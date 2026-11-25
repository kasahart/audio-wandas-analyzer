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
    /** The files of the last request to analyse that the host has not answered for yet (a result, or left out). */
    private awaiting = new Set<string>();
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

    /**
     * The host answered (an analysis update): each file with a result (shown, failed, or one the track store keeps
     * off) is answered, and so is each one the host no longer reports selected (left out, its analysis cancelled).
     */
    noteAnswer(resultPaths: readonly string[], hostSelected: readonly string[] | undefined): void {
        for (const filePath of resultPaths) this.awaiting.delete(filePath);
        if (hostSelected) {
            const selected = new Set(hostSelected);
            for (const filePath of [...this.awaiting]) if (!selected.has(filePath)) this.awaiting.delete(filePath);
        }
    }

    /**
     * How many of the files chosen are read of how many there are. A file is still on its way only while the host
     * has not answered for it since it was last asked for and `isRead` (its track is in) says no: the host reading
     * it, the browser build's Python starting. A file the host will not answer for (an answer that crossed a
     * removal, a cancelled analysis) is never counted as on its way, so the count never waits for good (#853).
     */
    readProgress(isRead: (filePath: string) => boolean): { read: number; total: number } {
        const paths = this.selection.paths;
        return { read: paths.filter(filePath => !this.awaiting.has(filePath) || isRead(filePath)).length, total: paths.length };
    }

    /** The message asking the host to analyse the tracks chosen; each has its own request id. */
    nextRequest(sessionId: string, clearAll = false): SelectedFilesRequest {
        this.requestSeq += 1;
        // Built from the host's listing, so the array is of the same realm as the state the host injected.
        const filePaths = this.listedFilePaths.slice(0, 0);
        filePaths.push(...this.selection.paths);
        // The newest request is the one answered: its files are awaited until the host answers for them.
        this.awaiting = new Set(this.selection.paths);
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
