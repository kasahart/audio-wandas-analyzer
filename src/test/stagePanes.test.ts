import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyStageText, eventLayers, loudPoints, medianView, stageAxes, stageLevelsHeadline, stageDifference, stageDiffRange, stageHeadline, stageRange, stageHover, wrapLines, type StagePlot, type StageStrings } from '../webview/runtime/stagePanes';
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
    const diff = stageDifference(view, cepstrum([-8.4, 0.03, -0.02, 0.005]))!;
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
    const diff = stageDifference(view, correlation([0.1, -0.2, 0.3, 0.55]))!;
    assert.deepEqual(stageAxes(names, diff, undefined, true), { x: 'Lag s', y: 'Δ Correlation coefficient · ch2 / ch1' });
    assert.equal(stageHeadline(diff, strings), '+1.00 ms −0.400');
    // A delay is read to 10 µs at any lag, and none has no sign.
    const long: StageView = { ...view, xs: [-0.0125, 0, 0.0125, 0.02] };
    const plot: StagePlot = { frame: { left: 0, top: 0, width: 100, height: 100 }, xAt: value => (value + 0.0125) * 1000, yAt: value => -value, ratioStep: 1.12, lines: [{ view: long, color: 'blue' }], diff: false };
    assert.match(stageHover(plot, 0, 0)!.text, /^−12\.50 ms/);
    assert.match(stageHover(plot, 12.5, 0)!.text, /^0\.00 ms/);
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

test('the line nearest the pointer is picked as the spectrum overlay picks it, and a band zoomed past its centre still answers', () => {
    // 1 px per Hz from 0, the level axis 1 px per dB downwards from 0 dB.
    const plotOf = (lines: StagePlot['lines'], from = 0): StagePlot => ({ frame: { left: 0, top: 0, width: 100, height: 100 }, xAt: value => value - from, yAt: value => -value, ratioStep: 1.12, lines, diff: false });
    const a = { view: { ...line([-10, -20, -30]), xs: [10, 50, 90] }, color: 'blue', label: 'base' };
    const b = { view: { ...line([-40, -60, -80]), xs: [10, 50, 90] }, color: 'gold', label: 'compare' };
    const near = stageHover(plotOf([a, b]), 48, 55)!;
    assert.equal(near.layer, b);
    assert.deepEqual([near.x, near.y, near.text], [50, 60, 'compare / 50 Hz / −60.0 dB']);
    assert.equal(stageHover(plotOf([a, b]), 48, 25)!.layer, a);
    // Past the lines' ends the pointer is over none of them; a level reads to 0.1 dB.
    assert.equal(stageHover(plotOf([a, b]), 5, 25), null);
    assert.equal(stageHover(plotOf([{ ...a, view: { ...a.view, values: [-1, -0.5, 0] } }]), 50, 0)!.text, 'base / 50 Hz / −0.5 dB');
    // Zoomed to 105–110 Hz of bands at 100 and 125 Hz: the 100 Hz step spans the plot, its centre left of it.
    const bands = { view: { frame: 'NOctFrame', kind: 'bar' as const, x: 'band' as const, xScale: 'log' as const, quantity: 'level' as const, xs: [100, 125], values: [-30, -35] }, color: 'gold' };
    const zoomed = { ...plotOf([bands], 105), ratioStep: Math.sqrt(1.25) };
    const band = stageHover(zoomed, 3, 30)!;
    assert.equal(band.text, '100 Hz / −30.0 dB');
    assert.equal(band.x, 0);
});

test('a signal drawn as itself is picked as a line: its envelope point nearest the pointer, its amplitude read in its unit', () => {
    // 1000 px per second from 0, the amplitude axis 100 px per unit downwards from 0 (y = 50 at 0).
    const plotOf = (lines: StagePlot['lines']): StagePlot => ({ frame: { left: 0, top: 0, width: 1000, height: 100 }, xAt: value => value * 1000, yAt: value => 50 - value * 100, ratioStep: 1.12, lines, diff: false, signal: { unit: 'Pa', paint: () => undefined } });
    const n = 4000;
    // Buckets every 0.25 ms (4 to a pixel column), the minimum before the maximum in each; one bucket's peak stands out.
    const signal = (low: number, high: number, peak: { at: number; min?: number; max?: number }): StageView => ({
        frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'level', xs: [0, 1], values: [-20, -20],
        waveform: {
            min: Array.from({ length: n }, (_, i) => (i === peak.at && peak.min !== undefined ? peak.min : low)),
            max: Array.from({ length: n }, (_, i) => (i === peak.at && peak.max !== undefined ? peak.max : high)),
            minT: Array.from({ length: n }, (_, i) => i * 0.00025), maxT: Array.from({ length: n }, (_, i) => i * 0.00025 + 0.0001), absolutePeak: 0.4, unit: 'Pa', ref: 2e-5,
        },
    });
    const a = { view: signal(-0.1, 0.1, { at: 2001, max: 0.3 }), color: 'blue', label: 'base' };
    const b = { view: signal(-0.05, 0.02, { at: 2000, min: -0.4 }), color: 'gold', label: 'compare' };
    // Over the pixel column at 0.5 s the base's highest point (0.3 at 0.50035 s) is nearest a pointer high up:
    // the cursor goes to that point, the readout reads it to the digits a pixel tells apart.
    const high = stageHover(plotOf([a, b]), 500, 15)!;
    assert.equal(high.layer, a);
    assert.equal(high.text, 'base / 0.500 s / 0.300 Pa');
    assert.deepEqual([Math.round(high.x * 100) / 100, Math.round(high.y)], [500.35, 20]);
    // Low down, the compared signal's lowest point is nearer; past the signals' ends there is none.
    const low = stageHover(plotOf([a, b]), 500, 88)!;
    assert.deepEqual([low.layer, low.text, Math.round(low.y)], [b, 'compare / 0.500 s / −0.400 Pa', 90]);
    assert.equal(stageHover(plotOf([a, b]), 1500, 50), null);
    // Each signal reads its own unit: an uncalibrated one beside a calibrated one reads the uncalibrated unit, not the axis's.
    const raw = { ...b, view: { ...b.view, waveform: { ...b.view.waveform!, unit: '' } } };
    assert.equal(stageHover({ ...plotOf([a, raw]), signal: { unit: 'FS', paint: () => undefined } }, 500, 88)!.text, 'compare / 0.500 s / −0.400 FS');
    // Zoomed into −0.1…0.3 of the amplitude, a point clipped off the plot is not picked: the visible one is.
    const zoomed = { ...plotOf([a, b]), signal: { unit: 'Pa', range: { min: -0.1, max: 0.3 }, paint: () => undefined } };
    assert.equal(stageHover(zoomed, 500, 88)!.layer, a);
    // One wide bucket (zoomed into the coarse envelope): its whole span answers, not only up to its middle.
    const wide = { view: { ...a.view, waveform: { min: [-0.1], max: [0.1], minT: [0.1], maxT: [0.9], absolutePeak: 0.1, unit: 'Pa', ref: 2e-5 } }, color: 'blue', label: 'base' };
    assert.equal(stageHover(plotOf([wide]), 150, 40)!.text, 'base / 0.900 s / 0.100 Pa');
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
    assert.equal(stageDifference(base, compare), null);
    assert.equal(stageLevelsHeadline(base, compare, null, { ...strings, compareLevelsAt: '', stageEventCounts: '{base} / {compare}' }), '2 / 1');
    // A level nothing crosses: 0 counted, and the empty plot says to lower the level instead of 'cannot be shown'.
    const none = events([]);
    assert.equal(stageLevelsHeadline(none, compare, null, { ...strings, compareLevelsAt: '', stageEventCounts: '{base} / {compare}' }), '0 / 1');
    assert.equal(emptyStageText({ stepNotDrawable: 'no {frame}', stageNoEvents: 'lower it' }, none), 'lower it');
    assert.equal(emptyStageText({ stepNotDrawable: 'no {frame}', stageNoEvents: 'lower it' }, { frame: 'X', kind: 'none' }), 'no X');
    const axes = stageAxes({ axisTriggerTime: 'From trigger [s]', waveRangeAxisAmplitude: 'Amplitude' } as unknown as StageStrings, compare, undefined);
    assert.deepEqual(axes, { x: 'From trigger [s]', y: 'Amplitude [Pa]' });
    // A group's median is of the files' mean events: its own lines are not kept.
    assert.equal(medianView([base, events([5, 7])])?.events, undefined);
    // ...but it is still events: no difference against it, the event headline and the trigger's time axis.
    const median = medianView([base, events([5, 7])])!;
    assert.equal(stageDifference(median, compare), null);
    assert.equal(stageLevelsHeadline(median, compare, null, { ...strings, compareLevelsAt: '', stageEventCounts: '{base} / {compare}' }), '— / 1');
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
