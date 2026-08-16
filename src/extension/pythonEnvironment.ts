import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const REQUIRED_PACKAGES = [
    {
        modules: ['numpy'],
        distribution: 'numpy',
        requirement: 'numpy>=2.0.2',
        minimum: [2, 0, 2],
    },
    {
        modules: ['scipy'],
        distribution: 'scipy',
        requirement: 'scipy>=1.13',
        minimum: [1, 13, 0],
    },
    {
        modules: ['wandas', 'mosqito'],
        distribution: 'wandas',
        requirement: 'wandas[psychoacoustic]>=0.7.2,<0.8.0',
        minimum: [0, 7, 2],
        maximum: [0, 8, 0],
    },
] as const;
const DEPENDENCY_CHECK_SCRIPT = `
import importlib.util
import importlib.metadata
import json
import os
import sys

try:
    from packaging.version import InvalidVersion, Version
except ImportError:
    InvalidVersion = None
    Version = None

required = ${JSON.stringify(REQUIRED_PACKAGES)}
cwd = os.getcwd()
sys.path = [entry for entry in sys.path if entry not in ("", cwd)]

def version_key(value):
    parts = []
    for component in value.split("+", 1)[0].split("."):
        digits = ""
        for character in component:
            if not character.isdigit():
                break
            digits += character
        if not digits:
            break
        parts.append(int(digits))
    return tuple((parts + [0, 0, 0])[:3])

def is_prerelease(value):
    public = value.split("+", 1)[0].lower()
    return any(marker in public for marker in ("a", "b", "rc", "dev"))

def needs_install(item):
    if any(importlib.util.find_spec(module) is None for module in item["modules"]):
        return True
    try:
        installed = importlib.metadata.version(item["distribution"])
    except importlib.metadata.PackageNotFoundError:
        return True
    if Version is not None:
        try:
            current = Version(installed)
            minimum = Version(".".join(str(part) for part in item["minimum"]))
            maximum = Version(".".join(str(part) for part in item["maximum"])) if "maximum" in item else None
        except InvalidVersion:
            return True
        return current.is_prerelease or current < minimum or (maximum is not None and current >= maximum)
    if is_prerelease(installed):
        return True
    current = version_key(installed)
    minimum = tuple(item["minimum"])
    maximum = tuple(item["maximum"]) if "maximum" in item else None
    return current < minimum or (maximum is not None and current >= maximum)

missing = list(dict.fromkeys(item["requirement"] for item in required if needs_install(item)))
print(json.dumps(missing))
`;
const BROWSE_LABEL = '$(folder) Browse...';
export const SELECT_PYTHON_INTERPRETER_TOOLTIP = 'Click to select Python environment';
export const MISSING_DEPENDENCIES_TOOLTIP = 'Python dependencies are missing or incompatible. Click to select or install.';
export const MISSING_INTERPRETER_TOOLTIP = 'Python interpreter was not found. Click to select another environment.';
export const PIP_UNAVAILABLE_TOOLTIP = 'pip is not available in this environment. Click to select another environment.';
export const CHECK_FAILED_TOOLTIP = 'Python environment check failed. Click to select another environment.';
export const IMPORTING_MODULES_TOOLTIP = 'Importing Python analysis modules in the background.';

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
    workspaceRoot?: string,
): string {
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    if (isLikelyCommand(pythonCommand)) {
        return pythonCommand;
    }
    if (isPythonExecutablePath(pythonCommand)) {
        if (workspaceRoot && !pathApi.isAbsolute(pythonCommand)) {
            return pathApi.join(workspaceRoot, pythonCommand);
        }
        return pythonCommand;
    }
    const relativeInterpreterPath = pathApi.join(pythonCommand, platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (workspaceRoot && !pathApi.isAbsolute(relativeInterpreterPath)) {
        return pathApi.join(workspaceRoot, relativeInterpreterPath);
    }
    return relativeInterpreterPath;
}

export function resolveConfiguredPythonCommand(pythonCommand: string): string {
    return resolvePythonCommand(pythonCommand, process.platform, getWorkspaceRoot());
}

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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

export function setStatusBarImporting(item: vscode.StatusBarItem, pythonCommand: string): void {
    item.text = `$(sync~spin) Python: importing modules`;
    item.tooltip = `${IMPORTING_MODULES_TOOLTIP}\n${pythonCommand}`;
    item.backgroundColor = undefined;
    item.show();
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
): Promise<boolean> {
    const requestId = ++latestDependencyCheckRequestId;
    const isLatestRequest = () => requestId === latestDependencyCheckRequestId;

    try {
        const { missingPackages } = await checkMissingDependencies(pythonCommand);
        if (!isLatestRequest()) {
            return false;
        }

        if (missingPackages.length === 0) {
            setStatusBarNormal(statusBarItem, pythonCommand);
            return true;
        }

        setStatusBarWarning(statusBarItem, pythonCommand);
        return await promptAndInstallDependencies(pythonCommand, missingPackages, statusBarItem, isLatestRequest);
    } catch (error) {
        if (!isLatestRequest()) {
            return false;
        }

        if (error instanceof PythonNotFoundError) {
            setStatusBarWarning(statusBarItem, pythonCommand, MISSING_INTERPRETER_TOOLTIP);
            void vscode.window.showWarningMessage(error.message);
            return false;
        }

        if (error instanceof PipNotAvailableError) {
            setStatusBarWarning(statusBarItem, pythonCommand, PIP_UNAVAILABLE_TOOLTIP);
            void vscode.window.showWarningMessage(error.message);
            return false;
        }

        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to check Python dependencies for ${pythonCommand}: ${message}`);
        setStatusBarWarning(statusBarItem, pythonCommand, CHECK_FAILED_TOOLTIP);
        void vscode.window.showErrorMessage(`Failed to check Python dependencies: ${message}`);
        return false;
    }
}

export async function checkMissingDependencies(
    pythonCommand: string,
): Promise<{ missingPackages: string[] }> {
    const resolvedPythonCommand = resolveConfiguredPythonCommand(pythonCommand);
    return new Promise((resolve, reject) => {
        const process = spawn(
            resolvedPythonCommand,
            ['-c', DEPENDENCY_CHECK_SCRIPT],
            {
                cwd: os.tmpdir(),
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
            const stderrTrimmed = stderr.trim();
            if (signal) {
                reject(new Error(`dependency check was terminated by signal ${signal}`));
                return;
            }

            if (code !== 0) {
                reject(new Error(stderrTrimmed || stdout.trim() || `dependency check exited with code ${code}`));
                return;
            }

            try {
                const parsed = JSON.parse(stdout.trim()) as unknown;
                if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
                    reject(new Error('dependency check returned an invalid package list'));
                    return;
                }
                resolve({ missingPackages: parsed });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                reject(new Error(`Failed to parse dependency check output: ${message}`));
            }
        });
    });
}

async function promptAndInstallDependencies(
    pythonCommand: string,
    missingPackages: string[],
    statusBarItem: vscode.StatusBarItem,
    isLatestRequest: () => boolean,
): Promise<boolean> {
    const answer = await vscode.window.showWarningMessage(
        `Audio Wandas Analyzer requires compatible Python packages: ${missingPackages.join(', ')}. Install or upgrade them now?`,
        'Install',
        'Dismiss',
    );

    if (!isLatestRequest()) {
        return false;
    }

    if (answer !== 'Install') {
        return false;
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
            return false;
        }

        setStatusBarNormal(statusBarItem, pythonCommand);
        void vscode.window.showInformationMessage('Packages installed successfully.');
        return true;
    } catch (error) {
        if (!isLatestRequest()) {
            return false;
        }

        if (error instanceof PipNotAvailableError) {
            setStatusBarWarning(statusBarItem, pythonCommand, PIP_UNAVAILABLE_TOOLTIP);
            void vscode.window.showWarningMessage(error.message);
            return false;
        }

        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to install packages: ${message}`);
        return false;
    }
}

async function installPackages(pythonCommand: string, packages: string[]): Promise<void> {
    const resolvedPythonCommand = resolveConfiguredPythonCommand(pythonCommand);
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
            if (stderr.includes('No module named pip')) {
                reject(new PipNotAvailableError(pythonCommand));
                return;
            }

            if (code !== 0) {
                reject(new Error(stderr.trim() || stdout.trim() || `pip install exited with code ${code}`));
                return;
            }
            resolve();
        });
    });
}
