import type { StftOptions } from './analysisTypes';
import type {
    AnalyzePayload, BackendCommand, BuildRecipePayload, BuildRecipeResult, BackendPayload, ScanPayload, ScanResult, BackendResult,
    CalibrationRequestContext, CursorAnswersResult, PairAnswersResult, RegionPeakResult, TrackAnswersResult,
    ExportWavLoopResult,
} from '../protocol/backendProtocol';
import type { FigureCommand } from '../protocol/figureMessages';
import type { PairSourceRef, PairSpectrumRequest, RegionPeakSourceRef, SpectrumSliceRequest, TrackDetailRequest } from '../utils/audioTarget';

export type AnalyzeOptions = Omit<AnalyzePayload, 'filePath'>;

export interface AnalysisContextPolicy {
    current(filePath: string): CalibrationRequestContext;
    discardStale?(filePath: string, error: unknown, attempted: CalibrationRequestContext): Promise<boolean>;
}

export interface AnalysisCancellationSignal {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): { dispose(): void };
}

/** A signal its owner fires once, e.g. when a newer request for the same track supersedes this one. */
export class RequestCancellation implements AnalysisCancellationSignal {
    private cancelled = false;
    private readonly listeners = new Set<() => void>();

    get isCancellationRequested(): boolean { return this.cancelled; }

    onCancellationRequested(listener: () => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    cancel(): void {
        if (this.cancelled) return;
        this.cancelled = true;
        this.listeners.forEach(listener => listener());
    }
}

/** The file version a lazy request is of (sourceVersion), named only when the asking track has one. */
function versionPayload(sourceVersion: string | undefined): { sourceVersion?: string } {
    return sourceVersion !== undefined ? { sourceVersion } : {};
}

export abstract class AnalysisClient {
    constructor(private readonly contextPolicy?: AnalysisContextPolicy) {}

    protected cancelRequest(_requestId: string, _reason: Error): void {}

    analysisRevisionFor(filePath: string): number {
        return this.contextPolicy?.current(filePath).analysisRevision ?? 0;
    }

    protected requestContext(filePath: string, request: CalibrationRequestContext): CalibrationRequestContext {
        return request.analysisRevision !== undefined ? request : this.contextPolicy?.current(filePath) ?? request;
    }

    protected async analyzeWithContext<R>(
        filePath: string, options: AnalyzeOptions, send: (options: AnalyzeOptions) => Promise<R>,
    ): Promise<R> {
        const context = this.contextPolicy?.current(filePath) ?? options;
        const resolved = { ...options, calibrationProfile: context.calibrationProfile, analysisRevision: context.analysisRevision };
        try {
            return await send(resolved);
        } catch (error) {
            if (!context.calibrationProfile || !await this.contextPolicy?.discardStale?.(filePath, error, context)) throw error;
            return send({ ...options, calibrationProfile: undefined, analysisRevision: this.analysisRevisionFor(filePath) });
        }
    }

    protected abstract request<K extends BackendCommand>(
        command: K, payload: BackendPayload<K>, requestId?: string, cancellation?: AnalysisCancellationSignal,
    ): Promise<BackendResult<K>>;

    analyze(filePath: string, options: AnalyzeOptions): Promise<BackendResult<'analyze'>> {
        return this.analyzeWithContext(filePath, options, resolved => this.request('analyze', analysisPayload(filePath, resolved)));
    }

    async releaseTrackDetail(filePath: string): Promise<void> {
        await this.request('release-track-detail', { filePath });
    }

    /** A Tracks row's answers kept by key for the figure service (the backend's `track-answers`): keys, no value. */
    async requestTrackAnswers(
        filePath: string,
        payload: CalibrationRequestContext & { scale: 'log' | 'linear'; startNorm?: number; endNorm?: number; spectrogram?: boolean; extents?: boolean; stftOptions?: StftOptions; sourceVersion: string | undefined },
        requestId: string,
        cancellation?: AnalysisCancellationSignal,
    ): Promise<TrackAnswersResult> {
        return this.request(
            'track-answers',
            {
                filePath,
                scale: payload.scale,
                ...(payload.startNorm !== undefined && payload.endNorm !== undefined ? { startNorm: payload.startNorm, endNorm: payload.endNorm } : {}),
                ...(payload.spectrogram === false ? { spectrogram: false } : {}),
                ...(payload.extents === true ? { extents: true } : {}),
                ...(payload.stftOptions ? { stftOptions: payload.stftOptions } : {}),
                ...versionPayload(payload.sourceVersion),
                ...this.calibrationPayload(this.requestContext(filePath, payload)),
            },
            requestId,
            cancellation,
        );
    }

    /** The cursor spectrum's answers kept by key for the figure service (the backend's `cursor-answers`): keys, no value. */
    async requestCursorAnswers(
        filePath: string,
        payload: CalibrationRequestContext & { cursorNorm: number; bandsPerOctave?: 1 | 3; stftOptions?: StftOptions; sourceVersion: string | undefined; scale: 'log' | 'linear' },
        requestId: string,
        cancellation?: AnalysisCancellationSignal,
    ): Promise<CursorAnswersResult> {
        return this.request(
            'cursor-answers',
            {
                filePath,
                cursorNorm: payload.cursorNorm,
                scale: payload.scale,
                ...(payload.bandsPerOctave ? { bandsPerOctave: payload.bandsPerOctave } : {}),
                ...(payload.stftOptions ? { stftOptions: payload.stftOptions } : {}),
                ...versionPayload(payload.sourceVersion),
                ...this.calibrationPayload(this.requestContext(filePath, payload)),
            },
            requestId,
            cancellation,
        );
    }

    /** The largest |sample| of the sources' channels over their stretches (AnalysisService.region_peak): one answer. */
    async requestRegionPeak(sources: readonly RegionPeakSourceRef[], contexts: ReadonlyMap<string, CalibrationRequestContext>, requestId: string): Promise<RegionPeakResult> {
        return this.request('region-peak', {
            sources: sources.map(({ sourceVersion, ...ref }) => ({
                ...ref, ...versionPayload(sourceVersion), ...this.calibrationPayload(this.requestContext(ref.filePath, contexts.get(ref.filePath) ?? {})),
            })),
        }, requestId);
    }

    /** The pair figure's answers kept by key for the figure service (the backend's `pair-answers`): keys, no value. */
    async requestPairAnswers(
        request: Pick<PairSpectrumRequest, 'reference' | 'responses' | 'startSeconds' | 'endSeconds'> & { stftOptions?: StftOptions; scale: 'log' | 'linear' },
        contexts: ReadonlyMap<string, CalibrationRequestContext>,
        requestId: string,
    ): Promise<PairAnswersResult> {
        const source = ({ sourceVersion, ...ref }: PairSourceRef) => ({
            ...ref, ...versionPayload(sourceVersion), ...this.calibrationPayload(this.requestContext(ref.filePath, contexts.get(ref.filePath) ?? {})),
        });
        return this.request(
            'pair-answers',
            {
                reference: source(request.reference),
                responses: request.responses.map(source),
                scale: request.scale,
                ...(request.startSeconds !== undefined ? { startSeconds: request.startSeconds } : {}),
                ...(request.endSeconds !== undefined ? { endSeconds: request.endSeconds } : {}),
                ...(request.stftOptions ? { stftOptions: request.stftOptions } : {}),
            },
            requestId,
        );
    }

    async exportWavLoop(
        filePath: string,
        startNorm: number,
        endNorm: number,
    ): Promise<ExportWavLoopResult> {
        return this.request(
            'export-wav-loop',
            { filePath, startNorm, endNorm },
        );
    }

    buildRecipe(payload: BuildRecipePayload): Promise<BuildRecipeResult> {
        return this.request('build-recipe', payload);
    }

    /** The calibration profile requests for `filePath` carry, if the host keeps one. */
    calibrationFor(filePath: string): CalibrationRequestContext['calibrationProfile'] {
        return this.contextPolicy?.current(filePath).calibrationProfile;
    }

    /** One step of a Recipe over one file, under the calibration the host keeps for it. */
    scan(payload: ScanPayload): Promise<ScanResult> {
        const calibration = payload.calibration ?? this.calibrationFor(payload.filePath);
        // The recording a step is measured against is calibrated as its own.
        const reference = payload.reference ? { ...payload.reference, ...(this.calibrationFor(payload.reference.filePath) ? { calibration: this.calibrationFor(payload.reference.filePath) } : {}) } : undefined;
        return this.request('scan', { ...payload, ...(calibration ? { calibration } : {}), ...(reference ? { reference } : {}) });
    }

    /**
     * One request of the figure service (python-backend/figures/), as the webview's answers/ sent it, under `requestId`
     * (the backend's request id, so a superseded draw is stopped by it: abandonRequests).
     */
    figure<K extends FigureCommand>(command: K, payload: BackendPayload<K>, requestId?: string): Promise<BackendResult<K>> {
        return this.request(command, payload, requestId);
    }

    /** Gives up on these requests if they still run: Python drops a queued one and sends no reply for a running one. */
    abandonRequests(requestIds: readonly string[]): void {
        for (const requestId of requestIds) this.abandonRequest(requestId);
    }

    protected abandonRequest(_requestId: string): void {}

    protected calibrationPayload(context: CalibrationRequestContext): CalibrationRequestContext {
        return {
            ...(context.calibrationProfile ? { calibrationProfile: context.calibrationProfile } : {}),
            analysisRevision: context.analysisRevision ?? 0,
        };
    }

}

export type LazyAnalysisRequest = TrackDetailRequest | SpectrumSliceRequest;
export type LazyAnalysisBackend = Pick<AnalysisClient, 'requestTrackAnswers' | 'requestCursorAnswers' | 'requestPairAnswers' | 'requestRegionPeak'>;

export async function executeLazyAnalysis(
    backend: LazyAnalysisBackend,
    message: LazyAnalysisRequest,
    context: CalibrationRequestContext & { stftOptions?: StftOptions },
    cancellation?: AnalysisCancellationSignal,
) {
    if (message.type === 'request-spectrum-slice') {
        // The answers are kept by key for the figure service: the reply names them and carries no value.
        const kept = await backend.requestCursorAnswers(message.filePath,
            { ...context, cursorNorm: message.cursorNorm, scale: message.answers, sourceVersion: message.sourceVersion,
                ...(message.bandsPerOctave ? { bandsPerOctave: message.bandsPerOctave } : {}) }, message.requestId, cancellation);
        return { type: 'cursor-answers-result' as const, requestId: message.requestId, analysisId: message.analysisId,
            settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath,
            sourceVersion: kept.sourceVersion, stftSignature: kept.stftSignature, analysisRevision: kept.analysisRevision,
            cursorNorm: message.cursorNorm, scale: message.answers, channels: kept.channels,
            windowStartNorm: kept.windowStartNorm, windowEndNorm: kept.windowEndNorm, window: kept.window,
            ...(kept.bandsPerOctave ? { bandsPerOctave: kept.bandsPerOctave } : {}) };
    }
    // The row's answers are kept by key for the figure service: the reply names them and carries no value.
    const timed = message.startNorm !== undefined && message.endNorm !== undefined ? { startNorm: message.startNorm, endNorm: message.endNorm } : {};
    const kept = await backend.requestTrackAnswers(message.filePath,
        { ...context, scale: message.answers, ...timed, ...(message.spectrogram === false ? { spectrogram: false } : {}), ...(message.extents === true ? { extents: true } : {}), sourceVersion: message.sourceVersion },
        message.requestId, cancellation);
    return { type: 'track-answers-result' as const, requestId: message.requestId, analysisId: message.analysisId,
        settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath,
        sourceVersion: kept.sourceVersion, stftSignature: kept.stftSignature, analysisRevision: kept.analysisRevision,
        scale: message.answers, ...timed, channels: kept.channels, sampleRateHz: kept.sampleRateHz, durationSeconds: kept.durationSeconds,
        windowSize: kept.windowSize, hopSize: kept.hopSize, windowed: kept.windowed, ...(kept.noLevels ? { noLevels: kept.noLevels } : {}) };
}

export function lazyAnalysisError(message: TrackDetailRequest | SpectrumSliceRequest, reason: string) {
    return { requestId: message.requestId, analysisId: message.analysisId,
        settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath,
        ...versionPayload(message.sourceVersion),
        type: message.type === 'request-track-detail' ? 'track-detail-error' as const : 'spectrum-slice-error' as const,
        error: reason,
        ...(message.type === 'request-track-detail' && message.startNorm !== undefined && message.endNorm !== undefined
            ? { startNorm: message.startNorm, endNorm: message.endNorm } : {}) };
}

export function analysisPayload(filePath: string, options: AnalyzeOptions): AnalyzePayload {
    return { filePath, ...(options.stftOptions ? { stftOptions: options.stftOptions } : {}),
        ...(options.calibrationProfile ? { calibrationProfile: options.calibrationProfile } : {}),
        analysisRevision: options.analysisRevision ?? 0 };
}
