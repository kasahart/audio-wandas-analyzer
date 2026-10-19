import test from 'node:test';
import assert from 'node:assert/strict';
import {
    OVERLAY_SPECTRUM_PAD,
    TRACK_SPECTRUM_PAD,
    spectrumPlotFrame,
    spectrumVisibleWindow,
    steppedOverlaySpectrumHoverNorm,
    steppedSpectrumHoverNorm,
    steppedTrackSpectrumHoverNorm,
} from '../webview/runtime/spectrumRuntime';
import type { SpectrumSlice } from '../webview/runtime/types';

function slice(overrides: Partial<SpectrumSlice> = {}): SpectrumSlice {
    return { values: [], frequencyBins: 11, maxFrequencyHz: 1000, minDb: -80, maxDb: 0, ...overrides };
}

test('spectrumVisibleWindow: ズーム比率で周波数範囲を決め、dB はデータ値を使う', () => {
    const vis = spectrumVisibleWindow(8000, -90, -10, { freqStart: 0.25, freqEnd: 0.5, dbMin: null, dbMax: null });
    assert.deepEqual(vis, { frequencyMin: 2000, frequencyMax: 4000, dbMin: -90, dbMax: -10 });
});

test('spectrumVisibleWindow: dB 上書きはデータ値より優先される（0 dB も上書き扱い）', () => {
    const vis = spectrumVisibleWindow(8000, -90, -10, { freqStart: 0, freqEnd: 1, dbMin: -60, dbMax: 0 });
    assert.equal(vis.dbMin, -60);
    assert.equal(vis.dbMax, 0);
});

test('spectrumPlotFrame: パディングを除いたプロット領域と表示範囲を返す', () => {
    const vis = { frequencyMin: 100, frequencyMax: 900, dbMin: -70, dbMax: -5 };
    assert.deepEqual(spectrumPlotFrame(200, 100, TRACK_SPECTRUM_PAD, vis), {
        padLeft: 32, plotWidth: 162, padTop: 4, plotHeight: 82, ...vis,
    });
    const overlay = spectrumPlotFrame(300, 120, OVERLAY_SPECTRUM_PAD, vis);
    assert.equal(overlay.plotWidth, 244);
    assert.equal(overlay.plotHeight, 94);
});

test('steppedSpectrumHoverNorm: 1 ビン移動した周波数を表示範囲の正規化位置に変換する', () => {
    assert.equal(steppedSpectrumHoverNorm(slice(), 4, 1, 0, 1000), 0.5);
    assert.equal(steppedSpectrumHoverNorm(slice(), 4, -1, 200, 400), 0.5);
});

test('steppedSpectrumHoverNorm: ビン番号は端でクランプされる', () => {
    assert.equal(steppedSpectrumHoverNorm(slice(), 0, -1, 0, 1000), 0);
    assert.equal(steppedSpectrumHoverNorm(slice(), 10, 1, 0, 1000), 1);
});

test('steppedSpectrumHoverNorm: 間引き前の最大周波数があればそれを基準にする', () => {
    assert.equal(steppedSpectrumHoverNorm(slice({ originalMaxFrequencyHz: 2000 }), 4, 1, 0, 2000), 0.5);
});

function flat(db: number, bins: number): SpectrumSlice {
    return slice({ values: new Array(bins).fill(db), frequencyBins: bins });
}

test('steppedTrackSpectrumHoverNorm: 表示中の周波数範囲で 1 ビン先の位置を返す', () => {
    assert.ok(Math.abs((steppedTrackSpectrumHoverNorm(flat(-40, 11), 0.5, 0, 1, 1) ?? NaN) - 0.6) < 1e-9);
    assert.ok(Math.abs((steppedTrackSpectrumHoverNorm(flat(-40, 11), 0, 0.5, 1, 1) ?? NaN) - 0.2) < 1e-9);
});

test('steppedTrackSpectrumHoverNorm: ビンが無ければ null', () => {
    assert.equal(steppedTrackSpectrumHoverNorm(slice({ frequencyBins: 0 }), 0.5, 0, 1, 1), null);
});

test('steppedOverlaySpectrumHoverNorm: Y が決まらない系列しか無ければ先頭の系列で移動する', () => {
    const vis = { frequencyMin: 0, frequencyMax: 1000, dbMin: 0, dbMax: 0 };
    const first = { slice: flat(-40, 11) };
    const second = { slice: flat(-40, 21) };
    assert.ok(Math.abs((steppedOverlaySpectrumHoverNorm([first, second], 0.5, 0.5, null, vis, 1) ?? NaN) - 0.6) < 1e-9);
});

test('steppedOverlaySpectrumHoverNorm: 系列が無い、または表示周波数幅が 0 なら null', () => {
    const vis = { frequencyMin: 0, frequencyMax: 1000, dbMin: -80, dbMax: 0 };
    assert.equal(steppedOverlaySpectrumHoverNorm([], 0.5, null, null, vis, 1), null);
    assert.equal(steppedOverlaySpectrumHoverNorm([{ slice: flat(-40, 11) }], 0.5, null, null, { ...vis, frequencyMax: 0 }, 1), null);
});

test('steppedOverlaySpectrumHoverNorm: キャンバスがあれば描画と同じピクセル座標で最寄り系列を選ぶ', () => {
    const vis = { frequencyMin: 0, frequencyMax: 1000, dbMin: -80, dbMax: 0 };
    const quiet = { slice: flat(-70, 11) };
    const loud = { slice: flat(-10, 21) };
    const canvas = { width: 300, height: 120 };
    assert.ok(Math.abs((steppedOverlaySpectrumHoverNorm([quiet, loud], 0.5, 0.1, canvas, vis, 1) ?? NaN) - 0.55) < 1e-9);
    assert.ok(Math.abs((steppedOverlaySpectrumHoverNorm([quiet, loud], 0.5, 0.8, canvas, vis, 1) ?? NaN) - 0.6) < 1e-9);
});
