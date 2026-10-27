import { expect, test, type Page } from '@playwright/test';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';

/** Counts amber band pixels (the analysis-window fill and curve) per canvas column. */
async function amberColumns(page: Page, canvasId: string): Promise<number[]> {
    return page.evaluate((id) => {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        const columns = new Array<number>(canvas.width).fill(0);
        for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            if (r > 60 && r > b * 1.6 && g > b * 1.2 && r >= g) {
                columns[(i / 4) % canvas.width] += 1;
            }
        }
        return columns;
    }, canvasId);
}

test('analysis window band follows the cursor on the waveform only and the header names it', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann -?\d+\.\d{3}–\d+\.\d{3} s \(\d+(\.\d+)? ms\)/);

    const canvas = page.locator('#track-canvas-0');
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#spectrum-cursor-time')).not.toHaveText(/@ 0:00\.00/);
    await expect.poll(async () => {
        const columns = await amberColumns(page, 'track-canvas-0');
        const lit = columns.flatMap((count, x) => (count > 0 ? [x] : []));
        const middle = columns.length / 2;
        return lit.length > 0 && Math.min(...lit) < middle && Math.max(...lit) > middle && lit.every((x) => Math.abs(x - middle) < columns.length / 4);
    }).toBe(true);
});

test('the spectrogram lane does not repeat the analysis window band', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann/);
    // Answer the lazy spectrogram request so the spectrogram lane and its overlay are drawn.
    await expect.poll(() => page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        const request = posted.find((message) => message.type === 'request-track-detail' && message.trackIndex === 0);
        if (!request) {
            return false;
        }
        const spectrogram = {
            values: Array.from({ length: 8 }, () => Array.from({ length: 4 }, () => -60)),
            timeBins: 8, frequencyBins: 4, windowSize: 512, hopSize: 256, maxFrequencyHz: 4000, minDb: -100, maxDb: 0,
            timeCentersSec: Array.from({ length: 8 }, (_, k) => -0.05 + k * 0.15),
        };
        window.postMessage({
            type: 'track-detail-result', requestId: request.requestId, analysisId: request.analysisId,
            settingsSignature: request.settingsSignature, trackIndex: 0, filePath: request.filePath,
            channels: [{ spectrogram }, { spectrogram }],
        }, '*');
        return true;
    })).toBe(true);
    await expect.poll(async () => (await amberColumns(page, 'track-canvas-0')).some((count) => count > 0)).toBe(true);
    // The raster fills the plot once the spectrogram arrives; before that only a loading message is drawn.
    await expect.poll(() => page.evaluate(() => {
        const canvas = document.getElementById('track-spec-canvas-0') as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = 0;
        for (let i = 3; i < data.length; i += 4) {
            opaque += data[i] > 0 ? 1 : 0;
        }
        return opaque > (canvas.width * canvas.height) / 2;
    })).toBe(true);
    expect((await amberColumns(page, 'track-spectrogram-overlay-0')).every((count) => count === 0)).toBe(true);
});
