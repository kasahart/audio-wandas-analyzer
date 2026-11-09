import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './src/test/uiSmoke',
    fullyParallel: false,
    // One worker per CPU core (Playwright's default is half): the smoke is CPU-bound, and on a 4-core machine 4 workers
    // take ~5 min where 2 took ~6.5. AWA_PERF=1 keeps the default, whose load its wall-clock budgets assume.
    // AWA_UI_WORKERS (a count or a percentage) overrides both; so does --workers.
    workers: process.env['AWA_UI_WORKERS'] || (process.env['AWA_PERF'] === '1' ? undefined : '100%'),
    retries: process.env['CI'] ? 1 : 0,
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ],
    use: {
        browserName: 'chromium',
        headless: true,
        viewport: { width: 1400, height: 900 },
        launchOptions: { executablePath: process.env['AWA_CHROMIUM_EXECUTABLE'] || undefined },
    },
});
