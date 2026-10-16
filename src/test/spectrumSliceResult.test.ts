import assert from 'node:assert/strict';
import test from 'node:test';
import { spectrumSlicesFromResult, type SpectrumSliceResultMessage } from '../webview/runtime/spectrumRuntime';

test('spectrumSlicesFromResult builds one cache slice per channel with the shared bin layout', () => {
    const msg: SpectrumSliceResultMessage = {
        type: 'spectrum-slice-result',
        requestId: 'r1',
        analysisId: 'a1',
        settingsSignature: 'sig',
        trackIndex: 0,
        filePath: '/a.wav',
        frequencyBins: 2,
        maxFrequencyHz: 24_000,
        windowStartNorm: 0.2,
        windowEndNorm: 0.3,
        window: 'hann',
        channels: [
            { channelIndex: 0, values: [-10, -20], minDb: -90, maxDb: 0 },
            { channelIndex: 1, values: [1, 2], minDb: 0, maxDb: 100, unit: 'Pa', axisLabel: 'SPL' },
        ],
    };

    assert.deepEqual(spectrumSlicesFromResult(msg, 0.25), [
        {
            settingsSignature: 'sig', cursorNorm: 0.25, channelIndex: 0, values: [-10, -20],
            frequencyBins: 2, originalMaxFrequencyHz: 24_000, maxFrequencyHz: 24_000,
            minDb: -90, maxDb: 0, unit: undefined, axisLabel: undefined,
            windowStartNorm: 0.2, windowEndNorm: 0.3, window: 'hann',
        },
        {
            settingsSignature: 'sig', cursorNorm: 0.25, channelIndex: 1, values: [1, 2],
            frequencyBins: 2, originalMaxFrequencyHz: 24_000, maxFrequencyHz: 24_000,
            minDb: 0, maxDb: 100, unit: 'Pa', axisLabel: 'SPL',
            windowStartNorm: 0.2, windowEndNorm: 0.3, window: 'hann',
        },
    ]);
});
