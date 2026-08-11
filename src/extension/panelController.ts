import * as vscode from 'vscode';
import {
    type AnalysisResultWithError,
    type AnalysisUpdateMessage,
    type ComparisonPanelReadyMessage,
    type RequestReanalyzeMessage,
    type SpectrogramSettings,
    type UpdateSpectrogramSettingsMessage,
} from '../shared/analysis/analysisTypes';
import {
    type AnalyzeSelectedFilesMessage,
    type SpectrumSliceRequest,
    type TrackDetailRequest,
    type WaveformRangeRequest,
} from '../shared/utils/audioTarget';
import {
    collectAudioFilePaths,
    collectSelectedResults,
    diffSelectedAudioFilePaths,
    sanitizeSelectedAudioFilePaths,
} from '../shared/utils/directorySelection';
import { ComparisonPanel } from '../webview/panels/ComparisonPanel';
import type { AnalysisOrchestrator } from './analysisOrchestrator';
import {
    getAnalysisRevision,
    onDidChangeCalibration,
    type CalibrationChangeEvent,
} from './calibrationStore';
import type { ExportFlows } from './exportFlows';
import { parsePanelMessage, type SelectTargetMessage } from './panelMessages';
import {
    PanelSession,
    type DirectorySelectionState,
    type DisposableLike,
    type PanelPort,
} from './panelSession';
import {
    getCurrentPythonEnvironmentState,
    onDidChangePythonEnvironmentState,
    type PythonEnvironmentState,
} from './pythonEnvironment';
import type { PythonBackendServer } from './pythonBackendServer';
import {
    loadPersistedStftOptions,
    loadSpectrogramSettings,
    saveSpectrogramSettings,
    type SpectrogramSettingsContext,
} from './spectrogramSettings';
import {
    buildDirectoryTree,
    pickAudioTarget,
    type OpenDialog,
    type TargetFileSystem,
} from './targetDiscovery';

export interface PanelBackend extends Pick<PythonBackendServer,
    | 'requestRange'
    | 'requestTrackDetail'
    | 'releaseTrackDetail'
    | 'requestSpectrumSlice'
    | 'exportWavLoop'> {}

export interface PanelAnalysis {
    analyzeFiles: AnalysisOrchestrator['analyzeFiles'];
    warmup(): void;
}

export interface PanelHandle extends PanelPort {
    onDidDispose(listener: () => unknown): DisposableLike;
}

export interface PanelFactory {
    showResults(
        extensionUri: vscode.Uri,
        results: AnalysisResultWithError[],
        existingPanel: PanelHandle | undefined,
        settings: SpectrogramSettings,
    ): PanelHandle;
    showDirectory(
        extensionUri: vscode.Uri,
        rootPath: string,
        allFilePaths: string[],
        selectedFilePaths: string[],
        results: AnalysisResultWithError[],
        environment: PythonEnvironmentState,
        existingPanel: PanelHandle | undefined,
        settings: SpectrogramSettings,
    ): PanelHandle;
}

export interface PanelControllerHost {
    fileSystem: TargetFileSystem;
    showOpenDialog: OpenDialog;
    executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
    showInformation(message: string): void;
    showError(message: string): void;
    getPythonEnvironment(): PythonEnvironmentState;
    onPythonEnvironmentChange(listener: (state: PythonEnvironmentState) => void): vscode.Disposable;
}

const defaultPanelFactory: PanelFactory = {
    showResults: (extensionUri, results, existingPanel, settings) => ComparisonPanel.show(
        extensionUri,
        results,
        existingPanel as vscode.WebviewPanel | undefined,
        settings,
    ),
    showDirectory: (
        extensionUri,
        rootPath,
        allFilePaths,
        selectedFilePaths,
        results,
        environment,
        existingPanel,
        settings,
    ) => ComparisonPanel.showDirectorySelection(
        extensionUri,
        rootPath,
        allFilePaths,
        selectedFilePaths,
        results,
        environment,
        existingPanel as vscode.WebviewPanel | undefined,
        settings,
    ),
};

const defaultHost: PanelControllerHost = {
    fileSystem: vscode.workspace.fs,
    showOpenDialog: (options) => vscode.window.showOpenDialog(options),
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    showInformation: (message) => { void vscode.window.showInformationMessage(message); },
    showError: (message) => { void vscode.window.showErrorMessage(message); },
    getPythonEnvironment: getCurrentPythonEnvironmentState,
    onPythonEnvironmentChange: onDidChangePythonEnvironmentState,
};

export class PanelController implements vscode.Disposable {
    private readonly sessions = new Map<PanelHandle, PanelSession<PanelHandle>>();
    private readonly calibrationRefreshQueues = new WeakMap<PanelSession<PanelHandle>, Promise<void>>();
    private readonly calibrationChangeDisposable: vscode.Disposable;

    constructor(
        private readonly context: SpectrogramSettingsContext & { extensionUri: vscode.Uri },
        private readonly backend: PanelBackend,
        private readonly analysis: PanelAnalysis,
        private readonly exports: ExportFlows,
        private readonly panelFactory: PanelFactory = defaultPanelFactory,
        private readonly host: PanelControllerHost = defaultHost,
    ) {
        this.calibrationChangeDisposable = onDidChangeCalibration((event) => {
            for (const session of this.sessions.values()) {
                if (!session.getActiveFilePaths().includes(event.filePath)) { continue; }
                void this.enqueueCalibrationRefresh(session, event).catch((error) => {
                    this.host.showError(error instanceof Error ? error.message : String(error));
                });
            }
        });
    }

    async analyzeTarget(
        targetUri: vscode.Uri,
        existingPanel?: PanelHandle,
        options: { autoSelectAllDirectoryFiles?: boolean } = {},
    ): Promise<void> {
        const existingSession = existingPanel ? this.sessions.get(existingPanel) : undefined;
        const revision = existingSession?.beginStateRequest();
        const targetStat = await this.host.fileSystem.stat(targetUri);
        if (existingSession && revision !== undefined && !existingSession.isCurrent(revision)) { return; }

        if ((targetStat.type & vscode.FileType.Directory) !== 0) {
            const tree = await buildDirectoryTree(targetUri, targetUri, this.host.fileSystem);
            if (existingSession && revision !== undefined && !existingSession.isCurrent(revision)) { return; }
            const filePaths = collectAudioFilePaths(tree);
            if (filePaths.length === 0) {
                throw new Error(`No supported audio files were found in ${targetUri.fsPath}`);
            }
            if (options.autoSelectAllDirectoryFiles) {
                await this.analyzeMultipleFiles(filePaths, existingPanel, revision);
                return;
            }
            const panel = this.panelFactory.showDirectory(
                this.context.extensionUri,
                targetUri.fsPath,
                filePaths,
                [],
                [],
                this.host.getPythonEnvironment(),
                existingPanel,
                loadSpectrogramSettings(this.context),
            );
            const session = this.ensureSession(panel);
            session.setDirectorySelection({
                rootPath: targetUri.fsPath,
                tree,
                allFilePaths: filePaths,
                selectedFilePaths: [],
                cachedResultsByFilePath: new Map(),
            });
            session.setActiveResults([]);
            this.postPythonEnvironmentState(session, this.host.getPythonEnvironment());
            return;
        }

        await this.analyzeMultipleFiles([targetUri.fsPath], existingPanel, revision);
    }

    async analyzeFiles(filePaths: string[], existingPanel?: PanelHandle): Promise<void> {
        const session = existingPanel ? this.sessions.get(existingPanel) : undefined;
        const revision = session?.beginStateRequest();
        await this.analyzeMultipleFiles(filePaths, existingPanel, revision);
    }

    getActiveFilePaths(panel: PanelHandle): string[] {
        return this.sessions.get(panel)?.getActiveFilePaths() ?? [];
    }

    dispose(): void {
        this.calibrationChangeDisposable.dispose();
        for (const session of this.sessions.values()) { session.dispose(); }
        this.sessions.clear();
    }

    private async analyzeMultipleFiles(
        filePaths: string[],
        existingPanel?: PanelHandle,
        expectedRevision?: number,
    ): Promise<void> {
        const existingSession = existingPanel ? this.sessions.get(existingPanel) : undefined;
        let results: AnalysisResultWithError[];
        try {
            results = await this.analysis.analyzeFiles(
                filePaths,
                loadPersistedStftOptions(this.context),
            );
        } catch (error) {
            if (error instanceof vscode.CancellationError) { return; }
            throw error;
        }
        if (existingSession && expectedRevision !== undefined
            && !existingSession.isCurrent(expectedRevision)) {
            return;
        }
        this.analysis.warmup();
        const panel = this.panelFactory.showResults(
            this.context.extensionUri,
            results,
            existingPanel,
            loadSpectrogramSettings(this.context),
        );
        const session = this.ensureSession(panel);
        session.clearDirectorySelection();
        session.setActiveResults(results.map((result) => result.filePath));
    }

    private ensureSession(panel: PanelHandle): PanelSession<PanelHandle> {
        const current = this.sessions.get(panel);
        if (current) { return current; }
        const session = new PanelSession(panel);
        this.sessions.set(panel, session);
        session.bindMessageListener(panel.webview.onDidReceiveMessage((message) => {
            void this.dispatchMessage(session, message).catch((error) => {
                this.host.showError(error instanceof Error ? error.message : String(error));
            });
        }));
        session.bindPythonEnvironment(this.host.onPythonEnvironmentChange((state) => {
            this.postPythonEnvironmentState(session, state);
        }));
        panel.onDidDispose(() => {
            session.dispose();
            this.sessions.delete(panel);
        });
        return session;
    }

    private async dispatchMessage(session: PanelSession<PanelHandle>, rawMessage: unknown): Promise<void> {
        const message = parsePanelMessage(rawMessage);
        if (!message || session.isDisposed) { return; }
        switch (message.type) {
            case 'analyze-selected-files': await this.handleSelection(session, message); break;
            case 'select-python-environment':
                await this.host.executeCommand('audioWandasAnalyzer.selectPythonEnvironment');
                break;
            case 'run-recipe':
                await this.host.executeCommand('audioWandasAnalyzer.runRecipe', session.getActiveFilePaths());
                break;
            case 'select-target': await this.handleSelectTarget(session, message); break;
            case 'update-spectrogram-settings':
                await saveSpectrogramSettings(this.context, message.settings);
                break;
            case 'comparison-panel-ready': await this.handlePanelReady(session, message); break;
            case 'request-reanalyze': await this.handleReanalyze(session, message); break;
            case 'request-waveform-range': this.handleWaveformRange(session, message); break;
            case 'request-track-detail': this.handleTrackDetail(session, message); break;
            case 'release-track-detail': void this.backend.releaseTrackDetail(message.filePath); break;
            case 'request-spectrum-slice': this.handleSpectrumSlice(session, message); break;
            case 'export-wav-loop': await this.exports.exportWavLoop(message); break;
            case 'export-report-options': await this.exports.exportReport(message); break;
            case 'show-info': this.host.showInformation(message.message); break;
        }
    }

    private async handleSelection(session: PanelSession<PanelHandle>, message: AnalyzeSelectedFilesMessage): Promise<void> {
        const selection = session.directorySelection;
        if (!selection) { return; }
        const selectedFilePaths = sanitizeSelectedAudioFilePaths(selection.tree, message.filePaths);
        const delta = diffSelectedAudioFilePaths(selection.selectedFilePaths, selectedFilePaths);
        const revision = session.beginStateRequest(message.requestId);
        selection.selectedFilePaths = selectedFilePaths;

        if (selectedFilePaths.length === 0) {
            if (session.isCurrent(revision, message.requestId)) { this.renderDirectorySession(session, selection, []); }
            return;
        }

        const newlyAdded = new Set(delta.addedFilePaths);
        const uncached = [
            ...delta.addedFilePaths.filter((filePath) => (
                !session.hasCachedResult(filePath, getAnalysisRevision(filePath))
            )),
            ...selectedFilePaths.filter((filePath) => {
                return !newlyAdded.has(filePath)
                    && !session.hasCachedResult(filePath, getAnalysisRevision(filePath));
            }),
        ];
        if (uncached.length > 0) {
            const newResults = await this.analysis.analyzeFiles(
                uncached,
                loadPersistedStftOptions(this.context),
            );
            if (session.isDisposed || session.directorySelection !== selection) { return; }
            for (const result of newResults) { selection.cachedResultsByFilePath.set(result.filePath, result); }
        }
        if (!session.isCurrent(revision, message.requestId)) { return; }
        this.analysis.warmup();
        this.renderDirectorySession(
            session,
            selection,
            collectSelectedResults(selection.selectedFilePaths, selection.cachedResultsByFilePath),
        );
    }

    private async handleSelectTarget(session: PanelSession<PanelHandle>, message: SelectTargetMessage): Promise<void> {
        const selected = await pickAudioTarget(message.targetKind, this.host.showOpenDialog);
        if (selected && !session.isDisposed) {
            await this.analyzeTarget(selected, session.panel);
        }
    }

    private async handleReanalyze(session: PanelSession<PanelHandle>, message: RequestReanalyzeMessage): Promise<void> {
        await saveSpectrogramSettings(this.context, message.settings);
        const filePaths = session.getActiveFilePaths();
        const revision = session.beginStateRequest();
        await session.postMessage({ type: 'reanalyze-start', count: filePaths.length });
        try {
            const results = await this.analysis.analyzeFiles(
                filePaths,
                message.settings.auto ? undefined : message.settings.stft,
                `Recomputing spectrogram (${filePaths.length} file${filePaths.length === 1 ? '' : 's'})`,
                session,
            );
            if (session.isCurrent(revision)) {
                const displayedByPath = new Map(
                    ComparisonPanel.getResults(session.panel).map((result) => [result.filePath, result]),
                );
                const acceptedResults = results.map((result) => {
                    const expectedRevision = getAnalysisRevision(result.filePath);
                    if (result.error || (result.analysisRevision ?? 0) === expectedRevision) {
                        return result;
                    }
                    return displayedByPath.get(result.filePath) ?? result;
                });
                session.cacheResults(acceptedResults);
                session.setActiveResults(acceptedResults.map((result) => result.filePath));
                ComparisonPanel.updateResults(session.panel, acceptedResults);
                await session.postMessage({
                    type: 'analysis-update',
                    results: acceptedResults,
                } satisfies AnalysisUpdateMessage);
            }
        } finally {
            if (session.isCurrent(revision)) { await session.postMessage({ type: 'reanalyze-end' }); }
        }
    }

    private enqueueCalibrationRefresh(
        session: PanelSession<PanelHandle>,
        message: CalibrationChangeEvent,
    ): Promise<void> {
        const previous = this.calibrationRefreshQueues.get(session) ?? Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(async () => this.handleCalibrationRefresh(session, message));
        this.calibrationRefreshQueues.set(session, current);
        const clearCurrent = (): void => {
            if (this.calibrationRefreshQueues.get(session) === current) {
                this.calibrationRefreshQueues.delete(session);
            }
        };
        void current.then(clearCurrent, clearCurrent);
        return current;
    }

    private async handleCalibrationRefresh(
        session: PanelSession<PanelHandle>,
        message: CalibrationChangeEvent,
    ): Promise<void> {
        if (!session.getActiveFilePaths().includes(message.filePath)
            || getAnalysisRevision(message.filePath) !== message.analysisRevision) {
            return;
        }
        const [result] = await this.analysis.analyzeFiles(
            [message.filePath],
            undefined,
            'Applying calibration (1 file)',
            undefined,
            false,
        );
        if (!result
            || session.isDisposed
            || !session.getActiveFilePaths().includes(message.filePath)
            || getAnalysisRevision(message.filePath) !== message.analysisRevision) {
            return;
        }
        const acceptedResult = result.error
            ? { ...result, analysisRevision: message.analysisRevision }
            : result;
        if (acceptedResult.analysisRevision !== message.analysisRevision) { return; }
        const results = ComparisonPanel.replaceResult(session.panel, acceptedResult);
        if (!results) { return; }
        session.cacheResults([acceptedResult]);
        await session.postMessage({ type: 'analysis-update', results } satisfies AnalysisUpdateMessage);
    }

    private async handlePanelReady(
        session: PanelSession<PanelHandle>,
        message: ComparisonPanelReadyMessage,
    ): Promise<void> {
        const current = ComparisonPanel.getResults(session.panel);
        const reported = new Map(
            message.calibrationRevisions.map((entry) => [entry.filePath, entry.analysisRevision]),
        );
        const isCurrent = current.length === message.calibrationRevisions.length
            && current.every((result) => (
                reported.get(result.filePath) === (result.analysisRevision ?? 0)
            ));
        if (!isCurrent) {
            await session.postMessage({ type: 'analysis-update', results: current } satisfies AnalysisUpdateMessage);
        }
    }

    private handleWaveformRange(session: PanelSession<PanelHandle>, request: WaveformRangeRequest): void {
        void this.backend.requestRange(
            request.filePath,
            request.startNorm,
            request.endNorm,
            request.points,
            request.requestId,
        ).then((result) => {
            if (!this.canPostForFile(session, request.filePath)) { return; }
            void session.postMessage({
                type: 'waveform-range-result',
                requestId: request.requestId,
                trackIndex: request.trackIndex,
                startNorm: request.startNorm,
                endNorm: request.endNorm,
                channels: result.channels,
            });
        }).catch(() => { /* overview data remains available */ });
    }

    private handleTrackDetail(session: PanelSession<PanelHandle>, request: TrackDetailRequest): void {
        void this.backend.requestTrackDetail(
            request.filePath,
            {
                trackIndex: request.trackIndex,
                analysisId: request.analysisId,
                settingsSignature: request.settingsSignature,
                stftOptions: loadPersistedStftOptions(this.context),
            },
            request.requestId,
        ).then((result) => {
            if (!this.canPostForFile(session, request.filePath)) { return; }
            void session.postMessage({
                type: 'track-detail-result',
                requestId: request.requestId,
                analysisId: request.analysisId,
                settingsSignature: request.settingsSignature,
                trackIndex: request.trackIndex,
                filePath: request.filePath,
                channels: result.channels,
            });
        }).catch((error) => {
            if (!this.canPostForFile(session, request.filePath)) { return; }
            void session.postMessage({
                type: 'track-detail-error',
                requestId: request.requestId,
                analysisId: request.analysisId,
                settingsSignature: request.settingsSignature,
                trackIndex: request.trackIndex,
                filePath: request.filePath,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }

    private handleSpectrumSlice(session: PanelSession<PanelHandle>, request: SpectrumSliceRequest): void {
        void this.backend.requestSpectrumSlice(
            request.filePath,
            {
                trackIndex: request.trackIndex,
                analysisId: request.analysisId,
                settingsSignature: request.settingsSignature,
                cursorNorm: request.cursorNorm,
                channelIndex: request.channelIndex,
                stftOptions: loadPersistedStftOptions(this.context),
            },
            request.requestId,
        ).then((result) => {
            if (!this.canPostForFile(session, request.filePath)) { return; }
            void session.postMessage({
                type: 'spectrum-slice-result',
                requestId: request.requestId,
                analysisId: request.analysisId,
                settingsSignature: request.settingsSignature,
                trackIndex: request.trackIndex,
                channelIndex: request.channelIndex,
                filePath: request.filePath,
                values: result.values,
                frequencyBins: result.frequencyBins,
                maxFrequencyHz: result.maxFrequencyHz,
                minDb: result.minDb,
                maxDb: result.maxDb,
                unit: result.unit,
                axisLabel: result.axisLabel,
            });
        }).catch((error) => {
            if (!this.canPostForFile(session, request.filePath)) { return; }
            void session.postMessage({
                type: 'spectrum-slice-error',
                requestId: request.requestId,
                analysisId: request.analysisId,
                settingsSignature: request.settingsSignature,
                trackIndex: request.trackIndex,
                channelIndex: request.channelIndex,
                filePath: request.filePath,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }

    private renderDirectorySession(
        session: PanelSession<PanelHandle>,
        selection: DirectorySelectionState,
        results: AnalysisResultWithError[],
    ): void {
        this.panelFactory.showDirectory(
            this.context.extensionUri,
            selection.rootPath,
            selection.allFilePaths,
            selection.selectedFilePaths,
            results,
            this.host.getPythonEnvironment(),
            session.panel,
            loadSpectrogramSettings(this.context),
        );
        session.setActiveResults(results.map((result) => result.filePath));
        this.postPythonEnvironmentState(session, this.host.getPythonEnvironment());
    }

    private postPythonEnvironmentState(session: PanelSession<PanelHandle>, state: PythonEnvironmentState): void {
        void session.postMessage({
            type: 'python-environment-state',
            pythonCommand: state.pythonCommand,
            status: state.status,
            tooltip: state.tooltip,
        });
    }

    private canPostForFile(session: PanelSession<PanelHandle>, filePath: string): boolean {
        return !session.isDisposed && session.getActiveFilePaths().includes(filePath);
    }
}
