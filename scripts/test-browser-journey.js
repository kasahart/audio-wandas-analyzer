const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * The whole path a user takes, in one test (issue #849): open a folder, put two recordings in the base and compare
 * slots, add a step in the step bar, compare, and export the comparison. Every other browser check tests one part;
 * this one fails when a change breaks the hand-over between two parts (the step bar's chain not reaching the
 * report, a slot not reaching the comparison).
 *
 * Only what a user does: a folder picked in the page's own folder input, clicks on what is shown, a real download.
 * No message is posted or answered by the test, and no fixed wait: each step waits for the page's state.
 *
 * A failure says which step broke, what the user did there, and where to look, with a screenshot of the page in
 * test-results/journey-failure.png.
 */

const RATE = 16000;
// Below and above the step's cutoff (the lowpass filter's own default, 1000 Hz): each a whole number of bins of
// the chain's averaged spectrum (16000 / 1024 = 15.625 Hz), so the highest bin is the tone itself.
const LOW_HZ = 500, HIGH_HZ = 3000;

/** A mono 16-bit WAV of two tones, `low` and `high` their amplitudes (full scale 1). */
function toneWav(low, high, seconds = 2) {
    const frames = RATE * seconds, bytes = Buffer.alloc(44 + frames * 2);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(RATE, 24); bytes.writeUInt32LE(RATE * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
    for (let i = 0; i < frames; i++) {
        const t = i / RATE;
        bytes.writeInt16LE(Math.round(32767 * (low * Math.sin(2 * Math.PI * LOW_HZ * t) + high * Math.sin(2 * Math.PI * HIGH_HZ * t))), 44 + i * 2);
    }
    return bytes;
}

/** The files of a zip (stored or deflated), by name: enough of the format for the report the page writes. */
function unzip(buffer) {
    const zlib = require('node:zlib');
    const files = new Map();
    // The central directory lists every entry with its real sizes (a local header may leave them to a data descriptor).
    const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(end >= 0, 'the report is a zip (no end of central directory)');
    let at = buffer.readUInt32LE(end + 16);
    for (let n = buffer.readUInt16LE(end + 10); n > 0; n--) {
        const method = buffer.readUInt16LE(at + 10), size = buffer.readUInt32LE(at + 20);
        const nameLength = buffer.readUInt16LE(at + 28), extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32);
        const local = buffer.readUInt32LE(at + 42), name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
        const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
        const data = buffer.subarray(start, start + size);
        files.set(name, method === 8 ? zlib.inflateRawSync(data) : data);
        at += 46 + nameLength + extra + comment;
    }
    return files;
}

module.exports = async function auditJourney({ browser, origin, root }) {
    const { csvRecords } = require(path.join(root, 'dist/shared/utils/csv.js'));
    // A folder of its own each run: two runs at once never read or delete each other's files.
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    const folder = fs.mkdtempSync(path.join(root, 'test-results/journey-folder-'));
    // The base and the compared recording: in both the tone above the cutoff is the louder, so the exported spectrum's
    // highest peak is the tone below it only when the added lowpass step reached the export.
    fs.writeFileSync(path.join(folder, 'a-base.wav'), toneWav(0.1, 0.4));
    fs.writeFileSync(path.join(folder, 'b-compare.wav'), toneWav(0.2, 0.4));
    // A file the app does not read is in the folder too: it is not counted and gets no row.
    fs.writeFileSync(path.join(folder, 'notes.txt'), 'not audio\n');

    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let current = 0;
    /**
     * One step of the journey. A failure inside it is rethrown with the step's number and name, what the user did,
     * and where the code of that step lives, so the person reading CI's log knows where to start.
     */
    const step = async (name, did, look, run) => {
        current++;
        try {
            await run();
            console.log(`Journey ${current}/6 ${name}: passed.`);
        } catch (error) {
            await page.screenshot({ path: path.join(root, 'test-results/journey-failure.png') }).catch(() => undefined);
            throw new Error([
                `Journey step ${current}/6 "${name}" broke.`,
                `What the user did: ${did}`,
                `Where to look: ${look}`,
                'Screenshot: test-results/journey-failure.png. Run it alone: npm run build:browser && node scripts/test-browser-journey.js',
                `Cause: ${error instanceof Error ? error.message : String(error)}`,
            ].join('\n'), { cause: error });
        }
    };
    /** What the comparison's Figure has drawn once it waits for nothing: its picture id and its first lane. */
    const drawn = async (other = null) => (await page.waitForFunction(previous => {
        const seen = document.querySelector('[data-stage-figure] canvas[data-figure]')?.__figureInspect?.();
        if (!seen || seen.waiting || seen.pictureId === null || seen.pictureId === previous) return null;
        const lane = seen.lanes[0];
        return lane ? { pictureId: seen.pictureId, lines: lane.lines.length, xLog: !!lane.xLog } : null;
    }, other, { timeout: 120000 })).jsonValue();

    try {
        await page.goto(origin + '/analyzer/');
        const S = await page.evaluate(() => window.__APP_STRINGS__);
        const rows = page.locator('[data-entry-rows] tr.entry-row');
        const row = name => rows.filter({ hasText: name });

        await step('open a folder', 'picked a folder with two WAVs and a text file in "Open a folder"',
            'src/webview/runtime/staticHost.ts (listOpenedFolder) and the entry table, src/webview/runtime/entryRuntime.ts', async () => {
                await page.locator('input[webkitdirectory]').setInputFiles(folder);
                await page.getByRole('status').filter({ hasText: S.browserFolderOpened.replace('{count}', '2') }).waitFor({ timeout: 60000 });
                await row('b-compare.wav').waitFor();
                assert.deepEqual(await rows.evaluateAll(found => found.map(node => (node.getAttribute('data-key') ?? '').split('/').pop())), ['a-base.wav', 'b-compare.wav'],
                    'the table lists the two WAVs, one row each, and not the text file');
            });

        await step('put the recordings in slots', 'hovered each row and chose 0 (base) and 1 (compare 1) in its 0–3 menu',
            'the row\'s slot menu in src/webview/runtime/entryRuntime.ts (entry-row-slotmenu, entry-row-slot)', async () => {
                for (const [name, slot] of [['a-base.wav', 0], ['b-compare.wav', 1]]) {
                    await row(name).hover();
                    await row(name).locator('[data-action="entry-row-slotmenu"]').click();
                    await page.locator(`[data-action="entry-row-slot"][data-slot="${slot}"]`).click();
                    await row(name).locator(`.entry-badge.entry-slot-${slot}`).waitFor();
                }
            });

        let input;
        await step('compare', 'pressed Compare in the toolbar and waited for the picture',
            'src/webview/runtime/trackStageMode.ts (the comparison and its legend) and the Worker, browser/audio.worker.js', async () => {
                await page.locator('[data-action="content-stage"]').click();
                const legend = page.locator('[data-stage-legend] .compare-legend-item');
                await legend.filter({ hasText: 'a-base.wav' }).waitFor({ timeout: 120000 });
                await legend.filter({ hasText: 'b-compare.wav' }).waitFor({ timeout: 120000 });
                input = await drawn();
                assert.equal(input.lines, 2, 'the comparison draws one line for the base and one for compare 1');
            });

        const bar = page.locator('.track-stage-bar');
        // Each step's chip names its wandas operation in its hint, in every language (its label is the page's own words).
        const chips = () => bar.locator('.step-chip:not([data-step-input]) .step-body').evaluateAll(bodies => bodies.map(body => body.getAttribute('data-hint') ?? ''));
        let before, spectrum;
        await step('add a step in the step bar', 'pressed ＋ after Input, chose lowpass_filter, then pressed the chain\'s last chip',
            'the step bar, src/webview/runtime/stepBar.ts and stepMenu.ts, and the comparison\'s scan of the chain (compare-scan)', async () => {
                before = await chips();
                await bar.locator('[data-action="step-insert"]').first().click();
                await bar.locator('[data-action="step-add-op"][data-op="wandas.audio.lowpass_filter"]').click();
                await bar.locator('.step-chip.is-current .step-body[data-hint*="lowpass_filter"]').waitFor();
                const after = await chips();
                assert.equal(after.length, before.length + 1, 'one step more on the bar');
                assert.ok(after[0].includes('lowpass_filter'), `the new step sits first, before the steps that were there: ${after.join(' | ')}`);
                // The step's own picture: still the time signal, now filtered.
                const filtered = await drawn(input.pictureId);
                assert.equal(filtered.lines, 2);
                await bar.locator('.step-chip').last().locator('.step-body').click();
                await bar.locator('.step-chip').last().and(bar.locator('.is-current')).waitFor();
                spectrum = await drawn(filtered.pictureId);
                assert.equal(spectrum.lines, 2, 'the last step shows both recordings');
                assert.ok(spectrum.xLog, 'the last step is a spectrum (a log frequency axis)');
            });

        let files;
        await step('export the comparison', 'opened Export and pressed "Export (comparison folder)"',
            'the report in src/webview/runtime/trackStageMode.ts (report) and the download in src/webview/runtime/staticHost.ts (downloadFile)', async () => {
                await page.locator('#tb-export-menu summary').click();
                const [download] = await Promise.all([
                    page.waitForEvent('download', { timeout: 60000 }),
                    page.locator('[data-action="stage-report"]').click(),
                ]);
                assert.match(download.suggestedFilename(), /\.zip$/);
                files = unzip(fs.readFileSync(await download.path()));
                // The files are named in the page's language (strings.ts reportFigure, reportDefinitions, reportCsv).
                for (const name of [`${S.reportFigure}.png`, `${S.reportFigure}.csv`, `${S.reportDefinitions}.json`, `${S.reportCsv}.csv`]) assert.ok(files.has(name), `the report holds ${name} (it holds ${[...files.keys()].join(', ')})`);
                assert.ok([...files.keys()].some(name => name.endsWith('.recipe.json')), 'the report holds the chain as a .recipe.json');
            });

        await step('check what was exported', 'opened the exported files',
            'the report\'s files: definitions.json and the Recipe from the step bar\'s chain, figure.csv from the Figure\'s table (figure-export)', async () => {
                const definitions = JSON.parse(files.get(`${S.reportDefinitions}.json`).toString('utf8'));
                assert.equal(definitions.steps[0].operation, 'wandas.audio.lowpass_filter', 'the step added is the first step written');
                assert.equal(definitions.comparisons[0].slot, 1);
                assert.match(definitions.comparisons[0].file, /^b-compare\.wav/);
                assert.match(definitions.comparisons[0].base.file, /^a-base\.wav/);
                const recipeName = [...files.keys()].find(name => name.endsWith('.recipe.json'));
                const recipe = JSON.parse(files.get(recipeName).toString('utf8'));
                const operations = recipe.nodes.map(node => node.operation);
                assert.ok(operations.indexOf('wandas.audio.lowpass_filter') >= 0 && operations.indexOf('wandas.audio.lowpass_filter') < operations.indexOf('wandas.audio.welch'),
                    `the Recipe runs the lowpass filter before the spectrum: ${operations.join(' → ')}`);
                // The CSV: a frequency and a level column for each recording, named as the legend names it.
                const [header, ...table] = csvRecords(files.get(`${S.reportFigure}.csv`).toString('utf8').replace(/^\uFEFF/, ''));
                assert.equal(header.length, 4, `two columns a recording: ${header.join(' | ')}`);
                assert.ok(header[0].includes('a-base.wav') && header[2].includes('b-compare.wav'), `the base first, then compare 1: ${header.join(' | ')}`);
                for (const column of [1, 3]) {
                    const values = table.map(record => Number(record[column]));
                    const peakHz = Number(table[values.indexOf(Math.max(...values))][column - 1]);
                    // The tone above the cutoff is the louder in the file: its peak gone means the filter ran.
                    assert.equal(peakHz, LOW_HZ, `${header[column]}: highest peak at ${peakHz} Hz, expected the ${LOW_HZ} Hz tone below the cutoff (the louder ${HIGH_HZ} Hz above it is filtered out)`);
                }
                // The exported Recipe runs in wandas itself, outside the app, and finds the same peak.
                fs.writeFileSync(path.join(folder, 'exported.recipe.json'), files.get(recipeName));
                const python = require(path.join(root, 'dist/test/helpers/python.js')).testPython();
                assert.ok(python, 'no Python found to run the exported Recipe');
                const run = spawnSync(python.command, [...python.args, '-c', [
                    'import sys, numpy, wandas',
                    'from wandas.pipeline import RecipePlan',
                    'plan = RecipePlan.load(sys.argv[1])',
                    'out = plan.apply({plan.inputs[0].name: wandas.read(sys.argv[2])})',
                    'print(float(out.freqs[int(numpy.argmax(numpy.atleast_2d(numpy.abs(out.data))[0]))]))',
                ].join('\n'), path.join(folder, 'exported.recipe.json'), path.join(folder, 'a-base.wav')], { encoding: 'utf8', timeout: 120000 });
                assert.equal(run.status, 0, `wandas could not run the exported Recipe: ${(run.stderr ?? '').slice(-2000)}`);
                assert.equal(Number(run.stdout.trim()), LOW_HZ, 'wandas, running the exported Recipe on the base, finds the same peak');
            });
        assert.deepEqual(errors, [], `the page threw: ${errors.join('\n')}`);
        console.log('Journey (open a folder → slots → compare → add a step → export → run the Recipe in wandas) passed.');
    } finally {
        await page.close();
        fs.rmSync(folder, { recursive: true, force: true });
    }
};

// Alone (`npm run build:browser && node scripts/test-browser-journey.js`): browser-dist served under /analyzer/ as
// test-browser-parity.js serves it, which runs this journey with its other checks in `npm run test:browser`.
if (require.main === module) {
    const http = require('node:http');
    const { chromium } = require('@playwright/test');
    const root = path.resolve(__dirname, '..');
    const base = path.join(root, 'browser-dist');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
    const server = http.createServer((req, res) => {
        let pathname = new URL(req.url, 'http://local').pathname.replace(/^\/analyzer/, '');
        if (pathname.endsWith('/')) pathname += 'index.html';
        const target = path.resolve(base, '.' + decodeURIComponent(pathname));
        if (!target.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
        fs.readFile(target, (error, data) => {
            if (error) { res.writeHead(404); res.end(); return; }
            res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream'); res.end(data);
        });
    });
    (async () => {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const browser = await chromium.launch({ headless: true, executablePath: process.env.AWA_CHROMIUM_EXECUTABLE || undefined, args: ['--mute-audio'] });
        try {
            const context = await browser.newContext({ locale: process.env.AWA_BROWSER_LOCALE || 'en-US' });
            await module.exports({ browser: context, origin: `http://127.0.0.1:${server.address().port}`, root });
        } finally { await browser.close(); server.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
}
