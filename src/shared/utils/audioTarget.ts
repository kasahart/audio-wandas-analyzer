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
