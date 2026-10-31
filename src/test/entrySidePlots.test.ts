import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { datasetRows } from '../shared/dataset/datasetTable';
import { OVERVIEW_MARGINS } from '../webview/runtime/entryPlots';
import { createSidePlots, type SidePlotsDeps } from '../webview/runtime/entrySidePlots';
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
    plots.noteResult('/d/a.wav', { ok: true, input: { id: 'x', fs: 48000, channels: [0], durationS: 1, unit: 'Pa', ref: 2e-5 }, thirdOctDb: [[40, 50]] });
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
