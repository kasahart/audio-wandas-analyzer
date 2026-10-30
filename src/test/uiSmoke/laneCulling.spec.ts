import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeManyTracksHtml } from './buildHtml';

/** The track indexes whose spectrogram the webview has asked the host for. */
function detailRequests(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        return [...new Set(posted.filter((message) => message.type === 'request-track-detail').map((message) => Number(message.trackIndex)))].sort((a, b) => a - b);
    });
}

/** Answers each spectrogram and cursor-spectrum request not answered yet with an error, which settles it. */
function answerWithErrors(page: Page): Promise<void> {
    return page.evaluate(() => {
        const answered = ((window as unknown as { __answered?: Set<unknown> }).__answered ??= new Set());
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        posted.forEach((message) => {
            const type = message.type === 'request-track-detail' ? 'track-detail-error' : message.type === 'request-spectrum-slice' ? 'spectrum-slice-error' : null;
            if (!type || answered.has(message.requestId)) return;
            answered.add(message.requestId);
            window.postMessage({ type, requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath, error: 'no host' }, '*');
        });
    });
}

test('only the lanes near the track view are drawn and ask for their spectrogram; the rest do when scrolled to', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(40);
    await expect.poll(async () => (await detailRequests(page)).length).toBeGreaterThan(0);
    const first = await detailRequests(page);
    expect(first).toContain(0);
    expect(first).not.toContain(39);
    await page.locator('#tracks-wrapper').evaluate((wrapper) => { wrapper.scrollTop = wrapper.scrollHeight; });
    await expect.poll(async () => (await detailRequests(page)).includes(39)).toBe(true);
});

test('the PNG export draws every lane: it asks for the spectrograms of lanes out of view and is saved once they are answered', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(40);
    await expect.poll(async () => (await detailRequests(page)).length).toBeGreaterThan(0);
    expect(await detailRequests(page)).not.toContain(39);
    await page.evaluate(() => document.querySelector<HTMLElement>('#toolbar [data-action="export-png"]')?.click());
    await expect.poll(async () => (await detailRequests(page)).includes(39)).toBe(true);
    const downloads = () => page.evaluate(() => (window as unknown as { __uiSmokeDownloads: Array<{ download: string }> }).__uiSmokeDownloads.map((d) => d.download));
    await page.waitForTimeout(300);
    expect(await downloads()).not.toContain('waveform-export.png');
    // The host answers every request (here with an error, which also settles it); cursor spectra are asked one at a time.
    await expect.poll(async () => {
        await answerWithErrors(page);
        return downloads();
    }, { intervals: [50], timeout: 20000 }).toContain('waveform-export.png');
});

test('a lane resized while out of view paints its spectrogram again when scrolled back', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40, true), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(40);
    const painted = () => page.locator('#track-spec-canvas-0').evaluate((canvas: HTMLCanvasElement) => {
        // The left half: the plot, not the colour bar drawn beside it on every paint.
        const data = canvas.getContext('2d')?.getImageData(0, 0, Math.floor(canvas.width / 2), canvas.height).data;
        return Boolean(data && data.some((value, index) => index % 4 === 3 && value > 0));
    });
    await expect.poll(painted).toBe(true);
    const wrapper = page.locator('#tracks-wrapper');
    await wrapper.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.waitForTimeout(300);
    await wrapper.evaluate((element) => { element.scrollTop = 0; });
    await expect.poll(painted).toBe(true);
});

/** The track indexes whose cursor spectrum the webview has asked the host for. */
function sliceRequests(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        return [...new Set(posted.filter((message) => message.type === 'request-spectrum-slice').map((message) => Number(message.trackIndex)))].sort((a, b) => a - b);
    });
}

test('with the cursor-spectrum panel folded, only lanes near the view ask for their cursor spectrum', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    // A fresh panel: the cursor-spectrum panel opens folded.
    await page.setContent(buildUiSmokeManyTracksHtml(40).replace('<script', '<script>window.__uiSmokeViewState = {};</script><script'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-section')).toHaveClass(/is-collapsed/);
    // Answer the queue for a while: it goes through every lane it wants (and asks again after an error).
    for (let round = 0; round < 80; round++) {
        await answerWithErrors(page);
        await page.waitForTimeout(50);
    }
    expect(await sliceRequests(page)).toContain(0);
    expect(await sliceRequests(page)).not.toContain(39);
    await page.locator('#tracks-wrapper').evaluate((wrapper) => { wrapper.scrollTop = wrapper.scrollHeight; });
    await expect.poll(async () => {
        await answerWithErrors(page);
        return (await sliceRequests(page)).includes(39);
    }, { intervals: [50] }).toBe(true);
});

test('with the cursor-spectrum panel open, every track asks for its cursor spectrum for the overlay', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-section')).not.toHaveClass(/is-collapsed/);
    await expect.poll(async () => {
        await answerWithErrors(page);
        return (await sliceRequests(page)).includes(39);
    }, { intervals: [50], timeout: 20000 }).toBe(true);
});
