import assert from 'node:assert/strict';
import test from 'node:test';
import {
    canvasTimeHit,
    clampedCanvasNorm,
    clientToCanvasPixels,
    CURSOR_LINE_STYLE,
    drawDashedTimeLine,
    drawRectZoomSelection,
    formatReadoutHz,
} from '../webview/runtime/canvasOverlays';

function recordingContext() {
    const calls: Array<[string, unknown[]]> = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
        get(target, key: string) {
            if (key in target) { return target[key]; }
            return (...args: unknown[]) => { calls.push([key, args]); };
        },
        set(target, key: string, value) {
            target[key] = value;
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
}

test('canvasTimeHit maps pointer X inside the time axis to the zoomed norm', () => {
    assert.deepEqual(canvasTimeHit(10, 60, 100, { start: 0.2, end: 0.6 }), { x: 50, timeWidth: 100, norm: 0.4 });
    assert.equal(canvasTimeHit(10, 5, 100, { start: 0, end: 1 }), null);
    assert.equal(canvasTimeHit(10, 111, 100, { start: 0, end: 1 }), null);
});

test('clampedCanvasNorm clamps to the visible axis and the file range', () => {
    assert.equal(clampedCanvasNorm(0, -50, 100, { start: 0.5, end: 1 }), 0.5);
    assert.equal(clampedCanvasNorm(0, 500, 100, { start: 0.5, end: 1 }), 1);
});

test('formatReadoutHz rounds near-integers and keeps one decimal otherwise', () => {
    assert.equal(formatReadoutHz(1000.02), '1000 Hz');
    assert.equal(formatReadoutHz(12.34), '12.3 Hz');
});

test('drawDashedTimeLine draws only when the time is inside the view', () => {
    const inside = recordingContext();
    drawDashedTimeLine(inside.ctx, 0.5, { start: 0, end: 1 }, 200, 40, CURSOR_LINE_STYLE);
    assert.deepEqual(inside.calls.find(([name]) => name === 'moveTo'), ['moveTo', [100, 0]]);
    const outside = recordingContext();
    drawDashedTimeLine(outside.ctx, 0.9, { start: 0, end: 0.5 }, 200, 40, CURSOR_LINE_STYLE);
    assert.equal(outside.calls.length, 0);
    const collapsed = recordingContext();
    drawDashedTimeLine(collapsed.ctx, 0.5, { start: 0.5, end: 0.5 }, 200, 40, CURSOR_LINE_STYLE);
    assert.equal(collapsed.calls.length, 0);
});

test('drawRectZoomSelection clips the selection rectangle to the canvas', () => {
    const { ctx, calls } = recordingContext();
    const selection = { trackId: 't', startNorm: 0.25, endNorm: 2, startAmpNorm: 0.5, endAmpNorm: -0.5 };
    drawRectZoomSelection(ctx, selection as never, { start: 0, end: 1 }, { start: -1, end: 1 }, 100, 100);
    const fill = calls.find(([name]) => name === 'fillRect');
    assert.ok(fill);
    assert.equal(fill[1][0], 25);
    assert.equal(fill[1][2], 75);
});

test('drawRectZoomSelection maps amplitudes through the zoomed amplitude range', () => {
    const { ctx, calls } = recordingContext();
    const selection = { trackId: 't', startNorm: 0, endNorm: 1, startAmpNorm: 0.4, endAmpNorm: 0.1 };
    drawRectZoomSelection(ctx, selection as never, { start: 0, end: 1 }, { start: 0, end: 0.5 }, 100, 100);
    const fill = calls.find(([name]) => name === 'fillRect');
    assert.ok(fill);
    const [left, top, width, height] = fill[1] as number[];
    assert.equal(left, 0);
    assert.equal(width, 100);
    assert.ok(Math.abs(top - 20) < 1e-9);
    assert.ok(Math.abs(height - 60) < 1e-9);
});

test('clientToCanvasPixels scales client offsets to the canvas backing store', () => {
    const rect = { left: 10, top: 20, width: 200, height: 50 };
    assert.deepEqual(clientToCanvasPixels(110, 45, rect, 400, 100), { x: 200, y: 50 });
});

test('clientToCanvasPixels uses a 1:1 scale when the canvas has no layout size', () => {
    const rect = { left: 10, top: 20, width: 0, height: 0 };
    assert.deepEqual(clientToCanvasPixels(15, 23, rect, 400, 100), { x: 5, y: 3 });
});
