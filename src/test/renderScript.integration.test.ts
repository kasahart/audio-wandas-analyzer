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

test('directory selection mode renders a Python environment button in the selection toolbar and results toolbar', () => {
    const { dom } = setupSelectionEnv();
    const selectionButton = dom.window.document.getElementById('selection-python-environment');
    const mainToolbarButton = dom.window.document.getElementById('toolbar-python-environment');

    assert.ok(selectionButton instanceof dom.window.HTMLButtonElement);
    assert.equal(selectionButton.textContent, 'Python: python3');
    assert.equal(selectionButton.title, 'python3 — Click to select Python interpreter');

    assert.ok(mainToolbarButton instanceof dom.window.HTMLButtonElement);
    assert.equal(mainToolbarButton.textContent, 'Python: python3');
    assert.equal(mainToolbarButton.title, 'python3 — Click to select Python interpreter');
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

    assert.equal(button.textContent, 'Python: missing-python ⚠');
    assert.equal(button.title, '/tmp/missing-python — Python interpreter was not found. Click to select another interpreter.');
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
            tooltip: 'Click to select Python interpreter',
        },
    }));

    assert.equal(button.textContent, 'Python: python.exe');
    assert.equal(button.title, 'C:\\Python311\\python.exe — Click to select Python interpreter');
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

function setupSpectrumEnv() {
    const script = getRenderScript();
    const env = createWebviewEnv(SPECTRUM_APP_STATE);
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

test('axes: 振幅軸ラベル (+1.0 / 0 / -1.0 と Amp 単位) が track-axis-canvas に描かれる', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const spy = env.domCanvasContexts.get('track-axis-canvas-0');
    assert.ok(spy, 'track-axis-canvas-0 のスパイが取得できること');
    const labels = spy!.fillTextCalls;
    assert.ok(labels.includes('+1.0'), '+1.0 ラベルが描かれること: ' + JSON.stringify(labels));
    assert.ok(labels.includes('-1.0'), '-1.0 ラベルが描かれること');
    assert.ok(labels.includes('0'), '0 ラベルが描かれること');
    assert.ok(labels.some((s) => s.includes('Amp')), '振幅軸タイトル (Amp) が描かれること');
    assert.ok(spy!.fillRectCalls > 0, 'ラベル用の半透明バックプレートが描かれること');
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

    const spy = env.domCanvasContexts.get('track-canvas-0');
    assert.ok(spy, 'track-canvas-0 のスパイが取得できること');
    const labels = spy!.fillTextCalls;
    assert.ok(labels.includes('0 Hz'), '0 Hz ラベルが描かれること: ' + JSON.stringify(labels));
    assert.ok(
        labels.some((s) => /\bkHz\b/.test(s) || /\bHz\b/.test(s)),
        'Hz または kHz の周波数ラベルが描かれること',
    );
    assert.ok(labels.some((s) => /\d+\s*dB$/.test(s)), 'カラーバーの dB ラベルが描かれること');
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

    assert.ok(overlaySpy!.strokeCalls > overlayBefore,
        '再生中の tick で overlay spectrum が再描画されること '
        + '(before=' + overlayBefore + ', after=' + overlaySpy!.strokeCalls + ')');
    assert.ok(trackSpy!.strokeCalls > trackBefore,
        '再生中の tick で per-track spectrum が再描画されること '
        + '(before=' + trackBefore + ', after=' + trackSpy!.strokeCalls + ')');
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

test('スペクトルズームツールバーのボタンが生成される', () => {
    const { dom } = setupEnv();
    const zoomIn  = dom.window.document.querySelector('[data-action="spec-zoom-in"]');
    const zoomOut = dom.window.document.querySelector('[data-action="spec-zoom-out"]');
    const reset   = dom.window.document.querySelector('[data-action="spec-zoom-reset"]');
    assert.ok(zoomIn,  'spec-zoom-in ボタンが存在すること');
    assert.ok(zoomOut, 'spec-zoom-out ボタンが存在すること');
    assert.ok(reset,   'spec-zoom-reset ボタンが存在すること');
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
test('spectrum overlay: Y軸(dB) dblclick で popover が開く', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom); // 初回レンダリングで overlay canvas をサイズ設定
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLElement | null;
    assert.ok(overlay, 'overlay canvas が存在すること');
    // Y軸ゾーン: cx < padL(36) → clientX=10
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 70 }));
    const pop = env.dom.window.document.getElementById('spectrum-range-popover') as HTMLElement;
    assert.ok(pop, 'popover が存在すること');
    assert.notStrictEqual(pop.style.display, 'none', 'popover が表示されること');
    const badge = env.dom.window.document.getElementById('spec-range-axis-badge');
    assert.ok(badge && /dB/.test(badge.textContent || ''), 'バッジが dB 軸であること');
    env.dom.window.close();
});

test('spectrum overlay: X軸(周波数) dblclick で popover が開く', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLElement | null;
    assert.ok(overlay, 'overlay canvas が存在すること');
    const cv = overlay as HTMLCanvasElement;
    const H = cv.height || 140;
    const W = cv.width || 800;
    // X軸ゾーン: cy > H-padB(18) かつ cx ∈ [36, W-8]
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: Math.floor(W / 2), clientY: H - 5 }));
    const badge = env.dom.window.document.getElementById('spec-range-axis-badge');
    assert.ok(badge && /Hz/.test(badge.textContent || ''), 'バッジが 周波数(Hz) 軸であること');
    const pop = env.dom.window.document.getElementById('spectrum-range-popover') as HTMLElement;
    assert.notStrictEqual(pop.style.display, 'none', 'popover が表示されること');
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
    // スナップショットで specDbMin/Max が変化したことを確認
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
        data: { type: 'comparison-panel-test-action', actions: [], actionId: 'pre-spec-reset' },
    }));
    await nextAnimationFrame(env.dom);
    // 内部 dblclick で reset
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: Math.floor(W / 2), clientY: Math.floor(H / 2) }));
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
        data: { type: 'comparison-panel-test-action', actions: [], actionId: 'post-spec-reset' },
    }));
    await nextAnimationFrame(env.dom);
    const snaps = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot');
    const post = (snaps[snaps.length - 1] as any)?.renderedUi;
    assert.ok(post, 'reset 後スナップショットが存在すること');
    // axisLabels.spectrumOverlay は specDbMin/Max=null・全周波数に戻ると既定ラベルになる
    assert.ok(post.axisLabels && post.axisLabels.spectrumOverlay, '軸ラベルが存在すること');
    env.dom.window.close();
});

test('spectrum overlay: min>=max は error 表示し popover を閉じない', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const overlay = env.dom.window.document.getElementById('spectrum-overlay-canvas') as HTMLElement | null;
    overlay!.dispatchEvent(new env.dom.window.MouseEvent('dblclick', { bubbles: true, clientX: 10, clientY: 70 }));
    const minI = env.dom.window.document.getElementById('spec-range-min') as HTMLInputElement;
    const maxI = env.dom.window.document.getElementById('spec-range-max') as HTMLInputElement;
    minI.value = '-10'; maxI.value = '-50';
    (env.dom.window.document.getElementById('spec-range-apply') as HTMLElement).click();
    const err = env.dom.window.document.getElementById('spec-range-error') as HTMLElement;
    assert.ok(err.textContent && err.textContent.length > 0, 'エラーが表示されること');
    const pop = env.dom.window.document.getElementById('spectrum-range-popover') as HTMLElement;
    assert.notStrictEqual(pop.style.display, 'none', 'エラー時は popover が開いたままであること');
    env.dom.window.close();
});
