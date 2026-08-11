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

export function parsePanelMessage(value: unknown): PanelMessage | undefined {
    if (!value || typeof value !== 'object') { return undefined; }
    const type = (value as { type?: unknown }).type;
    switch (type) {
        case 'analyze-selected-files': return isAnalyzeSelectedFilesMessage(value) ? value : undefined;
        case 'select-python-environment': return isSelectPythonEnvironmentMessage(value) ? value : undefined;
        case 'select-target': return isSelectTargetMessage(value) ? value : undefined;
        case 'request-reanalyze': return hasType(value, 'request-reanalyze') ? value as RequestReanalyzeMessage : undefined;
        case 'update-spectrogram-settings':
            return hasType(value, 'update-spectrogram-settings') ? value as UpdateSpectrogramSettingsMessage : undefined;
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
