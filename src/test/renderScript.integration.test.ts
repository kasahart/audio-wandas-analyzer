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

const WAVEFORM_PIPELINE_JS = readFileSync(
    join(__dirname, '..', '..', 'media', 'comparisonWaveform.js'),
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

const DUMMY_SELECTION_STATE = JSON.stringify({
    mode: 'directory-selection',
    results: [],
    rootPath: '/tmp/session',
    allFilePaths: ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'],
    selectedFilePaths: [],
    pythonEnvironmentState: {
        pythonCommand: 'python3',
        status: 'normal',
        tooltip: 'Click to select Python interpreter',
    },
    directoryTree: [
        {
            type: 'file',
            name: 'a.wav',
            relativePath: 'a.wav',
            filePath: '/tmp/session/a.wav',
        },
        {
            type: 'directory',
            name: 'sub',
            relativePath: 'sub',
            children: [
                {
                    type: 'file',
                    name: 'b.flac',
                    relativePath: 'sub/b.flac',
                    filePath: '/tmp/session/sub/b.flac',
                },
            ],
        },
    ],
});

const DUMMY_SELECTION_WITH_RESULTS_STATE = JSON.stringify({
    mode: 'directory-selection',
    rootPath: '/tmp/session',
    allFilePaths: ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'],
    selectedFilePaths: ['/tmp/session/a.wav'],
    pythonEnvironmentState: {
        pythonCommand: '.venv/bin/python',
        status: 'normal',
        tooltip: 'Click to select Python interpreter',
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
    directoryTree: [
        {
            type: 'file',
            name: 'a.wav',
            relativePath: 'a.wav',
            filePath: '/tmp/session/a.wav',
        },
        {
            type: 'directory',
            name: 'sub',
            relativePath: 'sub',
            children: [
                {
                    type: 'file',
                    name: 'b.flac',
                    relativePath: 'sub/b.flac',
                    filePath: '/tmp/session/sub/b.flac',
                },
            ],
        },
    ],
});

function setupEnv() {
    const script = getRenderScript();
    const { dom, postedMessages, offscreenInstances, domCanvasContexts } = createWebviewEnv(DUMMY_APP_STATE);
    // comparisonWaveform.js を先に eval して window.renderWaveformPipeline を登録する
    evalScript(dom, WAVEFORM_PIPELINE_JS);
    evalScript(dom, script);
    return { dom, postedMessages, offscreenInstances, domCanvasContexts };
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

test('toolbar にファイルとフォルダを開く導線がある', () => {
    const { dom } = setupEnv();
    const openFileButton = dom.window.document.querySelector('[data-action="open-file"]');
    const openFolderButton = dom.window.document.querySelector('[data-action="open-folder"]');
    assert.ok(openFileButton, 'open-file ボタンが存在すること');
    assert.ok(openFolderButton, 'open-folder ボタンが存在すること');
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

test('open-file ボタンが select-target(file) を送信する', () => {
    const { dom, postedMessages } = setupEnv();
    const button = dom.window.document.querySelector('[data-action="open-file"]');
    assert.ok(button instanceof dom.window.HTMLButtonElement);
    button.click();
    const message = postedMessages[0] as { type?: string; targetKind?: string };
    assert.equal(message.type, 'select-target');
    assert.equal(message.targetKind, 'file');
});

test('open-folder ボタンが select-target(directory) を送信する', () => {
    const { dom, postedMessages } = setupEnv();
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

test('directory selection mode renders a Python environment button in the selection toolbar only', () => {
    const { dom } = setupSelectionEnv();
    const selectionButton = dom.window.document.getElementById('selection-python-environment');
    const mainToolbarButton = dom.window.document.querySelector('#toolbar [data-action="select-python-environment"]');

    assert.ok(selectionButton instanceof dom.window.HTMLButtonElement);
    assert.equal(selectionButton.textContent, 'Python: python3');
    assert.equal(selectionButton.title, 'Click to select Python interpreter');
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
            tooltip: 'Python interpreter was not found. Click to select another interpreter.',
        },
    }));

    assert.equal(button.textContent, 'Python: /tmp/missing-python ⚠');
    assert.equal(button.title, 'Python interpreter was not found. Click to select another interpreter.');
    assert.equal(button.classList.contains('is-warning'), true);
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
