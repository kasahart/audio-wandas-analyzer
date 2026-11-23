import { expect, test } from './canvasAudit';
import { buildUiSmokeHtml } from './buildHtml';
import { drawnRow, rowFigure } from './tracksFigures';

/**
 * A screen of two device pixels a point (a Retina display, a scaled Windows desktop). A row's Figure draws its bitmap
 * at the device's pixels and the page's stylesheet sizes the canvas to its box: without that rule the canvas is shown
 * at its bitmap's size, twice as wide and tall as the row, with only its top left corner in sight.
 */
test.use({ deviceScaleFactor: 2 });

test('on a screen of two device pixels a point, a row\'s Figure is as large as its row, drawn at the device\'s pixels', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const seen = await drawnRow(page);
    const sizes = await page.locator(rowFigure(0)).evaluate((canvas: HTMLCanvasElement) => {
        const own = canvas.getBoundingClientRect(), box = canvas.parentElement!.getBoundingClientRect();
        return { own: [own.width, own.height], box: [box.width, box.height], bitmap: [canvas.width, canvas.height], ratio: window.devicePixelRatio };
    });
    expect(sizes.ratio).toBe(2);
    expect(sizes.own, 'the canvas fills its row\'s box, no more').toEqual(sizes.box);
    expect(sizes.bitmap).toEqual(sizes.box.map(side => Math.round(side * 2)));
    // Every lane lies inside the row as shown.
    for (const lane of seen.lanes) {
        expect(lane.frame.left + lane.frame.width).toBeLessThanOrEqual(sizes.box[0]);
        expect(lane.frame.top + lane.frame.height).toBeLessThanOrEqual(sizes.box[1]);
    }
});
