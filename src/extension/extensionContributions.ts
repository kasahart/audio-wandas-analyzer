import * as path from 'path';
import * as vscode from 'vscode';
import { fileCountLabel, fillTemplate, getStrings } from '../shared/i18n/strings';
import { isSupportedAudioFile } from '../shared/utils/audioTarget';
import { selectPythonEnvironment } from './pythonEnvironment';
import type { RecipeFlow } from './recipeFlow';
import { getDebugTargetUri, pickAudioTarget } from './targetDiscovery';

export interface AudioTargetController {
    analyzeTarget(
        uri: vscode.Uri,
        existingPanel?: vscode.WebviewPanel,
        options?: { autoSelectAllDirectoryFiles?: boolean },
    ): Promise<void>;
    analyzeFiles(filePaths: string[], existingPanel?: vscode.WebviewPanel): Promise<void>;
}

export interface TargetOpenHost {
    stat(uri: vscode.Uri): Thenable<vscode.FileStat>;
    showError(message: string): void;
    language(): string;
}

const defaultTargetOpenHost: TargetOpenHost = {
    stat: (uri) => vscode.workspace.fs.stat(uri),
    showError: (message) => { void vscode.window.showErrorMessage(message); },
    language: () => vscode.env.language,
};

function reportOpenFailure(host: TargetOpenHost, label: string, error: unknown): void {
    host.showError(fillTemplate(getStrings(host.language()).openTargetFailed, {
        path: label,
        reason: error instanceof Error ? error.message : String(error),
    }));
}

/** Opens a file or folder the user named; a failure (no audio in it, a path that cannot be read) is a message, not a failed command. */
export async function openTarget(
    controller: AudioTargetController,
    uri: vscode.Uri,
    host: TargetOpenHost = defaultTargetOpenHost,
): Promise<void> {
    try {
        await controller.analyzeTarget(uri);
    } catch (error) {
        reportOpenFailure(host, uri.fsPath || uri.toString(), error);
    }
}

/** One dropped folder or audio file opens as a target; several dropped files open side by side. */
export async function openDroppedTargets(
    controller: AudioTargetController,
    uris: vscode.Uri[],
    host: TargetOpenHost = defaultTargetOpenHost,
): Promise<void> {
    if (uris.length === 1) {
        const uri = uris[0];
        let stat: vscode.FileStat;
        try {
            stat = await host.stat(uri);
        } catch (error) {
            reportOpenFailure(host, uri.fsPath || uri.toString(), error);
            return;
        }
        if ((stat.type & vscode.FileType.Directory) !== 0
            || isSupportedAudioFile(path.basename(uri.fsPath))) {
            await openTarget(controller, uri, host);
        }
        return;
    }
    const filePaths = uris
        .map((uri) => uri.fsPath)
        .filter((filePath) => isSupportedAudioFile(path.basename(filePath)));
    if (filePaths.length === 0) { return; }
    try {
        await controller.analyzeFiles(filePaths);
    } catch (error) {
        reportOpenFailure(host, fileCountLabel(getStrings(host.language()), filePaths.length), error);
    }
}

function configuredDebugTarget(context: vscode.ExtensionContext): vscode.Uri | undefined {
    const debugFilePath = vscode.workspace
        .getConfiguration('audioWandasAnalyzer')
        .get<string>('debugFilePath', 'media/debug');
    return getDebugTargetUri(
        context.extensionUri,
        debugFilePath,
        vscode.workspace.workspaceFolders?.[0],
    );
}

async function analyzeDebugTarget(
    context: vscode.ExtensionContext,
    controller: AudioTargetController,
): Promise<void> {
    const target = configuredDebugTarget(context);
    if (!target) {
        void vscode.window.showErrorMessage(
            'Debug audio path is not configured. Set audioWandasAnalyzer.debugFilePath to an audio file or directory.',
        );
        return;
    }
    try {
        await vscode.workspace.fs.stat(target);
    } catch {
        void vscode.window.showErrorMessage(
            `Debug audio path was not found: ${target.fsPath}. Update audioWandasAnalyzer.debugFilePath or add the file or directory.`,
        );
        return;
    }
    await openTarget(controller, target);
}

export async function autoOpenDebugTarget(
    context: vscode.ExtensionContext,
    controller: AudioTargetController,
    autoSelectAllDirectoryFiles: boolean,
): Promise<void> {
    await Promise.resolve();
    const target = configuredDebugTarget(context);
    if (!target) { return; }
    try {
        await vscode.workspace.fs.stat(target);
        await controller.analyzeTarget(target, undefined, { autoSelectAllDirectoryFiles });
    } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
}

export function registerExtensionContributions(
    context: vscode.ExtensionContext,
    pythonStatusBarItem: vscode.StatusBarItem,
    controller: AudioTargetController,
    recipeFlow: RecipeFlow,
    onPythonEnvironmentReselected: (pythonCommand: string) => void,
): void {
    const welcomeDropTarget = new vscode.TreeItem('Drop audio files or folders here');
    welcomeDropTarget.description = 'Click to choose a file or folder';
    welcomeDropTarget.command = {
        command: 'audioWandasAnalyzer.analyzeFile',
        title: 'Analyze File or Folder',
    };
    welcomeDropTarget.iconPath = new vscode.ThemeIcon('new-file');

    const welcomeView = vscode.window.createTreeView('audioWandasAnalyzer.welcomeView', {
        treeDataProvider: {
            getTreeItem: (element: vscode.TreeItem) => element,
            getChildren: () => [welcomeDropTarget],
        },
        dragAndDropController: {
            dropMimeTypes: ['text/uri-list', 'application/vnd.code.tree.workbenchExplorerFiles'],
            dragMimeTypes: [],
            async handleDrop(_target, dataTransfer) {
                const uriList = await dataTransfer.get('text/uri-list')?.asString() ?? '';
                const uris = uriList
                    .split(/\r?\n/)
                    .filter((value) => value.trim() && !value.startsWith('#'))
                    .map((value) => vscode.Uri.parse(value.trim()));
                await openDroppedTargets(controller, uris);
            },
        },
    });

    context.subscriptions.push(
        welcomeView,
        vscode.commands.registerCommand('audioWandasAnalyzer.analyzeFile', async () => {
            const selected = await pickAudioTarget();
            if (selected) { await openTarget(controller, selected); }
        }),
        vscode.commands.registerCommand('audioWandasAnalyzer.analyzeDebugFile', async () => {
            await analyzeDebugTarget(context, controller);
        }),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.analyzeThisTarget',
            async (contextUri?: vscode.Uri) => {
                const selected = contextUri ?? await pickAudioTarget();
                if (selected) { await openTarget(controller, selected); }
            },
        ),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.selectPythonEnvironment',
            async () => {
                const reselected = await selectPythonEnvironment(pythonStatusBarItem);
                if (reselected) { onPythonEnvironmentReselected(reselected); }
            },
        ),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.runRecipe',
            async (filePaths?: string[]) => { await recipeFlow.run(filePaths); },
        ),
    );
}
