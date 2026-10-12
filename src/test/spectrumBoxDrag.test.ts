import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachSpectrumBoxDrag, SpectrumBoxDrag, type SpectrumBoxSpan } from '../webview/runtime/spectrumBoxDrag';
import { overlayPlotPoint } from '../webview/runtime/spectrumRuntime';

test('a new drag is inactive and ignores updates', () => {
    const drag = new SpectrumBoxDrag();
    assert.equal(drag.active, false);
    drag.update({ freqNorm: 0.1, dbNorm: 0.1 });
    assert.equal(drag.box, null);
    assert.equal(drag.finish(), null);
});

test('begin copies the anchor into the current point', () => {
    const drag = new SpectrumBoxDrag();
    const anchor = { freqNorm: 0.1, dbNorm: 0.2 };
    drag.begin(anchor);
    assert.equal(drag.active, true);
    assert.deepEqual(drag.box, { anchor, current: { freqNorm: 0.1, dbNorm: 0.2 } });
    assert.notEqual(drag.box?.current, anchor);
});

test('update moves the current point and finish ends the drag', () => {
    const drag = new SpectrumBoxDrag();
    drag.begin({ freqNorm: 0.1, dbNorm: 0.2 });
    drag.update({ freqNorm: 0.3, dbNorm: 0.5 });
    assert.deepEqual(drag.finish(), { anchor: { freqNorm: 0.1, dbNorm: 0.2 }, current: { freqNorm: 0.3, dbNorm: 0.5 } });
    assert.equal(drag.active, false);
    assert.equal(drag.finish(), null);
});

test('attachSpectrumBoxDrag drives a left-button drag from the canvas through document mouseup', () => {
    const dom = new JSDOM('<!doctype html><body><canvas id="c"></canvas></body>');
    const doc = dom.window.document;
    const el = doc.getElementById('c') as HTMLCanvasElement;
    const canvas = Object.assign(el, { getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect });
    canvas.width = 400;
    canvas.height = 200;
    const drag = new SpectrumBoxDrag();
    const log: string[] = [];
    const finished: SpectrumBoxSpan[] = [];
    attachSpectrumBoxDrag(canvas, doc, drag, {
        onUpdate: () => log.push('update'),
        onFinish: (span) => finished.push(span),
    });
    const mouse = (target: EventTarget, type: string, x: number, y: number, button = 0) =>
        target.dispatchEvent(new dom.window.MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true }));

    mouse(canvas, 'mousedown', 120, 60, 2);
    assert.equal(drag.active, false);
    mouse(doc, 'mousemove', 200, 100);
    assert.deepEqual(log, []);

    mouse(canvas, 'mousedown', 120, 60);
    assert.equal(drag.active, true);
    mouse(doc, 'mousemove', 200, 100);
    assert.deepEqual(log, ['update']);
    mouse(doc, 'mouseup', 200, 100);
    assert.equal(drag.active, false);
    assert.deepEqual(finished, [{ anchor: overlayPlotPoint(120, 60, 400, 200), current: overlayPlotPoint(200, 100, 400, 200) }]);

    mouse(doc, 'mouseup', 0, 0);
    assert.equal(finished.length, 1);
});
