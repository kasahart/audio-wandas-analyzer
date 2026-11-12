import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedSpectrogramBounds, spectrogramDisplayBounds } from '../webview/runtime/spectrogramRaster';

const spec = { minDb: -90, maxDb: -10, maxFrequencyHz: 22050 };

test('spectrogramDisplayBounds: 表示設定が未指定ならスペクトログラムの範囲をそのまま使う', () => {
    assert.deepEqual(
        spectrogramDisplayBounds(spec, { dbMin: null, dbMax: null, maxFrequencyHz: null }),
        { dbLo: -90, dbHi: -10, dbTyped: { min: false, max: false }, maxFrequencyHz: 22050, minFrequencyHz: 0 },
    );
});

test('spectrogramDisplayBounds: dB 範囲は表示設定で上書きし、0 dB も有効値として扱う', () => {
    assert.deepEqual(
        spectrogramDisplayBounds(spec, { dbMin: -60, dbMax: 0, maxFrequencyHz: null }),
        { dbLo: -60, dbHi: 0, dbTyped: { min: true, max: true }, maxFrequencyHz: 22050, minFrequencyHz: 0 },
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
        { dbLo: -100, dbHi: 0, dbTyped: { min: false, max: false }, maxFrequencyHz: 24000, minFrequencyHz: 0 },
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

test('spectrogramDisplayBounds: 下限がレーンのナイキスト以上なら範囲を保ち、そのレーンは空白になる', () => {
    const narrow = { minDb: -90, maxDb: 0, maxFrequencyHz: 8000 };
    assert.deepEqual(
        spectrogramDisplayBounds(narrow, { dbMin: null, dbMax: null, maxFrequencyHz: 20000, minFrequencyHz: 10000 }),
        { dbLo: -90, dbHi: 0, dbTyped: { min: false, max: false }, maxFrequencyHz: 20000, minFrequencyHz: 10000 },
    );
});

test('spectrogramDisplayBounds: 上限が auto でもレーンのナイキスト以上の下限は空の帯になる', () => {
    const narrow = { minDb: -90, maxDb: 0, maxFrequencyHz: 8000 };
    const bounds = spectrogramDisplayBounds(narrow, { dbMin: null, dbMax: null, maxFrequencyHz: null, minFrequencyHz: 10000 });
    assert.equal(bounds.minFrequencyHz, 10000);
    assert.equal(bounds.maxFrequencyHz, 10000);
});

test('spectrogramDisplayBounds: 自動の dB 端は切りのよい値に丸め、入力した端はそのまま使う', () => {
    const raw = { minDb: -120, maxDb: -23.21, maxFrequencyHz: 8000 };
    const auto = spectrogramDisplayBounds(raw, { dbMin: null, dbMax: null, maxFrequencyHz: null });
    assert.equal(auto.dbLo, -120);
    assert.equal(auto.dbHi, -20);
    const typed = spectrogramDisplayBounds(raw, { dbMin: -97.5, dbMax: null, maxFrequencyHz: null });
    assert.equal(typed.dbLo, -97.5);
    assert.equal(typed.dbHi, -20);
});

test('spectrogramDisplayBounds: 片方の端を入力したときは、表示する範囲の幅で自動の端を丸める', () => {
    const raw = { minDb: -120, maxDb: -29, maxFrequencyHz: 8000 };
    // Over -40…-29 dB the top stays at -29 (1 dB steps), not -25 from the 5 dB steps of the whole 91 dB range.
    assert.equal(spectrogramDisplayBounds(raw, { dbMin: -40, dbMax: null, maxFrequencyHz: null }).dbHi, -29);
});

test('a track spectrogram\'s auto colours reach no more than 100 dB under its loudest STFT cell: digital silence (−240 dB) does not set the bottom (R9)', () => {
    const silent = { minDb: -240, maxDb: -3.2, maxFrequencyHz: 8000 };
    const bounds = spectrogramDisplayBounds(silent, { dbMin: null, dbMax: null, maxFrequencyHz: null });
    assert.ok(bounds.dbLo <= -103.2 && bounds.dbLo >= -120, `bottom ${bounds.dbLo}`);
    assert.ok(bounds.dbHi >= -3.2 && bounds.dbHi <= 0, `top ${bounds.dbHi}`);
    // A typed bottom stays as typed.
    assert.equal(spectrogramDisplayBounds(silent, { dbMin: -200, dbMax: null, maxFrequencyHz: null }).dbLo, -200);
});
