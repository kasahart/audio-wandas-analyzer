import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderComparisonDocument } from '../../webview/panels/comparisonDocument';
import { DEFAULT_SPECTROGRAM_SETTINGS } from '../../shared/analysis/analysisTypes';
import { buildUiSmokeHtml } from './buildHtml';

// The Worker posts `{requestId, result}`; the fixture lines carry `requestId` beside the result fields.
function workerFixture(entry: { command: string; response: Record<string, unknown> }) {
    const { requestId: _requestId, ...response } = entry.response;
    return { ...entry, response };
}

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
        const fixtures = ${JSON.stringify(fixtures.validResponses.map(workerFixture))};
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
                    : command.cmd === 'limits' ? { maxInputBytes: 16777216, maxSources: 8, maxTotalInputBytes: 67108864, maxExportBytes: 33554432 }
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

function staticWorkerInit(): string {
    const fixtures = JSON.parse(readFileSync(join(process.cwd(), 'src/test/fixtures/backendProtocol.json'), 'utf8')).validResponses;
    return `window.prompt = () => '1';
        const fixtures = ${JSON.stringify(fixtures.map(workerFixture))};
        window.Worker = class {
            terminate() {}
            postMessage(command) {
                const result = command.cmd === 'load' ? { filePath: '/sources/' + command.sourceId }
                    : command.cmd === 'limits' ? { maxInputBytes: 16777216, maxSources: 8, maxTotalInputBytes: 67108864, maxExportBytes: 33554432 }
                    : command.cmd === 'run-recipe' ? { charts: [{ kind: 'scalar', title: 'Peak', rows: [] }] }
                    : { ...fixtures.find(entry => entry.command === command.cmd)?.response, filePath: command.filePath,
                        ...(command.cmd === 'analyze' ? { channelCount: 1, channels: [{ label: 'Channel 1', peakAbsolute: 1,
                            waveform: { min: [-1], max: [1], samples: [0], absolutePeak: 1 }, spectrogram: null }] } : {}) };
                queueMicrotask(() => this.onmessage({ data: { requestId: command.requestId, result } }));
            }
        };`;
}

/** Serves the Pages build (static host + modular runtime) with a fixture Worker in place of Pyodide. */
async function openStaticPage(page: Page, extraInit = ''): Promise<void> {
    const init = staticWorkerInit() + extraInit;
    const html = renderComparisonDocument({ mode: 'results', results: [], spectrogramSettings: DEFAULT_SPECTROGRAM_SETTINGS }, {
        waveformScriptUri: './comparisonWaveform.js', runtimeScriptUri: './comparisonRuntime.js', hostScriptUri: './staticHost.js', cspSource: "'self'", language: 'en', appVersion: '0.0.0',
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
        const body = (name === 'staticHost.js' ? init : '') + readFileSync(join(process.cwd(), 'dist/webview', name), 'utf8');
        await route.fulfill({ contentType: 'text/javascript', body });
    });
    await page.goto('http://awa.test/');
}

test('static page CSP allows recipe charts and calibration clicks report unsupported functionality', async ({ page }) => {
    const cspErrors: string[] = [];
    page.on('console', message => {
        if (/Content Security Policy|violates.*directive/i.test(message.text())) cspErrors.push(message.text());
    });
    await openStaticPage(page);
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


test('static page prompts in the empty results pane and keeps limits behind the About disclosure', async ({ page }) => {
    await openStaticPage(page);
    const strings = await page.evaluate(() => (window as typeof window & { __APP_STRINGS__: Record<string, string> }).__APP_STRINGS__);
    await expect(page.locator('#empty-state')).toHaveText(strings.browserEmptyPrompt);
    await expect(page.locator('span[role="status"]')).toHaveText('');
    const panel = page.locator('[data-browser-about] ul');
    await expect(panel).toBeHidden();
    await page.locator('[data-action="browser-about"]').click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(strings.browserAboutFileLimits);
    await expect(panel).toContainText(strings.browserAboutSessionLimits);
    await expect(panel).toContainText(strings.browserAboutUnsupported);
    await page.mouse.click(700, 400);
    await expect(panel).toBeHidden();
    await page.locator('[data-action="browser-about"]').click();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await page.locator('[data-action="browser-open-wav"]').setInputFiles({ name: 'selected.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(100) });
    await expect(page.locator('#empty-state')).toBeHidden();
    await page.locator('[data-action="remove-track"]').click();
    await expect(page.locator('#empty-state')).toHaveText(strings.browserEmptyPrompt);
});

test('static page opens a folder into the shared selection tree and checked files become tracks', async ({ page }) => {
    const folder = mkdtempSync(join(tmpdir(), 'awa-folder-'));
    mkdirSync(join(folder, 'rec', 'day2'), { recursive: true });
    writeFileSync(join(folder, 'rec', 'first.wav'), Buffer.alloc(100));
    writeFileSync(join(folder, 'rec', 'day2', 'second.wav'), Buffer.alloc(100));
    writeFileSync(join(folder, 'rec', 'notes.txt'), 'not audio');
    // Browsers without the File System Access picker fall back to the folder input.
    await openStaticPage(page, 'window.showDirectoryPicker = undefined;');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('[data-action="browser-open-folder"]').click();
    await (await chooser).setFiles(join(folder, 'rec'));
    await expect(page.locator('#selection-sidebar')).toBeVisible();
    await expect(page.locator('#selection-summary .selection-path')).toHaveText('/sources/rec');
    await expect(page.locator('.selection-file-checkbox')).toHaveCount(2);
    await expect(page.locator('#selection-python-environment')).toHaveCount(0);
    await expect(page.locator('#selection-results-pane #toolbar')).toHaveCount(1);
    await expect(page.locator('#directory-selection-layout')).toBeInViewport({ ratio: 1 });
    await page.locator('.selection-file-checkbox[data-file-path="/sources/rec/first.wav"]').check();
    await expect(page.locator('.track-row')).toHaveCount(1);
    await expect(page.locator('#selection-count')).toContainText('1 / 2');
    await page.locator('[data-action="selection-select-all"]').click();
    await expect(page.locator('.track-row')).toHaveCount(2);
    await page.locator('.selection-file-checkbox[data-file-path="/sources/rec/first.wav"]').uncheck();
    await expect(page.locator('.track-row')).toHaveCount(1);
    await expect(page.locator('.selection-file-checkbox[data-file-path="/sources/rec/day2/second.wav"]')).toBeChecked();
    await page.locator('[data-action="browser-clear"]').click();
    await expect(page.locator('.track-row')).toHaveCount(0);
    await expect(page.locator('.selection-file-checkbox:checked')).toHaveCount(0);

    await page.locator('#tree-filter-input').fill('second');
    const sameName = mkdtempSync(join(tmpdir(), 'awa-folder-'));
    mkdirSync(join(sameName, 'rec'));
    writeFileSync(join(sameName, 'rec', 'third.wav'), Buffer.alloc(100));
    const nextChooser = page.waitForEvent('filechooser');
    await page.locator('#selection-toolbar [data-action="open-folder"]').click();
    await (await nextChooser).setFiles(join(sameName, 'rec'));
    await expect(page.locator('#tree-filter-input')).toHaveValue('');
    await expect(page.locator('.selection-file-checkbox[data-file-path="/sources/rec/third.wav"]')).toBeVisible();
    await page.locator('.selection-file-checkbox').check();
    await expect(page.locator('.track-row')).toHaveCount(1);

    const fileChooser = page.waitForEvent('filechooser');
    await page.locator('#selection-toolbar [data-action="open-file"]').click();
    await (await fileChooser).setFiles({ name: 'single.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(100) });
    await expect(page.locator('#directory-selection-layout')).toHaveCount(0);
    await expect(page.locator('.track-row')).toHaveCount(2);
});

test('static page loads WAV files dropped onto the page or the recipe charts as tracks', async ({ page }) => {
    await openStaticPage(page);
    const dropFiles = (type: 'dragover' | 'drop', names: string[], intoRecipe = false) => page.evaluate(({ type, names, intoRecipe }) => {
        const target = intoRecipe ? document.querySelector('[data-recipe-result] iframe') as HTMLIFrameElement : undefined;
        const view = target ? target.contentWindow! as typeof window : window;
        const transfer = new view.DataTransfer();
        for (const name of names) transfer.items.add(new view.File([new Uint8Array(100)], name));
        view.document.body.dispatchEvent(new view.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, { type, names, intoRecipe });
    const outline = page.locator('[data-drop-target]');
    await dropFiles('dragover', ['dropped.wav']);
    await expect(outline).toBeInViewport({ ratio: 1 });
    await dropFiles('drop', ['notes.txt']);
    const noWav = await page.evaluate(() => (window as typeof window & { __APP_STRINGS__: { browserDropNoWav: string } }).__APP_STRINGS__.browserDropNoWav);
    await expect(page.locator('span[role="status"]')).toHaveText(noWav);
    await expect(outline).toBeHidden();
    await dropFiles('drop', ['dropped.wav', 'notes.txt', 'second.WAV']);
    await expect(page.locator('.track-row')).toHaveCount(2);
    await expect(page.locator('span[role="status"]')).toContainText('second.WAV:');

    await page.evaluate(() => {
        (window as typeof window & { __AWA_HOST__: { postMessage(message: unknown): void } }).__AWA_HOST__.postMessage({ type: 'run-recipe' });
    });
    await expect(page.frameLocator('[data-recipe-result] iframe').locator('.chart-title')).toHaveText('Peak');
    await dropFiles('dragover', ['third.wav'], true);
    await expect(outline).toBeVisible();
    await dropFiles('drop', ['third.wav'], true);
    await expect(page.locator('.track-row')).toHaveCount(3);
    await expect(outline).toBeHidden();
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

test('static page opens a folder through the File System Access picker without the input upload prompt', async ({ page }) => {
    await openStaticPage(page, `window.showDirectoryPicker = async () => {
        const file = name => ({ kind: 'file', name, getFile: async () => new File([new Uint8Array(100)], name, { type: 'audio/wav' }) });
        const dir = (name, entries) => ({ kind: 'directory', name, values: async function* () { yield* entries; } });
        return dir('rec', [file('b.wav'), file('notes.txt'), dir('day2', [file('a.WAV')])]);
    };`);
    page.on('filechooser', () => { throw new Error('the folder input must not open when the picker exists'); });
    await page.locator('[data-action="browser-open-folder"]').click();
    await expect(page.locator('.selection-file-checkbox')).toHaveCount(2);
    await expect(page.locator('#selection-summary .selection-path')).toHaveText('/sources/rec');
    await page.locator('.selection-file-checkbox[data-file-path="/sources/rec/day2/a.WAV"]').check();
    await expect(page.locator('.track-row')).toHaveCount(1);
});
