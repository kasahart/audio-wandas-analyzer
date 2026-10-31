import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';

async function expectSpectrumDockedAboveFooter(page: Page): Promise<void> {
    const section = await page.locator('#spectrum-section').boundingBox();
    const footer = await page.locator('#app-footer').boundingBox();
    if (!section || !footer) throw new Error('spectrum section or footer has no layout box');
    expect(Math.round(section.y + section.height)).toBe(Math.round(footer.y));
}

test('the power spectrum is docked at the bottom, above the hint footer', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expectSpectrumDockedAboveFooter(page);

    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    await expectSpectrumDockedAboveFooter(page);
});

test('dragging the spectrum top edge up makes it taller and down makes it shorter', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const handle = page.locator('[data-action="spectrum-height-drag"]');
    const canvas = page.locator('#spectrum-overlay-canvas');
    const handleBox = await handle.boundingBox();
    const sectionBox = await page.locator('#spectrum-section').boundingBox();
    if (!handleBox || !sectionBox) throw new Error('spectrum handle has no layout box');
    expect(Math.abs(handleBox.y + handleBox.height / 2 - sectionBox.y)).toBeLessThanOrEqual(1);

    const x = handleBox.x + handleBox.width / 2;
    const y = handleBox.y + handleBox.height / 2;
    const before = (await canvas.boundingBox())!.height;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 40, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBe(before + 40);
    const grownTop = (await page.locator('#spectrum-section').boundingBox())!.y;
    expect(Math.round(grownTop)).toBe(Math.round(sectionBox.y - 40));
    await expectSpectrumDockedAboveFooter(page);

    const grownHandle = (await handle.boundingBox())!;
    const y2 = grownHandle.y + grownHandle.height / 2;
    await page.mouse.move(x, y2);
    await page.mouse.down();
    await page.mouse.move(x, y2 + 30, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBe(before + 10);
});

test('the spectrum gear opens the shared frequency-analysis settings above itself', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const gear = page.locator('#spectrum-zoom-toolbar [data-action="spectrum-settings"]');
    const popover = page.locator('#spec-settings-popover');
    await gear.click();
    await expect(popover).toBeVisible();
    const gearBox = (await gear.boundingBox())!;
    const popoverBox = (await popover.boundingBox())!;
    expect(popoverBox.y).toBeGreaterThanOrEqual(0);
    expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(gearBox.y);
    await expect(page.locator('#spec-nfft')).toBeVisible();

    await page.locator('#spec-apply').click();
    await expect(popover).toBeHidden();
    await expect(page.locator('#reanalyze-overlay')).toBeVisible();
});

test('in a short Webview the settings popover stays on screen and Apply is reachable', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 500 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.locator('#spectrum-zoom-toolbar [data-action="spectrum-settings"]').click();
    const popover = page.locator('#spec-settings-popover');
    await expect(popover).toBeVisible();
    const box = (await popover.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(500);
    await page.locator('#spec-apply').click();
    await expect(popover).toBeHidden();
});

test('a cursor spectrum request left unanswered by a replaced analysis does not block the next one', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    // This host never answers spectrum requests, like a host whose source was cleared mid-request.
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const sliceRequests = (): Promise<number> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type?: string }> })
        .__uiSmokePostedMessages.filter(message => message.type === 'request-spectrum-slice').length);
    await expect.poll(sliceRequests).toBeGreaterThan(0);

    await page.evaluate(() => {
        const appWindow = window as unknown as { __APP_STATE__: { results: unknown[] }; __uiSmokePostedMessages: unknown[] };
        appWindow.__uiSmokePostedMessages = [];
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: appWindow.__APP_STATE__.results } }));
    });
    const box = await page.locator('#track-canvas-0').boundingBox();
    if (!box) throw new Error('track canvas has no layout box');
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
    await expect.poll(sliceRequests).toBeGreaterThan(0);
});
