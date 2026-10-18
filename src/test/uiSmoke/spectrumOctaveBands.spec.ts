import { expect, test, type Page } from '@playwright/test';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';

interface PostedSliceRequest {
    type: string;
    bandsPerOctave?: number;
}

function sliceRequests(page: Page): Promise<PostedSliceRequest[]> {
    return page.evaluate(() => ((window as typeof window & { __uiSmokePostedMessages: PostedSliceRequest[] }).__uiSmokePostedMessages)
        .filter(message => message && message.type === 'request-spectrum-slice'));
}

async function hoverOverlayAt(page: Page, fraction: number): Promise<void> {
    const overlay = page.locator('#spectrum-overlay-canvas');
    const box = await overlay.boundingBox();
    const width = await overlay.evaluate(canvas => (canvas as HTMLCanvasElement).width);
    if (!box) throw new Error('spectrum overlay has no layout box');
    // OVERLAY_SPECTRUM_PAD: 36 px left and 8 px right of the plot, in canvas pixels.
    const x = (36 + fraction * (width - 44)) * box.width / width;
    await page.mouse.move(box.x + x, box.y + box.height / 2);
}

test('the docked spectrum switches to 1/3 octave bands on a log axis and back to the FFT', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await sliceRequests(page)).length).toBeGreaterThan(0);
    await expect(page.locator('[data-action="spectrum-fft"]')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('[data-action="spectrum-octave-3"]').click();
    await expect(page.locator('[data-action="spectrum-octave-3"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-action="spectrum-fft"]')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await sliceRequests(page)).at(-1)?.bandsPerOctave).toBe(3);

    // The middle of a 22 Hz - 22 kHz log axis is about 708 Hz, nearest to the 630 Hz band.
    await hoverOverlayAt(page, 0.5);
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/ 630 Hz \//);
    await hoverOverlayAt(page, 0.99);
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/ 20000 Hz \//);

    await page.locator('[data-action="spectrum-fft"]').click();
    await expect.poll(async () => {
        const requests = await sliceRequests(page);
        return requests.length > 0 && requests[requests.length - 1].bandsPerOctave === undefined;
    }).toBe(true);
    await hoverOverlayAt(page, 0.5);
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/ 20\d\d(\.\d)? Hz \//);
});
