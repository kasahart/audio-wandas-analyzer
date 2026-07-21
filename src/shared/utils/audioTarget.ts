import * as path from 'path';

export const SUPPORTED_AUDIO_FILE_EXTENSIONS = new Set(['.wav', '.flac', '.ogg', '.aiff', '.aif', '.snd']);

export type SelectionTargetKind = 'file' | 'directory';

export function isSupportedAudioFile(fileName: string): boolean {
    return SUPPORTED_AUDIO_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function isSelectTargetMessage(message: unknown): message is { type: 'select-target'; targetKind: SelectionTargetKind } {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const candidate = message as { type?: unknown; targetKind?: unknown };
    return candidate.type === 'select-target' && (candidate.targetKind === 'file' || candidate.targetKind === 'directory');
}

export interface SelectPythonEnvironmentMessage {
    type: 'select-python-environment';
}

export function isSelectPythonEnvironmentMessage(message: unknown): message is SelectPythonEnvironmentMessage {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const candidate = message as { type?: unknown };
    return candidate.type === 'select-python-environment';
}

export interface AnalyzeSelectedFilesMessage {
    type: 'analyze-selected-files';
    requestId: string;
    filePaths: string[];
}

export function isAnalyzeSelectedFilesMessage(message: unknown): message is AnalyzeSelectedFilesMessage {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const candidate = message as { type?: unknown; requestId?: unknown; filePaths?: unknown };
    return candidate.type === 'analyze-selected-files'
        && typeof candidate.requestId === 'string'
        && Array.isArray(candidate.filePaths)
        && candidate.filePaths.every((filePath) => typeof filePath === 'string');
}

export interface WaveformRangeRequest {
    type: 'request-waveform-range';
    requestId: string;
    trackIndex: number;
    filePath: string;
    startNorm: number;
    endNorm: number;
    points: number;
}

export function isRequestWaveformRangeMessage(message: unknown): message is WaveformRangeRequest {
    if (!message || typeof message !== 'object') {
        return false;
    }
    const m = message as Record<string, unknown>;
    return (
        m['type'] === 'request-waveform-range' &&
        typeof m['requestId'] === 'string' &&
        typeof m['trackIndex'] === 'number' &&
        typeof m['filePath'] === 'string' && (m['filePath'] as string).length > 0 &&
        typeof m['startNorm'] === 'number' &&
        typeof m['endNorm'] === 'number' &&
        typeof m['points'] === 'number'
    );
}

export interface TrackDetailRequest {
    type: 'request-track-detail';
    requestId: string;
    analysisId: string;
    settingsSignature: string;
    trackIndex: number;
    filePath: string;
    stftOptions: import('../analysis/analysisTypes').StftOptions | null;
}

export function isRequestTrackDetailMessage(message: unknown): message is TrackDetailRequest {
    if (!message || typeof message !== 'object') {
        return false;
    }
    const m = message as Record<string, unknown>;
    return (
        m['type'] === 'request-track-detail' &&
        typeof m['requestId'] === 'string' &&
        typeof m['analysisId'] === 'string' &&
        typeof m['settingsSignature'] === 'string' &&
        typeof m['trackIndex'] === 'number' &&
        typeof m['filePath'] === 'string' && (m['filePath'] as string).length > 0 &&
        isStftOptionsOrNull(m['stftOptions'])
    );
}

export interface SpectrumSliceRequest {
    type: 'request-spectrum-slice';
    requestId: string;
    analysisId: string;
    settingsSignature: string;
    trackIndex: number;
    filePath: string;
    cursorNorm: number;
    channelIndex: number;
    stftOptions: import('../analysis/analysisTypes').StftOptions | null;
}

export function isRequestSpectrumSliceMessage(message: unknown): message is SpectrumSliceRequest {
    if (!message || typeof message !== 'object') {
        return false;
    }
    const m = message as Record<string, unknown>;
    return (
        m['type'] === 'request-spectrum-slice' &&
        typeof m['requestId'] === 'string' &&
        typeof m['analysisId'] === 'string' &&
        typeof m['settingsSignature'] === 'string' &&
        typeof m['trackIndex'] === 'number' &&
        typeof m['filePath'] === 'string' && (m['filePath'] as string).length > 0 &&
        typeof m['cursorNorm'] === 'number' &&
        typeof m['channelIndex'] === 'number' &&
        isStftOptionsOrNull(m['stftOptions'])
    );
}

function isStftOptionsOrNull(value: unknown): boolean {
    if (value === null) { return true; }
    if (!value || typeof value !== 'object') { return false; }
    const options = value as Record<string, unknown>;
    return Number.isInteger(options['nFft']) && Number(options['nFft']) > 0 &&
        Number.isInteger(options['hopSize']) && Number(options['hopSize']) > 0 &&
        Number(options['hopSize']) <= Number(options['nFft']) &&
        ['hann', 'hamming', 'blackman', 'boxcar'].includes(String(options['window']));
}

export interface TrackDetailReleaseMessage {
    type: 'release-track-detail';
    analysisId: string;
    settingsSignature: string;
    trackIndex: number;
    filePath: string;
}

export function isReleaseTrackDetailMessage(message: unknown): message is TrackDetailReleaseMessage {
    if (!message || typeof message !== 'object') {
        return false;
    }
    const m = message as Record<string, unknown>;
    return (
        m['type'] === 'release-track-detail' &&
        typeof m['analysisId'] === 'string' &&
        typeof m['settingsSignature'] === 'string' &&
        typeof m['trackIndex'] === 'number' &&
        typeof m['filePath'] === 'string' && (m['filePath'] as string).length > 0
    );
}

export interface ExportWavLoopMessage {
    type: 'export-wav-loop';
    filePaths: string[];
    startNorm: number;
    endNorm: number;
}

export function isExportWavLoopMessage(message: unknown): message is ExportWavLoopMessage {
    if (!message || typeof message !== 'object') { return false; }
    const m = message as Record<string, unknown>;
    return (
        m['type'] === 'export-wav-loop' &&
        Array.isArray(m['filePaths']) &&
        (m['filePaths'] as unknown[]).every((p) => typeof p === 'string') &&
        typeof m['startNorm'] === 'number' &&
        typeof m['endNorm'] === 'number'
    );
}

export interface ExportReportOptionsMessage {
    type: 'export-report-options';
    defaultName: string;
    markdownContent: string;
    notebookContent: string;
}

export function isExportReportOptionsMessage(message: unknown): message is ExportReportOptionsMessage {
    if (!message || typeof message !== 'object') { return false; }
    const m = message as Record<string, unknown>;
    return (
        m['type'] === 'export-report-options' &&
        typeof m['defaultName'] === 'string' &&
        typeof m['markdownContent'] === 'string' &&
        typeof m['notebookContent'] === 'string'
    );
}
