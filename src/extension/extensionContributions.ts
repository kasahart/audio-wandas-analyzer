import * as path from 'path';
import * as vscode from 'vscode';
import { fillTemplate, getStrings } from '../shared/i18n/strings';
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
        void vscode.window.showErrorMessage(getStrings(vscode.env.language).debugPathNotConfigured);
        return;
    }
    try {
        await vscode.workspace.fs.stat(target);
    } catch {
        void vscode.window.showErrorMessage(
            fillTemplate(getStrings(vscode.env.language).debugPathNotFound, { path: target.fsPath }),
        );
        return;
    }
    await controller.analyzeTarget(target);
}

/** Why the host needs Python: an explicit command retries a failed environment check, a view does not. */
export type PythonNeed = 'command' | 'view';

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
    preparePython: (reason: PythonNeed) => Promise<void>,
): void {
    const strings = getStrings(vscode.env.language);
    const needPython = (reason: PythonNeed): void => { void preparePython(reason); };
    const welcomeDropTarget = new vscode.TreeItem(strings.welcomeDropLabel);
    welcomeDropTarget.description = strings.welcomeDropDescription;
    welcomeDropTarget.command = {
        command: 'audioWandasAnalyzer.analyzeFile',
        title: strings.welcomeDropCommand,
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
                needPython('command');
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

    if (welcomeView.visible) { needPython('view'); }

    context.subscriptions.push(
        welcomeView,
        welcomeView.onDidChangeVisibility((event) => {
            if (event.visible) { needPython('view'); }
        }),
        vscode.commands.registerCommand('audioWandasAnalyzer.analyzeFile', async () => {
            needPython('command');
            const selected = await pickAudioTarget();
            if (selected) { await controller.analyzeTarget(selected); }
        }),
        vscode.commands.registerCommand('audioWandasAnalyzer.analyzeDebugFile', async () => {
            needPython('command');
            await analyzeDebugTarget(context, controller);
        }),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.analyzeThisTarget',
            async (contextUri?: vscode.Uri) => {
                needPython('command');
                const selected = contextUri ?? await pickAudioTarget();
                if (selected) { await controller.analyzeTarget(selected); }
            },
        ),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.selectPythonEnvironment',
            async () => { await selectPythonEnvironment(pythonStatusBarItem); },
        ),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.runRecipe',
            async (filePaths?: string[]) => {
                needPython('command');
                await recipeFlow.run(filePaths);
            },
        ),
    );
}
