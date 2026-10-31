import * as path from 'path';
import * as vscode from 'vscode';
import type { DirectoryTreeNode } from '../shared/analysis/analysisTypes';
import { getStrings } from '../shared/i18n/strings';
import { isSupportedAudioFile, SUPPORTED_AUDIO_DIALOG_EXTENSIONS, type SelectionTargetKind } from '../shared/utils/audioTarget';

const DIRECTORY_READ_CONCURRENCY = 8;
/** Files and folders looked at before the listing stops; a folder this large is better opened a subfolder at a time. */
export const MAX_DIRECTORY_ENTRIES = 50_000;

export interface TargetFileSystem {
    stat(uri: vscode.Uri): Thenable<vscode.FileStat>;
    readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
}

export type OpenDialog = (options: vscode.OpenDialogOptions) => Thenable<vscode.Uri[] | undefined>;

export interface DirectoryListingOptions {
    maxEntries?: number;
    /** Read requests in flight at once, across every level of the folder. */
    concurrency?: number;
    isCancelled?(): boolean;
    /** Entries looked at so far. */
    onProgress?(entries: number): void;
}

export interface DirectoryListing {
    tree: DirectoryTreeNode[];
    /** True when the listing stopped at `maxEntries`. */
    truncated: boolean;
}

// Hidden folders (.git, .venv) and node_modules hold no recordings worth listing and can hold a great many files.
function isSkippedDirectory(name: string): boolean {
    return name.startsWith('.') || name === 'node_modules';
}

function listsFolder(name: string, type: vscode.FileType): boolean {
    return (type & vscode.FileType.Directory) !== 0 && (type & vscode.FileType.SymbolicLink) === 0 && !isSkippedDirectory(name);
}

function sortEntries(entries: [string, vscode.FileType][]): [string, vscode.FileType][] {
    return [...entries].sort(([leftName, leftType], [rightName, rightType]) => {
        const leftIsDirectory = (leftType & vscode.FileType.Directory) !== 0;
        const rightIsDirectory = (rightType & vscode.FileType.Directory) !== 0;
        if (leftIsDirectory !== rightIsDirectory) { return leftIsDirectory ? -1 : 1; }
        return leftName.localeCompare(rightName);
    });
}

function limiter(concurrency: number): <T>(task: () => Thenable<T>) => Promise<T> {
    let running = 0;
    const waiting: Array<() => void> = [];
    return async (task) => {
        if (running >= concurrency) { await new Promise<void>(resolve => waiting.push(resolve)); }
        running++;
        try {
            return await task();
        } finally {
            running--;
            waiting.shift()?.();
        }
    };
}

/**
 * The supported audio files under `rootUri`, folders first. Symbolic links to folders are not followed (a link
 * back up would never end), and the listing stops at `maxEntries`. Cancelling throws `vscode.CancellationError`.
 */
export async function buildDirectoryTree(
    rootUri: vscode.Uri,
    fileSystem: TargetFileSystem = vscode.workspace.fs,
    options: DirectoryListingOptions = {},
): Promise<DirectoryListing> {
    const maxEntries = options.maxEntries ?? MAX_DIRECTORY_ENTRIES;
    const read = limiter(options.concurrency ?? DIRECTORY_READ_CONCURRENCY);
    let seen = 0;
    let truncated = false;

    const reads = new Map<string, Promise<[string, vscode.FileType][]>>();

    // A folder's subfolders are read as soon as its own read returns, but folders take their share of `maxEntries`
    // in name-sorted depth-first order, so a truncated listing does not depend on which read finished first.
    function startRead(folderUri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        // Checked again once a slot opens, so reads queued before a cancel or the cap are skipped rather than run.
        const entries = read(() => {
            if (options.isCancelled?.() || truncated) { return Promise.resolve<[string, vscode.FileType][]>([]); }
            return Promise.resolve(fileSystem.readDirectory(folderUri));
        }).then((found) => {
            // Reads waiting for their turn past the cap are ones the listing will not reach, so at most `maxEntries`
            // wait at once, even under a folder with more subfolders than that; the listing reads the rest itself.
            for (const [name, type] of sortEntries(found)) {
                if (reads.size > maxEntries || options.isCancelled?.()) { break; }
                if (listsFolder(name, type)) { void startRead(vscode.Uri.joinPath(folderUri, name)); }
            }
            return found;
        });
        // A read is awaited only when its folder's turn comes, so a failure before then is not yet unhandled.
        void entries.catch(() => undefined);
        reads.set(folderUri.fsPath, entries);
        return entries;
    }

    async function list(currentUri: vscode.Uri): Promise<DirectoryTreeNode[]> {
        if (options.isCancelled?.()) { throw new vscode.CancellationError(); }
        // Past the cap a folder adds nothing, so its read (perhaps failed or stalled) is not awaited.
        if (truncated) { return []; }
        const pending = reads.get(currentUri.fsPath) ?? startRead(currentUri);
        const entries = await pending;
        reads.delete(currentUri.fsPath);
        if (options.isCancelled?.()) { throw new vscode.CancellationError(); }
        const room = Math.max(0, maxEntries - seen);
        if (entries.length > room) { truncated = true; }
        seen += Math.min(entries.length, room);
        options.onProgress?.(seen);

        const nodes: DirectoryTreeNode[] = [];
        for (const [name, type] of sortEntries(entries).slice(0, room)) {
            const entryUri = vscode.Uri.joinPath(currentUri, name);
            const relativePath = path.relative(rootUri.fsPath, entryUri.fsPath).split(path.sep).join('/');
            if (listsFolder(name, type)) {
                const children = await list(entryUri);
                if (children.length > 0) { nodes.push({ type: 'directory', name, relativePath, children }); }
            } else if ((type & vscode.FileType.Directory) === 0 && (type & vscode.FileType.File) !== 0 && isSupportedAudioFile(name)) {
                nodes.push({ type: 'file', name, relativePath, filePath: entryUri.fsPath });
            }
        }
        return nodes;
    }

    const tree = await list(rootUri);
    return { tree, truncated };
}

export async function pickAudioTarget(
    targetKind?: SelectionTargetKind,
    showOpenDialog: OpenDialog = vscode.window.showOpenDialog,
    language: string = vscode.env.language,
): Promise<vscode.Uri | undefined> {
    const strings = getStrings(language);
    const selected = await showOpenDialog({
        canSelectMany: false,
        canSelectFiles: targetKind !== 'directory',
        canSelectFolders: targetKind !== 'file',
        openLabel: targetKind === 'directory'
            ? strings.dialogSelectAudioDirectory
            : targetKind === 'file'
                ? strings.dialogSelectAudioFile
                : strings.dialogAnalyzeAudioTarget,
        filters: targetKind !== 'directory'
            ? { [strings.dialogAudioFilesFilter]: SUPPORTED_AUDIO_DIALOG_EXTENSIONS }
            : undefined,
    });
    return selected?.[0];
}

/** Audio files to add beside the ones listed (＋ Add files): any number, from anywhere. */
export async function pickAudioFiles(
    showOpenDialog: OpenDialog = vscode.window.showOpenDialog,
    language: string = vscode.env.language,
): Promise<vscode.Uri[]> {
    const strings = getStrings(language);
    const selected = await showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: strings.dialogSelectAudioFile,
        filters: { [strings.dialogAudioFilesFilter]: SUPPORTED_AUDIO_DIALOG_EXTENSIONS },
    });
    return selected ?? [];
}

export function getDebugTargetUri(
    extensionUri: vscode.Uri,
    debugFilePath: string,
    workspaceFolder?: vscode.WorkspaceFolder,
): vscode.Uri | undefined {
    const configuredPath = debugFilePath.trim();
    if (!configuredPath) { return undefined; }
    if (path.isAbsolute(configuredPath)) { return vscode.Uri.file(configuredPath); }
    return workspaceFolder
        ? vscode.Uri.joinPath(workspaceFolder.uri, configuredPath)
        : vscode.Uri.joinPath(extensionUri, configuredPath);
}
