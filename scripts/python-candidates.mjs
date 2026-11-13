// Which Python a process outside VS Code runs the backend's code with (verify, the protocol-type generator), in the
// same order as the tests' lookup: one rule in two files. Why two: these scripts run before `tsc compile` (verify
// starts with it; the generator is one of its first steps), so they cannot import the compiled
// src/extension/pythonInterpreter.ts, whose `pythonCandidates` holds the same rule for the extension's code and the
// tests. src/test/pythonInterpreter.test.ts fails when the two lists differ, for each OS; a change to the order is
// made in both files and to that test's cases.
//
// The order: WANDAS_PYTHON (an interpreter path or command, as given), the workspace venvs (.venv, venv, env), the
// activated venv (VIRTUAL_ENV), then the commands python3 and python. A path counts when it exists, a command when it
// starts (firstPython).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';

const WORKSPACE_VENV_NAMES = ['.venv', 'venv', 'env'];
const FALLBACK_COMMANDS = ['python3', 'python'];

/** The interpreter inside an environment folder: Scripts\python.exe on Windows, bin/python elsewhere. */
function venvInterpreter(folder, platform) {
    return platform === 'win32' ? win32.join(folder, 'Scripts', 'python.exe') : posix.join(folder, 'bin', 'python');
}

/** The candidates in order, before any is checked. */
export function pythonCandidates({ root, env = process.env, platform = process.platform }) {
    const pathApi = platform === 'win32' ? win32 : posix;
    return [
        ...(env.WANDAS_PYTHON ? [env.WANDAS_PYTHON] : []),
        ...WORKSPACE_VENV_NAMES.map(name => venvInterpreter(pathApi.join(root, name), platform)),
        ...(env.VIRTUAL_ENV ? [venvInterpreter(env.VIRTUAL_ENV, platform)] : []),
        ...FALLBACK_COMMANDS,
    ];
}

const isPath = candidate => /[\\/]/u.test(candidate);
const starts = command => spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0;

/** The first candidate that is there: a path that exists, or a command that starts. Undefined when none is. */
export function firstPython(candidates, { exists = existsSync, runs = starts } = {}) {
    return candidates.find(candidate => (isPath(candidate) ? exists(candidate) : runs(candidate)));
}
