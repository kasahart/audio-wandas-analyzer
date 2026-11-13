import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { fillTemplate, getStrings, type UiStrings } from '../shared/i18n/strings';
import {
    DEFAULT_PYTHON_COMMAND,
    extensionPythonCandidates,
    firstRunningPython,
    invocationText,
    isLikelyCommand,
    pythonInvocation,
    resolvePythonCommand,
    virtualEnvPythonCommand,
    workspaceVenvCommands,
    type PythonInvocation,
    type PythonProbeFailure,
} from './pythonInterpreter';

export { resolvePythonCommand };

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
        requirement: 'wandas[psychoacoustic,effects]>=0.13.0,<0.14.0',
        minimum: [0, 13, 0],
        maximum: [0, 14, 0],
    },
] as const;
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const CREATE_VENV_TIMEOUT_MS = 5 * 60 * 1000;
const PYTHON_EXTENSION_TIMEOUT_MS = 5000;
const SELECT_ENVIRONMENT_COMMAND = 'audioWandasAnalyzer.selectPythonEnvironment';

function strings(): UiStrings {
    return getStrings(vscode.env.language);
}

function hasExplicitPythonCommand(config: vscode.WorkspaceConfiguration): boolean {
    const inspected = config.inspect<string>('pythonCommand');
    // Restricted Mode ignores workspace values of this restricted setting, so only the user value is in effect.
    const values = vscode.workspace.isTrusted
        ? [inspected?.globalValue, inspected?.workspaceValue, inspected?.workspaceFolderValue]
        : [inspected?.globalValue];
    return values.some(value => value !== undefined);
}

function isInsideWorkspace(candidate: string): boolean {
    return (vscode.workspace.workspaceFolders ?? []).some((folder) => {
        const relative = path.relative(folder.uri.fsPath, candidate);
        return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    });
}

/** Drops an auto-detected interpreter that an untrusted workspace supplies. */
function trustedCandidate(pythonCommand: string | undefined): string | undefined {
    return pythonCommand && !vscode.workspace.isTrusted && isInsideWorkspace(pythonCommand) ? undefined : pythonCommand;
}

function virtualEnvInterpreter(): string | undefined {
    return trustedCandidate(virtualEnvPythonCommand());
}

interface PythonExtensionApi {
    environments?: {
        getActiveEnvironmentPath?(resource?: vscode.Uri): { path?: unknown } | undefined;
        onDidChangeActiveEnvironmentPath?: vscode.Event<unknown>;
    };
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

/**
 * No candidate interpreter ran (each was started with the dependency check, which failed). The message names every
 * candidate with why it failed and the setting that chooses the interpreter: the one notification for this case.
 */
class NoPythonRunsError extends Error {
    constructor(failures: readonly { label: string; error: unknown }[]) {
        const text = strings();
        super(fillTemplate(text.pyNoInterpreterRuns, {
            tried: failures.map(({ label, error }) => `${label} (${probeFailureReason(error)})`).join('; '),
        }));
        this.name = 'NoPythonRunsError';
    }
}

/** Why a candidate did not run, in a few words: not found, or the first line of what its check printed. */
function probeFailureReason(error: unknown): string {
    const text = strings();
    if (error instanceof PythonNotFoundError) { return text.pyCandidateNotFound; }
    const firstLine = (error instanceof Error ? error.message : String(error)).trim().split(/\r?\n/u)[0] ?? '';
    return fillTemplate(text.pyCandidateFailed, { detail: firstLine.length > 160 ? `${firstLine.slice(0, 160)}…` : firstLine });
}

class PythonNotFoundError extends Error {
    constructor(pythonCommand: string) {
        super(fillTemplate(strings().pyInterpreterNotFound, { command: pythonCommand }));
        this.name = 'PythonNotFoundError';
    }
}

class UntrustedWorkspacePathError extends Error {
    constructor(pythonCommand: string) {
        super(fillTemplate(strings().pyUntrustedWorkspacePath, { command: pythonCommand }));
        this.name = 'UntrustedWorkspacePathError';
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

/** A candidate given as a string (a setting value: path, folder or command) or as a command with arguments. */
function asInvocation(candidate: string | PythonInvocation): PythonInvocation {
    return typeof candidate === 'string' ? pythonInvocation(candidate) : candidate;
}

/** A candidate as it is started: its command resolved (resolveConfiguredPythonCommand), its arguments kept. */
export function resolveConfiguredInvocation(candidate: string | PythonInvocation): PythonInvocation {
    const { command, args } = asInvocation(candidate);
    return { command: resolveConfiguredPythonCommand(command), args };
}

/**
 * Resolves `pythonCommand` against the workspace folder. While the workspace is untrusted a relative path is
 * refused, because it would start a program the folder supplies.
 */
export function resolveConfiguredPythonCommand(pythonCommand: string): string {
    const root = getWorkspaceRoot();
    const pathApi = process.platform === 'win32' ? path.win32 : path.posix;
    if (root && !vscode.workspace.isTrusted && !isLikelyCommand(pythonCommand) && !pathApi.isAbsolute(pythonCommand)) {
        throw new UntrustedWorkspacePathError(pythonCommand);
    }
    return resolvePythonCommand(pythonCommand, process.platform, root);
}

function getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function canCreateWorkspaceVenv(): boolean {
    const root = getWorkspaceRoot();
    return root !== undefined && vscode.workspace.isTrusted && !fs.existsSync(path.join(root, '.venv'));
}

export function setStatusBarImporting(item: vscode.StatusBarItem, pythonCommand: string): void {
    item.text = `$(sync~spin) ${strings().pyStatusImporting}`;
    item.tooltip = `${strings().pyTooltipImporting}\n${pythonCommand}`;
    item.backgroundColor = undefined;
}

type ProblemAction = 'select' | 'create-venv' | 'show-log' | 'open-browser';

/** The browser version, which needs no Python; offered when no interpreter is found. */
export const BROWSER_VERSION_URL = 'https://kasahart.github.io/audio-wandas-analyzer/';

interface LoggedRun {
    code: number | null;
    /** The run's stdout and stderr, kept to recognise known failures such as PEP 668. */
    output: string;
    cancelled: boolean;
    timedOut: boolean;
}

/** Runs a setup command with its output streamed to the setup log and the progress notification. */
function runLogged(
    log: vscode.OutputChannel,
    python: PythonInvocation,
    args: string[],
    timeoutMs: number,
    progress: vscode.Progress<{ message?: string }>,
    token: vscode.CancellationToken,
): Promise<LoggedRun> {
    const command = python.command;
    log.appendLine(`$ ${invocationText(python)} ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
        const child = spawn(command, [...python.args, ...args], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
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
            reject(error.code === 'ENOENT' || error.code === 'EACCES' ? new PythonNotFoundError(invocationText(python)) : error);
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

/** Every requirement the backend needs; the same list the README's pip install line quotes. */
export function requiredPackageRequirements(): string[] {
    return [...new Set(REQUIRED_PACKAGES.map(item => item.requirement))];
}


/**
 * The interpreter selection, the status it reports and the setup log. `activate()` makes the one instance and hands
 * it to the parts that read or change the environment.
 */
export class PythonEnvironment implements vscode.Disposable {
    private defaultInterpreter: string | undefined;
    private readonly defaultInterpreterEmitter = new vscode.EventEmitter<void>();
    /** Fires when the interpreter used while `pythonCommand` is unset changes (Python extension selection). */
    readonly onDidChangeDefaultInterpreter = this.defaultInterpreterEmitter.event;
    private pythonExtensionSubscribed = false;
    private setupLog: vscode.OutputChannel | undefined;
    private readonly pythonEnvironmentStateEmitter = new vscode.EventEmitter<PythonEnvironmentState>();
    private currentPythonEnvironmentState: PythonEnvironmentState | undefined;
    private latestDependencyCheckRequestId = 0;
    /** The candidate the last check found running, for the selection it was found for (getPythonCommand). */
    private found: { selection: string; candidate: PythonInvocation } | undefined;
    readonly onDidChangePythonEnvironmentState = this.pythonEnvironmentStateEmitter.event;
    private readonly reselectedEmitter = new vscode.EventEmitter<string>();
    /**
     * Fires when the user chose the interpreter `pythonCommand` already holds, so no configuration event follows
     * and the listener has to check the environment again itself.
     */
    readonly onDidReselectPythonCommand = this.reselectedEmitter.event;

    /** `platform` decides the fallback commands (pythonInterpreter.ts fallbackPythonCommands); tests inject it. */
    constructor(private readonly platform: NodeJS.Platform = process.platform) {}

    /**
     * The interpreters to try, in order, before relative-path resolution (pythonInterpreter.ts
     * extensionPythonCandidates): `audioWandasAnalyzer.pythonCommand` when the user set it, otherwise the one found by
     * `refreshDefaultInterpreter` (Python extension, then `VIRTUAL_ENV`), else the fallback commands of this OS.
     */
    getPythonCandidates(): PythonInvocation[] {
        const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
        return extensionPythonCandidates({
            configured: hasExplicitPythonCommand(config) ? config.get<string>('pythonCommand', DEFAULT_PYTHON_COMMAND) : undefined,
            active: this.defaultInterpreter,
            virtualEnv: virtualEnvInterpreter(),
        }, this.platform);
    }

    /**
     * The selection, as text: the first candidate (getPythonCandidates). It changes exactly when the candidates do,
     * so the extension compares it to know that the interpreter must be checked again.
     */
    getPythonCommand(): string {
        return invocationText(this.getPythonCandidates()[0]);
    }

    /**
     * The interpreter in use, unresolved: the candidate the last check found running for the current selection, else
     * the first candidate (not checked yet).
     */
    interpreterInUse(): PythonInvocation {
        const found = this.found;
        return found && found.selection === this.getPythonCommand() ? found.candidate : this.getPythonCandidates()[0];
    }

    /** interpreterInUse as shown in the status bar and messages: `py -3`, `.venv`. */
    interpreterLabel(): string {
        return invocationText(this.interpreterInUse());
    }

    /** interpreterInUse as the backend starts it (resolveConfiguredInvocation); throws for a refused workspace path. */
    backendInvocation(): PythonInvocation {
        return resolveConfiguredInvocation(this.interpreterInUse());
    }

    // The Python extension is optional: no extensionDependencies entry, and any failure falls back to VIRTUAL_ENV.
    private async pythonExtensionInterpreter(): Promise<string | undefined> {
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
            if (!this.pythonExtensionSubscribed && environments?.onDidChangeActiveEnvironmentPath) {
                this.pythonExtensionSubscribed = true;
                environments.onDidChangeActiveEnvironmentPath(() => {
                    void this.refreshDefaultInterpreter().then((changed) => {
                        if (changed) { this.defaultInterpreterEmitter.fire(); }
                    });
                });
            }
            const active = environments?.getActiveEnvironmentPath?.(vscode.workspace.workspaceFolders?.[0]?.uri);
            return typeof active?.path === 'string' && active.path ? trustedCandidate(active.path) : undefined;
        } catch {
            return undefined;
        }
    }

    /** Looks up the interpreter `getPythonCommand` falls back to; true when it changed. */
    async refreshDefaultInterpreter(): Promise<boolean> {
        const previous = this.defaultInterpreter;
        this.defaultInterpreter = await this.pythonExtensionInterpreter() ?? virtualEnvInterpreter();
        return previous !== this.defaultInterpreter;
    }

    private pythonSetupLog(): vscode.OutputChannel {
        this.setupLog ??= vscode.window.createOutputChannel('Audio Wandas Analyzer (Python setup)');
        return this.setupLog;
    }

    dispose(): void {
        this.setupLog?.dispose();
        this.setupLog = undefined;
    }

    getCurrentPythonEnvironmentState(): PythonEnvironmentState {
        return this.currentPythonEnvironmentState
            ? { ...this.currentPythonEnvironmentState }
            : { pythonCommand: this.interpreterLabel(), status: 'normal', tooltip: strings().pyTooltipSelect };
    }

    setStatusBarNormal(item: vscode.StatusBarItem, pythonCommand: string): void {
        const tooltip = strings().pyTooltipSelect;
        item.text = `Python: ${pythonCommand}`;
        item.tooltip = tooltip;
        item.backgroundColor = undefined;
        this.currentPythonEnvironmentState = { pythonCommand, status: 'normal', tooltip };
        this.pythonEnvironmentStateEmitter.fire(this.currentPythonEnvironmentState);
    }

    setStatusBarWarning(
        item: vscode.StatusBarItem,
        pythonCommand: string,
        tooltip: string = strings().pyTooltipMissingDeps,
    ): void {
        item.text = `Python: ${pythonCommand} $(warning)`;
        item.tooltip = tooltip;
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        item.show();
        this.currentPythonEnvironmentState = { pythonCommand, status: 'warning', tooltip };
        this.pythonEnvironmentStateEmitter.fire(this.currentPythonEnvironmentState);
    }

    private async environmentChoices(): Promise<PythonQuickPickItem[]> {
        const text = strings();
        const root = getWorkspaceRoot();
        const current = this.interpreterLabel();
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
        add(await this.pythonExtensionInterpreter(), text.pyPickFromPythonExtension);
        add(virtualEnvInterpreter(), text.pyPickFromVirtualEnv);
        for (const name of vscode.workspace.isTrusted && root ? workspaceVenvCommands(root) : []) {
            add(name, text.pyPickWorkspaceVenv);
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

    /** Lets the user pick an interpreter, or create a workspace `.venv`, and stores it in `pythonCommand`. */
    async selectPythonEnvironment(statusBarItem: vscode.StatusBarItem): Promise<void> {
        const text = strings();
        const selectedItem = await vscode.window.showQuickPick<PythonQuickPickItem>(await this.environmentChoices(), {
            placeHolder: text.pyPickPlaceholder,
        });

        if (!selectedItem) {
            return;
        }
        if (selectedItem.action === 'create-venv') {
            await this.createWorkspaceVenvAndInstall(this.interpreterInUse(), statusBarItem);
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
        await this.storePythonCommand(chosen);
    }

    private async storePythonCommand(chosen: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('audioWandasAnalyzer');
        if (hasExplicitPythonCommand(config) && chosen === config.get<string>('pythonCommand', DEFAULT_PYTHON_COMMAND)) {
            this.reselectedEmitter.fire(chosen);
            return;
        }
        if (!vscode.workspace.workspaceFolders?.length) {
            await config.update('pythonCommand', chosen, vscode.ConfigurationTarget.Global);
            return;
        }
        if (vscode.workspace.isTrusted) {
            await config.update('pythonCommand', chosen, vscode.ConfigurationTarget.Workspace);
            return;
        }
        // Restricted Mode would ignore a workspace value of this restricted setting.
        await config.update('pythonCommand', chosen, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage(fillTemplate(strings().pySavedToUserSettings, { command: chosen }));
    }

    /** Shows a problem with buttons for the ways out of it and runs the chosen one. */
    private async showProblem(
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
            'open-browser': text.pyBtnOpenBrowser,
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
            await this.createWorkspaceVenvAndInstall(this.interpreterInUse(), statusBarItem);
        } else if (chosen === 'show-log') {
            this.pythonSetupLog().show(true);
        } else if (chosen === 'open-browser') {
            await vscode.env.openExternal(vscode.Uri.parse(BROWSER_VERSION_URL));
        }
    }

    /**
     * Finds the interpreter to use and makes sure it has the packages: each of `candidates` (getPythonCandidates, or
     * one interpreter) is started with the dependency check in order, and the first that runs is used, so a working
     * configured interpreter or venv is checked once and no other is started. Missing packages are then offered for
     * install into it. When none runs, one notification names every candidate with why it failed and the setting
     * that chooses the interpreter. True when the interpreter in use has every package.
     */
    async checkAndPromptInstallDependencies(
        candidates: string | readonly PythonInvocation[],
        statusBarItem: vscode.StatusBarItem,
    ): Promise<boolean> {
        const requestId = ++this.latestDependencyCheckRequestId;
        const isLatestRequest = () => requestId === this.latestDependencyCheckRequestId;
        const text = strings();
        const tried = typeof candidates === 'string' ? [pythonInvocation(candidates)] : [...candidates];
        const selection = invocationText(tried[0]);

        try {
            const { found, failures } = await firstRunningPython(
                tried,
                candidate => this.checkMissingDependencies(candidate),
                error => error instanceof UntrustedWorkspacePathError,
            );
            if (!isLatestRequest()) {
                return false;
            }
            this.logProbeFailures(failures);
            if (!found) {
                this.found = undefined;
                throw new NoPythonRunsError(failures.map(failure => ({ label: this.startedAs(failure.candidate), error: failure.error })));
            }
            const { candidate, result: { missingPackages, externallyManaged } } = found;
            this.found = { selection, candidate };
            const pythonCommand = invocationText(candidate);

            if (missingPackages.length === 0) {
                this.setStatusBarNormal(statusBarItem, pythonCommand);
                return true;
            }

            this.setStatusBarWarning(statusBarItem, pythonCommand);
            return await this.promptAndInstallDependencies(
                candidate, missingPackages, externallyManaged, statusBarItem, isLatestRequest,
            );
        } catch (error) {
            if (!isLatestRequest()) {
                return false;
            }

            if (error instanceof NoPythonRunsError) {
                this.setStatusBarWarning(statusBarItem, selection, text.pyTooltipNoInterpreterRuns);
                void this.showProblem('warning', error.message, ['select', 'open-browser', 'show-log'], statusBarItem);
                return false;
            }
            if (error instanceof UntrustedWorkspacePathError) {
                this.setStatusBarWarning(statusBarItem, selection, text.pyTooltipUntrustedWorkspacePath);
                void this.showProblem('warning', error.message, ['select'], statusBarItem);
                return false;
            }

            // Not a candidate's failure (each of those is collected above): a fault of this flow itself.
            const message = error instanceof Error ? error.message : String(error);
            this.pythonSetupLog().appendLine(`[check] ${selection}: ${message}`);
            this.setStatusBarWarning(statusBarItem, selection, text.pyTooltipCheckFailed);
            void this.showProblem(
                'error',
                fillTemplate(text.pyCheckFailed, { command: selection }),
                ['show-log', 'select'],
                statusBarItem,
            );
            return false;
        }
    }

    /** A candidate as the message names it: the program it started (a folder's interpreter, a command as given). */
    private startedAs(candidate: PythonInvocation): string {
        try {
            return invocationText(resolveConfiguredInvocation(candidate));
        } catch {
            return invocationText(candidate);
        }
    }

    /** Each candidate that did not run, with what it printed (one not found was logged when its start failed). */
    private logProbeFailures(failures: readonly PythonProbeFailure[]): void {
        for (const { candidate, error } of failures) {
            if (error instanceof PythonNotFoundError) { continue; }
            this.pythonSetupLog().appendLine(`[check] ${this.startedAs(candidate)}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Starts `candidate` with the dependency check: its missing requirements, or a rejection when it does not run
     * (PythonNotFoundError when there is no such program, an Error with what it printed otherwise). This is the
     * probe checkAndPromptInstallDependencies tries each candidate with.
     */
    checkMissingDependencies(
        candidate: string | PythonInvocation,
    ): Promise<{ missingPackages: string[]; externallyManaged: boolean }> {
        // Resolved outside the promise: a refused workspace path (UntrustedWorkspacePathError) is thrown, not probed.
        const resolved = resolveConfiguredInvocation(candidate);
        const resolvedPythonCommand = invocationText(resolved);
        return new Promise((resolve, reject) => {
            const process = spawn(
                resolved.command,
                [...resolved.args, '-c', DEPENDENCY_CHECK_SCRIPT],
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
                    this.pythonSetupLog().appendLine(`[check] ${resolvedPythonCommand}: ${error.message}`);
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

    private async promptAndInstallDependencies(
        python: PythonInvocation,
        missingPackages: string[],
        externallyManaged: boolean,
        statusBarItem: vscode.StatusBarItem,
        isLatestRequest: () => boolean,
    ): Promise<boolean> {
        const text = strings();
        const pythonCommand = invocationText(python);
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
            await this.createWorkspaceVenvAndInstall(python, statusBarItem);
            return false;
        }

        try {
            await this.installPackages(python, missingPackages);
            if (!isLatestRequest()) {
                return false;
            }
            this.setStatusBarNormal(statusBarItem, pythonCommand);
            void vscode.window.showInformationMessage(text.pyInstallSucceeded);
            return true;
        } catch (error) {
            if (isLatestRequest()) {
                this.reportSetupFailure(error, pythonCommand, statusBarItem);
            }
            return false;
        }
    }

    private reportSetupFailure(error: unknown, pythonCommand: string, statusBarItem: vscode.StatusBarItem): void {
        const text = strings();
        if (error instanceof SetupError && error.cancelled) {
            void vscode.window.showInformationMessage(error.message);
            return;
        }
        if (error instanceof PipNotAvailableError) {
            this.setStatusBarWarning(statusBarItem, pythonCommand, text.pyTooltipPipUnavailable);
            void this.showProblem('warning', error.message, ['create-venv', 'select', 'show-log'], statusBarItem);
            return;
        }
        if (error instanceof ExternallyManagedError) {
            void this.showProblem('warning', error.message, ['create-venv', 'select', 'show-log'], statusBarItem);
            return;
        }
        if (error instanceof PythonNotFoundError) {
            this.setStatusBarWarning(statusBarItem, pythonCommand, text.pyTooltipMissingInterpreter);
            void this.showProblem('warning', error.message, ['select', 'open-browser', 'show-log'], statusBarItem);
            return;
        }
        const message = error instanceof SetupError ? error.message : text.pyInstallFailed;
        if (!(error instanceof SetupError)) {
            this.pythonSetupLog().appendLine(error instanceof Error ? error.message : String(error));
        }
        void this.showProblem('error', message, ['show-log', 'select'], statusBarItem);
    }

    private async installPackages(python: PythonInvocation, packages: string[]): Promise<void> {
        const resolved = resolveConfiguredInvocation(python);
        const pythonCommand = invocationText(python);
        this.pythonSetupLog().show(true);
        const run = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: fillTemplate(strings().pyInstallProgress, { command: pythonCommand }),
                cancellable: true,
            },
            (progress, token) => runLogged(
                this.pythonSetupLog(), resolved, ['-m', 'pip', 'install', ...packages], INSTALL_TIMEOUT_MS, progress, token,
            ),
        );
        const interrupted = interruptedError(run, INSTALL_TIMEOUT_MS);
        if (interrupted) { throw interrupted; }
        if (run.output.includes('No module named pip')) { throw new PipNotAvailableError(pythonCommand); }
        if (run.output.includes('externally-managed-environment')) { throw new ExternallyManagedError(pythonCommand); }
        if (run.code !== 0) { throw new SetupError(strings().pyInstallFailed); }
    }

    /**
     * Creates `<workspace>/.venv` with `baseCommand`, installs every requirement into it and selects it, which
     * restarts the backend through the configuration listener.
     */
    private async createWorkspaceVenvAndInstall(base: PythonInvocation, statusBarItem: vscode.StatusBarItem): Promise<void> {
        const text = strings();
        const root = getWorkspaceRoot();
        if (!root) { return; }
        const venvPath = path.join(root, '.venv');
        // Only a .venv this call made is ours to remove; a half-made one (no pip) would hide "Create .venv" for good.
        const createdHere = !fs.existsSync(venvPath);
        try {
            this.pythonSetupLog().show(true);
            const run = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: fillTemplate(text.pyCreateVenvProgress, { path: venvPath }),
                    cancellable: true,
                },
                (progress, token) => runLogged(
                    this.pythonSetupLog(),
                    resolveConfiguredInvocation(base),
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
            await this.installPackages(pythonInvocation(venvPath), requiredPackageRequirements());
            void vscode.window.showInformationMessage(text.pyInstallSucceeded);
            await this.storePythonCommand('.venv');
        } catch (error) {
            if (createdHere) {
                await fs.promises.rm(venvPath, { recursive: true, force: true }).catch((removeError: unknown) => {
                    this.pythonSetupLog().appendLine(`[venv] could not remove ${venvPath}: ${String(removeError)}`);
                });
            }
            this.reportSetupFailure(error, invocationText(base), statusBarItem);
        }
    }
}
