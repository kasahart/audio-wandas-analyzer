import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { AnalysisPanel, type AnalysisResult } from './panels/AnalysisPanel';

export function activate(context: vscode.ExtensionContext): void {
    const analyzeFileDisposable = vscode.commands.registerCommand('audioWandasAnalyzer.analyzeFile', async () => {
        const selected = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Analyze audio file',
            filters: {
                'Audio Files': ['wav', 'flac', 'ogg', 'aiff', 'aif', 'snd'],
            },
        });

        if (!selected || selected.length === 0) {
            return;
        }

        const fileUri = selected[0];

        await analyzeAudioFile(context, fileUri);
    });

    const analyzeDebugFileDisposable = vscode.commands.registerCommand('audioWandasAnalyzer.analyzeDebugFile', async () => {
        const debugFileUri = getDebugFileUri(context.extensionUri);

        if (!debugFileUri) {
            void vscode.window.showErrorMessage(
                'Debug audio file path is not configured. Set audioWandasAnalyzer.debugFilePath to a WAV file.',
            );
            return;
        }

        try {
            await vscode.workspace.fs.stat(debugFileUri);
        } catch {
            void vscode.window.showErrorMessage(
                `Debug audio file was not found: ${debugFileUri.fsPath}. Update audioWandasAnalyzer.debugFilePath or add the file.`,
            );
            return;
        }

        await analyzeAudioFile(context, debugFileUri);
    });

    context.subscriptions.push(analyzeFileDisposable, analyzeDebugFileDisposable);
}

export function deactivate(): void { }

async function analyzeAudioFile(context: vscode.ExtensionContext, fileUri: vscode.Uri): Promise<void> {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Analyzing audio with wandas',
            cancellable: false,
        },
        async () => {
            try {
                const result = await runAnalysis(context.extensionPath, fileUri);
                AnalysisPanel.show(context.extensionUri, fileUri, result);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`Audio analysis failed: ${message}`);
            }
        },
    );
}

function getDebugFileUri(extensionUri: vscode.Uri): vscode.Uri | undefined {
    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const debugFilePath = config.get<string>('debugFilePath', 'media/debug.wav').trim();

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