const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
const bytes = fs.readFileSync(path.join(root, 'src/test/fixtures/short-stereo.wav'));
const commands = [
    { cmd: 'analyze' },
    { cmd: 'track-detail', trackIndex: 0, analysisId: 'fixture', settingsSignature: 'fixture' },
    { cmd: 'spectrum-slice', trackIndex: 0, analysisId: 'fixture', settingsSignature: 'fixture', cursorNorm: 0.437 },
    { cmd: 'range', startNorm: 0.21, endNorm: 0.63, points: 128 },
    { cmd: 'export-wav-loop', startNorm: 0.21, endNorm: 0.63 },
].map((command, index) => ({ ...command, requestId: String(index), filePath: '/sources/selected.wav', stftOptions: { nFft: 256, hopSize: 64, window: 'hann' } }));
const native = spawnSync(path.join(root, '.venv/bin/python'), ['-c', `
import sys,json
sys.path.insert(0,'python-backend')
from analysis_engine import AnalysisEngine
from analysis_service import AnalysisService
from backend_server import dispatch
from browser_service import service
payload=open('src/test/fixtures/short-stereo.wav','rb').read()
service.engine.load('selected.wav',payload)
commands=json.loads(sys.stdin.read())
byte_results=[dispatch(c,service) for c in commands]
native_service=AnalysisService(AnalysisEngine())
for c in commands:c['filePath']='src/test/fixtures/short-stereo.wav'
native_results=[dispatch(c,native_service) for c in commands]
print(json.dumps([byte_results,native_results],allow_nan=False))
`], { maxBuffer: 32 * 1024 * 1024, cwd: root, input: JSON.stringify(commands), encoding: 'utf8', env: { ...process.env, MPLBACKEND: 'Agg' } });
assert.equal(native.status, 0, native.stderr);
const [byteResults, nativeResults] = JSON.parse(native.stdout);
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
    const target = path.resolve(base, '.' + decodeURIComponent(new URL(req.url,'http://local').pathname));
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
        browser=await chromium.launch({headless:true});
        const page=await browser.newPage();
        const errors=[]; page.on('pageerror',error=>errors.push(error.message));
        const origin=`http://127.0.0.1:${server.address().port}`;
        await page.goto(origin+'/index.html');
        const results=await page.evaluate(async ({bytes,commands})=>{
            const worker=new Worker('./audio.worker.js',{type:'module'});
            let id=0;
            const run=command=>new Promise((resolve,reject)=>{
                const requestId=String(++id);
                worker.onmessage=({data})=> data.error?reject(new Error(data.error)):resolve(data.result);
                worker.onerror=event=>reject(new Error(event.message));
                worker.postMessage({...command,requestId});
            });
            try {
                await run({cmd:'load',sourceId:'selected.wav',bytes:new Uint8Array(bytes).buffer});
                const results=[];
                for(const command of commands) results.push(await run(command));
                return results;
            } finally {worker.terminate();}
        },{bytes:Array.from(bytes),commands});
        compare(byteResults,results,'native/Pyodide');
        await page.getByLabel('Open short WAV').setInputFiles(path.join(root,'src/test/fixtures/short-stereo.wav'));
        await page.getByRole('status').filter({hasText:'waveform ready'}).waitFor({timeout:120000});
        assert.ok(await page.locator('canvas').count()>0);
        await page.locator('[data-action="content-spectrogram"]').click();
        await page.waitForFunction(() => document.querySelector('[data-action="content-spectrogram"]')?.classList.contains('is-active'));
        await page.waitForTimeout(1500);
        assert.equal(await page.getByRole('status').filter({hasText:'Error'}).count(),0);
        await page.locator('[data-action="content-waveform"]').click();
        await page.waitForTimeout(300);
        const box = await page.locator('#track-canvas-0').boundingBox();
        assert.ok(box);
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
        assert.equal(await page.locator('audio').evaluateAll(nodes=>nodes.every(audio=>audio.paused)),true);
        await page.getByText('Cancel / clear',{exact:true}).click();
        await page.getByRole('status').filter({hasText:'Worker cleared'}).waitFor();
        assert.deepEqual(errors,[]);
        console.log(`Browser Worker/native WAV, waveform, STFT, real-time cursor, range/export parity: ${numbers} numeric comparisons passed. UI load/clear, no autoplay passed.`);
    } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
