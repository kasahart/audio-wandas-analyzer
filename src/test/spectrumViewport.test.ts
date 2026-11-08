import test from 'node:test';
import assert from 'node:assert/strict';
import { spectrumVisibleWindow } from '../webview/runtime/spectrumRuntime';

test('spectrumVisibleWindow: ズーム比率で周波数範囲を決め、dB はデータ値を使う', () => {
    const vis = spectrumVisibleWindow(8000, -90, -10, { freqStart: 0.25, freqEnd: 0.5, dbMin: null, dbMax: null });
    assert.deepEqual(vis, { frequencyMin: 2000, frequencyMax: 4000, dbMin: -90, dbMax: -10 });
});

test('spectrumVisibleWindow: dB 上書きはデータ値より優先される（0 dB も上書き扱い）', () => {
    const vis = spectrumVisibleWindow(8000, -90, -10, { freqStart: 0, freqEnd: 1, dbMin: -60, dbMax: 0 });
    assert.equal(vis.dbMin, -60);
    assert.equal(vis.dbMax, 0);
});

