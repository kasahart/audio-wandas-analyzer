import { expect, test, type Page } from './canvasAudit';
import { buildExtensionHostPathManyTracksHtml, buildExtensionHostPathUiSmokeHtml } from './buildHtml';

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

test('one cursor click moves every track\'s analysis window band in the same frame', async ({ page }) => {
    // Where each waveform canvas last drew the band (twentieths of its width), or none since it was last cleared:
    // the tracks' own colours can be amber too, so the band is told apart by how it is drawn, not by its pixels.
    const trackBands = () => {
        const shown: Record<string, number | null> = {};
        (window as unknown as { __bandShown: typeof shown }).__bandShown = shown;
        const proto = CanvasRenderingContext2D.prototype;
        const { clearRect, fillRect } = Object.getOwnPropertyDescriptors(proto);
        proto.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
            if (this.canvas.id && w >= this.canvas.width && h >= this.canvas.height) shown[this.canvas.id] = null;
            (clearRect.value as CanvasRenderingContext2D['clearRect']).call(this, x, y, w, h);
        };
        proto.fillRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
            const style = typeof this.fillStyle === 'string' ? this.fillStyle.replace(/\s/gu, '') : '';
            if (this.canvas.id && style.startsWith('rgba(255,190,70')) {
                shown[this.canvas.id] = Math.round((x + w / 2) / this.canvas.width * 20);
            }
            (fillRect.value as CanvasRenderingContext2D['fillRect']).call(this, x, y, w, h);
        };
    };
    // Each slice answer takes a while and they are asked for one at a time: without the hold they land track by track.
    await page.setContent(buildExtensionHostPathManyTracksHtml(3, 120), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann/);
    const canvasIds = await page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>('canvas.track-canvas')]
        .map((canvas) => canvas.id).filter((id) => /^track-canvas-\d+(-\d+)?$/u.test(id)));
    expect(canvasIds.length).toBe(6);
    await page.evaluate(trackBands);
    await page.evaluate((ids) => {
        const shown = (window as unknown as { __bandShown: Record<string, number | null> }).__bandShown;
        const frames: Array<Array<number | null>> = [];
        (window as unknown as { __bandFrames: typeof frames }).__bandFrames = frames;
        const tick = () => { frames.push(ids.map((id) => shown[id] ?? null)); requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
    }, canvasIds);
    const box = (await page.locator('#' + canvasIds[0]).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    await expect.poll(() => page.evaluate(() => {
        const frames = (window as unknown as { __bandFrames: Array<Array<number | null>> }).__bandFrames;
        return frames.length > 0 && frames[frames.length - 1].every((x) => x === 15);
    }), { timeout: 5000 }).toBe(true);
    const frames = await page.evaluate(() => (window as unknown as { __bandFrames: Array<Array<number | null>> }).__bandFrames);
    // No frame shows one track's band already at the click while another's still sits elsewhere (or is gone).
    const mixed = frames.filter((frame) => frame.some((x) => x === 15) && frame.some((x) => x !== 15));
    expect(mixed).toEqual([]);
});
