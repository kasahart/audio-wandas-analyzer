import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from './canvasAudit';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';

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
    }, { request, view, files: scanned! });
    return request;
}

test('the track view\'s steps mode draws every track as the chosen step\'s Frame, and its zoom asks for the part on screen', async ({ page }) => {
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
    await answer(page, view);
    await expect(stage).toHaveAttribute('data-pending', '');
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
        for (const canvas of Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas#ruler-canvas, canvas#spectrum-overlay-canvas'))) {
            const own = canvas.getContext.bind(canvas);
            canvas.getContext = ((...args: Parameters<HTMLCanvasElement['getContext']>) => { w.__hiddenPaints.push(canvas.id); return own(...args); }) as HTMLCanvasElement['getContext'];
        }
        window.dispatchEvent(new Event('resize'));
    });
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-stage-canvas="overlay"]') !== null)).toBe(true);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __hiddenPaints: string[] }).__hiddenPaints)).toEqual([]);
    // Δ on request, under the overlay.
    await page.locator('[data-action="stage-diff"]').click();
    await expect(page.locator('[data-stage-diff]')).toBeVisible();
    // The overlay is drawn at the height Δ leaves it, not stretched from the height it had alone: the pointer's
    // marks fall on its lines rather than beside them.
    const drawnAtShownSize = (): Promise<boolean> => page.locator('[data-stage-canvas="overlay"]').evaluate(canvas => {
        const element = canvas as HTMLCanvasElement;
        return element.clientHeight > 0 && Math.abs(element.height - Math.round(element.clientHeight * devicePixelRatio)) <= 1;
    });
    expect(await drawnAtShownSize()).toBe(true);
    // A box dragged on the plot zooms in; once it settles, only the part on screen is asked for.
    const plot = page.locator('[data-stage-canvas="overlay"]');
    const box = (await plot.boundingBox())!;
    await page.mouse.move(box.x + 52 + (box.width - 56) * 0.3, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + 52 + (box.width - 56) * 0.6, box.y + box.height * 0.7, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.detail?.x[0]).toBeGreaterThan(100);
    // The track on screen is asked for first and drawn from its detail at once; the base group's recordings come after it.
    expect((await stageScans(page)).at(-1)!.filePaths).toEqual([first]);
    // As many points as the whole picture, at other frequencies: until the base has its detail too, Δ stays the whole pictures'.
    const zoomed = { ...view, xs: [400, 500, 600], values: [-35, -31, -33] };
    const wholeDelta = await page.locator('[data-stage-diff-headline]').textContent();
    await answer(page, zoomed);
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBeGreaterThan(1);
    expect((await stageScans(page)).at(-1)!.detail).toBeDefined();
    await expect(bar).toHaveAttribute('data-detail-lines', '1');
    await expect(page.locator('[data-stage-diff-headline]')).toHaveText(wholeDelta!);
    await expect(bar).toHaveAttribute('data-detail', 'false');
    await answer(page, zoomed);
    await expect(bar).toHaveAttribute('data-detail', 'true');
    // Side by side: every track in its lane again.
    await page.locator('[data-action="stage-layout"]').click();
    await expect(stage).toHaveAttribute('data-layout', 'lanes');
    await expect(page.locator('#stacked-wrap')).toBeVisible();
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
    await expect(page.locator('#ruler-row')).toBeVisible();
    await expect(page.locator('#stacked-wrap')).toBeVisible();
});

// The level references wandas reports for a scanned channel.
const FS_INPUT = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true };
const RAW_INPUT = { unit: '', ref: 1, levelReferenceLabel: 'dB re 1 input unit', calibrationStatus: 'uncalibrated', fullScale: false };
const SPL_INPUT = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: true };
for (const [source, tableInput, stepInput, standalone, axis, badge, other] of [
    ['WAV', FS_INPUT, FS_INPUT, false, 'Amplitude, uncalibrated [dBFS]', 'FS', 'Amplitude, uncalibrated [dB re 1 input unit]'],
    ['CSV', RAW_INPUT, RAW_INPUT, false, 'Amplitude, uncalibrated [dB re 1 input unit]', 'RAW', 'Amplitude, uncalibrated [dBFS]'],
    // Opened on its own (or before the folder's rescan): the entry table has no result for it, so its step's scan says.
    ['CSV opened on its own', RAW_INPUT, RAW_INPUT, true, 'Amplitude, uncalibrated [dB re 1 input unit]', 'RAW', 'Amplitude, uncalibrated [dBFS]'],
    // Calibrated on the drawn channel only: the whole file reads uncalibrated in the table, the drawn channel's step scan in Pa.
    ['WAV calibrated on the drawn channel only', FS_INPUT, SPL_INPUT, false, 'Amplitude [dB SPL re 20 µPa]', 'FS', 'Amplitude, uncalibrated [dBFS]'],
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
        // A gutter too short for the whole title keeps its unit (fittedAxisTitle).
        const drawnAxis = (title: string) => async (): Promise<boolean> => (await page.evaluate(() => (window as unknown as { __drawnTexts: string[] }).__drawnTexts))
            .some(text => text === title || text === /\[([^\]]+)\]$/.exec(title)![1]);
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
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __drawnTexts: string[] }).__drawnTexts)).join(' ')).toContain('boom on this file');
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
});
