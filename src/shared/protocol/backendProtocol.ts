import type { UiStrings } from '../i18n/strings';
import { isCalibrationProfile } from '../analysis/calibrationModel';
import { BACKEND_PROTOCOL_SCHEMA } from './generated/backendProtocolSchema';
import type { Drawn } from '../provenance';
import type {
    AnalyzePayload,
    BackendErrorPayload,
    BackendHeartbeatNotification,
    BackendReadyNotification,
    BackendStartedNotification,
    BuildRecipePayload,
    BuildRecipeResult,
    ExportWavLoopPayload,
    ExportWavLoopResult,
    PairSpectrumPayload,
    PairSpectrumResult,
    RangePayload,
    RangeResult,
    ReleaseTrackDetailPayload,
    ScanPayload,
    ScanResult,
    ScanSpecPayload,
    ScanSpecResult,
    SpectrumSlicePayload,
    SpectrumSliceResult,
    StageCombinePayload,
    StageCombineResult,
    StageDetail,
    StagePoints,
    StageRead,
    StageView,
    TrackDetailPayload,
    TrackDetailResult,
} from './generated/backendProtocolSchema';
import { schemaViolation } from './schemaValidation';
import type {
    AnalysisResult,
    CalibrationProfile,
    ChannelSummary,
    SpectrogramData,
    WaveformEnvelope,
} from '../analysis/analysisTypes';

export type {
    AnalyzePayload,
    BackendErrorPayload,
    BackendHeartbeatNotification,
    BackendReadyNotification,
    BackendStartedNotification,
    BuildRecipePayload,
    BuildRecipeResult,
    ExportWavLoopPayload,
    ExportWavLoopResult,
    PairSpectrumPayload,
    PairSpectrumResult,
    RangePayload,
    RangeResult,
    ReleaseTrackDetailPayload,
    ScanPayload,
    ScanResult,
    ScanSpecPayload,
    ScanSpecResult,
    SpectrumSlicePayload,
    SpectrumSliceResult,
    StageCombinePayload,
    StageCombineResult,
    StageDetail,
    StagePoints,
    StageRead,
    StageView,
    TrackDetailPayload,
    TrackDetailResult,
};

export interface CalibrationRequestContext {
    calibrationProfile?: CalibrationProfile;
    analysisRevision?: number;
}

export type ReleaseTrackDetailResult = Record<never, never>;

export interface BackendCommandMap {
    analyze: { payload: AnalyzePayload; result: AnalysisResult };
    range: { payload: RangePayload; result: RangeResult };
    'track-detail': { payload: TrackDetailPayload; result: TrackDetailResult };
    'release-track-detail': { payload: ReleaseTrackDetailPayload; result: ReleaseTrackDetailResult };
    'spectrum-slice': { payload: SpectrumSlicePayload; result: SpectrumSliceResult };
    'pair-spectrum': { payload: PairSpectrumPayload; result: PairSpectrumResult };
    'export-wav-loop': { payload: ExportWavLoopPayload; result: ExportWavLoopResult };
    'build-recipe': { payload: BuildRecipePayload; result: BuildRecipeResult };
    scan: { payload: ScanPayload; result: ScanResult };
    'scan-spec': { payload: ScanSpecPayload; result: ScanSpecResult };
    'stage-combine': { payload: StageCombinePayload; result: StageCombineResult };
}

export const BACKEND_COMMANDS = [
    'analyze',
    'range',
    'track-detail',
    'release-track-detail',
    'spectrum-slice',
    'pair-spectrum',
    'export-wav-loop',
    'build-recipe',
    'scan',
    'scan-spec',
    'stage-combine',
] as const satisfies ReadonlyArray<keyof BackendCommandMap>;

export type BackendCommand = typeof BACKEND_COMMANDS[number];
export type BackendPayload<K extends BackendCommand> = BackendCommandMap[K]['payload'];
export type BackendResult<K extends BackendCommand> = BackendCommandMap[K]['result'];
export type BackendRequest<K extends BackendCommand> = { cmd: K; requestId: string } & BackendPayload<K>;
export type BackendSuccessEnvelope<K extends BackendCommand> = { requestId: string } & BackendResult<K>;

/** Error codes from `python-backend/backend_errors.py`; hosts branch on these, never on the message text. */
export const BACKEND_ERROR_CODES = BACKEND_PROTOCOL_SCHEMA.$defs.BackendErrorPayload.properties.code.enum;
export type BackendErrorCode = BackendErrorPayload['code'];
/** What went wrong, from `python-backend/backend_errors.py`; picks the summary the user reads. */
export const BACKEND_ERROR_KINDS = BACKEND_PROTOCOL_SCHEMA.$defs.BackendErrorPayload.properties.kind.enum;
export type BackendErrorKind = BackendErrorPayload['kind'];

const ERROR_SUMMARY = {
    'analysis-settings': 'errorAnalysisSettings',
    'unreadable-file': 'errorUnreadableFile',
    'out-of-memory': 'errorOutOfMemory',
    'invalid-input': 'errorInvalidInput',
    'analysis-failed': 'errorAnalysisFailed',
} as const satisfies Record<BackendErrorKind, keyof UiStrings>;

export type ErrorSummaryStrings = Pick<UiStrings, typeof ERROR_SUMMARY[BackendErrorKind]>;

export interface BackendErrorEnvelope {
    requestId: string;
    error: BackendErrorPayload;
}

export type BackendNotification = BackendReadyNotification | BackendHeartbeatNotification | BackendStartedNotification;
export type BackendResponseEnvelope<K extends BackendCommand> = BackendSuccessEnvelope<K> | BackendErrorEnvelope;
export type BackendEnvelope<K extends BackendCommand> = BackendNotification | BackendResponseEnvelope<K>;

export class BackendProtocolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BackendProtocolError';
    }
}

/** A request the backend answered with an error envelope. */
export class BackendRequestError extends Error {
    constructor(readonly code: BackendErrorCode, readonly kind: BackendErrorKind, message: string) {
        super(message);
        this.name = 'BackendRequestError';
    }
}

function backendRequestError(error: unknown): BackendRequestError | undefined {
    for (let current = error, depth = 0; current instanceof Error && depth < 8; current = current.cause, depth++) {
        if (current instanceof BackendRequestError) return current;
    }
    return undefined;
}

/** The backend error code of `error` or of any error in its `cause` chain. */
export function backendErrorCode(error: unknown): BackendErrorCode | undefined {
    return backendRequestError(error)?.code;
}

/**
 * What the user reads about `error`: for a backend error, the summary of its kind in the UI's language, then the
 * backend's own text on the next line as the detail; any other error's message as it is.
 */
export function userErrorText(error: unknown, strings: ErrorSummaryStrings): string {
    const backend = backendRequestError(error);
    if (backend) return backend.message ? `${strings[ERROR_SUMMARY[backend.kind]]}\n${backend.message}` : strings[ERROR_SUMMARY[backend.kind]];
    return error instanceof Error ? error.message : String(error);
}

export function parseBackendErrorPayload(value: unknown): BackendErrorPayload | null {
    if (schemaViolation('BackendErrorPayload', value) !== null) return null;
    const { code, kind, message } = value as BackendErrorPayload;
    return { code, kind, message };
}

export function isBackendCommand(value: unknown): value is BackendCommand {
    return typeof value === 'string' && BACKEND_COMMANDS.some((command) => command === value);
}

export function isJsonObject(value: unknown): value is { [key: string]: unknown } {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}


/**
 * A message as it came over the wire, before its numbers are typed (its drawn points `Drawn`, provenance.ts): what the
 * cross-field checks below read. They compare how long a message's arrays are; none of their values is used, so
 * they read the message, never a picture.
 */
type Wire<T> = T extends Drawn ? unknown : T extends ReadonlyArray<infer Item> ? ReadonlyArray<Wire<Item>> : T extends object ? { readonly [K in keyof T]: Wire<T[K]> } : T;

/** Cross-field invariant the schema cannot express: every per-point array has the same length. */
function hasAlignedEnvelopeArrays(envelope: Wire<WaveformEnvelope>): boolean {
    const pointCount = envelope.min.length;
    return [envelope.max, envelope.samples, envelope.minT, envelope.maxT]
        .every(points => points === undefined || points.length === pointCount);
}

/** Cross-field invariant the schema cannot express: timeBins rows of frequencyBins values. */
function hasSpectrogramShape(spectrogram: Wire<SpectrogramData>): boolean {
    return spectrogram.values.length === spectrogram.timeBins
        && spectrogram.values.every(row => row.length === spectrogram.frequencyBins);
}

function hasChannelInvariants(channel: Wire<ChannelSummary>): boolean {
    return hasAlignedEnvelopeArrays(channel.waveform)
        && (channel.spectrogram === null || hasSpectrogramShape(channel.spectrogram));
}

/** Schema plus the channel count and the calibration profile's own checks (calibrationModel.ts). */
function isAnalysisResult(value: unknown): value is AnalysisResult {
    if (schemaViolation('AnalysisResult', value) !== null) return false;
    const wire = value as Wire<AnalysisResult>;
    const result = value as AnalysisResult;
    return wire.channels.length === wire.channelCount
        && wire.channels.every(hasChannelInvariants)
        && (result.calibrationProfile === undefined || isCalibrationProfile(result.calibrationProfile));
}

function isRangeResult(value: unknown): value is RangeResult {
    return schemaViolation('RangeResult', value) === null
        && (value as Wire<RangeResult>).channels.every(hasAlignedEnvelopeArrays);
}

function isTrackDetailResult(value: unknown): value is TrackDetailResult {
    return schemaViolation('TrackDetailResult', value) === null
        && (value as Wire<TrackDetailResult>).channels.every(hasChannelInvariants);
}

function isSpectrumSliceResult(value: unknown): value is SpectrumSliceResult {
    if (schemaViolation('SpectrumSliceResult', value) !== null) return false;
    const result = value as Wire<SpectrumSliceResult>;
    return result.channels.length > 0 && result.channels.every(channel => channel.values.length === result.frequencyBins)
        && (result.bandCentersHz === undefined || result.bandCentersHz.length === result.frequencyBins)
        && (result.frequenciesHz === undefined || (result.bandCentersHz === undefined && result.frequenciesHz.length === result.frequencyBins));
}

function isPairSpectrumResult(value: unknown): value is PairSpectrumResult {
    if (schemaViolation('PairSpectrumResult', value) !== null) return false;
    const result = value as PairSpectrumResult;
    return result.responses.every(response => {
        const bins = response.status === 'ok' ? result.frequencyBins : 0;
        return [response.gainDb, response.phaseRad, response.coherence].every(values => values.length === bins);
    });
}

function isExportWavLoopResult(value: unknown): value is ExportWavLoopResult {
    return schemaViolation('ExportWavLoopResult', value) === null;
}

function isReleaseTrackDetailResult(value: unknown): value is ReleaseTrackDetailResult {
    return schemaViolation('ReleaseTrackDetailResult', value) === null;
}

function isBuildRecipeResult(value: unknown): value is BuildRecipeResult {
    return schemaViolation('BuildRecipeResult', value) === null;
}

const STAGE_METRIC_KEYS = ['conditionId', 'leqDbA', 'peakHz', 'spectrumDb', 'spectrumBinsDb', 'spectrumBinHz', 'thirdOctDb', 'crest', 'endFrame'] as const;
const SCAN_SUCCESS_KEYS = [
    'conditionId', 'input', 'leqDbA', 'peakHz', 'spectrumDb', 'thirdOctDb', 'crest', 'specVersion', 'wandasVersion', 'elapsedMs',
] as const;

function isScanResult(value: unknown): value is ScanResult {
    if (schemaViolation('ScanResult', value) !== null) return false;
    const result = value as ScanResult;
    if (!result.ok) return typeof result.reason === 'string' && [...SCAN_SUCCESS_KEYS, 'spectrumBinsDb', 'spectrumBinHz'].every(key => result[key as keyof ScanResult] === undefined);
    // A step's picture alone (scan with `stage`): the file's input and the picture, none of the metrics.
    if (result.stage !== undefined && result.leqDbA === undefined) {
        return result.reason === undefined && result.input !== undefined && STAGE_METRIC_KEYS.every(key => result[key] === undefined);
    }
    if (result.reason !== undefined || !SCAN_SUCCESS_KEYS.every(key => result[key] !== undefined) || result.input === undefined) return false;
    // Every per-channel array follows input.channels.
    const channels = result.input.channels.length;
    return [result.leqDbA, result.peakHz, result.spectrumDb, result.thirdOctDb, result.crest]
        .every(values => values !== undefined && values.length === channels)
        // Every bin as well (optional): one row per channel, with the bins' spacing.
        && (result.spectrumBinsDb === undefined || (result.spectrumBinsDb.length === channels && typeof result.spectrumBinHz === 'number'));
}

/** A scan's spec as the stored index keeps it: the analysis spec and wandas versions it names (a scan result, or the backend's scan-spec). */
export const scanSpecOf = (spec: { specVersion?: number; wandasVersion?: string }): string => `${spec.specVersion ?? ''}|${spec.wandasVersion ?? ''}`;

function isScanSpecResult(value: unknown): value is ScanSpecResult {
    return schemaViolation('ScanSpecResult', value) === null;
}

function isStageCombineResult(value: unknown): value is StageCombineResult {
    if (schemaViolation('StageCombineResult', value) !== null) return false;
    const result = value as StageCombineResult;
    // Missing keys come alone; a combination never names any.
    return result.ok ? result.missing === undefined : result.missing !== undefined && !result.base && !result.diff;
}

type ResultValidator<K extends BackendCommand> = (value: unknown) => value is BackendResult<K>;

const RESULT_VALIDATORS: { [K in BackendCommand]: ResultValidator<K> } = {
    analyze: isAnalysisResult,
    range: isRangeResult,
    'track-detail': isTrackDetailResult,
    'release-track-detail': isReleaseTrackDetailResult,
    'spectrum-slice': isSpectrumSliceResult,
    'pair-spectrum': isPairSpectrumResult,
    'export-wav-loop': isExportWavLoopResult,
    'build-recipe': isBuildRecipeResult,
    scan: isScanResult,
    'scan-spec': isScanSpecResult,
    'stage-combine': isStageCombineResult,
};

export function parseBackendResult<K extends BackendCommand>(command: K, value: unknown): BackendResult<K> {
    const validator: ResultValidator<K> = RESULT_VALIDATORS[command];
    if (!validator(value)) {
        throw new BackendProtocolError(`Invalid ${command} success response`);
    }
    return value;
}

export function parseBackendNotification(value: unknown): BackendNotification | null {
    if (schemaViolation('BackendReadyNotification', value) === null) return { type: 'ready' };
    if (schemaViolation('BackendHeartbeatNotification', value) === null) {
        return { type: 'heartbeat', ts: (value as BackendHeartbeatNotification).ts };
    }
    if (schemaViolation('BackendStartedNotification', value) === null) {
        return { type: 'started', requestId: (value as BackendStartedNotification).requestId };
    }
    return null;
}

export interface PendingBackendRequest<T> {
    command: string;
    complete(response: T): void;
    reject(error: Error): void;
}

/** Correlates replies with their requests for both hosts; each host injects only its transport `send`. */
export class PendingBackendRequests<T, C extends string = string> extends Map<string, PendingBackendRequest<T> & { command: C }> {
    private sequence = 0;

    constructor(private readonly idPrefix: string) {
        super();
    }

    nextId(): string {
        return `${this.idPrefix}${++this.sequence}`;
    }

    /** Registers `requestId`, then sends; a synchronous send failure unregisters and rejects it. */
    dispatch<R>(command: C, requestId: string, complete: (response: T) => R, send: () => void): Promise<R> {
        return new Promise<R>((resolve, reject) => {
            this.set(requestId, { command, complete: response => { resolve(complete(response)); }, reject });
            try {
                send();
            } catch (error) {
                this.delete(requestId);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }
}

export interface BackendReplyDiagnostic {
    kind: 'orphan-response' | 'protocol-validation-error';
    message: string;
    requestId: string;
}

export function rejectPendingRequests<T extends { reject(error: Error): void }>(pending: Map<string, T>, error: Error): void {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
}

export function settleBackendRequest<T>(
    pending: Map<string, PendingBackendRequest<T>>,
    requestId: string,
    response: T,
    failure?: unknown,
): BackendReplyDiagnostic | undefined {
    const request = pending.get(requestId);
    if (!request) {
        return { kind: 'orphan-response', message: `Backend response has no pending request: ${requestId}`, requestId };
    }
    pending.delete(requestId);
    if (failure !== undefined) {
        // An error reply carries only `error` beside its envelope; anything else is protocol drift.
        const extraKeys = isJsonObject(response) ? Object.keys(response).filter(key => key !== 'error' && response[key] !== undefined) : [];
        const payload = extraKeys.length === 0 ? parseBackendErrorPayload(failure) : null;
        if (payload) {
            request.reject(new BackendRequestError(payload.code, payload.kind, payload.message));
            return;
        }
        const error = new BackendProtocolError(`Invalid error response for ${request.command}`);
        request.reject(error);
        return { kind: 'protocol-validation-error', message: error.message, requestId };
    }
    try {
        request.complete(response);
    } catch (cause) {
        const error = cause instanceof BackendProtocolError ? cause
            : new BackendProtocolError(`Invalid ${request.command} response: ${String(cause)}`);
        request.reject(error);
        return { kind: 'protocol-validation-error', message: error.message, requestId };
    }
}
