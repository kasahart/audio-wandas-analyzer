import { readFileSync } from 'node:fs';
import { stubStage } from './stubStage';
import path from 'node:path';
import { expect, settled, test, type Locator, type Page, type TickPlaces } from './canvasAudit';
import { appStateOf, buildExtensionHostPathUiSmokeHtml, buildUiSmokeCalibrationHtml, buildUiSmokeHtml, UI_SMOKE_HOST_GRID } from './buildHtml';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Metadata, entry100Results, openEntry, pickCsv, type ScannedFile } from './entryHelpers';
import { ROWS } from '../plotContracts/index';
import { INPUT_FRAME, isCharted, outputOf, WANDAS_OPERATIONS } from '../../shared/recipe/recipeCatalog';
import { reachableFrameKinds } from '../helpers/frameKinds';
import { DIFF_COLOR, FLAG_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';
import { binGrid, differenceFromMedian, firstKnown, isPoint, knownBars, knownBin, knownDistribution, knownDistributionScans, knownMembersInOrder, KNOWN_DISTRIBUTION, scannedDistribution, postedPictures, recordingLanes, servedBins, stepOf, type KnownData, type PointAt, type ReadOf, type Served } from './knownData';

const STR_EN = getStrings('en');

/**
 * R13: every plot is the one plot component, so every plot answers the same gestures the same way. This test opens
 * the screens with plots, collects each canvas the component drew (`data-plot`) and gives it the same checks:
 * the readout above it under the pointer, ← / → stepping that readout one point at a time, Ctrl+wheel zoom and
 * double-click reset, + / − / 0 over it zooming its horizontal axis about the middle and showing it whole, Ctrl+wheel
 * over its value axis zooming about the middle too, a box zoom, each axis's range, both axes named.
 * A plot that does not pass one yet is listed in KNOWN_GAPS with the deviation of the unified plot spec it waits
 * for; a gap that is fixed fails here until it is taken off, so the list only shrinks.
 */
type Check = 'readout' | 'step' | 'zoom' | 'reset' | 'zoom keys' | 'axis wheel' | 'box zoom' | 'lost release' | 'axis range' | 'x range' | 'axes' | 'names inside' | 'tick places';
const KNOWN_GAPS: Record<string, readonly Check[]> = {};

const FULL = '0.000 1.000 0.000 1.000';
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
    // Each recording's picture with the valueRange the backend sends with one (the first recording 6 dB up).
    const stages = request.filePaths.map((_, index) => stubStage(view, value => value + (index === 0 ? 6 : 0)));
    request.filePaths.forEach((filePath, index) => postedStages.push({ filePath, picture: stages[index] }));
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
    // Every plot the comparison draws reads the pictures the test posts (answer, answerKinds) or the recordings' lanes;
    // its median and Δ are of the groups slotted here (base the first, compare 1 the other), never of the first posted.
    knownData = firstKnown(postedPictures(postedStages, { base: [paths[0]], compare: paths[1] }), recordingLanes(results), scannedDistribution(files));
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

/**
 * The point a plot reads now (plotHoverLayer.ts's notePlotRead keeps it on the plot, `__plotRead`): where it is along
 * the horizontal axis (`at`), its row for an image, its index among its source's every point and its identity where it
 * has them (so a point beside it at the same x is told apart), and whether it is on the line the first read was on.
 * Waited for until there is one (its full data may be on its way) and, given `from`, until it is another than that
 * one, or until the page has finished answering and still reads `from` (which is then returned: the caller decides
 * what it means).
 */
type PointRead = PointAt & { sameLayer: boolean };
type NotedPlot = HTMLElement & { __plotRead?: { at?: number; row?: number; index?: number; identity?: string; image?: boolean; layer: { label?: string; color?: string; source?: string; event?: { id: number } } } | null; __stepLayer?: string };
const samePoint = (a: PointAt, b: PointAt): boolean => a.at === b.at && a.row === b.row && a.index === b.index && a.identity === b.identity;
async function pointRead(plot: Locator, from?: PointRead | null): Promise<PointRead | null> {
    const now = (): Promise<PointRead | null> => plot.evaluate((canvas, first) => {
        const noted = canvas as NotedPlot;
        const read = noted.__plotRead;
        if (!read || read.at === undefined) return null;
        // The line read, by what tells it apart (a plot drawn again under a step makes its layers anew).
        const layer = [read.layer.label, read.layer.color, read.layer.source, read.layer.event?.id].join('|');
        if (first) noted.__stepLayer = layer;
        return { at: read.at, row: read.row ?? null, index: read.index !== undefined && read.index >= 0 ? read.index : null, identity: read.identity ?? null, sameLayer: layer === noted.__stepLayer };
    }, !from);
    // The wait is for the page, never for a time: once it has answered (settled(): its frames, its timers, the host's
    // answers) and no read is waiting for its full data (data-plot-read "pending"), what the plot reads is its answer,
    // the same point too. The same point is the right answer where → cannot leave the line's last point or the next
    // point is off a zoomed window, and a wait by time alone for "another point" costs its whole bound each time there.
    for (let tries = 0, rested = 0; tries < 100; tries++) {
        await settled(plot.page());
        const point = await now();
        if (point && (!from || !samePoint(point, from))) return point;
        if (await plot.getAttribute('data-plot-read') === 'pending') {
            rested = 0;
            await plot.page().waitForTimeout(100);
        } else if (++rested >= 2) return point;
    }
    return now();
}

/** The quantity a count axis is named by (the distribution's dsDistCountAxis), in each language. */
const COUNT_QUANTITIES = (['en', 'ja'] as const).map(language => getStrings(language).dsDistCountAxis.split('[')[0].trim());

/**
 * The point → (or ←, `delta`) must read from `from` on `plot` (R7), taken from the raw data the test posted or built
 * the page with (`knownData`, knownData.ts), never from the plot's own full source (`layer.full`): an expectation
 * asked of the implementation agrees with it however wrong its data is. The step is the pick rule's
 * (pick_cases.json): from the point read, the next one in the data's order with a value to read, one at the same x
 * too; an image's next column on its row. The silent floor (−250 dB and below, drawn as a gap) is skipped only on a
 * line that has one, as the plot decided for the line read (data-plot-read-floorless, stagePanes.ts `floorless`).
 * `known` false where the test knows no data for the line read (NO_KNOWN_DATA says why); `expected` null past the end.
 */
type Expected = { known: true; expected: PointAt | null } | { known: false; why: string };
async function knownStep(plot: Locator, from: PointAt, delta: 1 | -1 = 1): Promise<Expected> {
    const read = await plot.evaluate(canvas => {
        const noted = (canvas as HTMLElement & { __plotRead?: { image?: boolean; layer: { label?: string; view: { frame?: string; kind?: string; xs?: number[] } } } | null }).__plotRead;
        const xs = noted?.layer.view.xs;
        const track = /^track-(?:spec-)?canvas-(\d+)(?:-(\d+))?$/u.exec(canvas.id);
        return {
            id: canvas.id, stage: canvas.getAttribute('data-stage-canvas'), attrs: Array.from(canvas.attributes).map(attribute => attribute.name), label: noted?.layer.label ?? null, frame: noted?.layer.view.frame ?? null,
            image: !!noted?.image, kind: noted?.layer.view.kind ?? null, filePath: canvas.closest('[data-file-path]')?.getAttribute('data-file-path') ?? null, ends: xs?.length ? [xs[0], xs[xs.length - 1]] as [number, number] : null,
            trackIndex: track ? Number(track[1]) : null, channelIndex: track?.[2] !== undefined ? Number(track[2]) : null,
        };
    });
    // What the page's stand-in served so far (each plot's every bin it answered last), for the plots known from it.
    served = Object.values(await plot.page().evaluate(() => (window as unknown as { __uiSmokeServed?: Record<string, Served> }).__uiSmokeServed ?? {}));
    const known = knownData?.(read) ?? null;
    if (!known) return { known: false, why: `no data of its own known for ${read.id || read.attrs.filter(name => name.startsWith('data-')).join(' ')} (${read.frame ?? 'no Frame'}, ${read.label ?? 'unnamed'}, ${JSON.stringify(read.ends)})` };
    const plain = await plot.getAttribute('data-plot-read-floorless') === 'true';
    const expected = stepOf(from, known, delta, plain);
    // A point read that the raw data does not have: the plot reads data the test never gave it. Its step fails, named.
    if (expected === 'unknown') {
        strayPlots.add(`${read.id || read.attrs.filter(name => name.startsWith('data-')).join(' ')} (${read.frame ?? 'no Frame'}, ${read.label ?? 'unnamed'}) reads x = ${from.at}${from.row !== null ? `, row ${from.row}` : ''}`);
        return { known: true, expected: null };
    }
    return { known: true, expected };
}

/** The checks a plot passes, each tried on its own; a failure is noted, not thrown, so every check is tried. */
/**
 * Plots whose vertical axes write no numbers, with why: 'tick places' holds the numbers each writes, and a plot listed
 * here that writes some fails (the list only shrinks).
 */
const NO_VERTICAL_TICKS: Record<string, string> = {
    'canvas.entry-dist-canvas[data-dist-canvas]': 'a distribution group\'s row: the groups are named beside their rows, its value axis is the shared one below (yAxisLabels false)',
};
/** What 'tick places' found wrong on the plot being checked, for expectContract to report with the plot's name. */
const tickPlacesFound: string[] = [];
/** The plot's vertical axes' tick labels held to where its axes paint their numbers (canvasAudit.ts tickPlaces). */
const tickPlacesOf = (plot: Locator): Promise<TickPlaces> => plot.evaluate(canvas => window.__tickPlaces?.(canvas as HTMLCanvasElement) ?? { declared: false, judged: 0, wrong: ['the ui-smoke audit is not installed'] });

async function contract(page: Page, plot: Locator): Promise<Set<Check>> {
    const passed = new Set<Check>();
    const plotKey = await plot.evaluate(plotName);
    // Each tick label of its vertical axes where its axis paints its number (R9, R14), seen at several vertical zooms:
    // whole now, box-zoomed and typed to a narrow window below, the states pushed here as they are seen.
    const tickStates: Array<{ at: string; places: TickPlaces }> = [];
    const seeTicks = async (at: string): Promise<void> => { await settled(page); tickStates.push({ at, places: await tickPlacesOf(plot) }); };
    await seeTicks('shown whole');
    const box = (await plot.boundingBox())!;
    const middle = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.45 };
    // Both axes are named, on screen: each name the plot gives (data-plot-axes) names its quantity and its unit and is
    // written with both, whole or, where it does not fit (axisTitle.ts fitAxisTitle), on two lines or with the
    // quantity shortened to its symbol or first characters, never the unit alone: on the plot, or on a canvas the plot
    // component bound to it as drawing its axes (data-plot-named-by: the canvas beside it that holds its value axis,
    // the lanes' time axis, the bottom plot of a stack), or as text in the element it names (data-plot-names, the
    // distribution rows' count). Never borrowed from a canvas it is not bound to.
    const axes = (await plot.getAttribute('data-plot-axes')) ?? '';
    const names = axes.split('|');
    const written = await plot.evaluate((canvas, names) => {
        type Texted = HTMLCanvasElement & { __plotTexts?: string[] };
        const NAME = /^(.*\S)\s*\[([^\]]+)\]$/su;
        const fits = (texts: readonly string[], name: string): boolean => {
            const parts = NAME.exec(name.trim());
            if (!parts) return false;
            const [, quantity, unit] = parts;
            const words = quantity.split(/\s+/u);
            // The quantity whole, the symbol it ends in, or its first characters with an ellipsis (shortQuantities).
            const isQuantity = (text: string): boolean => text === quantity || (words.length > 1 && text === words[words.length - 1])
                || (text.length > 1 && text.endsWith('…') && quantity.startsWith(text.slice(0, -1)));
            const oneLine = texts.some(text => { const drawn = NAME.exec(text.trim()); return !!drawn && drawn[2] === unit && isQuantity(drawn[1]); });
            // On two lines: the quantity and its unit written one after the other (one name), not anywhere apart.
            return oneLine || texts.some((text, index) => isQuantity(text) && (texts[index + 1] === `[${unit}]` || texts[index - 1] === `[${unit}]`));
        };
        const bound = (canvas.getAttribute('data-plot-named-by') ?? '').split(' ').filter(Boolean)
            .map(id => document.getElementById(id) as Texted | null).filter((other): other is Texted => !!other && other.checkVisibility());
        const own = [...((canvas as Texted).__plotTexts ?? []), ...bound.flatMap(other => other.__plotTexts ?? [])];
        // As text, only in the element the plot names for its axis names (data-plot-names), never elsewhere on the page (C6).
        const namesHost = canvas.getAttribute('data-plot-names') ? document.getElementById(canvas.getAttribute('data-plot-names') ?? '') : null;
        const pageText = (name: string): boolean => !!namesHost && [namesHost, ...Array.from(namesHost.querySelectorAll<HTMLElement>('*'))].some(element => element.children.length === 0 && element.checkVisibility() && element.textContent?.trim() === name);
        return names.map(name => NAME.test(name.trim()) && (fits(own, name) || pageText(name)));
    }, names);
    // Both axes, and a right-hand level axis where there is one.
    if (names.length >= 2 && written.every(Boolean)) passed.add('axes');
    // A hover shows its readout in the row just above the plot, and the plot does not move: a readout there shows
    // text it did not show before the pointer came (not one left from an earlier hover).
    const readouts = (top: number): Promise<string[]> => page.evaluate(top => Array.from(document.querySelectorAll<HTMLElement>('[id*="readout"], [class*="readout"]'))
        .filter(element => { const at = element.getBoundingClientRect(); return at.bottom <= top + 1 && top - at.bottom < 60; })
        .map(element => (element.checkVisibility({ visibilityProperty: true }) ? element.textContent?.trim() ?? '' : '')), top);
    await page.mouse.move(1, 1);
    await settled(page);
    // Plots stacked on one shared axis (data-plot-stack) share the one readout row above the stack.
    // The comparison's lanes, on one window, share the row above the first of them (trackStageGestures.ts slotOf),
    // the base's lane too where it draws no picture of its own (a step measured against the base).
    const rowTop = await plot.evaluate(canvas => {
        const lanes = document.body.classList.contains('is-stage-view') && canvas.classList.contains('track-canvas')
            ? Array.from(document.querySelectorAll<HTMLElement>('#tracks-wrapper .track-canvas')).find(lane => lane.checkVisibility()) : undefined;
        return (lanes ?? canvas.closest('[data-plot-stack]') ?? canvas).getBoundingClientRect().top;
    });
    const before = await readouts(rowTop);
    await page.mouse.move(middle.x, middle.y);
    await settled(page);
    const after = await readouts(rowTop);
    const above = after.some((text, index) => text && text !== before[index]);
    // The pointer's marks are seen: a marks layer shown over the plot is the topmost thing there, not under a screen.
    const buried = await page.evaluate(({ x, y }) => Array.from(document.querySelectorAll<HTMLElement>('.plot-hover-layer:not([hidden])')).some(layer => {
        layer.style.pointerEvents = 'auto';
        try { const stack = document.elementsFromPoint(x, y); return stack.includes(layer) && stack[0] !== layer; } finally { layer.style.pointerEvents = ''; }
    }), middle);
    if (above && !buried && Math.abs((await plot.boundingBox())!.y - box.y) < 0.5) passed.add('readout');
    // ← / → under the still pointer step the readout one point at a time (R7): → reads the very next point of the
    // full-resolution data the plot reads from (its next sample, bin, band or frame, however many share a pixel), ←
    // the one before it again, and → once more that next one; the readout stays in its row above the plot.
    const read = async (): Promise<string> => (await readouts(rowTop)).filter(Boolean).join(' | ');
    const origin = await pointRead(plot);
    const next = origin ? await knownStep(plot, origin) : null;
    const steps: string[] = [];
    const stepped: Array<PointRead | null> = [];
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowRight']) {
        const from = stepped.at(-1) ?? origin;
        await page.keyboard.press(key);
        await settled(page);
        stepped.push(await pointRead(plot, from));
        steps.push(await read());
    }
    const hovered = await read();
    const onLine = (point: PointRead | null, expected: PointAt | null): boolean => !!point && point.sameLayer && isPoint(point, expected);
    // → the very point the raw data has next (a point beside the one read at the same x too, told apart by its index or
    // identity), ← the one read again, → that next one again. Where the test knows no data of the line read (only as
    // NO_KNOWN_DATA lists, with why), the keys are checked to move one way and back, not to which point.
    const blind = next && !next.known ? NO_KNOWN_DATA[plotKey] : undefined;
    const onePoint = !!origin && !!next && (next.known
        ? !!next.expected && onLine(stepped[0], next.expected) && onLine(stepped[1], origin) && onLine(stepped[2], next.expected)
        : !!blind && movedOn(origin, stepped[0]) && onLine(stepped[1], origin) && onLine(stepped[2], stepped[0]));
    if (next && !next.known && !blind) unknownPlots.add(`${plotKey}: ${next.why}`);
    // Where the point is, written apart from its neighbour's (C3: its digits from the points' spacing), not only its
    // value: the readout less its last part (the value) differs between two neighbouring points.
    const place = (text: string): string => text.split(' / ').slice(0, -1).join(' / ');
    const apart = place(steps[0]) !== place(steps[1]);
    if (above && onePoint && apart && steps.every(Boolean) && steps[0] !== after.filter(Boolean).join(' | ') && steps[1] !== steps[0] && steps[2] === steps[0] && hovered === steps[2]) passed.add('step');
    // Ctrl+wheel zooms; a double-click resets. Each is seen in what the plot shows, not only in its attributes: its
    // picture is drawn again and differs from the one before (reset need not be the very first picture: a plot may
    // have taken finer data while zoomed).
    const picture = (): Promise<string> => plot.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
    // Where a pixel is on the plot's axes, as fractions of what it shows (0 at its left and bottom, 1 at its right and
    // top), from the plot's frame on the canvas alone (data-plot-frame): what a gesture there should show (C6).
    const frameOf = async (): Promise<number[]> => ((await plot.getAttribute('data-plot-frame')) ?? '').split(' ').map(Number);
    const fractionAt = (frame: number[], clientX: number, clientY: number): { x: number; y: number } | null => (frame.length === 4 && frame.every(Number.isFinite) && frame[2] > 0 && frame[3] > 0
        ? { x: (clientX - box.x - frame[0]) / frame[2], y: 1 - (clientY - box.y - frame[1]) / frame[3] } : null);
    const whole = await picture();
    // Ctrl+wheel zooms about the pointer (R13): the place under it stays under it, on a plot showing its whole.
    const wheelAt = { x: box.x + box.width * 0.7, y: middle.y };
    await page.mouse.move(wheelAt.x, wheelAt.y);
    await settled(page);
    const wheelFrom = await plot.getAttribute('data-plot-window');
    const wheelFraction = fractionAt(await frameOf(), wheelAt.x, wheelAt.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await settled(page);
    const zoomed = await plot.getAttribute('data-plot-window');
    const zoomedPicture = await picture();
    const [w0, w1] = (zoomed ?? '').split(' ').map(Number);
    const aboutPointer = (wheelFrom ?? FULL) === FULL && !!wheelFraction && w1 - w0 < 0.99 && Math.abs(w0 + wheelFraction.x * (w1 - w0) - wheelFraction.x) < 0.01;
    if (zoomed && zoomed !== FULL && aboutPointer && zoomedPicture !== whole) passed.add('zoom');
    await page.mouse.dblclick(middle.x, middle.y);
    await settled(page);
    if (zoomed && (await plot.getAttribute('data-plot-window')) === FULL && await picture() !== zoomedPicture) passed.add('reset');
    // + / − / 0 with the pointer over the plot (its keys, the same on every plot): + zooms its horizontal axis about the
    // middle of what it shows, wherever the pointer is on it, − zooms back out and 0 shows the whole; each is drawn.
    const windowOf = async (): Promise<number[]> => ((await plot.getAttribute('data-plot-window')) ?? '').split(' ').map(Number);
    const centred = (window: number[], wider: number): boolean => window.length === 4 && window.every(Number.isFinite)
        && window[0] > 0.001 && window[1] < 0.999 && window[1] - window[0] < wider && Math.abs(window[0] + window[1] - 1) < 0.01;
    // Near the right of the plot's frame (data-plot-frame): + zooms about the middle and takes that place off the window.
    const keyFrame = await frameOf();
    const keyWhole = await picture();
    // The first place there that reads a point (a line may end before the plot's right edge).
    let readWhole: PointRead | null = null;
    // A read waiting for its full data is given the time to come (no number meanwhile, R7).
    const readSettled = async (): Promise<void> => {
        await settled(page);
        for (let tries = 0; tries < 50 && await plot.getAttribute('data-plot-read') === 'pending'; tries++) await page.waitForTimeout(100);
    };
    for (const across of [0.95, 0.9, 0.86, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55]) {
        await page.mouse.move(keyFrame.length === 4 && keyFrame.every(Number.isFinite) ? box.x + keyFrame[0] + keyFrame[2] * across : box.x + box.width * 0.8, middle.y);
        await settled(page);
        await readSettled();
        readWhole = await plot.evaluate(canvas => !!(canvas as NotedPlot).__plotRead) ? await pointRead(plot) : null;
        if (readWhole) break;
    }
    // The double-click above may have given the plot the focus; a focused lane keeps ← / → for its time cursor (R7,
    // tested in trackPointerEvents.test.ts), so the keys here are the readout's under the pointer alone.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // A point stepped to before the zoom, right of the middle: + zooms about the middle, and takes it off the window.
    await page.keyboard.press('ArrowRight');
    const steppedWhole = readWhole && await pointRead(plot, readWhole);
    await page.keyboard.press('=');
    await settled(page);
    const keyed = await windowOf(), keyedPicture = await picture();
    // Drawn again by a key under the pointer that has not moved: the point stepped to, off the window now, is let go
    // and never read off the plot; the plot reads the point under the pointer on the new drawing (A26, R7).
    const zoomedRead = steppedWhole && await pointRead(plot, steppedWhole);
    const readOnPlot = (): Promise<boolean> => plot.evaluate(canvas => {
        const read = (canvas as HTMLElement & { __plotRead?: { x: number } | null }).__plotRead;
        const frame = (canvas.getAttribute('data-plot-frame') ?? '').split(' ').map(Number);
        return !!read && frame.length === 4 && read.x >= frame[0] - 0.5 && read.x <= frame[0] + frame[2] + 0.5;
    });
    // (A point that → could not leave, the line's last, is no step to let go: the pointer reads as it does anywhere.)
    const letGo = !!zoomedRead && (zoomedRead.at !== steppedWhole?.at || steppedWhole?.at === readWhole?.at) && await readOnPlot();
    // → steps exactly one full-resolution point on the zoomed plot, from a point in its middle (no point skipped).
    await page.mouse.move(box.x + box.width * 0.5, middle.y);
    const movedTo = zoomedRead && await pointRead(plot, zoomedRead);
    // Marked as the line the step is checked on.
    const zoomedHere = movedTo && await pointRead(plot);
    const zoomedKnown = zoomedHere ? await knownStep(plot, zoomedHere) : null;
    const zoomedNext = zoomedKnown?.known ? zoomedKnown.expected : null;
    // The step taken is to the point the raw data has next, or, where the test knows none (NO_KNOWN_DATA), on.
    const stepsOn = (from: PointRead | null, to: PointRead | null): boolean => !!from && !!to && to.sameLayer
        && (zoomedKnown?.known ? isPoint(to, zoomedNext) : !!NO_KNOWN_DATA[plotKey] && movedOn(from, to));
    await page.keyboard.press('ArrowRight');
    const zoomedStep = zoomedHere && await pointRead(plot, zoomedHere);
    const near = (a: number | undefined, b: number | null): boolean => a !== undefined && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    // Where that next point is off the zoomed window (sparse points, an events plot), → reads nothing past the plot's
    // side and the readout stays: the next point is then read nowhere inside the frame, wherever the pointer is.
    const seenInside = async (at: number | null): Promise<boolean> => {
        const frame = await frameOf();
        if (at === null || frame.length !== 4 || !frame.every(Number.isFinite)) return false;
        for (let column = 0; column < 20; column++) {
            await page.mouse.move(box.x + frame[0] + frame[2] * (column + 0.5) / 20, middle.y);
            await readSettled();
            const inside = await plot.evaluate((canvas, { at, frame }) => {
                const read = (canvas as HTMLElement & { __plotRead?: { x: number; at?: number } | null }).__plotRead;
                return !!read && read.at === at && read.x > frame[0] + 0.5 && read.x < frame[0] + frame[2] - 0.5;
            }, { at, frame });
            if (inside) return true;
        }
        return false;
    };
    const steppedZoomed = letGo && !!zoomedStep && zoomedStep.sameLayer && await readOnPlot()
        && (stepsOn(zoomedHere, zoomedStep) || (!!zoomedHere && samePoint(zoomedStep, zoomedHere) && zoomedKnown?.known === true && !await seenInside(zoomedNext?.at ?? null)));
    // − zooms back out about the middle: the point stepped to stays on the plot, so it stays the one read, on the
    // plot drawn anew (R7), whether the plot keeps its canvas or makes it anew on every repaint (the distribution).
    const stepTaken = stepsOn(zoomedHere, zoomedStep);
    await page.keyboard.press('-');
    await settled(page);
    let keptOut = !stepTaken;
    for (let tries = 0; tries < 20 && !keptOut; tries++) {
        await readSettled();
        keptOut = near(await plot.evaluate(canvas => (canvas as NotedPlot).__plotRead?.at), zoomedStep?.at ?? null);
        if (!keptOut) await page.waitForTimeout(100);
    }
    const keyedOut = await windowOf();
    await page.keyboard.press('=');
    await page.keyboard.press('0');
    await settled(page);
    if (centred(keyed, 0.75) && steppedZoomed && keptOut && keyedPicture !== keyWhole && keyedOut[1] - keyedOut[0] > keyed[1] - keyed[0] + 0.1
        && (await plot.getAttribute('data-plot-window')) === FULL && await picture() !== keyedPicture) passed.add('zoom keys');
    // Ctrl+wheel over the value axis (the plot's left margin, or the canvas beside it that holds it): no point on the
    // plot to zoom around, so the horizontal axis zooms about its middle, as on every plot.
    const valueAxisId = await plot.getAttribute('data-plot-axis');
    const valueAxisBox = valueAxisId ? await page.locator(`[id="${valueAxisId}"]`).boundingBox() : null;
    await page.mouse.move(valueAxisBox ? valueAxisBox.x + valueAxisBox.width / 2 : box.x + 8, valueAxisBox ? valueAxisBox.y + valueAxisBox.height / 2 : middle.y);
    await settled(page);
    const beforeWheel = await picture();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await settled(page);
    const leftWheel = centred(await windowOf(), 0.99) && await picture() !== beforeWheel;
    await page.mouse.dblclick(middle.x, middle.y);
    await settled(page);
    // Every value axis answers it, the right-hand one too where the plot draws one (its third axis name, in its right
    // margin from data-plot-frame): a plot with an axis that does not fails, whichever axis it is (A48, R13).
    const rightAxis = async (): Promise<{ x: number; y: number } | null> => {
        const frame = await frameOf();
        if (names.length < 3 || frame.length !== 4 || !frame.every(Number.isFinite)) return null;
        const margin = box.width - frame[0] - frame[2];
        return margin > 12 ? { x: box.x + frame[0] + frame[2] + margin / 2, y: box.y + frame[1] + frame[3] / 2 } : null;
    };
    const right = await rightAxis();
    let rightWheel = true;
    if (right) {
        await page.mouse.move(right.x, right.y);
        await settled(page);
        const beforeRight = await picture();
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -240);
        await page.keyboard.up('Control');
        await settled(page);
        rightWheel = centred(await windowOf(), 0.99) && await picture() !== beforeRight;
        await page.mouse.dblclick(middle.x, middle.y);
        await settled(page);
    }
    if (leftWheel && rightWheel) passed.add('axis wheel');
    // A plain drag zooms into its box (R13): the window narrows on the horizontal axis and on the vertical one, but
    // for a vertical axis defined to show every count always (data-plot-y-axis "all-counts", plotInteraction.ts
    // VerticalAxis), which stays whole and must be the plot's count axis. A double-click gives the whole back.
    await settled(page);
    const beforeBox = await picture();
    const boxFrom = await plot.getAttribute('data-plot-window'), boxFrame = await frameOf();
    // The box's corners on the plot's axes: what it should show (C6), from the pixels dragged alone.
    const corner0 = fractionAt(boxFrame, box.x + box.width * 0.3, box.y + box.height * 0.3);
    const corner1 = fractionAt(boxFrame, box.x + box.width * 0.7, box.y + box.height * 0.6);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, { steps: 4 });
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 4 });
    await page.mouse.up();
    await settled(page);
    // Let go, the readout is the pointer's where it was let go, on the zoomed plot, never the press's place (R7): the
    // same point a fresh hover there reads.
    const rawRead = (): Promise<string> => plot.evaluate(canvas => { const read = (canvas as NotedPlot).__plotRead; return read ? `${read.at}|${read.row}` : ''; });
    const release = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.6 };
    await settled(page);
    const atRelease = await rawRead();
    await page.mouse.move(release.x - 3, release.y);
    await page.mouse.move(release.x, release.y);
    await settled(page);
    const hoveredThere = await rawRead();
    const readsRelease = atRelease === hoveredThere;
    const boxed = ((await plot.getAttribute('data-plot-window')) ?? '').split(' ').map(Number);
    await seeTicks(`box-zoomed to ${boxed.join(' ')}`);
    const vertical = await plot.getAttribute('data-plot-y-axis');
    if (boxed.length === 4 && boxed.every(Number.isFinite) && (vertical === 'zoom' || vertical === 'all-counts')) {
        const [x0, x1, y0, y1] = boxed;
        // It shows what the box enclosed along the horizontal axis (clamped to the whole where the box ran past an
        // edge). The vertical window is a part of a whole range that may itself refit to the frequencies on screen
        // (the pair view's gain, R9), so its fractions are not the pixels' and only its narrowing is checked.
        const near = (value: number, expected: number | undefined): boolean => expected !== undefined && Math.abs(value - Math.min(1, Math.max(0, expected))) < 0.02;
        const across = (boxFrom ?? FULL) === FULL && x0 > 0.001 && x1 < 0.999 && x1 > x0 && near(x0, corner0?.x) && near(x1, corner1?.x);
        // A count axis is one that shows every count (display-rules R13), and only a count axis may: named as the
        // distribution names its count axis in either language (a word like 周波数 holds 数 and is no count).
        const counts = COUNT_QUANTITIES.includes(/^(.*\S)\s*\[/su.exec((names[1] ?? '').trim())?.[1] ?? '');
        const up = vertical === 'all-counts' ? counts && y0 === 0 && y1 === 1 : !counts && y0 > 0.001 && y1 < 0.999 && y1 > y0;
        if (across && up && readsRelease && await picture() !== beforeBox) passed.add('box zoom');
    }
    await page.mouse.dblclick(middle.x, middle.y);
    await settled(page);
    // A drag whose release never reaches the page ends there with nothing done (R7): the window loses the focus
    // mid-drag, or the button is let go outside the page (the next move finds it up). The plot reads and steps again
    // under the pointer, and shows what it showed before the press (no box zoomed into).
    let lostEnds = true;
    for (const lose of ['blur', 'move with the button up'] as const) {
        const windowBefore = await plot.getAttribute('data-plot-window');
        await page.mouse.move(box.x + box.width * 0.3, middle.y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.5, middle.y + 6, { steps: 4 });
        if (lose === 'blur') await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
        else await plot.evaluate((canvas, at) => canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: at.x, clientY: at.y, buttons: 0 })), { x: box.x + box.width * 0.5, y: middle.y + 6 });
        // Playwright's button is still down: its moves now are no drag, the press having ended.
        await page.mouse.move(middle.x - 3, middle.y);
        await page.mouse.move(middle.x, middle.y);
        await settled(page);
        const reads = await pointRead(plot);
        // The press gave a lane the keyboard's focus, where ← / → move its time cursor (A47): the readout's step is asked
        // with the focus elsewhere, as every other plot's is.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
        await page.keyboard.press('ArrowRight');
        await settled(page);
        const steps = reads ? await pointRead(plot, reads) : null;
        await page.mouse.up();
        await settled(page);
        const kept = (await plot.getAttribute('data-plot-window')) === windowBefore;
        if (!reads || !steps || (steps.at === reads.at && steps.row === reads.row) || !kept) lostEnds = false;
    }
    if (lostEnds) passed.add('lost release');
    // A double-click on an axis opens its range. The range is applied, not only offered: bounds narrowed to the middle
    // half of the ones it shows are typed in and applied, and the plot shows another part (its picture changes; the
    // window attribute is only the gestures'), then Auto gives the whole back (the picture changes again).
    /** The axis a range popover last opened for: its name and the bounds it offered. */
    let opened: { name: string; low: number; high: number } | null = null;
    const rangeApplies = async (at: { x: number; y: number }): Promise<boolean> => {
        await page.mouse.dblclick(at.x, at.y);
        const popover = page.locator('[id$="range-popover"]:visible');
        let done = false;
        opened = null;
        if (await popover.count()) {
            const min = popover.locator('input[id$="-min"]'), max = popover.locator('input[id$="-max"]');
            const low = Number(await min.inputValue()), high = Number(await max.inputValue());
            opened = { name: (await popover.first().evaluate(element => element.querySelector('[id$="-axis-badge"]')?.textContent ?? '')).trim(), low, high };
            const pictureBefore = await picture();
            if (Number.isFinite(low) && Number.isFinite(high) && high > low) {
                await min.fill(String(low + (high - low) / 4));
                await max.fill(String(high - (high - low) / 4));
                await popover.locator('button[id$="-apply"]').click();
                await settled(page);
                const narrowed = await picture();
                const applied = !(await popover.count()) && narrowed !== pictureBefore;
                await page.mouse.dblclick(at.x, at.y);
                const again = page.locator('[id$="range-popover"]:visible');
                if (await again.count()) await again.locator('button[id$="-auto"]').click();
                await settled(page);
                done = applied && await picture() !== narrowed;
            }
        }
        // Escape only for a popover still open: with none, it is the screen's own (it would leave the comparison).
        if (await page.locator('[id$="range-popover"]:visible').count()) await page.keyboard.press('Escape');
        return done;
    };
    // The level axis: the plot's own left margin, or the canvas beside it that holds its value axis (data-plot-axis).
    const axisId = await plot.getAttribute('data-plot-axis');
    const axisBox = axisId ? await page.locator(`[id="${axisId}"]`).boundingBox() : null;
    const leftAt = { x: axisBox ? axisBox.x + axisBox.width / 2 : box.x + 8, y: axisBox ? axisBox.y + axisBox.height / 2 : middle.y };
    const leftRange = await rangeApplies(leftAt);
    const leftOpened = opened as { name: string; low: number; high: number } | null;
    // A narrow window typed on the vertical axis, 1.7 % of what it shows, from 40.5 % of the way up: between round
    // values, and on a numbered row axis of 100 rows from the middle of a row (−59.5 of −100 to 0), a row cut in half.
    await page.mouse.dblclick(leftAt.x, leftAt.y);
    const narrowPopover = page.locator('[id$="range-popover"]:visible');
    if (await narrowPopover.count()) {
        const min = narrowPopover.locator('input[id$="-min"]'), max = narrowPopover.locator('input[id$="-max"]');
        const low = Number(await min.inputValue()), high = Number(await max.inputValue());
        if (Number.isFinite(low) && Number.isFinite(high) && high > low) {
            await min.fill(String(low + (high - low) * 0.405));
            await max.fill(String(low + (high - low) * 0.422));
            await narrowPopover.locator('button[id$="-apply"]').click();
            await seeTicks(`typed to ${String(low + (high - low) * 0.405)} … ${String(low + (high - low) * 0.422)} up`);
            await page.mouse.dblclick(leftAt.x, leftAt.y);
            const again = page.locator('[id$="range-popover"]:visible');
            if (await again.count()) await again.locator('button[id$="-auto"]').click();
            await settled(page);
        }
    }
    if (await page.locator('[id$="range-popover"]:visible').count()) await page.keyboard.press('Escape');
    // The right-hand level axis opens its own range (A48), as every axis does: named as that axis, over the levels it
    // shows, never the left one's.
    const rightAt = await rightAxis();
    const rightRange = rightAt ? await rangeApplies(rightAt) : true;
    const rightOpened = opened as { name: string; low: number; high: number } | null;
    const ownRight = !rightAt || (!!leftOpened && !!rightOpened && rightOpened.name !== leftOpened.name
        && (rightOpened.low !== leftOpened.low || rightOpened.high !== leftOpened.high));
    if (leftRange && rightRange && ownRight) passed.add('axis range');
    // The horizontal axis: the plot's own bottom margin, or the element that holds the axis it shares with the plots
    // stacked on it (data-plot-x-axis): a canvas of its own (the lanes' ruler, the distribution's value axis), in its
    // middle, or the plot at the bottom of the stack, in its bottom margin (the pair view's frequency axis).
    const xAxisId = await plot.getAttribute('data-plot-x-axis');
    const xAxis = xAxisId ? page.locator(`[id="${xAxisId}"]`) : null;
    const xAxisBox = xAxis ? await xAxis.boundingBox() : null;
    const xAxisIsPlot = xAxis ? await xAxis.evaluate(element => element.hasAttribute('data-plot')) : false;
    const xAt = !xAxisBox ? { x: middle.x, y: box.y + box.height - 6 }
        : { x: xAxisBox.x + xAxisBox.width / 2, y: xAxisIsPlot ? xAxisBox.y + xAxisBox.height - 6 : xAxisBox.y + xAxisBox.height / 2 };
    if (await rangeApplies(xAt)) passed.add('x range');
    await page.mouse.move(1, 1);
    // Through every gesture above (zoomed, boxed, ranged, reset), no axis name was drawn outside its canvas (R4): the
    // audit judges each name as it is drawn (canvasAudit.ts __titleAudit; the fix is in the shared component, see
    // docs/display-rules.md R4 "軸名はキャンバスの中に"). What it found stays on the page and fails the test at its end too.
    if ((await page.evaluate(() => window.__titleAudit ?? [])).length === 0) passed.add('names inside');
    // 'tick places': at every state seen (whole, box-zoomed, typed narrow; three at least, the typed one included), the
    // plot says where it paints (paintOverlay's __plotTickPlaces), every number its vertical axes write is where that
    // axis paints it, and it writes some, but for a plot whose vertical axes write none (NO_VERTICAL_TICKS, with why).
    const silent = !!NO_VERTICAL_TICKS[plotKey];
    tickPlacesFound.push(...tickStates.flatMap(state => state.places.wrong.map(wrong => `${state.at}: ${wrong}`)));
    if (tickStates.length >= 3 && tickStates.some(state => state.at.startsWith('typed')) && tickStates.every(state => state.places.declared && !state.places.wrong.length && (silent ? state.places.judged === 0 : state.places.judged > 0))) passed.add('tick places');
    return passed;
}

/**
 * Every plot on screen in a scenario gets the contract, not only the ones a test names: each [data-plot] canvas seen
 * while the scenario runs is recorded by its name (as the audit names a canvas: its id, else its class and data
 * attributes), and the scenario fails on one it saw and did not check. A plot left out is in UNCHECKED with why;
 * one listed there and checked fails too, so the list only shrinks.
 */
const UNCHECKED: Record<string, string> = {
    '#entry-dist-axis-canvas': 'the distribution rows\' shared value axis (their data-plot-axis): no lines of its own, its range is opened from each row\'s check',
};
const seenPlots = new Set<string>();
const checkedPlots = new Set<string>();
/**
 * The raw data of the plots a test shows, as the test itself posted it or built the page with (knownData.ts): the arrow
 * keys' expectation (knownStep) comes from it, never from the plot's own full source. Each test sets it; a plot whose
 * data it does not know is checked only to step one way and back, and only where NO_KNOWN_DATA says why.
 */
let knownData: KnownData | null = null;
/** What the page's stand-in served its plots (fullReadStandIn.ts uiSmokeServe), as knownStep last read it. */
let served: Served[] = [];
/** The pictures a comparison test posted (answer, answerKinds): each recording's, by its file. */
const postedStages: Array<{ filePath: string; picture: Record<string, unknown> }> = [];
/**
 * The plots whose raw data a test cannot know apart from the plot, with why. The list only shrinks: a plot that comes
 * to have known data is taken off (its step is then checked to the point).
 */
const NO_KNOWN_DATA: Record<string, string> = {};
/** Plots stepped with no data known and not in NO_KNOWN_DATA: each fails its 'step' check, and is named here. */
const unknownPlots = new Set<string>();
/** Plots that read a point the data the test gave them does not have: each fails its 'step' check, and is named here. */
const strayPlots = new Set<string>();
/** A point to the right of `from`, or beside it at the same x (another index or identity): a step on, wherever to. */
function movedOn(from: PointAt, to: PointAt | null): boolean {
    return !!to && (to.at > from.at || (to.at === from.at && to.row === from.row && (to.index !== from.index || to.identity !== from.identity)));
}
/** The nominal 1/3-octave centres (IEC 61260), from 20 Hz: the entry overview's columns, as many as a scan has bands. */
const THIRD_OCTAVE_CENTRES = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
/** The entry's plots, from the scan results the test opened it with: the overview's columns are each band of a row; the distribution, each channel's Leq. */
function entryKnown(files: ScannedFile[]): KnownData {
    const bands = ((files[0]?.result.thirdOctDb as number[][] | undefined)?.[0] ?? []).length;
    const overview: KnownData = read => (read.image && read.attrs.includes('data-entry-overview') ? { kind: 'image', xs: THIRD_OCTAVE_CENTRES.slice(0, bands) } : null);
    // The distribution beside them, from the same scans (knownData.ts scannedDistribution).
    return firstKnown(overview, scannedDistribution(files));
}
/**
 * A page the test built (buildHtml.ts), from what it was built with: the tracks' lanes from its app state, the cursor
 * spectrum's every bin (on the Extension Host path, its stub's grid; else the lane spectrogram's rows, which the page's
 * stand-in slices it from) and the pair view's bins (its stub's grid).
 */
function pageKnown(html: string, hostPath = false): KnownData {
    const results = appStateOf(html).results;
    const spectrogram = results[0]?.channels[0]?.spectrogram as { frequencyBins: number; maxFrequencyHz: number } | null | undefined;
    const isSpectrum = (read: ReadOf): boolean => read.id === 'spectrum-overlay-canvas';
    // A line's values are what the stand-in served it: the lane spectrogram's column at the cursor, the stub's bins.
    const spectrumValues = (read: ReadOf, bins: number): ReturnType<typeof servedBins> => servedBins(served, 'spectrum', read, bins);
    const spectrum = hostPath ? binGrid(isSpectrum, UI_SMOKE_HOST_GRID.spectrumBins, UI_SMOKE_HOST_GRID.maxHz, spectrumValues)
        : spectrogram ? binGrid(isSpectrum, spectrogram.frequencyBins, spectrogram.maxFrequencyHz, spectrumValues) : (): null => null;
    const pairValues = (read: ReadOf, bins: number): ReturnType<typeof servedBins> => servedBins(served, read.id.replace(/^pair-lane-/u, 'pair-'), read, bins);
    return firstKnown(recordingLanes(results), spectrum, binGrid(read => read.attrs.includes('data-pair-lane'), UI_SMOKE_HOST_GRID.pairBins, UI_SMOKE_HOST_GRID.maxHz, pairValues));
}
test.afterEach(() => {
    knownData = null;
    served = [];
    postedStages.length = 0;
    const unknown = [...unknownPlots];
    unknownPlots.clear();
    expect.soft(unknown, 'plots whose arrow keys were checked with no raw data of their own: give the test their data (knownData, knownData.ts), or list them in NO_KNOWN_DATA with why (R7)').toEqual([]);
    const stray = [...strayPlots];
    strayPlots.clear();
    expect.soft(stray, 'plots that read a point the data the test gave them does not have (R7: a readout is read from the full data, never elsewhere): the plot\'s full source (StageLayer.full) answers other points than its data, or knownData.ts models the data wrongly').toEqual([]);
});
test.beforeEach(() => { seenPlots.clear(); checkedPlots.clear(); });
/**
 * A plot's name, as the audit names a canvas: its id, else its class and the data attributes that say which plot it
 * is. Lanes of one kind (track-canvas-0, track-canvas-1-2) share a name: one of them checked checks that kind.
 */
function plotName(canvas: Element): string {
    if (canvas.id) return `#${canvas.id.replace(/(?:-\d+)+$/u, '-N')}`;
    const which = ['data-stage-canvas', 'data-pair-lane'];
    const shown = Array.from(canvas.attributes).filter(a => a.name === 'class' || (a.name.startsWith('data-') && !a.name.startsWith('data-plot') && !['data-dots', 'data-track-index', 'data-channel-index', 'data-file-path'].includes(a.name)));
    return `canvas${shown.map(a => (a.name === 'class' ? `.${a.value.trim().split(/\s+/).join('.')}` : which.includes(a.name) ? `[${a.name}="${a.value}"]` : `[${a.name}]`)).join('')}`;
}
/**
 * Whether a plot can be seen with something on it: shown, the topmost thing at its middle (not under a screen laid
 * over it), and drawn (its axes named; a plot with nothing to draw yet says so in their place, "Loading…").
 */
function onScreen(canvas: Element): boolean {
    const element = canvas as HTMLElement;
    if (!element.dataset.plotAxes || !element.checkVisibility({ visibilityProperty: true }) || element.clientWidth <= 1 || element.clientHeight <= 1) return false;
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
    const top = document.elementsFromPoint(x, y).find(item => !item.classList.contains('plot-hover-layer'));
    return top === element;
}
async function seePlots(page: Page): Promise<void> {
    for (const canvas of await page.locator('canvas[data-plot]').all()) {
        if (await canvas.evaluate(onScreen)) seenPlots.add(await canvas.evaluate(plotName));
    }
}
/** The contract on every plot on screen now that no check has had yet: each kind once, until none is left. */
async function expectEveryPlot(page: Page): Promise<void> {
    for (let round = 0; round < 12; round++) {
        let next: Locator | null = null, name = '';
        for (const canvas of await page.locator('canvas[data-plot]').all()) {
            const shown = await canvas.evaluate(onScreen);
            const own = await canvas.evaluate(plotName);
            if (shown && !checkedPlots.has(own) && !UNCHECKED[own]) { next = canvas; name = own; break; }
        }
        if (!next) return;
        await expectContract(page, name, next);
    }
}

test.afterEach(async ({ page }) => {
    if (!checkedPlots.size || page.isClosed()) return;
    await seePlots(page);
    const unchecked = [...seenPlots].filter(name => !checkedPlots.has(name));
    expect.soft(unchecked.filter(name => !UNCHECKED[name]), 'plots on screen the contract did not check (R13: give them expectContract, or list them in UNCHECKED with why)').toEqual([]);
    expect.soft(Object.keys(UNCHECKED).filter(name => checkedPlots.has(name)), 'now checked: take them off UNCHECKED').toEqual([]);
});

async function expectContract(page: Page, name: string, plot: Locator): Promise<void> {
    // Each plot's gestures take their own time (the backend answers each read): a test of several plots has it for each.
    test.info().setTimeout(test.info().timeout + 30_000);
    await expect(plot).toHaveAttribute('data-plot', '');
    await seePlots(page);
    checkedPlots.add(await plot.evaluate(plotName));
    const passed = await contract(page, plot);
    const gaps = KNOWN_GAPS[name] ?? [];
    const checks: Check[] = ['readout', 'step', 'zoom', 'reset', 'zoom keys', 'axis wheel', 'box zoom', 'lost release', 'axis range', 'x range', 'axes', 'names inside', 'tick places'];
    expect.soft(checks.filter(check => !passed.has(check) && !gaps.includes(check)), `${name}: fails these checks of the plot contract (docs/display-rules.md R13; each is a block in contract() above whose comment states the rule it checks, e.g. 'lost release' is R7's drag whose release never reaches the page, 'names inside' is R4's axis names inside their canvas, 'tick places' is R9/R14's tick labelled v at the place its axis paints v)`).toEqual([]);
    expect.soft(tickPlacesFound.splice(0), `${name}: tick labels written where their axis does not paint their number, at the vertical zooms of 'tick places' (docs/display-rules.md R9, R14: place each tick by the transform the picture is painted with, stagePanes.placedTicks; a numbered row axis's ticks are rows, stagePanes.rowNumberTicks; never relabel a place with another number)`).toEqual([]);
    expect.soft(gaps.filter(check => passed.has(check)), `${name}: now passes; take it off KNOWN_GAPS`).toEqual([]);
}

test('every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openComparison(page, scanned!);
    await expectContract(page, 'comparison overlay', page.locator('[data-stage-canvas="overlay"]'));
    await expectEveryPlot(page);
    // Δ under it, then one lane per track.
    await page.locator('[data-action="stage-diff"]').click();
    await expect(page.locator('[data-stage-diff]')).toBeVisible();
    await expectContract(page, 'comparison Δ', page.locator('[data-stage-canvas="diff"]'));
    await expectEveryPlot(page);
    await page.locator('[data-action="stage-diff"]').click();
    await page.locator('[data-action="stage-layout"]').click();
    await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'lanes');
    const lane = page.locator('.track-canvas[data-plot]').first();
    await expect(lane).toBeVisible();
    await expectContract(page, 'comparison lane', lane);
    await expectEveryPlot(page);
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
    await expectContract(page, 'trigger events', page.locator('[data-stage-canvas="overlay"]'));
    await expectContract(page, 'trigger lane', page.locator('.track-canvas[data-plot]').first());
    await expectEveryPlot(page);
});

/**
 * R7: each Frame kind a chain of steps from ＋ can give and the comparison draws (the operation catalogue's, as
 * frameKinds.ts walks it), reached the way a user reaches it (the chain's last step deleted, then each step added
 * from ＋), answered with the StageView the backend makes of that kind (fixtures/stageViewKinds.json, which
 * python-backend/test_stage_view_kinds.py holds to the backend), and every plot on screen given the same checks,
 * overlaid, with its Δ when it has one, and in lanes.
 */
const KIND_VIEWS = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'stageViewKinds.json'), 'utf8')) as Record<string, Record<string, unknown>>;
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
            const stages = request.filePaths.map((_, index) => stubStage(KIND_VIEWS[stageFrame(request)], value => value * (index === 0 ? 0.9 : 1)));
            request.filePaths.forEach((filePath, index) => postedStages.push({ filePath, picture: stages[index] }));
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
        // The kind is drawn: overlaid, or (an image a recording each) in lanes.
        await expect.poll(async () => (await page.locator('.track-canvas[data-plot], [data-stage-canvas][data-plot]').evaluateAll(plots => plots.filter(plot => (plot as HTMLElement).dataset.plotAxes).length))).toBeGreaterThan(0);
        await expectEveryPlot(page);
        expect(checkedPlots.size, `${kind}: a plot on screen to check`).toBeGreaterThan(0);
        const diff = page.locator('[data-action="stage-diff"]');
        if (await diff.isVisible() && await diff.isEnabled()) {
            await diff.click();
            await answerKinds(page, scanned!, answered);
            await expectEveryPlot(page);
            await diff.click();
        }
        const layout = page.locator('[data-action="stage-layout"]');
        if (await layout.isVisible() && await layout.isEnabled()) {
            await layout.click();
            await answerKinds(page, scanned!, answered);
            await expectEveryPlot(page);
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
    const diff = page.locator('[data-stage-canvas="diff"]');
    await expect(diff).toBeVisible();
    await boxZoom(page, diff);
    await expect(root).not.toHaveAttribute('data-diff-y-window', '0.000-1.000');
    await expect(root).not.toHaveAttribute('data-x-window', '0.000-1.000');
    // The overlay keeps its own level axis whole.
    await expect(root).toHaveAttribute('data-y-window', '0.000-1.000');
    // And a box on the overlay leaves the Δ's level axis where it was.
    const diffY = await root.getAttribute('data-diff-y-window');
    await boxZoom(page, page.locator('[data-stage-canvas="overlay"]'));
    await expect(root).not.toHaveAttribute('data-y-window', '0.000-1.000');
    await expect(root).toHaveAttribute('data-diff-y-window', diffY!);
});

test('the comparison draws its difference in the difference\'s green and its recordings in their roles\' colours, neither in the other\'s nor the failure\'s orange (R5)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openComparison(page, scanned!);
    await page.locator('[data-action="stage-diff"]').click();
    await expect(page.locator('[data-stage-diff]')).toBeVisible();
    // The lines each plot drew (the canvas audit's record of its strokes), not its grid or ticks: more than two points.
    const lines = (selector: string): Promise<string[]> => page.locator(selector).evaluate(canvas => [...new Set(((canvas as unknown as { __plotDrawn?: { strokes: Array<{ color: string; points: unknown[] }> } }).__plotDrawn?.strokes ?? [])
        .filter(stroke => stroke.points.length > 2).map(stroke => stroke.color.toLowerCase()))]);
    await expect.poll(() => lines('[data-stage-canvas="diff"]')).toEqual([DIFF_COLOR]);
    const overlay = await lines('[data-stage-canvas="overlay"]');
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
    await boxZoom(page, page.locator('.track-canvas[data-plot]').first());
    await expect(root).not.toHaveAttribute('data-lanes-window', '0.000-1.000 0.000-1.000');
    // The events plot above keeps its own window.
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
    await expect(root).toHaveAttribute('data-y-window', '0.000-1.000');
    // Once the zoom settles, each recording's signal is asked for again over the part on screen of its own length.
    type Detailed = Posted & { detail?: { x: [number, number] } };
    // Each detail asked for is answered (the next is asked once one is in), with the part of the signal it covers.
    const asks = new Map<string, [number, number]>();
    await expect.poll(async () => {
        const next = ((await stageScans(page)).slice(asked) as Detailed[]).find(message => message.stage === 'node-1' && message.detail && !asks.has(message.filePaths[0]));
        if (next?.detail) {
            asks.set(next.filePaths[0], next.detail.x);
            await page.evaluate(({ next, signal, files }) => {
                for (const filePath of next.filePaths) {
                    const file = files.find(item => item.filePath === filePath)!;
                    window.postMessage({ type: 'compare-scan-result', requestId: next.requestId, filePath, result: { ...file.result, stage: { ...signal, xs: next.detail!.x } } }, '*');
                }
                window.postMessage({ type: 'compare-scan-done', requestId: next.requestId }, '*');
            }, { next, signal, files: scanned! });
        }
        return asks.size;
    }).toBe(2);
    const [shorter, longer] = request.filePaths.map(filePath => asks.get(filePath)!);
    // The same part of each: the longer recording's request is twice the shorter's, not the shorter's seconds again.
    expect(longer[0]).toBeCloseTo(shorter[0] * 2, 6);
    expect(longer[1]).toBeCloseTo(shorter[1] * 2, 6);
    // A box on the events plot leaves the lanes' zoom where it was.
    const lanes = await root.getAttribute('data-lanes-window');
    await boxZoom(page, page.locator('[data-stage-canvas="overlay"]'));
    await expect(root).not.toHaveAttribute('data-x-window', '0.000-1.000');
    await expect(root).toHaveAttribute('data-lanes-window', lanes!);
    // The keys zoom the plot under the pointer in its own window, and 0 resets every plot's.
    await page.keyboard.press('0');
    await expect(root).toHaveAttribute('data-lanes-window', '0.000-1.000 0.000-1.000');
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
    const laneBox = (await page.locator('.track-canvas[data-plot]').first().boundingBox())!;
    await page.mouse.move(laneBox.x + laneBox.width * 0.6, laneBox.y + laneBox.height / 2);
    await page.keyboard.press('+');
    await expect(root).toHaveAttribute('data-lanes-window', '0.150-0.850 0.000-1.000');
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
});

test('the entry\'s held plot answers the same gestures as every plot (R13)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEntry(page, scanned!, { language: 'en' });
    knownData = entryKnown(scanned!);
    // A row in slot 1, then its key held: its Δ is drawn on the side while the key is down.
    await page.keyboard.press('1');
    await page.keyboard.down('1');
    const plot = page.locator('[data-entry-held-canvas]');
    await expect(plot).toBeVisible();
    // The Δ is drawn only once every bin is in (R1, R2): the host answers the hold's request for them, each file's
    // own spectrum standing in as its bins.
    const binsAsked = async (): Promise<Posted | undefined> => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages))
        .find(message => message.type === 'compare-scan' && message.requestId.startsWith('held-bins'));
    await expect.poll(binsAsked).toBeTruthy();
    const request = (await binsAsked())!;
    // The held Δ is of the bins answered here: every bin from 0 Hz to half the rate, as the test hands them over.
    const held = scanned!.find(item => request.filePaths.includes(item.filePath))!.result as { spectrumDb: number[][]; input: { fs: number } };
    // Its values: the held row's channel minus the median of its base's (R1), of the bins answered here for the files
    // the hold asked for (the held row first, then its base's).
    const binsOf = (filePath: string): number[][] => (scanned!.find(item => item.filePath === filePath)!.result as { spectrumDb: number[][] }).spectrumDb;
    const heldKey = await page.locator('[data-entry-rows] tr.entry-row[aria-selected="true"]').getAttribute('data-key');
    const heldChannel = Number(/#ch(\d+)$/u.exec(heldKey ?? '')?.[1] ?? 0);
    const [heldPath, ...basePaths] = request.filePaths;
    const heldDelta = differenceFromMedian(binsOf(heldPath)[heldChannel], basePaths.map(filePath => binsOf(filePath)[heldChannel]));
    knownData = firstKnown(entryKnown(scanned!), binGrid(read => read.attrs.includes('data-entry-held-canvas'), held.spectrumDb[0].length, held.input.fs / 2, () => heldDelta));
    await page.evaluate(({ request, files }) => {
        for (const file of files.filter(item => (request as unknown as { filePaths: string[] }).filePaths.includes(item.filePath))) {
            const result = file.result as { spectrumDb: number[][]; input: { fs: number } };
            const bins = { ...result, spectrumBinsDb: result.spectrumDb, spectrumBinHz: result.input.fs / 2 / Math.max(1, (result.spectrumDb[0]?.length ?? 1) - 1) };
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath: file.filePath, result: bins }, '*');
        }
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, files: scanned! });
    await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe('');
    await expectContract(page, 'entry held', plot);
    await page.keyboard.up('1');
    await expectEveryPlot(page);
});

test('the entry\'s overview strip answers the same gestures as every plot (R13)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEntry(page, scanned!, { language: 'en' });
    knownData = entryKnown(scanned!);
    const plot = page.locator('[data-entry-overview]');
    await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe('');
    await expectContract(page, 'entry overview', plot);
    await expectEveryPlot(page);
});

test('the entry\'s distribution answers the same gestures as every plot: each group\'s row, on the value axis below them (R13)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // A distribution the test knows to the count (knownData.ts KNOWN_DISTRIBUTION): its keys are checked to the bar and recording.
    await openEntry(page, knownDistributionScans(), { language: 'en' });
    knownData = firstKnown(knownDistribution(), entryKnown(knownDistributionScans()));
    const plot = page.locator('[data-dist-canvas]').first();
    await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe(null);
    await expectContract(page, 'entry distribution', plot);
    await expectEveryPlot(page);
});

/**
 * The distribution's ← / → walked end to end on a distribution the test knows to the count (knownData.ts
 * KNOWN_DISTRIBUTION, issue #771): each key reads exactly the next bar with recordings (an empty bin has no bar) or
 * the next recording on the rug, never two on and never none, and stays at either end. Each bar read is checked to
 * its centre, its index, and the range and count its readout writes; the rug's recordings of one value are each
 * read once, in the data's order (by value, then key). The same again zoomed in, where only what is on the plot is
 * stepped to. The expectation is the fixture's, never the chart's own binning or full source (R7).
 */
test('the distribution\'s ← / → pass every bar and every recording of a known distribution once, in order, whole and zoomed: each bar\'s centre, range and count (R7)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEntry(page, knownDistributionScans(), { language: 'en' });
    const plot = page.locator('[data-dist-canvas]').first();
    await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe(null);
    const readout = page.locator('[data-entry-dist] .entry-dist-note > [data-plot-readout]');
    const { low, high } = KNOWN_DISTRIBUTION;
    /** The value axis's window shown (fractions of the whole, data-plot-window). */
    const shown = async (): Promise<[number, number]> => {
        const [w0, w1] = ((await plot.getAttribute('data-plot-window')) ?? '').split(' ').map(Number);
        return [low + w0 * (high - low), low + w1 * (high - low)];
    };
    /** The pointer over `value` on the value axis, `up` of the way up the row (0 bottom, 1 top), as the plot shows it now. */
    const hover = async (value: number, up: number): Promise<PointRead | null> => {
        const box = (await plot.boundingBox())!;
        const [v0, v1] = await shown();
        await page.mouse.move(box.x + box.width * (value - v0) / (v1 - v0), box.y + box.height * (1 - up));
        return pointRead(plot);
    };
    const kindRead = (): Promise<string | null> => plot.evaluate(canvas => (canvas as HTMLElement & { __plotRead?: { layer: { view: { kind?: string } } } | null }).__plotRead?.layer.view.kind ?? null);
    /** A bar's readout, as written: "<group> / <low> <unit>–<high> <unit> / <count> ch". */
    const barReadout = async (): Promise<{ low: number; high: number; count: number } | null> => {
        const text = ((await readout.textContent()) ?? '').replace(/−/gu, '-');
        const parts = /(-?\d+(?:\.\d+)?) dB[^–]*–(-?\d+(?:\.\d+)?) dB.*\/ (\d+) ch$/u.exec(text.trim());
        return parts ? { low: Number(parts[1]), high: Number(parts[2]), count: Number(parts[3]) } : null;
    };
    // Each key press: the point it must read (null: it stays where it is, at an end or the plot's side), and what was read.
    type Walked = { key: string; expected: string; read: string; got: PointRead | null };
    const walk = async (start: PointRead, steps: ReadonlyArray<{ key: 'ArrowLeft' | 'ArrowRight'; expected: PointAt | null }>, written?: (expected: PointAt) => Promise<string | null>): Promise<Walked[]> => {
        const out: Walked[] = [];
        let from = start;
        for (const { key, expected } of steps) {
            await page.keyboard.press(key);
            const got = await pointRead(plot, from);
            const want = expected ?? from;
            const wrong = !got || !got.sameLayer || !isPoint(got, want) ? `${JSON.stringify(got)} (${await readout.textContent()})` : written ? await written(want) : null;
            out.push({ key, expected: JSON.stringify(want), read: wrong === null ? JSON.stringify(want) : `${JSON.stringify(want)} read as ${wrong}`, got });
            if (got) from = got;
        }
        return out;
    };
    // A bar read: its range and count as the readout writes them, against the fixture's bin (written to 0.1 dB).
    const barWritten = async (expected: PointAt): Promise<string | null> => {
        const bin = knownBin(expected.index!);
        const got = await barReadout();
        return got && Math.abs(got.low - bin.low) <= 0.05 && Math.abs(got.high - bin.high) <= 0.05 && got.count === bin.count ? null : ` but its readout writes ${await readout.textContent()} (the fixture's bin is ${bin.low}–${bin.high}, ${bin.count} ch)`;
    };
    const barAt = (bin: number): PointAt => ({ at: knownBin(bin).centre, row: null, index: bin, identity: null });
    /** The bars from `from` to either end, and one key more at each end (it stays), among those whose centre is in [v0, v1]. */
    const barSteps = (from: number, [v0, v1]: [number, number]): Array<{ key: 'ArrowLeft' | 'ArrowRight'; expected: PointAt | null }> => {
        const bars = knownBars().filter(bin => knownBin(bin).centre >= v0 && knownBin(bin).centre <= v1);
        const place = bars.indexOf(from);
        const left = bars.slice(0, place).reverse(), right = bars.slice(1);
        return [...left.map(bin => ({ key: 'ArrowLeft' as const, expected: barAt(bin) })), { key: 'ArrowLeft', expected: null },
            ...right.map(bin => ({ key: 'ArrowRight' as const, expected: barAt(bin) })), { key: 'ArrowRight', expected: null }];
    };
    const memberAt = (member: { key: string; value: number }): PointAt => ({ at: member.value, row: null, index: null, identity: member.key });
    /** The rug's recordings from the one read to either end and one more at each, among those in [v0, v1]: each once. */
    const rugSteps = (from: string, [v0, v1]: [number, number]): Array<{ key: 'ArrowLeft' | 'ArrowRight'; expected: PointAt | null }> => {
        const members = knownMembersInOrder().filter(member => member.value >= v0 && member.value <= v1);
        const place = members.findIndex(member => member.key === from);
        if (place < 0) return [{ key: 'ArrowRight', expected: { at: Number.NaN, row: null, index: null, identity: `${from} is not a known recording in view` } }];
        return [...members.slice(0, place).reverse().map(member => ({ key: 'ArrowLeft' as const, expected: memberAt(member) })), { key: 'ArrowLeft', expected: null },
            ...members.slice(1).map(member => ({ key: 'ArrowRight' as const, expected: memberAt(member) })), { key: 'ArrowRight', expected: null }];
    };
    const failed = (walked: Walked[]): Walked[] => walked.filter(step => step.read !== step.expected);
    for (const zoomed of [false, true]) {
        if (zoomed) {
            // + over the plot zooms the value axis about its middle (R13): the bars and recordings off it are not stepped to.
            await hover(60, 0.5);
            await page.keyboard.press('=');
            await settled(page);
            expect((await shown())[1] - (await shown())[0], 'the value axis zoomed in by +').toBeLessThan(high - low);
        }
        const view = await shown();
        const at = zoomed ? 'zoomed' : 'whole';
        // A bar: over bin 24's bar (15 recordings) near its top, where no rug tick is near.
        const bar = await hover(knownBin(24).centre, 0.9);
        expect(bar && await kindRead() === 'bar' && isPoint(bar, barAt(24)) ? null : `${JSON.stringify(bar)} ${await readout.textContent()}`, `${at}: the pointer over bin 24 reads its bar`).toBeNull();
        expect(await barWritten(barAt(24)), `${at}: bin 24's readout`).toBeNull();
        const barWalk = await walk(bar!, barSteps(24, view), barWritten);
        expect(failed(barWalk), `${at}: each ← / → reads the very next bar with recordings, its centre, range and count as the fixture has them (R7)`).toEqual([]);
        // The rug: at the bottom of the row, over bin 28's five recordings of one value.
        const tick = await hover(70.5, 0.02);
        expect(tick && await kindRead() === 'line' && tick.identity !== null && Math.abs(tick.at - 70.5) < 1.5 ? null : `${JSON.stringify(tick)} ${await readout.textContent()}`, `${at}: the pointer at the row's foot reads a recording on the rug`).toBeNull();
        const rugWalk = await walk(tick!, rugSteps(tick!.identity!, view));
        expect(failed(rugWalk), `${at}: each ← / → reads the very next recording, those of one value each once, in the data's order (R7)`).toEqual([]);
        // Every recording in view read once, none twice, none left out: from the first one (where ← stopped), → to the last.
        const reads = rugWalk.map(step => step.got?.identity ?? null);
        const turn = rugWalk.findIndex(step => step.key === 'ArrowRight');
        const once = [reads[turn - 1], ...reads.slice(turn, -1)];
        const inView = knownMembersInOrder().filter(member => member.value >= view[0] && member.value <= view[1]).map(member => member.key);
        expect(once, `${at}: the keys read every recording in view once, in the data's order`).toEqual(inView);
    }
});

test('the cursor spectrum answers the same gestures as every plot (R13)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    const html = buildUiSmokeHtml();
    knownData = pageKnown(html);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const plot = page.locator('#spectrum-overlay-canvas');
    await expect.poll(() => plot.evaluate(canvas => (canvas as HTMLCanvasElement).dataset.plotAxes ?? '')).not.toBe('');
    await expectContract(page, 'cursor spectrum', plot);
    await expectEveryPlot(page);
});

test('the cursor spectrum with two level references answers the axis gestures on its right-hand axis as on its left (A48, R13)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    const html = buildUiSmokeCalibrationHtml();
    knownData = pageKnown(html);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const plot = page.locator('#spectrum-overlay-canvas');
    await expect.poll(() => plot.evaluate(canvas => ((canvas as HTMLCanvasElement).dataset.plotAxes ?? '').split('|').length)).toBe(3);
    await expectContract(page, 'cursor spectrum, two references', plot);
    await expectEveryPlot(page);
});

test('the pair view\'s gain, phase and γ² plots answer the same gestures as every plot (R13)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    const html = buildExtensionHostPathUiSmokeHtml();
    knownData = pageKnown(html, true);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-action="set-pair-reference"]').first().click();
    await expect(page.locator('[data-pair-lane][data-plot]')).toHaveCount(3);
    for (const lane of ['gain', 'phase', 'coherence']) {
        const plot = page.locator(`[data-pair-lane="${lane}"]`);
        await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe('');
        await expectContract(page, `pair ${lane}`, plot);
    }
    await expectEveryPlot(page);
});

test('the track view\'s waveform and spectrogram lanes answer the same gestures as every plot: readout in the toolbar above them (R13)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    const html = buildUiSmokeHtml();
    knownData = pageKnown(html);
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (const [name, selector] of [['track waveform', '.track-canvas:not(.track-spec-canvas)'], ['track spectrogram', '.track-spec-canvas']] as const) {
        const plot = page.locator(`${selector}[data-plot]`).first();
        await expect(plot).toBeVisible();
        await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe(null);
        await expectContract(page, name, plot);
    }
    await expectEveryPlot(page);
});

/**
 * R7, R13 ("a click acts on the point the readout reads"): every plot whose click selects, toggles, goes to or moves
 * something acts on the very point its readout read at the press, the same pick and the same identity, never on a hit
 * test of its own; where the readout reads nothing, the click does nothing. Data-driven from the plot contract table:
 * every row of value 'click' (src/test/plotContracts/charts) has a case here, and each is clicked at places found on
 * the plot as drawn: every point the readout reads on a grid over it, half way between two read points near each other
 * (a tie, dots drawn over each other), at the edge between two places that read different things (a bin's edge, a
 * row's), and the grid's own places (gaps, a point read under the pointer from afar). At each, the identity the
 * readout reads is the identity the click acted on.
 */
type ClickRead = { x: number; y: number; id: string | null };
interface ClickCase {
    /** Opens the plot(s) the click acts on. */
    open(page: Page): Promise<Locator[]>;
    /** What the readout reads on `plot` now: its identity as the click would act on it (null: nothing to act on). */
    read(page: Page, plot: Locator): Promise<string | null>;
    /** The page's state the click changes: what it acted on is told by `acted`. */
    state(page: Page): Promise<string>;
    /** What a click that changed `before` into `after` acted on (null: nothing changed). */
    acted(before: string, after: string): string | null;
    /** Whether acting on `read` changes nothing of `before` (the row already focused, the bin already picked), so a click on it tells nothing. */
    already(before: string, read: string): boolean;
    /** Whether what the click acted on is what the readout read (default: the same identity). */
    match?(read: string | null, acted: string | null): boolean;
    /** The readout is shown as the pointer moves, of data the page holds: read without waiting for the page to settle. */
    readsAtOnce?: boolean;
    /** How many places to click on each plot (default 16): a click that redraws the whole table takes its time. */
    clicks?: number;
}
type NotedRead = { identity?: string; index?: number; at?: number; row?: number; value?: number; image?: boolean; full?: boolean; name?: string; layer: { marks?: string; dash?: unknown; label?: string; view: { kind: string }; event?: { id: number; source: string } } };
/** The read noted on a plot (plotHoverLayer.ts notePlotRead), as plain data. */
const notedRead = (plot: Locator): Promise<NotedRead | null> => plot.evaluate(canvas => {
    const read = (canvas as HTMLElement & { __plotRead?: NotedRead | null }).__plotRead;
    return read ? { identity: read.identity, index: read.index, at: read.at, row: read.row, value: read.value, image: read.image, full: read.full, name: read.name, layer: { marks: read.layer.marks, dash: read.layer.dash ? true : undefined, label: read.layer.label, view: { kind: read.layer.view.kind }, event: read.layer.event ? { id: read.layer.event.id, source: read.layer.event.source } : undefined } } : null;
});
/** Where the read point is drawn (CSS pixels on its plot), for the places a click is tried at. */
const readPlace = (plot: Locator): Promise<{ x: number; y: number } | null> => plot.evaluate(canvas => {
    const read = (canvas as HTMLElement & { __plotRead?: { x: number; y: number; image?: boolean } | null }).__plotRead;
    return read && !read.image ? { x: read.x, y: read.y } : null;
});
const entrySnapshot = (page: Page): Promise<{ focused: string | null; dist: { low: number; high: number; range: { low: number; high: number } | null } | null }> => page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'entry-snapshot', actions: [] } }));
    const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { entry: unknown } }> }).__uiSmokePostedMessages;
    return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi.entry as { focused: string | null; dist: { low: number; high: number; range: { low: number; high: number } | null } | null };
});
/** A table row's name as the strip's readout says it: its file, and its channel when the recording has several. */
const rowKeyName = (key: string): string => { const [file, ch] = key.split('#ch'); return `${file.split('/').at(-1) ?? ''}${ch ? ` ch${ch}` : ''}`; };
const changed = (before: string, after: string, key: string): unknown => { const a = JSON.parse(before) as Record<string, unknown>, b = JSON.parse(after) as Record<string, unknown>; return JSON.stringify(a[key]) === JSON.stringify(b[key]) ? undefined : b[key]; };

/** Opens the comparison on a trigger's events: two events of each recording, the lanes under them. */
async function openTriggerEvents(page: Page): Promise<void> {
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
    await answer(page, scanned!, { frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [-0.01, 0, 0.05, 0.19], events: [event(0, 0.5), event(1, 0.45)] });
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-1');
    await answer(page, scanned!, { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [0, 0.75, 1.5], values: [-0.5, 0.5, -0.5],
        waveform: { min: [-0.5, -0.4, -0.3], max: [0.5, 0.4, 0.3], minT: [0.2, 0.7, 1.1], maxT: [0.3, 0.8, 1.2], absolutePeak: 0.5, unit: 'FS', ref: 1 } });
    await expect.poll(async () => Number(await page.locator('.track-stage').getAttribute('data-lanes-marked'))).toBeGreaterThan(0);
}

/** A lane's click: the time cursor moves to the time the readout read (its sample's, its cell's frame's). */
const laneCase = (selector: string): ClickCase => ({
    async open(page) {
        await page.setViewportSize({ width: 1200, height: 900 });
        await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
        const plot = page.locator(`${selector}[data-plot]`).first();
        await expect(plot).toBeVisible();
        await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe(null);
        return [plot];
    },
    async read(_page, plot) {
        const read = await notedRead(plot);
        return read?.at !== undefined && (!read.image || read.full) ? `t:${read.at}` : null;
    },
    state: async page => JSON.stringify({ at: await page.locator('#tracks-wrapper').getAttribute('data-cursor-at') }),
    acted(before, after) { const at = changed(before, after, 'at'); return typeof at === 'string' ? `t:${Number(at)}` : null; },
    already: (before, read) => `t:${Number((JSON.parse(before) as { at: string | null }).at)}` === read,
});

const CLICK_CASES: Record<string, ClickCase> = {
    'entry-distribution.click': {
        async open(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openEntry(page, scanned!, { language: 'en' });
            await pickCsv(page, 'motor.csv', entry100Metadata());
            await page.locator('[data-action="entry-group"]').selectOption('csv:rpm');
            // A row of dots (two recordings of two channels: 1800 rpm) and a row of bars (the first group).
            const dots = page.locator('[data-dist-group="1800"] [data-dist-canvas]');
            await expect.poll(async () => ((await dots.getAttribute('data-dots')) ?? '').split('\n').filter(Boolean).length).toBe(4);
            const bars = page.locator('[data-dist-canvas]').first();
            await expect(bars).toBeVisible();
            return [dots, bars];
        },
        async read(page, plot) {
            const read = await notedRead(plot);
            if (read) {
                if (read.identity !== undefined) return `row:${read.identity}`;
                if (read.layer.view.kind === 'bar') return `bin:${read.index}`;
                // The base's median: no row, no bin.
                if (read.layer.dash) return null;
                return `tick:${read.layer.label}`;
            }
            // No point read: the readout says where on the value axis the pointer is (words.none), unless it says "no value".
            const readout = page.locator('.entry-dist-note > [data-plot-readout]');
            const text = (await readout.isVisible()) ? (await readout.textContent()) ?? '' : '';
            if (!text || text.includes(STR_EN.plotNoValue)) return null;
            const dist = (await entrySnapshot(page)).dist;
            if (!dist) return null;
            const width = (dist.high - dist.low) / 48;
            const box = (await plot.boundingBox())!;
            const pointer = await page.evaluate(() => (window as unknown as { __clickAt?: { x: number } }).__clickAt?.x ?? NaN);
            const value = dist.low + (pointer - box.x) / box.width * (dist.high - dist.low);
            return `bin:${Math.floor((value - dist.low) / width)}`;
        },
        state: async page => { const now = await entrySnapshot(page); return JSON.stringify({ focused: now.focused, range: now.dist?.range ?? null, low: now.dist?.low, high: now.dist?.high }); },
        acted(before, after) {
            const range = changed(before, after, 'range') as { low: number; high: number } | undefined;
            const { low, high } = JSON.parse(after) as { low: number; high: number };
            if (range) return `bin:${Math.round((range.low - low) / ((high - low) / 48))}`;
            const focused = changed(before, after, 'focused');
            return typeof focused === 'string' ? `row:${focused}` : null;
        },
        already(before, read) {
            const { focused, range, low, high } = JSON.parse(before) as { focused: string | null; range: { low: number } | null; low: number; high: number };
            return read === `row:${focused}` || (!!focused && read === `row:${focused.replace(/#ch\d+$/u, '')}`) || (!!range && read === `bin:${Math.round((range.low - low) / ((high - low) / 48))}`);
        },
        readsAtOnce: true,
        // Each click on a bin narrows the table of a hundred recordings, drawn again.
        clicks: 9,
        // A dot of a recording (a value of its file, not of a channel) goes to its file's row.
        match: (read, acted) => read === acted || (!!read && !read.includes('#ch') && !!acted && acted.replace(/#ch\d+$/u, '') === read),
    },
    'entry-overview.click': {
        async open(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openEntry(page, scanned!, { language: 'en' });
            const plot = page.locator('[data-entry-overview]');
            await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe('');
            return [plot];
        },
        async read(_page, plot) {
            const read = await notedRead(plot);
            return read?.image && read.full && read.value !== undefined && read.name ? `row:${read.name}` : null;
        },
        state: async page => JSON.stringify({ focused: (await entrySnapshot(page)).focused }),
        acted(before, after) { const focused = changed(before, after, 'focused'); return typeof focused === 'string' ? `row:${rowKeyName(focused)}` : null; },
        already(before, read) { const { focused } = JSON.parse(before) as { focused: string | null }; return !!focused && read === `row:${rowKeyName(focused)}`; },
        readsAtOnce: true,
    },
    'compare-overlay.click': {
        async open(page) {
            await openTriggerEvents(page);
            return [page.locator('[data-stage-canvas="overlay"]')];
        },
        async read(_page, plot) {
            const read = await notedRead(plot);
            return read?.layer.event ? `event:${read.layer.event.source}#${read.layer.event.id}` : null;
        },
        state: async page => JSON.stringify({ out: (await page.locator('[data-action="stage-event-toggle"][data-out="true"]').evaluateAll(buttons => buttons.map(button => `${(button as HTMLElement).dataset.path}#${(button as HTMLElement).dataset.event}`))).sort() }),
        acted(before, after) {
            const was = new Set((JSON.parse(before) as { out: string[] }).out), now = new Set((JSON.parse(after) as { out: string[] }).out);
            const flipped = [...[...was].filter(id => !now.has(id)), ...[...now].filter(id => !was.has(id))];
            return flipped.length ? flipped.map(id => `event:${id}`).join(' ') : null;
        },
        already: () => false,
    },
    'track-waveform.click': laneCase('.track-canvas:not(.track-spec-canvas)'),
    'track-spectrogram.click': laneCase('.track-spec-canvas'),
};

/** Where to click `plot`: every point read on a grid over it, ties between read points near each other, the edges between places that read differently, and the grid. */
async function clickPlaces(page: Page, plot: Locator, of: ClickCase): Promise<Array<{ x: number; y: number; why: string }>> {
    const box = (await plot.boundingBox())!;
    const columns = 8, rows = 4;
    const grid: ClickRead[][] = [];
    for (let row = 0; row < rows; row++) {
        grid.push([]);
        for (let column = 0; column < columns; column++) {
            // Off the round fractions of the plot, so no place falls exactly on a bin's edge, where the test's own sum of
            // the value could round to the other side of it than the page's.
            const x = box.x + (column + 0.43) / columns * box.width, y = box.y + (row + 0.43) / rows * box.height;
            await page.evaluate(at => { (window as unknown as { __clickAt: unknown }).__clickAt = at; }, { x, y });
            await page.mouse.move(x, y);
            if (!of.readsAtOnce) await settled(page);
            const id = await of.read(page, plot);
            const place = await readPlace(plot);
            grid[row].push({ x, y, id });
            if (place && id) grid[row].push({ x: box.x + place.x, y: box.y + place.y, id: `${id}\u0000point` });
        }
    }
    const points = new Map<string, { x: number; y: number }>();
    for (const line of grid) for (const item of line) if (item.id?.endsWith('\u0000point')) points.set(item.id, { x: item.x, y: item.y });
    const places: Array<{ x: number; y: number; why: string }> = [];
    const centres = [...points.values()];
    // Two read points near each other (a tie half way, dots drawn over each other).
    for (let a = 0; a < centres.length; a++) for (let b = a + 1; b < centres.length; b++) {
        if (Math.hypot(centres[a].x - centres[b].x, centres[a].y - centres[b].y) <= 24) places.push({ x: (centres[a].x + centres[b].x) / 2, y: (centres[a].y + centres[b].y) / 2, why: 'half way between two read points' });
    }
    // The edge between two neighbouring places that read different things (a bin's edge, a row's).
    const cells = grid.map(line => line.filter(item => !item.id?.endsWith('\u0000point')));
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const here = cells[row][column];
        for (const there of [cells[row][column + 1], cells[row + 1]?.[column]]) if (there && there.id !== here.id) places.push({ x: (here.x + there.x) / 2, y: (here.y + there.y) / 2, why: `the edge between ${here.id} and ${there.id}` });
    }
    // A read point, and a few pixels beside it (in reach, though not on it).
    for (const centre of centres) places.push({ x: centre.x, y: centre.y, why: 'on a read point' }, { x: centre.x, y: centre.y + 9, why: '9 px under a read point' });
    for (const line of cells) for (const item of line) places.push({ x: item.x, y: item.y, why: 'a place of the grid' });
    // Each kind of place in turn, as many as the test's time takes, within the plot.
    const inside = places.filter(place => place.x > box.x + 1 && place.x < box.x + box.width - 1 && place.y > box.y + 1 && place.y < box.y + box.height - 1);
    const kinds = ['half way', 'the edge', 'on a read', '9 px', 'a place'];
    const picked: typeof places = [];
    const most = of.clicks ?? 16;
    for (let round = 0; picked.length < most && round < 40; round++) for (const kind of kinds) { const next = inside.filter(place => place.why.startsWith(kind))[round]; if (next && picked.length < most) picked.push(next); }
    return picked;
}

test.describe('every plot with a click acts on the point its readout reads at the press: the same pick and identity at ties, overlapping points, bin edges and gaps, never a hit test of its own (R7, R13)', () => {
    const rows = ROWS.filter(row => row.value === 'click').map(row => row.id);
    test('every click row of the plot contract table has a case here, and every case a row (R7, R13)', () => {
        expect(Object.keys(CLICK_CASES).sort(), 'R7/R13: give each click row of src/test/plotContracts/charts a case in CLICK_CASES (plotContract.spec.ts), and take off a case whose row is gone').toEqual([...rows].sort());
    });
    for (const id of rows) {
        test(`${id}: the click acts on the readout's read (R7, R13)`, async ({ page }) => {
            const of = CLICK_CASES[id];
            test.skip(!of, `no case for ${id}`);
            test.skip(id !== 'track-waveform.click' && id !== 'track-spectrogram.click' && !scanned, 'no Python backend with wandas for the entry100 fixture');
            for (const plot of await of.open(page)) {
                const places = await clickPlaces(page, plot, of);
                expect(places.length, `${id}: places to click were found on the plot`).toBeGreaterThan(4);
                let checked = 0;
                for (const place of places) {
                    await page.evaluate(at => { (window as unknown as { __clickAt: unknown }).__clickAt = at; }, place);
                    await page.mouse.move(place.x, place.y);
                    if (!of.readsAtOnce) await settled(page);
                    const read = await of.read(page, plot);
                    const before = await of.state(page);
                    await page.mouse.down();
                    await page.mouse.up();
                    await settled(page);
                    const acted = of.acted(before, await of.state(page));
                    // An identity already the page's (a row already focused, the bin already picked) changes nothing to tell.
                    if (read !== null && acted === null && of.already(before, read)) continue;
                    checked += 1;
                    expect.soft((of.match ?? ((a, b) => a === b))(read, acted) ? read : acted, `${id} at ${place.why} (${place.x.toFixed(1)}, ${place.y.toFixed(1)}): the click acted on ${acted ?? 'nothing'}, the readout read ${read ?? 'nothing'}. Rule R7/R13 (docs/display-rules.md, "a click acts on the point the readout reads"): the plot's tap must act through clickOnRead on PlotHoverLayer.clicked's read, never a hit test of its own.`).toBe(read);
                }
                expect(checked, `${id}: clicks were checked`).toBeGreaterThan(2);
            }
        });
    }
});

test('every ui-smoke test fails on a plot on screen that the plot component did not draw, unless plotRegistry.ts lists it (R13)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // A canvas drawn some other way, left on screen: the audit names it once it has had time to be drawn.
    await page.evaluate(() => {
        const stray = document.createElement('canvas');
        stray.className = 'stray-plot';
        Object.assign(stray.style, { position: 'fixed', left: '0', top: '0', width: '120px', height: '60px' });
        document.body.append(stray);
    });
    await expect.poll(() => page.evaluate(() => window.__plotAudit ?? [])).toContain('canvas.stray-plot');
    // Taken away, with the audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { document.querySelector('.stray-plot')?.remove(); window.__plotAudit?.splice(0); });
});

test('every ui-smoke test fails on a draw into a plot made outside the plot component, from the page\'s first script on (R13)', async ({ page }) => {
    // Drawn by the page's own script while it loads: the audit is in before it.
    const html = buildUiSmokeHtml().replace('</body>', '<canvas class="hand-drawn" data-plot="test"></canvas><script nonce="'
        + (/<script nonce="([^"]+)"/u.exec(buildUiSmokeHtml())?.[1] ?? '') + '">document.querySelector(".hand-drawn").getContext("2d").fillRect(0, 0, 4, 4);</script></body>');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => window.__drawnAudit ?? [])).toContain('canvas.hand-drawn: fillRect');
    // Taken away, with the audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { document.querySelector('.hand-drawn')?.remove(); window.__drawnAudit?.splice(0); });
});

test('every ui-smoke test fails on a picture copied into a plot from another canvas by anything but the plot component (R13)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const plot = page.locator('#spectrum-overlay-canvas');
    await expect(plot).toHaveAttribute('data-plot', '');
    // Another canvas's picture laid onto the drawn plot by code of its own, not by paintOverlay.
    await page.evaluate(() => {
        const other = document.createElement('canvas');
        other.width = 8; other.height = 8;
        (document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement).getContext('2d')!.drawImage(other, 0, 0);
    });
    expect(await page.evaluate(() => window.__drawnAudit ?? [])).toContain('#spectrum-overlay-canvas: drawImage');
    // The audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { window.__drawnAudit?.splice(0); });
});

test('every ui-smoke test fails on a plot drawn into before it was marked, or off the page, and on a plot exported so (R13)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        // Drawn by other code, then marked a plot and shown: what it drew is still on it.
        const early = document.createElement('canvas');
        early.className = 'drawn-before-marked';
        early.getContext('2d')!.fillRect(0, 0, 4, 4);
        early.setAttribute('data-plot', '');
        Object.assign(early.style, { position: 'fixed', left: '0', top: '0', width: '120px', height: '60px' });
        document.body.append(early);
        // Marked a plot, drawn into while off the page, then exported.
        const off = document.createElement('canvas');
        off.className = 'drawn-off-page';
        off.setAttribute('data-plot', '');
        off.getContext('2d')!.strokeRect(0, 0, 4, 4);
        off.toDataURL();
        // A report's picture: only its white paper laid under it from outside the component, which is not a draw into the plot.
        const paper = document.createElement('canvas');
        paper.className = 'paper-only';
        paper.setAttribute('data-plot', '');
        const context = paper.getContext('2d')!;
        context.globalCompositeOperation = 'destination-over';
        context.fillRect(0, 0, paper.width, paper.height);
        paper.toDataURL();
    });
    await expect.poll(() => page.evaluate(() => window.__drawnAudit ?? [])).toEqual(expect.arrayContaining([
        expect.stringMatching(/^canvas\.drawn-before-marked: fillRect \(drawn before/u),
        expect.stringMatching(/^canvas\.drawn-off-page: strokeRect \(exported\)$/u),
    ]));
    expect((await page.evaluate(() => window.__drawnAudit ?? [])).filter(name => name.includes('paper-only'))).toEqual([]);
    // Taken away, with the audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { document.querySelector('.drawn-before-marked')?.remove(); window.__drawnAudit?.splice(0); });
});

test('every ui-smoke test fails on a plot on screen whose axis name is in its attributes but not drawn: what is checked is what is drawn (R4)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // A plot that says it has a time axis and a pressure axis, but writes only the time axis's name.
    await page.evaluate(() => {
        const plot = document.createElement('canvas');
        plot.className = 'unnamed-axis';
        plot.setAttribute('data-plot', '');
        plot.setAttribute('data-plot-axes', 'Time [s]|Ghost pressure [Pa]');
        Object.assign(plot.style, { position: 'fixed', left: '0', top: '0', width: '120px', height: '60px' });
        document.body.append(plot);
        // Drawn as the plot component draws (while it says so), so only the missing name is wrong with it.
        const scope = window as { __plotPainting?: number };
        scope.__plotPainting = (scope.__plotPainting ?? 0) + 1;
        plot.getContext('2d')?.fillText('Time [s]', 10, 50);
        scope.__plotPainting -= 1;
    });
    await expect.poll(() => page.evaluate(() => window.__unitAudit ?? []), { timeout: 15_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^canvas\.unnamed-axis .*names "Ghost pressure \[Pa\]" but does not draw it$/u)]));
    // Taken away, with the audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { document.querySelector('.unnamed-axis')?.remove(); window.__unitAudit?.splice(0); });
});

test('every ui-smoke test fails on a plot whose axis name is drawn only on a canvas it is not bound to: a name is never borrowed (R4)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // A plot that draws its time axis's name, and a strip beside it, bound to no plot, that draws the pressure name.
    await page.evaluate(() => {
        const scope = window as { __plotPainting?: number };
        const canvasAt = (className: string, top: string): HTMLCanvasElement => {
            const made = document.createElement('canvas');
            made.className = className;
            Object.assign(made.style, { position: 'fixed', left: '0', top, width: '120px', height: '60px' });
            document.body.append(made);
            return made;
        };
        const plot = canvasAt('borrowing-plot', '0');
        plot.setAttribute('data-plot', '');
        plot.setAttribute('data-plot-axes', 'Time [s]|Ghost pressure [Pa]');
        const strip = canvasAt('borrowed-strip', '70px');
        strip.id = 'borrowed-strip';
        strip.setAttribute('data-plot-axis-canvas', '');
        // Both drawn as the plot component draws (while it says so), so only the borrowing is wrong with them.
        scope.__plotPainting = (scope.__plotPainting ?? 0) + 1;
        plot.getContext('2d')?.fillText('Time [s]', 10, 50);
        strip.getContext('2d')?.fillText('Ghost pressure [Pa]', 10, 30);
        scope.__plotPainting -= 1;
    });
    await expect.poll(() => page.evaluate(() => window.__unitAudit ?? []), { timeout: 15_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^canvas\.borrowing-plot .*names "Ghost pressure \[Pa\]" but does not draw it$/u)]));
    // Bound to the strip by id, as the plot component binds a plot's axis canvases, the same name is the plot's own.
    await page.evaluate(() => { window.__unitAudit?.splice(0); document.querySelector('.borrowing-plot')?.setAttribute('data-plot-named-by', 'borrowed-strip'); });
    await settled(page);
    expect(await page.evaluate(() => (window.__unitAudit ?? []).filter(line => line.startsWith('canvas.borrowing-plot')))).toEqual([]);
    // Taken away, with the audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { document.querySelector('.borrowing-plot')?.remove(); document.querySelector('.borrowed-strip')?.remove(); window.__unitAudit?.splice(0); });
});

test('every ui-smoke test fails on an axis name drawn outside its canvas, on a plot or a plot\'s axis canvas (R4)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // A plot whose value axis's name runs off its left edge and whose unit's line runs off its top.
    await page.evaluate(() => {
        const plot = document.createElement('canvas');
        plot.className = 'name-outside';
        plot.setAttribute('data-plot', '');
        plot.width = 120; plot.height = 60;
        Object.assign(plot.style, { position: 'fixed', left: '0', top: '0', width: '120px', height: '60px' });
        document.body.append(plot);
        const context = plot.getContext('2d')!;
        const scope = window as { __plotPainting?: number };
        scope.__plotPainting = (scope.__plotPainting ?? 0) + 1;
        context.fillText('Inside [s]', 40, 50);
        context.fillText('Off the side [Pa]', -30, 30);
        context.save();
        context.translate(10, 30); context.rotate(-Math.PI / 2); context.textAlign = 'center';
        context.fillText('A quantity too long for sixty pixels', 0, 0);
        context.fillText('[dB SPL re 20 µPa]', 0, 11);
        context.restore();
        scope.__plotPainting -= 1;
    });
    const found = await page.evaluate(() => window.__titleAudit ?? []);
    expect(found.filter(text => text.includes('name-outside')).map(text => /"([^"]+)"/u.exec(text)?.[1]).sort(), 'the audit (canvasAudit.ts) must report each name, and each line of a two-line name, whose ink leaves the bitmap, and no name inside it')
        .toEqual(['A quantity too long for sixty pixels', 'Off the side [Pa]', '[dB SPL re 20 µPa]']);
    // Taken away, with the audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { document.querySelector('.name-outside')?.remove(); window.__titleAudit?.splice(0); });
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
    { name: 'the pair view', open: async page => { await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' }); await page.locator('[data-action="set-pair-reference"]').first().click(); await expect(page.locator('[data-pair-lane][data-plot]')).toHaveCount(3); } },
    { name: 'the comparison (overlay and Δ)', open: async page => { await openComparison(page, scanned!); await page.locator('[data-action="stage-diff"]').click(); await expect(page.locator('[data-stage-diff]')).toBeVisible(); } },
    { name: 'the comparison in lanes', open: async page => { await openComparison(page, scanned!); await page.locator('[data-action="stage-layout"]').click(); await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'lanes'); } },
];
for (const screen of NAME_SCREENS) {
    test(`every axis name stays inside its canvas on narrow and short plots too: ${screen.name} (R4)`, async ({ page }) => {
        test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
        await page.setViewportSize(NAME_SIZES[0]);
        await screen.open(page);
        await settled(page);
        const plots = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas[data-plot][data-plot-axes]')).filter(canvas => canvas.checkVisibility()).length);
        expect(plots, `${screen.name}: no plot with named axes is on screen, so this test checks nothing; open the screen as the other tests of this file do`).toBeGreaterThan(0);
        for (const size of NAME_SIZES) {
            await page.setViewportSize(size);
            await settled(page);
            expect.soft(await page.evaluate(() => window.__titleAudit ?? []), `${screen.name} at ${size.width}×${size.height}: an axis name was drawn outside its canvas (docs/display-rules.md R4). `
                + 'Fix it in the shared plot component, never per chart: fitAxisTitle (src/webview/plot/axisTitle.ts) must be given the room the name really has, and stagePanes.ts paintValueTitle must keep it inside its gutter.').toEqual([]);
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
                    + 'an axis name was drawn outside its canvas (docs/display-rules.md R4). Fix it in the shared plot component (axisTitle.ts fitAxisTitle, stagePanes.ts paintValueTitle), never per chart.').toEqual([]);
            }
        }
        // Reported above with the size it happened at; cleared so the end-of-test audit does not report it again.
        await page.evaluate(() => { window.__titleAudit?.splice(0); });
    });
}

test('every ui-smoke test fails on a plot on screen that drew a louder compared line over a quieter one (R6)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // A plot whose lines were drawn −40 dB first, then −20 dB over it: the louder one hides the quieter.
    await page.evaluate(() => {
        const plot = document.createElement('canvas');
        plot.className = 'loud-on-top';
        plot.setAttribute('data-plot', '');
        plot.setAttribute('data-plot-order', '-40.00,-20.00');
        Object.assign(plot.style, { position: 'fixed', left: '0', top: '0', width: '120px', height: '60px' });
        document.body.append(plot);
    });
    await expect.poll(() => page.evaluate(() => window.__orderAudit ?? [])).toContain('canvas.loud-on-top drew levels -40.00,-20.00');
    // Taken away, with the audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { document.querySelector('.loud-on-top')?.remove(); window.__orderAudit?.splice(0); });
});
