import { testLine } from './helpers/whole';
import { assertNotDrawn } from './fullNotDrawn';
import { N, R, Y } from './helpers/figure';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchedSource } from '../webview/runtime/fullRead';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { attachStageGestures } from '../webview/runtime/trackStageGestures';
import { initialStageState } from '../webview/runtime/trackStageModel';
import { STAGE_MARGINS, type StagePlot } from '../webview/runtime/stagePanes';

/** A page whose canvases draw (to nothing): the pointer's marks and readout are shown, so a click has a read to act on (R7, R13). */
function drawing(dom: JSDOM): JSDOM {
    const context = new Proxy({}, { get: () => () => undefined, set: () => true });
    dom.window.HTMLCanvasElement.prototype.getContext = (() => context) as unknown as HTMLCanvasElement['getContext'];
    return dom;
}

test('attaching the gestures puts the cursor line, zoom box and axis range popover on the page, hidden', () => {
    const dom = new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"></div></body>');
    const document = dom.window.document;
    const state = initialStageState();
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, document.querySelector('.track-stage') as HTMLElement, document, {
        strings: getStrings('en'), state, drawnOn: new Map(), painted: () => false, moved: () => undefined, rerender: () => undefined, hint: () => undefined, lanesApart: () => false,
    });
    for (const selector of ['.track-stage-cursor', '.track-stage-box']) {
        assert.equal(document.querySelectorAll(selector).length, 1, selector);
        assert.equal(document.querySelector<HTMLElement>(selector)?.hidden, true, selector);
    }
    assert.ok(document.getElementById('track-stage-range-popover'));
});

test('a click on a trigger\'s event line (the plot gestures\' tap: a press that stays put) leaves it out at once (plotInteraction arbitrates); a double click\'s second press puts it back, a drag leaves none out (R13)', () => {
    const dom = drawing(new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"><canvas data-stage-canvas="overlay"></canvas></div></body>'));
    const { document } = dom.window;
    const view = dom.window;
    const root = document.querySelector('.track-stage') as HTMLElement;
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    const frame = { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: 200, height: 100 };
    const width = frame.left + frame.width + STAGE_MARGINS.right, height = frame.top + frame.height + STAGE_MARGINS.bottom;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
    // One event drawn as a flat line across the middle of the plot.
    const event = { id: 2, source: '/d/a.wav', out: false };
    const plot = {
        frame, xAt: (value: number) => frame.left + value * frame.width, ...Y(value => frame.top + (1 - value) * frame.height, frame.height),
        xOf: (x: number) => (x - frame.left) / frame.width, ratioStep: 1, diff: false,
        lines: [{ view: { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 0.5, 1], values: [0.5, 0.5, 0.5] }, color: '#000', event, full: testLine([0, 0.5, 1], [0.5, 0.5, 0.5]) }],
    } as unknown as StagePlot;
    const state = initialStageState();
    state.on = true;
    const toggled: string[] = [];
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, root, document, {
        strings: getStrings('en'), state, drawnOn: new Map([[canvas, { picture: null, range: R({ min: 0, max: 1 }), axes: N({ x: 't', y: 'v' }), plot }]]), painted: () => true,
        moved: () => undefined, rerender: () => undefined, hint: () => undefined, lanesApart: () => false,
        toggleEvent: line => { toggled.push(`take ${line.id}`); return () => { toggled.push(`edit ${line.id}`); return () => { toggled.push(`undo ${line.id}`); }; }; },
    });
    const at = { clientX: frame.left + 100, clientY: frame.top + 50 };
    const fire = (target: EventTarget, type: string, detail = 1, place = at): void => { target.dispatchEvent(new view.MouseEvent(type, { ...place, button: 0, bubbles: true, detail })); };
    const fix = 'Fix: a click acts at once, and a double click\'s second press takes it back (plotInteraction.ts release(); docs/display-rules.md R13).';
    fire(canvas, 'mousedown');
    fire(document, 'mouseup');
    assert.deepEqual(toggled, ['take 2', 'edit 2'], `a click on the line did not leave it out at once. ${fix}`);
    // A double-click (which resets the zoom): its first press leaves the event out, its second puts it back.
    for (const detail of [1, 2]) { fire(canvas, 'mousedown', detail); fire(document, 'mouseup', detail); }
    assert.deepEqual(toggled, ['take 2', 'edit 2', 'take 2', 'edit 2', 'undo 2'], `a double click left the event out: it resets the zoom only. ${fix}`);
    toggled.length = 0;
    // A press dragged into a box zooms instead.
    fire(canvas, 'mousedown');
    fire(document, 'mousemove', 1, { clientX: frame.left + 180, clientY: frame.top + 90 });
    fire(document, 'mouseup', 1, { clientX: frame.left + 180, clientY: frame.top + 90 });
    assert.deepEqual(toggled, [], 'a drag leaves no event out');
});

test('a click on the events plot acts on the event line its readout reads at the press, never on a tolerance of its own: the nearest within the pick radius, the one nearest in height out of it, a tie the first, none past the lines\' ends (R7, R13)', () => {
    const dom = drawing(new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"><div class="track-stage-controls"><span data-plot-readout><span></span><span></span></span></div><canvas data-stage-canvas="overlay"></canvas></div></body>'));
    const { document } = dom.window;
    const root = document.querySelector('.track-stage') as HTMLElement;
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    const frame = { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: 200, height: 100 };
    const width = frame.left + frame.width + STAGE_MARGINS.right, height = frame.top + frame.height + STAGE_MARGINS.bottom;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
    // Two events as flat lines over the left half of the plot, 8 px apart (0.50 and 0.42 of the height).
    const lineOf = (id: number, value: number) => ({ view: { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 0.25, 0.5], values: [value, value, value] }, color: '#000', label: `#${id + 1}`, event: { id, source: '/d/a.wav', out: false }, full: testLine([0, 0.25, 0.5], [value, value, value]) });
    const plot = {
        frame, xAt: (value: number) => frame.left + value * frame.width, ...Y(value => frame.top + (1 - value) * frame.height, frame.height),
        xOf: (x: number) => (x - frame.left) / frame.width, ratioStep: 1, diff: false,
        lines: [lineOf(0, 0.5), lineOf(1, 0.42)],
    } as unknown as StagePlot;
    const state = initialStageState();
    state.on = true;
    const toggled: number[] = [];
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, root, document, {
        strings: getStrings('en'), state, drawnOn: new Map([[canvas, { picture: null, range: R({ min: 0, max: 1 }), axes: N({ x: 't', y: 'v' }), plot }]]), painted: () => true,
        moved: () => undefined, rerender: () => undefined, hint: () => undefined, lanesApart: () => false,
        toggleEvent: line => () => { toggled.push(line.id); return undefined; },
    });
    const fix = 'R7/R13 (docs/display-rules.md, "a click acts on the point the readout reads"): the events plot\'s click must act on the line PlotHoverLayer.clicked gives (trackStageGestures.ts tap through clickOnRead), never on a hit test or tolerance of its own.';
    const readName = (): string => (root.querySelector('[data-plot-readout] span')?.textContent ?? '');
    const click = (x: number, y: number): { read: string; acted: number[] } => {
        toggled.length = 0;
        const at = { clientX: frame.left + x, clientY: frame.top + y, button: 0, bubbles: true, detail: 1 };
        canvas.dispatchEvent(new dom.window.MouseEvent('mousemove', at));
        const read = readName();
        canvas.dispatchEvent(new dom.window.MouseEvent('mousedown', at));
        document.dispatchEvent(new dom.window.MouseEvent('mouseup', at));
        // A click on its own is not a double click's first press: the next one starts afresh.
        return { read, acted: [...toggled] };
    };
    // On the second line (8 px below the first): the readout reads it, and the click leaves it out, not the first.
    assert.deepEqual(click(50, 58), { read: '#2', acted: [1] }, fix);
    // 40 px under both, out of the pick radius: the readout reads the one nearest in height at the column, and so does the click.
    assert.deepEqual(click(50, 98), { read: '#2', acted: [1] }, fix);
    // Half way between them (4 px from each): the first in the data's order, as the readout reads it (pick_cases.json).
    assert.deepEqual(click(50, 54), { read: '#1', acted: [0] }, fix);
    // Past the lines' ends the readout reads no line: the click leaves nothing out.
    assert.deepEqual(click(180, 50).acted, [], fix);
});

/** The events left out by a hover and a click at (x, y) (CSS pixels on the plot's frame) on an events plot drawing `lines`. */
function eventsClicked(lines: unknown[], x: number, y: number): number[] {
    const dom = drawing(new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"><canvas data-stage-canvas="overlay"></canvas></div></body>'));
    const { document } = dom.window;
    const root = document.querySelector('.track-stage') as HTMLElement;
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    const frame = { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: 200, height: 100 };
    const width = frame.left + frame.width + STAGE_MARGINS.right, height = frame.top + frame.height + STAGE_MARGINS.bottom;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
    const plot = { frame, xAt: (value: number) => frame.left + value * frame.width, ...Y(value => frame.top + (1 - value) * frame.height, frame.height), xOf: (at: number) => (at - frame.left) / frame.width, ratioStep: 1, diff: false, lines } as unknown as StagePlot;
    const state = initialStageState();
    state.on = true;
    const toggled: number[] = [];
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, root, document, {
        strings: getStrings('en'), state, drawnOn: new Map([[canvas, { picture: null, range: R({ min: 0, max: 1 }), axes: N({ x: 't', y: 'v' }), plot }]]), painted: () => true,
        moved: () => undefined, rerender: () => undefined, hint: () => undefined, lanesApart: () => false,
        toggleEvent: line => () => { toggled.push(line.id); return undefined; },
    });
    const at = { clientX: frame.left + x, clientY: frame.top + y, button: 0, bubbles: true, detail: 1 };
    canvas.dispatchEvent(new dom.window.MouseEvent('mousemove', at));
    canvas.dispatchEvent(new dom.window.MouseEvent('mousedown', at));
    document.dispatchEvent(new dom.window.MouseEvent('mouseup', at));
    return toggled;
}

test('a click on the events plot leaves out the line its readout reads in the full data, not the line the drawn points would put nearest (R7, R13)', () => {
    // #1 flat at 0.5. #2 drawn flat at 0.42, its peak of 0.6 at 0.25 thinned away from the picture but held in its full data.
    const xs = [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5];
    const second = xs.map(x => (x === 0.25 ? 0.6 : 0.42));
    const lines = [
        { view: { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 0.5], values: [0.5, 0.5] }, color: '#000', label: '#1', event: { id: 0, source: '/d/a.wav', out: false }, full: testLine(xs, xs.map(() => 0.5)) },
        { view: { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 0.5], values: [0.42, 0.42] }, color: '#111', label: '#2', event: { id: 1, source: '/d/a.wav', out: false }, full: testLine(xs, second) },
    ];
    // On #2's peak (0.6 at 0.25 of a 200 × 100 px frame): 10 px above #1, on #2's full data.
    const toggled = eventsClicked(lines, 0.25 * 200, 0.4 * 100);
    assert.equal(toggled.length, 1, 'one line left out');
    assert.equal(toggled[0], 1, 'R7/R13: the click acts on the line the readout reads from the full data (trackStageGestures.ts tap through clickOnRead)');
    // The drawn points put #1 nearest there (0.5 is 10 px off, 0.42 is 18 px off).
    const drawnNearest = [0.5, 0.42].reduce((best, value, index, all) => (Math.abs(value - 0.6) < Math.abs(all[best] - 0.6) ? index : best), 0);
    assertNotDrawn(toggled[0], drawnNearest, 'not the line nearest by the points drawn');
});

test('a click on a trigger\'s event line while its full data is on its way is decided once it is in, never dropped; a double-click meanwhile still takes it back (R7)', async () => {
    const dom = drawing(new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"><canvas data-stage-canvas="overlay"></canvas></div></body>'));
    const { document } = dom.window;
    const view = dom.window;
    const root = document.querySelector('.track-stage') as HTMLElement;
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    const frame = { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: 200, height: 100 };
    const width = frame.left + frame.width + STAGE_MARGINS.right, height = frame.top + frame.height + STAGE_MARGINS.bottom;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
    // The event's samples are the backend's: each read is answered only when let go, as a slow reply.
    const samples = testLine([0, 0.5, 1], [0.5, 0.5, 0.5]);
    const replies: Array<() => void> = [];
    const full = fetchedSource((read, done) => { replies.push(() => done(samples.line({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1 }, () => undefined))); });
    const event = { id: 2, source: '/d/a.wav', out: false };
    const plot = {
        frame, xAt: (value: number) => frame.left + value * frame.width, ...Y(value => frame.top + (1 - value) * frame.height, frame.height),
        xOf: (x: number) => (x - frame.left) / frame.width, ratioStep: 1, diff: false,
        lines: [{ view: { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 0.5, 1], values: [0.5, 0.5, 0.5] }, color: '#000', event, full }],
    } as unknown as StagePlot;
    const state = initialStageState();
    state.on = true;
    const toggled: string[] = [];
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, root, document, {
        strings: getStrings('en'), state, drawnOn: new Map([[canvas, { picture: null, range: R({ min: 0, max: 1 }), axes: N({ x: 't', y: 'v' }), plot }]]), painted: () => true,
        moved: () => undefined, rerender: () => undefined, hint: () => undefined, lanesApart: () => false,
        toggleEvent: line => { toggled.push(`take ${line.id}`); return () => { toggled.push(`edit ${line.id}`); return () => { toggled.push(`undo ${line.id}`); }; }; },
    });
    const at = { clientX: frame.left + 100, clientY: frame.top + 50 };
    const fire = (target: EventTarget, type: string, detail = 1): void => { target.dispatchEvent(new view.MouseEvent(type, { ...at, button: 0, bubbles: true, detail })); };
    const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
    fire(canvas, 'mousedown');
    fire(document, 'mouseup');
    // The line under the pointer is asked for, and the click decided once it is in.
    await wait(0);
    assert.deepEqual(toggled, [], 'nothing decided before the line under the pointer is known');
    assert.ok(replies.length >= 1, 'its samples are asked for');
    while (replies.length) replies.shift()?.();
    assert.deepEqual(toggled, ['take 2', 'edit 2']);
    // A double-click whose second press comes before the data: nothing is left out (its first press is taken back before it acts).
    const late = fetchedSource((read, done) => { replies.push(() => done(samples.line({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1 }, () => undefined))); });
    (plot.lines[0] as { full: unknown }).full = late;
    for (const detail of [1, 2]) { fire(canvas, 'mousedown', detail); fire(document, 'mouseup', detail); }
    await wait(0);
    while (replies.length) replies.shift()?.();
    assert.deepEqual(toggled, ['take 2', 'edit 2'], 'the double-click took the first press\'s click back');
    // A click waiting for its line's data, then the next press (a drag into a box): the press takes its place.
    const slow = fetchedSource((read, done) => { replies.push(() => done(samples.line({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1 }, () => undefined))); });
    (plot.lines[0] as { full: unknown }).full = slow;
    fire(canvas, 'mousedown');
    fire(document, 'mouseup');
    await wait(0);
    assert.ok(replies.length >= 1, 'its samples are asked for');
    canvas.dispatchEvent(new view.MouseEvent('mousedown', { ...at, button: 0, bubbles: true, detail: 1 }));
    document.dispatchEvent(new view.MouseEvent('mousemove', { clientX: frame.left + 180, clientY: frame.top + 90, button: 0, bubbles: true }));
    document.dispatchEvent(new view.MouseEvent('mouseup', { clientX: frame.left + 180, clientY: frame.top + 90, button: 0, bubbles: true, detail: 1 }));
    while (replies.length) replies.shift()?.();
    await wait(0);
    assert.deepEqual(toggled, ['take 2', 'edit 2'], 'a press after the click cancels it, data or no data');
});

test('a click on an event line waiting for its data is decided on the plot it was clicked on: a zoom by the wheel meanwhile does not move it onto another line or none (R7)', async () => {
    const dom = drawing(new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"><canvas data-stage-canvas="overlay"></canvas></div></body>'));
    const { document } = dom.window;
    const root = document.querySelector('.track-stage') as HTMLElement;
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    const frame = { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: 200, height: 100 };
    const width = frame.left + frame.width + STAGE_MARGINS.right, height = frame.top + frame.height + STAGE_MARGINS.bottom;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
    const samples = testLine([0, 0.5, 1], [0.5, 0.5, 0.5]);
    const replies: Array<() => void> = [];
    const full = fetchedSource((read, done) => { replies.push(() => done(samples.line({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1 }, () => undefined))); });
    const event = { id: 2, source: '/d/a.wav', out: false };
    const plotOf = (level: number) => ({
        frame, xAt: (value: number) => frame.left + value * frame.width, ...Y(value => frame.top + (1 - (value - level + 0.5)) * frame.height, frame.height),
        xOf: (x: number) => (x - frame.left) / frame.width, ratioStep: 1, diff: false,
        lines: [{ view: { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 0.5, 1], values: [0.5, 0.5, 0.5] }, color: '#000', event, full }],
    } as unknown as StagePlot);
    const state = initialStageState();
    state.on = true;
    const toggled: string[] = [];
    const drawnOn = new Map([[canvas, { picture: null, range: R({ min: 0, max: 1 }), axes: N({ x: 't', y: 'v' }), plot: plotOf(0.5) }]]);
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, root, document, {
        strings: getStrings('en'), state, drawnOn, painted: () => true, moved: () => undefined, rerender: () => undefined, hint: () => undefined, lanesApart: () => false,
        toggleEvent: line => { toggled.push(`take ${line.id}`); return () => { toggled.push(`edit ${line.id}`); return () => { toggled.push(`undo ${line.id}`); }; }; },
    });
    const at = { clientX: frame.left + 100, clientY: frame.top + 50 };
    canvas.dispatchEvent(new dom.window.MouseEvent('mousedown', { ...at, button: 0, bubbles: true, detail: 1 }));
    document.dispatchEvent(new dom.window.MouseEvent('mouseup', { ...at, button: 0, bubbles: true, detail: 1 }));
    // Drawn again before the data comes: the line now far from that pixel.
    drawnOn.set(canvas, { ...drawnOn.get(canvas)!, plot: plotOf(0.1) });
    await new Promise(resolve => { setTimeout(resolve, 0); });
    while (replies.length) replies.shift()?.();
    assert.deepEqual(toggled, ['take 2', 'edit 2'], 'the line clicked on is the one decided');
    // A scroll before it is decided moves the plot on screen (its line now 40 px off the pixel clicked): the line
    // clicked on is decided all the same, at the place the plot was clicked at.
    drawnOn.set(canvas, { ...drawnOn.get(canvas)!, plot: plotOf(0.5) });
    const slow = fetchedSource((read, done) => { replies.push(() => done(samples.line({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1 }, () => undefined))); });
    (drawnOn.get(canvas)!.plot.lines[0] as { full: unknown }).full = slow;
    canvas.dispatchEvent(new dom.window.MouseEvent('mousedown', { ...at, button: 0, bubbles: true, detail: 1 }));
    document.dispatchEvent(new dom.window.MouseEvent('mouseup', { ...at, button: 0, bubbles: true, detail: 1 }));
    canvas.getBoundingClientRect = () => ({ left: 0, top: -40, width, height, right: width, bottom: height - 40, x: 0, y: -40, toJSON: () => ({}) });
    await new Promise(resolve => { setTimeout(resolve, 0); });
    while (replies.length) replies.shift()?.();
    assert.deepEqual(toggled, ['take 2', 'edit 2', 'take 2', 'edit 2'], 'decided where the plot was as clicked, a scroll meanwhile');
});

test('the steps\' gestures place the pointer on the plot as it was drawn: with a second level axis on the right its margin is the drawn one, and over that axis is an axis (R13)', async () => {
    const { stagePlotPoint } = await import('../webview/runtime/stagePanes');
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200, right: 600, bottom: 200, x: 0, y: 0, toJSON: () => ({}) }) };
    // A plot with two level axes: 52 px each side (paintOverlay's secondary margin).
    const drawn = { frame: { left: 52, top: 4, width: 496, height: 180 }, secondary: { lines: [] } } as unknown as StagePlot;
    const right = stagePlotPoint(canvas, 548, 100, drawn);
    assert.equal(right.fx, 1, 'the right end of the drawn frame is the plot\'s right end');
    assert.equal(right.axis, null);
    const over = stagePlotPoint(canvas, 570, 100, drawn);
    assert.equal(over.axis, 'y', 'over the right-hand axis');
    assert.equal(over.right, true);
    assert.ok(Math.abs(stagePlotPoint(canvas, 300, 100, drawn).fx - 248 / 496) < 1e-9, 'the middle is read on the drawn width');
});

test('over a heatmap\'s colour bar every axis gesture answers as on an axis, by the one hit test of it (stagePlotPoint): Ctrl+wheel zooms the horizontal axis about its middle, a press draws no box, a hover reads no cell, a double-click resets the zoom (R13)', async () => {
    const { stagePlotPoint } = await import('../webview/runtime/stagePanes');
    const dom = drawing(new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"><canvas data-stage-canvas="overlay"></canvas></div></body>'));
    const { document } = dom.window;
    const view = dom.window;
    const root = document.querySelector('.track-stage') as HTMLElement;
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    const frame = { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: 400, height: 200 };
    const width = frame.left + frame.width + STAGE_MARGINS.right, height = frame.top + frame.height + STAGE_MARGINS.bottom;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
    // The colour bar inside the plot's top right, as paintColourBar returns its box (CSS pixels on the canvas).
    const colourBar = { x: frame.left + 280, y: frame.top + 3, width: 116, height: 14 };
    const plot = { frame, colourBar, xAt: (value: number) => frame.left + value * frame.width, ...Y(value => frame.top + (1 - value) * frame.height, frame.height), xOf: (x: number) => (x - frame.left) / frame.width, ratioStep: 1, diff: false, lines: [] } as unknown as StagePlot;
    const bar = { clientX: colourBar.x + colourBar.width / 2, clientY: colourBar.y + colourBar.height / 2 };
    // The one hit test: the bar is a value axis; just off it, the plot.
    assert.deepEqual(stagePlotPoint(canvas, bar.clientX, bar.clientY, plot), { ...stagePlotPoint(canvas, bar.clientX, bar.clientY, { frame }), axis: 'y', colour: true });
    assert.equal(stagePlotPoint(canvas, colourBar.x - 1, bar.clientY, plot).axis, null);
    assert.equal(stagePlotPoint(canvas, bar.clientX, colourBar.y + colourBar.height + 1, plot).axis, null);
    const state = initialStageState();
    state.on = true;
    const hints: string[] = [];
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, root, document, {
        strings: getStrings('en'), state, drawnOn: new Map([[canvas, { picture: { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', xs: [0, 1], ys: [0, 1], matrix: [[0, 0], [0, 0]] }, range: R({ min: 0, max: 1 }), axes: N({ x: 't', y: 'f' }), plot } as never]]), painted: () => true,
        moved: () => undefined, rerender: () => undefined, hint: text => { hints.push(text); }, lanesApart: () => false,
    });
    const fix = 'Fix: hit-test the colour bar in stagePanes.stagePlotPoint, the one hit test every plot uses (docs/display-rules.md R13).';
    // Ctrl+wheel, one step in (×0.85, waveformInteraction.wheelZoomFactor): about the middle, 0.075 to 0.925, never about the pointer.
    canvas.dispatchEvent(new view.WheelEvent('wheel', { ...bar, deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
    assert.ok(Math.abs(state.window.x.start - 0.075) < 1e-12 && Math.abs(state.window.x.end - 0.925) < 1e-12, `Ctrl+wheel over the colour bar zoomed to ${JSON.stringify(state.window.x)}, not about the middle. ${fix}`);
    assert.deepEqual(state.window.y, { start: 0, end: 1 });
    // A hover there reads no cell: the axis's hint.
    canvas.dispatchEvent(new view.MouseEvent('mousemove', { ...bar, bubbles: true }));
    assert.equal(hints.at(-1), getStrings('en').compareHintAxis, `a hover over the colour bar read the plot. ${fix}`);
    // A press dragged from the bar draws no box and zooms nothing.
    const zoomed = JSON.stringify(state.window);
    canvas.dispatchEvent(new view.MouseEvent('mousedown', { ...bar, button: 0, bubbles: true, detail: 1 }));
    document.dispatchEvent(new view.MouseEvent('mousemove', { clientX: frame.left + 20, clientY: frame.top + 150, buttons: 1, bubbles: true }));
    document.dispatchEvent(new view.MouseEvent('mouseup', { clientX: frame.left + 20, clientY: frame.top + 150, button: 0, bubbles: true, detail: 1 }));
    assert.equal(JSON.stringify(state.window), zoomed, `a drag from the colour bar zoomed into a box. ${fix}`);
    assert.equal(document.querySelector<HTMLElement>('.track-stage-box')?.hidden, true);
    // A double-click on it: no colour range to type here, so the zoom is reset (never the rows' range).
    canvas.dispatchEvent(new view.MouseEvent('dblclick', { ...bar, bubbles: true }));
    assert.deepEqual(state.window, { x: { start: 0, end: 1 }, y: { start: 0, end: 1 } }, `a double-click on the colour bar did not reset the zoom. ${fix}`);
    assert.equal(document.getElementById('track-stage-range-popover')?.style.display, 'none', 'no range popover opened for the colour bar');
});
