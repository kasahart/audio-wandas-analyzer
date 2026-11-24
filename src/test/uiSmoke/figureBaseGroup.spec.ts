import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';

/**
 * The spectrum overlay's base group is declared whole: the
 * screen leaves no recording of it out before the figure service. A recording the entry table's answers put on
 * another axis (its scan's sample rate) is asked for at the step like every other, named in the figure spec with its
 * key, state and version, and the figure service (計算ア, python-backend/figures/members.py) judges it by the step's
 * own answer: on another axis there, it is left out of the median and counted with why, and the heading says so from
 * the service's counts; on the same axis there (a step that resamples, say), it is in the median. The stage scans
 * are the stub's; the figure service is the real one (figureStandIn.ts, python-backend/tests/figure_stand_in.py).
 */
let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });
const STR = getStrings('en');
const FIGURE = '[data-stage-figure] canvas[data-figure]';
type Posted = { type: string; requestId: string; filePaths: string[]; stage?: string; command?: string; payload?: { spec?: { keys: Array<{ key: string; state: string }>; lanes: Array<{ lines: Array<{ id: string; of: { median?: string[] } }> }> } } };
const posted = (page: Page): Promise<Posted[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages);
const stageScans = async (page: Page): Promise<Posted[]> => (await posted(page)).filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage'));
const SPECTRUM = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };
/** The same step's picture on another axis (other points): a recording the step does not put on the compared one's axis. */
const OTHER_AXIS = { ...SPECTRUM, xs: [100, 700, 1000, 5000], values: [-40, -35, -30, -50] };

/** Answers every stage scan not answered yet, each file's picture as `viewOf` gives it. */
async function answerAll(page: Page, files: ScannedFile[], viewOf: (filePath: string) => Record<string, unknown>, done: Set<string>): Promise<void> {
    for (const request of await stageScans(page)) {
        if (done.has(request.requestId)) continue;
        done.add(request.requestId);
        const stages = request.filePaths.map(filePath => viewOf(filePath));
        await page.evaluate(({ request, stages, files }) => {
            request.filePaths.forEach((filePath, index) => {
                const file = files.find(item => item.filePath === filePath)!;
                window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: stages[index] } }, '*');
            });
            window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
        }, { request, stages, files });
    }
}

/**
 * The comparison of the table's first row (slot 1) with its base group, on the chain's end (the Welch spectrum),
 * overlaid; `other` is a member of that group whose table answer is of another sample rate (another axis there).
 */
async function open(page: Page, pictureOf: (filePath: string, other: string) => Record<string, unknown>, down = 0): Promise<{ first: string; other: string; asked: () => Promise<string[]> }> {
    const files = [...scanned!].sort((a, b) => a.filePath.localeCompare(b.filePath, 'en', { numeric: true }));
    const rpm = (filePath: string): string => /_(\d+rpm)_/.exec(filePath)?.[1] ?? '';
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    // The table's answer of one member of slot 1's condition: of twice the sample rate (another axis by the table).
    const firstPath = files[0].filePath;
    const otherPath = files.find(file => file.filePath !== firstPath && rpm(file.filePath) === rpm(firstPath))!.filePath;
    const viewOf = (filePath: string): Record<string, unknown> => pictureOf(filePath, otherPath);
    const table = files.map(file => {
        if (file.filePath !== otherPath) return file;
        const result = file.result as { input?: { fs?: number } };
        return { ...file, result: { ...file.result, input: { ...result.input, fs: (result.input?.fs ?? 16000) * 2 } } };
    });
    await openEntry(page, table, { language: 'en', recipe });
    const first = await page.locator('[data-entry-rows] tr.entry-row').first().getAttribute('data-file-path');
    expect(first).toBe(firstPath);
    // `down`: the row as many below (the first file's next channel).
    for (let step = 0; step < down; step++) await page.keyboard.press('ArrowDown');
    if (down) expect(await page.locator('[data-entry-rows] tr.is-focused').getAttribute('data-file-path')).toBe(firstPath);
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    await page.evaluate(filePath => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    }] } })), firstPath);
    await expect(page.locator('.track-stage')).toBeVisible();
    const done = new Set<string>();
    const bar = page.locator('.track-stage-bar');
    await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(0);
    if (await bar.locator('.step-chip.is-current[data-step-input]').count()) {
        await answerAll(page, table, () => SPECTRUM, done);
        await bar.locator('[data-step-hold="node-2"]').click();
        await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-2');
    }
    await answerAll(page, table, viewOf, done);
    await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'overlay');
    const gate = page.locator('[data-action="stage-base-scan"]');
    if (await gate.isVisible()) await gate.click();
    // The base group's scans, answered as they are asked (one after another), until none is pending.
    await expect.poll(async () => { await answerAll(page, table, viewOf, done); return page.locator('.track-stage').getAttribute('data-pending'); }, { timeout: 30_000 }).toBe('');
    // Drawn of every answer: the last spec has no key still on its way, and the Figure is not waiting for its picture.
    await expect.poll(async () => {
        await answerAll(page, table, viewOf, done);
        const spec = (await posted(page)).filter(message => message.type === 'figure-request' && message.command === 'figure-draw').at(-1)?.payload?.spec;
        const waiting = await page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { waiting: boolean } }).__figureInspect().waiting);
        return !!spec && !waiting && spec.keys.every(entry => entry.state !== 'pending');
    }, { timeout: 30_000 }).toBe(true);
    await settled(page);
    const asked = async (): Promise<string[]> => [...new Set((await stageScans(page)).filter(scan => scan.stage === 'node-2').flatMap(scan => scan.filePaths))];
    return { first: firstPath, other: otherPath, asked };
}

const lastSpec = async (page: Page): Promise<NonNullable<NonNullable<Posted['payload']>['spec']>> => (await posted(page)).filter(message => message.type === 'figure-request' && message.command === 'figure-draw').at(-1)!.payload!.spec!;
const baseHeading = (page: Page): Promise<string> => page.locator('[data-stage-legend]').innerText();

test('a base group member the table puts on another axis is asked for, declared and counted by the figure service: on another axis at the step it is left out with why', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    test.setTimeout(120_000);
    const { first, other, asked } = await open(page, (filePath, otherPath) => (filePath === otherPath ? OTHER_AXIS : SPECTRUM));
    const members = (await asked()).filter(filePath => filePath !== first);
    expect(members, 'the step asks for it like every member (nothing is left out beforehand)').toContain(other);
    // The figure spec names every member of the base group, it among them, each with its key.
    const spec = await lastSpec(page);
    const median = spec.lanes.flatMap(lane => lane.lines).find(line => line.id === 'base')!.of.median!;
    // Every member asked for, and those whose file could not be read (declared failed, as their scan answered).
    const unreadable = median.filter(key => key.startsWith('failed|')).length;
    expect(median.length, 'the median line is declared of every member of the group').toBe(members.length + unreadable);
    for (const key of median) expect(spec.keys.map(entry => entry.key), 'each with its key, state and version').toContain(key);
    expect(spec.keys.filter(entry => median.includes(entry.key)).some(entry => entry.state === 'pending'), 'none still on its way').toBe(false);
    // The service counted it out (another axis at the step), and the heading says so from the service's counts.
    await expect.poll(() => baseHeading(page), { timeout: 15_000 }).toContain(STR.dsBaseOtherBins.replace('{n}', '1').trim());
    // The fixture's file that cannot be read is declared failed (never asked for at the step), and said so too.
    expect(unreadable, 'the fixture has a file that cannot be read').toBe(1);
    expect(await baseHeading(page)).toContain(STR.dsBaseFailed.replace('{n}', '1').trim());
});

test('a base group member the table puts on another axis, on the compared one\'s axis at the step, is in the median: the step\'s answer decides, not the table\'s', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    test.setTimeout(120_000);
    const { first, other, asked } = await open(page, () => SPECTRUM);
    const members = (await asked()).filter(filePath => filePath !== first);
    expect(members).toContain(other);
    const spec = await lastSpec(page);
    const median = spec.lanes.flatMap(lane => lane.lines).find(line => line.id === 'base')!.of.median!;
    expect(median.length).toBe(members.length + median.filter(key => key.startsWith('failed|')).length);
    await expect(page.locator(FIGURE)).toHaveCount(1);
    // Every usable member is in the median, it too (the fixture's recordings that fail are left out as failed).
    const usable = spec.keys.filter(entry => median.includes(entry.key) && entry.state === 'usable').length;
    await expect.poll(() => baseHeading(page), { timeout: 15_000 }).toContain(STR.entryBaseMedian.replace('{count}', String(usable)).trim());
    expect(await baseHeading(page)).not.toContain(STR.dsBaseOtherBins.replace('{n}', '1').trim());
});

test('compared as a channel a base member\'s file does not have, the member is declared with the channel and its file\'s channel count, and the figure service counts it without that channel', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    test.setTimeout(120_000);
    // The first file's second channel: the fixture's mono_48k.wav has none.
    await open(page, () => SPECTRUM, 1);
    const spec = await lastSpec(page);
    const median = spec.lanes.flatMap(lane => lane.lines).find(line => line.id === 'base')!.of.median!;
    const hinted = spec.keys.filter(entry => median.includes(entry.key)) as Array<{ key: string; state: string; channel?: number; channels?: number }>;
    expect(hinted.every(entry => entry.channel === 2), 'every member is compared as channel 2').toBe(true);
    const without = hinted.filter(entry => (entry.channels ?? 2) < 2);
    expect(without.length, 'the one-channel file is declared, its channel count said').toBe(1);
    expect(without[0].state, 'no picture of it is asked for: failed, as none can be had').toBe('failed');
    // The heading, from the service's counts, says it.
    await expect.poll(() => baseHeading(page), { timeout: 15_000 }).toContain(STR.dsBaseFewer.replace('{n}', '1').replace('{ch}', '2').trim());
});

/**
 * An export of the spectrum overlay never answered rejects (FigureExportDropped): a
 * newer one took its place ('superseded'), or the Figure went with the overlay ('disposed'). The screen handles both:
 * no rejection is left unhandled on the page, a superseded one says nothing (the newer one's word follows), and one
 * whose Figure went says there is nothing drawn to write.
 */
test('an export of the spectrum overlay superseded or left by its Figure is handled: no unhandled rejection, and the footer says why', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /Uncaught|unhandled|FigureExportDropped/iu.test(message.text())) errors.push(message.text()); });
    await open(page, () => SPECTRUM);
    const saved = (): Promise<string[]> => page.evaluate(() => (window as unknown as { __uiSmokeDownloads: Array<{ download: string }> }).__uiSmokeDownloads.map(item => item.download));
    const exports = (kinds: string[], thenHide = false): Promise<void> => page.evaluate(({ kinds, thenHide }) => {
        kinds.forEach((kind, at) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: `dropped-${kind}-${at}-${Date.now()}`, actions: [{ action: 'export-figure', payload: { kind } }] } })));
        // The comparison left for the waveforms at once: its Figure is disposed before any export is answered. (Laid
        // out as lanes it is the same Figure still, and the export is written.)
        if (thenHide) (document.querySelector('[data-action="content-waveform"]') as HTMLElement).click();
    }, { kinds, thenHide });
    // Three of each at once: the ones a newer took the place of are dropped as superseded; the last ones are written.
    await exports(['csv', 'csv', 'csv', 'png', 'png', 'png']);
    await expect.poll(async () => (await saved()).filter(name => name.startsWith('spectrum-overlay_')).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await settled(page);
    // One of each, then the overlay left: its Figure disposed before the answers came.
    await exports(['csv', 'png'], true);
    await expect(page.locator('#task-status')).toContainText(STR.stageExportNone.split(':')[0], { timeout: 15_000 });
    // Every request answered (the dropped ones' replies too), the page settled: nothing was left unhandled.
    await settled(page);
    expect(errors, 'no rejection left unhandled').toEqual([]);
});

/**
 * A region past the end of the compared recording (#817), the base a group of the table's rows that are not tracks:
 * the only track on screen is the compared recording, whose scan fails for good. The base is still drawn, of the
 * step's kind (its group's pictures), rather than the panel saying the step cannot be shown.
 */
test('a region past the end of the compared recording, the base a group of rows that are not tracks: the base is drawn and the step is not said to be undrawable (#817)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    test.setTimeout(120_000);
    const { first } = await open(page, () => SPECTRUM);
    const tracks = await page.locator('.track-stage').getAttribute('data-channels');
    expect(tracks?.split(',').length, 'the base group is asked for beside the one track').toBeGreaterThan(1);
    const bar = page.locator('.track-stage-bar');
    const before = (await stageScans(page)).length;
    // 区間 from ＋, then the average spectrum over it.
    await bar.locator('[data-action="step-insert"][data-after="node-1"]').click();
    await bar.locator('.step-menu-item[data-op="wandas.frame.time_slice"]').click();
    await bar.locator('[data-step-region-param="start"]').fill('0.5');
    await bar.locator('[data-step-region-param="end"]').fill('1.5');
    await bar.locator('[data-step-region-param="end"]').press('Enter');
    await expect(page.locator('.track-stage')).toHaveAttribute('data-region', '0.50–1.50');
    await bar.locator('[data-step-hold="node-2"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)).toMatchObject({ region: { start: 0.5, end: 1.5 }, stage: 'node-2' });
    // The compared recording (the one track) is shorter than the region: its scan fails for good; the base group's
    // recordings are answered, as they are asked (one after another).
    const done = new Set<string>();
    const answerRegion = async (): Promise<void> => {
        for (const request of (await stageScans(page)).slice(before)) {
            if (done.has(request.requestId)) continue;
            done.add(request.requestId);
            await page.evaluate(({ request, files, first, stage }) => {
                for (const filePath of request.filePaths) {
                    const file = files.find(item => item.filePath === filePath)!;
                    const result = filePath === first ? { ok: false, reason: 'region ends after the file (5.000 s)', lasting: true } : { ...file.result, stage };
                    window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result }, '*');
                }
                window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
            }, { request, files: scanned!, first, stage: SPECTRUM });
        }
    };
    await expect.poll(async () => { await answerRegion(); return page.locator('.track-stage').getAttribute('data-pending'); }, { timeout: 30_000 }).toBe('');
    // The base is drawn (the compared recording has no line), and the panel does not say the step cannot be shown.
    type Seen = { waiting: boolean; lanes: Array<{ lines: Array<{ id: string }> }> };
    await expect.poll(async () => {
        await answerRegion();
        const figure = page.locator(FIGURE);
        if (!(await figure.count())) return null;
        const seen = await figure.evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());
        return seen.waiting ? null : seen.lanes[0]?.lines.map(line => line.id);
    }, { timeout: 30_000 }).toEqual(['base']);
    const message = page.locator('[data-stage-message]');
    await expect(message).not.toContainText(STR.stepNotDrawable.split('(')[0].trim());
    await expect(message).not.toContainText(STR.stepCannotShow.split(':')[0].trim());
});
