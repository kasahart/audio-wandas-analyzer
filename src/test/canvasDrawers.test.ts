/**
 * src/webview/draw/canvasDrawers.ts の純粋関数を jsdom なしで直接 import して検証する。
 *
 * これらの関数は webview のインライン JS から切り出され、theme パラメータを
 * 取ることで DOM 依存を排除している。テストでは軽量な mock ctx を渡すだけで済む。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatHz,
    dbToRgb,
    drawSpectrumSelectionBox,
    type CanvasDrawCtx,
} from '../webview/draw/canvasDrawers';

interface RecordedOp { op: string; args: unknown[]; }

function makeMockCtx(): CanvasDrawCtx & { _ops: RecordedOp[]; _texts: string[] } {
    const ops: RecordedOp[] = [];
    const texts: string[] = [];
    const state: Record<string, unknown> = {
        fillStyle: '', strokeStyle: '', font: '',
        textAlign: 'left', textBaseline: 'alphabetic',
        globalAlpha: 1, lineWidth: 1,
    };
    return {
        get fillStyle() { return state.fillStyle as string; },
        set fillStyle(v) { state.fillStyle = v; ops.push({ op: 'set fillStyle', args: [v] }); },
        get strokeStyle() { return state.strokeStyle as string; },
        set strokeStyle(v) { state.strokeStyle = v; ops.push({ op: 'set strokeStyle', args: [v] }); },
        get font() { return state.font as string; },
        set font(v) { state.font = v; },
        get textAlign() { return state.textAlign as CanvasTextAlign; },
        set textAlign(v) { state.textAlign = v; },
        get textBaseline() { return state.textBaseline as CanvasTextBaseline; },
        set textBaseline(v) { state.textBaseline = v; },
        get globalAlpha() { return state.globalAlpha as number; },
        set globalAlpha(v) { state.globalAlpha = v; },
        get lineWidth() { return state.lineWidth as number; },
        set lineWidth(v) { state.lineWidth = v; },
        save() { ops.push({ op: 'save', args: [] }); },
        restore() { ops.push({ op: 'restore', args: [] }); },
        translate(x, y) { ops.push({ op: 'translate', args: [x, y] }); },
        rotate(a) { ops.push({ op: 'rotate', args: [a] }); },
        measureText(text) { return { width: text.length * 5 }; },
        beginPath() { ops.push({ op: 'beginPath', args: [] }); },
        moveTo(x, y) { ops.push({ op: 'moveTo', args: [x, y] }); },
        lineTo(x, y) { ops.push({ op: 'lineTo', args: [x, y] }); },
        rect(x, y, w, h) { ops.push({ op: 'rect', args: [x, y, w, h] }); },
        clip() { ops.push({ op: 'clip', args: [] }); },
        setLineDash(s) { ops.push({ op: 'setLineDash', args: [s] }); },
        stroke() { ops.push({ op: 'stroke', args: [] }); },
        clearRect(x, y, w, h) { ops.push({ op: 'clearRect', args: [x, y, w, h] }); },
        fillRect(x, y, w, h) { ops.push({ op: 'fillRect', args: [x, y, w, h] }); },
        strokeRect(x, y, w, h) { ops.push({ op: 'strokeRect', args: [x, y, w, h] }); },
        fillText(t, x, y) { texts.push(t); ops.push({ op: 'fillText', args: [t, x, y] }); },
        createImageData(w, h) {
            return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w) * Math.max(0, h) * 4) };
        },
        putImageData(img, x, y) { ops.push({ op: 'putImageData', args: [img.width, img.height, x, y] }); },
        _ops: ops,
        _texts: texts,
    };
}

// ── formatHz ──

test('formatHz: 1000 未満は "<n> Hz" を返す', () => {
    assert.equal(formatHz(0), '0 Hz');
    assert.equal(formatHz(440), '440 Hz');
    assert.equal(formatHz(999), '999 Hz');
});

test('formatHz: 1000 以上 10000 未満は "<n.n> kHz"', () => {
    assert.equal(formatHz(1000), '1.0 kHz');
    assert.equal(formatHz(5500), '5.5 kHz');
});

test('formatHz: 10000 以上は整数 kHz', () => {
    assert.equal(formatHz(10000), '10 kHz');
    assert.equal(formatHz(22050), '22 kHz');
});

// ── dbToRgb ──

test('dbToRgb: norm=0 は暗い紫系 (viridis 下端)', () => {
    const [r, g, b] = dbToRgb(0);
    assert.equal(r, 68);
    assert.equal(g, 1);
    assert.equal(b, 84);
});

test('dbToRgb: norm=1 は明るい黄系 (viridis 上端)', () => {
    const [r, g, b] = dbToRgb(1);
    assert.ok(r >= 240);
    assert.ok(g >= 200);
    assert.ok(b < 80);
});

test('dbToRgb: 各セグメント境界で連続している', () => {
    // viridis は単一チャンネルで単調でないが、norm の閾値 (0.25/0.5/0.75) で
    // ジャンプしないこと (区分線形補間が連続) を確認する。
    const eps = 1e-3;
    for (const boundary of [0.25, 0.5, 0.75]) {
        const lo = dbToRgb(boundary - eps);
        const hi = dbToRgb(boundary + eps);
        for (let c = 0; c < 3; c++) {
            assert.ok(Math.abs(lo[c] - hi[c]) <= 2,
                `discontinuity at norm=${boundary} channel ${c}: ${lo[c]} -> ${hi[c]}`);
        }
    }
});

// ── drawSpectrumSelectionBox ──

const crosshairFrame = { padLeft: 10, plotWidth: 100, padTop: 5, plotHeight: 50, frequencyMin: 0, frequencyMax: 1, dbMin: -1, dbMax: 0 };

test('drawSpectrumSelectionBox: 正規化座標の 2 点から左上基準の矩形を塗りと枠で描く', () => {
    const ctx = makeMockCtx();
    drawSpectrumSelectionBox(ctx, crosshairFrame, { freqNorm: 0.8, dbNorm: 0.2 }, { freqNorm: 0.3, dbNorm: 0.6 });
    const rects = ctx._ops.filter((o) => o.op === 'fillRect' || o.op === 'strokeRect');
    assert.deepEqual(rects, [
        { op: 'fillRect', args: [40, 25, 50, 20] },
        { op: 'strokeRect', args: [40, 25, 50, 20] },
    ]);
    assert.ok(ctx._ops.some((o) => o.op === 'setLineDash'));
    assert.equal(ctx._ops[ctx._ops.length - 1].op, 'restore');
});
