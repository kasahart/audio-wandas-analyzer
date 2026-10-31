import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml, buildUiSmokeManyTracksHtml } from './buildHtml';
import { getStrings } from '../../shared/i18n/strings';

/** The track indexes whose spectrogram the webview has asked the host for. */
function detailRequests(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        return [...new Set(posted.filter((message) => message.type === 'request-track-detail').map((message) => Number(message.trackIndex)))].sort((a, b) => a - b);
    });
}

/** Answers each spectrogram and cursor-spectrum request not answered yet with an error, which settles it. */
function answerWithErrors(page: Page): Promise<void> {
    return page.evaluate(() => {
        const answered = ((window as unknown as { __answered?: Set<unknown> }).__answered ??= new Set());
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        posted.forEach((message) => {
            const type = message.type === 'request-track-detail' ? 'track-detail-error' : message.type === 'request-spectrum-slice' ? 'spectrum-slice-error' : null;
            if (!type || answered.has(message.requestId)) return;
            answered.add(message.requestId);
            window.postMessage({ type, requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath, error: 'no host' }, '*');
        });
    });
}

/** Resolves after the page has drawn two more frames, so what a change scheduled has run. */
function nextFrames(page: Page): Promise<void> {
    return page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** Answers requests with errors `rounds` times, letting the page draw between rounds; it asks again after each error. */
async function answerRounds(page: Page, rounds: number): Promise<void> {
    for (let round = 0; round < rounds; round++) {
        await answerWithErrors(page);
        await nextFrames(page);
    }
}

test('only the lanes near the track view are drawn and ask for their spectrogram; the rest do when scrolled to', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(40);
    await expect.poll(async () => (await detailRequests(page)).length).toBeGreaterThan(0);
    const first = await detailRequests(page);
    expect(first).toContain(0);
    expect(first).not.toContain(39);
    await page.locator('#tracks-wrapper').evaluate((wrapper) => { wrapper.scrollTop = wrapper.scrollHeight; });
    await expect.poll(async () => (await detailRequests(page)).includes(39)).toBe(true);
});

test('the PNG export draws every lane: it asks for the spectrograms of lanes out of view and is saved once they are answered', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(40);
    await expect.poll(async () => (await detailRequests(page)).length).toBeGreaterThan(0);
    expect(await detailRequests(page)).not.toContain(39);
    await page.evaluate(() => document.querySelector<HTMLElement>('#toolbar [data-action="export-png"]')?.click());
    // While it waits the footer says so, visibly (not only to a screen reader).
    const status = page.locator('#task-status');
    await expect(status).toBeVisible();
    await expect(status).toHaveText(getStrings('en').exportPngBusy);
    await expect(status).toHaveAttribute('data-state', 'busy');
    await expect.poll(async () => (await detailRequests(page)).includes(39)).toBe(true);
    const downloads = () => page.evaluate(() => (window as unknown as { __uiSmokeDownloads: Array<{ download: string }> }).__uiSmokeDownloads.map((d) => d.download));
    await nextFrames(page);
    expect(await downloads()).not.toContain('waveform-export.png');
    // The host answers every request (here with an error, which also settles it); cursor spectra are asked one at a time.
    await expect.poll(async () => {
        await answerWithErrors(page);
        return downloads();
    }, { intervals: [50], timeout: 20000 }).toContain('waveform-export.png');
    await expect(status).toHaveText(getStrings('en').exportPngDone.replace('{name}', 'waveform-export.png'));
    await expect(status).toHaveAttribute('data-state', 'done');
    // The footer is aria-hidden: a screen reader hears the finished export through the page's live region.
    await expect(page.locator('#a11y-announce')).toHaveText(getStrings('en').exportPngDone.replace('{name}', 'waveform-export.png'));
});

test('a lane resized while out of view paints its spectrogram again when scrolled back', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40, true), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(40);
    const painted = () => page.locator('#track-spec-canvas-0').evaluate((canvas: HTMLCanvasElement) => {
        // The left half: the plot, not the colour bar drawn beside it on every paint.
        const data = canvas.getContext('2d')?.getImageData(0, 0, Math.floor(canvas.width / 2), canvas.height).data;
        return Boolean(data && data.some((value, index) => index % 4 === 3 && value > 0));
    });
    await expect.poll(painted).toBe(true);
    const wrapper = page.locator('#tracks-wrapper');
    await wrapper.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    for (const width of [800, 1000]) {
        await page.setViewportSize({ width, height: 600 });
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
        await nextFrames(page);
    }
    await wrapper.evaluate((element) => { element.scrollTop = 0; });
    await expect.poll(painted).toBe(true);
});

/** The track indexes whose cursor spectrum the webview has asked the host for. */
function sliceRequests(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        return [...new Set(posted.filter((message) => message.type === 'request-spectrum-slice').map((message) => Number(message.trackIndex)))].sort((a, b) => a - b);
    });
}

test('with the cursor-spectrum panel folded, only lanes near the view ask for their cursor spectrum', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    // A fresh panel: the cursor-spectrum panel opens folded.
    await page.setContent(buildUiSmokeManyTracksHtml(40).replace('<script', '<script>window.__uiSmokeViewState = {};</script><script'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-section')).toHaveClass(/is-collapsed/);
    // Answer the queue for a while: it goes through every lane it wants (and asks again after an error).
    await answerRounds(page, 80);
    expect(await sliceRequests(page)).toContain(0);
    expect(await sliceRequests(page)).not.toContain(39);
    await page.locator('#tracks-wrapper').evaluate((wrapper) => { wrapper.scrollTop = wrapper.scrollHeight; });
    await expect.poll(async () => {
        await answerWithErrors(page);
        return (await sliceRequests(page)).includes(39);
    }, { intervals: [50] }).toBe(true);
});

test('with the cursor-spectrum panel open, every track asks for its cursor spectrum for the overlay', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-section')).not.toHaveClass(/is-collapsed/);
    await expect.poll(async () => {
        await answerWithErrors(page);
        return (await sliceRequests(page)).includes(39);
    }, { intervals: [50], timeout: 20000 }).toBe(true);
});

type AnsweredSlice = { trackIndex: number; cursorNorm: number };

/** Answers each cursor-spectrum request with a spectrum (spectrograms with an error) and lists the cursor spectra answered. */
function answerSlices(page: Page): Promise<AnsweredSlice[]> {
    return page.evaluate(() => {
        const win = window as unknown as { __answered?: Set<unknown>; __answeredSlices?: Array<{ trackIndex: number; cursorNorm: number }>; __uiSmokePostedMessages: Array<Record<string, unknown>> };
        const answered = (win.__answered ??= new Set());
        const slices = (win.__answeredSlices ??= []);
        win.__uiSmokePostedMessages.forEach((message) => {
            if ((message.type !== 'request-track-detail' && message.type !== 'request-spectrum-slice') || answered.has(message.requestId)) return;
            answered.add(message.requestId);
            const identity = { requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature, trackIndex: message.trackIndex, filePath: message.filePath };
            if (message.type === 'request-track-detail') {
                window.postMessage({ ...identity, type: 'track-detail-error', error: 'no host' }, '*');
                return;
            }
            const cursorNorm = Number(message.cursorNorm);
            slices.push({ trackIndex: Number(message.trackIndex), cursorNorm });
            const values = Array.from({ length: 64 }, () => -50);
            const channels = Number.isInteger(message.channelIndex) ? [Number(message.channelIndex)] : [0, 1];
            window.postMessage({
                ...identity,
                type: 'spectrum-slice-result',
                frequencyBins: 64,
                maxFrequencyHz: 4000,
                windowStartNorm: cursorNorm - 0.02,
                windowEndNorm: cursorNorm + 0.02,
                window: 'hann',
                channels: channels.map((channelIndex) => ({ channelIndex, values, minDb: -100, maxDb: 0 })),
            }, '*');
        });
        return slices.slice();
    });
}

test('with the cursor-spectrum panel folded, the CSV waits for the spectra of lanes out of view at the current cursor', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40).replace('<script', '<script>window.__uiSmokeViewState = {};</script><script'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-section')).toHaveClass(/is-collapsed/);
    const answeredFor = async (trackIndex: number) => (await answerSlices(page)).filter((slice) => slice.trackIndex === trackIndex);
    const wrapper = page.locator('#tracks-wrapper');
    // The last lane gets its spectrum at the first cursor position while it is in view...
    await wrapper.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(async () => (await answeredFor(39)).length, { intervals: [50], timeout: 20000 }).toBeGreaterThan(0);
    const firstCursor = (await answeredFor(39))[0].cursorNorm;
    // ...and keeps it once out of view, while the cursor moves.
    await wrapper.evaluate((element) => { element.scrollTop = 0; });
    const canvas = (await page.locator('#track-canvas-0').boundingBox())!;
    await page.mouse.click(canvas.x + canvas.width * 0.75, canvas.y + canvas.height / 2);
    await expect.poll(async () => (await answeredFor(0)).some((slice) => Math.abs(slice.cursorNorm - firstCursor) > 0.1), { intervals: [50], timeout: 20000 }).toBe(true);
    const cursor = (await answeredFor(0)).at(-1)!.cursorNorm;

    const csvSaved = () => page.evaluate(() => (window as unknown as { __uiSmokeDownloads: Array<{ download: string }> }).__uiSmokeDownloads.some((d) => d.download === 'spectrum-export.csv'));
    await page.evaluate(() => document.querySelector<HTMLElement>('#toolbar [data-action="export-csv"]')?.click());
    let lastLaneAtCursor = false;
    await expect.poll(async () => {
        if (await csvSaved()) return true;
        lastLaneAtCursor = (await answeredFor(39)).some((slice) => Math.abs(slice.cursorNorm - cursor) < 0.01);
        return false;
    }, { intervals: [50], timeout: 20000 }).toBe(true);
    expect(lastLaneAtCursor).toBe(true);
});

test('on a narrow panel with the cursor-spectrum panel folded, the CSV still asks for the cursor spectra of lanes out of view', async ({ page }) => {
    // At this width the lanes' small spectra are hidden, so drawing them asks for nothing.
    await page.setViewportSize({ width: 480, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40).replace('<script', '<script>window.__uiSmokeViewState = {};</script><script'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-section')).toHaveClass(/is-collapsed/);
    await expect(page.locator('.track-row')).toHaveCount(40);
    await page.evaluate(() => document.querySelector<HTMLElement>('#toolbar [data-action="export-csv"]')?.click());
    await expect.poll(async () => {
        await answerSlices(page);
        return (await sliceRequests(page)).includes(39);
    }, { intervals: [50], timeout: 20000 }).toBe(true);
});

test('the PNG export keeps waiting for the zoom detail on its way across redraws', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.mouse.click(20, 20);
    for (let i = 0; i < 9; i += 1) { // deep enough that the prefetched range is narrower than the file
        await page.locator('#toolbar [data-action="zoom-in"]').click({ force: true });
    }
    const rangeRequests = () => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages
        .filter((message) => message.type === 'request-waveform-range' && Number(message.endNorm) - Number(message.startNorm) < 1));
    await expect.poll(async () => (await rangeRequests()).length).toBeGreaterThan(0);
    const downloads = () => page.evaluate(() => (window as unknown as { __uiSmokeDownloads: Array<{ download: string }> }).__uiSmokeDownloads.map((d) => d.download));
    await page.evaluate(() => document.querySelector<HTMLElement>('#toolbar [data-action="export-png"]')?.click());
    // A redraw (here the cursor moving) does not ask again for a range already on its way (#502); the export keeps waiting for it.
    const asked = (await rangeRequests()).length;
    const canvas = (await page.locator('#track-canvas-0').boundingBox())!;
    await page.mouse.click(canvas.x + canvas.width * 0.5, canvas.y + canvas.height / 2);
    await nextFrames(page);
    await page.waitForTimeout(200);
    expect((await rangeRequests()).length).toBe(asked);
    // Everything else the export waits for is answered.
    await answerRounds(page, 12);
    expect(await downloads()).not.toContain('waveform-export.png');
    // Answering the latest one with the detail it asked for lets the image be saved.
    await page.evaluate((request) => {
        const span = Number(request.endNorm) - Number(request.startNorm);
        const points = Number(request.points);
        const at = Array.from({ length: points }, (_, index) => Number(request.startNorm) + ((index + 0.5) / points) * span);
        const waveform = { min: at.map(() => -0.5), max: at.map(() => 0.5), minT: at, maxT: at, samples: at.map(() => 0), absolutePeak: 0.5 };
        window.postMessage({ type: 'waveform-range-result', requestId: request.requestId, trackIndex: request.trackIndex, startNorm: request.startNorm, endNorm: request.endNorm, channels: [waveform, waveform] }, '*');
    }, (await rangeRequests()).at(-1)!);
    await expect.poll(async () => {
        await answerWithErrors(page);
        return downloads();
    }, { intervals: [50], timeout: 20000 }).toContain('waveform-export.png');
});

test('a cursor spectrum the host failed is not asked again on every frame', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.mouse.click(20, 20);
    const sliceRequestCount = () => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages
        .filter((message) => message.type === 'request-spectrum-slice').length);
    await expect.poll(sliceRequestCount).toBeGreaterThan(0);
    await answerRounds(page, 4);
    const asked = await sliceRequestCount();
    // Nothing moved: the failed spectrum stays failed until the cursor, the settings or the tracks change.
    await answerRounds(page, 12);
    expect(await sliceRequestCount()).toBe(asked);
});

test('a cursor moved while the CSV waits: the file holds every shown track at the new cursor', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40).replace('<script', '<script>window.__uiSmokeViewState = {};</script><script'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(40);
    const canvas = (await page.locator('#track-canvas-0').boundingBox())!;
    await page.mouse.click(canvas.x + canvas.width * 0.25, canvas.y + canvas.height / 2);
    await page.evaluate(() => document.querySelector<HTMLElement>('#toolbar [data-action="export-csv"]')?.click());
    await page.mouse.click(canvas.x + canvas.width * 0.75, canvas.y + canvas.height / 2);
    const csv = () => page.evaluate(() => {
        const saved = (window as unknown as { __uiSmokeDownloads: Array<{ download: string; href: string }> }).__uiSmokeDownloads.find((d) => d.download === 'spectrum-export.csv');
        return saved ? decodeURIComponent(saved.href.slice(saved.href.indexOf(',') + 1)) : null;
    });
    await expect.poll(async () => {
        await answerSlices(page);
        return (await csv()) !== null;
    }, { intervals: [50], timeout: 20000 }).toBe(true);
    const header = (await csv())!.split('\n')[0];
    expect(header).toContain('take00.wav');
    expect(header).toContain('take39.wav');
});

test('a failed spectrogram lane shows the host\'s summary on one line and the backend\'s text below it', async ({ page }) => {
    const strings = getStrings('en');
    const recordText = '<script>window.__drawnText = []; const fill = CanvasRenderingContext2D.prototype.fillText;'
        + ' CanvasRenderingContext2D.prototype.fillText = function (text, x, y) { window.__drawnText.push({ id: this.canvas.id, text: String(text), y }); return fill.apply(this, arguments); };</script><script';
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(2).replace('<script', recordText), { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await detailRequests(page)).length).toBeGreaterThan(0);
    const detail = 'Parameter n must be >= ceil(m_num/2) = 32!';
    await page.evaluate((error) => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        posted.filter((message) => message.type === 'request-track-detail').forEach((message) => {
            window.postMessage({ type: 'track-detail-error', requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature,
                trackIndex: message.trackIndex, filePath: message.filePath, error }, '*');
        });
    }, `${strings.errorAnalysisSettings}\n${detail}`);
    const summary = strings.spectrogramFailed.replace('{reason}', strings.errorAnalysisSettings);
    const drawn = () => page.evaluate(() => (window as unknown as { __drawnText: Array<{ id: string; text: string; y: number }> }).__drawnText
        .filter((entry) => entry.id.startsWith('track-spec-canvas-0')));
    await expect.poll(async () => (await drawn()).map((entry) => entry.text)).toEqual(expect.arrayContaining([summary, detail]));
    const lines = await drawn();
    const summaryY = lines.filter((entry) => entry.text === summary).at(-1)?.y ?? NaN;
    const detailY = lines.filter((entry) => entry.text === detail).at(-1)?.y ?? NaN;
    expect(detailY).toBeGreaterThan(summaryY);
});

test('a zoom-detail range the host never answers is asked again by a later redraw', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.mouse.click(20, 20);
    for (let i = 0; i < 9; i += 1) {
        await page.locator('#toolbar [data-action="zoom-in"]').click({ force: true });
    }
    const rangeRequests = () => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages
        .filter((message) => message.type === 'request-waveform-range').length);
    await expect.poll(rangeRequests).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    const asked = await rangeRequests();
    const canvas = (await page.locator('#track-canvas-0').boundingBox())!;
    const redraw = (x: number) => page.mouse.click(canvas.x + canvas.width * x, canvas.y + canvas.height / 2);
    // A failed range gets no answer; while it may still be on its way, a redraw does not ask again...
    await redraw(0.4);
    await page.waitForTimeout(300);
    expect(await rangeRequests()).toBe(asked);
    // ...but after a while it no longer counts, so the next redraw asks again.
    await page.waitForTimeout(2000);
    await redraw(0.6);
    await expect.poll(rangeRequests).toBeGreaterThan(asked);
});
