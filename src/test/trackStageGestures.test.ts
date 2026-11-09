import { N, R } from './helpers/figure';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchedSource, localLine } from '../webview/runtime/fullRead';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { attachStageGestures } from '../webview/runtime/trackStageGestures';
import { initialStageState } from '../webview/runtime/trackStageModel';
import { STAGE_MARGINS, type StagePlot } from '../webview/runtime/stagePanes';

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

test('a click on a trigger\'s event line (the plot gestures\' tap: a press that stays put) leaves it out once no double-click follows (plotInteraction arbitrates); a drag or a double-click does not', async () => {
    const dom = new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"><canvas data-stage-canvas="overlay"></canvas></div></body>');
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
        frame, xAt: (value: number) => frame.left + value * frame.width, yAt: (value: number) => frame.top + (1 - value) * frame.height,
        xOf: (x: number) => (x - frame.left) / frame.width, ratioStep: 1, diff: false,
        lines: [{ view: { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 0.5, 1], values: [0.5, 0.5, 0.5] }, color: '#000', event, full: localLine([0, 0.5, 1], [0.5, 0.5, 0.5]) }],
    } as unknown as StagePlot;
    const state = initialStageState();
    state.on = true;
    const toggled: string[] = [];
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, root, document, {
        strings: getStrings('en'), state, drawnOn: new Map([[canvas, { picture: null, range: R({ min: 0, max: 1 }), axes: N({ x: 't', y: 'v' }), plot }]]), painted: () => true,
        moved: () => undefined, rerender: () => undefined, hint: () => undefined, lanesApart: () => false,
        toggleEvent: line => { toggled.push(`take ${line.id}`); return () => toggled.push(`edit ${line.id}`); },
    });
    const at = { clientX: frame.left + 100, clientY: frame.top + 50 };
    const fire = (target: EventTarget, type: string, detail = 1, place = at): void => { target.dispatchEvent(new view.MouseEvent(type, { ...place, button: 0, bubbles: true, detail })); };
    const wait = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 400); });
    fire(canvas, 'mousedown');
    fire(document, 'mouseup');
    assert.deepEqual(toggled, [], 'decided once no double-click follows');
    await wait();
    assert.deepEqual(toggled, ['take 2', 'edit 2']);
    // A double-click (which resets the zoom) leaves nothing out: its second press takes the first one's place.
    for (const detail of [1, 2]) { fire(canvas, 'mousedown', detail); fire(document, 'mouseup', detail); }
    await wait();
    assert.deepEqual(toggled, ['take 2', 'edit 2']);
    // A press dragged into a box zooms instead.
    fire(canvas, 'mousedown');
    fire(document, 'mousemove', 1, { clientX: frame.left + 180, clientY: frame.top + 90 });
    fire(document, 'mouseup', 1, { clientX: frame.left + 180, clientY: frame.top + 90 });
    await wait();
    assert.deepEqual(toggled, ['take 2', 'edit 2'], 'a drag leaves no event out');
    // Off the line, a click leaves nothing out.
    fire(canvas, 'mousedown', 1, { clientX: frame.left + 100, clientY: frame.top + 90 });
    fire(document, 'mouseup', 1, { clientX: frame.left + 100, clientY: frame.top + 90 });
    await wait();
    assert.deepEqual(toggled, ['take 2', 'edit 2']);
    // A click and then, before it is decided, a drag into a box: the drag takes its place.
    fire(canvas, 'mousedown');
    fire(document, 'mouseup');
    fire(canvas, 'mousedown');
    fire(document, 'mousemove', 1, { clientX: frame.left + 180, clientY: frame.top + 90 });
    fire(document, 'mouseup', 1, { clientX: frame.left + 180, clientY: frame.top + 90 });
    await wait();
    assert.deepEqual(toggled, ['take 2', 'edit 2'], 'the next press cancels the click');
});

test('a click on a trigger\'s event line while its full data is on its way is decided once it is in, never dropped; a double-click meanwhile still takes it back (R7)', async () => {
    const dom = new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"><canvas data-stage-canvas="overlay"></canvas></div></body>');
    const { document } = dom.window;
    const view = dom.window;
    const root = document.querySelector('.track-stage') as HTMLElement;
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    const frame = { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: 200, height: 100 };
    const width = frame.left + frame.width + STAGE_MARGINS.right, height = frame.top + frame.height + STAGE_MARGINS.bottom;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
    // The event's samples are the backend's: each read is answered only when let go, as a slow reply.
    const samples = localLine([0, 0.5, 1], [0.5, 0.5, 0.5]);
    const replies: Array<() => void> = [];
    const full = fetchedSource((read, done) => { replies.push(() => done(samples.line?.({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1 }, () => undefined))); });
    const event = { id: 2, source: '/d/a.wav', out: false };
    const plot = {
        frame, xAt: (value: number) => frame.left + value * frame.width, yAt: (value: number) => frame.top + (1 - value) * frame.height,
        xOf: (x: number) => (x - frame.left) / frame.width, ratioStep: 1, diff: false,
        lines: [{ view: { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 0.5, 1], values: [0.5, 0.5, 0.5] }, color: '#000', event, full }],
    } as unknown as StagePlot;
    const state = initialStageState();
    state.on = true;
    const toggled: string[] = [];
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, root, document, {
        strings: getStrings('en'), state, drawnOn: new Map([[canvas, { picture: null, range: R({ min: 0, max: 1 }), axes: N({ x: 't', y: 'v' }), plot }]]), painted: () => true,
        moved: () => undefined, rerender: () => undefined, hint: () => undefined, lanesApart: () => false,
        toggleEvent: line => { toggled.push(`take ${line.id}`); return () => toggled.push(`edit ${line.id}`); },
    });
    const at = { clientX: frame.left + 100, clientY: frame.top + 50 };
    const fire = (target: EventTarget, type: string, detail = 1): void => { target.dispatchEvent(new view.MouseEvent(type, { ...at, button: 0, bubbles: true, detail })); };
    const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
    fire(canvas, 'mousedown');
    fire(document, 'mouseup');
    // No double-click followed: the line under the pointer is asked for, and the click decided once it is in.
    await wait(400);
    assert.deepEqual(toggled, [], 'nothing decided before the line under the pointer is known');
    assert.ok(replies.length >= 1, 'its samples are asked for');
    while (replies.length) replies.shift()?.();
    assert.deepEqual(toggled, ['take 2', 'edit 2']);
    // A double-click whose second press comes before the data: nothing is left out.
    const late = fetchedSource((read, done) => { replies.push(() => done(samples.line?.({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1 }, () => undefined))); });
    (plot.lines[0] as { full: unknown }).full = late;
    for (const detail of [1, 2]) { fire(canvas, 'mousedown', detail); fire(document, 'mouseup', detail); }
    await wait(400);
    while (replies.length) replies.shift()?.();
    assert.deepEqual(toggled, ['take 2', 'edit 2'], 'the double-click took the first press\'s place');
    // A click waiting for its line's data, then the next press (a drag into a box): the press takes its place.
    const slow = fetchedSource((read, done) => { replies.push(() => done(samples.line?.({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1 }, () => undefined))); });
    (plot.lines[0] as { full: unknown }).full = slow;
    fire(canvas, 'mousedown');
    fire(document, 'mouseup');
    await wait(400);
    assert.ok(replies.length >= 1, 'its samples are asked for');
    canvas.dispatchEvent(new view.MouseEvent('mousedown', { ...at, button: 0, bubbles: true, detail: 1 }));
    document.dispatchEvent(new view.MouseEvent('mousemove', { clientX: frame.left + 180, clientY: frame.top + 90, button: 0, bubbles: true }));
    document.dispatchEvent(new view.MouseEvent('mouseup', { clientX: frame.left + 180, clientY: frame.top + 90, button: 0, bubbles: true, detail: 1 }));
    while (replies.length) replies.shift()?.();
    await wait(400);
    assert.deepEqual(toggled, ['take 2', 'edit 2'], 'a press after the click cancels it, data or no data');
});

test('a click on an event line waiting for its data is decided on the plot it was clicked on: a zoom by the wheel meanwhile does not move it onto another line or none (R7)', async () => {
    const dom = new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"><canvas data-stage-canvas="overlay"></canvas></div></body>');
    const { document } = dom.window;
    const root = document.querySelector('.track-stage') as HTMLElement;
    const canvas = root.querySelector('canvas') as HTMLCanvasElement;
    const frame = { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: 200, height: 100 };
    const width = frame.left + frame.width + STAGE_MARGINS.right, height = frame.top + frame.height + STAGE_MARGINS.bottom;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
    const samples = localLine([0, 0.5, 1], [0.5, 0.5, 0.5]);
    const replies: Array<() => void> = [];
    const full = fetchedSource((read, done) => { replies.push(() => done(samples.line?.({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1 }, () => undefined))); });
    const event = { id: 2, source: '/d/a.wav', out: false };
    const plotOf = (level: number) => ({
        frame, xAt: (value: number) => frame.left + value * frame.width, yAt: (value: number) => frame.top + (1 - (value - level + 0.5)) * frame.height,
        xOf: (x: number) => (x - frame.left) / frame.width, ratioStep: 1, diff: false,
        lines: [{ view: { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 0.5, 1], values: [0.5, 0.5, 0.5] }, color: '#000', event, full }],
    } as unknown as StagePlot);
    const state = initialStageState();
    state.on = true;
    const toggled: string[] = [];
    const drawnOn = new Map([[canvas, { picture: null, range: R({ min: 0, max: 1 }), axes: N({ x: 't', y: 'v' }), plot: plotOf(0.5) }]]);
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, root, document, {
        strings: getStrings('en'), state, drawnOn, painted: () => true, moved: () => undefined, rerender: () => undefined, hint: () => undefined, lanesApart: () => false,
        toggleEvent: line => { toggled.push(`take ${line.id}`); return () => toggled.push(`edit ${line.id}`); },
    });
    const at = { clientX: frame.left + 100, clientY: frame.top + 50 };
    canvas.dispatchEvent(new dom.window.MouseEvent('mousedown', { ...at, button: 0, bubbles: true, detail: 1 }));
    document.dispatchEvent(new dom.window.MouseEvent('mouseup', { ...at, button: 0, bubbles: true, detail: 1 }));
    // Drawn again before the data comes: the line now far from that pixel.
    drawnOn.set(canvas, { ...drawnOn.get(canvas)!, plot: plotOf(0.1) });
    await new Promise(resolve => { setTimeout(resolve, 400); });
    while (replies.length) replies.shift()?.();
    assert.deepEqual(toggled, ['take 2', 'edit 2'], 'the line clicked on is the one decided');
    // A scroll before it is decided moves the plot on screen (its line now 40 px off the pixel clicked): the line
    // clicked on is decided all the same, at the place the plot was clicked at.
    drawnOn.set(canvas, { ...drawnOn.get(canvas)!, plot: plotOf(0.5) });
    const slow = fetchedSource((read, done) => { replies.push(() => done(samples.line?.({ x0: read.x[0], x1: read.x[read.x.length - 1], beyond: read.beyond ?? 1 }, () => undefined))); });
    (drawnOn.get(canvas)!.plot.lines[0] as { full: unknown }).full = slow;
    canvas.dispatchEvent(new dom.window.MouseEvent('mousedown', { ...at, button: 0, bubbles: true, detail: 1 }));
    document.dispatchEvent(new dom.window.MouseEvent('mouseup', { ...at, button: 0, bubbles: true, detail: 1 }));
    canvas.getBoundingClientRect = () => ({ left: 0, top: -40, width, height, right: width, bottom: height - 40, x: 0, y: -40, toJSON: () => ({}) });
    await new Promise(resolve => { setTimeout(resolve, 400); });
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
