import assert from 'node:assert/strict';
import test from 'node:test';
import { frequencyAxisTicks } from '../webview/draw/canvasDrawers';
import { spectrumLayer } from '../webview/runtime/overlaySpectrumPainter';
import { spectrumSeriesRange } from '../webview/runtime/spectrumRuntime';
import type { SpectrumSlice } from '../webview/runtime/types';

function slice(values: number[], overrides: Partial<SpectrumSlice> = {}): SpectrumSlice {
    return { values, frequencyBins: values.length, maxFrequencyHz: 1000, minDb: -100, maxDb: 0, ...overrides };
}

const layerOf = (values: number[], overrides: Partial<SpectrumSlice> = {}, cutoffHz = 1000) =>
    spectrumLayer({ slice: slice(values, overrides), color: '#fff', index: 0, channelIndex: 0, label: 'A' }, cutoffHz);

test('a cursor spectrum slice becomes a level line over its bins\' frequencies', () => {
    const layer = layerOf([0, -50, -100]);
    const { levelBins, ...view } = layer.view;
    assert.deepEqual(view, { frame: 'spectrum', kind: 'line', x: 'frequency', xScale: 'linear', quantity: 'level', xs: [0, 500, 1000], values: [0, -50, -100] });
    // Ordered among the overlaid slices by every bin's power before it is thinned (R6): the bins above DC.
    assert.equal(levelBins?.count.reduce((sum, n) => sum + n, 0), 2);
    assert.equal(layer.label, 'A');
});

test('a slice cut for display keeps its bins\' frequencies over the original range and stops past the cutoff', () => {
    const layer = layerOf([0, -1, -2, -3, -4], { maxFrequencyHz: 500, originalMaxFrequencyHz: 2000 }, 500);
    assert.deepEqual(layer.view.xs, [0, 500]);
    assert.deepEqual(layer.view.values, [0, -1]);
});

test('spectrumSeriesRange spans every series', () => {
    assert.deepEqual(spectrumSeriesRange([
        { slice: slice([0], { minDb: -80, maxDb: -10, maxFrequencyHz: 8000 }) },
        { slice: slice([0], { minDb: -90, maxDb: -20, maxFrequencyHz: 24_000 }) },
    ]), { minDb: -90, maxDb: -10, maxFrequencyHz: 24_000 });
});

test('octave bands become steps on a log frequency axis, one per band centre', () => {
    const layer = layerOf([-50, 0], { bandsPerOctave: 1, bandCentersHz: [100, 1000], maxFrequencyHz: 10_000 }, 10_000);
    assert.deepEqual([layer.view.kind, layer.view.xScale, layer.view.xs, layer.view.values], ['bar', 'log', [100, 1000], [-50, 0]]);
});

test('octave bands past the display limit are kept, so each band keeps its width (the plot clips them)', () => {
    const layer = layerOf([-50, -40, -30], { bandsPerOctave: 1, bandCentersHz: [31.5, 63, 125], maxFrequencyHz: 50 }, 50);
    assert.deepEqual(layer.view.xs, [31.5, 63, 125]);
});

test('spectrumSeriesRange reports the shared log axis edge of octave-band series', () => {
    const band = slice([0], { bandCentersHz: [1000], bandsPerOctave: 3, minFrequencyHz: 22.39, maxFrequencyHz: 22_387 });
    assert.equal(spectrumSeriesRange([{ slice: band }]).logMinFrequencyHz, 22.39);
    assert.equal(spectrumSeriesRange([{ slice: slice([0]) }]).logMinFrequencyHz, undefined);
    assert.equal(spectrumSeriesRange([{ slice: band }, { slice: slice([0]) }]).logMinFrequencyHz, undefined);
});

test('frequencyAxisTicks labels both edges of a log axis even when no octave centre is in view', () => {
    assert.deepEqual(frequencyAxisTicks({ frequencyMin: 300, frequencyMax: 400, logFrequency: true }).map(tick => tick.text), ['300 Hz', '400 Hz']);
    assert.deepEqual(frequencyAxisTicks({ frequencyMin: 100, frequencyMax: 1000, logFrequency: true }).map(tick => tick.text),
        ['100 Hz', '125', '250', '500', '1.0 kHz']);
});
