import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, settled, test, type Page } from './canvasAudit';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';
import { FLAG_COLOR } from '../../shared/gui/roleColors';


/** A `#rrggbb` colour as the browser computes it. */
const rgb = (hex: string): string => `rgb(${[1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;

let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

type Posted = { type: string; requestId: string; filePaths: string[]; stage?: string; detail?: { x: number[]; points: number } };
const stageScans = (page: Page): Promise<Posted[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages
    .filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage')));

/** Answers the last steps-mode scan as a host does, each file's result carrying `view` as the step's Frame. */
async function answer(page: Page, view: Record<string, unknown>): Promise<Posted> {
    const request = (await stageScans(page)).at(-1)!;
    await page.evaluate(({ request, view, files }) => {
        for (const filePath of request.filePaths) {
            const file = files.find(item => item.filePath === filePath)!;
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: view } }, '*');
        }
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, view: view, files: scanned! });
    return request;
}

test('the track view\'s steps mode draws every track as the chosen step\'s Frame, and a zoom of the spectrum overlay draws the part on screen with no scan of it (the figure service holds every value)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    const first = await page.locator('[data-entry-rows] tr').first().getAttribute('data-file-path');
    await page.keyboard.press('1');
    // The slotted file is a track at once; Esc shrinks the table into the side panel beside it.
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; filePaths?: string[] }> }).__uiSmokePostedMessages))
        .filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths).toEqual([first]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    await page.evaluate(filePath => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    }] } })), first!);
    await expect(page.locator('.track-row')).toHaveCount(1);
    // Steps: the step bar over the tracks, opened the first time on the input (the recordings as they are).
    await page.locator('[data-action="content-stage"]').click();
    const bar = page.locator('.track-stage-bar');
    const stage = page.locator('.track-stage');
    await expect(bar).toBeVisible();
    await expect(page.locator('#ruler-row')).toBeHidden();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-input');
    await expect(bar.locator('.step-chip.is-current')).toHaveAttribute('data-step-input', '');
    // The average spectrum at the chain's end, asked of the track's file and its base (its condition).
    await bar.locator('[data-step-hold="node-2"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-2');
    const asked = (await stageScans(page)).at(-1)!;
    expect(asked.filePaths).toEqual([first]);
    // While it is computed, the comparison is on screen already (not the lanes), saying how many files are in.
    await expect(stage).toHaveAttribute('data-layout', 'overlay');
    await expect(stage).toHaveAttribute('data-pending', '0/1');
    await expect(page.locator('#stacked-wrap')).toBeHidden();
    const view = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };
    await answer(page, view);
    // The base (ungrouped: the folder's other recordings) is too large to scan unasked; asked, it is.
    await page.locator('[data-action="stage-base-scan"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBeGreaterThan(1);
    // The track's line is in; the base group's files are counted as they come.
    await expect(stage).toHaveAttribute('data-pending', /^1\/\d+$/);
    // Every recording of the group is asked for, one request per channel the step is asked
    // of, one after another: each answered as it comes.
    await expect.poll(async () => { if ((await stage.getAttribute('data-pending')) !== '') await answer(page, view); return stage.getAttribute('data-pending'); }).toBe('');
    // Overlaid by default: the base group's median and the slotted track on one plot, the lanes out of the way.
    await expect(stage).toHaveAttribute('data-layout', 'overlay');
    await expect(bar).toHaveAttribute('data-drawn', '2');
    await expect(page.locator('#stacked-wrap')).toBeHidden();
    await expect(page.locator('[data-stage-legend] .compare-legend-item')).toHaveCount(2);
    // The track takes its role's colour: slot 1, yellow.
    await expect(page.locator('.track-header .role-chip-face').first()).toHaveAttribute('style', /background:\s*#d4b20f/);
    await expect(page.locator('.track-header .role-chip-face').first()).toHaveText(/^1( ch\d)?$/);
    // What the comparison hides is not drawn: a resize draws its plot again, not the ruler or the spectra under it.
    await page.evaluate(() => {
        const w = window as unknown as { __hiddenPaints: string[] };
        w.__hiddenPaints = [];
        for (const canvas of Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas#ruler-canvas, #spectrum-overlay-plot canvas'))) {
            const own = canvas.getContext.bind(canvas);
            canvas.getContext = ((...args: Parameters<HTMLCanvasElement['getContext']>) => { w.__hiddenPaints.push(canvas.id); return own(...args); }) as HTMLCanvasElement['getContext'];
        }
        window.dispatchEvent(new Event('resize'));
    });
    // The spectrum overlay and its Δ are one Figure on the new path (screens/compareOverlay.ts).
    const figure = page.locator('[data-stage-figure] canvas[data-figure]');
    type Seen = { waiting: boolean; headline: string; lanes: Array<{ id: string; range: { x: [number, number] } | null }> };
    const seen = (): Promise<Seen> => figure.evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Seen }).__figureInspect());
    await expect.poll(async () => (await figure.count()) === 1).toBe(true);
    await settled(page);
    expect(await page.evaluate(() => (window as unknown as { __hiddenPaints: string[] }).__hiddenPaints)).toEqual([]);
    // Δ on request, a lane under the overlay's.
    await page.locator('[data-action="stage-diff"]').click();
    await expect.poll(async () => { const now = await seen(); return !now.waiting && now.lanes.map(lane => lane.id).join(); }).toBe('overlay,delta');
    // The Figure is drawn at the size it is shown at, not stretched from the size it had alone: the pointer's marks
    // fall on its lines rather than beside them.
    const drawnAtShownSize = (): Promise<boolean> => figure.evaluate(canvas => {
        const element = canvas as HTMLCanvasElement;
        return element.clientHeight > 0 && Math.abs(element.height - Math.round(element.clientHeight * devicePixelRatio)) <= 1;
    });
    await expect.poll(drawnAtShownSize).toBe(true);
    // A box dragged on the plot zooms in. The Figure draws the part on screen from every value the figure service
    // holds (第 5 節; the second consequence of 第 1 節): no scan of the part on screen is asked for it.
    const box = (await figure.boundingBox())!;
    const scansBefore = (await stageScans(page)).length;
    await expect(page.locator('[data-stage-figure-headline]')).not.toHaveText('');
    await page.mouse.move(box.x + 56 + (box.width - 70) * 0.3, box.y + 10 + (box.height * 0.5) * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + 56 + (box.width - 70) * 0.6, box.y + 10 + (box.height * 0.5) * 0.7, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => { const now = await seen(); return !now.waiting && (now.lanes[0].range?.x[0] ?? 0) > 100; }).toBe(true);
    expect((await stageScans(page)).length, 'no scan of the part on screen').toBe(scansBefore);
    // The Δ headline of the part on screen, in the readout's form.
    await expect(page.locator('[data-stage-figure-headline]')).not.toHaveText('');
    // Side by side: every track a lane of its own of the same Figure; the tracks' rows stay out of the way.
    await page.locator('[data-action="stage-layout"]').click();
    await expect(stage).toHaveAttribute('data-layout', 'lanes');
    await expect(stage).toHaveAttribute('data-figure', 'true');
    await expect(page.locator('#stacked-wrap')).toBeHidden();
    await expect.poll(async () => { const now = await seen(); return !now.waiting && now.lanes.every(lane => lane.id.startsWith('own-')) && now.lanes.length; }).toBeGreaterThan(0);
    // None of the waveform view's rows, with their cursor and loop lines, is in sight.
    await expect(page.locator('#track-row-figure-0')).toBeHidden();
    // The HPF chip: the track as a time signal, drawn as its waveform in its lane.
    await bar.locator('.step-chip', { hasText: 'HPF' }).locator('[data-step-hold]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-0');
    await answer(page, { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'level', xs: [0.5, 1, 1.5], values: [-20, -21, -22],
        waveform: { min: [-0.3, -0.2], max: [0.3, 0.2], minT: [0.2, 1.2], maxT: [0.3, 1.3], absolutePeak: 0.3, unit: 'FS', ref: 1 } });
    await expect(bar).toHaveAttribute('data-stage', 'node-0');
    await expect(bar).toHaveAttribute('data-drawn', '1');
    // Back to the waveform: the lanes and the ruler are as before.
    await page.locator('[data-action="content-waveform"]').click();
    await expect(stage).toBeHidden();
    await expect(page.locator('#track-row-figure-0')).toBeVisible();
    await expect(page.locator('#ruler-row')).toBeVisible();
    await expect(page.locator('#stacked-wrap')).toBeVisible();
});

test('a two-channel recording is one lane in the steps view: its second channel is left out, not drawn empty', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    const first = await page.locator('[data-entry-rows] tr').first().getAttribute('data-file-path');
    await page.keyboard.press('1');
    await page.keyboard.press('Escape');
    const channel = (label: string) => ({ label, peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } });
    await page.evaluate(({ filePath, channels }) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 2, sampleCount: 32000, channels,
    }] } })), { filePath: first!, channels: [channel('L'), channel('R')] });
    const lane = (index: number) => page.locator(`.track-row .track-channel-lane[data-channel-index="${index}"]`);
    // The track view: a lane per channel, each named.
    await expect(lane(1)).toBeVisible();
    await expect(page.locator('.track-row .track-channel-lane-header').first()).toBeVisible();
    await page.locator('[data-action="content-stage"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-input');
    // Side by side, the step's picture is a lane a recording of the comparison's Figure, not the tracks' rows.
    await answer(page, { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] });
    await page.locator('[data-action="stage-layout"]').click();
    await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'lanes');
    await expect(page.locator('#stacked-wrap')).toBeHidden();
    // One lane for the recording, with its one line: no second lane for its second channel, and no channel names.
    type Lanes = { waiting: boolean; lanes: Array<{ id: string; lines: unknown[] }> };
    const drawn = (): Promise<Lanes> => page.locator('[data-stage-figure] canvas[data-figure]').evaluate(canvas => (canvas as HTMLCanvasElement & { __figureInspect: () => Lanes }).__figureInspect());
    await expect.poll(async () => { const now = await drawn(); return !now.waiting && now.lanes.map(item => `${item.id.split('-')[0]}:${item.lines.length}`).join(); }).toBe('own:1');
    await expect(lane(1)).toBeHidden();
    await expect(page.locator('.track-row .track-channel-lane-header').first()).toBeHidden();
    await page.locator('[data-action="content-waveform"]').click();
    await expect(lane(1)).toBeVisible();
});

// The level references wandas reports for a scanned channel.
const FS_INPUT = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true };
const RAW_INPUT = { unit: '', ref: 1, levelReferenceLabel: 'dB re 1 input unit', calibrationStatus: 'uncalibrated', fullScale: false };
const SPL_INPUT = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true };
for (const [source, tableInput, stepInput, standalone, axis, badge, other] of [
    ['WAV', FS_INPUT, FS_INPUT, false, 'Level, uncalibrated [dBFS]', 'FS', 'Level, uncalibrated [dB re 1 input unit]'],
    ['CSV', RAW_INPUT, RAW_INPUT, false, 'Level, uncalibrated [dB re 1 input unit]', 'RAW', 'Level, uncalibrated [dBFS]'],
    // Opened on its own (or before the folder's rescan): the entry table has no result for it, so its step's scan says.
    ['CSV opened on its own', RAW_INPUT, RAW_INPUT, true, 'Level, uncalibrated [dB re 1 input unit]', 'RAW', 'Level, uncalibrated [dBFS]'],
    // Calibrated on the drawn channel only: the whole file reads uncalibrated in the table, the drawn channel's step scan in Pa.
    ['WAV calibrated on the drawn channel only', FS_INPUT, SPL_INPUT, false, 'Level [dB SPL re 20 µPa]', 'FS', 'Level, uncalibrated [dBFS]'],
] as const) {
    const fullScale = tableInput.fullScale;
    test(`a ${source} track names its level axis by wandas' reference for the channel drawn, and its badge by whether its source has a full scale`, async ({ page }) => {
        test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
        const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
        const view = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };
        // The fixture's scans as the backend reports each source: the table's whole-file scans, and the drawn step's scans.
        const withInput = (reference: Record<string, unknown>) => scanned!.map(file => {
            const input = file.result['input'] as Record<string, unknown> | undefined;
            return { filePath: file.filePath, result: { ...file.result, ...(input ? { input: { ...input, ...reference } } : {}) } };
        });
        const files = withInput(tableInput);
        const steps = withInput(stepInput);
        // Standalone: the table holds the folder's audio scans; the CSV track is none of its rows.
        await openEntry(page, standalone ? scanned! : files, { recipe });
        const lone = { filePath: '/elsewhere/vibration.csv', result: steps[0].result };
        // The level axis is canvas text: every string the page draws from here on is kept.
        await page.evaluate(() => {
            const drawn: string[] = [];
            (window as unknown as { __drawnTexts: string[] }).__drawnTexts = drawn;
            const proto = CanvasRenderingContext2D.prototype;
            proto.fillText = new Proxy(Reflect.get(proto, 'fillText'), {
                apply(target, self, args: Parameters<CanvasRenderingContext2D['fillText']>) {
                    drawn.push(String(args[0]));
                    return Reflect.apply(target, self, args);
                },
            });
        });
        const row = (await page.locator('[data-entry-rows] tr').first().getAttribute('data-file-path'))!;
        await page.keyboard.press('1');
        await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; filePaths?: string[] }> }).__uiSmokePostedMessages))
            .filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths).toEqual([row]);
        const first = standalone ? lone.filePath : row;
        await page.keyboard.press('Escape');
        await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
        await page.evaluate(({ filePath, fullScale }) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
            filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
            channels: [{ label: 'L', peakAbsolute: 0.5, fullScale, clipped: fullScale ? false : null, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
        }] } })), { filePath: first, fullScale });
        await expect(page.locator('.track-row')).toHaveCount(1);
        await expect(page.locator('.track-row .calibration-badge')).toHaveText(badge);
        await page.locator('[data-action="content-stage"]').click();
        await page.locator('.track-stage-bar [data-step-hold="node-2"]').click();
        await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-2');
        await page.evaluate(() => { (window as unknown as { __drawnTexts: string[] }).__drawnTexts.length = 0; });
        const request = (await stageScans(page)).at(-1)!;
        await page.evaluate(({ request, view, files }) => {
            for (const filePath of request.filePaths) {
                const file = files.find(item => item.filePath === filePath)!;
                window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: view } }, '*');
            }
            window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
        }, { request, view, files: standalone ? [lone] : steps });
        await expect(page.locator('.track-stage')).toHaveAttribute('data-pending', /^(|1\/\d+)$/);
        // A gutter too short for the whole title keeps its quantity and its unit: on two lines, or the quantity shortened (fitAxisTitle).
        const drawnAxis = (title: string) => async (): Promise<boolean> => {
            const texts = await page.evaluate(() => (window as unknown as { __drawnTexts: string[] }).__drawnTexts);
            const [, quantity, unit] = /^(.*\S)\s*\[([^\]]+)\]$/u.exec(title)!;
            const ofQuantity = (text: string): boolean => text.startsWith(quantity) || (text.length > 1 && /…( \[[^\]]+\])?$/u.test(text) && quantity.startsWith(text.replace(/…( \[[^\]]+\])?$/u, '')));
            return texts.includes(title) || texts.some(text => text.endsWith(` [${unit}]`) && ofQuantity(text)) || (texts.includes(`[${unit}]`) && texts.some(ofQuantity));
        };
        await expect.poll(drawnAxis(axis)).toBe(true);
        expect(await drawnAxis(other)()).toBe(false);
    });
}

test('a step that cannot run on these recordings says why: ＋ greys a 48 kHz-only step out, and a step failing on a file is marked with wandas\' reason on the plot', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe });
    // The plot's message is canvas text: every string drawn from here on is kept.
    await page.evaluate(() => {
        const drawn: string[] = [];
        (window as unknown as { __drawnTexts: string[] }).__drawnTexts = drawn;
        const proto = CanvasRenderingContext2D.prototype;
        proto.fillText = new Proxy(Reflect.get(proto, 'fillText'), {
            apply(target, self, args: Parameters<CanvasRenderingContext2D['fillText']>) {
                drawn.push(String(args[0]));
                return Reflect.apply(target, self, args);
            },
        });
    });
    const first = await page.locator('[data-entry-rows] tr').first().getAttribute('data-file-path');
    await page.keyboard.press('1');
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; filePaths?: string[] }> }).__uiSmokePostedMessages))
        .filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths).toEqual([first]);
    await page.keyboard.press('Escape');
    await page.evaluate(filePath => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    }] } })), first!);
    await page.locator('[data-action="content-stage"]').click();
    const bar = page.locator('.track-stage-bar');
    // ＋ after the average spectrum: noct_synthesis runs on 48 kHz recordings only, and these are 16 kHz.
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-input');
    const chips = await bar.locator('.step-chip').count();
    expect(chips).toBeGreaterThan(2);
    await bar.locator('[data-after="node-2"]').first().click();
    const synthesis = bar.locator('[data-op="wandas.spectral.noct_synthesis"]');
    await expect(synthesis).toHaveClass(/is-off/);
    await expect(synthesis.locator('.step-menu-hint')).toContainText('48 kHz');
    await expect(synthesis.locator('.step-menu-hint')).toContainText('16 kHz');
    // Pressed anyway, it is not added (the footer says why).
    await synthesis.click({ force: true });
    await expect(bar.locator('.step-chip')).toHaveCount(chips);
    await expect(bar.locator('[data-step-id], [data-step-hold]').filter({ hasText: 'noct_synthesis' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The spectrum fails on the file: its chip is marked, and the plot says wandas' reason rather than nothing.
    await bar.locator('[data-step-hold="node-2"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-2');
    const request = (await stageScans(page)).at(-1)!;
    await page.evaluate(request => {
        for (const filePath of request.filePaths) {
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ok: false, reason: 'boom on this file', failedStep: 'node-2' } }, '*');
        }
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, request);
    await expect(bar.locator('.step-chip.is-invalid')).toHaveCount(1);
    // Marked in the failure's orange (R5), the one colour no role, difference or recording has.
    await expect(bar.locator('.step-chip.is-invalid')).toHaveCSS('border-top-color', rgb(FLAG_COLOR));
    // The comparison draws nothing on the tracks' rows: its notice says wandas' reason.
    await expect(page.locator('.track-stage [data-stage-message]')).toContainText('boom on this file');
    if (process.env.AWA_SHOT_DIR) await page.locator('.track-stage').screenshot({ path: path.join(process.env.AWA_SHOT_DIR, 'message.png') });
});

test('a two-input recipe file opened from the Export menu becomes the step bar\'s chain, its cross-channel step paired with the base', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const read = (name: string) => readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', name), 'utf8');
    await openEntry(page, scanned!, { recipe: JSON.parse(read('entry-scan.recipe.json')) });
    const first = await page.locator('[data-entry-rows] tr').first().getAttribute('data-file-path');
    await page.keyboard.press('1');
    await page.keyboard.press('Escape');
    await page.evaluate(filePath => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: [{
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, fullScale: true, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    }] } })), first!);
    await expect(page.locator('.track-row')).toHaveCount(1);
    const open = async (name: string, text: string) => {
        await page.locator('#toolbar #tb-export-menu summary').click();
        const chooser = page.waitForEvent('filechooser');
        await page.locator('#toolbar [data-action="open-recipe"]').click();
        await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    };
    // Three inputs cannot be one chain on each recording: it says so and opens nothing.
    const coherence = JSON.parse(read('coherence.recipe.json'));
    await open('three.recipe.json', JSON.stringify({ ...coherence, inputs: [...coherence.inputs, { id: 'input-2', name: 'more', kind: 'frame' }] }));
    await expect(page.locator('#task-status')).toHaveAttribute('data-state', 'failed');
    await expect(page.locator('#task-status')).toContainText('three.recipe.json');
    await expect(page.locator('.track-stage-bar')).toBeHidden();
    // Coherence: the reference's and the response's channel joined become one channel paired with the base slot.
    await open('coherence.recipe.json', read('coherence.recipe.json'));
    await expect(page.locator('#task-status')).toHaveAttribute('data-state', 'done');
    const bar = page.locator('.track-stage-bar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.step-chip').filter({ hasText: /coherence/i })).toHaveCount(1);
    await expect(bar.locator('.step-chip').filter({ hasText: /concat/i })).toHaveCount(0);
    // The chain opens on its end: the coherence against the base.
    await expect(bar.locator('.step-chip.is-current')).toContainText(/coherence/i);
    // Opening it was one edit: ↶ brings back the chain that was there.
    await bar.locator('[data-action="step-undo"]').click();
    await expect(bar.locator('.step-chip').filter({ hasText: /coherence/i })).toHaveCount(0);
    await expect(bar.locator('.step-chip').filter({ hasText: /average spectrum/i })).toHaveCount(1);
});
