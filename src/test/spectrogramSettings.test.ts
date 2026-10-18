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
        stft: { nFft: 2048, overlapPercent: 50, window: 'hamming' },
        display: { dbMin: -80, dbMax: 0, maxFrequencyHz: 8000 },
    };
    const restored = JSON.parse(JSON.stringify(s)) as SpectrogramSettings;
    assert.deepEqual(restored, s);
});

test('settings load/save use the same narrow store contract without VSCode or browser globals', async () => {
    const { loadSpectrogramSettings, loadPersistedStftOptions, saveSpectrogramSettings } = await import('../shared/analysis/savedSpectrogramSettings');
    const saved = new Map<string, unknown>();
    const context = { workspaceState: { get: (key: string) => saved.get(key), update: async (key: string, value: unknown) => { saved.set(key, value); } } };
    assert.equal(loadPersistedStftOptions(context), undefined);
    const settings = { ...DEFAULT_SPECTROGRAM_SETTINGS, auto: false, stft: { nFft: 256, overlapPercent: 75, window: 'hann' as const } };
    await saveSpectrogramSettings(context, settings);
    assert.deepEqual(loadPersistedStftOptions(context), settings.stft);
    const restored = loadSpectrogramSettings(context); restored.stft.nFft = 512;
    assert.equal(loadSpectrogramSettings(context).stft.nFft, 256);
});


test('odd FFT sizes are rejected for incoming and persisted settings', async () => {
    const { isSpectrogramSettings, savedSpectrogramSettings } = await import('../shared/analysis/savedSpectrogramSettings');
    for (const nFft of [65, 255, 16383]) {
        const settings = { ...DEFAULT_SPECTROGRAM_SETTINGS, auto: false, stft: { nFft, overlapPercent: 75, window: 'hann' as const } };
        assert.equal(isSpectrogramSettings(settings), false);
        assert.deepEqual(savedSpectrogramSettings(settings), DEFAULT_SPECTROGRAM_SETTINGS);
    }
    const evenSettings = { ...DEFAULT_SPECTROGRAM_SETTINGS, auto: false, stft: { nFft: 254, overlapPercent: 75, window: 'hann' as const } };
    assert.equal(isSpectrogramSettings(evenSettings), true);
    assert.deepEqual(savedSpectrogramSettings(evenSettings), evenSettings);
});

test('an unusable persisted STFT falls back alone and keeps the saved display range', async () => {
    const { savedSpectrogramSettings } = await import('../shared/analysis/savedSpectrogramSettings');
    const display = { dbMin: -90, dbMax: -10, maxFrequencyHz: 8000 };
    const restored = savedSpectrogramSettings({ auto: false, stft: { nFft: 301, overlapPercent: 75, window: 'hann' }, display });
    assert.deepEqual(restored, { auto: true, stft: DEFAULT_SPECTROGRAM_SETTINGS.stft, display });
    const badDisplay = savedSpectrogramSettings({ auto: false, stft: { nFft: 512, overlapPercent: 67, window: 'hann' }, display: { dbMin: 'x' } });
    assert.deepEqual(badDisplay, { auto: false, stft: { nFft: 512, overlapPercent: 67, window: 'hann' }, display: DEFAULT_SPECTROGRAM_SETTINGS.display });
});

test('a nonpositive persisted frequency limit is not salvaged, but panel messages still accept it', async () => {
    const { isSpectrogramSettings, savedSpectrogramSettings } = await import('../shared/analysis/savedSpectrogramSettings');
    for (const maxFrequencyHz of [0, -100]) {
        const stft = { nFft: 301, overlapPercent: 75, window: 'hann' };
        const restored = savedSpectrogramSettings({ auto: false, stft, display: { dbMin: -90, dbMax: -10, maxFrequencyHz } });
        assert.deepEqual(restored, DEFAULT_SPECTROGRAM_SETTINGS);
        const message = { auto: false, stft: { nFft: 512, overlapPercent: 67, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz } };
        assert.equal(isSpectrogramSettings(message), true);
    }
});

test('an overlap outside [0, 100) is rejected, so a saved hop-size STFT falls back to the default', async () => {
    const { isSpectrogramSettings, savedSpectrogramSettings } = await import('../shared/analysis/savedSpectrogramSettings');
    for (const overlapPercent of [-1, 100, Number.NaN]) {
        const settings = { ...DEFAULT_SPECTROGRAM_SETTINGS, auto: false, stft: { nFft: 512, overlapPercent, window: 'hann' as const } };
        assert.equal(isSpectrogramSettings(settings), false);
    }
    const legacy = { auto: false, stft: { nFft: 512, hopSize: 128, window: 'hann' }, display: DEFAULT_SPECTROGRAM_SETTINGS.display };
    assert.deepEqual(savedSpectrogramSettings(legacy), DEFAULT_SPECTROGRAM_SETTINGS);
});
