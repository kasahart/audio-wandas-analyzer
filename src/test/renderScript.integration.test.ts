/**
 * ComparisonPanel.renderScript() を jsdom 環境で実行する統合テスト。
 *
 * テスト対象:
 * - renderScript() の JS が jsdom で例外なく実行できること
 * - DOM に期待するキャンバス要素が生成されること
 * - OffscreenCanvas が利用される（または DOM フォールバックが動く）こと
 * - postedMessages が記録されること
 *
 * NOTE: jsdom は CSS レイアウト（clientWidth）を実装しないため、
 * resizeAllCanvases() の幅判定は canvasDirtyState の単体テストで検証する。
 * 統合テストは「スクリプトが正しく動き DOM を生成すること」に集中する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// vscode モックを先に設定してから ComparisonPanel をロードするヘルパー
import { getRenderScript, getRenderStyles } from './helpers/comparisonScriptLoader';
import { createWebviewEnv, evalScript } from './helpers/webviewTestEnv';

// scripts/build-webview.js が tsc 後に生成。__dirname は dist/test なので 1 階層上が dist/。
const WAVEFORM_PIPELINE_JS = readFileSync(
    join(__dirname, '..', 'webview', 'comparisonWaveform.js'),
    'utf8',
);

/** テスト用の最小 AnalysisResult JSON */
const DUMMY_APP_STATE = JSON.stringify({
    mode: 'results',
    results: [
        {
            filePath: '/tmp/a.wav',
            fileName: 'a.wav',
            audioSource: 'vscode-resource:/tmp/a.wav',
            sampleRateHz: 44100,
            durationSeconds: 1.0,
            channelCount: 1,
            sampleCount: 44100,
            error: undefined,
            channels: [{
                label: 'L',
                rms: 0.1,
                peakAbsolute: 0.5,
                dominantFrequencies: [],
                waveform: { min: [-0.5], max: [0.5], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 0.5 },
                spectrogram: {
                    values: [[0]], timeBins: 1, frequencyBins: 1,
                    windowSize: 512, hopSize: 256,
                    maxFrequencyHz: 22050, minDb: -90, maxDb: 0,
                },
            }],
        },
        {
            filePath: '/tmp/b.wav',
            fileName: 'b.wav',
            audioSource: 'vscode-resource:/tmp/b.wav',
            sampleRateHz: 44100,
            durationSeconds: 1.0,
            channelCount: 1,
            sampleCount: 44100,
            error: undefined,
            channels: [{
                label: 'L',
                rms: 0.2,
                peakAbsolute: 0.7,
                dominantFrequencies: [],
                waveform: { min: [-0.7], max: [0.7], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 0.7 },
                spectrogram: {
                    values: [[0]], timeBins: 1, frequencyBins: 1,
                    windowSize: 512, hopSize: 256,
                    maxFrequencyHz: 22050, minDb: -90, maxDb: 0,
                },
            }],
        },
    ],
});

const MULTICHANNEL_APP_STATE = JSON.stringify({
    mode: 'results',
    results: [
        {
            filePath: '/tmp/stereo.wav',
            fileName: 'stereo.wav',
            audioSource: 'vscode-resource:/tmp/stereo.wav',
            sampleRateHz: 44100,
            durationSeconds: 1.0,
            channelCount: 2,
            sampleCount: 44100,
            error: undefined,
            channels: [
                {
                    label: 'Left',
                    rms: 0.1,
                    peakAbsolute: 0.5,
                    dominantFrequencies: [{ frequencyHz: 440, magnitude: 1 }],
                    peaks: [{ freqHz: 440, amplitudeDb: -12 }],
                    waveform: { min: [-0.5], max: [0.5], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 0.5 },
                    spectrogram: {
                        values: [[-12, -48, -72]], timeBins: 1, frequencyBins: 3,
                        windowSize: 512, hopSize: 256,
                        maxFrequencyHz: 22050, minDb: -90, maxDb: 0,
                    },
                },
                {
                    label: 'Right',
                    rms: 0.8,
                    peakAbsolute: 0.95,
                    dominantFrequencies: [{ frequencyHz: 880, magnitude: 1 }],
                    peaks: [{ freqHz: 880, amplitudeDb: -3 }],
                    waveform: { min: [-0.95], max: [0.95], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 0.95 },
                    spectrogram: {
                        values: [[-72, -48, -3]], timeBins: 1, frequencyBins: 3,
                        windowSize: 512, hopSize: 256,
                        maxFrequencyHz: 22050, minDb: -90, maxDb: 0,
                    },
                },
            ],
        },
    ],
});

const DUMMY_SELECTION_STATE = JSON.stringify({
    mode: 'directory-selection',
    results: [],
    rootPath: '/tmp/session',
    allFilePaths: ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'],
    selectedFilePaths: [],
    pythonEnvironmentState: {
        pythonCommand: 'python3',
        status: 'normal',
        tooltip: 'Click to select Python environment',
    },
});

const DUMMY_SELECTION_WITH_RESULTS_STATE = JSON.stringify({
    mode: 'directory-selection',
    rootPath: '/tmp/session',
    allFilePaths: ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'],
    selectedFilePaths: ['/tmp/session/a.wav'],
    pythonEnvironmentState: {
        pythonCommand: '.venv/bin/python',
        status: 'normal',
        tooltip: 'Click to select Python environment',
    },
    results: [
        {
            filePath: '/tmp/session/a.wav',
            fileName: 'a.wav',
            audioSource: 'vscode-resource:/tmp/session/a.wav',
            sampleRateHz: 44100,
            durationSeconds: 1.0,
            channelCount: 1,
            sampleCount: 44100,
            error: undefined,
            channels: [{
                label: 'L',
                rms: 0.1,
                peakAbsolute: 0.5,
                dominantFrequencies: [],
                waveform: { min: [-0.5], max: [0.5], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 0.5 },
                spectrogram: {
                    values: [[0]], timeBins: 1, frequencyBins: 1,
                    windowSize: 512, hopSize: 256,
                    maxFrequencyHz: 22050, minDb: -90, maxDb: 0,
                },
            }],
        },
    ],
});

function setupEnvWithState(stateJson: string) {
    const script = getRenderScript();
    const { dom, postedMessages, offscreenInstances, domCanvasContexts } = createWebviewEnv(stateJson);
    // comparisonWaveform.js を先に eval して window.renderWaveformPipeline を登録する
    evalScript(dom, WAVEFORM_PIPELINE_JS);
    evalScript(dom, script);
    return { dom, postedMessages, offscreenInstances, domCanvasContexts };
}

function setupEnv() {
    return setupEnvWithState(DUMMY_APP_STATE);
}

function setupMultichannelEnv() {
    return setupEnvWithState(MULTICHANNEL_APP_STATE);
}

function makeLazySpectrogramState(): string {
    const state = JSON.parse(DUMMY_APP_STATE);
    state.results.forEach((result: any) => {
        result.channels[0].spectrogram = null;
    });
    return JSON.stringify(state);
}

function setupSelectionEnv() {
    const script = getRenderScript();
    const { dom, postedMessages, offscreenInstances, domCanvasContexts } = createWebviewEnv(DUMMY_SELECTION_STATE);
    evalScript(dom, WAVEFORM_PIPELINE_JS);
    evalScript(dom, script);
    return { dom, postedMessages, offscreenInstances, domCanvasContexts };
}

function setupSelectionResultsEnv() {
    const script = getRenderScript();
    const { dom, postedMessages, offscreenInstances, domCanvasContexts } = createWebviewEnv(DUMMY_SELECTION_WITH_RESULTS_STATE);
    evalScript(dom, WAVEFORM_PIPELINE_JS);
    evalScript(dom, script);
    return { dom, postedMessages, offscreenInstances, domCanvasContexts };
}

function nextAnimationFrame(dom: ReturnType<typeof setupEnv>['dom']): Promise<void> {
    return new Promise((resolve) => {
        dom.window.requestAnimationFrame(() => resolve());
    });
}

test('renderStyles() defaults the panel palette to dark tones', () => {
    const styles = getRenderStyles();

    assert.match(styles, /--surface:\s*#1[0-9a-f]{5}/i);
    assert.match(styles, /--panel:\s*#1[0-9a-f]{5}/i);
    assert.doesNotMatch(styles, /--surface:\s*#fbfbf8/i);
    assert.doesNotMatch(styles, /--panel:\s*#ffffff/i);
});

test('renderStyles() applies an explicit dark background to track areas', () => {
    const styles = getRenderStyles();

    assert.match(styles, /#tracks-wrapper\s*\{[^}]*background:\s*var\(--track-bg\)/i);
    assert.match(styles, /\.track-canvas-wrap\s*\{[^}]*background:\s*var\(--track-bg\)/i);
});

test('renderScript() が jsdom で例外なく実行できる', () => {
    assert.doesNotThrow(() => {
        setupEnv();
    });
});

test('初回実行後に #app 内に HTML が生成される', () => {
    const { dom } = setupEnv();
    const app = dom.window.document.getElementById('app');
    assert.ok(app, '#app が存在すること');
    assert.ok(app!.innerHTML.length > 0, '#app 内に HTML が生成されていること');
});

test('2 トラック分の track-canvas が生成される', () => {
    const { dom } = setupEnv();
    const c0 = dom.window.document.getElementById('track-canvas-0');
    const c1 = dom.window.document.getElementById('track-canvas-1');
    assert.ok(c0, 'track-canvas-0 が存在すること');
    assert.ok(c1, 'track-canvas-1 が存在すること');
});

test('toolbar が生成される', () => {
    const { dom } = setupEnv();
    const toolbar = dom.window.document.getElementById('toolbar');
    assert.ok(toolbar, '#toolbar が存在すること');
});

test('results toolbar does not duplicate file or Python entry points', () => {
    const { dom } = setupEnv();
    const toolbar = dom.window.document.getElementById('toolbar');
    assert.ok(toolbar, '#toolbar が存在すること');
    assert.equal(toolbar.querySelector('[data-action="open-file"]'), null);
    assert.equal(toolbar.querySelector('[data-action="open-folder"]'), null);
    assert.equal(toolbar.querySelector('[data-action="select-python-environment"]'), null);
});

test('selection toolbar にファイルとフォルダを開く導線がある', () => {
    const { dom } = setupSelectionEnv();
    const toolbar = dom.window.document.getElementById('selection-toolbar');
    assert.ok(toolbar, '#selection-toolbar が存在すること');
    assert.ok(toolbar.querySelector('[data-action="open-file"]'), 'open-file ボタンが存在すること');
    assert.ok(toolbar.querySelector('[data-action="open-folder"]'), 'open-folder ボタンが存在すること');
});

test('各トラックに再生系のボタンと audio 要素が生成される', () => {
    const { dom } = setupEnv();
    const playButton = dom.window.document.querySelector('[data-action="toggle-playback"][data-track-index="0"]');
    const stopButton = dom.window.document.querySelector('[data-action="stop-playback"][data-track-index="0"]');
    const audio = dom.window.document.getElementById('track-audio-0');
    assert.ok(playButton, '再生ボタンが存在すること');
    assert.ok(stopButton, '停止ボタンが存在すること');
    assert.ok(audio instanceof dom.window.HTMLAudioElement, 'audio 要素が存在すること');
});

test('ruler-canvas が生成される', () => {
    const { dom } = setupEnv();
    const ruler = dom.window.document.getElementById('ruler-canvas');
    assert.ok(ruler, '#ruler-canvas が存在すること');
});

test('acquireVsCodeApi().postMessage が postedMessages を記録する', () => {
    const { dom, postedMessages } = setupEnv();
    const win = dom.window as any;
    win.acquireVsCodeApi().postMessage({ type: 'test' });
    assert.equal(postedMessages.length, 1);
    assert.deepEqual((postedMessages[0] as any).type, 'test');
});

test('selection open-file ボタンが select-target(file) を送信する', () => {
    const { dom, postedMessages } = setupSelectionEnv();
    const button = dom.window.document.querySelector('[data-action="open-file"]');
    assert.ok(button instanceof dom.window.HTMLButtonElement);
    button.click();
    const message = postedMessages[0] as { type?: string; targetKind?: string };
    assert.equal(message.type, 'select-target');
    assert.equal(message.targetKind, 'file');
});

test('selection open-folder ボタンが select-target(directory) を送信する', () => {
    const { dom, postedMessages } = setupSelectionEnv();
    const button = dom.window.document.querySelector('[data-action="open-folder"]');
    assert.ok(button instanceof dom.window.HTMLButtonElement);
    button.click();
    const message = postedMessages[0] as { type?: string; targetKind?: string };
    assert.equal(message.type, 'select-target');
    assert.equal(message.targetKind, 'directory');
});

test('directory selection mode renders file tree checkboxes for audio files', () => {
    const { dom } = setupSelectionEnv();
    const checkboxes = dom.window.document.querySelectorAll('.selection-file-checkbox');
    const directoryLabels = dom.window.document.querySelectorAll('.selection-tree-directory');
    const checked = dom.window.document.querySelectorAll('.selection-file-checkbox:checked');

    assert.equal(checkboxes.length, 2);
    assert.equal(checked.length, 0);
    assert.equal(directoryLabels.length, 1);
    assert.match(dom.window.document.body.textContent || '', /a\.wav/);
    assert.match(dom.window.document.body.textContent || '', /b\.flac/);
});

test('ファイルツリーにフィルタ入力が存在する', () => {
    const env = setupSelectionEnv();
    const filterInput = env.dom.window.document.getElementById('tree-filter-input') as HTMLInputElement | null;
    assert.ok(filterInput, 'tree-filter-input が存在すること');
    assert.equal(filterInput!.tagName.toLowerCase(), 'input', 'input 要素であること');
    env.dom.window.close();
});

test('ファイルツリーにリサイザーが存在する', () => {
    const env = setupSelectionEnv();
    const resizer = env.dom.window.document.getElementById('tree-resizer');
    assert.ok(resizer, 'tree-resizer が存在すること');
    env.dom.window.close();
});

test('ファイルツリーフィルタでファイルが絞り込まれる', () => {
    const env = setupSelectionEnv();
    const filterInput = env.dom.window.document.getElementById('tree-filter-input') as HTMLInputElement | null;
    assert.ok(filterInput, 'tree-filter-input が存在すること');
    const flush = (env.dom.window as unknown as Record<string, () => void>).__treeFilterFlush;

    const checkboxesBefore = env.dom.window.document.querySelectorAll('.selection-file-checkbox');
    assert.equal(checkboxesBefore.length, 2, 'フィルタ前に 2 件のファイルが表示されること');

    // "flac" でフィルタ → b.flac のみ表示
    filterInput!.value = 'flac';
    filterInput!.dispatchEvent(new env.dom.window.Event('input', { bubbles: true }));
    flush();

    const visibleRows = Array.from(env.dom.window.document.querySelectorAll('.selection-file-row'))
        .filter((el: Element) => (el.closest('li') as HTMLElement | null)?.style.display !== 'none');
    assert.equal(visibleRows.length, 1, 'flac でフィルタすると 1 件だけ表示されること');
    assert.ok(
        visibleRows[0].textContent?.includes('b.flac'),
        '表示されるのが b.flac であること',
    );

    // フィルタをクリア → 全件表示
    filterInput!.value = '';
    filterInput!.dispatchEvent(new env.dom.window.Event('input', { bubbles: true }));
    flush();
    const rowsAfterClear = Array.from(env.dom.window.document.querySelectorAll('.selection-file-row'))
        .filter((el: Element) => (el.closest('li') as HTMLElement | null)?.style.display !== 'none');
    assert.equal(rowsAfterClear.length, 2, 'フィルタクリア後に 2 件に戻ること');

    env.dom.window.close();
});

test('フィルタ適用後も選択状態が維持される', () => {
    const env = setupSelectionEnv();
    const filterInput = env.dom.window.document.getElementById('tree-filter-input') as HTMLInputElement | null;
    assert.ok(filterInput);
    const flush = (env.dom.window as unknown as Record<string, () => void>).__treeFilterFlush;

    // a.wav にチェックを入れる
    const checkboxA = env.dom.window.document.querySelector(
        '.selection-file-checkbox[data-file-path="/tmp/session/a.wav"]',
    ) as HTMLInputElement | null;
    assert.ok(checkboxA);
    checkboxA!.checked = true;
    checkboxA!.dispatchEvent(new env.dom.window.Event('change', { bubbles: true }));

    // "flac" でフィルタ（a.wav は非表示になる）
    filterInput!.value = 'flac';
    filterInput!.dispatchEvent(new env.dom.window.Event('input', { bubbles: true }));
    flush();

    // チェック状態は維持されていること
    const checkboxAAfter = env.dom.window.document.querySelector(
        '.selection-file-checkbox[data-file-path="/tmp/session/a.wav"]',
    ) as HTMLInputElement | null;
    assert.ok(checkboxAAfter!.checked, 'フィルタ後も a.wav のチェック状態が維持されること');

    env.dom.window.close();
});

test('directory selection mode renders a Python environment button only in the selection toolbar', () => {
    const { dom } = setupSelectionEnv();
    const selectionButton = dom.window.document.getElementById('selection-python-environment');
    const mainToolbarButton = dom.window.document.getElementById('toolbar-python-environment');

    assert.ok(selectionButton instanceof dom.window.HTMLButtonElement);
    assert.equal(selectionButton.textContent, 'Python: python3');
    assert.equal(selectionButton.title, 'python3 — Click to select Python environment');
    assert.equal(mainToolbarButton, null);
});

test('selection Python button posts select-python-environment when clicked', () => {
    const { dom, postedMessages } = setupSelectionEnv();
    const button = dom.window.document.getElementById('selection-python-environment');

    assert.ok(button instanceof dom.window.HTMLButtonElement);
    button.click();

    const message = postedMessages.at(-1) as { type?: string } | undefined;
    assert.equal(message?.type, 'select-python-environment');
});

test('python-environment-state message updates the selection toolbar button state', () => {
    const { dom } = setupSelectionEnv();
    const button = dom.window.document.getElementById('selection-python-environment');

    assert.ok(button instanceof dom.window.HTMLButtonElement);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        data: {
            type: 'python-environment-state',
            pythonCommand: '/tmp/missing-python',
            status: 'warning',
            tooltip: 'Python interpreter was not found. Click to select another environment.',
        },
    }));

    assert.equal(button.textContent, 'Python: missing-python ⚠');
    assert.equal(button.title, '/tmp/missing-python — Python interpreter was not found. Click to select another environment.');
    assert.equal(button.classList.contains('is-warning'), true);
});

test('python-environment-state message shortens Windows-style path in button label', () => {
    const { dom } = setupSelectionEnv();
    const button = dom.window.document.getElementById('selection-python-environment');

    assert.ok(button instanceof dom.window.HTMLButtonElement);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        data: {
            type: 'python-environment-state',
            pythonCommand: 'C:\\Python311\\python.exe',
            status: 'ok',
            tooltip: 'Click to select Python environment',
        },
    }));

    assert.equal(button.textContent, 'Python: python.exe');
    assert.equal(button.title, 'C:\\Python311\\python.exe — Click to select Python environment');
});

test('directory selection mode posts analyze-selected-files immediately when a checkbox is checked', () => {
    const { dom, postedMessages } = setupSelectionEnv();
    const firstCheckbox = dom.window.document.querySelector('[data-file-path="/tmp/session/a.wav"]');

    assert.ok(firstCheckbox instanceof dom.window.HTMLInputElement);

    firstCheckbox.checked = true;
    firstCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const message = postedMessages.at(-1) as { type?: string; requestId?: string; filePaths?: string[] } | undefined;

    assert.ok(message, 'analyze-selected-files message should be posted');
    assert.equal(message?.type, 'analyze-selected-files');
    assert.match(message?.requestId || '', /^selection-/);
    assert.deepEqual(message?.filePaths, ['/tmp/session/a.wav']);
});

test('directory selection mode keeps the tree visible while rendering selected tracks', () => {
    const { dom } = setupSelectionResultsEnv();
    const checkboxes = dom.window.document.querySelectorAll('.selection-file-checkbox');
    const trackCanvas = dom.window.document.getElementById('track-canvas-0');
    const toolbar = dom.window.document.getElementById('toolbar');

    assert.equal(checkboxes.length, 2);
    assert.ok(trackCanvas, 'selected track canvas should remain visible next to the tree');
    assert.ok(toolbar, 'comparison toolbar should be visible in selection mode');
});

test('directory selection mode posts an empty selection when a checked file is unchecked', () => {
    const { dom, postedMessages } = setupSelectionResultsEnv();
    const firstCheckbox = dom.window.document.querySelector('[data-file-path="/tmp/session/a.wav"]');

    assert.ok(firstCheckbox instanceof dom.window.HTMLInputElement);

    firstCheckbox.checked = false;
    firstCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const message = postedMessages.at(-1) as { type?: string; requestId?: string; filePaths?: string[] } | undefined;

    assert.ok(message, 'analyze-selected-files message should be posted when removing the last track');
    assert.equal(message?.type, 'analyze-selected-files');
    assert.match(message?.requestId || '', /^selection-/);
    assert.deepEqual(message?.filePaths, []);
});

test('directory selection mode select-all test action sends the full selection immediately', () => {
    const { dom, postedMessages } = setupSelectionEnv();

    dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
            data: {
                type: 'comparison-panel-test-action',
                actionId: 'selection-select-all-action',
                actions: ['selection-select-all'],
            },
        }),
    );

    const message = postedMessages.find((entry) => {
        return typeof entry === 'object' && entry !== null && (entry as { type?: string }).type === 'analyze-selected-files';
    }) as { type?: string; requestId?: string; filePaths?: string[] } | undefined;

    assert.ok(message, 'selection-select-all test action should post analyze-selected-files');
    assert.match(message?.requestId || '', /^selection-/);
    assert.deepEqual(message?.filePaths, ['/tmp/session/a.wav', '/tmp/session/sub/b.flac']);
});

test('comparisonWaveform.js が window.renderWaveformPipeline を登録する', () => {
    const { dom } = setupEnv();
    const win = dom.window as any;
    assert.equal(typeof win.renderWaveformPipeline, 'function',
        'window.renderWaveformPipeline が関数として登録されていること');
});

test('renderWaveformPipeline が ctx.stroke() を呼び出す', () => {
    const { dom } = setupEnv();
    const win = dom.window as any;
    const calls: string[] = [];
    const mockCtx = {
        lineWidth: 1.5,
        strokeStyle: '',
        beginPath() { calls.push('beginPath'); },
        moveTo() { calls.push('moveTo'); },
        lineTo() { calls.push('lineTo'); },
        stroke() { calls.push('stroke'); },
    };
    const env = {
        min: [-0.5, -0.3, -0.4],
        max: [0.8, 0.6, 0.7],
        minT: [0.1, 0.4, 0.7],
        maxT: [0.2, 0.5, 0.8],
        absolutePeak: 0.8,
    };
    win.renderWaveformPipeline(mockCtx, 800, 80, env, {
        zoomStart: 0, zoomEnd: 1, offsetNorm: 0,
        dataStart: 0, dataEnd: 1, color: '#4ec994',
    });
    assert.ok(calls.includes('stroke'), 'stroke() が呼ばれること');
    assert.ok(calls.includes('beginPath'), 'beginPath() が呼ばれること');
});

test('waveform-range-result メッセージを受信しても例外が起きない', () => {
    const { dom } = setupEnv();
    assert.doesNotThrow(() => {
        dom.window.dispatchEvent(
            new dom.window.MessageEvent('message', {
                data: {
                    type: 'waveform-range-result',
                    trackIndex: 0,
                    requestId: 'nonexistent-id',
                    startNorm: 0,
                    endNorm: 1,
                    channels: [],
                },
            }),
        );
    });
});

test('renderScript: spectrogram mode requests track detail when spectrogram is null', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    const button = env.dom.window.document.querySelector('[data-action="content-spectrogram"]') as HTMLButtonElement | null;
    assert.ok(button);
    button.click();
    await nextAnimationFrame(env.dom);

    const detailRequests = env.postedMessages.filter((msg: any) => msg.type === 'request-track-detail') as any[];
    assert.ok(detailRequests.length >= 1, 'request-track-detail should be posted');
    assert.equal(detailRequests[0].trackIndex, 0);
    assert.equal(detailRequests[0].filePath, '/tmp/a.wav');
    assert.equal(typeof detailRequests[0].analysisId, 'string');
    assert.equal(typeof detailRequests[0].settingsSignature, 'string');
});

test('renderScript: track-detail-result merges spectrogram and stale detail is ignored', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    const button = env.dom.window.document.querySelector('[data-action="content-spectrogram"]') as HTMLButtonElement | null;
    assert.ok(button);
    button.click();
    await nextAnimationFrame(env.dom);
    const req = env.postedMessages.find((msg: any) => msg.type === 'request-track-detail') as any;
    assert.ok(req);

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'track-detail-result',
        requestId: req.requestId,
        analysisId: 'stale',
        settingsSignature: req.settingsSignature,
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        channels: [{ spectrogram: { values: [[-10]], timeBins: 1, frequencyBins: 1, windowSize: 512, hopSize: 256, maxFrequencyHz: 22050, minDb: -90, maxDb: 0 } }],
    } }));
    await nextAnimationFrame(env.dom);
    let snap = env.postedMessages.filter((msg: any) => msg.type === 'comparison-panel-test-snapshot').at(-1) as any;
    assert.ok(snap.renderedUi.axisLabels.spectrogramPerTrack[0].includes('-120 dB'));
    assert.equal(snap.renderedUi.axisLabels.spectrogramPerTrack[0].includes('-90 dB'), false);

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'track-detail-result',
        requestId: req.requestId,
        analysisId: req.analysisId,
        settingsSignature: req.settingsSignature,
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        channels: [{ spectrogram: { values: [[-10]], timeBins: 1, frequencyBins: 1, windowSize: 512, hopSize: 256, maxFrequencyHz: 22050, minDb: -90, maxDb: 0 } }],
    } }));
    await nextAnimationFrame(env.dom);
    snap = env.postedMessages.filter((msg: any) => msg.type === 'comparison-panel-test-snapshot').at(-1) as any;
    assert.ok(snap.renderedUi.axisLabels.spectrogramPerTrack[0].includes('-90 dB'));
});

test('renderScript: removing a detailed track releases its spectrogram detail', () => {
    const env = setupEnv();
    const removeButton = env.dom.window.document.querySelector('[data-action="remove-track"][data-track-index="0"]') as HTMLButtonElement | null;
    assert.ok(removeButton);
    removeButton.click();

    const release = env.postedMessages.find((msg: any) => msg.type === 'release-track-detail' && msg.trackIndex === 0) as any;
    assert.ok(release, 'release-track-detail should be posted');
    assert.equal(release.filePath, '/tmp/a.wav');
});


test('renderScript: display-only spectrogram changes do not request fresh track detail', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    await nextAnimationFrame(env.dom);

    const specButton = env.dom.window.document.querySelector('[data-action="content-spectrogram"]') as HTMLButtonElement | null;
    assert.ok(specButton, 'spectrogram button should exist');
    specButton!.click();
    await nextAnimationFrame(env.dom);

    const requestCountBefore = env.postedMessages.filter((msg: any) => msg.type === 'request-track-detail').length;
    assert.ok(requestCountBefore > 0, 'spectrogram mode should request lazy track detail');

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'comparison-panel-test-action',
        actionId: 'display-only-detail-signature',
        actions: [{ action: 'set-spectrogram-display', payload: { dbMin: -70, dbMax: -5, maxFrequencyHz: 8000 } }],
    } }));
    await nextAnimationFrame(env.dom);
    await nextAnimationFrame(env.dom);

    const requestCountAfter = env.postedMessages.filter((msg: any) => msg.type === 'request-track-detail').length;
    assert.equal(requestCountAfter, requestCountBefore, 'display-only settings should not invalidate pending track-detail requests');
    env.dom.window.close();
});

test('renderScript: analysis-update in spectrogram mode requests fresh detail for new settings', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    const button = env.dom.window.document.querySelector('[data-action="content-spectrogram"]') as HTMLButtonElement | null;
    assert.ok(button);
    button.click();
    await nextAnimationFrame(env.dom);

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'analysis-update',
        results: JSON.parse(makeLazySpectrogramState()).results,
    } }));
    await nextAnimationFrame(env.dom);

    const detailRequests = env.postedMessages.filter((msg: any) => msg.type === 'request-track-detail') as any[];
    assert.ok(detailRequests.length >= 2, 'analysis-update should trigger a fresh detail request in spectrogram mode');
});

test('renderScript: missing spectrogram requests a spectrum slice at cursor', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    await nextAnimationFrame(env.dom);

    const sliceRequests = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice') as any[];
    assert.ok(sliceRequests.length >= 1, 'request-spectrum-slice should be posted');
    assert.equal(sliceRequests[0].trackIndex, 0);
    assert.equal(sliceRequests[0].filePath, '/tmp/a.wav');
    assert.equal(typeof sliceRequests[0].cursorNorm, 'number');
});

test('renderScript: lazy spectrum slices apply display range settings', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    await nextAnimationFrame(env.dom);

    let req = env.postedMessages.find((msg: any) => msg.type === 'request-spectrum-slice') as any;
    assert.ok(req, 'initial request-spectrum-slice should be posted');
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'spectrum-slice-result',
        requestId: req.requestId,
        analysisId: req.analysisId,
        settingsSignature: req.settingsSignature,
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        values: [-120, -20, 10],
        frequencyBins: 3,
        maxFrequencyHz: 22050,
        minDb: -120,
        maxDb: 10,
        unit: 'dB',
        axisLabel: 'Spectrum level [dB]',
    } }));
    await nextAnimationFrame(env.dom);

    const requestCountBeforeDisplayChange = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice').length;
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'comparison-panel-test-action',
        actionId: 'lazy-slice-display',
        actions: [{ action: 'set-spectrogram-display', payload: { dbMin: -60, dbMax: 0, maxFrequencyHz: 1000 } }],
    } }));
    await nextAnimationFrame(env.dom);
    await nextAnimationFrame(env.dom);

    const requestCountAfterDisplayChange = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice').length;
    assert.equal(requestCountAfterDisplayChange, requestCountBeforeDisplayChange, 'display-only changes should reuse the cached lazy slice');

    const snapshots = env.postedMessages.filter((msg: any) => msg.type === 'comparison-panel-test-snapshot') as any[];
    let snap: any = null;
    for (let i = snapshots.length - 1; i >= 0; i--) {
        if ((snapshots[i].renderedUi.axisLabels.spectrumOverlay as string[]).length > 0) {
            snap = snapshots[i];
            break;
        }
    }
    assert.ok(snap, 'a spectrum snapshot with overlay labels should be published');
    const overlay = snap.renderedUi.axisLabels.spectrumOverlay as string[];
    assert.ok(overlay.includes('0 dB'), `overlay should use configured max dB with wandas slice unit: ${JSON.stringify(overlay)}`);
    assert.ok(overlay.includes('-60 dB'), `overlay should use configured min dB with wandas slice unit: ${JSON.stringify(overlay)}`);
    assert.ok(overlay.some((label) => label === '1.0 kHz'), `overlay should use configured max frequency: ${JSON.stringify(overlay)}`);
});

test('renderScript: lazy spectrum cache is scoped to the current cursor', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    await nextAnimationFrame(env.dom);

    const initialReq = env.postedMessages.find((msg: any) => msg.type === 'request-spectrum-slice' && msg.trackIndex === 0) as any;
    assert.ok(initialReq, 'initial lazy slice request should be posted');
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'spectrum-slice-result',
        requestId: initialReq.requestId,
        analysisId: initialReq.analysisId,
        settingsSignature: initialReq.settingsSignature,
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        values: [-120, -20, 10],
        frequencyBins: 3,
        maxFrequencyHz: 22050,
        minDb: -120,
        maxDb: 10,
    } }));
    await nextAnimationFrame(env.dom);

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'comparison-panel-test-action',
        actionId: 'lazy-cache-cursor',
        actions: [{ action: 'set-cursor', payload: { cursorNorm: 0.5 } }],
    } }));
    await nextAnimationFrame(env.dom);

    const requests = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice' && msg.trackIndex === 0) as any[];
    const latestReq = requests[requests.length - 1];
    assert.ok(latestReq.cursorNorm > 0.45 && latestReq.cursorNorm < 0.55, 'cursor move should request a slice for the new cursor: ' + latestReq.cursorNorm);

    const snapshots = env.postedMessages.filter((msg: any) => msg.type === 'comparison-panel-test-snapshot') as any[];
    const lastSnap = snapshots[snapshots.length - 1];
    assert.equal(lastSnap.renderedUi.visibleSpectrumTrackCount, 0, 'stale lazy slice should not be reused for a different cursor');
    env.dom.window.close();
});

test('renderScript: lazy spectrum keeps previous drawing while a new cursor slice is pending', async () => {
    const state = JSON.parse(makeLazySpectrogramState());
    state.results = state.results.slice(0, 1);
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);

    const initialReq = env.postedMessages.find((msg: any) => msg.type === 'request-spectrum-slice' && msg.trackIndex === 0) as any;
    assert.ok(initialReq, 'initial lazy slice request should be posted');
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'spectrum-slice-result',
        requestId: initialReq.requestId,
        analysisId: initialReq.analysisId,
        settingsSignature: initialReq.settingsSignature,
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        values: [-120, -20, 10],
        frequencyBins: 3,
        maxFrequencyHz: 22050,
        minDb: -120,
        maxDb: 10,
    } }));
    await nextAnimationFrame(env.dom);

    const overlaySpy = env.domCanvasContexts.get('spectrum-overlay-canvas');
    const trackSpy = env.domCanvasContexts.get('track-spectrum-0');
    assert.ok(overlaySpy, 'overlay canvas spy should exist');
    assert.ok(trackSpy, 'track spectrum canvas spy should exist');
    const overlayClearBefore = overlaySpy!.clearRectCalls;
    const trackClearBefore = trackSpy!.clearRectCalls;

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'comparison-panel-test-action',
        actionId: 'lazy-spectrum-pending-hold',
        actions: [{ action: 'set-cursor', payload: { cursorNorm: 0.5 } }],
    } }));
    await nextAnimationFrame(env.dom);

    const requests = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice' && msg.trackIndex === 0) as any[];
    const latestReq = requests[requests.length - 1];
    assert.ok(latestReq.cursorNorm > 0.45 && latestReq.cursorNorm < 0.55, 'cursor move should request a new lazy slice');
    assert.equal(trackSpy!.clearRectCalls, trackClearBefore, 'per-track spectrum should keep its previous pixels while the new slice is pending');
    assert.equal(overlaySpy!.clearRectCalls, overlayClearBefore, 'overlay spectrum should keep its previous pixels while the new slice is pending');

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'spectrum-slice-error',
        requestId: latestReq.requestId,
        analysisId: latestReq.analysisId,
        settingsSignature: latestReq.settingsSignature,
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        error: 'slice failed',
    } }));
    await nextAnimationFrame(env.dom);

    assert.ok(trackSpy!.clearRectCalls > trackClearBefore, 'per-track spectrum should clear stale pixels after the pending slice fails');
    assert.ok(overlaySpy!.clearRectCalls > overlayClearBefore, 'overlay spectrum should clear stale pixels after the pending slice fails');
    env.dom.window.close();
});

test('renderScript: spectrum at exact track end renders silence instead of the last STFT bin', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'comparison-panel-test-action',
        actionId: 'spectrum-end-cursor',
        actions: [{ action: 'set-cursor', payload: { cursorNorm: 1 } }],
    } }));
    await nextAnimationFrame(env.dom);

    const snapshots = env.postedMessages.filter((msg: any) => msg.type === 'comparison-panel-test-snapshot') as any[];
    const snap = snapshots[snapshots.length - 1];
    assert.equal(snap.renderedUi.cursorNorm, 1);
    assert.ok(snap.renderedUi.axisLabels.spectrumOverlay.includes('-90 dB'), 'end cursor should use the silent floor: ' + JSON.stringify(snap.renderedUi.axisLabels.spectrumOverlay));
    env.dom.window.close();
});

test('再生ボタンで play 状態に切り替わる', async () => {
    const { dom } = setupEnv();
    const playButton = dom.window.document.querySelector('[data-action="toggle-playback"][data-track-index="0"]');
    const stopButton = dom.window.document.querySelector('[data-action="stop-playback"][data-track-index="0"]');
    const audio = dom.window.document.getElementById('track-audio-0') as HTMLAudioElement | null;

    assert.ok(playButton instanceof dom.window.HTMLButtonElement);
    assert.ok(stopButton instanceof dom.window.HTMLButtonElement);
    assert.ok(audio instanceof dom.window.HTMLAudioElement);

    (audio as HTMLAudioElement & { duration: number }).duration = 1;
    playButton.click();
    await Promise.resolve();

    assert.equal(playButton.textContent, '⏸');
    assert.equal(stopButton.disabled, false);
    assert.equal(audio.paused, false);

    stopButton.click();
    await Promise.resolve();
    dom.window.close();
});

test('renderScript: cursorNorm initializes as number (not null)', () => {
    // cursorNorm は 0（number）で初期化される。
    // clearHover() は updateCursorDisplay(cursorNorm) を呼ぶため、
    // まず mousemove で hoverNorm をセットし、次に mouseleave で clearHover を発火させる。
    // #cursor-display が formatTime(0) = '0:00.00' を表示すれば cursorNorm が number であると確認できる。
    const { dom } = setupEnv();
    const canvas = dom.window.document.getElementById('track-canvas-0') as HTMLElement | null;
    assert.ok(canvas, 'track-canvas-0 が存在すること');

    // mousemove on the canvas (bubbles to tracks-wrapper) → hoverNorm が設定される
    canvas.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 0 }));

    const tracksWrapper = dom.window.document.getElementById('tracks-wrapper');
    assert.ok(tracksWrapper, 'tracks-wrapper が存在すること');

    // mouseleave on tracks-wrapper → clearHover() → updateCursorDisplay(cursorNorm=0)
    tracksWrapper.dispatchEvent(new dom.window.MouseEvent('mouseleave', { bubbles: false }));

    const cursorDisplay = dom.window.document.getElementById('cursor-display');
    assert.ok(cursorDisplay, '#cursor-display が存在すること');
    // formatTime(0) = '0:00.00' — NaN にならず数値フォーマットで表示されること
    assert.equal(cursorDisplay.textContent, '0:00.00',
        'cursorNorm=0 のとき cursor-display は "0:00.00" を表示すること');
});

const SPECTRUM_APP_STATE = JSON.stringify({
    mode: 'results',
    results: [0, 1].map((idx) => ({
        filePath: `/tmp/spec-${idx}.wav`,
        fileName: `spec-${idx}.wav`,
        audioSource: `vscode-resource:/tmp/spec-${idx}.wav`,
        sampleRateHz: 44100,
        durationSeconds: 1.0,
        channelCount: 1,
        sampleCount: 44100,
        error: undefined,
        channels: [{
            label: 'L',
            rms: 0.1,
            peakAbsolute: 0.5,
            dominantFrequencies: [],
            waveform: { min: [-0.5], max: [0.5], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 0.5 },
            spectrogram: {
                values: [
                    [-80, -60, -40, -20],
                    [-70, -50, -30, -10],
                    [-60, -40, -20, 0],
                    [-50, -30, -10, -5],
                ],
                timeBins: 4,
                frequencyBins: 4,
                windowSize: 512,
                hopSize: 256,
                maxFrequencyHz: 22050,
                minDb: -90,
                maxDb: 0,
            },
        }],
    })),
});

const REAL_SCALE_AXIS_APP_STATE = JSON.stringify({
    mode: 'results',
    results: [
        {
            filePath: '/tmp/int16.wav',
            fileName: 'int16.wav',
            audioSource: 'vscode-resource:/tmp/int16.wav',
            sampleRateHz: 44100,
            durationSeconds: 1.0,
            channelCount: 1,
            sampleCount: 44100,
            error: undefined,
            channels: [{
                label: 'L',
                rms: 1024,
                peakAbsolute: 16383,
                dominantFrequencies: [],
                unit: null,
                waveform: { min: [-16383], max: [16383], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 16383 },
                spectrogram: null,
            }],
        },
        {
            filePath: '/tmp/pa.wav',
            fileName: 'pa.wav',
            audioSource: 'vscode-resource:/tmp/pa.wav',
            sampleRateHz: 44100,
            durationSeconds: 1.0,
            channelCount: 1,
            sampleCount: 44100,
            error: undefined,
            channels: [{
                label: 'L',
                rms: 0.1,
                peakAbsolute: 0.5,
                dominantFrequencies: [],
                unit: 'Pa',
                waveform: { min: [-0.5], max: [0.5], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 0.5 },
                spectrogram: null,
            }],
        },
    ],
});


const HIGH_FREQUENCY_READOUT_STATE = JSON.stringify({
    mode: 'results',
    results: [
        {
            filePath: '/tmp/high.wav',
            fileName: 'high.wav',
            audioSource: 'vscode-resource:/tmp/high.wav',
            sampleRateHz: 7200,
            durationSeconds: 1.0,
            channelCount: 1,
            sampleCount: 7200,
            error: undefined,
            channels: [{
                label: 'L',
                rms: 0.1,
                peakAbsolute: 0.5,
                dominantFrequencies: [],
                waveform: { min: [-0.5], max: [0.5], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 0.5 },
                spectrogram: {
                    values: [[-80, -60, -40, -20]],
                    timeBins: 1,
                    frequencyBins: 4,
                    windowSize: 512,
                    hopSize: 256,
                    maxFrequencyHz: 3600,
                    minDb: -90,
                    maxDb: 0,
                },
            }],
        },
    ],
});


const MISMATCHED_DELTA_F_SPECTRUM_STATE = JSON.stringify({
    mode: 'results',
    results: [
        {
            filePath: '/tmp/coarse.wav',
            fileName: 'coarse.wav',
            audioSource: 'vscode-resource:/tmp/coarse.wav',
            sampleRateHz: 1200,
            durationSeconds: 1.0,
            channelCount: 1,
            sampleCount: 1200,
            error: undefined,
            channels: [{
                label: 'L',
                rms: 0.1,
                peakAbsolute: 0.5,
                dominantFrequencies: [],
                waveform: { min: [-0.5], max: [0.5], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 0.5 },
                spectrogram: {
                    values: [[-80, -60, -40, -20]],
                    timeBins: 1,
                    frequencyBins: 4,
                    windowSize: 512,
                    hopSize: 256,
                    maxFrequencyHz: 600,
                    minDb: -90,
                    maxDb: 0,
                },
            }],
        },
        {
            filePath: '/tmp/fine.wav',
            fileName: 'fine.wav',
            audioSource: 'vscode-resource:/tmp/fine.wav',
            sampleRateHz: 1800,
            durationSeconds: 1.0,
            channelCount: 1,
            sampleCount: 1800,
            error: undefined,
            channels: [{
                label: 'L',
                rms: 0.1,
                peakAbsolute: 0.5,
                dominantFrequencies: [],
                waveform: { min: [-0.5], max: [0.5], minT: [0.0], maxT: [1.0], samples: [0.0], absolutePeak: 0.5 },
                spectrogram: {
                    values: [[-20, -35, -50, -65, -80, -85]],
                    timeBins: 1,
                    frequencyBins: 6,
                    windowSize: 512,
                    hopSize: 256,
                    maxFrequencyHz: 900,
                    minDb: -90,
                    maxDb: 0,
                },
            }],
        },
    ],
});

function setupSpectrumEnv() {
    const script = getRenderScript();
    const env = createWebviewEnv(SPECTRUM_APP_STATE);
    evalScript(env.dom, WAVEFORM_PIPELINE_JS);
    evalScript(env.dom, script);
    return env;
}


function setupMismatchedDeltaFSpectrumEnv() {
    const script = getRenderScript();
    const env = createWebviewEnv(MISMATCHED_DELTA_F_SPECTRUM_STATE);
    evalScript(env.dom, WAVEFORM_PIPELINE_JS);
    evalScript(env.dom, script);
    return env;
}

function setupHighFrequencyReadoutEnv() {
    const script = getRenderScript();
    const env = createWebviewEnv(HIGH_FREQUENCY_READOUT_STATE);
    evalScript(env.dom, WAVEFORM_PIPELINE_JS);
    evalScript(env.dom, script);
    return env;
}

function setupSpectrumEnvWithClock(clock: { now: number }) {
    const script = getRenderScript();
    const env = createWebviewEnv(SPECTRUM_APP_STATE);
    Object.defineProperty(env.dom.window.performance, 'now', {
        configurable: true,
        value: () => clock.now,
    });
    evalScript(env.dom, WAVEFORM_PIPELINE_JS);
    evalScript(env.dom, script);
    return env;
}

test('renderScript: each track row contains a per-track spectrum canvas', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const c0 = env.dom.window.document.getElementById('track-spectrum-0');
    const c1 = env.dom.window.document.getElementById('track-spectrum-1');
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas');
    assert.ok(c0, 'track-spectrum-0 が存在すること');
    assert.ok(c1, 'track-spectrum-1 が存在すること');
    assert.ok(overlay, '#spectrum-overlay-canvas が存在すること');
    env.dom.window.close();
});

test('renderScript: overlay spectrum canvas is drawn on initial render', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const overlaySpy = env.domCanvasContexts.get('spectrum-overlay-canvas');
    assert.ok(overlaySpy, 'overlay canvas のスパイが取得できること');
    assert.ok(overlaySpy!.strokeCalls > 0,
        '初期描画で重ね合わせスペクトルが少なくとも1本描かれること');
    env.dom.window.close();
});

test('renderScript: per-track spectrum is drawn on initial render', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const t0 = env.domCanvasContexts.get('track-spectrum-0');
    const t1 = env.domCanvasContexts.get('track-spectrum-1');
    assert.ok(t0 && t0.strokeCalls > 0, 'track-0 のスペクトルが描画されること');
    assert.ok(t1 && t1.strokeCalls > 0, 'track-1 のスペクトルが描画されること');
    env.dom.window.close();
});

test('renderScript: mouseup click commits cursor and re-draws spectrum', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const overlaySpy = env.domCanvasContexts.get('spectrum-overlay-canvas');
    assert.ok(overlaySpy);
    const before = overlaySpy!.strokeCalls;

    const canvas = env.dom.window.document.getElementById('track-canvas-0') as HTMLElement | null;
    assert.ok(canvas);
    // mousedown + mouseup (no movement) -> click branch in handleDocMouseUp
    canvas.dispatchEvent(new env.dom.window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 5 }));
    env.dom.window.document.dispatchEvent(new env.dom.window.MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 10, clientY: 5 }));

    assert.ok(overlaySpy!.strokeCalls > before,
        'クリック確定後に overlay canvas が再描画されること');
    env.dom.window.close();
});

test('axes: 振幅軸ラベルが absolutePeak と unit から track-axis-canvas に描かれる', async () => {
    const env = setupEnvWithState(REAL_SCALE_AXIS_APP_STATE);
    await nextAnimationFrame(env.dom);

    const int16Spy = env.domCanvasContexts.get('track-axis-canvas-0');
    assert.ok(int16Spy, 'track-axis-canvas-0 のスパイが取得できること');
    assert.ok(int16Spy!.fillTextCalls.includes('+16383'), '+16383 ラベルが描かれること');
    assert.ok(int16Spy!.fillTextCalls.includes('-16383'), '-16383 ラベルが描かれること');
    assert.ok(int16Spy!.fillTextCalls.includes('0'), '0 ラベルが描かれること');
    assert.ok(int16Spy!.fillTextCalls.includes('Amp'), '単位なし Amp タイトルが描かれること');
    assert.ok(int16Spy!.fillRectCalls > 0, 'ラベル用の半透明バックプレートが描かれること');

    const paSpy = env.domCanvasContexts.get('track-axis-canvas-1');
    assert.ok(paSpy, 'track-axis-canvas-1 のスパイが取得できること');
    assert.ok(paSpy!.fillTextCalls.includes('+0.50'), '+0.50 ラベルが描かれること');
    assert.ok(paSpy!.fillTextCalls.includes('-0.50'), '-0.50 ラベルが描かれること');
    assert.ok(paSpy!.fillTextCalls.includes('Amp (Pa)'), 'Amp (Pa) タイトルが描かれること');
    env.dom.window.close();
});

test('snapshot: waveformPerTrack が absolutePeak と unit から生成される', async () => {
    const env = setupEnvWithState(REAL_SCALE_AXIS_APP_STATE);
    await nextAnimationFrame(env.dom);
    const snap = env.postedMessages
        .filter((msg: any) => msg.type === 'comparison-panel-test-snapshot')
        .at(-1) as any;

    assert.deepEqual(Array.from(snap.renderedUi.axisLabels.waveformPerTrack[0]), ['+16383', '0', '-16383', 'Amp']);
    assert.deepEqual(Array.from(snap.renderedUi.axisLabels.waveformPerTrack[1]), ['+0.50', '0', '-0.50', 'Amp (Pa)']);
    assert.equal((env.dom.window.document.getElementById('track-axis-canvas-0') as HTMLCanvasElement).width, 64);
    env.dom.window.close();
});

test('#100: buildTrackRow が track-axis-canvas を track-canvas の前に生成すること', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const doc = env.dom.window.document;
    const axisCanvas = doc.getElementById('track-axis-canvas-0');
    const waveCanvas = doc.getElementById('track-canvas-0');
    assert.ok(axisCanvas, 'track-axis-canvas-0 が DOM に存在すること');
    assert.ok(waveCanvas, 'track-canvas-0 が DOM に存在すること');
    const order = axisCanvas!.compareDocumentPosition(waveCanvas!);
    assert.ok(
        order & env.dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
        'track-axis-canvas-0 が track-canvas-0 より DOM 上で前にあること',
    );
    env.dom.window.close();
});

test('axes: スペクトログラム表示で周波数軸 (Hz) とカラーバー (dB) が描かれる', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const win = env.dom.window as any;
    const spectrogramBtn = env.dom.window.document.querySelector('[data-action="content-spectrogram"]') as HTMLButtonElement | null;
    assert.ok(spectrogramBtn, 'スペクトログラム切替ボタンが存在すること');
    spectrogramBtn.click();
    await nextAnimationFrame(env.dom);
    // フレーム駆動の再描画を待つ
    await new Promise((r) => win.setTimeout(r, 0));

    const axisSpy = env.domCanvasContexts.get('track-axis-canvas-0');
    assert.ok(axisSpy, 'track-axis-canvas-0 のスパイが取得できること');
    const axisLabels = axisSpy!.fillTextCalls;
    assert.ok(axisLabels.includes('0 Hz'), '0 Hz ラベルが描かれること: ' + JSON.stringify(axisLabels));
    assert.ok(
        axisLabels.some((s) => /\bkHz\b/.test(s) || /\bHz\b/.test(s)),
        'Hz または kHz の周波数ラベルが axis canvas に描かれること',
    );

    const spy = env.domCanvasContexts.get('track-canvas-0');
    assert.ok(spy, 'track-canvas-0 のスパイが取得できること');
    const labels = spy!.fillTextCalls;
    assert.ok(labels.some((s) => /\d+\s*dB$/.test(s)), 'カラーバーの dB ラベルが描かれること');
    assert.equal(labels.some((s) => /\bkHz\b/.test(s) || /\bHz\b/.test(s)), false, '周波数ラベルはプロット canvas に描かれないこと');
    assert.ok(spy!.putImageDataCalls >= 2,
        'プロット領域とカラーバーで putImageData が複数回呼ばれること');
    env.dom.window.close();
});

test('axes: スペクトル (per-track / overlay) に Hz と dB のラベルが描かれる', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);

    const trackSpy = env.domCanvasContexts.get('track-spectrum-0');
    assert.ok(trackSpy, 'track-spectrum-0 のスパイが取得できること');
    const trackLabels = trackSpy!.fillTextCalls;
    assert.ok(trackLabels.includes('0 Hz'), 'per-track: 0 Hz ラベルが描かれること');
    assert.ok(trackLabels.some((s) => /dB$/.test(s)), 'per-track: dB ラベルが描かれること');

    const overlaySpy = env.domCanvasContexts.get('spectrum-overlay-canvas');
    assert.ok(overlaySpy, 'overlay canvas のスパイが取得できること');
    const overlayLabels = overlaySpy!.fillTextCalls;
    assert.ok(overlayLabels.includes('0 Hz'), 'overlay: 0 Hz ラベルが描かれること');
    assert.ok(overlayLabels.some((s) => /dB$/.test(s)), 'overlay: dB ラベルが描かれること');
    assert.ok(
        overlayLabels.some((s) => s !== '0 Hz' && (/kHz$/.test(s) || /Hz$/.test(s))),
        'overlay: 0 以外の周波数ラベル (Hz/kHz) が描かれること: ' + JSON.stringify(overlayLabels),
    );
    env.dom.window.close();
});


test('spectrum cursor: per-track readout formats focused frequency in Hz', async () => {
    const env = setupHighFrequencyReadoutEnv();
    await nextAnimationFrame(env.dom);

    const canvas = env.dom.window.document.getElementById('track-spectrum-0') as HTMLCanvasElement | null;
    assert.ok(canvas, 'track-spectrum-0 が存在すること');
    Object.defineProperty(canvas, 'width', { configurable: true, value: 200 });
    Object.defineProperty(canvas, 'height', { configurable: true, value: 140 });
    canvas!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 140, width: 200, height: 140 } as DOMRect);

    canvas!.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 88, clientY: 30 }));
    await nextAnimationFrame(env.dom);

    const readout = env.dom.window.document.getElementById('spectrum-freq-readout');
    assert.ok(readout, 'spectrum-freq-readout が存在すること');
    assert.match(readout!.textContent || '', /^1200 Hz\s+-60\.0 dB$/,
        'カーソル読み値は kHz 省略ではなく Hz 固定で表示すること');
    assert.doesNotMatch(readout!.textContent || '', /kHz/);
    env.dom.window.close();
});


test('spectrum cursor: overlay readout formats focused frequency in Hz', async () => {
    const env = setupHighFrequencyReadoutEnv();
    await nextAnimationFrame(env.dom);

    const canvas = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    assert.ok(canvas, 'spectrum-overlay-canvas が存在すること');
    Object.defineProperty(canvas, 'width', { configurable: true, value: 200 });
    Object.defineProperty(canvas, 'height', { configurable: true, value: 140 });
    canvas!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 140, width: 200, height: 140 } as DOMRect);

    canvas!.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 88, clientY: 30 }));
    await nextAnimationFrame(env.dom);

    const readout = env.dom.window.document.getElementById('spectrum-freq-readout');
    assert.ok(readout, 'spectrum-freq-readout が存在すること');
    assert.match(readout!.textContent || '', /^1200 Hz\s+-60\.0 dB$/,
        'overlay のカーソル読み値も kHz 省略ではなく Hz 固定で表示すること');
    assert.doesNotMatch(readout!.textContent || '', /kHz/);
    env.dom.window.close();
});


test('spectrum cursor: per-track readout snaps to the hovered track frequency bin', async () => {
    const env = setupMismatchedDeltaFSpectrumEnv();
    await nextAnimationFrame(env.dom);

    const canvas = env.dom.window.document.getElementById('track-spectrum-0') as HTMLCanvasElement | null;
    assert.ok(canvas, 'track-spectrum-0 が存在すること');
    Object.defineProperty(canvas, 'width', { configurable: true, value: 200 });
    Object.defineProperty(canvas, 'height', { configurable: true, value: 140 });
    canvas!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 140, width: 200, height: 140 } as DOMRect);

    canvas!.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 88, clientY: 30 }));
    await nextAnimationFrame(env.dom);

    const readout = env.dom.window.document.getElementById('spectrum-freq-readout');
    assert.ok(readout, 'spectrum-freq-readout が存在すること');
    assert.match(readout!.textContent || '', /^200 Hz\s+-60\.0 dB$/,
        'coarse track ΔF=200 Hz の最寄りbinへ吸着すること');
    env.dom.window.close();
});


test('spectrum cursor: narrow canvas hover clears stale spectrum target', async () => {
    const env = setupMismatchedDeltaFSpectrumEnv();
    await nextAnimationFrame(env.dom);

    const trackCanvas = env.dom.window.document.getElementById('track-spectrum-0') as HTMLCanvasElement | null;
    assert.ok(trackCanvas, 'track-spectrum-0 が存在すること');
    Object.defineProperty(trackCanvas, 'width', { configurable: true, value: 200 });
    Object.defineProperty(trackCanvas, 'height', { configurable: true, value: 140 });
    trackCanvas!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 140, width: 200, height: 140 } as DOMRect);

    trackCanvas!.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 88, clientY: 30 }));
    await nextAnimationFrame(env.dom);

    const readout = env.dom.window.document.getElementById('spectrum-freq-readout');
    assert.match(readout!.textContent || '', /^200 Hz\s+-60\.0 dB$/,
        '事前条件としてper-track hoverのreadoutが表示されること');

    const overlayCanvas = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    assert.ok(overlayCanvas, 'spectrum-overlay-canvas が存在すること');
    Object.defineProperty(overlayCanvas, 'width', { configurable: true, value: 20 });
    Object.defineProperty(overlayCanvas, 'height', { configurable: true, value: 140 });
    overlayCanvas!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 20, bottom: 140, width: 20, height: 140 } as DOMRect);

    overlayCanvas!.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 30 }));
    await nextAnimationFrame(env.dom);

    assert.equal(readout!.textContent || '', '',
        'plot幅がないcanvasでは前のスペクトルhover対象を持ち越さないこと');
    env.dom.window.close();
});

test('spectrum cursor: overlay snaps to the nearest visible series bin when delta F differs', async () => {
    const env = setupMismatchedDeltaFSpectrumEnv();
    await nextAnimationFrame(env.dom);

    const canvas = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    assert.ok(canvas, 'spectrum-overlay-canvas が存在すること');
    Object.defineProperty(canvas, 'width', { configurable: true, value: 200 });
    Object.defineProperty(canvas, 'height', { configurable: true, value: 140 });
    canvas!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 140, width: 200, height: 140 } as DOMRect);

    canvas!.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 73, clientY: 52 }));
    await nextAnimationFrame(env.dom);

    const readout = env.dom.window.document.getElementById('spectrum-freq-readout');
    assert.ok(readout, 'spectrum-freq-readout が存在すること');
    assert.match(readout!.textContent || '', /^180 Hz\s+-35\.0 dB$/,
        'fine track ΔF=180 Hz の最寄りbinへ吸着すること');
    env.dom.window.close();
});


test('spectrum cursor: overlay remains snapped after frequency zoom changes the visible range', async () => {
    const env = setupMismatchedDeltaFSpectrumEnv();
    await nextAnimationFrame(env.dom);

    const canvas = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    assert.ok(canvas, 'spectrum-overlay-canvas が存在すること');
    Object.defineProperty(canvas, 'width', { configurable: true, value: 200 });
    Object.defineProperty(canvas, 'height', { configurable: true, value: 140 });
    canvas!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 140, width: 200, height: 140 } as DOMRect);

    canvas!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 100, clientY: 135 }));
    const minI = env.dom.window.document.getElementById('spec-range-min') as HTMLInputElement;
    const maxI = env.dom.window.document.getElementById('spec-range-max') as HTMLInputElement;
    minI.value = '100';
    maxI.value = '500';
    (env.dom.window.document.getElementById('spec-range-apply') as HTMLElement).click();
    await nextAnimationFrame(env.dom);

    canvas!.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 81, clientY: 52 }));
    await nextAnimationFrame(env.dom);

    const readout = env.dom.window.document.getElementById('spectrum-freq-readout');
    assert.ok(readout, 'spectrum-freq-readout が存在すること');
    assert.match(readout!.textContent || '', /^180 Hz\s+-35\.0 dB$/,
        '周波数ズーム後もfine trackの実binへ吸着すること');
    env.dom.window.close();
});

test('renderScript: spectrum canvases are redrawn during playback as cursor advances', async () => {
    // 回帰テスト: 再生中、カーソル位置が進むたびにスペクトル表示が更新されることを保証する。
    // 修正前は再生ループ tick で refreshSpectrumViews() が呼ばれず、
    // overlay / per-track のスペクトル canvas が再生中ずっと初期描画のままだった。
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);

    const overlaySpy = env.domCanvasContexts.get('spectrum-overlay-canvas');
    const trackSpy = env.domCanvasContexts.get('track-spectrum-0');
    assert.ok(overlaySpy, 'overlay canvas のスパイが取得できること');
    assert.ok(trackSpy, 'track-spectrum-0 のスパイが取得できること');

    const overlayBefore = overlaySpy!.strokeCalls;
    const trackBefore = trackSpy!.strokeCalls;
    const waveformSpy = env.domCanvasContexts.get('track-canvas-0');
    assert.ok(waveformSpy, 'track-canvas-0 のスパイが取得できること');
    const waveformBefore = waveformSpy!.clearRectCalls;

    const audio = env.dom.window.document.getElementById('track-audio-0') as HTMLAudioElement | null;
    const playButton = env.dom.window.document.querySelector('[data-action="toggle-playback"][data-track-index="0"]') as HTMLButtonElement | null;
    const stopButton = env.dom.window.document.querySelector('[data-action="stop-playback"][data-track-index="0"]') as HTMLButtonElement | null;
    assert.ok(audio instanceof env.dom.window.HTMLAudioElement);
    assert.ok(playButton instanceof env.dom.window.HTMLButtonElement);
    assert.ok(stopButton instanceof env.dom.window.HTMLButtonElement);

    (audio as HTMLAudioElement & { duration: number }).duration = 1;
    playButton!.click();
    await Promise.resolve();
    assert.equal(audio!.paused, false, '再生状態に切り替わっていること');

    // 再生位置を進めてから rAF tick を消化する。
    // tick は paused=false の間 refreshSpectrumViews() を呼び、各スペクトル canvas を再描画する。
    (audio as HTMLAudioElement & { currentTime: number }).currentTime = 0.5;
    await nextAnimationFrame(env.dom);
    await new Promise((resolve) => env.dom.window.setTimeout(resolve, 0));

    // すぐに停止してループを止める（rAF はループ内で再スケジュールされ続けるため）。
    stopButton!.click();

    assert.ok(waveformSpy!.clearRectCalls > waveformBefore,
        '再生中の tick で waveform canvas が再描画され、カーソル線が進むこと '
        + '(before=' + waveformBefore + ', after=' + waveformSpy!.clearRectCalls + ')');
    assert.ok(overlaySpy!.strokeCalls > overlayBefore,
        '再生中の tick で overlay spectrum が再描画されること '
        + '(before=' + overlayBefore + ', after=' + overlaySpy!.strokeCalls + ')');
    assert.ok(trackSpy!.strokeCalls > trackBefore,
        '再生中の tick で per-track spectrum が再描画されること '
        + '(before=' + trackBefore + ', after=' + trackSpy!.strokeCalls + ')');
    env.dom.window.close();
});

test('renderScript: playback spectrum refresh is throttled and then catches up', async () => {
    const clock = { now: 1000 };
    const env = setupSpectrumEnvWithClock(clock);
    await nextAnimationFrame(env.dom);

    const overlaySpy = env.domCanvasContexts.get('spectrum-overlay-canvas');
    assert.ok(overlaySpy, 'overlay canvas のスパイが取得できること');

    const audio = env.dom.window.document.getElementById('track-audio-0') as HTMLAudioElement | null;
    const playButton = env.dom.window.document.querySelector('[data-action="toggle-playback"][data-track-index="0"]') as HTMLButtonElement | null;
    const stopButton = env.dom.window.document.querySelector('[data-action="stop-playback"][data-track-index="0"]') as HTMLButtonElement | null;
    assert.ok(audio instanceof env.dom.window.HTMLAudioElement);
    assert.ok(playButton instanceof env.dom.window.HTMLButtonElement);
    assert.ok(stopButton instanceof env.dom.window.HTMLButtonElement);

    (audio as HTMLAudioElement & { duration: number }).duration = 1;
    playButton.click();
    await Promise.resolve();
    await nextAnimationFrame(env.dom);

    const afterStart = overlaySpy!.clearRectCalls;
    clock.now = 1001;
    (audio as HTMLAudioElement & { currentTime: number }).currentTime = 0.2;
    await nextAnimationFrame(env.dom);
    assert.equal(overlaySpy!.clearRectCalls, afterStart,
        '66ms 未満の playback tick では spectrum 再描画を増やさないこと');

    clock.now = 1070;
    (audio as HTMLAudioElement & { currentTime: number }).currentTime = 0.5;
    await nextAnimationFrame(env.dom);
    await nextAnimationFrame(env.dom);
    assert.ok(overlaySpy!.clearRectCalls > afterStart,
        '66ms 経過後の playback tick では spectrum が再描画されること');

    stopButton.click();
    env.dom.window.close();
});

test('renderScript: spectrum hover mousemoves are coalesced to one animation frame', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);

    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    const overlaySpy = env.domCanvasContexts.get('spectrum-overlay-canvas');
    assert.ok(overlay instanceof env.dom.window.HTMLCanvasElement);
    assert.ok(overlaySpy, 'overlay canvas のスパイが取得できること');

    const before = overlaySpy!.clearRectCalls;
    overlay.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 20 }));
    overlay.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 22 }));
    overlay.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 140, clientY: 24 }));
    assert.equal(overlaySpy!.clearRectCalls, before,
        'mousemove handler 内では同期的に spectrum を再描画しないこと');

    await nextAnimationFrame(env.dom);
    assert.equal(overlaySpy!.clearRectCalls, before + 1,
        '同一フレーム内の mousemove 連打は 1 回の spectrum 更新に畳まれること');
    env.dom.window.close();
});


// ── Offset direct edit ────────────────────────────────────────────────────────

/** オフセット編集テスト用: setTimeout を即時実行に差し替えて 200ms 待ちを不要にする */
function withSyncTimeout(env: ReturnType<typeof setupEnv>, fn: () => void) {
    const orig = env.dom.window.setTimeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (env.dom.window as any).setTimeout = (cb: () => void) => { cb(); return 0; };
    try { fn(); } finally { (env.dom.window as any).setTimeout = orig; }
}

test('renderScript: click .track-offset-val opens inline input', () => {
    const env = setupEnv();
    const span = env.dom.window.document.querySelector('.track-offset-val') as HTMLElement | null;
    assert.ok(span, '.track-offset-val span が存在すること');

    withSyncTimeout(env, () => {
        span!.dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    });

    const input = span!.parentNode?.querySelector('input.track-offset-input') as HTMLInputElement | null;
    assert.ok(input, 'クリック後に .track-offset-input input が挿入されること');
    assert.equal(span!.style.display, 'none', 'クリック後に span が非表示になること');
    env.dom.window.close();
});

test('renderScript: Enter commits inline offset edit', () => {
    const env = setupEnv();
    const span = env.dom.window.document.querySelector('.track-offset-val') as HTMLElement | null;
    assert.ok(span, '.track-offset-val span が存在すること');

    withSyncTimeout(env, () => {
        span!.dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    });

    const input = span!.parentNode?.querySelector('input.track-offset-input') as HTMLInputElement | null;
    assert.ok(input, 'input が挿入されること');

    input!.value = '500';
    input!.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    assert.ok(!span!.parentNode?.querySelector('input.track-offset-input'), 'Enter 後に input が削除されること');
    assert.equal(span!.style.display, '', 'Enter 後に span が再表示されること');
    env.dom.window.close();
});

test('renderScript: Escape cancels inline offset edit', () => {
    const env = setupEnv();
    const span = env.dom.window.document.querySelector('.track-offset-val') as HTMLElement | null;
    assert.ok(span, '.track-offset-val span が存在すること');

    const originalText = span!.textContent;
    withSyncTimeout(env, () => {
        span!.dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    });

    const input = span!.parentNode?.querySelector('input.track-offset-input') as HTMLInputElement | null;
    assert.ok(input, 'input が挿入されること');

    input!.value = '9999';
    input!.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));

    assert.ok(!span!.parentNode?.querySelector('input.track-offset-input'), 'Escape 後に input が削除されること');
    assert.equal(span!.style.display, '', 'Escape 後に span が再表示されること');
    assert.equal(span!.textContent, originalText, 'Escape 後に span のテキストが変化しないこと');
    env.dom.window.close();
});

// ── Export PNG / CSV ──────────────────────────────────────────────────────────

test('renderScript: export-png button does not throw', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const btn = env.dom.window.document.querySelector('[data-action="export-png"]') as HTMLButtonElement | null;
    assert.ok(btn, '[data-action="export-png"] ボタンが存在すること');
    assert.doesNotThrow(() => { btn!.click(); }, 'export-png クリックが例外を投げないこと');
    env.dom.window.close();
});

test('renderScript: export-csv button does not throw', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const btn = env.dom.window.document.querySelector('[data-action="export-csv"]') as HTMLButtonElement | null;
    assert.ok(btn, '[data-action="export-csv"] ボタンが存在すること');
    assert.doesNotThrow(() => { btn!.click(); }, 'export-csv クリックが例外を投げないこと');
    env.dom.window.close();
});

test('renderScript: export-csv creates a download anchor with data URI', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);

    const created: HTMLAnchorElement[] = [];
    const origCreate = env.dom.window.document.createElement.bind(env.dom.window.document);
    env.dom.window.document.createElement = function(tag: string) {
        const el = origCreate(tag);
        if (tag === 'a') { created.push(el as HTMLAnchorElement); }
        return el;
    } as typeof document.createElement;

    try {
        env.dom.window.document.querySelector('[data-action="export-csv"]')?.dispatchEvent(
            new env.dom.window.MouseEvent('click', { bubbles: true }),
        );

        const anchor = created.find((a) => a.download === 'spectrum-export.csv');
        assert.ok(anchor, 'spectrum-export.csv という download 属性を持つ <a> が作られること');
        assert.ok(anchor!.href.startsWith('data:text/csv'), 'href が data:text/csv URI であること');
    } finally {
        env.dom.window.document.createElement = origCreate;
        env.dom.window.close();
    }
});

test('renderScript: multichannel track UI labels the displayed channel', async () => {
    const env = setupMultichannelEnv();
    await nextAnimationFrame(env.dom);

    const rowText = env.dom.window.document.querySelector('#track-row-0')?.textContent || '';
    assert.match(rowText, /Displayed: Channel 1 \/ 2 \(Left\)/);
    assert.match(rowText, /RMS \(Channel 1 \/ 2 \(Left\)\): -20\.0 dBFS/);
    assert.doesNotMatch(rowText, /Right/);

    const metricsText = env.dom.window.document.querySelector('#metrics-item-0')?.textContent || '';
    assert.match(metricsText, /stereo\.wav \[Channel 1 \/ 2 \(Left\)\]: RMS -20\.0 dBFS \/ Peak -6\.0 dBFS \/ 440 Hz/);
    env.dom.window.close();
});

function decodeDataUriPayload(uri: string): string {
    const comma = uri.indexOf(',');
    assert.ok(comma >= 0, 'data URI に payload があること');
    return decodeURIComponent(uri.slice(comma + 1));
}

test('renderScript: multichannel CSV names the displayed spectrum channel', async () => {
    const env = setupMultichannelEnv();
    await nextAnimationFrame(env.dom);

    const created: HTMLAnchorElement[] = [];
    const origCreate = env.dom.window.document.createElement.bind(env.dom.window.document);
    env.dom.window.document.createElement = function(tag: string) {
        const el = origCreate(tag);
        if (tag === 'a') { created.push(el as HTMLAnchorElement); }
        return el;
    } as typeof document.createElement;

    try {
        env.dom.window.document.querySelector('[data-action="export-csv"]')?.dispatchEvent(
            new env.dom.window.MouseEvent('click', { bubbles: true }),
        );

        const anchor = created.find((a) => a.download === 'spectrum-export.csv');
        assert.ok(anchor, 'CSV download anchor が作られること');
        const csv = decodeDataUriPayload(anchor!.href);
        assert.equal(csv.split('\n')[0], 'frequency_hz,stereo.wav Channel 1 / 2 (Left) Spectrum level [dB]');
        assert.doesNotMatch(csv, /Right/);
    } finally {
        env.dom.window.document.createElement = origCreate;
        env.dom.window.close();
    }
});

test('renderScript: multichannel report names the displayed RMS peak and spectrum channel', async () => {
    const env = setupMultichannelEnv();
    await nextAnimationFrame(env.dom);

    env.dom.window.document.querySelector('[data-action="export-report"]')?.dispatchEvent(
        new env.dom.window.MouseEvent('click', { bubbles: true }),
    );

    const msg = env.postedMessages.find((posted: any) => posted.type === 'export-report-options') as any;
    assert.ok(msg, 'report export message が送信されること');
    assert.match(msg.markdownContent, /\| File \| Sample Rate \| Duration \| Channels \| Displayed Channel \| RMS \| Peak \|/);
    assert.match(msg.markdownContent, /\| stereo\.wav \| 44100 Hz \| 1\.000s \| 2 \| Channel 1 \/ 2 \(Left\) \| -20\.0 dBFS \| -6\.0 dBFS \|/);
    assert.match(msg.markdownContent, /## Spectral Peaks \(first track, Channel 1 \/ 2 \(Left\)\)/);
    assert.match(msg.markdownContent, /\| 440\.0 \| -12\.0 \|/);
    assert.doesNotMatch(msg.markdownContent, /Right/);
    assert.doesNotMatch(msg.markdownContent, /880\.0/);
    env.dom.window.close();
});

test('renderScript: multichannel report sanitizes displayed channel markdown', async () => {
    const state = JSON.parse(MULTICHANNEL_APP_STATE);
    state.results[0].channels[0].label = 'Left | unsafe\n## injected';
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);

    env.dom.window.document.querySelector('[data-action="export-report"]')?.dispatchEvent(
        new env.dom.window.MouseEvent('click', { bubbles: true }),
    );

    const msg = env.postedMessages.find((posted: any) => posted.type === 'export-report-options') as any;
    assert.ok(msg, 'report export message が送信されること');
    assert.match(msg.markdownContent, /Channel 1 \/ 2 \(Left \\| unsafe ## injected\)/);
    assert.doesNotMatch(msg.markdownContent, /\n## injected/);
    env.dom.window.close();
});

test('renderScript: loop report uses global timeline and per-track local ranges with offsets', async () => {
    const state = JSON.parse(MULTICHANNEL_APP_STATE);
    const lateTrack = JSON.parse(JSON.stringify(state.results[0]));
    lateTrack.filePath = '/tmp/late.wav';
    lateTrack.fileName = 'late | unsafe\n`tick`.wav';
    lateTrack.audioSource = 'vscode-resource:/tmp/late.wav';
    state.results.push(lateTrack);
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
        data: {
            type: 'comparison-panel-test-action',
            actionId: 'loop-report-offsets',
            actions: [
                { action: 'set-track-offset', trackIndex: 1, payload: { offsetSeconds: 2 } },
                { action: 'set-loop-region', payload: { start: 0.5, end: 0.75 } },
            ],
        },
    }));
    await nextAnimationFrame(env.dom);

    env.dom.window.document.querySelector('[data-action="export-report"]')?.dispatchEvent(
        new env.dom.window.MouseEvent('click', { bubbles: true }),
    );

    const msg = env.postedMessages.find((posted: any) => posted.type === 'export-report-options') as any;
    assert.ok(msg, 'report export message が送信されること');
    assert.match(msg.markdownContent, /- Time basis: global comparison timeline \(offset-adjusted\)/);
    assert.match(msg.markdownContent, /- Global Start: 1\.500 s/);
    assert.match(msg.markdownContent, /- Global End: 2\.250 s/);
    assert.match(msg.markdownContent, /\| Track \| Offset \| Local Start \| Local End \| Local Duration \| Status \|/);
    assert.match(msg.markdownContent, /\| stereo\.wav \| 0\.000 s \| - \| - \| - \| Out of range \|/);
    assert.match(msg.markdownContent, /\| late [\\]\| unsafe `tick`\.wav \| 2\.000 s \| 0\.000 s \| 0\.250 s \| 0\.250 s \| Partial \|/);
    assert.doesNotMatch(msg.markdownContent, /- Start: 0\.500 s/);
    env.dom.window.close();
});

// ── Zoom-to-Selection (⇔) & F/L shortcuts ────────────────────────────────────

test('renderScript: zoom-to-selection ボタンがツールバーに存在すること', () => {
    const env = setupEnv();
    const btn = env.dom.window.document.querySelector('[data-action="zoom-to-selection"]') as HTMLButtonElement | null;
    assert.ok(btn, '[data-action="zoom-to-selection"] ボタンが存在すること');
    env.dom.window.close();
});

test('renderScript: zoom-to-selection ボタンはループがない状態で disabled であること', () => {
    const env = setupEnv();
    const btn = env.dom.window.document.querySelector('[data-action="zoom-to-selection"]') as HTMLButtonElement | null;
    assert.ok(btn, '[data-action="zoom-to-selection"] ボタンが存在すること');
    assert.equal(btn!.disabled, true, 'ループがない場合は disabled であること');
    env.dom.window.close();
});

test('renderScript: F キーで follow-cursor ボタンの is-active が切り替わること', () => {
    const env = setupEnv();
    const followBtn = env.dom.window.document.querySelector('[data-action="toggle-follow-cursor"]') as HTMLButtonElement | null;
    assert.ok(followBtn, '[data-action="toggle-follow-cursor"] ボタンが存在すること');
    assert.equal(followBtn!.classList.contains('is-active'), false, '初期状態は非アクティブであること');

    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f' }),
    );
    assert.equal(followBtn!.classList.contains('is-active'), true, 'F キー後に is-active になること');

    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f' }),
    );
    assert.equal(followBtn!.classList.contains('is-active'), false, 'F キー再押しで is-active が解除されること');
    env.dom.window.close();
});

test('renderScript: L キーはループがある場合に zoom-to-selection を実行すること', async () => {
    const env = setupEnv();
    const canvas = env.dom.window.document.getElementById('track-canvas-0') as HTMLCanvasElement | null;
    assert.ok(canvas, 'track-canvas-0 が存在すること');

    // ループ区間をドラッグで作成（MouseEvent で loopRegion を設定する）
    canvas!.dispatchEvent(new env.dom.window.MouseEvent('mousedown', { bubbles: true, clientX: 50, clientY: 5, buttons: 1 }));
    env.dom.window.document.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 5, buttons: 1 }));
    env.dom.window.document.dispatchEvent(new env.dom.window.MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 5 }));

    const zoomBtn = env.dom.window.document.querySelector('[data-action="zoom-to-selection"]') as HTMLButtonElement | null;
    assert.ok(zoomBtn, '[data-action="zoom-to-selection"] ボタンが存在すること');
    // ループ作成後は disabled が解除されていることを検証
    assert.equal(zoomBtn!.disabled, false, 'ループ作成後は zoom-to-selection ボタンが enabled になること');

    // follow-cursor を一旦有効化しておく
    const followBtn = env.dom.window.document.querySelector('[data-action="toggle-follow-cursor"]') as HTMLButtonElement | null;
    assert.ok(followBtn, 'follow-cursor ボタンが存在すること');
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f' }),
    );
    assert.equal(followBtn!.classList.contains('is-active'), true, 'follow-cursor が有効になっていること');

    // L キーを押下して zoom-to-selection を実行
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'l' }),
    );

    // 副作用の検証 1: follow-cursor が無効化されること
    assert.equal(followBtn!.classList.contains('is-active'), false, 'zoom-to-selection により follow-cursor が無効化されること');

    // テストスナップショットの送信を要求する
    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: {
                type: 'comparison-panel-test-action',
                actions: [],
                actionId: 'test-l-key-snapshot'
            }
        })
    );
    await nextAnimationFrame(env.dom);

    // 副作用の検証 2: ズーム範囲が更新されていること
    const snapshots = env.postedMessages.filter((msg: any) => msg.type === 'comparison-panel-test-snapshot');
    const lastSnapshot = snapshots[snapshots.length - 1] as any;
    assert.ok(lastSnapshot, 'テストスナップショットが送信されていること');
    const ui = lastSnapshot.renderedUi;
    assert.ok(ui, 'スナップショットに renderedUi が含まれること');
    assert.ok(ui.zoomStart >= 0, 'zoomStart は 0 以上であること');
    assert.ok(ui.zoomEnd <= 1, 'zoomEnd は 1 以下であること');
    assert.ok(ui.zoomStart < ui.zoomEnd, 'zoomStart < zoomEnd であること');

    env.dom.window.close();
});

test('renderScript: ショートカットキーは修飾キー (Ctrl/Meta/Alt) が押されている場合は動作しないこと', () => {
    const env = setupEnv();
    const followBtn = env.dom.window.document.querySelector('[data-action="toggle-follow-cursor"]') as HTMLButtonElement | null;
    assert.ok(followBtn, '[data-action="toggle-follow-cursor"] ボタンが存在すること');
    assert.equal(followBtn!.classList.contains('is-active'), false, '初期状態は非アクティブであること');

    // Ctrl+F を押下
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f', ctrlKey: true }),
    );
    assert.equal(followBtn!.classList.contains('is-active'), false, 'Ctrl+F キーでは is-active にならないこと');

    // Alt+F を押下
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f', altKey: true }),
    );
    assert.equal(followBtn!.classList.contains('is-active'), false, 'Alt+F キーでは is-active にならないこと');

    // Meta+F を押下
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f', metaKey: true }),
    );
    assert.equal(followBtn!.classList.contains('is-active'), false, 'Meta+F キーでは is-active にならないこと');

    env.dom.window.close();
});


test('renderScript: 修飾キーなし wheel はトラック領域の標準スクロールに渡すこと', async () => {
    const env = setupEnv();
    const wrapper = env.dom.window.document.getElementById('tracks-wrapper') as HTMLElement | null;
    assert.ok(wrapper, '#tracks-wrapper が存在すること');

    const event = new env.dom.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 120,
    });
    const wasNotCanceled = wrapper!.dispatchEvent(event);

    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: { type: 'comparison-panel-test-action', actions: [], actionId: 'plain-wheel-snapshot' },
        }),
    );
    await nextAnimationFrame(env.dom);
    const snapshots = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot');
    const snap = (snapshots[snapshots.length - 1] as any)?.renderedUi;

    assert.equal(wasNotCanceled, true, '標準 wheel は preventDefault されないこと');
    assert.equal(event.defaultPrevented, false, '標準 wheel はブラウザの縦スクロールに渡ること');
    assert.ok(snap, 'wheel 後のスナップショットが存在すること');
    assert.strictEqual(snap.zoomStart, 0, '標準 wheel では zoomStart が変わらないこと');
    assert.strictEqual(snap.zoomEnd, 1, '標準 wheel では zoomEnd が変わらないこと');

    env.dom.window.close();
});

test('renderScript: Ctrl+wheel は従来どおり波形ズームを実行すること', async () => {
    const env = setupEnv();
    const wrapper = env.dom.window.document.getElementById('tracks-wrapper') as HTMLElement | null;
    assert.ok(wrapper, '#tracks-wrapper が存在すること');

    const event = new env.dom.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -120,
    });
    const wasNotCanceled = wrapper!.dispatchEvent(event);

    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: { type: 'comparison-panel-test-action', actions: [], actionId: 'ctrl-wheel-snapshot' },
        }),
    );
    await nextAnimationFrame(env.dom);
    const snapshots = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot');
    const snap = (snapshots[snapshots.length - 1] as any)?.renderedUi;

    assert.equal(wasNotCanceled, false, 'Ctrl+wheel は preventDefault されること');
    assert.equal(event.defaultPrevented, true, 'Ctrl+wheel は標準スクロールへ渡さないこと');
    assert.ok(snap, 'Ctrl+wheel 後のスナップショットが存在すること');
    assert.ok(snap.zoomStart > 0 || snap.zoomEnd < 1, 'Ctrl+wheel で zoomStart/zoomEnd が変化すること');

    env.dom.window.close();
});

test('スペクトルズームツールバーのボタンが生成される', () => {
    const { dom } = setupEnv();
    const zoomIn  = dom.window.document.querySelector('[data-action="spec-zoom-in"]');
    const zoomOut = dom.window.document.querySelector('[data-action="spec-zoom-out"]');
    const reset   = dom.window.document.querySelector('[data-action="spec-zoom-reset"]');
    assert.ok(zoomIn,  'spec-zoom-in ボタンが存在すること');
    assert.ok(zoomOut, 'spec-zoom-out ボタンが存在すること');
    assert.ok(reset,   'spec-zoom-reset ボタンが存在すること');
});


test('高さ調整UIは数値入力とリセットボタンだけをツールバーに生成する', () => {
    const { dom } = setupEnv();
    assert.ok(dom.window.document.querySelector('[data-action="track-height-input"]'));
    assert.ok(dom.window.document.querySelector('[data-action="track-height-reset"]'));
    assert.ok(dom.window.document.querySelector('[data-action="spectrum-height-input"]'));
    assert.ok(dom.window.document.querySelector('[data-action="spectrum-height-reset"]'));
    assert.equal(dom.window.document.querySelector('[data-action="track-height-down"]'), null);
    assert.equal(dom.window.document.querySelector('[data-action="track-height-up"]'), null);
    assert.equal(dom.window.document.querySelector('[data-action="spectrum-height-down"]'), null);
    assert.equal(dom.window.document.querySelector('[data-action="spectrum-height-up"]'), null);
});


test('トラック高さはヘッダー実寸より低くならない', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);

    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: {
                type: 'comparison-panel-test-action',
                inputValues: { 'track-height-input': '48' },
                actionId: 'height-input-min',
            },
        }),
    );
    await nextAnimationFrame(env.dom);

    const trackCanvas = env.dom.window.document.getElementById('track-canvas-0') as HTMLCanvasElement | null;
    assert.ok(trackCanvas);
    assert.strictEqual(trackCanvas.height, 80);

    const snap = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot').at(-1) as any;
    assert.strictEqual(snap?.renderedUi?.trackHeight, 80);

    env.dom.window.close();
});


test('高さの数値入力がトラックとパワースペクトルの canvas 高さを変更する', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);

    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: {
                type: 'comparison-panel-test-action',
                inputValues: {
                    'track-height-input': '112',
                    'spectrum-height-input': '180',
                },
                actionId: 'height-input',
            },
        }),
    );
    await nextAnimationFrame(env.dom);

    const trackCanvas = env.dom.window.document.getElementById('track-canvas-0') as HTMLCanvasElement | null;
    const trackSpectrumCanvas = env.dom.window.document.getElementById('track-spectrum-0') as HTMLCanvasElement | null;
    const overlayCanvas = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    assert.ok(trackCanvas);
    assert.ok(trackSpectrumCanvas);
    assert.ok(overlayCanvas);
    assert.strictEqual(trackCanvas.height, 112);
    assert.strictEqual(trackSpectrumCanvas.height, 112);
    assert.strictEqual(overlayCanvas.height, 180);

    const snap1 = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot').at(-1) as any;
    assert.strictEqual(snap1?.renderedUi?.trackHeight, 112);
    assert.strictEqual(snap1?.renderedUi?.spectrumOverlayHeight, 180);

    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: {
                type: 'comparison-panel-test-action',
                actions: ['track-height-reset', 'spectrum-height-reset'],
                actionId: 'height-reset',
            },
        }),
    );
    await nextAnimationFrame(env.dom);

    assert.strictEqual(trackCanvas.height, 80);
    assert.strictEqual(trackSpectrumCanvas.height, 80);
    assert.strictEqual(overlayCanvas.height, 140);

    env.dom.window.close();
});


test('高さリサイズハンドルのドラッグがトラックとパワースペクトルの高さを変更する', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);

    const trackHandle = env.dom.window.document.querySelector('[data-action="track-height-drag"]') as HTMLElement | null;
    assert.ok(trackHandle);
    const spectrumHandle = env.dom.window.document.querySelector('[data-action="spectrum-height-drag"]') as HTMLElement | null;
    assert.ok(spectrumHandle);

    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: {
                type: 'comparison-panel-test-action',
                actions: [
                    { action: 'resize-height-drag', payload: { kind: 'track', startY: 100, endY: 124 } },
                    { action: 'resize-height-drag', payload: { kind: 'spectrum', startY: 200, endY: 170 } },
                ],
                actionId: 'height-drag',
            },
        }),
    );
    await nextAnimationFrame(env.dom);

    const trackCanvas = env.dom.window.document.getElementById('track-canvas-0') as HTMLCanvasElement | null;
    const overlayCanvas = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    assert.ok(trackCanvas);
    assert.ok(overlayCanvas);
    assert.strictEqual(trackCanvas.height, 104);
    assert.strictEqual(overlayCanvas.height, 170);

    const snap = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot').at(-1) as any;
    assert.strictEqual(snap?.renderedUi?.trackHeight, 104);
    assert.strictEqual(snap?.renderedUi?.spectrumOverlayHeight, 170);

    env.dom.window.close();
});


test('波形モードボタンが生成される', () => {
    const { dom } = setupEnv();
    const rectZoomBtn = dom.window.document.querySelector('[data-action="wave-mode-rect-zoom"]');
    assert.ok(rectZoomBtn, 'wave-mode-rect-zoom ボタンが存在すること');
    assert.strictEqual(
        dom.window.document.querySelector('[data-action="wave-mode-loop"]'),
        null,
        'wave-mode-loop ボタンは存在しないこと',
    );
});

test('wave-mode-rect-zoom ボタンがトグル動作すること', async () => {
    const env = setupEnv();
    const btn = env.dom.window.document.querySelector('[data-action="wave-mode-rect-zoom"]') as HTMLButtonElement | null;
    assert.ok(btn, 'wave-mode-rect-zoom ボタンが存在すること');

    // 初期状態: aria-pressed=false, waveformMode=loop
    assert.strictEqual(btn!.getAttribute('aria-pressed'), 'false', '初期状態の aria-pressed は false であること');

    // 1 回目クリック → rect-zoom に切り替わること
    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: { type: 'comparison-panel-test-action', actions: ['wave-mode-rect-zoom'], actionId: 'toggle-on' },
        }),
    );
    await nextAnimationFrame(env.dom);

    const snap1 = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot').at(-1) as any;
    assert.strictEqual(snap1?.renderedUi?.waveformMode, 'rect-zoom', '1 回目クリック後に waveformMode が rect-zoom になること');
    assert.strictEqual(btn!.getAttribute('aria-pressed'), 'true',  '1 回目クリック後に aria-pressed が true になること');

    // 2 回目クリック → loop に戻ること
    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: { type: 'comparison-panel-test-action', actions: ['wave-mode-rect-zoom'], actionId: 'toggle-off' },
        }),
    );
    await nextAnimationFrame(env.dom);

    const snap2 = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot').at(-1) as any;
    assert.strictEqual(snap2?.renderedUi?.waveformMode, 'loop',     '2 回目クリック後に waveformMode が loop に戻ること');
    assert.strictEqual(btn!.getAttribute('aria-pressed'), 'false', '2 回目クリック後に aria-pressed が false に戻ること');

    env.dom.window.close();
});

test('初期スペクトルズーム状態が全域である', async () => {
    const { dom, postedMessages } = setupEnv();
    await nextAnimationFrame(dom);
    const snapMsg = postedMessages.find((m: any) => m.type === 'comparison-panel-test-snapshot') as any;
    assert.ok(snapMsg, 'スナップショットメッセージが送信されること');
    assert.strictEqual(snapMsg.renderedUi.specFreqStart, 0,      'specFreqStart の初期値が 0 であること');
    assert.strictEqual(snapMsg.renderedUi.specFreqEnd,   1,      'specFreqEnd の初期値が 1 であること');
    assert.strictEqual(snapMsg.renderedUi.waveformMode,  'loop', 'waveformMode の初期値が loop であること');
});

test('renderScript: 波形キャンバスの dblclick でズームがリセットされる', async () => {
    const env = setupEnv();

    // '+' キーでズームイン（zoomStart/zoomEnd が変化する）
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: '+' }),
    );

    // スナップショットを要求してズームが変化したことを確認
    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: { type: 'comparison-panel-test-action', actions: [], actionId: 'pre-dblclick' },
        }),
    );
    await nextAnimationFrame(env.dom);
    const snapshots1 = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot');
    const pre = (snapshots1[snapshots1.length - 1] as any)?.renderedUi;
    assert.ok(pre, 'ズームイン後のスナップショットが存在すること');
    assert.ok(pre.zoomStart > 0 || pre.zoomEnd < 1, 'ズームイン後は zoomStart/zoomEnd が変化していること');

    // .track-canvas への dblclick でリセット
    const canvas = env.dom.window.document.querySelector('.track-canvas') as HTMLElement | null;
    assert.ok(canvas, '.track-canvas が存在すること');
    canvas!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true }));

    // スナップショットを再要求
    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: { type: 'comparison-panel-test-action', actions: [], actionId: 'post-dblclick' },
        }),
    );
    await nextAnimationFrame(env.dom);
    const snapshots2 = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot');
    const post = (snapshots2[snapshots2.length - 1] as any)?.renderedUi;
    assert.ok(post, 'dblclick 後のスナップショットが存在すること');
    assert.strictEqual(post.zoomStart, 0, 'dblclick 後 zoomStart が 0 になること');
    assert.strictEqual(post.zoomEnd,   1, 'dblclick 後 zoomEnd が 1 になること');

    env.dom.window.close();
});

test('renderScript: 軸キャンバスの dblclick でもズームがリセットされる', async () => {
    const env = setupEnv();

    // '+' キーでズームイン
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: '+' }),
    );

    // ズームイン後スナップショット
    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: { type: 'comparison-panel-test-action', actions: [], actionId: 'pre-axis-dblclick' },
        }),
    );
    await nextAnimationFrame(env.dom);
    const snapshots1 = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot');
    const pre = (snapshots1[snapshots1.length - 1] as any)?.renderedUi;
    assert.ok(pre && (pre.zoomStart > 0 || pre.zoomEnd < 1), 'ズームイン後は zoomStart/zoomEnd が変化していること');

    // .track-axis-canvas への dblclick でリセット
    const axisCanvas = env.dom.window.document.querySelector('.track-axis-canvas') as HTMLElement | null;
    assert.ok(axisCanvas, '.track-axis-canvas が存在すること');
    axisCanvas!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true }));

    // dblclick 後スナップショット
    env.dom.window.dispatchEvent(
        new env.dom.window.MessageEvent('message', {
            data: { type: 'comparison-panel-test-action', actions: [], actionId: 'post-axis-dblclick' },
        }),
    );
    await nextAnimationFrame(env.dom);
    const snapshots2 = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot');
    const post = (snapshots2[snapshots2.length - 1] as any)?.renderedUi;
    assert.ok(post, 'dblclick 後のスナップショットが存在すること');
    assert.strictEqual(post.zoomStart, 0, '軸 dblclick 後 zoomStart が 0 になること');
    assert.strictEqual(post.zoomEnd,   1, '軸 dblclick 後 zoomEnd が 1 になること');

    env.dom.window.close();
});
// NOTE: jsdom テスト env (createWebviewEnv) は __APP_STRINGS__ を注入しないため
// STR={} となり badge/error の textContent は空になる。そのため文字列ではなく
// popover の表示状態・入力プリフィル・Apply による state 反映（snapshot の
// axisLabels.spectrumOverlay = [maxDb,midDb,minDb,fMin,fMid,fMax]）で検証する。
function latestSpectrumOverlayLabels(env: ReturnType<typeof setupEnv>): string[] | null {
    const snaps = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot');
    const ui = (snaps[snaps.length - 1] as any)?.renderedUi;
    return ui?.axisLabels?.spectrumOverlay ?? null;
}
function requestSpectrumSnapshot(env: ReturnType<typeof setupEnv>, actionId: string): void {
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
        data: { type: 'comparison-panel-test-action', actions: [], actionId: actionId },
    }));
}

test('spectrum overlay: Y軸(dB) dblclick → popover が開き dB レンジを適用できる', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLElement | null;
    assert.ok(overlay, 'overlay canvas が存在すること');
    // Y軸ゾーン: cx < padL(36) → clientX=10
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 70 }));
    const pop = env.dom.window.document.getElementById('spectrum-range-popover') as HTMLElement;
    assert.ok(pop, 'popover が存在すること');
    assert.notStrictEqual(pop.style.display, 'none', 'popover が表示されること');
    const minI = env.dom.window.document.getElementById('spec-range-min') as HTMLInputElement;
    const maxI = env.dom.window.document.getElementById('spec-range-max') as HTMLInputElement;
    minI.value = '-80'; maxI.value = '-20';
    (env.dom.window.document.getElementById('spec-range-apply') as HTMLElement).click();
    assert.strictEqual(pop.style.display, 'none', 'Apply 後に popover が閉じること');
    requestSpectrumSnapshot(env, 'after-db-apply');
    await nextAnimationFrame(env.dom);
    const labels = latestSpectrumOverlayLabels(env);
    assert.ok(labels && labels.length >= 3, 'overlay 軸ラベルが存在すること');
    assert.strictEqual(labels![0], '-20 dB', 'dB Max ラベルが適用値になること');
    assert.strictEqual(labels![2], '-80 dB', 'dB Min ラベルが適用値になること');
    env.dom.window.close();
});

test('spectrum overlay: X軸(周波数) dblclick → popover が開き Hz レンジを適用できる', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    assert.ok(overlay, 'overlay canvas が存在すること');
    const H = overlay!.height || 140;
    const W = overlay!.width || 800;
    // X軸ゾーン: cy > H-padB(18) かつ cx ∈ [36, W-8]
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: Math.floor(W / 2), clientY: H - 5 }));
    const pop = env.dom.window.document.getElementById('spectrum-range-popover') as HTMLElement;
    assert.notStrictEqual(pop.style.display, 'none', 'popover が表示されること');
    const minI = env.dom.window.document.getElementById('spec-range-min') as HTMLInputElement;
    const maxI = env.dom.window.document.getElementById('spec-range-max') as HTMLInputElement;
    // freq 軸プリフィル: Min は全域開始の "0"（dB 軸と区別できる）
    assert.strictEqual(minI.value, '0', 'freq 軸の Min プリフィルは 0 であること');
    minI.value = '100'; maxI.value = '900';
    (env.dom.window.document.getElementById('spec-range-apply') as HTMLElement).click();
    requestSpectrumSnapshot(env, 'after-freq-apply');
    await nextAnimationFrame(env.dom);
    const labels = latestSpectrumOverlayLabels(env);
    assert.ok(labels && labels.length >= 6, 'overlay 軸ラベルが存在すること');
    assert.strictEqual(labels![3], '100 Hz', 'freq Min ラベルが適用値になること');
    assert.strictEqual(labels![5], '900 Hz', 'freq Max ラベルが適用値になること');
    env.dom.window.close();
});

test('spectrum overlay: プロット内部 dblclick で specZoomReset される', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    assert.ok(overlay, 'overlay canvas が存在すること');
    const W = overlay!.width || 800;
    const H = overlay!.height || 140;
    // まず Y軸 popover を開いて dB レンジを適用（state を変化させる）
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 70 }));
    const minI = env.dom.window.document.getElementById('spec-range-min') as HTMLInputElement;
    const maxI = env.dom.window.document.getElementById('spec-range-max') as HTMLInputElement;
    minI.value = '-80'; maxI.value = '-20';
    (env.dom.window.document.getElementById('spec-range-apply') as HTMLElement).click();
    requestSpectrumSnapshot(env, 'pre-spec-reset');
    await nextAnimationFrame(env.dom);
    const before = latestSpectrumOverlayLabels(env);
    assert.strictEqual(before![0], '-20 dB', 'reset 前は適用した dB レンジであること');
    // 内部 dblclick で reset → dB/freq が auto に戻る
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: Math.floor(W / 2), clientY: Math.floor(H / 2) }));
    requestSpectrumSnapshot(env, 'post-spec-reset');
    await nextAnimationFrame(env.dom);
    const after = latestSpectrumOverlayLabels(env);
    assert.ok(after && after.length >= 6, 'reset 後スナップショットの軸ラベルが存在すること');
    assert.notStrictEqual(after![0], '-20 dB', 'reset 後 dB Max が auto（適用値でない）に戻ること');
    assert.strictEqual(after![3], '0 Hz', 'reset 後 freq Min が 0 Hz（全域）に戻ること');
    env.dom.window.close();
});

test('spectrum overlay: min>=max は適用されず popover を閉じない', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLElement | null;
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 70 }));
    // 適用前のベースライン
    requestSpectrumSnapshot(env, 'pre-invalid');
    await nextAnimationFrame(env.dom);
    const baseline = latestSpectrumOverlayLabels(env);
    // 不正値 (min >= max) を適用
    const minI = env.dom.window.document.getElementById('spec-range-min') as HTMLInputElement;
    const maxI = env.dom.window.document.getElementById('spec-range-max') as HTMLInputElement;
    minI.value = '-10'; maxI.value = '-50';
    (env.dom.window.document.getElementById('spec-range-apply') as HTMLElement).click();
    const pop = env.dom.window.document.getElementById('spectrum-range-popover') as HTMLElement;
    assert.notStrictEqual(pop.style.display, 'none', '不正時は popover が開いたままであること');
    // state は変化していない（ラベルがベースラインのまま）
    requestSpectrumSnapshot(env, 'post-invalid');
    await nextAnimationFrame(env.dom);
    const after = latestSpectrumOverlayLabels(env);
    assert.deepStrictEqual(after, baseline, '不正値は適用されず軸ラベルが不変であること');
    env.dom.window.close();
});


test('spectrum overlay: clamp 後にゼロ幅になる周波数レンジは適用されない', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
    assert.ok(overlay, 'overlay canvas が存在すること');
    const H = overlay!.height || 140;
    const W = overlay!.width || 800;
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', {
        bubbles: true, clientX: Math.floor(W / 2), clientY: H - 5,
    }));

    requestSpectrumSnapshot(env, 'pre-out-of-range-freq');
    await nextAnimationFrame(env.dom);
    const baseline = latestSpectrumOverlayLabels(env);

    const minI = env.dom.window.document.getElementById('spec-range-min') as HTMLInputElement;
    const maxI = env.dom.window.document.getElementById('spec-range-max') as HTMLInputElement;
    minI.value = '999999';
    maxI.value = '1000000';
    (env.dom.window.document.getElementById('spec-range-apply') as HTMLElement).click();

    const pop = env.dom.window.document.getElementById('spectrum-range-popover') as HTMLElement;
    assert.notStrictEqual(pop.style.display, 'none', 'clamp 後にゼロ幅になる入力では popover が開いたままであること');
    requestSpectrumSnapshot(env, 'post-out-of-range-freq');
    await nextAnimationFrame(env.dom);
    const after = latestSpectrumOverlayLabels(env);
    assert.deepStrictEqual(after, baseline, 'clamp 後にゼロ幅になる周波数レンジは state に反映されないこと');
    env.dom.window.close();
});

