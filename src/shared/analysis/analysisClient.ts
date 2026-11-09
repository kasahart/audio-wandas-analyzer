import type { StftOptions } from './analysisTypes';
import type {
    AnalyzePayload, BackendCommand, BuildRecipePayload, BuildRecipeResult, BackendPayload, ScanPayload, ScanResult, StageCombinePayload, StageCombineResult, BackendResult,
    CalibrationRequestContext, PairSpectrumResult, RangeResult, SpectrumSlicePayload, SpectrumSliceResult, StageRead,
    TrackDetailPayload, TrackDetailResult, ExportWavLoopResult,
} from '../protocol/backendProtocol';
import type { PairSourceRef, PairSpectrumRequest, SpectrumSliceRequest, TrackDetailRequest, WaveformRangeRequest } from '../utils/audioTarget';

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

    async requestRange(
        filePath: string,
        startNorm: number,
        endNorm: number,
        points: number,
        requestId?: string,
        calibration: CalibrationRequestContext = {},
        cancellation?: AnalysisCancellationSignal,
        read?: StageRead,
        sourceVersion?: string,
    ): Promise<RangeResult> {
        return this.request(
            'range',
            { filePath, startNorm, endNorm, points, ...(read ? { read } : {}), ...versionPayload(sourceVersion),
                ...this.calibrationPayload(this.requestContext(filePath, calibration)) },
            requestId,
            cancellation,
        );
    }

    async requestTrackDetail(
        filePath: string,
        payload: Omit<TrackDetailPayload, 'filePath'>,
        requestId: string,
        cancellation?: AnalysisCancellationSignal,
    ): Promise<TrackDetailResult> {
        return this.request(
            'track-detail',
            {
                filePath,
                trackIndex: payload.trackIndex,
                analysisId: payload.analysisId,
                settingsSignature: payload.settingsSignature,
                ...(payload.stftOptions ? { stftOptions: payload.stftOptions } : {}),
                ...(payload.startNorm !== undefined && payload.endNorm !== undefined ? { startNorm: payload.startNorm, endNorm: payload.endNorm } : {}),
                ...(payload.lowHz !== undefined && payload.highHz !== undefined ? { lowHz: payload.lowHz, highHz: payload.highHz } : {}),
                ...(payload.read ? { read: payload.read } : {}),
                ...versionPayload(payload.sourceVersion),
                ...this.calibrationPayload(this.requestContext(filePath, payload)),
            },
            requestId,
            cancellation,
        );
    }

    async releaseTrackDetail(filePath: string): Promise<void> {
        await this.request('release-track-detail', { filePath });
    }

    async requestSpectrumSlice(
        filePath: string,
        payload: Omit<SpectrumSlicePayload, 'filePath'>,
        requestId: string,
        cancellation?: AnalysisCancellationSignal,
    ): Promise<SpectrumSliceResult> {
        return this.request(
            'spectrum-slice',
            {
                filePath,
                trackIndex: payload.trackIndex,
                analysisId: payload.analysisId,
                settingsSignature: payload.settingsSignature,
                cursorNorm: payload.cursorNorm,
                ...(payload.bandsPerOctave ? { bandsPerOctave: payload.bandsPerOctave } : {}),
                ...(payload.fullResolution ? { fullResolution: true } : {}),
                ...(payload.stftOptions ? { stftOptions: payload.stftOptions } : {}),
                ...versionPayload(payload.sourceVersion),
                ...this.calibrationPayload(this.requestContext(filePath, payload)),
            },
            requestId,
            cancellation,
        );
    }

    async requestPairSpectrum(
        request: Omit<PairSpectrumRequest, 'type' | 'requestId'> & { stftOptions?: StftOptions },
        contexts: ReadonlyMap<string, CalibrationRequestContext>,
        requestId: string,
    ): Promise<PairSpectrumResult> {
        const source = ({ sourceVersion, ...ref }: PairSourceRef) => ({
            ...ref, ...versionPayload(sourceVersion), ...this.calibrationPayload(this.requestContext(ref.filePath, contexts.get(ref.filePath) ?? {})),
        });
        return this.request(
            'pair-spectrum',
            {
                analysisId: request.analysisId,
                settingsSignature: request.settingsSignature,
                reference: source(request.reference),
                responses: request.responses.map(source),
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

    /** One file's entry-table metrics, under the calibration the host keeps for it. */
    scan(payload: ScanPayload): Promise<ScanResult> {
        const calibration = payload.calibration ?? this.calibrationFor(payload.filePath);
        // The recording a step is measured against is calibrated as its own.
        const reference = payload.reference ? { ...payload.reference, ...(this.calibrationFor(payload.reference.filePath) ? { calibration: this.calibrationFor(payload.reference.filePath) } : {}) } : undefined;
        return this.request('scan', { ...payload, ...(calibration ? { calibration } : {}), ...(reference ? { reference } : {}) });
    }

    /** A base group's median and a recording's difference from it, from the values its scans kept (stage_combine.py). */
    stageCombine(payload: StageCombinePayload): Promise<StageCombineResult> {
        return this.request('stage-combine', payload);
    }

    protected calibrationPayload(context: CalibrationRequestContext): CalibrationRequestContext {
        return {
            ...(context.calibrationProfile ? { calibrationProfile: context.calibrationProfile } : {}),
            analysisRevision: context.analysisRevision ?? 0,
        };
    }

}

export type LazyAnalysisRequest = WaveformRangeRequest | TrackDetailRequest | SpectrumSliceRequest;
export type LazyAnalysisBackend = Pick<AnalysisClient, 'requestRange' | 'requestTrackDetail' | 'requestSpectrumSlice' | 'requestPairSpectrum'>;

export async function executeLazyAnalysis(
    backend: LazyAnalysisBackend,
    message: LazyAnalysisRequest,
    context: CalibrationRequestContext & { stftOptions?: StftOptions },
    cancellation?: AnalysisCancellationSignal,
) {
    if (message.type === 'request-waveform-range') {
        const result = await backend.requestRange(message.filePath, message.startNorm, message.endNorm, message.points, message.requestId, context, cancellation, message.read, message.sourceVersion);
        return { type: 'waveform-range-result' as const, analysisRevision: result.analysisRevision, sourceVersion: result.sourceVersion, requestId: message.requestId,
            trackIndex: message.trackIndex, startNorm: message.startNorm, endNorm: message.endNorm, channels: result.channels, ...(result.points ? { points: result.points } : {}) };
    }
    const payload = { trackIndex: message.trackIndex, analysisId: message.analysisId,
        settingsSignature: message.settingsSignature, ...context, sourceVersion: message.sourceVersion };
    const window = message.type === 'request-track-detail' && message.startNorm !== undefined && message.endNorm !== undefined
        ? { startNorm: message.startNorm, endNorm: message.endNorm } : undefined;
    const band = message.type === 'request-track-detail' && message.lowHz !== undefined && message.highHz !== undefined
        ? { lowHz: message.lowHz, highHz: message.highHz } : undefined;
    const read = message.type === 'request-track-detail' && message.read ? { read: message.read } : undefined;
    const result = message.type === 'request-track-detail'
        ? await backend.requestTrackDetail(message.filePath, { ...payload, ...window, ...band, ...read }, message.requestId, cancellation)
        : await backend.requestSpectrumSlice(message.filePath,
            { ...payload, cursorNorm: message.cursorNorm, ...(message.bandsPerOctave ? { bandsPerOctave: message.bandsPerOctave } : {}),
                ...(message.fullResolution ? { fullResolution: true } : {}) }, message.requestId, cancellation);
    const identity = { requestId: message.requestId, analysisId: message.analysisId,
        settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath, sourceVersion: result.sourceVersion,
        ...(result.stftSignature !== undefined ? { stftSignature: result.stftSignature } : {}) };
    if ('frequencyBins' in result) {
        return { ...identity, analysisRevision: result.analysisRevision, type: 'spectrum-slice-result' as const, channels: result.channels,
            frequencyBins: result.frequencyBins, maxFrequencyHz: result.maxFrequencyHz, computeMs: result.computeMs,
            windowStartNorm: result.windowStartNorm, windowEndNorm: result.windowEndNorm, window: result.window,
            ...(result.bandCentersHz ? { bandsPerOctave: result.bandsPerOctave, bandCentersHz: result.bandCentersHz, minFrequencyHz: result.minFrequencyHz } : {}),
            ...(result.frequenciesHz ? { frequenciesHz: result.frequenciesHz } : {}),
            ...(message.type === 'request-spectrum-slice' ? { cursorNorm: message.cursorNorm } : {}) };
    }
    return { ...identity, analysisRevision: result.analysisRevision, type: 'track-detail-result' as const, channels: result.channels, ...window, ...(result.points ? { points: result.points } : {}) };
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
