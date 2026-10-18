import { expect, test } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';

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
    await expect(footer).toHaveText(STR.tooltipLoopOrShift + ' / ' + STR.hintDoubleClickResetZoom + ' / ' + STR.hintWheelGestures);

    const footerBox = await footer.boundingBox();
    const viewport = page.viewportSize();
    if (!footerBox || !viewport) throw new Error('footer has no layout box');
    expect(Math.round(footerBox.y + footerBox.height)).toBe(viewport.height);
});

test('axes, the spectrum and every toolbar control explain their gestures in the footer', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const footer = page.locator('#hint-footer');
    await expect(page.locator('#toolbar :is(button, summary, input):not([data-hint])')).toHaveCount(0);

    await page.locator('[data-action="zoom-in"]').hover();
    await expect(footer).toHaveText(STR.hintZoomIn);
    await page.locator('.track-axis-canvas').first().hover();
    await expect(footer).toHaveText(STR.hintWaveformAmplitudeAxis + ' / ' + STR.hintWheelGestures);

    const spectrum = page.locator('#spectrum-overlay-canvas');
    const box = await spectrum.boundingBox();
    if (!box) throw new Error('spectrum canvas has no layout box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(footer).toHaveText(STR.hintSpectrumPlot);
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await expect(footer).toHaveText(STR.hintSpectrumDbAxis);

    await page.mouse.move(0, 0);
    await spectrum.focus();
    await expect(footer).toHaveText(STR.hintSpectrumPlot);
    await expect(spectrum).toHaveAttribute('aria-description', STR.hintSpectrumPlot);
});

test('Space on a focused tree folder toggles the folder without reaching the playback shortcut', async ({ page }) => {
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    const directory = page.locator('.selection-tree-directory').first();
    const expanded = await directory.getAttribute('aria-expanded');
    await page.evaluate(() => {
        (window as unknown as { __docSpaces: number }).__docSpaces = 0;
        document.addEventListener('keydown', e => { if (e.key === ' ') (window as unknown as { __docSpaces: number }).__docSpaces++; });
    });
    await directory.focus();
    await page.keyboard.press(' ');
    await expect(directory).not.toHaveAttribute('aria-expanded', expanded ?? '');
    expect(await page.evaluate(() => (window as unknown as { __docSpaces: number }).__docSpaces)).toBe(0);
});
