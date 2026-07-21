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

async function openToolbarMenu(page: Page, index: number): Promise<void> {
    const menu = page.locator('#toolbar details.tb-menu').nth(index);
    await menu.locator('summary').evaluate((element) => {
        (element as HTMLElement).click();
    });
    await expect(menu).toHaveAttribute('open', '');
}

test('toolbar message assertions ignore initial comparison-panel test snapshots', async ({ page }) => {
    await loadUi(page);
    await page.evaluate(() => {
        (window as typeof window & {
            __uiSmokePostedMessages?: Array<{ type?: string }>;
        }).__uiSmokePostedMessages = [{ type: 'comparison-panel-test-snapshot' }];
    });

    await openToolbarMenu(page, 1);
    await page.locator('[data-action="run-recipe"]').click({ force: true });
    await openToolbarMenu(page, 2);
    await page.locator('[data-action="export-report"]').click({ force: true });

    expect(await getPostedActionTypes(page)).toEqual([
        'run-recipe',
        'export-report-options',
    ]);
});

test('results toolbar posts VS Code messages for recipe run and report export', async ({ page }) => {
    await loadUi(page);

    await openToolbarMenu(page, 1);
    await page.locator('[data-action="run-recipe"]').click({ force: true });
    await openToolbarMenu(page, 2);
    await page.locator('[data-action="export-report"]').click({ force: true });

    expect(await getPostedActionTypes(page)).toEqual([
        'run-recipe',
        'export-report-options',
    ]);
});

test('spectrogram settings apply refreshes detail without reanalyzing summaries', async ({ page }) => {
    await loadUi(page);

    await page.locator('[data-action="content-spectrogram"]').click({ force: true });
    await page.locator('[data-action="spectrogram-settings"]').click({ force: true });
    await expect(page.locator('#spec-settings-popover')).toBeVisible();

    await page.locator('#spec-auto').uncheck();
    await page.locator('#spec-nfft').selectOption('1024');
    await page.locator('#spec-hop').fill('256');
    await page.locator('#spec-window').selectOption('hann');
    await page.locator('#spec-apply').click({ force: true });

    const messages = await page.evaluate(() => (window as any).__uiSmokePostedMessages || []);
    expect(messages.some((message: any) => message.type === 'request-reanalyze')).toBe(false);
    expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'update-spectrogram-settings' }),
        expect.objectContaining({
            type: 'request-track-detail',
            stftOptions: { nFft: 1024, hopSize: 256, window: 'hann' },
        }),
    ]));
});

test('spectrogram settings reset refreshes the spectrum immediately', async ({ page }) => {
    await loadUi(page);

    await page.locator('[data-action="content-spectrogram"]').click({ force: true });
    await page.locator('[data-action="spectrogram-settings"]').click({ force: true });
    await page.locator('#spec-auto').uncheck();
    await page.locator('#spec-nfft').selectOption('2048');
    await page.locator('#spec-apply').click({ force: true });
    await page.locator('[data-action="spectrogram-settings"]').click({ force: true });
    const requestsBefore = await page.evaluate(() =>
        ((window as any).__uiSmokePostedMessages || []).filter((message: any) => message.type === 'request-spectrum-slice').length,
    );

    await page.locator('#spec-reset').click({ force: true });
    await page.waitForFunction((count) =>
        ((window as any).__uiSmokePostedMessages || []).filter((message: any) => message.type === 'request-spectrum-slice').length > count,
    requestsBefore);

    const requests = await page.evaluate(() =>
        ((window as any).__uiSmokePostedMessages || []).filter((message: any) => message.type === 'request-spectrum-slice'),
    );
    expect(requests.at(-1)).toEqual(expect.objectContaining({
        stftOptions: null,
    }));
});
