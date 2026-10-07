import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderComparisonDocument } from '../../webview/panels/comparisonDocument';
import { getChartSpecRenderScript } from '../../webview/chartSpecRenderScript';
import { DEFAULT_SPECTROGRAM_SETTINGS } from '../../shared/analysis/analysisTypes';
import { buildUiSmokeHtml } from './buildHtml';

async function loadUi(page: Page) {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
}

for (const clearSources of [true, false]) {
test(clearSources ? 'clearing a pending browser recipe keeps the cleared status' : 'removing one browser recipe input ignores late charts', async ({ page }) => {
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
                if (command.cmd === 'run-recipe') {
                    window.__pendingRecipe = command;
                    window.__completeRecipe = () => this.onmessage({ data: { requestId: command.requestId,
                        result: { charts: [{ kind: 'scalar', title: 'Late', rows: [] }] } } });
                    return;
                }
                const result = command.cmd === 'load' ? { filePath: '/sources/' + command.sourceId }
                    : { ...fixtures.find(entry => entry.command === command.cmd)?.response, filePath: command.filePath };
                queueMicrotask(() => this.onmessage({ data: { requestId: command.requestId, result } }));
            }
        };
    ` });
    await page.addScriptTag({ content: readFileSync(join(process.cwd(), 'dist/webview/staticHost.js'), 'utf8') });
    await page.locator('[data-action="browser-open-wav"]').setInputFiles({ name: 'selected.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(100) });
    await expect(page.locator('[role="status"]')).toContainText('selected.wav:');
    if (!clearSources) {
        await page.locator('[data-action="browser-open-wav"]').setInputFiles({ name: 'second.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(100) });
        await expect(page.locator('[role="status"]')).toContainText('second.wav:');
    }
    await page.evaluate(() => {
        (window as typeof window & { __AWA_HOST__: { postMessage(message: unknown): void } }).__AWA_HOST__.postMessage({ type: 'run-recipe' });
    });
    await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __pendingRecipe?: unknown }).__pendingRecipe))).toBe(true);
    const expected = clearSources
        ? await page.evaluate(() => (window as typeof window & { __APP_STRINGS__: { browserCleared: string } }).__APP_STRINGS__.browserCleared)
        : await page.locator('[role="status"]').textContent();
    if (clearSources) await page.locator('[data-action="browser-clear"]').click();
    else await page.evaluate(() => {
        (window as typeof window & { __AWA_HOST__: { releaseSource(path: string): void } }).__AWA_HOST__.releaseSource('/sources/selected-1.wav');
    });
    await page.evaluate(() => (window as typeof window & { __completeRecipe(): void }).__completeRecipe());
    await expect(page.locator('[role="status"]')).toHaveText(expected!);
    await expect(page.locator('[data-recipe-result]')).toHaveCount(0);
});
}

test('static page CSP allows recipe charts and calibration clicks report unsupported functionality', async ({ page }) => {
    const cspErrors: string[] = [];
    page.on('console', message => {
        if (/Content Security Policy|violates.*directive/i.test(message.text())) cspErrors.push(message.text());
    });
    const fixtures = JSON.parse(readFileSync(join(process.cwd(), 'src/test/fixtures/backendProtocol.json'), 'utf8')).validResponses;
    const init = `window.prompt = () => '1';
        const fixtures = ${JSON.stringify(fixtures)};
        window.Worker = class {
            terminate() {}
            postMessage(command) {
                const result = command.cmd === 'load' ? { filePath: '/sources/' + command.sourceId }
                    : command.cmd === 'run-recipe' ? { charts: [{ kind: 'scalar', title: 'Peak', rows: [] }] }
                    : { ...fixtures.find(entry => entry.command === command.cmd)?.response, filePath: command.filePath,
                        ...(command.cmd === 'analyze' ? { channelCount: 1, channels: [{ label: 'Channel 1', peakAbsolute: 1,
                            waveform: { min: [-1], max: [1], samples: [0], absolutePeak: 1 }, spectrogram: null }] } : {}) };
                queueMicrotask(() => this.onmessage({ data: { requestId: command.requestId, result } }));
            }
        };`;
    const html = renderComparisonDocument({ mode: 'results', results: [], spectrogramSettings: DEFAULT_SPECTROGRAM_SETTINGS }, {
        waveformScriptUri: './comparisonWaveform.js', runtimeScriptUri: './comparisonRuntime.js', hostScriptUri: './staticHost.js', cspSource: "'self'", language: 'en',
    });
    await page.route('http://awa.test/**', async route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        if (!name) { await route.fulfill({ contentType: 'text/html', body: html }); return; }
        if (name.startsWith('recipes/')) {
            await route.fulfill({ json: name.endsWith('manifest.json')
                ? [{ name: 'octave.json', location: './recipes/octave.json' }]
                : { inputs: [{ name: 'sig', file: '{{selection}}' }], steps: [], display: [] } });
            return;
        }
        const body = name === 'chartSpec.js' ? getChartSpecRenderScript()
            : (name === 'staticHost.js' ? init : '') + readFileSync(join(process.cwd(), 'dist/webview', name), 'utf8');
        await route.fulfill({ contentType: 'text/javascript', body });
    });
    await page.goto('http://awa.test/');
    await page.locator('[data-action="browser-open-wav"]').setInputFiles({ name: 'selected.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(100) });
    await expect(page.locator('[data-action="configure-calibration"]')).toHaveCount(1);
    await page.locator('[data-action="configure-calibration"]').click();
    const unsupported = await page.evaluate(() => (window as typeof window & { __APP_STRINGS__: { browserUnavailable: string } }).__APP_STRINGS__.browserUnavailable);
    await expect(page.locator('span[role="status"]')).toHaveText(unsupported);
    await page.evaluate(() => {
        (window as typeof window & { __AWA_HOST__: { postMessage(message: unknown): void } }).__AWA_HOST__.postMessage({ type: 'run-recipe' });
    });
    await expect(page.frameLocator('[data-recipe-result] iframe').locator('.chart-title')).toHaveText('Peak');
    await expect(page.frameLocator('[data-recipe-result] iframe').locator('.chart-title')).toBeVisible();
    expect(cspErrors).toEqual([]);
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
