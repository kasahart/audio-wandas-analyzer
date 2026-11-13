import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { choosePythonCommand, resolvePythonCommand, virtualEnvPythonCommand, workspaceVenvCommands } from '../../extension/pythonInterpreter';

// The Python the tests run the backend's code with, chosen as the extension chooses it (src/extension/pythonInterpreter.ts),
// so a test that needs Python runs wherever the extension would find one, on every OS. WANDAS_PYTHON stands for the
// user's `pythonCommand` setting; the repository's workspace venv (.venv, venv, env) for the interpreter the Python
// extension makes active in a workspace that has one. In CI a test that skips for want of it fails verify
// (scripts/test-skips.mjs).

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/** The interpreter command or path, before checking that it runs. */
export function testPythonCommand({ env = process.env, platform = process.platform, root = repoRoot, exists = existsSync }: {
    env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; root?: string; exists?: (file: string) => boolean;
} = {}): string {
    const chosen = choosePythonCommand({
        configured: env['WANDAS_PYTHON'] || undefined,
        active: workspaceVenvCommands(root, platform, exists)[0],
        virtualEnv: virtualEnvPythonCommand(env, platform, exists),
    });
    return resolvePythonCommand(chosen, platform, root);
}

let found: string | null | undefined;

/** That interpreter when it starts, else undefined (a test then skips, which CI does not allow). */
export function testPython(): string | undefined {
    if (found === undefined) {
        const command = testPythonCommand();
        found = spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0 ? command : null;
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
