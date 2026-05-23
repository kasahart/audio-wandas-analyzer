import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml } from './buildHtml';

async function loadUi(page: Page) {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.locator('body').click({ position: { x: 20, y: 20 } });
}

async function openHelp(page: Page) {
    await page.keyboard.press('?');
}

test('help overlay opens with ? and starts hidden', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    await expect(helpOverlay).toBeHidden();

    await openHelp(page);
    await expect(helpOverlay).toBeVisible();
    await expect(helpOverlay).toHaveCSS('display', 'flex');
});

test('help overlay closes when ? is pressed again', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    await openHelp(page);
    await expect(helpOverlay).toBeVisible();

    await openHelp(page);
    await expect(helpOverlay).toBeHidden();
});

test('help overlay closes with Escape', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    await openHelp(page);
    await expect(helpOverlay).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(helpOverlay).toBeHidden();
});

test('help overlay closes with the close button', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    await openHelp(page);
    await expect(helpOverlay).toBeVisible();

    await page.locator('#help-close-btn').click();
    await expect(helpOverlay).toBeHidden();
});

test('help overlay closes when the backdrop is clicked', async ({ page }) => {
    await loadUi(page);

    const helpOverlay = page.locator('#help-overlay');
    await openHelp(page);
    await expect(helpOverlay).toBeVisible();

    await helpOverlay.click({ position: { x: 8, y: 8 } });
    await expect(helpOverlay).toBeHidden();
});
