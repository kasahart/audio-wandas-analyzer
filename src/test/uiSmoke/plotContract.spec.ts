import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, settled, test, type Locator, type Page } from './canvasAudit';
import { buildExtensionHostPathUiSmokeHtml, buildUiSmokeCalibrationHtml, buildUiSmokeHtml } from './buildHtml';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';
import { INPUT_FRAME, isCharted, outputOf, WANDAS_OPERATIONS } from '../../shared/recipe/recipeCatalog';
import { reachableFrameKinds } from '../helpers/frameKinds';
import { DIFF_COLOR, FLAG_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';
import { drawnFigure, drawnRow, PAIR_FIGURE, rowFigure, ROW_SPECTROGRAM, ROW_WAVE } from './tracksFigures';

const STR_EN = getStrings('en');

/**
 * R13: every plot is one Figure (src/webview/figure/), so every plot answers the same gestures the same way. These
 * tests open the screens with plots and give each lane of each Figure the same checks (expectFigureContract): the
 * readout above it under the pointer, ← / → stepping that readout one point at a time, Ctrl+wheel zoom and
 * double-click reset, + / − / 0 over it, Ctrl+wheel over its axis zooming about the middle, a box zoom, a drag whose
 * release is lost, each axis's range typed and Auto, both axes named, each tick where its axis paints its value.
 */
let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });
// Each test opens its own page and reads only `scanned`, which every worker loads for itself: the file's tests run
// in parallel across workers (it is the longest file; one worker held it ~6.6 min).
test.describe.configure({ mode: 'parallel' });

type Posted = { type: string; requestId: string; filePaths: string[]; stage?: string; recipe?: { nodes: Array<{ id: string; operation: string }> } };
const stageScans = async (page: Page): Promise<Posted[]> => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages))
    .filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage'));
const spectrum = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };

async function answer(page: Page, files: ScannedFile[], view: Record<string, unknown> = spectrum): Promise<void> {
    const request = (await stageScans(page)).at(-1)!;
    // Each recording's values, which the stand-in keeps as the backend keeps a step's (buildHtml.ts): the page is told their description.
    const stages = request.filePaths.map(() => view);
    await page.evaluate(({ request, stages, files }) => {
        request.filePaths.forEach((filePath, index) => {
            const file = files.find(item => item.filePath === filePath)!;
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: stages[index] } }, '*');
        });
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, stages, files });
}

/** Slots two recordings as base and compare 1 and opens the comparison on the chain's end, its plots drawn. */
async function openComparison(page: Page, files: ScannedFile[]): Promise<void> {
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, files, { language: 'en', recipe });
    const drawn = await page.locator('[data-entry-rows] tr.entry-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-file-path')!));
    const rpm = (filePath: string): string => /_(\d+rpm)_/.exec(filePath)?.[1] ?? '';
    const other = drawn.findIndex(filePath => rpm(filePath) !== rpm(drawn[0]));
    const paths = [drawn[0], drawn[other]];
    await page.keyboard.press('0');
    for (let step = 0; step < other; step++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    const results = paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1) ?? '', audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    }));
    await page.evaluate(results => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results } })), results);
    await expect(page.locator('.track-stage')).toBeVisible();
    await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(0);
    const bar = page.locator('.track-stage-bar');
    if (await bar.locator('.step-chip.is-current[data-step-input]').count()) {
        await answer(page, files);
        await bar.locator('[data-step-hold="node-2"]').click();
        await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-2');
    }
    await answer(page, files);
}

// ── The spectrum overlay and its Δ lane on the new path: one Figure (src/webview/figure/, figure-design.md 第 4 節) ──

const FIGURE = '[data-stage-figure] canvas[data-figure]';
type Part = { start: number; end: number };
type FigureSeen = {
    waiting: boolean; readout: string; box: unknown;
    lanes: Array<{ id: string; frame: { left: number; top: number; width: number; height: number }; range: { x: [number, number]; y: [number, number] } | null; part: { x: Part; y: Part } | null; axisNames: { x: string; y: string }; xLog: boolean; yLog: boolean; image?: { rows: number; columns: number };
        xTicks: Array<{ value: number; text: string; px: number }>; yTicks: Array<{ value: number; text: string; px: number }>; lines: Array<{ id: string; colour: string; points: Array<[number, number] | null> }> }>;
    mark: { lane: string; line: string; index: number; x: number; px: number; py: number } | null;
};
/** What the overlay's Figure drew and reads now (its inspection on its canvas). */
const figureSeen = (page: Page, canvas = FIGURE): Promise<FigureSeen> => page.locator(canvas).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => FigureSeen }).__figureInspect());
/** Polled until the Figure has drawn the picture of what was last asked (no picture on its way). */
async function figureDrawn(page: Page, lane = 'overlay', canvas = FIGURE): Promise<FigureSeen> {
    await expect.poll(async () => { const now = await figureSeen(page, canvas); return !now.waiting && now.lanes.some(item => item.id === lane && item.range); }, { timeout: 30_000 }).toBe(true);
    await settled(page);
    return figureSeen(page, canvas);
}
const partOf = async (page: Page, lane: string, canvas = FIGURE): Promise<{ x: Part; y: Part }> => (await figureDrawn(page, lane, canvas)).lanes.find(item => item.id === lane)!.part!;
/** The Figure of the recordings under a trigger's events (a lane a recording), its readout and the row it is in. */
type FigureOn = { canvas: string; readout: string; row: string; /** The element that holds the axis across, where it is not under the Figure's last lane. */ acrossAxis?: string; /** How far left of a lane its axis up is pressed (30 px by default). */ upAxisLeft?: number };
const LANES_FIGURE: FigureOn = { canvas: '[data-stage-lanes-figure] canvas[data-figure]', readout: '[data-stage-lanes-figure-head] [data-plot-readout]', row: '[data-stage-lanes-figure-head]' };
const OVERLAY_FIGURE: FigureOn = { canvas: FIGURE, readout: '.track-stage-controls [data-plot-readout]', row: '.track-stage-controls' };
/** A Tracks row's Figure: its readout is the toolbar's, its axis across the screen's time ruler above the rows (no ticks of its own). */
const ROW_FIGURE: FigureOn = { canvas: rowFigure(0), readout: '#plot-readout', row: '#toolbar', acrossAxis: '#ruler-canvas', upAxisLeft: 12 };
const narrower = (part: Part): boolean => part.end - part.start < 0.999;

/**
 * The plot contract (R13) on lane `lane` of a Figure: the
 * readout above it, ← / → step one point and back, Ctrl+wheel zoom about the pointer and over the axis, + / − / 0, a
 * box zoom and a double click that resets it, a drag whose release is lost doing nothing, the axis's range typed and
 * Auto, both axes named with their quantity and unit, and each tick written at the place its axis paints its value.
 * A spectrum's lane is read in Hz and dB on a log axis; any other line's (a cepstrum's, a metric's over time) at its
 * place in seconds with its value, on a linear axis; an image's lane (a recording's spectrogram, roughness or
 * cepstrogram) at its cell's time and row with its value, its rows on a log axis when they are frequencies.
 */
async function expectFigureContract(page: Page, lane: string, on: FigureOn = OVERLAY_FIGURE): Promise<void> {
    test.info().setTimeout(test.info().timeout + 30_000);
    const seen = await figureDrawn(page, lane, on.canvas);
    const frame = seen.lanes.find(item => item.id === lane)!.frame;
    const log = seen.lanes.find(item => item.id === lane)!.xLog;
    const inDb = /\[dB[^\]]*\]$/u.test(seen.lanes.find(item => item.id === lane)!.axisNames.y);
    const image = !!seen.lanes.find(item => item.id === lane)!.image;
    const box = (await page.locator(on.canvas).boundingBox())!;
    const at = (across: number, down: number): { x: number; y: number } => ({ x: box.x + frame.left + frame.width * across, y: box.y + frame.top + frame.height * down });
    const whole = async (): Promise<void> => { await page.mouse.move(at(0.5, 0.5).x, at(0.5, 0.5).y); await page.keyboard.press('0'); await expect.poll(async () => narrower((await partOf(page, lane, on.canvas)).x)).toBe(false); };
    // Readout: the point read, in the row above the plots, its mark at it. The pointer on a point drawn near the middle
    // across (a line of a few points has none under most places).
    const points = seen.lanes.find(item => item.id === lane)!.lines.flatMap(line => line.points).filter((point): point is [number, number] => !!point && point[0] > frame.left && point[0] < frame.left + frame.width && point[1] > frame.top && point[1] < frame.top + frame.height);
    if (!image) expect(points.length, 'the lane drew points inside its frame').toBeGreaterThan(0);
    // An image has a cell under every place of its frame.
    const near = image ? [frame.left + frame.width * 0.45, frame.top + frame.height * 0.4] as [number, number] : points.reduce((best, point) => (Math.abs(point[0] - (frame.left + frame.width * 0.45)) < Math.abs(best[0] - (frame.left + frame.width * 0.45)) ? point : best));
    const middle = { x: box.x + near[0], y: box.y + near[1] };
    await page.mouse.move(middle.x, middle.y);
    await expect.poll(async () => (await figureSeen(page, on.canvas)).mark?.lane, { timeout: 15_000 }).toBe(lane);
    const readout = page.locator(on.readout);
    if (image) await expect(readout).toHaveText(/ \/ [−-]?[\d.]+ m?s \/ [\d.]+ \S+ \/ [+−-]?\d/u);
    else await expect(readout).toHaveText(new RegExp(` / ${log ? '[\\d.]+ k?Hz' : '[−-]?[\\d.]+ m?s'} / ${inDb ? '[+−-]?\\d+\\.\\d dB' : '[+−-]?\\d[\\d.]*(e[+−-]?\\d+)?( \\S+)?$'}`, 'u'));
    const row = (await page.locator(on.row).boundingBox())!;
    expect(row.y + row.height, 'the readout row is above the plot').toBeLessThanOrEqual(box.y + frame.top + 1);
    // Step: → reads the next point of the line read, ← back. With the focus nowhere: a Tracks row that a press gave the
    // focus keeps ← → for the time cursor (R7's one exception, figure.ts `pressFocuses`), and this contract presses rows.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    const first = (await figureSeen(page, on.canvas)).mark!;
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await figureSeen(page, on.canvas)).mark?.index).toBe(first.index + 1);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await figureSeen(page, on.canvas)).mark?.index).toBe(first.index);
    // Ctrl+wheel about the pointer, then a double click resets.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await expect.poll(async () => narrower((await partOf(page, lane, on.canvas)).x)).toBe(true);
    await page.mouse.dblclick(middle.x, middle.y);
    await expect.poll(async () => narrower((await partOf(page, lane, on.canvas)).x)).toBe(false);
    // + / − / 0 over the plot.
    await page.mouse.move(middle.x, middle.y);
    await page.keyboard.press('+');
    await expect.poll(async () => narrower((await partOf(page, lane, on.canvas)).x)).toBe(true);
    await page.keyboard.press('-');
    await expect.poll(async () => narrower((await partOf(page, lane, on.canvas)).x)).toBe(false);
    await page.keyboard.press('+');
    await page.keyboard.press('0');
    await expect.poll(async () => narrower((await partOf(page, lane, on.canvas)).x)).toBe(false);
    // Ctrl+wheel over the axis across (under the last lane): about its middle.
    const last = (await figureSeen(page, on.canvas)).lanes.at(-1)!.frame;
    const acrossBox = on.acrossAxis ? (await page.locator(on.acrossAxis).boundingBox())! : null;
    /** A place on the axis across, `fraction` of the way along the plots. */
    const onAcross = (fraction: number): { x: number; y: number } => ({ x: box.x + last.left + last.width * fraction, y: acrossBox ? acrossBox.y + acrossBox.height / 2 : box.y + last.top + last.height + 8 });
    /** A place on the lane's axis up, in its middle. */
    const onUp = { x: box.x + frame.left - (on.upAxisLeft ?? 30), y: box.y + frame.top + frame.height / 2 };
    await page.mouse.move(onAcross(0.2).x, onAcross(0.2).y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await expect.poll(async () => { const part = (await partOf(page, lane, on.canvas)).x; return narrower(part) && Math.abs((part.start + part.end) / 2 - 0.5) < 0.01; }).toBe(true);
    await whole();
    // A box zoom: both axes of the lane.
    await page.mouse.move(at(0.3, 0.3).x, at(0.3, 0.3).y);
    await page.mouse.down();
    await page.mouse.move(at(0.6, 0.7).x, at(0.6, 0.7).y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => { const part = await partOf(page, lane, on.canvas); return narrower(part.x) && narrower(part.y); }).toBe(true);
    await page.mouse.dblclick(middle.x, middle.y);
    await expect.poll(async () => { const part = await partOf(page, lane, on.canvas); return narrower(part.x) || narrower(part.y); }).toBe(false);
    // A drag whose release never reaches the page (let go outside it): a move with no button ends it, nothing done.
    await page.mouse.move(at(0.3, 0.3).x, at(0.3, 0.3).y);
    await page.mouse.down();
    await page.mouse.move(at(0.5, 0.6).x, at(0.5, 0.6).y, { steps: 3 });
    await page.evaluate(({ x, y }) => document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 0, bubbles: true })), at(0.6, 0.7));
    expect((await figureSeen(page, on.canvas)).box, 'the box goes with the press').toBeNull();
    await page.mouse.up();
    await settled(page);
    expect(narrower((await partOf(page, lane, on.canvas)).x), 'a lost release zooms nothing').toBe(false);
    // The axis across's range, typed, then Auto.
    await page.mouse.dblclick(onAcross(0.5).x, onAcross(0.5).y);
    const popover = page.locator('[id$="range-popover"]:visible');
    await expect(popover).toHaveCount(1);
    const min = popover.locator('input[id$="-range-min"]'), max = popover.locator('input[id$="-range-max"]');
    const low = Number(await min.inputValue()), high = Number(await max.inputValue());
    await min.fill(String(log ? low * (high / low) ** 0.25 : low + (high - low) * 0.25));
    await max.fill(String(log ? low * (high / low) ** 0.75 : low + (high - low) * 0.75));
    await popover.locator('button[id$="-range-apply"]').click();
    await expect.poll(async () => narrower((await partOf(page, lane, on.canvas)).x)).toBe(true);
    await page.mouse.dblclick(onAcross(0.5).x, onAcross(0.5).y);
    await popover.locator('button[id$="-range-auto"]').click();
    await expect.poll(async () => narrower((await partOf(page, lane, on.canvas)).x)).toBe(false);
    // Both axes named by their quantity and unit (R4), and each tick at the place its axis paints its value (R9, R14),
    // in three states: the whole axes, the level axis typed narrower, and a box on both.
    const ticksAtTheirPlaces = async (state: string): Promise<void> => {
        const drawn = (await figureDrawn(page, lane, on.canvas)).lanes.find(item => item.id === lane)!;
        expect(drawn.axisNames.x).toMatch(/\[[^\]]+\]$/u);
        expect(drawn.axisNames.y).toMatch(/\[[^\]]+\]$/u);
        const [bottom, top] = drawn.range!.y;
        expect(drawn.yTicks.length, `${state}: ticks up`).toBeGreaterThan(1);
        for (const tick of drawn.yTicks) expect(Math.abs(tick.px - (drawn.frame.top + (1 - (drawn.yLog ? Math.log(tick.value / bottom) / Math.log(top / bottom) : (tick.value - bottom) / (top - bottom))) * drawn.frame.height)), `${state}: tick ${tick.text}`).toBeLessThan(0.5);
        const [left, right] = drawn.range!.x;
        for (const tick of drawn.xTicks) expect(Math.abs(tick.px - (drawn.frame.left + (log ? Math.log(tick.value / left) / Math.log(right / left) : (tick.value - left) / (right - left)) * drawn.frame.width)), `${state}: tick ${tick.text}`).toBeLessThan(0.5);
        // Every axis name inside its canvas (R4: the canvas audit fits the Figure's names too).
        expect(await page.evaluate(() => (window as unknown as { __titleAudit?: string[] }).__titleAudit ?? []), `${state}: axis names inside the canvas`).toEqual([]);
    };
    await ticksAtTheirPlaces('whole');
    // The level axis's range, typed (a double click left of the lane), then Auto: its own lane's axis only.
    await page.mouse.dblclick(onUp.x, onUp.y);
    await expect(popover).toHaveCount(1);
    const yLow = Number(await min.inputValue()), yHigh = Number(await max.inputValue());
    await min.fill(String(yLow + (yHigh - yLow) / 4));
    await max.fill(String(yHigh - (yHigh - yLow) / 4));
    await popover.locator('button[id$="-range-apply"]').click();
    await expect.poll(async () => { const part = await partOf(page, lane, on.canvas); return narrower(part.y) && !narrower(part.x); }).toBe(true);
    await ticksAtTheirPlaces('the level axis typed narrower');
    await page.mouse.move(at(0.3, 0.3).x, at(0.3, 0.3).y);
    await page.mouse.down();
    await page.mouse.move(at(0.6, 0.7).x, at(0.6, 0.7).y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => narrower((await partOf(page, lane, on.canvas)).x)).toBe(true);
    await ticksAtTheirPlaces('a box on both axes');
    await page.mouse.dblclick(onUp.x, onUp.y);
    await popover.locator('button[id$="-range-auto"]').click();
    await page.mouse.dblclick(middle.x, middle.y);
    await expect.poll(async () => { const part = await partOf(page, lane, on.canvas); return narrower(part.x) || narrower(part.y); }).toBe(false);
    await page.mouse.move(1, 1);
}

test('every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openComparison(page, scanned!);
    // The spectrum overlay and its Δ: the new path's Figure, held to the same contract.
    await expectFigureContract(page, 'overlay');
    // Δ under it, then one lane per track.
    await page.locator('[data-action="stage-diff"]').click();
    await figureDrawn(page, 'delta');
    await expectFigureContract(page, 'delta');
    await page.locator('[data-action="stage-diff"]').click();
    await page.locator('[data-action="stage-layout"]').click();
    await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'lanes');
    // A lane a recording of the same Figure, held to the same contract.
    type Lanes = { waiting: boolean; lanes: Array<{ id: string }> };
    const lanes = (): Promise<Lanes> => page.locator(OVERLAY_FIGURE.canvas).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Lanes }).__figureInspect());
    await expect.poll(async () => { const now = await lanes(); return !now.waiting && !!now.lanes[0]?.id.startsWith('own-'); }, { timeout: 15_000 }).toBe(true);
    await expectFigureContract(page, (await lanes()).lanes[0].id);
});

test('a trigger\'s events plot and the lanes under it answer the same gestures as every plot (R13)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openComparison(page, scanned!);
    const bar = page.locator('.track-stage-bar');
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-delete"]').click();
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('[data-step-menu-filter]').fill('trigger');
    await bar.locator('.step-menu-item[data-op="wandas.audio.trigger"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.recipe?.nodes.at(-1)?.operation.split('.').pop()).toBe('trigger');
    const event = (id: number, peak: number): Record<string, unknown> => ({ id, time: 0.3 + id * 0.5, xs: [-0.01, 0, 0.05, 0.19], values: [0, peak, -peak / 2, 0] });
    await answer(page, scanned!, { frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [-0.01, 0, 0.05, 0.19], events: [event(0, 0.5), event(1, 0.4)] });
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-1');
    await answer(page, scanned!, { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [0, 0.75, 1.5], values: [-0.5, 0.5, -0.5],
        waveform: { min: [-0.5, -0.4, -0.3], max: [0.5, 0.4, 0.3], minT: [0.2, 0.7, 1.1], maxT: [0.3, 0.8, 1.2], absolutePeak: 0.5, unit: 'FS', ref: 1 } });
    await expect.poll(async () => Number(await page.locator('.track-stage').getAttribute('data-lanes-marked'))).toBeGreaterThan(0);
    // The events are lines of the one Figure, held to the same contract.
    await expectFigureContract(page, 'overlay');
    // …and so are the recordings under them: lanes of a Figure of their own (the recording's time across).
    await expectFigureContract(page, 'track1', LANES_FIGURE);
    await expectFigureContract(page, 'track2', LANES_FIGURE);
});

/**
 * R7: each Frame kind a chain of steps from ＋ can give and the comparison draws (the operation catalogue's, as
 * frameKinds.ts walks it), reached the way a user reaches it (the chain's last step deleted, then each step added
 * from ＋), answered with a result of that kind, and every plot on screen given the same checks, overlaid, with its
 * Δ when it has one, and in lanes.
 *
 * What a scan is answered with: kindAnswers.json, a step's values of each kind as the stand-in keeps them (the page is
 * told their description only, buildHtml.ts). They are the stand-in's input, not expectations. Their words are those
 * of the description the backend makes of that kind (fixtures/stageViewKinds.json, which
 * python-backend/test_stage_view_kinds.py holds to the backend): the test below holds the two together.
 */
const KIND_VIEWS = JSON.parse(readFileSync(path.resolve(__dirname, 'kindAnswers.json'), 'utf8')) as Record<string, Record<string, unknown>>;
const KIND_WORDS = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'stageViewKinds.json'), 'utf8')) as Record<string, Record<string, unknown>>;

test('the stand-in\'s values of each Frame kind are described as the backend describes that kind', () => {
    expect(Object.keys(KIND_VIEWS).sort()).toEqual(Object.keys(KIND_WORDS).sort());
    for (const [kind, view] of Object.entries(KIND_VIEWS)) {
        for (const word of ['frame', 'kind', 'x', 'xScale', 'quantity', 'unit', 'yAxis', 'pair', 'measure', 'measureExponent']) {
            expect(view[word], `${kind}: ${word} in src/test/uiSmoke/kindAnswers.json is not the backend's (src/test/fixtures/stageViewKinds.json). Fix: write the backend's word there.`).toEqual(KIND_WORDS[kind][word]);
        }
        expect(!!view.waveform, `${kind}: whether it is the sound itself`).toBe(KIND_WORDS[kind].signal === true);
        expect(!!view.events, `${kind}: whether it has events`).toBe(!!KIND_WORDS[kind].events);
    }
});
const OPERATIONS = new Map(WANDAS_OPERATIONS.map(operation => [operation.id, operation]));

/** The Frame kind a scan's stage gives: the chain's steps up to and with that node, from the recording. */
function stageFrame(request: Posted): string {
    let frame = INPUT_FRAME;
    const nodes = request.recipe?.nodes ?? [];
    if (!nodes.some(node => node.id === request.stage)) return frame;
    for (const node of nodes) {
        const operation = OPERATIONS.get(node.operation);
        frame = (operation && outputOf(operation, frame)) ?? frame;
        if (node.id === request.stage) break;
    }
    return frame;
}

/** Answers every stage scan not answered yet with its kind's picture, until none comes for a while. */
async function answerKinds(page: Page, files: ScannedFile[], answered: Set<string>): Promise<void> {
    for (let quiet = 0; quiet < 3;) {
        const open = (await stageScans(page)).filter(request => !answered.has(request.requestId));
        if (!open.length) { quiet++; await settled(page); continue; }
        quiet = 0;
        for (const request of open) {
            answered.add(request.requestId);
            // The recordings differ a little, inside the quantity's range (a coherence stays within 0–1).
            const stages = request.filePaths.map(() => KIND_VIEWS[stageFrame(request)]);
            await page.evaluate(({ request, stages, files }) => {
                request.filePaths.forEach((filePath, index) => {
                    const file = files.find(item => item.filePath === filePath)!;
                    window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: stages[index] } }, '*');
                });
                window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
            }, { request, stages, files });
        }
    }
}

for (const [kind, chain] of reachableFrameKinds()) {
    if (!isCharted(kind)) continue;
    test(`a ${kind} reached from ＋ answers the same gestures as every plot, overlaid, as its Δ and in lanes (R7)`, async ({ page }) => {
        test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
        test.setTimeout(240_000);
        await page.setViewportSize({ width: 1280, height: 1000 });
        await openComparison(page, scanned!);
        const answered = new Set((await stageScans(page)).map(request => request.requestId));
        const bar = page.locator('.track-stage-bar');
        await bar.locator('.step-chip', { hasText: STR_EN.stepAverage }).locator('[data-action="step-delete"]').click();
        for (const id of chain) {
            await bar.locator('[data-action="step-add"]').click();
            await bar.locator('[data-step-menu-filter]').fill(id.split('.').pop()!);
            await bar.locator(`.step-menu-item[data-op="${id}"]`).click();
            await expect.poll(async () => (await stageScans(page)).at(-1)?.recipe?.nodes.at(-1)?.operation).toBe(id);
        }
        await answerKinds(page, scanned!, answered);
        expect((await stageScans(page)).map(stageFrame)).toContain(kind);
        // The kind is drawn by the Figure: lines overlaid in the lane 'overlay'; an image a lane a recording, the first the base's.
        await expect(page.locator('.track-stage')).toHaveAttribute('data-figure', 'true', { timeout: 30_000 });
        const firstLane = async (): Promise<string> => (await figureSeen(page)).lanes.find(item => item.id === 'overlay' || item.image)?.id ?? '';
        await expect.poll(firstLane, { timeout: 30_000 }).not.toBe('');
        await expectFigureContract(page, await firstLane());
        const diff = page.locator('[data-action="stage-diff"]');
        if (await diff.isVisible() && await diff.isEnabled()) {
            await diff.click();
            await answerKinds(page, scanned!, answered);
            await expectFigureContract(page, 'delta');
            await diff.click();
        }
        const layout = page.locator('[data-action="stage-layout"]');
        if (await layout.isVisible() && await layout.isEnabled()) {
            await layout.click();
            await answerKinds(page, scanned!, answered);
        }
    });
}

/** A box dragged over the middle of the plot, from 30 % to 70 % across and up: a zoom into it. */
async function boxZoom(page: Page, plot: Locator): Promise<void> {
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7, { steps: 4 });
    await page.mouse.up();
    await page.mouse.move(1, 1);
}

test('the Δ pane zooms its own level axis, sharing only the frequency axis with the overlay above it', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openComparison(page, scanned!);
    await page.locator('[data-action="stage-diff"]').click();
    const root = page.locator('.track-stage');
    // The Δ is the Figure's lane under the overlay's (one Figure, the axis across shared).
    const seen = await figureDrawn(page, 'delta');
    const box = (await page.locator(FIGURE).boundingBox())!;
    const laneBox = (lane: string): Locator => {
        const frame = seen.lanes.find(item => item.id === lane)!.frame;
        return { boundingBox: async () => ({ x: box.x + frame.left, y: box.y + frame.top, width: frame.width, height: frame.height }) } as unknown as Locator;
    };
    await boxZoom(page, laneBox('delta'));
    await expect(root).not.toHaveAttribute('data-diff-y-window', '0.000-1.000');
    await expect(root).not.toHaveAttribute('data-x-window', '0.000-1.000');
    // The overlay keeps its own level axis whole.
    await expect(root).toHaveAttribute('data-y-window', '0.000-1.000');
    // And a box on the overlay leaves the Δ's level axis where it was.
    await figureDrawn(page, 'delta');
    const diffY = await root.getAttribute('data-diff-y-window');
    await boxZoom(page, laneBox('overlay'));
    await expect(root).not.toHaveAttribute('data-y-window', '0.000-1.000');
    await expect(root).toHaveAttribute('data-diff-y-window', diffY!);
});

test('the comparison draws its difference in the difference\'s green and its recordings in their roles\' colours, neither in the other\'s nor the failure\'s orange (R5)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openComparison(page, scanned!);
    await page.locator('[data-action="stage-diff"]').click();
    // The lines each lane of the overlay's Figure drew, in the colour each was drawn in.
    const lines = async (lane: string): Promise<string[]> => [...new Set((await figureDrawn(page, lane)).lanes.find(item => item.id === lane)!.lines
        .filter(line => line.points.filter(Boolean).length > 2).map(line => line.colour.toLowerCase()))];
    await expect.poll(() => lines('delta')).toEqual([DIFF_COLOR]);
    const overlay = await lines('overlay');
    expect(overlay.sort()).toEqual([ROLE_COLORS[0], ROLE_COLORS[1]].sort());
    expect(overlay).not.toContain(FLAG_COLOR);
});

test('the lanes under a trigger zoom on their own (the recording\'s time, not the trigger\'s) and draw the signal at full resolution once zoomed', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openComparison(page, scanned!);
    const bar = page.locator('.track-stage-bar');
    await bar.locator('.step-chip', { hasText: getStrings('en').stepAverage }).locator('[data-action="step-delete"]').click();
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('[data-step-menu-filter]').fill('trigger');
    await bar.locator('.step-menu-item[data-op="wandas.audio.trigger"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.recipe?.nodes.at(-1)?.operation.split('.').pop()).toBe('trigger');
    const event = (id: number, peak: number): Record<string, unknown> => ({ id, time: 0.3 + id * 0.5, xs: [-0.01, 0, 0.05, 0.19], values: [0, peak, -peak / 2, 0] });
    await answer(page, scanned!, { frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [-0.01, 0, 0.05, 0.19], events: [event(0, 0.5), event(1, 0.4)] });
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-1');
    const signal = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [0, 0.75, 1.5], values: [-0.5, 0.5, -0.5],
        waveform: { min: [-0.5, -0.4, -0.3], max: [0.5, 0.4, 0.3], minT: [0.2, 0.7, 1.1], maxT: [0.3, 0.8, 1.2], absolutePeak: 0.5, unit: 'FS', ref: 1 } };
    // The second recording twice as long as the first: each lane's window is a part of its own time axis.
    const request = (await stageScans(page)).at(-1)!;
    await page.evaluate(({ request, signal, files }) => {
        request.filePaths.forEach((filePath, index) => {
            const file = files.find(item => item.filePath === filePath)!;
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: { ...signal, xs: signal.xs.map(x => x * (index + 1)) } } }, '*');
        });
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, signal, files: scanned! });
    const root = page.locator('.track-stage');
    await expect.poll(async () => Number(await root.getAttribute('data-lanes-marked'))).toBeGreaterThan(0);
    const asked = (await stageScans(page)).length;
    // The lanes are a Figure of their own: a box on the first is every lane's part, in the recordings' seconds.
    const lanesBox = (await page.locator(LANES_FIGURE.canvas).boundingBox())!;
    const first = (await figureDrawn(page, 'track1', LANES_FIGURE.canvas)).lanes[0];
    // One axis across for both: the longer recording's 3 s, the shorter drawn over its own 1.5 s of it.
    expect(first.range!.x).toEqual([0, 3]);
    const at = (across: number, down: number): { x: number; y: number } => ({ x: lanesBox.x + first.frame.left + first.frame.width * across, y: lanesBox.y + first.frame.top + first.frame.height * down });
    await page.mouse.move(at(0.4, 0.3).x, at(0.4, 0.3).y);
    await page.mouse.down();
    await page.mouse.move(at(0.75, 0.7).x, at(0.75, 0.7).y, { steps: 8 });
    await page.mouse.up();
    await expect(root).not.toHaveAttribute('data-lanes-window', '0.000-1.000 0.000-1.000');
    const zoomed = (await figureDrawn(page, 'track1', LANES_FIGURE.canvas)).lanes;
    expect(zoomed[0].range!.x[0]).toBeCloseTo(1.2, 1);
    expect(zoomed[0].range!.x[1]).toBeCloseTo(2.25, 1);
    // The same seconds, and the same range up, on every lane.
    expect(zoomed[1].range).toEqual(zoomed[0].range);
    // The events plot above (the Figure's lane) keeps its own window.
    const eventsZoomed = async (): Promise<boolean> => { const part = await partOf(page, 'overlay'); return narrower(part.x) || narrower(part.y); };
    expect(await eventsZoomed()).toBe(false);
    // The part on screen is the figure service's to draw from the kept signal (python-backend/test_figures_signal.py holds
    // it to full resolution): the page asks for no scan of it.
    expect(((await stageScans(page)).slice(asked) as Array<Posted & { detail?: unknown }>).filter(message => message.detail)).toEqual([]);
    // A box on the events plot leaves the lanes' zoom where it was.
    const lanes = await root.getAttribute('data-lanes-window');
    const figureBox = (await page.locator(FIGURE).boundingBox())!, frame = (await figureDrawn(page)).lanes[0].frame;
    await page.mouse.move(figureBox.x + frame.left + frame.width * 0.4, figureBox.y + frame.top + frame.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(figureBox.x + frame.left + frame.width * 0.7, figureBox.y + frame.top + frame.height * 0.7, { steps: 6 });
    await page.mouse.up();
    await expect.poll(eventsZoomed).toBe(true);
    await expect(root).toHaveAttribute('data-lanes-window', lanes!);
    // The keys zoom the plot under the pointer in its own window, and 0 resets every plot's.
    await page.keyboard.press('0');
    await expect(root).toHaveAttribute('data-lanes-window', '0.000-1.000 0.000-1.000');
    await expect.poll(eventsZoomed).toBe(false);
    await page.mouse.move(at(0.6, 0.5).x, at(0.6, 0.5).y);
    await page.keyboard.press('+');
    await expect.poll(async () => narrower((await partOf(page, 'track1', LANES_FIGURE.canvas)).x)).toBe(true);
    expect(await eventsZoomed()).toBe(false);
});

test('the track view\'s waveform and spectrogram lanes answer the same gestures as every plot: readout in the toolbar above them (R13)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // A row is one Figure, its waveform lane over its spectrogram lane: each lane is held to the Figure's contract.
    await drawnRow(page);
    await expectFigureContract(page, ROW_WAVE, ROW_FIGURE);
    await expectFigureContract(page, ROW_SPECTROGRAM, ROW_FIGURE);
});

test('every ui-smoke test fails on a picture copied onto an axis canvas by anything but its painter (R13)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // The time ruler: an axis canvas the screen paints itself (timeRuler.ts), marked as one while it is painted.
    const plot = page.locator('#ruler-canvas');
    await expect(plot).toHaveAttribute('data-plot-axis-canvas', '');
    // Another canvas's picture laid onto the drawn ruler by code of its own, not by its painter.
    await page.evaluate(() => {
        const other = document.createElement('canvas');
        other.width = 8; other.height = 8;
        (document.getElementById('ruler-canvas') as HTMLCanvasElement).getContext('2d')!.drawImage(other, 0, 0);
    });
    expect(await page.evaluate(() => window.__drawnAudit ?? [])).toContain('#ruler-canvas: drawImage');
    // The audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { window.__drawnAudit?.splice(0); });
});

test('every ui-smoke test fails on a canvas on screen that is not a Figure\'s, an axis canvas or a listed layer (R13)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        const own = document.createElement('canvas');
        own.className = 'chart-of-its-own';
        own.width = 120; own.height = 60;
        Object.assign(own.style, { position: 'fixed', left: '0', top: '0', width: '120px', height: '60px' });
        document.body.append(own);
    });
    await expect.poll(() => page.evaluate(() => window.__plotAudit ?? [])).toContain('canvas.chart-of-its-own');
    // Taken away, with the audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { document.querySelector('.chart-of-its-own')?.remove(); window.__plotAudit?.splice(0); });
});

test('every ui-smoke test fails on an axis name drawn outside the Figure\'s canvas, each line of a name on two lines too (R4)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // A Figure's canvas (data-figure) whose value axis's name runs off its left edge and whose unit's line runs off its top.
    await page.evaluate(() => {
        const plot = document.createElement('canvas');
        plot.className = 'name-outside';
        plot.setAttribute('data-figure', 'figure-test');
        plot.width = 120; plot.height = 60;
        Object.assign(plot.style, { position: 'fixed', left: '0', top: '0', width: '120px', height: '60px' });
        document.body.append(plot);
        const context = plot.getContext('2d')!;
        context.fillText('Inside [s]', 40, 50);
        context.fillText('Off the side [Pa]', -30, 30);
        context.save();
        context.translate(10, 30); context.rotate(-Math.PI / 2); context.textAlign = 'center';
        context.fillText('A quantity too long for sixty pixels', 0, 0);
        context.fillText('[dB SPL re 20 µPa]', 0, 11);
        context.restore();
    });
    const found = await page.evaluate(() => window.__titleAudit ?? []);
    expect(found.filter(text => text.startsWith('canvas[data-figure]')).map(text => /"([^"]+)"/u.exec(text)?.[1]).sort(), 'the audit (canvasAudit.ts) must report each name, and each line of a two-line name, whose ink leaves the bitmap, and no name inside it')
        .toEqual(['A quantity too long for sixty pixels', 'Off the side [Pa]', '[dB SPL re 20 µPa]']);
    // Taken away, with the audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { document.querySelector('.name-outside')?.remove(); window.__titleAudit?.splice(0); });
});

test('every ui-smoke test fails on two tick labels a Figure writes over each other, and on none that only stand close (R4)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        const plot = document.createElement('canvas');
        plot.className = 'ticks-over';
        plot.setAttribute('data-figure', 'figure-test');
        plot.width = 160; plot.height = 80;
        Object.assign(plot.style, { position: 'fixed', left: '0', top: '0', width: '160px', height: '80px' });
        document.body.append(plot);
        const context = plot.getContext('2d')!;
        context.clearRect(0, 0, 160, 80);
        context.font = '10px sans-serif';
        // A value axis's labels: −20 and −40 a line apart, −60 written 3 px under −40 (over it).
        context.textAlign = 'right'; context.textBaseline = 'middle';
        context.fillText('−20', 30, 12); context.fillText('−40', 30, 26); context.fillText('−60', 30, 29);
        // An axis across: 100 and 200 written into each other, 5k clear of them.
        context.textAlign = 'center'; context.textBaseline = 'top';
        context.fillText('100', 60, 66); context.fillText('200', 66, 66); context.fillText('5k', 130, 66);
    });
    const found = await page.evaluate(() => window.__tickAudit ?? []);
    expect(found.map(text => [...text.matchAll(/"([^"]+)"/gu)].map(match => match[1]).join(' / ')).sort(), 'the audit (canvasAudit.ts) must report each pair of tick labels whose ink overlaps, and no other')
        .toEqual(['100 / 200', '−40 / −60']);
    await page.evaluate(() => { document.querySelector('.ticks-over')?.remove(); window.__tickAudit?.splice(0); });
});

/**
 * docs/display-rules.md R4, "軸名はキャンバスの中に": on every screen, with the page narrow and short, every axis name the
 * plots draw stays inside its canvas. The audit (canvasAudit.ts __titleAudit) judges each name as it is drawn; these
 * tests put the plots at the sizes where a name is hardest to fit. A new screen with plots is added to NAME_SCREENS.
 */
const NAME_SIZES = [{ width: 1280, height: 900 }, { width: 520, height: 900 }, { width: 1280, height: 340 }, { width: 420, height: 320 }];
const NAME_SCREENS: ReadonlyArray<{ name: string; open: (page: Page) => Promise<void> }> = [
    { name: 'the track view (lanes, cursor spectrum)', open: async page => { await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' }); } },
    { name: 'the track view with two level references', open: async page => { await page.setContent(buildUiSmokeCalibrationHtml(), { waitUntil: 'domcontentloaded' }); } },
    { name: 'the pair view', open: async page => { await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' }); await page.locator('[data-action="set-pair-reference"]').first().click(); await drawnFigure(page, PAIR_FIGURE); } },
    { name: 'the comparison (overlay and Δ)', open: async page => { await openComparison(page, scanned!); await page.locator('[data-action="stage-diff"]').click(); await figureDrawn(page, 'delta'); } },
    { name: 'the comparison in lanes', open: async page => { await openComparison(page, scanned!); await page.locator('[data-action="stage-layout"]').click(); await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'lanes'); } },
];
for (const screen of NAME_SCREENS) {
    test(`every axis name stays inside its canvas on narrow and short plots too: ${screen.name} (R4)`, async ({ page }) => {
        test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
        await page.setViewportSize(NAME_SIZES[0]);
        await screen.open(page);
        await settled(page);
        const plots = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas[data-figure]')).filter(canvas => canvas.checkVisibility()).length);
        expect(plots, `${screen.name}: no plot with named axes is on screen, so this test checks nothing; open the screen as the other tests of this file do`).toBeGreaterThan(0);
        for (const size of NAME_SIZES) {
            await page.setViewportSize(size);
            await settled(page);
            expect.soft(await page.evaluate(() => window.__titleAudit ?? []), `${screen.name} at ${size.width}×${size.height}: an axis name was drawn outside its canvas (docs/display-rules.md R4). `
                + 'Fix it in the Figure, never per chart: src/webview/figure/ fits every name into the room it really has (fitAxisTitle, src/webview/figure/axisTitle.ts).').toEqual([]);
        }
        // Every resize edge of the screen at its smallest, then at its largest (a waveform lane at its smallest share
        // of a short track is the shortest plot there is), from the keyboard as a user sets them (Home / End on a
        // focused edge, separatorKeys.ts). The sidebar's edge is left alone: its End hands the page to the table.
        const edges = page.locator('[role="separator"][data-action]:visible');
        for (const key of ['Home', 'End'] as const) {
            const actions = new Set<string>();
            for (let index = 0; index < await edges.count(); index++) {
                const edge = edges.nth(index);
                const action = (await edge.getAttribute('data-action')) ?? '';
                if (actions.has(action)) continue;
                actions.add(action);
                await edge.focus();
                await page.keyboard.press(key);
                await settled(page);
            }
            await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
            for (const size of NAME_SIZES) {
                await page.setViewportSize(size);
                await settled(page);
                expect.soft(await page.evaluate(() => window.__titleAudit ?? []), `${screen.name} at ${size.width}×${size.height} with every resize edge at its ${key === 'Home' ? 'smallest' : 'largest'}: `
                    + 'an axis name was drawn outside its canvas (docs/display-rules.md R4). Fix it in the Figure (fitAxisTitle, src/webview/figure/axisTitle.ts), never per chart.').toEqual([]);
            }
        }
        // Reported above with the size it happened at; cleared so the end-of-test audit does not report it again.
        await page.evaluate(() => { window.__titleAudit?.splice(0); });
    });
}
