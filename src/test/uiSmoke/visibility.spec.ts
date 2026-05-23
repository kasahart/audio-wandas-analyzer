import { expect, test } from '@playwright/test';
import { buildUiSmokeHtml } from './buildHtml';

test('help overlay is hidden by default and can be closed after opening', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    const helpOverlay = page.locator('#help-overlay');

    await expect(helpOverlay).toBeHidden();

    await page.locator('body').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('?');
    await expect(helpOverlay).toBeVisible();
    await expect(helpOverlay).toHaveCSS('display', 'flex');

    await page.keyboard.press('Escape');
    await expect(helpOverlay).toBeHidden();
});
