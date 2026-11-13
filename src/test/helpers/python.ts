import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { firstPython, pythonCandidates, workspaceVenvCommands } from '../../extension/pythonInterpreter';

// The Python the tests run the backend's code with, by the rule of src/extension/pythonInterpreter.ts
// (`pythonCandidates`: WANDAS_PYTHON, the workspace venv, VIRTUAL_ENV, python3, python), the same on every OS and the
// same as verify's (scripts/python-candidates.mjs). In CI a test that skips for want of it fails verify
// (scripts/test-skips.mjs).

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const starts = (command: string): boolean => spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0;

/** The interpreter the tests choose: the first candidate that exists (a path) or `runs` (a command). */
export function testPythonCommand({ env = process.env, platform = process.platform, root = repoRoot, exists = existsSync, runs = starts }: {
    env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; root?: string; exists?: (file: string) => boolean; runs?: (command: string) => boolean;
} = {}): string | undefined {
    return firstPython(pythonCandidates({ root, env, platform }), { exists, runs });
}

let found: string | null | undefined;

/** That interpreter when it starts, else undefined (a test then skips, which CI does not allow). */
export function testPython(): string | undefined {
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
