import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { datasetRows } from '../shared/dataset/datasetTable';
import { OVERVIEW_MARGINS, overviewPicture, paintOverview } from '../webview/runtime/entryPlots';
import { createSidePlots, type SidePlotsDeps } from '../webview/runtime/entrySidePlots';
import { scanAnswer, type ScanAnswer } from '../webview/runtime/answerStore';
import { folderReference } from '../webview/runtime/figureModel';
import type { ScanResult } from '../shared/protocol/backendProtocol';
import { commonLevelLabel } from '../shared/utils/format';
import { entryScreenHtml } from '../webview/runtime/entryTableHtml';
import { FULL_PLOT_WINDOW } from '../webview/runtime/plotInteraction';
import { BAND_CENTERS_HZ } from '../webview/runtime/entryTable';
import { stageHover, stageStep } from '../webview/runtime/stagePanes';
import { fontPixels } from '../webview/plot/axisTitle';

const strings = getStrings('en');

function setup(stale: Set<string> = new Set()) {
    const dom = new JSDOM('<!doctype html><body><div id="hint-footer"></div></body>');
    const { document } = dom.window;
    const host = document.createElement('div');
    host.innerHTML = entryScreenHtml(strings);
    const screen = host.firstElementChild as HTMLElement;
    document.body.append(screen);
    screen.hidden = false;
    const query = <T extends Element>(selector: string): T => {
        const element = screen.querySelector<T>(selector);
        assert.ok(element, selector);
        return element;
    };
    const side = query<HTMLElement>('.entry-side');
    const overview = query<HTMLCanvasElement>('[data-entry-overview]');
    const heldCanvas = query<HTMLCanvasElement>('[data-entry-held-canvas]');
    // jsdom has no 2D context; the painters then draw nothing.
    for (const canvas of [overview, heldCanvas]) canvas.getContext = (() => null) as HTMLCanvasElement['getContext'];
    const frames: Array<() => void> = [];
    const calls: string[] = [];
    const rows = datasetRows(['/d/a.wav', '/d/b.wav', '/d/c.wav', '/d/d.wav'], '/d', new Map(), new Map());
    const deps: SidePlotsDeps = {
        document, window: { requestAnimationFrame: fn => { frames.push(() => fn(0)); return frames.length; } }, strings,
        screen, side, body: query('[data-entry-rows]'), tableWrap: query('.entry-table-wrap'), overview, heldCanvas,
        rows: () => rows, focusedRow: () => null,
        paintDistribution: () => calls.push('distribution'), paintHeld: () => calls.push('held'), heldPicture: () => null,
        pickRow: key => calls.push(`pick ${key}`),
        // The folder's reference and each recording's answer, as the entry model and the answer store give them: a
        // stale result is an answer of another chain, never ready.
        reference: () => folderReference(answers(['/d/a.wav', '/d/b.wav', '/d/c.wav', '/d/d.wav'])),
        answers: paths => answers(paths),
    };
    const results = new Map<string, ScanResult>();
    const answers = (paths: readonly string[]): ScanAnswer[] => paths.map(path => (stale.has(path) ? { state: 'stale' as const, identity: scanAnswer(path, undefined).identity, value: scanAnswer(path, results.get(path)) } as unknown as ScanAnswer : scanAnswer(path, results.get(path))));
    const created = createSidePlots(deps);
    const plots = { ...created, noteResult: (path: string, result: ScanResult) => { results.set(path, result); created.noteResult(path, result); }, clear: () => { results.clear(); created.clear(); } };
    const flush = (): void => { for (const frame of frames.splice(0)) frame(); };
    return { dom, document, screen, side, overview, heldCanvas, plots, calls, frames, flush };
}

test('a plot keeps its zoom while it shows the same thing, and starts whole for something else', () => {
    const { plots } = setup();
    assert.equal(plots.window('held'), FULL_PLOT_WINDOW);
    assert.equal(plots.keepWindow('held', 'a'), FULL_PLOT_WINDOW);
    assert.equal(plots.keepWindow('held', 'a'), FULL_PLOT_WINDOW, 'nothing zoomed yet');
    assert.equal(plots.keepWindow('held', 'b'), FULL_PLOT_WINDOW);
});

test('a recording of an earlier chain is neither coloured on the strip nor sets its scale or reference', () => {
    const stale = new Set<string>();
    const { plots } = setup(stale);
    const input = (unit: string, ref: number, label: string) => ({ id: 'x', fs: 48000, channels: [0], durationS: 1, unit, ref, levelReferenceLabel: label, calibrationStatus: unit === 'Pa' ? 'calibrated' as const : 'uncalibrated' as const, fullScale: true });
    plots.noteResult('/d/a.wav', { ok: true, input: input('Pa', 2e-5, 'dB SPL re 20 µPa'), thirdOctDb: [[40, 50]] });
    plots.noteResult('/d/b.wav', { ok: true, input: input('FS', 1, 'dBFS'), thirdOctDb: [[-40, -30]] });
    plots.noteResult('/d/c.wav', { ok: true, input: input('FS', 1, 'dBFS'), thirdOctDb: [[-42, -32]] });
    assert.equal(plots.levelLabel(), 'dBFS', 'the commonest reference');
    assert.equal(plots.onLevelAxis('/d/b.wav'), true);
    stale.add('/d/b.wav');
    stale.add('/d/c.wav');
    assert.equal(plots.levelLabel(), 'dB SPL re 20 µPa', 'the stale ones no longer set the reference');
    assert.equal(plots.onLevelAxis('/d/b.wav'), false, 'nor are on its scale');
    assert.equal(plots.onLevelAxis('/d/a.wav'), true);
});

test('a recording whose answer is no longer fresh (its file written over, another chain) gives the strip no level, though its result is kept (B4)', () => {
    const stale = new Set<string>();
    const { plots } = setup(stale);
    const input = { id: 'x', fs: 48000, channels: [0], durationS: 1, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated' as const, fullScale: true };
    plots.noteResult('/d/a.wav', { ok: true, input, thirdOctDb: [[-40, -30]] });
    plots.noteResult('/d/b.wav', { ok: true, input, thirdOctDb: [[-42, -32]] });
    assert.deepEqual(plots.levels('/d/b.wav'), [-42, -32]);
    stale.add('/d/b.wav');
    assert.equal(plots.levels('/d/b.wav'), undefined, 'a stale answer\'s levels are not read');
    assert.deepEqual(plots.levels('/d/a.wav'), [-40, -30]);
    stale.delete('/d/b.wav');
    assert.deepEqual(plots.levels('/d/b.wav'), [-42, -32], 'fresh again, it is read again');
});

test('the strip takes the folder\'s one reference, and a cell of an uncalibrated recording on a mixed axis says so itself (R4)', () => {
    const { plots } = setup();
    const input = (status: 'calibrated' | 'uncalibrated') => ({ id: 'x', fs: 48000, channels: [0], durationS: 1, unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: status, fullScale: true });
    plots.noteResult('/d/a.wav', { ok: true, input: input('calibrated'), thirdOctDb: [[-40, -30]] });
    plots.noteResult('/d/b.wav', { ok: true, input: input('uncalibrated'), thirdOctDb: [[-42, -32]] });
    assert.equal(plots.levelWordOf('/d/a.wav'), '');
    assert.match(plots.levelWordOf('/d/b.wav'), /uncalibrated/i);
    const rows = [{ filePath: '/d/a.wav' }, { filePath: '/d/b.wav' }];
    const bands = new Map<string, (number | null)[]>([['/d/a.wav', BAND_CENTERS_HZ.map(() => -40)], ['/d/b.wav', BAND_CENTERS_HZ.map(() => -42)]]);
    const picture = overviewPicture(rows, bands, FULL_PLOT_WINDOW, 100, path => plots.levelWordOf(path));
    const names = (picture?.names ?? []).flat();
    assert.ok(names.some(name => /b\.wav.*uncalibrated/i.test(name)), JSON.stringify(names));
    assert.ok(names.some(name => name === 'a.wav'), 'the calibrated one says nothing');
});

test('painting waits for the next frame, once however often it is asked; the distribution only when asked for', () => {
    const { side, overview, heldCanvas, plots, calls, frames, flush } = setup();
    plots.schedule();
    plots.schedule(false);
    assert.equal(frames.length, 1);
    flush();
    assert.deepEqual(calls, ['distribution'], 'a side panel with no width draws only the distribution');
    Object.defineProperty(side, 'offsetWidth', { value: 320 });
    plots.schedule(false);
    flush();
    assert.deepEqual(calls, ['distribution', 'held']);
    assert.equal(overview.dataset.window, '0.000-1.000|0.000-1.000');
    assert.equal(heldCanvas.dataset.window, '0.000-1.000|0.000-1.000');
    plots.noteResult('/d/a.wav', { ok: true, input: { id: 'x', fs: 48000, channels: [0], durationS: 1, unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true }, thirdOctDb: [[40, 50]] });
    plots.noteResult('/d/b.wav', { ok: false, reason: 'unreadable' });
    plots.clear();
    plots.schedule();
    flush();
    assert.deepEqual(calls.slice(2), ['distribution', 'held']);
});

test('a click on the strip (the plot gestures\' tap: a press that stays put) picks the row under it, a drag none; the gestures add a zoom box and a range popover', () => {
    const { document, side, overview, plots, calls } = setup();
    plots.attach();
    assert.ok(side.querySelector('.entry-zoom-box[hidden]'));
    assert.ok(document.getElementById('entry-range-popover'));
    // Four rows over 100 px of plot, top first.
    const height = 100 + OVERVIEW_MARGINS.top + OVERVIEW_MARGINS.bottom;
    overview.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height, bottom: height, right: 200, x: 0, y: 0, toJSON: () => ({}) });
    const view = document.defaultView!;
    const fire = (target: EventTarget, type: string, clientY: number, clientX = OVERVIEW_MARGINS.left + 50): void => {
        target.dispatchEvent(new view.MouseEvent(type, { clientX, clientY, button: 0, bubbles: true }));
    };
    const click = (clientY: number): void => { fire(overview, 'mousedown', clientY); fire(document, 'mouseup', clientY); };
    click(OVERVIEW_MARGINS.top + 10);
    click(OVERVIEW_MARGINS.top + 60);
    click(OVERVIEW_MARGINS.top + 140);
    assert.deepEqual(calls, ['pick /d/a.wav', 'pick /d/c.wav'], 'below the rows is no row');
    // A press dragged into a box zooms instead: no row is picked.
    fire(overview, 'mousedown', OVERVIEW_MARGINS.top + 10);
    fire(document, 'mousemove', OVERVIEW_MARGINS.top + 80, OVERVIEW_MARGINS.left + 150);
    fire(document, 'mouseup', OVERVIEW_MARGINS.top + 80, OVERVIEW_MARGINS.left + 150);
    assert.deepEqual(calls, ['pick /d/a.wav', 'pick /d/c.wav'], 'a drag picks no row');
    // A click event alone (no press on the plot) is not the plot's: the strip answers only the shared gestures.
    overview.dispatchEvent(new view.MouseEvent('click', { clientX: OVERVIEW_MARGINS.left + 50, clientY: OVERVIEW_MARGINS.top + 10, bubbles: true }));
    assert.deepEqual(calls, ['pick /d/a.wav', 'pick /d/c.wav']);
});

test('a recording of several channels has a strip row per channel: each its own levels, named by its channel', () => {
    const rows = [
        { filePath: '/d/a.wav', key: '/d/a.wav#ch1', ch: 1, channels: 2 },
        { filePath: '/d/a.wav', key: '/d/a.wav#ch2', ch: 2, channels: 2 },
        { filePath: '/d/b.wav', key: '/d/b.wav', ch: 1, channels: 1 },
    ];
    const bands = new Map<string, (number | null)[]>([['/d/a.wav#ch1', [-40, -30]], ['/d/a.wav#ch2', [-20, -50]], ['/d/b.wav', [-35, -35]]]);
    const picture = overviewPicture(rows, bands, FULL_PLOT_WINDOW, 100);
    // Bottom first: b, then a's ch2, then a's ch1.
    assert.deepEqual(picture?.view.matrix?.map(row => row.slice(0, 2)), [[-35, -35], [-20, -50], [-40, -30]]);
    assert.deepEqual(picture?.names.map(row => row[0]), ['b.wav', 'a.wav ch2', 'a.wav ch1']);
});

test('the strip marks the focused table row, a channel\'s own row of a recording of several', () => {
    const dom = new JSDOM('<!doctype html><body><div class="holder"><canvas></canvas><div data-entry-overview-frame></div><div data-entry-overview-focus></div></div></body>');
    const { document } = dom.window;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    Object.defineProperties(canvas, { clientWidth: { value: 300 }, clientHeight: { value: 100 + OVERVIEW_MARGINS.top + OVERVIEW_MARGINS.bottom } });
    const context = new Proxy({}, {
        get: (_target, key) => (key === 'measureText' ? () => ({ width: 10 }) : key === 'createImageData' || key === 'getImageData' ? (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
            : key.toString().startsWith('create') ? () => ({ addColorStop: () => undefined }) : () => undefined),
        set: () => true,
    });
    canvas.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
    const rows = [
        { filePath: '/d/a.wav', key: '/d/a.wav#ch1', ch: 1, channels: 2 },
        { filePath: '/d/a.wav', key: '/d/a.wav#ch2', ch: 2, channels: 2 },
    ];
    const bands = new Map<string, (number | null)[]>([['/d/a.wav#ch1', [-40, -30]], ['/d/a.wav#ch2', [-20, -50]]]);
    const mark = document.querySelector<HTMLElement>('[data-entry-overview-focus]')!;
    paintOverview(canvas, strings, rows, bands, { first: 0, last: 1 }, '/d/a.wav#ch2', FULL_PLOT_WINDOW, { label: 'dBFS', calibrated: false });
    assert.equal(mark.hidden, false);
    // Two rows over 100 px: ch2's row is the lower half.
    assert.equal(mark.style.top, `${OVERVIEW_MARGINS.top + 50}px`);
    paintOverview(canvas, strings, rows, bands, { first: 0, last: 1 }, '/d/a.wav#ch1', FULL_PLOT_WINDOW, { label: 'dBFS', calibrated: false });
    assert.equal(mark.style.top, `${OVERVIEW_MARGINS.top}px`);
});

test('the side plots keep each channel\'s own levels, as the table\'s rows are keyed, and a new result replaces all of them', () => {
    const { plots } = setup();
    const input = { id: 'x', fs: 48000, channels: [0, 1], durationS: 1, unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated' as const, fullScale: true };
    plots.noteResult('/d/a.wav', { ok: true, input, thirdOctDb: [[-40, -30], [-20, -50]] });
    assert.deepEqual(plots.levels('/d/a.wav#ch1'), [-40, -30]);
    assert.deepEqual(plots.levels('/d/a.wav#ch2'), [-20, -50]);
    assert.equal(plots.levels('/d/a.wav'), undefined, 'no channel-averaged row: the table has none');
    plots.noteResult('/d/a.wav', { ok: true, input: { ...input, channels: [0] }, thirdOctDb: [[-10, -10]] });
    assert.deepEqual(plots.levels('/d/a.wav'), [-10, -10]);
    assert.equal(plots.levels('/d/a.wav#ch2'), undefined);
    plots.noteResult('/d/a.wav', { ok: false, reason: 'unreadable' });
    assert.equal(plots.levels('/d/a.wav'), undefined);
});

test('the overview colour scale and the dataset table name the recordings\' most common level reference, never plain dB, and say uncalibrated (R4)', () => {
    assert.equal(commonLevelLabel([]), 'dBFS');
    assert.equal(commonLevelLabel(['dBFS', 'dBFS']), 'dBFS');
    assert.equal(commonLevelLabel(['dB re 1 input unit']), 'dB re 1 input unit');
    assert.equal(commonLevelLabel(['dB SPL re 20 µPa']), 'dB SPL re 20 µPa');
    assert.equal(commonLevelLabel(['dBFS', 'dB SPL re 20 µPa', 'dB SPL re 20 µPa']), 'dB SPL re 20 µPa');
    const { plots } = setup();
    const input = (levelReferenceLabel: string, calibrationStatus: 'calibrated' | 'uncalibrated') => ({ id: 'x', fs: 48000, channels: [0], durationS: 1, unit: 'Pa', ref: 2e-5, levelReferenceLabel, calibrationStatus, fullScale: true });
    const leq = strings.dsLeq;
    assert.equal(plots.levelLabel(), 'dBFS');
    plots.noteResult('/d/a.wav', { ok: true, input: input('dB SPL re 20 µPa', 'calibrated'), thirdOctDb: [[60, 61]] });
    assert.equal(plots.levelLabel(), 'dB SPL re 20 µPa');
    assert.equal(plots.levelName(leq), 'Leq A-weighted [dB SPL re 20 µPa]');
    plots.noteResult('/d/b.wav', { ok: true, input: input('dBFS', 'uncalibrated'), thirdOctDb: [[-30, -31]] });
    plots.noteResult('/d/c.wav', { ok: true, input: input('dBFS', 'uncalibrated'), thirdOctDb: [[-32, -33]] });
    assert.equal(plots.levelLabel(), 'dBFS', 'the most common reference, not a bare dB');
    assert.equal(plots.levelName(leq), 'Leq A-weighted, uncalibrated [dBFS]', 'uncalibrated says so');
    plots.noteResult('/d/b.wav', { ok: false, reason: 'unreadable' });
    plots.noteResult('/d/c.wav', { ok: false, reason: 'unreadable' });
    assert.equal(plots.levelLabel(), 'dB SPL re 20 µPa', 'a file that cannot be read has no reference');
    plots.clear();
    assert.equal(plots.levelLabel(), 'dBFS');
});

test('the strip is a heatmap of the table: a row per table row counted down from the top, each bucket\'s quietest and loudest when they outnumber its lines (R2)', () => {
    const rows = ['/d/a.wav', '/d/b.wav', '/d/c.wav', '/d/d.wav'].map(filePath => ({ filePath }));
    const bands = new Map<string, (number | null)[]>([['/d/a.wav', [-40.4, -30]], ['/d/b.wav', [-20, null]], ['/d/d.wav', [-60, -10.2]]]);
    const whole = overviewPicture(rows, bands, FULL_PLOT_WINDOW, 100);
    assert.ok(whole);
    // Bottom first, as the axis runs: the last table row at the bottom, each at minus its centre's place.
    assert.deepEqual(whole.view.ys, [-3.5, -2.5, -1.5, -0.5]);
    // A cell names only the rows whose levels it used: c (not scanned yet) names nothing, nor does b where it has no level.
    assert.deepEqual(whole.names.map(row => row[0]), ['d.wav', '', 'b.wav', 'a.wav']);
    assert.equal(whole.names[2][1], '', 'b has no level in the second band');
    assert.deepEqual(whole.view.matrix?.[3].slice(0, 2), [-40.4, -30]);
    assert.ok(whole.view.matrix?.[1].every(value => value === null), 'a row not scanned yet has no cells');
    assert.deepEqual(whole.whole.ys, [-4, 0], 'the whole table\'s axis, for a zoomed strip');
    assert.deepEqual(whole.range, { min: -60, max: -10 });
    // Two lines for four rows: one bucket, its quietest and loudest per band, the one from the earlier row above.
    const binned = overviewPicture(rows, bands, FULL_PLOT_WINDOW, 2);
    assert.deepEqual(binned?.view.ys, [-3, -1]);
    assert.deepEqual(binned?.view.matrix?.map(row => row.slice(0, 2)), [[-60, -10.2], [-20, -30]]);
    // The readout names the recording each value is from: b's −20 dB and a's −30 dB share a line.
    assert.deepEqual(binned?.names.map(row => row.slice(0, 2)), [['d.wav', 'd.wav'], ['b.wav', 'a.wav']]);
    // A bucket's band no row has a level in names no row (not the bucket's first one).
    assert.deepEqual(binned?.names.map(row => row[2]), ['', '']);
    // A quiet row among loud ones is drawn, not left out for its bucket's loudest (R2): four lines, two buckets of four.
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(name => ({ filePath: `/d/${name}.wav` }));
    const levels = new Map<string, (number | null)[]>([-10, -50, -12, -14, -20, -21, -90, -22].map((value, index) => [many[index].filePath, [value]]));
    const extremes = overviewPicture(many, levels, FULL_PLOT_WINDOW, 4);
    assert.deepEqual(extremes?.view.ys, [-7, -5, -3, -1]);
    assert.deepEqual(extremes?.view.matrix?.map(row => row[0]), [-90, -20, -50, -10]);
    assert.deepEqual(extremes?.names.map(row => row[0]), ['g.wav', 'e.wav', 'b.wav', 'a.wav']);
    // Zoomed to the top half: only its rows, on the whole table's axis; the shades keep every row's range.
    const top = overviewPicture(rows, bands, { x: FULL_PLOT_WINDOW.x, y: { start: 0.5, end: 1 } }, 100);
    assert.deepEqual(top?.view.ys, [-1.5, -0.5]);
    assert.deepEqual(top?.range, { min: -60, max: -10 });
    assert.equal(overviewPicture(rows, new Map(), FULL_PLOT_WINDOW, 100), null, 'no levels, nothing to draw');
});

test('the strip\'s colour range holds every table row\'s level, not only the rows the window draws, and opens at round ends (R9)', () => {
    // 300 rows on 10 lines: each bucket of 60 rows draws its quietest and its loudest.
    const rows = Array.from({ length: 300 }, (_, index) => ({ filePath: `/d/${index}.wav` }));
    const bands = new Map<string, (number | null)[]>(rows.map((row, index) => [row.filePath, [-50 + (index % 7), -40 + (index % 5)]]));
    bands.set('/d/151.wav', [-97.3, -40]);
    bands.set('/d/20.wav', [-50, -3.4]);
    const picture = overviewPicture(rows, bands, FULL_PLOT_WINDOW, 10);
    assert.ok(picture);
    const drawn = (picture.view.matrix ?? []).flat().filter((value): value is number => value !== null);
    assert.ok(drawn.includes(-97.3), 'the quiet row is drawn, its bucket\'s quietest (R2)');
    assert.deepEqual(picture.range, { min: -100, max: 0 });
    // Zoomed to rows that hold neither end, the colours still span every row.
    const zoomed = overviewPicture(rows, bands, { x: FULL_PLOT_WINDOW.x, y: { start: 0, end: 0.1 } }, 10);
    assert.deepEqual(zoomed?.range, { min: -100, max: 0 });
});

test('the strip\'s colours reach no more than 100 dB under its loudest level: a digitally silent recording (−300 dB) does not set the bottom (R9)', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ filePath: `/d/${index}.wav` }));
    const bands = new Map<string, (number | null)[]>(rows.map((row, index) => [row.filePath, [-50 + index, -40]]));
    bands.set('/d/3.wav', [-300, -300]);
    bands.set('/d/9.wav', [-4.2, -40]);
    const picture = overviewPicture(rows, bands, FULL_PLOT_WINDOW, 10);
    assert.deepEqual(picture?.range, { min: -110, max: 0 });
});

test('the strip is read at the table row under the pointer, never a row its bucket draws, and ← / → step that row\'s bands (R7)', () => {
    const { document, overview } = setup();
    // A context that draws nothing but answers what the plot component asks of it.
    const image = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(Math.max(1, width * height * 4)) });
    // Whatever else it is asked for (a gradient, a path) is an object that takes any call.
    const anything: object = new Proxy(() => undefined, { get: (_target, prop) => (prop === 'then' ? undefined : () => anything), set: () => true });
    overview.getContext = (() => new Proxy({}, {
        get: (_target, prop) => (prop === 'measureText' ? () => ({ width: 10 }) : prop === 'createImageData' || prop === 'getImageData' ? (...size: number[]) => image(size.at(-2) ?? 1, size.at(-1) ?? 1) : () => anything),
        set: () => true,
    })) as unknown as HTMLCanvasElement['getContext'];
    // 400 rows on a strip about 90 pixels high: each picture line draws the loudest of four or five rows.
    const rows = Array.from({ length: 400 }, (_, index) => ({ filePath: `/d/r${index}.wav` }));
    const bands = new Map<string, (number | null)[]>(rows.map((row, index) => [row.filePath, BAND_CENTERS_HZ.map((_, band) => (index === 201 ? -21.5 - band : -20 - (index % 3) - band))]));
    const plot = paintOverview(overview, strings, rows, bands, { first: 0, last: 399 }, null, FULL_PLOT_WINDOW, { label: 'dBFS', calibrated: false }).drawn;
    assert.ok(plot);
    const view = plot.image?.layer.view ?? plot.lines[0]?.view;
    assert.ok((view?.matrix?.length ?? 0) < rows.length, 'the rows are thinned to be drawn');
    assert.ok(!(view?.matrix ?? []).some(line => line.includes(-21.5)), 'row 201 is neither its bucket\'s quietest nor its loudest, so it is not drawn');
    // The pointer on row 201's place, at band 0.
    const heat = plot.image;
    assert.ok(heat, 'a heatmap');
    const at = heat.placeOf(BAND_CENTERS_HZ[0], -(201 + 0.5));
    const read = stageHover(plot, at.x, at.y);
    assert.equal(read?.value, -21.5);
    assert.match(read?.text ?? '', /r201\.wav/);
    const next = read ? stageStep(plot, read, 1) : null;
    assert.equal(next?.value, -22.5, '→ is the same row\'s next band');
    assert.match(next?.text ?? '', /r201\.wav/);
    void document;
});

test('the strip\'s row numbers stay clear of its axis name, a table of a thousand rows too (R4)', () => {
    const dom = new JSDOM('<!doctype html><body><div class="holder"><canvas></canvas><div data-entry-overview-frame></div><div data-entry-overview-focus></div></div></body>');
    const canvas = dom.window.document.querySelector('canvas') as HTMLCanvasElement;
    Object.defineProperties(canvas, { clientWidth: { value: 300 }, clientHeight: { value: 200 } });
    const texts: Array<{ text: string; x: number; font: string; align: string; turned: boolean }> = [];
    const state = { font: '10px sans-serif', textAlign: 'left', turned: false };
    const saved: Array<typeof state> = [];
    const context = new Proxy({}, {
        get: (_target, key) => key === 'measureText' ? (text: string) => ({ width: text.length * 6 * fontPixels(state.font) / 10 })
            : key === 'fillText' ? (text: string, x: number) => { texts.push({ text, x, font: state.font, align: state.textAlign, turned: state.turned }); }
            : key === 'save' ? () => { saved.push({ ...state }); } : key === 'restore' ? () => { Object.assign(state, saved.pop() ?? state); }
            : key === 'rotate' ? () => { state.turned = true; }
            : key === 'font' || key === 'textAlign' ? state[key] : key === 'createImageData' || key === 'getImageData' ? (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) })
            : key.toString().startsWith('create') ? () => ({ addColorStop: () => undefined }) : () => undefined,
        set: (_target, key, value) => { if (key === 'font' || key === 'textAlign') state[key] = String(value); return true; },
    });
    canvas.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
    const rows = Array.from({ length: 1000 }, (_, index) => ({ filePath: `/d/${index}.wav` }));
    const bands = new Map<string, (number | null)[]>(rows.map(row => [row.filePath, [-40, -30]]));
    paintOverview(canvas, strings, rows, bands, { first: 0, last: 10 }, null, FULL_PLOT_WINDOW, { label: 'dBFS', calibrated: false });
    const name = texts.filter(item => item.turned);
    const numbers = texts.filter(item => !item.turned && item.align === 'right' && /^\d+$/u.test(item.text));
    assert.ok(name.length >= 1 && numbers.some(item => item.text.length >= 3), JSON.stringify(texts));
    const linePx = fontPixels(name[0].font);
    const nameRight = 10 + ((name.length - 1) / 2) * linePx * 1.1 + linePx / 2;
    for (const item of numbers) {
        const left = item.x - item.text.length * 6 * fontPixels(item.font) / 10;
        assert.ok(left >= nameRight, `row ${item.text} starts at ${left.toFixed(1)} px, the name ends at ${nameRight.toFixed(1)} px`);
    }
});
