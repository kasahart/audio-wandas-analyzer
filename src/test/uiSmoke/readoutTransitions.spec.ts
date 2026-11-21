import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { buildExtensionHostPathManyTracksHtml, buildExtensionHostPathUiSmokeHtml, buildUiSmokeHtml, buildUiSmokeManyTracksHtml } from './buildHtml';
import { drawnRow, laneOf, pointOnLane, rowFigure, ROW_SPECTROGRAM, ROW_WAVE, seenFigure, type Seen } from './tracksFigures';
import { backendRequired, entry100Metadata, entry100Results, openEntry, pickCsv, type ScannedFile } from './entryHelpers';
import { getStrings } from '../../shared/i18n/strings';

/**
 * R7's transitions of the readout, through the real paths of each chart in a real browser: the owner's own handlers
 * (a scroll of the lanes or the steps' view, the focus moving between surfaces inside one another, a pane that makes its
 * canvases anew on every repaint), the full data on its way and answered later, a read that failed and is asked again,
 * and the cursors linked to the point read (the time shown with the lanes, the pair plots' and the power spectrum's
 * frequency). readoutTransitions.test.ts tables the state machine itself (plotHoverLayer.ts); this table drives each
 * chart × event as a user does and checks what is on screen: the readout's text, the point the plot reads
 * (notePlotRead) and where the linked cursors are (data-cursor-hz, #cursor-display). The comparison's and the entry's
 * rows are of the entry100 fixture as the real backend analysed it.
 */
test.describe.configure({ mode: 'parallel' });

const seconds = (text: string): number | null => { const found = / \/ (−?\d+\.\d+) s \//u.exec(text); return found ? Number(found[1].replace('−', '-')) : null; };
const clock = async (page: Page): Promise<number> => {
    const [minutes, rest] = ((await page.locator('#cursor-display').textContent()) ?? '').split(':');
    return Number(minutes) * 60 + Number(rest);
};

// ── A Tracks row: one Figure a channel (its waveform lane over its spectrogram lane) ──
type RowMark = NonNullable<Seen['mark']>;
/** The pointer on a lane of a row's Figure once it has drawn, and the point it reads there. */
async function hoverRow(page: Page, lane: string, across: number, track = 0, up = 0.5): Promise<{ at: { x: number; y: number }; mark: RowMark }> {
    await drawnRow(page, track, 0, lane === ROW_WAVE);
    const at = await pointOnLane(page, rowFigure(track), lane, across, up);
    await page.mouse.move(at.x, at.y);
    return { at, mark: await rowReads(page, lane, track) };
}
/** Polled until the row reads a point of `lane`. */
async function rowReads(page: Page, lane: string, track = 0): Promise<RowMark> {
    await expect.poll(async () => (await seenFigure(page, rowFigure(track))).mark?.lane ?? null, { timeout: 15_000, message: `the row reads a point of its ${lane} lane` }).toBe(lane);
    return (await seenFigure(page, rowFigure(track))).mark!;
}
const rowMark = async (page: Page, track = 0): Promise<RowMark | null> => (await seenFigure(page, rowFigure(track)).catch(() => null))?.mark ?? null;
/** The part of the whole time the row's lane shows (0–1). */
const rowPart = async (page: Page, lane: string, track = 0): Promise<{ start: number; end: number }> => laneOf(await seenFigure(page, rowFigure(track)), lane).part!.x;
const rowZoomed = async (page: Page, lane: string): Promise<boolean> => { const part = await rowPart(page, lane); return part.end - part.start < 0.999; };

// ── The spectrum overlay on the new path: one Figure (src/webview/figure/), its overlay and Δ lanes ──
const FIGURE = '[data-stage-figure] canvas[data-figure]';
type FigureSeen = { waiting: boolean; mark: { lane: string; line: string; index: number; x: number; value: number; px: number; py: number } | null; lanes: Array<{ id: string; frame: { left: number; top: number; width: number; height: number }; part: { x: { start: number; end: number } } | null }> };
/** What the overlay's Figure drew and reads now (its inspection, src/webview/figure/figure.ts). */
const figureSeen = (page: Page): Promise<FigureSeen> => page.locator(FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => FigureSeen }).__figureInspect());
/** The pointer on lane `lane` of the Figure, `across` and `down` its frame, once it has drawn, and the point it reads there. */
async function hoverFigure(page: Page, lane: string, across: number, down = 0.5): Promise<NonNullable<FigureSeen['mark']>> {
    await expect.poll(async () => { const now = await figureSeen(page); return !now.waiting && now.lanes.some(item => item.id === lane); }, { timeout: 15_000 }).toBe(true);
    const frame = (await figureSeen(page)).lanes.find(item => item.id === lane)!.frame;
    const box = (await page.locator(FIGURE).boundingBox())!;
    await page.mouse.move(box.x + frame.left + frame.width * across, box.y + frame.top + frame.height * down);
    await expect.poll(async () => (await figureSeen(page)).mark !== null, { timeout: 15_000 }).toBe(true);
    return (await figureSeen(page)).mark!;
}
const markAt = async (page: Page): Promise<number | null> => (await figureSeen(page)).mark?.x ?? null;
/** The Figure's readout row (the comparison's, above its plots). */
const FIGURE_READOUT = '.track-stage-controls [data-plot-readout]';
/** The entry's distribution of a table column: the Figure in the distribution's box, its dots and its readout as it inspects them. */
const DIST_FIGURE = '[data-entry-dist-figure] canvas[data-figure]';
type DistSeen = { readout: string; lanes: Array<{ id: string; bins?: { dots: Array<{ key: string; px: number; py: number }> } }> };
const distSeen = async (page: Page): Promise<DistSeen | null> => ((await page.locator(DIST_FIGURE).count())
    ? page.locator(DIST_FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => DistSeen }).__figureInspect()) : null);
const distDots = async (page: Page, group: string): Promise<Array<{ key: string; x: number; y: number }>> =>
    ((await distSeen(page))?.lanes.find(lane => lane.id === `group:${group}`)?.bins?.dots ?? []).map(dot => ({ key: dot.key, x: dot.px, y: dot.py }));
const distText = async (page: Page): Promise<string> => (await distSeen(page))?.readout ?? '';
/**
 * A trigger's events are lines of the one Figure: the pointer onto the point read at `across`, `down`
 * its lane (on the line itself, where a click leaves its event out), and where on the page that is.
 */
async function onEventLine(page: Page, across: number, down = 0.5): Promise<{ x: number; y: number; line: string }> {
    await hoverFigure(page, 'overlay', across, down);
    // (The point read at this place, not one read before the pointer came here.)
    await settled(page);
    const read = (await figureSeen(page)).mark!;
    const box = (await page.locator(FIGURE).boundingBox())!;
    const onLine = (): Promise<boolean> => page.locator(FIGURE).evaluate(canvas => (canvas as HTMLElement).style.cursor === 'pointer');
    await page.mouse.move(box.x + read.px, box.y + read.py);
    await settled(page);
    // Zoomed, the point read under the pointer may be off the part on screen: down the lane to a line drawn there.
    const frame = (await figureSeen(page)).lanes[0].frame;
    for (let y = frame.top + 4; !await onLine() && y < frame.top + frame.height - 2; y += 4) { await page.mouse.move(box.x + frame.left + frame.width * across, box.y + y); await settled(page); }
    expect(await onLine(), 'on an event\'s line: a click acts on it').toBe(true);
    const now = (await figureSeen(page)).mark!;
    return { x: box.x + now.px, y: box.y + now.py, line: now.line };
}
const figureZoomed = async (page: Page): Promise<boolean> => { const part = (await figureSeen(page)).lanes[0]?.part?.x; return !!part && part.end - part.start < 0.999; };
/**
 * The answer at the point the Figure reads, worked out here from the pictures the test answered with (the stand-in
 * figure service's answers: every value, nothing thinned): a recording's own value, the median of the base's, or the
 * compared one less that median. The readout's value must be it exactly (R7: read of the unthinned answer).
 */
async function unthinnedAt(page: Page, mark: NonNullable<FigureSeen['mark']> & { value?: number }): Promise<number | null> {
    return page.evaluate(({ line, x }) => {
        type Of = { key?: string; median?: string[]; delta?: { compare: string; base: string[] } };
        const draw = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; command?: string; payload?: { spec?: { lanes: Array<{ lines: Array<{ id: string; of: Of }> }> } } }> }).__uiSmokePostedMessages
            .filter(message => message.type === 'figure-request' && message.command === 'figure-draw').at(-1)!.payload!.spec!;
        const of = draw.lanes.flatMap(lane => lane.lines).find(item => item.id === line)!.of;
        const stages = (window as unknown as { __uiSmokeStageData: Record<string, { xs: number[]; values: Array<number | null> }> }).__uiSmokeStageData;
        const at = (key: string): number | null => { const view = stages[key]; const index = view.xs.indexOf(x); return index < 0 ? null : view.values[index]; };
        const median = (keys: string[]): number | null => {
            const values = keys.map(at);
            if (values.some(value => value === null)) return null;
            const sorted = (values as number[]).slice().sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };
        if (of.key) return at(of.key);
        if (of.median) return median(of.median);
        const compare = at(of.delta!.compare), base = median(of.delta!.base);
        return compare === null || base === null ? null : compare - base;
    }, { line: mark.line, x: mark.x });
}

// ── The comparison's steps view, of the entry100 fixture as the backend analysed it (as plotContract.spec.ts) ──
let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });
type Posted = { type: string; requestId: string; filePaths: string[]; stage?: string; recipe?: { nodes: Array<{ id: string; operation: string }> } };
const stageScans = async (page: Page): Promise<Posted[]> => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages))
    .filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage'));
const SPECTRUM = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };
async function answer(page: Page, files: ScannedFile[], view: Record<string, unknown> = SPECTRUM): Promise<void> {
    const request = (await stageScans(page)).at(-1)!;
    // Each recording's values, which the stand-in keeps as the backend keeps a step's (buildHtml.ts): the page is told their description.
    const stages = request.filePaths.map(() => view);
    await page.evaluate(({ request, stages, files }) => {
        request.filePaths.forEach((filePath, index) => {
            const file = files.find(item => item.filePath === filePath)!;
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: stages[index] } }, '*');
        });
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, stages, files });
}
/** `more`: further recordings slotted after the compared one (compare 2, 3), so the lanes under the steps' plots scroll. */
async function openComparison(page: Page, files: ScannedFile[], more = 0): Promise<void> {
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, files, { language: 'en', recipe });
    const drawn = await page.locator('[data-entry-rows] tr.entry-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-file-path')!));
    const rpm = (filePath: string): string => /_(\d+rpm)_/.exec(filePath)?.[1] ?? '';
    const other = drawn.findIndex(filePath => rpm(filePath) !== rpm(drawn[0]));
    const paths = [drawn[0], drawn[other], ...drawn.slice(other + 1, other + 1 + more)];
    await page.keyboard.press('0');
    for (let step = 0; step < other; step++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('1');
    for (let slot = 2; slot < 2 + more; slot++) { await page.keyboard.press('ArrowDown'); await page.keyboard.press(String(slot)); }
    await page.keyboard.press('Enter');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    await page.evaluate(paths => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    })) } })), paths);
    await expect(page.locator('.track-stage')).toBeVisible();
    await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(0);
    const bar = page.locator('.track-stage-bar');
    if (await bar.locator('.step-chip.is-current[data-step-input]').count()) {
        await answer(page, files);
        await bar.locator('[data-step-hold="node-2"]').click();
        await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-2');
    }
    await answer(page, files);
}
/** The trigger step's events plot over the lanes under it (as plotContract.spec.ts sets it up). */
async function openTrigger(page: Page, files: ScannedFile[], more = 0): Promise<void> {
    const STR = getStrings('en');
    await openComparison(page, files, more);
    const bar = page.locator('.track-stage-bar');
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-delete"]').click();
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('[data-step-menu-filter]').fill('trigger');
    await bar.locator('.step-menu-item[data-op="wandas.audio.trigger"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.recipe?.nodes.at(-1)?.operation.split('.').pop()).toBe('trigger');
    const xs = Array.from({ length: 41 }, (_, index) => -0.01 + index * 0.005);
    const event = (id: number, peak: number): Record<string, unknown> => ({ id, time: 0.3 + id * 0.5, xs, values: xs.map(x => peak * Math.sin(40 * x)) });
    await answer(page, files, { frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs, events: [event(0, 0.5), event(1, 0.4)] });
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-1');
    await answer(page, files, { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [0, 0.75, 1.5], values: [-0.5, 0.5, -0.5],
        waveform: { min: [-0.5, -0.4, -0.3], max: [0.5, 0.4, 0.3], minT: [0.2, 0.7, 1.1], maxT: [0.3, 0.8, 1.2], absolutePeak: 0.5, unit: 'FS', ref: 1 } });
    await expect.poll(async () => Number(await page.locator('.track-stage').getAttribute('data-lanes-marked'))).toBeGreaterThan(0);
}

/** One row of the table: a chart, an event on it, and what the readout and its linked cursors show after it. */
type Row = { chart: string; event: string; backend?: boolean; run(page: Page): Promise<void> };

/** A row's ← / → then + (a redraw under the still pointer): the point stepped to is read on, and the time shown with the rows is its own. */
const steppedThenZoomed = (lane: string): Row['run'] => async page => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const first = (await hoverRow(page, lane, 0.6)).mark;
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await rowMark(page))?.x).not.toBe(first.x);
    const stepped = await rowReads(page, lane);
    await page.keyboard.press('=');
    await expect.poll(() => rowZoomed(page, lane), { timeout: 15_000 }).toBe(true);
    await drawnRow(page);
    await settled(page);
    const zoomed = await rowReads(page, lane);
    expect(zoomed.x, 'the cell or sample stepped to is still the one read').toBe(stepped.x);
    const readout = (await page.locator('#plot-readout').textContent()) ?? '';
    expect(seconds(readout), `the readout "${readout}" writes its time`).not.toBeNull();
    expect(Math.abs((seconds(readout) ?? NaN) - zoomed.x), 'the readout writes the point read').toBeLessThan(0.006);
    // The time shown with the rows (and the other rows' time line) is the point read, not the time now under its old place.
    await expect.poll(async () => Math.abs(await clock(page) - zoomed.x)).toBeLessThan(0.006);
};

/**
 * A gate on the host's answers to the readout's reads (read-lane-…, or a Figure's reads with the type `figure-read`) of the given types: passed, held until let go
 * (the backend slow), or turned into the host's error (a passing backend failure), as the page's host stand-in posts them.
 */
async function gateReads(page: Page): Promise<void> {
    await page.evaluate(() => {
        type Gate = { mode: 'pass' | 'hold' | 'fail'; types: string[]; held: unknown[][]; release(): void };
        const post = window.postMessage.bind(window) as (...args: unknown[]) => void;
        const gate: Gate = { mode: 'pass', types: [], held: [], release() { gate.mode = 'pass'; for (const args of gate.held.splice(0)) post(...args); } };
        (window as unknown as { __readGate: Gate }).__readGate = gate;
        window.postMessage = ((...args: unknown[]) => {
            const message = args[0] as { type?: string; requestId?: string; command?: string } | null;
            const figureRead = !!message && message.type === 'figure-result' && message.command === 'figure-read';
            const ours = gate.mode !== 'pass' && !!message && (figureRead ? gate.types.includes('figure-read') : String(message.requestId).startsWith('read-lane-') && gate.types.includes(String(message.type)));
            if (ours && gate.mode === 'hold') { gate.held.push(args); return; }
            if (ours && figureRead) { post({ type: 'figure-result', requestId: message.requestId, command: message.command, failed: 'test: failed for a while' }, ...args.slice(1)); return; }
            post(ours ? { ...message, type: String(message.type).replace(/-result$/u, '-error'), error: 'test: failed for a while' } : args[0], ...args.slice(1));
        }) as typeof window.postMessage;
    });
}
const setGate = (page: Page, mode: 'pass' | 'hold' | 'fail', types: string[] = []): Promise<void> => page.evaluate(({ mode, types }) => {
    const gate = (window as unknown as { __readGate: { mode: string; types: string[]; release(): void } }).__readGate;
    if (mode === 'pass') gate.release();
    else { gate.mode = mode; gate.types = types; }
}, { mode, types });
const testAction = (page: Page, action: string, payload: Record<string, unknown>): Promise<void> => page.evaluate(({ action, payload }) => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: `t-${action}-${Date.now()}`, actions: [{ action, payload }] } }));
}, { action, payload });
const snapshotUi = (page: Page): Promise<{ cursorNorm: number; entry?: { focused: string | null; dist: { range: unknown } | null } }> => page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: `snap-${Date.now()}`, actions: [] } }));
    const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { cursorNorm: number } }> }).__uiSmokePostedMessages;
    return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi;
});

const ROWS: Row[] = [
    {
        chart: 'track waveform lane', event: 'keys pressed while the next points are on their way add up',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildExtensionHostPathUiSmokeHtml(500), { waitUntil: 'domcontentloaded' });
            const from = (await hoverRow(page, ROW_WAVE, 0.3)).mark;
            // Three keys at once: the step's next points are asked for and come in after the last key.
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            await settled(page);
            await expect.poll(async () => (await rowMark(page))?.index, { timeout: 15_000, message: 'three keys, three points' }).toBe(from.index + 3);
            expect((await rowMark(page))!.x).toBeGreaterThan(from.x);
        },
    },
    {
        chart: 'track waveform lane', event: 'a scroll under a still pointer reads the lane now under it, and ← / → step it',
        async run(page) {
            await page.setViewportSize({ width: 1000, height: 600 });
            await page.setContent(buildExtensionHostPathManyTracksHtml(8), { waitUntil: 'domcontentloaded' });
            await expect(page.locator('.track-row')).toHaveCount(8);
            const wrapper = page.locator('#tracks-wrapper');
            expect(await wrapper.evaluate(element => element.scrollHeight > element.clientHeight + 100), 'the lanes scroll').toBe(true);
            const pointer = (await hoverRow(page, ROW_WAVE, 0.5)).at;
            // A plain wheel scrolls the rows under the pointer, which stays where it is: by one track, so the next
            // track's waveform is under it.
            const rowStep = (await page.locator('#track-row-figure-1').boundingBox())!.y - (await page.locator('#track-row-figure-0').boundingBox())!.y;
            await page.mouse.wheel(0, rowStep);
            await expect.poll(() => wrapper.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
            await settled(page);
            // The row under the pointer now reads, and it alone.
            const id = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.track-row-figure')?.id ?? '', pointer);
            expect(id).toMatch(/^track-row-figure-[\d-]+$/u);
            expect(id, 'another row than the one read before the scroll').not.toBe('track-row-figure-0');
            const under = `#${id} canvas[data-figure]`;
            await expect.poll(async () => (await seenFigure(page, under)).mark !== null, { timeout: 15_000, message: 'the row now under the pointer reads' }).toBe(true);
            const reading = await page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement & { __figureInspect?: () => { mark: unknown } }>('.track-row-figure canvas[data-figure]')]
                .filter(canvas => !!canvas.__figureInspect?.().mark).map(canvas => canvas.closest('.track-row-figure')!.id));
            expect(reading, 'the row under the pointer reads, and it alone').toEqual([id]);
            const box = (await page.locator(under).boundingBox())!;
            const read = (await seenFigure(page, under)).mark!;
            expect(Math.abs(read.px - (pointer.x - box.x)), 'read at the pointer').toBeLessThan(25);
            await expect(page.locator('#plot-readout:not([hidden])')).toHaveCount(1);
            await page.keyboard.press('ArrowRight');
            await expect.poll(async () => (await seenFigure(page, under)).mark?.x, { message: '→ steps the row under the pointer' }).not.toBe(read.x);
        },
    },
    { chart: 'track waveform lane', event: '→ then + : the point stepped to and the time shown stay its own', run: steppedThenZoomed(ROW_WAVE) },
    { chart: 'track spectrogram lane', event: '→ then + : the cell stepped to and the time shown stay its own', run: steppedThenZoomed(ROW_SPECTROGRAM) },
    {
        chart: 'steps overlay (a trigger\'s events, over its lanes)', event: 'a scroll under a still pointer reads the place now under it; ← / → step from there', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 620 });
            await openTrigger(page, scanned!, 2);
            const overlay = page.locator(FIGURE);
            const wrapper = page.locator('#tracks-wrapper');
            expect(await wrapper.evaluate(element => element.scrollHeight > element.clientHeight + 60), 'the steps\' view scrolls').toBe(true);
            await hoverFigure(page, 'overlay', 0.5, 0.6);
            const frame = (await figureSeen(page)).lanes[0].frame, first = (await overlay.boundingBox())!;
            const pointer = { x: first.x + frame.left + frame.width * 0.5, y: first.y + frame.top + frame.height * 0.6 };
            await page.mouse.wheel(0, 50);
            await expect.poll(() => wrapper.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
            await settled(page);
            const box = (await overlay.boundingBox())!;
            expect(pointer.y >= box.y && pointer.y <= box.y + box.height, 'still over the plot').toBe(true);
            const read = (await figureSeen(page)).mark;
            expect(Math.abs((read?.px ?? NaN) - (pointer.x - box.x)), 'read again at the pointer, never only taken away').toBeLessThan(25);
            await page.keyboard.press('ArrowRight');
            await expect.poll(async () => (await figureSeen(page)).mark?.index).not.toBe(read!.index);
            const stepped = (await figureSeen(page)).mark;
            expect(Math.abs((stepped?.px ?? NaN) - (pointer.x - box.x)), '→ steps from the point read there, never the plot\'s left edge').toBeLessThan(25);
        },
    },
    {
        chart: 'trigger events overlay inside the lanes\' surface', event: 'Tab to a lane and away: the pointer\'s readout stays', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 1100 });
            await openTrigger(page, scanned!);
            const read = await hoverFigure(page, 'overlay', 0.5);
            const slot = page.locator(FIGURE_READOUT);
            const text = (await slot.textContent()) ?? '';
            expect(text).toMatch(/\d/u);
            // (The lanes are a Figure of their own under the events': its canvas takes the focus.)
            const lane = page.locator('[data-stage-lanes-figure] canvas[data-figure]');
            // The keyboard's focus onto the lanes (Tab, as a user gives it), the pointer still on the events plot.
            const onLane = (): Promise<boolean> => lane.evaluate(canvas => document.activeElement === canvas);
            for (let presses = 0; presses < 60 && !await onLane(); presses++) await page.keyboard.press('Tab');
            if (!await onLane()) await lane.focus();
            expect(await onLane()).toBe(true);
            await settled(page);
            expect((await figureSeen(page)).mark?.x, 'the focus gives no readout over the pointer\'s').toBe(read.x);
            await expect(slot).toBeVisible();
            await expect(slot).toHaveText(text);
            await page.keyboard.press('Tab');
            await settled(page);
            expect(await onLane()).toBe(false);
            expect((await figureSeen(page)).mark?.x, 'nor does its leaving take the pointer\'s away').toBe(read.x);
            await expect(slot).toBeVisible();
            await expect(slot).toHaveText(text);
        },
    },
    {
        chart: 'track waveform lane', event: 'a step whose read failed lets its keys go and keeps the point read: the next key steps from it',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
            await gateReads(page);
            const from = (await hoverRow(page, ROW_WAVE, 0.3)).mark;
            await setGate(page, 'fail', ['figure-read']);
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            await settled(page);
            // The failure moved nothing and took nothing away: the point read is still the one marked.
            expect((await rowMark(page))?.index, 'the point read before the failure stays').toBe(from.index);
            await setGate(page, 'pass');
            await settled(page);
            expect((await rowMark(page))?.index, 'the keys of the failed read are not taken later by themselves').toBe(from.index);
            await page.keyboard.press('ArrowRight');
            await expect.poll(async () => (await rowMark(page))?.index, { timeout: 15_000, message: 'the next key steps from the point kept' }).toBe(from.index + 1);
        },
    },
    {
        chart: 'track waveform lane', event: 'a double click resets the zoom only: the loop and the time cursor stay',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
            await drawnRow(page);
            await testAction(page, 'set-loop-region', { start: 0.25, end: 0.75 });
            await expect(page.locator('#loop-time-display')).toBeVisible();
            const loop = await page.locator('#loop-time-display').textContent();
            await hoverRow(page, ROW_WAVE, 0.5);
            await page.keyboard.press('=');
            await expect.poll(() => rowZoomed(page, ROW_WAVE), { timeout: 15_000 }).toBe(true);
            await drawnRow(page);
            const cursor = (): Promise<number> => page.evaluate(() => {
                window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: `cursor-${Date.now()}`, actions: [] } }));
                const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi?: { cursorNorm?: number } }> }).__uiSmokePostedMessages;
                return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)?.renderedUi?.cursorNorm ?? NaN;
            });
            const before = await cursor();
            const at = await pointOnLane(page, rowFigure(0), ROW_WAVE, 0.85);
            await page.mouse.dblclick(at.x, at.y);
            await expect.poll(() => rowZoomed(page, ROW_WAVE), { timeout: 15_000 }).toBe(false);
            await settled(page);
            expect(await cursor(), 'the time cursor stays').toBe(before);
            await expect(page.locator('#loop-time-display'), 'the loop stays').toHaveText(loop ?? '');
            // A click alone moves the cursor and clears the loop, at once (R13).
            await page.mouse.click(at.x, at.y);
            await expect.poll(() => cursor()).not.toBe(before);
            await expect(page.locator('#loop-time-display')).toBeHidden();
        },
    },
    {
        chart: 'track waveform lane', event: 'a click on a lane that reads nothing (its file changed since it was analysed): the time cursor goes to the pointer\'s time (R13)',
        async run(page) {
            // Seeking is an act on a time, not on a point: where the readout reads nothing at all, nothing is claimed, so
            // the click seeks to the pointer's time (R13, "a click acts on the point the readout reads": no reading).
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildUiSmokeManyTracksHtml(2, true), { waitUntil: 'domcontentloaded' });
            const drawn = await drawnRow(page);
            await page.evaluate(filePath => window.postMessage({ type: 'entry-source-changed', filePath }, '*'), '/preview/take00.wav');
            await expect(page.locator('#track-row-0 [data-action="reanalyze-changed"]'), 'the row offers to analyse the changed file again').toBeVisible();
            // What was drawn of the old version stays as it was.
            expect((await drawnRow(page)).pictureId, 'the picture of the old version stays').toBe(drawn.pictureId);
            const cursor = (): Promise<number> => page.evaluate(() => {
                window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: `cursor-${Date.now()}`, actions: [] } }));
                const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi?: { cursorNorm?: number } }> }).__uiSmokePostedMessages;
                return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)?.renderedUi?.cursorNorm ?? NaN;
            });
            const before = await cursor();
            const box = laneOf(drawn, ROW_WAVE).frame;
            for (const across of [0.43, 0.71]) {
                const at = await pointOnLane(page, rowFigure(0), ROW_WAVE, across, 0.7);
                await page.mouse.move(at.x, at.y);
                await settled(page);
                expect(await rowMark(page), 'the row of the file changed gives no readout (R7)').toBeNull();
                await expect(page.locator('#plot-readout'), 'the row of the file changed gives no readout (R7)').toBeHidden();
                await page.mouse.click(at.x, at.y);
                await settled(page);
                // The full time window: the pointer's place across the lane is its time on the lanes' axis, to a pixel.
                const now = await cursor();
                expect(now, 'the click moves the time cursor').not.toBe(before);
                expect(Math.abs(now - across), `the time cursor is at the pointer's time (${across}), not left where it was (${before}): ${now}`).toBeLessThanOrEqual(1 / box.width);
            }
        },
    },
    {
        chart: 'steps overlay (a trigger\'s events, over its lanes)', event: 'a scroll that takes the surface from under a still pointer clears its readout', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 620 });
            await openTrigger(page, scanned!, 2);
            const wrapper = page.locator('#tracks-wrapper');
            await hoverFigure(page, 'overlay', 0.5, 0.85);
            const frame = (await figureSeen(page)).lanes[0].frame, first = (await page.locator(FIGURE).boundingBox())!;
            const pointer = { x: first.x + frame.left + frame.width * 0.5, y: first.y + frame.top + frame.height * 0.85 };
            const slot = page.locator(FIGURE_READOUT);
            await expect(slot).toContainText(/\d/u);
            // Scrolled until the events' plot is off the pointer: the lanes under it (another Figure) or the page.
            const surface = page.locator('.track-stage');
            const off = async (): Promise<boolean> => page.evaluate(({ x, y }) => { const under = document.elementFromPoint(x, y); return !!under && !document.querySelector('[data-stage-figure]')?.contains(under); }, pointer);
            for (let turn = 0; turn < 12 && !await off(); turn++) { await wrapper.evaluate(element => { element.scrollTop += 80; }); await settled(page); }
            expect(await off(), 'the steps\' view scrolled from under the pointer').toBe(true);
            expect(await surface.count()).toBe(1);
            // The Figure keeps the point it read last in its row, as when the pointer leaves it (every Figure's rule, stage
            // 2); it is no longer the pointer's: the keys step nothing of it, and no click is offered on it.
            const kept = (await figureSeen(page)).mark;
            await page.keyboard.press('ArrowRight');
            await settled(page);
            expect((await figureSeen(page)).mark?.index, 'the surface gone from under the pointer takes no key').toBe(kept?.index);
            expect(await page.locator(FIGURE).evaluate(canvas => (canvas as HTMLElement).style.cursor), 'and offers no click').toBe('');
        },
    },
    {
        chart: 'steps overlay (a trigger\'s events, over its lanes)', event: 'an event-line click leaves its event out at once, a drag after it does not take that back, and a double click on the line resets the zoom only (R13)', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 1100 });
            await openTrigger(page, scanned!);
            const on = await onEventLine(page, 0.5);
            const left = page.locator('[data-action="stage-event-toggle"][data-out="true"]');
            const leftOut = await left.count();
            const frame = (await figureSeen(page)).lanes[0].frame, box = (await page.locator(FIGURE).boundingBox())!;
            const at = (across: number, down: number): [number, number] => [box.x + frame.left + frame.width * across, box.y + frame.top + frame.height * down];
            // The click on the line (its data in: decided at once), then at once a drag into a box elsewhere on the plot.
            await page.mouse.click(on.x, on.y);
            await page.mouse.move(...at(0.2, 0.3));
            await page.mouse.down();
            await page.mouse.move(...at(0.45, 0.8), { steps: 5 });
            await page.mouse.up();
            await expect.poll(() => figureZoomed(page)).toBe(true);
            await settled(page);
            expect(await left.count(), 'the click left its event out at once, and the drag after it does not take that back (R13)').toBe(leftOut + 1);
            // A double click on a line, zoomed: the zoom is reset, and its first press's edit is taken back by its second.
            // (Zoomed, the lines cross the part on screen near its right side.)
            const again = await onEventLine(page, 0.9);
            await page.mouse.dblclick(again.x, again.y);
            await expect.poll(() => figureZoomed(page)).toBe(false);
            await settled(page);
            expect(await left.count(), 'a double click on a line leaves out or puts back nothing: it resets the zoom only (R13)').toBe(leftOut + 1);
        },
    },
    {
        chart: 'track waveform lane', event: 'a press moved within the drag threshold and let go: the readout and the time lines are both at the release',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
            // A press and a release a few pixels apart that read two points (the row reads its nearest one).
            let at = (await hoverRow(page, ROW_WAVE, 0.4)).at;
            let pressed = await rowReads(page, ROW_WAVE), released = pressed, releasedClock = NaN;
            for (let across = 0.4; across < 0.6 && released.x === pressed.x; across += 0.004) {
                at = await pointOnLane(page, rowFigure(0), ROW_WAVE, across);
                await page.mouse.move(at.x, at.y);
                await settled(page);
                pressed = await rowReads(page, ROW_WAVE);
                await page.mouse.move(at.x + 3, at.y);
                await settled(page);
                released = await rowReads(page, ROW_WAVE);
                releasedClock = await clock(page);
            }
            expect(released.x, 'two points a few pixels apart').not.toBe(pressed.x);
            await page.mouse.move(at.x, at.y);
            await expect.poll(async () => (await rowMark(page))?.x).toBe(pressed.x);
            await page.mouse.down();
            await page.mouse.move(at.x + 3, at.y);
            await page.mouse.up();
            await settled(page);
            await expect.poll(async () => (await rowMark(page))?.x, { message: 'read at the release' }).toBe(released.x);
            // The clock shows hundredths: the time lines are at the release, as a hover there puts them.
            expect(Math.abs(await clock(page) - releasedClock), 'the time lines are where a hover there puts them').toBeLessThan(0.011);
        },
    },
    {
        // The new path (第 1 節, the second consequence): while a new picture is on its way nothing is read and no mark is
        // shown, so a key pressed then steps nothing; once drawn, the point the keys marked is read again by its name.
        chart: 'steps overlay', event: '→ while its picture is made anew (pending): not taken, the point marked read again by its name once it is drawn', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openComparison(page, scanned!);
            const first = await hoverFigure(page, 'overlay', 0.2);
            expect(first.value, 'the readout is the unthinned answer at the point read').toBe(await unthinnedAt(page, first));
            // Where → goes from there; and back.
            await page.keyboard.press('ArrowRight');
            await expect.poll(() => markAt(page)).not.toBe(first.x);
            await page.keyboard.press('ArrowLeft');
            await expect.poll(() => markAt(page)).toBe(first.x);
            // A step before it bypassed (without moving the pointer): the picture is asked for anew.
            const scans = (await stageScans(page)).length;
            await page.evaluate(() => {
                document.querySelector<HTMLElement>('[data-action="step-bypass"][data-step="node-0"]')?.click();
                (document.activeElement as HTMLElement | null)?.blur();
            });
            await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(scans);
            await expect.poll(async () => (await figureSeen(page)).mark, { message: 'no mark while the new picture is on its way' }).toBeNull();
            await page.keyboard.press('ArrowRight');
            await answer(page, scanned!);
            await expect.poll(async () => (await figureSeen(page)).waiting).toBe(false);
            await settled(page);
            await expect.poll(() => markAt(page), { message: 'the point marked, read again by its name on the new picture; the key pressed meanwhile not taken' }).toBe(first.x);
            const again = (await figureSeen(page)).mark!;
            expect(again.value, 'read again: the new picture\'s unthinned answer there').toBe(await unthinnedAt(page, again));
        },
    },
    {
        chart: 'trigger events overlay inside the lanes\' surface', event: '→ then + : the point stepped to stays its own', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 1100 });
            await openTrigger(page, scanned!);
            // The events' lane of the Figure: → then = (a zoom about its middle) keeps the point stepped to.
            await hoverFigure(page, 'overlay', 0.3);
            const first = await markAt(page);
            await page.keyboard.press('ArrowRight');
            await expect.poll(() => markAt(page)).not.toBe(first);
            const stepped = await markAt(page);
            const before = JSON.stringify((await figureSeen(page)).lanes[0].part);
            await page.keyboard.press('=');
            await expect.poll(async () => JSON.stringify((await figureSeen(page)).lanes[0]?.part)).not.toBe(before);
            await expect.poll(async () => (await figureSeen(page)).waiting).toBe(false);
            await settled(page);
            await expect.poll(() => markAt(page), { message: 'the point stepped to, on the picture drawn anew' }).toBe(stepped);
        },
    },
    {
        chart: 'steps difference pane', event: '→ then + : the point stepped to stays its own', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openComparison(page, scanned!);
            await page.locator('[data-action="stage-diff"]').click();
            // The Δ lane of the overlay's Figure: → then = (a zoom about its middle) keeps the point stepped to.
            const read = await hoverFigure(page, 'delta', 0.45);
            expect(read.value, 'the Δ readout is the unthinned answer at the point read').toBe(await unthinnedAt(page, read));
            const first = await markAt(page);
            await page.keyboard.press('ArrowRight');
            await expect.poll(() => markAt(page)).not.toBe(first);
            const stepped = await markAt(page);
            const before = JSON.stringify((await figureSeen(page)).lanes[0].part);
            await page.keyboard.press('=');
            await expect.poll(async () => JSON.stringify((await figureSeen(page)).lanes[0]?.part)).not.toBe(before);
            await expect.poll(async () => (await figureSeen(page)).waiting).toBe(false);
            await settled(page);
            await expect.poll(() => markAt(page), { message: 'the point stepped to, on the picture drawn anew' }).toBe(stepped);
            const kept = (await figureSeen(page)).mark!;
            expect(kept.value, 'the point stepped to reads its unthinned answer').toBe(await unthinnedAt(page, kept));
        },
    },
    {
        chart: 'steps lanes (no trigger)', event: '→ then + : the point stepped to stays its own', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openComparison(page, scanned!);
            await page.locator('[data-action="stage-layout"]').click();
            await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'lanes');
            // A lane a recording of the one Figure: → then = (a zoom about its middle) keeps the point stepped to.
            await expect.poll(async () => { const now = await figureSeen(page); return !now.waiting && !!now.lanes[0]?.id.startsWith('own-'); }, { timeout: 15_000 }).toBe(true);
            await hoverFigure(page, (await figureSeen(page)).lanes[0].id, 0.45);
            const first = await markAt(page);
            await page.keyboard.press('ArrowRight');
            await expect.poll(() => markAt(page)).not.toBe(first);
            const stepped = await markAt(page);
            const before = JSON.stringify((await figureSeen(page)).lanes[0].part);
            await page.keyboard.press('=');
            await expect.poll(async () => JSON.stringify((await figureSeen(page)).lanes[0]?.part)).not.toBe(before);
            await expect.poll(async () => (await figureSeen(page)).waiting).toBe(false);
            await settled(page);
            await expect.poll(() => markAt(page), { message: 'the point stepped to, on the picture drawn anew' }).toBe(stepped);
        },
    },
    {
        chart: 'steps overlay (a trigger\'s events, over its lanes)', event: 'an event-line click, then a scroll at once: the line clicked on is left out', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 620 });
            await openTrigger(page, scanned!, 2);
            const on = await onEventLine(page, 0.5, 0.4);
            // The line read names its recording and its event (the readout: "<file> … #n @ …"; the line's id ends "#n").
            const file = /^(\S+\.wav)\b/u.exec((await page.locator(FIGURE_READOUT).textContent()) ?? '')?.[1] ?? '';
            const id = Number(on.line.split('#')[1]) - 1;
            expect(file && Number.isInteger(id), 'an event\'s line under the pointer').toBeTruthy();
            await page.mouse.click(on.x, on.y);
            await page.locator('#tracks-wrapper').evaluate(element => { element.scrollTop += 60; });
            const out = page.locator(`[data-action="stage-event-toggle"][data-event="${id}"][data-path*="${file}"][data-out="true"]`);
            await expect.poll(() => out.count(), { message: 'the event clicked on is left out, the scroll notwithstanding' }).toBe(1);
            expect(await page.locator('[data-action="stage-event-toggle"][data-out="true"]').count(), 'and no other').toBe(1);
        },
    },
    {
        // docs/display-rules.md R7, "同じ値の点": recordings of one value are each stepped onto once, in one order.
        chart: 'entry distribution', event: '← / → over recordings of the same value: each is read once, and back through the same ones', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openEntry(page, scanned!, { language: 'en' });
            await pickCsv(page, 'motor.csv', entry100Metadata());
            // The value and the group are both the CSV's rpm: every recording of a group has the very same value.
            await page.locator('[data-action="entry-value"]').selectOption('csv:rpm');
            await page.locator('[data-action="entry-group"]').selectOption('csv:rpm');
            const dotCanvas = page.locator(DIST_FIGURE);
            const dots = (): Promise<Array<{ key: string; x: number; y: number }>> => distDots(page, '1800');
            await expect.poll(async () => (await dots()).length, { message: 'the 1800 rpm group is drawn as dots' }).toBeGreaterThan(1);
            const drawn = await dots();
            expect(new Set(drawn.map(dot => dot.x)).size, 'this row needs recordings of one value (dots at one x): the fixture or the grouping changed, pick another tied group').toBe(1);
            // What the plot reads now: the readout's own text, which names the recording.
            const text = (): Promise<string> => distText(page);
            const at = (await dotCanvas.boundingBox())!;
            await page.mouse.move(at.x + drawn[0].x, at.y + drawn[0].y);
            await expect.poll(text, { message: 'the dot under the pointer is read', timeout: 15_000 }).not.toBe('');
            const fix = 'Recordings of the same value must each be stepped onto once (docs/display-rules.md R7; python-backend/figures/pick.py).';
            const forward = [await text()];
            for (let step = 1; step < drawn.length; step++) {
                await page.keyboard.press('ArrowRight');
                await expect.poll(text, { message: `→ from "${forward.at(-1)}" reads no other recording of the same value. ${fix}` }).not.toBe(forward.at(-1));
                forward.push(await text());
            }
            expect(new Set(forward).size, `→ read a recording twice: ${forward.join(' | ')}. ${fix}`).toBe(drawn.length);
            const backward = [await text()];
            for (let step = 1; step < drawn.length; step++) {
                await page.keyboard.press('ArrowLeft');
                await expect.poll(text, { message: `← from "${backward.at(-1)}" reads no other recording of the same value. ${fix}` }).not.toBe(backward.at(-1));
                backward.push(await text());
            }
            expect(backward, `← must pass the recordings → passed, in reverse. ${fix}`).toEqual([...forward].reverse());
            // Past the first one there is no further recording: the key reads no recording a second time (the Figure's
            // rule, figures/pick.py (b): past the last point there is nothing to read).
            await page.keyboard.press('ArrowLeft');
            await settled(page);
            expect(await text(), `← past the first recording must read no recording a second time. ${fix}`).toBe('');
        },
    },
    {
        // docs/display-rules.md R7, "選んだ点は、それが何であるかで覚える": the recording the keys stepped to is kept by its
        // key across a redraw, never by its index among the dots, which another recording has once one is taken out.
        chart: 'entry distribution', event: '→ onto a recording, then a redraw without another recording of the same value: the very recording stepped to is read on', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openEntry(page, scanned!, { language: 'en' });
            // The fixture's CSV with two columns added: the first five recordings are lot T and every recording
            // scores 7, so lot T is five dots of one value.
            const lines = entry100Metadata().replace(/^﻿/u, '').trimEnd().split(/\r?\n/u);
            const csv = [`${lines[0]},lot,score`, ...lines.slice(1).map((line, index) => `${line},${index < 5 ? 'T' : 'U'},7`)].join('\n');
            await pickCsv(page, 'motor.csv', csv);
            await page.locator('[data-action="entry-value"]').selectOption('csv:score');
            await page.locator('[data-action="entry-group"]').selectOption('csv:lot');
            const dotCanvas = page.locator(DIST_FIGURE);
            const dots = (): Promise<Array<{ key: string; x: number; y: number }>> => distDots(page, 'T');
            await expect.poll(async () => (await dots()).length, { message: 'lot T is drawn as five dots' }).toBe(5);
            const drawn = await dots();
            const text = (): Promise<string> => distText(page);
            const at = (await dotCanvas.boundingBox())!;
            await page.mouse.move(at.x + drawn[0].x, at.y + drawn[0].y);
            await expect.poll(text, { message: 'the dot under the pointer is read', timeout: 15_000 }).not.toBe('');
            const first = await text();
            await page.keyboard.press('ArrowRight');
            await expect.poll(text, { message: '→ steps onto the next recording of the same value' }).not.toBe(first);
            const stepped = await text();
            // The first recording is taken out of the table (the pointer still): the dots are drawn anew, one fewer.
            // (Every channel's row of it: a recording is in the distribution while any of its rows is in the table.)
            const recording = drawn[0].key.split('#')[0];
            for (let rows = 0; rows < 8; rows++) {
                const taken = await page.evaluate(file => {
                    const button = Array.from(document.querySelectorAll<HTMLElement>('[data-action="entry-row-exclude"]')).find(candidate => candidate.getAttribute('data-key')?.split('#')[0] === file);
                    button?.click();
                    return !!button;
                }, recording);
                if (!taken) break;
                await settled(page);
            }
            await expect.poll(async () => (await dots()).length, { message: 'the first recording\'s rows are on screen and Exclude on each takes its dot away (if not, this row must take a recording out another way)' }).toBe(4);
            await settled(page);
            expect(await text(), 'After a redraw the readout kept for the recording stepped to names another recording: it was found again by its index or its x, not by what it is. '
                + 'Fix: the point read is kept by its recording\'s key and looked up by it once the picture is drawn again (src/webview/figure/figure.ts). See docs/display-rules.md R7.').toBe(stepped);
        },
    },
    {
        chart: 'entry distribution', event: 'a click, then + before the double-click wait is over: the bin clicked on is picked', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openEntry(page, scanned!, { language: 'en' });
            // The fixture's CSV: the value is its rpm, grouped by line. The first line's tallest bar is 900 rpm.
            await pickCsv(page, 'motor.csv', entry100Metadata());
            await page.locator('[data-action="entry-value"]').selectOption('csv:rpm');
            await page.locator('[data-action="entry-group"]').selectOption('csv:line');
            type Bars = Array<{ left: number; right: number; top: number; bottom: number; count: number }>;
            const bars = (): Promise<Bars> => page.locator(DIST_FIGURE).evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => { lanes: Array<{ bins?: { bars: Bars } }> } }).__figureInspect().lanes[0]?.bins?.bars ?? []);
            await expect.poll(async () => ((await page.locator(DIST_FIGURE).count()) ? (await bars()).length : 0), { message: 'the first line\'s bars are drawn' }).toBeGreaterThan(0);
            const bar = [...await bars()].sort((one, other) => other.count - one.count)[0];
            const box = (await page.locator(DIST_FIGURE).boundingBox())!;
            await page.mouse.move(box.x + (bar.left + bar.right) / 2, box.y + (bar.top + bar.bottom) / 2);
            await expect.poll(() => distText(page), { message: 'the bar under the pointer is read', timeout: 15_000 }).not.toBe('');
            // The click, and + at once: the bin the readout read at the press is the one picked (R7, R13), not one the zoom put there.
            await page.mouse.down();
            await page.mouse.up();
            await page.keyboard.press('=');
            await expect.poll(async () => (await snapshotUi(page)).entry?.dist?.range ?? null, { message: 'a bin is picked' }).not.toBeNull();
            await settled(page);
            const picked = (await snapshotUi(page)).entry!.dist!.range as { low: number; high: number };
            expect(picked.low <= 900 && 900 < picked.high, `the bin clicked on (900 rpm, the bar the readout read) is picked: ${JSON.stringify(picked)}`).toBe(true);
        },
    },
    {
        // docs/display-rules.md R7, "選択は見た目だけを変える": a picked range colours the recordings inside it; the keys
        // still pass every recording drawn, into the range and out of it.
        chart: 'entry distribution', event: '← / → with a range picked: every recording is read once, inside the range and outside it', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openEntry(page, scanned!, { language: 'en' });
            // The fixture's CSV with two columns added: the first five recordings are lot T and score 1 to 5.
            const lines = entry100Metadata().replace(/^﻿/u, '').trimEnd().split(/\r?\n/u);
            const csv = [`${lines[0]},lot,score`, ...lines.slice(1).map((line, index) => `${line},${index < 5 ? 'T' : 'U'},${index < 5 ? index + 1 : 9}`)].join('\n');
            await pickCsv(page, 'motor.csv', csv);
            await page.locator('[data-action="entry-value"]').selectOption('csv:score');
            await page.locator('[data-action="entry-group"]').selectOption('csv:lot');
            const dotCanvas = page.locator(DIST_FIGURE);
            const dots = (): Promise<Array<{ key: string; x: number; y: number }>> => distDots(page, 'T');
            await expect.poll(async () => (await dots()).length, { message: 'lot T is drawn as five dots' }).toBe(5);
            const drawn = (await dots()).sort((a, b) => a.x - b.x);
            const at = (await dotCanvas.boundingBox())!;
            // Alt+drag picks the range holding the third and fourth recordings (from between the 2nd and 3rd dots to
            // between the 4th and 5th), away from the dots themselves.
            const y = at.y + drawn[0].y - 24;
            await page.keyboard.down('Alt');
            await page.mouse.move(at.x + (drawn[1].x + drawn[2].x) / 2, y);
            await page.mouse.down();
            await page.mouse.move(at.x + (drawn[3].x + drawn[4].x) / 2, y, { steps: 6 });
            await page.mouse.up();
            await page.keyboard.up('Alt');
            await expect.poll(async () => (await snapshotUi(page)).entry?.dist?.range ?? null, { message: 'Alt+drag picks a range on the distribution (if the gesture changed, pick the range as a user now does)' }).not.toBeNull();
            await settled(page);
            await expect.poll(async () => (await dots()).length, { message: 'the five recordings stay drawn with a range picked' }).toBe(5);
            const now = (await dots()).sort((a, b) => a.x - b.x);
            const box = (await dotCanvas.boundingBox())!;
            const text = (): Promise<string> => distText(page);
            await page.mouse.move(box.x + now[0].x, box.y + now[0].y);
            await expect.poll(text, { message: 'the dot under the pointer is read', timeout: 15_000 }).not.toBe('');
            const fix = 'With a range picked ← / → must still pass every recording drawn, inside the range and outside it (docs/display-rules.md R7). '
                + 'Fix: keep the recordings on one layer and show the range with StageLayer.colorAt (entryDistribution.ts distributionRows), never as a layer of their own.';
            const forward = [await text()];
            for (let step = 1; step < now.length; step++) {
                await page.keyboard.press('ArrowRight');
                await expect.poll(text, { message: `→ from "${forward.at(-1)}" (recording ${step} of 5) reads no further recording: it cannot cross the range's edge. ${fix}` }).not.toBe(forward.at(-1));
                forward.push(await text());
            }
            expect(new Set(forward).size, `→ read ${new Set(forward).size} of the 5 recordings: ${forward.join(' | ')}. ${fix}`).toBe(5);
            const backward = [await text()];
            for (let step = 1; step < now.length; step++) {
                await page.keyboard.press('ArrowLeft');
                await expect.poll(text, { message: `← from "${backward.at(-1)}" reads no further recording. ${fix}` }).not.toBe(backward.at(-1));
                backward.push(await text());
            }
            expect(backward, `← must pass the recordings → passed, in reverse. ${fix}`).toEqual([...forward].reverse());
        },
    },
    {
        chart: 'entry distribution', event: 'a double click on a dot resets the zoom only: the table stays on its row', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openEntry(page, scanned!, { language: 'en' });
            await pickCsv(page, 'motor.csv', entry100Metadata());
            await page.locator('[data-action="entry-value"]').selectOption('csv:rpm');
            await page.locator('[data-action="entry-group"]').selectOption('csv:rpm');
            // 1800 rpm: too few recordings for a histogram, drawn as dots.
            const dots = (): Promise<Array<{ key: string; x: number; y: number }>> => distDots(page, '1800');
            await expect.poll(async () => (await dots()).length, { message: 'the 1800 rpm group is drawn as dots' }).toBeGreaterThan(0);
            const focused = async (): Promise<string | null> => page.locator('[data-entry-rows] tr.is-focused').getAttribute('data-key', { timeout: 500 }).catch(() => null);
            const before = await focused();
            const dot = (await dots()).find(item => item.key !== before);
            expect(dot, 'a dot of another row').toBeTruthy();
            const at = (await page.locator(DIST_FIGURE).boundingBox())!;
            // (The dot is read before it is pressed: a click acts on what the readout read at the press.)
            await page.mouse.move(at.x + dot!.x, at.y + dot!.y);
            await expect.poll(() => distText(page), { message: 'the dot under the pointer is read', timeout: 15_000 }).not.toBe('');
            await page.mouse.dblclick(at.x + dot!.x, at.y + dot!.y);
            await settled(page);
            expect(await focused(), 'the table stays on its row').toBe(before);
        },
    },
];

for (const row of ROWS) {
    test(`${row.chart} × ${row.event} (R7)`, async ({ page }) => {
        // Where the backend is required (AWA_REQUIRE_BACKEND=1, or the repo's .venv), a row that needs it fails, never skips.
        if (row.backend && !scanned && backendRequired()) throw new Error('the Python backend is required here but the entry100 fixture was not scanned');
        if (row.backend) test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture (AWA_REQUIRE_BACKEND=0)');
        test.setTimeout(90_000);
        await row.run(page);
    });
}

test('the browser table holds a row for each chart the readout runs on, by its full name, and each real path R7 names', () => {
    // Every chart an owner shows through plotHoverLayer, exactly: one not listed here, or listed and with no row, fails.
    const CHARTS = ['track waveform lane', 'track spectrogram lane',
        'steps overlay', 'steps overlay (a trigger\'s events, over its lanes)', 'trigger events overlay inside the lanes\' surface', 'steps difference pane',
        'steps lanes (no trigger)', 'entry distribution'];
    expect([...new Set(ROWS.map(row => row.chart))].sort()).toEqual([...CHARTS].sort());
    // Each chart is stepped (→) or zoomed (+) under a still pointer in at least one of its rows.
    for (const chart of CHARTS) expect(ROWS.some(row => row.chart === chart && /→|\+/u.test(row.event)), `${chart}: a step or a zoom`).toBe(true);
    const events = ROWS.map(row => row.event).join(' | ');
    for (const path of ['scroll', 'Tab', 'then +', 'pending', 'failed', 'add up', 'step whose read failed', 'double click', 'drag', 'the surface from under', 'double-click wait', 'event-line click', 'drag threshold', 'a lane that reads nothing', 'picture is made anew', 'on a dot', 'recordings of the same value', 'a redraw without another recording', 'with a range picked']) expect(events, path).toContain(path);
});
