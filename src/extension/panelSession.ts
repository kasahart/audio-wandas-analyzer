import { SessionRequests, SourceResults } from '../shared/analysis/analysisSession';
import type { AnalysisResultWithError, DirectoryTreeNode } from '../shared/analysis/analysisTypes';

export interface DisposableLike {
    dispose(): void;
}

export interface PanelWebviewPort {
    postMessage(message: unknown): Thenable<boolean>;
    onDidReceiveMessage(listener: (message: unknown) => unknown): DisposableLike;
}

export interface PanelPort {
    webview: PanelWebviewPort;
}

export interface DirectorySelectionState {
    rootPath: string;
    tree: DirectoryTreeNode[];
    allFilePaths: string[];
    /** Files added from outside the folder (＋ Add files): listed and selectable beside the folder's. */
    extraFilePaths?: string[];
    selectedFilePaths: string[];
    cachedResultsByFilePath: Map<string, AnalysisResultWithError>;
    /** What each cached analysis was made under (the STFT asked and the file's version on disk), beside it. */
    cachedUnderByFilePath?: Map<string, string>;
}

export class PanelSession<P extends PanelPort = PanelPort> {
    readonly panel: P;
    directorySelection: DirectorySelectionState | null = null;
    activeResultPaths: string[] = [];
    private readonly generation = new SessionRequests();
    private cachedResults = new SourceResults<AnalysisResultWithError>();
    /**
     * What each cached analysis was made under (analysedUnder: the STFT asked and the file's version on disk): a
     * file selected again is shown from the cache only under the same, never an analysis of another STFT or version.
     */
    private cachedUnder = new Map<string, string>();

    get latestRequestId(): string | undefined { return this.generation.latestRequestId; }
    private messageDisposable: DisposableLike | null = null;
    private pythonEnvironmentSubscription: DisposableLike | null = null;
    private disposed = false;

    constructor(panel: P) {
        this.panel = panel;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    setDirectorySelection(selection: DirectorySelectionState): void {
        this.invalidateState();
        this.directorySelection = selection;
        this.cachedResults = new SourceResults(selection.cachedResultsByFilePath);
        this.cachedUnder = selection.cachedUnderByFilePath ??= new Map<string, string>();
        this.activeResultPaths = [];
    }

    setActiveResults(filePaths: string[]): void {
        this.activeResultPaths = [...filePaths];
    }

    /** Keeps analyses for the folder's files, each under what it was made under (`under`: analysedUnder). */
    cacheResults(results: AnalysisResultWithError[], under: (filePath: string) => string): void {
        if (!this.directorySelection) { return; }
        for (const result of results) {
            this.cachedResults.set(result.filePath, result);
            this.cachedUnder.set(result.filePath, under(result.filePath));
        }
    }

    /** Whether a file's cached analysis is of this calibration revision and made under `under`; one that is not is let go. */
    hasCachedResult(filePath: string, expectedAnalysisRevision: number, under: string): boolean {
        if (this.directorySelection === null) return false;
        if (this.cachedUnder.get(filePath) !== under) { this.forgetCached(filePath); return false; }
        return this.cachedResults.hasRevision(filePath, expectedAnalysisRevision, result => result.analysisRevision ?? 0);
    }

    /** A file written on disk: its cached analysis is of the old version. */
    forgetCached(filePath: string): void {
        this.cachedResults.delete(filePath);
        this.cachedUnder.delete(filePath);
    }

    clearDirectorySelection(): void {
        this.invalidateState();
        this.directorySelection = null;
        this.cachedResults = new SourceResults();
        this.cachedUnder = new Map();
    }

    getActiveFilePaths(): string[] {
        return this.directorySelection
            ? [...this.directorySelection.selectedFilePaths]
            : [...this.activeResultPaths];
    }

    /** Every path the panel may name a file by: the folder's listing, the selection and the tracks shown. */
    knownFilePaths(): string[] {
        return [...new Set([...(this.directorySelection?.allFilePaths ?? []), ...(this.directorySelection?.selectedFilePaths ?? []), ...this.activeResultPaths])];
    }

    /** Whether a webview request may name this file: one the folder listed, added beside it, or shown. */
    allowsFile(filePath: string): boolean {
        return this.activeResultPaths.includes(filePath)
            || (this.directorySelection !== null && (
                this.directorySelection.allFilePaths.includes(filePath)
                || this.directorySelection.selectedFilePaths.includes(filePath)));
    }

    beginStateRequest(requestId?: string): number {
        return this.generation.begin(requestId);
    }

    isCurrent(revision: number, requestId?: string): boolean {
        return !this.disposed
            && this.generation.isCurrent(revision, requestId);
    }

    bindMessageListener(disposable: DisposableLike): void {
        this.messageDisposable?.dispose();
        this.messageDisposable = disposable;
    }

    bindPythonEnvironment(disposable: DisposableLike): void {
        this.pythonEnvironmentSubscription?.dispose();
        this.pythonEnvironmentSubscription = disposable;
    }

    postMessage(message: unknown): Thenable<boolean> {
        if (this.disposed) { return Promise.resolve(false); }
        return this.panel.webview.postMessage(message);
    }

    dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;
        this.generation.dispose();
        this.messageDisposable?.dispose();
        this.messageDisposable = null;
        this.pythonEnvironmentSubscription?.dispose();
        this.pythonEnvironmentSubscription = null;
        this.directorySelection = null;
        this.cachedResults = new SourceResults();
        this.activeResultPaths = [];
    }

    private invalidateState(): number {
        return this.generation.advance();
    }
}
