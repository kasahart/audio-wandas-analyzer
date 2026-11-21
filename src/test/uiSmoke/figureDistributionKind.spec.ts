import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { backendRequired, entry100Metadata, entry100Results, openEntry, pickCsv, type ScannedFile } from './entryHelpers';
import { readTimingText, startReadTiming } from './readTiming';
import { bridgeComparison, RealBackend } from './realBackend';

/**
 * The entry screen's distribution of a table column (a bins lane of the Figure per group, counted and
 * read by the figure service), through the REAL backend, in the distribution's own box.
 *
 * Checked on the entry100 fixture (a CSV's number column by its line): the old pane draws nothing of it; the groups
 * and their counts are the fixture's, each lane says its group and its n; a bar's readout says its bin and its count,
 * and a click on it puts that bin's range on the table, whose rows are then exactly the bar's count (the one rule of a
 * range: half-open, and closed where it reaches the top of the axis, so the last bin's click keeps the largest value
 * too); a row's tick goes to its row; a slot's recording is a line in its role.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..');
let scanned: ScannedFile[] | undefined;
let backend: RealBackend | undefined;
let backendError = '';
const recipe = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as Record<string, unknown>;

test.beforeAll(() => {
    scanned = entry100Results();
    if (!scanned) return;
    try { backend = new RealBackend(); } catch (error) { backendError = error instanceof Error ? error.message : String(error); }
});
test.afterAll(() => { backend?.close(); });

const ready = (): boolean => {
    if (!(scanned && backend) && backendRequired()) throw new Error(`the Python backend is required here (AWA_REQUIRE_BACKEND, or the repo's .venv) but could not be used: ${backendError}`);
    return !!(scanned && backend);
};

interface Bins {
    bars: Array<{ bin: number; left: number; right: number; top: number; bottom: number; count: number; picked?: number }>;
    dots: Array<{ key: string; px: number; py: number; picked: boolean }>;
    ticks: Array<{ key: string; px: number }>;
    marks: Array<{ id: string; role?: string; key: string; px: number }>;
    blank: number;
    n: number;
    nPicked?: number;
}
interface Seen {
    waiting: boolean; pictureId: string | null; readout: string; failure: string | null;
    lanes: Array<{ id: string; frame: { left: number; top: number; width: number; height: number }; range: { x: [number, number]; y: [number, number] } | null; axisNames: { x: string; y: string }; bins?: Bins; tag?: string }>;
}
type Dist = { groups: Array<{ name: string; n: number; inRange: number }>; low: number; high: number; range: { low: number; high: number; closed?: boolean } | null; figure?: boolean };
type Snapshot = { visible: number; visibleKeys: string[]; focused: string | null; slots: (string | null)[]; dist: Dist | null };

const HOST = '[data-entry-dist-figure]';
const PREVIEW = `${HOST} canvas[data-figure]`;
const seen = (page: Page): Promise<Seen> => page.locator(PREVIEW).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());
const drawn = async (page: Page, more: (now: Seen) => boolean = () => true): Promise<Seen> => {
    await expect.poll(async () => { const now = await seen(page); return !now.waiting && now.lanes.length > 0 && now.lanes.every(lane => !!lane.bins) && more(now); }, { timeout: 30_000, message: 'the distribution drew its groups' }).toBe(true);
    return seen(page);
};
const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'entry-snapshot', actions: [] } }));
    const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { entry: unknown } }> }).__uiSmokePostedMessages;
    return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi.entry as Snapshot;
});

test('a table column\'s distribution is the Figure\'s, in the distribution\'s box: its groups, counts, reads and picks are the figure service\'s', async ({ page }, testInfo) => {
    test.skip(!ready(), `no Python backend with wandas for the entry100 fixture: ${backendError}`);
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openEntry(page, scanned!, { language: 'en', recipe });
    const stop = await bridgeComparison(page, backend!, recipe);
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await page.locator('[data-action="entry-value"]').selectOption('csv:temp_c');
    await page.locator('[data-action="entry-group"]').selectOption('csv:line');
    await expect.poll(async () => (await snapshot(page)).dist?.groups.map(group => group.name), { timeout: 30_000 }).toEqual(['L1', 'L2', 'L3']);
    const first = await drawn(page, now => now.lanes.length === 3);
    await expect(page.locator(HOST)).toBeVisible();
    const old = (await snapshot(page)).dist!;
    expect(old.figure, 'the snapshot is of the Figure').toBe(true);
    // The fixture's groups in order, each with as many rows (bars' counts, or a dot a row): the service's n, written in the lane's corner.
    expect(first.lanes.map(lane => lane.id)).toEqual(['group:L1', 'group:L2', 'group:L3']);
    const rowsOf = (bins: Bins): number => (bins.dots.length ? bins.dots.length : bins.bars.reduce((sum, bar) => sum + bar.count, 0));
    expect(first.lanes.map(lane => rowsOf(lane.bins!))).toEqual([55, 22, 21]);
    expect(first.lanes.map(lane => lane.bins!.n)).toEqual([55, 22, 21]);
    expect(old.groups).toEqual([{ name: 'L1', n: 55, inRange: 55 }, { name: 'L2', n: 22, inRange: 22 }, { name: 'L3', n: 21, inRange: 21 }]);
    expect(first.lanes.map(lane => lane.tag)).toEqual(['L1 · 55 recordings', 'L2 · 22 recordings', 'L3 · 21 recordings']);
    // One value axis for every group, named as a CSV column's (R4).
    for (const lane of first.lanes) {
        expect(lane.range!.x[0]).toBeCloseTo(old.low, 9);
        expect(lane.range!.x[1]).toBeCloseTo(old.high, 9);
        expect(lane.axisNames.x).toBe('temp_c (CSV column) [unit unknown]');
    }
    // The old pane draws nothing of a table column.
    await expect(page.locator('[data-dist-canvas]')).toHaveCount(0);
    await expect(page.locator('[data-entry-dist-groups]')).toBeHidden();

    // A bar's readout: its group, its bin's ends, its count. The highest bar of the first group.
    const box = (await page.locator(PREVIEW).boundingBox())!;
    const lane = first.lanes[0];
    const bar = [...lane.bins!.bars].sort((a, b) => b.count - a.count)[0];
    await page.mouse.move(box.x + (bar.left + bar.right) / 2, box.y + bar.top + 2);
    await expect.poll(async () => (await seen(page)).readout, { timeout: 15_000 }).toMatch(new RegExp(`^L1 / [\\d.]+–[\\d.]+ / ${bar.count} recordings?$`, 'u'));
    // How long a read takes, from the pointer's move to the readout: over the bars of the first group, one after another.
    await startReadTiming(page, PREVIEW);
    const times: number[] = [];
    const others = lane.bins!.bars.filter(item => item.bin !== bar.bin).slice(0, 11);
    for (const next of [...others, bar]) {
        const before = (await seen(page)).readout;
        const started = Date.now();
        await page.mouse.move(box.x + (next.left + next.right) / 2, box.y + next.top + 2);
        await expect.poll(async () => (await seen(page)).readout, { timeout: 15_000, intervals: [5] }).not.toBe(before);
        times.push(Date.now() - started);
    }
    const sorted = [...times].sort((a, b) => a - b);
    testInfo.annotations.push({ type: `read round trip (ms, pointer move to readout, ${sorted.length} moves)`, description: `median ${sorted[Math.floor(sorted.length / 2)]}, max ${sorted.at(-1)}` });
    testInfo.annotations.push({ type: 'read, the page\'s own part', description: await readTimingText(page) });
    await expect.poll(async () => (await seen(page)).readout, { timeout: 15_000 }).toMatch(new RegExp(`^L1 / [\\d.]+–[\\d.]+ / ${bar.count} recordings?$`, 'u'));
    if (process.env.AWA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'distribution.png') });

    // A click on it: the bin's range on the table. The rows left are the bars of that bin over every group, to the row.
    const inBin = first.lanes.reduce((sum, each) => sum + (each.bins!.bars.find(item => item.bin === bar.bin)?.count ?? 0) + each.bins!.dots.filter(dot => dot.px >= bar.left && dot.px < bar.right).length, 0);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => (await snapshot(page)).dist?.range ?? null, { timeout: 15_000 }).not.toBeNull();
    const picked = await snapshot(page);
    expect(picked.dist!.range!.high - picked.dist!.range!.low).toBeCloseTo((old.high - old.low) / 48, 9);
    const after = await drawn(page, now => now.lanes[0].bins!.bars.some(item => item.picked !== undefined));
    const barAfter = after.lanes[0].bins!.bars.find(item => item.bin === bar.bin)!;
    expect(barAfter.picked, 'the picked bin takes exactly the rows its bar counts').toBe(barAfter.count);
    expect(after.lanes.reduce((sum, each) => sum + each.bins!.bars.reduce((part, item) => part + (item.picked ?? 0), 0) + each.bins!.dots.filter(dot => dot.picked).length, 0)).toBe(inBin);
    testInfo_note(inBin, new Set(picked.visibleKeys.map(key => key.split('#')[0])).size);
    if (process.env.AWA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'distribution-picked.png') });

    expect(after.lanes.map(each => each.bins!.nPicked), 'each group says how many of its rows the range takes').toEqual(after.lanes.map(each => each.bins!.bars.reduce((part, item) => part + (item.picked ?? 0), 0) + each.bins!.dots.filter(dot => dot.picked).length));

    // The range off; a range dragged (Alt) up to the top of the axis: it is closed (it takes the values on the top, as
    // the last bin holds them), and the table keeps exactly the rows the figure lights.
    await page.locator('[data-testid="fchip"] [data-action="entry-fchip-clear"]').click();
    await expect.poll(async () => (await snapshot(page)).dist?.range).toBeNull();
    const whole = await drawn(page, now => now.lanes[0].bins!.bars.every(item => item.picked === undefined));
    const area = whole.lanes[0].frame;
    const from = area.left + area.width * 0.7;
    const above = whole.lanes.reduce((sum, each) => sum + [...each.bins!.ticks, ...each.bins!.dots].filter(row => row.px >= from).length, 0);
    await page.keyboard.down('Alt');
    await page.mouse.move(box.x + from, box.y + area.top + area.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + area.left + area.width + 8, box.y + area.top + area.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect.poll(async () => (await snapshot(page)).dist?.range?.closed, { timeout: 15_000 }).toBe(true);
    const topPicked = await snapshot(page);
    expect(topPicked.dist!.range!.high).toBeCloseTo(old.high, 9);
    testInfo_note(above, new Set(topPicked.visibleKeys.map(key => key.split('#')[0])).size);
    const lit = await drawn(page, now => now.lanes.some(each => each.bins!.nPicked !== undefined));
    expect(lit.lanes.reduce((sum, each) => sum + (each.bins!.nPicked ?? 0), 0), 'the figure lights the rows the table keeps').toBe(above);

    // The range off; a row's tick goes to its row.
    await page.locator('[data-testid="fchip"] [data-action="entry-fchip-clear"]').click();
    await expect.poll(async () => (await snapshot(page)).dist?.range).toBeNull();
    const cleared = await drawn(page, now => now.lanes[0].bins!.bars.every(item => item.picked === undefined));
    const ticks = cleared.lanes[0].bins!.ticks;
    const frame = cleared.lanes[0].frame;
    // The tick farthest from every other, so the read is its own.
    const alone = ticks.reduce((best, tick) => {
        const gap = (one: { px: number }): number => Math.min(...ticks.filter(other => other !== one).map(other => Math.abs(other.px - one.px)));
        return gap(tick) > gap(best) ? tick : best;
    }, ticks[0]);
    await page.mouse.move(box.x + alone.px, box.y + frame.top + frame.height - 2);
    await expect.poll(async () => (await seen(page)).readout, { timeout: 15_000 }).toMatch(/^L1 \/ .+ \/ [\d.]+$/u);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => (await snapshot(page)).focused, { timeout: 15_000 }).toBe(alone.key);

    // That row to slot 1: a line in its role on its group.
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    const slotted = await drawn(page, now => now.lanes.some(each => each.bins!.marks.length > 0));
    expect(slotted.lanes.flatMap(each => each.bins!.marks.map(mark => [each.id, mark.id, mark.role, mark.key]))).toEqual([['group:L1', 'L1:compare1', 'compare1', alone.key]]);
    expect(slotted.lanes[0].bins!.marks[0].px).toBeCloseTo(alone.px, 3);
    await settled(page);
    if (process.env.AWA_SHOT_DIR) await page.screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'distribution-slot.png') });

    // Ungrouped (the screen's default): one lane, of a group with no name, with every recording that has a number;
    // the two recordings the CSV has no row for are the group's too, counted as blank by the service.
    await page.locator('[data-action="entry-group"]').selectOption('none');
    const ungrouped = await drawn(page, now => now.lanes.length === 1);
    expect(ungrouped.lanes[0].id).toBe('group:');
    expect(rowsOf(ungrouped.lanes[0].bins!)).toBe(98);
    expect(ungrouped.lanes[0].bins!.blank).toBe(first.lanes.reduce((sum, each) => sum + each.bins!.blank, 0) + 1);
    expect(ungrouped.lanes[0].tag).toBe('All · 98 recordings');

    expect(await stop(), 'the backend answered every request').toEqual([]);
});

/** The table's recordings after the pick are the bin's rows (a CSV value is a recording's: its channels' rows together). */
function testInfo_note(inBin: number, recordings: number): void {
    expect(recordings, 'the table keeps the recordings the picked bar counts').toBe(inBin);
}
