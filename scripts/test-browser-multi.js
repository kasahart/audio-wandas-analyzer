const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = async function auditMulti({ browser, origin, root, nativeResults, compare }) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        const OriginalWorker = window.Worker;
        window.__workers = [];
        window.Worker = class extends OriginalWorker {
            constructor(...args) { super(...args); window.__workers.push(this); }
        };
    });
    await page.route('**/audio.worker.js', route => route.fulfill({contentType:'text/javascript',body:
        fs.readFileSync(path.join(root,'browser/audio.worker.js'),'utf8')
        + '\nself.addEventListener("message", event => {if(event.data.cmd === "__test_throw") throw new Error("intentional-multi-worker-failure");});'}));
    try {
        await page.goto(origin + '/analyzer/');
        await page.evaluate(() => {
            window.__multiIn = []; window.__multiOut = [];
            window.__AWA_HOST__.onMessage(message => window.__multiIn.push(message));
            const original = window.__AWA_HOST__.postMessage;
            window.__AWA_HOST__.postMessage = message => { window.__multiOut.push(message); original(message); };
        });
        const fixture = name => path.join(root,'src/test/fixtures',name);
        const picker = page.getByLabel('Open File', { exact: true });
        const status = page.locator('span[role="status"]');
        assert.equal(await picker.evaluate(input=>input.multiple),true);
        await picker.setInputFiles([fixture('short-stereo.wav'),fixture('changing-stereo.wav')]);
        await status.filter({hasText:'2 tracks'}).waitFor({timeout:120000});
        assert.equal(await page.locator('.track-row').count(),2);
        assert.equal(await page.evaluate(()=>window.__workers.length),1,'one shared Python runtime');
        const initial = await page.evaluate(()=>window.__multiIn.filter(m=>m.type==='analysis-update').at(-1).results);
        for(let i=0;i<2;i++) compare(nativeResults[i][0].channels,initial[i].channels,`multi.waveform[${i}]`);
        await page.locator('[data-action="content-spectrogram"]').click();
        await page.waitForFunction(()=>new Set(window.__multiIn.filter(m=>m.type==='track-detail-result'&&m.channels.every(c=>c.spectrogram?.timeBins>0)).map(m=>m.filePath)).size===2,undefined,{timeout:120000});
        await page.locator('[data-action="spectrogram-settings"]').click();
        await page.locator('#spec-auto').uncheck();await page.locator('#spec-nfft').selectOption('256');await page.locator('#spec-hop').fill('64');
        await page.evaluate(()=>window.__multiIn=[]);await page.locator('#spec-apply').click();
        await page.waitForFunction(()=>new Set(window.__multiIn.filter(m=>m.type==='track-detail-result'&&m.channels.every(c=>c.spectrogram?.windowSize===256&&c.spectrogram?.hopSize===64)).map(m=>m.filePath)).size===2,undefined,{timeout:120000});
        const detail = await page.evaluate(()=>window.__multiIn.filter(m=>m.type==='track-detail-result'));
        for(let i=0;i<2;i++) compare(nativeResults[i][1].channels,detail.find(m=>m.filePath===initial[i].filePath).channels,`multi.STFT[${i}]`);
        await page.screenshot({path:path.join(root,'test-results/browser-multi-stft.png'),fullPage:true});
        await page.locator('[data-action="content-waveform"]').click();
        await page.locator('[data-action="toggle-mute"]').first().click();
        assert.equal(await page.locator('audio').first().evaluate(audio=>audio.muted),true);
        await page.locator('[data-action="offset-up"]').first().click();
        assert.match(await page.locator('#offset-val-0').innerText(),/0\.010/);
        await page.waitForFunction(()=>{const c=document.querySelector('#track-canvas-0');return c?.width>0&&Math.abs(c.width-c.getBoundingClientRect().width)<1.1;});
        const box = await page.locator('#track-canvas-0').boundingBox();assert.ok(box);
        await page.mouse.move(box.x+box.width*.21,box.y+box.height*.5);await page.mouse.down();
        await page.mouse.move(box.x+box.width*.63,box.y+box.height*.5,{steps:5});await page.mouse.up();
        await page.locator('summary').filter({hasText:'Export'}).click();
        const [download] = await Promise.all([page.waitForEvent('download'),page.locator('[data-action="export-wav"]').click()]);
        assert.equal(download.suggestedFilename(),'selected-regions.zip');
        const selection = await page.evaluate(()=>window.__multiOut.filter(m=>m.type==='export-wav-loop').at(-1));
        assert.equal(selection.fileRegions.length,2);
        const first = selection.fileRegions.find(r=>r.filePath===initial[0].filePath);
        assert.equal(first.endNorm,1);assert.ok(Math.abs(first.startNorm-(selection.startNorm*2.5-.01))<1e-8);
        const checked = spawnSync(path.join(root,'.venv/bin/python'),['-c',[
            'import sys,json,zipfile,io,numpy as np,soundfile as sf',
            'z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None and z.namelist()==["short-stereo_loop.wav","changing-stereo_loop.wav"]',
            'regions=json.loads(sys.argv[2]); paths=json.loads(sys.argv[3])',
            'counts=[]',
            'for region,name in zip(regions,z.namelist(),strict=True):',
            ' source,rate=sf.read(paths[region["filePath"]],always_2d=True)',
            ' output,out_rate=sf.read(io.BytesIO(z.read(name)),always_2d=True)',
            ' a,b=(int(region[key]*len(source)) for key in ("startNorm","endNorm"))',
            ' assert out_rate==rate==8000 and output.shape==(b-a,2)',
            ' assert sf.info(io.BytesIO(z.read(name))).subtype=="PCM_16"',
            ' assert np.array_equal(output,source[a:b]); counts.append(len(output))',
            'print(json.dumps(counts))',
        ].join('\n'),await download.path(),JSON.stringify(selection.fileRegions),JSON.stringify(Object.fromEntries(initial.map((r,i)=>[r.filePath,fixture(i?'changing-stereo.wav':'short-stereo.wav')])) )],{encoding:'utf8'});
        assert.equal(checked.status,0,checked.stderr);console.log('Multi-track global-time/offset WAV ZIP exact samples:',checked.stdout.trim());
        // Shared generators feed both save adapters; inspect real downloaded UTF-8 files.
        async function exportReport(choice, extension) {
            page.once('dialog', dialog => dialog.accept(choice));
            const [report] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export-report"]').click()]);
            assert.equal(report.suggestedFilename(), 'short-stereo.' + extension);
            return fs.readFileSync(await report.path(), 'utf8');
        }
        const markdown = await exportReport('1', 'md');
        assert.match(markdown, /## Source paths/); assert.match(markdown, /selected-1-short-stereo.wav/);
        const notebook = JSON.parse(await exportReport('2', 'ipynb'));
        assert.equal(notebook.nbformat, 4);
        const code = notebook.cells.filter(cell => cell.cell_type === 'code').map(cell => cell.source.join('')).join('\n');
        assert.match(code, /wd.read\("selected-1-short-stereo.wav"\)/); assert.ok(!code.includes('/sources/'));
        const syntax = spawnSync(path.join(root,'.venv/bin/python'), ['-c', 'import sys; compile(sys.stdin.read(), "export.ipynb", "exec")'], {input:code,encoding:'utf8'});
        assert.equal(syntax.status, 0, syntax.stderr);
        page.once('dialog', dialog => dialog.dismiss());
        await page.locator('[data-action="export-report"]').click();
        await page.locator('summary').filter({hasText:'Export'}).click();
        await page.locator('[data-action="toggle-playback"]').last().click();
        await page.waitForFunction(()=>!document.querySelectorAll('audio')[1].paused);
        await page.locator('[data-action="stop-playback"]').last().click();
        assert.equal(await page.locator('audio').evaluateAll(xs=>xs.every(x=>x.paused)),true);
        const firstUrl=await page.locator('audio').first().getAttribute('src');
        await picker.setInputFiles(fixture('short-stereo.wav'));
        await status.filter({hasText:'3 tracks'}).waitFor();
        assert.equal(await page.locator('.track-row').count(),3);
        assert.equal(await page.locator('audio').first().getAttribute('src'),firstUrl);
        assert.equal(await page.locator('audio').first().evaluate(audio=>audio.muted),true,'mute survives additions');
        assert.match(await page.locator('#offset-val-0').innerText(),/0\.010/);
        const removedUrl=await page.locator('audio').last().getAttribute('src');
        await page.locator('[data-action="remove-track"]').last().click();
        assert.equal(await page.locator('.track-row').count(),2);
        assert.equal(await page.evaluate(async u=>{try{await fetch(u);return true;}catch{return false;}},removedUrl),false);
        const bytes=fs.readFileSync(fixture('short-stereo.wav'));
        await picker.setInputFiles([{name:'bad.wav',mimeType:'audio/wav',buffer:Buffer.from('invalid')},{name:'added.wav',mimeType:'audio/wav',buffer:bytes}]);
        await status.filter({hasText:'WAV only'}).waitFor();assert.equal(await page.locator('.track-row').count(),3);
        await picker.setInputFiles(Array.from({length:6},(_,i)=>({name:`additional-${i}.wav`,mimeType:'audio/wav',buffer:bytes})));
        await status.filter({hasText:'8 WAV files'}).waitFor();assert.equal(await page.locator('.track-row').count(),8);
        assert.equal(await page.evaluate(()=>window.__workers.length),1);
        const waitStftPainted = async () => {
            await page.waitForFunction(() => {
                const canvases = Array.from(document.querySelectorAll('canvas[id^="track-canvas-"]'));
                return canvases.length === 16 && canvases.every(canvas => {
                    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width - 20, canvas.height).data;
                    return pixels.some((value, index) => index % 4 === 3 && value > 0);
                });
            }, undefined, {timeout:30000});
        };
        await page.locator('[data-action="content-spectrogram"]').click();
        await waitStftPainted();
        await page.locator('[data-action="remove-track"]').last().click();
        await picker.setInputFiles({name:'replacement.wav',mimeType:'audio/wav',buffer:bytes});
        await status.filter({hasText:'8 tracks'}).waitFor();
        await waitStftPainted();
        assert.equal(await page.locator('[data-action="content-spectrogram"]').evaluate(button=>button.classList.contains('is-active')),true);
        console.log('Eight-track STFT remove/add: all 16 real Canvas rasters repainted without mode toggling.');
        await page.evaluate(()=>window.__workers[0].postMessage({cmd:'__test_throw',requestId:'test-fault'}));
        await status.filter({hasText:'Audio Worker failed'}).waitFor();assert.equal(await page.locator('.track-row').count(),0);
        assert.equal(await page.evaluate(async u=>{try{await fetch(u);return true;}catch{return false;}},firstUrl),false);
        await picker.setInputFiles(fixture('changing-stereo.wav'));await status.filter({hasText:'1 tracks'}).waitFor({timeout:120000});
        await page.locator('[data-action="browser-clear"]').click();assert.equal(await page.locator('.track-row').count(),0);
        assert.ok(errors.every(error=>error.includes('intentional-multi-worker-failure')),errors.join('\n'));
        await page.locator('[data-action="content-spectrogram"]').click();
        await page.reload();
        assert.equal(await page.locator('.track-row').count(),0,'audio is never persisted');
        const preferences = await page.evaluate(() => ({ settings: window.__APP_STATE__.spectrogramSettings, view: window.__AWA_HOST__.getState() }));
        assert.equal(preferences.settings.stft.nFft,256); assert.equal(preferences.settings.stft.hopSize,64);
        assert.equal(preferences.settings.auto,false); assert.equal(preferences.view.contentType,'spectrogram');
        assert.equal(await page.locator('[data-action="content-spectrogram"]').evaluate(button=>button.classList.contains('is-active')),true);
        const context = await browser.newContext({locale:'ja-JP'});
        try {
            const japanese = await context.newPage(); await japanese.goto(origin+'/analyzer/');
            assert.equal(await japanese.locator('html').getAttribute('lang'),'ja');
            assert.equal(await japanese.getByLabel('ファイルを開く',{exact:true}).count(),1);
            assert.equal(await japanese.evaluate(()=>window.__APP_STRINGS__.btnExportReport),'レポート');
            await japanese.getByLabel('ファイルを開く',{exact:true}).setInputFiles({name:'測定.wav',mimeType:'audio/wav',buffer:bytes});
            await japanese.locator('span[role="status"]').filter({hasText:'波形の準備完了'}).waitFor({timeout:120000});
            await japanese.locator('summary').filter({hasText:await japanese.evaluate(()=>window.__APP_STRINGS__.toolbarExportLabel)}).click();
            japanese.once('dialog',dialog=>{assert.match(dialog.message(),/レポート形式を選択/);return dialog.accept('1');});
            const [report] = await Promise.all([japanese.waitForEvent('download'),japanese.locator('[data-action="export-report"]').click()]);
            assert.equal(report.suggestedFilename(),'測定.md'); assert.match(fs.readFileSync(await report.path(),'utf8'),/測定.wav/);
            await japanese.locator('[data-action="browser-clear"]').click();
        } finally { await context.close(); }
        console.log('Multi-track lifecycle, shared WAV names, real Markdown/notebook downloads and Python syntax, report cancel, persisted STFT/display mode and Japanese browser locale/Unicode report passed.');
    } finally { await page.close(); }
};
