import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getStrings } from '../../shared/i18n/strings';
import { BAND_CENTERS_HZ, bandLabel } from '../../webview/runtime/entryTable';
import { entry100Metadata, entry100Results, openEntry, pickCsv, type ScannedFile } from './entryHelpers';

/**
 * The entry screen's distribution (the mock's tasks I1–I4, I9–I15, I17 on the entry100 fixture): the value
 * over the groups, a range dragged on it, the slots as ticks, the base as a group's median, and the strip it
 * folds into above the table while a comparison is open.
 */
let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

type Dist = { groups: Array<{ name: string; n: number; inRange: number }>; missing: number; unit: string; low: number; high: number; range: { low: number; high: number } | null; base: string | null; strip: boolean };
type Snapshot = { rows: number; visible: number; visibleKeys: string[]; focused: string | null; slots: (string | null)[]; filters: Array<{ column: string; kind: string }>; open: boolean; docked: boolean; dist: Dist | null };
const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'entry-snapshot', actions: [] } }));
    const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { entry: unknown } }> }).__uiSmokePostedMessages;
    return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi.entry as Snapshot;
});
const dist = async (page: Page): Promise<Dist> => (await snapshot(page)).dist!;
const BAND_3150 = BAND_CENTERS_HZ.findIndex(hz => Math.abs(hz - 3150) < 1);
const OUTLIERS = ['run018', 'run043', 'run060'];
const base = (filePath: string): string => path.basename(filePath);

/** Drags across the distribution from one value to another, as a user marks a range. */
async function dragRange(page: Page, low: number, high: number): Promise<void> {
    const { low: min, high: max } = await dist(page);
    const plot = page.locator('[data-entry-dist-plot]');
    const box = (await plot.boundingBox())!;
    const width = Number(await plot.getAttribute('width'));
    // The plot's x axis: 92 px of group names on the left, 12 on the right.
    const x = (value: number): number => box.x + 92 + (value - min) / (max - min) * (width - 104);
    await page.mouse.move(x(low), box.y + 20);
    await page.mouse.down();
    await page.mouse.move(x(high), box.y + 20, { steps: 5 });
    await page.mouse.up();
    await painted(page);
}

/** The distribution is drawn on the next frame after a change: wait for it. */
const painted = (page: Page): Promise<unknown> => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** The band values of the readable recordings, per channel: the outliers' are the top six. */
function bandValues(): number[] {
    return scanned!.flatMap(file => ((file.result as { ok?: boolean; thirdOctDb?: number[][] }).ok ? (file.result as { thirdOctDb: number[][] }).thirdOctDb.map(channel => channel[BAND_3150]) : []));
}

test('the separated high tail of the 3.15 kHz band, by rpm: dragged, the table keeps those six channels; one goes to slot 1 and is compared, and × takes the range off (I1, I3, I4, I17)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await page.locator('[data-action="entry-value"]').selectOption(`band:${BAND_3150}`);
    await page.locator('[data-action="entry-group"]').selectOption('csv:rpm');
    // Groups by number (900 before 1500), the recording without a CSV row last; computed values count channels.
    await expect.poll(async () => (await dist(page))?.groups.map(group => group.name)).toEqual(['900', '1200', '1500', '1800', '']);
    await expect.poll(async () => (await dist(page))?.unit).toBe('ch');
    await expect(page.locator('[data-dist-axis-label]')).toHaveText(STR.dsBand.replace('{band}', bandLabel(BAND_3150)));
    await expect(page.locator('[data-entry-dist-note]')).toHaveText(STR.dsDistDrag);
    // Nothing marks the high ones: the user sees the tail and drags over it.
    const values = bandValues().sort((a, b) => b - a);
    await dragRange(page, (values[5] + values[6]) / 2, (await dist(page)).high);
    const picked = await snapshot(page);
    expect(picked.visible).toBe(6);
    expect(picked.visibleKeys.every(key => OUTLIERS.some(run => base(key).includes(run)))).toBe(true);
    await expect(page.locator('[data-testid="fchip"]')).toHaveCount(1);
    await expect(page.locator('[data-entry-dist-note]')).toHaveText('');
    // The range only marks the distribution: every group is still drawn whole.
    expect(picked.dist!.groups.reduce((sum, group) => sum + group.n, 0)).toBe(197);
    expect(picked.dist!.groups.reduce((sum, group) => sum + group.inRange, 0)).toBe(6);
    // The first of them to slot 1: a tick in slot 1's colour on its group, and the legend says so.
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    await expect(page.locator('[data-dist-slot="1"]')).toHaveCount(1);
    await expect(page.locator('[data-entry-dist-legend]')).toContainText(STR.dsSlotCompare.replace('{n}', '1'));
    await expect(page.locator('[data-dist-base]')).toHaveCount(1);
    // Compared: the distribution folds above the table, its tick and the range's chip kept; ← goes back to it.
    await page.keyboard.press('Enter');
    await expect(page.locator('.track-stage')).toBeVisible();
    await expect(page.locator('#entry-screen')).toHaveClass(/is-dist-strip/);
    await expect.poll(async () => (await dist(page))?.strip).toBe(true);
    await expect(page.locator('[data-dist-slot="1"]')).toHaveCount(1);
    // Its two rows in view are the compared row's group, so the tick is seen.
    const groupsBox = (await page.locator('[data-entry-dist-groups]').boundingBox())!;
    const tick = (await page.locator('[data-dist-slot="1"]').boundingBox())!;
    expect(tick.y).toBeGreaterThanOrEqual(groupsBox.y - 1);
    expect(tick.y + tick.height).toBeLessThanOrEqual(groupsBox.y + groupsBox.height + 1);
    await expect(page.locator('[data-testid="fchip"]')).toHaveCount(1);
    const strip = (await page.locator('[data-entry-dist]').boundingBox())!;
    const table = (await page.locator('.entry-table-wrap').boundingBox())!;
    expect(strip.y + strip.height).toBeLessThanOrEqual(table.y + 1);
    // ⤢ widens the table back to the distribution beside it.
    await page.locator('.entry-size').click();
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    await expect.poll(async () => (await dist(page))?.strip).toBe(false);
    // × on the chip takes the range off; a range dragged again goes with Esc, before the table shrinks.
    await page.locator('[data-testid="fchip"] [data-action="entry-fchip-clear"]').click();
    await expect.poll(async () => (await dist(page))?.range).toBeNull();
    expect((await snapshot(page)).visible).toBe(197);
    await dragRange(page, (values[5] + values[6]) / 2, (await dist(page)).high);
    expect((await dist(page)).range).not.toBeNull();
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await dist(page))?.range).toBeNull();
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
});

test('a value not computed yet says so and offers 計算 in its header; computed, the distribution is drawn by line, then by channel (I2, I11)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja', answered: 0 });
    // No CSV: Leq is the value, the whole folder one group; nothing is computed by itself.
    await expect(page.locator('[data-entry-dist-empty]')).toHaveText(STR.dsDistNotComputed.replace('{value}', STR.dsLeq));
    const compute = page.locator('[data-entry-dist] [data-action="entry-compute"]');
    await expect(compute).toHaveText(new RegExp(`^${STR.dsCompute.replace('{n}', '100').replace(' · 約 {time}', '')}`));
    await compute.click();
    const scan = await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; requestId: string; cachedOnly?: boolean }> }).__uiSmokePostedMessages.filter(message => message.type === 'entry-scan' && !message.cachedOnly).at(-1)!);
    // Progress and 中止 stay in the distribution's header while it computes.
    await expect(page.locator('[data-entry-dist] [data-entry-progress]')).toBeVisible();
    await expect(page.locator('[data-entry-dist] [data-action="entry-compute-cancel"]')).toBeVisible();
    await page.evaluate(({ requestId, files }) => {
        for (const file of files) window.postMessage({ type: 'entry-scan-result', requestId, filePath: file.filePath, result: file.result }, '*');
        window.postMessage({ type: 'entry-scan-done', requestId }, '*');
    }, { requestId: scan.requestId, files: scanned! });
    await expect(page.locator('[data-entry-dist-empty]')).toBeHidden();
    await expect.poll(async () => (await dist(page))?.groups.map(group => [group.name, group.n])).toEqual([['', 197]]);
    await expect(page.locator('[data-dist-group=""] .entry-dist-name')).toContainText(STR.dsDistAll);
    // By channel: two groups, named as channels; the count axis says what a bar counts.
    await page.locator('[data-action="entry-group"]').selectOption('ch');
    await expect.poll(async () => (await dist(page))?.groups.map(group => [group.name, group.n])).toEqual([['1', 99], ['2', 98]]);
    await expect(page.locator('[data-dist-group="2"] .entry-dist-name')).toContainText(`${STR.dsCh} 2`);
    await expect(page.locator('[data-entry-dist-axis]')).toContainText(STR.dsDistCountAxis.replace('{unit}', STR.dsCh));
    // By line (from the CSV): three lines and the recording without a row.
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await page.locator('[data-action="entry-group"]').selectOption('csv:line');
    await expect.poll(async () => (await dist(page))?.groups.map(group => group.name)).toEqual(['L1', 'L2', 'L3', '']);
});

test('a group of two recordings is drawn as dots, and a dot goes to its row; a click without a drag picks one bin (I9)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openEntry(page, scanned!);
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await page.locator('[data-action="entry-group"]').selectOption('csv:rpm');
    // 1800 rpm: two recordings of two channels, too few for a histogram.
    const dots = page.locator('[data-dist-group="1800"] circle[data-dist-dot]');
    await expect(dots).toHaveCount(4);
    await expect(page.locator('[data-dist-group="900"] rect[data-bin]').first()).toBeVisible();
    const key = await dots.nth(2).getAttribute('data-key');
    await dots.nth(2).click();
    expect((await snapshot(page)).focused).toBe(key);
    // A press that stays put on the plot picks the bin under it.
    // The plot is drawn again once the row is focused: its bars are read after that.
    await expect(page.locator('[data-entry-rows] tr.is-focused')).toHaveAttribute('data-key', key!);
    await painted(page);
    const bar = page.locator('[data-dist-group="900"] rect[data-bin]').first();
    await expect(bar).toBeVisible();
    const plot = (await bar.boundingBox())!;
    await page.mouse.click(plot.x + plot.width / 2, plot.y + plot.height / 2);
    await painted(page);
    const range = (await dist(page)).range!;
    const { low, high } = await dist(page);
    expect(range.high - range.low).toBeCloseTo((high - low) / 48, 5);
    expect((await snapshot(page)).visible).toBeGreaterThan(0);
});

test('the base chip picks a group whose median is the base: a dashed line on it and the legend says which; a new grouping resets it (I12)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await page.locator('[data-action="entry-group"]').selectOption('csv:rpm');
    await page.locator('[data-entry-slots] [data-action="entry-slot"][data-slot="0"]').click();
    const menu = page.locator('[data-entry-basemenu]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-action="entry-base-group"]')).toHaveText([`${STR.dsBaseAuto} ✓`, ...['900', '1200', '1500', '1800', ''].map(name => STR.dsBaseGroupMedian.replace('{group}', `rpm ${name || STR.dsFilterBlank}`))]);
    await menu.locator('[data-action="entry-base-group"][data-group="1500"]').click();
    await expect(menu).toHaveCount(0);
    await expect.poll(async () => (await dist(page))?.base).toBe('1500');
    await expect(page.locator('[data-dist-group="1500"] [data-dist-base]')).toHaveCount(1);
    await expect(page.locator('[data-entry-dist-legend]')).toContainText(STR.dsLegendBaseMedian.replace('{group}', '1500'));
    await expect(page.locator('[data-entry-slots] [data-slot="0"]')).toContainText('rpm 1500');
    // Another grouping: the chosen group means nothing there, so the base goes back to slot 1's group.
    await page.locator('[data-action="entry-group"]').selectOption('csv:line');
    await expect.poll(async () => (await dist(page))?.base).toBeNull();
    await expect(page.locator('[data-dist-base]')).toHaveCount(0);
});

test('a CSV value counts recordings once; slot 1 keeps its tick when another value is drawn; many long group names show what differs and scroll (I10, I13, I15)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await page.locator('[data-action="entry-value"]').selectOption('csv:temp_c');
    await page.locator('[data-action="entry-group"]').selectOption('csv:line');
    // 98 recordings with a row, each once though it has two channels.
    await expect.poll(async () => (await dist(page))?.unit).toBe('recording');
    await expect(page.locator('[data-entry-dist-count]')).toHaveText(`98 ${STR.dsUnitRecording}`);
    await expect(page.locator('[data-dist-axis-label]')).toHaveText(STR.dsDistCsvAxis.replace('{col}', 'temp_c'));
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    await expect(page.locator('[data-dist-slot="1"]')).toHaveCount(1);
    await page.locator('[data-action="entry-value"]').selectOption('csv:load_pct');
    await expect(page.locator('[data-dist-slot="1"]')).toHaveCount(1);
    // A lot column of 40 long names: the part that differs, and the groups scroll under a fixed axis.
    const readable = scanned!.filter(file => (file.result as { ok?: boolean }).ok);
    const lots = ['audio_file,lot,score', ...readable.map((file, index) => `${base(file.filePath)},LOT-2026-${String(index % 40 + 1).padStart(2, '0')}-東工場-第二組立ライン,${(index % 17) / 17}`)].join('\n');
    await pickCsv(page, 'lots.csv', lots);
    await page.locator('[data-action="entry-value"]').selectOption('csv:score');
    await page.locator('[data-action="entry-group"]').selectOption('csv:lot');
    await expect.poll(async () => (await dist(page))?.groups.length).toBe(40);
    await expect(page.locator('[data-dist-group="LOT-2026-07-東工場-第二組立ライン"] .entry-dist-name')).toContainText('…07…');
    await expect(page.locator('[data-entry-dist-count]')).toContainText(STR.dsDistGroups.replace('{n}', '40'));
    const scroll = await page.locator('[data-entry-dist-groups]').evaluate(element => [element.scrollHeight, element.clientHeight]);
    expect(scroll[0]).toBeGreaterThan(scroll[1]);
    await expect(page.locator('[data-entry-dist-axis] svg')).toBeVisible();
});
