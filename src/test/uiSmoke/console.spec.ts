import { expect, test } from '@playwright/test';
import { buildUiSmokeHtml } from './buildHtml';

test('webview smoke renders without console or page errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });

    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    await page.locator('body').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('?');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Spectrogram' }).click();
    await page.locator('[data-action="spectrogram-settings"]').click();
    await expect(page.locator('#spec-settings-popover')).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
});
