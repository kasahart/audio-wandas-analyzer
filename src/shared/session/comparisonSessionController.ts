import { executeLazyAnalysis, lazyAnalysisError, type LazyAnalysisBackend, type LazyAnalysisRequest } from '../analysis/analysisClient';
import type {
    AnalysisResultWithError,
    AnalysisUpdateMessage,
    ComparisonPanelReadyMessage,
    SpectrogramSettings,
    StftOptions,
} from '../analysis/analysisTypes';
import type { CalibrationRequestContext } from '../protocol/backendProtocol';
import { parsePanelMessage, type PanelMessage } from '../protocol/panelMessages';
import type { AnalyzeSelectedFilesMessage, ExportReportOptionsMessage, ExportWavLoopMessage, SelectionTargetKind } from '../utils/audioTarget';
import { exportWavRegions, reportArtifact, type ReportFormat, type WavExportSink, type WavExportSource } from '../utils/exportArtifact';

type LazyPublication = Awaited<ReturnType<typeof executeLazyAnalysis>> | ReturnType<typeof lazyAnalysisError>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Messages the shared controller publishes to the Comparison Webview runtime. */
export type SessionPublication =
    | AnalysisUpdateMessage
    | { type: 'reanalyze-start'; count: number }
    | { type: 'reanalyze-end' }
    | DistributiveOmit<LazyPublication, 'analysisRevision'>;

/** Publication validity captured when one panel message starts. */
export interface SessionScope {
    /** False once a newer request, source removal, clear or dispose supersedes this message. */
    isCurrent(): boolean;
    /** Whether a lazy result for `filePath` computed against `analysisRevision` may still be shown. */
    canPublish(filePath: string, analysisRevision: number | undefined): boolean;
}

export interface WavExportPlan {
    sources: WavExportSource[];
    sink: WavExportSink;
    /** Runs after every region settled, e.g. to summarize or download an archive. */
    complete?(): Promise<void> | void;
}

export interface ReportArtifactFile { name: string; content: string; type: string }

/**
 * Host-specific ports behind the shared Comparison panel protocol. The VS Code
 * extension binds them to dialogs, workspace state and the Python child
 * process; the static Web host binds them to `<input type=file>`, localStorage
 * and the Pyodide Worker. Optional members are host features: a missing one
 * routes the message to `unsupported`.
 */
export interface ComparisonSessionPorts {
    scope(message: PanelMessage): SessionScope;
    publish(message: SessionPublication): void | PromiseLike<unknown>;
    saveSettings(settings: SpectrogramSettings): void | PromiseLike<void>;
    /** STFT options for lazy requests: the persisted explicit settings, or undefined in auto mode. */
    stftOptions(): StftOptions | undefined;
    client: LazyAnalysisBackend;
    /** Displayed calibration context for `filePath`; undefined ignores the request, throwing reports it. */
    lazyContext(filePath: string): CalibrationRequestContext | undefined;
    lazyFailed?(request: LazyAnalysisRequest, reason: string): void;
    releaseTrackDetail(filePath: string): PromiseLike<unknown> | void;
    /** Paths currently shown; an empty list skips reanalysis entirely. */
    activeFilePaths(): string[];
    /** Recompute every active source and return the results to publish, or undefined to publish nothing. */
    reanalyze(stftOptions: StftOptions | undefined, scope: SessionScope): Promise<AnalysisResultWithError[] | undefined>;
    /** Destination and sink for a WAV region export; undefined when the user cancelled. */
    wavExport(message: ExportWavLoopMessage, scope: SessionScope): Promise<WavExportPlan | undefined>;
    pickReportFormat(): Promise<ReportFormat | undefined>;
    saveReport(artifact: ReportArtifactFile, format: ReportFormat, message: ExportReportOptionsMessage): Promise<void>;
    selectTarget(targetKind: SelectionTargetKind): Promise<void> | void;
    showInformation(message: string): void;
    showError(message: string): void;
    unsupported(type: PanelMessage['type']): void;
    selection?(message: AnalyzeSelectedFilesMessage): Promise<void>;
    panelReady?(message: ComparisonPanelReadyMessage): Promise<void>;
    selectPythonEnvironment?(): Promise<void>;
    runRecipe?(): Promise<void>;
}

export function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Synchronous ports keep the message pipeline synchronous: a host that stores settings in memory and
// posts straight to a Worker observes the backend command in the same tick, as before sharing.
function thenable(value: unknown): value is PromiseLike<unknown> {
    return !!value && typeof (value as PromiseLike<unknown>).then === 'function';
}

/**
 * Interprets Comparison panel messages once for every host. Everything a host
 * decides (ownership, cancellation, storage, dialogs, transports) arrives
 * through {@link ComparisonSessionPorts}; the sequencing, generation gating,
 * lazy result conversion and export planning live here.
 */
export class ComparisonSessionController {
    constructor(private readonly ports: ComparisonSessionPorts) {}

    /** Parses and handles one raw Webview message; unknown shapes are ignored. */
    async dispatch(raw: unknown): Promise<void> {
        const message = parsePanelMessage(raw);
        if (!message) return;
        await this.handle(message);
    }

    async handle(message: PanelMessage): Promise<void> {
        const scope = this.ports.scope(message);
        if (!scope.isCurrent()) return;
        try {
            switch (message.type) {
                case 'update-spectrogram-settings': { const pending = this.ports.saveSettings(message.settings); if (thenable(pending)) await pending; } return;
                case 'request-reanalyze': await this.reanalyze(message.settings, scope); return;
                case 'request-waveform-range': case 'request-track-detail': case 'request-spectrum-slice':
                    await this.lazy(message, scope); return;
                case 'release-track-detail': { const pending = this.ports.releaseTrackDetail(message.filePath); if (thenable(pending)) await pending; } return;
                case 'export-wav-loop': await this.exportWav(message, scope); return;
                case 'export-report-options': await this.exportReport(message); return;
                case 'select-target': { const pending = this.ports.selectTarget(message.targetKind); if (thenable(pending)) await pending; } return;
                case 'show-info': this.ports.showInformation(message.message); return;
                case 'analyze-selected-files':
                    if (this.ports.selection) await this.ports.selection(message); else this.ports.unsupported(message.type);
                    return;
                case 'comparison-panel-ready': await this.ports.panelReady?.(message); return;
                case 'select-python-environment':
                    if (this.ports.selectPythonEnvironment) await this.ports.selectPythonEnvironment(); else this.ports.unsupported(message.type);
                    return;
                case 'run-recipe':
                    if (this.ports.runRecipe) await this.ports.runRecipe(); else this.ports.unsupported(message.type);
                    return;
            }
        } catch (error) {
            if (scope.isCurrent()) this.ports.showError(reasonOf(error));
        }
    }

    private async reanalyze(settings: SpectrogramSettings, scope: SessionScope): Promise<void> {
        { const pending = this.ports.saveSettings(settings); if (thenable(pending)) await pending; }
        const count = this.ports.activeFilePaths().length;
        if (count === 0) return;
        { const pending = this.ports.publish({ type: 'reanalyze-start', count }); if (thenable(pending)) await pending; }
        try {
            const results = await this.ports.reanalyze(settings.auto ? undefined : settings.stft, scope);
            if (results && scope.isCurrent()) {
                { const pending = this.ports.publish({ type: 'analysis-update', results } satisfies AnalysisUpdateMessage); if (thenable(pending)) await pending; }
            }
        } finally {
            if (scope.isCurrent()) { const pending = this.ports.publish({ type: 'reanalyze-end' }); if (thenable(pending)) await pending; }
        }
    }

    private async lazy(request: LazyAnalysisRequest, scope: SessionScope): Promise<void> {
        let context: CalibrationRequestContext | undefined;
        try {
            context = this.ports.lazyContext(request.filePath);
            if (!context) return;
            const { analysisRevision, ...result } = await executeLazyAnalysis(this.ports.client, request, {
                ...context, stftOptions: this.ports.stftOptions(),
            });
            if (scope.canPublish(request.filePath, analysisRevision)) { const pending = this.ports.publish(result); if (thenable(pending)) await pending; }
        } catch (error) {
            if (!scope.canPublish(request.filePath, context?.analysisRevision)) return;
            this.ports.lazyFailed?.(request, reasonOf(error));
            if (request.type !== 'request-waveform-range') { const pending = this.ports.publish(lazyAnalysisError(request, error)); if (thenable(pending)) await pending; }
        }
    }

    private async exportWav(message: ExportWavLoopMessage, scope: SessionScope): Promise<void> {
        const plan = await this.ports.wavExport(message, scope);
        if (!plan) return;
        await exportWavRegions(message, plan.sources, plan.sink);
        if (scope.isCurrent()) { const pending = plan.complete?.(); if (thenable(pending)) await pending; }
    }

    private async exportReport(message: ExportReportOptionsMessage): Promise<void> {
        const format = await this.ports.pickReportFormat();
        if (!format) return;
        await this.ports.saveReport(reportArtifact(message, format), format, message);
    }
}
