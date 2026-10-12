import test from 'node:test';
import assert from 'node:assert/strict';
import { spectrogramDisplayBounds } from '../webview/runtime/spectrogramRaster';

const spec = { minDb: -90, maxDb: -10, maxFrequencyHz: 22050 };

test('spectrogramDisplayBounds: 表示設定が未指定ならスペクトログラムの範囲をそのまま使う', () => {
    assert.deepEqual(
        spectrogramDisplayBounds(spec, { dbMin: null, dbMax: null, maxFrequencyHz: null }),
        { dbLo: -90, dbHi: -10, maxFrequencyHz: 22050 },
    );
});

test('spectrogramDisplayBounds: dB 範囲は表示設定で上書きし、0 dB も有効値として扱う', () => {
    assert.deepEqual(
        spectrogramDisplayBounds(spec, { dbMin: -60, dbMax: 0, maxFrequencyHz: null }),
        { dbLo: -60, dbHi: 0, maxFrequencyHz: 22050 },
    );
});

test('spectrogramDisplayBounds: 最大周波数はスペクトログラムの上限を超えない', () => {
    assert.equal(spectrogramDisplayBounds(spec, { dbMin: null, dbMax: null, maxFrequencyHz: 8000 }).maxFrequencyHz, 8000);
    assert.equal(spectrogramDisplayBounds(spec, { dbMin: null, dbMax: null, maxFrequencyHz: 48000 }).maxFrequencyHz, 22050);
});
