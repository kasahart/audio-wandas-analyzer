// Which Python interpreter the analyzer starts, without VS Code: the extension (pythonEnvironment.ts) and the tests
// that run the backend's Python (src/test/helpers/python.ts) both decide it here, so a test finds the interpreter the
// extension would, on every OS (`.venv\Scripts\python.exe` on Windows, `.venv/bin/python` elsewhere). Tests that once
// looked only for `.venv/bin/python` never ran on Windows, nor in a CI job without that path, and nothing said so.
import * as fs from 'fs';
import * as path from 'path';

/** The workspace virtual-environment folders the extension offers, in this order. */
export const WORKSPACE_VENV_NAMES = ['.venv', 'venv', 'env'] as const;

/** `audioWandasAnalyzer.pythonCommand`'s default (package.json): the interpreter when nothing else chose one. */
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
 * The interpreter in use, before resolution: the one the user set (`pythonCommand`), else the active one (the Python
 * extension's), else the activated virtual environment, else DEFAULT_PYTHON_COMMAND.
 */
export function choosePythonCommand(sources: { configured?: string; active?: string; virtualEnv?: string }): string {
    return sources.configured ?? sources.active ?? sources.virtualEnv ?? DEFAULT_PYTHON_COMMAND;
}

/** The commands tried last outside VS Code, after every interpreter path. */
export const FALLBACK_PYTHON_COMMANDS = ['python3', 'python'] as const;

/** The interpreter inside an environment folder: `Scripts\python.exe` on Windows, `bin/python` elsewhere. */
function venvInterpreter(folder: string, platform: NodeJS.Platform): string {
    return platform === 'win32' ? path.win32.join(folder, 'Scripts', 'python.exe') : path.posix.join(folder, 'bin', 'python');
}

/**
 * The interpreters a process outside VS Code tries for the backend's code (the tests, and through
 * scripts/python-candidates.mjs verify and the protocol-type generator), in order: WANDAS_PYTHON (an interpreter path
 * or command, as given; it stands for the `pythonCommand` setting), the workspace venvs (what the Python extension
 * makes active in a workspace that has one), the activated venv (VIRTUAL_ENV), then FALLBACK_PYTHON_COMMANDS.
 * One rule in two files: the scripts run before `tsc compile`, so they cannot import this; the test of this module
 * fails when the two lists differ for any OS.
 */
export function pythonCandidates({ root, env = process.env, platform = process.platform }: {
    root: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform;
}): string[] {
    const pathApi = platform === 'win32' ? path.win32 : path.posix;
    return [
        ...(env['WANDAS_PYTHON'] ? [env['WANDAS_PYTHON']] : []),
        ...WORKSPACE_VENV_NAMES.map(name => venvInterpreter(pathApi.join(root, name), platform)),
        ...(env['VIRTUAL_ENV'] ? [venvInterpreter(env['VIRTUAL_ENV'], platform)] : []),
        ...FALLBACK_PYTHON_COMMANDS,
    ];
}

/** The first candidate that is there: a path that `exists`, or a command that `runs`. */
export function firstPython(candidates: readonly string[], { exists, runs }: {
    exists: (file: string) => boolean; runs: (command: string) => boolean;
}): string | undefined {
    return candidates.find(candidate => (/[\\/]/u.test(candidate) ? exists(candidate) : runs(candidate)));
}
