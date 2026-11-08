import assert from 'node:assert/strict';
import test from 'node:test';
import { binFrequencyHz, nearestBinIndex } from '../webview/draw/canvasDrawers';
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

test('a row cut for display keeps the frequency of each point for drawing and hover snapping', () => {
    const msg: SpectrumSliceResultMessage = {
        type: 'spectrum-slice-result', requestId: 'r1', analysisId: 'a1', settingsSignature: 'sig', trackIndex: 0, filePath: '/a.wav',
        frequencyBins: 4, maxFrequencyHz: 6000, frequenciesHz: [0, 1.46484375, 80.56640625, 5000],
        channels: [{ channelIndex: 0, values: [-90, -80, 2.2, -70], minDb: -90, maxDb: 2.2 }],
    };
    const [slice] = spectrumSlicesFromResult(msg, 0.5);
    assert.deepEqual(slice.frequenciesHz, [0, 1.46484375, 80.56640625, 5000]);
    assert.equal(binFrequencyHz(slice, 2), 80.56640625);
    assert.equal(nearestBinIndex(slice, 79), 2);
    assert.equal(nearestBinIndex(slice, 3000), 3);
    assert.equal(nearestBinIndex(slice, 0.5), 0);
});

