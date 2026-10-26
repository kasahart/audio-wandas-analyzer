import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeEntryHtml } from './buildHtml';
import { pickCsv } from './entryHelpers';

/**
 * 100,000 recordings with no audio: paths, headers answered at once, and an attribute CSV. Measures what the
 * user waits for on a large dataset (first rows, the header probe, a filter, a sort, a new value drawn, the
 * table's scrolling) and holds them to the targets; the numbers are printed for the report.
 */
const N = 100_000;
const LINES = ['L1', 'L2', 'L3'];
const RPMS = ['900', '1200', '1500'];
const nameOf = (index: number): string => `${LINES[index % 3]}_${RPMS[(index >> 1) % 3]}rpm_${String(index).padStart(6, '0')}.wav`;
const pathOf = (index: number): string => `/entry100/${LINES[index % 3]}/${nameOf(index)}`;

/** Time in the page from `act` to the frame after next, when what it changed is on screen. */
async function timed(page: Page, act: string): Promise<number> {
    return page.evaluate(async (script) => {
        const started = performance.now();
        // eslint-disable-next-line no-new-func
        new Function(script)();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - started;
    }, act);
}

const snapshot = (page: Page) => page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'entry-snapshot', actions: [] } }));
    return (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { entry: { rows: number; visible: number; dist: { groups: unknown[] } | null } } }> })
        .__uiSmokePostedMessages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi.entry;
});

test('100,000 recordings: first rows, the header probe, a filter, a sort, a new value and scrolling stay within their targets', async ({ page }) => {
    test.setTimeout(240_000);
    page.on('pageerror', error => console.log(`pageerror ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') console.log(`console ${message.text()}`); });
    const paths = Array.from({ length: N }, (_, index) => pathOf(index));
    const numbers: Record<string, number> = {};
    let started = Date.now();
    await page.setContent(buildUiSmokeEntryHtml(paths, 'ja'), { waitUntil: 'domcontentloaded' });
    // The stored results are asked for and none are there: the rows are the files.
    const scan = await page.waitForFunction(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; requestId: string }> }).__uiSmokePostedMessages.find(message => message.type === 'entry-scan'));
    const { requestId } = await scan.jsonValue() as { requestId: string };
    await page.evaluate(requestId => { window.postMessage({ type: 'entry-conditions', requestId, table: null }, '*'); window.postMessage({ type: 'entry-scan-done', requestId }, '*'); }, requestId);
    await expect(page.locator('[data-entry-rows] tr.entry-row').first()).toBeVisible();
    numbers.firstRowsMs = Date.now() - started;
    console.log(`scale100k so far ${JSON.stringify(numbers)}`);
    // The headers stream in with progress, in batches as a host sends them; the table stays usable meanwhile.
    const probe = await page.waitForFunction(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string }> }).__uiSmokePostedMessages.find(message => message.type === 'entry-probe'));
    const { requestId: probeId, filePaths } = await probe.jsonValue() as unknown as { requestId: string; filePaths: string[] };
    expect(filePaths.length).toBe(N);
    started = Date.now();
    await page.evaluate(async ({ probeId, filePaths }) => {
        for (let at = 0; at < filePaths.length; at += 2000) {
            for (const filePath of filePaths.slice(at, at + 2000)) window.postMessage({ type: 'entry-probe-result', requestId: probeId, filePath, channels: filePath.includes('/L2/') ? 2 : 1 }, '*');
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }, { probeId, filePaths });
    await expect(page.locator('[data-entry-probing]')).toBeVisible();
    await page.evaluate(probeId => window.postMessage({ type: 'entry-probe-done', requestId: probeId }, '*'), probeId);
    await expect(page.locator('[data-entry-probing]')).toHaveCount(0, { timeout: 120_000 });
    numbers.probeMs = Date.now() - started;
    console.log(`scale100k so far ${JSON.stringify(numbers)}`);
    const rows = Math.round(N / 3) * 2 + (N - Math.round(N / 3));
    await expect.poll(async () => (await snapshot(page)).rows).toBe(rows);
    // The attribute CSV: line, rpm, a score.
    started = Date.now();
    const csv = ['audio_file,line,rpm,score', ...Array.from({ length: N }, (_, index) => `${LINES[index % 3]}/${nameOf(index)},${LINES[index % 3]},${RPMS[(index >> 1) % 3]},${((index * 7919) % 1000 / 1000).toFixed(3)}`)].join('\n');
    await pickCsv(page, 'big.csv', csv);
    await expect(page.locator('[data-entry-source]')).toContainText('big.csv');
    numbers.csvMs = Date.now() - started;
    await page.locator('[data-action="entry-value"]').selectOption('csv:score');
    await page.locator('[data-action="entry-group"]').selectOption('csv:line');
    await expect.poll(async () => (await snapshot(page)).dist?.groups.length).toBe(3);
    // A filter (line: L1 unchecked, through the column's check list), a sort, a new value drawn.
    await page.locator('th[data-column="csv:line"] [data-action="entry-fhead"]').click();
    await page.locator('[data-entry-fvalue="L1"]').uncheck();
    numbers.filterMs = await timed(page, `document.querySelector('[data-action="entry-fok"]').click()`);
    await page.locator('th[data-column="csv:score"] [data-action="entry-fhead"]').click();
    numbers.sortMs = await timed(page, `document.querySelector('[data-action="entry-fsort"][data-descending="true"]').click()`);
    // Another grouping, then another value: each redraws the table and the distribution.
    numbers.groupMs = await timed(page, `const select = document.querySelector('[data-action="entry-group"]'); select.value = 'csv:rpm'; select.dispatchEvent(new Event('change', { bubbles: true }));`);
    numbers.valueMs = await timed(page, `const select = document.querySelector('[data-action="entry-value"]'); select.value = 'csv:rpm'; select.dispatchEvent(new Event('change', { bubbles: true }));`);
    expect((await snapshot(page)).dist?.groups.length).toBe(3);
    // The rug is thinned to what can be seen: far fewer ticks than members.
    const ticks = await page.locator('.entry-dist-rug').first().evaluate(path => (path.getAttribute('d') ?? '').split('M').length - 1);
    expect(ticks).toBeLessThan(2000);
    // Scrolling: the frames while the table scrolls a long way, one wheel step per frame.
    numbers.scrollWorstFrameMs = await page.evaluate(async () => {
        const wrap = document.querySelector('.entry-table-wrap') as HTMLElement;
        let worst = 0, last = performance.now();
        for (let step = 0; step < 60; step++) {
            wrap.scrollTop += 2400;
            wrap.dispatchEvent(new Event('scroll'));
            await new Promise(resolve => requestAnimationFrame(resolve));
            const now = performance.now();
            worst = Math.max(worst, now - last);
            last = now;
        }
        return worst;
    });
    numbers.heapMb = await page.evaluate(() => Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 2 ** 20));
    console.log(`scale100k ${JSON.stringify(numbers)}`);
    expect(numbers.firstRowsMs).toBeLessThan(2000);
    expect(numbers.filterMs).toBeLessThan(300);
    expect(numbers.sortMs).toBeLessThan(300);
    expect(numbers.groupMs).toBeLessThan(300);
    expect(numbers.valueMs).toBeLessThan(300);
    expect(numbers.scrollWorstFrameMs).toBeLessThan(100);
});
