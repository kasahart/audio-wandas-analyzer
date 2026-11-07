import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page } from './canvasAudit';
import { buildUiSmokeHtml } from './buildHtml';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';

/**
 * R13: every plot is the one plot component, so every plot answers the same gestures the same way. This test opens
 * the screens with plots, collects each canvas the component drew (`data-plot`) and gives it the same checks.
 * A plot that does not pass one yet is listed in KNOWN_GAPS with the deviation of the unified plot spec it waits
 * for; a gap that is fixed fails here until it is taken off, so the list only shrinks.
 */
type Check = 'readout' | 'zoom' | 'reset' | 'axis range' | 'axes';
const KNOWN_GAPS: Record<string, readonly Check[]> = {
    // 3: the cursor spectrum zooms with its own events, not the plot component's.
    'cursor spectrum': ['zoom', 'reset'],
    // 12: the Δ pane's readout is in the row over the overlaid plot, not in its own headline row just above it.
    'comparison Δ': ['readout'],
};

const FULL = '0.000 1.000 0.000 1.000';
let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

type Posted = { type: string; requestId: string; filePaths: string[]; stage?: string };
const stageScans = async (page: Page): Promise<Posted[]> => (await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages))
    .filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage'));
const spectrum = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };

async function answer(page: Page, files: ScannedFile[]): Promise<void> {
    const request = (await stageScans(page)).at(-1)!;
    await page.evaluate(({ request, view, files }) => {
        request.filePaths.forEach((filePath, index) => {
            const file = files.find(item => item.filePath === filePath)!;
            window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: { ...view, values: view.values.map(value => value + (index === 0 ? 6 : 0)) } } }, '*');
        });
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, view: spectrum, files });
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
    // A hover shows its readout in the row just above the plot, and the plot does not move.
    await page.mouse.move(middle.x, middle.y);
    await page.waitForTimeout(80);
    const above = await page.evaluate(top => Array.from(document.querySelectorAll<HTMLElement>('[id*="readout"], [class*="readout"]'))
        .filter(element => element.textContent?.trim() && element.checkVisibility({ visibilityProperty: true }))
        .some(element => { const at = element.getBoundingClientRect(); return at.bottom <= top + 1 && top - at.bottom < 60; }), box.y);
    if (above && Math.abs((await plot.boundingBox())!.y - box.y) < 0.5) passed.add('readout');
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
    // A double-click on the level axis opens its range.
    await page.mouse.dblclick(box.x + 8, middle.y);
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

test('the cursor spectrum answers the same gestures as every plot (R13)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const plot = page.locator('#spectrum-overlay-canvas');
    await expect.poll(() => plot.evaluate(canvas => (canvas as HTMLCanvasElement).dataset.plotAxes ?? '')).not.toBe('');
    await expectContract(page, 'cursor spectrum', plot);
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
