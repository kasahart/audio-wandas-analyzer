import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';

function dispatchAnalysisUpdate(input: string[] | { paths: string[]; durations: number[] }): void {
    const paths = Array.isArray(input) ? input : input.paths;
    const results = paths.map((filePath, index) => ({
        filePath,
        fileName: filePath.split('/').at(-1) ?? filePath,
        audioSource: (window as unknown as { __retentionAudioSource?: string }).__retentionAudioSource ?? '',
        sampleRateHz: 8000,
        durationSeconds: Array.isArray(input) ? 2 : input.durations[index],
        channelCount: 1,
        sampleCount: (Array.isArray(input) ? 2 : input.durations[index]) * 8000,
        channels: [{
            label: 'L',
            peakAbsolute: 0.8 + index * 0.01,
            waveform: {
                min: [-0.2, -0.4],
                max: [0.2, 0.4],
                minT: [0.1, 0.6],
                maxT: [0.4, 0.9],
                absolutePeak: 0.8,
            },
        }],
    }));
    window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'analysis-update', results },
    }));
}

async function trackIdsInDom(page: import('@playwright/test').Page): Promise<string[]> {
    return page.locator('.track-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-track-id') ?? ''));
}

test('track identity survives add, reorder, remove, and analysis replacement', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });

    await page.evaluate(dispatchAnalysisUpdate, ['/preview/demo-tone.wav', '/preview/second.wav']);
    await expect(page.locator('.track-row')).toHaveCount(2);
    await expect.poll(() => trackIdsInDom(page)).toEqual(['track-1', 'track-2']);

    await page.locator('[data-track-id="track-2"].track-drag-handle')
        .dragTo(page.locator('[data-track-id="track-1"].track-row'));
    await expect.poll(() => trackIdsInDom(page)).toEqual(['track-2', 'track-1']);

    await page.locator('[data-action="remove-track"][data-track-id="track-1"]').click();
    await expect.poll(() => trackIdsInDom(page)).toEqual(['track-2']);

    await page.evaluate(dispatchAnalysisUpdate, ['/preview/second.wav', '/preview/third.wav']);
    await expect(page.locator('.track-row')).toHaveCount(2);
    await expect.poll(() => trackIdsInDom(page)).toEqual(['track-2', 'track-3']);
    await expect(page.locator('.track-row[data-track-id="track-2"] .track-name')).toHaveText('second.wav');
    await expect(page.locator('.track-row[data-track-id="track-3"] .track-name')).toHaveText('third.wav');
    await expect(page.locator('[data-track-index]')).toHaveCount(0);
});

test('directory checkbox remove/re-add keeps surviving offset, cursor, mute and document', async ({ page }) => {
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    const audioSource = 'data:audio/wav;base64,' + readFileSync(path.join(__dirname, '../fixtures/short-stereo.wav')).toString('base64');
    await page.evaluate(source => {
        (window as unknown as { __retentionAudioSource: string }).__retentionAudioSource = source;
    }, audioSource);
    const paths = ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'];
    await page.locator('[data-action="selection-select-all"]').click();
    await page.evaluate(dispatchAnalysisUpdate, paths);
    await expect(page.locator('.track-row')).toHaveCount(2);
    const tree = page.locator('#selection-toolbar');
    await tree.evaluate(node => node.setAttribute('data-retention-sentinel', 'same-document'));
    await page.locator('[data-action="offset-up"][data-track-id="track-1"]').click();
    await page.locator('[data-action="toggle-mute"][data-track-id="track-1"]').click();
    const canvas = page.locator('#track-canvas-0');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width * .437, box.y + box.height * .5);
    await page.locator('#toolbar [data-action="zoom-in"]').click();
    const viewState = () => page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'comparison-panel-test-action', actionId: 'retention-snapshot', actions: [],
        } }));
        const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { cursorNorm: number; zoomStart: number; zoomEnd: number } }> }).__uiSmokePostedMessages;
        return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi;
    });
    const configured = await viewState();
    expect(configured.cursorNorm).toBeGreaterThan(.3);
    const directory = page.locator('.selection-tree-directory').first();
    if (await directory.getAttribute('aria-expanded') === 'false') await directory.click();
    const checkbox = page.locator('.selection-file-checkbox[data-file-path="/tmp/session/sub/b.flac"]');
    for (const selected of [false, true]) {
        await checkbox.setChecked(selected);
        await page.evaluate(dispatchAnalysisUpdate, selected ? paths : [paths[0]]);
        await expect(page.locator('.track-row')).toHaveCount(selected ? 2 : 1);
        await expect(tree).toHaveAttribute('data-retention-sentinel', 'same-document');
        await expect(page.locator('#track-row-0')).toHaveAttribute('data-track-id', 'track-1');
        await expect(page.locator('#track-row-0 .track-offset-val')).toContainText('0.010');
        const current = await viewState();
        expect(current.cursorNorm).toBe(configured.cursorNorm);
        expect(current.zoomStart).toBe(configured.zoomStart);
        expect(current.zoomEnd).toBe(configured.zoomEnd);
        await expect(page.locator('#track-row-0 [data-action="toggle-mute"]')).toHaveAttribute('aria-pressed', 'true');
        expect(await page.locator('#track-audio-0').evaluate(node => (node as HTMLAudioElement).muted)).toBe(true);
        expect(await page.locator('audio').evaluateAll(nodes => nodes.every(node => (node as HTMLAudioElement).paused))).toBe(true);
        await expect(checkbox).toBeChecked({ checked: selected });
    }
});


test('span-changing selection refreshes cursor labels while retaining normalized cursor and zoom', async ({ page }) => {
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    const paths = ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'];
    await page.locator('[data-action="selection-select-all"]').click();
    await page.evaluate(dispatchAnalysisUpdate, { paths, durations: [1, 2] });
    const directory = page.locator('.selection-tree-directory').first();
    if (await directory.getAttribute('aria-expanded') === 'false') await directory.click();
    const checkbox = page.locator('.selection-file-checkbox[data-file-path="/tmp/session/sub/b.flac"]');
    const snapshot = () => page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'comparison-panel-test-action', actions: [], actionId: 'span-cursor-snapshot',
        } }));
        const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { cursorNorm: number; zoomStart: number; zoomEnd: number } }> }).__uiSmokePostedMessages;
        return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi;
    });
    for (const mode of ['waveform', 'spectrogram']) {
        await page.evaluate(mode => window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'comparison-panel-test-action', actions: [
                'content-' + mode,
                { action: 'set-cursor', payload: { cursorNorm: .23 } },
                { action: 'set-loop-region', payload: { start: .25, end: .75 } },
            ],
        } })), mode);
        await page.locator('#toolbar [data-action="zoom-in"]').click();
        const before = await snapshot();
        await expect(page.locator('#loop-time-display')).toHaveText('0:00.50 – 0:01.50');
        const longLabel = '0:00.46';
        await expect(page.locator('#cursor-display')).toHaveText(longLabel);
        await expect(page.locator('#spectrum-cursor-time')).toHaveText('@ ' + longLabel);
        await checkbox.setChecked(false);
        await page.evaluate(dispatchAnalysisUpdate, { paths: [paths[0]], durations: [1] });
        await expect(page.locator('.track-row')).toHaveCount(1);
        await expect(page.locator('#loop-time-display')).toHaveText('0:00.25 – 0:00.75');
        const shortLabel = '0:00.23';
        await expect(page.locator('#spectrum-cursor-time')).toHaveText('@ ' + shortLabel);
        await expect(page.locator('#cursor-display')).toHaveText(shortLabel);
        await expect(page.locator('#spectrum-cursor-time')).toHaveText('@ ' + shortLabel);
        expect(await snapshot()).toMatchObject({ cursorNorm: before.cursorNorm, zoomStart: before.zoomStart, zoomEnd: before.zoomEnd });
        await checkbox.setChecked(true);
        await page.evaluate(dispatchAnalysisUpdate, { paths, durations: [1, 2] });
        await expect(page.locator('#loop-time-display')).toHaveText('0:00.50 – 0:01.50');
        await expect(page.locator('#cursor-display')).toHaveText(longLabel);
        await expect(page.locator('#spectrum-cursor-time')).toHaveText('@ ' + longLabel);
        expect(await snapshot()).toMatchObject({ cursorNorm: before.cursorNorm, zoomStart: before.zoomStart, zoomEnd: before.zoomEnd });
        await page.evaluate(dispatchAnalysisUpdate, { paths, durations: [1, 1] });
        await expect(page.locator('#loop-time-display')).toHaveText('0:00.25 – 0:00.75');
        await page.evaluate(dispatchAnalysisUpdate, { paths, durations: [1, 2] });
        await expect(page.locator('#loop-time-display')).toHaveText('0:00.50 – 0:01.50');
    }
});


test('directory re-selection restores a removed track while ordinary refresh keeps it removed', async ({ page }) => {
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    const paths = ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'];
    await page.locator('[data-action="selection-select-all"]').click();
    await page.evaluate(dispatchAnalysisUpdate, paths);
    await page.locator('[data-action="offset-up"][data-track-id="track-2"]').click();
    await page.locator('[data-action="remove-track"][data-track-id="track-1"]').click();
    await page.evaluate(dispatchAnalysisUpdate, paths);
    await expect(page.locator('.track-row')).toHaveCount(1);
    const checkbox = page.locator('.selection-file-checkbox[data-file-path="/tmp/session/a.wav"]');
    await checkbox.setChecked(false);
    await page.evaluate(dispatchAnalysisUpdate, [paths[1]]);
    await checkbox.setChecked(true);
    await page.evaluate(dispatchAnalysisUpdate, paths);
    await expect(page.locator('.track-row')).toHaveCount(2);
    await expect(page.locator('.track-row[data-track-id="track-2"] .track-offset-val')).toContainText('0.010');
    await expect(page.locator('.track-row[data-track-id="track-3"] .track-name')).toHaveText('a.wav');
});

test('recreated directory document restores host selection and audio before the next checkbox action', async ({ page }) => {
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    const paths = ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'];
    await page.locator('[data-action="selection-select-all"]').click();
    await page.evaluate(dispatchAnalysisUpdate, paths);
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    const audioSource = 'data:audio/wav;base64,' + readFileSync(path.join(__dirname, '../fixtures/short-stereo.wav')).toString('base64');
    await page.evaluate(({ paths, audioSource }) => {
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'analysis-update', selectedFilePaths: paths,
            results: paths.map(filePath => ({ filePath, fileName: filePath.split('/').at(-1), audioSource,
                durationSeconds: 1, sampleRateHz: 8000, sampleCount: 8000, channelCount: 0, channels: [] })),
        } }));
    }, { paths, audioSource });
    await expect(page.locator('.track-row')).toHaveCount(2);
    const directory = page.locator('.selection-tree-directory').first();
    if (await directory.getAttribute('aria-expanded') === 'false') await directory.click();
    await expect(page.locator('.selection-file-checkbox')).toHaveCount(2);
    for (const filePath of paths) {
        await expect(page.locator(`.selection-file-checkbox[data-file-path="${filePath}"]`)).toBeChecked();
    }
    expect(await page.locator('audio').evaluateAll(nodes => nodes.every(node => {
        const audio = node as HTMLAudioElement;
        return audio.src.startsWith('data:audio/wav;base64,') && audio.paused;
    }))).toBe(true);
    await page.locator('.selection-file-checkbox[data-file-path="/tmp/session/a.wav"]').setChecked(false);
    const latestSelection = await page.evaluate(() => {
        const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; filePaths: string[] }> }).__uiSmokePostedMessages;
        return messages.filter(message => message.type === 'analyze-selected-files').at(-1)!.filePaths;
    });
    expect(latestSelection).toEqual([paths[1]]);
});
