import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { countTextElements, entry100Metadata, entry100Results, openEntry, type ScannedFile } from './entryHelpers';
import { parseTable, resolveTable } from '../../shared/analysis/entryMetadata';

let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

test('the entry table fills 100 rows, marks outliers and the files it cannot compare, and opens the slotted files', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const elapsed = await openEntry(page, scanned!);
    test.info().annotations.push({ type: 'entry100-render-ms', description: elapsed.toFixed(0) });
    expect(elapsed).toBeLessThan(10_000);
    await expect(page.locator('[data-entry-rows] tr')).toHaveCount(100);
    await expect(page.locator('[data-entry-head] th:not(.entry-badge-col):not(.entry-track-col)')).toHaveCount(6);
    await expect(page.locator('[data-entry-head]')).toContainText('▼Δ');
    await expect(page.locator('[data-entry-count="outliers"]')).toHaveText('3');
    await expect(page.locator('[data-entry-rows] tr.is-outlier')).toHaveCount(3);
    await expect(page.locator('[data-entry-rows] tr').first()).toHaveClass(/is-outlier/);
    for (const name of ['Rec_0012.wav', 'mono_48k.wav']) {
        const row = page.locator('[data-entry-rows] tr', { hasText: name });
        await expect(row.locator('td.entry-num')).toHaveText(['—', '—', '—']);
    }
    await expect(page.locator('[data-entry-rows] tr', { hasText: 'mono_48k.wav' })).toContainText(`${STR.entryShape}：1 ch · 48 kHz`);
    // Unreadable and of another shape are both "not comparable": one filter, the reason on each row.
    await expect(page.locator('[data-entry-count="failed"]')).toHaveText('2');
    await expect(page.locator('[data-action="entry-filter-mismatch"]')).toHaveCount(0);
    // Every file is measured: the count is gone. All files are uncalibrated, so there is no calibration column.
    await expect(page.locator('[data-entry-progress]')).toBeHidden();
    await expect(page.locator('[data-entry-head] th.entry-col-cal')).toHaveCount(0);
    await expect(page.locator('[data-action="entry-sort-band"]')).toHaveText('dBFS');
    await expect(page.locator('[data-entry-slots] .entry-chip-base')).toContainText(`${STR.entryBaseGroup} · L3 · 1500rpm · 6`);
    const words = await countTextElements(page);
    test.info().annotations.push({ type: 'entry-text-elements', description: String(words) });
    expect(words).toBeLessThanOrEqual(30);

    // Holding 0 swaps the level columns for Δ in place; releasing brings them back.
    const order = await page.locator('[data-entry-rows] .entry-name').allTextContents();
    await page.keyboard.down('0');
    await expect(page.locator('[data-entry-table]')).toHaveClass(/is-delta/);
    await expect(page.locator('[data-entry-head]')).toContainText(`Δ ${STR.entryColLeq}`);
    await expect(page.locator('[data-entry-rows] tr').first().locator('td.entry-delta').first()).toHaveText(/^[+−]\d/);
    expect(await page.locator('[data-entry-rows] .entry-name').allTextContents()).toEqual(order);
    await page.waitForTimeout(300);
    await page.keyboard.up('0');
    await expect(page.locator('[data-entry-table]')).not.toHaveClass(/is-delta/);
    // The base stays the condition's median, so a hold never moves slot 0.
    expect(await page.evaluate(() => document.querySelector('.entry-badge.entry-slot-0'))).toBeNull();

    // Enter without a slot 1–3 only points at those keys.
    await page.keyboard.press('Enter');
    await expect(page.locator('#hint-footer')).toHaveText(STR.entryKeySlot);
    await expect(page.locator('#entry-screen')).toBeVisible();
    await page.keyboard.press('1');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('2');
    await expect(page.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
    await expect(page.locator('.entry-badge.entry-slot-2')).toHaveCount(1);
    const firstTwo = (await page.locator('[data-entry-rows] tr').evaluateAll(rows => rows.slice(0, 2).map(row => row.getAttribute('data-file-path'))));
    await page.keyboard.press('Enter');
    // The table goes back into the side panel beside the track view, which compares the slotted files as a step of the Recipe.
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    await expect(page.locator('#entry-dock #entry-screen')).toBeVisible();
    await expect(page.locator('.track-stage')).toBeVisible();
    const opened = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; filePaths?: string[] }> })
        .__uiSmokePostedMessages.filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths);
    expect(opened).toEqual(firstTwo);
});

test('a pasted condition table reports what it matched and is saved; CSV downloads the table', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openEntry(page, scanned!);
    await page.locator('[data-action="entry-paste-conditions"]').click();
    const dialog = page.locator('[data-entry-dialog]');
    await expect(dialog).toBeVisible();
    const names = scanned!.map(file => path.basename(file.filePath, '.wav')).filter(name => name.startsWith('run0'));
    const table = ['file\tline\trpm', ...names.map((name, i) => `${name}\tL${(i % 3) + 1}\t${[900, 1200, 1500][i % 3]}rpm`)].join('\n');
    await page.locator('[data-entry-paste]').fill(table);
    await expect(page.locator('[data-entry-unmatched]')).toHaveText('30 / 100');
    await expect(page.locator('[data-entry-columns] input:checked')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.locator('[data-action="entry-paste-conditions"]').click();
    await page.locator('[data-entry-paste]').fill(table);
    await page.locator('[data-action="entry-conditions-apply"]').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-entry-head]')).toContainText('line');
    const saved = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; table?: { rows: Record<string, string[]> } }> })
        .__uiSmokePostedMessages.find(message => message.type === 'entry-save-conditions')?.table?.rows);
    // Rows are kept per recording, by the listed path the table's row was attached to.
    expect(Object.entries(saved ?? {}).find(([filePath]) => filePath.endsWith('/run000.wav'))?.[1]).toEqual(['L1', '900rpm']);

    await page.locator('[data-action="entry-export-csv"]').click();
    const download = await page.evaluate(() => (window as unknown as { __uiSmokeDownloads: Array<{ download: string; href: string }> }).__uiSmokeDownloads.at(-1));
    expect(download?.download).toBe('entry-table.csv');
    const csv = decodeURIComponent(download!.href.slice(download!.href.indexOf(',') + 1));
    const header = csv.slice(0, csv.indexOf('\r\n'));
    expect(header).toMatch(/^\uFEFFFile,line,rpm,Start s,End s,Leq dB\(A\) uncalibrated,Δ max band Hz,Δ max band dB,[\d.]+ k?Hz dB,Δ Leq dB\(A\),Δ [\d.]+ k?Hz dB,Base group n,Outliers$/u);
    expect(csv.trimEnd().split('\r\n')).toHaveLength(101);
});

test('the entry table speaks Japanese with the same few words', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    await expect(page.locator('[data-entry-head]')).toContainText(STR.entryColPeak);
    await expect(page.locator('[data-action="entry-paste-conditions"]')).toHaveText(STR.entryPasteConditions);
    await expect(page.locator('[data-entry-slots] .entry-chip-base')).toContainText(`${STR.entryBaseGroup} · L3 · 1500rpm · 6 件`);
    const words = await countTextElements(page);
    test.info().annotations.push({ type: 'entry-text-elements', description: String(words) });
    expect(words).toBeLessThanOrEqual(30);
    // Esc shrinks the table into the side panel.
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
});

test('a folder of 1000 files draws in a moment', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const readable = scanned!.filter(file => (file.result as { ok: boolean }).ok);
    // Redrawing per result once cost the square of the folder size: 1000 files took 45 s to draw.
    const many = Array.from({ length: 1000 }, (_, i) => {
        const source = readable[i % readable.length];
        return { filePath: `/many/${i}/${path.basename(source.filePath)}`, result: source.result };
    });
    const elapsed = await openEntry(page, many);
    test.info().annotations.push({ type: 'entry1000-render-ms', description: elapsed.toFixed(0) });
    expect(elapsed).toBeLessThan(2_000);
    await expect(page.locator('[data-entry-rows] tr')).toHaveCount(1000);
});

test('a folder of two files of one condition gets Δ but no outliers', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const readable = scanned!.filter(file => (file.result as { ok: boolean }).ok);
    const two = readable.filter(file => path.basename(file.filePath).startsWith('L1_900rpm_')).slice(0, 2);
    await openEntry(page, two);
    await expect(page.locator('[data-entry-rows] tr')).toHaveCount(2);
    // Two files cannot tell an outlier: "—", not "0".
    await expect(page.locator('[data-entry-count="outliers"]')).toHaveText('—');
    await expect(page.locator('[data-entry-slots] .entry-chip-base')).toContainText('n 1');
});

test('the folder\'s metadata CSV supplies the conditions; rows stay put while the scan runs', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const folder = path.dirname(scanned![0].filePath);
    const table = resolveTable(parseTable(entry100Metadata())!, scanned!.map(file => file.filePath), folder, 'motor.csv').table;
    const metadataPath = path.join(folder, 'motor.csv');
    // Half the results in: the rows keep the CSV's order, so nothing moves under the pointer.
    await openEntry(page, scanned!, { table, metadataPath, answered: 50 });
    await expect(page.locator('[data-entry-rows] tr')).toHaveCount(100);
    await expect(page.locator('[data-entry-rows] .entry-name').first()).toHaveText('L1_900rpm_run001.wav');
    await expect(page.locator('[data-entry-head] .entry-sort')).toHaveClass(/is-pending/);
    await expect(page.locator('[data-entry-source]')).toHaveText('motor.csv · 98 / 100');
    await expect(page.locator('[data-entry-head] [data-action="entry-column"]')).toHaveText(['line', 'rpm']);
    await expect(page.locator('[data-action="entry-columns-more"]')).toHaveText('+2');
    // The run0xx files have no condition in their names; the CSV gives them one.
    await expect(page.locator('[data-entry-rows] tr', { hasText: 'run000.wav' }).locator('td').nth(3)).toHaveText('L1');

    await page.locator('[data-action="entry-columns-more"]').click();
    await expect(page.locator('[data-entry-head] [data-action="entry-column"]')).toHaveText(['line', 'rpm', 'temp_c', 'load_pct']);
    // A heading checks its column into the condition, which the host keeps for this file.
    await page.locator('[data-entry-head] [data-action="entry-column"]', { hasText: 'line' }).click();
    const saved = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; table?: { checked: number[]; source?: string } }> })
        .__uiSmokePostedMessages.filter(message => message.type === 'entry-save-conditions').at(-1)?.table);
    expect(saved).toMatchObject({ checked: [1], source: 'motor.csv' });
});

test('holding 1 shows the slotted row\'s Δ spectrum under the scatter; the scatter takes numeric metadata as axes', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const folder = path.dirname(scanned![0].filePath);
    const table = resolveTable(parseTable(entry100Metadata())!, scanned!.map(file => file.filePath), folder, 'motor.csv').table;
    await openEntry(page, scanned!, { table, metadataPath: path.join(folder, 'motor.csv') });
    await expect(page.locator('[data-entry-scatter]')).toBeVisible();
    await expect(page.locator('[data-action="entry-axis-x"] option')).toContainText(['Leq dB(A)', 'Δ max band dB', '3.15 kHz dB', 'rpm', 'temp_c', 'load_pct']);
    await page.locator('[data-action="entry-axis-x"]').selectOption({ label: 'temp_c' });
    await expect(page.locator('[data-action="entry-axis-x"]')).toHaveValue('column:temp_c');

    // A tap slots the row; a hold shows its Δ against the base group until released.
    await page.keyboard.press('1');
    await expect(page.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
    await expect(page.locator('[data-entry-held]')).toBeHidden();
    const scatterBox = await page.locator('[data-entry-scatter]').boundingBox();
    await page.keyboard.down('1');
    await expect(page.locator('[data-entry-held]')).toBeVisible();
    // The Δ spectrum takes the scatter's frame: nothing on the side moves.
    expect(await page.locator('[data-entry-scatter]').boundingBox()).toEqual(scatterBox);
    expect(await page.locator('[data-entry-held]').boundingBox()).toEqual(await page.locator('.entry-scatter').boundingBox());
    await expect(page.locator('[data-entry-held-title]')).toHaveText(/^1 · .+\.wav$/);
    await page.keyboard.up('1');
    await expect(page.locator('[data-entry-held]')).toBeHidden();
    await expect(page.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
});

test('the step bar shows every step of the scan Recipe; an invalid value keeps Apply off and a valid one rescans the table', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    const bar = page.locator('#entry-screen [data-step-bar]');
    // "Steps", the input, then every step as a round chip joined by →, with the stage this screen answers with
    // (the app's 1/3-octave branch) after the chain, framed.
    await expect(bar.locator('.step-name')).toHaveText(STR.stepBarLabel);
    await expect(bar.locator('.step-chip')).toHaveText(['HPF 20 Hz', `${STR.stepRegion} ${STR.stepAll}`, `${STR.stepAverage} 1024`, STR.stepOctave]);
    // The app's 1/3-octave branch stands apart at the end, with no arrow from the chain: three links.
    await expect(bar.locator('.step-arrow')).toHaveCount(3);
    await expect(bar.locator('.step-branch .step-chip')).toHaveText(STR.stepOctave);
    await expect(bar.locator('.step-chip.is-current')).toHaveText(STR.stepOctave);
    // What the app computes beside the chain is no tag on the bar: … lists it.
    await expect(bar.locator('.step-outside')).toHaveCount(0);
    // ＋ opens wandas' operations that take the Frame at the chain's end; Esc closes it.
    await bar.locator('[data-action="step-add"]').click();
    await expect(bar.locator('.step-menu-title')).toHaveText(STR.stepMenuTitle.replace('{frame}', 'SpectralFrame'));
    await page.keyboard.press('Escape');
    await expect(bar.locator('[data-step-menu]')).toHaveCount(0);
    // … unfolds every step: its wandas operation, the Frame types on the links, what is outside the Recipe.
    await bar.locator('[data-action="step-expand"]').click();
    await expect(bar.locator('[data-action="step-expand"]')).toHaveAttribute('aria-expanded', 'true');
    // Every step is a chip: pressed, it shows its Frame on the comparison.
    await expect(bar.locator('.step-chip')).toHaveText(['HPF 20 Hz', `${STR.stepRegion} ${STR.stepAll}`, `${STR.stepAverage} 1024`, /^1\/3 oct/]);
    // Only ⚙ opens the settings: pressing a chip's body asks for files to compare first.
    await bar.locator('.step-chip').first().locator('.step-body').click();
    await expect(bar.locator('[data-step-form]')).toHaveCount(0);
    await expect(page.locator('#hint-footer')).toHaveText(STR.stepOpenCompare);
    // No Frame names and no method names under the chips: the method is in each chip's hint.
    await expect(bar.locator('.step-op, .step-frame')).toHaveCount(0);
    await expect(bar).not.toContainText('Frame');
    expect(await bar.locator('[data-step-hold]').evaluateAll(chips => chips.map(chip => /wandas (\w+)/.exec(chip.getAttribute('data-hint') ?? '')?.[1]))).toEqual(['highpass_filter', 'time_slice', 'welch', 'noct_spectrum']);
    await expect(bar.locator('.step-outside-row .awa-tag')).toHaveText([STR.outsideLeq, STR.outside192, STR.outsideMedian, STR.outsideDelta, STR.outsideOutliers]);
    await expect(bar.locator('.step-chip').nth(0)).toContainText('HPF 20 Hz');
    // A parameter the Recipe leaves out shows wandas' default.
    await bar.locator('[data-action="step-settings"]').first().click();
    await expect(bar.locator('[data-step-param="order"]')).toHaveValue('4');
    await bar.locator('[data-action="step-settings"]').first().click();
    await bar.locator('[data-action="step-settings"]').last().click();
    // The form opens under its own chip, not at the bar's start.
    const chip = await bar.locator('[data-step-id]').filter({ hasText: STR.stepAverage }).boundingBox();
    const form = await bar.locator('[data-step-form]').boundingBox();
    expect(Math.abs(form!.x - chip!.x)).toBeLessThan(4);
    // A click outside drops the form.
    await page.locator('[data-entry-rows] tr').nth(3).click();
    await expect(bar.locator('[data-step-form]')).toHaveCount(0);
    await bar.locator('[data-action="step-settings"]').first().click();
    await bar.locator('[data-step-param="cutoff"]').fill('9000');
    await expect(bar.locator('.step-field.is-invalid')).toHaveCount(1);
    await expect(bar.locator('[data-action="step-apply"]')).toBeDisabled();
    await bar.locator('.step-field.is-invalid').hover();
    await expect(page.locator('#hint-footer')).toHaveText(STR.stepNeedBelow.replace('{max}', '8000'));
    await bar.locator('[data-step-param="cutoff"]').fill('100');
    await bar.locator('[data-action="step-apply"]').click();
    await expect(bar.locator('.step-chip').nth(0)).toContainText('HPF 100 Hz');
    // Focus is back on the gear: Esc now only leaves the bar, the table stays.
    await expect(bar.locator('[data-action="step-settings"]').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toBeVisible();
    // A new chain does not scan the folder by itself: the rows keep the previous chain's values, greyed and said so.
    const scans = (): Promise<Array<{ type: string; requestId: string; filePaths: string[]; recipe?: { nodes: Array<{ operation: string }> } }>> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; requestId: string; filePaths: string[]; recipe?: { nodes: Array<{ operation: string }> } }> })
        .__uiSmokePostedMessages.filter(message => message.type === 'entry-scan'));
    expect((await scans()).length).toBe(1);
    await expect(page.locator('[data-entry-progress]')).toHaveText('0 / 100');
    await expect(page.locator('.entry-stale-tag')).toHaveText(STR.entryStaleTag.replace('{n}', '100'));
    await expect(page.locator('[data-entry-rows] tr.is-stale')).toHaveCount(100);
    // Only the focused row is measured at once, with the new chain.
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; filePaths: string[] }> })
        .__uiSmokePostedMessages.filter(message => message.type === 'compare-scan').at(-1)?.filePaths.length)).toBe(1);
    // "Scan all" says how many and about how long; it scans with the new chain and can be stopped.
    const all = page.locator('[data-action="entry-scan-all"]');
    await expect(all).toHaveText(new RegExp(`^${STR.entryScanAll.replace('{n}', '100').replace(' · ', ' · ').replace('{time}', '.+').replace(/[()]/g, '\\$&')}$`));
    await all.click();
    const scan = (await scans()).at(-1)!;
    expect(scan.recipe!.nodes.map(node => node.operation)).toEqual(['wandas.audio.highpass_filter', 'wandas.frame.time_slice', 'wandas.audio.welch']);
    expect(scan.filePaths.length).toBe(100);
    await page.evaluate(({ requestId, files }) => {
        for (const file of files.slice(0, 3)) window.postMessage({ type: 'entry-scan-result', requestId, filePath: file.filePath, result: file.result }, '*');
    }, { requestId: scan.requestId, files: scanned!.filter(file => scan.filePaths.slice(0, 3).includes(file.filePath)) });
    await expect(page.locator('[data-entry-progress]')).toHaveText('3 / 100');
    await page.locator('[data-action="entry-scan-cancel"]').click();
    const cancels = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string }> }).__uiSmokePostedMessages.filter(message => message.type === 'entry-scan-cancel').length);
    expect(cancels).toBe(1);
    // Stopped: the rows it reached are the new chain's, the rest stay greyed.
    await expect(page.locator('[data-entry-rows] tr.is-stale')).toHaveCount(97);
    await expect(page.locator('[data-action="entry-scan-all"]')).toHaveText(new RegExp(`^${STR.entryScanAll.replace('{n}', '97').replace('{time}', '.+')}$`));
});

test('Esc closes an open settings form first, then shrinks the maximized table into the side panel, which ⤢ widens again', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    const screen = page.locator('#entry-screen');
    await expect(screen).toHaveClass(/is-max/);
    const bar = page.locator('#entry-screen [data-step-bar]');
    await bar.locator('[data-action="step-expand"]').click();
    await bar.locator('[data-action="step-settings"]').first().click();
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('Escape');
    await expect(bar.locator('[data-step-form]')).toHaveCount(0);
    await expect(screen).toHaveClass(/is-max/);
    await page.keyboard.press('1');
    await page.mouse.move(600, 500);
    await page.keyboard.press('Escape');
    // Shrunk: the same table in the side panel, with its slot; the step bar is hidden (no second copy of the chain).
    await expect(screen).not.toHaveClass(/is-max/);
    await expect(screen).toBeVisible();
    await expect(page.locator('#entry-dock #entry-screen')).toHaveCount(1);
    await expect(page.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
    await expect(bar).toBeHidden();
    await expect(page.locator('[data-entry-recipe-chip]')).toHaveCount(0);
    // Narrow, it shows the name and the sorted number; the side plots wait for the width.
    await expect(screen).toHaveAttribute('data-cols', /^[1-3]$/);
    await expect(page.locator('.entry-side')).toBeHidden();
    // ⤢ widens it again.
    await page.locator('.entry-size').click();
    await expect(screen).toHaveClass(/is-max/);
    await expect(screen).toHaveAttribute('data-cols', '6');
    await page.locator('.entry-size').click();
    await expect(screen).not.toHaveClass(/is-max/);
    await page.locator('.entry-size').click();
    await expect(screen).toHaveClass(/is-max/);
});

test('? and F1 show the keys and symbols; the footer hints follow the next step and can be pressed', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    const keys = page.locator('[data-entry-keys] .entry-key');
    await expect(keys).toHaveText([STR.keyHelp]);
    await page.keyboard.press('?');
    const help = page.locator('[data-screen-help]');
    await expect(help).toBeVisible();
    await expect(help.locator('[data-screen-help-keys]')).toContainText('Enter');
    await expect(help.locator('[data-screen-help-symbols]')).toContainText('俯瞰帯');
    // While it is open the table takes no keys: 1 does not slot the row.
    await page.keyboard.press('1');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await expect(page.locator('#entry-screen')).toBeVisible();
    await expect(page.locator('.entry-badge.entry-slot-1')).toHaveCount(0);
    await page.keyboard.press('F1');
    await expect(help).toBeVisible();
    await page.keyboard.press('F1');
    await expect(help).toBeHidden();

    // A row's 1 slots its file like the key; the bar's button (or Enter) opens the comparison.
    const row = page.locator('[data-entry-rows] tr.entry-row').nth(1);
    await row.hover();
    await row.locator('[data-action="entry-row-slot"][data-slot="1"]').click();
    await expect(row.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
    await expect(row.locator('[data-action="entry-row-slot"][data-slot="1"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(keys).toHaveText([STR.keyHelp]);
    await keys.first().click();
    await expect(help).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-action="entry-open"]')).toContainText(STR.entryOpen);
    await page.locator('[data-action="entry-open"]').click();
    await expect(page.locator('.track-stage')).toBeVisible();
    // The comparison has its own list.
    await page.keyboard.press('?');
    await expect(help.locator('[data-screen-help-keys]')).toContainText('D');
    await page.keyboard.press('?');
    await expect(page.locator('.track-stage')).toBeVisible();
});

test('a symbol says what it means in the footer while the pointer is on it; sorting goes back to the top', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openEntry(page, scanned!);
    await page.locator('[data-entry-head] .entry-sort').first().hover();
    await expect(page.locator('#hint-footer')).toHaveText(STR.hintSortMark);
    await page.locator('[data-entry-overview]').hover();
    await expect(page.locator('#hint-footer')).toHaveText(`${STR.hintOverview} · ${STR.compareHintPlot}`);
    const wrap = page.locator('.entry-table-wrap');
    await wrap.evaluate(element => { element.scrollTop = 400; });
    await page.locator('[data-action="entry-sort-band"]').click();
    expect(await wrap.evaluate(element => element.scrollTop)).toBe(0);
});


test('a step added between two chips measures every file again; one that fails on a file is marked and left out; a chain without a spectrum has Leq only', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    const bar = page.locator('#entry-screen [data-step-bar]');
    type Scan = { type: string; requestId: string; recipe?: { nodes: Array<{ id: string; operation: string }> } };
    const lastScan = (): Promise<Scan> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Scan[] })
        .__uiSmokePostedMessages.filter(message => message.type === 'entry-scan').at(-1)!);
    await bar.locator('[data-action="step-expand"]').click();
    // The ＋ on the link after the region adds there.
    const link = bar.locator('[data-action="step-insert"][data-after="node-1"]');
    await link.hover();
    await link.click();
    await expect(bar.locator('.step-menu-title')).toHaveText(STR.stepMenuTitle.replace('{frame}', 'ChannelFrame'));
    await bar.locator('[data-step-menu-filter]').fill('a_weighting');
    await bar.locator('.step-menu-item', { hasText: 'a_weighting' }).click();
    expect(await bar.locator('[data-step-hold]').evaluateAll(chips => chips.map(chip => /wandas (\w+)/.exec(chip.getAttribute('data-hint') ?? '')?.[1]))).toEqual(['highpass_filter', 'time_slice', 'a_weighting', 'welch', 'noct_spectrum']);
    // Nothing is scanned until asked: the table keeps the previous chain's values, greyed.
    await expect(page.locator('.entry-stale-tag')).toBeVisible();
    // Only the focused row is measured. Its new value moves it in the table and the focus stays with it,
    // so the row now on top is not measured in turn (that went on down the whole folder).
    type RowScan = { type: string; requestId: string; filePaths: string[] };
    const rowScans = (): Promise<RowScan[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: RowScan[] })
        .__uiSmokePostedMessages.filter(message => message.type === 'compare-scan'));
    await expect.poll(async () => (await rowScans()).length).toBe(1);
    const [row] = await rowScans();
    await page.evaluate(({ requestId, filePath, result }) => {
        window.postMessage({ type: 'compare-scan-result', requestId, filePath, result }, '*');
        window.postMessage({ type: 'compare-scan-done', requestId }, '*');
    }, { requestId: row.requestId, filePath: row.filePaths[0], result: scanned!.find(file => file.filePath !== row.filePaths[0] && !/rpm_run0[56]/.test(file.filePath))!.result });
    await expect(page.locator('[data-entry-rows] tr.is-focused')).toHaveAttribute('data-file-path', row.filePaths[0]);
    await page.waitForTimeout(800);
    expect((await rowScans()).length).toBe(1);
    await page.locator('[data-action="entry-scan-all"]').click();
    const scan = await lastScan();
    const added = scan.recipe!.nodes.find(node => node.operation === 'wandas.audio.a_weighting')!;
    expect(scan.recipe!.nodes.map(node => node.operation)).toEqual(['wandas.audio.highpass_filter', 'wandas.frame.time_slice', 'wandas.audio.a_weighting', 'wandas.audio.welch']);
    await expect(page.locator('[data-entry-progress]')).toHaveText('1 / 100');
    // The step fails on a file: it turns orange with !, and every file is scanned again without it.
    await page.evaluate(({ requestId, filePath, step }) => {
        window.postMessage({ type: 'entry-scan-result', requestId, filePath, result: { ok: false, reason: 'boom', failedStep: step } }, '*');
    }, { requestId: scan.requestId, filePath: scanned![0].filePath, step: added.id });
    await expect(bar.locator('.step-chip.is-invalid')).toHaveText(/^a_weighting/);
    await expect.poll(async () => (await lastScan()).recipe!.nodes.map(node => node.operation)).toEqual(['wandas.audio.highpass_filter', 'wandas.frame.time_slice', 'wandas.audio.welch']);
    await bar.locator('.step-chip.is-invalid [data-action="step-settings"]').click();
    await expect(bar.locator('.step-form-why')).toHaveText(STR.stepFailedOn.replace('{reason}', 'boom'));
    await bar.locator('[data-action="step-remove"]').click();
    // Without the average spectrum the chain ends in a time signal: the table has Leq and no band columns.
    await expect(page.locator('[data-action="entry-band"]')).toHaveCount(1);
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-settings"]').click();
    await bar.locator('[data-action="step-remove"]').click();
    await expect(page.locator('[data-action="entry-band"]')).toHaveCount(0);
    await expect(page.locator('[data-entry-head] th')).not.toContainText([STR.entryColPeak]);
});

test('the entry table\'s plots answer the lanes\' gestures, and a press that stays put is still a click', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openEntry(page, scanned!);
    const scatter = page.locator('[data-entry-scatter]');
    const box = (await scatter.boundingBox())!;
    // The scatter's plot: 38 px of axis numbers on the left, 6 on top and right, 16 at the bottom.
    const at = (fx: number, fy: number) => ({ x: box.x + 38 + fx * (box.width - 44), y: box.y + 6 + (1 - fy) * (box.height - 22) });
    await expect(scatter).toHaveAttribute('data-window', '0.000-1.000|0.000-1.000');
    const focusedBefore = await page.locator('[data-entry-rows] tr.is-focused').getAttribute('data-file-path');
    // A box dragged on the scatter zooms into it, and the click that ends the drag picks nothing.
    await page.mouse.move(at(0.1, 0.9).x, at(0.1, 0.9).y);
    await page.mouse.down();
    await page.mouse.move(at(0.3, 0.6).x, at(0.3, 0.6).y, { steps: 4 });
    await expect(page.locator('.entry-zoom-box')).toBeVisible();
    await page.mouse.move(at(0.6, 0.4).x, at(0.6, 0.4).y, { steps: 4 });
    await page.mouse.up();
    // To within a pixel's rounding.
    await expect(scatter).toHaveAttribute('data-window', /^0\.(09|10)\d-0\.(59|60)\d\|0\.(39|40)\d-0\.(89|90)\d$/);
    expect(await page.locator('[data-entry-rows] tr.is-focused').getAttribute('data-file-path')).toBe(focusedBefore);
    // Pointed at, the plot says what the pointer can do (away from a point, which names its file instead).
    await page.mouse.move(at(0.02, 0.02).x, at(0.02, 0.02).y);
    await expect(page.locator('#hint-footer')).toHaveText(STR.compareHintPlot);
    // A double-click on the plot shows it whole again; on its x axis it opens the range.
    await page.mouse.dblclick(at(0.5, 0.5).x, at(0.5, 0.5).y);
    await expect(scatter).toHaveAttribute('data-window', '0.000-1.000|0.000-1.000');
    await page.mouse.dblclick(at(0.5, 0).x, box.y + box.height - 5);
    await expect(page.locator('#entry-range-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    // Ctrl+wheel on the strip zooms its bands; a click on it still goes to a row.
    const strip = page.locator('[data-entry-overview]');
    const stripBox = (await strip.boundingBox())!;
    await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect(strip).not.toHaveAttribute('data-window', /^0\.000-1\.000\|/);
    // Its plot sits between the colour scale (14 px) and the frequency axis (26 px).
    await page.mouse.click(stripBox.x + stripBox.width / 2, stripBox.y + 14 + (stripBox.height - 40) * 0.9);
    await expect(page.locator('[data-entry-rows] tr.is-focused')).toHaveCount(1);
    expect(await page.locator('[data-entry-rows] tr.is-focused').getAttribute('data-file-path')).not.toBe(focusedBefore);
});

test('the step bar names the steps in Japanese and says where the table\'s band column comes from', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { language: 'ja', recipe });
    const bar = page.locator('#entry-screen [data-step-bar]');
    await expect(bar.locator('[data-step-input]')).toHaveText('入力 100 本');
    await expect(bar.locator('.step-chip')).toHaveText(['ハイパス 20 Hz', '区間 全体', '平均スペクトル（FFT 1024 点）', '1/3 oct 帯域（表の値）']);
    await bar.locator('.step-chip', { hasText: '1/3 oct' }).locator('.step-body').hover();
    await expect(page.locator('#hint-footer')).toContainText(STR.stepOctaveHint);
});
