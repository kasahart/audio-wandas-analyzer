import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Metadata, entry100Results, openEntry, pickCsv, type ScannedFile } from './entryHelpers';

let scanned: ScannedFile[] | undefined;
const STR_EN = getStrings('en');
test.beforeAll(() => { scanned = entry100Results(); });

type Posted = { type: string; requestId: string; filePaths: string[]; stage?: string; reference?: { filePath: string; step: string; recipe: { nodes: Array<{ operation: string }> } }; region?: { start: number; end: number }; recipe?: { nodes: Array<{ operation: string }> }; folder?: string; files?: Array<{ name: string; text?: string }> };
const posted = (page: Page): Promise<Posted[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages);
const stageScans = async (page: Page): Promise<Posted[]> => (await posted(page)).filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage'));
const spectrum = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };

/** Answers the last steps-mode scan as a host does: each file's scan result carrying `view` (shifted for the first file). */
async function answer(page: Page, view: Record<string, unknown> = spectrum): Promise<Posted> {
    const request = (await stageScans(page)).at(-1)!;
    await page.evaluate(({ request, view, files }) => {
        request.filePaths.forEach((filePath, index) => {
            const file = files.find(item => item.filePath === filePath)!;
            const values = (view.values as number[] | undefined)?.map(value => value + (index === 0 ? 6 : 0));
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: { ...view, ...(values ? { values } : {}) } } }, '*');
        });
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, view, files: scanned! });
    return request;
}

/** Slots the table's two top rows and presses Enter: the track view compares them, as tracks, on the chain's end. */
async function openComparison(page: Page, language = 'en', files: ScannedFile[] = scanned!, baseSlot = false): Promise<string[]> {
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, files, { language, recipe });
    // Rows are a recording's channels, in name order: the first row, and the first of another condition (rpm).
    const drawn = await page.locator('[data-entry-rows] tr.entry-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-file-path')!));
    const rpm = (filePath: string): string => /_(\d+rpm)_/.exec(filePath)?.[1] ?? '';
    const other = drawn.findIndex(filePath => rpm(filePath) !== rpm(drawn[0]));
    const paths = [drawn[0], drawn[other]];
    // With `baseSlot`, the first row is the base (slot 0) and the other the compared one (slot 1).
    await page.keyboard.press(baseSlot ? '0' : '1');
    for (let step = 0; step < other; step++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press(baseSlot ? '1' : '2');
    await page.keyboard.press('Enter');
    await showTracks(page, paths);
    return paths;
}

/** After Enter: the host analyses the slotted files as tracks; the steps mode asks for its pictures and gets them. */
async function showTracks(page: Page, paths: string[]): Promise<void> {
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    // The slotted files are analysed as tracks.
    await expect.poll(async () => (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths).toEqual(paths);
    await page.evaluate(paths => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    })) } })), paths);
    await expect(page.locator('.track-stage')).toBeVisible();
    await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(0);
    await answer(page);
    await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'overlay');
}

test('Enter on the entry table compares the slotted files in the track view: overlaid, both levels in the headline, roles by colour', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const [first, second] = await openComparison(page);
    const root = page.locator('.track-stage');
    await expect(root).toHaveAttribute('data-compared', '1');
    await expect(page.locator('[data-stage-headline]')).toHaveText(/^Compare 1 − base · [\d.]+ k?Hz base −?\d+\.\d \/ compare −?\d+\.\d dB$/);
    await expect(page.locator('[data-stage-legend] .compare-legend-item')).toHaveText([/^Base group/, new RegExp(`^1${first.split('/').pop()} ch1 ${STR_EN.dsLeq.replace(/[[\]]/g, '\\$&')} −?\\d`), new RegExp(`^2${second.split('/').pop()} ch1 `)]);
    expect(await page.locator('[data-stage-legend] line').evaluateAll(lines => lines.map(line => line.getAttribute('stroke')))).toEqual(['#3b82f6', '#d4b20f', '#a371f7']);
    // The base group's ▾ says how its curve is made; "Show on the list" lists the compared files and their base on the table.
    const STR = getStrings('en');
    await expect(page.locator('[data-stage-legend] .compare-legend-item').first()).toContainText(new RegExp(STR.entryBaseMedian.replace('{count}', '\\d+')));
    await page.locator('[data-action="stage-base-info"]').click();
    await expect(page.locator('[data-stage-base-info]')).toContainText(STR.stageBaseAggregate);
    await page.locator('[data-action="stage-base-list"]').click();
    await expect(page.locator('[data-stage-base-info]')).toBeHidden();
    // On the list: a filter of the file column (a chip, × takes it off) to the compared files and their base.
    await expect(page.locator('[data-testid="fchip"]')).toHaveCount(1);
    // Hold 2: slot 2 is compared until released; a tap keeps it.
    await page.keyboard.down('2');
    await expect(root).toHaveAttribute('data-compared', '2');
    await page.waitForTimeout(300);
    await page.keyboard.up('2');
    await expect(root).toHaveAttribute('data-compared', '1');
    await page.keyboard.press('2');
    await expect(root).toHaveAttribute('data-compared', '2');
    await page.keyboard.press('1');
    // Esc with the toolbar's 書き出し open closes it and stays in the comparison.
    await page.locator('#tb-export-menu > summary').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#tb-export-menu')).not.toHaveAttribute('open', '');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    // Esc: back to the entry table, maximized, slots kept.
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    await expect(page.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
    await expect(page.locator('.entry-badge.entry-slot-2')).toHaveCount(1);
    // A row's slot menu makes it the base (0), as 1–3 slot theirs; chosen again, the base is the group median again.
    const otherKey = (await page.locator('[data-entry-rows] tr.entry-row').nth(2).getAttribute('data-key'))!;
    const other = page.locator(`[data-entry-rows] tr.entry-row[data-key="${otherKey}"]`);
    const otherName = otherKey.replace(/#ch\d+$/, '').split('/').pop()!;
    const slotZero = async (): Promise<void> => {
        await other.hover();
        await other.locator('[data-action="entry-row-slotmenu"]').click();
        await page.locator('[data-action="entry-row-slot"][data-slot="0"]').click();
    };
    await slotZero();
    await expect(other.locator('.entry-badge.entry-slot-0')).toHaveCount(1);
    await expect(page.locator('[data-entry-slots] [data-action="entry-slot"][data-slot="0"]')).toContainText(otherName);
    // The comparison's legend names that file as the base.
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-stage-legend] .compare-legend-item').first()).toContainText(otherName);
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    await slotZero();
    await expect(other.locator('.entry-badge.entry-slot-0')).toHaveCount(0);
    await expect(page.locator('[data-entry-slots] [data-action="entry-slot"][data-slot="0"]')).toContainText(STR.entryBaseGroup);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-stage-legend] .compare-legend-item').first()).toContainText(new RegExp(STR.entryBaseMedian.replace('{count}', '\\d+')));
});

test('the comparison shows the app\'s 1/3-octave branch as a step, and hides the lanes\' own controls', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const [first] = await openComparison(page);
    // The lanes' time zoom, menus and cursor spectrum do nothing on the steps view; Enter has nothing left to open.
    for (const action of ['zoom-in', 'zoom-reset', 'toggle-follow-cursor', 'toggle-spectrum-panel', 'entry-open']) {
        await expect(page.locator(`[data-action="${action}"]`).first()).toBeHidden();
    }
    await expect(page.locator('#toolbar details.tb-menu').first()).toBeHidden();
    await page.locator('.track-stage-bar [data-step-hold="node-noct"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-noct');
    await answer(page, { frame: 'NOctFrame', kind: 'bar', x: 'band', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] });
    await expect(page.locator('.track-stage-bar')).toHaveAttribute('data-stage', 'node-noct');
    // In the side panel the table keeps its four columns and never scrolls sideways; its ▾ sorts.
    await page.locator('th[data-column="leq"] [data-action="entry-fhead"]').click();
    await page.locator('[data-action="entry-fsort"][data-descending="true"]').click();
    await expect(page.locator('th[data-column="leq"]')).toHaveClass(/is-sorted/);
    expect(await page.locator('.entry-table-wrap').evaluate(wrap => wrap.scrollWidth - wrap.clientWidth)).toBeLessThanOrEqual(0);
    // A row's ▶ shows on the hovered row only, and shows its file as a track to play it.
    const row = page.locator('[data-entry-rows] tr.entry-row:not(.is-focused)').nth(3);
    const rowPath = (await row.getAttribute('data-file-path'))!;
    // The pointer leaves the sort menu's place first (it may sit over that row).
    await page.mouse.move(1, 1);
    await expect(row.locator('[data-action="entry-row-play"]')).toBeHidden();
    await row.hover();
    await expect(row.locator('[data-action="entry-row-play"]')).toBeVisible();
    await row.locator('[data-action="entry-row-play"]').click();
    await expect.poll(async () => (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths).toContain(rowPath);
    void first;
    // Back on the waveform view the lanes' controls return.
    await page.locator('[data-action="content-waveform"]').click();
    await expect(page.locator('[data-action="zoom-in"]')).toBeVisible();
});

test('D fixes the compared file\'s difference; 報告に hands the host one folder', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const [first] = await openComparison(page);
    await page.locator('[data-stage-canvas="overlay"]').click();
    await page.keyboard.press('d');
    await expect(page.locator('#hint-footer')).toHaveText(STR.compareFixedHint);
    // Every export is in the toolbar's 書き出し menu.
    await page.locator('#tb-export-menu > summary').click();
    await page.locator('[data-action="stage-report"]').click();
    const report = (await posted(page)).filter(message => message.type === 'save-report-folder').at(-1)!;
    expect(report.folder).toMatch(/^Standard_\d{8}-\d{6}$/);
    expect(report.files!.map(file => file.name)).toEqual(['summary.png', 'compare 1.png', 'compare 2.png', 'report.csv', 'Standard.recipe.json', 'Standard.1-3oct.recipe.json', 'definitions.json']);
    expect(report.files![3].text!).toContain('Δ 3.15 kHz dB');
    // The fixed difference is in the report, against its base as it was defined.
    expect(report.files![3].text!).toContain(`${STR.reportDerived} · ${first.split('/').pop()} ch1 · all`);
    // On the table it is a muted row right under the row it was fixed on, counted nowhere, with × to delete it.
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    const derived = page.locator('[data-entry-rows] tr.is-derived');
    await expect(derived).toHaveCount(1);
    await expect(derived.locator('.entry-nm')).toHaveText(new RegExp(`^└ Δ · ${STR.entryBaseGroup}`));
    const parent = await derived.evaluate(row => (row.previousElementSibling as HTMLElement).getAttribute('data-key'));
    expect(parent).toBe(`${first}#ch1`);
    const counts = await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'entry-snapshot', actions: [] } }));
        const entry = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { entry: { rows: number; dist: { groups: Array<{ n: number }> } } } }> }).__uiSmokePostedMessages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi.entry;
        return [entry.rows, entry.dist.groups.reduce((sum, group) => sum + group.n, 0)];
    });
    expect(counts).toEqual([197, 197]);
    await derived.locator('[data-action="entry-derived-remove"]').click();
    await expect(derived).toHaveCount(0);
});

test('narrowed to ch 2, the base is the group\'s ch-2 recordings within the filter, and the compared row shows its channel, value and memo', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await page.locator('[data-action="entry-group"]').selectOption('csv:rpm');
    await page.locator('th[data-column="ch"] [data-action="entry-fhead"]').click();
    await page.locator('[data-entry-fvalue="1"]').uncheck();
    await page.locator('[data-action="entry-fok"]').click();
    // The first ch-2 row: a memo on it, then slot 1, then compare.
    const first = page.locator('[data-entry-rows] tr.entry-row').first();
    const key = (await first.getAttribute('data-key'))!;
    expect(key).toMatch(/#ch2$/);
    const filePath = key.replace(/#ch2$/, '');
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('m');
    await page.locator('[data-entry-memo-text]').fill('rattle at 3 kHz');
    await page.keyboard.press('Escape');
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    await expect(page.locator('[data-entry-slots] [data-action="entry-slot"][data-slot="1"]')).toContainText(' ch2');
    await page.keyboard.press('Enter');
    await showTracks(page, [filePath]);
    const legend = page.locator('[data-stage-legend] .compare-legend-item');
    // The base: rpm's group of the compared row, its ch-2 recordings, within the filter.
    await expect(legend.first()).toContainText(`${STR.entryBaseGroup} rpm `);
    await expect(legend.first()).toContainText(` · ${STR.dsCh}2`);
    await expect(legend.first()).toContainText(STR.dsBaseNarrowed.replace('{filters}', `${STR.dsCh} = 2`));
    // The compared row: its name with the channel, its value on show, ✎ with its memo.
    await expect(legend.nth(1)).toContainText(`1${filePath.split('/').pop()} ch2`);
    await expect(legend.nth(1).locator('.compare-value')).toHaveText(new RegExp(`^${STR.dsLeq.replace(/[[\]]/g, '\\$&')} −\\d+\\.\\d$`));
    await expect(legend.nth(1).locator('[data-memo]')).toHaveAttribute('data-hint', 'rattle at 3 kHz');
});

test('a ch-2 slot is drawn as channel 2: its scans select it first, its base\'s too, and the picture is that channel\'s', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    await page.locator('[data-entry-table]').focus();
    // The second row is the first recording's ch 2.
    await page.keyboard.press('ArrowDown');
    const key = (await page.locator('[data-entry-rows] tr.is-focused').getAttribute('data-key'))!;
    expect(key).toMatch(/#ch2$/);
    const filePath = key.replace(/#ch2$/, '');
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    await page.evaluate(paths => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(path => ({
        filePath: path, fileName: path.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 2, sampleCount: 32000,
        channels: [0, 1].map(index => ({ label: `ch${index + 1}`, peakAbsolute: 0.5, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } })),
    })) } })), [filePath]);
    await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(0);
    // Every scan of the comparison selects channel 2 (index 1) at the head of its Recipe: the compared file and its base.
    const request = (await stageScans(page)).at(-1)!;
    const head = (request.recipe as unknown as { nodes: Array<{ operation: string; params: { entries: Array<[string, unknown]> } }> }).nodes[0];
    expect(head.operation).toBe('wandas.frame.get_channel');
    expect(head.params.entries).toEqual([['channel_idx', 1]]);
    expect(request.filePaths).toContain(filePath);
    await expect(page.locator('.track-stage')).toHaveAttribute('data-channels', new RegExp(`${filePath.split('/').pop()}:2`));
    // A host answers as wandas does: channel 2's picture (here −10 dB under channel 1's), and that is what is drawn.
    await page.evaluate(({ request, files }) => {
        for (const filePath of request.filePaths) {
            const file = files.find(item => item.filePath === filePath)!;
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-50, -40, -60] } } }, '*');
        }
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, files: scanned! });
    await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'overlay');
    await expect(page.locator('[data-stage-legend] .compare-legend-item').nth(1)).toContainText(`1${filePath.split('/').pop()} ch2`);
    // The base (the folder's other recordings, ungrouped) is too large to scan unasked: asked, it is scanned as ch 2 too.
    await page.locator('[data-action="stage-base-scan"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBeGreaterThan(30);
    const baseRequest = (await stageScans(page)).at(-1)!;
    expect((baseRequest.recipe as unknown as { nodes: Array<{ params: { entries: Array<[string, unknown]> } }> }).nodes[0].params.entries).toEqual([['channel_idx', 1]]);
});

test('the comparison\'s step bar grows the chain with ＋, offers only what takes the Frame there, and the plot answers the lanes\' gestures', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    // Tall enough that the overlaid plot's frequency axis is above the cursor-spectrum dock.
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openComparison(page);
    const bar = page.locator('.track-stage-bar');
    const add = async (name: string): Promise<void> => {
        await bar.locator('[data-action="step-add"]').click();
        await bar.locator('[data-step-menu-filter]').fill(name);
        await bar.locator('.step-menu-item', { hasText: name }).first().click();
    };
    // The slotted rows are channel 1 of two-channel recordings: each scan selects it first (get_channel).
    const lastRecipe = async (): Promise<string[]> => (await stageScans(page)).filter(message => message.recipe).at(-1)!.recipe!.nodes.map(node => node.operation.split('.').pop()!);
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-settings"]').click();
    await bar.locator('[data-action="step-remove"]').click();
    await add('a_weighting');
    await add('fft');
    // After a spectrum, ＋ offers what takes a SpectralFrame (ifft); a_weighting goes in earlier, before the fft.
    await bar.locator('[data-action="step-add"]').click();
    await expect(bar.locator('.step-menu-item[data-op="wandas.spectral.ifft"]')).not.toHaveClass(/is-off/);
    const earlier = bar.locator('[data-group="earlier"] .step-menu-item[data-op="wandas.audio.a_weighting"]');
    await expect(earlier).not.toHaveClass(/is-off/);
    await expect(earlier.locator('.step-menu-hint')).toHaveText(STR.stepGoesBefore.replace('{step}', 'fft'));
    await bar.locator('[data-step-menu-filter]').press('Escape');
    // The whole file is no region: no region chip.
    await expect(bar.locator('.step-chip')).toHaveText([STR.stepInput, 'HPF 20 Hz', 'a_weighting', 'fft', STR.stepOctave]);
    await expect.poll(lastRecipe).toEqual(['get_channel', 'highpass_filter', 'time_slice', 'a_weighting', 'fft']);
    await answer(page);
    // The base group (98 recordings, ungrouped) is scanned once asked.
    await page.locator('[data-action="stage-base-scan"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBeGreaterThan(30);
    await answer(page);
    await expect(page.locator('[data-stage-headline]')).toHaveText(/ base /);
    // The overlaid plot: hover says what the pointer can do; Shift+wheel or a sideways swipe pans, Ctrl+wheel zooms, a double-click resets.
    const root = page.locator('.track-stage');
    const plot = page.locator('[data-stage-canvas="overlay"]');
    const box = (await plot.boundingBox())!;
    const middle = { x: box.x + 52 + (box.width - 56) / 2, y: box.y + box.height / 2 };
    await page.mouse.move(middle.x, middle.y);
    await expect(page.locator('#hint-footer')).toHaveText(STR.compareHintPlot);
    // As on the spectrum overlay under the tracks: the line nearest the pointer drawn thicker, the cursor at its
    // point, and its name, where and its value in its colour.
    await expect(page.locator('.track-stage-cursor')).toBeVisible();
    await expect(page.locator('.track-stage-readout')).toHaveText(/^.+ \/ [\d.]+ k?Hz \/ −?\d+\.\d dB$/);
    const readoutColor = await page.locator('.track-stage-readout').evaluate(element => (element as HTMLElement).style.color);
    expect(readoutColor).not.toBe('');
    // + and − zoom about the middle.
    await page.keyboard.press('+');
    await expect(root).toHaveAttribute('data-x-window', '0.150-0.850');
    await page.keyboard.press('-');
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
    // 0 resets the zoom and _ zooms out, as on the lanes.
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await page.keyboard.press('0');
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
    await page.keyboard.press('=');
    await page.keyboard.press('_');
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
    // A box shows while it is dragged.
    await page.mouse.down();
    await page.mouse.move(middle.x + 60, middle.y + 40, { steps: 4 });
    await expect(page.locator('.track-stage-box')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('.track-stage-box')).toBeHidden();
    await page.mouse.dblclick(middle.x, middle.y);
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
    // A double-click on the frequency axis sets its range.
    await page.mouse.dblclick(middle.x, box.y + box.height - 5);
    await expect(page.locator('#track-stage-range-popover')).toBeVisible();
    await page.locator('#track-stage-range-min').fill('200');
    await page.locator('#track-stage-range-max').fill('2000');
    await page.locator('#track-stage-range-apply').click();
    await expect.poll(async () => { const [start, end] = (await root.getAttribute('data-x-window'))!.split('-').map(Number); return start > 0.1 && end < 0.9; }).toBe(true);
    await page.mouse.dblclick(middle.x, middle.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect(root).toHaveAttribute('data-x-window', '0.075-0.925');
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 100);
    await page.keyboard.up('Shift');
    await expect(root).toHaveAttribute('data-x-window', '0.150-1.000');
    // A sideways trackpad swipe pans it as far as the fingers moved, its span kept.
    await page.mouse.wheel(-40, 0);
    await expect.poll(async () => { const [start, end] = (await root.getAttribute('data-x-window'))!.split('-').map(Number); return start < 0.15 && start > 0.05 && Math.abs(end - start - 0.85) < 0.002; }).toBe(true);
    await page.mouse.dblclick(middle.x, middle.y);
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
});

test('a region set with its chip compares only that part of the files, shows on the plots, and holding a step shows the comparison without it', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openComparison(page);
    const root = page.locator('.track-stage');
    const bar = page.locator('.track-stage-bar');
    await expect(bar.locator('.step-chip', { hasText: STR.stepRegion })).toHaveCount(0);
    // 区間 from ＋: the region chip, its form open; Enter applies it and the pictures are scanned over it.
    await bar.locator('[data-action="step-insert"][data-after="node-1"]').click();
    await bar.locator('.step-menu-item[data-op="wandas.frame.time_slice"]').click();
    await expect(bar.locator('[data-step-region-param="start"]')).toBeFocused();
    await bar.locator('[data-step-region-param="start"]').fill('0.5');
    await bar.locator('[data-step-region-param="end"]').fill('1.5');
    await bar.locator('[data-step-region-param="end"]').press('Enter');
    await expect(bar.locator('.step-chip', { hasText: STR.stepRegion })).toHaveText(`${STR.stepRegion} 0.50–1.50 s`);
    await expect(root).toHaveAttribute('data-region', '0.50–1.50');
    await expect.poll(async () => (await stageScans(page)).at(-1)).toMatchObject({ region: { start: 0.5, end: 1.5 }, stage: 'node-1' });
    // The region's own picture says which part it is; a step before it shows the whole file with the region marked.
    await expect(root).toHaveAttribute('data-region-mark', 'tag');
    await bar.locator('.step-chip', { hasText: 'HPF' }).locator('[data-step-hold]').click();
    await expect(root).toHaveAttribute('data-region-mark', 'range');
    // The input chip: the files as they come in.
    await bar.locator(`[data-step-hold="node-input"]`).click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-input');
    await bar.locator('.step-chip', { hasText: STR.stepOctave }).locator('[data-step-hold]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-noct');
    await answer(page);
    // Then the files' metrics over it: a scan of the region without a step.
    await expect.poll(async () => (await stageScans(page)).some(message => message.region?.start === 0.5 && message.stage === undefined)).toBe(true);
    // Holding the HPF chip: the comparison without the HPF, framed green, until released.
    const hpf = bar.locator('.step-chip', { hasText: 'HPF' }).locator('[data-step-hold]');
    // The bar is drawn again as the region's scans come in: its chip is read once it stands still.
    await expect(hpf).toBeVisible();
    let box = await hpf.boundingBox();
    await expect.poll(async () => (box = await hpf.boundingBox()) !== null).toBe(true);
    box = box!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(root).toHaveAttribute('data-held', 'node-0');
    await expect(root).toHaveClass(/is-step-held/);
    await expect.poll(async () => (await stageScans(page)).at(-1)?.recipe?.nodes.map(node => node.operation.split('.').pop())).toEqual(['get_channel', 'time_slice', 'welch']);
    await page.mouse.up();
    await expect(root).toHaveAttribute('data-held', '');
    // The region chip's ×: the whole files again, and no region chip.
    await bar.locator('.step-chip', { hasText: STR.stepRegion }).hover();
    await bar.locator('[data-action="step-region-clear"]').click();
    await expect(root).toHaveAttribute('data-region', 'all');
    await expect(bar.locator('.step-chip', { hasText: STR.stepRegion })).toHaveCount(0);
    // ↶ brings the region back, ↷ takes it away again.
    await bar.locator('[data-action="step-undo"]').click();
    await expect(root).toHaveAttribute('data-region', '0.50–1.50');
    await bar.locator('[data-action="step-redo"]').click();
    await expect(root).toHaveAttribute('data-region', 'all');
});

test('bypass keeps a step in place but runs the chain without it; ↶ ↷ and Ctrl+Z undo and redo; a step that cannot run says why', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openComparison(page);
    const root = page.locator('.track-stage');
    const bar = page.locator('.track-stage-bar');
    const lastRecipe = async (): Promise<string[] | undefined> => (await stageScans(page)).filter(message => message.recipe).at(-1)?.recipe?.nodes.map(node => node.operation.split('.').pop()!);
    const hpf = bar.locator('.step-chip', { hasText: 'HPF' });
    await expect(bar.locator('[data-action="step-undo"]')).toBeDisabled();
    await hpf.hover();
    await hpf.locator('[data-action="step-bypass"]').click();
    await expect(hpf).toHaveClass(/is-bypassed/);
    await expect(hpf.locator('[data-action="step-bypass"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(lastRecipe).toEqual(['get_channel', 'time_slice', 'welch']);
    await answer(page);
    await expect(page.locator('[data-stage-headline]')).toContainText(STR.stepBypassing.replace('{ops}', 'HPF 20 Hz'));
    // M on the chip brings it back.
    await hpf.locator('[data-step-hold]').focus();
    await page.keyboard.press('m');
    await expect(hpf).not.toHaveClass(/is-bypassed/);
    // The whole chain again: the picture scanned at the start (its channel selected) is drawn, not asked for again.
    const scanned_ = async (): Promise<boolean> => (await stageScans(page)).some(message => message.recipe?.nodes.map(node => node.operation.split('.').pop()).join() === 'get_channel,highpass_filter,time_slice,welch');
    await expect.poll(scanned_).toBe(true);
    await expect(page.locator('[data-stage-headline]')).not.toContainText(STR.stepBypassing.replace('{ops}', 'HPF 20 Hz'));
    // Ctrl+Z undoes that (bypassed again), Ctrl+Shift+Z redoes it.
    await page.keyboard.press('Control+z');
    await expect(hpf).toHaveClass(/is-bypassed/);
    await page.keyboard.press('Control+Shift+z');
    await expect(hpf).not.toHaveClass(/is-bypassed/);
    // An FFT before the average spectrum: the spectrum cannot take it, stays in place with ⚠ and says why when shown.
    await bar.locator('[data-action="step-insert"][data-after="node-1"]').click();
    await bar.locator('[data-step-menu-filter]').fill('fft');
    await bar.locator('.step-menu-item[data-op="wandas.audio.fft"]').click();
    const welch = bar.locator('.step-chip', { hasText: STR.stepAverage });
    await expect(welch).toHaveClass(/is-invalid/);
    // The table's 1/3-octave branch after it cannot run either, and is not computed without the spectrum.
    await expect(bar.locator('.step-chip', { hasText: STR.stepOctave })).toHaveClass(/is-invalid/);
    await welch.locator('[data-step-hold]').click();
    await expect(page.locator('.track-stage-bar')).toHaveAttribute('data-drawn', '0');
    await expect(page.locator('[data-stage-headline]')).toHaveText('');
    // ↶ takes the FFT out again.
    await bar.locator('[data-action="step-undo"]').click();
    await expect(welch).not.toHaveClass(/is-invalid/);
    await expect(root).toBeVisible();
});

test('at 1280×720 the overlaid plot fits: the cursor spectrum folds while comparing, both axes are in sight, and it comes back after', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 720 });
    await openComparison(page);
    const section = page.locator('#spectrum-section');
    await expect(section).toHaveClass(/is-collapsed/);
    const plot = page.locator('[data-stage-canvas="overlay"]');
    const box = (await plot.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    // The frequency axis (the plot's bottom 16 px) and the level axis (its left 52 px) are the plot's own, not covered.
    const at = async (x: number, y: number): Promise<string | null> => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-stage-canvas') ?? null, [x, y]);
    expect(await at(box.x + box.width / 2, box.y + box.height - 6)).toBe('overlay');
    expect(await at(box.x + 20, box.y + box.height / 2)).toBe('overlay');
    // Back to the waveform: the cursor spectrum as it was.
    await page.locator('[data-action="content-waveform"]').click();
    await expect(section).not.toHaveClass(/is-collapsed/);
});

test('a chain need not end in the 1/3-octave bands: a step added is shown, × removes one, and the branch stands apart', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openComparison(page);
    const bar = page.locator('.track-stage-bar');
    // × is plainly there on the chip under the pointer, and removes that step.
    const average = bar.locator('.step-chip', { hasText: getStrings('en').stepAverage });
    await average.hover();
    const cross = average.locator('[data-action="step-delete"]');
    await expect(cross).toHaveCSS('opacity', '1');
    expect(parseFloat(await cross.evaluate(element => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
    expect((await cross.boundingBox())!.width).toBeGreaterThanOrEqual(18);
    await cross.click();
    await expect(bar.locator('.step-chip', { hasText: getStrings('en').stepAverage })).toHaveCount(0);
    // fft at the chain's end: the comparison shows fft, not the 1/3-octave branch.
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('[data-step-menu-filter]').fill('fft');
    await bar.locator('.step-menu-item', { hasText: 'fft' }).first().click();
    const fft = await bar.locator('.step-chip', { hasText: 'fft' }).getAttribute('data-step-id');
    await expect(bar).toHaveAttribute('data-stage', fft!);
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe(fft);
    // No Frame names on the bar, open or not; the branch has no arrow from the chain.
    await bar.locator('[data-action="step-expand"]').click();
    await expect(bar).not.toContainText('Frame');
    const branch = bar.locator('.step-branch');
    await expect(branch.locator('.step-chip')).toHaveCount(1);
    expect(await branch.evaluate(element => element.previousElementSibling?.classList.contains('step-arrow'))).toBe(false);
    await expect(branch.locator('[data-action="step-delete"]')).toHaveCount(0);
});

test('a base group of more than 30 recordings is not analysed by opening a comparison: the table\'s computed bands stand in until 「解析する」 is pressed', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openComparison(page);
    // Ungrouped, the base is the folder's other 97 recordings: only the compared files were asked for.
    const gate = page.locator('[data-stage-base-gate]');
    await expect(gate).toBeVisible();
    await expect(page.locator('.track-stage')).toHaveAttribute('data-base-gate', /^\d{2,}$/);
    const n = Number(await page.locator('.track-stage').getAttribute('data-base-gate'));
    expect(n).toBeGreaterThan(30);
    expect((await stageScans(page)).every(request => request.filePaths.length <= 3)).toBe(true);
    await expect(page.locator('[data-action="stage-base-scan"]')).toHaveText(new RegExp(`^${STR.stageBaseScan.replace('{n}', String(n)).replace(' · about {time}', '')}`));
    // On the 1/3-octave bands (where the comparison opens), the base is the table's computed levels, said so in its legend entry.
    const baseEntry = page.locator('[data-stage-legend] .compare-legend-item').first().locator('.compare-legend-label');
    await expect(baseEntry).toContainText(STR.stageBaseTableNote);
    await expect(baseEntry).toHaveAttribute('data-hint', STR.stageBaseTableHint.replace('{m}', String(n)).replace('{n}', String(n)));
    await expect(page.locator('[data-stage-headline]')).toContainText('base');
    // Pressed: the base group is asked for, and the button goes.
    await page.locator('[data-action="stage-base-scan"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBe(n);
    await expect(gate).toBeHidden();
});

test('coherence compares two channels of each recording: it comes with its pair (ch2 / ch1), which its settings change, and × takes both', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    // The fixture's two-channel recordings alone (with its one-channel recording, coherence is against the base slot: the next test).
    const paths = await openComparison(page, 'en', scanned!.filter(file => (file.result.input as { channels?: number[] } | undefined)?.channels?.length === 2));
    const bar = page.locator('.track-stage-bar');
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-delete"]').click();
    // The recordings are two-channel, as the host's analysis of them says.
    const lane = { peakAbsolute: 0.5, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } };
    await page.evaluate(({ paths, lane }) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 2, sampleCount: 32000,
        channels: [{ label: 'L', ...lane }, { label: 'R', ...lane }],
    })) } })), { paths, lane });
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('[data-step-menu-filter]').fill('coherence');
    await bar.locator('.step-menu-item[data-op="wandas.audio.coherence"]').click();
    const pair = bar.locator('.step-chip', { hasText: 'ch2 / ch1' });
    await expect(bar.locator('.step-chip')).toHaveText([STR.stepInput, 'HPF 20 Hz', 'coherence', 'ch2 / ch1']);
    // The pair is shown, and the slotted channel rows keep both channels: no get_channel before the pair.
    await expect(bar).toHaveAttribute('data-stage', (await pair.getAttribute('data-step-id'))!);
    const lastRecipe = async (): Promise<string[]> => (await stageScans(page)).filter(message => message.recipe).at(-1)!.recipe!.nodes.map(node => node.operation.split('.').pop()!);
    await expect.poll(lastRecipe).toEqual(['highpass_filter', 'time_slice', 'coherence', 'select_pair']);
    // Its settings name the channels from 1; a channel with itself is refused with why.
    await pair.locator('[data-action="step-settings"]').click();
    const output = bar.locator('[data-step-param="output"]');
    await expect(output).toHaveValue('2');
    await expect(bar.locator('[data-step-param="input"]')).toHaveValue('1');
    await output.fill('1');
    await output.dispatchEvent('input');
    await expect(bar.locator('[data-action="step-apply"]')).toBeDisabled();
    await expect(page.locator('#hint-footer')).toHaveText(STR.stepPairSelf);
    await output.fill('2');
    await output.dispatchEvent('input');
    await bar.locator('[data-action="step-apply"]').click();
    // A pair channel counted from the end (-1: the last) shows as its channel here and stays relative when applied untouched.
    const outputParam = async (): Promise<unknown> => ((await stageScans(page)).filter(message => message.recipe).at(-1)!.recipe as unknown as { nodes: Array<{ operation: string; params: { entries: Array<[string, unknown]> } }> })
        .nodes.find(node => node.operation.endsWith('select_pair'))!.params.entries.find(([name]) => name === 'output')?.[1];
    await pair.locator('[data-action="step-settings"]').click();
    await output.fill('-1');
    await output.dispatchEvent('input');
    await bar.locator('[data-action="step-apply"]').click();
    await expect.poll(outputParam).toBe(-1);
    await pair.locator('[data-action="step-settings"]').click();
    await expect(output).toHaveValue('2');
    await bar.locator('[data-action="step-apply"]').click();
    await expect(bar.locator('[data-step-form]')).toBeHidden();
    await expect.poll(outputParam).toBe(-1);
    // Bypassing coherence bypasses its pair too; nothing is marked as unable to run.
    const coherence = bar.locator('.step-chip', { hasText: 'coherence' });
    await coherence.locator('[data-action="step-bypass"]').click();
    await expect(pair).toHaveClass(/is-bypassed/);
    await expect(bar.locator('.step-chip.is-invalid')).toHaveCount(0);
    await coherence.locator('[data-action="step-bypass"]').click();
    await expect(pair).not.toHaveClass(/is-bypassed/);
    // × on coherence takes its pair too.
    await bar.locator('.step-chip', { hasText: 'coherence' }).locator('[data-action="step-delete"]').click();
    await expect(bar.locator('.step-chip')).toHaveText([STR.stepInput, 'HPF 20 Hz']);
});

test('with a one-channel recording, coherence is measured against the base slot: the compared recording over the base one, and ⚙ switches the reference', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const [base, compared] = await openComparison(page, 'en', scanned!, true);
    const bar = page.locator('.track-stage-bar');
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-delete"]').click();
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('[data-step-menu-filter]').fill('coherence');
    await bar.locator('.step-menu-item[data-op="wandas.audio.coherence"]').click();
    // No pair of channels: the chip names its reference, and nothing is marked as unable to run.
    await expect(bar.locator('.step-chip')).toHaveText([STR.stepInput, 'HPF 20 Hz', `coherence · ${STR.stagePairBase}`]);
    await expect(bar.locator('.step-chip.is-invalid')).toHaveCount(0);
    const coherence = bar.locator('.step-chip', { hasText: 'coherence' });
    const id = (await coherence.getAttribute('data-step-id'))!;
    // The compared recording is scanned with the base one as its reference at that step; the base is not a curve of its own.
    await expect.poll(async () => (await stageScans(page)).at(-1)!.reference?.step).toBe(id);
    const request = (await stageScans(page)).at(-1)!;
    expect(request.reference!.filePath).toBe(base);
    expect(request.filePaths).toEqual([compared]);
    // Each side is its slot's channel row: one channel of each recording makes the pair.
    const operations = (recipe: { nodes: Array<{ operation: string }> }): string[] => recipe.nodes.map(node => node.operation.split('.').pop()!);
    expect(operations(request.recipe!)).toEqual(['get_channel', 'highpass_filter', 'time_slice', 'coherence']);
    expect(operations(request.reference!.recipe)).toEqual(['get_channel', 'highpass_filter', 'time_slice', 'coherence']);
    await answer(page, { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'coherence', unit: '', xs: [100, 1000, 5000], values: [0.2, 0.5, 0.9], pair: { output: 2, input: 1, base: true } });
    await expect(page.locator('[data-stage-headline]')).toContainText(STR.stageVsBase.split('{file}')[0]);
    // ⚙: the reference back to a channel brings the pair, which one channel cannot give (said why); back to the base slot.
    await coherence.locator('[data-action="step-settings"]').click();
    await bar.locator('[data-action="step-reference"][data-mode="channel"]').click();
    await expect(bar.locator('.step-chip')).toHaveText([STR.stepInput, 'HPF 20 Hz', 'coherence', 'ch2 / ch1']);
    await expect(bar.locator('.step-chip.is-invalid')).not.toHaveCount(0);
    // The form stays open on the choice made, to switch back.
    await expect(bar.locator('[data-action="step-reference"][data-mode="channel"]')).toHaveAttribute('aria-pressed', 'true');
    await bar.locator('[data-action="step-reference"][data-mode="slot"]').click();
    await expect(bar.locator('.step-chip')).toHaveText([STR.stepInput, 'HPF 20 Hz', `coherence · ${STR.stagePairBase}`]);
    // The report's Recipe replays it in wandas: a base input through the same steps, one channel of each, the pair.
    await page.locator('#tb-export-menu > summary').click();
    await page.locator('[data-action="stage-report"]').click();
    await expect.poll(async () => (await posted(page)).some(message => message.type === 'save-report-folder')).toBe(true);
    const folder = (await posted(page)).filter(message => message.type === 'save-report-folder').at(-1)!;
    const written = JSON.parse(folder.files!.find(file => file.name === `${STR.stepRecipeName}.recipe.json`)!.text!) as { inputs: Array<{ name: string }>; nodes: Array<{ operation: string }> };
    expect(written.inputs.map(input => input.name)).toEqual(['signal', 'base']);
    expect(written.nodes.map(node => node.operation.split('.').pop()).slice(-3)).toEqual(['concat_frame', 'coherence', 'select_pair']);
});

test('B switches the base between the slot-0 file and the group median; 0 no longer does', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openComparison(page, 'en', scanned!, true);
    const root = page.locator('.track-stage');
    await expect(root).toHaveAttribute('data-base', 'file');
    await page.keyboard.press('0');
    await expect(root).toHaveAttribute('data-base', 'file');
    await page.keyboard.press('b');
    await expect(root).toHaveAttribute('data-base', 'group');
    await page.keyboard.press('B');
    await expect(root).toHaveAttribute('data-base', 'file');
    // The help lists it in the comparison's section, first while comparing.
    await page.keyboard.press('?');
    const help = page.locator('[data-screen-help]');
    await expect(help.locator('[data-help-section]').first()).toHaveAttribute('data-help-section', 'compare');
    await expect(help.locator('[data-help-section="compare"] th', { hasText: /^B$/ })).toHaveCount(1);
    await page.keyboard.press('F1');
    await expect(help).toBeHidden();
    await expect(root).toBeVisible();
});
