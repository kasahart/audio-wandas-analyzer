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
    drawWaveformAmplitudeAxis,
    drawSpectrogramAxes,
    drawSpectrumLine,
    drawSpectrumAxes,
    DEFAULT_THEME,
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
        beginPath() { ops.push({ op: 'beginPath', args: [] }); },
        moveTo(x, y) { ops.push({ op: 'moveTo', args: [x, y] }); },
        lineTo(x, y) { ops.push({ op: 'lineTo', args: [x, y] }); },
        stroke() { ops.push({ op: 'stroke', args: [] }); },
        fillRect(x, y, w, h) { ops.push({ op: 'fillRect', args: [x, y, w, h] }); },
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

// ── drawWaveformAmplitudeAxis ──

test('drawWaveformAmplitudeAxis: 振幅ラベル (+1.0 / 0 / -1.0) と Amp タイトルを描画', () => {
    const ctx = makeMockCtx();
    drawWaveformAmplitudeAxis(ctx, 800, 80);
    assert.ok(ctx._texts.includes('+1.0'));
    assert.ok(ctx._texts.includes('0'));
    assert.ok(ctx._texts.includes('-1.0'));
    assert.ok(ctx._texts.some((t) => t.includes('Amp')));
});

test('drawWaveformAmplitudeAxis: 半透明バックプレートとして fillRect を呼ぶ', () => {
    const ctx = makeMockCtx();
    drawWaveformAmplitudeAxis(ctx, 800, 80);
    const rects = ctx._ops.filter((o) => o.op === 'fillRect');
    assert.equal(rects.length, 1);
    assert.deepEqual(rects[0].args, [0, 0, 30, 80]);
});

test('drawWaveformAmplitudeAxis: save/restore はペアで呼ばれる', () => {
    const ctx = makeMockCtx();
    drawWaveformAmplitudeAxis(ctx, 800, 80);
    const saves = ctx._ops.filter((o) => o.op === 'save').length;
    const restores = ctx._ops.filter((o) => o.op === 'restore').length;
    assert.equal(saves, restores);
});

// ── drawSpectrogramAxes ──

const sampleSpec = { minDb: -90, maxDb: 0, maxFrequencyHz: 22050 };

test('drawSpectrogramAxes: Hz ラベルとカラーバー dB ラベルを描画', () => {
    const ctx = makeMockCtx();
    drawSpectrogramAxes(ctx, 800, 80, sampleSpec);
    assert.ok(ctx._texts.includes('0 Hz'));
    assert.ok(ctx._texts.some((t) => /kHz$/.test(t)));
    assert.ok(ctx._texts.includes('0 dB'));
    assert.ok(ctx._texts.some((t) => /-?\d+ dB$/.test(t)));
});

test('drawSpectrogramAxes: 左ラベル領域と右カラーバー領域に fillRect', () => {
    const ctx = makeMockCtx();
    drawSpectrogramAxes(ctx, 800, 80, sampleSpec);
    const rects = ctx._ops.filter((o) => o.op === 'fillRect');
    assert.equal(rects.length, 2, 'left strip + right strip');
});

test('drawSpectrogramAxes: putImageData を 1 回 (カラーバー) 呼ぶ', () => {
    const ctx = makeMockCtx();
    drawSpectrogramAxes(ctx, 800, 80, sampleSpec);
    const puts = ctx._ops.filter((o) => o.op === 'putImageData');
    assert.equal(puts.length, 1);
});

// ── drawSpectrumLine ──

const sampleSlice = {
    values: [-60, -50, -40, -30, -20, -10],
    frequencyBins: 6,
    maxFrequencyHz: 22050,
    minDb: -90,
    maxDb: 0,
};

test('drawSpectrumLine: fBins 個の点で線を描画', () => {
    const ctx = makeMockCtx();
    drawSpectrumLine(ctx, 800, 100, sampleSlice, '#4ec994');
    const moveTos = ctx._ops.filter((o) => o.op === 'moveTo').length;
    const lineTos = ctx._ops.filter((o) => o.op === 'lineTo').length;
    assert.equal(moveTos, 1);
    assert.equal(lineTos, 5);
});

test('drawSpectrumLine: minDb == maxDb のとき何も描画しない', () => {
    const ctx = makeMockCtx();
    const flat = { ...sampleSlice, minDb: 0, maxDb: 0 };
    drawSpectrumLine(ctx, 800, 100, flat, '#fff');
    assert.equal(ctx._ops.filter((o) => o.op === 'stroke').length, 0);
});

test('drawSpectrumLine: opts.padL/padR でプロット領域がシフトする', () => {
    const ctx = makeMockCtx();
    drawSpectrumLine(ctx, 200, 100, sampleSlice, '#fff', { padL: 20, padR: 10 });
    const firstMove = ctx._ops.find((o) => o.op === 'moveTo')!;
    const lastLine = [...ctx._ops].reverse().find((o) => o.op === 'lineTo')!;
    assert.equal(firstMove.args[0], 20);
    assert.equal(lastLine.args[0], 200 - 10);
});

// ── drawSpectrumAxes ──

test('drawSpectrumAxes: 最大/中央/最小 dB の 3 ラベルを描画', () => {
    const ctx = makeMockCtx();
    drawSpectrumAxes(ctx, 800, 100, sampleSlice, 30, 5, 5, 15);
    const dbLabels = ctx._texts.filter((t) => /dB$/.test(t));
    assert.equal(dbLabels.length, 3);
    assert.ok(dbLabels.includes('0 dB'));
    assert.ok(dbLabels.includes('-90 dB'));
    assert.ok(dbLabels.includes('-45 dB'));
});

test('drawSpectrumAxes: 0 Hz / 中央 / 最大の 3 周波数ラベルを描画', () => {
    const ctx = makeMockCtx();
    drawSpectrumAxes(ctx, 800, 100, sampleSlice, 30, 5, 5, 15);
    assert.ok(ctx._texts.includes('0 Hz'));
    const kHzLabels = ctx._texts.filter((t) => /kHz$/.test(t));
    assert.equal(kHzLabels.length, 2);
});

test('drawSpectrumAxes: DEFAULT_THEME を渡しても theme なしと同じ挙動', () => {
    const a = makeMockCtx();
    const b = makeMockCtx();
    drawSpectrumAxes(a, 800, 100, sampleSlice, 30, 5, 5, 15);
    drawSpectrumAxes(b, 800, 100, sampleSlice, 30, 5, 5, 15, DEFAULT_THEME);
    assert.deepEqual(a._texts, b._texts);
});
