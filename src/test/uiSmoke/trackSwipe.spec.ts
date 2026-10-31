import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml } from './buildHtml';

function showTrack(): void {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
        filePath: '/preview/swipe.wav',
        fileName: 'swipe.wav',
        audioSource: '',
        sampleRateHz: 8000,
        durationSeconds: 10,
        channelCount: 1,
        sampleCount: 80000,
        channels: [{ label: 'L', peakAbsolute: 0.8, waveform: { min: [-0.2, -0.4], max: [0.2, 0.4], minT: [1, 6], maxT: [4, 9], absolutePeak: 0.8 } }],
    }] } }));
}

async function view(page: Page): Promise<{ zoomStart: number; zoomEnd: number }> {
    return page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'swipe-snapshot', actions: [] } }));
        const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { zoomStart: number; zoomEnd: number } }> }).__uiSmokePostedMessages;
        return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi;
    });
}

test('a sideways trackpad swipe on a lane pans the timeline with the fingers; a vertical one leaves it', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(showTrack);
    await expect(page.locator('.track-row')).toHaveCount(1);
    for (let i = 0; i < 3; i += 1) await page.locator('#toolbar [data-action="zoom-in"]').click();
    const zoomed = await view(page);
    const span = zoomed.zoomEnd - zoomed.zoomStart;
    expect(span).toBeLessThan(0.5);
    const canvas = page.locator('#track-canvas-0');
    const box = (await canvas.boundingBox())!;
    const width = await canvas.evaluate(node => (node as HTMLCanvasElement).width);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Fingers to the left by 40 px: the view moves 40 px of the plot later, its span kept.
    await page.mouse.wheel(40, 2);
    await expect.poll(async () => (await view(page)).zoomStart).toBeCloseTo(zoomed.zoomStart + span * 40 / width, 6);
    const moved = await view(page);
    expect(moved.zoomEnd - moved.zoomStart).toBeCloseTo(span, 9);
    // A mostly vertical swipe (after a pause: a new swipe) scrolls the lanes, not the time.
    await page.waitForTimeout(300);
    await page.mouse.wheel(2, 40);
    expect((await view(page)).zoomStart).toBeCloseTo(moved.zoomStart, 9);
    await page.waitForTimeout(300);
    await page.mouse.wheel(-40, 0);
    await expect.poll(async () => (await view(page)).zoomStart).toBeCloseTo(zoomed.zoomStart, 6);
});
