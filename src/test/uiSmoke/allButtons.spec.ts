import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';

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
        document.querySelectorAll('[data-action="toggle-playback"], [data-action="stop-playback"], [data-action="toggle-mute"]').forEach((button) => {
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

    // Box zoom, zoom to the selection and follow sit in the ⋯ menu.
    const moreSummary = toolbar.locator('#tb-more-menu > summary');
    const summaryBackground = () => moreSummary.evaluate(node => getComputedStyle(node).backgroundColor);
    const idleBackground = await summaryBackground();
    await openToolbarMenu(page, 'tb-more-menu');
    const rectZoomButton = toolbar.locator('[data-action="wave-mode-rect-zoom"]');
    await expect(rectZoomButton).toBeEnabled();
    await expect(rectZoomButton).toHaveAttribute('aria-pressed', 'false');
    await rectZoomButton.click();
    await expect(rectZoomButton).toHaveAttribute('aria-pressed', 'true');
    await expect(rectZoomButton).toHaveClass(/is-active/);
    // A choice closes the menu; ⋯ itself shows that a mode inside it is on.
    await expect.poll(summaryBackground).not.toBe(idleBackground);
    await openToolbarMenu(page, 'tb-more-menu');
    await rectZoomButton.click();
    await expect(rectZoomButton).toHaveAttribute('aria-pressed', 'false');
    await expect(rectZoomButton).not.toHaveClass(/is-active/);
    await expect.poll(summaryBackground).toBe(idleBackground);

    // Heights are dragged at the lanes' edges: the toolbar has no height fields.
    await expect(toolbar.locator('[data-action="track-height-input"], [data-action="spectrum-height-input"]')).toHaveCount(0);

    // The lanes show the waveform over the spectrogram, so there is no spectrogram toggle; ⚙ is always there.
    await expect(toolbar.locator('[data-action="content-spectrogram"]')).toHaveCount(0);
    await expect(toolbar.locator('[data-action="spectrogram-settings"]')).toBeVisible();
    await toolbar.locator('[data-action="spectrogram-settings"]').click({ force: true });
    await expect(page.locator('#spec-settings-popover')).toBeVisible();

    const spectrumBeforeZoom = await getUiSmokeState(page);
    await domClick(page, '#spectrum-zoom-toolbar [data-action="spec-zoom-in"]');
    await page.waitForTimeout(100);
    const spectrumAfterZoomIn = await getUiSmokeState(page);
    expect(spectrumAfterZoomIn.spectrumZoom?.specFreqStart).not.toBe(spectrumBeforeZoom.spectrumZoom?.specFreqStart);
    expect(spectrumAfterZoomIn.spectrumZoom?.specFreqEnd).not.toBe(spectrumBeforeZoom.spectrumZoom?.specFreqEnd);

    await toolbar.locator('[data-action="spectrogram-settings"]').click({ force: true });
    await expect(page.locator('#spec-settings-popover')).toBeVisible();
    await page.locator('#spec-apply').click({ force: true });
    await expect(page.locator('#spec-settings-popover')).toBeHidden();

    await expect(toolbar.locator('[data-action="zoom-to-selection"]')).toBeDisabled();

    // Two menus: the other zoom tools (⋯) and Export, which also saves or runs a Recipe.
    await expect(page.locator('#toolbar details.tb-menu')).toHaveCount(2);
    await openToolbarMenu(page, 'tb-export-menu');
    await domClick(page, '#toolbar [data-action="run-recipe"]');
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

test('waveform rect zoom drag shows a rubber band and zooms time plus amplitude', async ({ page }) => {
    await loadResultsUi(page);
    const toolbar = page.locator('#toolbar');
    await openToolbarMenu(page, 'tb-more-menu');
    await toolbar.locator('[data-action="wave-mode-rect-zoom"]').click();

    const canvas = page.locator('#track-canvas-0');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width * 0.25;
    const startY = box!.y + box!.height * 0.2;
    const endX = box!.x + box!.width * 0.75;
    const endY = box!.y + box!.height * 0.8;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 4 });
    const dragging = await getUiSmokeState(page);
    expect(dragging.rectZoomSelection).not.toBeNull();
    await expect(toolbar.locator('[data-action="zoom-to-selection"]')).toBeDisabled();

    await page.mouse.up();
    await page.waitForTimeout(100);
    const zoomed = await getUiSmokeState(page);
    expect(zoomed.rectZoomSelection).toBeNull();
    expect(zoomed.zoomStart).toBeGreaterThan(0.2);
    expect(zoomed.zoomEnd).toBeLessThan(0.8);
    expect(zoomed.amplitudeZoomMinNorm).toBeGreaterThan(-1);
    expect(zoomed.amplitudeZoomMaxNorm).toBeLessThan(1);
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

test('clicking every track control changes the per-track UI or its side effects', async ({ page }) => {
    await loadResultsUi(page);
    await expect(page.locator('[data-action="toggle-mute"]')).toBeDisabled();
    await installPlaybackElement(page);

    const offsetBefore = await page.locator('#offset-val-0').textContent();

    // The role chip shows the track's colour without a role, and · on it.
    await expect(page.locator('.track-header .role-chip-face').first()).toHaveText('·');

    await domClick(page, '[data-action="toggle-playback"]');
    await expect(page.locator('[data-action="toggle-playback"]')).toHaveClass(/is-playing/);
    await expect(page.locator('[data-action="stop-playback"]')).toBeEnabled();
    await domClick(page, '[data-action="stop-playback"]');
    await expect(page.locator('[data-action="toggle-playback"]')).not.toHaveClass(/is-playing/);

    await domClick(page, '[data-action="toggle-mute"]');
    await expect(page.locator('[data-action="toggle-mute"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.locator('#track-audio-0').evaluate((audio: HTMLAudioElement) => audio.muted)).toBe(true);
    await domClick(page, '[data-action="toggle-mute"]');
    expect(await page.locator('#track-audio-0').evaluate((audio: HTMLAudioElement) => audio.muted)).toBe(false);
    await domClick(page, '[data-action="offset-up"]');
    await expect(page.locator('#offset-val-0')).not.toHaveText(offsetBefore ?? '+0.000s');
    await domClick(page, '[data-action="offset-down"]');
    await expect(page.locator('#offset-val-0')).toHaveText(offsetBefore ?? '+0.000s');

    await domClick(page, '[data-action="remove-track"]');
    await expect(page.locator('.track-row')).toHaveCount(0);
});
