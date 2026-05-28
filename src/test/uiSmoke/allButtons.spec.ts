import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';

type PostedMessage = {
    type?: string;
    targetKind?: string;
    filePaths?: string[];
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

async function getDownloads(page: Page): Promise<Array<{ download: string; href: string }>> {
    return page.evaluate(() => {
        return ((window as typeof window & {
            __uiSmokeDownloads?: Array<{ download: string; href: string }>;
        }).__uiSmokeDownloads ?? []);
    });
}

async function getClipboardWrites(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        return ((window as typeof window & {
            __uiSmokeClipboardWrites?: string[];
        }).__uiSmokeClipboardWrites ?? []);
    });
}

async function getUiSmokeState(page: Page): Promise<{
    spectrumZoom?: {
        specFreqStart?: number;
        specFreqEnd?: number;
    };
}> {
    return page.evaluate(() => {
        return ((window as typeof window & {
            __uiSmokeState?: {
                spectrumZoom?: {
                    specFreqStart?: number;
                    specFreqEnd?: number;
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

async function getCanvasDataUrl(page: Page, selector: string): Promise<string> {
    return page.locator(selector).evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) {
            throw new Error(`Expected canvas for ${selector}`);
        }
        return element.toDataURL();
    });
}

async function domClick(page: Page, selector: string): Promise<void> {
    await page.locator(selector).first().evaluate((element) => {
        (element as HTMLElement).click();
    });
}

test('results-toolbar buttons either change UI state or emit a VS Code side effect', async ({ page }) => {
    await loadResultsUi(page);

    const toolbar = page.locator('#toolbar');

    await toolbar.locator('[data-action="open-file"]').click({ force: true });
    await toolbar.locator('[data-action="open-folder"]').click({ force: true });
    await toolbar.locator('[data-action="select-python-environment"]').click({ force: true });

    await toolbar.locator('[data-action="zoom-in"]').click({ force: true });
    await toolbar.locator('[data-action="zoom-out"]').click({ force: true });
    await toolbar.locator('[data-action="zoom-reset"]').click({ force: true });

    await toolbar.locator('[data-action="content-spectrogram"]').click({ force: true });
    await expect(toolbar.locator('[data-action="content-spectrogram"]')).toHaveClass(/is-active/);
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

    await toolbar.locator('[data-action="run-recipe"]').click({ force: true });
    await toolbar.locator('[data-action="copy-spec"]').click({ force: true });
    await toolbar.locator('[data-action="export-png"]').click({ force: true });
    await toolbar.locator('[data-action="export-csv"]').click({ force: true });
    await toolbar.locator('[data-action="export-wav"]').click({ force: true });
    await toolbar.locator('[data-action="export-report"]').click({ force: true });

    const messages = await getPostedMessages(page);
    expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'select-target', targetKind: 'file' }),
        expect.objectContaining({ type: 'select-target', targetKind: 'directory' }),
        expect.objectContaining({ type: 'select-python-environment' }),
        expect.objectContaining({ type: 'request-reanalyze' }),
        expect.objectContaining({ type: 'export-report-options' }),
    ]));
});

test('clicking every selection-toolbar button produces the expected GUI-side reaction', async ({ page }) => {
    await loadSelectionUi(page);

    const toolbar = page.locator('#selection-toolbar');
    const directory = page.locator('.selection-tree-directory').first();

    await toolbar.locator('[data-action="open-file"]').click({ force: true });
    await toolbar.locator('[data-action="open-folder"]').click({ force: true });
    await toolbar.locator('[data-action="select-python-environment"]').click({ force: true });
    await page.locator('[data-action="selection-select-all"]').click({ force: true });
    await expect(page.locator('#selection-count')).toContainText('2 / 2');
    await page.locator('[data-action="selection-clear-all"]').click({ force: true });
    await expect(page.locator('#selection-count')).toContainText('0 / 2');
    await directory.click({ force: true });
    await expect(directory).toHaveAttribute('aria-expanded', 'false');

    const messages = await getPostedMessages(page);
    expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'select-target', targetKind: 'file' }),
        expect.objectContaining({ type: 'select-target', targetKind: 'directory' }),
        expect.objectContaining({ type: 'select-python-environment' }),
        expect.objectContaining({ type: 'analyze-selected-files', filePaths: ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'] }),
        expect.objectContaining({ type: 'analyze-selected-files', filePaths: [] }),
    ]));
});

test('clicking every track control changes the per-track UI or its side effects', async ({ page }) => {
    await loadResultsUi(page);
    await installPlaybackElement(page);

    const offsetBefore = await page.locator('#offset-val-0').textContent();

    await page.locator('[data-action="pick-color"]').click({ force: true });
    await expect(page.locator('#color-picker-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#color-picker-popover')).toBeHidden();

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
