import * as path from 'path';
import * as vscode from 'vscode';
import {
    DEFAULT_SPECTROGRAM_SETTINGS,
    type AnalysisResult,
    type AnalysisResultWithError,
    type AnalysisUpdateMessage,
    type DirectoryTreeNode,
    type RequestReanalyzeMessage,
    type SpectrogramSettings,
    type StftOptions,
    type UpdateSpectrogramSettingsMessage,
} from '../shared/analysis/analysisTypes';
import {
    isAnalyzeSelectedFilesMessage,
    isExportWavLoopMessage,
    isSelectPythonEnvironmentMessage,
    isSelectTargetMessage,
    isSupportedAudioFile,
    isRequestWaveformRangeMessage,
    isExportReportOptionsMessage,
    type SelectionTargetKind,
} from '../shared/utils/audioTarget';
import {
    collectAudioFilePaths,
    collectSelectedResults,
    diffSelectedAudioFilePaths,
    sanitizeSelectedAudioFilePaths,
} from '../shared/utils/directorySelection';
import { getDebugStartupBehavior } from '../shared/utils/startupDebug';
import { getStrings } from '../shared/i18n/strings';
import { ComparisonPanel } from '../webview/panels/ComparisonPanel';
import {
    checkAndPromptInstallDependencies,
    getCurrentPythonEnvironmentState,
    onDidChangePythonEnvironmentState,
    selectPythonEnvironment,
    setStatusBarNormal,
    type PythonEnvironmentState,
} from './pythonEnvironment';
import { PythonBackendServer } from './pythonBackendServer';
import { runRecipe } from './recipeRunner';
import { ChartSpecPanel } from '../webview/panels/ChartSpecPanel';

const SPECTROGRAM_SETTINGS_KEY = 'audioWandasAnalyzer.spectrogramSettings';

function loadSpectrogramSettings(context: vscode.ExtensionContext): SpectrogramSettings {
    const stored = context.workspaceState.get<SpectrogramSettings>(SPECTROGRAM_SETTINGS_KEY);
    return stored ?? DEFAULT_SPECTROGRAM_SETTINGS;
}

function loadPersistedStftOptions(context: vscode.ExtensionContext): StftOptions | undefined {
    const settings = loadSpectrogramSettings(context);
    return settings.auto ? undefined : settings.stft;
}

const panelMessageDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();
const panelResultFilePaths = new WeakMap<vscode.WebviewPanel, string[]>();
const panelPythonEnvironmentDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();
const panelDirectorySelections = new WeakMap<vscode.WebviewPanel, {
    rootPath: string;
    tree: DirectoryTreeNode[];
    allFilePaths: string[];
    selectedFilePaths: string[];
    cachedResultsByFilePath: Map<string, AnalysisResultWithError>;
    latestRequestId?: string;
}>();

let backendServer: PythonBackendServer | null = null;
let perfChannel: vscode.OutputChannel | null = null;

function getPerfChannel(): vscode.OutputChannel {
    if (!perfChannel) {
        perfChannel = vscode.window.createOutputChannel('Audio Wandas Analyzer (perf)');
    }
    return perfChannel;
}

function logPerf(line: string): void {
    getPerfChannel().appendLine(line);
}

interface AnalyzeTargetOptions {
    autoSelectAllDirectoryFiles?: boolean;
}

export function activate(context: vscode.ExtensionContext): void {
    const welcomeDropTarget = new vscode.TreeItem('Drop audio files or folders here');
    welcomeDropTarget.description = 'Click to choose a file or folder';
    welcomeDropTarget.command = {
        command: 'audioWandasAnalyzer.analyzeFile',
        title: 'Analyze File or Folder',
    };
    welcomeDropTarget.iconPath = new vscode.ThemeIcon('new-file');
    backendServer = new PythonBackendServer(context.extensionPath, (line) => logPerf(`[py] ${line.slice(7)}`));
    context.subscriptions.push({ dispose: () => { backendServer?.dispose(); backendServer = null; } });
    context.subscriptions.push({ dispose: () => { perfChannel?.dispose(); perfChannel = null; } });
    const pythonStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        10,
    );
    pythonStatusBarItem.command = 'audioWandasAnalyzer.selectPythonEnvironment';
    context.subscriptions.push(pythonStatusBarItem);

    const welcomeViewProvider: vscode.TreeDataProvider<vscode.TreeItem> = {
        getTreeItem: (element) => element,
        getChildren: () => [welcomeDropTarget],
    };
    const welcomeView = vscode.window.createTreeView('audioWandasAnalyzer.welcomeView', {
        treeDataProvider: welcomeViewProvider,
        dragAndDropController: {
            dropMimeTypes: ['text/uri-list', 'application/vnd.code.tree.workbenchExplorerFiles'],
            dragMimeTypes: [],
            async handleDrop(_target, dataTransfer) {
                const uriList = await dataTransfer.get('text/uri-list')?.asString() ?? '';
                const uris = uriList
                    .split(/\r?\n/)
                    .filter((value) => value.trim() && !value.startsWith('#'))
                    .map((value) => vscode.Uri.parse(value.trim()));

                if (uris.length === 0) {
                    return;
                }

                if (uris.length === 1) {
                    const droppedUri = uris[0];
                    const droppedStat = await vscode.workspace.fs.stat(droppedUri);
                    const isDirectory = (droppedStat.type & vscode.FileType.Directory) !== 0;
                    if (isDirectory || isSupportedAudioFile(path.basename(droppedUri.fsPath))) {
                        await analyzeAudioTarget(context, droppedUri);
                    }
                    return;
                }

                const filePaths = uris
                    .map((uri) => uri.fsPath)
                    .filter((filePath) => isSupportedAudioFile(path.basename(filePath)));

                if (filePaths.length > 0) {
                    await analyzeMultipleFiles(context, filePaths);
                }
            },
        },
    });

    const analyzeFileDisposable = vscode.commands.registerCommand('audioWandasAnalyzer.analyzeFile', async () => {
        const selected = await pickAudioTarget();

        if (!selected) {
            return;
        }

        await analyzeAudioTarget(context, selected);
    });

    const analyzeDebugFileDisposable = vscode.commands.registerCommand('audioWandasAnalyzer.analyzeDebugFile', async () => {
        const debugTargetUri = getDebugTargetUri(context.extensionUri);

        if (!debugTargetUri) {
            void vscode.window.showErrorMessage(
                'Debug audio path is not configured. Set audioWandasAnalyzer.debugFilePath to an audio file or directory.',
            );
            return;
        }

        try {
            await vscode.workspace.fs.stat(debugTargetUri);
        } catch {
            void vscode.window.showErrorMessage(
                `Debug audio path was not found: ${debugTargetUri.fsPath}. Update audioWandasAnalyzer.debugFilePath or add the file or directory.`,
            );
            return;
        }

        await analyzeAudioTarget(context, debugTargetUri);
    });

    const analyzeThisTargetDisposable = vscode.commands.registerCommand(
        'audioWandasAnalyzer.analyzeThisTarget',
        async (contextUri?: vscode.Uri) => {
            const selected = contextUri ?? await pickAudioTarget();

            if (!selected) {
                return;
            }

            await analyzeAudioTarget(context, selected);
        },
    );

    context.subscriptions.push(
        welcomeView,
        analyzeFileDisposable,
        analyzeThisTargetDisposable,
        analyzeDebugFileDisposable,
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.selectPythonEnvironment',
            () => selectPythonEnvironment(pythonStatusBarItem),
        ),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'audioWandasAnalyzer.runRecipe',
            async (filePathsFromCaller?: string[]) => {
                await runRecipeFlow(context, filePathsFromCaller);
            },
        ),
    );
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('audioWandasAnalyzer.pythonCommand')) {
                const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
                const pythonCommand = config.get<string>('pythonCommand', 'python3');
                setStatusBarNormal(pythonStatusBarItem, pythonCommand);
                void checkAndPromptInstallDependencies(pythonCommand, pythonStatusBarItem);
            }
        }),
    );

    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { registerWorkspaceTests } = require('../testing/workspaceTests') as typeof import('../testing/workspaceTests');
        registerWorkspaceTests(context);
    } catch {
        // workspace test discovery requires the typescript compiler API which is
        // not bundled in the VSIX. This is a dev-only feature; silence the error
        // for end-users.
    }

    const startupBehavior = getDebugStartupBehavior(process.env);
    if (startupBehavior.closePanelOnStartup) {
        void vscode.commands.executeCommand('workbench.action.closePanel');
    }

    if (startupBehavior.autoOpenDebugTarget) {
        void autoOpenDebugTargetOnStartup(context, startupBehavior.autoSelectAllDirectoryFiles);
    }

    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const pythonCommand = config.get<string>('pythonCommand', 'python3');
    setStatusBarNormal(pythonStatusBarItem, pythonCommand);
    void checkAndPromptInstallDependencies(pythonCommand, pythonStatusBarItem);
}

export function deactivate(): void { }

async function analyzeAudioTarget(
    context: vscode.ExtensionContext,
    targetUri: vscode.Uri,
    existingPanel?: vscode.WebviewPanel,
    options: AnalyzeTargetOptions = {},
): Promise<void> {
    const targetStat = await vscode.workspace.fs.stat(targetUri);

    if ((targetStat.type & vscode.FileType.Directory) !== 0) {
        const tree = await buildDirectoryTree(targetUri, targetUri);
        const filePaths = collectAudioFilePaths(tree);

        if (filePaths.length === 0) {
            throw new Error(`No supported audio files were found in ${targetUri.fsPath}`);
        }

        if (options.autoSelectAllDirectoryFiles) {
            await analyzeMultipleFiles(context, filePaths, existingPanel);
            return;
        }

        const comparisonPanel = showDirectorySelectionPanel(
            context,
            targetUri.fsPath,
            tree,
            filePaths,
            [],
            [],
            existingPanel,
        );
        panelDirectorySelections.set(comparisonPanel, {
            rootPath: targetUri.fsPath,
            tree,
            allFilePaths: filePaths,
            selectedFilePaths: [],
            cachedResultsByFilePath: new Map(),
        });
        registerPanelMessageHandler(context, comparisonPanel);
        return;
    }

    if (existingPanel) {
        panelDirectorySelections.delete(existingPanel);
    }
    await analyzeMultipleFiles(context, [targetUri.fsPath], existingPanel);
}

async function autoOpenDebugTargetOnStartup(
    context: vscode.ExtensionContext,
    autoSelectAllDirectoryFiles: boolean,
): Promise<void> {
    await Promise.resolve();

    const debugTargetUri = getDebugTargetUri(context.extensionUri);
    if (!debugTargetUri) {
        return;
    }

    try {
        await vscode.workspace.fs.stat(debugTargetUri);
        await analyzeAudioTarget(context, debugTargetUri, undefined, { autoSelectAllDirectoryFiles });
    } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(messageText);
    }
}

function registerPanelMessageHandler(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
): void {
    panelMessageDisposables.get(panel)?.dispose();

    const disposable = panel.webview.onDidReceiveMessage(async (message: unknown) => {
        try {
            if (isAnalyzeSelectedFilesMessage(message)) {
                const selection = panelDirectorySelections.get(panel);
                if (!selection) {
                    return;
                }

                const selectedFilePaths = sanitizeSelectedAudioFilePaths(selection.tree, message.filePaths);
                const selectionDelta = diffSelectedAudioFilePaths(selection.selectedFilePaths, selectedFilePaths);
                selection.latestRequestId = message.requestId;
                selection.selectedFilePaths = selectedFilePaths;
                panelDirectorySelections.set(panel, selection);

                if (selectedFilePaths.length === 0) {
                    showDirectorySelectionPanel(
                        context,
                        selection.rootPath,
                        selection.tree,
                        selection.allFilePaths,
                        selectedFilePaths,
                        [],
                        panel,
                    );
                    return;
                }

                const newlyAddedFilePathSet = new Set(selectionDelta.addedFilePaths);
                const uncachedSelectedFilePaths = [
                    ...selectionDelta.addedFilePaths.filter((filePath) => !selection.cachedResultsByFilePath.has(filePath)),
                    ...selectedFilePaths.filter((filePath) => {
                        return !newlyAddedFilePathSet.has(filePath)
                            && !selection.cachedResultsByFilePath.has(filePath);
                    }),
                ];

                if (uncachedSelectedFilePaths.length > 0) {
                    const newResults = await analyzeFilesWithProgress(
                        context,
                        uncachedSelectedFilePaths,
                        loadPersistedStftOptions(context),
                    );
                    const currentSelectionAfterLoad = panelDirectorySelections.get(panel);
                    if (!currentSelectionAfterLoad) {
                        return;
                    }

                    for (const result of newResults) {
                        currentSelectionAfterLoad.cachedResultsByFilePath.set(result.filePath, result);
                    }

                    panelDirectorySelections.set(panel, currentSelectionAfterLoad);
                }

                const currentSelection = panelDirectorySelections.get(panel);
                if (!currentSelection || currentSelection.latestRequestId !== message.requestId) {
                    return;
                }

                const results = collectSelectedResults(
                    currentSelection.selectedFilePaths,
                    currentSelection.cachedResultsByFilePath,
                );

                backendServer?.warmup();
                showDirectorySelectionPanel(
                    context,
                    currentSelection.rootPath,
                    currentSelection.tree,
                    currentSelection.allFilePaths,
                    currentSelection.selectedFilePaths,
                    results,
                    panel,
                );
                return;
            }

            if (isSelectPythonEnvironmentMessage(message)) {
                await vscode.commands.executeCommand('audioWandasAnalyzer.selectPythonEnvironment');
                return;
            }

            if (isRunRecipeMessage(message)) {
                const filePaths = getActiveFilePathsForPanel(panel);
                await vscode.commands.executeCommand('audioWandasAnalyzer.runRecipe', filePaths);
                return;
            }

            if (isSelectTargetMessage(message)) {
                const selected = await pickAudioTarget(message.targetKind);

                if (!selected) {
                    return;
                }

                await analyzeAudioTarget(context, selected, panel);
                return;
            }

            if (isUpdateSpectrogramSettingsMessage(message)) {
                await context.workspaceState.update(SPECTROGRAM_SETTINGS_KEY, message.settings);
                return;
            }

            if (isRequestReanalyzeMessage(message)) {
                await context.workspaceState.update(SPECTROGRAM_SETTINGS_KEY, message.settings);
                const filePaths = getActiveFilePathsForPanel(panel);
                const stftOptions = message.settings.auto ? undefined : message.settings.stft;
                await panel.webview.postMessage({ type: 'reanalyze-start', count: filePaths.length });
                try {
                    const results = await analyzeFilesWithProgress(
                        context,
                        filePaths,
                        stftOptions,
                        `Recomputing spectrogram (${filePaths.length} file${filePaths.length === 1 ? '' : 's'})`,
                        panel,
                    );
                    await panel.webview.postMessage({ type: 'analysis-update', results } satisfies AnalysisUpdateMessage);
                } finally {
                    await panel.webview.postMessage({ type: 'reanalyze-end' });
                }
                return;
            }

            if (isRequestWaveformRangeMessage(message)) {
                const req = message;
                backendServer?.requestRange(
                    req.filePath,
                    req.startNorm,
                    req.endNorm,
                    req.points,
                    req.requestId,
                ).then((result) => {
                    void panel.webview.postMessage({
                        type: 'waveform-range-result',
                        requestId: req.requestId,
                        trackIndex: req.trackIndex,
                        startNorm: req.startNorm,
                        endNorm: req.endNorm,
                        channels: result.channels,
                    });
                }).catch(() => {
                    // Silently ignore — WebView falls back to overview data
                });
                return;
            }

            if (isExportWavLoopMessage(message)) {
                if (!backendServer) { return; }
                const folderUris = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: 'Select output folder',
                });
                if (!folderUris || folderUris.length === 0) { return; }
                const outFolder = folderUris[0];

                let successCount = 0;
                const errors: string[] = [];
                const usedNames = new Set<string>();
                for (const filePath of message.filePaths) {
                    try {
                        const result = await backendServer.exportWavLoop(
                            filePath,
                            message.startNorm,
                            message.endNorm,
                        );
                        const stem = path.basename(filePath, path.extname(filePath));
                        let baseName = stem + '_loop.wav';
                        if (usedNames.has(baseName)) {
                            let n = 2;
                            while (usedNames.has(stem + `_loop_${n}.wav`)) { n++; }
                            baseName = stem + `_loop_${n}.wav`;
                        }
                        usedNames.add(baseName);
                        const outUri = vscode.Uri.joinPath(outFolder, baseName);
                        const buf = Buffer.from(result.wavBase64, 'base64');
                        await vscode.workspace.fs.writeFile(outUri, buf);
                        successCount++;
                    } catch (err) {
                        errors.push(`${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
                if (errors.length > 0) {
                    void vscode.window.showErrorMessage(
                        `WAV export: ${successCount} succeeded, ${errors.length} failed — ${errors.join('; ')}`,
                    );
                } else {
                    void vscode.window.showInformationMessage(
                        `WAV export complete (${successCount} file${successCount !== 1 ? 's' : ''}) → ${outFolder.fsPath}`,
                    );
                }
                return;
            }

            if (typeof message === 'object' && message !== null && (message as Record<string, unknown>)['type'] === 'show-info') {
                const msg = (message as Record<string, unknown>)['message'];
                if (typeof msg === 'string') {
                    void vscode.window.showInformationMessage(msg);
                }
                return;
            }

            if (isExportReportOptionsMessage(message)) {
                const str = getStrings(vscode.env.language);
                const format = await vscode.window.showQuickPick(
                    [
                        { label: str.reportFormatMarkdown, value: 'markdown' as const },
                        { label: str.reportFormatNotebook, value: 'notebook' as const },
                    ],
                    { placeHolder: str.reportFormatPlaceholder },
                );
                if (!format) { return; }

                const ext = format.value === 'markdown' ? '.md' : '.ipynb';
                const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                const defaultUri = wsFolder
                    ? vscode.Uri.file(path.join(wsFolder, message.defaultName + ext))
                    : undefined;
                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri,
                    filters: format.value === 'markdown'
                        ? { Markdown: ['md'] }
                        : { Notebook: ['ipynb'] },
                    saveLabel: str.reportSaveLabel,
                });
                if (!saveUri) { return; }

                const content = format.value === 'markdown'
                    ? message.markdownContent
                    : message.notebookContent;
                await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf-8'));
                void vscode.window.showInformationMessage(str.reportExportedPrefix + saveUri.fsPath);
                return;
            }
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(messageText);
        }
    });

    panelMessageDisposables.set(panel, disposable);
}

function showDirectorySelectionPanel(
    context: vscode.ExtensionContext,
    rootPath: string,
    directoryTree: DirectoryTreeNode[],
    allFilePaths: string[],
    selectedFilePaths: string[],
    results: AnalysisResultWithError[],
    existingPanel?: vscode.WebviewPanel,
): vscode.WebviewPanel {
    const panel = ComparisonPanel.showDirectorySelection(
        context.extensionUri,
        rootPath,
        directoryTree,
        allFilePaths,
        selectedFilePaths,
        results,
        getCurrentPythonEnvironmentState(),
        existingPanel,
        loadSpectrogramSettings(context),
    );
    panelResultFilePaths.set(panel, results.map((r) => r.filePath));
    ensurePythonEnvironmentStateSync(panel);
    return panel;
}

function ensurePythonEnvironmentStateSync(panel: vscode.WebviewPanel): void {
    if (!panelPythonEnvironmentDisposables.has(panel)) {
        const disposable = onDidChangePythonEnvironmentState((state) => {
            postPythonEnvironmentState(panel, state);
        });
        panelPythonEnvironmentDisposables.set(panel, disposable);
        panel.onDidDispose(() => {
            panelPythonEnvironmentDisposables.get(panel)?.dispose();
            panelPythonEnvironmentDisposables.delete(panel);
        });
    }

    postPythonEnvironmentState(panel, getCurrentPythonEnvironmentState());
}

function getActiveFilePathsForPanel(panel: vscode.WebviewPanel): string[] {
    const selection = panelDirectorySelections.get(panel);
    if (selection) {
        return [...selection.selectedFilePaths];
    }
    const fallback = panelResultFilePaths.get(panel);
    return fallback ? [...fallback] : [];
}

function isRequestReanalyzeMessage(value: unknown): value is RequestReanalyzeMessage {
    return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'request-reanalyze';
}

function isUpdateSpectrogramSettingsMessage(value: unknown): value is UpdateSpectrogramSettingsMessage {
    return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'update-spectrogram-settings';
}

function isRunRecipeMessage(value: unknown): boolean {
    return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'run-recipe';
}

function postPythonEnvironmentState(panel: vscode.WebviewPanel, state: PythonEnvironmentState): void {
    void panel.webview.postMessage({
        type: 'python-environment-state',
        pythonCommand: state.pythonCommand,
        status: state.status,
        tooltip: state.tooltip,
    });
}

async function runRecipeFlow(
    context: vscode.ExtensionContext,
    filePathsFromCaller?: string[],
): Promise<void> {
    const recipesDir = path.join(context.extensionPath, 'python-backend', 'recipes');
    let recipeFiles: string[];
    try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(recipesDir));
        recipeFiles = entries
            .filter(([name, type]) => (type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith('.json'))
            .map(([name]) => name)
            .sort();
    } catch (e) {
        void vscode.window.showErrorMessage(
            `Could not read recipe directory ${recipesDir}: ${(e as Error).message}`,
        );
        return;
    }

    const pickItems = recipeFiles.map((name) => ({ label: name, description: path.join(recipesDir, name) }));
    const browseLabel = '$(folder-opened) Browse...';
    pickItems.push({ label: browseLabel, description: 'Pick a recipe JSON from disk' });
    const picked = await vscode.window.showQuickPick(pickItems, { placeHolder: 'Select a wandas recipe' });
    if (!picked) {
        return;
    }
    let recipePath = picked.description;
    if (picked.label === browseLabel) {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'Recipe JSON': ['json'] },
            openLabel: 'Use recipe',
        });
        if (!uris || uris.length === 0) {
            return;
        }
        recipePath = uris[0].fsPath;
    }

    const selectionFilePaths = filePathsFromCaller && filePathsFromCaller.length > 0
        ? filePathsFromCaller
        : await pickRecipeInputFiles();
    if (!selectionFilePaths) {
        return;
    }

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Running recipe ${path.basename(recipePath)}…` },
        async () => {
            try {
                const result = await runRecipe({
                    recipePath,
                    selectionFilePaths,
                    extensionPath: context.extensionPath,
                });
                ChartSpecPanel.show(context.extensionUri, path.basename(recipePath), result.charts);
            } catch (e) {
                void vscode.window.showErrorMessage(`Recipe execution failed: ${(e as Error).message}`);
            }
        },
    );
}

async function pickRecipeInputFiles(): Promise<string[] | undefined> {
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        filters: { Audio: ['wav', 'flac', 'ogg', 'aiff', 'aif', 'snd'] },
        openLabel: 'Use as recipe input',
    });
    if (!uris || uris.length === 0) {
        return undefined;
    }
    return uris.map((u) => u.fsPath);
}

function getDebugTargetUri(extensionUri: vscode.Uri): vscode.Uri | undefined {
    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const debugFilePath = config.get<string>('debugFilePath', 'media/debug').trim();

    if (!debugFilePath) {
        return undefined;
    }

    if (path.isAbsolute(debugFilePath)) {
        return vscode.Uri.file(debugFilePath);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        return vscode.Uri.joinPath(workspaceFolder.uri, debugFilePath);
    }

    return vscode.Uri.joinPath(extensionUri, debugFilePath);
}

async function buildDirectoryTree(rootUri: vscode.Uri, currentUri: vscode.Uri): Promise<DirectoryTreeNode[]> {
    const entries = await vscode.workspace.fs.readDirectory(currentUri);
    const sortedEntries = [...entries].sort(([leftName, leftType], [rightName, rightType]) => {
        const leftIsDirectory = (leftType & vscode.FileType.Directory) !== 0;
        const rightIsDirectory = (rightType & vscode.FileType.Directory) !== 0;

        if (leftIsDirectory !== rightIsDirectory) {
            return leftIsDirectory ? -1 : 1;
        }

        return leftName.localeCompare(rightName);
    });

    const nodes: DirectoryTreeNode[] = [];

    for (const [name, type] of sortedEntries) {
        const entryUri = vscode.Uri.joinPath(currentUri, name);
        const relativePath = path.relative(rootUri.fsPath, entryUri.fsPath).split(path.sep).join('/');

        if ((type & vscode.FileType.Directory) !== 0) {
            const children = await buildDirectoryTree(rootUri, entryUri);
            if (children.length > 0) {
                nodes.push({
                    type: 'directory',
                    name,
                    relativePath,
                    children,
                });
            }
            continue;
        }

        if ((type & vscode.FileType.File) !== 0 && isSupportedAudioFile(name)) {
            nodes.push({
                type: 'file',
                name,
                relativePath,
                filePath: entryUri.fsPath,
            });
        }
    }

    return nodes;
}

async function pickAudioTarget(targetKind?: SelectionTargetKind): Promise<vscode.Uri | undefined> {
    const selected = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: targetKind !== 'directory',
        canSelectFolders: targetKind !== 'file',
        openLabel: targetKind === 'directory'
            ? 'Select audio directory'
            : targetKind === 'file'
                ? 'Select audio file'
                : 'Analyze audio file or folder',
        filters: targetKind !== 'directory'
            ? {
                'Audio Files': ['wav', 'flac', 'ogg', 'aiff', 'aif', 'snd'],
            }
            : undefined,
    });

    return selected?.[0];
}

async function analyzeMultipleFiles(
    context: vscode.ExtensionContext,
    filePaths: string[],
    panel?: vscode.WebviewPanel,
): Promise<void> {
    let results: AnalysisResultWithError[];
    try {
        results = await analyzeFilesWithProgress(context, filePaths, loadPersistedStftOptions(context));
    } catch (err) {
        if (err instanceof vscode.CancellationError) { return; }
        throw err;
    }
    backendServer?.warmup();
    const comparisonPanel = ComparisonPanel.show(
        context.extensionUri,
        results,
        panel,
        loadSpectrogramSettings(context),
    );
    panelResultFilePaths.set(comparisonPanel, results.map((r) => r.filePath));
    registerPanelMessageHandler(context, comparisonPanel);
}

async function analyzeFilesWithProgress(
    context: vscode.ExtensionContext,
    filePaths: string[],
    stftOptions?: StftOptions,
    titleOverride?: string,
    progressPanel?: vscode.WebviewPanel,
): Promise<AnalysisResultWithError[]> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: titleOverride ?? `Analyzing ${filePaths.length} files with wandas`,
            cancellable: true,
        },
        async (progress, token) => {
            const results: AnalysisResultWithError[] = [];
            for (let i = 0; i < filePaths.length; i++) {
                if (token.isCancellationRequested) { throw new vscode.CancellationError(); }
                const fileName = path.basename(filePaths[i]);
                progress.report({
                    increment: Math.floor(100 / filePaths.length),
                    message: `(${i + 1}/${filePaths.length}) ${fileName}`,
                });
                void progressPanel?.webview.postMessage({
                    type: 'analysis-file-progress',
                    current: i + 1,
                    total: filePaths.length,
                    fileName,
                });
                try {
                    const result = await runAnalysis(context.extensionPath, vscode.Uri.file(filePaths[i]), stftOptions);
                    results.push(result);
                } catch (err) {
                    results.push({
                        filePath: filePaths[i],
                        fileName,
                        sampleRateHz: 0,
                        durationSeconds: 0,
                        channelCount: 0,
                        sampleCount: 0,
                        channels: [],
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }

            return results;
        },
    );
}

async function runAnalysis(extensionPath: string, fileUri: vscode.Uri, stftOptions?: StftOptions): Promise<AnalysisResult> {
    const peakCount = vscode.workspace.getConfiguration('audioWandasAnalyzer').get<number>('defaultPeakCount', 5);
    if (!backendServer) {
        backendServer = new PythonBackendServer(extensionPath, (line) => logPerf(`[py] ${line.slice(7)}`));
    }
    const fileLabel = path.basename(fileUri.fsPath);
    const tReq = Date.now();
    logPerf(`[ts] analyze start file=${fileLabel}`);
    try {
        const result = await backendServer.analyze(fileUri.fsPath, {
            peakCount,
            stftOptions: stftOptions
                ? { nFft: stftOptions.nFft, hopSize: stftOptions.hopSize, window: stftOptions.window }
                : undefined,
        }) as AnalysisResult;
        logPerf(`[ts] analyze done  file=${fileLabel} total_ms=${Date.now() - tReq}`);
        return result;
    } catch (err) {
        logPerf(`[ts] analyze fail  file=${fileLabel} total_ms=${Date.now() - tReq}`);
        throw err;
    }
}
