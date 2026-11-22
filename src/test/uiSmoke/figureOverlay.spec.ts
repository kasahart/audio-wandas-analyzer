import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { backendRequired, openEntry, type ScannedFile } from './entryHelpers';
import { bridgeComparison, RealBackend, runFixture } from './realBackend';

/**
 * The comparison's spectrum overlay on the new path (one Figure, src/webview/figure/, drawn and read by the
 * figure service, python-backend/figures/), through the REAL backend as the host runs it (backend_server.py): two
 * recordings that differ in one tone a bin wide beside a louder tone both have (src/test/fixtures/narrow). What is
 * checked is what the Figure drew and reads (its inspection on its canvas, in canvas CSS px), and what the readout row
 * writes:
 *
 * - R2, R3: the whole spectrum is thinned to the screen, yet the narrow tone is drawn at its full level; zoomed onto it,
 *   the window is drawn again from every one of its own bins (the service draws from every value at any range);
 * - R7: the point read is a real bin with its exact value, the mark at it (< 1 px), and ← / → step one bin per key;
 * - R9: typed ends give the confirmed range today's rule gives (123.456789 Hz is 123.457 Hz), taken by layer 2 as given;
 * - R13: a double click resets the zoom only, its first press doing nothing (the overlay's click acts on nothing).
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..');
let files: ScannedFile[] | undefined;
let backend: RealBackend | undefined;
let folder = '';
let recipe: Record<string, unknown> = {};
let fixtureError = '';

test.beforeAll(async () => {
    folder = mkdtempSync(path.join(tmpdir(), 'figure-ui-'));
    const written = runFixture(path.join('src', 'test', 'fixtures', 'narrow', 'generate.py'), [folder]);
    if (!written.out) { fixtureError = written.error ?? ''; return; }
    recipe = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as Record<string, unknown>;
    const welch = (recipe.nodes as Array<{ operation: string; params: { entries: Array<[string, unknown]> } }>).find(node => node.operation === 'wandas.audio.welch')!;
    welch.params.entries = welch.params.entries.map(([name, value]) => [name, name === 'n_fft' ? 8192 : value]);
    try {
        backend = new RealBackend();
        const scanned: ScannedFile[] = [];
        for (const filePath of written.out.trim().split('\n')) scanned.push({ filePath, result: await backend.request({ cmd: 'scan', filePath, recipe, stage: String(recipe.output) }) });
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
    if (!files && backendRequired()) throw new Error(`the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo's .venv) but the narrow fixture could not be analysed: ${fixtureError}`);
    return !!files;
};

type Point = [number, number];
interface Seen {
    waiting: boolean; held: boolean; pictureId: string | null; readout: string; headline: string; generation: number;
    lanes: Array<{ id: string; frame: { left: number; top: number; width: number; height: number }; range: { x: [number, number]; y: [number, number] } | null; axisNames: { x: string; y: string }; order: string[]; lines: Array<{ id: string; colour: string; points: Array<Point | null> }> }>;
    mark: { lane: string; line: string; index: number; x: number; value: number; px: number; py: number } | null;
}
const FIGURE = '[data-stage-figure] canvas[data-figure]';
/** What the overlay's Figure drew and reads now. */
const seen = (page: Page): Promise<Seen> => page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());

/** The base recording in slot 0, the compared one in slot 1, the comparison opened on the Welch spectrum, drawn. */
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
    const welch = bar.locator('[data-step-hold="node-2"]');
    await expect(welch).toBeVisible();
    // The bar is drawn again while the comparison opens, and a click landing in between is lost (no step is
    // shown, and this wait ran out under load): the click is made again until the step is the one shown.
    await expect(async () => {
        if ((await bar.getAttribute('data-stage')) !== 'node-2') await welch.click();
        await expect(bar).toHaveAttribute('data-stage', 'node-2', { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.locator('.track-stage')).toHaveAttribute('data-figure', 'true', { timeout: 30_000 });
    await expect.poll(async () => {
        const now = await seen(page);
        return !now.waiting && (now.lanes[0]?.lines.length ?? 0) >= 2;
    }, { timeout: 30_000, message: 'the Figure drew the base and the compared recording' }).toBe(true);
    return stop;
}

/** Moves the pointer to `at` (canvas CSS px) and waits for the readout of a point read there. */
type EveryValue = { xs: number[]; values: Array<number | null> };
let everyValueAsked = 0;

/**
 * Every value of the lines the page's Figure last drew, as the backend itself writes them out (its figure-export of
 * the same declaration, whole: none thinned, none rounded), by line id. Asked of the backend apart from the page.
 */
async function everyValue(page: Page): Promise<Map<string, EveryValue>> {
    const draw = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; command?: string; payload?: Record<string, unknown> }> }).__uiSmokePostedMessages
        .filter(message => message.type === 'figure-request' && message.command === 'figure-draw').at(-1)!.payload!);
    // A Figure of its own each time: the backend takes no older generation of a Figure it has drawn before.
    const figureId = `every-value-${++everyValueAsked}`;
    const asked = await backend!.request({ cmd: 'figure-draw', ...draw, view: null, figureId, generation: 1, requestNumber: 1 }) as { status: string; dataId: string };
    expect(asked.status, 'the backend draws the declaration the page last drew').toBe('picture');
    const exported = await backend!.request({ cmd: 'figure-export', spec: draw.spec, view: null, dataId: asked.dataId, requestNumber: 1 }) as { columns: Array<{ line: string } & EveryValue> };
    await backend!.request({ cmd: 'figure-release', figureId });
    return new Map(exported.columns.map(column => [column.line, { xs: column.xs, values: column.values }]));
}

async function hover(page: Page, at: Point): Promise<Seen> {
    const box = (await page.locator(FIGURE).boundingBox())!;
    await page.mouse.move(box.x + at[0], box.y + at[1]);
    await expect.poll(async () => (await seen(page)).mark !== null, { timeout: 15_000 }).toBe(true);
    await settled(page);
    return seen(page);
}

/** The highest point drawn on lane `lane` (least y), away from `apart` px across of each of `not`. */
async function highest(page: Page, lane = 'overlay', not: number[] = [], apart = 12): Promise<Point> {
    const drawn = (await seen(page)).lanes.find(item => item.id === lane)!;
    const points = drawn.lines.flatMap(line => line.points).filter((point): point is Point => !!point && point[0] >= drawn.frame.left && point[0] <= drawn.frame.left + drawn.frame.width)
        .filter(([x]) => not.every(other => Math.abs(x - other) > apart));
    expect(points.length, 'the Figure drew lines').toBeGreaterThan(0);
    return points.reduce((best, point) => (point[1] < best[1] ? point : best));
}

const BIN_HZ = 16000 / 8192;

test('the spectrum overlay is one Figure on the new path: the old overlay and Δ canvases are not shown, its lines are in the declared order and the roles\' colours', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(120_000);
    const stop = await openComparison(page);
    await expect(page.locator('[data-stage-canvas="overlay"]')).toBeHidden();
    await expect(page.locator('[data-stage-canvas="diff"]')).toBeHidden();
    const now = await seen(page);
    // The spec carries every key its lines name, each with the state and the version the answer store gave it (the
    // version of a usable one is its kept values' key, as the backend names them): what the service counts by.
    type Spec = { lanes: Array<{ lines: Array<{ of: { key?: string; median?: string[]; delta?: { compare: string; base: string[] } } }> }>; keys: Array<{ key: string; state: string; version: string }> };
    const spec = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; command?: string; payload?: { spec?: unknown } }> }).__uiSmokePostedMessages
        .filter(message => message.type === 'figure-request' && message.command === 'figure-draw').at(-1)!.payload!.spec) as Spec;
    const named = new Set(spec.lanes.flatMap(lane => lane.lines.flatMap(line => [line.of.key, ...(line.of.median ?? []), line.of.delta?.compare, ...(line.of.delta?.base ?? [])])).filter((key): key is string => !!key));
    expect([...named].sort()).toEqual(spec.keys.map(entry => entry.key).sort());
    for (const entry of spec.keys) {
        expect(['usable', 'pending', 'stale', 'failed', 'evicted']).toContain(entry.state);
        expect(entry.version, `${entry.key}: a version`).not.toBe('');
        if (entry.state === 'usable') expect(entry.version).toBe(entry.key);
    }
    expect(spec.keys.every(entry => entry.state === 'usable'), 'both recordings scanned: usable').toBe(true);
    // Spec 1: the base (slot 0), then compare 1; no right-hand axis (spec 2): one value axis per lane.
    expect(now.lanes.map(lane => lane.id)).toEqual(['overlay']);
    expect(now.lanes[0].order).toEqual(['base', 'compare1']);
    expect(now.lanes[0].lines.map(line => line.colour)).toEqual(['#3b82f6', '#d4b20f']);
    // R6 on the canvas itself, not only as the Figure says it: drawn again, the base's line is stroked first and the
    // compared one's after it (over it). A painter that strokes in another order than it declares fails here.
    // Only this Figure's canvas is watched, and only its latest painting (a painting starts where the Figure clears
    // its canvas), so another Figure's lines or an earlier painting cannot stand in for this one.
    await page.locator(FIGURE).evaluate(target => {
        const w = window as unknown as { __figureStrokes: string[]; __figurePaintings: number };
        w.__figureStrokes = [];
        w.__figurePaintings = 0;
        const proto = CanvasRenderingContext2D.prototype as unknown as { stroke: (...rest: unknown[]) => void; clearRect: (...rest: unknown[]) => void };
        const stroke = proto.stroke;
        proto.stroke = function(this: CanvasRenderingContext2D, ...args: unknown[]): void {
            if (this.canvas === target && typeof this.strokeStyle === 'string') w.__figureStrokes.push(this.strokeStyle);
            stroke.apply(this, args);
        };
        const clearRect = proto.clearRect;
        proto.clearRect = function(this: CanvasRenderingContext2D, ...args: unknown[]): void {
            if (this.canvas === target && Number(args[0]) === 0 && Number(args[1]) === 0) { w.__figureStrokes = []; w.__figurePaintings += 1; }
            clearRect.apply(this, args);
        };
    });
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.width - 60, height: size.height });
    const roleStrokes = async (): Promise<string[]> => (await page.evaluate(() => (window as unknown as { __figureStrokes: string[] }).__figureStrokes)).filter(colour => colour === '#3b82f6' || colour === '#d4b20f');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __figurePaintings: number }).__figurePaintings), { timeout: 15_000, message: 'the overlay\'s Figure must paint again after the page is resized' }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => !(await seen(page)).waiting, { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await roleStrokes()).length, { timeout: 15_000 }).toBe(2);
    expect(await roleStrokes(), 'the lines are stroked in the declared order: the base, then compare 1 over it (R6). Fix: the Figure\'s painter must stroke lane.lines in their order (src/webview/figure/figure.ts)').toEqual(['#3b82f6', '#d4b20f']);
    expect(now.lanes[0].axisNames).toEqual({ x: 'Frequency [Hz]', y: expect.stringMatching(/^Level.*\[dBFS\]$/u) as unknown as string });
    // Δ: a lane under the overlay, sharing the axis across.
    await page.locator('[data-action="stage-diff"]').click();
    await expect.poll(async () => (await seen(page)).lanes.map(lane => lane.id), { timeout: 30_000 }).toEqual(['overlay', 'delta']);
    await expect.poll(async () => !(await seen(page)).waiting, { timeout: 30_000 }).toBe(true);
    const both = await seen(page);
    expect(both.lanes[1].range!.x).toEqual(both.lanes[0].range!.x);
    expect(both.lanes[1].axisNames.y).toBe('Difference Δ [dB]');
    // The Δ headline: where the difference is largest, the narrow tone, in the readout's form.
    await expect(page.locator('[data-stage-figure-headline]')).toHaveText(/^largest Δ 1\.5\d* kHz \+\d+\.\d dB$/u);
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

test('a narrow tone is drawn at its full level on the thinned whole spectrum, and zoomed onto it the window is drawn from every one of its own bins (R2, R3)', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(180_000);
    const stop = await openComparison(page);
    const whole = await seen(page);
    const frame = whole.lanes[0].frame;
    const drawnPoints = Math.max(...whole.lanes[0].lines.map(line => line.points.filter(Boolean).length));
    expect(drawnPoints, 'the whole spectrum is thinned to the plot\'s width, far fewer points than its 4096 bins').toBeLessThanOrEqual(Math.min(2048, Math.ceil(frame.width) * 3));
    const loudAt = await highest(page);
    const loud = (await hover(page, loudAt)).mark!;
    expect(Math.abs(loud.x - 3000)).toBeLessThan(10);
    const narrowAt = await highest(page, 'overlay', [loudAt[0]]);
    const narrow = (await hover(page, narrowAt)).mark!;
    expect(Math.abs(narrow.x - 1500)).toBeLessThan(10);
    expect(loud.value - narrow.value, 'the narrow tone keeps its level when thinned: 34 dB under the loud one').toBeLessThan(36);
    // The whole spectrum's drawn points placed on the frequency axis, to count how many of them a window held.
    const across = (x: number, range: [number, number], left: number, width: number): number => range[0] * (range[1] / range[0]) ** ((x - left) / width);
    const wholeX = whole.lanes[0].range!.x;
    const wholeIn = (low: number, high: number): number => Math.max(...whole.lanes[0].lines.map(line => line.points.filter((point): point is Point => !!point && across(point[0], wholeX, frame.left, frame.width) >= low && across(point[0], wholeX, frame.left, frame.width) <= high).length));
    /** Ctrl+wheel about the narrow tone, `notches` times, until the Figure has drawn the new range. */
    const zoomOnto = async (notches: number): Promise<Seen> => {
        const box = (await page.locator(FIGURE).boundingBox())!;
        const at = await highest(page, 'overlay', [loudAt[0]]);
        await page.mouse.move(box.x + at[0], box.y + at[1]);
        await page.keyboard.down('Control');
        for (let notch = 0; notch < notches; notch++) { await page.mouse.wheel(0, -240); await settled(page); }
        await page.keyboard.up('Control');
        await page.mouse.move(1, 1);
        await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.lanes[0].range!.x[1] < 3000; }, { timeout: 30_000 }).toBe(true);
        return seen(page);
    };
    const inWindow = (now: Seen): Point[] => now.lanes[0].lines.find(line => line.id === 'compare1')!.points.filter((point): point is Point => !!point && point[0] >= frame.left - 0.5 && point[0] <= frame.left + frame.width + 0.5);
    // Zoomed onto the tone: the window is drawn again from its own bins (R3), not the thinned line stretched: many more
    // points than the whole spectrum held there, and the tone at the level the whole spectrum drew it.
    const zoomed = await zoomOnto(6);
    const [low, high] = zoomed.lanes[0].range!.x;
    expect(inWindow(zoomed).length, 'more points than the thinned whole spectrum held in the window').toBeGreaterThan(2 * wholeIn(low, high));
    // No peak or dip lost (R2 at every zoom: each column of a pixel keeps its lowest and highest bin): every bin of the window,
    // as the figure service exports it unthinned, lies inside the drawn envelope of its own column.
    const lane = zoomed.lanes[0];
    const draw = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; command?: string; payload?: Record<string, unknown> }> }).__uiSmokePostedMessages
        .filter(message => message.type === 'figure-request' && message.command === 'figure-draw').at(-1)!.payload!);
    const asked = await backend!.request({ cmd: 'figure-draw', ...draw, figureId: 'r3-check', generation: 1, requestNumber: 1 }) as { dataId: string };
    const exported = await backend!.request({ cmd: 'figure-export', spec: draw.spec, view: draw.view, dataId: asked.dataId, requestNumber: 1 }) as { columns: Array<{ line: string; xs: number[]; values: Array<number | null> }> };
    await backend!.request({ cmd: 'figure-release', figureId: 'r3-check' });
    const every = exported.columns.find(column => column.line === 'compare1')!;
    const [bottom, topY] = lane.range!.y;
    const pxOf = (x: number): number => frame.left + Math.log(x / low) / Math.log(high / low) * frame.width;
    const pyOf = (value: number): number => frame.top + (1 - (value - bottom) / (topY - bottom)) * frame.height;
    const drawnCompare = inWindow(zoomed);
    let held = 0;
    every.xs.forEach((x, at) => {
        const value = every.values[at];
        // Inside the window and the value axis, and not silence (the line is cut there).
        if (value === null || x < low || x > high || value > topY || value < bottom || value <= -250) return;
        const column = drawnCompare.filter(([px]) => Math.abs(px - pxOf(x)) <= 2.5);
        const y = pyOf(value);
        expect(column.some(([, py]) => py <= y + 0.5) && column.some(([, py]) => py >= y - 0.5), `the bin at ${x} Hz (${value} dB) is inside the drawn envelope of its column`).toBe(true);
        held += 1;
    });
    expect(held, 'bins of the window checked').toBeGreaterThan(100);
    const top = (await hover(page, await highest(page))).mark!;
    expect(Math.abs(top.x - 1500)).toBeLessThan(5);
    expect(Math.abs(top.value - narrow.value), 'zoomed, the tone at the level the whole spectrum drew it').toBeLessThanOrEqual(0.15);
    // Zoomed in until the window holds fewer bins than the plot has columns of two pixels:
    // every bin of it is drawn, a bin apart.
    const deep = await zoomOnto(8);
    const [deepLow, deepHigh] = deep.lanes[0].range!.x;
    const points = inWindow(deep).sort((a, b) => a[0] - b[0]);
    const bins = (deepHigh - deepLow) / BIN_HZ;
    expect(bins, 'the window holds fewer bins than the plot has two-pixel columns').toBeLessThan(frame.width / 2);
    expect(Math.abs(points.length - bins) / bins, `${points.length} points drawn for the ${Math.round(bins)} bins of ${deepLow}–${deepHigh} Hz`).toBeLessThan(0.05);
    const gaps = points.slice(1).map((point, at) => across(point[0], [deepLow, deepHigh], frame.left, frame.width) - across(points[at][0], [deepLow, deepHigh], frame.left, frame.width)).sort((a, b) => a - b);
    expect(Math.abs(gaps[Math.floor(gaps.length / 2)] - BIN_HZ) / BIN_HZ, 'points a bin apart').toBeLessThan(0.03);
    // The Δ under it, on the same window: its highest point is the narrow tone's difference, the only one, and every
    // bin of the window is drawn, a bin apart (the Δ of every bin, 1 層目).
    await page.locator('[data-action="stage-diff"]').click();
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.lanes.map(item => item.id).join(); }, { timeout: 30_000 }).toBe('overlay,delta');
    const withDelta = await seen(page);
    const deltaFrame = withDelta.lanes[1].frame;
    const deltaIn = (now: Seen): Point[] => now.lanes[1].lines[0].points.filter((point): point is Point => !!point && point[0] >= deltaFrame.left - 0.5 && point[0] <= deltaFrame.left + deltaFrame.width + 0.5).sort((one, two) => one[0] - two[0]);
    const zoomedDelta = (await hover(page, await highest(page, 'delta'))).mark!;
    expect(zoomedDelta.lane).toBe('delta');
    expect(Math.abs(zoomedDelta.x - 1500), 'zoomed, the Δ\'s highest point is the narrow tone').toBeLessThan(5);
    expect(zoomedDelta.value, 'its difference, far above the rest').toBeGreaterThan(20);
    const deltaPoints = deltaIn(withDelta);
    const [dLow, dHigh] = withDelta.lanes[1].range!.x;
    const deltaBins = (dHigh - dLow) / BIN_HZ;
    expect(Math.abs(deltaPoints.length - deltaBins) / deltaBins, `${deltaPoints.length} Δ points for the ${Math.round(deltaBins)} bins of the window`).toBeLessThan(0.05);
    const deltaGaps = deltaPoints.slice(1).map((point, at) => across(point[0], [dLow, dHigh], deltaFrame.left, deltaFrame.width) - across(deltaPoints[at][0], [dLow, dHigh], deltaFrame.left, deltaFrame.width)).sort((one, two) => one - two);
    expect(Math.abs(deltaGaps[Math.floor(deltaGaps.length / 2)] - BIN_HZ) / BIN_HZ, 'Δ points a bin apart').toBeLessThan(0.03);
    // Back to the whole spectrum: the Δ is thinned, and the narrow difference keeps its height (R2).
    const figureBox = (await page.locator(FIGURE).boundingBox())!;
    await page.mouse.move(figureBox.x + deltaFrame.left + deltaFrame.width / 2, figureBox.y + deltaFrame.top + deltaFrame.height / 2);
    await page.keyboard.press('0');
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.lanes[1].range!.x[1] > 3000; }, { timeout: 30_000 }).toBe(true);
    const wholeDelta = (await hover(page, await highest(page, 'delta'))).mark!;
    expect(Math.abs(wholeDelta.x - 1500), 'thinned, the Δ\'s highest point is still the narrow tone').toBeLessThan(10);
    expect(Math.abs(wholeDelta.value - zoomedDelta.value), 'thinned, the Δ keeps the narrow difference at its full height').toBeLessThanOrEqual(0.15);
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

test('a hover reads a real bin at its exact value, the mark on it, and the arrow keys step one bin per key (R7)', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(180_000);
    const stop = await openComparison(page);
    const loudAt = await highest(page);
    const first = await hover(page, loudAt);
    const mark = first.mark!;
    expect(Math.abs(mark.x - 3000), 'the loud tone is read').toBeLessThan(10);
    // The readout writes the point read: its line's name, where, and the level in the axis's reference.
    expect(first.readout).toMatch(/ \/ 3(\.0+)? kHz \/ −?\d+\.\d dBFS$/u);
    await expect(page.locator('.track-stage-controls [data-figure-readout]')).toHaveText(first.readout);
    // The mark is at the point read, within a pixel of where the line through it is drawn.
    const drawn = first.lanes[0].lines.find(line => line.id === mark.line)!.points.filter((point): point is Point => !!point);
    expect(Math.min(...drawn.map(([x, y]) => Math.hypot(x - mark.px, y - mark.py))), 'the mark is on its line').toBeLessThan(1.5);
    const visited: Array<{ x: number; value: number; line: string; index: number }> = [{ x: mark.x, value: mark.value, line: mark.line, index: mark.index }];
    for (const key of [...Array<string>(12).fill('ArrowRight'), ...Array<string>(4).fill('ArrowLeft')]) {
        const from = visited[visited.length - 1];
        await page.keyboard.press(key);
        await expect.poll(async () => (await seen(page)).mark?.x, { timeout: 15_000 }).not.toBe(from.x);
        const next = (await seen(page)).mark!;
        expect(Math.abs(Math.abs(next.x - from.x) - BIN_HZ), `${key} from ${from.x} Hz to ${next.x} Hz`).toBeLessThan(1e-6);
        expect(next.index - from.index).toBe(key === 'ArrowRight' ? 1 : -1);
        visited.push({ x: next.x, value: next.value, line: next.line, index: next.index });
    }
    // Each value read is exactly the backend's own bin of the line read (every value of it, as the backend writes it
    // out), at the place read, never a drawn point's or another line's.
    expect(new Set(visited.map(item => item.line)).size, 'the keys step along the one line read').toBe(1);
    const answer = (await everyValue(page)).get(visited[0].line)!;
    for (const item of visited) {
        const index = answer.xs.findIndex(x => x === item.x);
        expect(index, `${item.x} Hz is a bin of the line read`).toBeGreaterThanOrEqual(0);
        expect(item.value, `${item.x} Hz reads the line's own bin there, exactly`).toBe(answer.values[index]);
    }
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

test('a range typed in the axis\'s popover is the confirmed range today\'s rule makes, taken by the figure service as given (R9)', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(120_000);
    const stop = await openComparison(page);
    const now = await seen(page);
    const frame = now.lanes[0].frame;
    const box = (await page.locator(FIGURE).boundingBox())!;
    // A double click on the axis across (under the plot) opens its range.
    await page.mouse.dblclick(box.x + frame.left + frame.width / 2, box.y + frame.top + frame.height + 8);
    const popover = page.locator('[id$="range-popover"]:visible');
    await expect(popover).toHaveCount(1);
    const fields = popover.locator('input[id$="-min"], input[id$="-max"]');
    await fields.nth(0).fill('123.456789');
    await fields.nth(1).fill('4000');
    await popover.locator('button[id$="-apply"]').click();
    await expect.poll(async () => { const after = await seen(page); return after.waiting ? null : after.lanes[0].range!.x; }, { timeout: 30_000 }).toEqual([123.457, 4000]);
    // The draw asked for exactly those ends: layer 2 does not round them again.
    const asked = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; command?: string; payload?: { view?: { x?: Array<number | null> } } }> }).__uiSmokePostedMessages
        .filter(message => message.type === 'figure-request' && message.command === 'figure-draw').at(-1)?.payload?.view?.x);
    expect(asked).toEqual([123.457, 4000]);
    // Opened again, the fields write the confirmed ends as they are.
    await page.mouse.dblclick(box.x + frame.left + frame.width / 2, box.y + frame.top + frame.height + 8);
    await expect(popover.locator('input[id$="-min"]')).toHaveValue('123.457');
    await expect(popover.locator('input[id$="-max"]')).toHaveValue('4000');
    await page.keyboard.press('Escape');
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

test('a level range typed wider than the automatic one is taken as typed: the value axis has no end of its own', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(120_000);
    const stop = await openComparison(page);
    const now = await seen(page);
    const frame = now.lanes[0].frame;
    const auto = now.lanes[0].range!.y;
    const box = (await page.locator(FIGURE).boundingBox())!;
    // A double click on the value axis (left of the plot) opens its range; 40 dB more at each end is typed.
    await page.mouse.dblclick(box.x + frame.left - 12, box.y + frame.top + frame.height / 2);
    const popover = page.locator('[id$="range-popover"]:visible');
    await expect(popover).toHaveCount(1);
    const wide = [Math.floor(auto[0]) - 40, Math.ceil(auto[1]) + 40];
    await popover.locator('input[id$="-min"]').fill(String(wide[0]));
    await popover.locator('input[id$="-max"]').fill(String(wide[1]));
    await popover.locator('button[id$="-apply"]').click();
    await expect.poll(async () => { const after = await seen(page); return after.waiting ? null : after.lanes[0].range!.y; }, { timeout: 30_000 }).toEqual(wide);
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

test('a double click on the overlay resets its zoom only: its first press acts on nothing, and the zoom is undone (R13)', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(120_000);
    const stop = await openComparison(page);
    const whole = (await seen(page)).lanes[0].range!;
    const frame = (await seen(page)).lanes[0].frame;
    const box = (await page.locator(FIGURE).boundingBox())!;
    // A box dragged over the middle: a zoom into it.
    await page.mouse.move(box.x + frame.left + frame.width * 0.3, box.y + frame.top + frame.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + frame.left + frame.width * 0.7, box.y + frame.top + frame.height * 0.7, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.lanes[0].range!.x[0] > whole.x[0]; }, { timeout: 30_000 }).toBe(true);
    const legend = await page.locator('[data-stage-legend]').innerHTML();
    const postedBefore = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string }> }).__uiSmokePostedMessages.filter(message => message.type !== 'figure-request').length);
    await page.mouse.dblclick(box.x + frame.left + frame.width / 2, box.y + frame.top + frame.height / 2);
    await expect.poll(async () => { const now = await seen(page); return now.waiting ? null : now.lanes[0].range; }, { timeout: 30_000 }).toEqual(whole);
    // Nothing else was done: no edit, no request but the Figure's own, the legend as it was.
    const postedAfter = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string }> }).__uiSmokePostedMessages.filter(message => message.type !== 'figure-request').length);
    expect(postedAfter).toBe(postedBefore);
    expect(await page.locator('[data-stage-legend]').innerHTML()).toBe(legend);
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

/** The rows of a CSV the Analyzer writes (csvFile: a BOM, CRLF, a field quoted when it holds a comma, a quote or a break). */
function csvRows(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], field = '', quoted = false;
    const body = text.replace(/^﻿/u, '');
    for (let at = 0; at < body.length; at++) {
        const char = body[at];
        if (quoted) {
            if (char === '"' && body[at + 1] === '"') { field += '"'; at++; } else if (char === '"') quoted = false; else field += char;
        } else if (char === '"') quoted = true;
        else if (char === ',') { row.push(field); field = ''; } else if (char === '\r') continue;
        else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else field += char;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}
type Download = { download: string; href: string };
const downloads = (page: Page): Promise<Download[]> => page.evaluate(() => (window as unknown as { __uiSmokeDownloads: Download[] }).__uiSmokeDownloads);
/**
 * The spectrum overlay's PNG or CSV, asked through the tests' own action (comparison-panel-test-action `export-figure`):
 * no menu offers it while the comparison screen's features are frozen.
 */
async function exportFrom(page: Page, action: 'stage-export-png' | 'stage-export-csv'): Promise<void> {
    await page.evaluate(kind => window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: `export-${kind}-${Date.now()}`, actions: [{ action: 'export-figure', payload: { kind } }] } })), action === 'stage-export-csv' ? 'csv' : 'png');
}

test('the 書き出し menu offers no PNG or CSV of the spectrum overlay: the comparison screen\'s features are frozen', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    const stop = await openComparison(page);
    await page.locator('#tb-export-menu > summary').click();
    const offered = await page.locator('#tb-export-menu .tb-btn:visible').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-action')));
    expect(offered).toContain('stage-report');
    expect(offered.filter(action => /^stage-export|figure/u.test(action ?? '')), 'no PNG or CSV of this figure in the menu').toEqual([]);
    expect(await page.locator('[data-action^="stage-export"], [data-action="export-figure"]').count(), 'nor anywhere on the page').toBe(0);
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

test('the spectrum overlay\'s CSV is every bin of every line exactly as the backend holds it, and its CSV and PNG are of the data id the screen drew', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(180_000);
    const stop = await openComparison(page);
    await page.locator('[data-action="stage-diff"]').click();
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.lanes.map(lane => lane.id).join(); }, { timeout: 30_000 }).toBe('overlay,delta');
    const shown = await page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { dataId: string } }).__figureInspect().dataId);
    expect(shown).toMatch(/^[0-9a-f]{32}$/u);
    // The CSV: named by the picture's data id.
    await exportFrom(page, 'stage-export-csv');
    await expect.poll(async () => (await downloads(page)).map(item => item.download)).toContain(`spectrum-overlay_${shown}.csv`);
    const csv = (await downloads(page)).find(item => item.download === `spectrum-overlay_${shown}.csv`)!;
    const rows = csvRows(decodeURIComponent(csv.href.replace(/^data:text\/csv;charset=utf-8,/u, '')));
    const [header, ...body] = rows;
    // Three lines (the base, compare 1, the Δ), each its frequencies and its answers.
    expect(header.length).toBe(6);
    expect(header[0]).toMatch(/Frequency \[Hz\]$/u);
    expect(header[5]).toMatch(/Difference Δ \[dB\]$/u);
    // Every bin of each recording's answer (0 Hz to Nyquist), exactly as the backend itself writes it out.
    const every = await everyValue(page);
    const base = every.get('base')!, compare = every.get('compare1')!;
    const column = (at: number): Array<[number, number | null]> => body.filter(row => row[at] !== '').map(row => [Number(row[at]), row[at + 1] === '' ? null : Number(row[at + 1])]);
    const inRange = (points: EveryValue): Array<[number, number | null]> => points.xs.map((x, at) => [x, points.values[at]] as [number, number | null]);
    expect(column(0), 'the base: every bin, its exact value').toEqual(inRange(base));
    expect(column(2), 'compare 1: every bin, its exact value').toEqual(inRange(compare));
    expect(column(2).length, 'not thinned: more bins than the plot has pixels').toBeGreaterThan(2000);
    const delta = inRange(compare).map(([x, value], at) => [x, value === null || inRange(base)[at][1] === null ? null : value - inRange(base)[at][1]!] as [number, number | null]);
    expect(column(4), 'the Δ: compare 1 − the base at every bin').toEqual(delta);
    // The PNG: the same data id, drawn by its own Figure at the export's size, then let go.
    await exportFrom(page, 'stage-export-png');
    await expect.poll(async () => (await downloads(page)).map(item => item.download)).toContain(`spectrum-overlay_${shown}.png`);
    const png = (await downloads(page)).find(item => item.download === `spectrum-overlay_${shown}.png`)!;
    expect(png.href).toMatch(/^data:image\/png;base64,/u);
    const size = await page.evaluate(href => new Promise<[number, number]>(resolve => { const image = new Image(); image.onload = () => resolve([image.naturalWidth, image.naturalHeight]); image.src = href; }), png.href);
    // (700 px of figure under the 18 px strip that names its lines.)
    expect(size[0] / size[1]).toBeCloseTo(1200 / (700 + 18), 2);
    const released = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; command?: string; payload?: { figureId?: string } }> }).__uiSmokePostedMessages
        .filter(message => message.type === 'figure-request').map(message => [message.command, message.payload?.figureId]));
    const pngFigure = released.filter(([command]) => command === 'figure-draw').at(-1)![1];
    expect(released.some(([command, figure]) => command === 'figure-release' && figure === pngFigure), 'the PNG\'s Figure let go once drawn').toBe(true);
    expect(await stop(), 'the backend answered every request').toEqual([]);
});

test('「One lane per track」 shows the same lines a lane a recording on the one Figure: the tracks\' rows are not drawn on, the lanes share one range, a point is read on its own lane, and its CSV and PNG are of the picture drawn', async ({ page }) => {
    test.skip(!ready(), `no Python backend with wandas for the narrow fixture: ${fixtureError}`);
    test.setTimeout(180_000);
    const stop = await openComparison(page);
    const overlaid = await seen(page);
    const stage = page.locator('.track-stage');
    await page.locator('[data-action="stage-layout"]').click();
    await expect(stage).toHaveAttribute('data-layout', 'lanes');
    // The same Figure, a lane a recording (the base's, then the compared one), each its own line; no Δ lane.
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.lanes.map(lane => lane.id).join(); }, { timeout: 30_000 }).toBe('own-base1,own-compare1');
    await expect(stage).toHaveAttribute('data-figure', 'true');
    await expect(page.locator('[data-stage-canvas="overlay"]')).toBeHidden();
    // The tracks' own rows are out of the way: nothing of the comparison is drawn on them.
    await expect(page.locator('#stacked-wrap')).toBeHidden();
    const now = await seen(page);
    expect(now.lanes.map(lane => lane.lines.map(line => line.id))).toEqual([['base1'], ['compare1']]);
    expect(now.lanes.map(lane => lane.lines[0].colour)).toEqual(['#3b82f6', '#d4b20f']);
    // Looked at together: the same part across and one range up (the overlay's own, of the same two answers), the axes named as the overlay's.
    expect(now.lanes[1].range).toEqual(now.lanes[0].range);
    expect(now.lanes[0].range).toEqual(overlaid.lanes[0].range);
    for (const lane of now.lanes) expect(lane.axisNames).toEqual(overlaid.lanes[0].axisNames);
    // Each lane has a height to be read at, one under the other.
    for (const lane of now.lanes) expect(lane.frame.height).toBeGreaterThan(80);
    expect(now.lanes[1].frame.top).toBeGreaterThanOrEqual(now.lanes[0].frame.top + now.lanes[0].frame.height);
    await expect(page.locator('.track-stage-bar')).toHaveAttribute('data-drawn', '2');
    // R7: the pointer on the compared recording's lane reads its own line, by the recording's name.
    const read = await hover(page, await highest(page, 'own-compare1'));
    expect(read.mark!.lane).toBe('own-compare1');
    expect(read.mark!.line).toBe('compare1');
    expect(read.readout).toMatch(/^compare\.wav \/ .+ k?Hz \/ .+ dBFS$/u);
    // The CSV and the PNG are of this picture (its data id): each recording's every bin, no Δ column.
    const shown = await page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { dataId: string } }).__figureInspect().dataId);
    await exportFrom(page, 'stage-export-csv');
    await expect.poll(async () => (await downloads(page)).map(item => item.download)).toContain(`spectrum-overlay_${shown}.csv`);
    const csv = (await downloads(page)).find(item => item.download === `spectrum-overlay_${shown}.csv`)!;
    const [header, ...body] = csvRows(decodeURIComponent(csv.href.replace(/^data:text\/csv;charset=utf-8,/u, '')));
    expect(header.length).toBe(4);
    expect(body.filter(row => row[2] !== '').length, 'not thinned: more bins than the plot has pixels').toBeGreaterThan(2000);
    await exportFrom(page, 'stage-export-png');
    await expect.poll(async () => (await downloads(page)).map(item => item.download)).toContain(`spectrum-overlay_${shown}.png`);
    if (process.env.AWA_SHOT_DIR) await stage.screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'lines-a-lane-a-recording.png') });
    // Overlaid again: the one lane, with the base and the compared recording on it.
    await page.locator('[data-action="stage-layout"]').click();
    await expect.poll(async () => { const back = await seen(page); return !back.waiting && back.lanes.map(lane => lane.id).join(); }, { timeout: 30_000 }).toBe('overlay');
    await expect(stage).toHaveAttribute('data-layout', 'overlay');
    expect(await stop(), 'the backend answered every request').toEqual([]);
});
