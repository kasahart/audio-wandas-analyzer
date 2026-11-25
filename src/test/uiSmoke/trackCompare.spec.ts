import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Metadata, entry100Results, openEntry, pickCsv, type ScannedFile } from './entryHelpers';

let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

type Posted = { type: string; requestId: string; filePaths: string[]; stage?: string; reference?: { filePath: string; step: string; recipe: { nodes: Array<{ operation: string }> } }; region?: { start: number; end: number }; recipe?: { nodes: Array<{ operation: string }> }; folder?: string; files?: Array<{ name: string; text?: string; base64?: string }> };
const posted = (page: Page): Promise<Posted[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages);
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stageScans = async (page: Page): Promise<Posted[]> => (await posted(page)).filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage'));
const spectrum = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };
/** The spectrum overlay and its Δ lane: one Figure on the new path (screens/compareOverlay.ts), in place of the old canvases. */
const FIGURE = '[data-stage-figure] canvas[data-figure]';
/** What the overlay's Figure drew and reads now (its inspection, src/webview/figure/figure.ts). */
const figureSeen = (page: Page): Promise<{ mark: unknown; box: unknown }> => page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { mark: unknown; box: unknown } }).__figureInspect());

/** Answers the last steps-mode scan as a host does: each file's scan result carrying `view` (shifted for the first file). */
async function answer(page: Page, view: Record<string, unknown> = spectrum): Promise<Posted> {
    const request = (await stageScans(page)).at(-1)!;
    // Each recording's values, which the stand-in keeps as the backend keeps a step's (buildHtml.ts): the page is told their description.
    const stages = request.filePaths.map(() => view);
    await page.evaluate(({ request, stages, files }) => {
        request.filePaths.forEach((filePath, index) => {
            const file = files.find(item => item.filePath === filePath)!;
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: stages[index] } }, '*');
        });
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, stages, files: scanned! });
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
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    })) } })), paths);
    await expect(page.locator('.track-stage')).toBeVisible();
    await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(0);
    // The first opening shows the recordings as they are (the input); these tests compare on the chain's end.
    const bar = page.locator('.track-stage-bar');
    if (await bar.locator('.step-chip.is-current[data-step-input]').count()) {
        expect((await stageScans(page)).at(-1)!.stage).toBe('node-input');
        await answer(page);
        await bar.locator('[data-step-hold="node-2"]').click();
        await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-2');
    }
    await answer(page);
    await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'overlay');
}

test('a compared recording written again keeps its line on the spectrum overlay, not read, until its new picture is drawn (第 6 節 描き直しの決まり 1)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const [first] = await openComparison(page);
    // The legend held at its height: a row of a file being analysed again writes less, and the plot under it would
    // grow, which is a redraw of its own (a size change). Held, a redraw here could only come of the stale answer.
    await page.addStyleTag({ content: `[data-stage-legend] { height: ${(await page.locator('[data-stage-legend]').boundingBox())!.height}px; flex: 0 0 auto; }` });
    await settled(page);
    type Seen = { waiting: boolean; generation: number; pictureId: string | null; mark: { line: string } | null; lanes: Array<{ lines: Array<{ id: string; points: Array<[number, number] | null> }> }> };
    const seen = (): Promise<Seen> => page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());
    await expect.poll(async () => { const now = await seen(); return !now.waiting && now.lanes[0]?.lines.some(line => line.id === 'compare1'); }).toBe(true);
    const box = (await page.locator(FIGURE).boundingBox())!;
    /** The pointer on the compared line's middle drawn point. */
    const onCompared = async (): Promise<void> => {
        const points = (await seen()).lanes[0].lines.find(line => line.id === 'compare1')!.points.filter((point): point is [number, number] => !!point);
        const [x, y] = points[Math.floor(points.length / 2)];
        await page.mouse.move(1, 1);
        await page.mouse.move(box.x + x, box.y + y);
        await settled(page);
    };
    await onCompared();
    await expect.poll(async () => (await seen()).mark?.line).toBe('compare1');
    const before = await seen();
    const scans = (await stageScans(page)).length;
    // The compared file was written again on disk: its picture is asked for anew under its new version.
    await page.evaluate(filePath => window.postMessage({ type: 'entry-source-changed', filePath }, '*'), first);
    await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(scans);
    await settled(page);
    // Its answer went stale, and no new one is in: the picture stays as drawn (no redraw), its line is not read.
    const stale = await seen();
    expect(stale.generation, 'no redraw for answers that only went stale').toBe(before.generation);
    expect(stale.pictureId).toBe(before.pictureId);
    expect(stale.lanes[0].lines.map(line => line.id).sort(), "every line still drawn").toEqual(before.lanes[0].lines.map(line => line.id).sort());
    await onCompared();
    expect((await seen()).mark?.line, 'the stale line is not read').not.toBe('compare1');
    // The new picture in: drawn again, and the line read again.
    await answer(page);
    await expect.poll(async () => { const now = await seen(); return !now.waiting && now.generation > before.generation; }).toBe(true);
    await onCompared();
    await expect.poll(async () => (await seen()).mark?.line).toBe('compare1');
});

test('the page holds no value of a step: an answer the backend let go is asked for again, and its line comes back', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const [first] = await openComparison(page);
    type Seen = { waiting: boolean; lanes: Array<{ lines: Array<{ id: string }> }> };
    const seen = (): Promise<Seen> => page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());
    const comparedDrawn = async (): Promise<boolean> => { const now = await seen(); return !now.waiting && !!now.lanes[0]?.lines.some(line => line.id === 'compare1'); };
    await expect.poll(comparedDrawn).toBe(true);
    const scans = await stageScans(page);
    const held = await page.evaluate(() => (window as unknown as { __uiSmokeStageData: Record<string, Record<string, unknown>> }).__uiSmokeStageData);
    expect(Object.keys(held).length).toBeGreaterThan(0);
    // The backend's store made room: the compared recording's kept answer is gone.
    const gone = Object.keys(held).filter(key => key.startsWith(`k:${first}:`)).at(-1)!;
    await page.evaluate(key => { (window as unknown as { __uiSmokeLetGo: Record<string, boolean> }).__uiSmokeLetGo = { [key]: true }; }, gone);
    // The next picture (the Figure drawn again at another size) counts it as let go: the comparison forgets that
    // recording's scan and asks it again, that recording only.
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.width - 60, height: size.height });
    await expect.poll(async () => (await stageScans(page)).length, { timeout: 15_000 }).toBeGreaterThan(scans.length);
    const again = (await stageScans(page)).at(-1)!;
    expect(again.filePaths).toEqual([first]);
    expect(again.stage).toBe(scans.at(-1)!.stage);
    // Answered, its answer is kept again (under a new key here) and its line is back.
    await answer(page);
    await expect.poll(comparedDrawn, { timeout: 15_000 }).toBe(true);
    await settled(page);
    expect((await stageScans(page)).length, 'asked once: nothing is asked in turn').toBe(scans.length + 1);
});

test('the spectrum overlay\'s CSV and PNG are refused while its data changed since the picture, and written of the new picture once drawn', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const [first] = await openComparison(page);
    await page.addStyleTag({ content: `[data-stage-legend] { height: ${(await page.locator('[data-stage-legend]').boundingBox())!.height}px; flex: 0 0 auto; }` });
    const dataId = (): Promise<string | null> => page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { waiting: boolean; dataId: string | null } }).__figureInspect().dataId);
    await expect.poll(dataId).not.toBeNull();
    const saved = (): Promise<string[]> => page.evaluate(() => (window as unknown as { __uiSmokeDownloads: Array<{ download: string }> }).__uiSmokeDownloads.map(item => item.download));
    // Through the tests' own action: no menu offers it while the comparison screen's features are frozen.
    const exportFrom = async (action: string): Promise<void> => {
        await page.evaluate(kind => window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: `export-${kind}-${Date.now()}`, actions: [{ action: 'export-figure', payload: { kind } }] } })), action === 'stage-export-csv' ? 'csv' : 'png');
    };
    // The compared file written again: its answer is stale, the picture on screen is of the data before.
    const scans = (await stageScans(page)).length;
    await page.evaluate(filePath => window.postMessage({ type: 'entry-source-changed', filePath }, '*'), first);
    await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(scans);
    await settled(page);
    const before = await saved();
    for (const action of ['stage-export-csv', 'stage-export-png']) {
        await exportFrom(action);
        await expect(page.locator('#task-status')).toContainText(STR.stageExportChanged.split('.')[0]);
        await settled(page);
    }
    expect(await saved(), 'nothing written of a picture whose data changed').toEqual(before);
    // The new picture in: both written, of its own data id.
    await answer(page);
    await expect.poll(async () => { const id = await dataId(); return id !== null && !(await page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { waiting: boolean } }).__figureInspect().waiting)); }).toBe(true);
    await settled(page);
    await expect.poll(dataId).not.toBeNull();
    const now = await dataId();
    await exportFrom('stage-export-csv');
    await expect.poll(saved).toContain(`spectrum-overlay_${now}.csv`);
    await exportFrom('stage-export-png');
    await expect.poll(saved).toContain(`spectrum-overlay_${now}.png`);
});

test('Enter on the entry table compares the slotted files in the track view: overlaid, no difference named over the plots, roles by colour', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const [first, second] = await openComparison(page);
    const root = page.locator('.track-stage');
    await expect(root).toHaveAttribute('data-compared', '1');
    // The base group (more than 30 recordings) is analysed once asked.
    await page.locator('[data-action="stage-base-scan"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBeGreaterThan(2);
    await answer(page);
    // The row above the plots names no difference: its numbers are the pointer's readout (R7).
    await expect(page.locator('[data-stage-headline]')).toHaveText('');
    await expect(page.locator('[data-stage-legend] .compare-legend-item')).toHaveText([/^Base group/, new RegExp(`^Compare 1 ▾${first.split('/').pop()} ch1`), new RegExp(`^Compare 2 ▾${second.split('/').pop()} ch1`)]);
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
    // The comparison's legend names that file as the base.
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-stage-legend] .compare-legend-item').first()).toContainText(otherName);
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    await slotZero();
    await expect(other.locator('.entry-badge.entry-slot-0')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-stage-legend] .compare-legend-item').first()).toContainText(new RegExp(STR.entryBaseMedian.replace('{count}', '\\d+')));
});

test('the comparison shows a step\'s bands as bars, and hides the lanes\' own controls', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const [first] = await openComparison(page);
    // The lanes' time zoom, menus and cursor spectrum do nothing on the steps view; Enter has nothing left to open.
    for (const action of ['zoom-in', 'zoom-reset', 'toggle-follow-cursor', 'toggle-spectrum-panel', 'entry-open']) {
        await expect(page.locator(`[data-action="${action}"]`).first()).toBeHidden();
    }
    await expect(page.locator('#toolbar details.tb-menu').first()).toBeHidden();
    await page.locator('.track-stage-bar [data-step-hold="node-2"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-2');
    await answer(page, { frame: 'NOctFrame', kind: 'bar', x: 'band', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] });
    await expect(page.locator('.track-stage-bar')).toHaveAttribute('data-stage', 'node-2');
    // In the side panel the table leaves out the value column and never scrolls sideways; its ▾ sorts.
    await expect(page.locator('th[data-column="leq"]')).toBeHidden();
    await page.locator('th[data-column="name"] [data-action="entry-fhead"]').click();
    await page.locator('[data-action="entry-fsort"][data-descending="true"]').click();
    await expect(page.locator('th[data-column="name"]')).toHaveClass(/is-sorted/);
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

test('報告に hands the host one folder at once: the compared files in words, the Recipes, and the figure on show as PNG and CSV of the screen\'s data id; nothing is measured for it', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openComparison(page);
    await page.locator(FIGURE).click();
    // D fixes nothing any more: the key does nothing here.
    await page.keyboard.press('d');
    const scansBefore = (await posted(page)).filter(message => message.type === 'compare-scan').length;
    const shown = await page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { dataId: string | null } }).__figureInspect().dataId);
    // Every export is in the toolbar's 書き出し menu.
    await page.locator('#tb-export-menu > summary').click();
    await page.locator('[data-action="stage-report"]').click();
    // Made and handed to the host (which asks where to put it, and says itself when it is saved).
    await expect(page.locator('#task-status')).toContainText(STR.reportReady.trim());
    const report = (await posted(page)).filter(message => message.type === 'save-report-folder').at(-1)!;
    expect(report.folder).toMatch(/^Standard_\d{8}-\d{6}$/);
    expect(report.files!.map(file => file.name)).toEqual(['report.csv', 'Standard.recipe.json', 'definitions.json', 'figure.png', 'figure.csv']);
    const csv = report.files![0].text!;
    expect(csv).not.toContain('Δ');
    expect(csv).not.toMatch(/\bLeq\b/u);
    // The figure's files are of the picture on screen: its data id, a PNG, and every answer of its lines.
    expect(shown).not.toBeNull();
    const definitions = JSON.parse(report.files![2].text!) as { figure: unknown; recipes: Record<string, string>; shownStep?: string | null; comparisons: Array<{ base: unknown }> };
    expect(definitions.figure).toEqual({ dataId: shown, files: ['figure.png', 'figure.csv'] });
    // Which step of the chain the figure shows, and the Recipe file the folder holds.
    expect(definitions.shownStep).toBe(await page.locator('.track-stage-bar').getAttribute('data-stage'));
    // The slots are of two conditions and the figure has one base (the active comparison's group): every row names that one.
    expect(definitions.comparisons).toHaveLength(2);
    expect(new Set(definitions.comparisons.map(item => JSON.stringify(item.base))).size).toBe(1);
    expect(Object.keys(definitions.recipes)).toEqual(['Standard.recipe.json']);
    expect(report.files![3].base64!.startsWith('iVBORw0KGgo')).toBe(true);
    expect(report.files![4].text!.split('\r\n').length).toBeGreaterThan(2);
    // Nothing was measured for it.
    expect((await posted(page)).filter(message => message.type === 'compare-scan').length).toBe(scansBefore);
    // Back on the table no row of a fixed difference is added.
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).toHaveClass(/is-max/);
    await expect(page.locator('[data-entry-rows] tr.is-derived')).toHaveCount(0);
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
    await expect(first.locator('.entry-badge.entry-slot-1')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await showTracks(page, [filePath]);
    const legend = page.locator('[data-stage-legend] .compare-legend-item');
    // The base: rpm's group of the compared row, its ch-2 recordings, within the filter.
    await expect(legend.first()).toContainText(`${STR.entryBaseGroup} rpm `);
    await expect(legend.first()).toContainText(` · ${STR.dsCh}2`);
    await expect(legend.first()).toContainText(STR.dsBaseNarrowed.replace('{filters}', `${STR.dsCh} = 2`));
    // The compared row: its name with the channel, its value on show (the CSV's column of numbers), ✎ with its memo.
    await expect(legend.nth(1)).toContainText(`Compare 1 ▾${filePath.split('/').pop()} ch2`);
    await expect(legend.nth(1).locator('.compare-value')).toHaveText(/^rpm \d+$/);
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
        channels: [0, 1].map(index => ({ label: `ch${index + 1}`, peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } })),
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
    await expect(page.locator('[data-stage-legend] .compare-legend-item').nth(1)).toContainText(`Compare 1 ▾${filePath.split('/').pop()} ch2`);
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
    await expect(bar.locator('.step-chip')).toHaveText([STR.stepInput, 'HPF 20 Hz', 'a_weighting', 'fft']);
    await expect.poll(lastRecipe).toEqual(['get_channel', 'highpass_filter', 'time_slice', 'a_weighting', 'fft']);
    await answer(page);
    // The base group (98 recordings, ungrouped) is scanned once asked.
    await page.locator('[data-action="stage-base-scan"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBeGreaterThan(30);
    await answer(page);
    // The base group's picture drawn (its heading counts it): the plot is where it stays from now on, gestures and all.
    await expect(page.locator('[data-stage-legend]')).toContainText(STR.entryBaseMedian.replace('{count}', ''));
    // The overlaid plot: hover says what the pointer can do; Shift+wheel or a sideways swipe pans, Ctrl+wheel zooms, a double-click resets.
    const root = page.locator('.track-stage');
    const plot = page.locator(FIGURE);
    const box = (await plot.boundingBox())!;
    // The middle of the plot's frame (inside its axes), as the Figure lays it out once it has drawn.
    const frameOf = (): Promise<{ left: number; top: number; width: number; height: number } | undefined> => plot.evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { waiting: boolean; lanes: Array<{ frame: { left: number; top: number; width: number; height: number } }> } }).__figureInspect().lanes[0]?.frame);
    await expect.poll(async () => !!(await frameOf())).toBe(true);
    const frame = (await frameOf())!;
    const middle = { x: box.x + frame.left + frame.width / 2, y: box.y + frame.top + frame.height / 2 };
    await page.mouse.move(middle.x, middle.y);
    await expect(page.locator('#hint-footer')).toHaveText(STR.compareHintPlot);
    // As on the spectrum overlay under the tracks: the line nearest the pointer drawn thicker, the cursor at its
    // point, and its name, where and its value in its colour.
    await expect.poll(async () => (await figureSeen(page)).mark !== null).toBe(true);
    await expect(page.locator('.track-stage-controls [data-plot-readout]')).toHaveText(/^.+ \/ [\d.]+ k?Hz \/ −?\d+\.\d dBFS$/);
    const readoutColor = await page.locator('.track-stage-controls [data-plot-readout]').evaluate(element => (element as HTMLElement).style.color);
    // In the row just above the plots, as the cursor spectrum's readout is in its header (R7).
    await expect(page.locator('.track-stage-controls [data-plot-readout]:not([hidden])')).toHaveCount(1);
    await expect(page.locator('#plot-readout')).toBeHidden();
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
    expect((await figureSeen(page)).box).not.toBeNull();
    await page.mouse.up();
    expect((await figureSeen(page)).box).toBeNull();
    await page.mouse.dblclick(middle.x, middle.y);
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
    // A double-click on the frequency axis sets its range.
    await page.mouse.dblclick(middle.x, box.y + box.height - 5);
    const popover = page.locator('[id$="range-popover"]:visible');
    await expect(popover).toHaveCount(1);
    await popover.locator('input[id$="-range-min"]').fill('200');
    await popover.locator('input[id$="-range-max"]').fill('2000');
    await popover.locator('button[id$="-range-apply"]').click();
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

test('a zoom on the comparison keeps the base\'s heading and the plot where they are while the zoomed picture is on its way', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openComparison(page);
    await answer(page);
    await page.locator('[data-action="stage-base-scan"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBeGreaterThan(30);
    await answer(page);
    const legend = page.locator('[data-stage-legend]');
    await expect(legend).toContainText(STR.entryBaseMedian.replace('{count}', ''));
    const plot = page.locator(FIGURE);
    await expect.poll(() => plot.evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { waiting: boolean } }).__figureInspect().waiting)).toBe(false);
    // Every change of the heading or of the plot's place from here on, as it happens (not only where the test looks).
    await page.evaluate(() => {
        const head = document.querySelector('[data-stage-legend]') as HTMLElement;
        const canvas = document.querySelector('[data-stage-figure] canvas[data-figure]') as HTMLCanvasElement;
        const seen = (): string => { const rect = canvas.getBoundingClientRect(); return `${head.innerText.replace(/\s+/g, ' ')} | ${Math.round(rect.top)} ${Math.round(rect.height)}`; };
        const log = [seen()];
        const look = (): void => { const now = seen(); if (now !== log[log.length - 1]) log.push(now); };
        new MutationObserver(look).observe(head, { subtree: true, childList: true, characterData: true, attributes: true });
        new ResizeObserver(look).observe(canvas);
        (window as unknown as { __stageSeen: string[] }).__stageSeen = log;
    });
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const root = page.locator('.track-stage');
    // + zooms: the same spec at another range, so the Figure shows the last picture on the new view until the new one comes.
    await page.keyboard.press('+');
    await expect(root).toHaveAttribute('data-x-window', '0.150-0.850');
    await page.keyboard.press('0');
    await expect(root).toHaveAttribute('data-x-window', '0.000-1.000');
    await expect.poll(() => plot.evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { waiting: boolean } }).__figureInspect().waiting)).toBe(false);
    // The heading kept its count throughout, so the plot under it never moved (a double-click on its axis lands on the axis).
    expect(await page.evaluate(() => (window as unknown as { __stageSeen: string[] }).__stageSeen)).toHaveLength(1);
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
    await bar.locator('[data-step-hold="node-2"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-2');
    await answer(page);
    // Nothing is measured of the region beside the steps shown: no scan of it without a step.
    expect((await stageScans(page)).some(message => message.stage === undefined)).toBe(false);
    // Holding the HPF chip: the comparison without the HPF, framed green, until released.
    const hpf = bar.locator('.step-chip', { hasText: 'HPF' }).locator('[data-step-hold]');
    // The bar is drawn again as the region's scans come in: its chip is read once it stands still.
    await expect(hpf).toBeVisible();
    let box = await hpf.boundingBox();
    await expect.poll(async () => (box = await hpf.boundingBox()) !== null).toBe(true);
    box = box!;
    type Held = { waiting: boolean; dataId: string | null; lanes: Array<{ lines: Array<{ id: string; points: Array<[number, number] | null> }> }> };
    const held = (): Promise<Held> => page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Held }).__figureInspect());
    await expect.poll(async () => { const now = await held(); return !now.waiting && now.dataId !== null; }).toBe(true);
    const own = await held();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(root).toHaveAttribute('data-held', 'node-0');
    await expect(root).toHaveClass(/is-step-held/);
    await expect.poll(async () => (await stageScans(page)).at(-1)?.recipe?.nodes.map(node => node.operation.split('.').pop())).toEqual(['get_channel', 'time_slice', 'welch']);
    // The picture without the step is the one Figure's too: of the scans made without it, once they
    // are in (another spectrum than the chain's own), and the chain's own again on release.
    await answer(page, { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', unit: 'dB', xs: [100, 1000, 5000], values: [-60, -50, -40] });
    await expect(root).toHaveAttribute('data-figure', 'true');
    await expect.poll(async () => { const now = await held(); return !now.waiting && now.dataId !== null && now.dataId !== own.dataId; }).toBe(true);
    expect((await held()).lanes[0].lines.map(line => line.id)).toEqual(own.lanes[0].lines.map(line => line.id));
    await page.mouse.up();
    await expect(root).toHaveAttribute('data-held', '');
    await expect.poll(async () => { const now = await held(); return !now.waiting && now.dataId; }).toBe(own.dataId);
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
    const plot = page.locator(FIGURE);
    const box = (await plot.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    // The frequency axis (the plot's bottom 16 px) and the level axis (its left 52 px) are the plot's own, not covered.
    const at = async (x: number, y: number): Promise<string | null> => page.evaluate(([x, y]) => { const under = document.elementFromPoint(x, y); return under?.hasAttribute('data-figure') ? 'overlay' : under?.getAttribute('data-stage-canvas') ?? null; }, [x, y]);
    expect(await at(box.x + box.width / 2, box.y + box.height - 6)).toBe('overlay');
    expect(await at(box.x + 20, box.y + box.height / 2)).toBe('overlay');
    // Back to the waveform: the cursor spectrum as it was.
    await page.locator('[data-action="content-waveform"]').click();
    await expect(section).not.toHaveClass(/is-collapsed/);
});

test('a step added at the chain\'s end is shown, × removes one, and the bar holds the Recipe\'s steps only', async ({ page }) => {
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
    // fft at the chain's end: the comparison shows fft.
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('[data-step-menu-filter]').fill('fft');
    await bar.locator('.step-menu-item', { hasText: 'fft' }).first().click();
    const fft = await bar.locator('.step-chip', { hasText: 'fft' }).getAttribute('data-step-id');
    await expect(bar).toHaveAttribute('data-stage', fft!);
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe(fft);
    // No Frame names on the bar, open or not; no chip of the app's own beside the chain.
    await bar.locator('[data-action="step-expand"]').click();
    await expect(bar).not.toContainText('Frame');
    await expect(bar.locator('.step-branch')).toHaveCount(0);
    await expect(bar.locator('[data-step-hold="node-noct"]')).toHaveCount(0);
});

test('a base group of more than 30 recordings is not analysed by opening a comparison: it has no line until 「解析する」 is pressed', async ({ page }) => {
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
    // Its legend entry says it is not analysed yet.
    const baseEntry = page.locator('[data-stage-legend] .compare-legend-item').first().locator('.compare-legend-label');
    await expect(baseEntry).toContainText(STR.stageBaseNoLine);
    // Pressed: the base group is asked for, and the button goes.
    const before = (await stageScans(page)).length;
    await page.locator('[data-action="stage-base-scan"]').click();
    // Every recording of the group is asked for (none is left out before the figure service),
    // one request per channel the step is asked of, one after another: the base's own channel, then a recording asked
    // of its channels together (the fixture's mono_48k.wav), once the first is answered.
    await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(before);
    await answer(page);
    await expect.poll(async () => new Set((await stageScans(page)).slice(before).flatMap(request => request.filePaths)).size).toBe(n);
    await expect(gate).toBeHidden();
});

test('the readout row above the comparison keeps the values whole at any width, with the base group\'s button in it, and a hover never moves the plots', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1100, height: 800 });
    await openComparison(page);
    await expect(page.locator('[data-stage-base-gate]')).toBeVisible();
    for (const width of [1100, 700, 600]) {
        await page.setViewportSize({ width, height: 800 });
        const row = page.locator('.track-stage-controls');
        const plot = page.locator(FIGURE);
        const before = (await plot.boundingBox())!;
        await page.mouse.move(before.x + 52 + (before.width - 56) / 2, before.y + before.height / 2);
        const readout = page.locator('.track-stage-controls [data-plot-readout]');
        await expect(readout).toHaveText(/ \/ [\d.]+ k?Hz \/ −?\d+\.\d dBFS$/);
        // The values end inside the row and the window (the canvas audit checks this in every test too); the row is above the plot.
        const values = (await readout.locator('.plot-readout-values').boundingBox())!;
        const rowBox = (await row.boundingBox())!;
        expect(values.x + values.width, `values at ${width} px`).toBeLessThanOrEqual(Math.min(rowBox.x + rowBox.width, width) + 1);
        expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(before.y + 1);
        // The hover moved nothing: the plot is where it was.
        expect((await plot.boundingBox())!.y).toBeCloseTo(before.y, 0);
        await page.mouse.move(1, 1);
    }
});

test('coherence compares two channels of each recording: it comes with its pair (ch2 / ch1), which its settings change, and × takes both', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    // The fixture's two-channel recordings alone (with its one-channel recording, coherence is against the base slot: the next test).
    const paths = await openComparison(page, 'en', scanned!.filter(file => (file.result.input as { channels?: number[] } | undefined)?.channels?.length === 2));
    const bar = page.locator('.track-stage-bar');
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-delete"]').click();
    // The recordings are two-channel, as the host's analysis of them says.
    const lane = { peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } };
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
    // The ⚙ drawn again under the pointer still resting where it clicked (as the bar is after a click): the browser says
    // the pointer is over the new one, but it did not move, so the reason stays instead of the ⚙'s hint.
    const gear = await pair.locator('[data-action="step-settings"]').boundingBox();
    await pair.locator('[data-action="step-settings"]').evaluate(button => button.replaceWith(button.cloneNode(true)));
    await page.mouse.move(gear!.x + gear!.width / 2, gear!.y + gear!.height / 2);
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
    const [base, compared] = await openComparison(page, 'en', scanned, true);
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
    // It is drawn by the one Figure: the compared recording's line alone, the base (the reference) no
    // line of its own, no Δ lane, and no base in the legend.
    type Drawn = { waiting: boolean; failure: string | null; lanes: Array<{ id: string; axisNames: { x: string; y: string }; lines: Array<{ id: string; points: unknown[] }> }> };
    const drawn = (): Promise<Drawn> => page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Drawn }).__figureInspect());
    await expect(page.locator('.track-stage')).toHaveAttribute('data-figure', 'true');
    await expect.poll(async () => { const now = await drawn(); return !now.waiting && now.lanes.length; }).toBe(1);
    const figure = await drawn();
    expect(figure.failure).toBeNull();
    expect(figure.lanes[0].lines.map(line => line.id)).toEqual(['compare1']);
    expect(figure.lanes[0].lines[0].points).toHaveLength(3);
    expect(figure.lanes[0].axisNames.y).toMatch(/coherence/iu);
    await expect(page.locator('[data-stage-legend] .compare-legend-item').first()).toHaveClass(/is-active/);
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

test('the report names the base the figure is measured against: the slot-0 recording, and after B the group', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openComparison(page, 'en', scanned, true);
    const root = page.locator('.track-stage');
    const reports = async () => (await posted(page)).filter(message => message.type === 'save-report-folder');
    const baseOf = async (count: number): Promise<string> => {
        await page.locator('#tb-export-menu > summary').click();
        await page.locator('[data-action="stage-report"]').click();
        await expect.poll(async () => (await reports()).length, { timeout: 30000 }).toBe(count);
        const files = (await reports()).at(-1)!.files!;
        return (JSON.parse(files.find(file => file.name === 'definitions.json')!.text!) as { comparisons: Array<{ base: { kind: string } }> }).comparisons[0].base.kind;
    };
    await expect(root).toHaveAttribute('data-base', 'file');
    expect(await baseOf(1)).toBe('file');
    await page.keyboard.press('b');
    await expect(root).toHaveAttribute('data-base', 'group');
    // (A report while the group's figure is on its way writes nothing and says so: the figure is waited for.)
    await expect.poll(async () => page.locator(FIGURE).evaluate(canvas => { const seen = (canvas as HTMLCanvasElement & { __figureInspect: () => { waiting: boolean; dataId: string | null } }).__figureInspect(); return !seen.waiting && !!seen.dataId; }), { timeout: 60000 }).toBe(true);
    expect(await baseOf(2)).toBe('group');
});

test('slots of two conditions, grouped: every row of the report names the one base the figure has (the active comparison\'s group), not each its own', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    await pickCsv(page, 'motor.csv', entry100Metadata());
    await page.locator('[data-action="entry-group"]').selectOption('csv:rpm');
    // The first row in slot 1, the first row of another rpm in slot 2: their own groups are two.
    const drawn = await page.locator('[data-entry-rows] tr.entry-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-file-path')!));
    const rpm = (filePath: string): string => /_(\d+rpm)_/.exec(filePath)?.[1] ?? '';
    const other = drawn.findIndex(filePath => rpm(filePath) !== rpm(drawn[0]));
    expect(other).toBeGreaterThan(0);
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    for (let step = 0; step < other; step++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('2');
    await page.keyboard.press('Enter');
    await showTracks(page, [drawn[0], drawn[other]]);
    await page.locator('#tb-export-menu > summary').click();
    await page.locator('[data-action="stage-report"]').click();
    await expect.poll(async () => (await posted(page)).filter(message => message.type === 'save-report-folder').length, { timeout: 30000 }).toBe(1);
    const files = (await posted(page)).filter(message => message.type === 'save-report-folder').at(-1)!.files!;
    const comparisons = (JSON.parse(files.find(file => file.name === 'definitions.json')!.text!) as { comparisons: Array<{ file: string; base: { kind: string; group?: { name: string } } }> }).comparisons;
    expect(comparisons).toHaveLength(2);
    expect(comparisons.map(item => item.base.kind)).toEqual(['group', 'group']);
    expect(comparisons[1].base, 'the second slot is drawn against the same base as the first: the report says that base').toEqual(comparisons[0].base);
});

test('B switches the base between the slot-0 file and the group median; 0 no longer does', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await openComparison(page, 'en', scanned, true);
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

test('the first opening shows the input: a base group draws each of its waveforms under the compared one; the next opening keeps the step shown last', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    await pickCsv(page, 'motor.csv', entry100Metadata());
    // Grouped by rpm: the compared row's base is the recordings of its own condition.
    await page.locator('[data-action="entry-group"]').selectOption('csv:rpm');
    const first = page.locator('[data-entry-rows] tr.entry-row').first();
    const filePath = (await first.getAttribute('data-file-path'))!;
    await page.locator('[data-entry-table]').focus();
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths).toEqual([filePath]);
    await page.evaluate(filePath => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    }] } })), filePath);
    const bar = page.locator('.track-stage-bar');
    const stage = page.locator('.track-stage');
    await expect(stage).toBeVisible();
    await expect(bar.locator('.step-chip.is-current')).toHaveAttribute('data-step-input', '');
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-input');
    const wave = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'level', xs: [0.5, 1, 1.5], values: [-20, -21, -22],
        waveform: { min: [-0.3, -0.2], max: [0.3, 0.2], minT: [0.2, 1.2], maxT: [0.3, 1.3], absolutePeak: 0.3, unit: 'FS', ref: 1 } };
    // The compared track first; its base group (more than 30 recordings) once asked for, as on every step.
    await answer(page, wave);
    // Not yet analysed (gated), the base is named and counts nothing: the button says how many recordings it would analyse.
    const baseEntry = page.locator('[data-stage-legend] .compare-legend-item').first();
    await expect(baseEntry).toContainText(STR.entryBaseGroup);
    await expect(baseEntry).not.toContainText(STR.entryBaseCount.replace('{count}', await page.locator('.track-stage').getAttribute('data-base-gate') ?? ''));
    await page.locator('[data-action="stage-base-scan"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBeGreaterThan(1);
    const members = (await stageScans(page)).at(-1)!.filePaths.filter(path => path !== filePath).length;
    await answer(page, wave);
    await expect(stage).toHaveAttribute('data-pending', '');
    // Each member's waveform, thin in the base's colour, and the compared one on top: one legend entry counts them.
    await expect(bar).toHaveAttribute('data-drawn', String(members + 1));
    await expect(baseEntry).toContainText(STR.entryBaseCount.replace('{count}', String(members)));
    await expect(baseEntry).not.toContainText(STR.entryBaseMedian.replace('{count}', String(members)));
    await expect(baseEntry.locator('[data-action="stage-base-info"]')).toHaveAttribute('aria-label', STR.stageBaseEach);
    // A waveform answers the pointer as a spectrum's line does: the cursor at its point, its name, time and amplitude in its colour.
    // (The sound itself is overlaid by the Figure: its mark is the Figure's.)
    const figure = page.locator('[data-stage-figure] canvas[data-figure]');
    const overlay = (await figure.boundingBox())!;
    await page.mouse.move(overlay.x + 52 + (overlay.width - 56) * 0.75, overlay.y + overlay.height * 0.3);
    await expect.poll(() => figure.evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { mark: unknown } }).__figureInspect().mark !== null)).toBe(true);
    await expect(page.locator('.track-stage-controls [data-plot-readout]')).toHaveText(/^.+ \/ 1\.\d+ s \/ −?0\.\d+ FS$/);
    expect(await page.locator('.track-stage-controls [data-plot-readout]').evaluate(element => (element as HTMLElement).style.color)).not.toBe('');
    await page.mouse.move(0, 0);
    // No level difference against a median that is on no line: no headline numbers, no Δ.
    await expect(page.locator('[data-stage-headline]')).toHaveText('');
    await expect(page.locator('[data-action="stage-diff"]')).toBeHidden();
    await baseEntry.locator('[data-action="stage-base-info"]').click();
    await expect(page.locator('[data-stage-base-aggregate]')).toHaveText(STR.stageBaseEach);
    // The average spectrum chosen, then back to the tracks and the comparison opened again: the spectrum, not the input.
    await bar.locator('[data-step-hold="node-2"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-2');
    await page.locator('[data-action="content-waveform"]').click();
    await expect(stage).toBeHidden();
    await page.locator('[data-action="content-stage"]').click();
    await expect(stage).toBeVisible();
    await expect(bar.locator('.step-chip.is-current')).toHaveAttribute('data-step-id', 'node-2');
});

test('a trigger added from ＋ fires at half the tracks\' peak, draws each event of each recording over the time from its trigger, and is followed only by what takes events', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openComparison(page, 'en', scanned, true);
    const bar = page.locator('.track-stage-bar');
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-delete"]').click();
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('[data-step-menu-filter]').fill('trigger');
    await bar.locator('.step-menu-item[data-op="wandas.audio.trigger"]').click();
    // The tracks peak at 0.5: the new trigger fires at 0.25, and the comparison shows it.
    const chip = bar.locator('.step-chip', { hasText: STR.stepTrigger });
    await expect(chip).toHaveText(`${STR.stepTrigger} 0.25`);
    const trigger = await chip.getAttribute('data-step-id');
    await expect(bar).toHaveAttribute('data-stage', trigger!);
    await expect.poll(async () => (await stageScans(page)).at(-1)?.recipe?.nodes.map(node => node.operation.split('.').pop())).toEqual(['get_channel', 'highpass_filter', 'time_slice', 'trigger']);
    const event = (id: number, peak: number): Record<string, unknown> => ({ id, time: 0.3 + id * 0.5, xs: [-0.01, 0, 0.05, 0.19], values: [0, peak, -peak / 2, 0] });
    await answer(page, { frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [-0.01, 0, 0.05, 0.19], events: [event(0, 0.5), event(1, 0.4), event(2, 0.45)] });
    // Each recording's events are its lines: no difference between them, the headline counts them.
    await expect(page.locator('[data-stage-headline]')).toHaveText(STR.stageEventCounts.replace('{base}', '3').replace('{compare}', '3'));
    // Under them the tracks, each recording as the trigger takes it (the step before it): the trigger's level, a mark per
    // event and the events used.
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-1');
    await answer(page, { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [0, 0.75, 1.5], values: [-0.5, 0.5, -0.5],
        waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.2, 0.7], maxT: [0.3, 0.8], absolutePeak: 0.5, unit: 'FS', ref: 1 } });
    await expect.poll(async () => Number(await page.locator('.track-stage').getAttribute('data-lanes-marked'))).toBeGreaterThan(0);
    await settled(page);
    const counts = page.locator('.stage-event-count');
    await expect(counts.first()).toHaveText(STR.stageEventsUsed.replace('{used}', '3').replace('{total}', '3'));
    await expect(page.locator('.stage-event-mark').first()).toContainText('▶ 1');
    // The recordings are lanes of a Figure of their own under the events': the events' plot covers no
    // lane, on a short window too (R10), and each keeps a height to be read at.
    const LANES = '[data-stage-lanes-figure] canvas[data-figure]';
    type Lanes = { lanes: Array<{ id: string; frame: { top: number; height: number }; range: { x: [number, number] }; guides: Array<{ id?: string; at: number }>; events?: { used: number; total: number } }> };
    const lanes = (): Promise<Lanes> => page.locator(LANES).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Lanes }).__figureInspect());
    for (const size of [{ width: 1100, height: 700 }, { width: 1600, height: 1000 }, { width: 1280, height: 1100 }]) {
        await page.setViewportSize(size);
        await settled(page);
        const above = (await page.locator('[data-stage-figure]').boundingBox())!, under = (await page.locator('[data-stage-lanes-figure]').boundingBox())!;
        expect(under.y - (above.y + above.height), `at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(0);
        expect(above.height, `at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(150);
        for (const lane of (await lanes()).lanes) expect(lane.frame.height, `${lane.id} at ${size.width}x${size.height}`).toBeGreaterThanOrEqual(40);
    }
    // Each lane is its recording's own time, with the trigger's level, a line where each event fired and the count.
    const seen = await lanes();
    expect(seen.lanes.map(lane => lane.id)).toEqual(['track1', 'track2']);
    for (const lane of seen.lanes) {
        expect(lane.range.x).toEqual([0, 1.5]);
        expect(lane.guides.map(guide => guide.id)).toEqual(['threshold', 'event:0', 'event:1', 'event:2']);
        expect(lane.guides[0].at).toBe(0.25);
        expect(lane.events).toEqual({ used: 3, total: 3 });
    }
    // The events are lines of the one Figure, its lane over the time from the trigger.
    const plot = page.locator(FIGURE);
    const canvasBox = (await plot.boundingBox())!;
    const frame = await plot.evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { lanes: Array<{ frame: { left: number; top: number; width: number; height: number } }> } }).__figureInspect().lanes[0].frame);
    const box = { x: canvasBox.x + frame.left, y: canvasBox.y + frame.top, width: frame.width, height: frame.height };
    // The pointer on a line names its recording and event.
    const x = box.x + box.width * (0.01 / 0.2);
    let lineY = box.y + 2;
    for (; lineY < box.y + box.height / 2; lineY += 2) {
        await page.mouse.move(x, lineY);
        // On the line itself (not only nearest it), which a click would leave out.
        if (await page.locator('#hint-footer').textContent() === STR.stageEventClickOut) break;
    }
    // …and where in the recording it was cut; a click on it leaves it out.
    await expect(page.locator('.track-stage-controls [data-plot-readout]')).toHaveText(/#[123] @ \d\.\d\d s \/ 0\.00 s/);
    await page.screenshot({ path: 'test-results/trigger-events.png' });
    const footer = page.locator('#hint-footer');
    await expect(footer).toHaveText(STR.stageEventClickOut);
    await expect(plot).toHaveCSS('cursor', 'pointer');
    // A double-click resets the zoom and leaves no event out.
    await page.mouse.dblclick(x, lineY);
    await settled(page);
    await page.mouse.move(x, lineY + 1);
    await page.mouse.move(x, lineY);
    await expect(footer).toHaveText(STR.stageEventClickOut);
    await page.mouse.click(x, lineY);
    await expect(footer).toHaveText(new RegExp(`#[123]${escapeRegExp(STR.stageEventOut.split('#{n}')[1])}$`));
    // Drawn faint and still there: the pointer on it says a click puts it back; ↶ does too.
    await page.mouse.move(x, lineY + 1);
    await page.mouse.move(x, lineY);
    await expect(footer).toHaveText(STR.stageEventClickIn);
    await page.keyboard.press('Control+z');
    await expect(footer).toHaveText(STR.stepUndone);
    await page.mouse.move(x, lineY + 1);
    await page.mouse.move(x, lineY);
    await expect(footer).toHaveText(STR.stageEventClickOut);
    await page.mouse.click(x, lineY);
    await expect(footer).toHaveText(new RegExp(`#[123]${escapeRegExp(STR.stageEventOut.split('#{n}')[1])}$`));
    // The track's mark of the event left out: ↺ puts it back, × leaves it out again; its lane counts the events used.
    await expect(counts.filter({ hasText: STR.stageEventsUsed.replace('{used}', '2').replace('{total}', '3') })).toHaveCount(1);
    const out = page.locator('.stage-event-mark.is-out [data-action="stage-event-toggle"]');
    await expect(out).toHaveText('↺');
    await out.click();
    await expect(page.locator('#task-status')).toHaveText(new RegExp(`#[123]${escapeRegExp(STR.stageEventIn.split('#{n}')[1])}$`));
    await expect(page.locator('.stage-event-mark.is-out')).toHaveCount(0);
    await page.locator('[data-action="stage-event-toggle"]').first().click();
    await expect(page.locator('.stage-event-mark.is-out')).toHaveCount(1);
    await page.locator('[data-action="stage-event-play"]').first().click();
    await page.screenshot({ path: 'test-results/trigger-lanes.png' });
    // Back to the tracks, the plain tracks have no marks; the comparison again shows them.
    await page.locator('[data-action="content-waveform"]').click();
    await expect(page.locator('.stage-event-mark')).toHaveCount(0);
    await page.locator('[data-action="content-stage"]').click();
    await expect(page.locator('.stage-event-mark.is-out')).toHaveCount(1);
    // After the trigger, ＋ offers the events' mean, transfer function and coherence; a Frame's step goes before it.
    await bar.locator('[data-action="step-add"]').click();
    await expect(bar.locator('.step-menu-item[data-op="wandas.segments.average"]')).not.toHaveClass(/is-off|is-earlier/);
    await expect(bar.locator('.step-menu-item[data-op="wandas.audio.welch"]')).toHaveClass(/is-earlier/);
    await bar.locator('.step-menu-item[data-op="wandas.segments.average"]').click();
    // The mean of the events: the recording with one left out takes it without that one (wandas.segments.drop), the others as they are.
    // (Asked for one after another: the next once the first is answered.)
    const lastChain = async (): Promise<string> => (await stageScans(page)).at(-1)?.recipe?.nodes.map(node => node.operation.split('.').pop()).join(' ') ?? '';
    const mean = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [-0.01, 0, 0.05, 0.19], values: [0, 0.4, -0.2, 0] };
    const chains = new Set<string>();
    for (let round = 0; round < 2; round++) {
        await expect.poll(async () => /average$/.test(await lastChain()) && !chains.has(await lastChain())).toBe(true);
        const asked = (await stageScans(page)).at(-1)!;
        chains.add(await lastChain());
        if (/drop/.test(await lastChain())) expect(asked.filePaths).toHaveLength(1);
        await answer(page, mean);
    }
    expect([...chains].sort()).toEqual(['get_channel highpass_filter time_slice trigger average', 'get_channel highpass_filter time_slice trigger drop average']);
    // Another trigger level finds other events: the one left out is back, and the footer says so.
    await bar.locator(`[data-action="step-settings"][data-step="${trigger}"]`).click();
    await bar.locator('input[data-step-param="threshold"]').fill('0.3');
    await bar.locator('[data-action="step-apply"]').click();
    await expect(page.locator('#task-status')).toHaveText(STR.stageEventsBack);
    await expect.poll(async () => (await stageScans(page)).at(-1)?.recipe?.nodes.map(node => node.operation.split('.').pop())).toEqual(['get_channel', 'highpass_filter', 'time_slice', 'trigger', 'average']);
});

test('a recording whose step is too large to keep is on no line of the Figure, and the page says why: the headline and the base\'s heading count it', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const [base, compared] = await openComparison(page, 'en', scanned, true);
    expect(compared).not.toBe(base);
    const bar = page.locator('.track-stage-bar');
    // The high-pass filter's step: the sound itself (half an hour of it is over what the backend keeps, and its scan says so).
    await bar.locator('[data-step-hold="node-0"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-0');
    const request = (await stageScans(page)).at(-1)!;
    const wave = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [0.5, 1, 1.5], values: [0.1, -0.1, 0.2],
        waveform: { min: [-0.3, -0.2], max: [0.3, 0.2], minT: [0.2, 1.2], maxT: [0.3, 1.3], absolutePeak: 0.3, unit: 'FS', ref: 1 } };
    await page.evaluate(({ request, wave, files, base }) => {
        for (const filePath of request.filePaths) {
            const file = files.find(item => item.filePath === filePath)!;
            // The base's values were not kept: its picture comes with the scan's word for it.
            const result = filePath === base ? { ...file.result, stage: wave, stageDataTooLarge: true } : { ...file.result, stage: wave };
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result }, '*');
        }
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, wave, files: scanned!, base });
    const stage = page.locator('.track-stage');
    await expect(stage).toHaveAttribute('data-figure', 'true');
    await expect(stage).toHaveAttribute('data-too-large', '1');
    await expect(page.locator('[data-stage-headline]')).toHaveText(STR.stageFigureTooLarge.replace('{n}', '1'));
    // The compared recording alone is drawn; the base is left out by the figure service, with its reason.
    type Seen = { waiting: boolean; lanes: Array<{ lines: Array<{ id: string }> }> };
    await expect.poll(async () => {
        const seen = await page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());
        return seen.waiting ? null : seen.lanes[0]?.lines.map(line => line.id);
    }, { timeout: 30_000 }).toEqual(['compare1']);
    await expect(page.locator('[data-stage-legend] .compare-legend-item').first()).toContainText(STR.dsBaseTooLarge.replace('{n}', '1').replace(/^ · /u, ''));
});

test('a region past the end of the compared recording leaves its line out, says it could not be computed, and the base is drawn (#817)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const [base, compared] = await openComparison(page, 'en', scanned, true);
    expect(compared).not.toBe(base);
    const root = page.locator('.track-stage');
    const bar = page.locator('.track-stage-bar');
    // 区間 from ＋, then the average spectrum over it.
    await bar.locator('[data-action="step-insert"][data-after="node-1"]').click();
    await bar.locator('.step-menu-item[data-op="wandas.frame.time_slice"]').click();
    await bar.locator('[data-step-region-param="start"]').fill('0.5');
    await bar.locator('[data-step-region-param="end"]').fill('1.5');
    await bar.locator('[data-step-region-param="end"]').press('Enter');
    await expect(root).toHaveAttribute('data-region', '0.50–1.50');
    await bar.locator('[data-step-hold="node-2"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)).toMatchObject({ region: { start: 0.5, end: 1.5 }, stage: 'node-2' });
    // The compared recording is shorter than the region: its scan fails for good; the base's is answered.
    const request = (await stageScans(page)).at(-1)!;
    await page.evaluate(({ request, spectrum, files, compared }) => {
        for (const filePath of request.filePaths) {
            const file = files.find(item => item.filePath === filePath)!;
            const result = filePath === compared ? { ok: false, reason: 'region ends after the file (5.000 s)', lasting: true } : { ...file.result, stage: spectrum };
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result }, '*');
        }
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, spectrum, files: scanned!, compared });
    // The base is drawn alone (the compared recording's level is its declared one, not waited for).
    type Seen = { waiting: boolean; lanes: Array<{ lines: Array<{ id: string }> }> };
    await expect.poll(async () => {
        const seen = await page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());
        return seen.waiting ? null : seen.lanes[0]?.lines.map(line => line.id);
    }, { timeout: 30_000 }).toEqual(['base']);
    const legend = page.locator('[data-stage-legend] .compare-legend-item');
    // The base's heading waits for nothing; the compared recording's name says why it has no line.
    await expect(legend.first()).not.toContainText(STR.dsBaseNoIdentity.split('{n}')[1].trim());
    await expect(legend.filter({ hasText: path.basename(compared) })).toContainText(STR.stageLeftFailed.trim());
    // A standing failure is an answer: the headline keeps the region.
    await expect(page.locator('[data-stage-headline]')).toContainText(`${STR.stepRegion} 0.50–1.50 s`);
});

test('a region past the end of every recording says that none could be computed, not that the step cannot be shown (#817)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await openComparison(page, 'en', scanned, true);
    const root = page.locator('.track-stage');
    const bar = page.locator('.track-stage-bar');
    await bar.locator('[data-action="step-insert"][data-after="node-1"]').click();
    await bar.locator('.step-menu-item[data-op="wandas.frame.time_slice"]').click();
    await bar.locator('[data-step-region-param="start"]').fill('0.5');
    await bar.locator('[data-step-region-param="end"]').fill('1.5');
    await bar.locator('[data-step-region-param="end"]').press('Enter');
    await expect(root).toHaveAttribute('data-region', '0.50–1.50');
    await bar.locator('[data-step-hold="node-2"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)).toMatchObject({ region: { start: 0.5, end: 1.5 }, stage: 'node-2' });
    const request = (await stageScans(page)).at(-1)!;
    await page.evaluate(request => {
        for (const filePath of request.filePaths) {
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ok: false, reason: 'region ends after the file (5.000 s)', lasting: true } }, '*');
        }
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, request);
    const message = page.locator('.track-stage [data-stage-message]');
    await expect(message).toHaveText(STR.stageNothingComputed);
    await expect(message).not.toContainText(STR.stepNotDrawable.split('{frame}')[0].trim());
});

test('while the recordings chosen are still being read, the comparison and the tracks say so, not that the step cannot be shown (#853)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { language: 'en', recipe });
    // Two recordings in slots 1 and 2 (rows are a recording's channels: the next recording's first row).
    const drawn = await page.locator('[data-entry-rows] tr.entry-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-file-path')!));
    const other = drawn.findIndex(filePath => filePath !== drawn[0]);
    await page.keyboard.press('1');
    for (let step = 0; step < other; step++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('2');
    await page.keyboard.press('Enter');
    // The host is asked for the two tracks and has not answered yet (the browser build's Python still starting).
    await expect.poll(async () => (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths.length).toBe(2);
    const root = page.locator('.track-stage');
    const message = root.locator('[data-stage-message]');
    const reading = STR.tracksReading.replace('{done}', '0').replace('{n}', '2');
    await expect(message).toHaveText(reading);
    await expect(message).not.toContainText(STR.stepNotDrawable.split('{frame}')[0].trim());
    await expect(root).toHaveAttribute('data-reading', '0/2');
    // Nothing is to be chosen: the headline does not ask for recordings, and the tracks' empty text does not say to click ☐.
    await expect(root.locator('[data-stage-headline]')).not.toHaveText(STR.stageChooseRoles);
    await expect(page.locator('#empty-state p')).toHaveText(reading);
    // Once the tracks are in, the comparison asks for its pictures and no longer says it is reading.
    const paths = (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)!.filePaths;
    await page.evaluate(paths => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    })) } })), paths);
    await expect(root).toHaveAttribute('data-reading', '');
    await expect(message).not.toHaveText(reading);
});

test('a host that answers without the tracks (an analysis cancelled) leaves nothing said to be reading (#853)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { language: 'en', recipe });
    const drawn = await page.locator('[data-entry-rows] tr.entry-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-file-path')!));
    const other = drawn.findIndex(filePath => filePath !== drawn[0]);
    await page.keyboard.press('1');
    for (let step = 0; step < other; step++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('2');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths.length).toBe(2);
    const root = page.locator('.track-stage');
    await expect(root).toHaveAttribute('data-reading', '0/2');
    // VS Code's Cancel on the analysis: the host answers with no result and no longer reports the files selected.
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [], selectedFilePaths: [] } })));
    await expect(root).toHaveAttribute('data-reading', '');
    await expect(root.locator('[data-stage-message]')).not.toContainText(STR.tracksReading.split(' {done}')[0]);
    await expect(page.locator('#empty-state p')).not.toContainText(STR.tracksReading.split(' {done}')[0]);
});
