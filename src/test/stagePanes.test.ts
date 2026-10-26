import assert from 'node:assert/strict';
import test from 'node:test';
import { loudPoints, medianView, stageAxes, stageLevelsHeadline, stageDifference, stageDiffRange, stageHeadline, stageRange, type StageStrings } from '../webview/runtime/stagePanes';
import type { StageView } from '../shared/protocol/backendProtocol';

const line = (values: number[], quantity: StageView['quantity'] = 'level'): StageView => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity, xs: [100, 1000, 10000], values });
const strings = { stageNoDelta: 'none', stageMaxDelta: '{at} {delta}' };

test('a group base is the median of its files\' pictures, point by point', () => {
    assert.deepEqual(medianView([line([1, 5, 9]), line([3, 1, 9]), line([2, 2, 0])])!.values, [2, 2, 9]);
    // Pictures on other axes have no median.
    assert.equal(medianView([line([1, 2, 3]), { ...line([1, 2]), xs: [100, 1000] }]), null);
});

test('Δ is taken between pictures of one quantity on the same axes, and the headline names where it is largest', () => {
    const diff = stageDifference(line([-40, -30, -20]), line([-41, -16, -20]))!;
    assert.deepEqual(diff.values, [-1, 14, 0]);
    assert.equal(stageHeadline(diff, strings), '1.00 kHz +14.0 dB');
    // A linear quantity subtracts plainly, without dB.
    const coherence = stageDifference(line([0.1, 0.2, 0.3], 'coherence'), line([0.2, 0.2, 0.2], 'coherence'))!;
    assert.deepEqual(coherence.values, [0.1, 0, -0.1]);
    assert.equal(stageHeadline(coherence, strings), '100 Hz +0.100');
    assert.equal(stageDifference(line([1, 2, 3], 'coherence'), line([1, 2, 3])), null);
    assert.equal(stageHeadline(null, strings), 'none');
    const heat: StageView = { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', yAxis: 'frequency', xs: [0.5, 1], ys: [100, 1000], matrix: [[-40, -40], [-30, -30]] };
    assert.equal(stageHeadline(stageDifference(heat, { ...heat, matrix: [[-40, -45], [-30, -30]] }), strings), '1.00 s · 100 Hz −5.0 dB');
    assert.equal(stageDifference(heat, line([1, 2, 3])), null);
});

test('levels share a range of four round steps; coherence keeps 0 to 1', () => {
    assert.deepEqual(stageRange([line([-43, -12, -30])]), { min: -50, max: -10 });
    assert.deepEqual(stageRange([line([0.2, 0.5, 0.9], 'coherence')]), { min: 0, max: 1 });
});

test('a cross-channel picture names its pair on the value axis: the channel over its reference', () => {
    const names = { axisFrequency: 'Frequency [Hz]', axisCoherence: 'Coherence', axisGain: 'Gain [dB]' } as unknown as StageStrings;
    assert.deepEqual(stageAxes(names, { ...line([0.2, 0.5, 0.9], 'coherence'), pair: { output: 2, input: 1 } }, undefined), { x: 'Frequency [Hz]', y: 'Coherence · ch2 / ch1' });
    assert.equal(stageAxes(names, { ...line([0, -3, -6], 'gain'), pair: { output: 3, input: 1 } }, undefined).y, 'Gain [dB] · ch3 / ch1');
    assert.equal(stageAxes(names, line([0.2, 0.5, 0.9], 'coherence'), undefined).y, 'Coherence');
});

const cepstrum = (values: number[]): StageView => ({ frame: 'CepstralFrame', kind: 'line', x: 'quefrency', xScale: 'linear', quantity: 'cepstrum', xs: [0, 0.001, 0.002, 0.003], values });

test('a cepstrum is drawn on a quefrency axis, symmetric about zero without its zero-quefrency coefficient', () => {
    const view = cepstrum([-8.5, 0.01, -0.02, 0.005]);
    const range = stageRange([view]);
    assert.ok(Math.abs(range.max - 0.021) < 1e-9 && range.min === -range.max);
    const names = { axisQuefrency: 'Quefrency s', axisCepstrum: 'Real cepstrum', axisDelta: 'Δ dB' } as unknown as StageStrings;
    assert.deepEqual(stageAxes(names, view, undefined), { x: 'Quefrency s', y: 'Real cepstrum' });
    const diff = stageDifference(view, cepstrum([-8.4, 0.03, -0.02, 0.005]))!;
    assert.deepEqual(stageAxes(names, diff, undefined, true), { x: 'Quefrency s', y: 'Δ Real cepstrum' });
    assert.equal(stageHeadline(diff, strings), '1.00 ms +0.0200');
    assert.deepEqual(stageDiffRange(diff), { min: -0.021, max: 0.021 });
});

test('a step\'s headline names the largest difference among loud points only, with both values', () => {
    const at = { stageNoDelta: 'none', compareLevelsAt: '{at} base {base} / compare {compare}' };
    // 60 → 65 dB at 1 kHz and 20 → 30 dB at 100 Hz: the 10 dB difference is 30 dB under the loudest, so the 5 dB one heads.
    const base = line([20, 60, 0]), compare = line([30, 65, 0]);
    assert.deepEqual(loudPoints(base, compare).values, [false, true, false]);
    assert.equal(stageLevelsHeadline(base, compare, stageDifference(base, compare), at), '1.00 kHz base 60.0 / compare 65.0 dB');
    // Values that are not levels have no loudness: every point counts.
    const a = line([0.1, 0.9, 0.5], 'coherence'), b = line([0.6, 0.8, 0.5], 'coherence');
    assert.equal(stageLevelsHeadline(a, b, stageDifference(a, b), at), '100 Hz base 0.100 / compare 0.600');
});

test('an STFT column whose window sticks out of the signal is drawn but never heads the comparison', () => {
    const at = { stageNoDelta: 'none', compareLevelsAt: '{at} base {base} / compare {compare}', stageMaxDelta: '{at} {delta}' };
    const heat = (matrix: number[][]): StageView => ({ frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', yAxis: 'frequency', xs: [0, 1, 2], ys: [100, 1000], matrix, whole: [true, true, false] });
    const base = heat([[-40, -40, -40], [-30, -30, -30]]), compare = heat([[-40, -38, -25], [-30, -30, -30]]);
    const diff = stageDifference(base, compare)!;
    // The last column differs most (+15 dB) but reads padding: the headline names the next largest.
    assert.equal(stageHeadline(diff, at), '1.00 s · 100 Hz +2.0 dB');
    assert.equal(stageLevelsHeadline(base, compare, diff, at), '1.00 s · 100 Hz base −40.0 / compare −38.0 dB');
    assert.deepEqual(diff.matrix![0], [0, 2, 15]);
});
