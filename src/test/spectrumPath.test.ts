import assert from 'node:assert/strict';
import test from 'node:test';
import { traceSpectrumPath, type CanvasDrawCtx, type SpectrumPlotFrame } from '../webview/draw/canvasDrawers';
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
