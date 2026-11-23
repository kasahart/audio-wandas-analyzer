// Which Python a process outside VS Code runs the backend's code with (verify, the protocol-type generator), in the
// same order as the tests' lookup: one rule in two files. Why two: these scripts run before `tsc compile` (verify
// starts with it; the generator is one of its first steps), so they cannot import the compiled
// src/extension/pythonInterpreter.ts, whose `pythonCandidates` and `fallbackPythonCommands` hold the same rule for the
// extension's code and the tests. src/test/pythonInterpreter.test.ts fails when the two lists differ, for each OS; a
// change to the order is made in both files and to that test's cases.
//
// The order: WANDAS_PYTHON (an interpreter path or command, as given), the workspace venvs (.venv, venv, env), the
// activated venv (VIRTUAL_ENV), then the commands per OS: `py -3` and `python` on Windows (python3 usually does not
// exist there), `python3` and `python` elsewhere. A candidate is a command and the arguments before the script's own
// ({ command: 'py', args: ['-3'] }), and is started as such. A path counts when it exists, a command when it starts
// (firstPython).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';

const WORKSPACE_VENV_NAMES = ['.venv', 'venv', 'env'];

/** The commands tried last, per OS (pythonInterpreter.ts fallbackPythonCommands). */
export function fallbackPythonCommands(platform = process.platform) {
    return platform === 'win32'
        ? [{ command: 'py', args: ['-3'] }, { command: 'python', args: [] }]
        : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
}

/** The interpreter inside an environment folder: Scripts\python.exe on Windows, bin/python elsewhere. */
function venvInterpreter(folder, platform) {
    return platform === 'win32' ? win32.join(folder, 'Scripts', 'python.exe') : posix.join(folder, 'bin', 'python');
}

const invocation = command => ({ command, args: [] });

/** The candidates in order, before any is checked. */
export function pythonCandidates({ root, env = process.env, platform = process.platform }) {
    const pathApi = platform === 'win32' ? win32 : posix;
    return [
        ...(env.WANDAS_PYTHON ? [invocation(env.WANDAS_PYTHON)] : []),
        ...WORKSPACE_VENV_NAMES.map(name => invocation(venvInterpreter(pathApi.join(root, name), platform))),
        ...(env.VIRTUAL_ENV ? [invocation(venvInterpreter(env.VIRTUAL_ENV, platform))] : []),
        ...fallbackPythonCommands(platform),
    ];
}

/** How a candidate is shown in messages: `py -3`. For display only. */
export const invocationText = candidate => [candidate.command, ...candidate.args].join(' ');

const isPath = candidate => /[\\/]/u.test(candidate.command);
const starts = candidate => spawnSync(candidate.command, [...candidate.args, '--version'], { stdio: 'ignore', windowsHide: true }).status === 0;

/** The first candidate that is there: a path that exists, or a command that starts. Undefined when none is. */
export function firstPython(candidates, { exists = existsSync, runs = starts } = {}) {
    return candidates.find(candidate => (isPath(candidate) ? exists(candidate.command) : runs(candidate)));
}
