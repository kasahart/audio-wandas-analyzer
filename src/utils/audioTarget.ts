import * as path from 'path';

export const SUPPORTED_AUDIO_FILE_EXTENSIONS = new Set(['.wav', '.flac', '.ogg', '.aiff', '.aif', '.snd']);

export type SelectionTargetKind = 'file' | 'directory';

export function isSupportedAudioFile(fileName: string): boolean {
    return SUPPORTED_AUDIO_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

export function isAnalyzeFileMessage(message: unknown): message is { type: 'analyze-file'; filePath: string } {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const candidate = message as { type?: unknown; filePath?: unknown };
    return candidate.type === 'analyze-file' && typeof candidate.filePath === 'string' && candidate.filePath.length > 0;
}

export function isSelectTargetMessage(message: unknown): message is { type: 'select-target'; targetKind: SelectionTargetKind } {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const candidate = message as { type?: unknown; targetKind?: unknown };
    return candidate.type === 'select-target' && (candidate.targetKind === 'file' || candidate.targetKind === 'directory');
}