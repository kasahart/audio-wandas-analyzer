import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { backendRequired, openEntry, type ScannedFile } from './entryHelpers';
import { readTimingText, startReadTiming } from './readTiming';
import { bridgeComparison, RealBackend, runFixture } from './realBackend';

/**
 * The spectrogram in the comparison: each recording on screen is an image lane of the one Figure of
 * the new path (drawn, ranged and read by the figure service), through the REAL backend.
 *
 * Checked: the base's and the compared recording's images are lanes of one Figure, named by their recordings, over the
 * same time, the same frequencies and in the same colours; each is drawn at the size its frame allows (a column per
 * two pixels at most, every cell the service sent); the cell read is the service's (a real STFT frame and bin, its
 * level unrounded), the mark at its place; ← → ↑ ↓ step one answer cell; a box zoom draws the part again in every
 * lane; the colour bar's range, typed, is every lane's; and how long a read takes from the pointer's move to the
 * readout.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..');
let files: ScannedFile[] | undefined;
let backend: RealBackend | undefined;
let folder = '';
let recipe: Record<string, unknown> = {};
let fixtureError = '';

test.beforeAll(async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'figure-image-ui-'));
    const written = runFixture(path.join('src', 'test', 'fixtures', 'narrow', 'generate.py'), [folder]);
    if (!written.out) { fixtureError = written.error ?? ''; return; }
    recipe = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as Record<string, unknown>;
    try {
        backend = new RealBackend();
        // The table's rows are of the entry's own scan (its average spectrum); the comparison then runs the chain with
        // the average spectrum swapped for a spectrogram, so its last step ends in a SpectrogramFrame.
        const scanned: ScannedFile[] = [];
        for (const filePath of written.out.trim().split('\n')) scanned.push({ filePath, result: await backend.request({ cmd: 'scan', filePath, recipe, stage: String(recipe.output) }) });
        files = scanned;
        recipe = JSON.parse(JSON.stringify(recipe)) as Record<string, unknown>;
        const nodes = recipe.nodes as Array<Record<string, unknown>>;
        nodes[2] = { ...nodes[2], operation: 'wandas.audio.stft', version: 2, params: { $type: 'map', entries: [['hop_length', 128], ['n_fft', 512]] } };
    } catch (error) {
        fixtureError = error instanceof Error ? error.message : String(error);
    }
});
test.afterAll(() => {
    backend?.close();
    if (folder) rmSync(folder, { recursive: true, force: true });
});

const ready = (): boolean => {
    if (!files && backendRequired()) throw new Error(`the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo's .venv) but the narrow fixture could not be analysed: ${fixtureError}`);
    return !!files;
};

interface Seen {
    waiting: boolean; pictureId: string | null; readout: string; failure: string | null;
    lanes: Array<{
        id: string; frame: { left: number; top: number; width: number; height: number }; range: { x: [number, number]; y: [number, number] } | null; axisNames: { x: string; y: string };
        image?: { line: string; rows: number; columns: number; colour: [number, number]; colourName: string; edges: { left: number; right: number; top: number; bottom: number } };
    }>;
    mark: { index: number; row?: number; x: number; y?: number; value: number; px: number; py: number } | null;
}
const PREVIEW = '[data-stage-figure] canvas[data-figure]';
const seen = (page: Page): Promise<Seen> => page.locator(PREVIEW).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());
const drawn = async (page: Page): Promise<Seen> => {
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.lanes.length === 2 && now.lanes.every(lane => !!lane.image); }, { timeout: 30_000, message: 'the Figure drew its images' }).toBe(true);
    return seen(page);
};
/** The base in slot 0, the compared recording in slot 1, the comparison opened on the STFT step. */
async function openComparison(page: Page, recipe: Record<string, unknown>, stepId = 'node-2'): Promise<() => Promise<string[]>> {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openEntry(page, files!, { language: 'en', recipe });
    const stop = await bridgeComparison(page, backend!, recipe);
    await page.keyboard.press('0');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    const paths = files!.map(file => file.filePath);
    await page.evaluate(paths => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.1, fullScale: true, waveform: { min: [-0.1, -0.1], max: [0.1, 0.1], minT: [0.1, 1.1], maxT: [0.4, 1.4], absolutePeak: 0.1 } }],
    })) } })), paths);
    await expect(page.locator('.track-stage')).toBeVisible();
    const bar = page.locator('.track-stage-bar');
    const step = bar.locator(`[data-step-hold="${stepId}"]`);
    await expect(step).toBeVisible();
    // The bar is drawn again while the comparison opens, and a click landing in between is lost (no step is
    // shown, and this wait ran out under load): the click is made again until the step is the one shown.
    await expect(async () => {
        if ((await bar.getAttribute('data-stage')) !== stepId) await step.click();
        await expect(bar).toHaveAttribute('data-stage', stepId, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    return stop;
}

test('the recordings\' spectrograms are lanes of the one Figure of the new path: the same ranges and colours; cells, reads, steps and zoom are the figure service\'s', async ({ page }, testInfo) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(180_000);
    const stop = await openComparison(page, recipe);
    await expect(page.locator('.track-stage')).toHaveAttribute('data-figure', 'true', { timeout: 30_000 });
    // The tracks' own lanes are not shown under the comparison's images, nor the old overlay's canvas.
    await expect(page.locator('[data-stage-canvas="overlay"]')).toBeHidden();
    const first = await drawn(page);
    expect(first.failure).toBeNull();
    // The base recording, then the compared one: a lane each, over the same time and frequencies, in the same colours.
    expect(first.lanes.map(item => item.id)).toEqual(['image-base1', 'image-compare1']);
    expect(first.lanes.map(item => item.image!.line)).toEqual(['base1', 'compare1']);
    expect(first.lanes[1].range).toEqual(first.lanes[0].range);
    expect(first.lanes[1].image!.colour).toEqual(first.lanes[0].image!.colour);
    expect(first.lanes[1].image!.colourName).toBe(first.lanes[0].image!.colourName);
    await expect(page.locator('.track-stage-bar')).toHaveAttribute('data-drawn', '2');
    const [lane] = first.lanes;
    const image = lane.image!;
    expect(lane.axisNames).toEqual({ x: 'Time [s]', y: 'Frequency [Hz]' });
    expect(image.colourName).toMatch(/^Level/u);
    // 16 kHz, 2 s, 512-sample frames every 128: about 250 frames and 256 bins above 20 Hz; a column per two pixels at
    // most, a row per two pixels at most (log bands then).
    expect(image.columns).toBeGreaterThan(100);
    expect(image.columns).toBeLessThanOrEqual(Math.ceil(lane.frame.width / 2));
    // Two lanes share the stage's height: each has the rows its own height allows (a row per two pixels at most).
    expect(image.rows).toBeGreaterThan(20);
    expect(image.rows).toBeLessThanOrEqual(Math.ceil(lane.frame.height / 2));
    expect(image.colour[1] - image.colour[0], 'the colour range is at most 100 dB').toBeLessThanOrEqual(100);
    expect(lane.range!.y).toEqual([20, 8000]);
    // The cells fill the plot across (the first and last frame's own edges reach just past the axis's ends).
    expect(image.edges.left).toBeLessThanOrEqual(lane.frame.left + 1);
    expect(image.edges.right).toBeGreaterThanOrEqual(lane.frame.left + lane.frame.width - 1);

    // A read: a real frame and bin (31.25 Hz and 8 ms apart), the mark inside half a cell of the pointer.
    const box = (await page.locator(PREVIEW).boundingBox())!;
    const at = { x: lane.frame.left + lane.frame.width * 0.4, y: lane.frame.top + lane.frame.height * 0.3 };
    await startReadTiming(page, PREVIEW);
    const times: number[] = [];
    for (let move = 0; move < 12; move += 1) {
        const before = (await seen(page)).mark;
        const started = Date.now();
        await page.mouse.move(box.x + at.x + move * 9, box.y + at.y + move * 2);
        await expect.poll(async () => { const mark = (await seen(page)).mark; return !!mark && (mark.index !== before?.index || mark.row !== before?.row); }, { timeout: 15_000, intervals: [5] }).toBe(true);
        times.push(Date.now() - started);
    }
    await settled(page);
    const read = await seen(page);
    const mark = read.mark!;
    expect(mark.row).toBeGreaterThanOrEqual(0);
    expect((mark.y! / 31.25) % 1, 'the frequency read is a real bin').toBeCloseTo(0, 6);
    expect(Math.abs(mark.px - (at.x + 11 * 9)), 'the mark is in the cell under the pointer (across)').toBeLessThan(lane.frame.width / image.columns + 2);
    expect(read.readout).toMatch(/ \/ \d+\.\d{3} s \/ [\d.]+ k?Hz \/ −?[\d.]+ dB/u);
    const sorted = [...times].sort((a, b) => a - b);
    testInfo.annotations.push({ type: 'read round trip (ms, pointer move to readout, 12 moves)', description: `median ${sorted[6]}, max ${sorted[11]}` });
    testInfo.annotations.push({ type: 'read, the page\'s own part', description: await readTimingText(page) });

    // The arrow keys step one answer cell: a row up, then a column on.
    await page.keyboard.press('ArrowUp');
    await expect.poll(async () => (await seen(page)).mark?.row, { timeout: 15_000 }).toBe(mark.row! + 1);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await seen(page)).mark?.index, { timeout: 15_000 }).toBe(mark.index + 1);
    const stepped = (await seen(page)).mark!;
    expect(stepped.y! - mark.y!).toBeCloseTo(31.25, 6);
    expect(stepped.x - mark.x).toBeCloseTo(128 / 16000, 9);

    if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'heatmap-lanes.png') });

    // A box zoom: the part is drawn again from its own cells (more of them per second than the whole picture had).
    const from = { x: lane.frame.left + lane.frame.width * 0.25, y: lane.frame.top + lane.frame.height * 0.2 };
    const to = { x: lane.frame.left + lane.frame.width * 0.5, y: lane.frame.top + lane.frame.height * 0.6 };
    await page.mouse.move(box.x + from.x, box.y + from.y);
    await page.mouse.down();
    await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.pictureId !== first.pictureId && now.lanes.length === 2 && (now.lanes[0]?.range?.x[1] ?? 9) < 1.2; }, { timeout: 30_000 }).toBe(true);
    const zoomed = (await seen(page)).lanes[0];
    expect(zoomed.range!.x[0]).toBeGreaterThan(0.3);
    expect(zoomed.range!.y[0]).toBeGreaterThan(20);
    expect(zoomed.range!.y[1]).toBeLessThan(8000);
    expect(zoomed.image!.columns / (zoomed.range!.x[1] - zoomed.range!.x[0]), 'every frame of the part is a column').toBeCloseTo(16000 / 128, -1);
    // The zoom is every lane's: the compared recording's image shows the same part.
    const both = await seen(page);
    expect(both.lanes[1].range).toEqual(both.lanes[0].range);
    if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'heatmap-zoomed.png') });

    // The colour bar is an axis: a double click on it opens its range, and typed ends are every lane's colours.
    await page.keyboard.press('0');
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.lanes.length === 2 && now.lanes[0].range!.x[0] === first.lanes[0].range!.x[0]; }, { timeout: 30_000 }).toBe(true);
    const whole = (await seen(page)).lanes[0];
    await page.mouse.dblclick(box.x + whole.frame.left + whole.frame.width + 12, box.y + whole.frame.top + whole.frame.height / 2);
    const popover = page.locator('[id$="range-popover"]:visible');
    await expect(popover).toHaveCount(1);
    await expect(popover.locator('input[id$="-max"]')).toHaveValue(String(whole.image!.colour[1]));
    await popover.locator('input[id$="-min"]').fill('-60');
    await popover.locator('input[id$="-max"]').fill('-20');
    await popover.locator('button[id$="-apply"]').click();
    await expect.poll(async () => { const now = await seen(page); return now.waiting ? null : now.lanes.map(item => item.image?.colour); }, { timeout: 30_000 }).toEqual([[-60, -20], [-60, -20]]);
    if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'heatmap-colour-range.png') });
    // A reset (a double click on the plot) takes the colours back with the rest.
    await page.keyboard.press('0');
    await expect.poll(async () => { const now = await seen(page); return now.waiting ? null : now.lanes.map(item => item.image?.colour); }, { timeout: 30_000 }).toEqual([whole.image!.colour, whole.image!.colour]);
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

/** The other images of the comparison: what their rows are over, what their colours measure, and whether they are signed. */
const OTHER_IMAGES = [
    {
        name: 'cepstrogram', stepId: 'node-3', rows: 'Quefrency [s]', colourName: /^Real cepstrum/u, signed: true, readout: / \/ \d+\.\d+ s \/ [\d.]+ m?s \/ [+−]?[\d.]+/u,
        change: (nodes: Array<Record<string, unknown>>): void => { nodes.push({ id: 'node-3', operation: 'wandas.spectrogram.cepstrum', version: 1, inputs: ['node-2'], params: { $type: 'map', entries: [] } }); },
    },
    {
        name: 'roughness', stepId: 'node-2', rows: 'Critical band [Bark]', colourName: /^Specific roughness \[asper\/Bark\]$/u, signed: false, readout: / \/ \d+\.\d+ s \/ [\d.]+ Bark \/ [\d.e+−-]+ asper\/Bark/u,
        change: (nodes: Array<Record<string, unknown>>): void => { nodes[2] = { ...nodes[2], operation: 'wandas.audio.roughness_dw_spec', version: 2, params: { $type: 'map', entries: [] } }; },
    },
] as const;

for (const kind of OTHER_IMAGES) {
    test(`the recordings' ${kind.name}s are lanes of the one Figure too: rows on a linear axis, one colour range, a cell read with its unit`, async ({ page }) => {
        test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
        test.setTimeout(240_000);
        const own = JSON.parse(JSON.stringify(recipe)) as Record<string, unknown>;
        kind.change(own.nodes as Array<Record<string, unknown>>);
        own.output = kind.stepId;
        const stop = await openComparison(page, own, kind.stepId);
        await expect(page.locator('.track-stage')).toHaveAttribute('data-figure', 'true', { timeout: 120_000 });
        await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.lanes.length === 2 && now.lanes.every(lane => !!lane.image); }, { timeout: 120_000, message: 'the Figure drew its images' }).toBe(true);
        const first = await seen(page);
        expect(first.failure).toBeNull();
        expect(first.lanes.map(item => item.id)).toEqual(['image-base1', 'image-compare1']);
        const [lane, other] = first.lanes;
        expect(lane.axisNames).toEqual({ x: 'Time [s]', y: kind.rows });
        expect(lane.image!.colourName).toMatch(kind.colourName);
        expect(other.range).toEqual(lane.range);
        expect(other.image!.colour).toEqual(lane.image!.colour);
        // Signed coefficients are coloured about zero; a roughness from its lowest to its highest.
        if (kind.signed) expect(lane.image!.colour[0]).toBe(-lane.image!.colour[1]);
        else expect(lane.image!.colour[1]).toBeGreaterThan(lane.image!.colour[0]);
        expect(lane.image!.rows).toBeLessThanOrEqual(Math.ceil(lane.frame.height / 2));
        // A read: the answer's own cell, at its row's place on the linear axis, written with its unit.
        const box = (await page.locator(PREVIEW).boundingBox())!;
        await page.mouse.move(box.x + lane.frame.left + lane.frame.width * 0.45, box.y + lane.frame.top + lane.frame.height * 0.4);
        await expect.poll(async () => (await seen(page)).mark?.row ?? -1, { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
        await settled(page);
        const read = await seen(page);
        expect(read.readout).toMatch(kind.readout);
        expect(Math.abs(read.mark!.py - (lane.frame.top + lane.frame.height * 0.4)), 'the mark is in the row under the pointer').toBeLessThan(lane.frame.height / lane.image!.rows + 3);
        if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, `heatmap-${kind.name}.png`) });
        expect(await stop(), 'the backend answered every request').toEqual([]);
    });
}

test('the PNG of the spectrograms names each lane by its recording, as the page does (the lanes have no line for the strip to name)', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    const stop = await openComparison(page, recipe);
    await drawn(page);
    // What the export's own Figure writes (its canvas is off the page; the screen's Figure is on it).
    await page.evaluate(() => {
        const held = window as unknown as { __offPageTexts: string[] };
        held.__offPageTexts = [];
        // eslint-disable-next-line @typescript-eslint/unbound-method -- kept to be called on the context it was asked of (own.call below)
        const own = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number): void {
            if (!this.canvas.isConnected) held.__offPageTexts.push(String(text));
            if (maxWidth === undefined) own.call(this, text, x, y); else own.call(this, text, x, y, maxWidth);
        };
    });
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: `export-png-${Date.now()}`, actions: [{ action: 'export-figure', payload: { kind: 'png' } }] } })));
    const saved = (): Promise<Array<{ download: string; href: string }>> => page.evaluate(() => (window as unknown as { __uiSmokeDownloads: Array<{ download: string; href: string }> }).__uiSmokeDownloads.filter(item => item.download.endsWith('.png')));
    await expect.poll(async () => (await saved()).length, { timeout: 60_000 }).toBe(1);
    const texts = await page.evaluate(() => (window as unknown as { __offPageTexts: string[] }).__offPageTexts);
    for (const file of files!.slice(0, 2)) {
        const name = path.basename(file.filePath).replace(/\.[^.]+$/u, '');
        expect(texts.some(text => text.includes(name)), `the PNG names the lane of ${name}; it wrote: ${texts.join(' | ')}`).toBe(true);
    }
    await stop();
});
