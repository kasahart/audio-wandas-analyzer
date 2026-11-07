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
    formatWaveformAxisLabels,
    drawSpectrogramFrequencyAxis,
    drawSpectrumSelectionBox,
    drawCanvasMessage,
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

// ── drawWaveformAmplitudeAxis ──

test('drawWaveformAmplitudeAxis: absolutePeak の実スケールで振幅ラベルを描画', () => {
    const ctx = makeMockCtx();
    drawWaveformAmplitudeAxis(ctx, 800, 80, formatWaveformAxisLabels(16383, null, 'Amp'), DEFAULT_THEME);
    assert.ok(ctx._texts.includes('+16383'));
    assert.ok(ctx._texts.includes('0'));
    assert.ok(ctx._texts.includes('-16383'));
    assert.ok(ctx._texts.includes('Amp'));
});

test('drawWaveformAmplitudeAxis: unit がある場合は Amp タイトルに表示', () => {
    const ctx = makeMockCtx();
    drawWaveformAmplitudeAxis(ctx, 800, 80, formatWaveformAxisLabels(0.5, 'Pa', 'Amp'), DEFAULT_THEME);
    assert.ok(ctx._texts.includes('+0.50'));
    assert.ok(ctx._texts.includes('-0.50'));
    assert.ok(ctx._texts.includes('Amp (Pa)'));
});

test('drawWaveformAmplitudeAxis: very small absolutePeak は 0.00 に丸めない', () => {
    const ctx = makeMockCtx();
    drawWaveformAmplitudeAxis(ctx, 64, 80, formatWaveformAxisLabels(0.005, null, 'Amp'), DEFAULT_THEME);
    assert.ok(ctx._texts.includes('+0.0050'));
    assert.ok(ctx._texts.includes('-0.0050'));
});

test('drawWaveformAmplitudeAxis: invalid absolutePeak は 1 にフォールバック', () => {
    const ctx = makeMockCtx();
    drawWaveformAmplitudeAxis(ctx, 800, 80, formatWaveformAxisLabels(0, null, 'Amp'), DEFAULT_THEME);
    assert.ok(ctx._texts.includes('+1.0'));
    assert.ok(ctx._texts.includes('-1.0'));
    assert.ok(ctx._texts.includes('Amp'));
});

test('drawWaveformAmplitudeAxis: 半透明バックプレートとして fillRect を呼ぶ', () => {
    const ctx = makeMockCtx();
    drawWaveformAmplitudeAxis(ctx, 800, 80);
    const rects = ctx._ops.filter((o) => o.op === 'fillRect');
    assert.equal(rects.length, 1);
    assert.deepEqual(rects[0].args, [0, 0, 64, 80]);
});

test('drawWaveformAmplitudeAxis: save/restore はペアで呼ばれる', () => {
    const ctx = makeMockCtx();
    drawWaveformAmplitudeAxis(ctx, 800, 80);
    const saves = ctx._ops.filter((o) => o.op === 'save').length;
    const restores = ctx._ops.filter((o) => o.op === 'restore').length;
    assert.equal(saves, restores);
});

// ── drawSpectrogramFrequencyAxis ──
// (A spectrogram's colour bar is the one every coloured picture draws: paintColourBar, stagePanes.ts.)

const sampleSpec = { minDb: -90, maxDb: 0, maxFrequencyHz: 22050 };

test('drawSpectrogramFrequencyAxis: Hz ラベルを描画', () => {
    const ctx = makeMockCtx();
    drawSpectrogramFrequencyAxis(ctx, 64, 80, sampleSpec);
    assert.ok(ctx._texts.includes('0 Hz'));
    assert.ok(ctx._texts.some((t) => /kHz$/.test(t)));
});

test('drawSpectrogramFrequencyAxis: 渡された axis canvas 幅だけを背景として塗る', () => {
    const ctx = makeMockCtx();
    drawSpectrogramFrequencyAxis(ctx, 32, 80, sampleSpec);
    const rects = ctx._ops.filter((o) => o.op === 'fillRect');
    assert.deepEqual(rects.map((r) => r.args), [[0, 0, 32, 80]]);
    const textXs = ctx._ops
        .filter((o) => o.op === 'fillText' && o.args[0] !== 'Freq')
        .map((o) => o.args[1]);
    assert.ok(textXs.every((x) => x === 30));
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

// ── drawCanvasMessage ──

test('drawCanvasMessage: キャンバスを消去してから中央にメッセージを描く', () => {
    const ctx = makeMockCtx();
    drawCanvasMessage(ctx, 200, 80, 'No data', '11px sans-serif', '#888');
    assert.deepEqual(ctx._ops[0], { op: 'clearRect', args: [0, 0, 200, 80] });
    assert.deepEqual(ctx._ops[ctx._ops.length - 1], { op: 'fillText', args: ['No data', 100, 40] });
    assert.equal(ctx.fillStyle, '#888');
    assert.equal(ctx.font, '11px sans-serif');
    assert.equal(ctx.textAlign, 'center');
});

test('drawCanvasMessage: 改行ごとに 1 行ずつ、まとまりを中央に描く', () => {
    const ctx = makeMockCtx();
    drawCanvasMessage(ctx, 200, 80, 'Summary\nDetail', '11px sans-serif', '#888');
    assert.deepEqual(ctx._ops.filter((o) => o.op === 'fillText'), [
        { op: 'fillText', args: ['Summary', 100, 33] },
        { op: 'fillText', args: ['Detail', 100, 47] },
    ]);
});
