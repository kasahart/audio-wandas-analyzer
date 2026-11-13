#!/usr/bin/env node
// Single source of truth for "is the working tree green?" (`npm run verify`).
// An agent's task is not done until this script exits 0. Plain Node, so it runs the same on Windows.
//
// Runs: tsc compile, ESLint, Webview pattern lint, generated protocol types, single-source consistency,
// agent skills copy, GUI triggerability audit, node:test, ruff check + format --check, pyright, the backend's
// drawn-points flow check, pytest.
//   AWA_VERIFY_BROWSER=1  also checks the browser runtime assets and Worker/native parity
//   AWA_SLOW=1            also runs the slow pytest checks (the operation catalog's probe); CI sets it
//   AWA_PERF=1            also holds the pytest and node:test wall-clock budgets (they are reported either way)
//   AWA_VERIFY_SERIAL=1   runs the steps one after another with their output live (the default runs three
//                         independent lanes at once, TypeScript / ESLint / Python, and prints each lane when it ends)
// pytest runs across the CPU cores (pytest-xdist, -n auto) unless AWA_PERF=1, whose budgets assume a serial run.
// E2E (npm run verify:e2e) and the Playwright smoke (npm run test:ui) are separate CI jobs.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLanes } from './verify-runner.mjs';

const started = Date.now();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
const venvBin = join(root, '.venv', windows ? 'Scripts' : 'bin');
const env = { ...process.env };
if (existsSync(venvBin)) {
    env[pathKey] = `${venvBin}${delimiter}${env[pathKey] ?? ''}`;
}
const python = existsSync(venvBin) ? join(venvBin, windows ? 'python.exe' : 'python') : windows ? 'python' : 'python3';

// Through npm's own CLI when npm started us: spawning npm.cmd on Windows would need a shell.
const npm = args => process.env.npm_execpath
    ? [process.execPath, [process.env.npm_execpath, ...args]]
    : [windows ? 'npm.cmd' : 'npm', args];
const node = (...args) => [process.execPath, args];

for (const tool of ['ruff', 'pyright']) {
    if (spawnSync(python, ['-m', tool, '--version'], { env, stdio: 'ignore' }).status !== 0) {
        console.error(`${tool} not found — install dev deps with: pip install -c python-backend/constraints.txt -e ".[dev]"`);
        process.exit(1);
    }
}

// A lane is a list of steps that depend on the ones before them (node:test runs what tsc built); lanes run at once. A
// step that needs another lane's step names it in `after` and waits for it (pytest runs the compiled batch bundle in
// dist/, which tsc compile rewrites). The first failed step ends verify: the steps still running in the other lanes
// are stopped with their whole process tree, and verify fails naming the failure (scripts/verify-runner.mjs).
const pytestArgs = process.env.AWA_PERF === '1' ? [] : ['-n', 'auto', '--dist', 'worksteal'];
const lanes = [
    ['TypeScript', [
        ['tsc compile', ...npm(['run', 'compile'])],
        ['webview pattern lint', ...node('scripts/lint-webview-patterns.js')],
        ['generated protocol types (python-backend/protocol_schema.py)', ...node('scripts/generate-protocol-types.mjs')],
        ['single-source consistency (dependency pins, browser limits)', ...node('scripts/check-single-sources.mjs')],
        ['agent skills copy (.claude/skills from .agents/skills)', ...node('scripts/sync-skills.mjs', '--check')],
        ['gui triggerability audit', ...npm(['run', 'lint:gui-triggerability'])],
        // spec (not the non-TTY TAP default) repeats every failure at the end, so it survives a truncated CI log tail.
        ['node:test', ...node('--test', '--test-reporter=spec', 'dist/test/**/*.test.js')],
    ]],
    ['ESLint', [
        ['eslint', ...npm(['run', 'lint'])],
    ]],
    ['Python', [
        ['ruff check', python, ['-m', 'ruff', 'check', 'python-backend', 'scripts/check_decimation_flow.py']],
        ['ruff format --check', python, ['-m', 'ruff', 'format', '--check', 'python-backend', 'scripts/check_decimation_flow.py']],
        // Configured in pyproject.toml ([tool.pyright]); --pythonpath points it at the interpreter verify runs. pyright
        // needs that interpreter's absolute path: given a bare `python3` (CI has no .venv) it finds no site-packages.
        ['pyright', python, ['-m', 'pyright', '--pythonpath', () => pythonExecutable()]],
        // What the backend thins to draw (min/max per bucket, block averages) never becomes a number it sends (R1, R2).
        ['drawn points never become numbers (scripts/check_decimation_flow.py)', python, ['scripts/check_decimation_flow.py']],
        ['pytest', python, ['-m', 'pytest', 'python-backend', ...pytestArgs], { after: 'tsc compile' }],
    ]],
];
if (process.env.AWA_VERIFY_BROWSER === '1') {
    lanes.push(['Browser', [
        ['browser runtime asset integrity', python, ['scripts/prepare-browser-runtime.py', '--check']],
    ]]);
}

function pythonExecutable() {
    return spawnSync(python, ['-c', 'import sys; print(sys.executable)'], { env, encoding: 'utf8' }).stdout.trim();
}

const failures = await runLanes(lanes, { cwd: root, env, serial: process.env.AWA_VERIFY_SERIAL === '1' });
if (failures.length === 0 && process.env.AWA_VERIFY_BROWSER === '1') {
    // Builds into dist/ like tsc compile, so it runs after every lane.
    failures.push(...await runLanes([['Browser parity', [['browser Worker/native parity', ...npm(['run', 'test:browser'])]]]], { cwd: root, env, serial: true }));
}
if (failures.length > 0) {
    console.error(`verify: failed: ${failures.join('; ')} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    process.exit(1);
}
console.log(`verify: OK (${((Date.now() - started) / 1000).toFixed(1)} s)`);
