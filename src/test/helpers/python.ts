import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { firstPython, pythonCandidates, workspaceVenvCommands, type PythonInvocation } from '../../extension/pythonInterpreter';

// The Python the tests run the backend's code with, by the rule of src/extension/pythonInterpreter.ts
// (`pythonCandidates`: WANDAS_PYTHON, the workspace venv, VIRTUAL_ENV, then `py -3`, python on Windows and python3,
// python elsewhere), the same as verify's (scripts/python-candidates.mjs). It is a command and its own arguments
// (`py -3`): start it as `spawn(python.command, [...python.args, ...])`, never by splitting a string. In CI a
// test that skips for want of it fails verify (scripts/test-skips.mjs).

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const starts = (python: PythonInvocation): boolean => spawnSync(python.command, [...python.args, '--version'], { stdio: 'ignore', windowsHide: true }).status === 0;

/** The interpreter the tests choose: the first candidate that exists (a path) or `runs` (a command). */
export function testPythonCommand({ env = process.env, platform = process.platform, root = repoRoot, exists = existsSync, runs = starts }: {
    env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; root?: string; exists?: (file: string) => boolean; runs?: (python: PythonInvocation) => boolean;
} = {}): PythonInvocation | undefined {
    return firstPython(pythonCandidates({ root, env, platform }), { exists, runs });
}

let found: PythonInvocation | null | undefined;

/** That interpreter when it starts, else undefined (a test then skips, which CI does not allow). */
export function testPython(): PythonInvocation | undefined {
    if (found === undefined) {
        const command = testPythonCommand();
        found = command !== undefined && starts(command) ? command : null;
    }
    return found ?? undefined;
}

/**
 * Whether a test that needs the Python backend must fail rather than skip without it: where it is required
 * (AWA_REQUIRE_BACKEND=1), and wherever the repository's own environment is set up (a workspace venv), so a local run
 * cannot pass a real-backend contract unseen either (C6). AWA_REQUIRE_BACKEND=0 lets such a run skip on purpose.
 */
export function backendRequired(env: NodeJS.ProcessEnv = process.env): boolean {
    if (env['AWA_REQUIRE_BACKEND'] === '1') return true;
    if (env['AWA_REQUIRE_BACKEND'] === '0') return false;
    return workspaceVenvCommands(repoRoot).length > 0;
}
