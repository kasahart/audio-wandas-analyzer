import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { datasetRows } from '../shared/dataset/datasetTable';
import { OVERVIEW_MARGINS, overviewPicture } from '../webview/runtime/entryPlots';
import { createSidePlots, type SidePlotsDeps } from '../webview/runtime/entrySidePlots';
import { sharedLevelLabel } from '../shared/utils/format';
import { entryScreenHtml } from '../webview/runtime/entryTableHtml';
import { FULL_PLOT_WINDOW } from '../webview/runtime/plotInteraction';

const strings = getStrings('en');

function setup() {
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
        rows: () => rows, focusedFile: () => null,
        paintDistribution: () => calls.push('distribution'), paintHeld: () => calls.push('held'), heldPicture: () => null,
        pickRow: key => calls.push(`pick ${key}`),
    };
    const plots = createSidePlots(deps);
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

test('a click on the strip picks the row under it; the gestures add a zoom box and a range popover', () => {
    const { document, side, overview, plots, calls } = setup();
    plots.attach();
    assert.ok(side.querySelector('.entry-zoom-box[hidden]'));
    assert.ok(document.getElementById('entry-range-popover'));
    // Four rows over 100 px of plot, top first.
    overview.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 100 + OVERVIEW_MARGINS.top + OVERVIEW_MARGINS.bottom, bottom: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) });
    const click = (clientY: number): void => { overview.dispatchEvent(new document.defaultView!.MouseEvent('click', { clientY, bubbles: true })); };
    click(OVERVIEW_MARGINS.top + 10);
    click(OVERVIEW_MARGINS.top + 60);
    click(OVERVIEW_MARGINS.top + 140);
    assert.deepEqual(calls, ['pick /d/a.wav', 'pick /d/c.wav'], 'below the rows is no row');
});

test('the overview colour scale and the dataset table name the recordings\' shared level reference, plain dB once they differ', () => {
    assert.equal(sharedLevelLabel([]), 'dBFS');
    assert.equal(sharedLevelLabel(['dBFS', 'dBFS']), 'dBFS');
    assert.equal(sharedLevelLabel(['dB re 1 input unit']), 'dB re 1 input unit');
    assert.equal(sharedLevelLabel(['dB SPL re 20 µPa']), 'dB SPL re 20 µPa');
    assert.equal(sharedLevelLabel(['dBFS', 'dB re 1 input unit']), 'dB');
    assert.equal(sharedLevelLabel(['dB SPL re 20 µPa', 'dBFS']), 'dB');
    const { plots } = setup();
    const input = (levelReferenceLabel: string, calibrationStatus: 'calibrated' | 'uncalibrated') => ({ id: 'x', fs: 48000, channels: [0], durationS: 1, unit: 'Pa', ref: 2e-5, levelReferenceLabel, calibrationStatus, fullScale: true });
    assert.equal(plots.levelLabel(), 'dBFS');
    plots.noteResult('/d/a.wav', { ok: true, input: input('dB SPL re 20 µPa', 'calibrated') });
    assert.equal(plots.levelLabel(), 'dB SPL re 20 µPa');
    plots.noteResult('/d/b.wav', { ok: true, input: input('dBFS', 'uncalibrated') });
    assert.equal(plots.levelLabel(), 'dB');
    plots.noteResult('/d/b.wav', { ok: false, reason: 'unreadable' });
    assert.equal(plots.levelLabel(), 'dB SPL re 20 µPa', 'a file that cannot be read has no reference');
    plots.clear();
    assert.equal(plots.levelLabel(), 'dBFS');
});

test('the strip is a heatmap of the table: a row per table row counted down from the top, the loudest per line when they outnumber its lines', () => {
    const rows = ['/d/a.wav', '/d/b.wav', '/d/c.wav', '/d/d.wav'].map(filePath => ({ filePath }));
    const bands = new Map<string, (number | null)[]>([['/d/a.wav', [-40.4, -30]], ['/d/b.wav', [-20, null]], ['/d/d.wav', [-60, -10.2]]]);
    const whole = overviewPicture(rows, bands, FULL_PLOT_WINDOW, 100);
    assert.ok(whole);
    // Bottom first, as the axis runs: the last table row at the bottom, each at minus its centre's place.
    assert.deepEqual(whole.view.ys, [-3.5, -2.5, -1.5, -0.5]);
    assert.deepEqual(whole.names, ['d.wav', 'c.wav', 'b.wav', 'a.wav']);
    assert.deepEqual(whole.view.matrix?.[3].slice(0, 2), [-40.4, -30]);
    assert.ok(whole.view.matrix?.[1].every(value => value === null), 'a row not scanned yet has no cells');
    assert.deepEqual(whole.whole.ys, [-4, 0], 'the whole table\'s axis, for a zoomed strip');
    assert.deepEqual(whole.range, { min: -60, max: -10 });
    // Two lines for four rows: each holds the loudest of its two rows per band.
    const binned = overviewPicture(rows, bands, FULL_PLOT_WINDOW, 2);
    assert.deepEqual(binned?.view.ys, [-3, -1]);
    assert.deepEqual(binned?.view.matrix?.map(row => row.slice(0, 2)), [[-60, -10.2], [-20, -30]]);
    // Zoomed to the top half: only its rows, on the whole table's axis; the shades keep every row's range.
    const top = overviewPicture(rows, bands, { x: FULL_PLOT_WINDOW.x, y: { start: 0.5, end: 1 } }, 100);
    assert.deepEqual(top?.view.ys, [-1.5, -0.5]);
    assert.deepEqual(top?.range, { min: -60, max: -10 });
    assert.equal(overviewPicture(rows, new Map(), FULL_PLOT_WINDOW, 100), null, 'no levels, nothing to draw');
});
