import type { ChartSpec } from '../chartSpec';
import type { RecipeDocument } from '../recipe/recipeSelection';
import { isCalibrationProfile } from '../analysis/calibrationModel';
import { BACKEND_PROTOCOL_SCHEMA } from './generated/backendProtocolSchema';
import type {
    AnalyzePayload,
    BackendErrorPayload,
    BackendHeartbeatNotification,
    BackendReadyNotification,
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
    SpectrumSlicePayload,
    SpectrumSliceResult,
    StageDetail,
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
    SpectrumSlicePayload,
    SpectrumSliceResult,
    StageDetail,
    StageView,
    TrackDetailPayload,
    TrackDetailResult,
};

export interface CalibrationRequestContext {
    calibrationProfile?: CalibrationProfile;
    analysisRevision?: number;
}

export type ReleaseTrackDetailResult = Record<never, never>;

export interface RunRecipePayload {
    recipe: RecipeDocument;
    /** Recipe input name → file path of a loaded track. */
    inputs: Record<string, string>;
    recipePath?: string;
    inputContexts?: Record<string, CalibrationRequestContext>;
}

export interface RunRecipeResult {
    charts: ChartSpec[];
}

export interface BackendCommandMap {
    analyze: { payload: AnalyzePayload; result: AnalysisResult };
    range: { payload: RangePayload; result: RangeResult };
    'track-detail': { payload: TrackDetailPayload; result: TrackDetailResult };
    'release-track-detail': { payload: ReleaseTrackDetailPayload; result: ReleaseTrackDetailResult };
    'spectrum-slice': { payload: SpectrumSlicePayload; result: SpectrumSliceResult };
    'pair-spectrum': { payload: PairSpectrumPayload; result: PairSpectrumResult };
    'export-wav-loop': { payload: ExportWavLoopPayload; result: ExportWavLoopResult };
    'run-recipe': { payload: RunRecipePayload; result: RunRecipeResult };
    'build-recipe': { payload: BuildRecipePayload; result: BuildRecipeResult };
    scan: { payload: ScanPayload; result: ScanResult };
}

export const BACKEND_COMMANDS = [
    'analyze',
    'range',
    'track-detail',
    'release-track-detail',
    'spectrum-slice',
    'pair-spectrum',
    'export-wav-loop',
    'run-recipe',
    'build-recipe',
    'scan',
] as const satisfies ReadonlyArray<keyof BackendCommandMap>;

export type BackendCommand = typeof BACKEND_COMMANDS[number];
export type BackendPayload<K extends BackendCommand> = BackendCommandMap[K]['payload'];
export type BackendResult<K extends BackendCommand> = BackendCommandMap[K]['result'];
export type BackendRequest<K extends BackendCommand> = { cmd: K; requestId: string } & BackendPayload<K>;
export type BackendSuccessEnvelope<K extends BackendCommand> = { requestId: string } & BackendResult<K>;

/** Error codes from `python-backend/backend_errors.py`; hosts branch on these, never on the message text. */
export const BACKEND_ERROR_CODES = BACKEND_PROTOCOL_SCHEMA.$defs.BackendErrorPayload.properties.code.enum;
export type BackendErrorCode = BackendErrorPayload['code'];

export interface BackendErrorEnvelope {
    requestId: string;
    error: BackendErrorPayload;
}

export type BackendNotification = BackendReadyNotification | BackendHeartbeatNotification;
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
    constructor(readonly code: BackendErrorCode, message: string) {
        super(message);
        this.name = 'BackendRequestError';
    }
}

/** The backend error code of `error` or of any error in its `cause` chain. */
export function backendErrorCode(error: unknown): BackendErrorCode | undefined {
    for (let current = error, depth = 0; current instanceof Error && depth < 8; current = current.cause, depth++) {
        if (current instanceof BackendRequestError) return current.code;
    }
    return undefined;
}

export function parseBackendErrorPayload(value: unknown): BackendErrorPayload | null {
    if (schemaViolation('BackendErrorPayload', value) !== null) return null;
    const { code, message } = value as BackendErrorPayload;
    return { code, message };
}

export function isBackendCommand(value: unknown): value is BackendCommand {
    return typeof value === 'string' && BACKEND_COMMANDS.some((command) => command === value);
}

export function isJsonObject(value: unknown): value is { [key: string]: unknown } {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}


/** Cross-field invariant the schema cannot express: every per-point array has the same length. */
function hasAlignedEnvelopeArrays(envelope: WaveformEnvelope): boolean {
    const pointCount = envelope.min.length;
    return [envelope.max, envelope.samples, envelope.minT, envelope.maxT]
        .every(points => points === undefined || points.length === pointCount);
}

/** Cross-field invariant the schema cannot express: timeBins rows of frequencyBins values. */
function hasSpectrogramShape(spectrogram: SpectrogramData): boolean {
    return spectrogram.values.length === spectrogram.timeBins
        && spectrogram.values.every(row => row.length === spectrogram.frequencyBins);
}

function hasChannelInvariants(channel: ChannelSummary): boolean {
    return hasAlignedEnvelopeArrays(channel.waveform)
        && (channel.spectrogram === null || hasSpectrogramShape(channel.spectrogram));
}

/** Schema plus the channel count and the calibration profile's own checks (calibrationModel.ts). */
function isAnalysisResult(value: unknown): value is AnalysisResult {
    if (schemaViolation('AnalysisResult', value) !== null) return false;
    const result = value as AnalysisResult;
    return result.channels.length === result.channelCount
        && result.channels.every(hasChannelInvariants)
        && (result.calibrationProfile === undefined || isCalibrationProfile(result.calibrationProfile));
}

function isRangeResult(value: unknown): value is RangeResult {
    return schemaViolation('RangeResult', value) === null
        && (value as RangeResult).channels.every(hasAlignedEnvelopeArrays);
}

function isTrackDetailResult(value: unknown): value is TrackDetailResult {
    return schemaViolation('TrackDetailResult', value) === null
        && (value as TrackDetailResult).channels.every(hasChannelInvariants);
}

function isSpectrumSliceResult(value: unknown): value is SpectrumSliceResult {
    if (schemaViolation('SpectrumSliceResult', value) !== null) return false;
    const result = value as SpectrumSliceResult;
    return result.channels.length > 0 && result.channels.every(channel => channel.values.length === result.frequencyBins)
        && (result.bandCentersHz === undefined || result.bandCentersHz.length === result.frequencyBins);
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

function isRunRecipeResult(value: unknown): value is RunRecipeResult {
    // Outside the generated schema: the envelope is closed here, each ChartSpec stays open.
    return isJsonObject(value)
        && Object.keys(value).every(key => key === 'charts')
        && Array.isArray(value['charts'])
        && value['charts'].every((chart) => isJsonObject(chart)
            && ['line', 'heatmap', 'bar', 'scalar'].includes(String(chart['kind']))
            && typeof chart['title'] === 'string');
}

function isBuildRecipeResult(value: unknown): value is BuildRecipeResult {
    return schemaViolation('BuildRecipeResult', value) === null;
}

const STAGE_METRIC_KEYS = ['conditionId', 'leqDbA', 'peakHz', 'spectrumDb', 'thirdOctDb', 'crest', 'endFrame'] as const;
const SCAN_SUCCESS_KEYS = [
    'conditionId', 'input', 'leqDbA', 'peakHz', 'spectrumDb', 'thirdOctDb', 'crest', 'specVersion', 'wandasVersion', 'elapsedMs',
] as const;

function isScanResult(value: unknown): value is ScanResult {
    if (schemaViolation('ScanResult', value) !== null) return false;
    const result = value as ScanResult;
    if (!result.ok) return typeof result.reason === 'string' && SCAN_SUCCESS_KEYS.every(key => result[key] === undefined);
    // A step's picture alone (scan with `stage`): the file's input and the picture, none of the metrics.
    if (result.stage !== undefined && result.leqDbA === undefined) {
        return result.reason === undefined && result.input !== undefined && STAGE_METRIC_KEYS.every(key => result[key] === undefined);
    }
    if (result.reason !== undefined || !SCAN_SUCCESS_KEYS.every(key => result[key] !== undefined)) return false;
    // Every per-channel array follows input.channels.
    const channels = result.input!.channels.length;
    return [result.leqDbA, result.peakHz, result.spectrumDb, result.thirdOctDb, result.crest]
        .every(values => values!.length === channels);
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
    'run-recipe': isRunRecipeResult,
    'build-recipe': isBuildRecipeResult,
    scan: isScanResult,
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
            request.reject(new BackendRequestError(payload.code, payload.message));
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
