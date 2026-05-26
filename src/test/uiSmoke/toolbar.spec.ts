import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml } from './buildHtml';

async function loadUi(page: Page) {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
}

async function getPostedActionTypes(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const messages = (window as typeof window & {
            __uiSmokePostedMessages?: Array<{ type?: string }>;
        }).__uiSmokePostedMessages ?? [];
        return messages
            .map((message) => message.type ?? '')
            .filter((type) => type !== 'comparison-panel-test-snapshot');
    });
}

test('toolbar message assertions ignore initial comparison-panel test snapshots', async ({ page }) => {
    await loadUi(page);
    await page.evaluate(() => {
        (window as typeof window & {
            __uiSmokePostedMessages?: Array<{ type?: string }>;
        }).__uiSmokePostedMessages = [{ type: 'comparison-panel-test-snapshot' }];
    });

    await page.locator('[data-action="select-python-environment"]').click({ force: true });
    await page.locator('[data-action="run-recipe"]').click({ force: true });
    await page.locator('[data-action="export-report"]').click({ force: true });

    expect(await getPostedActionTypes(page)).toEqual([
        'select-python-environment',
        'run-recipe',
        'export-report-options',
    ]);
});

test('results toolbar posts VS Code messages for Python selection, recipe run, and report export', async ({ page }) => {
    await loadUi(page);

    await page.locator('[data-action="select-python-environment"]').click({ force: true });
    await page.locator('[data-action="run-recipe"]').click({ force: true });
    await page.locator('[data-action="export-report"]').click({ force: true });

    expect(await getPostedActionTypes(page)).toEqual([
        'select-python-environment',
        'run-recipe',
        'export-report-options',
    ]);
});

test('spectrogram settings apply posts a reanalyze request', async ({ page }) => {
    await loadUi(page);

    await page.locator('[data-action="content-spectrogram"]').click({ force: true });
    await page.locator('[data-action="spectrogram-settings"]').click({ force: true });
    await expect(page.locator('#spec-settings-popover')).toBeVisible();

    await page.locator('#spec-auto').uncheck();
    await page.locator('#spec-nfft').selectOption('1024');
    await page.locator('#spec-hop').fill('256');
    await page.locator('#spec-apply').click({ force: true });

    expect((await getPostedActionTypes(page)).at(-1)).toBe('request-reanalyze');
});
