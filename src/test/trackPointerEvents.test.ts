import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { keyRouterFor } from '../webview/runtime/keyRouter';
import { attachTrackPointerListeners, type PlotSelectors } from '../webview/runtime/trackPointerEvents';

/** `selectors`: the lanes' own when left out (a focused lane keeps its arrows); a pane's (plotInteraction.ts) otherwise. */
function setup(axisOpens = false, steps = true, selectors?: PlotSelectors, zooms = true) {
    const { window } = new JSDOM('<!doctype html><body><div id="tracks"><canvas class="track-canvas" tabindex="0"></canvas><canvas class="track-axis-canvas"></canvas><span class="label"></span><canvas class="track-canvas" id="lane2" tabindex="0"></canvas></div><input id="field"></body>');
    const doc = window.document;
    const wrapper = doc.getElementById('tracks') as HTMLElement;
    const calls: string[] = [];
    attachTrackPointerListeners(wrapper, doc, keyRouterFor(window), {
        step: (plot, delta) => { calls.push(`step:${plot.className}:${delta}`); return steps; },
        resetZoom: () => { calls.push('reset'); },
        openAxisRange: () => { calls.push('axis'); return axisOpens; },
        hover: () => { calls.push('hover'); },
        clearHover: () => { calls.push('clear'); },
        press: () => { calls.push('press'); },
        drag: () => { calls.push('drag'); },
        release: () => { calls.push('release'); },
        zoomWheel: () => { calls.push('zoom'); },
        panWheel: (_e, swipe) => { calls.push(swipe ? 'swipe' : 'pan'); },
        zoomKey: (plot, action) => { calls.push(`zoomKey:${plot.id || plot.className}:${action}`); return zooms; },
    }, selectors);
    const at = (selector: string) => doc.querySelector(selector) as HTMLElement;
    return { window, doc, wrapper, calls, at };
}

test('attachTrackPointerListeners resets zoom only for double-clicks on waveform or axis canvases', () => {
    const { window, calls, at } = setup();
    for (const selector of ['.track-canvas', '.track-axis-canvas', '.label']) {
        at(selector).dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    }
    assert.deepEqual(calls, ['axis', 'reset', 'axis', 'reset']);
});

test('attachTrackPointerListeners opens the axis range instead of resetting zoom when the axis or plot has one', () => {
    const { window, calls, at } = setup(true);
    for (const selector of ['.track-axis-canvas', '.track-canvas']) {
        at(selector).dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    }
    assert.deepEqual(calls, ['axis', 'axis']);
});

test('attachTrackPointerListeners wires hover and press on the tracks and drag on the document', () => {
    const { window, doc, wrapper, calls } = setup();
    wrapper.dispatchEvent(new window.MouseEvent('mousemove'));
    wrapper.dispatchEvent(new window.MouseEvent('mouseleave'));
    wrapper.dispatchEvent(new window.MouseEvent('mousedown'));
    doc.dispatchEvent(new window.MouseEvent('mousemove'));
    doc.dispatchEvent(new window.MouseEvent('mouseup'));
    assert.deepEqual(calls, ['hover', 'clear', 'press', 'drag', 'release']);
});

test('attachTrackPointerListeners zooms with Ctrl+wheel, pans with Shift+wheel and leaves plain scrolling alone', () => {
    const { window, wrapper, calls } = setup();
    const wheel = (init: WheelEventInit) => {
        const event = new window.WheelEvent('wheel', { cancelable: true, ...init });
        wrapper.dispatchEvent(event);
        return event.defaultPrevented;
    };
    assert.equal(wheel({ ctrlKey: true }), true);
    assert.equal(wheel({ shiftKey: true }), true);
    assert.equal(wheel({}), false);
    assert.deepEqual(calls, ['zoom', 'pan']);
});

function wheelAt(window: JSDOM['window'], at: (selector: string) => HTMLElement) {
    return (selector: string, timeStamp: number, init: WheelEventInit) => {
        const event = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
        Object.defineProperty(event, 'timeStamp', { value: timeStamp });
        at(selector).dispatchEvent(event);
        return event.defaultPrevented;
    };
}

test('attachTrackPointerListeners pans with a sideways swipe on a plot and leaves it alone elsewhere', () => {
    const { window, calls, at } = setup();
    const wheel = wheelAt(window, at);
    assert.equal(wheel('.track-canvas', 0, { deltaX: 12, deltaY: 2 }), true);
    // Mostly vertical (or exactly diagonal) after a pause: the lanes scroll; off the plots: the page's own sideways scroll stays.
    assert.equal(wheel('.track-canvas', 1000, { deltaX: 2, deltaY: 12 }), false);
    assert.equal(wheel('.track-canvas', 2000, { deltaX: 10, deltaY: 10 }), false);
    assert.equal(wheel('.label', 3000, { deltaX: 12 }), false);
    assert.deepEqual(calls, ['swipe']);
});

test('attachTrackPointerListeners keeps a swipe on the direction it started with until it pauses', () => {
    const { window, calls, at } = setup();
    const wheel = wheelAt(window, at);
    // A sideways swipe drifting past the diagonal keeps panning…
    assert.equal(wheel('.track-canvas', 0, { deltaX: 10, deltaY: 9 }), true);
    assert.equal(wheel('.track-canvas', 16, { deltaX: 9, deltaY: 10 }), true);
    // …and a vertical one drifting sideways keeps scrolling the lanes.
    assert.equal(wheel('.track-canvas', 500, { deltaX: 9, deltaY: 10 }), false);
    assert.equal(wheel('.track-canvas', 516, { deltaX: 10, deltaY: 9 }), false);
    assert.deepEqual(calls, ['swipe', 'swipe']);
});

const keyIn = (window: JSDOM['window'], doc: Document) => (code: string, init: KeyboardEventInit = {}, target: EventTarget = doc.body): boolean => {
    const event = new window.KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event.defaultPrevented;
};

test('← / → step the readout of the plot under the pointer, or of a focused one, and go on when it reads nothing (R7)', () => {
    // A pane's plot (plotInteraction.ts): focused, it takes the arrows too.
    const { window, doc, calls, at } = setup(false, true, { plot: '.track-canvas', axis: '.track-axis-canvas' });
    const key = keyIn(window, doc);
    // Off every plot the arrows are not the plots'.
    assert.equal(key('ArrowRight'), false);
    at('.track-canvas').dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
    assert.equal(key('ArrowRight'), true);
    assert.equal(key('ArrowLeft'), true);
    // With a modifier, in a field, or another key: left to whoever takes them.
    assert.equal(key('ArrowRight', { shiftKey: true }), false);
    assert.equal(key('ArrowRight', { ctrlKey: true }), false);
    assert.equal(key('ArrowRight', {}, at('#field')), false);
    assert.equal(key('ArrowUp'), false);
    at('#tracks').dispatchEvent(new window.MouseEvent('mouseleave'));
    // Given the focus from the keyboard with the pointer elsewhere, a plot reads where it starts; the arrows step it.
    at('.track-canvas').focus();
    assert.equal(key('ArrowRight', {}, at('.track-canvas')), true);
    assert.deepEqual(calls.filter(call => call.startsWith('step')), ['step:track-canvas:1', 'step:track-canvas:-1', 'step:track-canvas:0', 'step:track-canvas:1']);
});

test('an arrow over a plot that reads nothing goes on to the keys behind it', () => {
    const { window, doc, at } = setup(false, false);
    at('.track-canvas').dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
    const event = new window.KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true, cancelable: true });
    doc.body.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
});

test('a lane with the keyboard focus keeps ← / → for its time cursor, even with the pointer on it; the pointer on another lane steps that one\'s readout (R7)', () => {
    const { window, doc, calls, at } = setup();
    const key = keyIn(window, doc);
    const lane = at('.track-canvas'), other = at('#lane2');
    // Clicked to place the cursor, the pointer left where it is: focus and pointer on the same lane.
    lane.focus();
    lane.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
    assert.equal(key('ArrowRight', {}, lane), false, 'goes on to the lanes\' cursor');
    assert.equal(key('ArrowLeft', {}, lane), false);
    // The pointer on another lane: that lane's readout steps, the focused one's cursor stays.
    other.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
    assert.equal(key('ArrowRight', {}, lane), true);
    // The focus let go: the lane under the pointer steps.
    lane.blur();
    lane.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
    assert.equal(key('ArrowRight'), true);
    assert.deepEqual(calls.filter(call => call.startsWith('step')), ['step:track-canvas:1', 'step:track-canvas:1']);
});

test('+ / − / 0 zoom the plot under the pointer, a lane too, and go on to the view\'s own keys off every plot or on one showing nothing', () => {
    const { window, doc, calls, at } = setup();
    const key = (name: string, init: KeyboardEventInit = {}, target: EventTarget = doc.body): boolean => {
        const event = new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
        target.dispatchEvent(event);
        return event.defaultPrevented;
    };
    // Off every plot, and on a plot only focused: the view's keys (the lanes' shared zoom, the comparison's) take them.
    assert.equal(key('+'), false);
    at('.track-canvas').focus();
    assert.equal(key('+', {}, at('.track-canvas')), false);
    at('#lane2').dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
    assert.equal(key('+'), true);
    assert.equal(key('=', {}), true);
    assert.equal(key('-'), true);
    assert.equal(key('_', { shiftKey: true }), true);
    assert.equal(key('0'), true);
    // With Ctrl, in a field, or another key: left alone.
    assert.equal(key('+', { ctrlKey: true }), false);
    assert.equal(key('0', {}, at('#field')), false);
    assert.equal(key('9'), false);
    assert.deepEqual(calls.filter(call => call.startsWith('zoomKey')), ['zoomKey:lane2:in', 'zoomKey:lane2:in', 'zoomKey:lane2:out', 'zoomKey:lane2:out', 'zoomKey:lane2:reset']);
    // The pointer gone, the key goes on.
    at('#tracks').dispatchEvent(new window.MouseEvent('mouseleave'));
    assert.equal(key('+'), false);
});

test('a zoom key over a plot that shows nothing goes on to the keys behind it', () => {
    const { window, doc, at } = setup(false, true, undefined, false);
    at('.track-canvas').dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
    const event = new window.KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true });
    doc.body.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
});

test('a plot of another surface with only the focus never takes ← / → from the plot under the pointer: the cursor spectrum focused, the pointer on a lane, the lane steps (A47, R7)', () => {
    const { window } = new JSDOM('<!doctype html><body><div id="lanes"><canvas class="track-canvas" id="lane"></canvas></div><div id="spectrum"><canvas class="spectrum-canvas" id="spec" tabindex="0"></canvas></div></body>');
    const doc = window.document;
    const calls: string[] = [];
    const handlers = (name: string) => ({
        step: (plot: Element, delta: -1 | 0 | 1) => { calls.push(`${name}:${plot.id}:${delta}`); return true; },
        resetZoom: () => undefined, openAxisRange: () => false, hover: () => undefined, clearHover: () => undefined,
        press: () => undefined, drag: () => undefined, release: () => undefined, zoomWheel: () => undefined, panWheel: () => undefined, zoomKey: () => false,
    });
    const keys = keyRouterFor(window);
    // The lanes' surface is attached first, the spectrum's after it (so the spectrum's keys are tried first), as the comparison does.
    attachTrackPointerListeners(doc.getElementById('lanes') as HTMLElement, doc, keys, handlers('lanes'));
    attachTrackPointerListeners(doc.getElementById('spectrum') as HTMLElement, doc, keys, handlers('spectrum'), { plot: '.spectrum-canvas' });
    const spec = doc.getElementById('spec') as HTMLElement;
    spec.focus();
    calls.length = 0;
    (doc.getElementById('lane') as HTMLElement).dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
    spec.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true }));
    assert.deepEqual(calls, ['lanes:lane:1'], 'the lane under the pointer steps');
    // With the pointer off every plot, the focused spectrum takes them.
    (doc.getElementById('lanes') as HTMLElement).dispatchEvent(new window.MouseEvent('mouseleave'));
    calls.length = 0;
    spec.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true }));
    assert.deepEqual(calls, ['spectrum:spec:1']);
});
