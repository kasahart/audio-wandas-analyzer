import { expect, test } from '@playwright/test';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';

test('spectrum header names the analysis window behind the cursor-linked spectrum', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann -?\d+\.\d{3}–\d+\.\d{3} s \(\d+(\.\d+)? ms\)/);
});
