import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from './canvasAudit';
import { openEntry, type ScannedFile } from './entryHelpers';
import { bridgeComparison, RealBackend, runFixture } from './realBackend';

/**
 * R2, R3 on real data through the real path: two recordings the backend analyses (backend_server.py, as the host
 * runs it) that differ in one tone a bin wide, beside a louder tone both have (src/test/fixtures/narrow). The
 * comparison asks for its pictures and its difference as it does in the extension, and the test reads what the plot
 * component drew on each plot (its strokes, recorded by canvasAudit.ts), not the plot's attributes:
 *
 * - the whole spectrum is thinned to the screen, yet the narrow tone is drawn at its full level (R2);
 * - zoomed onto it, the plot asks for the window's own bins and draws every one of them, a bin apart, the tone at the
 *   same level and the louder tone outside the window not on the plot (R3);
 * - the Δ under it does the same with the difference, taken again over the window's bins.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..');
let files: ScannedFile[] | undefined;
let backend: RealBackend | undefined;
let folder = '';
let recipe: Record<string, unknown> = {};
let fixtureError = '';

test.beforeAll(async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'narrow-ui-'));
    const written = runFixture(path.join('src', 'test', 'fixtures', 'narrow', 'generate.py'), [folder]);
    if (!written.out) { fixtureError = written.error ?? ''; return; }
    // The entry Recipe with a long FFT: 4096 bins, many more than the plot's width, so the whole spectrum is thinned.
    recipe = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as Record<string, unknown>;
    const welch = (recipe.nodes as Array<{ operation: string; params: { entries: Array<[string, unknown]> } }>).find(node => node.operation === 'wandas.audio.welch')!;
    welch.params.entries = welch.params.entries.map(([name, value]) => [name, name === 'n_fft' ? 8192 : value]);
    // A backend that cannot start (no wandas) skips the test with why, as a missing Python does, unless it is required.
    try {
        backend = new RealBackend();
        const scanned: ScannedFile[] = [];
        for (const filePath of written.out.trim().split('\n')) scanned.push({ filePath, result: await backend.request({ cmd: 'scan', filePath, recipe }) });
        files = scanned;
    } catch (error) {
        fixtureError = error instanceof Error ? error.message : String(error);
    }
});
test.afterAll(() => {
    backend?.close();
    if (folder) rmSync(folder, { recursive: true, force: true });
});

const ready = (): boolean => {
    if (!files && process.env.AWA_REQUIRE_BACKEND === '1') throw new Error(`AWA_REQUIRE_BACKEND=1 but the narrow fixture could not be analysed: ${fixtureError}`);
    return !!files;
};

/** The base recording in slot 0, the compared one in slot 1, the comparison opened on the Welch spectrum. */
async function openComparison(page: Page): Promise<() => Promise<string[]>> {
    await page.setViewportSize({ width: 1280, height: 900 });
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
    await expect(bar.locator('[data-step-hold="node-2"]')).toBeVisible();
    // The Welch step shown: its chip made current (the first opening shows the input), then the bar showing it.
    const welch = bar.locator('[data-step-hold="node-2"]');
    const welchChip = bar.locator('.step-chip[data-step-id="node-2"]');
    if (!((await welchChip.getAttribute('class')) ?? '').split(/\s+/u).includes('is-current')) await welch.click();
    await expect(welchChip).toHaveClass(/(?:^|\s)is-current(?:\s|$)/u);
    await expect(bar).toHaveAttribute('data-stage', 'node-2', { timeout: 30_000 });
    // Drawn: the Welch step's own picture (not the step shown before it), every file in, its lines' order measured,
    // and both recordings' lines on the plot.
    const overlay = page.locator('[data-stage-canvas="overlay"]');
    await expect.poll(async () => ({
        stage: await bar.getAttribute('data-stage'),
        pending: await page.locator('.track-stage').getAttribute('data-pending'),
        measuring: ((await overlay.getAttribute('data-plot-order')) ?? '…').includes('…'),
        axes: ((await overlay.getAttribute('data-plot-axes')) ?? '').startsWith('Frequency'),
        lines: (await lines(overlay)).length >= 2,
    }), { timeout: 30_000 }).toEqual({ stage: 'node-2', pending: '', measuring: false, axes: true, lines: true });
    return stop;
}

type Point = [number, number];
/** The lines the plot component drew on `plot`: each stroke clipped to the plot's frame, with only its points inside it. */
function lines(plot: Locator): Promise<Array<{ color: string; points: Point[]; frame: [number, number, number, number] }>> {
    return plot.evaluate(canvas => {
        const drawn = (canvas as HTMLCanvasElement & { __plotDrawn?: { strokes: Array<{ color: string; points: Point[]; clip: [number, number, number, number] | null }> } }).__plotDrawn;
        return (drawn?.strokes ?? []).filter(stroke => stroke.clip).map(stroke => {
            const [left, top, width, height] = stroke.clip!;
            return { color: stroke.color, frame: stroke.clip!, points: stroke.points.filter(([x, y]) => x >= left - 0.5 && x <= left + width + 0.5 && y >= top - 0.5 && y <= top + height + 0.5) };
        }).filter(stroke => stroke.points.length);
    });
}

/** The highest point drawn on `plot` (least y), away from `apart` CSS pixels across of each of `not`. */
async function highest(plot: Locator, not: number[] = [], apart = 12): Promise<Point> {
    const points = (await lines(plot)).flatMap(stroke => stroke.points).filter(([x]) => not.every(other => Math.abs(x - other) > apart));
    expect(points.length, 'the plot drew lines').toBeGreaterThan(0);
    return points.reduce((best, point) => (point[1] < best[1] ? point : best));
}

/** The frequency (Hz) and level (dB) the pointer at (x, y) on `plot` reads in the row above it. */
async function readAt(page: Page, plot: Locator, [x, y]: Point): Promise<{ hz: number; db: number; text: string }> {
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + x, box.y + y);
    const row = plot.locator('xpath=preceding::*[@data-plot-readout][1]');
    await expect(row).toBeVisible();
    const text = (await row.textContent()) ?? '';
    const where = /([\d.]+)\s*(k?)Hz/u.exec(text);
    const level = /([+−-]?[\d.]+)\s*dB/u.exec(text.slice(where ? where.index + where[0].length : 0));
    expect(where && level, `a frequency and a level in "${text}"`).toBeTruthy();
    return { hz: Number(where![1]) * (where![2] ? 1000 : 1), db: Number(level![1].replace('−', '-')), text };
}

/** The bin spacing of the fixture's spectrum: 16 kHz over an 8192-point FFT. */
const BIN_HZ = 16000 / 8192;

/**
 * What the longest line drawn on `plot` holds across its frame, read in Hz: its points placed on the log frequency
 * axis by the two the pointer reads at its ends, then how many there are, how far apart, and the ends' frequencies.
 */
async function binsDrawn(page: Page, plot: Locator): Promise<{ count: number; low: number; high: number; gaps: number[] }> {
    const strokes = await lines(plot);
    const longest = strokes.reduce((best, stroke) => (stroke.points.length > best.points.length ? stroke : best));
    const points = [...longest.points].sort((a, b) => a[0] - b[0]);
    const first = points[0], last = points[points.length - 1];
    const low = (await readAt(page, plot, first)).hz, high = (await readAt(page, plot, last)).hz;
    const hz = ([x]: Point): number => low * (high / low) ** ((x - first[0]) / (last[0] - first[0]));
    const gaps = points.slice(1).map((point, index) => hz(point) - hz(points[index]));
    return { count: points.length, low, high, gaps };
}

/**
 * Every bin of the window is drawn on `plot` (R3): its longest line's points are about as many as the bins between
 * its ends, a bin apart, and more than twice what the whole spectrum held there (`overviewIn`). (The detail asked for
 * reaches a little past the window, for a pan; the frame's clip keeps it off the plot.)
 */
async function expectEveryBin(page: Page, plot: Locator, overviewIn: (low: number, high: number) => number): Promise<void> {
    const { count, low, high, gaps } = await binsDrawn(page, plot);
    const bins = (high - low) / BIN_HZ + 1;
    expect(Math.abs(count - bins) / bins, `${count} points drawn for the ${Math.round(bins)} bins of ${low}–${high} Hz`).toBeLessThan(0.02);
    const sorted = [...gaps].sort((a, b) => a - b);
    expect(Math.abs(sorted[Math.floor(sorted.length / 2)] - BIN_HZ) / BIN_HZ, 'points a bin apart').toBeLessThan(0.03);
    expect(sorted[sorted.length - 1], 'no bin left out').toBeLessThan(1.5 * BIN_HZ);
    expect(count, 'more points than the thinned whole spectrum holds in the window').toBeGreaterThan(2 * overviewIn(low, high));
}

/** The `compare-scan` and `compare-combine` messages posted from the `from`-th on that ask for a detail. */
async function detailsAsked(page: Page, from: number): Promise<string[]> {
    return page.evaluate(from => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; detail?: unknown }> }).__uiSmokePostedMessages.slice(from)
        .filter(message => (message.type === 'compare-scan' || message.type === 'compare-combine') && message.detail).map(message => message.type), from);
}
const postedCount = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: unknown[] }).__uiSmokePostedMessages.length);

/** Ctrl+wheel at (x, y) on `plot`, `notches` times: a zoom about that point. */
async function zoomInto(page: Page, plot: Locator, [x, y]: Point, notches: number): Promise<void> {
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + x, box.y + y);
    await page.keyboard.down('Control');
    for (let notch = 0; notch < notches; notch++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
    await page.keyboard.up('Control');
    await page.mouse.move(1, 1);
}

test('a narrow tone in real recordings is drawn at its full level on the thinned whole spectrum, and zoomed onto it the window is drawn again from every one of its own bins (R2, R3)', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(180_000);
    const stop = await openComparison(page);
    const overlay = page.locator('[data-stage-canvas="overlay"]');
    // The whole spectrum: far more bins than pixels (4096), so thinned to a few points per pixel.
    const drawnPoints = Math.max(...(await lines(overlay)).map(stroke => stroke.points.length));
    const frameWidth = (await lines(overlay))[0].frame[2];
    expect(drawnPoints, 'the whole spectrum is thinned to the plot\'s width, far fewer points than its 4096 bins').toBeLessThanOrEqual(Math.min(2048, Math.ceil(frameWidth) * 3));
    // The loudest drawn point is the 3 kHz tone.
    const loudAt = await highest(overlay);
    const loud = await readAt(page, overlay, loudAt);
    expect(Math.abs(loud.hz - 3000), loud.text).toBeLessThan(10);
    // Away from it, the highest drawn point is the narrow 1.5 kHz tone, one bin wide among 4096.
    const narrowAt = await highest(overlay, [loudAt[0]]);
    const narrow = await readAt(page, overlay, narrowAt);
    expect(Math.abs(narrow.hz - 1500), narrow.text).toBeLessThan(10);
    expect(loud.db - narrow.db, 'the narrow tone keeps its level when thinned: 34 dB under the loud one').toBeLessThan(36);
    const overviewStrokes = await lines(overlay);
    // The whole spectrum's points placed on the frequency axis by the two tones read on it (a log axis), to count
    // how many of them a window holds.
    const perOctave = (loudAt[0] - narrowAt[0]) / Math.log2(loud.hz / narrow.hz);
    const overviewHz = ([x]: Point): number => narrow.hz * 2 ** ((x - narrowAt[0]) / perOctave);
    const overviewIn = (low: number, high: number): number => Math.max(...overviewStrokes.map(stroke => stroke.points.filter(point => overviewHz(point) >= low && overviewHz(point) <= high).length));
    // Zoomed onto the narrow tone: the plot asks the backend for the window's own bins (a detail), then draws every bin
    // in it, a bin apart, many more points than the whole spectrum held there (R3), not the thinned line stretched.
    const beforeZoom = await postedCount(page);
    await zoomInto(page, overlay, narrowAt, 6);
    const root = page.locator('.track-stage');
    await expect(root).not.toHaveAttribute('data-x-window', '0.000-1.000');
    const frame = (await lines(overlay))[0].frame;
    const rightEdge = await readAt(page, overlay, [frame[0] + frame[2] - 1, frame[1] + frame[3] / 2]);
    expect(rightEdge.hz, 'the window ends below the loud tone').toBeLessThan(3000);
    await expect.poll(async () => {
        const top = await highest(overlay);
        const read = await readAt(page, overlay, top);
        return Math.abs(read.hz - 1500) < 5 && Math.abs(read.db - narrow.db) <= 0.15;
    }, { timeout: 30_000, message: 'zoomed, the highest point drawn is the narrow tone at the level the whole spectrum drew it' }).toBe(true);
    await expect.poll(() => detailsAsked(page, beforeZoom), { timeout: 30_000, message: 'the zoom asks for the window\'s own bins' }).toContain('compare-scan');
    await expect(() => expectEveryBin(page, overlay, overviewIn)).toPass({ timeout: 30_000 });
    // Δ under it, on the same frequency window: its highest point is the narrow tone's difference, the only one.
    await page.locator('[data-action="stage-diff"]').click();
    const diff = page.locator('[data-stage-canvas="diff"]');
    await expect(diff).toBeVisible();
    await expect.poll(async () => (await lines(diff)).length, { timeout: 30_000 }).toBeGreaterThan(0);
    let zoomedDelta = 0;
    await expect.poll(async () => {
        const read = await readAt(page, diff, await highest(diff));
        zoomedDelta = read.db;
        return Math.abs(read.hz - 1500) < 5 && read.db > 20;
    }, { timeout: 30_000, message: 'zoomed, the Δ\'s highest point is the narrow tone' }).toBe(true);
    // The Δ too: its difference taken over the window's own bins (a combine with the detail), every bin drawn.
    await expect.poll(() => detailsAsked(page, beforeZoom), { timeout: 30_000, message: 'the zoomed Δ asks for the difference of the window\'s own bins' }).toContain('compare-combine');
    await expect(() => expectEveryBin(page, diff, overviewIn)).toPass({ timeout: 30_000 });
    // Back to the whole spectrum: the Δ is thinned, and the narrow difference keeps its height.
    await page.keyboard.press('0');
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
    await expect.poll(async () => {
        const read = await readAt(page, diff, await highest(diff));
        return Math.abs(read.hz - 1500) < 10 && Math.abs(read.db - zoomedDelta) <= 0.15;
    }, { timeout: 30_000, message: 'thinned, the Δ keeps the narrow difference at its full height' }).toBe(true);
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

test('a hover and the arrow keys on the thinned whole spectrum read its real bins from the backend, one bin per key, each at its exact value (R7)', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(180_000);
    const stop = await openComparison(page);
    const overlay = page.locator('[data-stage-canvas="overlay"]');
    const loudAt = await highest(overlay);
    const box = (await overlay.boundingBox())!;
    const before = await postedCount(page);
    await page.mouse.move(box.x + loudAt[0], box.y + loudAt[1]);
    // The number is the full data's (asked for around the pointer), not the line drawn there.
    await expect(overlay).toHaveAttribute('data-plot-read', 'full', { timeout: 30_000 });
    const read = async (): Promise<[number, number]> => [Number(await overlay.getAttribute('data-plot-read-at')), Number(await overlay.getAttribute('data-plot-read-value'))];
    const visited: Array<[number, number]> = [await read()];
    expect(Math.abs(visited[0][0] - 3000), 'the loud tone is read').toBeLessThan(10);
    // ← / → step one real bin at a time, though several share each pixel of the thinned line.
    for (const key of [...Array<string>(12).fill('ArrowRight'), ...Array<string>(4).fill('ArrowLeft')]) {
        const from = visited[visited.length - 1][0];
        await page.keyboard.press(key);
        await expect.poll(async () => (await read())[0], { timeout: 15_000 }).not.toBe(from);
        const next = await read();
        expect(Math.abs(Math.abs(next[0] - from) - BIN_HZ), `${key} from ${from} Hz to ${next[0]} Hz`).toBeLessThan(1e-6);
        expect(Math.sign(next[0] - from)).toBe(key === 'ArrowRight' ? 1 : -1);
        visited.push(next);
    }
    // Each value read is the backend's own bin there, asked for again here over the whole stretch stepped through.
    const asked = await page.evaluate(from => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; base?: string[]; read?: { of?: string; x: number[] } }> }).__uiSmokePostedMessages.slice(from)
        .filter(message => message.type === 'compare-combine' && message.read), before);
    expect(asked.length, 'the readout asked the backend for its points').toBeGreaterThan(0);
    // Each line under the pointer asks for its window once; the line read asks once more for the steps ahead.
    expect(asked.length, 'a request for the window and the steps ahead, not one per key').toBeLessThanOrEqual(4);
    const stepped = asked.find(message => message.read?.x.length === 1) ?? asked[0];
    const xs = visited.map(([at]) => at);
    const whole = await backend!.request({ cmd: 'stage-combine', base: stepped.base, read: { x: [Math.min(...xs), Math.max(...xs)], beyond: 0, of: stepped.read?.of ?? 'base' } }) as { points?: { xs: number[]; values: Array<number | null> } };
    const points = whole.points!;
    for (const [at, value] of visited) {
        const index = points.xs.findIndex(x => Math.abs(x - at) < 1e-6);
        expect(index, `bin at ${at} Hz`).toBeGreaterThanOrEqual(0);
        expect(value).toBe(points.values[index]);
    }
    expect(await stop(), 'the backend answered every request').toEqual([]);
});
