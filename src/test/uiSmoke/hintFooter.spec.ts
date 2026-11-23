import { expect, test } from './canvasAudit';
import { getStrings } from '../../shared/i18n/strings';
import { buildUiSmokeHtml } from './buildHtml';
import { pointOnLane, pointOnRowAxis, rowFigure, ROW_WAVE, drawnRow } from './tracksFigures';


const STR = getStrings('en');

test('hints show in the footer instead of tooltips beside the pointer', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const footer = page.locator('#hint-footer');
    await expect(footer).toBeVisible();
    // The lane view has no native tooltips; the entry table and comparison add them on purpose (titledHintAttr).
    await expect(page.locator('[title]:not(#entry-screen *)')).toHaveCount(0);

    await page.locator('#tb-more-menu > summary').hover();
    await expect(footer).toHaveText(STR.toolbarMore);
    await page.locator('#tb-more-menu > summary').click();
    await page.locator('[data-action="toggle-follow-cursor"]').hover();
    await expect(footer).toHaveText(STR.btnFollowCursorTitle);
    await page.locator('#tb-more-menu > summary').click();

    await drawnRow(page);
    const plot = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.5);
    await page.mouse.move(plot.x, plot.y);
    await expect(footer).toHaveText(STR.hintRectZoomDrag + ' / ' + STR.hintDoubleClickResetZoom + ' / ' + STR.hintWheelGestures);

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
    // A row's axis is its Figure's: it says what a double-click on it does, as every Figure's axis does.
    const axis = await pointOnRowAxis(page, 'amplitude');
    await page.mouse.move(axis.x, axis.y);
    await expect(footer).toHaveText(STR.compareHintAxis);

    const spectrum = page.locator('#spectrum-overlay-plot');
    const box = await spectrum.boundingBox();
    if (!box) throw new Error('spectrum canvas has no layout box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(footer).toHaveText(STR.hintSpectrumPlot);
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    // An axis of the Figure says what a double-click on it does, as on the comparison's.
    await expect(footer).toHaveText(STR.compareHintAxis);
});

