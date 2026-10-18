import assert from 'node:assert/strict';
import test from 'node:test';
import { frequencyAxisTicks, traceSpectrumPath, type CanvasDrawCtx, type SpectrumPlotFrame } from '../webview/draw/canvasDrawers';
import { spectrumSeriesRange } from '../webview/runtime/spectrumRuntime';
import type { SpectrumSlice } from '../webview/runtime/types';

const FRAME: SpectrumPlotFrame = {
    padLeft: 10, plotWidth: 100, padTop: 5, plotHeight: 100,
    frequencyMin: 0, frequencyMax: 1000, dbMin: -100, dbMax: 0,
};

function recordingCtx() {
    const calls: Array<[string, number, number]> = [];
    const ctx = {
        moveTo: (x: number, y: number) => calls.push(['moveTo', x, y]),
        lineTo: (x: number, y: number) => calls.push(['lineTo', x, y]),
    } as unknown as CanvasDrawCtx;
    return { ctx, calls };
}

function slice(values: number[], overrides: Partial<SpectrumSlice> = {}): SpectrumSlice {
    return { values, frequencyBins: values.length, maxFrequencyHz: 1000, minDb: -100, maxDb: 0, ...overrides };
}

test('traceSpectrumPath maps each bin into the plot frame', () => {
    const { ctx, calls } = recordingCtx();
    traceSpectrumPath(ctx, slice([0, -50, -100]), FRAME, 1000);
    assert.deepEqual(calls, [['moveTo', 10, 5], ['lineTo', 60, 55], ['lineTo', 110, 105]]);
});

test('traceSpectrumPath spaces bins over the original range and stops past the cutoff', () => {
    const { ctx, calls } = recordingCtx();
    traceSpectrumPath(ctx, slice([0, 0, 0, 0, 0], { maxFrequencyHz: 500, originalMaxFrequencyHz: 2000 }), FRAME, 500);
    assert.deepEqual(calls.map(([op, x]) => [op, x]), [['moveTo', 10], ['lineTo', 60]]);
});

test('spectrumSeriesRange spans every series', () => {
    assert.deepEqual(spectrumSeriesRange([
        { slice: slice([0], { minDb: -80, maxDb: -10, maxFrequencyHz: 8000 }) },
        { slice: slice([0], { minDb: -90, maxDb: -20, maxFrequencyHz: 24_000 }) },
    ]), { minDb: -90, maxDb: -10, maxFrequencyHz: 24_000 });
});

const LOG_FRAME: SpectrumPlotFrame = {
    padLeft: 0, plotWidth: 100, padTop: 0, plotHeight: 100,
    frequencyMin: 10, frequencyMax: 10_000, logFrequency: true, dbMin: -100, dbMax: 0,
};

test('traceSpectrumPath draws octave bands as steps between the band edges on a log axis', () => {
    const { ctx, calls } = recordingCtx();
    // 100 Hz and 1 kHz sit a third and two thirds of the way along 10 Hz - 10 kHz.
    traceSpectrumPath(ctx, slice([-50, 0], { bandsPerOctave: 1, bandCentersHz: [100, 1000], maxFrequencyHz: 10_000 }), LOG_FRAME, 10_000);
    const round = (v: number) => Math.round(v * 100) / 100;
    assert.deepEqual(calls.map(([op, x, y]) => [op, round(x), y]), [
        ['moveTo', round(100 * Math.log10(10 / Math.SQRT2) / 3), 50],
        ['lineTo', 50, 50],
        ['lineTo', 50, 0],
        ['lineTo', round(100 * Math.log10(100 * Math.SQRT2) / 3), 0],
    ]);
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
