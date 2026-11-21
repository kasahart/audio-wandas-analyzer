import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisWindowWeight, CURSOR_LINE_STYLE, drawAnalysisWindowBand, drawDashedTimeLine, waveformCursorLineStyle } from '../webview/runtime/canvasOverlays';

function recordingContext() {
    const calls: Array<[string, unknown[]]> = [];
    const ctx = new Proxy<Record<string, unknown>>({}, {
        get(target, key: string) {
            if (key in target) { return target[key]; }
            return (...args: unknown[]) => { calls.push([key, args]); };
        },
        set(target, key: string, value) {
            target[key] = value;
            calls.push(['set:' + key, [value]]);
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls };
}

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

test('drawAnalysisWindowBand is a neutral grey, not a role\'s or the failure\'s hue, on a dark and a light lane (R5)', () => {
    for (const light of [false, true]) {
        const { ctx, calls } = recordingContext();
        drawAnalysisWindowBand(ctx, { startNorm: 0.25, endNorm: 0.75, window: 'hann' }, { start: 0, end: 1 }, 200, 40, light);
        const styles = calls.filter(([name]) => name === 'set:strokeStyle' || name === 'set:fillStyle').map(([, args]) => String(args[0]));
        assert.ok(styles.length > 0);
        for (const style of styles) {
            const [r, g, b] = style.match(/\d+/g)!.map(Number);
            assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 20, `${style} is a grey`);
            assert.ok(light ? r < 128 : r > 128, `${style} stands out on the lane`);
        }
    }
});

