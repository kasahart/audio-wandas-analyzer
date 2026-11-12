/**
 * R3 on the track spectrogram: a lane zoomed past the whole file's columns asks the host for the window it shows,
 * and draws and reads that window's frames instead of the whole file's columns stretched. Zoomed back out, it draws
 * the whole file's again.
 */
import { expect, settled, test } from './canvasAudit';
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
                // A readout's read (R7) is the page's stand-in's to answer, from the spectrogram the lane holds.
                if (request.type !== 'request-track-detail' || request.read || answered.has(request.requestId)) return;
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
        .filter((message) => message.type === 'request-track-detail' && !message.read && typeof message.startNorm === 'number')
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
    // The asks are throttled (80 ms) and a window that lands can show the view still needs a finer one, so the lane
    // may ask more than once: wait until it has stopped asking and draws the last window it asked for.
    await expect.poll(async () => {
        const before = await windowRequests();
        await settled(page);
        const asked = await windowRequests();
        const last = asked[asked.length - 1];
        const drawn = (await lane.getAttribute('data-spectrogram-window')) ?? '';
        return asked.length === before.length && Boolean(last) && drawn === `${last[0]} ${last[1]}`;
    }, { message: 'the lane stops asking and draws the last window it asked for' }).toBe(true);
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

test('a spectrogram lane boxed to a narrow band asks for that band\'s own bins and draws and reads them, not the whole range\'s rows stretched (R3)', async ({ page }) => {
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // The host answers as the backend does: 24 rows over 0–4 kHz for every frequency (n_fft 2048: 1025 bins), a
    // band's own bins (those in it and one beside each end, 3.9 Hz apart) when one is asked for. Every row is
    // −80 dB but the bin at 1 kHz, which only a band's rows hold on its own.
    await page.evaluate(({ hop, duration }) => {
        (window as unknown as { __uiSmokeTestAnswersReads: boolean }).__uiSmokeTestAnswersReads = true;
        const answered = new Set<unknown>();
        const binHz = 4000 / 1024;
        window.setInterval(() => {
            const posted = (window as unknown as { __uiSmokePostedMessages: Posted }).__uiSmokePostedMessages;
            posted.forEach((request) => {
                if (request.type !== 'request-track-detail' || answered.has(request.requestId)) return;
                answered.add(request.requestId);
                const count = 20;
                const times = Array.from({ length: count }, (_, k) => (k + 0.5) * duration / count);
                const read = request.read as { x: number[]; y?: number[]; beyond?: number } | undefined;
                if (read) {
                    // A readout's read (R7): the STFT's real cells around the place, from all 1025 bins.
                    const nearest = (axis: number[], value: number): number => axis.reduce((best, at, index) => (Math.abs(at - value) < Math.abs(axis[best] - value) ? index : best), 0);
                    const bins = Array.from({ length: 1025 }, (_, bin) => bin * binHz);
                    const column = nearest(times, read.x[0]), row = nearest(bins, read.y?.[0] ?? 0), beyond = read.beyond ?? 1;
                    const c0 = Math.max(0, column - beyond), c1 = Math.min(count, column + beyond + 1), r0 = Math.max(0, row - 2), r1 = Math.min(1025, row + 3);
                    const ys = bins.slice(r0, r1), xs = times.slice(c0, c1);
                    window.postMessage({
                        type: 'track-detail-result', requestId: request.requestId, analysisId: request.analysisId,
                        settingsSignature: request.settingsSignature, trackIndex: request.trackIndex, filePath: request.filePath, channels: [],
                        points: { xs, ys, matrix: ys.map(hz => xs.map(() => (Math.abs(hz - 1000) < binHz / 2 ? -20 : -80))), start: c0 > 0 ? xs[0] : null, end: c1 < count ? xs[xs.length - 1] : null, complete: true },
                    }, '*');
                    return;
                }
                const banded = typeof request.lowHz === 'number' && typeof request.highHz === 'number';
                const first = banded ? Math.max(0, Math.ceil((request.lowHz as number) / binHz) - 1) : 0;
                const last = banded ? Math.min(1024, Math.floor((request.highHz as number) / binHz) + 1) : 1024;
                const rows = banded ? last - first + 1 : 24;
                const hzOf = (row: number): number => (first + row * (last - first) / (rows - 1)) * binHz;
                const spectrogram = {
                    values: Array.from({ length: count }, () => Array.from({ length: rows }, (_, row) => (banded && Math.abs(hzOf(row) - 1000) < binHz / 2 ? -20 : -80))),
                    timeBins: count, frequencyBins: rows, windowSize: 2048, hopSize: hop, maxFrequencyHz: 4000, minDb: -100, maxDb: 0,
                    timeCentersSec: times,
                    ...(banded ? { bandLowHz: first * binHz, bandHighHz: last * binHz } : {}),
                };
                window.postMessage({
                    type: 'track-detail-result', requestId: request.requestId, analysisId: request.analysisId,
                    settingsSignature: request.settingsSignature, trackIndex: request.trackIndex, filePath: request.filePath,
                    channels: [{ spectrogram }, { spectrogram }],
                }, '*');
            });
        }, 20);
    }, { hop: HOP, duration: DURATION });
    const lane = page.locator('#track-spec-canvas-0');
    await expect(lane).toHaveAttribute('data-spectrogram-window', '0 1');
    await expect(lane).toHaveAttribute('data-spectrogram-band', '');
    const bandRequests = () => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted }).__uiSmokePostedMessages
        .filter((message) => message.type === 'request-track-detail' && typeof message.lowHz === 'number')
        .map((message) => [message.lowHz as number, message.highHz as number]));
    expect(await bandRequests()).toEqual([]);
    // A box over the whole time and 950–1050 Hz (the lane's 0–4 kHz up its height).
    const box = (await lane.boundingBox())!;
    const yOf = (hz: number): number => box.y + box.height * (1 - hz / 4000);
    await page.mouse.move(box.x + 2, yOf(1050));
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, yOf(1000), { steps: 4 });
    await page.mouse.move(box.x + box.width - 2, yOf(950), { steps: 4 });
    await page.mouse.up();
    // The band shown holds about 0.6 of the whole range's 24 rows: the lane asks for that band (covering what it
    // shows, at most twice as wide; spectrogramZoom.test.ts holds the rule).
    await expect.poll(async () => (await bandRequests()).length).toBeGreaterThan(0);
    const [low, high] = (await bandRequests()).at(-1)!;
    expect(low).toBeLessThan(1000);
    expect(high).toBeGreaterThan(1000);
    expect(high - low).toBeLessThan(400);
    await expect.poll(async () => (await lane.getAttribute('data-spectrogram-band')) ?? '').not.toBe('');
    const [drawnLow, drawnHigh] = ((await lane.getAttribute('data-spectrogram-band')) ?? '').split(' ').map(Number);
    expect(drawnLow).toBeLessThanOrEqual(low);
    expect(drawnHigh).toBeGreaterThanOrEqual(high);
    // The mark still says the band shown as fractions of the whole axis (0 Hz to Nyquist), not of the band's rows.
    const [, , yStart, yEnd] = ((await lane.getAttribute('data-plot-window')) ?? '').split(' ').map(Number);
    expect(yStart * 4000).toBeGreaterThan(drawnLow - 1);
    expect(yEnd * 4000).toBeLessThan(drawnHigh + 1);
    expect(yEnd * 4000).toBeGreaterThan(1000);
    // The pointer reads the band's own rows: the 1 kHz bin at −20 dB, at its own frequency.
    const zoomed = (await lane.boundingBox())!;
    const readout = page.locator('#plot-readout');
    let found = '';
    for (let step = 0; step <= 40 && !found; step++) {
        await page.mouse.move(zoomed.x + zoomed.width / 2, zoomed.y + zoomed.height * step / 40);
        // The read is answered by the host (above, every 20 ms): the row under the pointer is read once it is in.
        await expect(readout).not.toBeEmpty();
        const text = (await readout.textContent()) ?? '';
        if (/−20\.0 dB/.test(text)) found = text;
    }
    expect(found).toMatch(/1(\.000)? kHz/);
    // Double-click resets the zoom: the whole range's rows again.
    await lane.dblclick();
    await expect(lane).toHaveAttribute('data-spectrogram-band', '');
});
