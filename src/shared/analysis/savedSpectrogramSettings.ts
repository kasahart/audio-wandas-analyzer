import { DEFAULT_SPECTROGRAM_SETTINGS, type SpectrogramSettings } from './analysisTypes';

export const SPECTROGRAM_SETTINGS_KEY = 'audioWandasAnalyzer.spectrogramSettings';

export function isSpectrogramSettings(value: unknown): value is SpectrogramSettings {
    if (!value || typeof value !== 'object') { return false; }
    const settings = value as Record<string, unknown>;
    const stft = settings['stft'];
    const display = settings['display'];
    if (typeof settings['auto'] !== 'boolean'
        || !stft || typeof stft !== 'object'
        || !display || typeof display !== 'object') {
        return false;
    }
    const stftRecord = stft as Record<string, unknown>;
    const displayRecord = display as Record<string, unknown>;
    const nullableNumber = (candidate: unknown): boolean => candidate === null
        || (typeof candidate === 'number' && Number.isFinite(candidate));
    return typeof stftRecord['nFft'] === 'number'
        && Number.isInteger(stftRecord['nFft'])
        && stftRecord['nFft'] > 0
        && typeof stftRecord['hopSize'] === 'number'
        && Number.isInteger(stftRecord['hopSize'])
        && stftRecord['hopSize'] > 0
        && typeof stftRecord['window'] === 'string'
        && ['hann', 'hamming', 'blackman', 'boxcar'].includes(stftRecord['window'])
        && nullableNumber(displayRecord['dbMin'])
        && nullableNumber(displayRecord['dbMax'])
        && nullableNumber(displayRecord['maxFrequencyHz']);
}

export function savedSpectrogramSettings(value: unknown): SpectrogramSettings {
    if (!isSpectrogramSettings(value) || value.stft.nFft < 64 || value.stft.nFft > 16384 || value.stft.hopSize > value.stft.nFft) {
        return { ...DEFAULT_SPECTROGRAM_SETTINGS, stft: { ...DEFAULT_SPECTROGRAM_SETTINGS.stft }, display: { ...DEFAULT_SPECTROGRAM_SETTINGS.display } };
    }
    return { auto: value.auto, stft: { ...value.stft }, display: { ...value.display } };
}
