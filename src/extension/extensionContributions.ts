import * as path from 'path';
import * as vscode from 'vscode';
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
    await controller.analyzeTarget(target);
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
                if (uris.length === 1) {
                    const uri = uris[0];
                    const stat = await vscode.workspace.fs.stat(uri);
                    if ((stat.type & vscode.FileType.Directory) !== 0
                        || isSupportedAudioFile(path.basename(uri.fsPath))) {
                        await controller.analyzeTarget(uri);
                    }
                    return;
                }
                const filePaths = uris
                    .map((uri) => uri.fsPath)
                    .filter((filePath) => isSupportedAudioFile(path.basename(filePath)));
                if (filePaths.length > 0) {
                    await controller.analyzeFiles(filePaths);
                }
            },
        },
    });

    context.subscriptions.push(
        welcomeView,
        vscode.commands.registerCommand('audioWandasAnalyzer.analyzeFile', async () => {
            const selected = await pickAudioTarget();
            if (selected) { await controller.analyzeTarget(selected); }
        }),
        vscode.commands.registerCommand('audioWandasAnalyzer.analyzeDebugFile', async () => {
            await analyzeDebugTarget(context, controller);
        }),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.analyzeThisTarget',
            async (contextUri?: vscode.Uri) => {
                const selected = contextUri ?? await pickAudioTarget();
                if (selected) { await controller.analyzeTarget(selected); }
            },
        ),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.selectPythonEnvironment',
            () => selectPythonEnvironment(pythonStatusBarItem),
        ),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.runRecipe',
            async (filePaths?: string[]) => { await recipeFlow.run(filePaths); },
        ),
    );
}
