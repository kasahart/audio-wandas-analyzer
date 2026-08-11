import * as path from 'path';
import * as vscode from 'vscode';
import type { DirectoryTreeNode } from '../shared/analysis/analysisTypes';
import { isSupportedAudioFile, type SelectionTargetKind } from '../shared/utils/audioTarget';

const DIRECTORY_READ_CONCURRENCY = 8;

export interface TargetFileSystem {
    stat(uri: vscode.Uri): Thenable<vscode.FileStat>;
    readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
}

export type OpenDialog = (options: vscode.OpenDialogOptions) => Thenable<vscode.Uri[] | undefined>;

async function mapWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    concurrency: number,
): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < tasks.length) {
            const index = nextIndex++;
            results[index] = await tasks[index]();
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

export async function buildDirectoryTree(
    rootUri: vscode.Uri,
    currentUri: vscode.Uri,
    fileSystem: TargetFileSystem = vscode.workspace.fs,
): Promise<DirectoryTreeNode[]> {
    const entries = await fileSystem.readDirectory(currentUri);
    const sortedEntries = [...entries].sort(([leftName, leftType], [rightName, rightType]) => {
        const leftIsDirectory = (leftType & vscode.FileType.Directory) !== 0;
        const rightIsDirectory = (rightType & vscode.FileType.Directory) !== 0;
        if (leftIsDirectory !== rightIsDirectory) { return leftIsDirectory ? -1 : 1; }
        return leftName.localeCompare(rightName);
    });

    const tasks = sortedEntries.map(([name, type]) => async () => {
        const entryUri = vscode.Uri.joinPath(currentUri, name);
        const relativePath = path.relative(rootUri.fsPath, entryUri.fsPath).split(path.sep).join('/');
        if ((type & vscode.FileType.Directory) !== 0) {
            const children = await buildDirectoryTree(rootUri, entryUri, fileSystem);
            return children.length > 0
                ? { type: 'directory' as const, name, relativePath, children }
                : null;
        }
        if ((type & vscode.FileType.File) !== 0 && isSupportedAudioFile(name)) {
            return { type: 'file' as const, name, relativePath, filePath: entryUri.fsPath };
        }
        return null;
    });

    const results = await mapWithConcurrency(tasks, DIRECTORY_READ_CONCURRENCY);
    return results.filter((node): node is NonNullable<typeof node> => node !== null);
}

export async function pickAudioTarget(
    targetKind?: SelectionTargetKind,
    showOpenDialog: OpenDialog = vscode.window.showOpenDialog,
): Promise<vscode.Uri | undefined> {
    const selected = await showOpenDialog({
        canSelectMany: false,
        canSelectFiles: targetKind !== 'directory',
        canSelectFolders: targetKind !== 'file',
        openLabel: targetKind === 'directory'
            ? 'Select audio directory'
            : targetKind === 'file'
                ? 'Select audio file'
                : 'Analyze audio file or folder',
        filters: targetKind !== 'directory'
            ? { 'Audio Files': ['wav', 'flac', 'ogg', 'aiff', 'aif', 'snd'] }
            : undefined,
    });
    return selected?.[0];
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
