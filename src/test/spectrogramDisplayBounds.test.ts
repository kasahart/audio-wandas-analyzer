import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedSpectrogramBounds, spectrogramDisplayBounds } from '../webview/runtime/spectrogramRaster';

const spec = { minDb: -90, maxDb: -10, maxFrequencyHz: 22050 };

test('spectrogramDisplayBounds: 表示設定が未指定ならスペクトログラムの範囲をそのまま使う', () => {
    assert.deepEqual(
        spectrogramDisplayBounds(spec, { dbMin: null, dbMax: null, maxFrequencyHz: null }),
        { dbLo: -90, dbHi: -10, maxFrequencyHz: 22050, minFrequencyHz: 0 },
    );
});

test('spectrogramDisplayBounds: dB 範囲は表示設定で上書きし、0 dB も有効値として扱う', () => {
    assert.deepEqual(
        spectrogramDisplayBounds(spec, { dbMin: -60, dbMax: 0, maxFrequencyHz: null }),
        { dbLo: -60, dbHi: 0, maxFrequencyHz: 22050, minFrequencyHz: 0 },
    );
});

test('spectrogramDisplayBounds: 最大周波数はスペクトログラムの上限を超えない', () => {
    assert.equal(spectrogramDisplayBounds(spec, { dbMin: null, dbMax: null, maxFrequencyHz: 8000 }).maxFrequencyHz, 8000);
    assert.equal(spectrogramDisplayBounds(spec, { dbMin: null, dbMax: null, maxFrequencyHz: 48000 }).maxFrequencyHz, 22050);
});

test('spectrogramDisplayBounds: 連動中は共通の自動範囲を使い、ナイキストを超える上端も保つ', () => {
    const shared = { minDb: -110, maxDb: 0, maxFrequencyHz: 24000 };
    assert.deepEqual(
        spectrogramDisplayBounds(spec, { dbMin: null, dbMax: null, maxFrequencyHz: null }, shared),
        { dbLo: -110, dbHi: 0, maxFrequencyHz: 24000, minFrequencyHz: 0 },
    );
});

test('spectrogramDisplayBounds: 下限周波数は上端より下のときだけ使う', () => {
    assert.equal(spectrogramDisplayBounds(spec, { dbMin: null, dbMax: null, maxFrequencyHz: 8000, minFrequencyHz: 500 }).minFrequencyHz, 500);
    assert.equal(spectrogramDisplayBounds(spec, { dbMin: null, dbMax: null, maxFrequencyHz: 8000, minFrequencyHz: 9000 }).minFrequencyHz, 0);
});

test('linkedSpectrogramBounds: 全レーンの最も広い dB 範囲と最も高い上限周波数', () => {
    assert.deepEqual(
        linkedSpectrogramBounds([{ minDb: -90, maxDb: 0, maxFrequencyHz: 8000 }, { minDb: -110, maxDb: -20, maxFrequencyHz: 24000 }]),
        { minDb: -110, maxDb: 0, maxFrequencyHz: 24000 },
    );
    assert.equal(linkedSpectrogramBounds([]), null);
});
