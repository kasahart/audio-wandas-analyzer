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
 * - zoomed onto it, the plot draws the tone at the same level and nothing of the louder tone outside the window (R3);
 * - the Δ under it does the same with the difference.
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
    backend = new RealBackend();
    files = [];
    for (const filePath of written.out.trim().split('\n')) files.push({ filePath, result: await backend.request({ cmd: 'scan', filePath, recipe }) });
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
    if (!(await bar.locator('.step-chip.is-current').getAttribute('data-step-hold'))?.includes('node-2')) await bar.locator('[data-step-hold="node-2"]').click();
    await expect.poll(() => lines(page.locator('[data-stage-canvas="overlay"]')).then(found => found.length), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
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

/** Ctrl+wheel at (x, y) on `plot`, `notches` times: a zoom about that point. */
async function zoomInto(page: Page, plot: Locator, [x, y]: Point, notches: number): Promise<void> {
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + x, box.y + y);
    await page.keyboard.down('Control');
    for (let notch = 0; notch < notches; notch++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
    await page.keyboard.up('Control');
    await page.mouse.move(1, 1);
}

test('a narrow tone in real recordings is drawn at its full level on the thinned whole spectrum and when zoomed onto it, and nothing outside the window is drawn (R2, R3)', async ({ page }) => {
    test.skip(!ready(), 'no Python backend with wandas for the narrow fixture');
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
    // Zoomed onto the narrow tone: once the backend's bins for the window are drawn, the tone is the highest point
    // drawn, at the level it had on the whole spectrum, and the louder tone outside the window is drawn nowhere.
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
    // Back to the whole spectrum: the Δ is thinned, and the narrow difference keeps its height.
    await page.keyboard.press('0');
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
    await expect.poll(async () => {
        const read = await readAt(page, diff, await highest(diff));
        return Math.abs(read.hz - 1500) < 10 && Math.abs(read.db - zoomedDelta) <= 0.15;
    }, { timeout: 30_000, message: 'thinned, the Δ keeps the narrow difference at its full height' }).toBe(true);
    expect(await stop(), 'the backend answered every request').toEqual([]);
});
