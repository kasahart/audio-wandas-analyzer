import { expect, test, type Page } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Metadata, entry100Results, openEntry, pickCsv, type ScannedFile } from './entryHelpers';

/**
 * The entry table's session survives a reload: what the user chose is saved to the host a moment after each
 * change, and given back with the stored results when the folder opens again. Memos and exclusions go back to
 * whoever made the CSV as that CSV with two columns more.
 */
let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

type Saved = { type: string; rootPath: string; session: Record<string, unknown>; csv?: { name: string; text: string } | null };
const saves = (page: Page): Promise<Saved[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Saved[] }).__uiSmokePostedMessages.filter(message => message.type === 'entry-save-session'));
const snapshot = (page: Page) => page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'entry-snapshot', actions: [] } }));
    return (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { entry: Record<string, unknown> & { dist: { base: string | null } | null } } }> })
        .__uiSmokePostedMessages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi.entry;
});

test('the CSV, value, group, filters, base, slots, memo and exclusions are saved to the host and come back when the folder opens again', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    // Nothing is saved for a folder just opened: its stored session (none) came back and nothing changed.
    await page.waitForTimeout(800);
    expect(await saves(page)).toEqual([]);
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await page.locator('[data-action="entry-value"]').selectOption('csv:temp_c');
    await page.locator('[data-action="entry-group"]').selectOption('csv:rpm');
    await page.locator('th[data-column="ch"] [data-action="entry-fhead"]').click();
    await page.locator('[data-entry-fvalue="1"]').uncheck();
    await page.locator('[data-action="entry-fok"]').click();
    await page.locator('[data-entry-slots] [data-action="entry-slot"][data-slot="0"]').click();
    await page.locator('[data-action="entry-base-group"][data-group="1500"]').click();
    const rows = page.locator('[data-entry-rows] tr.entry-row');
    const [first, second] = [await rows.nth(0).getAttribute('data-key'), await rows.nth(1).getAttribute('data-key')];
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('m');
    await page.locator('[data-entry-memo-text]').fill('ベアリングかも');
    await page.keyboard.press('Escape');
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    await rows.nth(1).hover();
    await rows.nth(1).locator('[data-action="entry-row-exclude"]').click();
    // Saved once things settle, with the CSV (it changed).
    await expect.poll(async () => (await saves(page)).length, { timeout: 5000 }).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    const all = await saves(page);
    const last = all.at(-1)!;
    expect(last.rootPath).toBe('/entry100');
    expect(all.some(item => item.csv?.name === 'motor.csv')).toBe(true);
    expect(last.session).toMatchObject({ version: 1, value: 'csv:temp_c', group: 'csv:rpm', baseGroup: '1500', memo: [[first, 'ベアリングかも']], excluded: [second] });
    expect((last.session.filters as Array<{ column: string }>).map(filter => filter.column)).toEqual(['ch']);
    expect((last.session.slots as string[])[1]).toBe(first);
    const csv = all.find(item => item.csv)!.csv!;

    // Reopened: the host gives the session back with the stored results; the table is as it was, and nothing is saved by the opening itself.
    await openEntry(page, scanned!, { language: 'ja', session: last.session, csv });
    await expect(page.locator('[data-entry-source]')).toContainText('motor.csv');
    await expect.poll(async () => (await snapshot(page)).value).toBe('csv:temp_c');
    const restored = await snapshot(page);
    expect(restored).toMatchObject({ group: 'csv:rpm', memo: { [first!]: 'ベアリングかも' }, excluded: [second] });
    expect((restored.filters as Array<{ column: string }>).map(filter => filter.column)).toEqual(['ch']);
    expect((restored.slots as string[])[1]).toBe(first);
    expect(restored.dist?.base).toBe('1500');
    await expect(page.locator('[data-entry-slots] [data-action="entry-slot"][data-slot="0"]')).toContainText('rpm 1500');
    // setContent keeps the window: the saves posted so far are the first page's; the reopening adds none.
    const before = (await saves(page)).length;
    await page.waitForTimeout(800);
    expect((await saves(page)).length).toBe(before);

    // 「メモと除外を CSV に書き出す」: the CSV as it was, with memo and excluded after its columns.
    await page.locator('[data-action="entry-export-notes"]').click();
    await expect(page.locator('[data-action="entry-export-notes"]')).toHaveText(STR.dsExportNotes);
    const text = await page.evaluate(async () => {
        const downloads = (window as unknown as { __uiSmokeDownloads: Array<{ download: string; href: string }> }).__uiSmokeDownloads;
        const last = downloads.at(-1)!;
        return { name: last.download, text: await (await fetch(last.href)).text() };
    });
    expect(text.name).toBe('motor-notes.csv');
    const lines = text.text.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('sample_id,audio_file,line,rpm,temp_c,load_pct,memo,excluded');
    expect(lines.length).toBe(entry100Metadata().replace(/^﻿/, '').trimEnd().split('\n').length);
    const name = (key: string): string => key.replace(/#ch\d$/, '').split('/').pop()!;
    expect(lines.find(line => line.includes(`,${name(first!)},`))).toMatch(/,ch2: ベアリングかも,/);
});
