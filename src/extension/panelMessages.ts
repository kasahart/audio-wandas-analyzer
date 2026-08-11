import type {
    RequestReanalyzeMessage,
    UpdateSpectrogramSettingsMessage,
} from '../shared/analysis/analysisTypes';
import {
    isAnalyzeSelectedFilesMessage,
    isExportReportOptionsMessage,
    isExportWavLoopMessage,
    isReleaseTrackDetailMessage,
    isRequestSpectrumSliceMessage,
    isRequestTrackDetailMessage,
    isRequestWaveformRangeMessage,
    isSelectPythonEnvironmentMessage,
    isSelectTargetMessage,
    type AnalyzeSelectedFilesMessage,
    type ExportReportOptionsMessage,
    type ExportWavLoopMessage,
    type SelectPythonEnvironmentMessage,
    type SelectionTargetKind,
    type SpectrumSliceRequest,
    type TrackDetailReleaseMessage,
    type TrackDetailRequest,
    type WaveformRangeRequest,
} from '../shared/utils/audioTarget';

export interface SelectTargetMessage {
    type: 'select-target';
    targetKind: SelectionTargetKind;
}

export interface RunRecipeMessage {
    type: 'run-recipe';
}

export interface ShowInfoMessage {
    type: 'show-info';
    message: string;
}

export type PanelMessage =
    | AnalyzeSelectedFilesMessage
    | SelectPythonEnvironmentMessage
    | SelectTargetMessage
    | RequestReanalyzeMessage
    | UpdateSpectrogramSettingsMessage
    | WaveformRangeRequest
    | TrackDetailRequest
    | TrackDetailReleaseMessage
    | SpectrumSliceRequest
    | ExportWavLoopMessage
    | ExportReportOptionsMessage
    | RunRecipeMessage
    | ShowInfoMessage;

function hasType(value: unknown, type: string): boolean {
    return !!value && typeof value === 'object' && (value as { type?: unknown }).type === type;
}

function isSpectrogramSettings(value: unknown): boolean {
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
        && typeof stftRecord['hopSize'] === 'number'
        && Number.isInteger(stftRecord['hopSize'])
        && ['hann', 'hamming', 'blackman', 'boxcar'].includes(String(stftRecord['window']))
        && nullableNumber(displayRecord['dbMin'])
        && nullableNumber(displayRecord['dbMax'])
        && nullableNumber(displayRecord['maxFrequencyHz']);
}

function isRequestReanalyzeMessage(value: unknown): value is RequestReanalyzeMessage {
    if (!hasType(value, 'request-reanalyze')) { return false; }
    const message = value as Record<string, unknown>;
    return isSpectrogramSettings(message['settings'])
        && (message['reason'] === undefined
            || message['reason'] === 'settings'
            || message['reason'] === 'calibration');
}

function isUpdateSpectrogramSettingsMessage(value: unknown): value is UpdateSpectrogramSettingsMessage {
    return hasType(value, 'update-spectrogram-settings')
        && isSpectrogramSettings((value as Record<string, unknown>)['settings']);
}

export function parsePanelMessage(value: unknown): PanelMessage | undefined {
    if (!value || typeof value !== 'object') { return undefined; }
    const type = (value as { type?: unknown }).type;
    switch (type) {
        case 'analyze-selected-files': return isAnalyzeSelectedFilesMessage(value) ? value : undefined;
        case 'select-python-environment': return isSelectPythonEnvironmentMessage(value) ? value : undefined;
        case 'select-target': return isSelectTargetMessage(value) ? value : undefined;
        case 'request-reanalyze': return isRequestReanalyzeMessage(value) ? value : undefined;
        case 'update-spectrogram-settings':
            return isUpdateSpectrogramSettingsMessage(value) ? value : undefined;
        case 'request-waveform-range': return isRequestWaveformRangeMessage(value) ? value : undefined;
        case 'request-track-detail': return isRequestTrackDetailMessage(value) ? value : undefined;
        case 'release-track-detail': return isReleaseTrackDetailMessage(value) ? value : undefined;
        case 'request-spectrum-slice': return isRequestSpectrumSliceMessage(value) ? value : undefined;
        case 'export-wav-loop': return isExportWavLoopMessage(value) ? value : undefined;
        case 'export-report-options': return isExportReportOptionsMessage(value) ? value : undefined;
        case 'run-recipe': return { type: 'run-recipe' };
        case 'show-info': {
            const message = (value as { message?: unknown }).message;
            return typeof message === 'string' ? { type: 'show-info', message } : undefined;
        }
        default: return undefined;
    }
}
