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
});
