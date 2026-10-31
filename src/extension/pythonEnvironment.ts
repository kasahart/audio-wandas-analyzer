import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { fillTemplate, getStrings, type UiStrings } from '../shared/i18n/strings';

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
        modules: ['soundfile'],
        distribution: 'soundfile',
        requirement: 'soundfile>=0.12',
        minimum: [0, 12, 0],
    },
    {
        modules: ['wandas', 'mosqito', 'librosa'],
        distribution: 'wandas',
        requirement: 'wandas[psychoacoustic,effects]>=0.12.0,<0.13.0',
        minimum: [0, 12, 0],
        maximum: [0, 13, 0],
    },
] as const;
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const CREATE_VENV_TIMEOUT_MS = 5 * 60 * 1000;
const PYTHON_EXTENSION_TIMEOUT_MS = 5000;
const WORKSPACE_VENV_NAMES = ['.venv', 'venv', 'env'];
const SELECT_ENVIRONMENT_COMMAND = 'audioWandasAnalyzer.selectPythonEnvironment';

function strings(): UiStrings {
    return getStrings(vscode.env.language);
}

let defaultInterpreter: string | undefined;
const defaultInterpreterEmitter = new vscode.EventEmitter<void>();
/** Fires when the interpreter used while `pythonCommand` is unset changes (Python extension selection). */
export const onDidChangeDefaultInterpreter = defaultInterpreterEmitter.event;

function hasExplicitPythonCommand(config: vscode.WorkspaceConfiguration): boolean {
    const inspected = config.inspect<string>('pythonCommand');
    return [inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue]
        .some(value => value !== undefined);
}

/**
 * The interpreter in use, before relative-path resolution: `audioWandasAnalyzer.pythonCommand` when the user set
 * it, otherwise the one found by `refreshDefaultInterpreter` (Python extension, then `VIRTUAL_ENV`), else python3.
 */
export function getPythonCommand(): string {
    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    if (hasExplicitPythonCommand(config)) {
        return config.get<string>('pythonCommand', 'python3');
    }
    return defaultInterpreter ?? virtualEnvInterpreter() ?? config.get<string>('pythonCommand', 'python3');
}

function virtualEnvInterpreter(): string | undefined {
    const virtualEnv = process.env['VIRTUAL_ENV'];
    if (!virtualEnv) { return undefined; }
    return fs.existsSync(resolvePythonCommand(virtualEnv)) ? virtualEnv : undefined;
}

interface PythonExtensionApi {
    environments?: {
        getActiveEnvironmentPath?(resource?: vscode.Uri): { path?: unknown } | undefined;
        onDidChangeActiveEnvironmentPath?: vscode.Event<unknown>;
    };
}

let pythonExtensionSubscribed = false;

// The Python extension is optional: no extensionDependencies entry, and any failure falls back to VIRTUAL_ENV.
async function pythonExtensionInterpreter(): Promise<string | undefined> {
    const extension = vscode.extensions.getExtension<PythonExtensionApi>('ms-python.python');
    if (!extension) { return undefined; }
    try {
        const api = extension.isActive
            ? extension.exports
            : await Promise.race([
                Promise.resolve(extension.activate()),
                new Promise<undefined>(resolve => { setTimeout(() => resolve(undefined), PYTHON_EXTENSION_TIMEOUT_MS); }),
            ]);
        const environments = api?.environments;
        if (!pythonExtensionSubscribed && environments?.onDidChangeActiveEnvironmentPath) {
            pythonExtensionSubscribed = true;
            environments.onDidChangeActiveEnvironmentPath(() => {
                void refreshDefaultInterpreter().then((changed) => {
                    if (changed) { defaultInterpreterEmitter.fire(); }
                });
            });
        }
        const active = environments?.getActiveEnvironmentPath?.(vscode.workspace.workspaceFolders?.[0]?.uri);
        return typeof active?.path === 'string' && active.path ? active.path : undefined;
    } catch {
        return undefined;
    }
}

/** Looks up the interpreter `getPythonCommand` falls back to; true when it changed. */
export async function refreshDefaultInterpreter(): Promise<boolean> {
    const previous = defaultInterpreter;
    defaultInterpreter = await pythonExtensionInterpreter() ?? virtualEnvInterpreter();
    return previous !== defaultInterpreter;
}

let setupLog: vscode.OutputChannel | undefined;

function pythonSetupLog(): vscode.OutputChannel {
    setupLog ??= vscode.window.createOutputChannel('Audio Wandas Analyzer (Python setup)');
    return setupLog;
}

export function disposePythonSetupLog(): void {
    setupLog?.dispose();
    setupLog = undefined;
}

const DEPENDENCY_CHECK_SCRIPT = `
import importlib.util
import importlib.metadata
import json
import os
import sys
import sysconfig

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
in_virtual_env = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
marker = os.path.join(sysconfig.get_path("stdlib"), "EXTERNALLY-MANAGED")
print(json.dumps({"missing": missing, "externallyManaged": not in_virtual_env and os.path.isfile(marker)}))
`;

export interface PythonEnvironmentState {
    pythonCommand: string;
    status: 'normal' | 'warning';
    tooltip: string;
}

const pythonEnvironmentStateEmitter = new vscode.EventEmitter<PythonEnvironmentState>();
let currentPythonEnvironmentState: PythonEnvironmentState | undefined;
let latestDependencyCheckRequestId = 0;

export const onDidChangePythonEnvironmentState = pythonEnvironmentStateEmitter.event;

export function getCurrentPythonEnvironmentState(): PythonEnvironmentState {
    return currentPythonEnvironmentState
        ? { ...currentPythonEnvironmentState }
        : { pythonCommand: getPythonCommand(), status: 'normal', tooltip: strings().pyTooltipSelect };
}

class PythonNotFoundError extends Error {
    constructor(pythonCommand: string) {
        super(fillTemplate(strings().pyInterpreterNotFound, { command: pythonCommand }));
        this.name = 'PythonNotFoundError';
    }
}

class PipNotAvailableError extends Error {
    constructor(pythonCommand: string) {
        super(fillTemplate(strings().pyPipUnavailable, { command: pythonCommand }));
        this.name = 'PipNotAvailableError';
    }
}

class ExternallyManagedError extends Error {
    constructor(pythonCommand: string) {
        super(fillTemplate(strings().pyExternallyManaged, { command: pythonCommand }));
        this.name = 'ExternallyManagedError';
    }
}

/** A setup step failed in a way the user can only act on, so `message` is already the localized notification text. */
class SetupError extends Error {
    constructor(message: string, readonly cancelled = false) {
        super(message);
        this.name = 'SetupError';
    }
}

interface PythonQuickPickItem extends vscode.QuickPickItem {
    pythonCommand?: string;
    action?: 'browse' | 'create-venv';
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

function canCreateWorkspaceVenv(): boolean {
    const root = getWorkspaceRoot();
    return root !== undefined && !fs.existsSync(path.join(root, '.venv'));
}

export function setStatusBarNormal(item: vscode.StatusBarItem, pythonCommand: string): void {
    const tooltip = strings().pyTooltipSelect;
    item.text = `Python: ${pythonCommand}`;
    item.tooltip = tooltip;
    item.backgroundColor = undefined;
    currentPythonEnvironmentState = { pythonCommand, status: 'normal', tooltip };
    pythonEnvironmentStateEmitter.fire(currentPythonEnvironmentState);
}

export function setStatusBarImporting(item: vscode.StatusBarItem, pythonCommand: string): void {
    item.text = `$(sync~spin) ${strings().pyStatusImporting}`;
    item.tooltip = `${strings().pyTooltipImporting}\n${pythonCommand}`;
    item.backgroundColor = undefined;
}

export function setStatusBarWarning(
    item: vscode.StatusBarItem,
    pythonCommand: string,
    tooltip: string = strings().pyTooltipMissingDeps,
): void {
    item.text = `Python: ${pythonCommand} $(warning)`;
    item.tooltip = tooltip;
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    item.show();
    currentPythonEnvironmentState = { pythonCommand, status: 'warning', tooltip };
    pythonEnvironmentStateEmitter.fire(currentPythonEnvironmentState);
}

function interpreterExists(pythonCommand: string, workspaceRoot: string | undefined): boolean {
    return fs.existsSync(resolvePythonCommand(pythonCommand, process.platform, workspaceRoot));
}

async function environmentChoices(): Promise<PythonQuickPickItem[]> {
    const text = strings();
    const root = getWorkspaceRoot();
    const current = getPythonCommand();
    const found: PythonQuickPickItem[] = [];
    const seen = new Set<string>();
    const add = (pythonCommand: string | undefined, description: string): void => {
        if (!pythonCommand) { return; }
        const resolved = resolvePythonCommand(pythonCommand, process.platform, root);
        if (seen.has(resolved)) { return; }
        seen.add(resolved);
        found.push({
            label: pythonCommand,
            description: pythonCommand === current ? `${text.pyPickCurrent} · ${description}` : description,
            pythonCommand,
        });
    };
    add(await pythonExtensionInterpreter(), text.pyPickFromPythonExtension);
    add(virtualEnvInterpreter(), text.pyPickFromVirtualEnv);
    for (const name of WORKSPACE_VENV_NAMES) {
        if (root && interpreterExists(name, root)) { add(name, text.pyPickWorkspaceVenv); }
    }
    return [
        ...found,
        { label: text.pyPickOther, kind: vscode.QuickPickItemKind.Separator },
        ...(canCreateWorkspaceVenv()
            ? [{ label: text.pyPickCreateVenv, detail: text.pyPickCreateVenvDetail, action: 'create-venv' as const }]
            : []),
        { label: text.pyPickBrowse, action: 'browse' },
    ];
}

const reselectedEmitter = new vscode.EventEmitter<string>();
/**
 * Fires when the user chose the interpreter `pythonCommand` already holds, so no configuration event follows
 * and the listener has to check the environment again itself.
 */
export const onDidReselectPythonCommand = reselectedEmitter.event;

/** Lets the user pick an interpreter, or create a workspace `.venv`, and stores it in `pythonCommand`. */
export async function selectPythonEnvironment(statusBarItem: vscode.StatusBarItem): Promise<void> {
    const text = strings();
    const selectedItem = await vscode.window.showQuickPick<PythonQuickPickItem>(await environmentChoices(), {
        placeHolder: text.pyPickPlaceholder,
    });

    if (!selectedItem) {
        return;
    }
    if (selectedItem.action === 'create-venv') {
        await createWorkspaceVenvAndInstall(getPythonCommand(), statusBarItem);
        return;
    }

    let chosen = selectedItem.pythonCommand;
    if (selectedItem.action === 'browse') {
        const selectedFolder = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: text.pyPickBrowseOpenLabel,
        });
        chosen = selectedFolder?.[0]?.fsPath;
    }

    if (!chosen) {
        return;
    }
    await storePythonCommand(chosen);
}

async function storePythonCommand(chosen: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
    if (hasExplicitPythonCommand(config) && chosen === config.get<string>('pythonCommand', 'python3')) {
        reselectedEmitter.fire(chosen);
        return;
    }
    const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update('pythonCommand', chosen, target);
}

type ProblemAction = 'select' | 'create-venv' | 'show-log';

/** Shows a problem with buttons for the ways out of it and runs the chosen one. */
async function showProblem(
    severity: 'warning' | 'error',
    message: string,
    actions: ProblemAction[],
    statusBarItem: vscode.StatusBarItem,
): Promise<void> {
    const text = strings();
    const labels: Record<ProblemAction, string> = {
        'select': text.pyBtnSelect,
        'create-venv': text.pyBtnCreateVenv,
        'show-log': text.pyBtnShowLog,
    };
    const offered = actions.filter(action => action !== 'create-venv' || canCreateWorkspaceVenv());
    const buttons = offered.map(action => labels[action]);
    const answer = severity === 'warning'
        ? await vscode.window.showWarningMessage(message, ...buttons)
        : await vscode.window.showErrorMessage(message, ...buttons);
    const chosen = offered.find(action => labels[action] === answer);
    if (chosen === 'select') {
        await vscode.commands.executeCommand(SELECT_ENVIRONMENT_COMMAND);
    } else if (chosen === 'create-venv') {
        await createWorkspaceVenvAndInstall(currentPythonEnvironmentState?.pythonCommand ?? getPythonCommand(), statusBarItem);
    } else if (chosen === 'show-log') {
        pythonSetupLog().show(true);
    }
}

export async function checkAndPromptInstallDependencies(
    pythonCommand: string,
    statusBarItem: vscode.StatusBarItem,
): Promise<boolean> {
    const requestId = ++latestDependencyCheckRequestId;
    const isLatestRequest = () => requestId === latestDependencyCheckRequestId;
    const text = strings();

    try {
        const { missingPackages, externallyManaged } = await checkMissingDependencies(pythonCommand);
        if (!isLatestRequest()) {
            return false;
        }

        if (missingPackages.length === 0) {
            setStatusBarNormal(statusBarItem, pythonCommand);
            return true;
        }

        setStatusBarWarning(statusBarItem, pythonCommand);
        return await promptAndInstallDependencies(pythonCommand, missingPackages, externallyManaged, statusBarItem, isLatestRequest);
    } catch (error) {
        if (!isLatestRequest()) {
            return false;
        }

        if (error instanceof PythonNotFoundError) {
            setStatusBarWarning(statusBarItem, pythonCommand, text.pyTooltipMissingInterpreter);
            void showProblem('warning', error.message, ['select', 'show-log'], statusBarItem);
            return false;
        }

        const message = error instanceof Error ? error.message : String(error);
        pythonSetupLog().appendLine(`[check] ${pythonCommand}: ${message}`);
        setStatusBarWarning(statusBarItem, pythonCommand, text.pyTooltipCheckFailed);
        void showProblem(
            'error',
            fillTemplate(text.pyCheckFailed, { command: pythonCommand }),
            ['show-log', 'select'],
            statusBarItem,
        );
        return false;
    }
}

export async function checkMissingDependencies(
    pythonCommand: string,
): Promise<{ missingPackages: string[]; externallyManaged: boolean }> {
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
                pythonSetupLog().appendLine(`[check] ${resolvedPythonCommand}: ${error.message}`);
                reject(new PythonNotFoundError(resolvedPythonCommand));
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
                const parsed = JSON.parse(stdout.trim()) as { missing?: unknown; externallyManaged?: unknown } | null;
                const missing = parsed?.missing;
                if (!Array.isArray(missing) || !missing.every((entry) => typeof entry === 'string')) {
                    reject(new Error('dependency check returned an invalid package list'));
                    return;
                }
                resolve({ missingPackages: missing, externallyManaged: parsed?.externallyManaged === true });
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
    externallyManaged: boolean,
    statusBarItem: vscode.StatusBarItem,
    isLatestRequest: () => boolean,
): Promise<boolean> {
    const text = strings();
    const choices = [
        ...(externallyManaged ? [] : [text.pyBtnInstall]),
        ...(canCreateWorkspaceVenv() ? [text.pyBtnCreateVenv] : []),
        text.pyBtnSelect,
    ];
    const message = externallyManaged
        ? fillTemplate(text.pyExternallyManaged, { command: pythonCommand })
        : fillTemplate(text.pyMissingPackages, { command: pythonCommand, packages: missingPackages.join(', ') });
    const answer = await vscode.window.showWarningMessage(message, ...choices);

    if (!isLatestRequest() || answer === undefined) {
        return false;
    }
    if (answer === text.pyBtnSelect) {
        await vscode.commands.executeCommand(SELECT_ENVIRONMENT_COMMAND);
        return false;
    }
    if (answer === text.pyBtnCreateVenv) {
        await createWorkspaceVenvAndInstall(pythonCommand, statusBarItem);
        return false;
    }

    try {
        await installPackages(pythonCommand, missingPackages);
        if (!isLatestRequest()) {
            return false;
        }
        setStatusBarNormal(statusBarItem, pythonCommand);
        void vscode.window.showInformationMessage(text.pyInstallSucceeded);
        return true;
    } catch (error) {
        if (isLatestRequest()) {
            reportSetupFailure(error, pythonCommand, statusBarItem);
        }
        return false;
    }
}

function reportSetupFailure(error: unknown, pythonCommand: string, statusBarItem: vscode.StatusBarItem): void {
    const text = strings();
    if (error instanceof SetupError && error.cancelled) {
        void vscode.window.showInformationMessage(error.message);
        return;
    }
    if (error instanceof PipNotAvailableError) {
        setStatusBarWarning(statusBarItem, pythonCommand, text.pyTooltipPipUnavailable);
        void showProblem('warning', error.message, ['create-venv', 'select', 'show-log'], statusBarItem);
        return;
    }
    if (error instanceof ExternallyManagedError) {
        void showProblem('warning', error.message, ['create-venv', 'select', 'show-log'], statusBarItem);
        return;
    }
    if (error instanceof PythonNotFoundError) {
        setStatusBarWarning(statusBarItem, pythonCommand, text.pyTooltipMissingInterpreter);
        void showProblem('warning', error.message, ['select', 'show-log'], statusBarItem);
        return;
    }
    const message = error instanceof SetupError ? error.message : text.pyInstallFailed;
    if (!(error instanceof SetupError)) {
        pythonSetupLog().appendLine(error instanceof Error ? error.message : String(error));
    }
    void showProblem('error', message, ['show-log', 'select'], statusBarItem);
}

interface LoggedRun {
    code: number | null;
    /** The run's stdout and stderr, kept to recognise known failures such as PEP 668. */
    output: string;
    cancelled: boolean;
    timedOut: boolean;
}

/** Runs a setup command with its output streamed to the setup log and the progress notification. */
function runLogged(
    command: string,
    args: string[],
    timeoutMs: number,
    progress: vscode.Progress<{ message?: string }>,
    token: vscode.CancellationToken,
): Promise<LoggedRun> {
    const log = pythonSetupLog();
    log.appendLine(`$ ${command} ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        let cancelled = false;
        let timedOut = false;
        const onData = (chunk: Buffer | string): void => {
            const textChunk = chunk.toString();
            output += textChunk;
            log.append(textChunk);
            const lastLine = textChunk.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).pop();
            if (lastLine) { progress.report({ message: lastLine.slice(0, 120) }); }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);
        const cancellation = token.onCancellationRequested(() => {
            cancelled = true;
            child.kill();
        });
        child.on('error', (error: NodeJS.ErrnoException) => {
            clearTimeout(timer);
            cancellation.dispose();
            log.appendLine(error.message);
            reject(error.code === 'ENOENT' || error.code === 'EACCES' ? new PythonNotFoundError(command) : error);
        });
        child.on('close', (code: number | null) => {
            clearTimeout(timer);
            cancellation.dispose();
            log.appendLine(`[exit ${code ?? 'killed'}]`);
            resolve({ code, output, cancelled, timedOut });
        });
    });
}

function interruptedError(run: LoggedRun, timeoutMs: number): SetupError | undefined {
    const text = strings();
    if (run.cancelled) { return new SetupError(text.pyInstallCancelled, true); }
    if (run.timedOut) { return new SetupError(fillTemplate(text.pyInstallTimedOut, { minutes: Math.round(timeoutMs / 60000) })); }
    return undefined;
}

async function installPackages(pythonCommand: string, packages: string[]): Promise<void> {
    const resolvedPythonCommand = resolveConfiguredPythonCommand(pythonCommand);
    pythonSetupLog().show(true);
    const run = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: fillTemplate(strings().pyInstallProgress, { command: pythonCommand }),
            cancellable: true,
        },
        (progress, token) => runLogged(resolvedPythonCommand, ['-m', 'pip', 'install', ...packages], INSTALL_TIMEOUT_MS, progress, token),
    );
    const interrupted = interruptedError(run, INSTALL_TIMEOUT_MS);
    if (interrupted) { throw interrupted; }
    if (run.output.includes('No module named pip')) { throw new PipNotAvailableError(pythonCommand); }
    if (run.output.includes('externally-managed-environment')) { throw new ExternallyManagedError(pythonCommand); }
    if (run.code !== 0) { throw new SetupError(strings().pyInstallFailed); }
}

/** Every requirement the backend needs; the same list the README's pip install line quotes. */
export function requiredPackageRequirements(): string[] {
    return [...new Set(REQUIRED_PACKAGES.map(item => item.requirement))];
}

/**
 * Creates `<workspace>/.venv` with `baseCommand`, installs every requirement into it and selects it, which
 * restarts the backend through the configuration listener.
 */
async function createWorkspaceVenvAndInstall(baseCommand: string, statusBarItem: vscode.StatusBarItem): Promise<void> {
    const text = strings();
    const root = getWorkspaceRoot();
    if (!root) { return; }
    const venvPath = path.join(root, '.venv');
    try {
        pythonSetupLog().show(true);
        const run = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: fillTemplate(text.pyCreateVenvProgress, { path: venvPath }),
                cancellable: true,
            },
            (progress, token) => runLogged(
                resolveConfiguredPythonCommand(baseCommand),
                ['-m', 'venv', venvPath],
                CREATE_VENV_TIMEOUT_MS,
                progress,
                token,
            ),
        );
        const interrupted = interruptedError(run, CREATE_VENV_TIMEOUT_MS);
        if (interrupted) { throw interrupted; }
        if (run.code !== 0) {
            throw new SetupError(fillTemplate(
                run.output.includes('ensurepip') ? text.pyVenvNoEnsurepip : text.pyVenvFailed,
                { path: venvPath },
            ));
        }
        await installPackages(venvPath, requiredPackageRequirements());
        void vscode.window.showInformationMessage(text.pyInstallSucceeded);
        await storePythonCommand('.venv');
    } catch (error) {
        reportSetupFailure(error, baseCommand, statusBarItem);
    }
}
