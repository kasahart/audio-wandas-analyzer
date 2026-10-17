import { expect, test } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { buildUiSmokeHtml } from './buildHtml';

const STR = getStrings('en');

test('hints show in the footer instead of tooltips beside the pointer', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const footer = page.locator('#hint-footer');
    await expect(footer).toBeVisible();
    await expect(page.locator('[title]')).toHaveCount(0);

    await page.locator('[data-action="toggle-follow-cursor"]').hover();
    await expect(footer).toHaveText(STR.btnFollowCursorTitle);

    const canvas = page.locator('.track-canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('track canvas has no layout box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(footer).toHaveText(STR.tooltipLoopOrShift);

    const footerBox = await footer.boundingBox();
    const viewport = page.viewportSize();
    if (!footerBox || !viewport) throw new Error('footer has no layout box');
    expect(Math.round(footerBox.y + footerBox.height)).toBe(viewport.height);
});
