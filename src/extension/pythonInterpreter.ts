// Which Python interpreter the analyzer starts, without VS Code: the extension (pythonEnvironment.ts) and the tests
// that run the backend's Python (src/test/helpers/python.ts) both decide it here, so a test finds the interpreter the
// extension would, on every OS (`.venv\Scripts\python.exe` on Windows, `.venv/bin/python` elsewhere). Tests that once
// looked only for `.venv/bin/python` never ran on Windows, nor in a CI job without that path, and nothing said so.
import * as fs from 'fs';
import * as path from 'path';

/** The workspace virtual-environment folders the extension offers, in this order. */
export const WORKSPACE_VENV_NAMES = ['.venv', 'venv', 'env'] as const;

/**
 * `audioWandasAnalyzer.pythonCommand`'s default (package.json). The value is read only when the user set the setting;
 * when nothing chose an interpreter the extension tries fallbackPythonCommands instead.
 */
export const DEFAULT_PYTHON_COMMAND = 'python3';

export function isPythonExecutablePath(value: string): boolean {
    return /(^|[/\\])python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/iu.test(value);
}

export function isLikelyCommand(value: string): boolean {
    return /^(?:python(?:\d+(?:\.\d+)?)?|py(?:\.exe)?|python(?:\d+(?:\.\d+)?)?\.exe)$/iu.test(value);
}

/**
 * The program `pythonCommand` names: a command (python3) as it is, an interpreter path as it is (relative ones
 * against `workspaceRoot`), and an environment folder as the interpreter inside it (`Scripts\python.exe` on
 * Windows, `bin/python` elsewhere).
 */
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

/** The activated virtual environment (`VIRTUAL_ENV`), when its interpreter exists. */
export function virtualEnvPythonCommand(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    exists: (file: string) => boolean = fs.existsSync,
): string | undefined {
    const virtualEnv = env['VIRTUAL_ENV'];
    return virtualEnv && exists(resolvePythonCommand(virtualEnv, platform)) ? virtualEnv : undefined;
}

/** The workspace virtual-environment folders (WORKSPACE_VENV_NAMES) under `workspaceRoot` that hold an interpreter. */
export function workspaceVenvCommands(
    workspaceRoot: string,
    platform: NodeJS.Platform = process.platform,
    exists: (file: string) => boolean = fs.existsSync,
): string[] {
    return WORKSPACE_VENV_NAMES.filter(name => exists(resolvePythonCommand(name, platform, workspaceRoot)));
}

/**
 * A program that runs Python, and the arguments that come before the script's own: `py -3` is
 * `{ command: 'py', args: ['-3'] }`. A candidate is kept in this form wherever it is started (the backend, the
 * dependency check, pip, venv, the tests), so a command with an argument is never split out of a string.
 */
export interface PythonInvocation {
    readonly command: string;
    readonly args: readonly string[];
}

/** A program with no arguments of its own: an interpreter path, an environment folder or a plain command. */
export function pythonInvocation(command: string): PythonInvocation {
    return { command, args: [] };
}

/** How a candidate is shown to the user and in logs: `py -3`. For display only; it is never parsed back. */
export function invocationText(candidate: PythonInvocation): string {
    return [candidate.command, ...candidate.args].join(' ');
}

/**
 * The commands tried last, after every interpreter that a setting, an environment or a workspace venv names. Per OS,
 * because the command that runs Python 3 differs: on Windows the Python launcher `py -3` (python.org installers add
 * it; `python3` usually does not exist there, and `python` may be the Microsoft Store stub that only prints a hint),
 * then `python`; elsewhere `python3`, then `python` (on some systems `python` is Python 2 or absent).
 * The one place this order is decided; scripts/python-candidates.mjs repeats it for the scripts that run before
 * `tsc compile`, and src/test/pythonInterpreter.test.ts fails when the two differ for any OS.
 */
export function fallbackPythonCommands(platform: NodeJS.Platform = process.platform): PythonInvocation[] {
    return platform === 'win32'
        ? [{ command: 'py', args: ['-3'] }, pythonInvocation('python')]
        : [pythonInvocation('python3'), pythonInvocation('python')];
}

/**
 * The interpreters the extension tries, in order: the one the user set (`pythonCommand`), else the active one (the
 * Python extension's), else the activated virtual environment, as the only candidate (a choice is not passed over for
 * another interpreter); when none of them chose, fallbackPythonCommands for `platform`. The first that runs is used
 * (firstRunningPython).
 */
export function extensionPythonCandidates(
    sources: { configured?: string; active?: string; virtualEnv?: string },
    platform: NodeJS.Platform = process.platform,
): PythonInvocation[] {
    const chosen = sources.configured ?? sources.active ?? sources.virtualEnv;
    return chosen !== undefined ? [pythonInvocation(chosen)] : fallbackPythonCommands(platform);
}

/** A candidate that did not run, and the error its probe gave. */
export interface PythonProbeFailure {
    candidate: PythonInvocation;
    error: unknown;
}

/**
 * Probes `candidates` in order and stops at the first whose `probe` resolves, so a working first candidate (the
 * configured interpreter, a venv) costs one probe and no more. `found` is that candidate and its probe's result;
 * `failures` are the candidates before it (all of them when none ran), each with why. An error for which `fatal` is
 * true ends the search and is thrown (a candidate that must not be started at all).
 */
export async function firstRunningPython<T>(
    candidates: readonly PythonInvocation[],
    probe: (candidate: PythonInvocation) => Promise<T>,
    fatal: (error: unknown) => boolean = () => false,
): Promise<{ found?: { candidate: PythonInvocation; result: T }; failures: PythonProbeFailure[] }> {
    const failures: PythonProbeFailure[] = [];
    for (const candidate of candidates) {
        try {
            return { found: { candidate, result: await probe(candidate) }, failures };
        } catch (error) {
            if (fatal(error)) { throw error; }
            failures.push({ candidate, error });
        }
    }
    return { failures };
}

/** The venv interpreter inside an environment folder: `Scripts\python.exe` on Windows, `bin/python` elsewhere. */
function venvInterpreter(folder: string, platform: NodeJS.Platform): string {
    return platform === 'win32' ? path.win32.join(folder, 'Scripts', 'python.exe') : path.posix.join(folder, 'bin', 'python');
}

/**
 * The interpreters a process outside VS Code tries for the backend's code (the tests, and through
 * scripts/python-candidates.mjs verify and the protocol-type generator), in order: WANDAS_PYTHON (an interpreter path
 * or command, as given; it stands for the `pythonCommand` setting), the workspace venvs (what the Python extension
 * makes active in a workspace that has one), the activated venv (VIRTUAL_ENV), then fallbackPythonCommands.
 * One rule in two files: the scripts run before `tsc compile`, so they cannot import this; the test of this module
 * fails when the two lists differ for any OS.
 */
export function pythonCandidates({ root, env = process.env, platform = process.platform }: {
    root: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform;
}): PythonInvocation[] {
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    return [
        ...(env['WANDAS_PYTHON'] ? [pythonInvocation(env['WANDAS_PYTHON'])] : []),
        ...WORKSPACE_VENV_NAMES.map(name => pythonInvocation(venvInterpreter(pathApi.join(root, name), platform))),
        ...(env['VIRTUAL_ENV'] ? [pythonInvocation(venvInterpreter(env['VIRTUAL_ENV'], platform))] : []),
        ...fallbackPythonCommands(platform),
    ];
}

/** The first candidate that is there: a path that `exists`, or a command that `runs`. */
export function firstPython(candidates: readonly PythonInvocation[], { exists, runs }: {
    exists: (file: string) => boolean; runs: (candidate: PythonInvocation) => boolean;
}): PythonInvocation | undefined {
    return candidates.find(candidate => (/[\\/]/u.test(candidate.command) ? exists(candidate.command) : runs(candidate)));
}
