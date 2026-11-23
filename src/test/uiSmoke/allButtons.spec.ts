import { expect, settled, test, type Page } from './canvasAudit';
import { buildUiSmokeTwoRatesHtml, buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';
import { drawnFigure, drawnRow, laneOf, openRowRange, pointOnLane, rowFigure, ROW_SPECTROGRAM, ROW_WAVE, seenFigure } from './tracksFigures';
import { getStrings } from '../../shared/i18n/strings';


type PostedMessage = {
    type?: string;
    targetKind?: string;
    filePaths?: string[];
    message?: string;
};

async function loadResultsUi(page: Page) {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#toolbar')).toBeVisible();
}

async function loadSelectionUi(page: Page) {
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#selection-toolbar')).toBeVisible();
}

async function getPostedMessages(page: Page): Promise<PostedMessage[]> {
    return page.evaluate(() => {
        return ((window as typeof window & {
            __uiSmokePostedMessages?: PostedMessage[];
        }).__uiSmokePostedMessages ?? []);
    });
}

async function clearPostedMessages(page: Page): Promise<void> {
    await page.evaluate(() => {
        (window as typeof window & {
            __uiSmokePostedMessages?: PostedMessage[];
        }).__uiSmokePostedMessages = [];
    });
}

async function getUiSmokeState(page: Page): Promise<{
    zoomStart?: number;
    zoomEnd?: number;
    amplitudeZoomMinNorm?: number;
    amplitudeZoomMaxNorm?: number;
    rectZoomSelection?: unknown;
    spectrumZoom?: {
        specFreqStart?: number;
        specFreqEnd?: number;
        trackHeight?: number;
        spectrumOverlayHeight?: number;
    };
}> {
    return page.evaluate(() => {
        return ((window as typeof window & {
            __uiSmokeState?: {
                zoomStart?: number;
                zoomEnd?: number;
                amplitudeZoomMinNorm?: number;
                amplitudeZoomMaxNorm?: number;
                rectZoomSelection?: unknown;
                spectrumZoom?: {
                    specFreqStart?: number;
                    specFreqEnd?: number;
                    trackHeight?: number;
                    spectrumOverlayHeight?: number;
                };
            };
        }).__uiSmokeState ?? {});
    });
}

async function installPlaybackElement(page: Page) {
    await page.evaluate(() => {
        const host = document.getElementById('audio-host');
        if (!host || document.getElementById('track-audio-0')) {
            return;
        }
        const audio = document.createElement('audio');
        audio.id = 'track-audio-0';
        let pausedState = true;
        Object.defineProperty(audio, 'paused', {
            configurable: true,
            get() {
                return pausedState;
            },
        });
        audio.play = async function() {
            pausedState = false;
        };
        audio.pause = function() {
            pausedState = true;
        };
        host.appendChild(audio);
        document.querySelectorAll('[data-action="toggle-playback"], [data-action="stop-playback"]').forEach((button) => {
            button.removeAttribute('disabled');
        });
    });
}

async function domClick(page: Page, selector: string): Promise<void> {
    await page.locator(selector).first().evaluate((element) => {
        (element as HTMLElement).click();
    });
}

/** Opens one of the toolbar's menus: 'tb-export-menu' (every export) or 'tb-more-menu' (the other zoom tools). */
async function openToolbarMenu(page: Page, id: 'tb-export-menu' | 'tb-more-menu'): Promise<void> {
    const menu = page.locator(`#toolbar #${id}`);
    await menu.locator('summary').evaluate((element) => {
        (element as HTMLElement).click();
    });
    await expect(menu).toHaveAttribute('open', '');
}

test('results-toolbar buttons either change UI state or emit a VS Code side effect', async ({ page }) => {
    await loadResultsUi(page);

    const toolbar = page.locator('#toolbar');

    await toolbar.locator('[data-action="zoom-in"]').click({ force: true });
    await toolbar.locator('[data-action="zoom-out"]').click({ force: true });
    await toolbar.locator('[data-action="zoom-reset"]').click({ force: true });

    // Zoom to the selection and follow sit in the ⋯ menu; there is no box zoom mode: a drag on a lane zooms into its box.
    await openToolbarMenu(page, 'tb-more-menu');
    await expect(toolbar.locator('[data-action="wave-mode-rect-zoom"]')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Heights are dragged at the lanes' edges: the toolbar has no height fields.
    await expect(toolbar.locator('[data-action="track-height-input"], [data-action="spectrum-height-input"]')).toHaveCount(0);

    // The lanes show the waveform over the spectrogram, so there is no spectrogram toggle; ⚙ is always there.
    await expect(toolbar.locator('[data-action="content-spectrogram"]')).toHaveCount(0);
    await expect(toolbar.locator('[data-action="spectrogram-settings"]')).toBeVisible();
    await toolbar.locator('[data-action="spectrogram-settings"]').click({ force: true });
    await expect(page.locator('#spec-settings-popover')).toBeVisible();

    // The cursor spectrum's zoom buttons act on its picture: once it is drawn.
    await drawnFigure(page);
    const spectrumBeforeZoom = await getUiSmokeState(page);
    await domClick(page, '#spectrum-zoom-toolbar [data-action="spec-zoom-in"]');
    await settled(page);
    const spectrumAfterZoomIn = await getUiSmokeState(page);
    expect(spectrumAfterZoomIn.spectrumZoom?.specFreqStart).not.toBe(spectrumBeforeZoom.spectrumZoom?.specFreqStart);
    expect(spectrumAfterZoomIn.spectrumZoom?.specFreqEnd).not.toBe(spectrumBeforeZoom.spectrumZoom?.specFreqEnd);

    await toolbar.locator('[data-action="spectrogram-settings"]').click({ force: true });
    await expect(page.locator('#spec-settings-popover')).toBeVisible();
    await page.locator('#spec-apply').click({ force: true });
    await expect(page.locator('#spec-settings-popover')).toBeHidden();

    await expect(toolbar.locator('[data-action="zoom-to-selection"]')).toBeDisabled();

    // Two menus: the other zoom tools (⋯) and Export, which also saves or opens a Recipe.
    await expect(page.locator('#toolbar details.tb-menu')).toHaveCount(2);
    await openToolbarMenu(page, 'tb-export-menu');
    await domClick(page, '#toolbar [data-action="open-recipe"]');
    await domClick(page, '#toolbar [data-action="save-recipe"]');
    await domClick(page, '#toolbar [data-action="export-png"]');
    await domClick(page, '#toolbar [data-action="export-csv"]');
    await domClick(page, '#toolbar [data-action="export-wav"]');
    await domClick(page, '#toolbar [data-action="export-report"]');

    const messages = await getPostedMessages(page);
    expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'request-reanalyze' }),
        expect.objectContaining({ type: 'export-report-options' }),
        expect.objectContaining({ type: 'save-recipe' }),
    ]));
});

test('a drag on a row\'s waveform shows a rubber band and zooms time plus amplitude, as on every plot (R13)', async ({ page }) => {
    await loadResultsUi(page);
    const toolbar = page.locator('#toolbar');
    await drawnRow(page);
    const start = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.25, 0.8);
    const end = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.75, 0.2);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    // The rubber band is the Figure's own box.
    expect((await seenFigure(page, rowFigure(0))).box).not.toBeNull();
    await expect(toolbar.locator('[data-action="zoom-to-selection"]')).toBeDisabled();

    await page.mouse.up();
    await settled(page);
    expect((await seenFigure(page, rowFigure(0))).box).toBeNull();
    const zoomed = await getUiSmokeState(page);
    expect(zoomed.zoomStart).toBeGreaterThan(0.2);
    expect(zoomed.zoomEnd).toBeLessThan(0.8);
    expect(zoomed.amplitudeZoomMinNorm).toBeGreaterThan(-1);
    expect(zoomed.amplitudeZoomMaxNorm).toBeLessThan(1);
});

test('a drag on a row\'s spectrogram zooms into its time and frequencies; a double-click shows the whole again (R13)', async ({ page }) => {
    await loadResultsUi(page);
    await drawnRow(page);
    const start = await pointOnLane(page, rowFigure(0), ROW_SPECTROGRAM, 0.25, 0.8);
    const end = await pointOnLane(page, rowFigure(0), ROW_SPECTROGRAM, 0.75, 0.4);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    expect((await seenFigure(page, rowFigure(0))).box).not.toBeNull();
    await page.mouse.up();
    await settled(page);
    const zoomed = await getUiSmokeState(page);
    expect(zoomed.zoomStart).toBeGreaterThan(0.2);
    expect(zoomed.zoomEnd).toBeLessThan(0.8);
    // Its frequencies: the band from 40 % to 80 % up the axis, as the part of the whole axis the lane shows.
    const shown = async () => laneOf(await drawnRow(page), ROW_SPECTROGRAM).part!.y;
    await expect.poll(async () => (await shown()).start).toBeGreaterThan(0.3);
    expect((await shown()).end).toBeLessThan(0.9);
    const middle = await pointOnLane(page, rowFigure(0), ROW_SPECTROGRAM, 0.5);
    await page.mouse.dblclick(middle.x, middle.y);
    await expect.poll(async () => { const part = laneOf(await seenFigure(page, rowFigure(0)), ROW_SPECTROGRAM).part; return part ? [part.x.start, part.x.end, part.y.start, part.y.end] : null; }).toEqual([0, 1, 0, 1]);
});

test('a spectrogram box zoom shows the same frequencies in Hz on rows of different sample rates, and the axis popover starts from and replaces it (R13)', async ({ page }) => {
    await page.setContent(buildUiSmokeTwoRatesHtml(), { waitUntil: 'domcontentloaded' });
    const tops = await page.evaluate(() => (window as unknown as { __APP_STATE__: { results: Array<{ sampleRateHz: number }> } }).__APP_STATE__.results
        .map(result => result.sampleRateHz / 2));
    expect(tops[1]).toBeCloseTo(tops[0] / 2);
    // The band each row shows, in Hz.
    const shownHz = async (index: number): Promise<[number, number]> => laneOf(await drawnRow(page, index), ROW_SPECTROGRAM).range!.y;
    await shownHz(1);
    // Box from 10 % to 40 % up the full-rate row: within the half-rate row's band too.
    const start = await pointOnLane(page, rowFigure(0), ROW_SPECTROGRAM, 0.25, 0.1);
    const end = await pointOnLane(page, rowFigure(0), ROW_SPECTROGRAM, 0.75, 0.4);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await shownHz(0))[1]).toBeLessThan(tops[0] * 0.5);
    const [low0, high0] = await shownHz(0);
    await expect.poll(async () => Math.abs((await shownHz(1))[1] - high0)).toBeLessThan(tops[0] * 0.002);
    const [low1] = await shownHz(1);
    expect(Math.abs(low1 - low0)).toBeLessThan(tops[0] * 0.002);
    // The frequency axis' popover starts from the band shown, and what is typed there is what is shown.
    const range = await openRowRange(page, 'frequency');
    expect(Math.abs(Number(await range.max.inputValue()) - high0)).toBeLessThan(tops[0] * 0.002);
    const typed = [Math.round(tops[0] * 0.05), Math.round(tops[0] * 0.2)];
    await range.min.fill(String(typed[0]));
    await range.max.fill(String(typed[1]));
    await range.apply.click();
    await expect.poll(async () => (await shownHz(0)).map(Math.round)).toEqual(typed);
});

test('Alt+drag on a row sets the loop region; a plain drag does not', async ({ page }) => {
    await loadResultsUi(page);
    const toolbar = page.locator('#toolbar');
    await drawnRow(page);
    const start = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.3);
    const end = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.6);
    await page.keyboard.down('Alt');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect(toolbar.locator('[data-action="zoom-to-selection"]')).toBeEnabled();
    const looped = await getUiSmokeState(page);
    expect(looped.rectZoomSelection ?? null).toBeNull();
    expect(looped.zoomStart).toBe(0);
});

test('export-wav without a loop posts a visible info message', async ({ page }) => {
    await loadResultsUi(page);
    await clearPostedMessages(page);

    await openToolbarMenu(page, 'tb-export-menu');
    await page.locator('#toolbar [data-action="export-wav"]').click({ force: true });

    const messages = await getPostedMessages(page);
    expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
            type: 'show-info',
            message: expect.stringContaining('No loop region selected'),
        }),
    ]));
});

test('export-png / export-csv ボタンが #a11y-announce を更新する', async ({ page }) => {
    await loadResultsUi(page);
    const toolbar = page.locator('#toolbar');

    await openToolbarMenu(page, 'tb-export-menu');

    // export-png: クリック後に announce が更新される
    await page.evaluate(() => {
        const el = document.getElementById('a11y-announce');
        if (el) { el.textContent = ''; }
    });
    await toolbar.locator('[data-action="export-png"]').click({ force: true });
    await expect(page.locator('#a11y-announce')).not.toBeEmpty();

    // export-csv: クリック後に announce が更新される
    await page.evaluate(() => {
        const el = document.getElementById('a11y-announce');
        if (el) { el.textContent = ''; }
    });
    // A used item closes its menu: open it again for the next one.
    await openToolbarMenu(page, 'tb-export-menu');
    await toolbar.locator('[data-action="export-csv"]').click({ force: true });
    await expect(page.locator('#a11y-announce')).not.toBeEmpty();
});

test('export-csv with no tracks says it failed in the footer and the announcer', async ({ page }) => {
    await loadSelectionUi(page);
    const failed = getStrings('en').announceExportCsvFailed;
    await domClick(page, '#toolbar [data-action="export-csv"]');
    await expect(page.locator('#task-status')).toBeVisible();
    await expect(page.locator('#task-status')).toHaveAttribute('data-state', 'failed');
    await expect(page.locator('#task-status')).toHaveText(failed);
    await expect(page.locator('#a11y-announce')).toHaveText(failed);
    expect(await getPostedMessages(page)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'show-info', message: failed })]));
});

test('clicking every selection-toolbar button produces the expected GUI-side reaction', async ({ page }) => {
    await loadSelectionUi(page);

    const toolbar = page.locator('#selection-toolbar');
    await toolbar.locator('[data-action="open-file"]').click({ force: true });
    await toolbar.locator('[data-action="open-folder"]').click({ force: true });
    // The interpreter's button shows only when it needs attention; it still answers a press.
    await expect(toolbar.locator('[data-action="select-python-environment"]')).toBeHidden();
    await domClick(page, '#selection-toolbar [data-action="select-python-environment"]');

    const messages = await getPostedMessages(page);
    expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'select-target', targetKind: 'file' }),
        expect.objectContaining({ type: 'select-target', targetKind: 'directory' }),
        expect.objectContaining({ type: 'select-python-environment' }),
    ]));
});

test('Space after a click on a row plays that row\'s recording: the focused canvas is the row\'s Figure, and its row names the recording', async ({ page }) => {
    await loadResultsUi(page);
    await installPlaybackElement(page);
    const play = page.locator('[data-action="toggle-playback"]').first();
    const canvas = page.locator('#track-row-figure-0 canvas[data-figure]');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 4);
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('CANVAS');
    await page.keyboard.press(' ');
    await expect(play, 'Space after a click on the row plays it').toHaveClass(/is-playing/);
});

test('clicking every track control changes the per-track UI or its side effects', async ({ page }) => {
    await loadResultsUi(page);
    await expect(page.locator('[data-action="toggle-playback"]')).toBeDisabled();
    // One track plays at a time, so a track has no mute of its own.
    await expect(page.locator('[data-action="toggle-mute"]')).toHaveCount(0);
    await installPlaybackElement(page);

    const offsetBefore = await page.locator('#offset-val-0').textContent();

    // The role chip shows the track's colour without a role, and · on it.
    await expect(page.locator('.track-header .role-chip-face').first()).toHaveText('·');

    await domClick(page, '[data-action="toggle-playback"]');
    await expect(page.locator('[data-action="toggle-playback"]')).toHaveClass(/is-playing/);
    await expect(page.locator('[data-action="stop-playback"]')).toBeEnabled();
    await domClick(page, '[data-action="stop-playback"]');
    await expect(page.locator('[data-action="toggle-playback"]')).not.toHaveClass(/is-playing/);

    await domClick(page, '[data-action="offset-up"]');
    await expect(page.locator('#offset-val-0')).not.toHaveText(offsetBefore ?? '+0.000s');
    await domClick(page, '[data-action="offset-down"]');
    await expect(page.locator('#offset-val-0')).toHaveText(offsetBefore ?? '+0.000s');

    await domClick(page, '[data-action="remove-track"]');
    await expect(page.locator('.track-row')).toHaveCount(0);
});
