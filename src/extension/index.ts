import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AnalysisResult, AnalysisResultWithError, DirectoryTreeNode } from '../shared/analysis/analysisTypes';
import {
    isAnalyzeSelectedFilesMessage,
    isSelectTargetMessage,
    isSupportedAudioFile,
    isRequestWaveformRangeMessage,
    type SelectionTargetKind,
} from '../shared/utils/audioTarget';
import {
    collectAudioFilePaths,
    collectSelectedResults,
    diffSelectedAudioFilePaths,
    sanitizeSelectedAudioFilePaths,
} from '../shared/utils/directorySelection';
import { getDebugStartupBehavior } from '../shared/utils/startupDebug';
import { ComparisonPanel } from '../webview/panels/ComparisonPanel';
import { WaveformServer } from './waveformServer';

const panelMessageDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();
const panelDirectorySelections = new WeakMap<vscode.WebviewPanel, {
    rootPath: string;
    tree: DirectoryTreeNode[];
    allFilePaths: string[];
    selectedFilePaths: string[];
    cachedResultsByFilePath: Map<string, AnalysisResultWithError>;
    latestRequestId?: string;
}>();

let waveformServer: WaveformServer | null = null;

interface AnalyzeTargetOptions {
    autoSelectAllDirectoryFiles?: boolean;
}

export function activate(context: vscode.ExtensionContext): void {
    waveformServer = new WaveformServer(context.extensionPath);
    context.subscriptions.push({ dispose: () => { waveformServer?.dispose(); waveformServer = null; } });

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

    context.subscriptions.push(analyzeFileDisposable, analyzeDebugFileDisposable);

    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { registerWorkspaceTests } = require('../testing/workspaceTests') as typeof import('../testing/workspaceTests');
        registerWorkspaceTests(context);
    } catch (error) {
        console.error('[audioWandasAnalyzer] Failed to register workspace tests', error);
        void vscode.window.showWarningMessage(
            'Audio Wandas Analyzer workspace tests are unavailable. Analyze commands remain available.',
        );
    }

    const startupBehavior = getDebugStartupBehavior(process.env);
    if (startupBehavior.closePanelOnStartup) {
        void vscode.commands.executeCommand('workbench.action.closePanel');
    }

    if (startupBehavior.autoOpenDebugTarget) {
        void autoOpenDebugTargetOnStartup(context, startupBehavior.autoSelectAllDirectoryFiles);
    }
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

        const comparisonPanel = ComparisonPanel.showDirectorySelection(
            context.extensionUri,
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
                    ComparisonPanel.showDirectorySelection(
                        context.extensionUri,
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
                    const newResults = await analyzeFilesWithProgress(context, uncachedSelectedFilePaths);
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

                waveformServer?.warmup();
                ComparisonPanel.showDirectorySelection(
                    context.extensionUri,
                    currentSelection.rootPath,
                    currentSelection.tree,
                    currentSelection.allFilePaths,
                    currentSelection.selectedFilePaths,
                    results,
                    panel,
                );
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

            if (isRequestWaveformRangeMessage(message)) {
                const req = message;
                waveformServer?.requestRange(
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
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(messageText);
        }
    });

    panelMessageDisposables.set(panel, disposable);
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
    const results = await analyzeFilesWithProgress(context, filePaths);
    waveformServer?.warmup();
    const comparisonPanel = ComparisonPanel.show(context.extensionUri, results, panel);
    registerPanelMessageHandler(context, comparisonPanel);
}

async function analyzeFilesWithProgress(
    context: vscode.ExtensionContext,
    filePaths: string[],
): Promise<AnalysisResultWithError[]> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Analyzing ${filePaths.length} files with wandas`,
            cancellable: false,
        },
        async (progress) => {
            const results: AnalysisResultWithError[] = [];
            for (let i = 0; i < filePaths.length; i++) {
                progress.report({
                    increment: Math.floor(100 / filePaths.length),
                    message: `(${i + 1}/${filePaths.length}) ${path.basename(filePaths[i])}`,
                });
                try {
                    const result = await runAnalysis(context.extensionPath, vscode.Uri.file(filePaths[i]));
                    results.push(result);
                } catch (err) {
                    results.push({
                        filePath: filePaths[i],
                        fileName: path.basename(filePaths[i]),
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

async function runAnalysis(extensionPath: string, fileUri: vscode.Uri): Promise<AnalysisResult> {
    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const pythonCommand = config.get<string>('pythonCommand', 'python3');
    const defaultPeakCount = config.get<number>('defaultPeakCount', 5);
    const scriptPath = path.join(extensionPath, 'python-backend', 'main.py');

    return new Promise((resolve, reject) => {
        const process = spawn(
            pythonCommand,
            [scriptPath, '--file', fileUri.fsPath, '--peaks', String(defaultPeakCount)],
            {
                cwd: extensionPath,
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (chunk: Buffer | string) => {
            stdout += chunk.toString();
        });

        process.stderr.on('data', (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });

        process.on('error', (error: Error) => {
            reject(new Error(`Failed to start Python process (${pythonCommand}): ${error.message}`));
        });

        process.on('close', (code: number | null) => {
            if (code !== 0) {
                reject(new Error(stderr.trim() || `Python backend exited with code ${code}`));
                return;
            }

            try {
                const parsed = JSON.parse(stdout) as AnalysisResult;
                resolve(parsed);
            } catch (error) {
                reject(
                    new Error(
                        `Invalid backend response: ${error instanceof Error ? error.message : String(error)}`,
                    ),
                );
            }
        });
    });
}
