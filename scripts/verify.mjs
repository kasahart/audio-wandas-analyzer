#!/usr/bin/env node
// Single source of truth for "is the working tree green?" (`npm run verify`).
// An agent's task is not done until this script exits 0. Plain Node, so it runs the same on Windows.
//
// Runs: tsc compile, Webview pattern lint, generated protocol types, single-source consistency,
// agent skills copy, GUI triggerability audit, node:test, ruff check + format --check, pyright, pytest.
//   AWA_VERIFY_BROWSER=1  also checks the browser runtime assets and Worker/native parity
//   AWA_SLOW=1            also runs the slow pytest checks (the operation catalog's probe); CI sets it
//   AWA_PERF=1            also holds pytest's wall-clock budgets (they are reported either way)
// E2E (npm run verify:e2e) and the Playwright smoke (npm run test:ui) are separate CI jobs.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
const venvBin = join(root, '.venv', windows ? 'Scripts' : 'bin');
const env = { ...process.env };
if (existsSync(venvBin)) {
    env[pathKey] = `${venvBin}${delimiter}${env[pathKey] ?? ''}`;
}
const python = existsSync(venvBin) ? join(venvBin, windows ? 'python.exe' : 'python') : windows ? 'python' : 'python3';

function run(label, command, args) {
    console.log(`==> ${label}`);
    const done = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
    if (done.error) {
        console.error(`verify: could not start ${command}: ${done.error.message}`);
        process.exit(1);
    }
    if (done.status !== 0) {
        console.error(`verify: ${label} failed`);
        process.exit(done.status ?? 1);
    }
}

// Through npm's own CLI when npm started us: spawning npm.cmd on Windows would need a shell.
const npm = args => process.env.npm_execpath
    ? [process.execPath, [process.env.npm_execpath, ...args]]
    : [windows ? 'npm.cmd' : 'npm', args];
const node = (...args) => [process.execPath, args];

for (const tool of ['ruff', 'pyright']) {
    if (spawnSync(python, ['-m', tool, '--version'], { env, stdio: 'ignore' }).status !== 0) {
        console.error(`${tool} not found — install dev deps with: pip install -e ".[dev]"`);
        process.exit(1);
    }
}

run('tsc compile', ...npm(['run', 'compile']));
run('webview pattern lint', ...node('scripts/lint-webview-patterns.js'));
run('generated protocol types (python-backend/protocol_schema.py)', ...node('scripts/generate-protocol-types.mjs'));
run('single-source consistency (dependency pins, browser limits)', ...node('scripts/check-single-sources.mjs'));
run('agent skills copy (.claude/skills from .agents/skills)', ...node('scripts/sync-skills.mjs', '--check'));
run('gui triggerability audit', ...npm(['run', 'lint:gui-triggerability']));
// spec (not the non-TTY TAP default) repeats every failure at the end, so it survives a truncated CI log tail.
run('node:test', ...node('--test', '--test-reporter=spec', 'dist/test/**/*.test.js'));
run('ruff check', python, ['-m', 'ruff', 'check', 'python-backend']);
run('ruff format --check', python, ['-m', 'ruff', 'format', '--check', 'python-backend']);
// Configured in pyproject.toml ([tool.pyright]); --pythonpath points it at the interpreter verify runs. pyright
// needs that interpreter's absolute path: given a bare `python3` (CI has no .venv) it finds no site-packages.
const pythonExecutable = spawnSync(python, ['-c', 'import sys; print(sys.executable)'], { env, encoding: 'utf8' }).stdout.trim();
run('pyright', python, ['-m', 'pyright', '--pythonpath', pythonExecutable]);
run('pytest', python, ['-m', 'pytest', 'python-backend']);

if (process.env.AWA_VERIFY_BROWSER === '1') {
    run('browser runtime asset integrity', python, ['scripts/prepare-browser-runtime.py', '--check']);
    run('browser Worker/native parity', ...npm(['run', 'test:browser']));
}

console.log('verify: OK');
