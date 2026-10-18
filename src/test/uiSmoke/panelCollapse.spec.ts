import { expect, test } from '@playwright/test';
import { buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';

test('the spectrum toggle folds the docked spectrum to its header and gives the tracks the room', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const toggle = page.locator('#spectrum-section-header [data-action="toggle-spectrum-panel"]');
    const plot = page.locator('#spectrum-overlay-wrap');
    const tracks = page.locator('#tracks-wrapper');
    const openTracksHeight = (await tracks.boundingBox())!.height;

    await toggle.click();
    await expect(plot).toBeHidden();
    await expect(page.locator('#spectrum-zoom-toolbar')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect((await tracks.boundingBox())!.height).toBeGreaterThan(openTracksHeight + 100);
    const section = (await page.locator('#spectrum-section').boundingBox())!;
    const footer = (await page.locator('#hint-footer').boundingBox())!;
    expect(Math.round(section.y + section.height)).toBe(Math.round(footer.y));

    // A collapsed panel has no height to drag.
    const handle = (await page.locator('[data-action="spectrum-height-drag"]').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 60, { steps: 4 });
    await page.mouse.up();
    await expect(plot).toBeHidden();

    await toggle.click();
    await expect(plot).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(Math.round((await tracks.boundingBox())!.height)).toBe(Math.round(openTracksHeight));
});

test('double-clicking the spectrum top edge folds and unfolds it', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const handle = page.locator('[data-action="spectrum-height-drag"]');
    const plot = page.locator('#spectrum-overlay-wrap');
    await handle.dblclick();
    await expect(plot).toBeHidden();
    await handle.dblclick();
    await expect(plot).toBeVisible();
});

test('the selection toggle hides the file list so the results pane takes the full width', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    const toggle = page.locator('#selection-toolbar [data-action="toggle-selection-sidebar"]');
    const sidebar = page.locator('#selection-sidebar');
    const results = page.locator('#selection-results-pane');
    const openWidth = (await results.boundingBox())!.width;

    await toggle.click();
    await expect(sidebar).toBeHidden();
    await expect(page.locator('#tree-resizer')).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => Math.round((await results.boundingBox())!.width)).toBe(1200);
    expect(openWidth).toBeLessThan(1200);

    await toggle.click();
    await expect(sidebar).toBeVisible();
    await expect.poll(async () => Math.round((await results.boundingBox())!.width)).toBe(Math.round(openWidth));

    await page.locator('#tree-resizer').dblclick();
    await expect(sidebar).toBeHidden();
});
