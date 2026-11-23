import { expect, test, type Page } from './canvasAudit';
import { buildExtensionHostPathManyTracksHtml, buildExtensionHostPathUiSmokeHtml, buildUiSmokeHtml } from './buildHtml';
import { drawnRow, laneOf, pointOnLane, rowFigure, ROW_SPECTROGRAM, ROW_WAVE, seenFigure } from './tracksFigures';



/**
 * Counts the band's pixels (its curve: a light blue-grey, unlike the white cursor, the grey of a track without a role
 * and the roles' hues) per column of one lane of the first row, on the layer over the row's Figure (what follows the cursor).
 */
async function bandColumns(page: Page, lane: string): Promise<number[]> {
    const frame = laneOf(await seenFigure(page, rowFigure(0)), lane).frame;
    return page.evaluate((frame) => {
        const canvas = document.querySelector('#track-row-figure-0 canvas.track-row-layer') as HTMLCanvasElement;
        const ratio = window.devicePixelRatio || 1;
        const width = Math.round(frame.width * ratio), height = Math.round(frame.height * ratio);
        const data = canvas.getContext('2d')!.getImageData(Math.round(frame.left * ratio), Math.round(frame.top * ratio), width, height).data;
        const columns = new Array<number>(width).fill(0);
        for (let i = 0; i < data.length; i += 4) {
            const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
            if (r > 150 && b - r >= 8 && g > r) {
                columns[(i / 4) % width] += 1;
            }
        }
        return columns;
    }, frame);
}

test('analysis window band follows the cursor on the waveform only and the header names it', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann −?\d+\.\d{3}–\d+\.\d{3} s \(\d+(\.\d+)? ms\)/);

    await drawnRow(page, 0, 0, true);
    const at = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.5);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator('#spectrum-cursor-time')).not.toHaveText(/@ 0:00\.00/);
    await expect.poll(async () => {
        const columns = await bandColumns(page, ROW_WAVE);
        const lit = columns.flatMap((count, x) => (count > 0 ? [x] : []));
        const middle = columns.length / 2;
        return lit.length > 0 && Math.min(...lit) < middle && Math.max(...lit) > middle && lit.every((x) => Math.abs(x - middle) < columns.length / 4);
    }).toBe(true);
});

test('the spectrogram lane does not repeat the analysis window band', async ({ page }) => {
    // A page whose recording has spectrogram cells: the row is both lanes.
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann/);
    await drawnRow(page);
    await expect.poll(async () => (await bandColumns(page, ROW_WAVE)).some((count) => count > 0)).toBe(true);
    expect((await bandColumns(page, ROW_SPECTROGRAM)).every((count) => count === 0)).toBe(true);
});

/** Records, every frame, where the layer over each row last drew the analysis window band (twentieths of its waveform's width; null for none). Returns the rows' boxes. */
async function recordBandFrames(page: Page): Promise<string[]> {
    // Every row's waveform is as wide as the first's, beside the rows' axis column.
    const wave = laneOf(await drawnRow(page, 0, 0, true), ROW_WAVE).frame;
    const canvasIds = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.track-row-figure')].map((row) => row.id));
    await page.evaluate(({ ids, wave }) => {
        const rowOf = (canvas: HTMLCanvasElement): string => (canvas.classList.contains('track-row-layer') ? canvas.parentElement?.id ?? '' : '');
        const ratio = window.devicePixelRatio || 1;
        // The band is told apart by how it is drawn, not by its pixels.
        const shown: Record<string, number | null> = {};
        const proto = CanvasRenderingContext2D.prototype;
        const { clearRect, fillRect } = Object.getOwnPropertyDescriptors(proto);
        proto.clearRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
            const row = rowOf(this.canvas);
            if (row && w >= this.canvas.width && h >= this.canvas.height) shown[row] = null;
            (clearRect.value as CanvasRenderingContext2D['clearRect']).call(this, x, y, w, h);
        };
        proto.fillRect = function (this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
            const style = typeof this.fillStyle === 'string' ? this.fillStyle.replace(/\s/gu, '') : '';
            const row = rowOf(this.canvas);
            // Drawn in the waveform's own pixels (canvasOverlays.paintOverPlots).
            if (row && style.startsWith('rgba(201,209,217')) {
                shown[row] = Math.round((x + w / 2) / (wave.width * ratio) * 20);
            }
            (fillRect.value as CanvasRenderingContext2D['fillRect']).call(this, x, y, w, h);
        };
        const frames: Array<Array<number | null>> = [];
        (window as unknown as { __bandFrames: typeof frames }).__bandFrames = frames;
        const tick = () => { frames.push(ids.map((id) => shown[id] ?? null)); requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
    }, { ids: canvasIds, wave });
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
    const at = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.75);
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => {
        const frames = await bandFrames(page);
        return frames.length > 0 && frames[frames.length - 1].every((x) => x === 15);
    }, { timeout: 5000 }).toBe(true);
    expect(mixedFrames(await bandFrames(page))).toEqual([]);
});

test('after a pause every channel of every track shows its band at the paused cursor together', async ({ page }) => {
    // The fixture's audio is 2 s long: on a machine too busy to press pause within it, playback ends first and no
    // band is left to compare (the test then fails on its wait, not on the product). It passes run by itself.
    await page.setContent(buildExtensionHostPathManyTracksHtml(3, 120), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann/);
    await page.evaluate(() => document.querySelectorAll<HTMLAudioElement>('audio').forEach((audio) => { audio.muted = true; }));
    await recordBandFrames(page);
    const at = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.1);
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await bandFrames(page)).at(-1)?.every((x) => x === 2) ?? false, { timeout: 5000 }).toBe(true);

    const play = page.locator('[data-action="toggle-playback"]').first();
    await play.click();
    await expect.poll(() => page.evaluate(() => (document.getElementById('track-audio-0') as HTMLAudioElement).currentTime), { timeout: 15000, intervals: [50] }).toBeGreaterThan(0.6);
    await play.click();
    await expect.poll(async () => {
        const last = (await bandFrames(page)).at(-1) ?? [];
        return last.length > 0 && last.every((x) => x !== null && x > 2 && x === last[0]);
    }, { timeout: 5000 }).toBe(true);
    expect(mixedFrames(await bandFrames(page))).toEqual([]);
});

test('while playing, every picture of the cursor spectrum has the lines of every recording at one time', async ({ page }) => {
    // Each recording's answers take a while and are asked for one at a time. A picture made as each arrives would
    // hold three recordings at three times: the lines compared would not be of one moment.
    await page.setContent(buildExtensionHostPathManyTracksHtml(3, 60), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-cursor-time')).toHaveText(/(window|解析窓) hann/);
    await page.evaluate(() => document.querySelectorAll<HTMLAudioElement>('audio').forEach((audio) => { audio.muted = true; }));
    const play = page.locator('[data-action="toggle-playback"]').first();
    // The page's audio is ready to play before the click (a busy machine loads it late; a click before that plays nothing).
    await expect.poll(() => page.evaluate(() => (document.getElementById('track-audio-0') as HTMLAudioElement).readyState), { timeout: 15000 }).toBeGreaterThanOrEqual(2);
    type Draw = { type?: string; command?: string; payload?: { spec?: { lanes: Array<{ lines: Array<{ of: { key: string } }> }> } } };
    // A stand-in key: cursor | file | channel | the time asked at | ….
    const times = async (): Promise<string[][]> => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Draw[] }).__uiSmokePostedMessages
        .filter(message => message.type === 'figure-request' && message.command === 'figure-draw')
        .map(message => (message.payload?.spec?.lanes ?? []).flatMap(lane => lane.lines.map(line => line.of.key)).filter(key => key.startsWith('cursor|')))))
        .filter(keys => keys.length > 0).map(keys => [...new Set(keys.map(key => key.split('|')[3]))]);
    const playing = (): Promise<boolean> => page.evaluate(() => !(document.getElementById('track-audio-0') as HTMLAudioElement).paused);
    await play.click();
    // Played until enough pictures were drawn, however slow the machine is (how many a second is no rule of the page's):
    // the audio is 2 s long and stops at its end, so it is started again where it has stopped.
    await expect.poll(async () => {
        if (!await playing()) await play.click();
        return (await times()).filter(of => of.length === 1).length;
    }, { timeout: 20_000, intervals: [250], message: 'pictures drawn while playing' }).toBeGreaterThan(3);
    if (await playing()) await play.click();
    expect((await times()).filter(of => of.length > 1), 'pictures whose lines are of more than one time').toEqual([]);
});
