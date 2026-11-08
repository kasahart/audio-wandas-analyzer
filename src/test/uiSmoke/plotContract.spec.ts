import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from './canvasAudit';
import { buildExtensionHostPathUiSmokeHtml, buildUiSmokeHtml } from './buildHtml';
import { getStrings } from '../../shared/i18n/strings';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';

/**
 * R13: every plot is the one plot component, so every plot answers the same gestures the same way. This test opens
 * the screens with plots, collects each canvas the component drew (`data-plot`) and gives it the same checks.
 * A plot that does not pass one yet is listed in KNOWN_GAPS with the deviation of the unified plot spec it waits
 * for; a gap that is fixed fails here until it is taken off, so the list only shrinks.
 */
type Check = 'readout' | 'zoom' | 'reset' | 'axis range' | 'axes';
const KNOWN_GAPS: Record<string, readonly Check[]> = {};

const FULL = '0.000 1.000 0.000 1.000';
let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

type Posted = { type: string; requestId: string; filePaths: string[]; stage?: string; recipe?: { nodes: Array<{ operation: string }> } };
const stageScans = async (page: Page): Promise<Posted[]> => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages))
    .filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage'));
const spectrum = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };

async function answer(page: Page, files: ScannedFile[], view: Record<string, unknown> = spectrum): Promise<void> {
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

/** Slots two recordings as base and compare 1 and opens the comparison on the chain's end, its plots drawn. */
async function openComparison(page: Page, files: ScannedFile[]): Promise<void> {
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, files, { language: 'en', recipe });
    const drawn = await page.locator('[data-entry-rows] tr.entry-row').evaluateAll(rows => rows.map(row => row.getAttribute('data-file-path')!));
    const rpm = (filePath: string): string => /_(\d+rpm)_/.exec(filePath)?.[1] ?? '';
    const other = drawn.findIndex(filePath => rpm(filePath) !== rpm(drawn[0]));
    const paths = [drawn[0], drawn[other]];
    await page.keyboard.press('0');
    for (let step = 0; step < other; step++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('1');
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

/** The checks a plot passes, each tried on its own; a failure is noted, not thrown, so every check is tried. */
async function contract(page: Page, plot: Locator): Promise<Set<Check>> {
    const passed = new Set<Check>();
    const box = (await plot.boundingBox())!;
    const middle = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.45 };
    // Both axes are named.
    const axes = (await plot.getAttribute('data-plot-axes')) ?? '';
    if (axes.split('|').length === 2 && axes.split('|').every(name => name.trim())) passed.add('axes');
    // A hover shows its readout in the row just above the plot, and the plot does not move: a readout there shows
    // text it did not show before the pointer came (not one left from an earlier hover).
    const readouts = (top: number): Promise<string[]> => page.evaluate(top => Array.from(document.querySelectorAll<HTMLElement>('[id*="readout"], [class*="readout"]'))
        .filter(element => { const at = element.getBoundingClientRect(); return at.bottom <= top + 1 && top - at.bottom < 60; })
        .map(element => (element.checkVisibility({ visibilityProperty: true }) ? element.textContent?.trim() ?? '' : '')), top);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(80);
    // Plots stacked on one shared axis (data-plot-stack) share the one readout row above the stack.
    const rowTop = await plot.evaluate(canvas => (canvas.closest('[data-plot-stack]') ?? canvas).getBoundingClientRect().top);
    const before = await readouts(rowTop);
    await page.mouse.move(middle.x, middle.y);
    await page.waitForTimeout(80);
    const after = await readouts(rowTop);
    const above = after.some((text, index) => text && text !== before[index]);
    // The pointer's marks are seen: a marks layer shown over the plot is the topmost thing there, not under a screen.
    const buried = await page.evaluate(({ x, y }) => Array.from(document.querySelectorAll<HTMLElement>('.plot-hover-layer:not([hidden])')).some(layer => {
        layer.style.pointerEvents = 'auto';
        try { const stack = document.elementsFromPoint(x, y); return stack.includes(layer) && stack[0] !== layer; } finally { layer.style.pointerEvents = ''; }
    }), middle);
    if (above && !buried && Math.abs((await plot.boundingBox())!.y - box.y) < 0.5) passed.add('readout');
    // Ctrl+wheel zooms; a double-click resets.
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await page.waitForTimeout(80);
    const zoomed = await plot.getAttribute('data-plot-window');
    if (zoomed && zoomed !== FULL) passed.add('zoom');
    await page.mouse.dblclick(middle.x, middle.y);
    await page.waitForTimeout(80);
    if (zoomed && (await plot.getAttribute('data-plot-window')) === FULL) passed.add('reset');
    // A double-click on the level axis opens its range: the plot's own left margin, or the canvas beside it that
    // holds its value axis (data-plot-axis).
    const axisId = await plot.getAttribute('data-plot-axis');
    const axisBox = axisId ? await page.locator(`[id="${axisId}"]`).boundingBox() : null;
    await page.mouse.dblclick(axisBox ? axisBox.x + axisBox.width / 2 : box.x + 8, axisBox ? axisBox.y + axisBox.height / 2 : middle.y);
    const popover = page.locator('[id$="range-popover"]:visible');
    if (await popover.count()) passed.add('axis range');
    await page.keyboard.press('Escape');
    await page.mouse.move(1, 1);
    return passed;
}

async function expectContract(page: Page, name: string, plot: Locator): Promise<void> {
    await expect(plot).toHaveAttribute('data-plot', '');
    const passed = await contract(page, plot);
    const gaps = KNOWN_GAPS[name] ?? [];
    const checks: Check[] = ['readout', 'zoom', 'reset', 'axis range', 'axes'];
    expect.soft(checks.filter(check => !passed.has(check) && !gaps.includes(check)), `${name}: fails the plot contract (R13)`).toEqual([]);
    expect.soft(gaps.filter(check => passed.has(check)), `${name}: now passes; take it off KNOWN_GAPS`).toEqual([]);
}

test('every plot the comparison shows answers the same gestures: readout above it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openComparison(page, scanned!);
    await expectContract(page, 'comparison overlay', page.locator('[data-stage-canvas="overlay"]'));
    // Δ under it, then one lane per track.
    await page.locator('[data-action="stage-diff"]').click();
    await expect(page.locator('[data-stage-diff]')).toBeVisible();
    await expectContract(page, 'comparison Δ', page.locator('[data-stage-canvas="diff"]'));
    await page.locator('[data-action="stage-diff"]').click();
    await page.locator('[data-action="stage-layout"]').click();
    await expect(page.locator('.track-stage')).toHaveAttribute('data-layout', 'lanes');
    const lane = page.locator('.track-canvas[data-plot]').first();
    await expect(lane).toBeVisible();
    await expectContract(page, 'comparison lane', lane);
});

test('a trigger\'s events plot and the lanes under it answer the same gestures as every plot (R13)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await page.setViewportSize({ width: 1280, height: 1100 });
    await openComparison(page, scanned!);
    const bar = page.locator('.track-stage-bar');
    await bar.locator('.step-chip', { hasText: STR.stepAverage }).locator('[data-action="step-delete"]').click();
    await bar.locator('[data-action="step-add"]').click();
    await bar.locator('[data-step-menu-filter]').fill('trigger');
    await bar.locator('.step-menu-item[data-op="wandas.audio.trigger"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)?.recipe?.nodes.at(-1)?.operation.split('.').pop()).toBe('trigger');
    const event = (id: number, peak: number): Record<string, unknown> => ({ id, time: 0.3 + id * 0.5, values: [0, peak, -peak / 2, 0] });
    await answer(page, scanned!, { frame: 'ChannelFrameSegments', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [-0.01, 0, 0.05, 0.19], events: [event(0, 0.5), event(1, 0.4)] });
    await expect.poll(async () => (await stageScans(page)).at(-1)?.stage).toBe('node-1');
    await answer(page, scanned!, { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [0, 0.75, 1.5], values: [-0.5, 0.5, -0.5],
        waveform: { min: [-0.5, -0.4, -0.3], max: [0.5, 0.4, 0.3], minT: [0.2, 0.7, 1.1], maxT: [0.3, 0.8, 1.2], absolutePeak: 0.5, unit: 'FS', ref: 1 } });
    await expect.poll(async () => Number(await page.locator('.track-stage').getAttribute('data-lanes-marked'))).toBeGreaterThan(0);
    await expectContract(page, 'trigger events', page.locator('[data-stage-canvas="overlay"]'));
    await expectContract(page, 'trigger lane', page.locator('.track-canvas[data-plot]').first());
});

test('the entry\'s held plot answers the same gestures as every plot (R13)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEntry(page, scanned!, { language: 'en' });
    // A row in slot 1, then its key held: its Δ is drawn on the side while the key is down.
    await page.keyboard.press('1');
    await page.keyboard.down('1');
    const plot = page.locator('[data-entry-held-canvas]');
    await expect(plot).toBeVisible();
    await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe('');
    await expectContract(page, 'entry held', plot);
    await page.keyboard.up('1');
});

test('the entry\'s overview strip answers the same gestures as every plot (R13)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEntry(page, scanned!, { language: 'en' });
    const plot = page.locator('[data-entry-overview]');
    await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe('');
    await expectContract(page, 'entry overview', plot);
});

test('the entry\'s distribution answers the same gestures as every plot: each group\'s row, on the value axis below them (R13)', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await page.setViewportSize({ width: 1280, height: 900 });
    await openEntry(page, scanned!, { language: 'en' });
    const plot = page.locator('[data-dist-canvas]').first();
    await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe(null);
    await expectContract(page, 'entry distribution', plot);
});

test('the cursor spectrum answers the same gestures as every plot (R13)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const plot = page.locator('#spectrum-overlay-canvas');
    await expect.poll(() => plot.evaluate(canvas => (canvas as HTMLCanvasElement).dataset.plotAxes ?? '')).not.toBe('');
    await expectContract(page, 'cursor spectrum', plot);
});

test('the pair view\'s gain, phase and γ² plots answer the same gestures as every plot (R13)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await page.locator('[data-action="set-pair-reference"]').first().click();
    await expect(page.locator('[data-pair-lane][data-plot]')).toHaveCount(3);
    for (const lane of ['gain', 'phase', 'coherence']) {
        const plot = page.locator(`[data-pair-lane="${lane}"]`);
        await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe('');
        await expectContract(page, `pair ${lane}`, plot);
    }
});

test('the track view\'s waveform and spectrogram lanes answer the same gestures as every plot: readout in the toolbar above them (R13)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    for (const [name, selector] of [['track waveform', '.track-canvas:not(.track-spec-canvas)'], ['track spectrogram', '.track-spec-canvas']] as const) {
        const plot = page.locator(`${selector}[data-plot]`).first();
        await expect(plot).toBeVisible();
        await expect.poll(() => plot.getAttribute('data-plot-axes')).not.toBe(null);
        await expectContract(page, name, plot);
    }
});

test('every ui-smoke test fails on a plot on screen that the plot component did not draw, unless plotRegistry.ts lists it (R13)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    // A canvas drawn some other way, left on screen: the audit names it once it has had time to be drawn.
    await page.evaluate(() => {
        const stray = document.createElement('canvas');
        stray.className = 'stray-plot';
        Object.assign(stray.style, { position: 'fixed', left: '0', top: '0', width: '120px', height: '60px' });
        document.body.append(stray);
    });
    await expect.poll(() => page.evaluate(() => window.__plotAudit ?? [])).toContain('canvas.stray-plot');
    // Taken away, with the audit's record cleared, so this test itself passes the audit.
    await page.evaluate(() => { document.querySelector('.stray-plot')?.remove(); window.__plotAudit?.splice(0); });
});
