import assert from 'node:assert/strict';
import test from 'node:test';
import { FULL_PLOT_WINDOW, windowFromBox } from '../webview/runtime/plotInteraction';

test('a box zooms both axes; one too thin on an axis it zooms zooms nothing', () => {
    assert.deepEqual(windowFromBox(FULL_PLOT_WINDOW, { fx: 0.2, fy: 0.1 }, { fx: 0.6, fy: 0.5 }), { x: { start: 0.2, end: 0.6 }, y: { start: 0.1, end: 0.5 } });
    assert.equal(windowFromBox(FULL_PLOT_WINDOW, { fx: 0.2, fy: 0.3 }, { fx: 0.6, fy: 0.3 }), null);
    assert.equal(windowFromBox(FULL_PLOT_WINDOW, { fx: 0.3, fy: 0.1 }, { fx: 0.3, fy: 0.5 }), null);
});

test('on a plot that zooms only its horizontal axis, a level drag zooms it and the vertical window stays', () => {
    const window = { x: { start: 0, end: 0.5 }, y: { start: 0.25, end: 0.75 } };
    assert.deepEqual(windowFromBox(window, { fx: 0.2, fy: 0.3 }, { fx: 0.6, fy: 0.3 }, true), { x: { start: 0.1, end: 0.3 }, y: window.y });
    assert.equal(windowFromBox(window, { fx: 0.3, fy: 0.1 }, { fx: 0.3, fy: 0.9 }, true), null);
});
