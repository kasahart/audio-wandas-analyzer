import { expect, test, type Page } from './canvasAudit';
import { buildUiSmokeHtml } from './buildHtml';

const PCM_SCALE = 13106;

async function loadUi(page: Page) {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.mouse.click(20, 20);
}

async function forceOverviewWaveformScale(page: Page, scale: number) {
    await page.evaluate((targetScale) => {
        const state = eval('__APP_STATE__') as {
            results: Array<{ channels: Array<{ waveform: { min: number[]; max: number[]; absolutePeak: number } }> }>;
        };
        const waveform = state.results[0].channels[0].waveform;
        const ratio = targetScale / waveform.absolutePeak;
        waveform.min = waveform.min.map((value) => value * ratio);
        waveform.max = waveform.max.map((value) => value * ratio);
        waveform.absolutePeak = targetScale;
    }, scale);
}

function buildRangeWaveform(pointCount: number, startNorm: number, endNorm: number, scale: number) {
    const min: number[] = [];
    const max: number[] = [];
    const minT: number[] = [];
    const maxT: number[] = [];
    const samples: number[] = [];

    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const center = startNorm + ((pointIndex + 0.5) / pointCount) * (endNorm - startNorm);
        const amp = 0.35 + 0.3 * Math.abs(Math.sin(pointIndex * 0.65));
        min.push(-amp * scale);
        max.push(amp * scale);
        minT.push(center);
        maxT.push(center);
        samples.push(0);
    }

    return { min, max, minT, maxT, samples, absolutePeak: 0.65 * scale };
}

test('zoomed waveform keeps the prefetched range while panning and drops to the overview only past it', async ({ page }) => {
    await loadUi(page);
    await forceOverviewWaveformScale(page, PCM_SCALE);

    // The lane says what it drew from (the overview, a fetched range, or that range over the overview around it)
    // and how tall its line is on screen.
    const lane = page.locator('#track-canvas-0');
    const drawnFrom = async () => (await lane.getAttribute('data-waveform-source')) ?? 'none';

    const toolbar = page.locator('#toolbar');
    for (let i = 0; i < 9; i += 1) { // deep enough that the prefetched range is narrower than the file
        await toolbar.locator('[data-action="zoom-in"]').click({ force: true });
    }

    await expect.poll(async () => page.evaluate(() => {
        const smokeWindow = window as unknown as { __uiSmokePostedMessages: unknown[] };
        return smokeWindow.__uiSmokePostedMessages.some((message: unknown) => {
            return !!message
                && typeof message === 'object'
                && (message as { type?: string }).type === 'request-waveform-range'
                && ((message as { endNorm?: number }).endNorm ?? 1) - ((message as { startNorm?: number }).startNorm ?? 0) < 1;
        });
    })).toBe(true);

    const request = await page.evaluate(() => {
        const smokeWindow = window as unknown as { __uiSmokePostedMessages: unknown[] };
        for (let i = smokeWindow.__uiSmokePostedMessages.length - 1; i >= 0; i -= 1) {
            const message = smokeWindow.__uiSmokePostedMessages[i];
            if (!!message
                && typeof message === 'object'
                && (message as { type?: string }).type === 'request-waveform-range'
                && ((message as { endNorm?: number }).endNorm ?? 1) - ((message as { startNorm?: number }).startNorm ?? 0) < 1) {
                return message as {
                    requestId: string;
                    trackIndex: number;
                    startNorm: number;
                    endNorm: number;
                };
            }
        }
        throw new Error('zoomed request-waveform-range was not posted');
    });

    const waveform = buildRangeWaveform(512, request.startNorm, request.endNorm, PCM_SCALE);

    await page.evaluate(({ rangeRequest, rangeWaveform }) => {
        window.postMessage({
            type: 'waveform-range-result',
            requestId: rangeRequest.requestId,
            trackIndex: rangeRequest.trackIndex,
            startNorm: rangeRequest.startNorm,
            endNorm: rangeRequest.endNorm,
            channels: [rangeWaveform],
        }, '*');
    }, { rangeRequest: request, rangeWaveform: waveform });

    // The fetched range is drawn at the overview's scale: its line fills the lane as the overview's did.
    await expect.poll(drawnFrom).toBe('range');
    expect(Number(await lane.getAttribute('data-waveform-height'))).toBeGreaterThan(20);

    const panScreens = async (steps: number) => {
        for (let i = 0; i < steps; i += 1) {
            await page.locator('#tracks-wrapper').dispatchEvent('wheel', {
                deltaY: 100,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            });
        }
    };
    // Shift+wheel pans 10 % of the view: the range already holds two screens either side, so the lines stay fine (#502).
    await panScreens(1);
    await expect.poll(drawnFrom).toBe('range');
    // Past the fetched range the overview fills the rest of the view while the part still fetched keeps its detail,
    // and only once the view has left that range entirely is the overview all there is (until the next range lands).
    const seen: string[] = [];
    for (let step = 0; step < 200 && !seen.includes('overview'); step += 1) {
        await panScreens(1);
        await nextFrame(page);
        const frame = await drawnFrom();
        if (seen.at(-1) !== frame) seen.push(frame);
    }
    expect(seen).toEqual(['range', 'layered', 'overview']);
});

function nextFrame(page: Page): Promise<void> {
    return page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
