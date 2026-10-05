import type * as vscode from 'vscode';
import {
    type SpectrogramSettings,
    type StftOptions,
} from '../shared/analysis/analysisTypes';

import { SPECTROGRAM_SETTINGS_KEY, savedSpectrogramSettings } from '../shared/analysis/savedSpectrogramSettings';

export type SpectrogramSettingsContext = Pick<vscode.ExtensionContext, 'workspaceState'>;

export function loadSpectrogramSettings(context: SpectrogramSettingsContext): SpectrogramSettings {
    return savedSpectrogramSettings(context.workspaceState.get(SPECTROGRAM_SETTINGS_KEY));
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
