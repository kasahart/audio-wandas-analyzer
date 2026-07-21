import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml } from './buildHtml';

const FULL_SCALE_AMPLITUDE = 0.4;

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

test('zoomed waveform uses range cache only while it fully covers the view', async ({ page }) => {
    await loadUi(page);
    await forceOverviewWaveformScale(page, FULL_SCALE_AMPLITUDE);

    await page.evaluate(() => {
        const win = window as unknown as {
            renderWaveformPipeline: (...args: unknown[]) => void;
            __uiSmokeWaveformCalls: Array<{
                dataStart?: number;
                dataEnd?: number;
                ySpan: number;
            }>;
        };
        const original = win.renderWaveformPipeline;
        win.__uiSmokeWaveformCalls = [];
        win.renderWaveformPipeline = (...args: unknown[]) => {
            const ctx = args[0] as CanvasRenderingContext2D;
            const params = args[4] as { dataStart?: number; dataEnd?: number };
            const originalMoveTo = ctx.moveTo.bind(ctx);
            const originalLineTo = ctx.lineTo.bind(ctx);
            const yValues: number[] = [];
            ctx.moveTo = (x: number, y: number) => {
                if (Number.isFinite(y)) { yValues.push(y); }
                return originalMoveTo(x, y);
            };
            ctx.lineTo = (x: number, y: number) => {
                if (Number.isFinite(y)) { yValues.push(y); }
                return originalLineTo(x, y);
            };
            try {
                original(...args);
            } finally {
                ctx.moveTo = originalMoveTo;
                ctx.lineTo = originalLineTo;
            }
            win.__uiSmokeWaveformCalls.push({
                dataStart: params.dataStart,
                dataEnd: params.dataEnd,
                ySpan: yValues.length > 0 ? Math.max(...yValues) - Math.min(...yValues) : 0,
            });
        };
    });

    const toolbar = page.locator('#toolbar');
    for (let i = 0; i < 5; i += 1) {
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

    const waveform = buildRangeWaveform(512, request.startNorm, request.endNorm, FULL_SCALE_AMPLITUDE);

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

    await expect.poll(async () => page.evaluate(() => {
        const win = window as unknown as {
            __uiSmokeWaveformCalls: Array<{ dataStart?: number; dataEnd?: number; ySpan: number }>;
        };
        for (let i = win.__uiSmokeWaveformCalls.length - 1; i >= 0; i -= 1) {
            const call = win.__uiSmokeWaveformCalls[i];
            if (call.dataStart !== 0 || call.dataEnd !== 1) {
                return call.ySpan;
            }
        }
        return 0;
    })).toBeGreaterThan(20);
    await expect.poll(async () => page.evaluate(() => {
        const win = window as unknown as {
            __uiSmokeWaveformCalls: Array<{ dataStart?: number; dataEnd?: number; ySpan: number }>;
        };
        return win.__uiSmokeWaveformCalls.filter((call) => call.dataStart !== 0 || call.dataEnd !== 1).at(-1)?.ySpan ?? 0;
    })).toBeLessThan(80);

    await page.evaluate(() => {
        const win = window as unknown as {
            __uiSmokeWaveformCalls: Array<{ dataStart?: number; dataEnd?: number; ySpan: number }>;
        };
        win.__uiSmokeWaveformCalls = [];
    });
    await page.locator('#tracks-wrapper').dispatchEvent('wheel', {
        deltaY: 100,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
    });

    await expect.poll(async () => page.evaluate(() => {
        const win = window as unknown as {
            __uiSmokeWaveformCalls: Array<{ dataStart?: number; dataEnd?: number; ySpan: number }>;
        };
        const last = win.__uiSmokeWaveformCalls.at(-1);
        if (!last) { return 'none'; }
        return last.dataStart === 0 && last.dataEnd === 1 ? 'overview' : 'range';
    })).toBe('overview');
});
