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
    await openTarget(controller, target);
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
    /** Resolves false when the environment is not usable; the check has then shown its Install/Select prompt. */
    preparePython: (reason: PythonNeed) => Promise<boolean>,
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
                await openDroppedTargets(controller, uris);
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
            if (selected) { await openTarget(controller, selected); }
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
                if (selected) { await openTarget(controller, selected); }
            },
        ),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.selectPythonEnvironment',
            async () => { await selectPythonEnvironment(pythonStatusBarItem); },
        ),
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.runRecipe',
            async (filePaths?: string[]) => {
                // A recipe runs in the backend, so it waits for the check (and any install) like an analysis does.
                if (!await preparePython('command')) { return; }
                await recipeFlow.run(filePaths);
            },
        ),
    );
}
