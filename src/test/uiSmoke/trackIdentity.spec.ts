import { expect, settled, test, type Page } from './canvasAudit';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { buildUiSmokeHtml, buildUiSmokeSelectionHtml } from './buildHtml';
import { drawnRow, pointOnLane, rowFigure, ROW_WAVE } from './tracksFigures';


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
            peakAbsolute: 0.8 + index * 0.01, fullScale: true,
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

/** Shows a listed file as a track or takes it off, as the entry table's ＋ and × do (the e2e's test action). */
async function showFiles(page: Page, filePaths: readonly string[], selected: boolean) {
    await page.evaluate(({ filePaths, selected }) => window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'comparison-panel-test-action', actions: filePaths.map(filePath => ({ action: 'set-file-selected', payload: { filePath, selected } })),
    } })), { filePaths, selected });
}

test('directory file remove/re-add keeps surviving offset, cursor and document', async ({ page }) => {
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    const audioSource = 'data:audio/wav;base64,' + readFileSync(path.join(__dirname, '../fixtures/short-stereo.wav')).toString('base64');
    await page.evaluate(source => {
        (window as unknown as { __retentionAudioSource: string }).__retentionAudioSource = source;
    }, audioSource);
    const paths = ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'];
    await showFiles(page, paths, true);
    await page.evaluate(dispatchAnalysisUpdate, paths);
    await expect(page.locator('.track-row')).toHaveCount(2);
    const tree = page.locator('#selection-toolbar');
    await tree.evaluate(node => node.setAttribute('data-retention-sentinel', 'same-document'));
    // The offset's steps are in the track's … menu.
    await page.locator('.track-row[data-track-id="track-1"] details.track-more summary').click();
    await page.locator('[data-action="offset-up"][data-track-id="track-1"]').click();
    await page.locator(rowFigure(0)).scrollIntoViewIfNeeded();
    await drawnRow(page, 0, 0, true);
    const at = await pointOnLane(page, rowFigure(0), ROW_WAVE, .437);
    await page.mouse.click(at.x, at.y);
    // The click moves the cursor at once (plotInteraction.ts, R13), then the zoom is about it.
    await settled(page);
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
    const checkbox = { setChecked: (selected: boolean) => showFiles(page, ['/tmp/session/sub/b.flac'], selected) };
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
        expect(await page.locator('audio').evaluateAll(nodes => nodes.every(node => (node as HTMLAudioElement).paused))).toBe(true);
        expect(await page.evaluate(() => (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; filePaths: string[] }> }).__uiSmokePostedMessages
            .filter(message => message.type === 'analyze-selected-files').at(-1)!.filePaths.includes('/tmp/session/sub/b.flac'))).toBe(selected);
    }
});


test('span-changing selection refreshes cursor labels while retaining normalized cursor and zoom', async ({ page }) => {
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    const paths = ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'];
    await showFiles(page, paths, true);
    await page.evaluate(dispatchAnalysisUpdate, { paths, durations: [1, 2] });
    const checkbox = { setChecked: (selected: boolean) => showFiles(page, ['/tmp/session/sub/b.flac'], selected) };
    const snapshot = () => page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'comparison-panel-test-action', actions: [], actionId: 'span-cursor-snapshot',
        } }));
        const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; renderedUi: { cursorNorm: number; zoomStart: number; zoomEnd: number } }> }).__uiSmokePostedMessages;
        return messages.filter(message => message.type === 'comparison-panel-test-snapshot').at(-1)!.renderedUi;
    });
    for (const mode of ['waveform']) {
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
    await showFiles(page, paths, true);
    await page.evaluate(dispatchAnalysisUpdate, paths);
    await page.locator('.track-row[data-track-id="track-2"] details.track-more summary').click();
    await page.locator('[data-action="offset-up"][data-track-id="track-2"]').click();
    await page.locator('[data-action="remove-track"][data-track-id="track-1"]').click();
    await page.evaluate(dispatchAnalysisUpdate, paths);
    await expect(page.locator('.track-row')).toHaveCount(1);
    const checkbox = { setChecked: (selected: boolean) => showFiles(page, ['/tmp/session/a.wav'], selected) };
    await checkbox.setChecked(false);
    await page.evaluate(dispatchAnalysisUpdate, [paths[1]]);
    await checkbox.setChecked(true);
    await page.evaluate(dispatchAnalysisUpdate, paths);
    await expect(page.locator('.track-row')).toHaveCount(2);
    await expect(page.locator('.track-row[data-track-id="track-2"] .track-offset-val')).toContainText('0.010');
    await expect(page.locator('.track-row[data-track-id="track-3"] .track-name')).toHaveText('a.wav');
});

test('recreated directory document restores host selection and audio before the next selection change', async ({ page }) => {
    await page.setContent(buildUiSmokeSelectionHtml(), { waitUntil: 'domcontentloaded' });
    const paths = ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'];
    await showFiles(page, paths, true);
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
    expect(await page.locator('audio').evaluateAll(nodes => nodes.every(node => {
        const audio = node as HTMLAudioElement;
        return audio.src.startsWith('data:audio/wav;base64,') && audio.paused;
    }))).toBe(true);
    await showFiles(page, ['/tmp/session/a.wav'], false);
    const latestSelection = await page.evaluate(() => {
        const messages = (window as unknown as { __uiSmokePostedMessages: Array<{ type: string; filePaths: string[] }> }).__uiSmokePostedMessages;
        return messages.filter(message => message.type === 'analyze-selected-files').at(-1)!.filePaths;
    });
    expect(latestSelection).toEqual([paths[1]]);
});

test('tracks of files named alike stay told apart: a long name keeps its end (run number) in the narrow header (#841)', async ({ page }) => {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const names = ['L1_900rpm_microphone_front_run001.wav', 'L1_900rpm_microphone_front_run002.wav'];
    await page.evaluate(dispatchAnalysisUpdate, names.map(name => `/m/${name}`));
    await expect(page.locator('.track-row')).toHaveCount(2);
    for (const [index, name] of names.entries()) {
        const header = page.locator('.track-row').nth(index).locator('.track-name');
        // The text is still the whole name (screen readers, the runtime's reads).
        await expect(header).toHaveText(name);
        await expect(header.locator('.track-name-tail')).toHaveText(name.slice(-10, -4));
        // The run number is drawn whole inside the header; the head is what gives way.
        const fit = await header.evaluate(el => {
            const box = el.getBoundingClientRect(), tail = el.querySelector('.track-name-tail')!.getBoundingClientRect(), head = el.querySelector<HTMLElement>('.track-name-head')!;
            return { inside: tail.left >= box.left - 0.5 && tail.right <= box.right + 0.5, headCut: head.scrollWidth > head.clientWidth };
        });
        expect(fit).toEqual({ inside: true, headCut: true });
    }
});
