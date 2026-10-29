import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NO_ROLE_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';
import { getStrings } from '../../shared/i18n/strings';
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
    // A selection on the tracks: it becomes the comparison's region; taken off there (↶), it stands aside while the
    // comparison (over the whole files) plays, and is there again after.
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'comparison-panel-test-action', actions: [{ action: 'set-loop-region', payload: { start: .25, end: .75 } }],
    } })));
    await expect(page.locator('#loop-time-display')).toHaveText('0:00.50 – 0:01.50');
    await page.locator('[data-action="content-stage"]').click();
    await expect(page.locator('.track-stage')).toBeVisible();
    await expect(page.locator('.track-stage')).toHaveAttribute('data-region', '0.50–1.50');
    await page.locator('.track-stage-bar [data-action="step-undo"]').click();
    await expect(page.locator('.track-stage')).toHaveAttribute('data-region', 'all');
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
    // It keeps the focus through its ■: Space again stops it.
    await page.keyboard.press(' ');
    await expect(other).toHaveText('▶');
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


test('a selection on the tracks becomes the comparison\'s region as it opens, once: ↶ takes it back, and the unanalysed base says it has no line over it', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    await comparedTrack(page);
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'comparison-panel-test-action', actions: [{ action: 'set-loop-region', payload: { start: .25, end: .75 } }],
    } })));
    await page.locator('[data-action="content-stage"]').click();
    const root = page.locator('.track-stage');
    const bar = page.locator('.track-stage-bar');
    await expect(root).toHaveAttribute('data-region', '0.50–1.50');
    await expect(bar.locator('.step-chip', { hasText: STR.stepRegion })).toHaveText(`${STR.stepRegion} 0.50–1.50 s`);
    await answer(page);
    await expect(page.locator('[data-stage-headline]')).toContainText(`${STR.stepRegion} 0.50–1.50 s`);
    // The base group (too many to analyse unasked) has no line over a region: the table's values are of whole files.
    const baseEntry = page.locator('[data-stage-legend] .compare-legend-item').first().locator('.compare-legend-label');
    await expect(baseEntry).toContainText(STR.stageBaseNoLine);
    await expect(page.locator('[data-action="stage-base-scan"]')).toContainText('with the same steps');
    // ↶ takes the region back: the whole files, and the table's values stand in for the base again.
    await bar.locator('[data-action="step-undo"]').click();
    await expect(root).toHaveAttribute('data-region', 'all');
    await answer(page);
    await expect(baseEntry).toContainText(STR.stageBaseTableNote);
    // A region already set is not replaced by the tracks' selection on opening again.
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'comparison-panel-test-action', actions: [{ action: 'set-loop-region', payload: { start: .5, end: 1 } }],
    } })));
    await page.locator('[data-action="content-stage"]').click();
    await expect(root).toHaveAttribute('data-region', '1.00–2.00');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'comparison-panel-test-action', actions: [{ action: 'set-loop-region', payload: { start: .25, end: .5 } }],
    } })));
    await page.locator('[data-action="content-stage"]').click();
    await expect(root).toHaveAttribute('data-region', '1.00–2.00');
});

test('the selection is read in the compared recording\'s own time, whatever its offset on the timeline', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await comparedTrack(page);
    // The second track compared instead, moved 1 s along the timeline (0–3 s in all).
    const second = page.locator('.track-header details.role-chip').nth(1);
    await second.locator('summary').click();
    await second.locator('[data-action="track-role-set"][data-slot="1"]').click();
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'comparison-panel-test-action', actions: [
            { action: 'set-track-offset', trackIndex: 1, payload: { offsetSeconds: 1 } },
            { action: 'set-loop-region', payload: { start: .25, end: .75 } },
        ],
    } })));
    await page.locator('[data-action="content-stage"]').click();
    // 0.75–2.25 s on the timeline is 0.00–1.25 s of the recording that starts at 1 s.
    await expect(page.locator('.track-stage')).toHaveAttribute('data-region', '0.00–1.25');
});

test('a selection the compared recording does not reach is read in the next recording it does reach', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    await comparedTrack(page);
    // The second track compared instead, moved 3 s along the timeline (0–5 s in all): the selection ends before it starts.
    const second = page.locator('.track-header details.role-chip').nth(1);
    await second.locator('summary').click();
    await second.locator('[data-action="track-role-set"][data-slot="1"]').click();
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'comparison-panel-test-action', actions: [
            { action: 'set-track-offset', trackIndex: 1, payload: { offsetSeconds: 3 } },
            { action: 'set-loop-region', payload: { start: .1, end: .3 } },
        ],
    } })));
    await page.locator('[data-action="content-stage"]').click();
    // 0.5–1.5 s on the timeline: only the first recording, at 0 s, has it.
    await expect(page.locator('.track-stage')).toHaveAttribute('data-region', '0.50–1.50');
});

test('in Compare, colour is the role\'s: a recording without one is grey, its name in the legend; the headline names the difference', async ({ page }) => {
    test.skip(!scanned, 'no Python backend with wandas for the entry100 fixture');
    const STR = getStrings('en');
    const compared = await comparedTrack(page);
    await page.locator('[data-action="content-stage"]').click();
    await answer(page);
    const legend = page.locator('[data-stage-legend]');
    const stroke = (item: ReturnType<Page['locator']>) => item.locator('svg line').getAttribute('stroke');
    const items = legend.locator('.compare-legend-item');
    const comparedItem = items.filter({ has: page.locator(`[data-action="compare-play"][data-path="${compared}"]`) });
    const other = items.filter({ has: page.locator(`[data-action="compare-play"]:not([data-path="${compared}"])`) });
    expect(await stroke(items.first())).toBe(ROLE_COLORS[0]);
    expect(await stroke(comparedItem)).toBe(ROLE_COLORS[1]);
    expect(await stroke(other)).toBe(NO_ROLE_COLOR);
    await expect(other.locator('.compare-legend-label')).not.toBeEmpty();
    await expect(page.locator('[data-stage-headline]')).toContainText(STR.stageCompareMinusBase.replace('{n}', '1'));
});
