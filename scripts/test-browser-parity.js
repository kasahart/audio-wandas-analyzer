const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('@playwright/test');

/** Every track taken off with its lane's × (the entry table replaced the selection panel's clear-all), until none is left. */
async function removeAllTracks(page, act = 'click') {
    for (let left = await page.locator('.track-row').count(); left > 0; left = await page.locator('.track-row').count()) {
        await page.locator('.track-row [data-action="remove-track"]').first()[act]();
        await page.waitForFunction(count => document.querySelectorAll('.track-row').length < count, left);
    }
}
const root = path.resolve(__dirname, '..');
const fixtureNames = ['short-stereo.wav', 'changing-stereo.wav'];
const fixtures = fixtureNames.map(name => ({ name, bytes: fs.readFileSync(path.join(root, 'src/test/fixtures', name)) }));
const toneRate = 16000, toneBytes = Buffer.alloc(44 + toneRate * 4);
toneBytes.write('RIFF'); toneBytes.writeUInt32LE(toneBytes.length - 8, 4); toneBytes.write('WAVEfmt ', 8);
toneBytes.writeUInt32LE(16, 16); toneBytes.writeUInt16LE(1, 20); toneBytes.writeUInt16LE(2, 22);
toneBytes.writeUInt32LE(toneRate, 24); toneBytes.writeUInt32LE(toneRate * 4, 28);
toneBytes.writeUInt16LE(4, 32); toneBytes.writeUInt16LE(16, 34);
toneBytes.write('data', 36); toneBytes.writeUInt32LE(toneBytes.length - 44, 40);
for (let frame = 0; frame < toneRate; frame++) {
    [440, 880].forEach((hz, channel) => toneBytes.writeInt16LE(Math.round(16000 * Math.sin(2 * Math.PI * hz * frame / toneRate)), 44 + frame * 4 + channel * 2));
}
fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
const tonePath = path.join(root, 'test-results/generated-frequency-tones.wav');
fs.writeFileSync(tonePath, toneBytes);
const bytes = fixtures[0].bytes;
// Only these payloads list stftOptions; the schema rejects keys it does not list.
const STFT_COMMANDS = new Set(['analyze', 'track-detail', 'spectrum-slice', 'pair-spectrum', 'build-recipe']);
const withStft = (command, stftOptions) => (STFT_COMMANDS.has(command.cmd) ? { ...command, stftOptions } : command);
const commands = [
    { cmd: 'analyze' },
    { cmd: 'track-detail', trackIndex: 0, analysisId: 'fixture', settingsSignature: 'fixture' },
    { cmd: 'spectrum-slice', trackIndex: 0, analysisId: 'fixture', settingsSignature: 'fixture', cursorNorm: 0.437 },
    { cmd: 'spectrum-slice', trackIndex: 0, analysisId: 'fixture', settingsSignature: 'fixture', cursorNorm: 0.437, bandsPerOctave: 3 },
    { cmd: 'spectrum-slice', trackIndex: 0, analysisId: 'fixture', settingsSignature: 'fixture', cursorNorm: 0.437, bandsPerOctave: 1 },
    { cmd: 'range', startNorm: 0.21, endNorm: 0.63, points: 128 },
    { cmd: 'export-wav-loop', startNorm: 0.21, endNorm: 0.63 },
    { cmd: 'build-recipe', bandsPerOctave: 3 },
    { cmd: 'build-recipe', referenceChannel: 0, responses: [{ filePath: '/sources/selected.wav', channelIndex: 1 }] },
].map((command, index) => withStft({ ...command, requestId: String(index), filePath: '/sources/selected.wav' }, { nFft: 256, overlapPercent: 75, window: 'hann' }));
// Pair sources name their files inside the payload, so the command carries no top-level filePath.
const pairSource = (channelIndex, offsetSeconds) => ({ filePath: '/sources/selected.wav', channelIndex, offsetSeconds });
commands.push(withStft({ cmd: 'pair-spectrum', requestId: 'pair-parity', analysisId: 'fixture', settingsSignature: 'fixture',
    reference: pairSource(0, 0), responses: [pairSource(1, 0), pairSource(1, 0.05)] }, { nFft: 256, overlapPercent: 75, window: 'hann' }));
fixtures.push({ name: 'generated-frequency-tones.wav', path: tonePath, bytes: toneBytes, commands: [
    { ...commands[2], cursorNorm: 0.5 }, ...commands,
].map(command => withStft(command, { nFft: 2048, overlapPercent: 75, window: 'hann' })) });
function nativeResultsFor(fixture) {
const native = spawnSync(path.join(root, '.venv/bin/python'), ['-c', `
import sys,json
sys.path.insert(0,'python-backend')
from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from backend_server import dispatch
from browser_service import _service
service=_service()
packet=json.loads(sys.stdin.read())
payload=open(packet['fixture'],'rb').read()
service.engine.load('selected.wav',payload)
commands=packet['commands']
# MoSQITo prints resampling warnings to stdout, which carries only the JSON result here.
out=sys.stdout
sys.stdout=sys.stderr
byte_results=[dispatch(c,service) for c in commands]
native_service=AnalysisService(AnalysisEngine())
for c in commands:
    if c['cmd']=='pair-spectrum':
        for source in [c['reference'],*c['responses']]:
            source['filePath']=packet['fixture']
        continue
    c['filePath']=packet['fixture']
    for source in c.get('responses',[]):
        source['filePath']=packet['fixture']
    if c['cmd']=='run-recipe':
        c['inputs']={name: packet['fixture'] for name in c['inputs']}
native_results=[dispatch(c,native_service) for c in commands]
print(json.dumps([byte_results,native_results],allow_nan=False),file=out)
`], { maxBuffer: 32 * 1024 * 1024, cwd: root, input: JSON.stringify({commands:fixture.commands || commands,fixture:fixture.path || `src/test/fixtures/${fixture.name}`}), encoding: 'utf8', env: { ...process.env, MPLBACKEND: 'Agg' } });
assert.equal(native.status, 0, native.stderr);
return JSON.parse(native.stdout);
}
// The time-varying loudness recipe also checks that the Web runtime bundles MoSQITo.
for (const name of ['loudness.recipe.json', 'coherence.recipe.json', 'transfer-function.recipe.json']) {
    const recipe = JSON.parse(fs.readFileSync(path.join(root, 'python-backend/recipes', name), 'utf8'));
    commands.push({
        cmd: 'run-recipe', requestId: `recipe-${name}`, recipePath: `./recipes/${name}`, recipe,
        inputs: Object.fromEntries(recipe.inputs.map(input => [input.name, '/sources/selected.wav'])),
    });
}
const nativePairs = fixtures.map(nativeResultsFor);
const byteResults = nativePairs.map(pair => pair[0]);
const nativeResults = nativePairs.map(pair => pair[1]);
let numbers = 0;
function compare(a, b, at = '') {
    if (['computeMs', 'filePath', 'fileName'].some(key => at.endsWith('.' + key))) return;
    if (typeof a === 'number') {
        assert.equal(typeof b, 'number', at);
        assert.ok(Math.abs(a - b) <= 0.0002 + Math.abs(a) * 0.00002, `${at}: ${a} vs ${b}`); numbers++; return;
    }
    if (Array.isArray(a)) { assert.equal(a.length, b.length, at); a.forEach((x,i) => compare(x,b[i],`${at}[${i}]`)); return; }
    if (a && typeof a === 'object') { assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),at); for (const key of Object.keys(a)) compare(a[key],b[key],`${at}.${key}`); return; }
    assert.equal(a,b,at);
}
compare(byteResults,nativeResults,'native/bytes');
const base = path.join(root,'browser-dist');
const server = http.createServer((req,res) => {
    let pathname = new URL(req.url,'http://local').pathname;
    if (pathname.startsWith('/analyzer/')) pathname = pathname.slice('/analyzer'.length);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = path.resolve(base, '.' + decodeURIComponent(pathname));
    if (!target.startsWith(base + path.sep)) { res.writeHead(403);res.end();return; }
    const actual = target.endsWith(path.sep) ? path.join(target,'index.html') : target;
    fs.readFile(actual,(error,data) => {
        if(error){res.writeHead(404);res.end();return;}
        const ext=path.extname(actual);
        res.setHeader('Content-Type', ({ '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json' })[ext] || 'application/octet-stream');res.end(data);
    });
});
(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    let browser;
    try {
        browser=await chromium.launch({headless:true,executablePath:process.env.AWA_CHROMIUM_EXECUTABLE||undefined,args:['--mute-audio']});
        const page=await browser.newPage();
        const errors=[]; page.on('pageerror',error=>errors.push(error.message));
        const origin=`http://127.0.0.1:${server.address().port}`;
        await page.goto(origin+'/analyzer/index.html');
        // The page speaks the browser's language: what it says is read from its own strings, not assumed English.
        const S=await page.evaluate(()=>window.__APP_STRINGS__);
        const READY=S.browserReady.slice(0,S.browserReady.indexOf('{count}')).trim();
        const OPEN_FILE='input[data-action="browser-open-wav"]';
        const results=await page.evaluate(async ({fixtures,commands})=>{
            const worker=new Worker('./audio.worker.js',{type:'module'});
            let id=0;
            const run=command=>new Promise((resolve,reject)=>{
                const requestId=String(++id);
                worker.onmessage=({data})=>{ if(data.requestId!==requestId) return; data.error?reject(new Error(data.error.message)):resolve(data.result); };
                worker.onerror=event=>reject(new Error(event.message));
                worker.postMessage({...command,requestId});
            });
            try {
                const all=[];
                for (const fixture of fixtures) {
                    await run({cmd:'load',sourceId:'selected.wav',bytes:new Uint8Array(fixture.bytes).buffer});
                    const results=[];
                    for(const command of fixture.commands || commands) results.push(await run(command));
                    all.push(results);
                    await run({cmd:'unload',filePath:'/sources/selected.wav'});
                }
                return all;
            } finally {worker.terminate();}
        },{fixtures:fixtures.map(fixture=>({bytes:Array.from(fixture.bytes),commands:fixture.commands})),commands});
        compare(byteResults,results,'native/Pyodide');
        for (const runtime of [byteResults, nativeResults, results]) {
            for (const slice of [runtime[2][0], runtime[2][3]]) {
                assert.equal(slice.frequencyBins, 192);
                slice.channels.forEach((channel, i) => {
                    const peak = channel.values.indexOf(Math.max(...channel.values));
                    const hz = peak * slice.maxFrequencyHz / 191;
                    assert.ok(Math.abs(hz - [440, 880][i]) <= 8000 / 191 / 2 + 16000 / 2048, `known tone mapped to ${hz} Hz`);
                });
            }
            for (const [slice, bands] of [[runtime[2][4], [400, 800]], [runtime[2][5], [500, 1000]]]) {
                slice.channels.forEach((channel, i) => {
                    assert.equal(slice.bandCentersHz[channel.values.indexOf(Math.max(...channel.values))], bands[i]);
                });
            }
        }
        await page.locator(OPEN_FILE).setInputFiles(path.join(root,'src/test/fixtures/short-stereo.wav'));
        await page.getByRole('status').filter({hasText:READY}).waitFor({timeout:120000});
        assert.ok(await page.locator('canvas').count()>0);
        // Every track taken off with its lane's ×, as a user does (the entry table replaced the selection panel's
        // clear-all): no track row stays, and the Worker lets go of their audio.
        const clearAll = async () => {
            for (let left = await page.locator('.track-row').count(); left > 0; left = await page.locator('.track-row').count()) {
                await page.locator('.track-row [data-action="remove-track"]').first().click();
                await page.waitForFunction(count => document.querySelectorAll('.track-row').length < count, left);
            }
        };
        // The first track's canvas: track numbers go on counting after tracks are taken off, so it is not always 0.
        const firstCanvas = async (target = page) => `#${await target.evaluate(() => [...document.querySelectorAll('.track-row canvas')].map(canvas => canvas.id).find(id => /^track-canvas-\d+$/.test(id)))}`;
        const recordHostMessages = () => page.evaluate(() => {
            window.__testInbound = [];
            window.__testOutbound = [];
            const original = window.__AWA_HOST__.postMessage;
            window.__AWA_HOST__.postMessage = message => { window.__testOutbound.push(message); original(message); };
            window.__AWA_HOST__.onMessage(message => window.__testInbound.push(message));
        });
        await recordHostMessages();
        await page.waitForFunction(() => window.__testInbound.some(message => message.type === 'track-detail-result'
            && message.channels.every(channel => channel.spectrogram?.timeBins > 0)), undefined, {timeout:120000});
        assert.equal(await page.getByRole('status').filter({hasText:'Error'}).count(),0);
        await page.evaluate(() => {
            const download = window.__AWA_HOST__.downloadFile;
            window.__AWA_HOST__.downloadFile = (content, name, mimeType) => {
                window.__csvArtifact = {content, name, mimeType}; download(content, name, mimeType);
            };
        });
        const csvMenu = page.locator('details').filter({has:page.locator('[data-action="export-csv"]')});
        await csvMenu.locator('summary').click();
        const [csvDownload] = await Promise.all([page.waitForEvent('download'),page.locator('[data-action="export-csv"]').click()]);
        assert.equal(csvDownload.suggestedFilename(),'spectrum-export.csv');
        assert.equal(await csvDownload.failure(),null);
        const csv = fs.readFileSync(await csvDownload.path(),'utf8');
        const artifact = await page.evaluate(()=>window.__csvArtifact);
        assert.equal(csv,artifact.content);assert.equal(artifact.mimeType,'text/csv;charset=utf-8');
        const csvRows = csv.trim().split('\n').map(line=>line.split(','));
        assert.equal(csvRows[0].length,4,'stereo exports frequency/level for both channels');
        assert.ok(csvRows.length>1 && csvRows.length<=193);
        assert.ok(csvRows.slice(1).every(row=>row.length===4 && row.every(value=>Number.isFinite(Number(value)))));
        assert.equal(Number(csvRows.at(-1)[0]),4000);assert.equal(Number(csvRows.at(-1)[2]),4000);
        await csvMenu.locator('summary').click();
        console.log('Real static CSV Blob download and UTF-8/channel/frequency content passed.');
        await page.locator('[data-action="spectrogram-settings"]').click();
        await page.locator('#spec-auto').uncheck();
        await page.locator('#spec-nfft').selectOption('256');
        await page.locator('#spec-overlap').selectOption('75');
        await page.evaluate(() => { window.__testInbound = []; });
        await page.locator('#spec-apply').click();
        await page.waitForFunction(() => window.__testInbound.some(message => message.type === 'reanalyze-end')
            && window.__testInbound.some(message => message.type === 'track-detail-result'
                && message.channels.every(channel => channel.spectrogram?.windowSize === 256 && channel.spectrogram?.hopSize === 64)));
        assert.equal(await page.locator('#reanalyze-overlay').isVisible(), false);
        await page.locator('[data-action="content-waveform"]').click();
        await page.waitForTimeout(300);
        const box = await page.locator('#track-canvas-0').boundingBox();
        assert.ok(box);
        await page.evaluate(() => { window.__testInbound = []; });
        await page.mouse.click(box.x + box.width * .437, box.y + box.height * .5);
        await page.waitForFunction(() => window.__testInbound.some(message => message.type === 'spectrum-slice-result' && Math.abs(message.cursorNorm - .437) < .01));
        await page.mouse.move(box.x + box.width * .21, box.y + box.height * .5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * .63, box.y + box.height * .5, { steps: 4 });
        await page.mouse.up();
        await page.locator('#tb-export-menu > summary').click();
        const [download] = await Promise.all([
            page.waitForEvent('download', {timeout:15000}),
            page.locator('[data-action="export-wav"]').click(),
        ]);
        assert.equal(download.suggestedFilename(), 'short-stereo_loop.wav');
        const exported = fs.readFileSync(await download.path());
        assert.equal(exported.toString('ascii', 0, 4), 'RIFF');
        assert.ok(exported.length > 44 && exported.length < bytes.length);
        const selection = await page.evaluate(() => window.__testOutbound.filter(message => message.type === 'export-wav-loop').at(-1));
        const checked = spawnSync(path.join(root, '.venv/bin/python'), ['-c', [
            'import sys,json,numpy as np,soundfile as sf',
            'source,rate=sf.read(sys.argv[1],always_2d=True)',
            'output,output_rate=sf.read(sys.argv[2],always_2d=True)',
            'start,end=(int(float(v)*len(source)) for v in sys.argv[3:5])',
            'assert output_rate==rate==8000 and output.shape==(end-start,2)',
            'assert sf.info(sys.argv[2]).subtype=="PCM_16"',
            'assert np.array_equal(output,source[start:end])',
            'print(json.dumps({"frames":len(output),"rate":output_rate,"channels":2}))',
        ].join('\n'), path.join(root,'src/test/fixtures/short-stereo.wav'), await download.path(), String(selection.startNorm), String(selection.endNorm)], {encoding:'utf8'});
        assert.equal(checked.status,0,checked.stderr);
        console.log('Actual UI region WAV inspected:',checked.stdout.trim());
        assert.ok(await page.locator('audio').count() > 0);
        const trackCount = await page.locator('.track-row').count();
        assert.ok(trackCount > 0);
        await page.evaluate(async () => {
            const message = { type: 'analysis-update', results: [] };
            window.dispatchEvent(new MessageEvent('message', { origin: 'https://untrusted.example', source: window, data: message }));
            window.postMessage(message, '*');
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        assert.equal(await page.locator('.track-row').count(), trackCount);
        assert.equal(await page.locator('audio').evaluateAll(nodes=>nodes.every(audio=>audio.paused)),true);
        await clearAll();
        assert.deepEqual(errors,[]);
        const picker = page.locator(OPEN_FILE);
        const status = page.getByRole('status');
        const fixturePath = name => path.join(root,'src/test/fixtures',name);
        async function loadFile(name) {
            if (await page.locator('.track-row').count()) await clearAll();
            await picker.setInputFiles(fixturePath(name));
            await status.filter({hasText:`${name}: ${READY}`}).waitFor({timeout:120000});
            await page.waitForFunction(() => {
                const canvas=[...document.querySelectorAll('.track-row canvas')].find(item=>/^track-canvas-\d+$/.test(item.id));
                return canvas?.width>0 && Math.abs(canvas.width-canvas.getBoundingClientRect().width)<1.1;
            });
            assert.ok(await page.locator('audio').count() > 0);
            assert.equal(await page.locator('audio').evaluateAll(nodes=>nodes.every(audio=>audio.paused)),true);
        }
        await picker.setInputFiles({name:'bad.wav',mimeType:'audio/wav',buffer:Buffer.from('not a WAV')});
        await status.filter({hasText:'Unable to read audio'}).waitFor();
        assert.doesNotMatch(await page.locator('span[role="status"]').innerText(),/Traceback|PythonError|\n/);
        assert.equal(await page.locator('.track-row').count(),0);
        // Non-WAV formats decode in Pyodide through the same wandas readers as the desktop backend.
        const encode = format => spawnSync(path.join(root,'.venv/bin/python'),['-c','import sys,io,soundfile as sf; d,r=sf.read(sys.argv[1]); b=io.BytesIO(); sf.write(b,d,r,format=sys.argv[2]); sys.stdout.buffer.write(b.getvalue())',fixturePath('short-stereo.wav'),format]);
        const flac = encode('FLAC'), aiff = encode('AIFF');
        assert.equal(flac.status,0,String(flac.stderr));
        assert.equal(aiff.status,0,String(aiff.stderr));
        const accelCsv = 'time,x\n' + Array.from({length:2000},(_,i)=>`${i/1000},${Math.sin(2*Math.PI*50*i/1000)}`).join('\n') + '\n';
        await picker.setInputFiles([{name:'take.flac',mimeType:'audio/flac',buffer:flac.stdout},{name:'take.aiff',mimeType:'audio/aiff',buffer:aiff.stdout},{name:'accel.csv',mimeType:'text/csv',buffer:Buffer.from(accelCsv)}]);
        await status.filter({hasText:`accel.csv: ${READY}`}).waitFor({timeout:120000});
        assert.equal(await page.locator('.track-row').count(),3);
        // Chromium decodes neither AIFF nor a CSV blob, so only the FLAC track gets transport audio.
        assert.equal(await page.locator('audio').count(),1);
        for (const name of ['take.aiff','accel.csv']) assert.ok(await page.locator('.track-row',{hasText:name}).locator('.track-btns [disabled]').count()>0, name);
        await clearAll();
        await loadFile('short-stereo.wav');
        const firstUrl = await page.locator('audio').first().getAttribute('src');
        await loadFile('changing-stereo.wav');
        const secondUrl = await page.locator('audio').first().getAttribute('src');
        assert.notEqual(firstUrl,secondUrl);
        assert.equal(await page.evaluate(async url => {try {await fetch(url);return true;} catch {return false;}},firstUrl),false);
        const changingBox = await page.locator(await firstCanvas()).boundingBox();
        assert.ok(changingBox);
        await page.mouse.click(changingBox.x + changingBox.width * .2, changingBox.y + changingBox.height * .5);
        await page.waitForFunction(() => window.__testInbound.some(message => message.type==='spectrum-slice-result' && Math.abs(message.cursorNorm-.2)<.01));
        await page.evaluate(() => { window.__testInbound = []; });
        await page.mouse.click(changingBox.x + changingBox.width * .437, changingBox.y + changingBox.height * .5);
        await page.waitForFunction(() => window.__testInbound.some(message => message.type==='spectrum-slice-result' && Math.abs(message.cursorNorm-.437)<.01));
        const peakHz = await page.evaluate(() => {
            const slice=window.__testInbound.filter(message=>message.type==='spectrum-slice-result' && Math.abs(message.cursorNorm-.437)<.01).at(-1);
            const values=slice.channels[0].values;
            return values.indexOf(Math.max(...values))*slice.maxFrequencyHz/(slice.frequencyBins-1);
        });
        assert.ok(Math.abs(peakHz-880)<80,`2.5s cursor should select the later 880Hz section, got ${peakHz}`);
        await picker.setInputFiles({name:'oversized.wav',mimeType:'audio/wav',buffer:Buffer.alloc(16*1024*1024+1)});
        await status.filter({hasText:S.browserInputTooLarge.replace('{mib}','16')}).waitFor();
        assert.equal(await page.locator('.track-row').count(),1);
        const longWav=Buffer.alloc(44+31*8000*2*2);
        bytes.copy(longWav,0,0,44); longWav.writeUInt32LE(longWav.length-8,4); longWav.writeUInt32LE(longWav.length-44,40);
        await picker.setInputFiles({name:'long.wav',mimeType:'audio/wav',buffer:longWav});
        await status.filter({hasText:'up to 30 seconds'}).waitFor();
        assert.doesNotMatch(await page.locator('span[role="status"]').innerText(),/Traceback|PythonError|\n/);
        assert.equal(await page.locator('.track-row').count(),1);
        await clearAll();
        // Clearing keeps a booted Worker, so a boot failure needs a fresh page; the failed boot is retried by the next WAV.
        await page.route('**/runtime/pyodide.mjs',route=>route.abort());
        await page.reload();
        await picker.setInputFiles(fixturePath('short-stereo.wav'));
        await status.filter({hasText:/fetch|network/i}).waitFor({timeout:120000});
        await page.unroute('**/runtime/pyodide.mjs');
        // A revisit boots from the runtime cache; Pyodide's own module scripts and the lock still come from HTTP.
        const nativeWheel='six-1.17.0-py2.py3-none-any.whl';
        const runtimeDownloads=[];
        const cachedRuntime=/\/runtime\/(?!lock\.json$|pyodide\.mjs$|pyodide\.asm\.mjs$)[^/]+$/;
        await page.route(cachedRuntime,route=>{runtimeDownloads.push(path.basename(new URL(route.request().url()).pathname));return route.continue();});
        // Cache writes are not awaited by the boot, so the check waits until every runtime file is stored.
        const runtimeAssetCount=JSON.parse(fs.readFileSync(path.join(base,'runtime/lock.json'),'utf8')).assets.length;
        await page.waitForFunction(async count=>(await (await caches.open('awa-runtime')).keys()).length>=count,runtimeAssetCount,{timeout:60000});
        await page.reload();
        await picker.setInputFiles(fixturePath('short-stereo.wav'));
        await status.filter({hasText:READY}).waitFor({timeout:120000});
        assert.deepEqual(runtimeDownloads,[]);
        // A corrupted cache entry is downloaded again instead of failing the boot.
        await page.evaluate(async name=>{
            const cache=await caches.open('awa-runtime');
            const key=(await cache.keys()).find(request=>request.url.includes(name));
            await cache.put(key,new Response('corrupted'));
        },nativeWheel);
        await page.reload();
        await picker.setInputFiles(fixturePath('short-stereo.wav'));
        await status.filter({hasText:READY}).waitFor({timeout:120000});
        assert.deepEqual(runtimeDownloads,[nativeWheel]);
        await page.unroute(cachedRuntime);
        // Native wheels are verified only by their locked hash, so a tampered download must still fail the boot.
        await page.evaluate(()=>caches.delete('awa-runtime'));
        const tampered=fs.readFileSync(path.join(base,'runtime',nativeWheel));
        tampered[tampered.length-1]^=0xff;
        await page.route(`**/runtime/${nativeWheel}`,route=>route.fulfill({contentType:'application/octet-stream',body:tampered}));
        await page.reload();
        await picker.setInputFiles(fixturePath('short-stereo.wav'));
        await status.filter({hasText:'Failed to load runtime packages'}).waitFor({timeout:120000});
        assert.equal(await page.locator('.track-row').count(),0);
        await page.unroute(`**/runtime/${nativeWheel}`);
        await page.route('**/audio.worker.js',route=>route.fulfill({contentType:'text/javascript',body:'throw new Error("intentional-worker-failure")'}));
        await picker.setInputFiles(fixturePath('changing-stereo.wav'));
        await status.filter({hasText:S.browserWorkerFailed}).waitFor();
        assert.equal(await page.locator('.track-row').count(),0);
        await page.unroute('**/audio.worker.js');
        await loadFile('changing-stereo.wav');
        await recordHostMessages();
        await clearAll();
        await picker.setInputFiles(tonePath);
        await status.filter({hasText:READY}).waitFor({timeout:120000});
        await page.locator('[data-action="spectrogram-settings"]').click();
        await page.locator('#spec-auto').uncheck();
        await page.locator('#spec-nfft').selectOption('2048');
        await page.locator('#spec-overlap').selectOption('75');
        await page.locator('#spec-maxfreq').fill('2000');
        await page.evaluate(() => {window.__testInbound = [];});
        await page.locator('#spec-apply').click();
        await page.waitForFunction(() => window.__testInbound.some(m => m.type === 'track-detail-result'
            && m.channels.every(c => c.spectrogram?.windowSize === 2048)),undefined,{timeout:120000});
        // The spectrogram under the waveform: its plot ends 50 px before the canvas does, at the colour bar.
        const toneCanvas = await page.locator((await firstCanvas()).replace('track-canvas-', 'track-spec-canvas-')).boundingBox();
        await page.evaluate(() => {window.__testInbound = [];});
        await page.mouse.click(toneCanvas.x + (toneCanvas.width - 50) * .5, toneCanvas.y + toneCanvas.height * .5);
        await page.waitForFunction(() => window.__testInbound.some(m => m.type === 'spectrum-slice-result' && Math.abs(m.cursorNorm - .5) < .01));
        const toneCsvMenu = page.locator('details').filter({has:page.locator('[data-action="export-csv"]')});
        if (!await toneCsvMenu.evaluate(node=>node.open)) await toneCsvMenu.locator('summary').click();
        const [toneCsvDownload] = await Promise.all([page.waitForEvent('download'),page.locator('[data-action="export-csv"]').click()]);
        const toneCsvRows = fs.readFileSync(await toneCsvDownload.path(),'utf8').trim().split('\n').slice(1).map(row=>row.split(',').map(Number));
        assert.equal(toneCsvRows.length,192);
        // The menu closes after an export; close it only if it is still open, or a click would open it over the spectra.
        if (await toneCsvMenu.evaluate(node=>node.open)) await toneCsvMenu.locator('summary').click();
        for (const [channel, hz] of [[0,440],[1,880]]) {
            const peakRow = toneCsvRows.reduce((best,row)=>row[channel*2+1]>best[channel*2+1]?row:best);
            const peakHz = peakRow[channel*2], peakDb = peakRow[channel*2+1];
            assert.ok(Math.abs(peakHz-hz)<=8000/191/2+16000/2048, `CSV ${hz} Hz tone exported as ${peakHz}`);
            const canvasId = (await firstCanvas()).replace('track-canvas-', 'track-spectrum-') + (channel ? '-1' : '');
            await page.locator(canvasId).scrollIntoViewIfNeeded();
            const spectrumBox = await page.locator(canvasId).boundingBox();
            assert.ok(spectrumBox);
            await page.mouse.move(spectrumBox.x+32+(spectrumBox.width-38)*peakHz/2000,spectrumBox.y+spectrumBox.height*.5);
            await page.waitForFunction(expected=>{
                const text=document.getElementById('spectrum-freq-readout')?.textContent || '';
                const match=text.match(/(\d+(?:\.\d+)?) Hz \/ (-?\d+(?:\.\d+)?)/);
                return match && Math.abs(Number(match[1])-expected.hz)<.11 && Math.abs(Number(match[2])-expected.db)<.11;
            },{hz:peakHz,db:peakDb});
            const stftId = (await firstCanvas()).replace('track-canvas-', 'track-spec-canvas-') + (channel ? '-1' : '');
            const band = await page.locator(stftId).evaluate(canvas=>{
                const x=Math.floor((canvas.width-50)*.5), h=canvas.height;
                const data=canvas.getContext('2d').getImageData(x,0,1,h).data;
                const green=Array.from({length:h},(_,y)=>data[y*4+1]);
                const top=Math.max(...green), rows=green.map((v,y)=>v===top?y:-1).filter(y=>y>=0);
                return {hz:(1-(rows[0]+rows.at(-1)+1)/2/h)*2000,pixelHz:2000/h,top};
            });
            assert.ok(band.top>100,'actual STFT raster must be painted');
            assert.ok(Math.abs(band.hz-peakHz)<=band.pixelHz+1,`STFT band ${band.hz} Hz vs CSV/hover ${peakHz} Hz`);
            console.log(`Known ${hz} Hz: CSV/hover ${peakHz} Hz, actual STFT band ${band.hz.toFixed(2)} Hz (192-bin resolution).`);
        }
        await page.screenshot({path:path.join(root,'test-results/frequency-tones.png')});
        assert.equal(await page.locator('audio').evaluateAll(xs=>xs.every(x=>x.paused)),true);
        await clearAll();
        const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
        await mobile.goto(origin+'/analyzer/');
        await mobile.locator(OPEN_FILE).setInputFiles(fixturePath('short-stereo.wav'));
        await mobile.getByRole('status').filter({hasText:READY}).waitFor({timeout:120000});
        const mobileBox=await mobile.locator('#track-canvas-0').boundingBox();
        assert.ok(mobileBox?.width>0);
        await mobile.evaluate(() => {
            window.__testInbound=[];
            window.__AWA_HOST__.onMessage(message=>window.__testInbound.push(message));
        });
        await mobile.touchscreen.tap(mobileBox.x+mobileBox.width*.5,mobileBox.y+mobileBox.height*.5);
        await mobile.waitForFunction(()=>window.__testInbound.some(message=>message.type==='spectrum-slice-result' && Math.abs(message.cursorNorm-.5)<.1));
        const cdp=await mobile.context().newCDPSession(mobile);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mobileBox.x+mobileBox.width*.2,y:mobileBox.y+mobileBox.height*.5}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mobileBox.x+mobileBox.width*.7,y:mobileBox.y+mobileBox.height*.5}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        assert.equal(await mobile.locator('#loop-time-display').isVisible(),false,'documented prototype limitation: no touch-drag region');
        console.log('390px touch tap/STFT passed; touch-drag region remains unavailable.');
        // The spectrogram under the waveform is painted without a toggle (its detail may have come before the listener).
        await mobile.waitForFunction(()=>{
            const canvas=document.getElementById('track-spec-canvas-0');
            if(!canvas?.width) return false;
            const data=canvas.getContext('2d').getImageData(0,0,Math.max(1,canvas.width-50),canvas.height).data;
            return data.some((value,index)=>index%4===3&&value>0);
        },undefined,{timeout:120000});
        await mobile.screenshot({path:path.join(root,'test-results/static-mobile.png')});
        await removeAllTracks(mobile, 'tap');
        await mobile.close();
        await require('./test-browser-multi')({browser,origin,root,nativeResults,compare});
        await require('./test-browser-auto-96k')({browser,origin,root,compare});
        assert.ok(errors.every(message=>message.includes('intentional-worker-failure')),errors.join('\n'));
        console.log('Subpath, settings, non-unit-duration cursor, invalid/oversized/long WAV, initialization/Worker failure recovery, repeated source switching/Blob cleanup, 390px touch viewport passed.');
        console.log(`Browser Worker/native WAV, waveform, STFT, real-time cursor, range/export parity: ${numbers} numeric comparisons passed. UI load/clear, no autoplay passed.`);
    } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); fs.rmSync(tonePath,{force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
