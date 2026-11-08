/**
 * R3 on the track spectrogram: a lane zoomed past the whole file's columns asks the host for the window it shows,
 * and draws and reads that window's frames instead of the whole file's columns stretched. Zoomed back out, it draws
 * the whole file's again.
 */
import { expect, test } from './canvasAudit';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';

type Posted = Array<Record<string, unknown>>;

// The preview file: 2 s at 8 kHz. With a 64-sample hop that is 250 frames, sent for the whole file as 20 columns.
const HOP = 64, SAMPLE_RATE = 8000, DURATION = 2, COLUMNS = 20;

test('a zoomed spectrogram lane asks for its window again and draws it from that window\'s frames, not the whole file\'s stretched (R3)', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // The host answers each spectrogram request with the frames of what it asks for: the whole file, or a window.
    await page.evaluate(({ hop, sampleRate, duration, columns }) => {
        const answered = new Set<unknown>();
        const answer = () => {
            const posted = (window as unknown as { __uiSmokePostedMessages: Posted }).__uiSmokePostedMessages;
            posted.forEach((request) => {
                if (request.type !== 'request-track-detail' || answered.has(request.requestId)) return;
                answered.add(request.requestId);
                const start = typeof request.startNorm === 'number' ? request.startNorm : 0;
                const end = typeof request.endNorm === 'number' ? request.endNorm : 1;
                const frames = Math.round((end - start) * duration * sampleRate / hop);
                const count = Math.min(columns, frames);
                const step = (end - start) * duration / count;
                const spectrogram = {
                    values: Array.from({ length: count }, (_, k) => Array.from({ length: 8 }, () => -80 + 40 * ((k % 2)))),
                    timeBins: count, frequencyBins: 8, windowSize: 256, hopSize: hop, maxFrequencyHz: 4000, minDb: -100, maxDb: 0,
                    timeCentersSec: Array.from({ length: count }, (_, k) => start * duration + (k + 0.5) * step),
                };
                window.postMessage({
                    type: 'track-detail-result', requestId: request.requestId, analysisId: request.analysisId,
                    settingsSignature: request.settingsSignature, trackIndex: request.trackIndex, filePath: request.filePath,
                    channels: [{ spectrogram }, { spectrogram }],
                    ...(typeof request.startNorm === 'number' ? { startNorm: request.startNorm, endNorm: request.endNorm } : {}),
                }, '*');
            });
        };
        window.setInterval(answer, 20);
    }, { hop: HOP, sampleRate: SAMPLE_RATE, duration: DURATION, columns: COLUMNS });
    const lane = page.locator('#track-spec-canvas-0');
    await expect(lane).toHaveAttribute('data-spectrogram-window', '0 1');
    const windowRequests = () => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted }).__uiSmokePostedMessages
        .filter((message) => message.type === 'request-track-detail' && typeof message.startNorm === 'number')
        .map((message) => [message.startNorm as number, message.endNorm as number]));
    // Not zoomed, the whole file's columns serve: nothing more is asked.
    expect(await windowRequests()).toEqual([]);
    const box = await lane.boundingBox();
    if (!box) throw new Error('spectrogram lane has no layout box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    for (let k = 0; k < 4; k++) await page.mouse.wheel(0, -480);
    await page.keyboard.up('Control');
    // Zoomed in: the lane asks for a window covering what it shows, and draws from it once it lands.
    await expect.poll(async () => (await windowRequests()).length).toBeGreaterThan(0);
    const view = await lane.getAttribute('data-plot-window');
    const [viewStart, viewEnd] = (view ?? '').split(' ').map(Number);
    // The wheel steps can ask more than once (the asks are throttled): wait until the lane draws the last window asked.
    await expect.poll(async () => {
        const asked = await windowRequests();
        const last = asked[asked.length - 1];
        const drawn = (await lane.getAttribute('data-spectrogram-window')) ?? '';
        return Boolean(last) && drawn === `${last[0]} ${last[1]}`;
    }, { message: 'the lane draws the last window it asked for' }).toBe(true);
    const [drawnStart, drawnEnd] = ((await lane.getAttribute('data-spectrogram-window')) ?? '').split(' ').map(Number);
    expect(drawnStart).toBeLessThanOrEqual(viewStart + 1e-3);
    expect(drawnEnd).toBeGreaterThanOrEqual(viewEnd - 1e-3);
    expect(drawnEnd - drawnStart).toBeLessThan(1);
    // The pointer on the zoomed lane still reads a cell: the one drawn, from the window's frames.
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await expect(page.locator('#plot-readout:not([hidden])')).toHaveCount(1);
    // Double-click resets the zoom: the whole file's columns are drawn again, and no window is asked for.
    const asked = (await windowRequests()).length;
    await lane.dblclick();
    await expect(lane).toHaveAttribute('data-spectrogram-window', '0 1');
    expect((await windowRequests()).length).toBe(asked);
});
