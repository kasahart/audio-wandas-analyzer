import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';

function dispatchAnalysisUpdate(paths: string[]): void {
    const results = paths.map((filePath, index) => ({
        filePath,
        fileName: filePath.split('/').at(-1) ?? filePath,
        audioSource: (window as unknown as { __retentionAudioSource?: string }).__retentionAudioSource ?? '',
        sampleRateHz: 8000,
        durationSeconds: 2,
        channelCount: 1,
        sampleCount: 16000,
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
