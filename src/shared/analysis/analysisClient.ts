import type { StftOptions } from './analysisTypes';
import type {
    AnalyzePayload, BackendCommand, BackendPayload, BackendResult,
    CalibrationRequestContext, RangeResult, SpectrumSlicePayload, SpectrumSliceResult,
    TrackDetailPayload, TrackDetailResult, ExportWavLoopResult, RunRecipePayload, RunRecipeResult,
} from '../protocol/backendProtocol';
import type { SpectrumSliceRequest, TrackDetailRequest, WaveformRangeRequest } from '../utils/audioTarget';

export type AnalyzeOptions = Omit<AnalyzePayload, 'filePath'>;

export interface AnalysisContextPolicy {
    current(filePath: string): CalibrationRequestContext;
    discardStale?(filePath: string, error: unknown, attempted: CalibrationRequestContext): Promise<boolean>;
}

export interface AnalysisCancellationSignal {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface RecipeExecutionOptions {
    recipePath?: string;
    cancellation?: AnalysisCancellationSignal;
}

export abstract class AnalysisClient {
    constructor(private readonly contextPolicy?: AnalysisContextPolicy) {}

    private nextRecipeId = 0;
    protected recipeTimeoutMs = 120_000;
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
    ): Promise<RangeResult> {
        return this.request(
            'range',
            { filePath, startNorm, endNorm, points, ...this.calibrationPayload(this.requestContext(filePath, calibration)) },
            requestId,
        );
    }

    async requestTrackDetail(
        filePath: string,
        payload: Omit<TrackDetailPayload, 'filePath'>,
        requestId: string,
    ): Promise<TrackDetailResult> {
        return this.request(
            'track-detail',
            {
                filePath,
                trackIndex: payload.trackIndex,
                analysisId: payload.analysisId,
                settingsSignature: payload.settingsSignature,
                ...(payload.stftOptions ? { stftOptions: payload.stftOptions } : {}),
                ...this.calibrationPayload(this.requestContext(filePath, payload)),
            },
            requestId,
        );
    }

    async releaseTrackDetail(filePath: string): Promise<void> {
        await this.request('release-track-detail', { filePath });
    }

    async requestSpectrumSlice(
        filePath: string,
        payload: Omit<SpectrumSlicePayload, 'filePath'>,
        requestId: string,
    ): Promise<SpectrumSliceResult> {
        return this.request(
            'spectrum-slice',
            {
                filePath,
                trackIndex: payload.trackIndex,
                analysisId: payload.analysisId,
                settingsSignature: payload.settingsSignature,
                cursorNorm: payload.cursorNorm,
                ...(payload.stftOptions ? { stftOptions: payload.stftOptions } : {}),
                ...this.calibrationPayload(this.requestContext(filePath, payload)),
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

    async runRecipe(recipe: RunRecipePayload['recipe'], options: RecipeExecutionOptions = {}): Promise<RunRecipeResult> {
        const cancellation = options.cancellation;
        if (cancellation?.isCancellationRequested) throw new Error('Recipe execution cancelled');
        const inputContexts = Object.fromEntries((recipe.inputs ?? []).map(input => [
            input.name, this.calibrationPayload(this.requestContext(input.file, {})),
        ]));
        const requestId = `recipe-${++this.nextRecipeId}`;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let disposable: { dispose(): void } | undefined;
        let cancelled = false;
        const cancellationListeners = new Set<() => void>();
        const requestCancellation: AnalysisCancellationSignal = {
            get isCancellationRequested() { return cancelled; },
            onCancellationRequested: listener => {
                cancellationListeners.add(listener);
                return { dispose: () => { cancellationListeners.delete(listener); } };
            },
        };
        const interrupted = new Promise<never>((_resolve, reject) => {
            const interrupt = (error: Error): void => {
                cancelled = true;
                reject(error);
                cancellationListeners.forEach(listener => listener());
                this.cancelRequest(requestId, error);
            };
            timer = setTimeout(() => interrupt(new Error(`Recipe execution timed out after ${this.recipeTimeoutMs} ms`)), this.recipeTimeoutMs);
            if (cancellation) {
                const cancel = (): void => { interrupt(new Error('Recipe execution cancelled')); };
                disposable = cancellation.onCancellationRequested(cancel);
                if (cancellation.isCancellationRequested) cancel();
            }
        });
        try {
            if (cancelled) return await interrupted;
            return await Promise.race([
                interrupted,
                this.request('run-recipe', {
                    recipe, inputContexts, ...(options.recipePath ? { recipePath: options.recipePath } : {}),
                }, requestId, requestCancellation),
            ]);
        } finally {
            clearTimeout(timer);
            disposable?.dispose();
        }
    }

    protected calibrationPayload(context: CalibrationRequestContext): CalibrationRequestContext {
        return {
            ...(context.calibrationProfile ? { calibrationProfile: context.calibrationProfile } : {}),
            analysisRevision: context.analysisRevision ?? 0,
        };
    }

}

export type LazyAnalysisRequest = WaveformRangeRequest | TrackDetailRequest | SpectrumSliceRequest;
export type LazyAnalysisBackend = Pick<AnalysisClient, 'requestRange' | 'requestTrackDetail' | 'requestSpectrumSlice'>;

export async function executeLazyAnalysis(
    backend: LazyAnalysisBackend,
    message: LazyAnalysisRequest,
    context: CalibrationRequestContext & { stftOptions?: StftOptions },
) {
    if (message.type === 'request-waveform-range') {
        const result = await backend.requestRange(message.filePath, message.startNorm, message.endNorm, message.points, message.requestId, context);
        return { type: 'waveform-range-result' as const, analysisRevision: result.analysisRevision, requestId: message.requestId,
            trackIndex: message.trackIndex, startNorm: message.startNorm, endNorm: message.endNorm, channels: result.channels };
    }
    const payload = { trackIndex: message.trackIndex, analysisId: message.analysisId,
        settingsSignature: message.settingsSignature, ...context };
    const result = message.type === 'request-track-detail'
        ? await backend.requestTrackDetail(message.filePath, payload, message.requestId)
        : await backend.requestSpectrumSlice(message.filePath, { ...payload, cursorNorm: message.cursorNorm }, message.requestId);
    const identity = { requestId: message.requestId, analysisId: message.analysisId,
        settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath };
    if ('frequencyBins' in result) {
        return { ...identity, analysisRevision: result.analysisRevision, type: 'spectrum-slice-result' as const, channels: result.channels,
            frequencyBins: result.frequencyBins, maxFrequencyHz: result.maxFrequencyHz, computeMs: result.computeMs,
            ...(message.type === 'request-spectrum-slice' ? { cursorNorm: message.cursorNorm } : {}) };
    }
    return { ...identity, analysisRevision: result.analysisRevision, type: 'track-detail-result' as const, channels: result.channels };
}

export function lazyAnalysisError(message: TrackDetailRequest | SpectrumSliceRequest, error: unknown) {
    return { requestId: message.requestId, analysisId: message.analysisId,
        settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath,
        type: message.type === 'request-track-detail' ? 'track-detail-error' as const : 'spectrum-slice-error' as const,
        error: error instanceof Error ? error.message : String(error) };
}

export function analysisPayload(filePath: string, options: AnalyzeOptions): AnalyzePayload {
    return { filePath, ...(options.stftOptions ? { stftOptions: options.stftOptions } : {}),
        ...(options.calibrationProfile ? { calibrationProfile: options.calibrationProfile } : {}),
        analysisRevision: options.analysisRevision ?? 0 };
}
