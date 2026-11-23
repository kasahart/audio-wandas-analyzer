import path from 'node:path';
import { expect, test, type Page } from './canvasAudit';
import { getStrings } from '../../shared/i18n/strings';
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
/** A table column's distribution: the Figure in the distribution's box, as it inspects itself. */
const DIST_FIGURE = '[data-entry-dist-figure] canvas[data-figure]';
type FigureLanes = Array<{ id: string; tag?: string; axisNames: { x: string; y: string }; bins?: { n: number; marks: Array<{ role?: string; key: string }> } }>;
const figureLanes = async (page: Page): Promise<FigureLanes> => ((await page.locator(DIST_FIGURE).count())
    ? page.locator(DIST_FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { lanes: FigureLanes } }).__figureInspect().lanes) : []);
const figureMarks = async (page: Page): Promise<string[]> => (await figureLanes(page)).flatMap(lane => (lane.bins?.marks ?? []).map(mark => mark.role ?? ''));
const base = (filePath: string): string => path.basename(filePath);


test('a CSV value counts recordings once; slot 1 keeps its line when another value is drawn; many long group names show what differs and scroll (I10, I13, I15)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('ja');
    await openEntry(page, scanned!, { language: 'ja' });
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await page.locator('[data-action="entry-value"]').selectOption('csv:temp_c');
    await page.locator('[data-action="entry-group"]').selectOption('csv:line');
    // 98 recordings with a row, each once though it has two channels: each group's n is the figure service's count,
    // written at its lane (the heading sums nothing).
    await expect.poll(async () => (await dist(page))?.groups.map(group => group.n), { timeout: 15_000 }).toEqual([55, 22, 21]);
    expect((await dist(page)).unit).toBe('recording');
    expect((await figureLanes(page)).map(lane => lane.tag)).toEqual([55, 22, 21].map((n, index) => `L${index + 1} · ${n} ${STR.dsUnitRecording}`));
    // The CSV header gives no unit: the axis says it is not known (R4).
    expect((await figureLanes(page))[0].axisNames.x).toBe(STR.dsDistCsvAxis.replace('{col}', 'temp_c').replace('{unit}', STR.axisUnitUnknown));
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    await expect.poll(() => figureMarks(page), { timeout: 15_000 }).toEqual(['compare1']);
    await page.locator('[data-action="entry-value"]').selectOption('csv:load_pct');
    await expect.poll(async () => (await figureLanes(page))[0]?.axisNames.x, { timeout: 15_000 }).toContain('load_pct');
    await expect.poll(() => figureMarks(page), { timeout: 15_000 }).toEqual(['compare1']);
    // The slot moved to the recording's second channel: still that recording's line (a CSV value is the recording's,
    // drawn once, whichever of its channels holds the slot).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('1');
    await expect.poll(async () => (await snapshot(page)).slots[1], { timeout: 15_000 }).toContain('#ch2');
    await expect.poll(() => figureMarks(page), { timeout: 15_000 }).toEqual(['compare1']);
    // "Tracks only": the distribution counts the rows the table lists (the one recording on a track), no others.
    await page.locator('[data-action="entry-tracks-only"]').click();
    await expect.poll(async () => (await dist(page))?.groups.map(group => group.n), { timeout: 15_000 }).toEqual([1]);
    await page.locator('[data-action="entry-tracks-only"]').click();
    await expect.poll(async () => (await dist(page))?.groups.map(group => group.n), { timeout: 15_000 }).toEqual([55, 22, 21]);
    // A lot column of 40 long names: the part that differs, and the groups scroll under a fixed axis.
    const readable = scanned!.filter(file => (file.result as { ok?: boolean }).ok);
    const lots = ['audio_file,lot,score', ...readable.map((file, index) => `${base(file.filePath)},LOT-2026-${String(index % 40 + 1).padStart(2, '0')}-東工場-第二組立ライン,${(index % 17) / 17}`)].join('\n');
    await pickCsv(page, 'lots.csv', lots);
    await page.locator('[data-action="entry-value"]').selectOption('csv:score');
    await page.locator('[data-action="entry-group"]').selectOption('csv:lot');
    await expect.poll(async () => (await dist(page))?.groups.length, { timeout: 15_000 }).toBe(40);
    expect((await figureLanes(page)).find(lane => lane.id === 'group:LOT-2026-07-東工場-第二組立ライン')?.tag).toContain('…07…');
    await expect(page.locator('[data-entry-dist-count]')).toContainText(STR.dsDistGroups.replace('{n}', '40'));
    // The lanes scroll in the box (their axis is at the foot of them: the readout says a value wherever the box is scrolled to).
    const scroll = await page.locator('[data-entry-dist-figure]').evaluate(element => [element.scrollHeight, element.clientHeight]);
    expect(scroll[0]).toBeGreaterThan(scroll[1]);
});
