import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { AnalysisPanel, type AnalysisResult, type DirectoryTreeNode } from './panels/AnalysisPanel';
import { registerWorkspaceTests } from './testing/workspaceTests';
import {
    isAnalyzeFileMessage,
    isSelectTargetMessage,
    isSupportedAudioFile,
    isCompareFilesMessage,
    isRequestWaveformRangeMessage,
    type SelectionTargetKind,
} from './utils/audioTarget';
import { ComparisonPanel } from './panels/ComparisonPanel';

interface DirectoryBrowserContext {
    directoryUri: vscode.Uri;
    tree: DirectoryTreeNode[];
}

const panelMessageDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();

export function activate(context: vscode.ExtensionContext): void {
    registerWorkspaceTests(context);

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
}

export function deactivate(): void { }

async function analyzeAudioTarget(
    context: vscode.ExtensionContext,
    targetUri: vscode.Uri,
    existingPanel?: vscode.WebviewPanel,
): Promise<void> {
    const targetStat = await vscode.workspace.fs.stat(targetUri);

    if ((targetStat.type & vscode.FileType.Directory) !== 0) {
        const tree = await buildDirectoryTree(targetUri, targetUri);

        if (tree.length === 0) {
            throw new Error(`No supported audio files were found in ${targetUri.fsPath}`);
        }

        const browserPanel = AnalysisPanel.showDirectoryBrowser(
            context.extensionUri,
            targetUri,
            tree,
            undefined,
            undefined,
            existingPanel,
        );
        registerPanelMessageHandler(context, browserPanel, { directoryUri: targetUri, tree });
        return;
    }

    await analyzeAudioFile(context, targetUri, existingPanel);
}

async function analyzeAudioFile(
    context: vscode.ExtensionContext,
    fileUri: vscode.Uri,
    panel?: vscode.WebviewPanel,
    directoryContext?: DirectoryBrowserContext,
): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Analyzing audio with wandas',
            cancellable: false,
        },
        async (progress) => {
            progress.report({
                increment: 100,
                message: path.basename(fileUri.fsPath),
            });

            try {
                const result = await runAnalysis(context.extensionPath, fileUri);
                if (directoryContext && panel) {
                    const browserPanel = AnalysisPanel.showDirectoryBrowser(
                        context.extensionUri,
                        directoryContext.directoryUri,
                        directoryContext.tree,
                        fileUri,
                        result,
                        panel,
                    );
                    registerPanelMessageHandler(context, browserPanel, directoryContext);
                    return;
                }

                const analysisPanel = AnalysisPanel.show(context.extensionUri, fileUri, result, panel);
                registerPanelMessageHandler(context, analysisPanel);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(message);
            }
        },
    );
}

function registerPanelMessageHandler(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    directoryContext?: DirectoryBrowserContext,
): void {
    panelMessageDisposables.get(panel)?.dispose();

    const disposable = panel.webview.onDidReceiveMessage(async (message: unknown) => {
        try {
            if (isAnalyzeFileMessage(message)) {
                await analyzeAudioFile(context, vscode.Uri.file(message.filePath), panel, directoryContext);
                return;
            }

            if (isSelectTargetMessage(message)) {
                const selected = await pickAudioTarget(message.targetKind);

                if (!selected) {
                    return;
                }

                await analyzeAudioTarget(context, selected, panel);
            }

            if (isCompareFilesMessage(message)) {
                await analyzeMultipleFiles(context, message.filePaths, panel);
                return;
            }

            if (isRequestWaveformRangeMessage(message)) {
                const req = message;
                runRangeAnalysis(
                    context.extensionPath,
                    req.filePath,
                    req.startNorm,
                    req.endNorm,
                    req.points,
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

// AnalysisResult にエラー状態を持たせるために拡張した型
interface AnalysisResultOrError extends AnalysisResult {
    error?: string;
}

async function analyzeMultipleFiles(
    context: vscode.ExtensionContext,
    filePaths: string[],
    panel?: vscode.WebviewPanel,
): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Analyzing ${filePaths.length} files with wandas`,
            cancellable: false,
        },
        async (progress) => {
            const results: AnalysisResultOrError[] = [];
            for (let i = 0; i < filePaths.length; i++) {
                progress.report({
                    increment: Math.floor(100 / filePaths.length),
                    message: `(${i + 1}/${filePaths.length}) ${path.basename(filePaths[i])}`,
                });
                try {
                    const result = await runAnalysis(context.extensionPath, vscode.Uri.file(filePaths[i]));
                    results.push(result);
                } catch (err) {
                    // 1件失敗してもパネルは開く。エラー情報をトラックに載せる
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
            const comparisonPanel = ComparisonPanel.show(context.extensionUri, results, panel);
            registerPanelMessageHandler(context, comparisonPanel);
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

async function runRangeAnalysis(
    extensionPath: string,
    filePath: string,
    startNorm: number,
    endNorm: number,
    points: number,
): Promise<{ channels: unknown[] }> {
    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const pythonCommand = config.get<string>('pythonCommand', 'python3');
    const scriptPath = path.join(extensionPath, 'python-backend', 'main.py');

    return new Promise((resolve, reject) => {
        const proc = spawn(
            pythonCommand,
            [scriptPath, '--file', filePath,
             '--range-start', String(startNorm),
             '--range-end', String(endNorm),
             '--range-points', String(points)],
            { cwd: extensionPath, stdio: ['ignore', 'pipe', 'pipe'] },
        );

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (chunk: Buffer | string) => { stdout += chunk.toString(); });
        proc.stderr.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
        proc.on('error', reject);
        proc.on('close', (code: number | null) => {
            if (code !== 0) { reject(new Error(stderr.trim())); return; }
            try { resolve(JSON.parse(stdout) as { channels: unknown[] }); } catch (e) { reject(e); }
        });
    });
}