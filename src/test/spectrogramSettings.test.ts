import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_SPECTROGRAM_SETTINGS,
    type SpectrogramSettings,
} from '../shared/analysis/analysisTypes';

test('default settings are auto', () => {
    assert.equal(DEFAULT_SPECTROGRAM_SETTINGS.auto, true);
    assert.equal(DEFAULT_SPECTROGRAM_SETTINGS.stft.nFft, 1024);
});

test('round-trip via JSON', () => {
    const s: SpectrogramSettings = {
        auto: false,
        stft: { nFft: 2048, hopSize: 512, window: 'hamming' },
        display: { dbMin: -80, dbMax: 0, maxFrequencyHz: 8000 },
    };
    const restored = JSON.parse(JSON.stringify(s)) as SpectrogramSettings;
    assert.deepEqual(restored, s);
});
