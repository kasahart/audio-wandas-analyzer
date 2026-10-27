import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeManyTracksHtml } from './buildHtml';

/** The track indexes whose spectrogram the webview has asked the host for. */
function detailRequests(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        return [...new Set(posted.filter((message) => message.type === 'request-track-detail').map((message) => Number(message.trackIndex)))].sort((a, b) => a - b);
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
    // The host answers every request (here with an error, which also settles it).
    await page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        posted.filter((message) => message.type === 'request-track-detail').forEach((message) => {
            window.postMessage({ type: 'track-detail-error', requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath, error: 'no host' }, '*');
        });
    });
    await expect.poll(downloads).toContain('waveform-export.png');
});
