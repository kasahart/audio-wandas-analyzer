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
    selectedFilePaths: string[];
    cachedResultsByFilePath: Map<string, AnalysisResultWithError>;
}

export class PanelSession<P extends PanelPort = PanelPort> {
    readonly panel: P;
    directorySelection: DirectorySelectionState | null = null;
    activeResultPaths: string[] = [];
    latestRequestId: string | undefined;
    private revision = 0;
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
        this.activeResultPaths = [];
    }

    setActiveResults(filePaths: string[]): void {
        this.activeResultPaths = [...filePaths];
    }

    cacheResults(results: AnalysisResultWithError[]): void {
        if (!this.directorySelection) { return; }
        for (const result of results) {
            this.directorySelection.cachedResultsByFilePath.set(result.filePath, result);
        }
    }

    clearDirectorySelection(): void {
        this.invalidateState();
        this.directorySelection = null;
    }

    getActiveFilePaths(): string[] {
        return this.directorySelection
            ? [...this.directorySelection.selectedFilePaths]
            : [...this.activeResultPaths];
    }

    beginStateRequest(requestId?: string): number {
        this.latestRequestId = requestId;
        return this.invalidateState();
    }

    isCurrent(revision: number, requestId?: string): boolean {
        return !this.disposed
            && revision === this.revision
            && (requestId === undefined || requestId === this.latestRequestId);
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
        this.revision++;
        this.messageDisposable?.dispose();
        this.messageDisposable = null;
        this.pythonEnvironmentSubscription?.dispose();
        this.pythonEnvironmentSubscription = null;
        this.directorySelection = null;
        this.activeResultPaths = [];
    }

    private invalidateState(): number {
        this.revision++;
        return this.revision;
    }
}
