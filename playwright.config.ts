import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './src/test/uiSmoke',
    fullyParallel: false,
    retries: process.env['CI'] ? 1 : 0,
    use: {
        browserName: 'chromium',
        headless: true,
        viewport: { width: 1400, height: 900 },
    },
    reporter: 'list',
});
