import { expect, test, type Page } from './canvasAudit';
import { buildExtensionHostPathManyTracksHtml, buildExtensionHostPathUiSmokeHtml } from './buildHtml';
import { CURSOR_FIGURE, drawnFigure, hoverLane, laneOf, seenFigure } from './tracksFigures';

interface PostedSliceRequest {
    type: string;
    bandsPerOctave?: number;
}

function sliceRequests(page: Page): Promise<PostedSliceRequest[]> {
    return page.evaluate(() => ((window as typeof window & { __uiSmokePostedMessages: PostedSliceRequest[] }).__uiSmokePostedMessages)
        .filter(message => message && message.type === 'request-spectrum-slice'));
}

/** Points at a place across the cursor spectrum's plot (a fraction of its lane), once its picture is drawn. */
async function hoverOverlayAt(page: Page, fraction: number): Promise<void> {
    await drawnFigure(page);
    await hoverLane(page, CURSOR_FIGURE, undefined, fraction);
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

    // The bands are drawn on a log axis: the middle of a 22 Hz - 22 kHz one is about 708 Hz, nearest to the 630 Hz band.
    await expect.poll(async () => (await seenFigure(page)).lanes[0]?.xLog).toBe(true);
    await hoverOverlayAt(page, 0.5);
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/630 Hz/);
    await hoverOverlayAt(page, 0.99);
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/20 kHz/);

    await page.locator('[data-action="spectrum-fft"]').click();
    await expect.poll(async () => {
        const requests = await sliceRequests(page);
        return requests.length > 0 && requests[requests.length - 1].bandsPerOctave === undefined;
    }).toBe(true);
    // The middle of the 0–4 kHz axis is a bin beside 2 kHz (every bin of the FFT is kept, 0.98 Hz apart).
    await expect.poll(async () => (await seenFigure(page)).lanes[0]?.xLog).toBe(false);
    await hoverOverlayAt(page, 0.5);
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/(1\.99\d*|2(\.0\d*)?) kHz/);
});

test('the cursor spectrum names its level axis as Compare does, uncalibrated, and its lines in a legend', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await sliceRequests(page)).length).toBeGreaterThan(0);
    // The axis is named by the picture (the figure service's words for the lines' level), with the files uncalibrated.
    const levelName = async (): Promise<string> => laneOf(await drawnFigure(page)).axisNames.y;
    expect(await levelName()).toMatch(/^Level, uncalibrated \[dB/);
    // The legend names the lines, each by its track's colour.
    const legend = page.locator('#spectrum-axis-legend');
    await expect(legend).toBeVisible();
    await expect(legend.locator('.spectrum-axis-legend-label').first()).not.toBeEmpty();
    // 1/3 octave bands are named the same way, not "Band level".
    await page.locator('[data-action="spectrum-octave-3"]').click();
    await expect.poll(() => sliceRequests(page).then(requests => requests.some(request => request.bandsPerOctave === 3))).toBe(true);
    await expect.poll(async () => (await seenFigure(page)).lanes[0]?.xLog).toBe(true);
    expect(await levelName()).toMatch(/^Level, uncalibrated \[dB/);
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
    await expect(page.locator('#spectrum-overlay-empty')).toBeVisible();
    await expect(legend).toBeHidden();
});
