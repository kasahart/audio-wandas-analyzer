import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUiSmokeHtml } from './buildHtml';

async function loadUi(page: Page) {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
}

test('clearing a pending browser recipe keeps the cleared status', async ({ page }) => {
    const fixtures = JSON.parse(readFileSync(join(process.cwd(), 'src/test/fixtures/backendProtocol.json'), 'utf8'));
    await page.setContent('<html><body></body></html>');
    await page.addScriptTag({ content: `
        window.__APP_STATE__ = {};
        window.prompt = () => '1';
        const fixtures = ${JSON.stringify(fixtures.validResponses)};
        window.fetch = async url => ({ ok: true, json: async () => url.endsWith('manifest.json')
            ? [{ name: 'octave.json', location: './recipes/octave.json' }]
            : { inputs: [{ name: 'sig', file: '{{selection}}' }], steps: [], display: [] } });
        window.Worker = class {
            terminate() {}
            postMessage(command) {
                if (command.cmd === 'run-recipe') { window.__pendingRecipe = command; return; }
                const result = command.cmd === 'load' ? { filePath: '/sources/' + command.sourceId }
                    : { ...fixtures.find(entry => entry.command === command.cmd).response, filePath: command.filePath };
                queueMicrotask(() => this.onmessage({ data: { requestId: command.requestId, result } }));
            }
        };
    ` });
    await page.addScriptTag({ content: readFileSync(join(process.cwd(), 'dist/webview/staticHost.js'), 'utf8') });
    await page.locator('[data-action="browser-open-wav"]').setInputFiles({ name: 'selected.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(100) });
    await expect(page.locator('[role="status"]')).toContainText('selected.wav:');
    await page.evaluate(() => {
        (window as typeof window & { __AWA_HOST__: { postMessage(message: unknown): void } }).__AWA_HOST__.postMessage({ type: 'run-recipe' });
    });
    await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __pendingRecipe?: unknown }).__pendingRecipe))).toBe(true);
    await page.locator('[data-action="browser-clear"]').click();
    const cleared = await page.evaluate(() => (window as typeof window & { __APP_STRINGS__: { browserCleared: string } }).__APP_STRINGS__.browserCleared);
    await expect(page.locator('[role="status"]')).toHaveText(cleared);
    await expect(page.locator('[data-recipe-result]')).toHaveCount(0);
});

async function getPostedActionTypes(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const messages = (window as typeof window & {
            __uiSmokePostedMessages?: Array<{ type?: string }>;
        }).__uiSmokePostedMessages ?? [];
        return messages
            .map((message) => message.type ?? '')
            .filter((type) => type !== 'comparison-panel-test-snapshot'
                && type !== 'comparison-panel-ready'
                && type !== 'request-spectrum-slice');
    });
}

async function openToolbarMenu(page: Page, index: number): Promise<void> {
    const menu = page.locator('#toolbar details.tb-menu').nth(index);
    await menu.locator('summary').evaluate((element) => {
        (element as HTMLElement).click();
    });
    await expect(menu).toHaveAttribute('open', '');
}

test('toolbar message assertions ignore initial panel bootstrap messages', async ({ page }) => {
    await loadUi(page);
    await page.evaluate(() => {
        (window as typeof window & {
            __uiSmokePostedMessages?: Array<{ type?: string }>;
        }).__uiSmokePostedMessages = [
            { type: 'comparison-panel-test-snapshot' },
            { type: 'comparison-panel-ready' },
        ];
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
