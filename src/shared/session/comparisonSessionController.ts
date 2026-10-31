import { executeLazyAnalysis, lazyAnalysisError, RequestCancellation, type AnalysisClient, type LazyAnalysisBackend, type LazyAnalysisRequest } from '../analysis/analysisClient';
import type {
    AnalysisResultWithError,
    AnalysisUpdateMessage,
    ComparisonPanelReadyMessage,
    SpectrogramSettings,
    StftOptions,
} from '../analysis/analysisTypes';
import { saveSession, runCompareScan, runEntryProbe, runEntryScan, type ComparePublication, type EntryProbePublication, type EntryPublication, type EntryScanPorts } from '../analysis/entryScan';
import type { CalibrationRequestContext, PairSpectrumResult } from '../protocol/backendProtocol';
import { parsePanelMessage, type PanelMessage, type SaveRecipeMessage } from '../protocol/panelMessages';
import type { AnalyzeSelectedFilesMessage, ExportReportOptionsMessage, ExportWavLoopMessage, PairSpectrumRequest, SelectionTargetKind } from '../utils/audioTarget';
import { exportWavRegions, reportArtifact, type ReportFormat, type WavExportSink, type WavExportSource } from '../utils/exportArtifact';

type LazyPublication = Awaited<ReturnType<typeof executeLazyAnalysis>> | ReturnType<typeof lazyAnalysisError>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Messages the shared controller publishes to the Comparison Webview runtime. */
export type SessionPublication =
    | AnalysisUpdateMessage
    | { type: 'reanalyze-start'; count: number }
    | { type: 'reanalyze-end' }
    | DistributiveOmit<LazyPublication, 'analysisRevision'>
    | PairSpectrumPublication
    | EntryPublication
    | EntryProbePublication
    | ComparePublication;

export type PairSpectrumPublication =
    | ({ type: 'pair-spectrum-result'; requestId: string } & Omit<PairSpectrumResult, 'analysisRevision' | 'calibrationSignature'>)
    | { type: 'pair-spectrum-error'; requestId: string; analysisId: string; settingsSignature: string; error: string };

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
    client: LazyAnalysisBackend & Pick<AnalysisClient, 'buildRecipe'>;
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
    /** Saves a `.recipe.json` built from the bottom panel; the user may still cancel the destination. */
    saveRecipe(file: ReportArtifactFile): Promise<void>;
    selectTarget(targetKind: SelectionTargetKind): Promise<void> | void;
    showInformation(message: string): void;
    showError(message: string): void;
    unsupported(type: PanelMessage['type']): void;
    selection?(message: AnalyzeSelectedFilesMessage): Promise<void>;
    panelReady?(message: ComparisonPanelReadyMessage): Promise<void>;
    selectPythonEnvironment?(): Promise<void>;
    runRecipe?(scope: SessionScope): Promise<void>;
    /** Writes the comparison's report as one folder; the user may still cancel the destination. */
    saveReportFolder?(folder: string, files: Array<{ name: string; bytes: Uint8Array }>): Promise<void>;
    /** The entry table's scan and storage; a host without it routes entry messages to `unsupported`. */
    entry?: EntryScanPorts;
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
    /** Advanced by every entry scan, so an older scan stops before its next file. */
    private entryScans = 0;
    private entryProbes = 0;
    /**
     * The latest comparison scan per source (a request id's prefix: 'track-stage', 'entry-hold', 'row', ...): a newer
     * one from the same source supersedes it; another source's (the side panel's table beside the comparison) does not.
     */
    private readonly compareScans = new Map<string, number>();
    private compareScanCount = 0;
    /**
     * The lazy request in flight per kind and track. The Webview keeps one per slot and drops the answer to an
     * older one, so a newer request cancels the older before the backend spends time on it.
     */
    private readonly lazyInFlight = new Map<string, RequestCancellation>();

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
                case 'request-pair-spectrum': await this.pair(message, scope); return;
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
                    if (this.ports.runRecipe) await this.ports.runRecipe(scope); else this.ports.unsupported(message.type);
                    return;
                case 'save-recipe': await this.saveRecipe(message); return;
                case 'entry-scan': {
                    const entry = this.ports.entry;
                    if (!entry) { this.ports.unsupported(message.type); return; }
                    const scan = ++this.entryScans;
                    await runEntryScan(entry, message, publication => this.ports.publish(publication),
                        () => scan === this.entryScans && scope.isCurrent());
                    return;
                }
                case 'entry-probe': {
                    const entry = this.ports.entry;
                    if (!entry) { this.ports.unsupported(message.type); return; }
                    const probe = ++this.entryProbes;
                    await runEntryProbe(entry, message, publication => this.ports.publish(publication), () => probe === this.entryProbes && scope.isCurrent());
                    return;
                }
                case 'entry-probe-cancel': this.entryProbes++; return;
                case 'compare-scan': {
                    const entry = this.ports.entry;
                    if (!entry) { this.ports.unsupported(message.type); return; }
                    const source = message.requestId.replace(/-[^-]*$/, '');
                    const scan = ++this.compareScanCount;
                    this.compareScans.set(source, scan);
                    await runCompareScan(entry, message, publication => this.ports.publish(publication),
                        () => this.compareScans.get(source) === scan && scope.isCurrent());
                    return;
                }
                case 'save-report-folder':
                    if (!this.ports.saveReportFolder) { this.ports.unsupported(message.type); return; }
                    await this.ports.saveReportFolder(message.folder, message.files.map(file => ({
                        name: file.name,
                        bytes: file.base64 !== undefined ? Uint8Array.from(atob(file.base64), char => char.charCodeAt(0)) : new TextEncoder().encode(file.text),
                    })));
                    return;
                // The running entry scan stops after its current file: a newer scan number makes it stale.
                case 'entry-scan-cancel': this.entryScans++; return;
                case 'entry-save-session':
                    if (this.ports.entry) await saveSession(this.ports.entry, message);
                    else this.ports.unsupported(message.type);
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
        const slot = `${request.type}\u0000${request.trackIndex}\u0000${request.filePath}`;
        const cancellation = new RequestCancellation();
        this.lazyInFlight.get(slot)?.cancel();
        this.lazyInFlight.set(slot, cancellation);
        try {
            context = this.ports.lazyContext(request.filePath);
            if (!context) return;
            const { analysisRevision, ...result } = await executeLazyAnalysis(this.ports.client, request, {
                ...context, stftOptions: this.ports.stftOptions(),
            }, cancellation);
            if (scope.canPublish(request.filePath, analysisRevision)) { const pending = this.ports.publish(result); if (thenable(pending)) await pending; }
        } catch (error) {
            if (cancellation.isCancellationRequested) return;
            if (!scope.canPublish(request.filePath, context?.analysisRevision)) return;
            this.ports.lazyFailed?.(request, reasonOf(error));
            if (request.type !== 'request-waveform-range') { const pending = this.ports.publish(lazyAnalysisError(request, error)); if (thenable(pending)) await pending; }
        } finally {
            if (this.lazyInFlight.get(slot) === cancellation) this.lazyInFlight.delete(slot);
        }
    }

    private async pair(request: PairSpectrumRequest, scope: SessionScope): Promise<void> {
        const sources = [request.reference, ...request.responses];
        const contexts = new Map<string, CalibrationRequestContext>();
        try {
            for (const source of sources) {
                const context = this.ports.lazyContext(source.filePath);
                if (!context) return;
                contexts.set(source.filePath, context);
            }
            const { analysisRevision: referenceRevision, calibrationSignature: _signature, ...result } = await this.ports.client.requestPairSpectrum(
                { ...request, stftOptions: this.ports.stftOptions() }, contexts, request.requestId,
            );
            const revisions = new Map(result.responses.map(response => [response.filePath, response.analysisRevision]));
            revisions.set(result.filePath, referenceRevision);
            if (![...revisions].every(([filePath, revision]) => scope.canPublish(filePath, revision))) return;
            const pending = this.ports.publish({ type: 'pair-spectrum-result', requestId: request.requestId, ...result });
            if (thenable(pending)) await pending;
        } catch (error) {
            if (!sources.every(source => scope.canPublish(source.filePath, contexts.get(source.filePath)?.analysisRevision))) return;
            const pending = this.ports.publish({ type: 'pair-spectrum-error', requestId: request.requestId,
                analysisId: request.analysisId, settingsSignature: request.settingsSignature, error: reasonOf(error) });
            if (thenable(pending)) await pending;
        }
    }

    private async exportWav(message: ExportWavLoopMessage, scope: SessionScope): Promise<void> {
        const plan = await this.ports.wavExport(message, scope);
        if (!plan) return;
        await exportWavRegions(message, plan.sources, plan.sink);
        if (scope.isCurrent()) { const pending = plan.complete?.(); if (thenable(pending)) await pending; }
    }

    private async saveRecipe({ type: _type, ...analysis }: SaveRecipeMessage): Promise<void> {
        // Like pair requests, every named file must be one the host still displays.
        const paths = [analysis.filePath, ...(analysis.responses ?? []).map(source => source.filePath)];
        if (!paths.every(filePath => this.ports.lazyContext(filePath))) return;
        const stftOptions = this.ports.stftOptions();
        const built = await this.ports.client.buildRecipe({ ...analysis, ...(stftOptions ? { stftOptions } : {}) });
        await this.ports.saveRecipe({
            name: `${built.name}.recipe.json`, content: JSON.stringify(built.recipe, null, 2) + '\n', type: 'application/json',
        });
    }

    private async exportReport(message: ExportReportOptionsMessage): Promise<void> {
        const format = await this.ports.pickReportFormat();
        if (!format) return;
        await this.ports.saveReport(reportArtifact(message, format), format, message);
    }
}
