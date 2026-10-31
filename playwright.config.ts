import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './src/test/uiSmoke',
    fullyParallel: false,
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
    // The 100,000-recording timings run only with AWA_PERF=1, alone and after the rest: beside other workers they
    // measure the machine's load.
    projects: [
        { name: 'ui', testIgnore: /scale100k\.spec\.ts/ },
        ...(process.env['AWA_PERF'] === '1' ? [{ name: 'scale', testMatch: /scale100k\.spec\.ts/, dependencies: ['ui'] }] : []),
    ],
});
