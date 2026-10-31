import { promises as fs } from 'fs';
import * as path from 'path';
import { createFolderStore, isFolderKey } from './folderStore';
import * as vscode from 'vscode';
import {
    type AnalysisResultWithError,
    type AnalysisUpdateMessage,
    type ComparisonPanelReadyMessage,
    type SpectrogramSettings,
    type StftOptions,
} from '../shared/analysis/analysisTypes';
import { type AnalyzeSelectedFilesMessage, type SelectionTargetKind } from '../shared/utils/audioTarget';
import {
    collectAudioFilePaths,
    collectSelectedResults,
    diffSelectedAudioFilePaths,
    sanitizeSelectedAudioFilePaths,
} from '../shared/utils/directorySelection';
import { ComparisonPanel } from '../webview/panels/ComparisonPanel';
import { fileCountLabel, fillTemplate, getStrings, type UiStrings } from '../shared/i18n/strings';
import type { AnalysisHost, AnalysisOrchestrator } from './analysisOrchestrator';
import type { AnalysisClient } from '../shared/analysis/analysisClient';
import { userErrorText, type CalibrationRequestContext } from '../shared/protocol/backendProtocol';
import { calibrationFileKey, type CalibrationChangeEvent, type CalibrationStore } from './calibrationStore';
import type { ExportFlows } from './exportFlows';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import type { PanelMessage } from '../shared/protocol/panelMessages';
import { ComparisonSessionController, type ComparisonSessionPorts, type SessionScope } from '../shared/session/comparisonSessionController';
import {
    PanelSession,
    type DisposableLike,
    type PanelPort,
} from './panelSession';
import {
    getCurrentPythonEnvironmentState,
    onDidChangePythonEnvironmentState,
    type PythonEnvironmentState,
} from './pythonEnvironment';
import {
    loadPersistedStftOptions,
    loadSpectrogramSettings,
    saveSpectrogramSettings,
    type SpectrogramSettingsContext,
} from '../shared/analysis/savedSpectrogramSettings';
import {
    buildDirectoryTree,
    MAX_DIRECTORY_ENTRIES,
    pickAudioFiles,
    pickAudioTarget,
    type DirectoryListing,
    type OpenDialog,
    type TargetFileSystem,
} from './targetDiscovery';

export interface PanelBackend extends Pick<AnalysisClient,
    | 'requestRange'
    | 'requestTrackDetail'
    | 'releaseTrackDetail'
    | 'requestSpectrumSlice'
    | 'requestPairSpectrum'
    | 'exportWavLoop'
    | 'buildRecipe'
    | 'scan'
    | 'calibrationFor'> {}

export interface PanelAnalysis {
    analyzeFiles: AnalysisOrchestrator['analyzeFiles'];
    warmup(): void;
}

export interface PanelHandle extends PanelPort {
    onDidDispose(listener: () => unknown): DisposableLike;
}

export interface PanelFactory {
    /** The results the panel currently displays; directory updates and `showResults` record them here too. */
    getResults(panel: PanelHandle): AnalysisResultWithError[];
    updateResults(panel: PanelHandle, results: AnalysisResultWithError[]): void;
    /** Swaps in one file's result; undefined when the panel no longer shows that file. */
    replaceResult(panel: PanelHandle, result: AnalysisResultWithError): AnalysisResultWithError[] | undefined;
    updateDirectoryResults(results: AnalysisResultWithError[], panel: PanelHandle, selectedFilePaths?: string[]): Thenable<boolean>;
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
    language(): string;
    withProgress: AnalysisHost['withProgress'];
}

const defaultPanelFactory: PanelFactory = {
    getResults: (panel) => ComparisonPanel.getResults(panel),
    updateResults: (panel, results) => ComparisonPanel.updateResults(panel, results),
    replaceResult: (panel, result) => ComparisonPanel.replaceResult(panel, result),
    updateDirectoryResults: (results, panel, selectedFilePaths) => ComparisonPanel.updateDirectoryResults(
        results, panel as vscode.WebviewPanel, selectedFilePaths,
    ),
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
    language: () => vscode.env.language,
    withProgress: (options, task) => vscode.window.withProgress(options, task),
};

/** The calibration revisions a panel's results are checked against, and their change events. */
export type PanelCalibration = Pick<CalibrationStore, 'analysisRevision' | 'onDidChange' | 'configureTrack'>;

export class PanelController implements vscode.Disposable {
    private readonly sessions = new Map<PanelHandle, PanelSession<PanelHandle>>();
    private readonly calibrationRefreshQueues = new WeakMap<PanelSession<PanelHandle>, Promise<void>>();
    private readonly calibrationChangeDisposable: vscode.Disposable;

    constructor(
        private readonly context: SpectrogramSettingsContext & { extensionUri: vscode.Uri; storageUri?: vscode.Uri; globalStorageUri?: vscode.Uri },
        private readonly backend: PanelBackend,
        private readonly analysis: PanelAnalysis,
        private readonly exports: ExportFlows,
        private readonly calibration: PanelCalibration,
        private readonly panelFactory: PanelFactory = defaultPanelFactory,
        private readonly host: PanelControllerHost = defaultHost,
    ) {
        this.calibrationChangeDisposable = calibration.onDidChange((event) => {
            for (const session of this.sessions.values()) {
                // The event carries the canonical key, which differs from the panel's path on Windows (drive-letter
                // case, resolved root) and for symlinked files; refresh under the path the panel actually shows.
                const filePath = session.getActiveFilePaths()
                    .find((activePath) => calibrationFileKey(activePath) === event.filePath);
                if (filePath === undefined) { continue; }
                void this.enqueueCalibrationRefresh(session, { ...event, filePath }).catch((error) => {
                    this.host.showError(userErrorText(error, this.strings()));
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
            let listing: DirectoryListing;
            try {
                listing = await this.listDirectory(targetUri);
            } catch (error) {
                if (error instanceof vscode.CancellationError) { return; }
                throw error;
            }
            if (existingSession && revision !== undefined && !existingSession.isCurrent(revision)) { return; }
            const { tree } = listing;
            if (listing.truncated) {
                this.host.showInformation(fillTemplate(this.strings().directoryListingTruncated, {
                    count: MAX_DIRECTORY_ENTRIES, path: targetUri.fsPath,
                }));
            }
            const filePaths = collectAudioFilePaths(tree);
            if (filePaths.length === 0) {
                throw new Error(fillTemplate(this.strings().noSupportedAudioFiles, { path: targetUri.fsPath }));
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
        const stftOptions = loadPersistedStftOptions(this.context);
        let results: AnalysisResultWithError[];
        try {
            results = await this.analysis.analyzeFiles(
                filePaths,
                stftOptions,
            );
        } catch (error) {
            if (error instanceof vscode.CancellationError) { return; }
            throw error;
        }
        if (existingSession && expectedRevision !== undefined
            && !existingSession.isCurrent(expectedRevision)) {
            return;
        }
        results = await this.settleLiveResults(results, stftOptions);
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
        await this.refreshStalePanelResults(session);
    }

    private isLiveResult(result: AnalysisResultWithError): boolean {
        return (result.analysisRevision ?? 0) === this.calibration.analysisRevision(result.filePath);
    }

    private async settleLiveResults(
        initialResults: AnalysisResultWithError[],
        stftOptions: StftOptions | undefined,
    ): Promise<AnalysisResultWithError[]> {
        let results = initialResults;
        while (true) {
            const stalePaths = results
                .filter((result) => !this.isLiveResult(result))
                .map((result) => result.filePath);
            if (stalePaths.length === 0) { return results; }
            const refreshed = await this.analysis.analyzeFiles(
                stalePaths,
                stftOptions,
                this.progressTitle('progressSyncCalibration', stalePaths.length),
                undefined,
                false,
            );
            const refreshedByPath = new Map(refreshed.map((result) => [result.filePath, result]));
            results = results.map((result) => refreshedByPath.get(result.filePath) ?? result);
        }
    }

    private listDirectory(targetUri: vscode.Uri): Thenable<DirectoryListing> {
        return this.host.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: fillTemplate(this.strings().directoryListingProgress, { path: path.basename(targetUri.fsPath) || targetUri.fsPath }),
                cancellable: true,
            },
            (progress, token) => buildDirectoryTree(targetUri, this.host.fileSystem, {
                isCancelled: () => token.isCancellationRequested,
                onProgress: (entries) => progress.report({ message: String(entries) }),
            }),
        );
    }

    private strings(): UiStrings {
        return getStrings(this.host.language());
    }

    private progressTitle(
        key: 'progressSyncCalibration' | 'progressRecomputeSpectrogram' | 'progressApplyCalibration',
        fileCount: number,
    ): string {
        const strings = this.strings();
        return fillTemplate(strings[key], { files: fileCountLabel(strings, fileCount) });
    }

    private ensureSession(panel: PanelHandle): PanelSession<PanelHandle> {
        const current = this.sessions.get(panel);
        if (current) { return current; }
        const session = new PanelSession(panel);
        this.sessions.set(panel, session);
        const controller = new ComparisonSessionController(this.sessionPorts(session));
        session.bindMessageListener(panel.webview.onDidReceiveMessage((message) => {
            void controller.dispatch(message);
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

    // VS Code host: dialogs, workspace state, calibration revisions and the Python child process
    // behind the shared session contract.
    private sessionPorts(session: PanelSession<PanelHandle>): ComparisonSessionPorts {
        return {
            strings: this.strings(),
            scope: (message: PanelMessage): SessionScope => {
                const revision = message.type === 'request-reanalyze' ? session.beginStateRequest() : undefined;
                return {
                    isCurrent: () => revision === undefined ? !session.isDisposed : session.isCurrent(revision),
                    canPublish: (filePath, analysisRevision) => this.canPostLazyResult(session, filePath, analysisRevision),
                };
            },
            publish: (message) => session.postMessage(message),
            saveSettings: (settings) => saveSpectrogramSettings(this.context, settings),
            stftOptions: () => loadPersistedStftOptions(this.context),
            client: this.backend,
            lazyContext: (filePath) => this.displayedCalibration(session, filePath),
            releaseTrackDetail: (filePath) => { void this.backend.releaseTrackDetail(filePath); },
            activeFilePaths: () => session.getActiveFilePaths(),
            reanalyze: (stftOptions, scope) => this.reanalyze(session, stftOptions, scope),
            wavExport: (message) => {
                const filePaths = message.filePaths.filter((filePath) => session.allowsFile(filePath));
                return filePaths.length > 0 ? this.exports.wavExport({ ...message, filePaths }) : Promise.resolve(undefined);
            },
            pickReportFormat: () => this.exports.pickReportFormat(),
            saveReport: (artifact, format, message) => this.exports.saveReport(artifact, format, message),
            saveRecipe: (file) => this.exports.saveRecipe(file),
            selectTarget: (targetKind) => this.handleSelectTarget(session, targetKind),
            showInformation: (message) => this.host.showInformation(message),
            showError: (message) => this.host.showError(message),
            unsupported: () => undefined,
            selection: (message) => this.handleSelection(session, message),
            // The channels come from the track the panel shows, not from the message.
            configureCalibration: async (message) => {
                const result = this.panelFactory.getResults(session.panel).find((candidate) => candidate.filePath === message.filePath);
                if (result) { await this.calibration.configureTrack(result); }
            },
            panelReady: (message) => this.handlePanelReady(session, message),
            selectPythonEnvironment: async () => { await this.host.executeCommand('audioWandasAnalyzer.selectPythonEnvironment'); },
            runRecipe: async () => { await this.host.executeCommand('audioWandasAnalyzer.runRecipe', session.getActiveFilePaths()); },
            // The report folder goes inside a folder the user picks; nothing is written if they cancel.
            saveReportFolder: async (folder, files) => {
                const picked = await this.host.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: this.strings().compareReport });
                if (!picked?.[0]) return;
                const target = path.join(picked[0].fsPath, folder);
                await fs.mkdir(target, { recursive: true });
                for (const file of files) await fs.writeFile(path.join(target, file.name), file.bytes);
                this.host.showInformation(this.strings().reportSaved + target);
            },
            entry: {
                // Path, size and mtime: the same file unchanged gets its stored metrics back without a scan.
                identity: async (filePath) => {
                    this.assertListed(session, filePath);
                    try {
                        const real = await fs.realpath(filePath);
                        const stat = await fs.stat(real, { bigint: true });
                        return `${real}|${stat.size}|${stat.mtimeNs}`;
                    } catch {
                        return undefined;
                    }
                },
                calibration: (filePath) => JSON.stringify(this.backend.calibrationFor(filePath) ?? null),
                scan: async (filePath, region, recipe, stage, detail, reference) => {
                    this.assertListed(session, filePath);
                    if (reference) { this.assertListed(session, reference.filePath); }
                    return this.backend.scan({ filePath, recipe: recipe ?? await this.entryRecipe(), ...(region ? { region } : {}), ...(stage ? { stage } : {}), ...(detail ? { detail } : {}), ...(reference ? { reference } : {}) });
                },
                recipe: () => this.entryRecipe(),
                readHead: async (filePath, length) => {
                    this.assertListed(session, filePath);
                    const handle = await fs.open(filePath, 'r');
                    try {
                        const buffer = new Uint8Array(length);
                        const { bytesRead } = await handle.read(buffer, 0, length, 0);
                        return buffer.subarray(0, bytesRead);
                    } finally {
                        await handle.close();
                    }
                },
                // A folder's index, session and CSV go to files in the workspace storage; the rest to the state database.
                read: (key) => (this.folderStore && isFolderKey(key) ? this.folderStore.read(key) : this.context.workspaceState.get(key)),
                write: (key, value) => (this.folderStore && isFolderKey(key) ? this.folderStore.write(key, value) : this.context.workspaceState.update(key, value)),
            },
        };
    }

    /** The webview names files by path; only the ones this panel listed or shows may reach the disk or the backend. */
    private assertListed(session: PanelSession<PanelHandle>, filePath: string): void {
        if (!session.allowsFile(filePath)) {
            throw new Error(fillTemplate(this.strings().fileNotInSession, { path: filePath }));
        }
    }

    private entryRecipeFile?: Promise<RecipeDocument>;

    /** The workspace storage (else the extension's global storage) for a folder's index and session; none in tests. */
    private folderStoreMade = false;
    private folderStoreValue?: ReturnType<typeof createFolderStore>;
    private get folderStore(): ReturnType<typeof createFolderStore> | undefined {
        if (!this.folderStoreMade) {
            this.folderStoreMade = true;
            const base = this.context.storageUri ?? this.context.globalStorageUri;
            this.folderStoreValue = base ? createFolderStore(path.join(base.fsPath, 'entry')) : undefined;
        }
        return this.folderStoreValue;
    }

    /** The fixed Recipe the entry table scans with, shipped beside the Python backend. */
    private entryRecipe(): Promise<RecipeDocument> {
        this.entryRecipeFile ??= fs.readFile(
            path.join(this.context.extensionUri.fsPath, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8',
        ).then(text => JSON.parse(text) as RecipeDocument);
        return this.entryRecipeFile;
    }

    private async handleSelection(session: PanelSession<PanelHandle>, message: AnalyzeSelectedFilesMessage): Promise<void> {
        const selection = session.directorySelection;
        if (!selection) { return; }
        const selectedFilePaths = sanitizeSelectedAudioFilePaths(selection.tree, message.filePaths, selection.extraFilePaths);
        const delta = diffSelectedAudioFilePaths(selection.selectedFilePaths, selectedFilePaths);
        const revision = session.beginStateRequest(message.requestId);
        selection.selectedFilePaths = selectedFilePaths;

        if (selectedFilePaths.length === 0) {
            if (session.isCurrent(revision, message.requestId)) { await this.updateDirectorySession(session, []); }
            return;
        }

        const newlyAdded = new Set(delta.addedFilePaths);
        const uncached = [
            ...delta.addedFilePaths.filter((filePath) => (
                !session.hasCachedResult(filePath, this.calibration.analysisRevision(filePath))
            )),
            ...selectedFilePaths.filter((filePath) => {
                return !newlyAdded.has(filePath)
                    && !session.hasCachedResult(filePath, this.calibration.analysisRevision(filePath));
            }),
        ];
        if (uncached.length > 0) {
            const stftOptions = loadPersistedStftOptions(this.context);
            const analyzedResults = await this.analysis.analyzeFiles(
                uncached,
                stftOptions,
            );
            if (session.isDisposed || session.directorySelection !== selection) { return; }
            const newResults = await this.settleLiveResults(analyzedResults, stftOptions);
            if (session.isDisposed || session.directorySelection !== selection) { return; }
            for (const result of newResults) { selection.cachedResultsByFilePath.set(result.filePath, result); }
        }
        if (!session.isCurrent(revision, message.requestId)) { return; }
        this.analysis.warmup();
        await this.updateDirectorySession(
            session,
            collectSelectedResults(selection.selectedFilePaths, selection.cachedResultsByFilePath),
        );
        await this.refreshStalePanelResults(session);
    }

    private async handleSelectTarget(session: PanelSession<PanelHandle>, targetKind: SelectionTargetKind): Promise<void> {
        // ＋ Add files: the picked files join what is shown, from wherever they are; a folder opens on its entry table.
        if (targetKind === 'file') {
            const picked = (await pickAudioFiles(this.host.showOpenDialog, this.host.language())).map((uri) => uri.fsPath);
            if (picked.length && !session.isDisposed) await this.addFiles(session, picked);
            return;
        }
        const selected = await pickAudioTarget(targetKind, this.host.showOpenDialog, this.host.language());
        if (selected && !session.isDisposed) {
            await this.analyzeTarget(selected, session.panel);
        }
    }

    /**
     * Files added beside the folder's: listed (the entry table's "added files") and shown as tracks at once.
     * A panel without a folder shows them beside its own files.
     */
    private async addFiles(session: PanelSession<PanelHandle>, filePaths: string[]): Promise<void> {
        const selection = session.directorySelection;
        if (!selection) {
            const shown = session.getActiveFilePaths();
            await this.analyzeMultipleFiles([...shown, ...filePaths.filter((filePath) => !shown.includes(filePath))], session.panel, session.beginStateRequest());
            return;
        }
        const fresh = filePaths.filter((filePath) => !selection.allFilePaths.includes(filePath));
        selection.extraFilePaths = [...(selection.extraFilePaths ?? []), ...fresh];
        selection.allFilePaths = [...selection.allFilePaths, ...fresh];
        await session.postMessage({ type: 'directory-selection', rootPath: selection.rootPath, filePaths: selection.allFilePaths });
        await this.handleSelection(session, {
            type: 'analyze-selected-files',
            requestId: `add-files-${Date.now()}`,
            filePaths: [...selection.selectedFilePaths, ...filePaths.filter((filePath) => !selection.selectedFilePaths.includes(filePath))],
        });
    }

    private async reanalyze(
        session: PanelSession<PanelHandle>,
        stftOptions: StftOptions | undefined,
        scope: SessionScope,
    ): Promise<AnalysisResultWithError[] | undefined> {
        const filePaths = session.getActiveFilePaths();
        const results = await this.analysis.analyzeFiles(
            filePaths,
            stftOptions,
            this.progressTitle('progressRecomputeSpectrogram', filePaths.length),
            session,
        );
        if (!scope.isCurrent()) { return undefined; }
        const displayedByPath = new Map(
            this.panelFactory.getResults(session.panel).map((result) => [result.filePath, result]),
        );
        const acceptedResults = results.map((result) => {
            if (this.isLiveResult(result)) {
                return result;
            }
            return displayedByPath.get(result.filePath) ?? result;
        });
        session.cacheResults(acceptedResults);
        session.setActiveResults(acceptedResults.map((result) => result.filePath));
        this.panelFactory.updateResults(session.panel, acceptedResults);
        return acceptedResults;
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
            || this.calibration.analysisRevision(message.filePath) !== message.analysisRevision) {
            return;
        }
        const [result] = await this.analysis.analyzeFiles(
            [message.filePath],
            undefined,
            this.progressTitle('progressApplyCalibration', 1),
            undefined,
            false,
        );
        if (!result
            || session.isDisposed
            || !session.getActiveFilePaths().includes(message.filePath)
            || this.calibration.analysisRevision(message.filePath) !== message.analysisRevision) {
            return;
        }
        if (!this.isLiveResult(result) || result.analysisRevision !== message.analysisRevision) { return; }
        const results = this.panelFactory.replaceResult(session.panel, result);
        if (!results) { return; }
        session.cacheResults([result]);
        await session.postMessage({ type: 'analysis-update', results } satisfies AnalysisUpdateMessage);
    }

    private async refreshStalePanelResults(session: PanelSession<PanelHandle>): Promise<void> {
        const stale = this.panelFactory.getResults(session.panel).filter((result) => !this.isLiveResult(result));
        for (const result of stale) {
            await this.enqueueCalibrationRefresh(session, {
                filePath: result.filePath,
                analysisRevision: this.calibration.analysisRevision(result.filePath),
            });
        }
    }

    private async handlePanelReady(
        session: PanelSession<PanelHandle>,
        message: ComparisonPanelReadyMessage,
    ): Promise<void> {
        if (session.directorySelection) {
            await this.panelFactory.updateDirectoryResults(
                this.panelFactory.getResults(session.panel), session.panel, session.directorySelection.selectedFilePaths,
            );
            await this.refreshStalePanelResults(session);
            return;
        }
        await this.refreshStalePanelResults(session);
        const current = this.panelFactory.getResults(session.panel);
        const reported = new Map(
            message.calibrationRevisions.map((entry) => [entry.filePath, entry.analysisRevision]),
        );
        const isCurrent = current.length === message.calibrationRevisions.length
            && current.every((result) => (
                this.isLiveResult(result)
                && reported.get(result.filePath) === (result.analysisRevision ?? 0)
            ));
        if (!isCurrent) {
            await session.postMessage({ type: 'analysis-update', results: current } satisfies AnalysisUpdateMessage);
        }
    }

    private async updateDirectorySession(
        session: PanelSession<PanelHandle>,
        results: AnalysisResultWithError[],
    ): Promise<void> {
        session.setActiveResults(results.map((result) => result.filePath));
        // The selection goes with the results, so the webview's tracks follow files the host added (＋ Add files).
        await this.panelFactory.updateDirectoryResults(
            results,
            session.panel,
            session.directorySelection?.selectedFilePaths,
        );
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

    private displayedCalibration(
        session: PanelSession<PanelHandle>,
        filePath: string,
    ): CalibrationRequestContext | undefined {
        if (!this.canPostForFile(session, filePath)) { return undefined; }
        const displayed = this.panelFactory.getResults(session.panel).find((result) => result.filePath === filePath);
        if (!displayed) { return undefined; }
        return {
            calibrationProfile: displayed.calibrationProfile,
            analysisRevision: displayed.analysisRevision ?? 0,
        };
    }

    private canPostLazyResult(
        session: PanelSession<PanelHandle>,
        filePath: string,
        analysisRevision: number | undefined,
    ): boolean {
        const displayed = this.displayedCalibration(session, filePath);
        return displayed !== undefined
            && displayed.analysisRevision === (analysisRevision ?? 0);
    }
}
