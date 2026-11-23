import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, settled, test, type Locator, type Page } from './canvasAudit';
import { getStrings } from '../../shared/i18n/strings';

import { FLAG_COLOR } from '../../shared/gui/roleColors';
import { answerProbe, entry100Metadata, entry100Results, openEntry, openStepsView, pickCsv, type ScannedFile } from './entryHelpers';

const SPECTRUM_VIEW = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };

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

test('a folder opens as a list of its recordings: no analysis is asked for at open, after a filter or after a slot, and nothing offers one', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    expect((await posted(page)).filter(message => message.type === 'entry-open').length).toBe(1);
    expect((await snapshot(page))?.rows).toBe(197);
    // The table shows no value computed from the sound: no value column without a CSV column of numbers.
    await expect(page.locator('[data-entry-head] th.entry-col-value')).toHaveCount(0);
    await expect(page.locator('[data-action="entry-value"] option:checked')).toHaveText(STR.dsValueNone);
    // Narrowed to the file names with 1500rpm, and a row slotted: the entry itself still asks for no scan and no figure,
    // and no button offers one. (The slotted recording becomes a track, analysed as a track is: analyze-selected-files.)
    await filterBy(page, 'name');
    await page.locator('[data-entry-fsearch]').fill('1500rpm');
    await page.locator('[data-action="entry-fok"]').click();
    await rows(page).nth(1).click();
    await page.keyboard.press('1');
    await settled(page);
    await expect(page.locator('[data-action="entry-compute"], [data-action="entry-compute-cancel"], [data-entry-progress]')).toHaveCount(0);
    const analysed = (await posted(page)).map(message => message.type).filter(type => /scan|figure|spectrum|track-detail/u.test(type));
    expect(analysed, 'the entry asks for no scan and no figure: of its own it posts entry-open, entry-probe and its session only').toEqual([]);
});

test('the table shows each file\'s own information from its header (length, sample rate, calibration): it orders the table, a calibration set shows at once, and the table\'s CSV writes it with no analysis value', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    // What each header says: lengths of 2, 12 and 22 s, two sample rates, and the host has a calibration for one file in four.
    const headers = Object.fromEntries(scanned!.map((file, index) => {
        const result = file.result as { ok?: boolean; input?: { channels: number[] } };
        return [file.filePath, result.ok ? { channels: result.input!.channels.length, durationS: 2 + (index % 3) * 10, sampleRate: index % 2 ? 48000 : 16000, calibrated: index % 4 === 0 } : 'not a WAV header'];
    }));
    await openEntry(page, scanned!, { headers });
    await expect(page.locator('[data-entry-head] th.entry-col-info .entry-th-label')).toHaveText([STR.entryColDuration, STR.entryColRate, STR.entryColCalibration]);
    const info = (row: number): Promise<string[]> => rows(page).nth(row).locator('.entry-col-info').allTextContents();
    // Each row says its own file's (a file of two channels: two rows of the same information).
    const said = (row: number): Promise<string[]> => rows(page).nth(row).getAttribute('data-file-path').then(filePath => {
        const header = headers[filePath ?? ''] as { durationS: number; sampleRate: number; calibrated: boolean };
        return [header.durationS.toFixed(header.durationS < 10 ? 2 : 1), String(header.sampleRate), header.calibrated ? STR.entryCalibrated : STR.entryUncalibrated];
    });
    for (const row of [0, 1, 2, 3, 4]) await expect.poll(() => info(row)).toEqual(await said(row));
    expect(new Set((await Promise.all([0, 2, 4, 6, 8, 10].map(info))).map(cells => cells.join(' '))).size, 'the rows differ: lengths, rates and calibrations of several files').toBeGreaterThan(2);
    // The entry shows no value computed from the sound: no value column without a CSV.
    await expect(page.locator('[data-entry-head] th.entry-col-value')).toHaveCount(0);
    // The host says the second file is calibrated now: its rows say so at once, its header not read again.
    const uncalibrated = (await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(async row => ((await info(row))[2] === STR.entryUncalibrated ? row : -1)))).find(row => row >= 0)!;
    const second = (await rows(page).nth(uncalibrated).getAttribute('data-file-path'))!;
    const before = await info(uncalibrated);
    const probes = (await posted(page)).filter(message => message.type === 'entry-probe').length;
    await page.evaluate(filePath => window.postMessage({ type: 'entry-calibration-changed', filePath, calibrated: true }, '*'), second);
    await expect.poll(() => info(uncalibrated)).toEqual([before[0], before[1], STR.entryCalibrated]);
    expect((await posted(page)).filter(message => message.type === 'entry-probe').length).toBe(probes);
    // Ordered by length, the longest first.
    await filterBy(page, 'duration');
    await page.locator('[data-action="entry-fsort"][data-descending="true"]').click();
    await expect.poll(async () => (await info(0))[0]).toBe('22.0');
    const lengths = await rows(page).evaluateAll(items => items.map(row => Number(row.querySelector('.entry-col-info')?.textContent)));
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    // The table's CSV: the file, its channel and information, then the slot, the memo and the exclusion.
    await page.locator('#entry-export-menu > summary').click();
    await page.locator('#entry-export-menu [data-action="entry-export-csv"]').click();
    const text = await page.evaluate(async () => {
        const downloads = (window as unknown as { __uiSmokeDownloads: Array<{ download: string; href: string }> }).__uiSmokeDownloads;
        const last = downloads.at(-1)!;
        return { name: last.download, text: await (await fetch(last.href)).text() };
    });
    expect(text.name).toBe('entry-table.csv');
    const lines = text.text.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe([STR.entryColFile, STR.dsCh, STR.entryColDuration, STR.entryColRate, STR.entryColCalibration, STR.entryCsvSlot, STR.entryCsvMemo, STR.entryCsvExcluded].join(','));
    expect(lines.length - 1).toBe((await snapshot(page)).rows);
    expect(lines.find(line => line.startsWith(`${base(second)},1,`))).toBe(`${base(second)},1,${Number(before[0])},${before[1]},${STR.entryCalibrated},,,`);
});

test('a row\'s ✎ under a resting pointer: the footer says its new hint, the memo, once it is written; the button is the same one (#781)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openEntry(page, scanned!);
    await settled(page);
    const row = rows(page).nth(1);
    await row.click();
    const memo = row.locator('[data-action="entry-row-memo"]');
    await memo.hover();
    await expect(page.locator('#hint-footer')).toHaveText(STR.dsRowMemo);
    await memo.evaluate(button => { (window as unknown as { memoButton: Element }).memoButton = button; });
    // Written from the keyboard, the pointer resting where it was: the button stays and only its hint changes.
    await page.keyboard.press('m');
    await page.locator('[data-entry-memo-text]').fill('bearing noise');
    await page.keyboard.press('Escape');
    await expect(memo).toHaveAttribute('data-hint', 'bearing noise');
    expect(await memo.evaluate(button => button === (window as unknown as { memoButton: Element }).memoButton)).toBe(true);
    await expect(page.locator('#hint-footer')).toHaveText('bearing noise');
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
    // Each why in the failure's orange (R5).
    const flag = `rgb(${[1, 3, 5].map(at => parseInt(FLAG_COLOR.slice(at, at + 2), 16)).join(', ')})`;
    for (const why of await page.locator('[data-entry-rows] .entry-why').all()) await expect(why).toHaveCSS('color', flag);
    await expect(page.locator('[data-entry-rows] tr').nth(1)).toContainText('mono_48k.wav');
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toHaveAttribute('data-mode', 'all');
});

test('the files\' headers split rows by channel; the reading can be stopped', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja', headers: null });
    // The headers are being read: said with a count, and it can be stopped.
    await expect(page.locator('[data-entry-probing]')).toHaveText(STR.dsProbing.replace('{done}', '0').replace('{n}', '100'));
    await page.locator('[data-action="entry-probe-cancel"]').click();
    expect((await posted(page)).filter(message => message.type === 'entry-probe-cancel').length).toBe(1);
    await expect(page.locator('[data-entry-probing]')).toHaveCount(0);
    expect((await snapshot(page))?.rows).toBe(100);

    await openEntry(page, scanned!, { language: 'ja', headers: null });
    const headers = Object.fromEntries(scanned!.map(file => {
        const result = file.result as { ok?: boolean; input?: { channels: number[] } };
        return [file.filePath, result.ok ? result.input!.channels.length : 'not a WAV header'];
    }));
    await answerProbe(page, headers);
    await expect(page.locator('[data-entry-probing]')).toHaveCount(0);
    // 99 readable recordings, 98 of them with two channels; the one whose header is broken has no row.
    expect((await snapshot(page))?.rows).toBe(197);
    await filterBy(page, 'ch');
    await expect(page.locator('[data-entry-flist] .entry-ck-n')).toHaveText(['99', '98']);
    await page.locator('[data-entry-fvalue="1"]').uncheck();
    await page.locator('[data-action="entry-fok"]').click();
    expect((await snapshot(page))?.visible).toBe(98);
});

test('a file added while the headers are read asks again for every header not read yet', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { language: 'en', headers: null });
    const added = '/data/added.flac';
    await page.evaluate(({ added }) => window.postMessage({ type: 'directory-selection', rootPath: '', rootLabel: '', filePaths: [added] }, '*'), { added });
    const probes = async (): Promise<Array<{ filePaths: string[] }>> => (await posted(page)).filter(message => message.type === 'entry-probe');
    await expect.poll(async () => (await probes()).length).toBe(2);
    const last = (await probes()).at(-1)!;
    expect(last.filePaths).toContain(added);
    expect(last.filePaths.length).toBe(scanned!.length + 1);
});

test('a row slotted before its channels are known follows its file to ch 1 once they are', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { language: 'en', headers: null });
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

test('a row\'s tools: its slot, a memo kept on Esc, and taken out then put back (I6, I7)', async ({ page }) => {
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
    // A key puts the selected row in; the row's menu takes it out again (the panel has no slot chips of its own).
    await expect(page.locator('[data-action="entry-slot"]')).toHaveCount(0);
    await rows(page).nth(4).click();
    const other = (await rows(page).nth(4).getAttribute('data-key'))!;
    await page.keyboard.press('2');
    expect((await snapshot(page))?.slots).toEqual([null, key, other, null]);
    await rows(page).nth(4).locator('[data-action="entry-row-slotmenu"]').click();
    await page.locator('[data-action="entry-row-slot"][data-slot="-1"]').click();
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

test('the entry table speaks Japanese with few words: value and group, the CSV, and the columns of the file and its own information', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    await expect(page.locator('.entry-pick:not([hidden])')).toHaveText([new RegExp(`^${STR.dsValue}`), new RegExp(`^${STR.dsGroup}`)]);
    await expect(page.locator('[data-action="entry-value"] option:checked')).toHaveText(STR.dsValueNone);
    // ☑ (on a track), the file, ch, its length, sample rate and calibration, and the spare end, plus a group column when grouped.
    await expect(page.locator('[data-entry-head] th')).toHaveCount(7 + (await page.locator('th.entry-col-group, th[data-column^="folder"], th[data-column^="csv"]').count()) );
    await expect(page.locator('[data-entry-head] th.entry-col-info .entry-th-label')).toHaveText([STR.entryColDuration, STR.entryColRate, STR.entryColCalibration]);
    await expect(page.locator('[data-entry-head] th').nth(1)).toContainText(STR.entryColFile);
});

test('a folder of 1000 recordings draws only the rows on screen, but its head and its filter lists count every row, not the rows drawn', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    const many = Array.from({ length: 1000 }, (_, index) => ({ ...scanned![index % 90], filePath: `/many/f${String(index).padStart(4, '0')}.wav` }));
    const ms = await openEntry(page, many, { language: 'ja' });
    test.info().annotations.push({ type: 'timing', description: `1000 recordings' first rows ${ms.toFixed(1)} ms (target 3000 ms)` });
    // A wall-clock budget, held only with AWA_PERF=1; the row count below is always held.
    if (process.env['AWA_PERF'] === '1') expect(ms).toBeLessThan(3000);
    expect(await page.locator('[data-entry-rows] tr.entry-row').count()).toBeLessThan(80);
    await expect(page.locator('.entry-th-count')).toHaveText(STR.dsRows.replace('{n}', '1,967'));
    // The ch filter's list counts every row of each channel, the rows drawn or not.
    await filterBy(page, 'ch');
    const counts = (await page.locator('[data-entry-flist] .entry-ck-n').allTextContents()).map(text => Number(text.replace(/,/g, '')));
    expect(counts.reduce((sum, n) => sum + n, 0)).toBe(1967);
});

test('the step bar (in 比較解析) shows every step of the scan Recipe; an invalid value keeps Apply off and a valid one is applied; the folder is not scanned', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    // The table carries no step bar: the chain is edited where the analysis is decided, the track view's 比較解析.
    await expect(page.locator('#entry-screen [data-step-bar]')).toHaveCount(0);
    await openStepsView(page, scanned!, SPECTRUM_VIEW);
    const bar = page.locator('.track-stage-bar');
    // The recipe button (the preset the chain is), the input, then every step of the Recipe as a round chip joined by →: no chip of the app's own.
    await expect(bar.locator('.step-preset')).toHaveText(STR.stepPresetButton.replace('{name}', STR.presetSpectrumName));
    // The whole file is no region: no region chip.
    await expect(bar.locator('.step-chip:not([data-step-input])')).toHaveText(['HPF 20 Hz', `${STR.stepAverage} 1024`]);
    // Two links and the end's ＋.
    await expect(bar.locator('.step-arrow')).toHaveCount(3);
    // ＋ is on every link, not only while … is open.
    await expect(bar.locator('[data-action="step-insert"]')).toHaveCount(2);
    await expect(bar.locator('[data-action="step-undo"]')).toBeDisabled();
    await expect(bar.locator('.step-branch')).toHaveCount(0);
    // The first opening shows the input, the recordings as they are.
    await expect(bar.locator('.step-chip.is-current')).toHaveAttribute('data-step-input', '');
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
    await expect(bar.locator('.step-chip:not([data-step-input])')).toHaveText(['HPF 20 Hz', `${STR.stepAverage} 1024`]);
    // Only ⚙ opens the settings: pressing a chip's body shows that step.
    await bar.locator('.step-chip:not([data-step-input])').first().locator('.step-body').click();
    await expect(bar.locator('[data-step-form]')).toHaveCount(0);
    // No Frame names and no method names under the chips: the method is in each chip's hint.
    await expect(bar.locator('.step-op, .step-frame')).toHaveCount(0);
    await expect(bar).not.toContainText('Frame');
    expect(await bar.locator('[data-step-hold]:not([data-step-hold="node-input"])').evaluateAll(chips => chips.map(chip => /wandas (\w+)/.exec(chip.getAttribute('data-hint') ?? '')?.[1]))).toEqual(['highpass_filter', 'welch']);
    // Nothing is computed beside the chain any more (the table's fixed analysis is gone): no row of it.
    await expect(bar.locator('.step-outside-row')).toHaveCount(0);
    await expect(bar.locator('.step-chip:not([data-step-input])').nth(0)).toContainText('HPF 20 Hz');
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
    await page.locator('[data-entry-head] th').nth(1).click();
    await expect(bar.locator('[data-step-form]')).toHaveCount(0);
    await bar.locator('[data-action="step-settings"]').first().click();
    await bar.locator('[data-step-param="cutoff"]').fill('9000');
    await expect(bar.locator('.step-field.is-invalid')).toHaveCount(1);
    await expect(bar.locator('[data-action="step-apply"]')).toBeDisabled();
    await bar.locator('.step-field.is-invalid').hover();
    await expect(page.locator('#hint-footer')).toHaveText(STR.stepNeedBelow.replace('{max}', '8000'));
    await bar.locator('[data-step-param="cutoff"]').fill('100');
    await bar.locator('[data-action="step-apply"]').click();
    await expect(bar.locator('.step-chip:not([data-step-input])').nth(0)).toContainText('HPF 100 Hz');
    await expect(page.locator('#entry-screen')).toBeVisible();
    // A new chain analyses nothing of the folder: the table is a list, and no button offers a computation.
    expect(await entryScans(page)).toEqual([]);
    expect((await snapshot(page))?.rows).toBe(197);
    await expect(page.locator('[data-entry-rows] tr.entry-row.is-stale')).toHaveCount(0);
    await expect(page.locator('[data-action="entry-compute"]')).toHaveCount(0);
});

test('Esc shrinks the maximized table into the side panel, which ⤢ widens again', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    const screen = page.locator('#entry-screen');
    await expect(screen).toHaveClass(/is-max/);
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    await page.mouse.move(600, 500);
    await page.keyboard.press('Escape');
    // Shrunk: the same table in the side panel, with its slot; no step bar (the chain lives in 比較解析).
    await expect(screen).not.toHaveClass(/is-max/);
    await expect(screen).toBeVisible();
    await expect(page.locator('#entry-dock #entry-screen')).toHaveCount(1);
    await expect(page.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
    await expect(page.locator('#entry-screen [data-step-bar]')).toHaveCount(0);
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
    await expect(page.locator('#help-open-btn')).toHaveText(STR.helpOpen);
    await page.keyboard.press('?');
    const help = page.locator('[data-screen-help]');
    await expect(help).toBeVisible();
    await expect(help.locator('[data-screen-help-keys]')).toContainText('Enter');
    await expect(help.locator('[data-screen-help-symbols]')).toContainText('分布');
    // What the entry no longer has is not explained: the strip of levels, a fixed difference.
    await expect(help.locator('[data-screen-help-symbols]')).not.toContainText('俯瞰帯');
    await expect(help.locator('[data-screen-help-symbols]')).not.toContainText('固定');
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
    await page.locator('#help-open-btn').click();
    await expect(help).toBeVisible();
    await expect(help.locator('[data-help-section="entry"]')).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-action="entry-open"]')).toContainText(STR.entryOpen);
    await page.locator('[data-action="entry-open"]').click();
    await expect(page.locator('.track-stage')).toBeVisible();
    // The comparison has its own list.
    await page.keyboard.press('?');
    await expect(help.locator('[data-screen-help-keys]')).toContainText('B');
    await page.keyboard.press('?');
    await expect(page.locator('.track-stage')).toBeVisible();
});

test('a step\'s ⚙ offers every value wandas describes: sound_level\'s weighting and dB, welch\'s average under "more", written into the Recipe', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    await openStepsView(page, scanned!, SPECTRUM_VIEW);
    const bar = page.locator('.track-stage-bar');
    type Node = { id: string; operation: string; params: { entries: Array<[string, unknown]> } };
    type Scan = { type: string; recipe?: { nodes: Node[] } };
    const lastScan = (): Promise<Scan> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Scan[] })
        .__uiSmokePostedMessages.filter(message => message.type === 'compare-scan' && message.recipe).at(-1)!);
    await bar.locator('[data-action="step-expand"]').click();
    await bar.locator('[data-action="step-insert"][data-after="node-1"]').click();
    await bar.locator('[data-step-menu-filter]').fill('sound_level');
    await bar.locator('.step-menu-item', { hasText: 'sound_level' }).click();
    // Its ⚙ has wandas' values at wandas' defaults, not "no settings".
    await bar.locator('.step-chip', { hasText: 'sound_level' }).locator('[data-action="step-settings"]').click();
    const form = bar.locator('[data-step-form]');
    await expect(form.locator('.step-form-note')).toHaveCount(0);
    await expect(form.locator('[data-step-param="freq_weighting"]')).toHaveValue('Z');
    await expect(form.locator('[data-step-param="freq_weighting"] option')).toHaveText(['A', 'C', 'Z', STR.stepNone]);
    await expect(form.locator('[data-step-param="time_weighting"]')).toHaveValue('Fast');
    await expect(form.locator('[data-step-param="dB"]')).not.toBeChecked();
    await form.locator('[data-step-param="freq_weighting"]').selectOption('A');
    await form.locator('[data-step-param="dB"]').check();
    await form.locator('[data-action="step-apply"]').click();
    await expect(bar.locator('[data-step-form]')).toHaveCount(0);
    // Reopened, the form keeps them and marks them as changed.
    await bar.locator('.step-chip', { hasText: 'sound_level' }).locator('[data-action="step-settings"]').click();
    await expect(form.locator('[data-step-param="freq_weighting"]')).toHaveValue('A');
    await expect(form.locator('.step-field.is-changed')).toHaveCount(2);
    await page.keyboard.press('Escape');
    // welch's five values: four shown, average behind "1 more (average)".
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-settings"]').click();
    const more = form.locator('details.step-more');
    await expect(more.locator('summary')).toHaveText(STR.stepMore.replace('{n}', '1').replace('{names}', 'average'));
    await expect(more.locator('[data-step-param="average"]')).toBeHidden();
    await more.locator('summary').click();
    await more.locator('[data-step-param="average"]').selectOption('median');
    await form.locator('[data-action="step-apply"]').click();
    // The Recipe the comparison asks its pictures with carries exactly the changed values, in wandas' encoding.
    const nodes = (await lastScan()).recipe!.nodes;
    expect(nodes.find(node => node.operation === 'wandas.audio.sound_level')!.params.entries).toEqual([['dB', true], ['freq_weighting', 'A']]);
    expect(nodes.find(node => node.operation === 'wandas.audio.welch')!.params.entries).toContainEqual(['average', 'median']);
    // ↶ takes the last change back.
    await bar.locator('[data-action="step-undo"]').click();
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-settings"]').click();
    await expect(form.locator('[data-step-param="average"]')).toHaveValue('mean');
});

test('the step bar names the steps in Japanese', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { language: 'ja', recipe });
    await openStepsView(page, scanned!, SPECTRUM_VIEW);
    const bar = page.locator('.track-stage-bar');
    await expect(bar.locator('.step-preset')).toHaveText('レシピ: 全体のスペクトル');
    await expect(bar.locator('[data-step-input]')).toHaveText('入力');
    await expect(bar.locator('.step-chip:not([data-step-input])')).toHaveText(['ハイパス 20 Hz', '平均スペクトル（FFT 1024 点）']);
});

/** Whether a header's words stay whole ("A特性" on one line) and its text stays inside the cell. */
const headerFit = (page: Page, column: string) => page.locator(`th[data-column="${column}"]`).evaluate(th => {
    const text = th.querySelector('.entry-th-label')!.firstChild!;
    const rects = (from: number, to: number): DOMRect[] => {
        const range = document.createRange();
        range.setStart(text, from);
        range.setEnd(text, to);
        return [...range.getClientRects()];
    };
    const at = text.textContent!.indexOf('A特性');
    const cell = th.getBoundingClientRect();
    return {
        wordLines: at < 0 ? 1 : new Set(rects(at, at + 3).map(rect => Math.round(rect.top))).size,
        inside: rects(0, text.textContent!.length).every(rect => rect.left >= cell.left - 0.5 && rect.right <= cell.right + 0.5),
        lines: new Set(rects(0, text.textContent!.length).map(rect => Math.round(rect.top))).size,
    };
});

for (const language of ['ja', 'en'] as const) {
    test(`the headers of a file's information stay whole inside their columns maximized; docked, those columns are not shown (${language})`, async ({ page }) => {
        test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
        await openEntry(page, scanned!, { language, docked: true });
        // Beside the tracks the table is for finding a file: no column of its information, so the names have the room.
        await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
        await expect(page.locator('th[data-column="duration"]')).toBeHidden();
        await expect(page.locator('[data-entry-rows] tr.entry-row .entry-col-info').first()).toBeHidden();
        // The ▾ takes only its glyph and padding, whatever the font: a ▾ of a fixed width took "ch"'s room in its 3.8em
        // column and broke it where the font's glyphs are wider (#781's first fix, seen in CI only).
        const chButton = await page.locator('th[data-column="ch"] [data-action="entry-fhead"]').evaluate(button => {
            const range = document.createRange();
            range.selectNodeContents(button);
            return { width: button.getBoundingClientRect().width, glyph: range.getBoundingClientRect().width, padding: parseFloat(getComputedStyle(button).paddingLeft) + parseFloat(getComputedStyle(button).paddingRight) };
        });
        expect(chButton.width, 'the ▾ is as wide as its glyph and padding').toBeLessThanOrEqual(chButton.glyph + chButton.padding + 0.5);
        expect((await headerFit(page, 'ch')).lines, 'ch docked').toBe(1);
        await page.locator('.entry-size').click();
        await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
        await expect(page.locator('[data-entry-rows] tr.entry-row .entry-col-info').first()).toBeVisible();
        for (const column of ['duration', 'fs', 'calibration']) {
            const fit = await headerFit(page, column);
            expect(fit.lines, `${column}: one line`).toBe(1);
            expect(fit.inside, `${column}: inside its column`).toBe(true);
        }
        // A word that fits is never broken: "ch" stays "ch", not "c / h".
        expect((await headerFit(page, 'ch')).lines, 'ch maximized').toBe(1);
    });
}

test('docked beside the tracks, the footer\'s help button lists the table\'s keys first and gives the focus back to the table', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { language: 'ja', docked: true });
    const row = page.locator('[data-entry-rows] tr.entry-row').first();
    await row.locator('.entry-nm').click();
    await page.locator('#help-open-btn').click();
    const help = page.locator('[data-screen-help]');
    await expect(help).toBeVisible();
    await expect(help.locator('[data-help-section="entry"]')).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    expect(await page.evaluate(() => !!document.activeElement?.closest('#entry-screen'))).toBe(true);
});

test('a CSV value with a long name with no spaces still stays inside its column maximized', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { language: 'ja', docked: true });
    await page.locator('.entry-size').click();
    for (const name of ['異常度スコアの移動平均値', 'anomaly_score_moving_average']) {
        const readable = scanned!.filter(file => (file.result as { ok?: boolean }).ok);
        await pickCsv(page, `${name}.csv`, [`audio_file,${name}`, ...readable.map((file, index) => `${base(file.filePath)},${(index / 10).toFixed(1)}`)].join('\n') + '\n');
        await page.locator('[data-action="entry-value"]').selectOption(`csv:${name}`);
        await expect(page.locator(`th[data-column="csv:${name}"] .entry-th-label`)).toHaveText(name);
        expect((await headerFit(page, `csv:${name}`)).inside, name).toBe(true);
    }
});

test('「トラックのみ」 lists only the files on a track', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { language: 'ja', docked: true });
    const first = rows(page).first();
    const filePath = await first.getAttribute('data-file-path');
    await first.locator('td.entry-mark').click();
    await expect(first).toHaveClass(/is-shown/);
    await page.locator('[data-action="entry-tracks-only"]').click();
    // The file's rows (one per channel) and no other file's.
    await expect.poll(() => rows(page).evaluateAll(items => [...new Set(items.map(row => row.getAttribute('data-file-path')))])).toEqual([filePath]);
    expect(await entryScans(page)).toEqual([]);
});

/** Space on a focused ☑: off, then on again with no new focus — the redrawn mark keeps the focus. */
async function pressMarkTwice(page: Page, mark: Locator): Promise<void> {
    const checked = await mark.getAttribute('aria-checked');
    const other = checked === 'true' ? 'false' : 'true';
    await page.keyboard.press(' ');
    await expect(mark).toHaveAttribute('aria-checked', other);
    await expect(mark).toBeFocused();
    await page.keyboard.press(' ');
    await expect(mark).toHaveAttribute('aria-checked', checked!);
    await expect(mark).toBeFocused();
}

test('the ☐ / ☑ of a row takes T, Enter and Space; widened, the table keeps Tab and clicks from the track view under it', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openEntry(page, scanned!);
    // The track view under the widened table is inert: Tab never reaches its toolbar.
    await expect(page.locator('#selection-results-pane')).toHaveAttribute('inert', '');
    await expect(page.locator('#selection-toolbar')).toHaveAttribute('inert', '');
    for (let step = 0; step < 30; step++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('#selection-results-pane, #selection-toolbar'))).toBe(false);
    }
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('ArrowDown');
    const row = page.locator('[data-entry-rows] tr.entry-row.is-focused');
    const mark = row.locator('[data-action="entry-row-track"]');
    // The focused row's mark is the one Tab reaches; it is a checkbox, not the ● of a step's output.
    await expect(mark).toHaveAttribute('role', 'checkbox');
    await expect(mark).toHaveAttribute('tabindex', '0');
    await expect(page.locator('[data-entry-rows] tr.entry-row:not(.is-focused) [data-action="entry-row-track"]').first()).toHaveAttribute('tabindex', '-1');
    await expect(mark).toHaveText('☐');
    const filePath = (await row.getAttribute('data-file-path'))!;
    const shown = async (): Promise<string[] | undefined> => (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths;
    await page.keyboard.press('t');
    await expect.poll(shown).toEqual([filePath]);
    await page.evaluate(filePath => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5], max: [0.5], minT: [0.1], maxT: [0.4], absolutePeak: 0.5 } }],
    }] } })), filePath);
    await expect(mark).toHaveText('☑');
    await expect(mark).toHaveAttribute('aria-checked', 'true');
    // Space (or Enter) on the mark itself takes the track off again, and the focus stays on the redrawn mark.
    await mark.focus();
    await pressMarkTwice(page, mark);
    await page.keyboard.press('Enter');
    await expect(mark).toHaveAttribute('aria-checked', 'false');
    await expect(mark).toHaveText('☐');
    await expect(mark).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(mark).toHaveAttribute('aria-checked', 'true');
    await expect(mark).toBeFocused();
    // The help says so, in the entry table's section, which comes first.
    await page.keyboard.press('?');
    const help = page.locator('[data-screen-help]');
    await expect(help.locator('[data-help-section]').first()).toHaveAttribute('data-help-section', 'entry');
    await expect(help.locator('[data-help-section="entry"]')).toContainText(STR.helpEntryTrack);
    await expect(help.locator('[data-screen-help-symbols]')).toContainText('☐ / ☑');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    // Shrunk into the side panel, the track view takes Tab again.
    await page.locator('[data-action="entry-maximize"]').click();
    await expect(page.locator('#selection-results-pane')).not.toHaveAttribute('inert', '');
});

test('docked, the selected row looks like the others: its name stays readable and its tools come only under the mouse', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { docked: true });
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('ArrowDown');
    const row = page.locator('[data-entry-rows] tr.entry-row.is-focused');
    await page.mouse.move(0, 0);
    // Its tools take no room (a pixel at most) and show nothing.
    for (const action of ['entry-row-play', 'entry-row-memo', 'entry-row-exclude']) {
        expect((await row.locator(`[data-action="${action}"]`).boundingBox())?.width ?? 0, action).toBeLessThanOrEqual(1);
    }
    const name = (await row.locator('.entry-nm').boundingBox())!;
    expect(name.width).toBeGreaterThan(60);
    // With no value column the name takes the room the channel leaves, and the header lines up with the rows.
    const table = (await page.locator('[data-entry-table]').boundingBox())!;
    const cell = (await row.locator('td.entry-name').boundingBox())!;
    expect(cell.width).toBeGreaterThan(table.width * 0.6);
    expect((await page.locator('th[data-column="name"]').boundingBox())!.width).toBeCloseTo(cell.width, 0);
    // Under the mouse its tools are there, as on any row.
    await row.locator('.entry-nm').hover();
    await expect(row.locator('[data-action="entry-row-play"]')).toBeVisible();
    await expect(row.locator('[data-action="entry-row-exclude"]')).toBeVisible();
    // The keyboard alone still reaches them: Tab from the row's ☐ / ☑ walks its tools, which show while they have the focus.
    await page.mouse.move(0, 0);
    await row.locator('[data-action="entry-row-track"]').focus();
    const exclude = row.locator('[data-action="entry-row-exclude"]');
    for (let step = 0; step < 6 && !(await exclude.evaluate(element => element === document.activeElement)); step++) await page.keyboard.press('Tab');
    await expect(exclude).toBeFocused();
    expect((await exclude.boundingBox())!.width).toBeGreaterThan(20);
    const excludedKey = await row.getAttribute('data-key');
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-entry-rows] tr.entry-row[data-key="${excludedKey}"]`)).toHaveCount(0);
});

test('docked, Space on a row\'s ☐ / ☑ toggles it each time and never reaches the lanes\' playback', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { docked: true });
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('ArrowDown');
    const mark = page.locator('[data-entry-rows] tr.entry-row.is-focused [data-action="entry-row-track"]');
    await mark.focus();
    await expect(mark).toHaveText('☐');
    await pressMarkTwice(page, mark);
    await expect(mark).toHaveText('☐');
    await page.keyboard.press('Enter');
    await expect(mark).toHaveAttribute('aria-checked', 'true');
    await expect(mark).toBeFocused();
    await expect(page.locator('[data-action="toggle-playback"].is-playing')).toHaveCount(0);
});

test('↓ on a row\'s ☐ / ☑ takes the focus to the next row\'s mark, so Space toggles the row that is lit', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { docked: true });
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('ArrowDown');
    const firstMark = page.locator('[data-entry-rows] tr.entry-row.is-focused [data-action="entry-row-track"]');
    await firstMark.focus();
    const firstKey = await firstMark.getAttribute('data-key');
    await page.keyboard.press('ArrowDown');
    const litMark = page.locator('[data-entry-rows] tr.entry-row.is-focused [data-action="entry-row-track"]');
    await expect(litMark).not.toHaveAttribute('data-key', firstKey ?? '');
    await expect(litMark).toBeFocused();
    await page.keyboard.press('Space');
    await expect(litMark).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(`[data-entry-rows] [data-action="entry-row-track"][data-key="${firstKey}"]`)).toHaveAttribute('aria-checked', 'false');
});

test('maximized, the help\'s Tab stays in the help: the table behind it does not take Tab', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!);
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('?');
    await expect(page.locator('#help-overlay')).toBeVisible();
    for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Tab']) {
        await page.keyboard.press(key);
        expect(await page.evaluate(() => !!document.activeElement?.closest('#help-overlay'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('#help-overlay')).toBeHidden();
});

test('the side panel\'s edge from the keyboard: End past 60 % of the window maximizes the table, as a drag does', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!, { docked: true });
    const edge = page.locator('#tree-resizer');
    const sidebar = page.locator('#selection-sidebar');
    const width = (await sidebar.boundingBox())!.width;
    await edge.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    const widened = (await sidebar.boundingBox())!.width;
    expect(widened).toBeGreaterThan(width);
    await page.keyboard.press('End');
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    // The panel keeps the width it had.
    await page.locator('[data-action="entry-maximize"]').click();
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(Math.round(widened));
});

test('the recipe button starts the chain from a preset: its last step is asked for and shown, ↶ brings the chain back', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    await openStepsView(page, scanned!, SPECTRUM_VIEW);
    const bar = page.locator('.track-stage-bar');
    const button = bar.locator('[data-action="step-preset-open"]');
    await button.click();
    const menu = bar.locator('[data-step-preset-menu]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.step-preset-name')).toHaveText([STR.presetSpectrumName, STR.presetOctaveName, STR.presetSpectrogramName, STR.presetLevelName, STR.presetLoudnessName, STR.presetRoughnessName]);
    // The menu sits inside the window.
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const before = (await posted(page)).length;
    // Chosen from the keyboard (the footer says what happened; the button and the chips show it to the pointer too).
    await page.mouse.move(0, 0);
    await menu.locator('[data-preset="loudness"]').focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(button).toHaveText(STR.stepPresetButton.replace('{name}', STR.presetLoudnessName));
    await expect(page.locator('#hint-footer')).toHaveText(STR.stepPresetApplied.replace('{name}', STR.presetLoudnessName));
    await expect(bar.locator('.step-chip.is-current')).toContainText('loudness');
    // The comparison asks for the new chain's last step: the loudness over time.
    type Scan = { type: string; requestId: string; stage?: string; recipe?: { output: string; nodes: Array<{ id: string; operation: string }> } };
    await expect.poll(async () => (await posted(page)).slice(before).some(message => {
        const scan = message as unknown as Scan;
        return scan.type === 'compare-scan' && scan.requestId.startsWith('track-stage') && !!scan.recipe && scan.stage === scan.recipe.output
            && scan.recipe.nodes.find(node => node.id === scan.stage)?.operation === 'wandas.audio.loudness_zwtv';
    })).toBe(true);
    await bar.locator('[data-action="step-undo"]').click();
    await expect(button).toHaveText(STR.stepPresetButton.replace('{name}', STR.presetSpectrumName));
    await expect(bar.locator('.step-chip:not([data-step-input])')).toHaveText(['HPF 20 Hz', `${STR.stepAverage} 1024`]);
});

test('typing in ＋\'s filter with an IME redraws only the list: the composition survives and its confirming Enter adds nothing', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    await openStepsView(page, scanned!, SPECTRUM_VIEW);
    const bar = page.locator('.track-stage-bar');
    await bar.locator('[data-action="step-expand"]').click();
    const link = bar.locator('[data-action="step-insert"][data-after="node-1"]');
    await link.hover();
    await link.click();
    const filter = bar.locator('[data-step-menu-filter]');
    await expect(filter).toBeFocused();
    await filter.evaluate(element => { (window as unknown as { __filter: Element }).__filter = element; });
    const sameField = (): Promise<boolean> => filter.evaluate(element => element === (window as unknown as { __filter: Element }).__filter && document.activeElement === element);
    const chips = await bar.locator('.step-chip').count();
    const cdp = await page.context().newCDPSession(page);
    // A composition in progress: each update is an input event, and the list follows it without touching the field.
    await cdp.send('Input.imeSetComposition', { text: 'ｆ', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.imeSetComposition', { text: 'ｆｆ', selectionStart: 2, selectionEnd: 2 });
    expect(await sameField()).toBe(true);
    await expect(filter).toHaveValue('ｆｆ');
    // The Enter that confirms the conversion comes while composing: it adds no operation.
    await filter.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true })));
    await expect(bar.locator('[data-step-menu]')).toBeVisible();
    expect(await bar.locator('.step-chip').count()).toBe(chips);
    await cdp.send('Input.insertText', { text: 'fft' });
    await expect(filter).toHaveValue('fft');
    expect(await sameField()).toBe(true);
    await expect(bar.locator('.step-menu-item:not(.is-off)').first()).toHaveAttribute('data-op', /fft/);
    // A plain Enter adds the first operation listed.
    await filter.press('Enter');
    await expect(bar.locator('[data-step-menu]')).toHaveCount(0);
    await expect(bar.locator('.step-chip')).toHaveCount(chips + 1);
});

test('widened, the name takes the free width and keeps its end in sight; in a narrow window the distribution goes below the table', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEntry(page, scanned!, 'en');
    const first = rows(page).first();
    const nameCell = first.locator('td.entry-name');
    const tableWidth = (await page.locator('[data-entry-table]').boundingBox())!.width;
    // The name column has most of the table, not a fixed 21em with empty space beside the value.
    expect((await nameCell.boundingBox())!.width).toBeGreaterThan(tableWidth * 0.5);
    // Its tooltip is the full path, and a screen reader hears the name whole.
    const filePath = (await first.getAttribute('data-file-path'))!;
    await expect(first.locator('td.entry-name')).toHaveAccessibleName(new RegExp(`^${base(filePath).replace('.', '\\.')}`));
    await expect(first.locator('.entry-nm')).toHaveAttribute('title', new RegExp(`^${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    // Squeezed, the head gives way and the tail stays whole.
    await page.setViewportSize({ width: 800, height: 800 });
    await page.locator('[data-entry-table]').evaluate(table => { (table as HTMLElement).style.width = '360px'; });
    const tail = first.locator('.entry-nm-tail');
    if (await tail.count()) {
        const fits = await tail.evaluate(element => element.scrollWidth <= element.clientWidth + 1);
        expect(fits).toBe(true);
        expect(base(filePath).endsWith((await tail.textContent())!)).toBe(true);
    }
    await page.locator('[data-entry-table]').evaluate(table => { (table as HTMLElement).style.width = ''; });
    // At 800 px the table's last column (the calibration) is in sight, not behind the distribution, which sits under the table. The rows keep
    // their cells when the resize draws them again (#781), so the cell is measured once the page has answered the resize.
    await settled(page);
    const value = (await first.locator('.entry-col-info').last().boundingBox())!;
    const side = (await page.locator('.entry-side').boundingBox())!;
    expect(value.x + value.width).toBeLessThanOrEqual(800);
    expect(side.y).toBeGreaterThanOrEqual(value.y + value.height);
});

test('Open Compare looks unavailable while slots 1–3 are empty and says why; a filled slot enables it', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openEntry(page, scanned!, 'en');
    const open = page.locator('[data-action="entry-open"]');
    const why = STR.compareRefuseSlot.replace('{n}', '1');
    await expect(open).toHaveAttribute('aria-disabled', 'true');
    await expect(open).toHaveCSS('cursor', 'not-allowed');
    await expect(open).toHaveAttribute('data-hint', why);
    // It still answers a press (Playwright waits for an aria-disabled button unless forced; a user does not).
    await open.click({ force: true });
    await expect(page.locator('#hint-footer')).toHaveText(why);
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    await rows(page).first().click();
    await page.keyboard.press('1');
    await expect(open).toHaveAttribute('aria-disabled', 'false');
    await expect(open).not.toHaveCSS('cursor', 'not-allowed');
});
