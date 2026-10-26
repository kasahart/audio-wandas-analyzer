import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { answerProbe, entry100Metadata, entry100Results, openEntry, pickCsv, type ScannedFile } from './entryHelpers';

let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

type Posted = { type: string; requestId: string; filePaths: string[]; cachedOnly?: boolean; recipe?: { nodes: Array<{ id: string; operation: string }> } };
const posted = (page: Page): Promise<Posted[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages);
const entryScans = async (page: Page): Promise<Posted[]> => (await posted(page)).filter(message => message.type === 'entry-scan');
/** The entry table's state as the test bridge reports it. */
const snapshot = (page: Page) => page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'entry-snapshot', actions: [] } }));
    const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { entry: Record<string, unknown> } }> }).__uiSmokePostedMessages;
    return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi.entry;
});
const rows = (page: Page) => page.locator('[data-entry-rows] tr.entry-row');
const base = (filePath: string): string => path.basename(filePath);
/** The fixture's readable recordings with a judgement and a score, as an ASD tool would write them. */
function scoredCsv(files: readonly ScannedFile[]): string {
    const readable = files.filter(file => (file.result as { ok?: boolean }).ok);
    return ['audio_file,judge,score,lot', ...readable.map((file, index) => `${base(file.filePath)},${index % 7 === 3 ? '要確認' : 'OK'},${((index * 37) % 100 / 100).toFixed(2)},LOT-${index % 3}`)].join('\n') + '\n';
}
async function filterBy(page: Page, column: string): Promise<void> {
    await page.locator(`th[data-column="${column}"] [data-action="entry-fhead"]`).click();
    await expect(page.locator('[data-entry-fpop]')).toBeVisible();
}

test('a folder opens with only what is stored; nothing is computed until 計算, which takes the rows on screen and can be stopped', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja', answered: 0 });
    // Opening asks only for stored results.
    expect((await entryScans(page)).map(message => message.cachedOnly)).toEqual([true]);
    expect((await snapshot(page))?.rows).toBe(100);
    // The value is not computed: its column says so, with no ▾ to sort or filter by it.
    await expect(page.locator('th[data-column="leq"] [data-action="entry-fhead"]')).toHaveCount(0);
    await expect(page.locator('th[data-column="leq"] .entry-th-label')).toHaveAttribute('data-hint', STR.dsNotComputed);
    await expect(rows(page).first().locator('.entry-col-value')).toHaveText('—');
    const compute = page.locator('[data-action="entry-compute"]');
    await expect(compute).toHaveText(new RegExp(`^${STR.dsCompute.replace('{n}', '100').replace(' · 約 {time}', '')}`));
    // Narrowed to the file names with 1500rpm, 計算 takes only those.
    await filterBy(page, 'name');
    await page.locator('[data-entry-fsearch]').fill('1500rpm');
    await page.locator('[data-action="entry-fok"]').click();
    await expect(compute).toHaveText(new RegExp(`^${STR.dsCompute.replace('{n}', '22').replace(' · 約 {time}', '')}`));
    await compute.click();
    const scan = (await entryScans(page)).at(-1)!;
    expect(scan.cachedOnly).toBeUndefined();
    expect(scan.filePaths.length).toBe(22);
    expect(scan.filePaths.every(file => base(file).includes('1500rpm'))).toBe(true);
    await page.evaluate(({ requestId, files }) => {
        for (const file of files) window.postMessage({ type: 'entry-scan-result', requestId, filePath: file.filePath, result: file.result }, '*');
    }, { requestId: scan.requestId, files: scanned!.filter(file => scan.filePaths.slice(0, 3).includes(file.filePath)) });
    await expect(page.locator('[data-entry-progress]')).toHaveText(STR.dsComputing.replace('{done}', '3').replace('{n}', '22'));
    // 中止 keeps what was computed: those rows have values, the rest still none, and 計算 offers the rest.
    await page.locator('[data-action="entry-compute-cancel"]').click();
    expect((await posted(page)).filter(message => message.type === 'entry-scan-cancel').length).toBe(1);
    await expect(compute).toHaveText(new RegExp(`^${STR.dsComputeRest.replace(' · 約 {time}', '')}`));
    await expect(page.locator('[data-entry-uncomputed]')).toHaveText(STR.dsUncomputed.replace('{n}', '19'));
    await expect(page.locator('[data-entry-rows] tr.entry-row .entry-col-value:not(:text("—"))')).toHaveCount(6);
    // The distribution draws the 6 computed channels only and counts the rest (I14).
    expect((await snapshot(page))?.dist).toMatchObject({ missing: 19, unit: 'ch' });
    await expect(page.locator('[data-entry-dist-count]')).toHaveText('6 ch');
});

test('a picked CSV attaches its attributes by asd-insight\'s rules and lists what did not match with why (I5)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    // Without a CSV only the unreadable recording is listed.
    const unmatched = page.locator('[data-action="entry-view-unmatched"]');
    await expect(unmatched).toHaveText(STR.dsUnreadable.replace('{n}', '1'));
    // A CSV that is not UTF-8 is refused with asd-insight's reason; nothing changes.
    await page.locator('[data-entry-csv-input]').setInputFiles({ name: 'sjis.csv', mimeType: 'text/csv', buffer: Buffer.from([0x82, 0xa0, 0x2c, 0x31, 0x0a, 0x31, 0x2c, 0x32]) });
    await expect(page.locator('#hint-footer')).toContainText('UTF-8');
    await expect(page.locator('[data-entry-source]')).toHaveText(STR.dsPickCsv);
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await expect(page.locator('[data-entry-source]')).toHaveText('motor.csv · 98/100');
    // Grouped by its first column that is not a number; its numbers become values to show.
    await expect(page.locator('[data-action="entry-group"]')).toHaveValue('csv:line');
    await expect(page.locator('[data-action="entry-value"] option')).toContainText(['rpm', 'temp_c', 'load_pct']);
    await expect(unmatched).toHaveText(STR.dsUnmatched.replace('{n}', '2'));
    await unmatched.click();
    await expect(page.locator('#entry-screen')).toHaveAttribute('data-mode', 'unmatched');
    await expect(page.locator('[data-entry-rows] .entry-why')).toHaveText([STR.dsReasonUnreadable, STR.dsReasonNoRow]);
    await expect(page.locator('[data-entry-rows] tr').nth(1)).toContainText('mono_48k.wav');
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toHaveAttribute('data-mode', 'all');
});

test('the files\' headers split rows by channel before anything is computed, so ch 2 alone needs no 計算; the reading can be stopped', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja', answered: 0, headers: null });
    // The headers are being read: said with a count, and it can be stopped.
    await expect(page.locator('[data-entry-probing]')).toHaveText(STR.dsProbing.replace('{done}', '0').replace('{n}', '100'));
    await page.locator('[data-action="entry-probe-cancel"]').click();
    expect((await posted(page)).filter(message => message.type === 'entry-probe-cancel').length).toBe(1);
    await expect(page.locator('[data-entry-probing]')).toHaveCount(0);
    expect((await snapshot(page))?.rows).toBe(100);

    await openEntry(page, scanned!, { language: 'ja', answered: 0, headers: null });
    const headers = Object.fromEntries(scanned!.map(file => {
        const result = file.result as { ok?: boolean; input?: { channels: number[] } };
        return [file.filePath, result.ok ? result.input!.channels.length : 'not a WAV header'];
    }));
    await answerProbe(page, headers);
    await expect(page.locator('[data-entry-probing]')).toHaveCount(0);
    // 99 readable recordings, 98 of them with two channels; the one whose header is broken has no row.
    expect((await snapshot(page))?.rows).toBe(197);
    expect((await entryScans(page)).every(message => message.cachedOnly)).toBe(true);
    await filterBy(page, 'ch');
    await expect(page.locator('[data-entry-flist] .entry-ck-n')).toHaveText(['99', '98']);
    await page.locator('[data-entry-fvalue="1"]').uncheck();
    await page.locator('[data-action="entry-fok"]').click();
    expect((await snapshot(page))?.visible).toBe(98);
    await expect(page.locator('[data-action="entry-compute"]')).toHaveText(new RegExp(`^${STR.dsCompute.replace('{n}', '98').replace(' · 約 {time}', '')}`));
});

test('a file added while the headers are read asks again for every header not read yet', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { language: 'en', answered: 0, headers: null });
    const added = '/data/added.flac';
    await page.evaluate(({ added }) => window.postMessage({ type: 'directory-selection', rootPath: '', rootLabel: '', filePaths: [added] }, '*'), { added });
    const probes = async (): Promise<Array<{ filePaths: string[] }>> => (await posted(page)).filter(message => message.type === 'entry-probe') as unknown as Array<{ filePaths: string[] }>;
    await expect.poll(async () => (await probes()).length).toBe(2);
    const last = (await probes()).at(-1)!;
    expect(last.filePaths).toContain(added);
    expect(last.filePaths.length).toBe(scanned!.length + 1);
});

test('a row slotted before its channels are known follows its file to ch 1 once they are', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { language: 'en', answered: 0, headers: null });
    const row = rows(page).nth(1);
    const key = (await row.getAttribute('data-key'))!;
    expect(key).not.toContain('#ch');
    await row.hover();
    await row.locator('[data-action="entry-row-slotmenu"]').click();
    await page.locator('[data-action="entry-row-slot"][data-slot="1"]').click();
    await answerProbe(page, Object.fromEntries(scanned!.map(file => [file.filePath, 2])));
    await expect.poll(async () => (await snapshot(page))?.slots).toEqual([null, `${key}#ch1`, null, null]);
});

test('rows are a recording and its channel; ch 2 alone, then a second filter, and one of two filters taken off (I16, I18, I20)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openEntry(page, scanned!);
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await expect(rows(page)).toHaveCount(Math.min(197, await rows(page).count()));
    expect((await snapshot(page))?.rows).toBe(197);
    await filterBy(page, 'ch');
    // The check list: every value with how many rows have it.
    await expect(page.locator('[data-entry-flist] .entry-ck-v')).toHaveText(['1', '2']);
    await expect(page.locator('[data-entry-flist] .entry-ck-n')).toHaveText(['99', '98']);
    await page.locator('[data-entry-fvalue="1"]').uncheck();
    await page.locator('[data-action="entry-fok"]').click();
    expect((await snapshot(page))?.visible).toBe(98);
    await expect(page.locator('[data-entry-rows] .entry-col-ch')).not.toContainText(['1']);
    await expect(page.locator('[data-testid="fchip"]')).toHaveText([`${STR.dsCh} = 2×`]);
    // The header's ▾ shows it is filtered (▼).
    await expect(page.locator('th[data-column="ch"] [data-action="entry-fhead"]')).toHaveText('▼');
    await filterBy(page, 'csv:line');
    await page.locator('[data-entry-fall]').uncheck();
    await page.locator('[data-entry-fvalue="L2"]').check();
    await page.locator('[data-action="entry-fok"]').click();
    await expect(page.locator('[data-testid="fchip"]')).toHaveCount(2);
    const both = (await snapshot(page))?.visible as number;
    // × on the ch chip takes that filter off and keeps the other.
    await page.locator('[data-testid="fchip"]', { hasText: STR.dsCh }).locator('[data-action="entry-fchip-clear"]').click();
    await expect(page.locator('[data-testid="fchip"]')).toHaveCount(1);
    expect((await snapshot(page))?.visible).toBe(both * 2);
});

test('a column not on screen filters through ＋, a name search keeps 1500rpm, 要確認 only sorted by score (I19, I21, I22)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!);
    await pickCsv(page, 'scores.csv', scoredCsv(scanned!));
    // I19: lot is not on screen (grouped by judge): ＋ picks it and narrows by it.
    await expect(page.locator('[data-action="entry-group"]')).toHaveValue('csv:judge');
    await page.locator('[data-action="entry-fadd"]').click();
    await page.locator('[data-action="entry-fcol"]').selectOption('csv:lot');
    await page.locator('[data-entry-fall]').uncheck();
    await page.locator('[data-entry-fvalue="LOT-1"]').check();
    await page.locator('[data-action="entry-fok"]').click();
    const lots = await page.evaluate(() => [...document.querySelectorAll('[data-entry-rows] tr.entry-row')].length);
    expect(lots).toBeGreaterThan(0);
    await page.locator('[data-action="entry-fchip-clear"]').click();
    // I21: the file names with 1500rpm.
    await filterBy(page, 'name');
    await page.locator('[data-entry-fsearch]').fill('1500rpm');
    await page.locator('[data-action="entry-fok"]').click();
    const names = await page.locator('[data-entry-rows] .entry-nm').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(name => name.includes('1500rpm'))).toBe(true);
    await page.locator('[data-action="entry-fchip-clear"]').click();
    // I22: 要確認 only, the score high to low.
    await page.locator('[data-action="entry-value"]').selectOption('csv:score');
    await filterBy(page, 'csv:judge');
    await page.locator('[data-entry-fvalue="OK"]').uncheck();
    await page.locator('[data-action="entry-fok"]').click();
    await filterBy(page, 'csv:score');
    await page.locator('[data-action="entry-fsort"][data-descending="true"]').click();
    const scores = (await page.locator('[data-entry-rows] .entry-col-value').allTextContents()).map(Number);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    await expect(page.locator('[data-entry-rows] .entry-col-group')).not.toContainText(['OK']);
});

test('a row\'s tools: its slot, a memo kept on Esc, and taken out then put back (I6, I7); empty slot chips take the selected row', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    const row = rows(page).nth(1);
    const key = (await row.getAttribute('data-key'))!;
    await row.hover();
    await row.locator('[data-action="entry-row-slotmenu"]').click();
    await page.locator('[data-action="entry-row-slot"][data-slot="1"]').click();
    await expect(row.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
    expect((await snapshot(page))?.slots).toEqual([null, key, null, null]);
    // An empty chip puts the selected row in; a filled one only goes to its row.
    await rows(page).nth(4).click();
    const other = (await rows(page).nth(4).getAttribute('data-key'))!;
    await page.locator('[data-action="entry-slot"][data-slot="2"]').click();
    expect((await snapshot(page))?.slots).toEqual([null, key, other, null]);
    await page.locator('[data-action="entry-slot"][data-slot="1"]').click();
    expect((await snapshot(page))?.slots).toEqual([null, key, other, null]);
    expect((await snapshot(page))?.focused).toBe(key);
    await page.locator('[data-action="entry-slot-clear"][data-slot="2"]').click();
    expect((await snapshot(page))?.slots).toEqual([null, key, null, null]);
    // I7: M opens the memo; Esc keeps what was written.
    await rows(page).nth(1).click();
    await page.keyboard.press('m');
    await page.locator('[data-entry-memo-text]').fill('ベアリングかも');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-entry-memo]')).toHaveCount(0);
    expect((await snapshot(page))?.memo).toEqual({ [key]: 'ベアリングかも' });
    await expect(rows(page).nth(1).locator('[data-action="entry-row-memo"]')).toHaveClass(/is-on/);
    await expect(rows(page).nth(1).locator('[data-action="entry-row-memo"]')).toHaveAttribute('data-hint', 'ベアリングかも');
    // I6: 外す takes a row out; 除外 lists it and 戻す puts it back.
    const out = rows(page).nth(3);
    const outKey = (await out.getAttribute('data-key'))!;
    await out.hover();
    await out.locator('[data-action="entry-row-exclude"]').click();
    await expect(page.locator('[data-action="entry-view-excluded"]')).toHaveText(STR.dsExcluded.replace('{n}', '1'));
    expect((await snapshot(page))?.visibleKeys).not.toContain(outKey);
    await page.locator('[data-action="entry-view-excluded"]').click();
    await expect(rows(page)).toHaveCount(1);
    await rows(page).first().locator('[data-action="entry-row-restore"]').click();
    await expect(page.locator('[data-action="entry-view-excluded"]')).toHaveText(STR.dsExcluded.replace('{n}', '0'));
    expect((await snapshot(page))?.visibleKeys).toContain(outKey);
});

test('the keyboard alone: ↓ moves, Space plays, 1 slots, Enter compares; keys on a button stay that button\'s (I8)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!);
    await page.locator('[data-entry-table]').focus();
    const first = (await snapshot(page))?.focused as string;
    await page.keyboard.press('ArrowDown');
    const second = (await snapshot(page))?.focused as string;
    expect(second).not.toBe(first);
    await page.keyboard.press(' ');
    await expect.poll(async () => (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths ?? []).toContain(second.replace(/#ch\d+$/, ''));
    await page.keyboard.press('1');
    expect((await snapshot(page))?.slots).toEqual([null, second, null, null]);
    // Enter on a header's ▾ opens its menu only, not the comparison.
    await page.locator('th[data-column="name"] [data-action="entry-fhead"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-entry-fpop]')).toBeVisible();
    await expect(page.locator('.track-stage')).toBeHidden();
    await page.keyboard.press('Escape');
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.track-stage')).toBeVisible();
});

test('the entry table speaks Japanese with few words: value and group, the CSV, and the four columns', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    await expect(page.locator('.entry-pick')).toHaveText([new RegExp(`^${STR.dsValue}`), new RegExp(`^${STR.dsGroup}`)]);
    await expect(page.locator('[data-action="entry-value"] option:checked')).toHaveText(STR.dsLeq);
    await expect(page.locator('[data-entry-head] th')).toHaveCount(4 + (await page.locator('th.entry-col-group, th[data-column^="folder"], th[data-column^="csv"]').count()) );
    await expect(page.locator('[data-entry-head] th').first()).toContainText(STR.entryColFile);
});

test('a folder of 1000 recordings draws only the rows on screen', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    const many = Array.from({ length: 1000 }, (_, index) => ({ ...scanned![index % 90], filePath: `/many/f${String(index).padStart(4, '0')}.wav` }));
    const ms = await openEntry(page, many, { language: 'ja' });
    expect(ms).toBeLessThan(3000);
    expect(await page.locator('[data-entry-rows] tr.entry-row').count()).toBeLessThan(80);
    await expect(page.locator('.entry-th-count')).toHaveText(STR.dsRows.replace('{n}', '1,967'));
});

test('the step bar shows every step of the scan Recipe; an invalid value keeps Apply off and a valid one rescans the table', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    const bar = page.locator('#entry-screen [data-step-bar]');
    // "Steps", the input, then every step as a round chip joined by →, with the stage this screen answers with
    // (the app's 1/3-octave branch) after the chain, framed.
    await expect(bar.locator('.step-name')).toHaveText(STR.btnStage);
    // The whole file is no region: no region chip.
    await expect(bar.locator('.step-chip')).toHaveText(['HPF 20 Hz', `${STR.stepAverage} 1024`, STR.stepOctave]);
    // The app's 1/3-octave branch stands apart at the end, with no arrow from the chain: two links and the end's ＋.
    await expect(bar.locator('.step-arrow')).toHaveCount(3);
    // ＋ is on every link, not only while … is open.
    await expect(bar.locator('[data-action="step-insert"]')).toHaveCount(2);
    await expect(bar.locator('[data-action="step-undo"]')).toBeDisabled();
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
    await expect(bar.locator('.step-chip')).toHaveText(['HPF 20 Hz', `${STR.stepAverage} 1024`, /^1\/3 oct/]);
    // Only ⚙ opens the settings: pressing a chip's body asks for files to compare first.
    await bar.locator('.step-chip').first().locator('.step-body').click();
    await expect(bar.locator('[data-step-form]')).toHaveCount(0);
    await expect(page.locator('#hint-footer')).toHaveText(STR.stepOpenCompare);
    // No Frame names and no method names under the chips: the method is in each chip's hint.
    await expect(bar.locator('.step-op, .step-frame')).toHaveCount(0);
    await expect(bar).not.toContainText('Frame');
    expect(await bar.locator('[data-step-hold]').evaluateAll(chips => chips.map(chip => /wandas (\w+)/.exec(chip.getAttribute('data-hint') ?? '')?.[1]))).toEqual(['highpass_filter', 'welch', 'noct_spectrum']);
    await expect(bar.locator('.step-outside-row .awa-tag')).toHaveText([STR.entryColLeq, STR.outside192, STR.outsideMedian, STR.outsideDelta]);
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
    // Every row is greyed (another chain's values), and nothing is measured by itself, not even the focused row.
    expect((await snapshot(page))?.rows).toBe(197);
    await expect(page.locator('[data-entry-rows] tr.entry-row:not(.is-stale)')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect((await posted(page)).filter(message => message.type === 'compare-scan').length).toBe(0);
    // 計算 says how many files and about how long; it computes with the new chain and can be stopped.
    const compute = page.locator('[data-action="entry-compute"]');
    // The unreadable recording has no row: 99 files to compute.
    await expect(compute).toHaveText(new RegExp(`^${STR.dsCompute.replace('{n}', '99').replace('{time}', '.+')}$`));
    await compute.click();
    const scan = (await scans()).at(-1)!;
    expect(scan.recipe!.nodes.map(node => node.operation)).toEqual(['wandas.audio.highpass_filter', 'wandas.frame.time_slice', 'wandas.audio.welch']);
    expect(scan.filePaths.length).toBe(99);
    await page.evaluate(({ requestId, files }) => {
        for (const file of files.slice(0, 3)) window.postMessage({ type: 'entry-scan-result', requestId, filePath: file.filePath, result: file.result }, '*');
    }, { requestId: scan.requestId, files: scanned!.filter(file => scan.filePaths.slice(0, 3).includes(file.filePath)) });
    await expect(page.locator('[data-entry-progress]')).toHaveText(STR.dsComputing.replace('{done}', '3').replace('{n}', '99'));
    await page.locator('[data-action="entry-compute-cancel"]').click();
    const cancels = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string }> }).__uiSmokePostedMessages.filter(message => message.type === 'entry-scan-cancel').length);
    expect(cancels).toBe(1);
    // Stopped: the files it reached are the new chain's, the rest stay greyed and 「残りを計算」 offers them.
    await expect(compute).toHaveText(new RegExp(`^${STR.dsComputeRest.replace('{time}', '.+')}$`));
    await expect(page.locator('[data-entry-uncomputed]')).toHaveText(STR.dsUncomputed.replace('{n}', String(197 - 6)));
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

    // A row's slot menu slots it like the key; the bar's button (or Enter) opens the comparison.
    const row = page.locator('[data-entry-rows] tr.entry-row').nth(1);
    await row.hover();
    await row.locator('[data-action="entry-row-slotmenu"]').click();
    await page.locator('[data-action="entry-row-slot"][data-slot="1"]').click();
    await expect(row.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
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
    expect(await bar.locator('[data-step-hold]').evaluateAll(chips => chips.map(chip => /wandas (\w+)/.exec(chip.getAttribute('data-hint') ?? '')?.[1]))).toEqual(['highpass_filter', 'a_weighting', 'welch', 'noct_spectrum']);
    // Nothing is scanned until asked: the table keeps the previous chain's values, greyed; not even the focused row is measured.
    await expect(page.locator('[data-entry-rows] tr.entry-row.is-stale').first()).toBeVisible();
    await page.waitForTimeout(400);
    expect((await posted(page)).filter(message => message.type === 'compare-scan').length).toBe(0);
    await page.locator('[data-action="entry-compute"]').click();
    const scan = await lastScan();
    const added = scan.recipe!.nodes.find(node => node.operation === 'wandas.audio.a_weighting')!;
    expect(scan.recipe!.nodes.map(node => node.operation)).toEqual(['wandas.audio.highpass_filter', 'wandas.frame.time_slice', 'wandas.audio.a_weighting', 'wandas.audio.welch']);
    await expect(page.locator('[data-entry-progress]')).toHaveText(STR.dsComputing.replace('{done}', '0').replace('{n}', '99'));
    // The step fails on a file: the chain cannot run from there. It and every step after it (and the table's
    // 1/3-octave branch) are marked ⚠; the scan stops and nothing is computed without the step.
    const scansBefore = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string }> }).__uiSmokePostedMessages.filter(message => message.type === 'entry-scan').length);
    await page.evaluate(({ requestId, filePath, step }) => {
        window.postMessage({ type: 'entry-scan-result', requestId, filePath, result: { ok: false, reason: 'boom', failedStep: step } }, '*');
    }, { requestId: scan.requestId, filePath: scanned![0].filePath, step: added.id });
    await expect(bar.locator('.step-chip.is-invalid')).toHaveText([/^a_weighting/, new RegExp(`^${STR.stepAverage}`), new RegExp(`^${STR.stepOctave}`)]);
    await expect(page.locator('.entry-stale-tag')).toHaveText(STR.entryChainBroken);
    await expect(page.locator('[data-action="entry-compute"]')).toHaveCount(0);
    await expect(page.locator('[data-action="entry-compute-cancel"]')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string }> }).__uiSmokePostedMessages.filter(message => message.type === 'entry-scan').length)).toBe(scansBefore);
    await bar.locator('.step-chip.is-invalid [data-action="step-settings"]').first().click();
    await expect(bar.locator('.step-form-why')).toHaveText(STR.stepFailedOn.replace('{reason}', 'boom'));
    await bar.locator('[data-action="step-remove"]').click();
    // Without the average spectrum the chain ends in a time signal: the values are Leq and the crest factor, no bands or peak.
    const values = page.locator('[data-action="entry-value"] option');
    await expect(values.filter({ hasText: STR.dsPeak })).toHaveCount(1);
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-settings"]').click();
    await bar.locator('[data-action="step-remove"]').click();
    await expect(values.filter({ hasText: STR.dsPeak })).toHaveCount(0);
    await expect(values).toHaveText([STR.dsLeq, STR.dsCrest]);
});

test('the overview strip answers the lanes\' gestures, and a press that stays put is still a click', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!);
    const focusedBefore = await page.locator('[data-entry-rows] tr.is-focused').getAttribute('data-file-path');
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
    await expect(bar.locator('.step-chip')).toHaveText(['ハイパス 20 Hz', '平均スペクトル（FFT 1024 点）', '1/3 oct 帯域（表の値）']);
    await bar.locator('.step-chip', { hasText: '1/3 oct' }).locator('.step-body').hover();
    await expect(page.locator('#hint-footer')).toContainText(STR.stepOctaveHint);
});

test('「計算」\'s estimate follows the recordings\' lengths from their headers, not only how many there are', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    const ten = scanned!.slice(0, 10);
    // Ten 2-second recordings: seconds.
    await openEntry(page, ten, { language: 'ja', answered: 0, headers: Object.fromEntries(ten.map(file => [file.filePath, { channels: 2, durationS: 2 }])) });
    const compute = page.locator('[data-action="entry-compute"]');
    await expect(compute).toHaveText(STR.dsCompute.replace('{n}', '10').replace('{time}', STR.entrySeconds.replace('{n}', '2')));
    // The same ten as 10-minute recordings: minutes.
    await openEntry(page, ten, { language: 'ja', answered: 0, headers: Object.fromEntries(ten.map(file => [file.filePath, { channels: 2, durationS: 600 }])) });
    await expect(compute).toHaveText(STR.dsCompute.replace('{n}', '10').replace('{time}', STR.entryMinutes.replace('{n}', '4')));
});
