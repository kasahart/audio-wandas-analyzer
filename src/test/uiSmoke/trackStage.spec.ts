import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
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
        channels: [{ label: 'L', peakAbsolute: 0.5, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    }] } })), first!);
    await expect(page.locator('.track-row')).toHaveCount(1);
    // Steps: the step bar over the tracks, on the 1/3-octave bands the table reads, asked of the track's file and its base (its condition).
    await page.locator('[data-action="content-stage"]').click();
    const bar = page.locator('.track-stage-bar');
    const stage = page.locator('.track-stage');
    await expect(bar).toBeVisible();
    await expect(page.locator('#ruler-row')).toBeHidden();
    await expect.poll(async () => (await stageScans(page)).length).toBeGreaterThan(0);
    const asked = (await stageScans(page)).at(-1)!;
    expect(asked.stage).toBe('node-noct');
    expect(asked.filePaths).toEqual([first]);
    const view = { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] };
    await answer(page, view);
    // The base (ungrouped: the folder's other recordings) is too large to scan unasked; asked, it is.
    await page.locator('[data-action="stage-base-scan"]').click();
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBeGreaterThan(1);
    await answer(page, view);
    // Overlaid by default: the base group's median and the slotted track on one plot, the lanes out of the way.
    await expect(stage).toHaveAttribute('data-layout', 'overlay');
    await expect(bar).toHaveAttribute('data-drawn', '2');
    await expect(page.locator('#stacked-wrap')).toBeHidden();
    await expect(page.locator('[data-stage-legend] .compare-legend-item')).toHaveCount(2);
    // The track takes its role's colour: slot 1, yellow.
    await expect(page.locator('.track-header .role-chip-face').first()).toHaveAttribute('style', /background:\s*#d4b20f/);
    await expect(page.locator('.track-header .role-chip-face').first()).toHaveText(/^1( ch\d)?$/);
    // Δ on request, under the overlay.
    await page.locator('[data-action="stage-diff"]').click();
    await expect(page.locator('[data-stage-diff]')).toBeVisible();
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
    const zoomed = { ...view, xs: [400, 500, 600, 700], values: [-35, -31, -33, -36] };
    await answer(page, zoomed);
    await expect.poll(async () => (await stageScans(page)).at(-1)!.filePaths.length).toBeGreaterThan(1);
    expect((await stageScans(page)).at(-1)!.detail).toBeDefined();
    await expect(bar).toHaveAttribute('data-detail-lines', '1');
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
