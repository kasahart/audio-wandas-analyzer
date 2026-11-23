/** Mirrors `wandas.supported_formats()` of the pinned wandas; test_typescript_extension_list_matches_wandas in python-backend/test_browser_service.py keeps them equal. */
export const SUPPORTED_AUDIO_FILE_EXTENSIONS = new Set(['.wav', '.flac', '.ogg', '.oga', '.opus', '.mp3', '.aiff', '.aif', '.au', '.snd', '.caf', '.rf64', '.w64', '.csv']);
/** The same extensions without the leading dot, as VS Code open-dialog filters expect. */
export const SUPPORTED_AUDIO_DIALOG_EXTENSIONS = Array.from(SUPPORTED_AUDIO_FILE_EXTENSIONS, extension => extension.slice(1));

export type SelectionTargetKind = 'file' | 'directory';

function extensionOf(fileName: string): string {
    const leaf = fileName.split(/[\\/]/).pop() ?? '';
    const dot = leaf.lastIndexOf('.');
    return dot > 0 ? leaf.slice(dot).toLowerCase() : '';
}

export function isSupportedAudioFile(fileName: string): boolean {
    return SUPPORTED_AUDIO_FILE_EXTENSIONS.has(extensionOf(fileName));
}

/** Chromium has no AIFF, AU, CAF, W64 or RF64 decoder and CSV holds samples rather than encoded audio, so the webview plays only these. */
const PLAYABLE_AUDIO_FILE_EXTENSIONS = new Set(['.wav', '.flac', '.ogg', '.oga', '.opus', '.mp3']);

export function hasPlayableAudio(fileName: string): boolean {
    return PLAYABLE_AUDIO_FILE_EXTENSIONS.has(extensionOf(fileName));
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
    /** Sent by the panel's Clear, so a host can tell it from unchecking the last file. */
    clearAll?: true;
}

export function isAnalyzeSelectedFilesMessage(message: unknown): message is AnalyzeSelectedFilesMessage {
    if (!message || typeof message !== 'object') {
        return false;
    }

    const candidate = message as { type?: unknown; requestId?: unknown; filePaths?: unknown; clearAll?: unknown };
    return candidate.type === 'analyze-selected-files'
        && typeof candidate.requestId === 'string'
        && (candidate.clearAll === undefined || candidate.clearAll === true)
        && Array.isArray(candidate.filePaths)
        && candidate.filePaths.every((filePath) => typeof filePath === 'string');
}

export interface TrackDetailRequest {
    type: 'request-track-detail';
    requestId: string;
    analysisId: string;
    settingsSignature: string;
    trackIndex: number;
    filePath: string;
    /**
     * The version of the file the asking track was drawn from (its analysis's sourceVersion). The backend refuses a
     * file changed since (stale-source), so an answer is never of another version than the picture it is drawn over.
     * Named by every request (undefined only for a host that gives no version).
     */
    sourceVersion: string | undefined;
    /** The time on screen (fractions of the file): the automatic settings give that window its own STFT (R3). Absent for the whole file. */
    startNorm?: number;
    endNorm?: number;
    /**
     * The row's answers are kept by key for the figure service (the backend's `track-answers`): the reply
     * (`track-answers-result`) names each channel's kept samples and kept STFT levels and carries no value of them.
     * The word is how the spectrogram's frequency axis is drawn, which the kept levels are of.
     */
    answers: 'log' | 'linear';
    /** With `answers`, false: the samples alone (the row shows no spectrogram). */
    spectrogram?: boolean;
    /**
     * True: the whole file's extents alone (each channel's `signalExtent` and `imageExtent`), for a recording that
     * takes part in the rows' linked scale and is not on screen: its samples and levels are not kept.
     */
    extents?: boolean;
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
        typeof m['filePath'] === 'string' && m['filePath'].length > 0 &&
        (m['startNorm'] === undefined && m['endNorm'] === undefined
            || typeof m['startNorm'] === 'number' && typeof m['endNorm'] === 'number' && m['startNorm'] < m['endNorm']) &&
        (m['sourceVersion'] === undefined || typeof m['sourceVersion'] === 'string') &&
        (m['answers'] === 'log' || m['answers'] === 'linear') &&
        (m['spectrogram'] === undefined || typeof m['spectrogram'] === 'boolean') &&
        (m['extents'] === undefined || typeof m['extents'] === 'boolean')
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
    /**
     * The version of the file the asking track was drawn from (its analysis's sourceVersion). The backend refuses a
     * file changed since (stale-source), so an answer is never of another version than the picture it is drawn over.
     * Named by every request (undefined only for a host that gives no version).
     */
    sourceVersion: string | undefined;
    /** Absent for the FFT spectrum. */
    bandsPerOctave?: SpectrumBandsPerOctave;
    /**
     * The answers are kept by key for the figure service (the backend's `cursor-answers`): the reply
     * (`cursor-answers-result`) names each channel's kept line and carries no value of it. The word is how the
     * frequency axis is drawn, which the kept line is of.
     */
    answers: 'log' | 'linear';
}

export type SpectrumBandsPerOctave = 1 | 3;

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
        typeof m['filePath'] === 'string' && m['filePath'].length > 0 &&
        typeof m['cursorNorm'] === 'number' &&
        (m['bandsPerOctave'] === undefined || m['bandsPerOctave'] === 1 || m['bandsPerOctave'] === 3) &&
        (m['sourceVersion'] === undefined || typeof m['sourceVersion'] === 'string') &&
        (m['answers'] === 'log' || m['answers'] === 'linear')
    );
}

/** One channel at its place on the shared timeline. */
export interface PairSourceRef {
    filePath: string;
    channelIndex: number;
    offsetSeconds: number;
    /**
     * The version of the file the asking track was drawn from (its analysis's sourceVersion). The backend refuses a
     * file changed since (stale-source), so an answer is never of another version than the picture it is drawn over.
     * Named by every request (undefined only for a host that gives no version).
     */
    sourceVersion: string | undefined;
}

export interface PairSpectrumRequest {
    type: 'request-pair-spectrum';
    requestId: string;
    analysisId: string;
    settingsSignature: string;
    reference: PairSourceRef;
    responses: PairSourceRef[];
    /** Global seconds; absent bounds average the whole overlap. */
    startSeconds?: number;
    endSeconds?: number;
    /**
     * The answers are kept by key for the figure service (the backend's `pair-answers`): the reply
     * (`pair-answers-result`) names each response's three kept lines and carries no value of them. The word is how
     * the frequency axis is drawn, which the kept lines are of.
     */
    answers: 'log' | 'linear';
}

function isPairSourceRef(value: unknown): value is PairSourceRef {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const m = value as Record<string, unknown>;
    return typeof m['filePath'] === 'string' && m['filePath'].length > 0
        && Number.isInteger(m['channelIndex']) && (m['channelIndex'] as number) >= 0
        && typeof m['offsetSeconds'] === 'number' && Number.isFinite(m['offsetSeconds'])
        && (m['sourceVersion'] === undefined || typeof m['sourceVersion'] === 'string');
}

function isOptionalFinite(value: unknown): boolean {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

export function isRequestPairSpectrumMessage(message: unknown): message is PairSpectrumRequest {
    if (!message || typeof message !== 'object') {
        return false;
    }
    const m = message as Record<string, unknown>;
    return (
        m['type'] === 'request-pair-spectrum' &&
        typeof m['requestId'] === 'string' &&
        typeof m['analysisId'] === 'string' &&
        typeof m['settingsSignature'] === 'string' &&
        isPairSourceRef(m['reference']) &&
        Array.isArray(m['responses']) && m['responses'].every(isPairSourceRef) &&
        isOptionalFinite(m['startSeconds']) && isOptionalFinite(m['endSeconds']) &&
        (m['answers'] === 'log' || m['answers'] === 'linear')
    );
}

/** One recording's channels and the stretch of it (the file's 0..1) a region's peak is taken over. */
export interface RegionPeakSourceRef {
    filePath: string;
    /** The channels (from 0); none names every channel of the recording. */
    channels: number[];
    startNorm: number;
    endNorm: number;
    /** The version of the file the asking track was drawn from (PairSourceRef.sourceVersion). */
    sourceVersion: string | undefined;
}

/**
 * The largest |sample| of these recordings' channels over their stretches, from every sample: one answer of the
 * backend's (AnalysisService.region_peak), where a new trigger's level starts.
 */
export interface RegionPeakRequest {
    type: 'request-region-peak';
    requestId: string;
    sources: RegionPeakSourceRef[];
}

export function isRequestRegionPeakMessage(message: unknown): message is RegionPeakRequest {
    if (!message || typeof message !== 'object') return false;
    const m = message as Record<string, unknown>;
    const source = (value: unknown): boolean => {
        if (!value || typeof value !== 'object') return false;
        const of = value as Record<string, unknown>;
        return typeof of['filePath'] === 'string' && of['filePath'].length > 0
            && Array.isArray(of['channels']) && of['channels'].every(channel => Number.isInteger(channel) && (channel as number) >= 0)
            && typeof of['startNorm'] === 'number' && Number.isFinite(of['startNorm']) && typeof of['endNorm'] === 'number' && Number.isFinite(of['endNorm'])
            && (of['sourceVersion'] === undefined || typeof of['sourceVersion'] === 'string');
    };
    return m['type'] === 'request-region-peak' && typeof m['requestId'] === 'string' && m['requestId'].length > 0
        && Array.isArray(m['sources']) && m['sources'].length > 0 && m['sources'].every(source);
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
        typeof m['filePath'] === 'string' && m['filePath'].length > 0
    );
}

export interface ConfigureCalibrationChannel {
    channelIndex: number;
    label: string;
}

export interface ConfigureCalibrationMessage {
    type: 'configure-calibration';
    trackIndex: number;
    filePath: string;
    channels: ConfigureCalibrationChannel[];
}

export function isConfigureCalibrationMessage(message: unknown): message is ConfigureCalibrationMessage {
    if (!message || typeof message !== 'object') {
        return false;
    }
    const candidate = message as Record<string, unknown>;
    return candidate['type'] === 'configure-calibration'
        && Number.isInteger(candidate['trackIndex'])
        && (candidate['trackIndex'] as number) >= 0
        && typeof candidate['filePath'] === 'string'
        && candidate['filePath'].length > 0
        && Array.isArray(candidate['channels'])
        && candidate['channels'].length > 0
        && candidate['channels'].every((channel) => {
            if (!channel || typeof channel !== 'object') {
                return false;
            }
            const entry = channel as Record<string, unknown>;
            return Number.isInteger(entry['channelIndex'])
                && (entry['channelIndex'] as number) >= 0
                && typeof entry['label'] === 'string'
                && entry['label'].trim().length > 0;
        });
}

export interface ExportWavLoopMessage {
    type: 'export-wav-loop';
    fileRegions?: Array<{ filePath: string; startNorm: number; endNorm: number }>;
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
        typeof m['endNorm'] === 'number' &&
        (m['fileRegions'] === undefined || (Array.isArray(m['fileRegions']) && m['fileRegions'].every(region => {
            if (!region || typeof region !== 'object') return false;
            const r = region as Record<string, unknown>;
            return typeof r.filePath === 'string' && (m['filePaths'] as string[]).includes(r.filePath)
                && typeof r.startNorm === 'number' && Number.isFinite(r.startNorm) && r.startNorm >= 0
                && typeof r.endNorm === 'number' && Number.isFinite(r.endNorm) && r.endNorm <= 1
                && r.endNorm > r.startNorm;
        })))
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
