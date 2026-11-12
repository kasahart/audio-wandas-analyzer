/**
 * A picture's source axis (`xSource`, `ySource`) decides its whole-view range and which pictures share an axis; the
 * drawn `xs` never do (docs/display-rules.md R2).
 *
 * The backend thins a picture to draw it, so how many points `xs` has and where its first and last are depend on the
 * thinning and the zoom. `xSource` is taken of the data before thinning (python-backend/stage_view.py source_axis).
 * If a test here fails, some code read the length or the ends of `xs` to decide something: use `view.xSource`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StageView } from '../shared/protocol/backendProtocol';
import { pictureAxis, pictureSet, UNKNOWN_AXIS } from '../webview/runtime/figureModel';
import type { AnswerIdentity } from '../webview/runtime/answerTypes';
import type { LevelInput } from '../webview/runtime/comparePanes';
import { axisFractionOf, axisValueAt, rowValueAt } from '../webview/runtime/stagePanes';

const sourceOf = (count: number, first: number, step: number): NonNullable<StageView['xSource']> => ({ count, first, last: first + (count - 1) * step, step });

/** A line whose drawn points are `drawn` (any points of the source), of a source axis of `count` values. */
function line(x: StageView['x'], drawn: number[], source: NonNullable<StageView['xSource']>): StageView {
    return { frame: 'F', kind: 'line', x, xScale: 'linear', quantity: 'value', xs: drawn, values: drawn.map(() => 0), xSource: source, data: 'k' };
}

test('the whole view of a thinned line spans its source data\'s first to last x, not its first and last drawn point (R2)', () => {
    // 1000 samples at 1 kHz from 2 s; the thinning kept neither the first nor the last sample.
    const view = line('time', [2.003, 2.4, 2.71, 2.995], sourceOf(1000, 2, 0.001));
    assert.equal(axisValueAt(view, 0), 2);
    assert.equal(axisValueAt(view, 1), 2.999);
    assert.equal(axisFractionOf(view, 2), 0);
    assert.equal(axisFractionOf(view, 2.999), 1);
    // A zoomed part's picture (other drawn points, the same source) is on the same scale.
    const zoomed: StageView = { ...view, xs: [2.5, 2.5005, 2.501], values: [0, 0, 0], detail: true };
    assert.equal(axisValueAt(zoomed, 0), 2);
    assert.equal(axisValueAt(zoomed, 1), 2.999);
});

test('pictures thinned to the same drawn points are on other axes when their source axes differ (R2)', () => {
    const drawn = [0, 0.001, 0.002, 0.003];
    // Two cepstra of recordings of other lengths, both thinned to these four points.
    const short = line('quefrency', drawn, sourceOf(8000, 0, 1 / 16000)), long = line('quefrency', drawn, sourceOf(16000, 0, 1 / 16000));
    assert.notEqual(pictureAxis(short), pictureAxis(long), 'another count of source values');
    // Two time lines at other steps (other sample rates), both thinned to the same points.
    assert.notEqual(pictureAxis(line('time', drawn, sourceOf(48000, 0, 1 / 48000))), pictureAxis(line('time', drawn, sourceOf(44100, 0, 1 / 44100))), 'another step');
    // Two images with the same drawn rows of other source rows.
    const image = (rows: number): StageView => ({ frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', yAxis: 'frequency', xs: drawn, ys: [100, 1000], matrix: [[0, 0, 0, 0], [0, 0, 0, 0]], xSource: sourceOf(100, 0, 0.01), ySource: { count: rows, first: 0, last: 8000, step: 8000 / (rows - 1) }, data: 'k' });
    assert.notEqual(pictureAxis(image(257)), pictureAxis(image(513)), 'another count of source rows');
    assert.equal(pictureAxis(image(257)), pictureAxis(image(257)));
});

test('one source axis is one axis however it was thinned or zoomed, and a time axis of another length is the same axis (R1, R2)', () => {
    const source = sourceOf(16000, 0, 1 / 16000);
    const whole = line('quefrency', [0, 0.25, 0.5, 0.99], source), zoomed = line('quefrency', [0.4, 0.41, 0.42], source), dense = line('quefrency', [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], source);
    assert.equal(pictureAxis(whole), pictureAxis(zoomed), 'a zoomed part');
    assert.equal(pictureAxis(whole), pictureAxis(dense), 'another thinning');
    // Over time, recordings of other lengths share the axis (their common part is compared), from the same start and
    // step; a start half a step off is the same sample grid to the nearest step, a whole step off is not.
    const step = 1 / 48000;
    const at = (count: number, first = 0): string => pictureAxis(line('time', [0, 0.5], { count, first, last: first + (count - 1) * step, step }));
    assert.equal(at(48000), at(48001), 'a sample longer');
    assert.equal(at(48000), at(96000), 'twice as long');
    assert.notEqual(at(48000), at(48000, step), 'starting a sample later');
});

test('a picture that does not say its source axis is grouped with no other picture, however alike they are (R1, R2)', () => {
    const drawn = [0, 0.001, 0.002, 0.003];
    const bare = (): StageView => ({ frame: 'F', kind: 'line', x: 'quefrency', xScale: 'linear', quantity: 'value', xs: drawn, values: drawn.map(() => 0), data: 'k' });
    const known = (): StageView => line('quefrency', drawn, sourceOf(4, 0, 0.001));
    const level: LevelInput = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true };
    const identity = (path: string): AnswerIdentity => ({ path, fileVersion: 'v', calibrationSignature: 'c', level, recipeKey: 'r', region: '', conditionId: '' });
    const set = (views: Record<string, StageView>, compared: StageView) => pictureSet(Object.keys(views), path => ({ state: 'ready', value: views[path], identity: identity(path) }), () => level, { level, view: compared }, true);
    const why = 'a picture with no xSource must not be put on one axis with any other: missing information splits, never merges (figureModel.pictureAxis, UNKNOWN_AXIS)';
    assert.deepEqual(set({ '/a.wav': bare(), '/b.wav': bare() }, bare()).paths, [], `${why}: two such members are not one group with a compared one alike`);
    assert.deepEqual(set({ '/a.wav': bare(), '/b.wav': known() }, known()).paths, ['/b.wav'], `${why}: a member without one is not on the compared one's axis`);
    assert.deepEqual(set({ '/a.wav': known(), '/b.wav': known() }, bare()).paths, [], `${why}: a compared one without one counts nobody on its axis`);
    assert.equal(pictureAxis(bare()), UNKNOWN_AXIS);
});

test('a log axis\'s whole range is from its source places, or its stated limits, never its drawn points (R2)', () => {
    // Bands on a log axis span half a band beyond the first and last centre of the source.
    const bands: StageView = { frame: 'NOctFrame', kind: 'bar', x: 'band', xScale: 'log', quantity: 'level', xs: [250, 500], values: [0, 0], xSource: { count: 4, first: 125, last: 1000, step: 125 }, data: 'k' };
    assert.ok(Math.abs(axisValueAt(bands, 0) - 125 / Math.SQRT2) < 1e-9, `the range starts half a band below the first source band, got ${axisValueAt(bands, 0)}`);
    assert.ok(Math.abs(axisValueAt(bands, 1) - 1000 * Math.SQRT2) < 1e-9, `the range ends half a band above the last source band, got ${axisValueAt(bands, 1)}`);
    // A spectrogram's rows are drawn between its stated row limits (20 Hz to Nyquist), whatever rows were drawn.
    const image: StageView = { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', yAxis: 'frequency', xs: [0.1, 0.2], ys: [100, 1000], yLimits: [20, 8000], matrix: [[0, 0], [0, 0]], xSource: sourceOf(10, 0.05, 0.05), ySource: { count: 513, first: 0, last: 8000, step: 15.625 }, data: 'k' };
    assert.ok(Math.abs(rowValueAt(image, 0) - 20) < 1e-9 && Math.abs(rowValueAt(image, 1) - 8000) < 1e-6, 'the rows span the stated limits');
    assert.equal(axisValueAt(image, 0), 0.05, 'its time axis starts at its first source column');
    assert.ok(Math.abs(axisValueAt(image, 1) - 0.5) < 1e-12, 'and ends at its last');
});
