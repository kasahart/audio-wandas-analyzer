import type * as vscode from 'vscode';
import {
    DEFAULT_SPECTROGRAM_SETTINGS,
    type SpectrogramSettings,
    type StftOptions,
} from '../shared/analysis/analysisTypes';

const SPECTROGRAM_SETTINGS_KEY = 'audioWandasAnalyzer.spectrogramSettings';

export type SpectrogramSettingsContext = Pick<vscode.ExtensionContext, 'workspaceState'>;

export function loadSpectrogramSettings(context: SpectrogramSettingsContext): SpectrogramSettings {
    return context.workspaceState.get<SpectrogramSettings>(SPECTROGRAM_SETTINGS_KEY)
        ?? DEFAULT_SPECTROGRAM_SETTINGS;
}

export function loadPersistedStftOptions(context: SpectrogramSettingsContext): StftOptions | undefined {
    const settings = loadSpectrogramSettings(context);
    return settings.auto ? undefined : settings.stft;
}

export function saveSpectrogramSettings(
    context: SpectrogramSettingsContext,
    settings: SpectrogramSettings,
): Thenable<void> {
    return context.workspaceState.update(SPECTROGRAM_SETTINGS_KEY, settings);
}
