import { expect, test, type Page } from './canvasAudit';
import { buildExtensionHostPathManyTracksHtml, buildExtensionHostPathUiSmokeHtml } from './buildHtml';

/** Counts the band's pixels (its curve: a light blue-grey, unlike the white cursor, the grey of a track without a role and the roles' hues) per canvas column. */
async function bandColumns(page: Page, canvasId: string): Promise<number[]> {
    return page.evaluate((id) => {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        const columns = new Array<number>(canvas.width).fill(0);
        for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            if (r > 150 && b - r >= 8 && g > r) {
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
        const columns = await bandColumns(page, 'track-waveform-overlay-0');
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
    await expect.poll(async () => (await bandColumns(page, 'track-waveform-overlay-0')).some((count) => count > 0)).toBe(true);
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
    expect((await bandColumns(page, 'track-spectrogram-overlay-0')).every((count) => count === 0)).toBe(true);
});

/** Records, every frame, where the layer over each track waveform last drew the analysis window band (twentieths of its width; null for none). */
async function recordBandFrames(page: Page): Promise<string[]> {
    const canvasIds = await page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>('canvas.track-waveform-overlay')].map((canvas) => canvas.id));
    await page.evaluate((ids) => {
        // The band is told apart by how it is drawn, not by its pixels.
        const shown: Record<string, number | null> = {};
        const proto = CanvasRenderingContext2D.prototype;
        const { clearRect, fillRect } = Object.getOwnPropertyDescriptors(proto);
        proto.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
            if (this.canvas.id && w >= this.canvas.width && h >= this.canvas.height) shown[this.canvas.id] = null;
            (clearRect.value as CanvasRenderingContext2D['clearRect']).call(this, x, y, w, h);
        };
        proto.fillRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
            const style = typeof this.fillStyle === 'string' ? this.fillStyle.replace(/\s/gu, '') : '';
            if (this.canvas.id && style.startsWith('rgba(201,209,217')) {
                shown[this.canvas.id] = Math.round((x + w / 2) / this.canvas.width * 20);
            }
            (fillRect.value as CanvasRenderingContext2D['fillRect']).call(this, x, y, w, h);
        };
        const frames: Array<Array<number | null>> = [];
        (window as unknown as { __bandFrames: typeof frames }).__bandFrames = frames;
        const tick = () => { frames.push(ids.map((id) => shown[id] ?? null)); requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
    }, canvasIds);
    return canvasIds;
}

async function bandFrames(page: Page): Promise<Array<Array<number | null>>> {
    return page.evaluate(() => (window as unknown as { __bandFrames: Array<Array<number | null>> }).__bandFrames);
}

/** Frames where some track shows a band and another shows none or one elsewhere. */
function mixedFrames(frames: Array<Array<number | null>>): Array<Array<number | null>> {
    return frames.filter((frame) => frame.some((x) => x !== null) && new Set(frame).size > 1);
}

test('one cursor click moves every track\'s analysis window band in the same frame', async ({ page }) => {
    // Each slice answer takes a while and they are asked for one at a time: without the hold they land track by track.
    await page.setContent(buildExtensionHostPathManyTracksHtml(3, 120), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann/);
    const canvasIds = await recordBandFrames(page);
    expect(canvasIds.length).toBe(6);
    const box = (await page.locator('#' + canvasIds[0]).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    await expect.poll(async () => {
        const frames = await bandFrames(page);
        return frames.length > 0 && frames[frames.length - 1].every((x) => x === 15);
    }, { timeout: 5000 }).toBe(true);
    expect(mixedFrames(await bandFrames(page))).toEqual([]);
});

test('after a pause every channel of every track shows its band at the paused cursor together', async ({ page }) => {
    await page.setContent(buildExtensionHostPathManyTracksHtml(3, 120), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann/);
    await page.evaluate(() => document.querySelectorAll<HTMLAudioElement>('audio').forEach((audio) => { audio.muted = true; }));
    const canvasIds = await recordBandFrames(page);
    const box = (await page.locator('#' + canvasIds[0]).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height / 2);
    await expect.poll(async () => (await bandFrames(page)).at(-1)?.every((x) => x === 2) ?? false, { timeout: 5000 }).toBe(true);

    const play = page.locator('[data-action="toggle-playback"]').first();
    await play.click();
    await expect.poll(() => page.evaluate(() => (document.getElementById('track-audio-0') as HTMLAudioElement).currentTime)).toBeGreaterThan(0.6);
    await play.click();
    await expect.poll(async () => {
        const last = (await bandFrames(page)).at(-1) ?? [];
        return last.length > 0 && last.every((x) => x !== null && x > 2 && x === last[0]);
    }, { timeout: 5000 }).toBe(true);
    expect(mixedFrames(await bandFrames(page))).toEqual([]);
});
