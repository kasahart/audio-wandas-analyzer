import test from 'node:test';
import assert from 'node:assert/strict';
import { heatmapDbRange, niceRange } from '../shared/utils/ticks';
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

/** Whether `value` is a whole number of `step`s, to the 12 digits ticks rounds to. */
const onStep = (value: number, step: number): boolean => Math.abs(value / step - Math.round(value / step)) < 1e-9;

/** The round steps (1, 2 or 5 times a power of ten) both ends are on, coarse enough to tick a colour bar (span / 40). */
function sharedSteps(min: number, max: number): number[] {
    const steps: number[] = [];
    for (let power = -6; power <= 3; power++) for (const size of [1, 2, 5]) steps.push(size * 10 ** power);
    return steps.filter(step => step >= (max - min) / 40 && onStep(min, step) && onStep(max, step));
}

test('a heatmap\'s auto colour range spans at most 100 dB after rounding: the top rounded up to a tick, the bottom on a tick no more than 100 dB under it (R9)', () => {
    // The issue's example: −240…−0.4 dB was limited to −100.4…−0.4 and then widened to −105…0 (105 dB).
    assert.deepEqual(heatmapDbRange(-240, -0.4), { min: -100, max: 0 });
    // A track spectrogram with both ends auto is the same rule (and digital silence does not set the bottom).
    const silent = { minDb: -240, maxDb: -0.4, maxFrequencyHz: 8000 };
    const track = spectrogramDisplayBounds(silent, { dbMin: null, dbMax: null, maxFrequencyHz: null });
    assert.deepEqual({ min: track.dbLo, max: track.dbHi }, { min: -100, max: 0 });
    // Under 100 dB the range is rounded out as any range is (niceRange).
    assert.deepEqual(heatmapDbRange(-64, -3), { min: niceRange(-64, -3).low, max: niceRange(-64, -3).high });
    // A typed end stays as typed.
    assert.equal(spectrogramDisplayBounds(silent, { dbMin: -200, dbMax: null, maxFrequencyHz: null }).dbLo, -200);

    const pairs: Array<[number, number]> = [[-240, -0.4], [-240, -3], [-240, -3.2], [-300, -20], [-149.5, -9.5], [-109.5, -9.5], [-64, -3], [-20, -20], [0, 0], [42.5, 42.5], [3, 47], [10, 130], [-12.3, -12.1], [-0.004, 0.003]];
    // Spans just under, at and just over 100 dB, at many offsets, positive and negative.
    for (let index = 0; index <= 75; index++) {
        // Each top and bottom written to a tenth, as a level is, not a sum carrying floating-point drift.
        const top = (-1373 + 37 * index) / 10;
        for (const span of [0.5, 7.3, 40, 92, 95.1, 99, 99.9, 100, 100.1, 100.4, 101, 104.9, 108, 150, 240]) pairs.push([Math.round((top - span) * 10) / 10, top]);
    }
    for (const [low, high] of pairs) {
        const got = heatmapDbRange(low, high);
        const label = `${low}…${high} dB → ${got.min}…${got.max}`;
        assert.ok(got.max - got.min <= 100, `${label} spans at most 100 dB`);
        assert.ok(got.max >= high, `${label} keeps the loudest value`);
        assert.ok(got.min <= high && got.min < got.max, `${label} starts below the loudest value`);
        // Within 100 dB of the shown top, every value is shown.
        assert.ok(got.min <= Math.max(low, got.max - 100), `${label} shows every value up to 100 dB under its top`);
        assert.ok(sharedSteps(got.min, got.max).length > 0, `${label} has both ends on one tick grid`);
        // A track spectrogram's auto colours are the same.
        const bounds = spectrogramDisplayBounds({ minDb: low, maxDb: high, maxFrequencyHz: 8000 }, { dbMin: null, dbMax: null, maxFrequencyHz: null });
        assert.deepEqual({ min: bounds.dbLo, max: bounds.dbHi }, got, `${label}: the track spectrogram agrees`);
    }
});
