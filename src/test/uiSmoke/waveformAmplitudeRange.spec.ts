import { expect, test } from '@playwright/test';
import { buildUiSmokeHtml } from './buildHtml';

test('double-clicking the waveform amplitude axis sets the vertical range from a popover', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const axis = page.locator('.track-axis-canvas').first();
    await axis.dblclick();
    const popover = page.locator('#waveform-range-popover');
    await expect(popover).toBeVisible();
    await expect(page.locator('#wave-range-max')).toBeFocused();

    const max = Number(await page.locator('#wave-range-max').inputValue());
    expect(max).toBeGreaterThan(0);
    await page.locator('#wave-range-min').fill('-0.25');
    await page.locator('#wave-range-max').fill('0.25');
    await page.locator('#wave-range-apply').click();
    await expect(popover).toBeHidden();

    await axis.dblclick();
    await expect(page.locator('#wave-range-max')).toHaveValue('0.25');
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
});
