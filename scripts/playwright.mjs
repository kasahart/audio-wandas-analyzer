#!/usr/bin/env node
// `npx playwright <args>` with the repo's defaults, on every OS: browsers in ~/.cache/ms-playwright unless
// PLAYWRIGHT_BROWSERS_PATH says otherwise (so worktrees and the devcontainer share one download), and no
// garbage collection of other Playwright versions' browsers.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright'),
    PLAYWRIGHT_SKIP_BROWSER_GC: '1',
};
const done = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { env, stdio: 'inherit' });
process.exit(done.status ?? 1);
