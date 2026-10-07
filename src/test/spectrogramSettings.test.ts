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

test('settings load/save use the same narrow store contract without VSCode or browser globals', async () => {
    const { loadSpectrogramSettings, loadPersistedStftOptions, saveSpectrogramSettings } = await import('../shared/analysis/savedSpectrogramSettings');
    const saved = new Map<string, unknown>();
    const context = { workspaceState: { get: (key: string) => saved.get(key), update: async (key: string, value: unknown) => { saved.set(key, value); } } };
    assert.equal(loadPersistedStftOptions(context), undefined);
    const settings = { ...DEFAULT_SPECTROGRAM_SETTINGS, auto: false, stft: { nFft: 256, hopSize: 64, window: 'hann' as const } };
    await saveSpectrogramSettings(context, settings);
    assert.deepEqual(loadPersistedStftOptions(context), settings.stft);
    const restored = loadSpectrogramSettings(context); restored.stft.nFft = 512;
    assert.equal(loadSpectrogramSettings(context).stft.nFft, 256);
});
