import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';

let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

type Posted = { type: string; requestId: string; filePaths: string[]; stage?: string; region?: { start: number; end: number }; recipe?: { nodes: Array<{ operation: string }> }; folder?: string; files?: Array<{ name: string; text?: string }> };
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
async function openComparison(page: Page, language = 'en'): Promise<string[]> {
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { language, recipe });
    const paths = await page.locator('[data-entry-rows] tr').evaluateAll(rows => rows.slice(0, 2).map(row => row.getAttribute('data-file-path')!));
    await page.keyboard.press('1');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('2');
    await page.keyboard.press('Enter');
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
    return paths;
}

test('Enter on the entry table compares the slotted files in the track view: overlaid, both levels in the headline, roles by colour', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const [first, second] = await openComparison(page);
    const root = page.locator('.track-stage');
    await expect(root).toHaveAttribute('data-compared', '1');
    await expect(page.locator('[data-stage-headline]')).toHaveText(/^[\d.]+ k?Hz base −?\d+\.\d \/ compare −?\d+\.\d dB$/);
    await expect(page.locator('[data-stage-legend] .compare-legend-item')).toHaveText([/^Base group/, `1 · ${first.split('/').pop()}`, `2 · ${second.split('/').pop()}`]);
    expect(await page.locator('[data-stage-legend] line').evaluateAll(lines => lines.map(line => line.getAttribute('stroke')))).toEqual(['#3b82f6', '#d4b20f', '#a371f7']);
    // The base group's ▾ says how its curve is made; "Show on the list" lists the compared files and their base on the table.
    const STR = getStrings('en');
    await expect(page.locator('[data-stage-legend] .compare-legend-item').first()).toContainText(STR.entryBaseMedian.replace('{count}', '6'));
    await page.locator('[data-action="stage-base-info"]').click();
    await expect(page.locator('[data-stage-base-info]')).toContainText(STR.stageBaseAggregate);
    await page.locator('[data-action="stage-base-list"]').click();
    await expect(page.locator('[data-stage-base-info]')).toBeHidden();
    await expect(page.locator('[data-action="entry-filter-compared"]')).toHaveAttribute('aria-pressed', 'true');
    // Hold 2: slot 2 is compared until released; a tap keeps it.
    await page.keyboard.down('2');
    await expect(root).toHaveAttribute('data-compared', '2');
    await page.waitForTimeout(300);
    await page.keyboard.up('2');
    await expect(root).toHaveAttribute('data-compared', '1');
    await page.keyboard.press('2');
    await expect(root).toHaveAttribute('data-compared', '2');
    await page.keyboard.press('1');
    // Esc: back to the entry table, maximized, slots kept.
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    await expect(page.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
    await expect(page.locator('.entry-badge.entry-slot-2')).toHaveCount(1);
    // A row's 0 makes its file the base, as 1–3 slot theirs; pressed again, the base is the group median again.
    // The base re-sorts the table, so the row is found by its file.
    const otherPath = (await page.locator('[data-entry-rows] tr.entry-row').nth(2).getAttribute('data-file-path'))!;
    const other = page.locator(`[data-entry-rows] tr.entry-row[data-file-path="${otherPath}"]`);
    const otherName = otherPath.split('/').pop()!;
    await other.hover();
    const zero = other.locator('[data-action="entry-row-slot"][data-slot="0"]');
    await zero.click();
    await expect(zero).toHaveAttribute('aria-pressed', 'true');
    await expect(other.locator('.entry-badge.entry-slot-0')).toHaveCount(1);
    await expect(page.locator('[data-entry-slots] .entry-chip-base')).toContainText(otherName);
    // The comparison's legend names that file as the base.
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-stage-legend] .compare-legend-item').first()).toContainText(otherName);
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    await other.hover();
    await zero.click();
    await expect(zero).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-entry-slots] .entry-chip-base')).toContainText(STR.entryBaseGroup);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-stage-legend] .compare-legend-item').first()).toContainText(STR.entryBaseMedian.replace('{count}', '6'));
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
    // Sorted by a band in the side panel, the table still fits: the band's level takes Leq's place.
    await page.locator('[data-action="entry-sort-band"]').click();
    await expect(page.locator('th.entry-col-band')).toHaveClass(/is-sorted/);
    await expect(page.locator('th.entry-col-leq')).toBeHidden();
    expect(await page.locator('.entry-table-wrap').evaluate(wrap => wrap.scrollWidth - wrap.clientWidth)).toBeLessThanOrEqual(0);
    // "Compared" lists the slotted files with their base (marked); a base row's ▶ shows it as a track to play it.
    await page.locator('[data-action="entry-filter-compared"]').click();
    const rows = page.locator('[data-entry-rows] tr.entry-row');
    await expect(rows.first()).toHaveAttribute('data-file-path', first);
    const baseRow = page.locator('[data-entry-rows] tr.entry-row.is-base').first();
    await expect(baseRow).toBeVisible();
    const basePath = (await baseRow.getAttribute('data-file-path'))!;
    // ▶ shows on the hovered row only.
    await expect(baseRow.locator('[data-action="entry-row-play"]')).toBeHidden();
    await baseRow.hover();
    await expect(baseRow.locator('[data-action="entry-row-play"]')).toBeVisible();
    await baseRow.locator('[data-action="entry-row-play"]').click();
    await expect.poll(async () => (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths).toContain(basePath);
    // Back on the waveform view the lanes' controls return.
    await page.locator('[data-action="content-waveform"]').click();
    await expect(page.locator('[data-action="zoom-in"]')).toBeVisible();
});

test('D fixes the compared file\'s difference as a row of the entry table; 報告に hands the host one folder', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const [first] = await openComparison(page);
    await page.locator('[data-stage-canvas="overlay"]').click();
    await page.keyboard.press('d');
    await expect(page.locator('#hint-footer')).toHaveText(STR.compareFixedHint);
    await page.locator('[data-action="stage-report"]').click();
    const report = (await posted(page)).filter(message => message.type === 'save-report-folder').at(-1)!;
    expect(report.folder).toMatch(/^Standard_\d{8}-\d{6}$/);
    expect(report.files!.map(file => file.name)).toEqual(['summary.png', 'compare 1.png', 'compare 2.png', 'report.csv', 'Standard.recipe.json', 'Standard.1-3oct.recipe.json', 'definitions.json']);
    expect(report.files![3].text!).toContain('Δ 3.15 kHz dB');
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    const names = await page.locator('[data-entry-rows] .entry-name').allTextContents();
    const at = names.indexOf(first.split('/').pop()!);
    expect(names[at + 1]).toMatch(/^└ Δ /);
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
    await expect.poll(lastRecipe).toEqual(['highpass_filter', 'time_slice', 'a_weighting', 'fft']);
    await answer(page);
    await expect(page.locator('[data-stage-headline]')).toHaveText(/ base /);
    // The overlaid plot: hover says what the pointer can do; Shift+wheel pans, Ctrl+wheel zooms, a double-click resets.
    const root = page.locator('.track-stage');
    const plot = page.locator('[data-stage-canvas="overlay"]');
    const box = (await plot.boundingBox())!;
    const middle = { x: box.x + 52 + (box.width - 56) / 2, y: box.y + box.height / 2 };
    await page.mouse.move(middle.x, middle.y);
    await expect(page.locator('#hint-footer')).toHaveText(STR.compareHintPlot);
    // As on the lanes: a cursor line and the values under the pointer (where, base, compare, Δ).
    await expect(page.locator('.track-stage-cursor')).toBeVisible();
    await expect(page.locator('.track-stage-readout')).toHaveText(/^[\d.]+ k?Hz · −?\d+\.\d · −?\d+\.\d · [+−]\d+\.\d dB$/);
    // + and − zoom about the middle.
    await page.keyboard.press('+');
    await expect(root).toHaveAttribute('data-x-window', '0.150-0.850');
    await page.keyboard.press('-');
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
    const box = (await hpf.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(root).toHaveAttribute('data-held', 'node-0');
    await expect(root).toHaveClass(/is-step-held/);
    await expect.poll(async () => (await stageScans(page)).at(-1)?.recipe?.nodes.map(node => node.operation.split('.').pop())).toEqual(['time_slice', 'welch']);
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
    await expect.poll(lastRecipe).toEqual(['time_slice', 'welch']);
    await answer(page);
    await expect(page.locator('[data-stage-headline]')).toContainText(STR.stepBypassing.replace('{ops}', 'HPF 20 Hz'));
    // M on the chip brings it back.
    await hpf.locator('[data-step-hold]').focus();
    await page.keyboard.press('m');
    await expect(hpf).not.toHaveClass(/is-bypassed/);
    await expect.poll(lastRecipe).toEqual(['highpass_filter', 'time_slice', 'welch']);
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

test('holding a step on the entry table draws its picture as the steps view does: one stage scan with and one without it, the Δ, and detail once zoomed', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { language: 'en', recipe });
    const holds = async (): Promise<Posted[]> => (await posted(page)).filter(message => message.type === 'compare-scan' && message.requestId.startsWith('entry-hold'));
    const hpf = page.locator('#entry-screen .step-chip', { hasText: 'HPF' }).locator('[data-step-hold]');
    const box = (await hpf.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const held = page.locator('[data-entry-held]');
    await expect(held).toBeVisible();
    await expect(held).toHaveClass(/is-pending/);
    // The chain's end with the HPF, then without it (one request in flight per source).
    const answerHold = async (shift: number): Promise<Posted> => {
        const request = (await holds()).at(-1)!;
        await page.evaluate(({ request, view, files, shift }) => {
            for (const filePath of request.filePaths) {
                const file = files.find(item => item.filePath === filePath)!;
                window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: { ...view, values: view.values.map(value => value + shift) } } }, '*');
            }
            window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
        }, { request, view: spectrum, files: scanned!, shift });
        return request;
    };
    await expect.poll(async () => (await holds()).length).toBe(1);
    const withIt = await answerHold(0);
    await expect.poll(async () => (await holds()).length).toBe(2);
    const without = await answerHold(3);
    expect(withIt.stage).toBe(without.stage);
    expect(withIt.recipe!.nodes.map(node => node.operation.split('.').pop())).toContain('highpass_filter');
    expect(without.recipe!.nodes.map(node => node.operation.split('.').pop())).not.toContain('highpass_filter');
    await expect(held).not.toHaveClass(/is-pending/);
    // Zoomed (Ctrl+wheel on the held plot, the chip still held), it asks for the part on screen at full resolution once the zoom settles.
    const canvas = page.locator('[data-entry-held-canvas]');
    const plot = (await canvas.boundingBox())!;
    await canvas.dispatchEvent('wheel', { deltaY: -200, ctrlKey: true, clientX: plot.x + plot.width / 2, clientY: plot.y + plot.height / 2, bubbles: true, cancelable: true });
    await expect(canvas).not.toHaveAttribute('data-window', '0.000-1.000|0.000-1.000');
    await expect.poll(async () => (await holds()).some(message => 'detail' in message)).toBe(true);
    await page.mouse.up();
    await expect(held).toBeHidden();
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
