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

test('toolbar buttons have aria-labels and toolbar has role=toolbar', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    // Verify toolbar has role="toolbar" and aria-label
    const toolbar = page.locator('#toolbar');
    await expect(toolbar).toHaveAttribute('role', 'toolbar');
    const ariaLabel = await toolbar.getAttribute('aria-label');
    expect(ariaLabel).toBeTruthy();

    // Verify zoom buttons have aria-labels
    const zoomOut = page.locator('[data-action="zoom-out"]');
    const zoomIn = page.locator('[data-action="zoom-in"]');
    const zoomReset = page.locator('[data-action="zoom-reset"]');
    await expect(zoomOut).toHaveAttribute('aria-label');
    await expect(zoomIn).toHaveAttribute('aria-label');
    await expect(zoomReset).toHaveAttribute('aria-label');
});

test('focus-visible CSS rule is present in rendered styles', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    const hasFocusVisibleRule = await page.evaluate(() => {
        for (const sheet of Array.from(document.styleSheets)) {
            try {
                for (const rule of Array.from(sheet.cssRules)) {
                    if (rule instanceof CSSStyleRule && rule.selectorText && rule.selectorText.includes('focus-visible')) {
                        return true;
                    }
                }
            } catch { /* cross-origin */ }
        }
        return false;
    });
    expect(hasFocusVisibleRule).toBe(true);
});
