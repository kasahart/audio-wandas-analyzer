import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, settled, test, type Locator, type Page } from './canvasAudit';
import { buildExtensionHostPathManyTracksHtml, buildExtensionHostPathUiSmokeHtml, buildUiSmokeHtml } from './buildHtml';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';
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

type Noted = { read: string; at: number | null; x: number | null; frame: number[]; cursorHz: number | null };
/** What a plot reads now (plotHoverLayer.ts notePlotRead) and the frequency its linked cursor is at (data-cursor-hz). */
const noted = (plot: Locator): Promise<Noted> => plot.evaluate(canvas => {
    const read = (canvas as HTMLElement & { __plotRead?: { x: number } | null }).__plotRead;
    const at = canvas.getAttribute('data-plot-read-at'), hz = canvas.getAttribute('data-cursor-hz');
    return {
        read: canvas.getAttribute('data-plot-read') ?? '', at: at ? Number(at) : null, x: read ? read.x : null,
        frame: (canvas.getAttribute('data-plot-frame') ?? '').split(' ').map(Number), cursorHz: hz ? Number(hz) : null,
    };
});
/** Polled until the plot reads a point of its full data (not pending, nor failed). */
async function readFull(plot: Locator, timeout = 10_000): Promise<Noted> {
    await expect.poll(async () => (await noted(plot)).read, { timeout }).toBe('full');
    return noted(plot);
}
const same = (a: number | null | undefined, b: number | null | undefined, tolerance = 1e-9): boolean =>
    a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
/** The `count` points with a value after `at` in the plot's full data, as the plot asks it (fullRead.ts). */
const pointsAfter = (plot: Locator, at: number, count: number): Promise<number[]> => plot.evaluate(async (canvas, { at, count }) => {
    type Points = { xs: number[]; values?: Array<number | null> };
    const read = (canvas as HTMLElement & { __plotRead?: { layer: { full: { line?(query: Record<string, unknown>, ready: () => void): Points | null | undefined } } } | null }).__plotRead;
    const source = read?.layer.full;
    if (!source?.line) return [];
    const got = await new Promise<Points | null>(resolve => {
        const ready = (): void => { const answer = source.line!({ x0: at, x1: at, beyond: 512 }, ready); if (answer !== undefined) resolve(answer); };
        ready();
    });
    return (got?.xs ?? []).filter((x, index) => x > at && got?.values?.[index] !== null && Number.isFinite(got?.values?.[index] ?? NaN)).slice(0, count);
}, { at, count });
const seconds = (text: string): number | null => { const found = / \/ (−?\d+\.\d+) s \//u.exec(text); return found ? Number(found[1].replace('−', '-')) : null; };
const clock = async (page: Page): Promise<number> => {
    const [minutes, rest] = ((await page.locator('#cursor-display').textContent()) ?? '').split(':');
    return Number(minutes) * 60 + Number(rest);
};
async function hoverAt(page: Page, plot: Locator, across: number, down = 0.5): Promise<{ x: number; y: number }> {
    const box = (await plot.boundingBox())!;
    const frame = (await noted(plot)).frame;
    const left = frame.length === 4 && frame.every(Number.isFinite) ? frame[0] : 0, width = frame.length === 4 && frame.every(Number.isFinite) ? frame[2] : box.width;
    const at = { x: box.x + left + width * across, y: box.y + box.height * down };
    await page.mouse.move(at.x, at.y);
    return at;
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
    await page.evaluate(({ request, view, files }) => {
        request.filePaths.forEach((filePath, index) => {
            const file = files.find(item => item.filePath === filePath)!;
            const values = (view.values as number[] | undefined)?.map(value => value + (index === 0 ? 6 : 0));
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: { ...view, ...(values ? { values } : {}) } } }, '*');
        });
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, view, files });
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
const slotOf = (plot: Locator): Locator => plot.locator('xpath=preceding::*[@data-plot-readout][1]');

/** One row of the table: a chart, an event on it, and what the readout and its linked cursors show after it. */
type Row = { chart: string; event: string; backend?: boolean; run(page: Page): Promise<void> };

/** A lane's ← / → then + (a redraw under the still pointer): the point stepped to is read on, and the time shown with the lanes is its own. */
const steppedThenZoomed = (selector: string): Row['run'] => async page => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const lane = page.locator(selector).first();
    await expect.poll(() => lane.getAttribute('data-plot')).toBe('');
    await hoverAt(page, lane, 0.6);
    const first = await readFull(lane);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await noted(lane)).at).not.toBe(first.at);
    const stepped = await readFull(lane);
    await page.keyboard.press('=');
    await expect.poll(() => lane.getAttribute('data-plot-window')).not.toBe('0.000 1.000 0.000 1.000');
    await settled(page);
    const zoomed = await readFull(lane);
    expect(zoomed.at, 'the cell or sample stepped to is still the one read').toBe(stepped.at);
    const readout = (await page.locator('#plot-readout').textContent()) ?? '';
    expect(seconds(readout), `the readout "${readout}" writes its time`).not.toBeNull();
    expect(Math.abs((seconds(readout) ?? NaN) - (zoomed.at ?? NaN)), 'the readout writes the point read').toBeLessThan(0.006);
    // The time shown with the lanes (and the other lanes' time line) is the point read, not the time now under its old place.
    await expect.poll(async () => Math.abs(await clock(page) - (zoomed.at ?? NaN))).toBeLessThan(0.006);
};

/**
 * A gate on the host's answers to the readout's reads (read-lane-…) of the given types: passed, held until let go
 * (the backend slow), or turned into the host's error (a passing backend failure), as the page's host stand-in posts them.
 */
async function gateReads(page: Page): Promise<void> {
    await page.evaluate(() => {
        type Gate = { mode: 'pass' | 'hold' | 'fail'; types: string[]; held: unknown[][]; release(): void };
        const post = window.postMessage.bind(window) as (...args: unknown[]) => void;
        const gate: Gate = { mode: 'pass', types: [], held: [], release() { gate.mode = 'pass'; for (const args of gate.held.splice(0)) post(...args); } };
        (window as unknown as { __readGate: Gate }).__readGate = gate;
        window.postMessage = ((...args: unknown[]) => {
            const message = args[0] as { type?: string; requestId?: string } | null;
            const ours = gate.mode !== 'pass' && !!message && String(message.requestId).startsWith('read-lane-') && gate.types.includes(String(message.type));
            if (ours && gate.mode === 'hold') { gate.held.push(args); return; }
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
const readValue = (plot: Locator): Promise<string> => plot.evaluate(canvas => canvas.getAttribute('data-plot-read-value') ?? '');
/** The cursor spectrum read at `across`, stepped once with →: the frequency stepped to, read from the full data. */
async function spectrumStepped(page: Page, across = 0.3): Promise<{ spectrum: Locator; stepped: Noted; pointer: { x: number; y: number }; under: Noted }> {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await gateReads(page);
    const spectrum = page.locator('#spectrum-overlay-canvas');
    await expect.poll(() => spectrum.getAttribute('data-plot-axes')).not.toBe('');
    const pointer = await hoverAt(page, spectrum, across, 0.4);
    const under = await readFull(spectrum);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await noted(spectrum)).at).not.toBe(under.at);
    return { spectrum, stepped: await readFull(spectrum), pointer, under };
}

const ROWS: Row[] = [
    {
        chart: 'track waveform lane', event: 'keys pressed while the next points are on their way add up',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildExtensionHostPathUiSmokeHtml(500), { waitUntil: 'domcontentloaded' });
            const lane = page.locator('.track-canvas:not(.track-spec-canvas)').first();
            await expect.poll(() => lane.getAttribute('data-plot')).toBe('');
            await hoverAt(page, lane, 0.3);
            const from = await readFull(lane);
            // Three keys at once: the step's next points are asked for and come in after the last key.
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            await settled(page);
            const after = await readFull(lane);
            const next = await pointsAfter(lane, from.at!, 3);
            expect(next.length).toBe(3);
            expect(after.at, 'three keys, three points').toBe(next[2]);
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
            const lane = page.locator('.track-canvas:not(.track-spec-canvas)').first();
            await expect.poll(() => lane.getAttribute('data-plot')).toBe('');
            const pointer = await hoverAt(page, lane, 0.5);
            await readFull(lane);
            // A plain wheel scrolls the lanes under the pointer, which stays where it is: by one track, so the next
            // track's waveform is under it.
            const nextLane = page.locator('.track-canvas:not(.track-spec-canvas)').nth(1);
            const rowStep = (await nextLane.boundingBox())!.y - (await lane.boundingBox())!.y;
            await page.mouse.wheel(0, rowStep);
            await expect.poll(() => wrapper.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
            await settled(page);
            // The lane under the pointer now reads, and it alone.
            const id = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id ?? '', pointer);
            expect(id).toMatch(/^track-(?:spec-)?canvas-[\d-]+$/u);
            expect(id, 'another lane than the one read before the scroll').not.toBe(await lane.getAttribute('id'));
            const under = page.locator(`#${id}`);
            await readFull(under);
            await expect(page.locator('.track-canvas[data-plot-read="full"]')).toHaveCount(1);
            const box = (await under.boundingBox())!;
            const read = await noted(under);
            expect(Math.abs((read.x ?? NaN) - (pointer.x - box.x)), 'read at the pointer').toBeLessThan(25);
            await expect(page.locator('#plot-readout:not([hidden])')).toHaveCount(1);
            await page.keyboard.press('ArrowRight');
            await expect.poll(async () => (await noted(under)).at, { message: '→ steps the lane under the pointer' }).not.toBe(read.at);
        },
    },
    { chart: 'track waveform lane', event: '→ then + : the point stepped to and the time shown stay its own', run: steppedThenZoomed('.track-canvas:not(.track-spec-canvas)') },
    { chart: 'track spectrogram lane', event: '→ then + : the cell stepped to and the time shown stay its own', run: steppedThenZoomed('.track-spec-canvas') },
    {
        chart: 'cursor spectrum', event: 'its slice pending, then in: the pair plots\' cursors follow the frequency read',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildExtensionHostPathUiSmokeHtml(400), { waitUntil: 'domcontentloaded' });
            await page.locator('[data-action="set-pair-reference"]').first().click();
            await expect(page.locator('[data-pair-lane][data-plot]')).toHaveCount(3);
            const spectrum = page.locator('#spectrum-overlay-canvas');
            await expect.poll(() => spectrum.getAttribute('data-plot-axes')).not.toBe('');
            for (const lane of ['gain', 'phase', 'coherence']) await expect.poll(() => page.locator(`[data-pair-lane="${lane}"]`).getAttribute('data-plot-axes')).not.toBe('');
            await hoverAt(page, spectrum, 0.37, 0.4);
            const read = await readFull(spectrum);
            await expect.poll(async () => (await noted(spectrum)).cursorHz, { message: 'the spectrum follows the frequency it reads' }).toBe(read.at);
            for (const lane of ['gain', 'phase', 'coherence']) {
                await expect.poll(async () => same((await noted(page.locator(`[data-pair-lane="${lane}"]`))).cursorHz, read.at, 1e-6), { message: `${lane}'s cursor at the frequency read` }).toBe(true);
            }
        },
    },
    {
        chart: 'pair gain', event: '+ (a redraw) under a still pointer: the power spectrum\'s line follows the point read now',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
            await page.locator('[data-action="set-pair-reference"]').first().click();
            const gain = page.locator('[data-pair-lane="gain"]');
            await expect.poll(() => gain.getAttribute('data-plot-axes')).not.toBe('');
            const spectrum = page.locator('#spectrum-overlay-canvas');
            await hoverAt(page, gain, 0.7);
            const before = await readFull(gain);
            await expect.poll(async () => same((await noted(spectrum)).cursorHz, before.at, 1e-6)).toBe(true);
            // + twice: zoomed about the middle, so another point is under the still pointer.
            for (let turn = 0; turn < 2; turn++) {
                await page.keyboard.press('=');
                await settled(page);
            }
            await expect.poll(async () => (await noted(gain)).at).not.toBe(before.at);
            const zoomed = await readFull(gain);
            await expect.poll(async () => same((await noted(spectrum)).cursorHz, zoomed.at, 1e-6), { message: 'the power spectrum\'s line at the frequency the gain reads now' }).toBe(true);
        },
    },
    {
        chart: 'cursor spectrum', event: 'its slice failed: read again once the pause is over, the pointer still',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
            // The host fails the readout's slices (a passing backend failure) until the test lets them through: its
            // answers, as the page's host stand-in posts them, are turned into the host's error.
            await page.evaluate(() => {
                const state = window as unknown as { __failReads: boolean };
                state.__failReads = true;
                const post = window.postMessage.bind(window);
                window.postMessage = ((data: unknown, ...rest: unknown[]) => {
                    const message = data as { type?: string; requestId?: string } | null;
                    const failed = state.__failReads && message?.type === 'spectrum-slice-result' && String(message.requestId).startsWith('read-lane-');
                    return (post as (...args: unknown[]) => void)(failed ? { ...message, type: 'spectrum-slice-error', error: 'test: failed for a while' } : data, ...rest);
                }) as typeof window.postMessage;
            });
            const spectrum = page.locator('#spectrum-overlay-canvas');
            await expect.poll(() => spectrum.getAttribute('data-plot-axes')).not.toBe('');
            // The cursor moved to a time whose slice is not read yet: its read fails.
            const lane = page.locator('.track-canvas:not(.track-spec-canvas)').first();
            const laneBox = (await lane.boundingBox())!;
            await page.mouse.click(laneBox.x + laneBox.width * 0.73, laneBox.y + laneBox.height / 2);
            await settled(page);
            await hoverAt(page, spectrum, 0.4, 0.4);
            await expect.poll(async () => (await noted(spectrum)).read).toBe('failed');
            await expect(page.locator('#spectrum-freq-readout')).not.toContainText(/\d/u);
            await page.evaluate(() => { (window as unknown as { __failReads: boolean }).__failReads = false; });
            // No motion: the read is asked again once the store's pause (FAILED_RETRY_MS) is over.
            await readFull(spectrum, 12_000);
            await expect(page.locator('#spectrum-freq-readout')).toContainText(/\d/u);
            // The order's level read failed with it (the same slice): its level unknown, then waiting the same pause,
            // is this test's injected failure, not a plot that orders its lines by drawn points (R6's audit, canvasAudit.ts).
            await page.evaluate(() => {
                const audit = window.__orderAudit ?? [];
                audit.splice(0, audit.length, ...audit.filter(entry => !entry.startsWith('#spectrum-overlay-canvas')));
            });
        },
    },
    {
        chart: 'steps overlay (a trigger\'s events, over its lanes)', event: 'a scroll under a still pointer reads the place now under it; ← / → step from there', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 620 });
            await openTrigger(page, scanned!, 2);
            const overlay = page.locator('[data-stage-canvas="overlay"]');
            await expect.poll(() => overlay.getAttribute('data-plot')).toBe('');
            const wrapper = page.locator('#tracks-wrapper');
            expect(await wrapper.evaluate(element => element.scrollHeight > element.clientHeight + 60), 'the steps\' view scrolls').toBe(true);
            const pointer = await hoverAt(page, overlay, 0.5, 0.6);
            await readFull(overlay);
            await page.mouse.wheel(0, 50);
            await expect.poll(() => wrapper.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
            await settled(page);
            const box = (await overlay.boundingBox())!;
            expect(pointer.y >= box.y && pointer.y <= box.y + box.height, 'still over the plot').toBe(true);
            const read = await readFull(overlay);
            expect(Math.abs((read.x ?? NaN) - (pointer.x - box.x)), 'read again at the pointer, never only taken away').toBeLessThan(25);
            await page.keyboard.press('ArrowRight');
            await expect.poll(async () => (await noted(overlay)).at).not.toBe(read.at);
            const stepped = await noted(overlay);
            expect(Math.abs((stepped.x ?? NaN) - (pointer.x - box.x)), '→ steps from the point read there, never the plot\'s left edge').toBeLessThan(25);
        },
    },
    {
        chart: 'trigger events overlay inside the lanes\' surface', event: 'Tab to a lane and away: the pointer\'s readout stays', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 1100 });
            await openTrigger(page, scanned!);
            const overlay = page.locator('[data-stage-canvas="overlay"]');
            await expect.poll(() => overlay.getAttribute('data-plot')).toBe('');
            await hoverAt(page, overlay, 0.5);
            const read = await readFull(overlay);
            const slot = slotOf(overlay);
            const text = (await slot.textContent()) ?? '';
            expect(text).toMatch(/\d/u);
            const lane = page.locator('.track-canvas[data-plot]').first();
            // The keyboard's focus onto the lane (Tab, as a user gives it), the pointer still on the events plot.
            const onLane = (): Promise<boolean> => lane.evaluate(canvas => document.activeElement === canvas);
            for (let presses = 0; presses < 60 && !await onLane(); presses++) await page.keyboard.press('Tab');
            if (!await onLane()) await lane.focus();
            expect(await onLane()).toBe(true);
            await settled(page);
            expect((await noted(overlay)).at, 'the focus gives no readout over the pointer\'s').toBe(read.at);
            await expect(slot).toBeVisible();
            await expect(slot).toHaveText(text);
            await page.keyboard.press('Tab');
            await settled(page);
            expect(await onLane()).toBe(false);
            expect((await noted(overlay)).at, 'nor does its leaving take the pointer\'s away').toBe(read.at);
            await expect(slot).toBeVisible();
            await expect(slot).toHaveText(text);
        },
    },
    {
        chart: 'entry distribution', event: '→ then + (the rows made anew): the bin stepped to is read on', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openEntry(page, scanned!, { language: 'en' });
            const row = page.locator('[data-dist-canvas]').first();
            await expect.poll(() => row.getAttribute('data-plot-axes')).not.toBe(null);
            const key = await row.getAttribute('data-plot-key');
            const again = page.locator(`[data-dist-canvas][data-plot-key="${key}"]`);
            await hoverAt(page, again, 0.45);
            const first = await readFull(again);
            await page.keyboard.press('ArrowRight');
            await expect.poll(async () => (await noted(again)).at).not.toBe(first.at);
            await page.keyboard.press('ArrowRight');
            await settled(page);
            const stepped = await readFull(again);
            await page.keyboard.press('=');
            await expect.poll(() => again.getAttribute('data-plot-window')).not.toMatch(/^0\.000 1\.000/u);
            await settled(page);
            expect((await readFull(again)).at, 'the bin stepped to, on the row drawn anew').toBe(stepped.at);
        },
    },
    {
        chart: 'cursor spectrum', event: 'a redraw whose re-read is pending: no old value meanwhile, and a key then steps from the new data once in',
        async run(page) {
            const { spectrum, stepped } = await spectrumStepped(page);
            // The time cursor moves (the pointer still): the spectrum is drawn anew, its slice's points on their way.
            await setGate(page, 'hold', ['spectrum-slice-result']);
            await testAction(page, 'set-cursor', { cursorNorm: 0.71 });
            await expect.poll(async () => (await noted(spectrum)).read, { message: 'the point stepped to waits for the new drawing\'s data' }).toBe('pending');
            await expect(page.locator('#spectrum-freq-readout')).not.toContainText(/\d/u);
            // A key meanwhile: no step from the old drawing, no number.
            await page.keyboard.press('ArrowRight');
            await settled(page);
            expect((await noted(spectrum)).read, 'still waiting, never a step from the old data').toBe('pending');
            await expect(page.locator('#spectrum-freq-readout')).not.toContainText(/\d/u);
            await setGate(page, 'pass');
            const after = await readFull(spectrum);
            const [next] = await pointsAfter(spectrum, stepped.at!, 1);
            expect(after.at, 'one step from the point stepped to, read again on the new data').toBe(next);
            expect(await readValue(spectrum), 'a value of the new slice').not.toBe('');
        },
    },
    {
        chart: 'cursor spectrum', event: 'a re-read on a new drawing failed: the point stepped to is kept, read once the backend answers',
        async run(page) {
            const { spectrum, stepped, under } = await spectrumStepped(page);
            await setGate(page, 'fail', ['spectrum-slice-result']);
            await testAction(page, 'set-cursor', { cursorNorm: 0.69 });
            await expect.poll(async () => (await noted(spectrum)).read).toBe('failed');
            await expect(page.locator('#spectrum-freq-readout')).not.toContainText(/\d/u);
            await setGate(page, 'pass');
            const again = await readFull(spectrum, 12_000);
            expect(again.at, 'the point stepped to').toBe(stepped.at);
            expect(again.at, 'not the one under the pointer').not.toBe(under.at);
            await page.evaluate(() => {
                const audit = window.__orderAudit ?? [];
                audit.splice(0, audit.length, ...audit.filter(entry => !entry.startsWith('#spectrum-overlay-canvas')));
            });
        },
    },
    {
        chart: 'cursor spectrum', event: '+ takes the point stepped to off the window: the true pointer is read, never the step\'s place',
        async run(page) {
            const { spectrum, pointer } = await spectrumStepped(page, 0.04);
            const box = (await spectrum.boundingBox())!;
            const frame = (await noted(spectrum)).frame;
            const at = pointer.x - box.x;
            // Steps on until the point stepped to is well right of the pointer (low on the log axis, where bins are wide).
            for (let key = 0; key < 400 && ((await noted(spectrum)).x ?? 0) < at + 45; key++) await page.keyboard.press('ArrowRight');
            const far = await readFull(spectrum);
            expect((far.x ?? 0) - at, 'stepped well away from the pointer').toBeGreaterThan(45);
            expect((far.x ?? 0) - frame[0], 'and left of the middle quarter').toBeLessThan(frame[2] * 0.37);
            // + twice, about the middle: the point stepped to is off the window, the pointer still on the plot.
            await page.keyboard.press('=');
            await settled(page);
            await page.keyboard.press('=');
            await expect.poll(() => spectrum.getAttribute('data-plot-window')).not.toMatch(/^0\.000 1\.000/u);
            await settled(page);
            const read = await readFull(spectrum);
            expect(read.at, 'the point off the window is not read').not.toBe(far.at);
            expect(Math.abs((read.x ?? NaN) - at), 'read at the true pointer').toBeLessThan(15);
        },
    },
    {
        chart: 'track waveform lane', event: 'a seek whose read failed keeps the keys queued with it: three keys, three points once the backend answers',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildExtensionHostPathUiSmokeHtml(500), { waitUntil: 'domcontentloaded' });
            await gateReads(page);
            const lane = page.locator('.track-canvas:not(.track-spec-canvas)').first();
            await expect.poll(() => lane.getAttribute('data-plot')).toBe('');
            await hoverAt(page, lane, 0.3);
            const from = await readFull(lane);
            const next = await pointsAfter(lane, from.at!, 3);
            expect(next.length).toBe(3);
            await setGate(page, 'fail', ['waveform-range-result']);
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowRight');
            await settled(page);
            await setGate(page, 'pass');
            await expect.poll(async () => (await noted(lane)).at, { timeout: 15_000, message: 'three keys, three points' }).toBe(next[2]);
        },
    },
    {
        chart: 'track waveform lane', event: 'a double click resets the zoom only: the loop and the time cursor stay',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
            const lane = page.locator('.track-canvas:not(.track-spec-canvas)').first();
            await expect.poll(() => lane.getAttribute('data-plot')).toBe('');
            await testAction(page, 'set-loop-region', { start: 0.25, end: 0.75 });
            await expect(page.locator('#loop-time-display')).toBeVisible();
            const loop = await page.locator('#loop-time-display').textContent();
            await hoverAt(page, lane, 0.5);
            await page.keyboard.press('=');
            await expect.poll(() => lane.getAttribute('data-plot-window')).not.toBe('0.000 1.000 0.000 1.000');
            const cursor = (): Promise<number> => page.evaluate(() => {
                window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: `cursor-${Date.now()}`, actions: [] } }));
                const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi?: { cursorNorm?: number } }> }).__uiSmokePostedMessages;
                return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)?.renderedUi?.cursorNorm ?? NaN;
            });
            const before = await cursor();
            const box = (await lane.boundingBox())!;
            await page.mouse.dblclick(box.x + box.width * 0.85, box.y + box.height / 2);
            await expect.poll(() => lane.getAttribute('data-plot-window')).toBe('0.000 1.000 0.000 1.000');
            await settled(page);
            expect(await cursor(), 'the time cursor stays').toBe(before);
            await expect(page.locator('#loop-time-display'), 'the loop stays').toHaveText(loop ?? '');
            // A click alone moves the cursor and clears the loop, once no second press follows.
            await page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2);
            await expect.poll(() => cursor()).not.toBe(before);
            await expect(page.locator('#loop-time-display')).toBeHidden();
        },
    },
    {
        chart: 'cursor spectrum', event: 'a box drag carried over the pair plots: no hover on that surface while it drags',
        async run(page) {
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
            await page.locator('[data-action="set-pair-reference"]').first().click();
            const gain = page.locator('[data-pair-lane="gain"]');
            await expect.poll(() => gain.getAttribute('data-plot-axes')).not.toBe('');
            const spectrum = page.locator('#spectrum-overlay-canvas');
            await expect.poll(() => spectrum.getAttribute('data-plot-axes')).not.toBe('');
            const from = await hoverAt(page, spectrum, 0.3, 0.4);
            await page.mouse.down();
            await page.mouse.move(from.x + 40, from.y + 20, { steps: 4 });
            const gainBox = (await gain.boundingBox())!;
            await page.mouse.move(gainBox.x + gainBox.width * 0.5, gainBox.y + gainBox.height * 0.5, { steps: 6 });
            await settled(page);
            expect((await noted(gain)).read, 'the pair plot reads nothing while the drag is under way').not.toBe('full');
            expect((await noted(gain)).read).not.toBe('pending');
            await page.mouse.up();
            await page.mouse.move(gainBox.x + gainBox.width * 0.52, gainBox.y + gainBox.height * 0.5);
            await readFull(gain);
        },
    },
    {
        chart: 'steps overlay (a trigger\'s events, over its lanes)', event: 'a scroll that takes the surface from under a still pointer clears its readout', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 620 });
            await openTrigger(page, scanned!, 2);
            const overlay = page.locator('[data-stage-canvas="overlay"]');
            await expect.poll(() => overlay.getAttribute('data-plot')).toBe('');
            const wrapper = page.locator('#tracks-wrapper');
            const pointer = await hoverAt(page, overlay, 0.5, 0.85);
            await readFull(overlay);
            const slot = slotOf(overlay);
            await expect(slot).toContainText(/\d/u);
            // Scrolled until the steps' view is off the pointer: a lane (another surface) or the page under it.
            const surface = page.locator('.track-stage');
            const off = async (): Promise<boolean> => page.evaluate(({ x, y }) => { const under = document.elementFromPoint(x, y); return !!under && !document.querySelector('.track-stage')?.contains(under); }, pointer);
            for (let turn = 0; turn < 12 && !await off(); turn++) { await wrapper.evaluate(element => { element.scrollTop += 80; }); await settled(page); }
            expect(await off(), 'the steps\' view scrolled from under the pointer').toBe(true);
            expect(await surface.count()).toBe(1);
            await expect.poll(async () => (await noted(overlay)).read, { message: 'its point is no longer read' }).not.toBe('full');
        },
    },
    {
        chart: 'entry distribution', event: 'a click, then + before the double-click wait is over: the bin clicked on is picked', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 900 });
            await openEntry(page, scanned!, { language: 'en' });
            const row = page.locator('[data-dist-canvas]').first();
            await expect.poll(() => row.getAttribute('data-plot-axes')).not.toBe(null);
            const snapshot = (): Promise<{ low: number; high: number; range: { low: number; high: number } | null }> => page.evaluate(() => {
                window.dispatchEvent(new MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId: 'entry-snapshot', actions: [] } }));
                const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { entry: { dist: { low: number; high: number; range: { low: number; high: number } | null } } } }> }).__uiSmokePostedMessages;
                return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi.entry.dist;
            });
            const { low, high } = await snapshot();
            const box = (await row.boundingBox())!;
            const frame = (await noted(row)).frame;
            const left = frame.length === 4 && frame.every(Number.isFinite) ? frame[0] : 0, width = frame.length === 4 && frame.every(Number.isFinite) ? frame[2] : box.width;
            // Near the top edge of the row, where no dot is: the bin of the value at x 0.2 of the axis.
            const x = box.x + left + width * 0.2, y = box.y + 2;
            const value = low + 0.2 * (high - low);
            await page.mouse.click(x, y);
            await page.keyboard.press('=');
            await settled(page);
            const picked = (await snapshot()).range;
            expect(picked, 'a bin is picked').not.toBeNull();
            expect(picked!.low <= value + 1e-9 && value - 1e-9 <= picked!.high, `the bin clicked on (${value}) is picked, not one the zoom put there: ${JSON.stringify(picked)}`).toBe(true);
        },
    },
    {
        chart: 'steps overlay (a trigger\'s events, over its lanes)', event: 'an event-line click, then a drag before it is decided: the drag takes its place', backend: true,
        async run(page) {
            await page.setViewportSize({ width: 1280, height: 1100 });
            await openTrigger(page, scanned!);
            const overlay = page.locator('[data-stage-canvas="overlay"]');
            await expect.poll(() => overlay.getAttribute('data-plot')).toBe('');
            await hoverAt(page, overlay, 0.5);
            await readFull(overlay);
            const box = (await overlay.boundingBox())!;
            const on = await overlay.evaluate(canvas => { const read = (canvas as HTMLElement & { __plotRead?: { x: number; y: number } | null }).__plotRead; return read ? { x: read.x, y: read.y } : null; });
            expect(on, 'an event\'s line under the pointer').not.toBeNull();
            const left = page.locator('[data-action="stage-event-toggle"][data-out="true"]');
            const leftOut = await left.count();
            const whole = (window: string | null): boolean => !window || window.startsWith('0.000 1.000');
            // The click on the line, then at once a drag into a box elsewhere on the plot.
            await page.mouse.click(box.x + on!.x, box.y + on!.y);
            await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.8, { steps: 5 });
            await page.mouse.up();
            await expect.poll(async () => whole(await overlay.getAttribute('data-plot-window'))).toBe(false);
            await settled(page);
            expect(await left.count(), 'no event left out: the drag took the click\'s place').toBe(leftOut);
            // A click alone on the line leaves its event out, once no second press follows.
            await page.keyboard.press('0');
            await expect.poll(async () => whole(await overlay.getAttribute('data-plot-window'))).toBe(true);
            await hoverAt(page, overlay, 0.5);
            const again = await overlay.evaluate(canvas => { const read = (canvas as HTMLElement & { __plotRead?: { x: number; y: number } | null }).__plotRead; return read ? { x: read.x, y: read.y } : null; });
            await page.mouse.click(box.x + again!.x, box.y + again!.y);
            await expect.poll(() => left.count(), { message: 'the click alone leaves it out' }).toBe(leftOut + 1);
        },
    },
];

for (const row of ROWS) {
    test(`${row.chart} × ${row.event} (R7)`, async ({ page }) => {
        if (row.backend) test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
        test.setTimeout(90_000);
        await row.run(page);
    });
}

test('the browser table holds a row for each chart the readout runs on and each real path R7 names', () => {
    const charts = new Set(ROWS.map(row => row.chart.split(' ')[0] + ' ' + row.chart.split(' ')[1]));
    for (const chart of ['track waveform', 'track spectrogram', 'cursor spectrum', 'pair gain', 'steps overlay', 'trigger events', 'entry distribution']) expect(charts.has(chart), chart).toBe(true);
    const events = ROWS.map(row => row.event).join(' | ');
    for (const path of ['scroll', 'Tab', 'then +', 'pending', 'failed', '(a redraw)', 'add up', 'off the window', 'seek', 'double click', 'drag', 'the surface from under', 'double-click wait', 'event-line click']) expect(events, path).toContain(path);
});
