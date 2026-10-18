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

    // The folded header itself is the way back.
    await page.locator('#spectrum-section-header').click({ position: { x: 40, y: 8 } });
    await expect(plot).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(Math.round((await tracks.boundingBox())!.height)).toBe(Math.round(openTracksHeight));

    await page.locator('#spectrum-section-header').click({ position: { x: 40, y: 8 } });
    await expect(plot).toBeVisible();
    await toggle.click();
    await expect(plot).toBeHidden();
    await toggle.click();
    await expect(plot).toBeVisible();
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
    const rail = page.locator('#selection-sidebar-rail');
    await expect(rail).toBeVisible();
    await expect(page.locator('#selection-rail-count')).toHaveText('0/2');
    const railWidth = (await rail.boundingBox())!.width;
    await expect.poll(async () => Math.round((await results.boundingBox())!.width)).toBe(Math.round(1200 - railWidth));
    expect(openWidth).toBeLessThan(1200 - railWidth);

    // Clicking anywhere on the rail brings the list back.
    const railBox = (await rail.boundingBox())!;
    await page.mouse.click(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2);
    await expect(sidebar).toBeVisible();
    await expect(rail).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => Math.round((await results.boundingBox())!.width)).toBe(Math.round(openWidth));

    await page.locator('#tree-resizer').dblclick();
    await expect(sidebar).toBeHidden();
});

test('maximizing the spectrum gives its plot the tracks\' room and Esc restores the layout', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const maximize = page.locator('#spectrum-section-header [data-action="toggle-spectrum-maximize"]');
    const canvas = page.locator('#spectrum-overlay-canvas');
    const tracks = page.locator('#tracks-wrapper');
    const before = (await canvas.boundingBox())!.height;

    await maximize.click();
    await expect(maximize).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBeGreaterThan(400);
    const tracksBox = (await tracks.boundingBox())!;
    expect(tracksBox.height).toBeGreaterThan(40);
    expect(tracksBox.height).toBeLessThanOrEqual(900 * 0.3 + 1);
    await expect(page.locator('[data-action="spectrum-height-drag"]')).toBeHidden();
    const section = (await page.locator('#spectrum-section').boundingBox())!;
    const footer = (await page.locator('#hint-footer').boundingBox())!;
    expect(Math.round(section.y + section.height)).toBe(Math.round(footer.y));

    // The plot follows the window while maximized.
    await page.setViewportSize({ width: 1200, height: 700 });
    await expect.poll(async () => Math.round((await page.locator('#spectrum-section').boundingBox())!.y + (await page.locator('#spectrum-section').boundingBox())!.height))
        .toBe(Math.round((await page.locator('#hint-footer').boundingBox())!.y));

    await page.locator('body').press('Escape');
    await expect(maximize).toHaveAttribute('aria-pressed', 'false');
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBe(before);
});

test('collapsing a maximized spectrum leaves maximize, and maximizing a collapsed one unfolds it', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const maximize = page.locator('#spectrum-section-header [data-action="toggle-spectrum-maximize"]');
    const collapse = page.locator('#spectrum-section-header [data-action="toggle-spectrum-panel"]');
    const plot = page.locator('#spectrum-overlay-wrap');
    await maximize.click();
    await collapse.click();
    await expect(plot).toBeHidden();
    await expect(maximize).toHaveAttribute('aria-pressed', 'false');
    expect((await page.locator('#tracks-wrapper').boundingBox())!.height).toBeGreaterThan(500);

    await maximize.click();
    await expect(plot).toBeVisible();
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(maximize).toHaveAttribute('aria-pressed', 'true');
});

test('dragging the spectrum edge can go past the old 320 px cap but keeps a strip of tracks', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const handle = (await page.locator('[data-action="spectrum-height-drag"]').boundingBox())!;
    const x = handle.x + handle.width / 2;
    await page.mouse.move(x, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await page.locator('#spectrum-overlay-canvas').boundingBox())!.height).toBeGreaterThan(320);
    expect((await page.locator('#tracks-wrapper').boundingBox())!.height).toBeGreaterThanOrEqual(119);

    // A smaller window shrinks the tall spectrum again instead of squeezing the tracks out.
    await page.setViewportSize({ width: 1200, height: 600 });
    await expect.poll(async () => (await page.locator('#tracks-wrapper').boundingBox())!.height).toBeGreaterThanOrEqual(119);
    const section = (await page.locator('#spectrum-section').boundingBox())!;
    const footer = (await page.locator('#hint-footer').boundingBox())!;
    expect(Math.round(section.y + section.height)).toBe(Math.round(footer.y));
});
