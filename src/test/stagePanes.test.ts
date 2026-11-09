import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { held } from './helpers/heldSource';
import { spectrumLayer } from '../webview/runtime/overlaySpectrumPainter';
import { axisNameParts, fontPixels } from '../webview/plot/axisTitle';
import { heatmapDbRange, niceRange } from '../shared/utils/ticks';
import { axisFractionOf, axisValueAt, byLevel, levelBinsOf, emptyStageText, eventLayers, paintOverlay, stageAxes, paintColourBar, colourBarTop, stageEventCounts, stageDiffRange, stageHeadline, stageRange, stageHover, wrapLines, type StagePlot, type StageStrings } from '../webview/runtime/stagePanes';
import type { StageView } from '../shared/protocol/backendProtocol';
import { fetchedSource, localLine, NO_FULL_DATA } from '../webview/runtime/fullRead';

const line = (values: number[], quantity: StageView['quantity'] = 'level'): StageView => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity, xs: [100, 1000, 10000], values });
const strings = { stageNoDelta: 'none', stageMaxDelta: '{at} {delta}' };

/** compare − base point by point, as the backend's difference of two pictures already at full resolution is. */
function minus(base: StageView, compare: StageView): StageView {
    const sub = (a: number | null, b: number | null | undefined): number | null => (a === null || b === null || b === undefined ? null : Math.round((a - b) * 1e6) / 1e6);
    return compare.matrix
        ? { ...compare, matrix: compare.matrix.map((row, r) => row.map((value, c) => sub(value, base.matrix?.[r]?.[c]))) }
        : { ...compare, values: (compare.values ?? []).map((value, index) => sub(value, base.values?.[index])) };
}

test('the Δ pane\'s headline writes the backend\'s largest difference, found before thinning, never the largest point drawn', () => {
    // The drawn points say +14 dB at 1 kHz; the full-resolution peak (stage_combine.difference_peak) is elsewhere.
    const diff: StageView = { ...minus(line([-40, -30, -20]), line([-41, -16, -20])), peak: { x: 1250, value: 17.5, xStep: 1 } };
    assert.equal(stageHeadline(diff, strings), '1.25 kHz +17.5 dB');
    assert.equal(stageHeadline({ ...line([0, 0, 0], 'coherence'), peak: { x: 100, value: 0.1 } }, strings), '100 Hz +0.100');
    assert.equal(stageHeadline(null, strings), 'none');
    // Drawn points but no peak: nothing found at full resolution, so nothing is named from the picture.
    assert.equal(stageHeadline(minus(line([-40, -30, -20]), line([-41, -16, -20])), strings), 'none');
    const heat: StageView = { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', yAxis: 'frequency', xs: [0.5, 1], ys: [100, 1000], matrix: [[0, -5], [0, 0]], peak: { x: 1, y: 100, value: -5 } };
    assert.equal(stageHeadline(heat, strings), '1.00 s · 100 Hz −5.0 dB');
});

test('levels share a range of four round steps; coherence keeps 0 to 1', () => {
    assert.deepEqual(stageRange([line([-43, -12, -30])]), { min: -50, max: -10 });
    assert.deepEqual(stageRange([line([0.2, 0.5, 0.9], 'coherence')]), { min: 0, max: 1 });
});

test('a dB line\'s automatic range holds every value of its full data down to 100 dB under its loudest, on round steps (R9)', () => {
    // −49.5 to −9.5 dB: 40 dB wide, but four 10 dB steps from 0 would cut −49.5 off; 20 dB steps hold it.
    assert.deepEqual(stageRange([{ ...line([-30, -20]), valueRange: { min: -49.5, max: -9.5 } }]), { min: -80, max: 0 });
    for (const [min, max] of [[-49.5, -9.5], [-41, -1], [-109.5, -9.5], [-61, -2], [-12.3, -12.1], [-300, -20]]) {
        const range = stageRange([{ ...line([min, max]), valueRange: { min, max } }]);
        assert.ok(range.max >= max && range.min <= Math.max(min, max - 100), `${min}…${max} dB drawn on ${range.min}…${range.max}`);
        // Never wider than it needs: its bottom is at most a step under 100 dB below the loudest.
        assert.ok(range.min >= max - 100 - 25, `${min}…${max} dB drawn on ${range.min}…${range.max}`);
    }
});

test('every range is set from the full data\'s lowest and highest value (valueRange), never the points drawn or the cells averaged to draw an image (R1, R9)', () => {
    // A line thinned to points whose extremes were averaged away: its range holds every value.
    assert.deepEqual(stageRange([{ ...line([-43, -12, -30]), valueRange: { min: -61, max: -2 } }]), stageRange([line([-61, -2])]));
    // A heatmap's colours: the full STFT's loudest cell (a short loud one, averaged down to −20 dB to draw), not the cells.
    const heat = (matrix: number[][], valueRange?: StageView['valueRange']): StageView => ({ frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', yAxis: 'frequency', xs: [0, 1], ys: [100, 1000], matrix, ...(valueRange ? { valueRange } : {}) });
    const drawn = [[-40, -20], [-60, -30]];
    assert.deepEqual(stageRange([heat(drawn, { min: -64, max: -3 })]), heatmapDbRange(-64, -3));
    assert.notDeepEqual(stageRange([heat(drawn, { min: -64, max: -3 })]), stageRange([heat(drawn)]));
    // A cepstrogram's colour edge: the full coefficients' 99th percentile.
    const cep = (robust?: number): StageView => ({ frame: 'CepstrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'cepstrum', yAxis: 'quefrency', xs: [0, 1], ys: [0, 0.001, 0.002], matrix: [[9, 9], [0.1, -0.1], [0.2, 0.05]], ...(robust !== undefined ? { valueRange: { min: -0.9, max: 0.9, robust } } : {}) });
    assert.equal(stageRange([cep(0.71)]).max, niceRange(-0.71, 0.71).high);
    // A difference's ± from the full Δ.
    assert.deepEqual(stageDiffRange({ ...line([-2, 3]), valueRange: { min: -19, max: 7 } }), stageDiffRange(line([-19, 7])));
});

test('a heatmap\'s colours reach no more than 100 dB under its loudest value: digital silence (−240 dB) does not set the bottom (R9)', () => {
    assert.deepEqual(heatmapDbRange(-240, -3), { min: niceRange(-103, -3).low, max: niceRange(-103, -3).high });
    assert.ok(heatmapDbRange(-240, -3).min >= -120 && heatmapDbRange(-240, -3).min <= -103);
    // A range under 100 dB keeps its own lowest value.
    assert.deepEqual(heatmapDbRange(-64, -3), { min: niceRange(-64, -3).low, max: niceRange(-64, -3).high });
    const heat: StageView = { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', yAxis: 'frequency', xs: [0, 1], ys: [100, 1000], matrix: [[-240, -10]], valueRange: { min: -240, max: -3 } };
    assert.deepEqual(stageRange([heat]), heatmapDbRange(-240, -3));
});

test('a cross-channel picture names its pair on the value axis: the channel over its reference, before the unit', () => {
    const names = { axisFrequency: 'Frequency [Hz]', axisCoherence: 'Coherence γ² [–]', axisGain: 'Gain [dB]' } as unknown as StageStrings;
    assert.deepEqual(stageAxes(names, { ...line([0.2, 0.5, 0.9], 'coherence'), pair: { output: 2, input: 1 } }, undefined), { x: 'Frequency [Hz]', y: 'Coherence γ² · ch2 / ch1 [–]' });
    assert.equal(stageAxes(names, { ...line([0, -3, -6], 'gain'), pair: { output: 3, input: 1 } }, undefined).y, 'Gain · ch3 / ch1 [dB]');
    assert.equal(stageAxes(names, line([0.2, 0.5, 0.9], 'coherence'), undefined).y, 'Coherence γ² [–]');
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

test('a heatmap names what its colour measures, with its unit and reference, for its colour bar', () => {
    const names = { axisTime: 'Time [s]', axisFrequency: 'Frequency [Hz]', axisBark: 'Critical band [Bark]', axisQuefrency: 'Quefrency [ms]', axisCepstrum: 'Real cepstrum', axisRoughness: 'Roughness', axisDelta: 'Δ level [dB]', axisLevelUncal: 'Level [dBFS, uncalibrated]', axisLevelCal: 'Level [{ref}]' } as unknown as StageStrings;
    const heat = (quantity: StageView['quantity'], extra: Partial<StageView> = {}): StageView => ({ frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity, yAxis: 'frequency', xs: [0, 1], ys: [100, 1000], matrix: [[-40, -40], [-30, -30]], ...extra });
    const spectrogram = stageAxes(names, heat('level'), undefined);
    assert.equal(spectrogram.y, 'Frequency [Hz]');
    assert.ok(spectrogram.colour && spectrogram.colour.length > 0, 'a spectrogram\'s colour is its level');
    assert.equal(spectrogram.colour, stageAxes(names, { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100], values: [-40] }, undefined).y, 'named as a spectrum\'s level axis is');
    assert.equal(stageAxes(names, heat('roughness', { unit: 'asper', yAxis: 'bark' }), undefined).colour, 'Roughness [asper]');
    assert.equal(stageAxes(names, heat('cepstrum', { yAxis: 'quefrency' }), undefined).colour, 'Real cepstrum');
    assert.equal(stageAxes(names, heat('level'), undefined, true).colour, 'Δ level [dB]');
});

const cepstrum = (values: number[]): StageView => ({ frame: 'CepstralFrame', kind: 'line', x: 'quefrency', xScale: 'linear', quantity: 'cepstrum', xs: [0, 0.001, 0.002, 0.003], values });

test('a cepstrum is drawn on a quefrency axis, symmetric about zero without its zero-quefrency coefficient', () => {
    const view = cepstrum([-8.5, 0.01, -0.02, 0.005]);
    const range = stageRange([view]);
    assert.ok(Math.abs(range.max - 0.022) < 1e-9 && range.min === -range.max);
    const names = { axisQuefrency: 'Quefrency s', axisCepstrum: 'Real cepstrum', axisDelta: 'Δ dB' } as unknown as StageStrings;
    assert.deepEqual(stageAxes(names, view, undefined), { x: 'Quefrency s', y: 'Real cepstrum' });
    const diff = minus(view, cepstrum([-8.4, 0.03, -0.02, 0.005]));
    assert.deepEqual(stageAxes(names, diff, undefined, true), { x: 'Quefrency s', y: 'Δ Real cepstrum' });
    assert.equal(stageHeadline({ ...diff, peak: { x: 0.001, value: 0.02, xStep: 0.001 } }, strings), '1.00 ms +0.0200');
    assert.deepEqual(stageDiffRange(diff), { min: -0.022, max: 0.022 });
});

const correlation = (values: number[]): StageView => ({ frame: 'CrossCorrelationFrame', kind: 'line', x: 'lag', xScale: 'linear', quantity: 'correlation', xs: [-0.002, -0.001, 0, 0.001], values, pair: { output: 2, input: 1 } });

test('a cross-correlation is drawn over a signed lag axis on the fixed [-1, 1] coefficient range', () => {
    const view = correlation([0.1, -0.2, 0.3, 0.95]);
    assert.deepEqual(stageRange([view]), { min: -1, max: 1 });
    const names = { axisLag: 'Lag s', axisCorrelation: 'Correlation coefficient', axisDelta: 'Δ dB' } as unknown as StageStrings;
    assert.deepEqual(stageAxes(names, view, undefined), { x: 'Lag s', y: 'Correlation coefficient · ch2 / ch1' });
    const diff = minus(view, correlation([0.1, -0.2, 0.3, 0.55]));
    assert.deepEqual(stageAxes(names, diff, undefined, true), { x: 'Lag s', y: 'Δ Correlation coefficient · ch2 / ch1' });
    assert.equal(stageHeadline({ ...diff, peak: { x: 0.001, value: -0.4, xStep: 0.001 } }, strings), '+1.00 ms −0.400');
    // A delay is read to 10 µs at any lag, and none has no sign.
    const long: StageView = { ...view, xs: [-0.0125, 0, 0.0125, 0.02] };
    // Points 50 px apart, so the pointer over each reads that one.
    const plot: StagePlot = { frame: { left: 0, top: 0, width: 200, height: 100 }, xAt: value => (value + 0.0125) * 4000, xOf: x => x / 4000 - 0.0125, yAt: value => -value, ratioStep: 1.12, lines: [{ view: long, color: 'blue', full: held(long) }], diff: false };
    assert.match(stageHover(plot, 0, 0)!.text, /^−12\.50 ms/);
    assert.match(stageHover(plot, 50, 0)!.text, /^0\.00 ms/);
});

test('a trigger\'s events are each a line of their slot, on one amplitude range, with no difference between recordings', () => {
    const events = (peaks: number[]): StageView => ({
        frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'Pa', xs: [-0.01, 0, 0.1],
        values: [0, peaks.reduce((a, b) => a + b, 0) / peaks.length, 0], events: peaks.map((peak, id) => ({ id: id * 2, time: id, xs: [-0.01, 0, 0.1], values: [0, peak, 0] })),
    });
    const base = events([1, 3]), compare = events([2]);
    const layers = eventLayers({ view: compare, color: '#ff0', width: 2.2, label: 'b.wav', full: held(compare) });
    // One line per event, in the slot's colour, named by its event from 1 for the readout.
    // One line per event, named by its event and where in the recording it was cut.
    assert.deepEqual(layers.map(layer => [layer.label, layer.view.values, layer.color, layer.view.events]), [['b.wav #1 @ 0.00 s', [0, 2, 0], '#ff0', undefined]]);
    // A recording's events can be left out: those are faint, and each line says whose event it is.
    const own = eventLayers({ view: base, color: '#00f', source: 'a.wav', excluded: [2], full: held(base) });
    assert.deepEqual(own.map(layer => [layer.event, layer.alpha]), [[{ id: 0, source: 'a.wav', out: false }, 0.85], [{ id: 2, source: 'a.wav', out: true }, 0.25]]);
    assert.deepEqual(eventLayers({ view: line([1, 2, 3]), color: '#00f', full: held(line([1, 2, 3])) }).map(layer => layer.view.values), [[1, 2, 3]]);
    // The range holds every event's peak, not only their mean.
    assert.ok(stageRange([base, compare]).max >= 3);
    // Amplitudes have no −300 dB floor: a −500 (raw counts) peak is in the range.
    assert.ok(stageRange([events([-500])]).min <= -500);
    // Two recordings' events are not one another's: no Δ, and the headline counts them instead.
    assert.equal(stageEventCounts(base, compare, { stageEventCounts: '{base} / {compare}' }), '2 / 1');
    // A level nothing crosses: 0 counted, and the empty plot says to lower the level instead of 'cannot be shown'.
    const none = events([]);
    assert.equal(stageEventCounts(none, compare, { stageEventCounts: '{base} / {compare}' }), '0 / 1');
    assert.equal(emptyStageText({ stepNotDrawable: 'no {frame}', stageNoEvents: 'lower it' }, none), 'lower it');
    assert.equal(emptyStageText({ stepNotDrawable: 'no {frame}', stageNoEvents: 'lower it' }, { frame: 'X', kind: 'none' }), 'no X');
    const axes = stageAxes({ axisTriggerTime: 'From trigger [s]', waveRangeAxisAmplitude: 'Amplitude', axisUncalibrated: ', uncalibrated' } as unknown as StageStrings, compare, { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false });
    assert.deepEqual(axes, { x: 'From trigger [s]', y: 'Amplitude [Pa]' });
    // A group's median (the backend's, of the files' mean events) has no event lines of its own, but it is still
    // events: the event headline and the trigger's time axis.
    const { events: _lines, ...median } = events([5, 7]);
    assert.equal(stageEventCounts(median, compare, { stageEventCounts: '{base} / {compare}' }), '— / 1');
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

/** A view with the levelBins the backend gives it, from `full` (its values before thinning; its drawn values by default). */
function measured(view: StageView, full: number[] = (view.values ?? []).map(value => value ?? Number.NaN)): StageView {
    const xs = view.xs ?? [];
    return { ...view, levelBins: levelBinsOf(xs, full, [xs[0], xs[xs.length - 1]], view.xScale === 'log') };
}

test('overlaid lines are drawn loudest first, the quietest last on top, by their level on screen', () => {
    const layer = (color: string, values: number[], quantity: StageView['quantity'] = 'level') => { const view = quantity === 'level' ? measured(line(values, quantity)) : line(values, quantity); return { view, color, full: held(view) }; };
    const base = layer('blue', [-40, -40, -40]), loud = layer('yellow', [-20, -40, -40]), quiet = layer('grey', [-60, -60, -60]);
    assert.deepEqual(byLevel([quiet, base, loud], line([0, 0, 0])).map(item => item.color), ['yellow', 'blue', 'grey']);
    // Zoomed past the 100 Hz point, the yellow and blue lines are as loud: they keep their order.
    assert.deepEqual(byLevel([base, loud, quiet], line([0, 0, 0]), { start: 0.4, end: 1 }).map(item => item.color), ['blue', 'yellow', 'grey']);
    // Lines not in dB keep their place, after the levels.
    const coherence = layer('green', [0.9, 0.9, 0.9], 'coherence');
    assert.deepEqual(byLevel([coherence, quiet, loud], line([0, 0, 0])).map(item => item.color), ['yellow', 'grey', 'green']);
});

/** A canvas whose context records the colour of each line stroked, in the order stroked. */
function strokingCanvas(): { canvas: HTMLCanvasElement; strokes: string[] } {
    const strokes: string[] = [];
    let strokeStyle = '';
    const context = new Proxy({}, {
        get: (_target, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 })
            : key === 'stroke' ? () => { strokes.push(strokeStyle); } : key === 'strokeStyle' ? strokeStyle : () => undefined),
        set: (_target, key, value) => { if (key === 'strokeStyle') strokeStyle = String(value); return true; },
    });
    const canvas = { width: 0, height: 0, clientWidth: 600, clientHeight: 200, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
    return { canvas, strokes };
}

test('each event of a trigger is its own series, drawn at its own times: never at the xs of another event or of their mean (R2)', () => {
    // Their mean on its own xs; each event's peak where it occurred, at a time neither the mean nor the other has.
    const view: StageView = {
        frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'Pa', xs: [-0.01, 0, 0.1], values: [0, 0.5, 0],
        events: [{ id: 0, time: 1, xs: [-0.01, 0.02, 0.1], values: [0, 1, 0] }, { id: 1, time: 2, xs: [-0.01, 0.07, 0.1], values: [0, 0.8, 0] }],
    };
    const layers = eventLayers({ view, color: '#ff0', label: 'b.wav', full: held(view) });
    assert.deepEqual(layers.map(layer => layer.view.xs), [[-0.01, 0.02, 0.1], [-0.01, 0.07, 0.1]]);
    // What is stroked: each line's points, in canvas pixels.
    const paths: Array<Array<[number, number]>> = [];
    let path: Array<[number, number]> = [];
    const context = new Proxy({}, {
        get: (_target, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 })
            : key === 'beginPath' ? () => { path = []; } : key === 'moveTo' || key === 'lineTo' ? (x: number, y: number) => { path.push([x, y]); }
                : key === 'stroke' ? () => { paths.push(path); } : () => undefined),
        set: () => true,
    });
    const canvas = { width: 0, height: 0, clientWidth: 600, clientHeight: 200, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
    const plot = paintOverlay(canvas, { layers }, { min: -1, max: 1 }, { x: 'Time [s]', y: 'Amplitude [Pa]' });
    assert.ok(plot);
    // Each event's line (three points) has its top at its own peak's time and value.
    const peaks = paths.filter(points => points.length === 3).map(points => points.reduce((top, point) => (point[1] < top[1] ? point : top)));
    for (const [at, value] of [[0.02, 1], [0.07, 0.8]]) {
        assert.ok(peaks.some(([x, y]) => Math.abs(x - plot.xAt(at)) < 0.5 && Math.abs(y - plot.yAt(value)) < 0.5), `a line peaks at ${at} s`);
    }
});

test('every plot draws its overlaid lines loudest first and the quietest last on top, whatever order the caller gives them (R6)', () => {
    const layer = (color: string, values: number[]) => { const view = measured(line(values)); return { view, color, width: 2, full: held(view) }; };
    const { canvas, strokes } = strokingCanvas();
    // Given the quiet one first, as the report gives its base before the compared file: the plot puts it on top.
    paintOverlay(canvas, { layers: [layer('quiet', [-60, -60, -60]), layer('loud', [-20, -20, -20]), layer('base', [-40, -40, -40])] }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' });
    assert.deepEqual(strokes.filter(color => ['loud', 'base', 'quiet'].includes(color)), ['loud', 'base', 'quiet'], 'the quietest line is stroked last');
    assert.equal(canvas.dataset.plotOrder, '-20.00,-40.00,-60.00', 'the levels it drew, in order, for the audit of every plot');
    // Given loud first, the same order: the caller's order does not decide it, and the colours stay the caller's.
    strokes.length = 0;
    paintOverlay(canvas, { layers: [layer('loud', [-20, -20, -20]), layer('quiet', [-60, -60, -60]), layer('base', [-40, -40, -40])] }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' });
    assert.deepEqual(strokes.filter(color => ['loud', 'base', 'quiet'].includes(color)), ['loud', 'base', 'quiet']);
    // Lines on the right-hand level axis are ordered among themselves the same way.
    strokes.length = 0;
    paintOverlay(canvas, { layers: [layer('loud', [-20, -20, -20])] }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' },
        { secondary: { layers: [layer('second-quiet', [-70, -70, -70]), layer('second-loud', [-30, -30, -30])], range: { min: -80, max: 0 }, title: 'Level [dB re 1]' } });
    assert.deepEqual(strokes.filter(color => color.startsWith('second')), ['second-loud', 'second-quiet']);
});

test('a picture that is not a compared line keeps the place its caller gave it among the overlay (R6)', () => {
    const { canvas, strokes } = strokingCanvas();
    // A median tick (a line without a level) first, then a quiet and a loud line: the tick stays first, the lines swap.
    const tick = { view: { ...line([0, 1, 0]), quantity: undefined }, color: 'tick', full: held({ ...line([0, 1, 0]), quantity: undefined }) };
    const quiet = { view: measured(line([-60, -60, -60])), color: 'quiet', full: held(line([-60, -60, -60])) }, loud = { view: measured(line([-20, -20, -20])), color: 'loud', full: held(line([-20, -20, -20])) };
    paintOverlay(canvas, { layers: [quiet, loud, tick] }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' });
    assert.deepEqual(strokes.filter(color => ['tick', 'quiet', 'loud'].includes(color)), ['loud', 'quiet', 'tick']);
    // A lane's finer data over part of its view is a part of one picture, not a line compared: drawn as given.
    strokes.length = 0;
    const part = (color: string, values: number[], span: [number, number]) => ({ view: line(values), color, span, full: held(line(values)) });
    paintOverlay(canvas, { layers: [part('around', [-60, -60, -60], [100, 300]), part('detail', [-20, -20, -20], [300, 10000])] }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' });
    assert.deepEqual(strokes.filter(color => ['around', 'detail'].includes(color)), ['around', 'detail']);
});

test('no chart orders its own overlaid lines: the order is the plot component\'s alone (R6)', () => {
    // Every chart draws through paintOverlay (R13, canvasAudit.ts), which orders the lines; a caller ordering them
    // too would be a second rule that drifts from it.
    const root = path.resolve(__dirname, '..', '..', 'src', 'webview');
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.ts') ? [path.join(dir, entry.name)] : []));
    const ordering = files(root).filter(file => path.basename(file) !== 'stagePanes.ts' && /\b(byLevel|overlayOrder)\s*\(/u.test(readFileSync(file, 'utf8')));
    assert.deepEqual(ordering.map(file => path.relative(root, file)), []);
    // And the component draws every overlay in that order: paintOverlay's lines come from overlayOrder, kept as last
    // judged while a level is on its way (settledOrder).
    const plot = readFileSync(path.join(root, 'runtime', 'stagePanes.ts'), 'utf8');
    assert.match(plot, /const order = settledOrder\(canvas, 'main', overlay\.layers, overlayOrder\(overlay\.layers,/u);
});

test('waveforms are ordered by their samples\' mean square on the shared amplitude axis, whatever their level reference', () => {
    // 0.1 Pa reads 71 dB re 20 µPa, 0.5 FS −9 dB re 1: on screen the FS one is the larger and goes under.
    const signal = (color: string, peak: number, level: number, ref: number) => ({ color, view: {
        frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'level', xs: [0, 1], values: [level, level],
        waveform: { min: [-peak, -peak], max: [peak, peak], minT: [0, 1], maxT: [0, 1], absolutePeak: peak, unit: ref === 1 ? 'FS' : 'Pa', ref },
        levelBins: { edges: [0, 1], power: [peak * peak / 2], count: [48000] },
    } as StageView, full: NO_FULL_DATA });
    const pa = signal('blue', 0.1, 71, 2e-5), fs = signal('yellow', 0.5, -9, 1);
    assert.deepEqual(byLevel([pa, fs], pa.view).map(item => item.color), ['yellow', 'blue']);
});

test('silence on screen lowers a line\'s level as no power, instead of being left out', () => {
    const layer = (color: string, values: number[]) => { const view = measured({ ...line(values), xs: [100, 200, 400, 800] }); return { view, color, full: held(view) }; };
    const gaps = layer('blue', [-20, -300, -300, -300]), steady = layer('yellow', [-23, -23, -23, -23]);
    assert.deepEqual(byLevel([gaps, steady], steady.view).map(item => item.color), ['yellow', 'blue']);
});

test('the order comes from every value before thinning, never from the points drawn (R2, R6)', () => {
    // Drawn, the blue line's thinned points look louder (one −10 dB spike kept as a bucket's highest); over every bin
    // it is the quieter. It goes on top.
    const spiky = { view: measured(line([-10, -70, -70]), [-40, -70, -70]), color: 'blue', full: held(measured(line([-10, -70, -70]), [-40, -70, -70])) };
    const steady = { view: measured(line([-30, -30, -30])), color: 'yellow', full: held(line([-30, -30, -30])) };
    assert.deepEqual(byLevel([spiky, steady], line([0, 0, 0])).map(item => item.color), ['yellow', 'blue']);
    // A DC signal, and a signal zoomed in to single samples, have their mean square, not the zero of max − min.
    const signal = (color: string, power: number) => ({ color, view: {
        frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', xs: [0, 1], values: [0.5, 0.5],
        waveform: { min: [0.5, 0.5], max: [0.5, 0.5], minT: [0, 1], maxT: [0, 1], absolutePeak: 0.5, unit: '', ref: 1 },
        levelBins: { edges: [0, 0.5, 1], power: [power, power], count: [2, 2] },
    } as StageView, full: NO_FULL_DATA });
    const dc = signal('dc', 0.25), faint = signal('faint', 0.0001);
    assert.deepEqual(byLevel([faint, dc], dc.view).map(item => item.color), ['dc', 'faint']);
    // Over part of the axis, only the stretches on screen count.
    const late = { color: 'late', view: { ...dc.view, levelBins: { edges: [0, 0.5, 1], power: [0, 1], count: [2, 2] } }, full: dc.full };
    const early = { color: 'early', view: { ...dc.view, levelBins: { edges: [0, 0.5, 1], power: [0.5, 0], count: [2, 2] } }, full: dc.full };
    assert.deepEqual(byLevel([late, early], dc.view, { start: 0, end: 0.5 }).map(item => item.color), ['early', 'late']);
    assert.deepEqual(byLevel([early, late], dc.view, { start: 0.5, end: 1 }).map(item => item.color), ['late', 'early']);
});

test('a zoom narrower than one of a line\'s stretches still orders it by the stretch it is in (R6)', () => {
    // Two lines measured over 0–24 kHz in 256 stretches (94 Hz each), zoomed to 10 000–10 010 Hz: inside one stretch.
    const xs = Array.from({ length: 2049 }, (_, i) => i * 24000 / 2048);
    const flat = (level: number): StageView => ({ frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs, values: xs.map(() => level),
        levelBins: levelBinsOf(xs, xs.map(() => level), [0, 24000], false) });
    const quiet = { view: flat(-60), color: 'quiet', full: held(flat(-60)) }, loud = { view: flat(-20), color: 'loud', full: held(flat(-20)) };
    const axis: StageView = { frame: 'spectrum', kind: 'line', xs: [0, 24000], xLimits: [0, 24000], xScale: 'linear' };
    const window = { start: 10000 / 24000, end: 10010 / 24000 };
    assert.deepEqual(byLevel([quiet, loud], axis, window).map(item => item.color), ['loud', 'quiet']);
});

test('a cursor spectrum on a linear axis counts its 0 Hz bin in its level (R6)', () => {
    // [0, −100, −100] dB is louder over every bin (−4.8 dB) than [−100, −20, −20] (−21.8 dB): it goes under.
    const slice = (values: number[]) => ({ slice: { values, frequencyBins: 3, maxFrequencyHz: 1000, minDb: -100, maxDb: 0 }, color: String(values[0]), index: 0, channelIndex: 0, label: '' });
    const visible = { frequencyMin: 0, frequencyMax: 1000, buckets: 400, logFrequency: false };
    const dc = spectrumLayer(slice([0, -100, -100]), 1000, visible), tone = spectrumLayer(slice([-100, -20, -20]), 1000, visible);
    const axis: StageView = { frame: 'spectrum', kind: 'line', xs: [0, 1000], xLimits: [0, 1000], xScale: 'linear' };
    assert.deepEqual(byLevel([tone, dc], axis).map(item => item.color), ['0', '-100']);
});

/** The order expected over [x0, x1], worked out here from every value of each line: the mean of 10^(dB/10), loudest first. */
function expectedOrder(lines: ReadonlyArray<{ color: string; xs: readonly number[]; values: readonly number[] }>, x0: number, x1: number): string[] {
    const mean = (xs: readonly number[], values: readonly number[]): number => {
        const inside = values.filter((_, index) => xs[index] >= x0 && xs[index] <= x1);
        return inside.reduce((sum, value) => sum + 10 ** (value / 10), 0) / inside.length;
    };
    return [...lines].sort((a, b) => mean(b.xs, b.values) - mean(a.xs, a.values)).map(item => item.color);
}

test('while a line\'s level on screen is on its way, the plot keeps the order it last judged on every value: never one guessed from part of it (R6)', async () => {
    const xs = Array.from({ length: 2049 }, (_, i) => i * 24000 / 2048);
    const x0 = 5000, x1 = 10000, peakBin = 854;
    const peaked = xs.map((_, i) => (i === peakBin ? 0 : -40)), flat = xs.map(() => -35);
    // The backend's answers are held until let go, as a slow reply.
    const held: Array<() => void> = [];
    const backend = (values: readonly number[]) => fetchedSource((read, done) => {
        held.push(() => {
            const inside = values.filter((_, index) => xs[index] >= read.x[0] && xs[index] <= read.x[1]);
            done({ xs: [], start: null, end: null, complete: false, level: { power: inside.reduce((sum, value) => sum + 10 ** (value / 10), 0) / inside.length, count: inside.length } });
        });
    });
    const sources = { flat: backend(flat), peaked: backend(peaked) };
    const layer = (color: 'flat' | 'peaked', values: number[]) => ({ color, width: 2, full: sources[color],
        view: { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs: xs.filter((_, i) => i % 16 === 0), values: values.filter((_, i) => i % 16 === 0),
            levelBins: levelBinsOf(xs, values, [0, 24000], false) } as StageView });
    const axis: StageView = { frame: 'spectrum', kind: 'line', xs: [0, 24000], xLimits: [0, 24000], xScale: 'linear' };
    const lines = (strokes: string[]) => strokes.filter(color => color === 'flat' || color === 'peaked');
    const zoomed = { axisView: axis, window: { x: { start: x0 / 24000, end: x1 / 24000 } } };
    // Before anything is judged, the caller's order: not one guessed from the stretches on screen.
    const fresh = strokingCanvas();
    paintOverlay(fresh.canvas, { layers: [layer('peaked', peaked), layer('flat', flat)] }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' }, zoomed);
    assert.deepEqual(lines(fresh.strokes), ['peaked', 'flat']);
    assert.match(fresh.canvas.dataset.plotOrder ?? '', /…/u);
    // Over the whole axis every stretch is on screen: judged at once, the peaked line the louder (under).
    const { canvas, strokes } = strokingCanvas();
    paintOverlay(canvas, { layers: [layer('flat', flat), layer('peaked', peaked)] }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' }, { axisView: axis });
    assert.deepEqual(lines(strokes), expectedOrder([{ color: 'peaked', xs, values: peaked }, { color: 'flat', xs, values: flat }], 0, 24000));
    assert.deepEqual(lines(strokes), ['peaked', 'flat']);
    // Zoomed, the levels on screen are asked for: until both are in, the plot keeps that order, given in either order.
    for (const given of [['flat', 'peaked'], ['peaked', 'flat']] as const) {
        strokes.length = 0;
        paintOverlay(canvas, { layers: given.map(color => layer(color, color === 'flat' ? flat : peaked)) }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' }, zoomed);
        assert.deepEqual(lines(strokes), ['peaked', 'flat'], `kept while measured, given ${given.join(', ')}`);
        assert.match(canvas.dataset.plotOrder ?? '', /…/u);
    }
    // One level in, the other still on its way: still kept.
    strokes.length = 0;
    held.shift()?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(lines(strokes).slice(-2), ['peaked', 'flat']);
    assert.match(canvas.dataset.plotOrder ?? '', /…/u);
    // Both in: judged on every value on screen, the quieter peaked line on top, and drawn so.
    while (held.length) held.shift()?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(lines(strokes).slice(-2), expectedOrder([{ color: 'peaked', xs, values: peaked }, { color: 'flat', xs, values: flat }], x0, x1));
    assert.deepEqual(lines(strokes).slice(-2), ['flat', 'peaked']);
    assert.equal(canvas.dataset.plotOrder, '-35.00,-40.00');
});

test('zoomed, lines are ordered by every value on screen: a loud peak just off screen, in a stretch the edge cuts, does not count (R6, R2)', async () => {
    // Two spectra of 2049 bins over 0–24 kHz, held by the backend: each comes thinned to be drawn, with the levelBins
    // of its every bin (256 stretches of 93.75 Hz), and its full data read through a fetched source.
    const xs = Array.from({ length: 2049 }, (_, i) => i * 24000 / 2048);
    // Zoomed to 5–10 kHz. The stretch 9937.5–10031.25 Hz is cut by the right edge; the peak at 10007.8 Hz is in it,
    // off screen. On screen the peaked line is the quieter (−40 dB against −35 dB): it goes on top.
    const x0 = 5000, x1 = 10000, peakBin = 854;
    assert.ok(xs[peakBin] > x1 && xs[peakBin] < 10031.25);
    const peaked = xs.map((_, i) => (i === peakBin ? 0 : -40)), flat = xs.map(() => -35);
    const reads: number[][] = [];
    const backend = (values: readonly number[]) => fetchedSource((read, done) => {
        reads.push(read.x);
        // The backend's read_level (full_read.py): the mean power of every value in the window, ends in.
        setTimeout(() => {
            const inside = values.filter((_, index) => xs[index] >= read.x[0] && xs[index] <= read.x[1]);
            done({ xs: [], start: null, end: null, complete: false, level: { power: inside.reduce((sum, value) => sum + 10 ** (value / 10), 0) / inside.length, count: inside.length } });
        }, 0);
    });
    const layer = (color: string, values: number[]) => ({ color, width: 2, full: backend(values),
        view: { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs: xs.filter((_, i) => i % 16 === 0), values: values.filter((_, i) => i % 16 === 0),
            levelBins: levelBinsOf(xs, values, [0, 24000], false) } as StageView });
    const axis: StageView = { frame: 'spectrum', kind: 'line', xs: [0, 24000], xLimits: [0, 24000], xScale: 'linear' };
    const expected = expectedOrder([{ color: 'peaked', xs, values: peaked }, { color: 'flat', xs, values: flat }], x0, x1);
    assert.deepEqual(expected, ['flat', 'peaked']);
    const { canvas, strokes } = strokingCanvas();
    paintOverlay(canvas, { layers: [layer('flat', flat), layer('peaked', peaked)] }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' },
        { axisView: axis, window: { x: { start: x0 / 24000, end: x1 / 24000 } } });
    // Until every value on screen is in, the order is not judged.
    assert.match(canvas.dataset.plotOrder ?? '', /…/u);
    strokes.length = 0;
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(reads, [[x0, x1], [x0, x1]], 'each line measured once, over the window on screen');
    // Drawn again as each comes in (one read is on its way at a time): last with both, the quieter on top.
    assert.deepEqual(strokes.filter(color => color === 'flat' || color === 'peaked').slice(-2), expected, 'drawn again once measured, the quieter on top');
    assert.equal(canvas.dataset.plotOrder, '-35.00,-40.00');
    // Over the whole axis every stretch is on screen: its levelBins give the order at once, with nothing fetched.
    strokes.length = 0;
    paintOverlay(canvas, { layers: [layer('peaked', peaked), layer('flat', flat)] }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' }, { axisView: axis });
    assert.deepEqual(strokes.filter(color => color === 'flat' || color === 'peaked'), expectedOrder([{ color: 'peaked', xs, values: peaked }, { color: 'flat', xs, values: flat }], 0, 24000));
    assert.equal(reads.length, 2);
});

test('a line the webview holds every value of is ordered at once by its values on screen, the stretch cut by the edge too (R6)', () => {
    const xs = Array.from({ length: 2049 }, (_, i) => i * 24000 / 2048);
    const x0 = 5000, x1 = 10000;
    const peaked = xs.map((_, i) => (i === 854 ? 0 : -40)), flat = xs.map(() => -35);
    const layer = (color: string, values: number[]) => ({ color, full: localLine(xs, values),
        view: { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs, values, levelBins: levelBinsOf(xs, values, [0, 24000], false) } as StageView });
    const axis: StageView = { frame: 'spectrum', kind: 'line', xs: [0, 24000], xLimits: [0, 24000], xScale: 'linear' };
    const window = { start: x0 / 24000, end: x1 / 24000 };
    assert.deepEqual(byLevel([layer('peaked', peaked), layer('flat', flat)], axis, window).map(item => item.color),
        expectedOrder([{ color: 'peaked', xs, values: peaked }, { color: 'flat', xs, values: flat }], x0, x1));
});

test('a level drawn with no levels from its values before thinning is written as unmeasured, for the audit to fail (R6)', () => {
    const { canvas } = strokingCanvas();
    paintOverlay(canvas, { layers: [{ view: line([-20, -20, -20]), color: 'a', full: held(line([-20, -20, -20])) }, { view: measured(line([-40, -40, -40])), color: 'b', full: held(measured(line([-40, -40, -40]))) }] }, { min: -80, max: 0 }, { x: 'Frequency [Hz]', y: 'Level [dB]' });
    assert.match(canvas.dataset.plotOrder ?? '', /\?/u);
});

test('a colour bar stays inside a narrow plot and never leaves out its name: beside the scale, else above it, shortened only as every axis name is (R4)', () => {
    // 10px sans-serif, about 5.6 px a character (at the font's own size).
    const drawn: Array<{ text: string; x: number; y: number; font: string }> = [];
    let box = { x: 0, width: 0, height: 0 };
    const context = {
        font: '10px sans-serif',
        measureText(this: { font: string }, text: string) { return { width: text.length * 5.6 * (fontPixels(this.font) / 10) }; },
        fillText(this: { font: string }, text: string, x: number, y: number) { drawn.push({ text, x, y, font: this.font }); },
        fillRect: (x: number, _y: number, width: number, height: number) => { if (!box.width) box = { x, width, height }; },
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        strokeRect: () => undefined, save: () => undefined, restore: () => undefined,
    } as unknown as CanvasRenderingContext2D;
    const name = 'Amplitude, uncalibrated [dBFS]';
    const paint = (left: number, right: number) => {
        drawn.length = 0; box = { x: 0, width: 0, height: 0 };
        const returned = paintColourBar(context, { left, right, top: 0 }, name, '−80', '0', () => '#000', { text: '#000', back: '#fff', line: '#000' });
        const titles = drawn.filter(item => item.text !== '−80' && item.text !== '0');
        return { titles: titles.map(item => item.text), drawn: [...drawn], left: box.x, returned };
    };
    const wide = paint(56, 600);
    assert.deepEqual(wide.titles, [name], 'a wide plot names it in full, beside the scale');
    assert.equal(new Set(wide.drawn.map(item => item.y)).size, 1, 'on one row');
    for (const right of [296, 200, 150, 110]) {
        const narrow = paint(56, right);
        assert.ok(narrow.titles.length >= 1, `${right}: its name is drawn`);
        const joined = narrow.titles.length === 2 ? `${narrow.titles[0]} ${narrow.titles[1]}` : narrow.titles[0];
        assert.ok(axisNameParts(joined), `${right}: its quantity and its unit: ${narrow.titles.join(' / ')}`);
        assert.ok(narrow.titles.some(text => text.includes('[dBFS]')), `${right}: its unit`);
        assert.ok(narrow.titles.some(text => /^Amp/u.test(text)), `${right}: its quantity, whole or shortened`);
        assert.ok(narrow.left >= 56, `${right}: inside the plot`);
        const scaleY = narrow.drawn.find(item => item.text === '−80')?.y ?? 0;
        assert.ok(narrow.drawn.filter(item => narrow.titles.includes(item.text)).every(item => item.y < scaleY), `${right}: above the scale`);
        assert.ok(narrow.returned.height > 14, `${right}: its box holds the name's row`);
    }
    assert.deepEqual(paint(56, 296).titles, [name], 'with the plot\'s width, the name is whole above the scale');
});

test("a colour bar moves under the region's corner tag, which covers the plot's top right from 4 to 21 px down", () => {
    assert.equal(colourBarTop(10, false), 13);
    assert.ok(colourBarTop(10, true) >= 10 + 21);
});

test('the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)', () => {
    const xs = Array.from({ length: 101 }, (_, i) => i), values = xs.map(i => (i === 50 ? 1 : 0));
    const spiky: StageView = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'coherence', xs, values };
    const plot: StagePlot = { frame: { left: 0, top: 0, width: 200, height: 100 }, xAt: value => value * 2, xOf: x => x / 2, yAt: value => 100 - value * 80, ratioStep: 1.12, lines: [{ view: spiky, color: 'blue', full: held(spiky) }], diff: false };
    // 8 px right of the peak and a little under its top: the top.
    assert.deepEqual(pick(stageHover(plot, 108, 25)), { x: 100, y: 20 });
    // Down by the floor at the same place: the floor under the pointer.
    assert.deepEqual(pick(stageHover(plot, 108, 98)), { x: 108, y: 100 });
    // Past the radius, the point under the pointer as before.
    assert.deepEqual(pick(stageHover(plot, 150, 20)), { x: 150, y: 100 });
    // Zoomed into the level axis, the peak past its top is off the plot: the line under the pointer is read, not the clamped peak.
    const clamped = (value: number): number => 100 - Math.min(0.5, Math.max(0, value)) * 200;
    const zoomed: StagePlot = { ...plot, yAt: clamped, lineYAt: value => 100 - value * 200 };
    assert.deepEqual(pick(stageHover(zoomed, 108, 3)), { x: 108, y: 100 });
});

test('a signal is read at its sample nearest the pointer within a few pixels, never at a point of the envelope drawn (R7)', () => {
    // Drawn as two buckets of their lowest and highest; its samples are four, at their own times.
    const wave: StageView = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'amplitude', xs: [], values: [],
        waveform: { min: [-0.5, -0.2], max: [0.5, 0.9], minT: [0, 99], maxT: [40, 51] } } as unknown as StageView;
    const samples = localLine([0, 40, 51, 52, 99], [-0.5, 0.5, 0.9, 0.7, -0.2]);
    const plot: StagePlot = { frame: { left: 0, top: 0, width: 200, height: 100 }, xAt: value => value, xOf: x => x, yAt: value => 50 - value * 50, ratioStep: 1.12, lines: [{ view: wave, color: 'blue', full: samples }], diff: false };
    // The sample at (51, 5) is 1 px from the pointer; the one at (40, 25) is farther.
    assert.deepEqual(pick(stageHover(plot, 50, 5)), { x: 51, y: 5 });
    // A sample the envelope does not draw (52 s, 0.7) is read where it is nearest.
    assert.deepEqual(pick(stageHover(plot, 53, 15)), { x: 52, y: 15 });
    // Given no full data, a signal reads nothing, not the envelope's point under the pointer.
    assert.equal(stageHover({ ...plot, lines: [{ view: wave, color: 'blue', full: NO_FULL_DATA }] }, 50, 5), null);
});

function pick(hit: ReturnType<typeof stageHover>): { x: number; y: number } | null {
    return hit ? { x: hit.x, y: hit.y } : null;
}

test('a colour or value range not in dB is widened to round ends, as a dB range is', () => {
    const view = (values: number[], quantity: StageView['quantity']): StageView => ({ frame: 'SpectralFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity, xs: [0, 1], values: [], matrix: [values] });
    assert.deepEqual(stageRange([view([3.21, 17.4], 'roughness')]), { min: 2, max: 19 });
    assert.deepEqual(stageRange([view([0.13, 0.87], 'value')]), { min: 0.05, max: 0.95 });
    assert.deepEqual(stageDiffRange(view([-0.37, 0.12], 'value')), { min: -0.4, max: 0.4 });
});
