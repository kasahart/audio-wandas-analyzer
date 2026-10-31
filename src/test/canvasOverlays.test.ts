import assert from 'node:assert/strict';
import test from 'node:test';
import {
    analysisWindowWeight,
    canvasTimeHit,
    clampedCanvasNorm,
    clientToCanvasPixels,
    CURSOR_LINE_STYLE,
    drawAnalysisWindowBand,
    drawDashedTimeLine,
    drawRectZoomSelection,
    formatReadoutHz,
    waveformCursorLineStyle,
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

test('the waveform cursor takes the theme text colour and falls back to white without one', () => {
    assert.deepEqual(waveformCursorLineStyle('#1e1e1e'), { color: '#1e1e1e', alpha: CURSOR_LINE_STYLE.alpha });
    assert.equal(waveformCursorLineStyle(''), CURSOR_LINE_STYLE);
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

test('analysisWindowWeight follows the named window and treats boxcar as flat', () => {
    assert.equal(analysisWindowWeight('hann', 0), 0);
    assert.equal(analysisWindowWeight('hann', 0.5), 1);
    assert.ok(Math.abs(analysisWindowWeight('hamming', 0) - 0.08) < 1e-12);
    assert.ok(Math.abs(analysisWindowWeight('blackman', 0.5) - 1) < 1e-12);
    assert.equal(analysisWindowWeight('boxcar', 0.1), 1);
});

test('drawAnalysisWindowBand traces the window shape across the band', () => {
    const { ctx, calls } = recordingContext();
    drawAnalysisWindowBand(ctx, { startNorm: 0.25, endNorm: 0.75, window: 'hann' }, { start: 0, end: 1 }, 200, 40);
    const points = calls.filter(([name]) => name === 'lineTo').map(([, args]) => args as number[]);
    assert.equal(points[0][0], 50);
    assert.equal(points[0][1], 20);
    const peak = points.reduce((best, p) => (p[1] < best[1] ? p : best));
    const trough = points.reduce((best, p) => (p[1] > best[1] ? p : best));
    assert.equal(peak[0], 100);
    assert.equal(trough[0], 100);
    assert.ok(peak[1] < 5);
    assert.equal(peak[1] + trough[1], 40);
});

test('drawAnalysisWindowBand keeps a visible minimum width and skips bands outside the view', () => {
    const narrow = recordingContext();
    drawAnalysisWindowBand(narrow.ctx, { startNorm: 0.5, endNorm: 0.5001, window: 'hann' }, { start: 0, end: 1 }, 200, 40);
    const fill = narrow.calls.find(([name]) => name === 'fillRect');
    assert.ok(fill && (fill[1][2] as number) >= 3);
    assert.equal(narrow.calls.some(([name]) => name === 'lineTo'), false);
    const outside = recordingContext();
    drawAnalysisWindowBand(outside.ctx, { startNorm: 0.8, endNorm: 0.9 }, { start: 0, end: 0.5 }, 200, 40);
    assert.equal(outside.calls.length, 0);
});

test('drawRectZoomSelection uses the explicit amplitude range even when it spans both peaks', () => {
    const { ctx, calls } = recordingContext();
    const selection = { trackId: 't', startNorm: 0, endNorm: 1, startAmpNorm: 1, endAmpNorm: -1 };
    drawRectZoomSelection(ctx, selection as never, { start: 0, end: 1 }, { start: -2, end: 2, explicit: true }, 100, 100);
    const fill = calls.find(([name]) => name === 'fillRect');
    assert.ok(fill);
    const [, top, , height] = fill[1] as number[];
    assert.ok(Math.abs(top - 25) < 1e-9);
    assert.ok(Math.abs(height - 50) < 1e-9);
});
