import assert from 'node:assert/strict';
import test from 'node:test';
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

test('a click on a trigger\'s event line (the plot gestures\' tap: a press that stays put) leaves it out once no double-click follows; a drag or a double-click does not', async () => {
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
        lines: [{ view: { kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 0.5, 1], values: [0.5, 0.5, 0.5] }, color: '#000', event, full: 'drawn' }],
    } as unknown as StagePlot;
    const state = initialStageState();
    state.on = true;
    const toggled: string[] = [];
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, root, document, {
        strings: getStrings('en'), state, drawnOn: new Map([[canvas, { picture: null, range: { min: 0, max: 1 }, axes: { x: 't', y: 'v' }, plot }]]), painted: () => true,
        moved: () => undefined, rerender: () => undefined, hint: () => undefined, lanesApart: () => false,
        toggleEvent: line => { toggled.push(`take ${line.id}`); return () => toggled.push(`edit ${line.id}`); },
    });
    const at = { clientX: frame.left + 100, clientY: frame.top + 50 };
    const fire = (target: EventTarget, type: string, detail = 1, place = at): void => { target.dispatchEvent(new view.MouseEvent(type, { ...place, button: 0, bubbles: true, detail })); };
    const wait = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 400); });
    fire(canvas, 'mousedown');
    fire(document, 'mouseup');
    assert.deepEqual(toggled, ['take 2'], 'taken at once, edited once no double-click follows');
    await wait();
    assert.deepEqual(toggled, ['take 2', 'edit 2']);
    // A double-click (which resets the zoom) takes the first press's edit back.
    for (const detail of [1, 2]) { fire(canvas, 'mousedown', detail); fire(document, 'mouseup', detail); }
    await wait();
    assert.deepEqual(toggled, ['take 2', 'edit 2', 'take 2']);
    // A press dragged into a box zooms instead.
    fire(canvas, 'mousedown');
    fire(document, 'mousemove', 1, { clientX: frame.left + 180, clientY: frame.top + 90 });
    fire(document, 'mouseup', 1, { clientX: frame.left + 180, clientY: frame.top + 90 });
    await wait();
    assert.deepEqual(toggled, ['take 2', 'edit 2', 'take 2'], 'a drag leaves no event out');
    // Off the line, a click leaves nothing out.
    fire(canvas, 'mousedown', 1, { clientX: frame.left + 100, clientY: frame.top + 90 });
    fire(document, 'mouseup', 1, { clientX: frame.left + 100, clientY: frame.top + 90 });
    await wait();
    assert.deepEqual(toggled, ['take 2', 'edit 2', 'take 2']);
});
