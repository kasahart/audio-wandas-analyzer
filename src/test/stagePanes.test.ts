import assert from 'node:assert/strict';
import test from 'node:test';
import { axisFractionOf, axisValueAt, emptyStageText, eventLayers, stageAxes, stageLevelsHeadline, stageDiffRange, stageHeadline, stageRange, stageHover, wrapLines, type StagePlot, type StageStrings } from '../webview/runtime/stagePanes';
import type { StageView } from '../shared/protocol/backendProtocol';

const line = (values: number[], quantity: StageView['quantity'] = 'level'): StageView => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity, xs: [100, 1000, 10000], values });
const strings = { stageNoDelta: 'none', stageMaxDelta: '{at} {delta}' };

/** compare − base point by point, as the backend's difference of two pictures already at full resolution is. */
function minus(base: StageView, compare: StageView): StageView {
    const sub = (a: number | null, b: number | null | undefined): number | null => (a === null || b === null || b === undefined ? null : Math.round((a - b) * 1e6) / 1e6);
    return compare.matrix
        ? { ...compare, matrix: compare.matrix.map((row, r) => row.map((value, c) => sub(value, base.matrix?.[r]?.[c]))) }
        : { ...compare, values: (compare.values ?? []).map((value, index) => sub(value, base.values?.[index])) };
}

test('the Δ pane\'s headline names where the difference drawn is largest', () => {
    const diff = minus(line([-40, -30, -20]), line([-41, -16, -20]));
    assert.equal(stageHeadline(diff, strings), '1.00 kHz +14.0 dB');
    // A linear quantity, without dB.
    assert.equal(stageHeadline(minus(line([0.1, 0.2, 0.3], 'coherence'), line([0.2, 0.2, 0.2], 'coherence')), strings), '100 Hz +0.100');
    assert.equal(stageHeadline(null, strings), 'none');
    const heat: StageView = { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', yAxis: 'frequency', xs: [0.5, 1], ys: [100, 1000], matrix: [[-40, -40], [-30, -30]] };
    assert.equal(stageHeadline(minus(heat, { ...heat, matrix: [[-40, -45], [-30, -30]] }), strings), '1.00 s · 100 Hz −5.0 dB');
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

test('a metric over time names what it measures on its value axis, from its unit', () => {
    const names = { axisTime: 'Time [s]', dsValue: 'Value', axisLoudness: 'Loudness', axisSharpness: 'Sharpness', axisRoughness: 'Roughness', axisLevelOf: 'Level' } as unknown as StageStrings;
    const series = (unit: string): StageView => ({ frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit, xs: [0, 1], values: [1, 2] });
    assert.deepEqual(stageAxes(names, series('sone'), undefined), { x: 'Time [s]', y: 'Loudness [sone]' });
    assert.equal(stageAxes(names, series('asper'), undefined).y, 'Roughness [asper]');
    assert.equal(stageAxes(names, series('acum'), undefined).y, 'Sharpness [acum]');
    assert.equal(stageAxes(names, series('dB re 1 FS'), undefined).y, 'Level [dB re 1 FS]');
    assert.equal(stageAxes(names, series('Pa'), undefined).y, 'Value [Pa]');
});

const cepstrum = (values: number[]): StageView => ({ frame: 'CepstralFrame', kind: 'line', x: 'quefrency', xScale: 'linear', quantity: 'cepstrum', xs: [0, 0.001, 0.002, 0.003], values });

test('a cepstrum is drawn on a quefrency axis, symmetric about zero without its zero-quefrency coefficient', () => {
    const view = cepstrum([-8.5, 0.01, -0.02, 0.005]);
    const range = stageRange([view]);
    assert.ok(Math.abs(range.max - 0.021) < 1e-9 && range.min === -range.max);
    const names = { axisQuefrency: 'Quefrency s', axisCepstrum: 'Real cepstrum', axisDelta: 'Δ dB' } as unknown as StageStrings;
    assert.deepEqual(stageAxes(names, view, undefined), { x: 'Quefrency s', y: 'Real cepstrum' });
    const diff = minus(view, cepstrum([-8.4, 0.03, -0.02, 0.005]));
    assert.deepEqual(stageAxes(names, diff, undefined, true), { x: 'Quefrency s', y: 'Δ Real cepstrum' });
    assert.equal(stageHeadline(diff, strings), '1.00 ms +0.0200');
    assert.deepEqual(stageDiffRange(diff), { min: -0.021, max: 0.021 });
});

const correlation = (values: number[]): StageView => ({ frame: 'CrossCorrelationFrame', kind: 'line', x: 'lag', xScale: 'linear', quantity: 'correlation', xs: [-0.002, -0.001, 0, 0.001], values, pair: { output: 2, input: 1 } });

test('a cross-correlation is drawn over a signed lag axis on the fixed [-1, 1] coefficient range', () => {
    const view = correlation([0.1, -0.2, 0.3, 0.95]);
    assert.deepEqual(stageRange([view]), { min: -1, max: 1 });
    const names = { axisLag: 'Lag s', axisCorrelation: 'Correlation coefficient', axisDelta: 'Δ dB' } as unknown as StageStrings;
    assert.deepEqual(stageAxes(names, view, undefined), { x: 'Lag s', y: 'Correlation coefficient · ch2 / ch1' });
    const diff = minus(view, correlation([0.1, -0.2, 0.3, 0.55]));
    assert.deepEqual(stageAxes(names, diff, undefined, true), { x: 'Lag s', y: 'Δ Correlation coefficient · ch2 / ch1' });
    assert.equal(stageHeadline(diff, strings), '+1.00 ms −0.400');
    // A delay is read to 10 µs at any lag, and none has no sign.
    const long: StageView = { ...view, xs: [-0.0125, 0, 0.0125, 0.02] };
    const plot: StagePlot = { frame: { left: 0, top: 0, width: 100, height: 100 }, xAt: value => (value + 0.0125) * 1000, yAt: value => -value, ratioStep: 1.12, lines: [{ view: long, color: 'blue' }], diff: false };
    assert.match(stageHover(plot, 0, 0)!.text, /^−12\.50 ms/);
    assert.match(stageHover(plot, 12.5, 0)!.text, /^0\.00 ms/);
});

test('a step\'s headline names the point the backend found, with both values, in the axes\' units', () => {
    const at = { stageNoDelta: 'none', compareLevelsAt: '{at} base {base} / compare {compare}' };
    const base = line([20, 60, 0]), compare = line([30, 65, 0]);
    assert.equal(stageLevelsHeadline(base, compare, minus(base, compare), { x: 1000, base: 60, compare: 65 }, at), '1.00 kHz base 60.0 / compare 65.0 dB');
    // Values that are not levels: without dB, to three figures.
    const a = line([0.1, 0.9, 0.5], 'coherence'), b = line([0.6, 0.8, 0.5], 'coherence');
    assert.equal(stageLevelsHeadline(a, b, minus(a, b), { x: 100, base: 0.1, compare: 0.6 }, at), '100 Hz base 0.100 / compare 0.600');
    // An image's point names both its axes; without a point (nothing loud, other axes) there is no headline.
    const heat: StageView = { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', yAxis: 'frequency', xs: [0, 1], ys: [100, 1000], matrix: [[-40, -40], [-30, -30]] };
    assert.equal(stageLevelsHeadline(heat, heat, heat, { x: 1, y: 100, base: -40, compare: -38 }, at), '1.00 s · 100 Hz base −40.0 / compare −38.0 dB');
    assert.equal(stageLevelsHeadline(base, compare, minus(base, compare), null, at), 'none');
});

test('an STFT column whose window sticks out of the signal is drawn but never heads the Δ pane', () => {
    const at = { stageNoDelta: 'none', stageMaxDelta: '{at} {delta}' };
    const heat = (matrix: number[][]): StageView => ({ frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', yAxis: 'frequency', xs: [0, 1, 2], ys: [100, 1000], matrix, whole: [true, true, false] });
    const diff = minus(heat([[-40, -40, -40], [-30, -30, -30]]), heat([[-40, -38, -25], [-30, -30, -30]]));
    // The last column differs most (+15 dB) but reads padding: the headline names the next largest.
    assert.equal(stageHeadline(diff, at), '1.00 s · 100 Hz +2.0 dB');
});

test('a trigger\'s events are each a line of their slot, on one amplitude range, with no difference between recordings', () => {
    const events = (peaks: number[]): StageView => ({
        frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'Pa', xs: [-0.01, 0, 0.1],
        values: [0, peaks.reduce((a, b) => a + b, 0) / peaks.length, 0], events: peaks.map((peak, id) => ({ id: id * 2, time: id, values: [0, peak, 0] })),
    });
    const base = events([1, 3]), compare = events([2]);
    const layers = eventLayers({ view: compare, color: '#ff0', width: 2.2, label: 'b.wav' });
    // One line per event, in the slot's colour, named by its event from 1 for the readout.
    // One line per event, named by its event and where in the recording it was cut.
    assert.deepEqual(layers.map(layer => [layer.label, layer.view.values, layer.color, layer.view.events]), [['b.wav #1 @ 0.00 s', [0, 2, 0], '#ff0', undefined]]);
    // A recording's events can be left out: those are faint, and each line says whose event it is.
    const own = eventLayers({ view: base, color: '#00f', source: 'a.wav', excluded: [2] });
    assert.deepEqual(own.map(layer => [layer.event, layer.alpha]), [[{ id: 0, source: 'a.wav', out: false }, 0.85], [{ id: 2, source: 'a.wav', out: true }, 0.25]]);
    assert.deepEqual(eventLayers({ view: line([1, 2, 3]), color: '#00f' }).map(layer => layer.view.values), [[1, 2, 3]]);
    // The range holds every event's peak, not only their mean.
    assert.ok(stageRange([base, compare]).max >= 3);
    // Amplitudes have no −300 dB floor: a −500 (raw counts) peak is in the range.
    assert.ok(stageRange([events([-500])]).min <= -500);
    // Two recordings' events are not one another's: no Δ, and the headline counts them instead.
    assert.equal(stageLevelsHeadline(base, compare, null, null, { ...strings, compareLevelsAt: '', stageEventCounts: '{base} / {compare}' }), '2 / 1');
    // A level nothing crosses: 0 counted, and the empty plot says to lower the level instead of 'cannot be shown'.
    const none = events([]);
    assert.equal(stageLevelsHeadline(none, compare, null, null, { ...strings, compareLevelsAt: '', stageEventCounts: '{base} / {compare}' }), '0 / 1');
    assert.equal(emptyStageText({ stepNotDrawable: 'no {frame}', stageNoEvents: 'lower it' }, none), 'lower it');
    assert.equal(emptyStageText({ stepNotDrawable: 'no {frame}', stageNoEvents: 'lower it' }, { frame: 'X', kind: 'none' }), 'no X');
    const axes = stageAxes({ axisTriggerTime: 'From trigger [s]', waveRangeAxisAmplitude: 'Amplitude' } as unknown as StageStrings, compare, undefined);
    assert.deepEqual(axes, { x: 'From trigger [s]', y: 'Amplitude [Pa]' });
    // A group's median (the backend's, of the files' mean events) has no event lines of its own, but it is still
    // events: the event headline and the trigger's time axis.
    const { events: _lines, ...median } = events([5, 7]);
    assert.equal(stageLevelsHeadline(median, compare, null, null, { ...strings, compareLevelsAt: '', stageEventCounts: '{base} / {compare}' }), '— / 1');
    assert.equal(stageAxes({ axisTriggerTime: 'From trigger [s]', waveRangeAxisAmplitude: 'Amplitude' } as unknown as StageStrings, median, undefined).x, 'From trigger [s]');
});

test('the pane\'s message wraps to its width: at spaces, else between Japanese characters', () => {
    const width = (part: string): number => part.length * 10;
    assert.deepEqual(wrapLines('drag the step here', 100, width), ['drag the', 'step here']);
    assert.deepEqual(wrapLines('この手順は表示できません', 60, width), ['この手順は表', '示できません']);
    // A word wider than the line is cut between its characters; nothing is lost.
    assert.deepEqual(wrapLines('noct_synthesis', 50, width).join(''), 'noct_synthesis');
    assert.ok(wrapLines('noct_synthesis は前の手順の結果に使えません', 80, width).every(line => width(line) <= 80));
    assert.deepEqual(wrapLines('short', 100, width), ['short']);
    // A long word after others is cut too, not left wider than the line.
    assert.ok(wrapLines('reason: noct_synthesis_failed_here', 80, width).every(line => width(line) <= 80));
});

test('a spectrum drawn as its own bins spans its stated limits, not edges read off its first two bins', () => {
    const bins: StageView = { ...line([-40, -30, -20]), xs: [46.875, 93.75, 23953.125], xLimits: [20, 24000] };
    assert.equal(axisValueAt(bins, 0), 20);
    assert.ok(Math.abs(axisValueAt(bins, 1) - 24000) < 1e-6);
    assert.ok(Math.abs(axisFractionOf(bins, 20 * Math.sqrt(1200)) - 0.5) < 1e-9);
    // Band centres without limits keep their geometric edges.
    assert.ok(Math.abs(axisValueAt(line([-40, -30, -20]), 0) - 100 / Math.sqrt(10)) < 1e-9);
});
