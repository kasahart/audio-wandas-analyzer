const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
const fixtureNames = ['short-stereo.wav', 'changing-stereo.wav'];
const fixtures = fixtureNames.map(name => ({ name, bytes: fs.readFileSync(path.join(root, 'src/test/fixtures', name)) }));
const bytes = fixtures[0].bytes;
const commands = [
    { cmd: 'analyze' },
    { cmd: 'track-detail', trackIndex: 0, analysisId: 'fixture', settingsSignature: 'fixture' },
    { cmd: 'spectrum-slice', trackIndex: 0, analysisId: 'fixture', settingsSignature: 'fixture', cursorNorm: 0.437 },
    { cmd: 'range', startNorm: 0.21, endNorm: 0.63, points: 128 },
    { cmd: 'export-wav-loop', startNorm: 0.21, endNorm: 0.63 },
].map((command, index) => ({ ...command, requestId: String(index), filePath: '/sources/selected.wav', stftOptions: { nFft: 256, hopSize: 64, window: 'hann' } }));
function nativeResultsFor(fixture) {
const native = spawnSync(path.join(root, '.venv/bin/python'), ['-c', `
import sys,json
sys.path.insert(0,'python-backend')
from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from backend_server import dispatch
from browser_service import service
packet=json.loads(sys.stdin.read())
payload=open(packet['fixture'],'rb').read()
service.engine.load('selected.wav',payload)
commands=packet['commands']
byte_results=[dispatch(c,service) for c in commands]
native_service=AnalysisService(AnalysisEngine())
for c in commands:c['filePath']=packet['fixture']
native_results=[dispatch(c,native_service) for c in commands]
print(json.dumps([byte_results,native_results],allow_nan=False))
`], { maxBuffer: 32 * 1024 * 1024, cwd: root, input: JSON.stringify({commands,fixture:`src/test/fixtures/${fixture.name}`}), encoding: 'utf8', env: { ...process.env, MPLBACKEND: 'Agg' } });
assert.equal(native.status, 0, native.stderr);
return JSON.parse(native.stdout);
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
        browser=await chromium.launch({headless:true,args:['--mute-audio']});
        const page=await browser.newPage();
        const errors=[]; page.on('pageerror',error=>errors.push(error.message));
        const origin=`http://127.0.0.1:${server.address().port}`;
        await page.goto(origin+'/analyzer/index.html');
        const results=await page.evaluate(async ({fixtures,commands})=>{
            const worker=new Worker('./audio.worker.js',{type:'module'});
            let id=0;
            const run=command=>new Promise((resolve,reject)=>{
                const requestId=String(++id);
                worker.onmessage=({data})=> data.error?reject(new Error(data.error)):resolve(data.result);
                worker.onerror=event=>reject(new Error(event.message));
                worker.postMessage({...command,requestId});
            });
            try {
                const all=[];
                for (const fixture of fixtures) {
                    await run({cmd:'load',sourceId:'selected.wav',bytes:new Uint8Array(fixture.bytes).buffer});
                    const results=[];
                    for(const command of commands) results.push(await run(command));
                    all.push(results);
                    await run({cmd:'unload',filePath:'/sources/selected.wav'});
                }
                return all;
            } finally {worker.terminate();}
        },{fixtures:fixtures.map(fixture=>({bytes:Array.from(fixture.bytes)})),commands});
        compare(byteResults,results,'native/Pyodide');
        await page.getByLabel('Open short WAV').setInputFiles(path.join(root,'src/test/fixtures/short-stereo.wav'));
        await page.getByRole('status').filter({hasText:'waveform ready'}).waitFor({timeout:120000});
        assert.ok(await page.locator('canvas').count()>0);
        await page.evaluate(() => {
            window.__testInbound = [];
            window.__testOutbound = [];
            const original = window.__AWA_HOST__.postMessage;
            window.__AWA_HOST__.postMessage = message => { window.__testOutbound.push(message); original(message); };
            window.__AWA_HOST__.onMessage(message => window.__testInbound.push(message));
        });
        await page.locator('[data-action="content-spectrogram"]').click();
        await page.waitForFunction(() => document.querySelector('[data-action="content-spectrogram"]')?.classList.contains('is-active'));
        await page.waitForFunction(() => window.__testInbound.some(message => message.type === 'track-detail-result'
            && message.channels.every(channel => channel.spectrogram?.timeBins > 0)), undefined, {timeout:120000});
        assert.equal(await page.getByRole('status').filter({hasText:'Error'}).count(),0);
        await page.locator('[data-action="spectrogram-settings"]').click();
        await page.locator('#spec-auto').uncheck();
        await page.locator('#spec-nfft').selectOption('256');
        await page.locator('#spec-hop').fill('64');
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
        await page.locator('summary').filter({hasText:'Export'}).click();
        const [download] = await Promise.all([
            page.waitForEvent('download', {timeout:15000}),
            page.locator('[data-action="export-wav"]').click(),
        ]);
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
        await page.getByText('Cancel / clear',{exact:true}).click();
        await page.getByRole('status').filter({hasText:'Worker cleared'}).waitFor();
        assert.deepEqual(errors,[]);
        const picker = page.getByLabel('Open short WAV');
        const status = page.getByRole('status');
        const fixturePath = name => path.join(root,'src/test/fixtures',name);
        async function loadFile(name) {
            if (await page.locator('.track-row').count()) await page.getByText('Cancel / clear',{exact:true}).click();
            await picker.setInputFiles(fixturePath(name));
            await status.filter({hasText:`${name}: waveform ready`}).waitFor({timeout:120000});
            await page.waitForFunction(() => {
                const canvas=document.querySelector('#track-canvas-0');
                return canvas?.width>0 && Math.abs(canvas.width-canvas.getBoundingClientRect().width)<1.1;
            });
            assert.ok(await page.locator('audio').count() > 0);
            assert.equal(await page.locator('audio').evaluateAll(nodes=>nodes.every(audio=>audio.paused)),true);
        }
        await picker.setInputFiles({name:'bad.wav',mimeType:'audio/wav',buffer:Buffer.from('not a WAV')});
        await status.filter({hasText:'WAV only'}).waitFor();
        assert.equal(await page.locator('.track-row').count(),0);
        await loadFile('short-stereo.wav');
        const firstUrl = await page.locator('audio').first().getAttribute('src');
        await loadFile('changing-stereo.wav');
        const secondUrl = await page.locator('audio').first().getAttribute('src');
        assert.notEqual(firstUrl,secondUrl);
        assert.equal(await page.evaluate(async url => {try {await fetch(url);return true;} catch {return false;}},firstUrl),false);
        const changingBox = await page.locator('#track-canvas-0').boundingBox();
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
        await status.filter({hasText:'16 MiB or smaller'}).waitFor();
        assert.equal(await page.locator('.track-row').count(),1);
        const longWav=Buffer.alloc(44+31*8000*2*2);
        bytes.copy(longWav,0,0,44); longWav.writeUInt32LE(longWav.length-8,4); longWav.writeUInt32LE(longWav.length-44,40);
        await picker.setInputFiles({name:'long.wav',mimeType:'audio/wav',buffer:longWav});
        await status.filter({hasText:'up to 30 seconds'}).waitFor();
        assert.equal(await page.locator('.track-row').count(),1);
        await page.getByText('Cancel / clear',{exact:true}).click();
        await page.route('**/runtime/pyodide.mjs',route=>route.abort());
        await picker.setInputFiles(fixturePath('short-stereo.wav'));
        await status.filter({hasText:/fetch|network/i}).waitFor({timeout:120000});
        await page.unroute('**/runtime/pyodide.mjs');
        await loadFile('short-stereo.wav');
        await page.getByText('Cancel / clear',{exact:true}).click();
        await page.route('**/audio.worker.js',route=>route.fulfill({contentType:'text/javascript',body:'throw new Error("intentional-worker-failure")'}));
        await picker.setInputFiles(fixturePath('changing-stereo.wav'));
        await status.filter({hasText:'Audio Worker failed'}).waitFor();
        assert.equal(await page.locator('.track-row').count(),0);
        await page.unroute('**/audio.worker.js');
        await loadFile('changing-stereo.wav');
        await page.getByText('Cancel / clear',{exact:true}).click();
        const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
        await mobile.goto(origin+'/analyzer/');
        await mobile.getByLabel('Open short WAV').setInputFiles(fixturePath('short-stereo.wav'));
        await mobile.getByRole('status').filter({hasText:'waveform ready'}).waitFor({timeout:120000});
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
        await mobile.locator('[data-action="content-spectrogram"]').tap();
        await mobile.waitForFunction(()=>window.__testInbound.some(message=>message.type==='track-detail-result'
            && message.channels.every(channel=>channel.spectrogram?.timeBins>0)),undefined,{timeout:120000});
        assert.equal(await mobile.locator('[data-action="content-spectrogram"]').evaluate(node=>node.classList.contains('is-active')),true);
        await mobile.screenshot({path:path.join(root,'test-results/static-mobile.png')});
        await mobile.getByText('Cancel / clear',{exact:true}).tap();
        await mobile.close();
        await require('./test-browser-multi')({browser,origin,root,nativeResults,compare});
        assert.ok(errors.every(message=>message.includes('intentional-worker-failure')),errors.join('\n'));
        console.log('Subpath, settings, non-unit-duration cursor, invalid/oversized/long WAV, initialization/Worker failure recovery, repeated source switching/Blob cleanup, 390px touch viewport passed.');
        console.log(`Browser Worker/native WAV, waveform, STFT, real-time cursor, range/export parity: ${numbers} numeric comparisons passed. UI load/clear, no autoplay passed.`);
    } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
