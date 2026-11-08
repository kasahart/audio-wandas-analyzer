import { expect, test, type Page } from './canvasAudit';
import { buildExtensionHostPathManyTracksHtml, buildExtensionHostPathUiSmokeHtml } from './buildHtml';

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
    // OVERLAY_SPECTRUM_PAD: 52 px left and 8 px right of the plot, in canvas pixels.
    const x = (52 + fraction * (width - 60)) * box.width / width;
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
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/ 20 kHz \//);

    await page.locator('[data-action="spectrum-fft"]').click();
    await expect.poll(async () => {
        const requests = await sliceRequests(page);
        return requests.length > 0 && requests[requests.length - 1].bandsPerOctave === undefined;
    }).toBe(true);
    await hoverOverlayAt(page, 0.5);
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/ 2(\.0\d{0,2})? kHz \//);
});

test('the cursor spectrum names its level axis as Compare does, uncalibrated, and its lines in a legend', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await sliceRequests(page)).length).toBeGreaterThan(0);
    await page.evaluate(() => {
        const texts: string[] = [];
        (window as unknown as { __overlayTexts: string[] }).__overlayTexts = texts;
        const proto = CanvasRenderingContext2D.prototype;
        const { fillText } = Object.getOwnPropertyDescriptors(proto);
        proto.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) {
            if (this.canvas.id === 'spectrum-overlay-canvas') texts.push(text);
            const draw = fillText.value as (this: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number) => void;
            if (maxWidth === undefined) draw.call(this, text, x, y); else draw.call(this, text, x, y, maxWidth);
        };
    });
    const overlayTexts = () => page.evaluate(() => (window as unknown as { __overlayTexts: string[] }).__overlayTexts);
    // Not the backend's "Spectrum amplitude level": the UI's name, with the files uncalibrated.
    // A short panel's axis has room for the unit alone: the legend gives the whole name, before the lines' names.
    await hoverOverlayAt(page, 0.5);
    const legend = page.locator('#spectrum-axis-legend');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.spectrum-axis-legend-label').first()).not.toBeEmpty();
    await expect(legend.locator('.spectrum-axis-legend-reference')).toHaveText(/^Amplitude, uncalibrated \[dB/);
    expect((await overlayTexts()).some(text => text.startsWith('Spectrum amplitude level'))).toBe(false);
    // 1/3 octave bands are named the same way, not "Band level".
    await page.locator('[data-action="spectrum-octave-3"]').click();
    await page.evaluate(() => { (window as unknown as { __overlayTexts: string[] }).__overlayTexts.length = 0; });
    await hoverOverlayAt(page, 0.5);
    await expect.poll(() => sliceRequests(page).then(requests => requests.some(request => request.bandsPerOctave === 3))).toBe(true);
    await expect(legend.locator('.spectrum-axis-legend-reference')).toHaveText(/^Amplitude, uncalibrated \[dB/);
    expect((await overlayTexts()).some(text => text.startsWith('Band level'))).toBe(false);
});

test('the cursor spectrum\'s legend leaves with its lines: with every track taken off, none is named', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathManyTracksHtml(2), { waitUntil: 'domcontentloaded' });
    await hoverOverlayAt(page, 0.5);
    const legend = page.locator('#spectrum-axis-legend');
    await expect(legend).toBeVisible();
    // Every track taken off: no line is drawn, the panel says there is no data.
    await page.evaluate(() => window.postMessage({
        type: 'comparison-panel-test-action', actionId: 'take-off',
        actions: [{ action: 'remove-track', trackIndex: 1 }, { action: 'remove-track', trackIndex: 0 }],
    }, '*'));
    await expect(page.locator('.track-row')).toHaveCount(0);
    await expect(page.locator('#spectrum-overlay-canvas')).toBeVisible();
    await expect(legend).toBeHidden();
});
