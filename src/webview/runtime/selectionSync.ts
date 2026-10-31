import { OrderedSelection } from '../../shared/utils/directorySelection';

export interface SelectionSyncInit {
    rootLabel: string;
    /** Every file the host lists (a folder's, or files opened on their own). */
    listedFilePaths: readonly string[];
    selectedFilePaths: readonly unknown[];
    /** The page lists the host's files (the entry table); otherwise it shows only the tracks it was opened with. */
    listsFiles: boolean;
}

export interface SelectedFilesRequest {
    requestId: string;
    filePaths: string[];
    clearAll?: true;
}

/**
 * The files the comparison shows as tracks and what it last agreed with the host about them: the folder label,
 * how many files the host lists, the host's last reported selection, and a ▶ waiting for its file's track.
 */
export class SelectionSync {
    readonly listedFilePaths: string[];
    private readonly selection = new OrderedSelection();
    private rootLabelValue: string;
    private listedCountValue: number;
    private hostSelection = new Set<string>();
    private pendingPlay: string | null = null;
    private requestSeq = 0;

    constructor(init: SelectionSyncInit) {
        this.rootLabelValue = init.rootLabel;
        this.listedFilePaths = init.listedFilePaths.slice();
        this.listedCountValue = init.listsFiles ? this.listedFilePaths.length : 0;
        init.selectedFilePaths.forEach(filePath => {
            if (typeof filePath === 'string') this.selection.add(filePath);
        });
    }

    /** The files shown as tracks, in the order they were chosen. */
    get paths(): readonly string[] { return this.selection.paths; }
    get rootLabel(): string { return this.rootLabelValue; }
    /** How many files the host lists: the entry table's rows. */
    get listedCount(): number { return this.listedCountValue; }

    has(filePath: string): boolean { return this.selection.has(filePath); }
    add(filePath: string): void { this.selection.add(filePath); }
    remove(filePath: string): void { this.selection.remove(filePath); }
    clear(): void { this.selection.clear(); }

    /** The host listed `listedCount` files under `rootLabel`; a new folder starts with no tracks. */
    showListing(rootLabel: string, listedCount: number, newFolder: boolean): void {
        this.rootLabelValue = rootLabel;
        if (newFolder) this.selection.clear();
        this.listedCountValue = listedCount;
    }

    /**
     * The host reports `filePaths` selected: they become the tracks. Returns the ones it did not report last time
     * (opened again with the picker after their track was taken off); one it still reports from before (an update
     * that crossed a removal) is not among them.
     */
    adoptHostSelection(filePaths: readonly string[]): string[] {
        const newlySelected = filePaths.filter(filePath => !this.hostSelection.has(filePath));
        this.hostSelection = new Set(filePaths);
        this.selection.clear();
        filePaths.forEach(filePath => this.selection.add(filePath));
        return newlySelected;
    }

    /** The message asking the host to analyse the tracks chosen; each has its own request id. */
    nextRequest(sessionId: string, clearAll = false): SelectedFilesRequest {
        this.requestSeq += 1;
        // Built from the host's listing, so the array is of the same realm as the state the host injected.
        const filePaths = this.listedFilePaths.slice(0, 0);
        filePaths.push(...this.selection.paths);
        return {
            requestId: 'selection-' + sessionId + '-' + this.requestSeq,
            filePaths,
            ...(clearAll ? { clearAll: true as const } : {}),
        };
    }

    /** A ▶ pressed before `filePath` was analysed: it plays once its track is there. */
    queuePlay(filePath: string): void {
        this.pendingPlay = filePath;
    }

    /** The file waiting to play, once `isReady` says its track is there (and then no longer waiting). */
    takeReadyPlay(isReady: (filePath: string) => boolean): string | null {
        const filePath = this.pendingPlay;
        if (!filePath || !isReady(filePath)) return null;
        this.pendingPlay = null;
        return filePath;
    }
}
