import type { UiStrings } from '../i18n/strings';
import { isCalibrationProfile } from '../analysis/calibrationModel';
import { BACKEND_PROTOCOL_SCHEMA } from './generated/backendProtocolSchema';
import type {
    AnalyzePayload,
    BackendErrorPayload,
    BackendHeartbeatNotification,
    BackendReadyNotification,
    BackendStartedNotification,
    BuildRecipePayload,
    BuildRecipeResult,
    CursorAnswersPayload,
    CursorAnswersResult,
    TrackAnswersPayload,
    TrackAnswersResult,
    ExportWavLoopPayload,
    ExportWavLoopResult,
    FigureCountPayload,
    FigureCountResult,
    FigureDrawPayload,
    FigureDrawResult,
    FigureExportPayload,
    FigureExportResult,
    FigureReadPayload,
    FigureReadResult,
    FigureReleasePayload,
    FigureReleaseResult,
    PairAnswersPayload,
    PairAnswersResult,
    RegionPeakPayload,
    RegionPeakResult,
    ReleaseTrackDetailPayload,
    ScanPayload,
    ScanResult,
    StageView,
} from './generated/backendProtocolSchema';
import { schemaViolation } from './schemaValidation';
import type {
    AnalysisResult,
    CalibrationProfile,
} from '../analysis/analysisTypes';

export type {
    AnalyzePayload,
    BackendErrorPayload,
    BackendHeartbeatNotification,
    BackendReadyNotification,
    BackendStartedNotification,
    BuildRecipePayload,
    BuildRecipeResult,
    CursorAnswersPayload,
    CursorAnswersResult,
    TrackAnswersPayload,
    TrackAnswersResult,
    ExportWavLoopPayload,
    ExportWavLoopResult,
    PairAnswersPayload,
    PairAnswersResult,
    RegionPeakPayload,
    RegionPeakResult,
    ReleaseTrackDetailPayload,
    ScanPayload,
    ScanResult,
    StageView,
};

export interface CalibrationRequestContext {
    calibrationProfile?: CalibrationProfile;
    analysisRevision?: number;
}

export type ReleaseTrackDetailResult = Record<never, never>;

export interface BackendCommandMap {
    analyze: { payload: AnalyzePayload; result: AnalysisResult };
    'release-track-detail': { payload: ReleaseTrackDetailPayload; result: ReleaseTrackDetailResult };
    // The Tracks screen's two bottom figures' answers, kept by key for the figure service (python-backend/services/tracks_answers.py).
    // The reply names each kept line's key and sends no value.
    'cursor-answers': { payload: CursorAnswersPayload; result: CursorAnswersResult };
    'pair-answers': { payload: PairAnswersPayload; result: PairAnswersResult };
    // A Tracks row's answers (each channel's samples and STFT levels), kept by key the same way.
    'track-answers': { payload: TrackAnswersPayload; result: TrackAnswersResult };
    'region-peak': { payload: RegionPeakPayload; result: RegionPeakResult };
    'export-wav-loop': { payload: ExportWavLoopPayload; result: ExportWavLoopResult };
    'build-recipe': { payload: BuildRecipePayload; result: BuildRecipeResult };
    scan: { payload: ScanPayload; result: ScanResult };
    // The figure service (python-backend/figures/; docs/figure-design.md 第 5, 6 節): every Figure
    // of the webview asks it (src/webview/answers/figureRequests.ts).
    'figure-draw': { payload: FigureDrawPayload; result: FigureDrawResult };
    'figure-read': { payload: FigureReadPayload; result: FigureReadResult };
    'figure-export': { payload: FigureExportPayload; result: FigureExportResult };
    'figure-release': { payload: FigureReleasePayload; result: FigureReleaseResult };
    'figure-count': { payload: FigureCountPayload; result: FigureCountResult };
}

export const BACKEND_COMMANDS = [
    'analyze',
    'release-track-detail',
    'cursor-answers',
    'track-answers',
    'pair-answers',
    'region-peak',
    'export-wav-loop',
    'build-recipe',
    'scan',
    'figure-draw',
    'figure-read',
    'figure-export',
    'figure-release',
    'figure-count',
] as const satisfies ReadonlyArray<keyof BackendCommandMap>;

export type BackendCommand = typeof BACKEND_COMMANDS[number];
export type BackendPayload<K extends BackendCommand> = BackendCommandMap[K]['payload'];
export type BackendResult<K extends BackendCommand> = BackendCommandMap[K]['result'];
export type BackendRequest<K extends BackendCommand> = { cmd: K; requestId: string } & BackendPayload<K>;
export type BackendSuccessEnvelope<K extends BackendCommand> = { requestId: string } & BackendResult<K>;

/** Error codes from `python-backend/services/backend_errors.py`; hosts branch on these, never on the message text. */
export const BACKEND_ERROR_CODES = BACKEND_PROTOCOL_SCHEMA.$defs.BackendErrorPayload.properties.code.enum;
export type BackendErrorCode = BackendErrorPayload['code'];
/** What went wrong, from `python-backend/services/backend_errors.py`; picks the summary the user reads. */
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


/** Schema plus the channel count and the calibration profile's own checks (calibrationModel.ts). */
function isAnalysisResult(value: unknown): value is AnalysisResult {
    if (schemaViolation('AnalysisResult', value) !== null) return false;
    const result = value as AnalysisResult;
    return result.channels.length === result.channelCount
        && (result.calibrationProfile === undefined || isCalibrationProfile(result.calibrationProfile));
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

/** A scan is one step's picture of a file (its input and the picture), or the one-line reason it could not be had. */
function isScanResult(value: unknown): value is ScanResult {
    if (schemaViolation('ScanResult', value) !== null) return false;
    const result = value as ScanResult;
    if (!result.ok) return typeof result.reason === 'string' && result.input === undefined && result.stage === undefined;
    return result.reason === undefined && result.input !== undefined && result.stage !== undefined;
}

type ResultValidator<K extends BackendCommand> = (value: unknown) => value is BackendResult<K>;

const RESULT_VALIDATORS: { [K in BackendCommand]: ResultValidator<K> } = {
    analyze: isAnalysisResult,
    'release-track-detail': isReleaseTrackDetailResult,
    'cursor-answers': (value: unknown): value is CursorAnswersResult => schemaViolation('CursorAnswersResult', value) === null,
    'pair-answers': (value: unknown): value is PairAnswersResult => schemaViolation('PairAnswersResult', value) === null,
    'track-answers': (value: unknown): value is TrackAnswersResult => schemaViolation('TrackAnswersResult', value) === null,
    'region-peak': (value: unknown): value is RegionPeakResult => schemaViolation('RegionPeakResult', value) === null,
    'export-wav-loop': isExportWavLoopResult,
    'build-recipe': isBuildRecipeResult,
    scan: isScanResult,
    'figure-draw': (value: unknown): value is FigureDrawResult => schemaViolation('FigureDrawResult', value) === null,
    'figure-read': (value: unknown): value is FigureReadResult => schemaViolation('FigureReadResult', value) === null,
    'figure-export': (value: unknown): value is FigureExportResult => schemaViolation('FigureExportResult', value) === null,
    'figure-release': (value: unknown): value is FigureReleaseResult => schemaViolation('FigureReleaseResult', value) === null,
    'figure-count': (value: unknown): value is FigureCountResult => schemaViolation('FigureCountResult', value) === null,
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
