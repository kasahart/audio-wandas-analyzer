import { spawn } from 'child_process';
import * as vscode from 'vscode';

const REQUIRED_PACKAGES: readonly string[] = ['numpy', 'wandas'];
const BROWSE_LABEL = '$(folder) Browse...';

class PythonNotFoundError extends Error {
    constructor(pythonCommand: string, cause?: string) {
        super(`Python interpreter not found: ${pythonCommand}${cause ? ` (${cause})` : ''}`);
        this.name = 'PythonNotFoundError';
    }
}

class PipNotAvailableError extends Error {
    constructor(pythonCommand: string) {
        super(`pip is not available in ${pythonCommand}`);
        this.name = 'PipNotAvailableError';
    }
}

interface PythonQuickPickItem extends vscode.QuickPickItem {
    pythonCommand?: string;
}

export function setStatusBarNormal(item: vscode.StatusBarItem, pythonCommand: string): void {
    item.text = `Python: ${pythonCommand}`;
    item.tooltip = 'Click to select Python interpreter';
    item.backgroundColor = undefined;
    item.show();
}

export function setStatusBarWarning(item: vscode.StatusBarItem, pythonCommand: string): void {
    item.text = `Python: ${pythonCommand} $(warning)`;
    item.tooltip = 'Python dependencies are missing. Click to select or install.';
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    item.show();
}

export async function selectPythonEnvironment(statusBarItem: vscode.StatusBarItem): Promise<void> {
    const selectedItem = await vscode.window.showQuickPick<PythonQuickPickItem>([
        { label: '.venv/bin/python', pythonCommand: '.venv/bin/python' },
        { label: 'venv/bin/python', pythonCommand: 'venv/bin/python' },
        { label: 'python3', pythonCommand: 'python3' },
        { label: 'python', pythonCommand: 'python' },
        { label: 'Custom', kind: vscode.QuickPickItemKind.Separator },
        { label: BROWSE_LABEL },
    ], {
        placeHolder: 'Select Python interpreter',
    });

    if (!selectedItem) {
        return;
    }

    let chosen = selectedItem.pythonCommand;
    if (selectedItem.label === BROWSE_LABEL) {
        const selectedFile = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: 'Select Python interpreter',
        });
        chosen = selectedFile?.[0]?.fsPath;
    }

    if (!chosen) {
        return;
    }

    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update('pythonCommand', chosen, target);
    await checkAndPromptInstallDependencies(chosen, statusBarItem);
}

export async function checkAndPromptInstallDependencies(
    pythonCommand: string,
    statusBarItem: vscode.StatusBarItem,
): Promise<void> {
    try {
        const { missingPackages } = await checkMissingDependencies(pythonCommand);
        if (missingPackages.length === 0) {
            setStatusBarNormal(statusBarItem, pythonCommand);
            return;
        }

        setStatusBarWarning(statusBarItem, pythonCommand);
        await promptAndInstallDependencies(pythonCommand, missingPackages, statusBarItem);
    } catch (error) {
        if (error instanceof PythonNotFoundError || error instanceof PipNotAvailableError) {
            setStatusBarWarning(statusBarItem, pythonCommand);
            void vscode.window.showWarningMessage(error.message);
            return;
        }

        throw error;
    }
}

export async function checkMissingDependencies(
    pythonCommand: string,
): Promise<{ missingPackages: string[] }> {
    return new Promise((resolve, reject) => {
        const process = spawn(
            pythonCommand,
            ['-m', 'pip', 'show', ...REQUIRED_PACKAGES],
            {
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

        process.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT' || error.code === 'EACCES') {
                reject(new PythonNotFoundError(pythonCommand, error.message));
                return;
            }
            reject(error);
        });

        process.on('close', () => {
            if (stderr.includes('No module named pip')) {
                reject(new PipNotAvailableError(pythonCommand));
                return;
            }

            const stdoutLower = stdout.toLowerCase();
            const missingPackages = REQUIRED_PACKAGES.filter((pkg) => {
                return !stdoutLower.includes(`name: ${pkg.toLowerCase()}`);
            });

            resolve({ missingPackages });
        });
    });
}

async function promptAndInstallDependencies(
    pythonCommand: string,
    missingPackages: string[],
    statusBarItem: vscode.StatusBarItem,
): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
        `Audio Wandas Analyzer requires missing Python packages: ${missingPackages.join(', ')}. Install them now?`,
        'Install',
        'Dismiss',
    );

    if (answer !== 'Install') {
        return;
    }

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Installing Python packages...',
            },
            async () => installPackages(pythonCommand, missingPackages),
        );
        setStatusBarNormal(statusBarItem, pythonCommand);
        void vscode.window.showInformationMessage('Packages installed successfully.');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to install packages: ${message}`);
    }
}

async function installPackages(pythonCommand: string, packages: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const process = spawn(
            pythonCommand,
            ['-m', 'pip', 'install', ...packages],
            {
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
                reject(new Error(stderr.trim() || stdout.trim() || `pip install exited with code ${code}`));
                return;
            }
            resolve();
        });
    });
}
