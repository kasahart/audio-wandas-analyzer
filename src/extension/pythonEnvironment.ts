import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

const REQUIRED_PACKAGES: readonly string[] = ['numpy', 'wandas'];
const BROWSE_LABEL = '$(folder) Browse...';
export const SELECT_PYTHON_INTERPRETER_TOOLTIP = 'Click to select Python environment';
export const MISSING_DEPENDENCIES_TOOLTIP = 'Python dependencies are missing. Click to select or install.';
export const MISSING_INTERPRETER_TOOLTIP = 'Python interpreter was not found. Click to select another environment.';
export const PIP_UNAVAILABLE_TOOLTIP = 'pip is not available in this environment. Click to select another environment.';
export const CHECK_FAILED_TOOLTIP = 'Python environment check failed. Click to select another environment.';

export interface PythonEnvironmentState {
    pythonCommand: string;
    status: 'normal' | 'warning';
    tooltip: string;
}

const pythonEnvironmentStateEmitter = new vscode.EventEmitter<PythonEnvironmentState>();
let currentPythonEnvironmentState: PythonEnvironmentState = {
    pythonCommand: 'python3',
    status: 'normal',
    tooltip: SELECT_PYTHON_INTERPRETER_TOOLTIP,
};
let latestDependencyCheckRequestId = 0;

export const onDidChangePythonEnvironmentState = pythonEnvironmentStateEmitter.event;

export function getCurrentPythonEnvironmentState(): PythonEnvironmentState {
    return { ...currentPythonEnvironmentState };
}

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

function isOnlyPackageNotFoundWarnings(stderr: string): boolean {
    const lines = stderr
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    return lines.length > 0
        && lines.every((line) => /^WARNING:\s+Package\(s\)\s+not\s+found:/u.test(line));
}

interface PythonQuickPickItem extends vscode.QuickPickItem {
    pythonCommand?: string;
}

function isPythonExecutablePath(value: string): boolean {
    return /(^|[/\\])python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/iu.test(value);
}

function isLikelyCommand(value: string): boolean {
    return /^(?:python(?:\d+(?:\.\d+)?)?|py(?:\.exe)?|python(?:\d+(?:\.\d+)?)?\.exe)$/iu.test(value);
}

export function resolvePythonCommand(
    pythonCommand: string,
    platform: NodeJS.Platform = process.platform,
): string {
    if (isPythonExecutablePath(pythonCommand) || isLikelyCommand(pythonCommand)) {
        return pythonCommand;
    }
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    return pathApi.join(pythonCommand, platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

export function setStatusBarNormal(item: vscode.StatusBarItem, pythonCommand: string): void {
    item.text = `Python: ${pythonCommand}`;
    item.tooltip = SELECT_PYTHON_INTERPRETER_TOOLTIP;
    item.backgroundColor = undefined;
    item.show();
    currentPythonEnvironmentState = {
        pythonCommand,
        status: 'normal',
        tooltip: SELECT_PYTHON_INTERPRETER_TOOLTIP,
    };
    pythonEnvironmentStateEmitter.fire(currentPythonEnvironmentState);
}

export function setStatusBarWarning(
    item: vscode.StatusBarItem,
    pythonCommand: string,
    tooltip: string = MISSING_DEPENDENCIES_TOOLTIP,
): void {
    item.text = `Python: ${pythonCommand} $(warning)`;
    item.tooltip = tooltip;
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    item.show();
    currentPythonEnvironmentState = {
        pythonCommand,
        status: 'warning',
        tooltip,
    };
    pythonEnvironmentStateEmitter.fire(currentPythonEnvironmentState);
}

export async function selectPythonEnvironment(statusBarItem: vscode.StatusBarItem): Promise<void> {
    const selectedItem = await vscode.window.showQuickPick<PythonQuickPickItem>([
        { label: '.venv', pythonCommand: '.venv' },
        { label: 'venv', pythonCommand: 'venv' },
        { label: 'Custom', kind: vscode.QuickPickItemKind.Separator },
        { label: BROWSE_LABEL },
    ], {
        placeHolder: 'Select Python environment folder',
    });

    if (!selectedItem) {
        return;
    }

    let chosen = selectedItem.pythonCommand;
    if (selectedItem.label === BROWSE_LABEL) {
        const selectedFolder = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: 'Select Python environment',
        });
        chosen = selectedFolder?.[0]?.fsPath;
    }

    if (!chosen) {
        return;
    }

    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    const currentPythonCommand = config.get<string>('pythonCommand', 'python3');
    if (chosen === currentPythonCommand) {
        await checkAndPromptInstallDependencies(chosen, statusBarItem);
        return;
    }
    const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update('pythonCommand', chosen, target);
}

export async function checkAndPromptInstallDependencies(
    pythonCommand: string,
    statusBarItem: vscode.StatusBarItem,
): Promise<void> {
    const requestId = ++latestDependencyCheckRequestId;
    const isLatestRequest = () => requestId === latestDependencyCheckRequestId;

    try {
        const { missingPackages } = await checkMissingDependencies(pythonCommand);
        if (!isLatestRequest()) {
            return;
        }

        if (missingPackages.length === 0) {
            setStatusBarNormal(statusBarItem, pythonCommand);
            return;
        }

        setStatusBarWarning(statusBarItem, pythonCommand);
        await promptAndInstallDependencies(pythonCommand, missingPackages, statusBarItem, isLatestRequest);
    } catch (error) {
        if (!isLatestRequest()) {
            return;
        }

        if (error instanceof PythonNotFoundError) {
            setStatusBarWarning(statusBarItem, pythonCommand, MISSING_INTERPRETER_TOOLTIP);
            void vscode.window.showWarningMessage(error.message);
            return;
        }

        if (error instanceof PipNotAvailableError) {
            setStatusBarWarning(statusBarItem, pythonCommand, PIP_UNAVAILABLE_TOOLTIP);
            void vscode.window.showWarningMessage(error.message);
            return;
        }

        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to check Python dependencies for ${pythonCommand}: ${message}`);
        setStatusBarWarning(statusBarItem, pythonCommand, CHECK_FAILED_TOOLTIP);
        void vscode.window.showErrorMessage(`Failed to check Python dependencies: ${message}`);
    }
}

export async function checkMissingDependencies(
    pythonCommand: string,
): Promise<{ missingPackages: string[] }> {
    const resolvedPythonCommand = resolvePythonCommand(pythonCommand);
    return new Promise((resolve, reject) => {
        const process = spawn(
            resolvedPythonCommand,
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
                reject(new PythonNotFoundError(resolvedPythonCommand, error.message));
                return;
            }
            reject(error);
        });

        process.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
            if (stderr.includes('No module named pip')) {
                reject(new PipNotAvailableError(pythonCommand));
                return;
            }

            const stderrTrimmed = stderr.trim();
            if (signal) {
                reject(new Error(`pip show was terminated by signal ${signal}`));
                return;
            }

            if (code !== 0 && !(code === 1 && (stderrTrimmed.length === 0 || isOnlyPackageNotFoundWarnings(stderrTrimmed)))) {
                reject(new Error(stderrTrimmed || stdout.trim() || `pip show exited with code ${code}`));
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
    isLatestRequest: () => boolean,
): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
        `Audio Wandas Analyzer requires missing Python packages: ${missingPackages.join(', ')}. Install them now?`,
        'Install',
        'Dismiss',
    );

    if (!isLatestRequest()) {
        return;
    }

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
        if (!isLatestRequest()) {
            return;
        }

        setStatusBarNormal(statusBarItem, pythonCommand);
        void vscode.window.showInformationMessage('Packages installed successfully.');
    } catch (error) {
        if (!isLatestRequest()) {
            return;
        }

        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to install packages: ${message}`);
    }
}

async function installPackages(pythonCommand: string, packages: string[]): Promise<void> {
    const resolvedPythonCommand = resolvePythonCommand(pythonCommand);
    return new Promise((resolve, reject) => {
        const process = spawn(
            resolvedPythonCommand,
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
            reject(new Error(`Failed to start Python process (${resolvedPythonCommand}): ${error.message}`));
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
