import { expect, test, type Page } from '@playwright/test';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';

interface HostMetric {
    at: number;
    requestId: string;
    cursorNorm: number;
    channelIndex?: number;
}

interface HostMetrics {
    requests: HostMetric[];
    responses: HostMetric[];
    spectrumPaints: number[];
    inFlight: number;
    maxInFlight: number;
}

async function loadExtensionHostPath(page: Page): Promise<void> {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const metrics = (window as typeof window & { __uiSmokeHostMetrics?: HostMetrics }).__uiSmokeHostMetrics;
        return metrics !== undefined && metrics.responses.length > 0 && metrics.inFlight === 0;
    });
}

function effectiveRate(timestamps: number[]): number {
    if (timestamps.length < 2) {
        return 0;
    }
    return (timestamps.length - 1) * 1000 / (timestamps[timestamps.length - 1] - timestamps[0]);
}

test('F5-equivalent playback exercises lazy spectrum IPC at interactive rate', async ({ page }) => {
    await loadExtensionHostPath(page);
    await page.evaluate(() => {
        const testWindow = window as typeof window & { __uiSmokeHostMetrics: HostMetrics };
        const metrics = testWindow.__uiSmokeHostMetrics;
        metrics.requests.length = 0;
        metrics.responses.length = 0;
        metrics.spectrumPaints.length = 0;
        metrics.maxInFlight = 0;
        const audio = document.getElementById('track-audio-0');
        if (!(audio instanceof HTMLAudioElement)) {
            throw new Error('F5-path fixture did not render its audio element');
        }
        audio.muted = true;
        audio.loop = true;
    });

    await page.locator('[data-action="toggle-playback"][data-track-id="track-1"]').click();
    await page.waitForTimeout(3000);

    const result = await page.evaluate(() => {
        const testWindow = window as typeof window & { __uiSmokeHostMetrics: HostMetrics };
        const audio = document.getElementById('track-audio-0');
        if (audio instanceof HTMLAudioElement) {
            audio.pause();
        }
        const metrics = testWindow.__uiSmokeHostMetrics;
        return {
            requests: metrics.requests,
            responses: metrics.responses,
            spectrumPaints: metrics.spectrumPaints,
            maxInFlight: metrics.maxInFlight,
        };
    });

    const responseRate = effectiveRate(result.responses.map((entry) => entry.at));
    const cursorPositions = result.requests.map((entry) => entry.cursorNorm);
    expect(result.requests.length).toBeGreaterThan(70);
    expect(responseRate).toBeGreaterThanOrEqual(27);
    expect(result.maxInFlight).toBeLessThanOrEqual(1);
    expect(result.requests.every((entry) => entry.channelIndex === undefined)).toBe(true);
    expect(Math.max(...cursorPositions) - Math.min(...cursorPositions)).toBeGreaterThan(0.5);
    expect(result.spectrumPaints.length).toBeGreaterThan(60);
});
