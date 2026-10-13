import { DEFAULT_SPECTROGRAM_SETTINGS, type StftOptions, type SpectrogramSettings } from './analysisTypes';

export const SPECTROGRAM_SETTINGS_KEY = 'audioWandasAnalyzer.spectrogramSettings';

const STFT_WINDOWS: ReadonlyArray<StftOptions['window']> = ['hann', 'hamming', 'blackman', 'boxcar'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNullableFinite(value: unknown): value is number | null {
    return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isStftOptions(value: unknown): value is StftOptions {
    return isRecord(value)
        && isPositiveInteger(value['nFft'])
        && value['nFft'] % 2 === 0
        && isPositiveInteger(value['hopSize'])
        && typeof value['window'] === 'string'
        && STFT_WINDOWS.includes(value['window'] as StftOptions['window']);
}

function isDisplaySettings(value: unknown): value is SpectrogramSettings['display'] {
    return isRecord(value)
        && isNullableFinite(value['dbMin'])
        && isNullableFinite(value['dbMax'])
        && isNullableFinite(value['maxFrequencyHz']);
}

export function isSpectrogramSettings(value: unknown): value is SpectrogramSettings {
    return isRecord(value)
        && typeof value['auto'] === 'boolean'
        && isStftOptions(value['stft'])
        && isDisplaySettings(value['display']);
}

function isUsableStft(value: unknown): value is StftOptions {
    return isStftOptions(value) && value.nFft >= 64 && value.nFft <= 16384 && value.hopSize <= value.nFft;
}

function isUsableDisplay(value: unknown): value is SpectrogramSettings['display'] {
    return isDisplaySettings(value) && (value.maxFrequencyHz === null || value.maxFrequencyHz > 0);
}

export function savedSpectrogramSettings(value: unknown): SpectrogramSettings {
    const record = isRecord(value) ? value : {};
    const stftValid = isUsableStft(record['stft']);
    const stft = stftValid ? record['stft'] as StftOptions : DEFAULT_SPECTROGRAM_SETTINGS.stft;
    const display = isUsableDisplay(record['display']) ? record['display'] : DEFAULT_SPECTROGRAM_SETTINGS.display;
    const auto = stftValid && typeof record['auto'] === 'boolean' ? record['auto'] : DEFAULT_SPECTROGRAM_SETTINGS.auto;
    return { auto, stft: { ...stft }, display: { ...display } };
}

export interface SpectrogramSettingsStore {
    get(key: string): unknown;
    update(key: string, value: unknown): PromiseLike<void>;
}

export interface SpectrogramSettingsContext { workspaceState: SpectrogramSettingsStore }

export function loadSpectrogramSettings(context: SpectrogramSettingsContext): SpectrogramSettings {
    return savedSpectrogramSettings(context.workspaceState.get(SPECTROGRAM_SETTINGS_KEY));
}

export function loadPersistedStftOptions(context: SpectrogramSettingsContext): StftOptions | undefined {
    const settings = loadSpectrogramSettings(context);
    return settings.auto ? undefined : settings.stft;
}

export function saveSpectrogramSettings(context: SpectrogramSettingsContext, settings: SpectrogramSettings): PromiseLike<void> {
    return context.workspaceState.update(SPECTROGRAM_SETTINGS_KEY, settings);
}
