import { expect, test } from '@playwright/test';
import { SHORTCUT_ROWS } from '../../webview/comparisonRenderScript';
import { buildUiSmokeHtml } from './buildHtml';

test('keyboard shortcut dialog lists all documented shortcuts', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    await page.locator('body').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('?');
    const helpOverlay = page.locator('#help-overlay');
    await expect(helpOverlay).toBeVisible();

    for (const row of SHORTCUT_ROWS) {
        await expect(helpOverlay.getByText(row.shortcut, { exact: true })).toBeVisible();
    }
});

test('keyboard shortcut dialog traps focus on Tab and closes on Escape', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    await page.locator('body').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('?');
    await expect(page.locator('#help-close-btn')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator('#help-close-btn')).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#help-close-btn')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#help-overlay')).toBeHidden();
});
