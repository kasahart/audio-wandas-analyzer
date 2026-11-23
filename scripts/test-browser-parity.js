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
// The native side runs on the Python the tests use, found as the extension finds it (npm run build:browser compiled it).
const python = require(path.join(root, 'dist/test/helpers/python.js')).testPython();
assert.ok(python, 'no Python found for the native side (a workspace venv, VIRTUAL_ENV, WANDAS_PYTHON or python3)');
// The page speaks the browser's language (staticHost: navigator.language), and headless Chromium takes that from the
// machine's LANG unless told: a Japanese desktop ran the Japanese page where CI (LANG=C.UTF-8) ran the English one, so
// a check could pass on one and fail on the other. Every page opened here is in this one locale; CI's is en-US.
// AWA_BROWSER_LOCALE=ja runs the same checks on the Japanese page. A page that asks for its own locale keeps it.
const BROWSER_LOCALE = process.env.AWA_BROWSER_LOCALE || 'en-US';
function pinLocale(browser) {
    for (const name of ['newPage', 'newContext']) {
        const open = browser[name].bind(browser);
        browser[name] = (options = {}) => open({ locale: BROWSER_LOCALE, ...options });
    }
    return browser;
}
// The exports read back by the reader of what the Analyzer writes (RFC 4180): an English header has commas in it.
const { csvRecords } = require(path.join(root, 'dist/shared/utils/csv.js'));
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
const STFT_COMMANDS = new Set(['analyze', 'track-answers', 'cursor-answers', 'pair-answers', 'build-recipe']);
const withStft = (command, stftOptions) => (STFT_COMMANDS.has(command.cmd) ? { ...command, stftOptions } : command);
const commands = [
    { cmd: 'analyze' },
    // A Tracks row's answers (each channel's samples and spectrogram levels) are kept by key too.
    { cmd: 'track-answers', scale: 'linear' },
    // The cursor spectrum's answers are kept by key: the reply names them and carries no value (rows below read them).
    { cmd: 'cursor-answers', cursorNorm: 0.437, scale: 'linear' },
    { cmd: 'cursor-answers', cursorNorm: 0.437, bandsPerOctave: 3 },
    { cmd: 'cursor-answers', cursorNorm: 0.437, bandsPerOctave: 1 },
    { cmd: 'export-wav-loop', startNorm: 0.21, endNorm: 0.63 },
    { cmd: 'build-recipe', bandsPerOctave: 3 },
    { cmd: 'build-recipe', referenceChannel: 0, responses: [{ filePath: '/sources/selected.wav', channelIndex: 1 }] },
].map((command, index) => withStft({ ...command, requestId: String(index), filePath: '/sources/selected.wav' }, { nFft: 256, overlapPercent: 75, window: 'hann' }));
// Pair sources name their files inside the payload, so the command carries no top-level filePath.
const pairSource = (channelIndex, offsetSeconds) => ({ filePath: '/sources/selected.wav', channelIndex, offsetSeconds });
// A region's peak names its files inside the payload too: the largest |sample| of every channel over the stretch.
commands.push({ cmd: 'region-peak', requestId: 'region-peak', sources: [{ filePath: '/sources/selected.wav', channels: [], startNorm: 0.21, endNorm: 0.63 }] });
commands.push(withStft({ cmd: 'pair-answers', requestId: 'pair-parity',
    reference: pairSource(0, 0), responses: [pairSource(1, 0), pairSource(1, 0.05)] }, { nFft: 256, overlapPercent: 75, window: 'hann' }));
/**
 * Every value of the lines an answers command kept (the command of that requestId in the same list), as the figure
 * service's table gives them: a draw, its table (every point of every line, never thinned), and the figure let go.
 * `$spec` and `$dataId` name an earlier command of the list by its requestId; both runners fill them in from that
 * command's reply (the figure spec of its keys; the data id of its picture) before they send the command.
 */
const rowsOf = asked => [
    { cmd: 'figure-draw', requestId: `draw-${asked}`, figureId: `parity-${asked}`, generation: 1, requestNumber: 1, spec: { $spec: asked }, width: 900, height: 360, view: null, selection: null },
    { cmd: 'figure-export', requestId: `rows-${asked}`, spec: { $spec: asked }, dataId: { $dataId: `draw-${asked}` } },
    { cmd: 'figure-release', requestId: `release-${asked}`, figureId: `parity-${asked}` },
];
commands.push(...rowsOf('2'), ...rowsOf('3'), ...rowsOf('4'), ...rowsOf('pair-parity'));
// A Tracks row as the page draws it: the first channel's waveform over its spectrogram, one picture of the figure
// service from the answers command 1 kept (every number of the picture is compared: the ranges, the points drawn).
commands.push(
    { cmd: 'figure-draw', requestId: 'draw-row', figureId: 'parity-row', generation: 1, requestNumber: 1, spec: { $spec: '1' }, width: 900, height: 360, view: null, selection: null },
    { cmd: 'figure-release', requestId: 'release-row', figureId: 'parity-row' },
);
// An 8192-point cursor spectrum: every one of its 4097 bins is kept and written, whatever the width it is drawn at.
const longFft = { nFft: 8192, overlapPercent: 75, window: 'hann' };
fixtures.push({ name: 'generated-frequency-tones.wav', path: tonePath, bytes: toneBytes, commands: [
    { ...commands[2], requestId: 'tone-mid', cursorNorm: 0.5 }, ...rowsOf('tone-mid'), ...commands,
].map(command => withStft(command, { nFft: 2048, overlapPercent: 75, window: 'hann' })).concat([
    { ...commands[2], requestId: 'long-fft', cursorNorm: 0.5, stftOptions: longFft }, ...rowsOf('long-fft'),
]) });
/** The reply of the command of that requestId in a fixture's list. */
const replyOf = (fixtureIndex, replies, requestId) => {
    const list = fixtures[fixtureIndex].commands || commands;
    const at = list.findIndex(command => command.requestId === requestId);
    assert.ok(at >= 0, `fixture ${fixtureIndex} has no command ${requestId}`);
    return replies[at];
};
function nativeResultsFor(fixture) {
const native = spawnSync(python, ['-c', `
import sys,json
sys.path.insert(0,'python-backend')
from services.analysis_engine import AnalysisEngine
from services.analysis_service import AnalysisService
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
def spec_of(reply):
    if 'channels' in reply and 'windowed' in reply:
        first=reply['channels'][0]
        lanes=[{'id':'wave','kind':'band','lines':[{'id':'samples','of':{'key':first['signal']}}]},{'id':'spectrogram','kind':'image','lines':[{'id':'levels','of':{'key':first['image']}}]}]
    elif 'channels' in reply:
        lanes=[{'id':'spectrum','kind':'lines','lines':[{'id':f"ch{c['channelIndex']}",'of':{'key':c['key']}} for c in reply['channels']]}]
    else:
        ok=[(i,r['keys']) for i,r in enumerate(reply['responses']) if 'keys' in r]
        lanes=[{'id':part,'kind':'lines','axis':'own','lines':[{'id':f'{part}-{i}','of':{'key':keys[part]}} for i,keys in ok]} for part in ('gain','phase','coherence')]
    keys=[line['of']['key'] for lane in lanes for line in lane['lines']]
    return {'lanes':lanes,'keys':[{'key':key,'state':'usable','version':key} for key in keys]}
def run(commands,service,tag):
    replies=[]
    def reply_of(request_id):
        return replies[[c['requestId'] for c in commands].index(request_id)]
    for c in commands:
        if isinstance(c.get('spec'),dict) and '$spec' in c['spec']:
            c={**c,'spec':spec_of(reply_of(c['spec']['$spec']))}
        if isinstance(c.get('dataId'),dict):
            drawn=reply_of(c['dataId']['$dataId'])
            assert 'dataId' in drawn, f"{c['dataId']['$dataId']} drew no picture: {json.dumps(drawn)[:400]}"
            c={**c,'dataId':drawn['dataId']}
        if 'figureId' in c:
            # A figure's id is its own for good: each run draws under ids of its own.
            c={**c,'figureId':c['figureId']+tag}
        replies.append(dispatch(c,service))
    return replies
byte_results=run(commands,service,'-bytes')
native_service=AnalysisService(AnalysisEngine())
for c in commands:
    if c['cmd']=='pair-answers':
        for source in [c['reference'],*c['responses']]:
            source['filePath']=packet['fixture']
        continue
    if c['cmd'].startswith('figure-'):
        continue
    if c['cmd']=='region-peak':
        for source in c['sources']:
            source['filePath']=packet['fixture']
        continue
    c['filePath']=packet['fixture']
    for source in c.get('responses',[]):
        source['filePath']=packet['fixture']
    if c.get('reference'):
        c['reference']['filePath']=packet['fixture']
native_results=run(commands,native_service,'-path')
print(json.dumps([byte_results,native_results],allow_nan=False),file=out)
`], { maxBuffer: 32 * 1024 * 1024, cwd: root, input: JSON.stringify({commands:fixture.commands || commands,fixture:fixture.path || `src/test/fixtures/${fixture.name}`}), encoding: 'utf8', env: { ...process.env, MPLBACKEND: 'Agg' } });
assert.equal(native.status, 0, native.stderr);
return JSON.parse(native.stdout);
}
// Bundled recipes as the step bar opens them, scanned at their last step (a cross-channel one paired with the
// same file as its base). The time-varying loudness recipe also checks that the Web runtime bundles MoSQITo.
const { openedRecipe } = require(path.join(root, 'dist/shared/recipe/recipeOpen.js'));
for (const name of ['loudness.recipe.json', 'filter-welch.recipe.json', 'coherence.recipe.json', 'transfer-function.recipe.json']) {
    const opened = openedRecipe(JSON.parse(fs.readFileSync(path.join(root, 'python-backend/recipes', name), 'utf8')));
    assert.ok(opened.recipe, `${name} opens in the step bar`);
    const { recipe } = opened;
    const paired = (recipe.awaSlotReference ?? [])[0];
    commands.push({
        cmd: 'scan', requestId: `recipe-${name}`, filePath: '/sources/selected.wav', recipe, stage: recipe.output,
        ...(paired ? { reference: { filePath: '/sources/selected.wav', step: paired, recipe } } : {}),
    });
}
const nativePairs = fixtures.map(nativeResultsFor);
const byteResults = nativePairs.map(pair => pair[0]);
const nativeResults = nativePairs.map(pair => pair[1]);
let numbers = 0;
// A file's host identity: a path natively, a content hash on the Web, and so what is named or kept under it.
// sourceVersion is the version of that identity (a hash of input.id: the path with its size, times and inode
// natively, so a path is never read twice to name it; the content hash when the bytes are loaded), so a path and
// the same bytes loaded give different values by design. Its value is compared only between two byte loads;
// `checkSourceVersions` keeps it checked on every route.
// A kept answer's key is a hash of what it is of, the file's identity among it: it differs as that does.
const HOST_IDENTITY = ['filePath', 'fileName', 'input.id', 'stage.data', 'key', 'signal', 'image', 'signalExtent', 'imageExtent', 'keys.gain', 'keys.phase', 'keys.coherence', 'version', 'members'];
const SOURCE_VERSION = 'sourceVersion';
function compare(a, b, at = '', hostKeys = HOST_IDENTITY) {
    // A picture's own ids (figureId, pictureId, dataId) are made per run and draw: they say nothing of the answers.
    if (['computeMs', 'elapsedMs', 'figureId', 'pictureId', 'dataId', ...hostKeys].some(key => at.endsWith('.' + key))) return;
    if (typeof a === 'number') {
        assert.equal(typeof b, 'number', at);
        assert.ok(Math.abs(a - b) <= 0.0002 + Math.abs(a) * 0.00002, `${at}: ${a} vs ${b}`); numbers++; return;
    }
    if (Array.isArray(a)) { assert.equal(a.length, b.length, at); a.forEach((x,i) => compare(x,b[i],`${at}[${i}]`,hostKeys)); return; }
    if (a && typeof a === 'object') { assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),at); for (const key of Object.keys(a)) compare(a[key],b[key],`${at}.${key}`,hostKeys); return; }
    assert.equal(a,b,at);
}
/** Every sourceVersion one route gave, at any depth of its answers. */
function sourceVersionsIn(value, found = []) {
    if (Array.isArray(value)) value.forEach(item => sourceVersionsIn(item, found));
    else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
            if (key === SOURCE_VERSION) found.push(item); else sourceVersionsIn(item, found);
        }
    }
    return found;
}
/** Each route names each fixture by one non-empty sourceVersion on every answer, and different fixtures differently. */
function checkSourceVersions(runtime, route) {
    const perFixture = runtime.map((answers, index) => {
        const versions = sourceVersionsIn(answers);
        const at = `${route}[${index}] ${fixtures[index].name}`;
        assert.ok(versions.length >= 2, `${at}: answers carry ${SOURCE_VERSION}`);
        for (const version of versions) assert.ok(typeof version === 'string' && version.length > 0, `${at}: ${SOURCE_VERSION} ${JSON.stringify(version)}`);
        // The same route asked again and again of one load gives the same id.
        assert.deepEqual([...new Set(versions)], [versions[0]], `${at}: one ${SOURCE_VERSION} per load`);
        return versions[0];
    });
    assert.equal(new Set(perFixture).size, perFixture.length, `${route}: each fixture its own ${SOURCE_VERSION}`);
}
// Path against bytes: the version's value is a host identity here (see HOST_IDENTITY).
compare(byteResults,nativeResults,'native/bytes',[...HOST_IDENTITY, SOURCE_VERSION]);
checkSourceVersions(byteResults,'native/bytes');
checkSourceVersions(nativeResults,'native/path');
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
        browser=pinLocale(await chromium.launch({headless:true,executablePath:process.env.AWA_CHROMIUM_EXECUTABLE||undefined,args:['--mute-audio']}));
        const page=await browser.newPage();
        const errors=[]; page.on('pageerror',error=>errors.push(error.message));
        const origin=`http://127.0.0.1:${server.address().port}`;
        await page.goto(origin+'/analyzer/index.html');
        // The page speaks the browser's language: what it says is read from its own strings, not assumed English.
        const S=await page.evaluate(()=>window.__APP_STRINGS__);
        assert.equal(await page.evaluate(()=>navigator.language),BROWSER_LOCALE,'the page runs in the pinned locale, not the machine\'s');
        console.log(`Browser locale ${BROWSER_LOCALE}.`);
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
                    const list=fixture.commands || commands;
                    const replyOf=requestId=>results[list.findIndex(command=>command.requestId===requestId)];
                    const specOf=reply=>{
                        const lanes=reply.channels && reply.windowed!==undefined
                            ? [{id:'wave',kind:'band',lines:[{id:'samples',of:{key:reply.channels[0].signal}}]},{id:'spectrogram',kind:'image',lines:[{id:'levels',of:{key:reply.channels[0].image}}]}]
                            : reply.channels
                            ? [{id:'spectrum',kind:'lines',lines:reply.channels.map(c=>({id:`ch${c.channelIndex}`,of:{key:c.key}}))}]
                            : ['gain','phase','coherence'].map(part=>({id:part,kind:'lines',axis:'own',
                                lines:reply.responses.flatMap((r,i)=>r.keys?[{id:`${part}-${i}`,of:{key:r.keys[part]}}]:[])}));
                        const keys=lanes.flatMap(lane=>lane.lines.map(line=>line.of.key));
                        return {lanes,keys:keys.map(key=>({key,state:'usable',version:key}))};
                    };
                    for(const asked of list) {
                        let command=asked;
                        if(command.spec?.$spec!==undefined) command={...command,spec:specOf(replyOf(command.spec.$spec))};
                        if(command.dataId?.$dataId!==undefined) command={...command,dataId:replyOf(command.dataId.$dataId).dataId};
                        // A figure's id is its own for good: each fixture draws under ids of its own.
                        if(command.figureId!==undefined) command={...command,figureId:`${command.figureId}-${all.length}`};
                        results.push(await run(command));
                    }
                    all.push(results);
                    await run({cmd:'unload',filePath:'/sources/selected.wav'});
                }
                return all;
            } finally {worker.terminate();}
        },{fixtures:fixtures.map(fixture=>({bytes:Array.from(fixture.bytes),commands:fixture.commands})),commands});
        // Both load the same bytes, so here the version's value too must agree.
        compare(byteResults,results,'native/Pyodide');
        checkSourceVersions(results,'Pyodide');
        for (const runtime of [byteResults, nativeResults, results]) {
            const tones = runtime[2];
            /** The rows the figure service writes of an answers command's kept lines: a column a line, every point. */
            const rows = asked => {
                const table = replyOf(2, tones, `rows-${asked}`);
                assert.equal(table.status, 'rows', `rows of ${asked}: ${table.status}`);
                return table.columns;
            };
            for (const [asked, bins] of [['tone-mid', 1025], ['2', 1025], ['long-fft', 4097]]) {
                const columns = rows(asked);
                assert.equal(columns.length, 2, 'a line a channel');
                columns.forEach((column, i) => {
                    // Every bin is kept and written, at its own frequency: nothing is cut to be drawn.
                    assert.equal(column.values.length, bins);
                    const hz = column.xs[column.values.indexOf(Math.max(...column.values))];
                    assert.ok(Math.abs(hz - [440, 880][i]) <= 8000 / (bins - 1) / 2, `known tone mapped to ${hz} Hz`);
                });
            }
            for (const [asked, bands] of [['3', [400, 800]], ['4', [500, 1000]]]) {
                rows(asked).forEach((column, i) => {
                    assert.equal(column.xs[column.values.indexOf(Math.max(...column.values))], bands[i]);
                });
            }
            // The pair's three lines of both responses, every bin (this fixture's 2048-point FFT: 1025).
            const pair = rows('pair-parity');
            assert.deepEqual(pair.map(column => [column.lane, column.values.length]), ['gain', 'gain', 'phase', 'phase', 'coherence', 'coherence'].map(lane => [lane, 1025]));
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
        // A Tracks row is one Figure per channel. The first track's: track numbers go on counting after tracks are
        // taken off, so it is not always 0.
        const rowFigure = async (target = page, channel = 0) => {
            const id = await (await target.waitForFunction(() => [...document.querySelectorAll('[id^="track-row-figure-"]')]
                .map(node => node.id).find(name => /^track-row-figure-\d+$/.test(name)) || null, undefined, {timeout:120000})).jsonValue();
            return `#${id}${channel ? `-${channel}` : ''} canvas[data-figure]`;
        };
        // Where a lane of a row's drawn picture sits on the page (the row has a picture of that lane, and waits for none).
        const laneBox = async (target, figure, lane) => (await target.waitForFunction(([selector, id]) => {
            const canvas = document.querySelector(selector), seen = canvas?.__figureInspect?.();
            const found = seen && !seen.waiting && seen.pictureId !== null && seen.lanes.find(item => item.id === id);
            if (!found) return null;
            const box = canvas.getBoundingClientRect();
            return {x: box.left + found.frame.left, y: box.top + found.frame.top, width: found.frame.width, height: found.frame.height};
        }, [figure, lane], {timeout:120000})).jsonValue();
        const recordHostMessages = () => page.evaluate(() => {
            window.__testInbound = [];
            window.__testOutbound = [];
            const original = window.__AWA_HOST__.postMessage;
            window.__AWA_HOST__.postMessage = message => { window.__testOutbound.push(message); original(message); };
            window.__AWA_HOST__.onMessage(message => window.__testInbound.push(message));
        });
        await recordHostMessages();
        // Both channels' rows are drawn: a waveform lane over a spectrogram lane, from the answers the Worker kept.
        for (const channel of [0, 1]) assert.ok((await laneBox(page, await rowFigure(page, channel), 'spectrogram')).height > 0);
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
        assert.match(csvDownload.suggestedFilename(),/^spectrum-export_.+\.csv$/);
        assert.equal(await csvDownload.failure(),null);
        const csv = fs.readFileSync(await csvDownload.path(),'utf8');
        const artifact = await page.evaluate(()=>window.__csvArtifact);
        assert.equal(csv,artifact.content);assert.equal(artifact.mimeType,'text/csv;charset=utf-8');
        // The bytes saved: UTF-8 with a BOM, CRLF after every record, as every CSV the Analyzer writes (src/shared/utils/csv.ts).
        const csvBytes = fs.readFileSync(await csvDownload.path());
        assert.deepEqual([...csvBytes.subarray(0,3)],[0xEF,0xBB,0xBF],'the spectrum CSV starts with the UTF-8 BOM');
        assert.ok(csv.endsWith('\r\n') && !/\r(?!\n)|(?<!\r)\n/u.test(csv),'the spectrum CSV ends every record with CRLF');
        const csvRows = csvRecords(csv);
        assert.equal(csvRows[0].length,4,'stereo exports frequency/level for both channels');
        // Each column named as its axis is: the frequency, and the level with its quantity, unit and reference (C5).
        const levelHeader = S.axisLevelUncal.replace('{label}','dBFS');
        csvRows[0].forEach((header,column)=>assert.ok(header.endsWith(' '+(column%2 ? levelHeader : S.axisFrequency)),`CSV column ${column}: ${header}`));
        // Every bin of the cursor's FFT: n_fft/2+1 rows at fs/n_fft spacing up to Nyquist.
        const csvBins = csvRows.length - 1;
        assert.ok(Number.isInteger(Math.log2(csvBins - 1)), `${csvBins} CSV rows are not n_fft/2+1`);
        assert.ok(Math.abs(Number(csvRows[2][0]) - 4000 / (csvBins - 1)) < 1e-3);
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
            && window.__testInbound.some(message => message.type === 'track-answers-result'
                && message.windowSize === 256 && message.hopSize === 64));
        assert.equal(await page.locator('#reanalyze-overlay').isVisible(), false);
        await page.locator('[data-action="content-waveform"]').click();
        await page.waitForTimeout(300);
        const box = await laneBox(page, await rowFigure(), 'wave');
        assert.ok(box);
        await page.evaluate(() => { window.__testInbound = []; });
        await page.mouse.click(box.x + box.width * .437, box.y + box.height * .5);
        await page.waitForFunction(() => window.__testInbound.some(message => message.type === 'cursor-answers-result' && Math.abs(message.cursorNorm - .437) < .01));
        // Alt+drag sets the loop (a plain drag is the box zoom).
        await page.mouse.move(box.x + box.width * .21, box.y + box.height * .5);
        await page.keyboard.down('Alt');
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * .63, box.y + box.height * .5, { steps: 4 });
        await page.mouse.up();
        await page.keyboard.up('Alt');
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
        const checked = spawnSync(python, ['-c', [
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
            await laneBox(page, await rowFigure(), 'wave');
            assert.ok(await page.locator('audio').count() > 0);
            assert.equal(await page.locator('audio').evaluateAll(nodes=>nodes.every(audio=>audio.paused)),true);
        }
        await picker.setInputFiles({name:'bad.wav',mimeType:'audio/wav',buffer:Buffer.from('not a WAV')});
        await status.filter({hasText:'Unable to read audio'}).waitFor();
        assert.doesNotMatch(await page.locator('span[role="status"]').innerText(),/Traceback|PythonError|\n/);
        assert.equal(await page.locator('.track-row').count(),0);
        // Non-WAV formats decode in Pyodide through the same wandas readers as the desktop backend.
        const encode = format => spawnSync(python,['-c','import sys,io,soundfile as sf; d,r=sf.read(sys.argv[1]); b=io.BytesIO(); sf.write(b,d,r,format=sys.argv[2]); sys.stdout.buffer.write(b.getvalue())',fixturePath('short-stereo.wav'),format]);
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
        const changingBox = await laneBox(page, await rowFigure(), 'wave');
        assert.ok(changingBox);
        await page.mouse.click(changingBox.x + changingBox.width * .2, changingBox.y + changingBox.height * .5);
        await page.waitForFunction(() => window.__testInbound.some(message => message.type==='cursor-answers-result' && Math.abs(message.cursorNorm-.2)<.01));
        await page.evaluate(() => { window.__testInbound = []; });
        await page.mouse.click(changingBox.x + changingBox.width * .437, changingBox.y + changingBox.height * .5);
        await page.waitForFunction(() => window.__testInbound.some(message => message.type==='cursor-answers-result' && Math.abs(message.cursorNorm-.437)<.01));
        // The page holds no value of the line: the peak is read off the picture the Figure drew (its highest point's
        // place across, turned back into Hz by the lane's own axis).
        await page.waitForFunction(() => { const seen=document.querySelector('#spectrum-overlay-plot canvas[data-figure]')?.__figureInspect?.(); return !!seen && !seen.waiting && seen.pictureId!==null && seen.lanes[0]?.lines.length>0; });
        await page.waitForTimeout(300);
        const peakHz = await page.evaluate(() => {
            const lane=document.querySelector('#spectrum-overlay-plot canvas[data-figure]').__figureInspect().lanes[0];
            const top=lane.lines[0].points.filter(Boolean).reduce((best,point)=>point[1]<best[1]?point:best);
            const part=(top[0]-lane.frame.left)/lane.frame.width, [low,high]=lane.range.x;
            return lane.xLog ? low*Math.pow(high/low,part) : low+part*(high-low);
        });
        assert.ok(Math.abs(peakHz-880)<80,`2.5s cursor should select the later 880Hz section, got ${peakHz}`);
        // Playwright hands buffers over 50 MB only as files, so the oversized pick is a sparse file one byte past the limit.
        const oversized=path.join(root,'test-results/oversized.wav'); fs.mkdirSync(path.dirname(oversized),{recursive:true}); fs.writeFileSync(oversized,''); fs.truncateSync(oversized,80*1024*1024+1);
        await picker.setInputFiles(oversized);
        await status.filter({hasText:S.browserInputTooLarge.replace('{mib}','80')}).waitFor();
        assert.equal(await page.locator('.track-row').count(),1);
        // A header-level limit answers on one line: length is bounded only by the memory budget, the rate by 96 kHz.
        const fastWav=Buffer.from(bytes);
        fastWav.writeUInt32LE(192000,24); fastWav.writeUInt32LE(192000*fastWav.readUInt16LE(32),28);
        await picker.setInputFiles({name:'fast.wav',mimeType:'audio/wav',buffer:fastWav});
        await status.filter({hasText:'1–96 kHz'}).waitFor();
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
        await page.waitForFunction(() => window.__testInbound.some(m => m.type === 'track-answers-result' && m.windowSize === 2048),undefined,{timeout:120000});
        // The spectrogram lane under the waveform lane of the row's Figure.
        await page.waitForTimeout(300);
        const toneCanvas = await laneBox(page, await rowFigure(), 'spectrogram');
        await page.evaluate(() => {window.__testInbound = [];});
        await page.mouse.click(toneCanvas.x + toneCanvas.width * .5, toneCanvas.y + toneCanvas.height * .5);
        // A click acts on the point the readout reads (R7): the spectrogram frame nearest the pointer, so the cursor
        // lands within half a hop of the middle (2048 points at 75 % overlap: 512 samples of the 1 s, 16 kHz tones).
        const halfHopNorm = 512 / toneRate / 2;
        await page.waitForFunction(tolerance => window.__testInbound.some(m => m.type === 'cursor-answers-result'
            && Math.abs(m.cursorNorm - .5) <= tolerance), halfHopNorm + .002);
        const toneCsvMenu = page.locator('details').filter({has:page.locator('[data-action="export-csv"]')});
        if (!await toneCsvMenu.evaluate(node=>node.open)) await toneCsvMenu.locator('summary').click();
        const [toneCsvDownload] = await Promise.all([page.waitForEvent('download'),page.locator('[data-action="export-csv"]').click()]);
        const toneCsvRows = csvRecords(fs.readFileSync(await toneCsvDownload.path(),'utf8')).slice(1).map(row=>row.map(Number));
        assert.equal(toneCsvRows.length,2048/2+1);
        // The menu closes after an export; close it only if it is still open, or a click would open it over the spectra.
        if (await toneCsvMenu.evaluate(node=>node.open)) await toneCsvMenu.locator('summary').click();
        // The cursor spectrum panel starts folded: open it to read the peaks, and fold it again afterwards.
        const spectrumToggle = page.locator('#spectrum-section-header [data-action="toggle-spectrum-panel"]');
        const spectrumWasFolded = await spectrumToggle.getAttribute('aria-expanded') === 'false';
        if (spectrumWasFolded) await spectrumToggle.click();
        for (const [channel, hz] of [[0,440],[1,880]]) {
            const peakRow = toneCsvRows.reduce((best,row)=>row[channel*2+1]>best[channel*2+1]?row:best);
            const peakHz = peakRow[channel*2], peakDb = peakRow[channel*2+1];
            assert.ok(Math.abs(peakHz-hz)<=16000/2048/2, `CSV ${hz} Hz tone exported as ${peakHz}`);
            // The cursor spectrum is one Figure of both channels: the pointer on the highest point of the line peaking
            // there reads that bin (the picture's points are real bins, each bucket's lowest and highest).
            // The panel was just opened: the picture of its settled size is the one to point at.
            const drawn = () => page.waitForFunction(() => { const seen=document.querySelector('#spectrum-overlay-plot canvas[data-figure]')?.__figureInspect?.(); return !!seen && !seen.waiting && seen.pictureId!==null && seen.lanes[0]?.lines.length===2; });
            await drawn(); await page.waitForTimeout(500); await drawn();
            await page.mouse.move(0,0);
            const top = await page.evaluate(expectedHz => {
                const canvas=document.querySelector('#spectrum-overlay-plot canvas[data-figure]');
                const lane=canvas.__figureInspect().lanes[0], [low,high]=lane.range.x;
                const hzOf=px=>{ const part=(px-lane.frame.left)/lane.frame.width; return lane.xLog ? low*Math.pow(high/low,part) : low+part*(high-low); };
                const tops=lane.lines.map(line=>line.points.filter(Boolean).reduce((best,point)=>point[1]<best[1]?point:best));
                const peak=tops.reduce((best,point)=>Math.abs(hzOf(point[0])-expectedHz)<Math.abs(hzOf(best[0])-expectedHz)?point:best);
                const box=canvas.getBoundingClientRect();
                return {x:box.left+peak[0],y:box.top+peak[1]};
            }, hz);
            await page.mouse.move(top.x,top.y);
            // The readout lands on the peak bin whether the bins are denser than the plot's pixels or not.
            await page.waitForFunction(expected=>{
                const text=document.getElementById('spectrum-freq-readout')?.textContent || '';
                // As every plot writes it (plotText.ts): Hz or kHz, and a true minus sign (−).
                const match=text.match(/(\d+(?:\.\d+)?) (k?)Hz \/ ([−-]?\d+(?:\.\d+)?)/);
                const hz=match ? Number(match[1])*(match[2] ? 1000 : 1) : NaN, db=match ? Number(match[3].replace('−','-')) : NaN;
                return !!match && Math.abs(hz-expected.hz)<.11 && Math.abs(db-expected.db)<.11;
            },{hz:peakHz,db:peakDb}).catch(async error=>{ throw new Error(`the readout at the ${hz} Hz peak says "${await page.locator('#spectrum-freq-readout').textContent()}", expected ${peakHz} Hz / ${peakDb}: ${error.message}`); });
            // The row's spectrogram lane as painted: the brightest rows of one pixel column (the palette's green
            // rises with the level), turned back into Hz by the lane's own axis up.
            const stftFigure = await rowFigure(page, channel);
            await laneBox(page, stftFigure, 'spectrogram');
            const band = await page.locator(stftFigure).evaluate(canvas=>{
                const lane=canvas.__figureInspect().lanes.find(item=>item.id==='spectrogram');
                const scale=canvas.width/canvas.getBoundingClientRect().width;
                const x=Math.floor((lane.frame.left+lane.frame.width*.3)*scale), y0=Math.ceil(lane.frame.top*scale), h=Math.floor((lane.frame.top+lane.frame.height)*scale)-y0;
                const data=canvas.getContext('2d').getImageData(x,y0,1,h).data;
                const green=Array.from({length:h},(_,y)=>data[y*4+1]);
                const top=Math.max(...green), rows=green.map((v,y)=>v===top?y:-1).filter(y=>y>=0);
                const [low,high]=lane.range.y;
                const hzAt=row=>{ const part=1-((y0+row)/scale-lane.frame.top)/lane.frame.height; return lane.yLog ? low*Math.pow(high/low,part) : low+part*(high-low); };
                const mid=(rows[0]+rows.at(-1)+1)/2;
                return {hz:hzAt(mid),pixelHz:Math.abs(hzAt(mid-1)-hzAt(mid+1))/2,top};
            });
            assert.ok(band.top>100,'actual STFT raster must be painted');
            assert.ok(Math.abs(band.hz-peakHz)<=band.pixelHz+1,`STFT band ${band.hz} Hz vs CSV/hover ${peakHz} Hz`);
            console.log(`Known ${hz} Hz: CSV/hover ${peakHz} Hz, actual STFT band ${band.hz.toFixed(2)} Hz (every FFT bin).`);
        }
        await page.screenshot({path:path.join(root,'test-results/frequency-tones.png')});
        if (spectrumWasFolded) await spectrumToggle.click();
        assert.equal(await page.locator('audio').evaluateAll(xs=>xs.every(x=>x.paused)),true);
        await clearAll();
        const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
        await mobile.goto(origin+'/analyzer/');
        await mobile.locator(OPEN_FILE).setInputFiles(fixturePath('short-stereo.wav'));
        // At 390 px the footer's status line has no room to be seen, so it is waited for as text.
        await mobile.getByRole('status').filter({hasText:READY}).waitFor({state:'attached',timeout:120000});
        const rowFigureOf=async target=>`#${await (await target.waitForFunction(()=>[...document.querySelectorAll('[id^="track-row-figure-"]')].map(node=>node.id).find(name=>/^track-row-figure-\d+$/.test(name))||null,undefined,{timeout:120000})).jsonValue()} canvas[data-figure]`;
        const mobileBox=await laneBox(mobile, await rowFigureOf(mobile), 'wave');
        assert.ok(mobileBox?.width>0);
        await mobile.evaluate(() => {
            window.__testInbound=[];
            window.__AWA_HOST__.onMessage(message=>window.__testInbound.push(message));
        });
        await mobile.touchscreen.tap(mobileBox.x+mobileBox.width*.5,mobileBox.y+mobileBox.height*.5);
        await mobile.waitForFunction(()=>window.__testInbound.some(message=>message.type==='cursor-answers-result' && Math.abs(message.cursorNorm-.5)<.1));
        const cdp=await mobile.context().newCDPSession(mobile);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:mobileBox.x+mobileBox.width*.2,y:mobileBox.y+mobileBox.height*.5}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:mobileBox.x+mobileBox.width*.7,y:mobileBox.y+mobileBox.height*.5}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        assert.equal(await mobile.locator('#loop-time-display').isVisible(),false,'documented prototype limitation: no touch-drag region');
        console.log('390px touch tap/STFT passed; touch-drag region remains unavailable.');
        // The spectrogram lane under the waveform is drawn without a toggle.
        assert.ok((await laneBox(mobile, await rowFigureOf(mobile), 'spectrogram')).height>0);
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
