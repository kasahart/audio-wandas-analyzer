import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachPlotInteraction, FULL_PLOT_WINDOW, PLOT_DOUBLE_CLICK_MS, windowFromBox, type PlotDrag, type PlotInteractionDeps, type PlotPoint, type PlotWindow } from '../webview/runtime/plotInteraction';

test('a box zooms both axes; one too thin on an axis it zooms zooms nothing', () => {
    assert.deepEqual(windowFromBox(FULL_PLOT_WINDOW, { fx: 0.2, fy: 0.1 }, { fx: 0.6, fy: 0.5 }), { x: { start: 0.2, end: 0.6 }, y: { start: 0.1, end: 0.5 } });
    assert.equal(windowFromBox(FULL_PLOT_WINDOW, { fx: 0.2, fy: 0.3 }, { fx: 0.6, fy: 0.3 }), null);
    assert.equal(windowFromBox(FULL_PLOT_WINDOW, { fx: 0.3, fy: 0.1 }, { fx: 0.3, fy: 0.5 }), null);
});

test('on a plot whose vertical axis shows all counts, a box zooms its value axis and every count stays on screen (R13)', () => {
    const window = { x: { start: 0, end: 0.5 }, y: { start: 0.25, end: 0.75 } };
    assert.deepEqual(windowFromBox(window, { fx: 0.2, fy: 0.3 }, { fx: 0.6, fy: 0.3 }, 'all-counts'), { x: { start: 0.1, end: 0.3 }, y: FULL_PLOT_WINDOW.y });
    assert.deepEqual(windowFromBox(window, { fx: 0.2, fy: 0.1 }, { fx: 0.6, fy: 0.5 }, 'all-counts'), { x: { start: 0.1, end: 0.3 }, y: FULL_PLOT_WINDOW.y });
    assert.equal(windowFromBox(window, { fx: 0.3, fy: 0.1 }, { fx: 0.3, fy: 0.9 }, 'all-counts'), null);
    assert.deepEqual(windowFromBox(window, { fx: 0.2, fy: 0.1 }, { fx: 0.6, fy: 0.5 }, 'zoom'), { x: { start: 0.1, end: 0.3 }, y: { start: 0.3, end: 0.5 } });
});

/** Two plots and an axis strip on a surface, with the shared gestures' deps recording what they are asked. */
function surface(extra: Partial<PlotInteractionDeps> = {}) {
    const { window } = new JSDOM('<!doctype html><body><div id="surface"><canvas class="plot" id="a"></canvas><canvas class="plot" id="b"></canvas><canvas class="axis" id="axis"></canvas><span id="header"></span></div></body>');
    const doc = window.document;
    const element = (id: string): HTMLElement => doc.getElementById(id) as HTMLElement;
    for (const id of ['a', 'b', 'axis', 'header']) element(id).getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    const calls: string[] = [];
    let window_: PlotWindow = FULL_PLOT_WINDOW;
    const point = (clientX: number, clientY: number): PlotPoint => ({ fx: clientX / 100, fy: 1 - clientY / 100 });
    attachPlotInteraction(element('surface'), doc, '.plot', {
        locate: (target, clientX, clientY) => {
            const plot = (target as HTMLElement | null)?.closest?.<HTMLElement>('.plot');
            return plot ? { plot, point: point(clientX, clientY), axis: null } : null;
        },
        pointOn: (_plot, clientX, clientY) => point(clientX, clientY),
        window: () => window_,
        setWindow: (plot, next) => { calls.push(`window:${plot.id}:${next ? `${next.x.start.toFixed(3)}-${next.x.end.toFixed(3)}` : 'whole'}`); window_ = next ?? FULL_PLOT_WINDOW; },
        hover: () => undefined,
        clearHover: () => undefined,
        showBox: plot => { calls.push(`box:${plot.id}`); },
        hideBox: () => { calls.push('hide'); },
        openAxisRange: (hit, _x, _y, clicked) => { calls.push(`range:${hit.plot.id}:${hit.axis}:${clicked.id}`); return true; },
        stepFrom: () => null,
        ...extra,
    });
    const mouse = (target: EventTarget, type: string, clientX: number, init: MouseEventInit = {}): void => {
        target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...(type === 'mousemove' ? { buttons: 1 } : {}), clientX, clientY: 50, ...init }));
    };
    const drag = (id: string, from: number, to: number, init: MouseEventInit = {}): void => {
        mouse(element(id), 'mousedown', from, init);
        mouse(doc, 'mousemove', to, init);
        mouse(doc, 'mouseup', to, init);
    };
    const wheel = (id: string, init: WheelEventInit): void => { element(id).dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 50, clientY: 50, ...init })); };
    return { window, doc, element, calls, mouse, drag, wheel };
}

const recorder = (calls: string[], name: string): PlotDrag => ({
    start: hit => { calls.push(`${name}:start:${hit.plot.id}`); },
    move: () => { calls.push(`${name}:move`); },
    end: (_event, dragged) => { calls.push(`${name}:end:${dragged}`); },
});

test('a plain drag zooms into its box, Alt+drag and Shift+drag are the plot\'s own; Alt is taken before Shift', () => {
    const calls: string[] = [];
    const { drag } = surface({ altDrag: recorder(calls, 'alt'), shiftDrag: recorder(calls, 'shift') });
    drag('a', 20, 60, { shiftKey: true });
    drag('a', 20, 60, { altKey: true });
    drag('b', 20, 60, { altKey: true, shiftKey: true });
    assert.deepEqual(calls, ['shift:start:a', 'shift:move', 'shift:end:true', 'alt:start:a', 'alt:move', 'alt:end:true', 'alt:start:b', 'alt:move', 'alt:end:true']);
});

test('a plot without a Shift drag zooms into the box Shift+drag draws', () => {
    const { element, doc, mouse, calls } = surface();
    mouse(element('a'), 'mousedown', 20, { shiftKey: true, clientY: 80 });
    mouse(doc, 'mousemove', 60, { shiftKey: true, clientY: 20 });
    mouse(doc, 'mouseup', 60, { shiftKey: true, clientY: 20 });
    assert.equal(calls[0], 'box:a');
    assert.ok(calls.includes('window:a:0.200-0.600'), calls.join(', '));
});

test('every press is told the plot first; one that stays put is a tap, told nowhere else, and Alt or Shift tells its drag', () => {
    const calls: string[] = [];
    const { mouse, element, doc } = surface({
        pressed: hit => { calls.push(`pressed:${hit.plot.id}`); },
        tap: (plot, event) => { calls.push(`tap:${plot.id}:${event.clientX}`); },
        shiftDrag: recorder(calls, 'shift'),
    });
    mouse(element('b'), 'mousedown', 30);
    mouse(doc, 'mouseup', 31);
    mouse(element('a'), 'mousedown', 30, { shiftKey: true });
    mouse(doc, 'mouseup', 30, { shiftKey: true });
    assert.deepEqual(calls, ['pressed:b', 'tap:b:31', 'pressed:a', 'shift:start:a', 'shift:end:false']);
});

test('a plot that maps a box itself is given the box and the release, in place of the window it would set', () => {
    const boxes: string[] = [];
    const { drag, calls } = surface({ zoomToBox: (plot, from, to, release) => { boxes.push(`${plot.id}:${from.fx}-${to.fx}:${release.clientX}`); } });
    drag('a', 20, 60);
    assert.deepEqual(boxes, ['a:0.2-0.6:60']);
    assert.deepEqual(calls, ['box:a', 'hide']);
});

test('the wheel acts where wheelAt says: off the plots too, and not at all where it says none', () => {
    const { wheel, calls, element } = surface({
        wheelAt: (target, _x, _y, gesture) => ((target as HTMLElement).id === 'b' && gesture === 'zoom' ? null : { plot: element('a'), point: { fx: 0.5, fy: 0.5 }, axis: null }),
    });
    wheel('header', { ctrlKey: true, deltaY: -100 });
    wheel('b', { ctrlKey: true, deltaY: -100 });
    wheel('b', { shiftKey: true, deltaY: 100 });
    assert.deepEqual(calls, ['window:a:0.075-0.925', 'window:a:0.150-1.000']);
});

test('a double-click on an axis drawn on its own canvas opens its range, told the element; where it has none the zoom resets', () => {
    const { mouse, element, calls } = surface({
        axes: { selector: '.axis', locate: axis => ({ plot: element('a'), point: { fx: 0, fy: 0.5 }, axis: axis.id === 'axis' ? 'y' : null }) },
    });
    mouse(element('axis'), 'dblclick', 5);
    mouse(element('b'), 'dblclick', 50);
    assert.deepEqual(calls, ['range:a:y:axis', 'window:b:whole']);
});

test('a plot that keeps the arrows for itself while focused does not step its readout from them; another plot does', () => {
    for (const keeps of [true, false]) {
        const steps: string[] = [];
        const { window, element } = surface({ focusKeepsArrows: keeps, stepFrom: plot => { steps.push(plot.id); return null; } });
        element('a').tabIndex = 0;
        element('a').focus();
        element('a').dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'ArrowRight', key: 'ArrowRight' }));
        assert.deepEqual(steps, keeps ? [] : ['a', 'a']);
    }
});

test('+ / − zoom the horizontal axis of the plot under the pointer around its middle and 0 shows it whole; the window it set is named on the plot (R13)', () => {
    const { window, element, mouse, calls } = surface();
    const key = (name: string): boolean => {
        const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: name });
        window.document.body.dispatchEvent(event);
        return event.defaultPrevented;
    };
    // Off every plot the key is not the plots'.
    assert.equal(key('+'), false);
    // The pointer near the plot's left edge: the zoom is still about the middle, not the pointer.
    mouse(element('b'), 'mousemove', 5);
    assert.equal(key('+'), true);
    assert.equal(element('b').dataset.plotWindow, '0.150 0.850 0.000 1.000');
    assert.equal(key('-'), true);
    assert.equal(key('0'), true);
    assert.deepEqual(calls, ['window:b:0.150-0.850', 'window:b:0.000-1.000', 'window:b:whole']);
    assert.equal(element('b').dataset.plotWindow, '0.000 1.000 0.000 1.000');
});

test('a zoom key over a plot that shows nothing (locate finds none) goes on to the view\'s keys', () => {
    const { window, element, mouse, calls } = surface({ locate: () => null });
    mouse(element('a'), 'mousemove', 50);
    const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: '+' });
    window.document.body.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assert.deepEqual(calls, []);
});

test('Ctrl+wheel over an axis zooms the horizontal axis around its middle; over the plot, around the pointer (R13)', () => {
    let axis: 'x' | 'y' | null = 'y';
    const { wheel, calls, element } = surface({ wheelAt: (_target, clientX) => ({ plot: element('a'), point: { fx: clientX / 100, fy: 0.5 }, axis }) });
    wheel('a', { ctrlKey: true, deltaY: -100, clientX: 10 });
    axis = 'x';
    wheel('a', { ctrlKey: true, deltaY: 100, clientX: 10 });
    axis = null;
    wheel('a', { ctrlKey: true, deltaY: -100, clientX: 0 });
    assert.deepEqual(calls, ['window:a:0.075-0.925', 'window:a:0.011-0.989', 'window:a:0.011-0.842']);
});

test('Ctrl+wheel on an axis drawn on its own canvas zooms about the middle, as on an axis drawn on the plot', () => {
    const { wheel, calls, element } = surface({ axes: { selector: '.axis', locate: () => ({ plot: element('a'), point: { fx: 0.1, fy: 0.5 }, axis: 'x' }) } });
    wheel('axis', { ctrlKey: true, deltaY: -100, clientX: 10 });
    wheel('header', { ctrlKey: true, deltaY: -100 });
    assert.deepEqual(calls, ['window:a:0.075-0.925']);
});

test('a drag under way reads nothing, and let go (a box zoom, Alt+drag, Shift+drag) the readout is the pointer\'s where it was let go, never where it was pressed (R7)', () => {
    for (const init of [{}, { altKey: true }, { shiftKey: true }] as MouseEventInit[]) {
        const calls: string[] = [];
        const { drag } = surface({
            hover: (event, hit) => { calls.push(`hover:${hit?.plot.id ?? 'none'}:${event.clientX}`); },
            clearHover: () => { calls.push('clear'); },
            altDrag: recorder([], 'alt'), shiftDrag: recorder([], 'shift'),
        });
        drag('a', 20, 60, init);
        assert.deepEqual(calls, ['clear', 'hover:a:60'], JSON.stringify(init));
    }
});

/** Two surfaces of plots on one page, each with its own gestures, recording taps done and hovers read. */
function twoSurfaces() {
    const { window } = new JSDOM('<!doctype html><body><div id="one"><canvas class="plot" id="a"></canvas></div><div id="two"><canvas class="plot" id="b"></canvas></div></body>');
    const doc = window.document;
    const element = (id: string): HTMLElement => doc.getElementById(id) as HTMLElement;
    for (const id of ['a', 'b']) element(id).getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    const done: string[] = [];
    const point = (clientX: number, clientY: number): PlotPoint => ({ fx: clientX / 100, fy: 1 - clientY / 100 });
    for (const id of ['one', 'two']) {
        attachPlotInteraction(element(id), doc, '.plot', {
            locate: (target, clientX, clientY) => {
                // Each surface finds its own plots only, as every owner's does.
                const plot = (target as HTMLElement | null)?.closest?.<HTMLElement>('.plot');
                return plot && element(id).contains(plot) ? { plot, point: point(clientX, clientY), axis: null } : null;
            },
            pointOn: (_plot, clientX, clientY) => point(clientX, clientY),
            window: () => FULL_PLOT_WINDOW,
            setWindow: plot => { done.push(`window:${plot.id}`); },
            hover: (_event, hit) => { if (hit) done.push(`hover:${hit.plot.id}`); },
            clearHover: () => undefined,
            showBox: () => undefined,
            hideBox: () => undefined,
            openAxisRange: () => false,
            stepFrom: plot => { done.push(`step:${plot.id}`); return null; },
            // The click is decided at the press (its x on the plot as clicked), done once no double click follows.
            tap: (plot, event) => { const x = event.clientX; return () => { done.push(`tap:${plot.id}:${x}`); }; },
        });
    }
    const mouse = (target: EventTarget, type: string, clientX: number, init: MouseEventInit = {}): void => {
        target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...(type === 'mousemove' ? { buttons: 1 } : {}), clientX, clientY: 50, ...init }));
    };
    const click = (id: string, clientX: number, detail = 1): void => { mouse(element(id), 'mousedown', clientX, { detail }); mouse(doc, 'mouseup', clientX, { detail }); };
    const wait = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, PLOT_DOUBLE_CLICK_MS + 60); });
    const key = (code: string, keyName = code): void => { doc.body.dispatchEvent(new window.KeyboardEvent('keydown', { code, key: keyName, bubbles: true, cancelable: true })); };
    return { doc, element, done, mouse, click, wait, key };
}

test('one arbitration of a click for every plot: done once no double click follows, a double click does none, and the next press anywhere (a drag, another plot\'s click) takes its place (R13)', async () => {
    const { doc, element, done: calls, mouse, click, wait } = twoSurfaces();
    const done = { get taps() { return calls.filter(call => call.startsWith('tap:')); } };
    click('a', 30);
    assert.deepEqual(done.taps, [], 'not at once: a double click may follow');
    await wait();
    assert.deepEqual(done.taps, ['tap:a:30']);
    // A double click (a zoom reset) does nothing else.
    click('a', 30, 1); click('a', 30, 2);
    await wait();
    assert.deepEqual(done.taps, ['tap:a:30'], 'a double click is no click');
    // A click, then a drag on the other surface before it is done: the drag takes its place.
    click('a', 40);
    mouse(element('b'), 'mousedown', 20);
    mouse(doc, 'mousemove', 70);
    mouse(doc, 'mouseup', 70);
    await wait();
    assert.deepEqual(done.taps, ['tap:a:30'], 'the next press cancels the click');
    // A click on one plot, then one on the other: only the last is done.
    click('a', 40); click('b', 60);
    await wait();
    assert.deepEqual(done.taps, ['tap:a:30', 'tap:b:60']);
});

test('a drag under way on one surface reads nothing on another: no hover until it is let go (R7)', () => {
    const { doc, element, done, mouse } = twoSurfaces();
    mouse(element('a'), 'mousedown', 20);
    mouse(doc, 'mousemove', 70);
    done.length = 0;
    mouse(element('b'), 'mousemove', 50);
    assert.deepEqual(done.filter(call => call === 'hover:b'), [], 'no hover on the other surface while dragging');
    mouse(doc, 'mouseup', 70);
    done.length = 0;
    mouse(element('b'), 'mousemove', 55);
    assert.ok(done.includes('hover:b'), 'read again once let go');
});

test('during a drag on one surface the keys over another plot step and zoom nothing; let go there, it reads where it was let go without a move (R7)', () => {
    const { doc, element, done, mouse, key } = twoSurfaces();
    mouse(element('a'), 'mousedown', 20);
    mouse(doc, 'mousemove', 70);
    // The pointer over b (a drag carried across): its hover is not read meanwhile.
    element('b').dispatchEvent(new (doc.defaultView as Window & typeof globalThis).MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: 60, clientY: 50 }));
    done.length = 0;
    key('ArrowRight');
    key('Equal', '=');
    assert.deepEqual(done.filter(call => call.startsWith('step:') || call.startsWith('window:b')), [], 'no step and no zoom of b while the drag is under way');
    // Let go over b, the pointer still: b reads there.
    element('b').dispatchEvent(new (doc.defaultView as Window & typeof globalThis).MouseEvent('mouseup', { bubbles: true, clientX: 60, clientY: 50, button: 0 }));
    assert.ok(done.includes('hover:b'), `read where it was let go: ${done.join(', ')}`);
});

test('a press moved within the drag threshold and let go reads where it was let go, as the time lines go there (R7)', () => {
    const { doc, element, done, mouse } = twoSurfaces();
    mouse(element('a'), 'mousedown', 20);
    done.length = 0;
    mouse(doc, 'mousemove', 22);
    element('a').dispatchEvent(new (doc.defaultView as Window & typeof globalThis).MouseEvent('mouseup', { bubbles: true, clientX: 22, clientY: 50, button: 0, detail: 1 }));
    assert.ok(done.includes('hover:a'), `read at the release: ${done.join(', ')}`);
});
