import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderComparisonDocument } from '../../webview/panels/comparisonDocument';
import { DEFAULT_SPECTROGRAM_SETTINGS } from '../../shared/analysis/analysisTypes';
import { buildUiSmokeHtml } from './buildHtml';
import { getStrings } from '../../shared/i18n/strings';

// The Worker posts `{requestId, result}`; the fixture lines carry `requestId` beside the result fields.
function workerFixture(entry: { command: string; response: Record<string, unknown> }) {
    const { requestId: _requestId, ...response } = entry.response;
    return { ...entry, response };
}

/** An opened folder starts with the entry table in the side panel beside the tracks (⤢ widens it). */
async function leaveEntryTable(page: Page) {
    await expect(page.locator('#entry-screen')).toBeVisible();
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
}

/** A file's row in the side panel's entry table. */
/** A mono 16-bit WAV of 28 silent samples: its header says one channel, as the entry table reads it at open. */
function tinyWav(): Buffer {
    const wav = Buffer.alloc(100);
    wav.write('RIFF', 0); wav.writeUInt32LE(92, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(56, 40);
    return wav;
}
const WAV_BYTES = Array.from(tinyWav());
const entryRow = (page: Page, filePath: string) => page.locator(`#entry-dock tr[data-file-path="${filePath}"]`);

/** A row's ▶ (shown on the row under the pointer): the file becomes a track. */
async function showRow(page: Page, filePath: string) {
    await entryRow(page, filePath).hover();
    await entryRow(page, filePath).locator('[data-action="entry-row-play"]').click();
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
        const fixtures = ${JSON.stringify(fixtures.validResponses.map(workerFixture))};
        window.fetch = async url => ({ ok: true, json: async () => url.endsWith('manifest.json')
            ? [{ name: 'octave.json', location: './recipes/octave.json' }]
            : { schema: 'wandas.recipe', version: 2, inputs: [{ id: 'input-0', name: 'signal', kind: 'frame' }], nodes: [], output: 'input-0' } });
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
    await page.locator('[data-action="browser-open-wav"]').setInputFiles({ name: 'selected.wav', mimeType: 'audio/wav', buffer: tinyWav() });
    await expect(page.locator('[role="status"]')).toContainText('selected.wav:');
    if (!clearSources) {
        await page.locator('[data-action="browser-open-wav"]').setInputFiles({ name: 'second.wav', mimeType: 'audio/wav', buffer: tinyWav() });
        await expect(page.locator('[role="status"]')).toContainText('second.wav:');
    }
    await page.evaluate(() => {
        (window as typeof window & { __AWA_HOST__: { postMessage(message: unknown): void } }).__AWA_HOST__.postMessage({ type: 'run-recipe' });
    });
    await page.locator('[data-recipe-picker] [data-action="browser-recipe-pick"]').first().click();
    if (!clearSources) await page.locator('[data-recipe-picker] [data-action="browser-recipe-run"]').click();
    await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __pendingRecipe?: unknown }).__pendingRecipe))).toBe(true);
    const expected = clearSources
        ? await page.evaluate(() => (window as typeof window & { __APP_STRINGS__: { browserCleared: string } }).__APP_STRINGS__.browserCleared)
        : await page.locator('[role="status"]').textContent();
    if (clearSources) await page.evaluate(() => {
        (window as typeof window & { __AWA_HOST__: { postMessage(message: unknown): void } }).__AWA_HOST__
            .postMessage({ type: 'analyze-selected-files', requestId: 'clear', filePaths: [] });
    });
    else await page.evaluate(() => {
        (window as typeof window & { __AWA_HOST__: { releaseSource(path: string): void } }).__AWA_HOST__.releaseSource('/sources/selected.wav');
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
                    : command.cmd === 'scan' ? { ok: true, conditionId: 'c', input: { id: 'i', fs: 16000, channels: [0], durationS: 2, unit: 'FS', ref: 1 },
                        leqDbA: [-20], peakHz: [1000], spectrumDb: [[-20]], thirdOctDb: [[-23]], crest: [1.4], specVersion: 1, wandasVersion: '0.9.0', elapsedMs: 1 }
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
                : { schema: 'wandas.recipe', version: 2, inputs: [{ id: 'input-0', name: 'signal', kind: 'frame' }], nodes: [], output: 'input-0' } });
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
    await page.locator('[data-action="browser-open-wav"]').setInputFiles({ name: 'selected.wav', mimeType: 'audio/wav', buffer: tinyWav() });
    const calibration = page.locator('[data-action="configure-calibration"]');
    await expect(calibration).toHaveCount(1);
    await expect(calibration).toHaveCSS('opacity', '0.4');
    const unsupported = await page.evaluate(() => (window as typeof window & { __APP_STRINGS__: { browserUnavailable: string } }).__APP_STRINGS__.browserUnavailable);
    await expect(page.locator('span[role="status"]')).toContainText('selected.wav:');
    const statusBefore = await page.locator('span[role="status"]').textContent();
    await calibration.hover();
    await expect(page.locator('#hint-footer')).toHaveText(unsupported);
    await page.mouse.move(700, 450);
    await calibration.click();
    await expect(page.locator('#hint-footer')).toHaveText(unsupported);
    await expect(page.locator('[aria-live="polite"]', { hasText: unsupported })).toHaveCount(1);
    await calibration.focus();
    await expect(calibration).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('span[role="status"]')).toHaveText(statusBefore!);
    await page.evaluate(() => {
        (window as typeof window & { __AWA_HOST__: { postMessage(message: unknown): void } }).__AWA_HOST__.postMessage({ type: 'run-recipe' });
    });
    await page.locator('[data-recipe-picker] [data-action="browser-recipe-pick"]').first().click();
    await expect(page.frameLocator('[data-recipe-result] iframe').locator('.chart-title')).toHaveText('Peak');
    await expect(page.frameLocator('[data-recipe-result] iframe').locator('.chart-title')).toBeVisible();
    expect(cspErrors).toEqual([]);
});


test('static page prompts in the empty results pane and keeps limits behind the About disclosure', async ({ page }) => {
    await openStaticPage(page);
    const strings = await page.evaluate(() => (window as typeof window & { __APP_STRINGS__: Record<string, string> }).__APP_STRINGS__);
    await expect(page.locator('#empty-state')).toHaveText(strings.browserEmptyPrompt);
    await expect(page.locator('span[role="status"]')).toHaveText('');
    // The selection panel is the only place that opens sources; its entry table waits for something to list.
    await expect(page.locator('#selection-sidebar')).toBeVisible();
    await expect(page.locator('#entry-screen')).toBeHidden();
    await expect(page.locator('#selection-toolbar [data-action="open-folder"]')).toHaveText(strings.btnOpenFolder);
    await expect(page.getByRole('button', { name: strings.btnOpenFile, exact: true })).toHaveCount(1);
    const indicator = page.locator('[data-python-indicator]');
    await expect(indicator).toHaveAttribute('data-hint', strings.browserPythonStarting);
    // The page has no header row: the status line, About and the Python dot sit in the footer row.
    const footerBox = (await page.locator('#web-footer').boundingBox())!;
    for (const part of ['span[role="status"]', '[data-action="browser-about"]']) {
        const partBox = (await page.locator(part).boundingBox())!;
        expect(partBox.y).toBeGreaterThanOrEqual(footerBox.y);
    }
    expect((await page.locator('#app').boundingBox())!.y).toBeLessThanOrEqual(1);
    const dotBox = (await indicator.boundingBox())!;
    expect(dotBox.y).toBeGreaterThanOrEqual(footerBox.y);
    expect(dotBox.x + dotBox.width).toBeLessThanOrEqual(footerBox.x + footerBox.width);
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#selection-toolbar [data-action="open-file"]').click();
    expect((await chooser).isMultiple()).toBe(true);
    const panel = page.locator('[data-browser-about] ul');
    await expect(panel).toBeHidden();
    await page.locator('[data-action="browser-about"]').click();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(strings.browserAboutFileLimits);
    await expect(panel).toContainText(strings.browserAboutSessionLimits);
    await expect(panel).toContainText(strings.browserAboutUnsupported);
    await page.locator('#empty-state').click();
    await expect(panel).toBeHidden();
    await page.setViewportSize({ width: 820, height: 900 });
    await page.locator('[data-action="browser-about"]').click();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(820);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(820);
    await page.locator('#empty-state').click();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.locator('[data-action="browser-about"]').click();
    await expect.poll(async () => { const opened = (await panel.boundingBox())!; return opened.y + opened.height; }).toBeLessThanOrEqual(footerBox.y);
    await page.setViewportSize({ width: 640, height: 900 });
    await expect.poll(async () => { const resized = (await panel.boundingBox())!; return resized.x + resized.width; }).toBeLessThanOrEqual(640);
    await page.locator('#empty-state').click();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.locator('[data-action="browser-about"]').click();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.locator('[data-action="browser-about"]')).toBeFocused();
    await page.locator('[data-action="browser-open-wav"]').setInputFiles({ name: 'selected.wav', mimeType: 'audio/wav', buffer: tinyWav() });
    await expect(page.locator('#empty-state')).toBeHidden();
    // A file opened on its own is a track at once, and a row of the entry table's "added files" in the side panel.
    await expect(entryRow(page, '/sources/selected.wav')).toHaveClass(/is-shown/);
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    await expect(page.locator('#selection-toolbar [data-action="open-folder"]')).toHaveText(strings.btnOpenAnotherFolder);
    await page.locator('[data-action="remove-track"]').click();
    await expect(page.locator('#empty-state')).toHaveText(strings.emptyNoTracks);
    await expect(entryRow(page, '/sources/selected.wav')).not.toHaveClass(/is-shown/);
});

test('static page opens a folder onto the entry table, whose rows become tracks with ▶ and leave with a lane\'s ×', async ({ page }) => {
    const folder = mkdtempSync(join(tmpdir(), 'awa-folder-'));
    mkdirSync(join(folder, 'rec', 'day2'), { recursive: true });
    writeFileSync(join(folder, 'rec', 'first.wav'), tinyWav());
    writeFileSync(join(folder, 'rec', 'day2', 'second.wav'), tinyWav());
    writeFileSync(join(folder, 'rec', 'notes.txt'), 'not audio');
    // Browsers without the File System Access picker fall back to the folder input.
    await openStaticPage(page, 'window.showDirectoryPicker = undefined;');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#selection-toolbar [data-action="open-folder"]').click();
    await (await chooser).setFiles(join(folder, 'rec'));
    await leaveEntryTable(page);
    await expect(page.locator('#selection-sidebar')).toBeVisible();
    await expect(page.locator('#entry-dock tr[data-file-path]')).toHaveCount(2);
    await expect(page.locator('#selection-python-environment')).toHaveCount(0);
    await expect(page.locator('#selection-results-pane #toolbar')).toHaveCount(1);
    await expect(page.locator('#directory-selection-layout')).toBeInViewport({ ratio: 1 });
    await showRow(page, '/sources/rec/first.wav');
    await expect(page.locator('.track-row')).toHaveCount(1);
    await expect(page.locator('#selection-rail-count')).toHaveText('1/2');
    await showRow(page, '/sources/rec/day2/second.wav');
    await expect(page.locator('.track-row')).toHaveCount(2);
    await expect(entryRow(page, '/sources/rec/first.wav')).toHaveClass(/is-shown/);
    // A lane's × takes its track off; the row stays, no longer bold.
    await page.locator('[data-action="remove-track"]').first().click();
    await expect(page.locator('.track-row')).toHaveCount(1);
    await expect(entryRow(page, '/sources/rec/day2/second.wav')).toHaveClass(/is-shown/);
    // Taking off the last track frees the audio but keeps the table.
    await page.locator('[data-action="remove-track"]').first().click();
    await expect(page.locator('.track-row')).toHaveCount(0);
    await expect(page.locator('#entry-dock tr[data-file-path]')).toHaveCount(2);
    // A click on a row shows its file as a track; a second click takes it off. The empty view says so.
    await expect(page.locator('#empty-state')).toHaveText(getStrings('en').emptyNoTracks);
    await entryRow(page, '/sources/rec/first.wav').locator('.entry-nm').click();
    await expect(page.locator('.track-row')).toHaveCount(1);
    await expect(entryRow(page, '/sources/rec/first.wav')).toHaveClass(/is-shown/);
    await expect(entryRow(page, '/sources/rec/first.wav').locator('td.entry-mark')).toHaveText('●');
    // A row in a slot goes off the tracks and out of its slot together, as a lane's × does.
    await entryRow(page, '/sources/rec/first.wav').locator('.entry-nm').click();
    await expect(page.locator('.track-row')).toHaveCount(0);
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    await expect(entryRow(page, '/sources/rec/first.wav')).toHaveClass(/is-shown/);
    await expect(entryRow(page, '/sources/rec/first.wav').locator('.entry-badge')).toHaveCount(1);
    await entryRow(page, '/sources/rec/first.wav').locator('.entry-col-value').click();
    await expect(entryRow(page, '/sources/rec/first.wav')).not.toHaveClass(/is-shown/);
    await expect(entryRow(page, '/sources/rec/first.wav').locator('.entry-badge')).toHaveCount(0);
    await entryRow(page, '/sources/rec/first.wav').locator('.entry-nm').click();
    await expect(page.locator('.track-row')).toHaveCount(1);
    // A double click counts once: the second row goes on and stays.
    await entryRow(page, '/sources/rec/day2/second.wav').locator('.entry-nm').dblclick();
    await expect(entryRow(page, '/sources/rec/day2/second.wav')).toHaveClass(/is-shown/);
    await entryRow(page, '/sources/rec/day2/second.wav').locator('.entry-nm').click();
    await expect(entryRow(page, '/sources/rec/day2/second.wav').locator('td.entry-mark')).toHaveText('○');
    // The row and its lane light up together under the mouse, from either side.
    await entryRow(page, '/sources/rec/first.wav').locator('.entry-col-ch').hover();
    await expect(page.locator('.track-row.is-linked')).toHaveCount(1);
    await page.locator('.track-row .track-header').first().hover();
    await expect(entryRow(page, '/sources/rec/first.wav')).toHaveClass(/is-linked/);
    // 「トラックのみ」 narrows the table to the rows on a track, and follows the tracks.
    const tracksOnly = page.locator('[data-action="entry-tracks-only"]');
    await expect(tracksOnly).toHaveText(getStrings('en').dsTracksOnly.replace('{n}', '1'));
    await tracksOnly.click();
    await expect(page.locator('#entry-dock tr[data-file-path]')).toHaveCount(1);
    // A lane's × takes the row off too.
    await page.locator('[data-action="remove-track"]').first().click();
    await expect(page.locator('.track-row')).toHaveCount(0);
    await expect(page.locator('#entry-dock tr[data-file-path]')).toHaveCount(0);
    await tracksOnly.click();
    await expect(page.locator('#entry-dock tr[data-file-path]')).toHaveCount(2);
    await expect(entryRow(page, '/sources/rec/first.wav')).not.toHaveClass(/is-shown/);
    await expect(tracksOnly).toHaveCount(0);
    // Maximized, a click on a row only picks it; its ● shows or takes off the track.
    await page.locator('#entry-screen [data-action="entry-maximize"]').click();
    await entryRow(page, '/sources/rec/first.wav').locator('.entry-nm').click();
    await expect(entryRow(page, '/sources/rec/first.wav')).not.toHaveClass(/is-shown/);
    await entryRow(page, '/sources/rec/first.wav').locator('td.entry-mark').click();
    await expect(entryRow(page, '/sources/rec/first.wav')).toHaveClass(/is-shown/);
    await entryRow(page, '/sources/rec/first.wav').locator('td.entry-mark').click();
    await expect(entryRow(page, '/sources/rec/first.wav')).not.toHaveClass(/is-shown/);
    await page.keyboard.press('Escape');
    await leaveEntryTable(page);

    const sameName = mkdtempSync(join(tmpdir(), 'awa-folder-'));
    mkdirSync(join(sameName, 'rec'));
    writeFileSync(join(sameName, 'rec', 'third.wav'), tinyWav());
    const nextChooser = page.waitForEvent('filechooser');
    await page.locator('#selection-toolbar [data-action="open-folder"]').click();
    await (await nextChooser).setFiles(join(sameName, 'rec'));
    await leaveEntryTable(page);
    // A second folder joins the table.
    await expect(page.locator('#entry-dock tr[data-file-path]')).toHaveCount(3);
    await showRow(page, '/sources/rec (2)/third.wav');
    await expect(page.locator('.track-row')).toHaveCount(1);

    // ＋ Add files: the file is a track at once, in the "added files" group at the top.
    const fileChooser = page.waitForEvent('filechooser');
    await page.locator('#selection-toolbar [data-action="open-file"]').click();
    await (await fileChooser).setFiles({ name: 'single.wav', mimeType: 'audio/wav', buffer: tinyWav() });
    await expect(entryRow(page, '/sources/single.wav')).toHaveClass(/is-shown/);
    await expect(entryRow(page, '/sources/rec (2)/third.wav')).toHaveClass(/is-shown/);
    await expect(page.locator('.track-row')).toHaveCount(2);
});

test('the table shows where a recording goes, keeps its exports reachable by keys, and hides them with the folded panel', async ({ page }) => {
    const folder = mkdtempSync(join(tmpdir(), 'awa-folder-'));
    mkdirSync(join(folder, 'rec'));
    writeFileSync(join(folder, 'rec', 'first.wav'), tinyWav());
    await openStaticPage(page, 'window.showDirectoryPicker = undefined;');
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#selection-toolbar [data-action="open-folder"]').click();
    await (await chooser).setFiles(join(folder, 'rec'));
    await leaveEntryTable(page);
    // Nothing compared yet: an empty slot 1 shows where a recording goes, and Enter lights it up.
    const slot1 = page.locator('[data-entry-slots] [data-action="entry-slot"][data-slot="1"]');
    await expect(slot1).toHaveClass(/is-empty/);
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('Enter');
    await expect(slot1).toHaveClass(/is-flash/);

    // The maximized table's 書き出し opens from the keyboard; Esc closes the menu before it shrinks the table.
    await page.locator('#entry-screen [data-action="entry-maximize"]').click();
    const menu = page.locator('#entry-export-menu');
    await menu.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(menu).not.toHaveAttribute('open', '');
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    // Esc on one of its items gives the focus back to the menu, not to the page.
    await menu.locator('summary').press('Enter');
    await menu.locator('[data-action="entry-export-csv"]').focus();
    await page.keyboard.press('Escape');
    await expect(menu).not.toHaveAttribute('open', '');
    await expect(menu.locator('summary')).toBeFocused();
    // So does Enter on one of its items.
    await menu.locator('summary').press('Enter');
    await menu.locator('[data-action="entry-export-notes"]').press('Enter');
    await expect(menu).not.toHaveAttribute('open', '');
    await expect(menu.locator('summary')).toBeFocused();
    // A press outside it closes it too.
    await menu.locator('summary').click();
    await expect(menu).toHaveAttribute('open', '');
    await page.locator('[data-entry-table]').click({ position: { x: 5, y: 5 } });
    await expect(menu).not.toHaveAttribute('open', '');
    await page.locator('#entry-screen [data-action="entry-maximize"]').click();

    // With the side panel folded, the table's exports leave the toolbar's 書き出し too.
    await page.locator('#tb-export-menu > summary').click();
    await expect(page.locator('#toolbar [data-action="entry-batch"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#selection-sidebar [data-action="toggle-selection-sidebar"]').click();
    await page.locator('#tb-export-menu > summary').click();
    await expect(page.locator('#toolbar [data-action="entry-batch"]')).toBeHidden();
});

test('static page recipe menu drops from the Export menu, stays in the window, closes on Escape and runs a local recipe file', async ({ page }) => {
    await openStaticPage(page);
    await page.locator('[data-action="browser-open-wav"]').setInputFiles({ name: 'selected.wav', mimeType: 'audio/wav', buffer: tinyWav() });
    await expect(page.locator('.track-row')).toHaveCount(1);
    const workflow = page.locator('#toolbar details.tb-menu').filter({ has: page.locator('[data-action="run-recipe"]') });
    const picker = page.locator('[data-recipe-picker]');
    await workflow.locator('summary').click();
    await workflow.locator('[data-action="run-recipe"]').click();
    await expect(picker).toBeVisible();
    await expect(workflow).not.toHaveAttribute('open', '');
    await expect(picker.locator('[data-action="browser-recipe-pick"]')).toHaveText(['octave']);
    const summaryBox = (await workflow.locator('summary').boundingBox())!;
    const pickerBox = (await picker.boundingBox())!;
    expect(pickerBox.x).toBeLessThanOrEqual(summaryBox.x + 1);
    expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 1280) - 7);
    expect(pickerBox.y).toBeGreaterThan(summaryBox.y + summaryBox.height - 1);
    await page.evaluate(() => {
        const keys: string[] = [];
        (window as typeof window & { __pageKeys?: string[] }).__pageKeys = keys;
        document.addEventListener('keydown', event => { keys.push(event.key); });
    });
    const pageKeys = () => page.evaluate(() => (window as typeof window & { __pageKeys: string[] }).__pageKeys);
    await picker.locator('[data-action="browser-recipe-file"]').hover();
    await expect(page.locator('#hint-footer')).toHaveText('Run a wandas .recipe.json from your computer');
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(page.locator('#hint-footer')).toHaveText('');
    expect(await pageKeys(), 'Escape closes only the menu').toEqual([]);

    await workflow.locator('summary').click();
    await workflow.locator('[data-action="run-recipe"]').click();
    await expect(picker.locator('[data-action="browser-recipe-pick"]')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.frameLocator('[data-recipe-result] iframe').locator('.chart-title')).toHaveText('Peak');
    await expect(page.locator('[data-recipe-result]')).toContainText('octave');
    expect(await pageKeys(), 'Space presses the menu item instead of reaching the playback shortcut').toEqual([]);

    await workflow.locator('summary').click();
    await workflow.locator('[data-action="run-recipe"]').click();
    await picker.locator('input[type="file"]').setInputFiles({ name: 'mine.recipe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(
        { schema: 'wandas.recipe', version: 2, inputs: [{ id: 'input-0', name: 'signal', kind: 'frame' }], nodes: [], output: 'input-0' })) });
    await expect(picker).toHaveCount(0);
    const result = page.locator('[data-recipe-result]');
    await expect(result).toContainText('mine');
    await expect(result).toContainText('signal: selected.wav');
    await expect(page.frameLocator('[data-recipe-result] iframe').locator('.chart-title')).toHaveText('Peak');

    // In a window too short for the menu, it scrolls instead of hiding its last item below the edge.
    await page.setViewportSize({ width: 1280, height: 110 });
    await workflow.locator('summary').click();
    await workflow.locator('[data-action="run-recipe"]').click();
    const shortBox = (await picker.boundingBox())!;
    expect(shortBox.y + shortBox.height).toBeLessThanOrEqual(110);
    await expect(picker).toHaveCSS('overflow-y', 'auto');
    await picker.locator('[data-action="browser-recipe-file"]').scrollIntoViewIfNeeded();
    await expect(picker.locator('[data-action="browser-recipe-file"]')).toBeInViewport();
});

test('static page loads WAV files dropped onto the page or the recipe charts as tracks', async ({ page }) => {
    await openStaticPage(page);
    const dropFiles = (type: 'dragover' | 'drop', names: string[], intoRecipe = false) => page.evaluate(({ type, names, intoRecipe, wav }) => {
        const target = intoRecipe ? document.querySelector('[data-recipe-result] iframe') as HTMLIFrameElement : undefined;
        const view = target ? target.contentWindow! as typeof window : window;
        const transfer = new view.DataTransfer();
        for (const name of names) transfer.items.add(new view.File([new Uint8Array(wav)], name));
        view.document.body.dispatchEvent(new view.DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, { type, names, intoRecipe, wav: WAV_BYTES });
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
    await page.locator('[data-recipe-picker] [data-action="browser-recipe-pick"]').first().click();
    // Two tracks for one input: the menu proposes the first and the user can pick the other before running.
    const input = page.locator('[data-recipe-picker] select[data-recipe-input="signal"]');
    await expect(input).toBeFocused();
    await expect(input.locator('option')).toHaveText(['dropped.wav', 'second.WAV']);
    await expect(input.locator('option:checked')).toHaveText('dropped.wav');
    await input.selectOption({ label: 'second.WAV' });
    await page.locator('[data-recipe-picker] [data-action="browser-recipe-run"]').click();
    await expect(page.locator('[data-recipe-picker]')).toHaveCount(0);
    await expect(page.locator('[data-recipe-result]')).toContainText('signal: second.WAV');
    await expect(page.frameLocator('[data-recipe-result] iframe').locator('.chart-title')).toHaveText('Peak');
    await dropFiles('dragover', ['third.wav'], true);
    await expect(outline).toBeVisible();
    await dropFiles('drop', ['third.wav'], true);
    await expect(page.locator('.track-row')).toHaveCount(3);
    await expect(outline).toBeHidden();

    // A dropped folder is walked through its entry and listed beside the files; its WAV files stay unchecked.
    await page.evaluate((wav) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([], 'rec'));
        const file = (name: string) => ({ isDirectory: false, name, file: (done: (file: File) => void) => done(new File([new Uint8Array(wav)], name)) });
        const dir = (name: string, entries: unknown[]) => ({ isDirectory: true, name, createReader: () => {
            let read = false;
            return { readEntries: (done: (batch: unknown[]) => void) => { done(read ? [] : entries); read = true; } };
        } });
        const root = dir('rec', [file('a.wav'), file('notes.txt'), dir('day2', [file('b.WAV')])]);
        Object.defineProperty(transfer, 'items', { value: [{ webkitGetAsEntry: () => root }] });
        document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, WAV_BYTES);
    await leaveEntryTable(page);
    await expect(entryRow(page, '/sources/rec/a.wav')).not.toHaveClass(/is-shown/);
    await expect(entryRow(page, '/sources/rec/day2/b.WAV')).not.toHaveClass(/is-shown/);
    await expect(page.locator('.track-row')).toHaveCount(3);
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

/** Opens one of the toolbar's menus: 'tb-export-menu' (every export) or 'tb-more-menu' (the other zoom tools). */
async function openToolbarMenu(page: Page, id: 'tb-export-menu' | 'tb-more-menu'): Promise<void> {
    const menu = page.locator(`#toolbar #${id}`);
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

    await openToolbarMenu(page, 'tb-export-menu');
    await page.locator('[data-action="run-recipe"]').click({ force: true });
    await openToolbarMenu(page, 'tb-export-menu');
    await page.locator('[data-action="export-report"]').click({ force: true });

    expect(await getPostedActionTypes(page)).toEqual([
        'run-recipe',
        'export-report-options',
    ]);
});

test('results toolbar posts VS Code messages for recipe run and report export', async ({ page }) => {
    await loadUi(page);

    await openToolbarMenu(page, 'tb-export-menu');
    await page.locator('[data-action="run-recipe"]').click({ force: true });
    await openToolbarMenu(page, 'tb-export-menu');
    await page.locator('[data-action="export-report"]').click({ force: true });

    expect(await getPostedActionTypes(page)).toEqual([
        'run-recipe',
        'export-report-options',
    ]);
});

test('spectrogram settings apply posts a reanalyze request', async ({ page }) => {
    await loadUi(page);

    await page.locator('[data-action="spectrogram-settings"]').click({ force: true });
    await expect(page.locator('#spec-settings-popover')).toBeVisible();

    await page.locator('#spec-auto').uncheck();
    await page.locator('#spec-nfft').selectOption('1024');
    await page.locator('#spec-overlap').selectOption('50');
    await page.locator('#spec-apply').click({ force: true });

    expect((await getPostedActionTypes(page)).at(-1)).toBe('request-reanalyze');
    const stft = await page.evaluate(() => {
        const messages = (window as typeof window & {
            __uiSmokePostedMessages?: Array<{ type?: string; settings?: { stft?: unknown } }>;
        }).__uiSmokePostedMessages ?? [];
        return messages.filter((message) => message.type === 'request-reanalyze').at(-1)?.settings?.stft;
    });
    expect(stft).toMatchObject({ nFft: 1024, overlapPercent: 50 });
});

test('a lane shows the waveform over its spectrogram on one time axis, split by a drag', async ({ page }) => {
    await loadUi(page);
    const wave = page.locator('#track-canvas-0');
    const spec = page.locator('#track-spec-canvas-0');
    await expect(wave).toBeVisible();
    await expect(spec).toBeVisible();
    const box = async () => ({ wave: (await wave.boundingBox())!, spec: (await spec.boundingBox())! });
    const before = await box();
    // Both plots start at the same time; the waveform stops where the spectrogram's colour bar begins.
    expect(before.wave.x).toBeCloseTo(before.spec.x, 0);
    expect(before.spec.y).toBeGreaterThan(before.wave.y + before.wave.height - 1);
    expect(before.spec.width - before.wave.width).toBeCloseTo(50, 0);
    // Hovering either plot moves the same cursor time.
    await page.mouse.move(before.spec.x + before.wave.width / 2, before.spec.y + before.spec.height / 2);
    const fromSpec = await page.locator('#cursor-display').textContent();
    await page.mouse.move(before.wave.x + before.wave.width / 2, before.wave.y + before.wave.height / 2);
    expect(await page.locator('#cursor-display').textContent()).toBe(fromSpec);
    // A click on the spectrogram gives the lane the keys: → moves the cursor.
    await spec.click({ position: { x: before.wave.width / 4, y: before.spec.height / 2 } });
    await expect(spec).toBeFocused();
    await page.mouse.move(0, 0);
    const clicked = await page.locator('#cursor-display').textContent();
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('#cursor-display')).not.toHaveText(clicked ?? '');
    // Box zoom is the waveform's: over the spectrogram the hint names the loop drag that will run.
    await page.locator('#tb-more-menu > summary').click();
    await page.locator('#toolbar [data-action="wave-mode-rect-zoom"]').click();
    await page.mouse.move(before.wave.x + before.wave.width / 3, before.wave.y + before.wave.height / 2);
    const waveHint = await page.locator('#hint-footer').textContent();
    await page.mouse.move(before.spec.x + before.wave.width / 3, before.spec.y + before.spec.height / 2);
    await expect(page.locator('#hint-footer')).not.toHaveText(waveHint ?? '');
    await page.locator('#tb-more-menu > summary').click();
    await page.locator('#toolbar [data-action="wave-mode-rect-zoom"]').click();

    const split = page.locator('.track-split').first();
    const handle = (await split.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 30, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await wave.boundingBox())!.height).toBeGreaterThan(before.wave.height + 20);
    const after = await box();
    expect(after.wave.height + after.spec.height).toBeCloseTo(before.wave.height + before.spec.height, 0);
    // Dragged to the top, the waveform keeps room for its axis.
    const moved = (await split.boundingBox())!;
    await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
    await page.mouse.down();
    await page.mouse.move(moved.x + moved.width / 2, moved.y - 400, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await wave.boundingBox())!.height).toBeLessThan(after.wave.height);
    expect((await wave.boundingBox())!.height).toBeGreaterThanOrEqual(39);

    // 比較解析 gives the lane to its plot: the spectrogram and the split hide.
    await page.locator('#toolbar [data-action="content-stage"]').click();
    await expect(spec).toBeHidden();
    await expect(split).toBeHidden();
    await page.locator('#toolbar [data-action="content-waveform"]').click();
    await expect(spec).toBeVisible();
});

test('static page opens a folder through the File System Access picker without the input upload prompt', async ({ page }) => {
    await openStaticPage(page, `window.showDirectoryPicker = async () => {
        const wavBytes = ${JSON.stringify(WAV_BYTES)};
        const file = name => ({ kind: 'file', name, getFile: async () => new File([new Uint8Array(wavBytes)], name, { type: 'audio/wav' }) });
        const dir = (name, entries) => ({ kind: 'directory', name, values: async function* () { yield* entries; } });
        return dir('rec', [file('b.wav'), file('notes.txt'), dir('day2', [file('a.WAV')])]);
    };`);
    page.on('filechooser', () => { throw new Error('the folder input must not open when the picker exists'); });
    await page.locator('#selection-toolbar [data-action="open-folder"]').click();
    await leaveEntryTable(page);
    await expect(page.locator('#entry-dock tr[data-file-path]')).toHaveCount(2);
    await showRow(page, '/sources/rec/day2/a.WAV');
    await expect(page.locator('.track-row')).toHaveCount(1);
});
