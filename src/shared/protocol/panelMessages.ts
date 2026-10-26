import { isSpectrogramSettings } from '../analysis/savedSpectrogramSettings';
import { isRecipeChain } from '../recipe/recipeSteps';
import { isEntryConditionTable, isEntryRegion, type CompareScanMessage, type EntrySaveConditionsMessage, type EntryScanCancelMessage, type EntryScanMessage, type SaveReportFolderMessage } from '../analysis/entryScan';
import type { BuildRecipePayload } from './backendProtocol';
import { schemaViolation } from './schemaValidation';
import type {
    ComparisonPanelReadyMessage,
    RequestReanalyzeMessage,
    UpdateSpectrogramSettingsMessage,
} from '../analysis/analysisTypes';
import {
    isAnalyzeSelectedFilesMessage,
    isExportReportOptionsMessage,
    isExportWavLoopMessage,
    isReleaseTrackDetailMessage,
    isRequestPairSpectrumMessage,
    isRequestSpectrumSliceMessage,
    isRequestTrackDetailMessage,
    isRequestWaveformRangeMessage,
    isSelectPythonEnvironmentMessage,
    isSelectTargetMessage,
    type AnalyzeSelectedFilesMessage,
    type ExportReportOptionsMessage,
    type ExportWavLoopMessage,
    type PairSpectrumRequest,
    type SelectPythonEnvironmentMessage,
    type SelectionTargetKind,
    type SpectrumSliceRequest,
    type TrackDetailReleaseMessage,
    type TrackDetailRequest,
    type WaveformRangeRequest,
} from '../utils/audioTarget';

export interface SelectTargetMessage {
    type: 'select-target';
    targetKind: SelectionTargetKind;
}

export interface RunRecipeMessage {
    type: 'run-recipe';
}

/** The bottom panel's analysis to save as a wandas Recipe; the host adds the STFT settings. */
export type SaveRecipeMessage = { type: 'save-recipe' } & Omit<BuildRecipePayload, 'stftOptions'>;

export interface ShowInfoMessage {
    type: 'show-info';
    message: string;
}

export type PanelMessage =
    | AnalyzeSelectedFilesMessage
    | SelectPythonEnvironmentMessage
    | SelectTargetMessage
    | ComparisonPanelReadyMessage
    | RequestReanalyzeMessage
    | UpdateSpectrogramSettingsMessage
    | WaveformRangeRequest
    | TrackDetailRequest
    | TrackDetailReleaseMessage
    | SpectrumSliceRequest
    | PairSpectrumRequest
    | ExportWavLoopMessage
    | ExportReportOptionsMessage
    | RunRecipeMessage
    | SaveRecipeMessage
    | ShowInfoMessage
    | EntryScanMessage
    | EntryScanCancelMessage
    | EntrySaveConditionsMessage
    | CompareScanMessage
    | SaveReportFolderMessage;

function hasType(value: unknown, type: string): boolean {
    return !!value && typeof value === 'object' && (value as { type?: unknown }).type === type;
}

function isRequestReanalyzeMessage(value: unknown): value is RequestReanalyzeMessage {
    if (!hasType(value, 'request-reanalyze')) { return false; }
    const message = value as Record<string, unknown>;
    return isSpectrogramSettings(message['settings']) && message['reason'] === undefined;
}

function isComparisonPanelReadyMessage(value: unknown): value is ComparisonPanelReadyMessage {
    if (!hasType(value, 'comparison-panel-ready')) { return false; }
    const message = value as Record<string, unknown>;
    return Array.isArray(message['calibrationRevisions'])
        && message['calibrationRevisions'].every((entry) => {
            if (!entry || typeof entry !== 'object') { return false; }
            const revision = entry as Record<string, unknown>;
            return typeof revision['filePath'] === 'string'
                && revision['filePath'].length > 0
                && typeof revision['analysisRevision'] === 'number'
                && Number.isInteger(revision['analysisRevision'])
                && revision['analysisRevision'] >= 0;
        });
}

function isUpdateSpectrogramSettingsMessage(value: unknown): value is UpdateSpectrogramSettingsMessage {
    return hasType(value, 'update-spectrogram-settings')
        && isSpectrogramSettings((value as Record<string, unknown>)['settings']);
}

function isSaveRecipeMessage(value: unknown): value is SaveRecipeMessage {
    if (!hasType(value, 'save-recipe')) { return false; }
    const { type: _type, ...analysis } = value as Record<string, unknown>;
    return analysis['stftOptions'] === undefined && schemaViolation('BuildRecipePayload', analysis) === null;
}

function isEntryScanMessage(value: unknown): value is EntryScanMessage {
    if (!hasType(value, 'entry-scan')) { return false; }
    const message = value as Record<string, unknown>;
    return typeof message['requestId'] === 'string' && Array.isArray(message['filePaths'])
        && message['filePaths'].every(filePath => typeof filePath === 'string' && filePath.length > 0)
        && (message['rootPath'] === undefined || typeof message['rootPath'] === 'string')
        && (message['recipe'] === undefined || isRecipeChain(message['recipe']));
}

function isCompareScanMessage(value: unknown): value is CompareScanMessage {
    if (!hasType(value, 'compare-scan')) { return false; }
    const message = value as Record<string, unknown>;
    return typeof message['requestId'] === 'string' && (message['region'] === undefined || isEntryRegion(message['region'])) && Array.isArray(message['filePaths'])
        && (message['recipe'] === undefined || isRecipeChain(message['recipe']))
        && (message['stage'] === undefined || typeof message['stage'] === 'string')
        && message['filePaths'].every(filePath => typeof filePath === 'string' && filePath.length > 0);
}

const SAFE_NAME = /^[^\\/:*?"<>|\u0000-\u001f]+$/u;

function isSaveReportFolderMessage(value: unknown): value is SaveReportFolderMessage {
    if (!hasType(value, 'save-report-folder')) { return false; }
    const message = value as Record<string, unknown>;
    return typeof message['folder'] === 'string' && SAFE_NAME.test(message['folder']) && Array.isArray(message['files'])
        && message['files'].length > 0 && message['files'].length <= 16
        && message['files'].every(file => !!file && typeof file === 'object'
            && typeof (file as Record<string, unknown>)['name'] === 'string' && SAFE_NAME.test((file as Record<string, string>)['name'])
            && (typeof (file as Record<string, unknown>)['base64'] === 'string') !== (typeof (file as Record<string, unknown>)['text'] === 'string'));
}

function isEntrySaveConditionsMessage(value: unknown): value is EntrySaveConditionsMessage {
    if (!hasType(value, 'entry-save-conditions')) { return false; }
    const table = (value as Record<string, unknown>)['table'];
    return table === null || isEntryConditionTable(table);
}

export function parsePanelMessage(value: unknown): PanelMessage | undefined {
    if (!value || typeof value !== 'object') { return undefined; }
    const type = (value as { type?: unknown }).type;
    switch (type) {
        case 'analyze-selected-files': return isAnalyzeSelectedFilesMessage(value) ? value : undefined;
        case 'select-python-environment': return isSelectPythonEnvironmentMessage(value) ? value : undefined;
        case 'select-target': return isSelectTargetMessage(value) ? value : undefined;
        case 'comparison-panel-ready':
            return isComparisonPanelReadyMessage(value) ? value : undefined;
        case 'request-reanalyze': return isRequestReanalyzeMessage(value) ? value : undefined;
        case 'update-spectrogram-settings':
            return isUpdateSpectrogramSettingsMessage(value) ? value : undefined;
        case 'request-waveform-range': return isRequestWaveformRangeMessage(value) ? value : undefined;
        case 'request-track-detail': return isRequestTrackDetailMessage(value) ? value : undefined;
        case 'release-track-detail': return isReleaseTrackDetailMessage(value) ? value : undefined;
        case 'request-spectrum-slice': return isRequestSpectrumSliceMessage(value) ? value : undefined;
        case 'request-pair-spectrum': return isRequestPairSpectrumMessage(value) ? value : undefined;
        case 'export-wav-loop': return isExportWavLoopMessage(value) ? value : undefined;
        case 'export-report-options': return isExportReportOptionsMessage(value) ? value : undefined;
        case 'run-recipe': return { type: 'run-recipe' };
        case 'save-recipe': return isSaveRecipeMessage(value) ? value : undefined;
        case 'entry-scan': return isEntryScanMessage(value) ? value : undefined;
        case 'entry-scan-cancel': return { type: 'entry-scan-cancel' };
        case 'entry-save-conditions': return isEntrySaveConditionsMessage(value) ? value : undefined;
        case 'compare-scan': return isCompareScanMessage(value) ? value : undefined;
        case 'save-report-folder': return isSaveReportFolderMessage(value) ? value : undefined;
        case 'show-info': {
            const message = (value as { message?: unknown }).message;
            return typeof message === 'string' ? { type: 'show-info', message } : undefined;
        }
        default: return undefined;
    }
}
