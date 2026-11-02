import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { drawnAtOtherSize, redrawWhenResized } from '../webview/runtime/canvasResize';

/** A canvas shown at `shown` CSS pixels (jsdom lays nothing out) with a `drawn` bitmap. */
function canvasAt(document: Document, shown: [number, number], drawn: [number, number]): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { get: () => shown[0] });
    Object.defineProperty(canvas, 'clientHeight', { get: () => shown[1] });
    [canvas.width, canvas.height] = drawn;
    return canvas;
}

test('a canvas is at another size when its bitmap differs from where it is shown by more than a pixel; a hidden one is not', () => {
    const { document } = new JSDOM('<!doctype html><body></body>').window;
    assert.equal(drawnAtOtherSize(canvasAt(document, [400, 200], [400, 200])), false);
    assert.equal(drawnAtOtherSize(canvasAt(document, [400, 200], [401, 199])), false);
    assert.equal(drawnAtOtherSize(canvasAt(document, [400, 180], [400, 200])), true);
    assert.equal(drawnAtOtherSize(canvasAt(document, [0, 0], [400, 200])), false);
});

test('a watched canvas resized to another size than it was drawn at is drawn again; one still at its size is not', () => {
    const { document } = new JSDOM('<!doctype html><body></body>').window;
    let notify: ((entries: Array<{ target: Element }>) => void) | undefined;
    const observed: Element[] = [];
    const Observer = class {
        constructor(callback: (entries: Array<{ target: Element }>) => void) { notify = callback; }
        observe(target: Element): void { observed.push(target); }
    } as unknown as typeof ResizeObserver;
    const stretched = canvasAt(document, [400, 180], [400, 200]);
    const fitting = canvasAt(document, [400, 200], [400, 200]);
    let redraws = 0;
    redrawWhenResized(Observer, [stretched, fitting], () => { redraws += 1; });
    assert.deepEqual(observed, [stretched, fitting]);
    notify?.([{ target: fitting }]);
    assert.equal(redraws, 0);
    notify?.([{ target: fitting }, { target: stretched }]);
    assert.equal(redraws, 1);
    // Without a ResizeObserver (an old host) nothing is watched, and nothing breaks.
    redrawWhenResized(undefined, [stretched], () => { redraws += 1; });
    assert.equal(redraws, 1);
});
