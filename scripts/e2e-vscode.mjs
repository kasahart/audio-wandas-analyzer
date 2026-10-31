#!/usr/bin/env node
// Runs the VS Code extension-host E2E; under xvfb-run where it exists (headless Linux), directly elsewhere.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'e2e', 'runVscodeE2E.js');
const xvfb = process.platform === 'linux' && spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).error === undefined;
const [command, args] = xvfb ? ['xvfb-run', ['-a', process.execPath, runner]] : [process.execPath, [runner]];
const done = spawnSync(command, args, { stdio: 'inherit' });
process.exit(done.status ?? 1);
