import { expect, test } from '@playwright/test';
import { buildUiSmokeHtml } from './buildHtml';

function dispatchAnalysisUpdate(paths: string[]): void {
    const results = paths.map((filePath, index) => ({
        filePath,
        fileName: filePath.split('/').at(-1) ?? filePath,
        audioSource: '',
        sampleRateHz: 8000,
        durationSeconds: 2,
        channelCount: 1,
        sampleCount: 16000,
        channels: [{
            label: 'L',
            peakAbsolute: 0.8 + index * 0.01,
            waveform: {
                min: [-0.2, -0.4],
                max: [0.2, 0.4],
                minT: [0.1, 0.6],
                maxT: [0.4, 0.9],
                absolutePeak: 0.8,
            },
        }],
    }));
    window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'analysis-update', results },
    }));
}

async function trackIdsInDom(page: import('@playwright/test').Page): Promise<string[]> {
    return page.locator('.track-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-track-id') ?? ''));
}

test('track identity survives add, reorder, remove, and analysis replacement', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    await page.evaluate(dispatchAnalysisUpdate, ['/preview/demo-tone.wav', '/preview/second.wav']);
    await expect(page.locator('.track-row')).toHaveCount(2);
    await expect.poll(() => trackIdsInDom(page)).toEqual(['track-1', 'track-2']);

    await page.locator('[data-track-id="track-2"].track-drag-handle')
        .dragTo(page.locator('[data-track-id="track-1"].track-row'));
    await expect.poll(() => trackIdsInDom(page)).toEqual(['track-2', 'track-1']);

    await page.locator('[data-action="remove-track"][data-track-id="track-1"]').click();
    await expect.poll(() => trackIdsInDom(page)).toEqual(['track-2']);

    await page.evaluate(dispatchAnalysisUpdate, ['/preview/second.wav', '/preview/third.wav']);
    await expect(page.locator('.track-row')).toHaveCount(2);
    await expect.poll(() => trackIdsInDom(page)).toEqual(['track-2', 'track-3']);
    await expect(page.locator('.track-row[data-track-id="track-2"] .track-name')).toHaveText('second.wav');
    await expect(page.locator('.track-row[data-track-id="track-3"] .track-name')).toHaveText('third.wav');
    await expect(page.locator('[data-track-index]')).toHaveCount(0);
});
