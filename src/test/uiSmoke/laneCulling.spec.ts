import { expect, settled, test, type Page } from './canvasAudit';
import { buildUiSmokeHtml, buildUiSmokeManyTracksHtml } from './buildHtml';
import { drawnRow, pointOnLane, rowFigure, ROW_WAVE, seenFigure } from './tracksFigures';
import { getStrings } from '../../shared/i18n/strings';
import { csvRecords } from '../../shared/utils/csv';


/** The page's stand-in leaves the rows' askings to the test, which answers them itself (fullReadStandIn.ts uiSmokeRowAnswers). */
const TEST_ANSWERS_ROWS = '<script>window.__uiSmokeTestAnswersRows = true;</script><script';

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

// The tests of 40 tracks answer one request a poll: about 17 s each on a free machine, more beside other workers.
test.describe.configure({ timeout: 120_000 });

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

test('the PNG export draws every lane: it asks for the spectrograms of lanes out of view and is saved once they are answered, saying so when rows could not be drawn', async ({ page }) => {
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
    }, { intervals: [50], timeout: 90000 }).toContain('waveform-export.png');
    // The rows' answers failed: the image holds each row with its words in place of its plot, and the notice says
    // the image has rows that are not drawn (never a plain "exported").
    await expect(status).toHaveText(getStrings('en').exportPngPartial.replace('{name}', 'waveform-export.png'));
    await expect(status).toHaveAttribute('data-state', 'done');
    // The footer is aria-hidden: a screen reader hears the finished export through the page's live region.
    await expect(page.locator('#a11y-announce')).toHaveText(getStrings('en').exportPngPartial.replace('{name}', 'waveform-export.png'));
});

test('a row resized while out of view draws its spectrogram again when scrolled back', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40, true), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(40);
    // The first row's Figure shows a picture with its spectrogram, at the width its box has now.
    const painted = async (): Promise<boolean> => {
        const seen = await seenFigure(page, rowFigure(0)).catch(() => null);
        const box = await page.locator('#track-row-figure-0').boundingBox();
        const image = seen?.lanes.find(lane => !!lane.image);
        return !!seen && !seen.waiting && !!image && !!box && image.frame.left + image.frame.width <= box.width;
    };
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
    }, { intervals: [50], timeout: 90000 }).toBe(true);
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
            // Every bin of an 8192-point FFT, kept under a key a channel as the backend keeps them (fullReadStandIn.ts).
            const bins = 4097;
            const xs = Array.from({ length: bins }, (_, index) => index / (bins - 1) * 4000);
            const values = Array.from({ length: bins }, () => -50);
            const keep = (window as unknown as { uiSmokeCursorAnswers: (message: unknown, lines: unknown[], extra?: unknown) => unknown }).uiSmokeCursorAnswers;
            window.postMessage(keep(message, [0, 1].map(channelIndex => ({ channelIndex, xs, values, level: { unit: 'FS', ref: 1, label: 'dBFS' }, xLimits: [0, 4000] }))), '*');
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
    await expect.poll(async () => (await answeredFor(39)).length, { intervals: [50], timeout: 90000 }).toBeGreaterThan(0);
    const firstCursor = (await answeredFor(39))[0].cursorNorm;
    // ...and keeps it once out of view, while the cursor moves.
    await wrapper.evaluate((element) => { element.scrollTop = 0; });
    await drawnRow(page, 0, 0, true);
    const at = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.75);
    await page.mouse.click(at.x, at.y);
    await expect.poll(async () => (await answeredFor(0)).some((slice) => Math.abs(slice.cursorNorm - firstCursor) > 0.1), { intervals: [50], timeout: 90000 }).toBe(true);
    const cursor = (await answeredFor(0)).at(-1)!.cursorNorm;

    const csvSaved = () => page.evaluate(() => (window as unknown as { __uiSmokeDownloads: Array<{ download: string }> }).__uiSmokeDownloads.some((d) => /^spectrum-export_[0-9.-]+_[0-9a-f]+\.csv$/.test(d.download)));
    await page.evaluate(() => document.querySelector<HTMLElement>('#toolbar [data-action="export-csv"]')?.click());
    let lastLaneAtCursor = false;
    await expect.poll(async () => {
        if (await csvSaved()) return true;
        lastLaneAtCursor = (await answeredFor(39)).some((slice) => Math.abs(slice.cursorNorm - cursor) < 0.01);
        return false;
    }, { intervals: [50], timeout: 90000 }).toBe(true);
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
    }, { intervals: [50], timeout: 90000 }).toBe(true);
});

test('a cursor spectrum the host failed is not asked again on every frame', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.mouse.click(20, 20);
    const sliceRequestCount = () => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages
        .filter((message) => message.type === 'request-spectrum-slice').length);
    await expect.poll(sliceRequestCount).toBeGreaterThan(0);
    await answerRounds(page, 4);
    const asked = await sliceRequestCount();
    // Nothing moved: the failed spectrum is not asked again while the answer store's pause stands (FAILED_RETRY_MS),
    // far longer than these frames; after it, it is asked again once by itself.
    await answerRounds(page, 12);
    expect(await sliceRequestCount()).toBe(asked);
});

test('a cursor moved while the CSV waits: the file holds every shown track at the new cursor', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(40).replace('<script', '<script>window.__uiSmokeViewState = {};</script><script'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.track-row')).toHaveCount(40);
    await drawnRow(page, 0, 0, true);
    const first = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.25), second = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.75);
    await page.mouse.click(first.x, first.y);
    await page.evaluate(() => document.querySelector<HTMLElement>('#toolbar [data-action="export-csv"]')?.click());
    await page.mouse.click(second.x, second.y);
    const csv = () => page.evaluate(() => {
        const saved = (window as unknown as { __uiSmokeDownloads: Array<{ download: string; href: string }> }).__uiSmokeDownloads.find((d) => /^spectrum-export_[0-9.-]+_[0-9a-f]+\.csv$/.test(d.download));
        return saved ? decodeURIComponent(saved.href.slice(saved.href.indexOf(',') + 1)) : null;
    });
    await expect.poll(async () => {
        await answerSlices(page);
        return (await csv()) !== null;
    }, { intervals: [50], timeout: 90000 }).toBe(true);
    const rows = csvRecords((await csv())!);
    expect(rows[0].join('\n')).toContain('take00.wav');
    expect(rows[0].join('\n')).toContain('take39.wav');
    // Every bin of the host's 8192-point FFT, not the row drawn: 4097 rows at 4000 / 4096 Hz spacing.
    expect(rows.length).toBe(1 + 4097);
    // The bin's own frequency, as the figure service's table writes it (every digit, not rounded for the screen).
    expect(Number(rows[2][0])).toBe(4000 / 4096);
});

test('a recording too short for the STFT draws its waveform, and its spectrogram lane says why in its own place', async ({ page }) => {
    const strings = getStrings('en');
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(2, true).replace('<script', '<script>window.__uiSmokeNoLevels = "too-short";</script><script'), { waitUntil: 'domcontentloaded' });
    // The waveform lane is drawn alone, and nothing is asked again.
    const seen = await drawnRow(page, 0, 0, true);
    expect(seen.lanes.map(lane => lane.id)).toEqual([ROW_WAVE]);
    const says = page.locator('#track-row-figure-0 .track-row-says');
    await expect(says).toHaveText(strings.rowTooShort);
    // The words lie where the spectrogram would be: under the waveform lane, inside the row's box.
    const canvas = (await page.locator(rowFigure(0)).boundingBox())!, words = (await says.boundingBox())!, row = (await page.locator('#track-row-figure-0').boundingBox())!;
    const wave = seen.lanes[0].frame;
    expect(words.y).toBeGreaterThanOrEqual(canvas.y + wave.top + wave.height - 1);
    expect(words.y + words.height).toBeLessThanOrEqual(row.y + row.height + 1);
    const asked = (await detailRequests(page)).length;
    await settled(page);
    expect((await detailRequests(page)).length).toBe(asked);
});

test('a row whose answers failed says the host\'s summary on one line and the backend\'s text below it', async ({ page }) => {
    const strings = getStrings('en');
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(2).replace('<script', TEST_ANSWERS_ROWS), { waitUntil: 'domcontentloaded' });
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
    // The row draws nothing and says why in its own box: the summary, then the backend's text on the line under it.
    const says = page.locator('#track-row-figure-0 .track-row-says');
    await expect(says).toBeVisible();
    expect(((await says.innerText()).split('\n')).map(line => line.trim())).toEqual([summary, detail]);
    const box = (await says.boundingBox())!, row = (await page.locator('#track-row-figure-0').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(row.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width + 1);
});

test('a row whose file changed after it was analysed stops asking, says so, and offers to analyse again', async ({ page }) => {
    const strings = getStrings('en');
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.setContent(buildUiSmokeManyTracksHtml(2).replace('<script', TEST_ANSWERS_ROWS), { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await detailRequests(page)).length).toBeGreaterThan(0);
    const button = page.locator('#track-row-0 [data-action="reanalyze-changed"]');
    await expect(button).toBeHidden();
    const asked = () => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages
        .filter((message) => message.type === 'request-track-detail' && message.trackIndex === 0).length);
    await page.evaluate(() => {
        const posted = (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages;
        posted.filter((message) => message.type === 'request-track-detail' && message.trackIndex === 0).forEach((message) => {
            window.postMessage({ type: 'track-detail-error', requestId: message.requestId, analysisId: message.analysisId, settingsSignature: message.settingsSignature,
                trackIndex: message.trackIndex, filePath: message.filePath, error: 'a.wav changed on disk since it was analysed', staleSource: true }, '*');
        });
    });
    await expect(button).toBeVisible();
    await expect(page.locator('#track-row-figure-0 .track-row-says')).toHaveText(strings.sourceChangedLane);
    // Nothing of the changed file is drawn, so nothing of it is read (R7): its row holds no Figure. The other row is asked as before.
    await expect(page.locator(rowFigure(0))).toHaveCount(0);
    await expect(page.locator('#track-row-figure-1 .track-row-says')).toHaveText(strings.spectrogramLoading);
    await expect(page.locator('#track-row-1 [data-action="reanalyze-changed"]')).toBeHidden();
    const before = await asked();
    // Past the store's pause a passing failure would be asked again; this one is not.
    await page.waitForTimeout(5600);
    await page.mouse.click(500, 300);
    await settled(page);
    expect(await asked()).toBe(before);
    await button.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages
        .some((message) => message.type === 'request-reanalyze'))).toBe(true);
});

