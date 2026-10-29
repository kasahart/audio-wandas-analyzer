import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { entry100Results, openEntry, type ScannedFile } from './entryHelpers';

let scanned: ScannedFile[] | undefined;
test.beforeAll(() => { scanned = entry100Results(); });

type Posted = { type: string; requestId: string; filePaths: string[] };
const posted = (page: Page): Promise<Posted[]> => page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Posted[] }).__uiSmokePostedMessages);

/** Two of the table's recordings as tracks, the first compared (slot 1), each with an audio element that plays at once. */
async function comparedTrack(page: Page): Promise<string> {
    const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8'));
    await openEntry(page, scanned!, { recipe, docked: true });
    const rows = page.locator('[data-entry-rows] tr.entry-row');
    const paths = [await rows.nth(0).getAttribute('data-file-path'), await rows.nth(2).getAttribute('data-file-path')] as string[];
    await rows.nth(0).locator('[data-action="entry-row-track"]').click();
    await rows.nth(2).locator('[data-action="entry-row-track"]').click();
    await expect.poll(async () => (await posted(page)).filter(message => message.type === 'analyze-selected-files').at(-1)?.filePaths).toEqual(paths);
    await page.evaluate(paths => window.dispatchEvent(new MessageEvent('message', { data: { type: 'analysis-update', results: paths.map(filePath => ({
        filePath, fileName: filePath.split('/').at(-1), audioSource: '', sampleRateHz: 16000, durationSeconds: 2, channelCount: 1, sampleCount: 32000,
        channels: [{ label: 'L', peakAbsolute: 0.5, waveform: { min: [-0.5, -0.4], max: [0.5, 0.4], minT: [0.1, 0.6], maxT: [0.4, 0.9], absolutePeak: 0.5 } }],
    })) } })), paths);
    await expect(page.locator('.track-row')).toHaveCount(2);
    await page.evaluate(() => {
        const host = document.getElementById('audio-host')!;
        for (const i of [0, 1]) {
            if (document.getElementById('track-audio-' + i)) continue;
            const audio = document.createElement('audio');
            audio.id = 'track-audio-' + i;
            let paused = true;
            Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
            audio.play = async () => { paused = false; };
            audio.pause = () => { paused = true; };
            host.appendChild(audio);
        }
    });
    const chip = page.locator(`.track-header details.role-chip[data-file-path="${paths[0]}"]`);
    await chip.locator('summary').click();
    await chip.locator('[data-action="track-role-set"][data-slot="1"]').click();
    return paths[0];
}

/** Answers the steps view's last scan as a host does. */
async function answer(page: Page): Promise<void> {
    const scans = async (): Promise<Posted[]> => (await posted(page)).filter(message => message.type === 'compare-scan' && message.requestId.startsWith('track-stage'));
    await expect.poll(async () => (await scans()).length).toBeGreaterThan(0);
    const request = (await scans()).at(-1)!;
    await page.evaluate(({ request, files }) => {
        for (const filePath of request.filePaths) {
            const file = files.find(item => item.filePath === filePath);
            if (file) window.postMessage({ type: 'compare-scan-result', requestId: request.requestId, filePath, result: { ...file.result, stage: { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: [100, 1000, 5000], values: [-40, -30, -50] } } }, '*');
        }
        window.postMessage({ type: 'compare-scan-done', requestId: request.requestId }, '*');
    }, { request, files: scanned! });
}

test('opened from the tracks, Compare goes back to the tracks on Esc, playback going on; the legend\'s ▶ and Space play the recordings themselves', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const compared = await comparedTrack(page);
    // A selection on the tracks: it stands aside while the comparison (over the whole files) plays, and is there again after.
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'comparison-panel-test-action', actions: [{ action: 'set-loop-region', payload: { start: .25, end: .75 } }],
    } })));
    await expect(page.locator('#loop-time-display')).toHaveText('0:00.50 – 0:01.50');
    await page.locator('[data-action="content-stage"]').click();
    await expect(page.locator('.track-stage')).toBeVisible();
    await answer(page);
    await expect(page.locator('.track-stage')).toHaveAttribute('data-compared', '1');
    // The layout button says what it does.
    await expect(page.locator('[data-action="stage-layout"]')).toHaveText('One lane per track');
    // Each recording has its ▶; the base group, made of many, has none.
    const legend = page.locator('[data-stage-legend]');
    const play = legend.locator(`[data-action="compare-play"][data-path="${compared}"]`);
    await expect(play).toHaveText('▶');
    await expect(legend.locator('.compare-legend-item').first().locator('[data-action="compare-play"]')).toHaveCount(0);
    await play.click();
    await expect(play).toHaveText('■');
    await expect(page.locator('#loop-time-display')).toBeHidden();
    await expect(page.locator('[data-action="toggle-playback"]').first()).toHaveClass(/is-playing/);
    // Space plays (or stops) the recording compared.
    await page.locator('.track-stage canvas').first().click();
    await page.keyboard.press(' ');
    await expect(play).toHaveText('▶');
    await page.keyboard.press(' ');
    await expect(play).toHaveText('■');
    // Space on a focused ▶ presses that ▶: the second recording plays, not the compared one.
    const other = legend.locator(`[data-action="compare-play"]:not([data-path="${compared}"])`);
    await other.focus();
    await page.keyboard.press(' ');
    await expect(other).toHaveText('■');
    await expect(play).toHaveText('▶');
    await play.click();
    await expect(play).toHaveText('■');
    // Esc: back to the tracks, not the entry table, and the recording plays on.
    await page.keyboard.press('Escape');
    await expect(page.locator('.track-stage')).toBeHidden();
    await expect(page.locator('[data-action="content-waveform"]')).toHaveClass(/is-active/);
    await expect(page.locator('#entry-screen')).not.toHaveClass(/is-max/);
    await expect(page.locator('[data-action="toggle-playback"]').first()).toHaveClass(/is-playing/);
    await expect(page.locator('#loop-time-display')).toHaveText('0:00.50 – 0:01.50');
});

