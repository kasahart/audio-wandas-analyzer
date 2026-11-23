/**
 * 生成済み Comparison Webview runtime を jsdom 環境で実行する統合テスト。
 *
 * テスト対象:
 * - TypeScript entry bundle が jsdom で例外なく実行できること
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
// vscode モックを先に設定してから ComparisonPanel をロードするヘルパー
import { getRenderScript, getRenderStyles } from './helpers/comparisonScriptLoader';
import { createWebviewEnv, evalScript } from './helpers/webviewTestEnv';
import { answerCursorRequests, answerFigures, cursorAnswers, cursorKey, drawnSpecs, figureRequests, lastDrawnKeys, TEST_LINE } from './helpers/tracksFigures';
import { OWN_COLORS } from '../shared/gui/roleColors';
import { csvRecords } from '../shared/utils/csv';

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
                peakAbsolute: 0.5,
                peakLevelDb: -6.0206,
                sourceLevelReferenceLabel: 'dBFS',
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
                peakAbsolute: 0.7,
                peakLevelDb: -3.098,
                sourceLevelReferenceLabel: 'dBFS',
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
                    peakAbsolute: 0.5,
                    peakLevelDb: -6.0206,
                    sourceLevelReferenceLabel: 'dBFS',
                },
                {
                    label: 'Right',
                    peakAbsolute: 0.95,
                    peakLevelDb: -0.4455,
                    sourceLevelReferenceLabel: 'dBFS',
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
                peakAbsolute: 0.5,
            }],
        },
    ],
});

const DUMMY_SELECTION_WITH_B_RESULT_STATE = JSON.stringify({
    mode: 'directory-selection',
    rootPath: '/tmp/session',
    allFilePaths: ['/tmp/session/a.wav', '/tmp/session/sub/b.flac'],
    selectedFilePaths: ['/tmp/session/sub/b.flac'],
    pythonEnvironmentState: {
        pythonCommand: '.venv/bin/python',
        status: 'normal',
        tooltip: 'Click to select Python environment',
    },
    results: [
        {
            filePath: '/tmp/session/sub/b.flac',
            fileName: 'b.flac',
            audioSource: 'vscode-resource:/tmp/session/sub/b.flac',
            sampleRateHz: 44100,
            durationSeconds: 1.0,
            channelCount: 1,
            sampleCount: 44100,
            error: undefined,
            channels: [{
                label: 'L',
                peakAbsolute: 0.7,
            }],
        },
    ],
});

function setupEnvWithState(stateJson: string, initialVsCodeState: unknown = null) {
    const script = getRenderScript();
    const { dom, postedMessages, vscodeStates, offscreenInstances, domCanvasContexts } = createWebviewEnv(
        stateJson,
        initialVsCodeState,
    );
    evalScript(dom, script);
    return { dom, postedMessages, vscodeStates, offscreenInstances, domCanvasContexts };
}

/** The plot heights the page gives each row's Figure: its waveform's and its spectrogram's (CSS px). */
function rowHeights(dom: ReturnType<typeof createWebviewEnv>['dom']): { wave: number; spec: number } {
    const style = (dom.window.document.getElementById('tracks-wrapper') as HTMLElement).style;
    return { wave: parseFloat(style.getPropertyValue('--row-wave')), spec: parseFloat(style.getPropertyValue('--row-spec')) };
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
    return setupEnvWithState(DUMMY_SELECTION_STATE);
}

function setupSelectionResultsEnv() {
    return setupEnvWithState(DUMMY_SELECTION_WITH_RESULTS_STATE);
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
    assert.match(styles, /\.track-row-figure\s*\{[^}]*background:\s*var\(--track-bg\)/i);
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
    assert.ok(app.innerHTML.length > 0, '#app 内に HTML が生成されていること');
});

test('2 トラック分の行の図の枠が生成される', () => {
    const { dom } = setupEnv();
    const c0 = dom.window.document.getElementById('track-row-figure-0');
    const c1 = dom.window.document.getElementById('track-row-figure-1');
    assert.ok(c0, 'track-row-figure-0 が存在すること');
    assert.ok(c1, 'track-row-figure-1 が存在すること');
});

test('track DOM uses stable TrackId attributes instead of result indices', () => {
    const { dom } = setupEnv();
    const rows = Array.from(dom.window.document.querySelectorAll('.track-row'));
    assert.deepEqual(rows.map((row) => row.getAttribute('data-track-id')), ['track-1', 'track-2']);
    assert.equal(dom.window.document.querySelector('[data-track-index]'), null);
    assert.equal(new Set(rows.map((row) => row.getAttribute('data-track-id'))).size, rows.length);
    dom.window.close();
});

test('host response boundary reports an invalid numeric track identity', () => {
    const env = setupEnv();
    const warnings: string[] = [];
    env.dom.window.console.warn = (...values: unknown[]) => warnings.push(values.map(String).join(' '));

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
        data: {
            type: 'track-detail-error',
            requestId: 'invalid-track',
            analysisId: 'analysis',
            settingsSignature: 'settings',
            trackIndex: 99,
            filePath: '/tmp/none.wav',
            error: 'failed',
        },
    }));

    assert.deepEqual(warnings, ['Rejected track-detail-error with invalid trackIndex 99']);
    env.dom.window.close();
});

test('renderScript: monaural tracks keep waveform and spectrogram in one body without a channel header', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);

    const row = env.dom.window.document.getElementById('track-row-0');
    assert.ok(row, 'track-row-0 が存在すること');
    assert.equal(row.querySelector('.track-channel-lane-header'), null);

    const meta = row.querySelector('.track-meta');
    assert.match(meta?.textContent || '', /^1 ch.*Peak −6\.0 dB/,
        'mono track の概要値は下部凡例ではなく track meta に表示されること');

    // One box a channel: its Figure draws the waveform over the spectrogram in it.
    const box = env.dom.window.document.getElementById('track-row-figure-0');
    assert.ok(box, 'track-row-figure-0 が存在すること');
    assert.equal(row.querySelectorAll('.track-row-figure').length, 1, 'mono track は図の枠が 1 つ');
    assert.equal(row.querySelector('.track-spectrum-wrap, .track-spectrum-canvas'), null, 'トラック右にはスペクトルを置かないこと');
    const stack = box.parentElement;
    assert.ok(stack?.classList.contains('track-canvas-stack'), '図の枠は波形とスペクトログラムの境目と同じ枠に入ること');
    assert.ok(stack?.querySelector('.track-split'), '波形とスペクトログラムの境目があること');
    assert.ok(stack?.parentElement?.classList.contains('track-channel-lane-body'), '図の枠はレーン本文に入ること');
    assert.equal(stack?.parentElement?.children.length, 1, '時系列の描画がレーン本文の幅をすべて使うこと');
    env.dom.window.close();
});

test('toolbar が生成される', () => {
    const { dom } = setupEnv();
    const toolbar = dom.window.document.getElementById('toolbar');
    assert.ok(toolbar, '#toolbar が存在すること');
});

test('renderScript: results pane does not render the bottom metrics legend', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    assert.equal(env.dom.window.document.getElementById('metrics-bar'), null);
    assert.equal(env.dom.window.document.querySelectorAll('.metrics-item').length, 0);
    env.dom.window.close();
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
    const playButton = dom.window.document.querySelector('[data-action="toggle-playback"][data-track-id="track-1"]');
    const stopButton = dom.window.document.querySelector('[data-action="stop-playback"][data-track-id="track-1"]');
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

test('the side panel docks the entry table and keeps its resizer', () => {
    const env = setupSelectionEnv();
    const resizer = env.dom.window.document.getElementById('tree-resizer');
    assert.ok(resizer, 'tree-resizer が存在すること');
    assert.ok(env.dom.window.document.getElementById('entry-dock'), 'the entry table docks in the side panel');
    assert.equal(env.dom.window.document.querySelector('.selection-file-checkbox'), null, 'no folder tree');
    env.dom.window.close();
});

test('directory selection mode renders a Python environment button only in the selection toolbar', () => {
    const { dom } = setupSelectionEnv();
    const selectionButton = dom.window.document.getElementById('selection-python-environment');
    const mainToolbarButton = dom.window.document.getElementById('toolbar-python-environment');

    assert.ok(selectionButton instanceof dom.window.HTMLButtonElement);
    assert.equal(selectionButton.textContent, 'Python: python3');
    assert.equal(selectionButton.dataset.hint, 'python3 — Click to select Python environment');
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
    assert.equal(button.dataset.hint, '/tmp/missing-python — Python interpreter was not found. Click to select another environment.');
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
    assert.equal(button.dataset.hint, 'C:\\Python311\\python.exe — Click to select Python environment');
});

/** Shows or takes off a listed file, as the entry table's slots and ＋ do (the test action the e2e uses too). */
function setFileShown(dom: ReturnType<typeof setupSelectionEnv>['dom'], filePath: string, selected: boolean): void {
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        data: { type: 'comparison-panel-test-action', actionId: `show-${filePath}-${selected}`, actions: [{ action: 'set-file-selected', payload: { filePath, selected } }] },
    }));
}

test('directory selection mode posts analyze-selected-files immediately when a file is shown', () => {
    const { dom, postedMessages } = setupSelectionEnv();
    setFileShown(dom, '/tmp/session/a.wav', true);

    const message = postedMessages.filter(entry => (entry as { type?: string }).type === 'analyze-selected-files').at(-1) as { type?: string; requestId?: string; filePaths?: string[] } | undefined;

    assert.ok(message, 'analyze-selected-files message should be posted');
    assert.equal(message?.type, 'analyze-selected-files');
    assert.match(message?.requestId || '', /^selection-/);
    assert.deepEqual(message?.filePaths, ['/tmp/session/a.wav']);
});

test('directory selection mode posts shown files in the order they were shown', () => {
    const { dom, postedMessages } = setupSelectionEnv();
    setFileShown(dom, '/tmp/session/sub/b.flac', true);
    setFileShown(dom, '/tmp/session/a.wav', true);

    const message = postedMessages.filter(entry => (entry as { type?: string }).type === 'analyze-selected-files').at(-1) as { type?: string; filePaths?: string[] } | undefined;

    assert.equal(message?.type, 'analyze-selected-files');
    assert.deepEqual(message?.filePaths, ['/tmp/session/sub/b.flac', '/tmp/session/a.wav']);
});

test('directory selection mode keeps the side panel while rendering selected tracks', () => {
    const { dom } = setupSelectionResultsEnv();
    const trackCanvas = dom.window.document.getElementById('track-row-figure-0');
    const toolbar = dom.window.document.getElementById('toolbar');

    assert.ok(dom.window.document.getElementById('entry-dock'));
    assert.ok(trackCanvas, 'selected track canvas should remain visible next to the side panel');
    assert.ok(toolbar, 'comparison toolbar should be visible in selection mode');
});

test('directory selection mode keeps an existing track and its own colour when a new earlier tree item appears', () => {
    const { dom } = setupEnvWithState(DUMMY_SELECTION_WITH_B_RESULT_STATE);
    // A track without a role: its chip has the track's own colour, as in Compare (R5), kept when a track comes in before it.
    const initialSwatch = dom.window.document.querySelector<HTMLElement>(
        '.track-row[data-track-id="track-1"] .role-chip-face',
    );

    assert.ok(initialSwatch);
    const initialBColor = initialSwatch.style.getPropertyValue('--role-fallback');
    assert.ok(OWN_COLORS.includes(initialBColor), initialBColor);

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
        data: {
            type: 'analysis-update',
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
                        peakAbsolute: 0.5,
                    }],
                },
                {
                    filePath: '/tmp/session/sub/b.flac',
                    fileName: 'b.flac',
                    audioSource: 'vscode-resource:/tmp/session/sub/b.flac',
                    sampleRateHz: 44100,
                    durationSeconds: 1.0,
                    channelCount: 1,
                    sampleCount: 44100,
                    error: undefined,
                    channels: [{
                        label: 'L',
                        peakAbsolute: 0.7,
                    }],
                },
            ],
        },
    }));

    const rows = Array.from(dom.window.document.querySelectorAll('.track-row'));
    const bRow = rows.find((row) => row.textContent?.includes('b.flac'));
    const bSwatch = bRow?.querySelector('.role-chip-face') as HTMLElement | null;

    assert.ok(bSwatch);
    assert.equal(bSwatch.style.getPropertyValue('--role-fallback'), initialBColor);
    assert.equal(bRow?.getAttribute('data-track-id'), 'track-1');
    const aRow = rows.find((row) => row.textContent?.includes('a.wav'));
    assert.equal(aRow?.getAttribute('data-track-id'), 'track-2');
});

test('directory selection mode posts an empty selection when the shown file is taken off', () => {
    const { dom, postedMessages } = setupSelectionResultsEnv();
    setFileShown(dom, '/tmp/session/a.wav', false);

    const message = postedMessages.filter(entry => (entry as { type?: string }).type === 'analyze-selected-files').at(-1) as { type?: string; requestId?: string; filePaths?: string[] } | undefined;

    assert.ok(message, 'analyze-selected-files message should be posted when removing the last track');
    assert.equal(message?.type, 'analyze-selected-files');
    assert.match(message?.requestId || '', /^selection-/);
    assert.deepEqual(message?.filePaths, []);
});

test('renderScript: the track view requests track detail when spectrogram is null', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    const button = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="content-waveform"]');
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

test('renderScript: the waveform/spectrogram split survives Webview regeneration', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const doc = env.dom.window.document;
    const split = doc.querySelector<HTMLElement>('.track-split');
    assert.ok(split, 'every lane has a split between its waveform and spectrogram');
    split.dispatchEvent(new env.dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }));
    // 32 px of the 160 px plots: the waveform's share goes from 40 % to 60 %.
    doc.dispatchEvent(new env.dom.window.MouseEvent('pointermove', { bubbles: true, clientY: 132 }));
    doc.dispatchEvent(new env.dom.window.MouseEvent('pointerup', { bubbles: true, clientY: 132 }));
    await nextAnimationFrame(env.dom);
    assert.deepEqual(rowHeights(env.dom), { wave: 96, spec: 64 });

    const persistedState = env.vscodeStates.at(-1);
    assert.ok(persistedState, 'the split is persisted before the host regenerates HTML');
    env.dom.window.close();

    const rerendered = setupEnvWithState(DUMMY_APP_STATE, persistedState);
    await nextAnimationFrame(rerendered.dom);
    assert.deepEqual(rowHeights(rerendered.dom), { wave: 96, spec: 64 });
    rerendered.dom.window.close();
});

test('renderScript: removing a detailed track releases its spectrogram detail', () => {
    const env = setupEnv();
    const removeButton = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="remove-track"][data-track-id="track-1"]');
    assert.ok(removeButton);
    removeButton.click();

    const release = env.postedMessages.find((msg: any) => msg.type === 'release-track-detail' && msg.trackIndex === 0) as any;
    assert.ok(release, 'release-track-detail should be posted');
    assert.equal(release.filePath, '/tmp/a.wav');
});

test('renderScript: display-only spectrogram changes do not request fresh track detail', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    await nextAnimationFrame(env.dom);

    const specButton = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="content-waveform"]');
    assert.ok(specButton, 'spectrogram button should exist');
    specButton.click();
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

test('renderScript: analysis-update requests fresh spectrogram detail for new settings', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    const button = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="content-waveform"]');
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

test('analysis-update preserves TrackId runtime state while protocol indices change', async () => {
    const env = setupEnv();
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'comparison-panel-test-action',
        actionId: 'set-b-offset-before-reorder',
        actions: [{ action: 'set-track-offset', trackIndex: 1, payload: { offsetSeconds: 2 } }],
    } }));

    const reversedResults = JSON.parse(DUMMY_APP_STATE).results.reverse();
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'analysis-update',
        results: reversedResults,
    } }));
    await nextAnimationFrame(env.dom);

    const snapshot = env.postedMessages
        .filter((message: any) => message.type === 'comparison-panel-test-snapshot')
        .at(-1) as any;
    const trackA = snapshot.renderedUi.tracks.find((track: any) => track.filePath === '/tmp/a.wav');
    const trackB = snapshot.renderedUi.tracks.find((track: any) => track.filePath === '/tmp/b.wav');
    assert.deepEqual(
        { id: trackA.trackId, index: trackA.trackIndex, offset: trackA.offsetSeconds },
        { id: 'track-1', index: 1, offset: 0 },
    );
    assert.deepEqual(
        { id: trackB.trackId, index: trackB.trackIndex, offset: trackB.offsetSeconds },
        { id: 'track-2', index: 0, offset: 2 },
    );
    assert.deepEqual(Array.from(snapshot.renderedUi.displayOrder), ['track-1', 'track-2']);
    env.dom.window.close();
});

test('analysis-update rebuilds audio bindings when protocol order changes', async () => {
    const env = setupEnv();
    const oldAudioA = env.dom.window.document.getElementById('track-audio-0') as HTMLAudioElement;
    const playA = env.dom.window.document.querySelector(
        '[data-action="toggle-playback"][data-track-id="track-1"]',
    ) as HTMLButtonElement;
    playA.click();
    await Promise.resolve();
    assert.equal(oldAudioA.paused, false);

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'analysis-update',
        results: JSON.parse(DUMMY_APP_STATE).results.reverse(),
    } }));
    await nextAnimationFrame(env.dom);

    assert.equal(oldAudioA.paused, true, 'detached media element should be paused');
    const newAudioA = env.dom.window.document.querySelector('#audio-host audio[data-track-id="track-1"]') as HTMLAudioElement;
    const newAudioB = env.dom.window.document.querySelector('#audio-host audio[data-track-id="track-2"]') as HTMLAudioElement;
    assert.equal(newAudioA.id, 'track-audio-1');
    assert.equal(newAudioB.id, 'track-audio-0');

    const rebuiltPlayA = env.dom.window.document.querySelector(
        '[data-action="toggle-playback"][data-track-id="track-1"]',
    ) as HTMLButtonElement;
    rebuiltPlayA.click();
    await Promise.resolve();
    assert.equal(newAudioA.paused, false);
    assert.equal(newAudioB.paused, true);
    env.dom.window.close();
});

test('analysis-update does not restore a locally removed track', async () => {
    const env = setupEnv();
    const removeA = env.dom.window.document.querySelector(
        '[data-action="remove-track"][data-track-id="track-1"]',
    ) as HTMLButtonElement;
    removeA.click();

    for (let update = 0; update < 2; update += 1) {
        env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
            type: 'analysis-update',
            results: JSON.parse(DUMMY_APP_STATE).results,
        } }));
        await nextAnimationFrame(env.dom);
    }

    assert.equal(env.dom.window.document.querySelector('[data-track-id="track-1"]'), null);
    assert.ok(env.dom.window.document.querySelector('.track-row[data-track-id="track-2"]'));
    assert.equal(env.dom.window.document.querySelectorAll('.track-row').length, 1);
    env.dom.window.close();
});

test('after an analysis-update a focused row canvas still says its keys in the footer', async () => {
    const env = setupHighFrequencyReadoutEnv();
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'analysis-update',
        results: JSON.parse(HIGH_FREQUENCY_READOUT_STATE).results,
    } }));
    await nextAnimationFrame(env.dom);

    // A row's Figure makes its canvas when its picture comes; one stands in for it here.
    const waveformCanvas = env.dom.window.document.createElement('canvas');
    waveformCanvas.tabIndex = 0;
    env.dom.window.document.getElementById('track-row-figure-0')!.append(waveformCanvas);
    // The rows are rebuilt: the one listener on their wrapper puts a focused canvas's keys in the footer, over what it said before.
    const footer = env.dom.window.document.createElement('div');
    footer.id = 'hint-footer';
    footer.textContent = 'before focus';
    env.dom.window.document.body.append(footer);
    waveformCanvas.focus();
    assert.notEqual(footer.textContent, 'before focus');

    env.dom.window.close();
});

test('lazy detail response cannot attach to a replacement at the same protocol index', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    const button = env.dom.window.document.querySelector('[data-action="content-waveform"]') as HTMLButtonElement;
    button.click();
    await nextAnimationFrame(env.dom);
    const oldRequest = env.postedMessages.find((message: any) => message.type === 'request-track-detail') as any;
    assert.ok(oldRequest);

    const replacement = JSON.parse(makeLazySpectrogramState()).results[0];
    replacement.filePath = '/tmp/replacement.wav';
    replacement.fileName = 'replacement.wav';
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'analysis-update',
        results: [replacement],
    } }));
    await nextAnimationFrame(env.dom);

    const requests = env.postedMessages.filter((message: any) => message.type === 'request-track-detail') as any[];
    const replacementRequest = requests.at(-1);
    assert.notEqual(replacementRequest.analysisId, oldRequest.analysisId);
    assert.equal(replacementRequest.filePath, '/tmp/replacement.wav');

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'track-detail-result',
        requestId: oldRequest.requestId,
        analysisId: oldRequest.analysisId,
        settingsSignature: oldRequest.settingsSignature,
        trackIndex: 0,
        filePath: '/tmp/a.wav',
        channels: [{ spectrogram: {
            values: [[-10]], timeBins: 1, frequencyBins: 1, windowSize: 512, hopSize: 256,
            maxFrequencyHz: 22050, minDb: -90, maxDb: 0,
        } }],
    } }));
    await nextAnimationFrame(env.dom);

    const snapshot = env.postedMessages
        .filter((message: any) => message.type === 'comparison-panel-test-snapshot')
        .at(-1) as any;
    assert.equal(snapshot.renderedUi.tracks[0].trackId, 'track-3');
    assert.equal(snapshot.renderedUi.axisLabels.spectrogramPerTrack[0].includes('−90'), false, JSON.stringify(snapshot.renderedUi.axisLabels.spectrogramPerTrack));
    env.dom.window.close();
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

test('renderScript: multichannel lazy spectrum uses one track-batched request', async () => {
    const state = JSON.parse(MULTICHANNEL_APP_STATE);
    state.results[0].channels.forEach((channel: any) => { channel.spectrogram = null; });
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);

    let sliceRequests = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice' && msg.trackIndex === 0) as any[];
    assert.equal(sliceRequests.length, 1, 'only one backend spectrum request may be in flight');
    const first = sliceRequests[0];
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: cursorAnswers(first, [0, 1]) }));
    await nextAnimationFrame(env.dom);

    sliceRequests = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice' && msg.trackIndex === 0) as any[];
    assert.equal(sliceRequests.length, 1, 'one response should update every channel without another IPC');
    assert.equal('channelIndex' in sliceRequests[0], false);
    env.dom.window.close();
});

test('renderScript: lazy spectrum applies global backpressure and converges to the latest cursor', async () => {
    const state = JSON.parse(makeLazySpectrogramState());
    state.results = state.results.slice(0, 1);
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);

    const initial = env.postedMessages.find((msg: any) => msg.type === 'request-spectrum-slice') as any;
    assert.ok(initial, 'initial lazy slice request should be posted');

    const cursorUpdates = Array.from({ length: 120 }, (_, index) => (index + 1) / 150);
    for (const cursorNorm of cursorUpdates) {
        env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
            type: 'comparison-panel-test-action',
            actionId: 'lazy-backpressure-' + cursorNorm,
            actions: [{ action: 'set-cursor', payload: { cursorNorm } }],
        } }));
        await nextAnimationFrame(env.dom);
    }
    let requests = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice') as any[];
    assert.equal(requests.length, 1, 'cursor updates must not enqueue IPC while a slice is in flight');

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: cursorAnswers(initial) }));
    await nextAnimationFrame(env.dom);

    requests = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice') as any[];
    assert.equal(requests.length, 2, 'completion should dispatch exactly one trailing request');
    assert.ok(requests[1].cursorNorm > 0.79 && requests[1].cursorNorm < 0.81,
        'the trailing request should target only the latest cursor: ' + requests[1].cursorNorm);
    assert.deepEqual(cursorDrawn(env), [], 'the answer of a cursor since left is not drawn as this cursor\'s');
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: cursorAnswers(requests[1]) }));
    await nextAnimationFrame(env.dom);
    assert.deepEqual(cursorDrawn(env), [cursorKey(requests[1], 0)], 'the latest answer is the Figure\'s line after the delayed backend response');
    env.dom.window.close();
});

test('renderScript: a lane scrolled into view in the frame a spectrum hover repaints in still asks for its spectrum', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    const doc = env.dom.window.document;
    const box = (top: number, height: number) => () => ({ top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    // The folded spectrum panel leaves lanes out of view without a cursor spectrum: the second lane starts far below.
    doc.getElementById('tracks-wrapper')!.getBoundingClientRect = box(0, 100);
    const secondRow = doc.getElementById('track-row-1')!;
    secondRow.getBoundingClientRect = box(1000, 100);
    await nextAnimationFrame(env.dom);
    const sliceRequests = () => env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice') as any[];
    assert.deepEqual(sliceRequests().map(msg => msg.trackIndex), [0]);
    const first = sliceRequests()[0];
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: cursorAnswers(first) }));
    await nextAnimationFrame(env.dom);
    await nextAnimationFrame(env.dom);
    assert.deepEqual(sliceRequests().map(msg => msg.trackIndex), [0]);
    // A pointer over the spectrum asks for no slice; a scroll in the same frame must still ask for them.
    doc.getElementById('spectrum-overlay-plot')!.dispatchEvent(new env.dom.window.MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }));
    secondRow.getBoundingClientRect = box(20, 100);
    doc.getElementById('tracks-wrapper')!.dispatchEvent(new env.dom.window.Event('scroll'));
    await nextAnimationFrame(env.dom);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.deepEqual(sliceRequests().map(msg => msg.trackIndex), [0, 1]);
    env.dom.window.close();
});

test('renderScript: a PNG export asks for the cursor spectrum of a lane out of view while the spectrum panel is folded', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    const doc = env.dom.window.document;
    const box = (top: number, height: number) => () => ({ top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    doc.getElementById('tracks-wrapper')!.getBoundingClientRect = box(0, 100);
    doc.getElementById('track-row-1')!.getBoundingClientRect = box(1000, 100);
    await nextAnimationFrame(env.dom);
    const sliceRequests = () => env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice') as any[];
    assert.deepEqual(sliceRequests().map(msg => msg.trackIndex), [0]);
    const first = sliceRequests()[0];
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: cursorAnswers(first) }));
    await nextAnimationFrame(env.dom);
    assert.deepEqual(sliceRequests().map(msg => msg.trackIndex), [0]);
    // The image draws every lane's analysis window band, which comes from the lane's cursor spectrum.
    doc.querySelector<HTMLButtonElement>('[data-action="export-png"]')!.click();
    await nextAnimationFrame(env.dom);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.deepEqual(sliceRequests().map(msg => msg.trackIndex), [0, 1]);
    env.dom.window.close();
});

test('renderScript: a cursor set again to where an in-flight slice was asked asks for it once more', async () => {
    const state = JSON.parse(makeLazySpectrogramState());
    state.results = state.results.slice(0, 1);
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);
    const sliceRequests = () => env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice') as any[];
    const initial = sliceRequests()[0];
    assert.ok(initial, 'initial lazy slice request should be posted');
    // Playback pausing does this: the cursor stays, but the requests asked so far are dropped while one is in flight.
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'comparison-panel-test-action',
        actionId: 'same-cursor',
        actions: [{ action: 'set-cursor', payload: { cursorNorm: initial.globalCursorNorm ?? initial.cursorNorm } }],
    } }));
    await nextAnimationFrame(env.dom);
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: cursorAnswers(initial) }));
    await nextAnimationFrame(env.dom);
    await new Promise(resolve => env.dom.window.setTimeout(resolve, 40));
    // The answer to the dropped request is stale, so a fresh one must follow or the track keeps no slice there.
    const requests = sliceRequests();
    assert.equal(requests.length, 2, 'the dropped in-flight request should be asked again');
    assert.equal(requests[1].cursorNorm, initial.cursorNorm);
    env.dom.window.close();
});

test('renderScript: a seek invalidates an in-flight spectrum response', async () => {
    const state = JSON.parse(makeLazySpectrogramState());
    state.results = state.results.slice(0, 1);
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);

    const initial = env.postedMessages.find((msg: any) => msg.type === 'request-spectrum-slice') as any;
    assert.ok(initial);
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: { type: 'comparison-panel-test-action', actions: [{ action: 'set-cursor', payload: { cursorNorm: 0.75 } }], actionId: 'seek' } }));
    await nextAnimationFrame(env.dom);

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: cursorAnswers(initial) }));
    await nextAnimationFrame(env.dom);
    await new Promise((resolve) => env.dom.window.setTimeout(resolve, 40));

    assert.deepEqual(cursorDrawn(env), [], 'the response started before the seek must not be drawn');
    const requests = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice') as any[];
    assert.equal(requests.length, 2, 'seek should retain only one replacement request');
    assert.ok(requests[1].cursorNorm > initial.cursorNorm, 'replacement request should target the seek cursor');

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: cursorAnswers(requests[1]) }));
    await nextAnimationFrame(env.dom);
    assert.deepEqual(cursorDrawn(env), [cursorKey(requests[1], 0)], 'the response for the seek cursor should be drawn');
    env.dom.window.close();
});

test('renderScript: test actions named after inherited object keys are ignored', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'comparison-panel-test-action',
        actionId: 'inherited-key-actions',
        actions: [
            { action: '__proto__', trackIndex: 0, payload: {} },
            { action: 'constructor', trackIndex: 0, payload: {} },
            { action: 'set-cursor', payload: { cursorNorm: 0.25 } },
        ],
    } }));
    await nextAnimationFrame(env.dom);

    const snapshots = env.postedMessages.filter((msg: any) => msg.type === 'comparison-panel-test-snapshot') as any[];
    const snap = snapshots[snapshots.length - 1];
    assert.equal(snap.renderedUi.cursorNorm, 0.25);
    env.dom.window.close();
});

test('再生ボタンで play 状態に切り替わる', async () => {
    const { dom } = setupEnv();
    const playButton = dom.window.document.querySelector('[data-action="toggle-playback"][data-track-id="track-1"]');
    const stopButton = dom.window.document.querySelector('[data-action="stop-playback"][data-track-id="track-1"]');
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

test('renderScript: results pane rebuild preserves playback button state', async () => {
    const env = setupMultichannelEnv();
    await nextAnimationFrame(env.dom);
    const audio = env.dom.window.document.getElementById('track-audio-0') as HTMLAudioElement | null;
    const playButton = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="toggle-playback"][data-track-id="track-1"]');
    assert.ok(audio instanceof env.dom.window.HTMLAudioElement);
    assert.ok(playButton instanceof env.dom.window.HTMLButtonElement);

    (audio as HTMLAudioElement & { duration: number }).duration = 1;
    playButton.click();
    await Promise.resolve();
    assert.equal(playButton.textContent, '⏸');

    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'analysis-update',
        results: JSON.parse(MULTICHANNEL_APP_STATE).results,
    } }));
    await nextAnimationFrame(env.dom);

    const rebuiltPlayButton = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="toggle-playback"][data-track-id="track-1"]');
    const rebuiltStopButton = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="stop-playback"][data-track-id="track-1"]');
    assert.equal(rebuiltPlayButton?.textContent, '⏸');
    assert.equal(rebuiltStopButton?.disabled, false);

    rebuiltStopButton?.click();
    await Promise.resolve();
    env.dom.window.close();
});

test('renderScript: cursorNorm initializes as number (not null)', () => {
    // The cursor starts at 0 (a number): when the tracks are analysed again the toolbar writes it as a time from the
    // start, never NaN. (A row's Figure writes it when the pointer leaves the row: rowsScreen `reads`.)
    const { dom } = setupEnv();
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'analysis-update', results: JSON.parse(DUMMY_APP_STATE).results } }));
    const cursorDisplay = dom.window.document.getElementById('cursor-display');
    assert.ok(cursorDisplay, '#cursor-display が存在すること');
    assert.equal(cursorDisplay.textContent, '0:00.00', 'cursorNorm=0 のとき cursor-display は "0:00.00" を表示すること');
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
            peakAbsolute: 0.5,
            // The backend names every channel's level reference (an uncalibrated recording's dBFS).
            sourceLevelReferenceLabel: 'dBFS',
        }],
    })),
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
                peakAbsolute: 0.5,
            }],
        },
    ],
});

function setupSpectrumEnv() {
    const script = getRenderScript();
    const env = createWebviewEnv(SPECTRUM_APP_STATE);
    evalScript(env.dom, script);
    return env;
}

function setupHighFrequencyReadoutEnv() {
    const script = getRenderScript();
    const env = createWebviewEnv(HIGH_FREQUENCY_READOUT_STATE);
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
    evalScript(env.dom, script);
    return env;
}

test('renderScript: the cursor spectrum is the only power spectrum, and it is keyboard-focusable', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    assert.equal(env.dom.window.document.querySelectorAll('.track-row .track-spectrum-canvas, .track-row .track-spectrum-wrap').length, 0,
        'トラック行にスペクトルを置かないこと');
    // One Figure in the panel's box: its canvas takes the keyboard (R7), as every Figure's does.
    await settleTracksFigures(env);
    const canvases = env.dom.window.document.querySelectorAll('#spectrum-overlay-plot canvas');
    assert.equal(canvases.length, 1, 'the panel\'s box holds one Figure');
    assert.equal(canvases[0].getAttribute('tabindex'), '0');
    env.dom.window.close();
});

test('the time ruler maps its ticks to the rows\' width', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const row = env.dom.window.document.getElementById('ruler-row');
    assert.ok(row);
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 994 });
    const ruler = env.dom.window.document.getElementById('ruler-canvas') as HTMLCanvasElement | null;
    assert.ok(ruler);

    const spectrogramBtn = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="content-waveform"]');
    assert.ok(spectrogramBtn);
    spectrogramBtn.click();
    await nextAnimationFrame(env.dom);

    const rulerSpy = env.domCanvasContexts.get('ruler-canvas');
    assert.ok(rulerSpy);
    const tick = rulerSpy.fillTextArgs.filter((call) => call.text === '0.4').at(-1);
    assert.ok(tick, '0.4 秒 tick が描画されること: ' + JSON.stringify(rulerSpy.fillTextArgs.map((call) => call.text)));
    assert.equal(tick.x, 322, 'the ruler\'s 0.4 s tick (of 1 s) is drawn at 40 % of the 800px lane + its label offset');
    env.dom.window.close();
});

test('renderScript: playback spectrum scheduler keeps the next rAF cursor desired', async () => {
    const clock = { now: 1000 };
    const env = setupSpectrumEnvWithClock(clock);
    await nextAnimationFrame(env.dom);

    const audio = env.dom.window.document.getElementById('track-audio-0') as HTMLAudioElement;
    const playButton = env.dom.window.document.querySelector('[data-action="toggle-playback"][data-track-id="track-1"]') as HTMLButtonElement;
    const stopButton = env.dom.window.document.querySelector('[data-action="stop-playback"][data-track-id="track-1"]') as HTMLButtonElement;
    (audio as HTMLAudioElement & { duration: number }).duration = 15;
    const first = env.postedMessages.find((msg: any) => msg.type === 'request-spectrum-slice') as any;
    assert.ok(first);
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: cursorAnswers(first) }));
    await nextAnimationFrame(env.dom);

    playButton.click();
    await Promise.resolve();
    clock.now = 1016;
    (audio as HTMLAudioElement & { currentTime: number }).currentTime = 0.016;
    await nextAnimationFrame(env.dom);
    clock.now = 1032;
    await new Promise((resolve) => env.dom.window.setTimeout(resolve, 35));

    const requests = env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice') as any[];
    assert.equal(requests.length, 2, 'a cursor one display frame ahead must remain desired until the rate limit opens');
    assert.ok(requests[1].cursorNorm > 0, 'the trailing request must advance beyond the first cursor');
    stopButton.click();
    env.dom.window.close();
});

// ── The cursor spectrum as a Figure ─────────────────────────────────

/** The keys of the lines of the cursor spectrum the page last asked the figure service to draw ([] with none asked). */
const cursorDrawn = (env: ReturnType<typeof setupEnv>): string[] => lastDrawnKeys(env, 'spectrum');
/** How many times the page asked the figure service to draw a cursor spectrum. */
const cursorDraws = (env: ReturnType<typeof setupEnv>): number => drawnSpecs(env).filter(spec => spec.lanes[0]?.id === 'spectrum').length;
const settled = new WeakMap<object, { cursor: Set<string>; figures: Set<string> }>();
/** Plays the host until the page asks nothing more: every cursor spectrum request and every figure request answered. */
async function settleTracksFigures(env: ReturnType<typeof setupEnv>, channels: (request: { trackIndex: number }) => readonly number[] = () => [0]): Promise<void> {
    const done = settled.get(env) ?? { cursor: new Set<string>(), figures: new Set<string>() };
    settled.set(env, done);
    for (let round = 0, quiet = 0; round < 30 && quiet < 2; round++) {
        const answered = answerCursorRequests(env, done.cursor, channels) + answerFigures(env, done.figures);
        quiet = answered ? 0 : quiet + 1;
        await nextAnimationFrame(env.dom);
    }
}
const setCursor = (env: ReturnType<typeof setupEnv>, cursorNorm: number, actionId: string): void => {
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: { type: 'comparison-panel-test-action', actionId, actions: [{ action: 'set-cursor', payload: { cursorNorm } }] } }));
};
const cursorRequests = (env: ReturnType<typeof setupEnv>): any[] => env.postedMessages.filter((msg: any) => msg.type === 'request-spectrum-slice') as any[];
const lastSnapshot = (env: ReturnType<typeof setupEnv>): any => (env.postedMessages.filter((msg: any) => msg.type === 'comparison-panel-test-snapshot') as any[]).at(-1);

test('the cursor spectrum is one Figure of the tracks\' kept answers: a line a channel in the order of the rows, asked for by key with no value of a line in the page', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    assert.equal(cursorDraws(env), 0, 'nothing is drawn of a track before its answer');
    await settleTracksFigures(env);
    // One request at a time (the backend's queue is not filled), a track after another.
    const asked = cursorRequests(env);
    assert.deepEqual(asked.map(request => [request.trackIndex, request.answers]), [[0, 'linear'], [1, 'linear']], 'each track asks for its answers kept by key, on a linear frequency axis');
    const spec = drawnSpecs(env).at(-1)!;
    assert.deepEqual(spec.lanes.map(lane => [lane.id, lane.lines.map(line => line.of)]), [['spectrum', [{ key: cursorKey(asked[0], 0) }, { key: cursorKey(asked[1], 0) }]]]);
    assert.deepEqual(spec.keys.map(key => [key.key, key.state, key.level]), asked.map(request => [cursorKey(request, 0), 'usable', { unit: 'FS', ref: 1, label: 'dBFS' }]));
    // The page's snapshot reads what the Figure drew: both tracks have a line, and the axes are named, with their ticks.
    const snap = lastSnapshot(env);
    assert.equal(snap.renderedUi.visibleSpectrumTrackCount, 2);
    assert.deepEqual(Array.from(snap.renderedUi.axisLabels.spectrumOverlay as string[]).filter((text: string) => /\[/.test(text)), ['Frequency [Hz]', 'Level, uncalibrated [dBFS]'], JSON.stringify(snap.renderedUi.axisLabels.spectrumOverlay));
    assert.ok(snap.renderedUi.axisLabels.spectrumOverlay.length > 2, 'the ticks drawn are in the snapshot too');
    // The legend names each line by its track's colour.
    const swatches = [...env.dom.window.document.querySelectorAll<HTMLElement>('#spectrum-axis-legend .spectrum-axis-legend-swatch')];
    assert.equal(swatches.length, 2);
    assert.notEqual(swatches[0].style.background, swatches[1].style.background);
    assert.equal(env.dom.window.document.getElementById('spectrum-overlay-empty')?.hidden, true);
    env.dom.window.close();
});

test('recordings in another unit or reference are on a lane of their own, one above another (the old right-hand level axis is gone)', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const done = new Set<string>(), figures = new Set<string>();
    const pascal = { unit: 'Pa', ref: 2e-5, label: 'dB SPL re 20 µPa' };
    for (let round = 0; round < 6; round++) {
        answerCursorRequests(env, done, () => [0], request => (request.trackIndex === 1 ? pascal : { unit: 'FS', ref: 1, label: 'dBFS' }));
        answerFigures(env, figures);
        await nextAnimationFrame(env.dom);
    }
    const spec = drawnSpecs(env).at(-1)!;
    assert.deepEqual(spec.lanes.map(lane => [lane.id, lane.axis, lane.lines.length]), [['spectrum', 'own', 1], ['spectrum-2', 'own', 1]]);
    assert.deepEqual(spec.keys.map(key => key.level?.label), ['dBFS', 'dB SPL re 20 µPa']);
    env.dom.window.close();
});

test('a cursor action keeps the last picture while the new cursor\'s answers are on their way, then draws them; another band setting does not keep it (V6)', async () => {
    const state = JSON.parse(makeLazySpectrogramState());
    state.results = state.results.slice(0, 1);
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);
    await settleTracksFigures(env);
    const first = cursorRequests(env).at(-1);
    assert.deepEqual(cursorDrawn(env), [cursorKey(first, 0)]);
    const draws = cursorDraws(env);
    // A cursor action: the answers of the cursor before are not this cursor's (R7), and nothing new is asked of the
    // figure service while this cursor's are on their way: the Figure keeps the picture it has.
    setCursor(env, 0.5, 'hold-cursor');
    await nextAnimationFrame(env.dom);
    const next = cursorRequests(env).at(-1);
    assert.ok(next.cursorNorm > 0.45 && next.cursorNorm < 0.55, 'the new cursor asks for its own answers: ' + next.cursorNorm);
    assert.equal(cursorDraws(env), draws, 'no draw while the new cursor\'s answers are on their way');
    assert.equal(env.dom.window.document.querySelectorAll('#spectrum-overlay-plot canvas').length, 1, 'the Figure stays');
    await settleTracksFigures(env);
    assert.deepEqual(cursorDrawn(env), [cursorKey(next, 0)], 'the new cursor\'s answers are drawn when they come');
    // Another band setting: the picture is of other conditions, so it is not kept on screen.
    env.dom.window.document.querySelector<HTMLElement>('[data-action="spectrum-octave-3"]')?.click();
    await nextAnimationFrame(env.dom);
    assert.equal(cursorRequests(env).at(-1).bandsPerOctave, 3, 'the band setting asks again');
    assert.equal(env.dom.window.document.querySelectorAll('#spectrum-overlay-plot canvas').length, 0, 'the Figure of the other setting is taken away');
    assert.equal(env.dom.window.document.getElementById('spectrum-overlay-empty')?.hidden, false, 'and the panel says there is no data yet');
    env.dom.window.close();
});

test('a failed cursor spectrum request frees the track to ask again at another cursor', async () => {
    const state = JSON.parse(makeLazySpectrogramState());
    state.results = state.results.slice(0, 1);
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);
    const request = cursorRequests(env).at(-1);
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'spectrum-slice-error', requestId: request.requestId, analysisId: request.analysisId, settingsSignature: request.settingsSignature,
        trackIndex: 0, filePath: '/tmp/a.wav', error: 'slice failed',
    } }));
    await nextAnimationFrame(env.dom);
    const before = cursorRequests(env).length;
    setCursor(env, 0.7, 'slice-retry-after-error');
    await nextAnimationFrame(env.dom);
    assert.ok(cursorRequests(env).length > before, 'a terminal error must release the active request for another cursor');
    env.dom.window.close();
});

test('the display settings\' dB range and top frequency are the cursor spectrum\'s range, sent with the draw and asking for no new answers', async () => {
    const state = JSON.parse(makeLazySpectrogramState());
    state.results = state.results.slice(0, 1);
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);
    await settleTracksFigures(env);
    const before = cursorRequests(env).length;
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'comparison-panel-test-action', actionId: 'lazy-slice-display',
        actions: [{ action: 'set-spectrogram-display', payload: { dbMin: -60, dbMax: 0, maxFrequencyHz: 1000 } }],
    } }));
    await nextAnimationFrame(env.dom);
    await nextAnimationFrame(env.dom);
    assert.equal(cursorRequests(env).length, before, 'a display-only change reuses the kept answers');
    const draw = figureRequests(env, 'figure-draw').at(-1)!.payload as any;
    assert.deepEqual(draw.view, { x: [null, 1000], lanes: [{ lane: 'spectrum', y: [-60, 0] }] });
    env.dom.window.close();
});

test('a cursor past a track\'s end draws no line of that track: no stand-in, no floor line', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    await settleTracksFigures(env);
    assert.equal(lastSnapshot(env).renderedUi.visibleSpectrumTrackCount, 2);
    const asked = cursorRequests(env).length;
    setCursor(env, 1, 'spectrum-end-cursor');
    await nextAnimationFrame(env.dom);
    await settleTracksFigures(env);
    assert.equal(lastSnapshot(env).renderedUi.cursorNorm, 1);
    assert.equal(cursorRequests(env).length, asked, 'nothing is asked at the very end of the tracks');
    assert.equal(env.dom.window.document.querySelectorAll('#spectrum-overlay-plot canvas').length, 0, 'no Figure');
    assert.equal(env.dom.window.document.getElementById('spectrum-overlay-empty')?.hidden, false, 'the panel says there is no data');
    assert.equal(lastSnapshot(env).renderedUi.visibleSpectrumTrackCount, 0);
    env.dom.window.close();
});

test('while playing, the Figure is asked to draw only when an answer comes in, never on a playback tick alone', async () => {
    const clock = { now: 1000 };
    const env = setupSpectrumEnvWithClock(clock);
    await nextAnimationFrame(env.dom);
    await settleTracksFigures(env);
    const audio = env.dom.window.document.getElementById('track-audio-0') as HTMLAudioElement;
    const playButton = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="toggle-playback"][data-track-id="track-1"]')!;
    const stopButton = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="stop-playback"][data-track-id="track-1"]')!;
    (audio as HTMLAudioElement & { duration: number }).duration = 1;
    playButton.click();
    await Promise.resolve();
    await nextAnimationFrame(env.dom);
    const draws = cursorDraws(env);
    const asked = cursorRequests(env).length;
    clock.now = 1034;
    (audio as HTMLAudioElement & { currentTime: number }).currentTime = 0.5;
    await nextAnimationFrame(env.dom);
    await nextAnimationFrame(env.dom);
    assert.equal(cursorDraws(env), draws, 'a playback tick alone draws no cursor spectrum: the last picture stays');
    const open = cursorRequests(env).slice(asked);
    assert.ok(open.length >= 1, 'the playing cursor asks for its answers');
    assert.ok(new Set(open.map(request => request.trackIndex)).size === open.length, 'one request a track in flight');
    await settleTracksFigures(env);
    assert.ok(cursorDraws(env) > draws, 'the answers that come in are drawn');
    stopButton.click();
    env.dom.window.close();
});

test('a role set on a track header gives its cursor spectrum line the role colour (the legend\'s swatch shows it)', async () => {
    const env = setupSelectionResultsEnv();
    await nextAnimationFrame(env.dom);
    await settleTracksFigures(env);
    const swatch = (): string => env.dom.window.document.querySelector<HTMLElement>('#spectrum-axis-legend .spectrum-axis-legend-swatch')?.style.background ?? '';
    const before = swatch();
    assert.ok(before, 'the line has its track\'s colour');
    // Its menu is filled as it opens.
    env.dom.window.document.querySelector<HTMLElement>('.track-row .role-chip summary')!.click();
    await nextAnimationFrame(env.dom);
    env.dom.window.document.querySelector<HTMLElement>('.track-row .role-chip [data-action="track-role-set"][data-slot="1"]')!.click();
    await nextAnimationFrame(env.dom);
    await settleTracksFigures(env);
    assert.notEqual(swatch(), before, 'the role\'s colour');
    env.dom.window.close();
});

test('export-csv writes the table the Figure answers: every answer of the lines shown, named as the legend names them', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    await settleTracksFigures(env);
    const created: Array<{ download: string; href: string }> = [];
    const realCreate = env.dom.window.document.createElement.bind(env.dom.window.document);
    env.dom.window.document.createElement = ((tag: string) => {
        const element = realCreate(tag);
        if (tag.toLowerCase() === 'a') { (element as HTMLAnchorElement).click = () => { created.push({ download: (element as HTMLAnchorElement).download, href: (element as HTMLAnchorElement).href }); }; }
        return element;
    });
    env.dom.window.document.querySelector('[data-action="export-csv"]')?.dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true }));
    for (let round = 0; round < 20 && !created.length; round++) {
        await settleTracksFigures(env);
        await new Promise(resolve => env.dom.window.setTimeout(resolve, 10));
    }
    const exported = figureRequests(env, 'figure-export');
    assert.equal(exported.length, 1, 'the CSV is asked of the figure service, once');
    const anchor = created.find(item => item.download.endsWith('.csv'));
    assert.ok(anchor, 'a CSV is downloaded: ' + JSON.stringify(created.map(item => item.download)));
    const csv = decodeDataUriPayload(anchor.href);
    const rows = csvRecords(csv);
    assert.equal(rows[0].length, 4, 'a frequency and a level column a line: ' + JSON.stringify(rows[0]));
    assert.ok(rows[0][0].includes('spec-0.wav') && rows[0][2].includes('spec-1.wav'), JSON.stringify(rows[0]));
    assert.deepEqual(rows.slice(1).map(row => [Number(row[0]), Number(row[1])]), TEST_LINE.xs.map((x, at) => [x, TEST_LINE.values[at]]));
    env.dom.window.close();
});

// ── Offset direct edit ────────────────────────────────────────────────────────

/** オフセット編集テスト用: setTimeout を即時実行に差し替えて 200ms 待ちを不要にする */
function withSyncTimeout(env: ReturnType<typeof setupEnv>, fn: () => void) {
    const orig = env.dom.window.setTimeout;
    (env.dom.window as any).setTimeout = (cb: () => void) => { cb(); return 0; };
    try { fn(); } finally { (env.dom.window as any).setTimeout = orig; }
}

test('renderScript: click .track-offset-val opens inline input', () => {
    const env = setupEnv();
    const span = env.dom.window.document.querySelector<HTMLElement>('.track-offset-val');
    assert.ok(span, '.track-offset-val span が存在すること');

    withSyncTimeout(env, () => {
        span.dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    });

    const input = span.parentNode?.querySelector('input.track-offset-input') as HTMLInputElement | null;
    assert.ok(input, 'クリック後に .track-offset-input input が挿入されること');
    assert.equal(span.style.display, 'none', 'クリック後に span が非表示になること');
    env.dom.window.close();
});

test('renderScript: Enter commits inline offset edit', () => {
    const env = setupEnv();
    const span = env.dom.window.document.querySelector<HTMLElement>('.track-offset-val');
    assert.ok(span, '.track-offset-val span が存在すること');

    withSyncTimeout(env, () => {
        span.dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    });

    const input = span.parentNode?.querySelector('input.track-offset-input') as HTMLInputElement | null;
    assert.ok(input, 'input が挿入されること');

    input.value = '500';
    input.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    assert.ok(!span.parentNode?.querySelector('input.track-offset-input'), 'Enter 後に input が削除されること');
    assert.equal(span.style.display, '', 'Enter 後に span が再表示されること');
    env.dom.window.close();
});

test('renderScript: Escape cancels inline offset edit', () => {
    const env = setupEnv();
    const span = env.dom.window.document.querySelector<HTMLElement>('.track-offset-val');
    assert.ok(span, '.track-offset-val span が存在すること');

    const originalText = span.textContent;
    withSyncTimeout(env, () => {
        span.dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true, detail: 1 }));
    });

    const input = span.parentNode?.querySelector('input.track-offset-input') as HTMLInputElement | null;
    assert.ok(input, 'input が挿入されること');

    input.value = '9999';
    input.dispatchEvent(new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));

    assert.ok(!span.parentNode?.querySelector('input.track-offset-input'), 'Escape 後に input が削除されること');
    assert.equal(span.style.display, '', 'Escape 後に span が再表示されること');
    assert.equal(span.textContent, originalText, 'Escape 後に span のテキストが変化しないこと');
    env.dom.window.close();
});

// ── Export PNG / CSV ──────────────────────────────────────────────────────────

test('renderScript: export-png button does not throw', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    const btn = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="export-png"]');
    assert.ok(btn, '[data-action="export-png"] ボタンが存在すること');
    assert.doesNotThrow(() => { btn.click(); }, 'export-png クリックが例外を投げないこと');
    env.dom.window.close();
});

test('renderScript: export-csv button does not throw', async () => {
    const env = setupSpectrumEnv();
    await nextAnimationFrame(env.dom);
    const btn = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="export-csv"]');
    assert.ok(btn, '[data-action="export-csv"] ボタンが存在すること');
    assert.doesNotThrow(() => { btn.click(); }, 'export-csv クリックが例外を投げないこと');
    env.dom.window.close();
});

test('renderScript: multichannel track UI renders all channel sublanes without a selector', async () => {
    const env = setupMultichannelEnv();
    await nextAnimationFrame(env.dom);

    assert.equal(env.dom.window.document.querySelector('[data-action="select-channel"]'), null);
    assert.equal(env.dom.window.document.querySelectorAll('#track-row-0 .track-channel-lane').length, 2);

    const metaText = Array.from(env.dom.window.document.querySelectorAll('#track-row-0 .track-meta'))
        .map((el) => el.textContent || '')
        .join(' ');
    assert.match(metaText, /^2 ch/);
    assert.doesNotMatch(metaText, /Displayed:/);

    const laneTexts = Array.from(env.dom.window.document.querySelectorAll('#track-row-0 .track-channel-lane-header'))
        .map((el) => el.textContent || '');
    assert.ok(laneTexts.some((text) => /Channel 1 \/ 2 \(Left\).*Peak −6\.0 dB/.test(text)), laneTexts.join('\n'));
    assert.ok(laneTexts.some((text) => /Channel 2 \/ 2 \(Right\).*Peak −0\.4 dB/.test(text)), laneTexts.join('\n'));

    assert.equal(env.dom.window.document.getElementById('metrics-bar'), null);
    assert.equal(env.dom.window.document.querySelector('#metrics-item-0'), null);
    env.dom.window.close();
});

test('renderScript: channel peak metrics use backend-provided levels without recalculating dB', async () => {
    const state = JSON.parse(MULTICHANNEL_APP_STATE);
    state.results[0].channels[0].peakLevelDb = 45.6;
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);

    const firstLane = env.dom.window.document.querySelector(
        '#track-row-0 .track-channel-lane-header',
    );
    assert.match(firstLane?.textContent ?? '', /Peak 45\.6 dB/);

    env.dom.window.document.querySelector('[data-action="export-report"]')?.dispatchEvent(
        new env.dom.window.MouseEvent('click', { bubbles: true }),
    );
    const msg = env.postedMessages.find((posted: any) => posted.type === 'export-report-options') as any;
    assert.match(msg.markdownContent, /\| 45\.6 dBFS \|/);
    env.dom.window.close();
});

function decodeDataUriPayload(uri: string): string {
    const comma = uri.indexOf(',');
    assert.ok(comma >= 0, 'data URI に payload があること');
    return decodeURIComponent(uri.slice(comma + 1));
}

test('renderScript: multichannel report lists peak metrics for every channel', async () => {
    const env = setupMultichannelEnv();
    await nextAnimationFrame(env.dom);

    env.dom.window.document.querySelector('[data-action="export-report"]')?.dispatchEvent(
        new env.dom.window.MouseEvent('click', { bubbles: true }),
    );

    const msg = env.postedMessages.find((posted: any) => posted.type === 'export-report-options') as any;
    assert.ok(msg, 'report export message が送信されること');
    assert.match(msg.markdownContent, /\| File \| Channel \| Sample Rate \| Duration \| Channels \| Peak \|/);
    assert.match(msg.markdownContent, /\| stereo\.wav \| Channel 1 \/ 2 \(Left\) \| 44100 Hz \| 1\.000s \| 2 \| −6\.0 dBFS \|/);
    assert.match(msg.markdownContent, /\| stereo\.wav \| Channel 2 \/ 2 \(Right\) \| 44100 Hz \| 1\.000s \| 2 \| −0\.4 dBFS \|/);
    assert.doesNotMatch(msg.markdownContent, /Spectral Peaks/);
    const notebook = JSON.parse(msg.notebookContent) as { cells: Array<{ id: string; source: string[] }> };
    const loadCell = notebook.cells.find((cell) => cell.id === 'load-files');
    assert.ok(loadCell);
    assert.match(loadCell.source.join(''), /wd\.read\("\/tmp\/stereo\.wav"\)/);
    assert.doesNotMatch(loadCell.source.join(''), /read_wav/);
    env.dom.window.close();
});

test('renderScript: multichannel report sanitizes channel markdown', async () => {
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

test('renderScript: calibrated report escapes units and keeps peak references', async () => {
    const state = JSON.parse(MULTICHANNEL_APP_STATE);
    Object.assign(state.results[0].channels[0], {
        measurement: {
            calibrationStatus: 'calibrated',
            calibrationSource: 'manual',
            factor: 2,
            linearUnit: 'Pa|rms',
            referenceValue: 1,
            referenceUnit: 'Pa|ref',
            levelUnit: 'dB',
            levelReferenceLabel: 'dB re 1 Pa|ref',
        },
        peakLevelDb: 80,
        rawPeakFullScale: 0.25,
    });
    Object.assign(state.results[0].channels[1], {
        measurement: {
            calibrationStatus: 'uncalibrated',
            calibrationSource: 'default',
            factor: 1,
            linearUnit: 'FS',
            referenceValue: 1,
            referenceUnit: 'FS',
            levelUnit: 'dBFS',
            levelReferenceLabel: 'dBFS',
        },
        peakLevelDb: -0.4,
        rawPeakFullScale: 0.95,
    });
    const env = setupEnvWithState(JSON.stringify(state));
    await nextAnimationFrame(env.dom);

    env.dom.window.document.querySelector('[data-action="export-report"]')?.dispatchEvent(
        new env.dom.window.MouseEvent('click', { bubbles: true }),
    );

    const msg = env.postedMessages.find((posted: any) => posted.type === 'export-report-options') as any;
    assert.ok(msg, 'report export message should be sent');
    assert.match(msg.markdownContent, /0\.500 Pa\\\|rms \/ 80\.0 dB/);
    assert.doesNotMatch(msg.markdownContent, /Spectral Peaks/);
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

test('renderScript: report export skips locally removed tracks', async () => {
    const env = setupEnv();
    env.dom.window.document.querySelector(
        '[data-action="remove-track"][data-track-id="track-1"]',
    )?.dispatchEvent(new env.dom.window.MouseEvent('click', { bubbles: true }));
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
        data: {
            type: 'comparison-panel-test-action',
            actionId: 'removed-track-report',
            actions: [{ action: 'set-loop-region', payload: { start: 0.1, end: 0.5 } }],
        },
    }));
    await nextAnimationFrame(env.dom);

    env.dom.window.document.querySelector('[data-action="export-report"]')?.dispatchEvent(
        new env.dom.window.MouseEvent('click', { bubbles: true }),
    );

    const msg = env.postedMessages.find((posted: any) => posted.type === 'export-report-options') as any;
    assert.ok(msg, 'report export message should be sent');
    assert.doesNotMatch(msg.markdownContent, /a\.wav/);
    assert.match(msg.markdownContent, /b\.wav/);
    env.dom.window.close();
});

// ── Zoom-to-Selection (⇔) & F/L shortcuts ────────────────────────────────────

test('renderScript: zoom-to-selection ボタンがツールバーに存在すること', () => {
    const env = setupEnv();
    const btn = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="zoom-to-selection"]');
    assert.ok(btn, '[data-action="zoom-to-selection"] ボタンが存在すること');
    env.dom.window.close();
});

test('renderScript: zoom-to-selection ボタンはループがない状態で disabled であること', () => {
    const env = setupEnv();
    const btn = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="zoom-to-selection"]');
    assert.ok(btn, '[data-action="zoom-to-selection"] ボタンが存在すること');
    assert.equal(btn.disabled, true, 'ループがない場合は disabled であること');
    env.dom.window.close();
});

test('renderScript: F キーで follow-cursor ボタンの is-active が切り替わること', () => {
    const env = setupEnv();
    const followBtn = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="toggle-follow-cursor"]');
    assert.ok(followBtn, '[data-action="toggle-follow-cursor"] ボタンが存在すること');
    assert.equal(followBtn.classList.contains('is-active'), false, '初期状態は非アクティブであること');

    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f' }),
    );
    assert.equal(followBtn.classList.contains('is-active'), true, 'F キー後に is-active になること');

    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f' }),
    );
    assert.equal(followBtn.classList.contains('is-active'), false, 'F キー再押しで is-active が解除されること');
    env.dom.window.close();
});

test('renderScript: L キーはループがある場合に zoom-to-selection を実行すること', async () => {
    const env = setupEnv();
    // ループ区間を作る（行の図の Alt+ドラッグが作るのと同じ区間）
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: { type: 'comparison-panel-test-action', actions: [{ action: 'set-loop-region', payload: { start: 0.1, end: 0.4 } }], actionId: 'loop' } }));

    const zoomBtn = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="zoom-to-selection"]');
    assert.ok(zoomBtn, '[data-action="zoom-to-selection"] ボタンが存在すること');
    // ループ作成後は disabled が解除されていることを検証
    assert.equal(zoomBtn.disabled, false, 'ループ作成後は zoom-to-selection ボタンが enabled になること');

    // follow-cursor を一旦有効化しておく
    const followBtn = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="toggle-follow-cursor"]');
    assert.ok(followBtn, 'follow-cursor ボタンが存在すること');
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f' }),
    );
    assert.equal(followBtn.classList.contains('is-active'), true, 'follow-cursor が有効になっていること');

    // L キーを押下して zoom-to-selection を実行
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'l' }),
    );

    // 副作用の検証 1: follow-cursor が無効化されること
    assert.equal(followBtn.classList.contains('is-active'), false, 'zoom-to-selection により follow-cursor が無効化されること');

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
    const followBtn = env.dom.window.document.querySelector<HTMLButtonElement>('[data-action="toggle-follow-cursor"]');
    assert.ok(followBtn, '[data-action="toggle-follow-cursor"] ボタンが存在すること');
    assert.equal(followBtn.classList.contains('is-active'), false, '初期状態は非アクティブであること');

    // Ctrl+F を押下
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f', ctrlKey: true }),
    );
    assert.equal(followBtn.classList.contains('is-active'), false, 'Ctrl+F キーでは is-active にならないこと');

    // Alt+F を押下
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f', altKey: true }),
    );
    assert.equal(followBtn.classList.contains('is-active'), false, 'Alt+F キーでは is-active にならないこと');

    // Meta+F を押下
    env.dom.window.document.dispatchEvent(
        new env.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'f', metaKey: true }),
    );
    assert.equal(followBtn.classList.contains('is-active'), false, 'Meta+F キーでは is-active にならないこと');

    env.dom.window.close();
});

test('renderScript: 修飾キーなし wheel はトラック領域の標準スクロールに渡すこと', async () => {
    const env = setupEnv();
    const wrapper = env.dom.window.document.getElementById('tracks-wrapper');
    assert.ok(wrapper, '#tracks-wrapper が存在すること');

    const event = new env.dom.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 120,
    });
    const wasNotCanceled = wrapper.dispatchEvent(event);

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
    const wrapper = env.dom.window.document.getElementById('tracks-wrapper');
    assert.ok(wrapper, '#tracks-wrapper が存在すること');

    const event = new env.dom.window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -120,
    });
    const wasNotCanceled = wrapper.dispatchEvent(event);

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

    // The lane's plot height is shared: 40 % waveform, the rest its spectrogram.
    assert.deepEqual(rowHeights(env.dom), { wave: 40, spec: 60 });

    const snap = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot').at(-1) as any;
    assert.strictEqual(snap?.renderedUi?.trackHeight, 100);

    env.dom.window.close();
});

test('高さの数値入力がトラックの行とパワースペクトルの枠の高さを変更する', async () => {
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

    const overlayPlot = env.dom.window.document.getElementById('spectrum-overlay-plot');
    assert.ok(overlayPlot);
    // 112 px of plots: 45 waveform + 67 spectrogram.
    assert.deepEqual(rowHeights(env.dom), { wave: 45, spec: 67 });
    // The Figure is drawn at its box's size: the box takes the height typed.
    assert.strictEqual(overlayPlot.style.height, '180px');

    const snap1 = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot').at(-1) as any;
    assert.strictEqual(snap1?.renderedUi?.trackHeight, 112);
    assert.strictEqual(snap1?.renderedUi?.spectrumOverlayHeight, 180);

    env.dom.window.close();
});

test('高さリサイズハンドルのドラッグがトラックとパワースペクトルの高さを変更する', async () => {
    const env = setupEnv();
    await nextAnimationFrame(env.dom);
    // The cursor spectrum starts folded; open it to drag its edge.
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: { type: 'comparison-panel-test-action', actions: ['toggle-spectrum-panel'], actionId: 'open-dock' } }));
    await nextAnimationFrame(env.dom);

    const trackHandle = env.dom.window.document.querySelector<HTMLElement>('[data-action="track-height-drag"]');
    assert.ok(trackHandle);
    const spectrumHandle = env.dom.window.document.querySelector<HTMLElement>('[data-action="spectrum-height-drag"]');
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

    // The cursor spectrum's box is the Figure's: the Figure sizes its own canvas to it.
    const overlayBox = env.dom.window.document.getElementById('spectrum-overlay-plot');
    assert.ok(overlayBox);
    // 160 + 24 px of plots, 40 % of it the waveform.
    assert.equal(rowHeights(env.dom).wave, 74);
    assert.strictEqual(overlayBox.style.height, '170px');

    const snap = env.postedMessages.filter((m: any) => m.type === 'comparison-panel-test-snapshot').at(-1) as any;
    assert.strictEqual(snap?.renderedUi?.trackHeight, 184);
    assert.strictEqual(snap?.renderedUi?.spectrumOverlayHeight, 170);

    env.dom.window.close();
});

test('ズームのモード切り替えボタンはない: どのレーンでもドラッグは矩形ズーム', () => {
    const { dom } = setupEnv();
    assert.strictEqual(dom.window.document.querySelector('[data-action="wave-mode-rect-zoom"]'), null);
    assert.strictEqual(dom.window.document.querySelector('[data-action="wave-mode-loop"]'), null);
});

test('初期スペクトルズーム状態が全域である', async () => {
    const { dom, postedMessages } = setupEnv();
    await nextAnimationFrame(dom);
    const snapMsg = postedMessages.find((m: any) => m.type === 'comparison-panel-test-snapshot') as any;
    assert.ok(snapMsg, 'スナップショットメッセージが送信されること');
    assert.strictEqual(snapMsg.renderedUi.specFreqStart, 0,      'specFreqStart の初期値が 0 であること');
    assert.strictEqual(snapMsg.renderedUi.specFreqEnd,   1,      'specFreqEnd の初期値が 1 であること');
});

test('tracks without an audio source disable all playback controls', () => {
    const state = JSON.parse(DUMMY_APP_STATE);
    delete state.results[0].audioSource;
    const { dom } = setupEnvWithState(JSON.stringify(state));
    for (const action of ['toggle-playback', 'stop-playback']) {
        const buttons = dom.window.document.querySelectorAll<HTMLButtonElement>(`.track-row [data-action="${action}"]`);
        assert.equal(buttons[0].disabled, true);
        if (action !== 'stop-playback') assert.equal(buttons[1].disabled, false);
    }
    dom.window.close();
});

test('renderScript: a detail error is not asked again on every render until the settings change', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    const button = env.dom.window.document.querySelector('[data-action="content-waveform"]') as HTMLButtonElement;
    button.click();
    await nextAnimationFrame(env.dom);
    const detailRequests = () => env.postedMessages.filter((msg: any) => msg.type === 'request-track-detail') as any[];
    const initial = detailRequests()[0];
    assert.ok(initial);
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        ...initial, type: 'track-detail-error', error: 'Out of memory',
    } }));
    for (const startNorm of [0.1, 0.2, 0.3]) {
        env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
            type: 'comparison-panel-test-action', actionId: `rerender-${startNorm}`,
            actions: [{ action: 'set-loop-region', payload: { start: startNorm, end: startNorm + 0.1 } }],
        } }));
        await nextAnimationFrame(env.dom);
    }
    const failedTrackRequests = detailRequests().filter((msg: any) => msg.filePath === initial.filePath);
    assert.equal(failedTrackRequests.length, 1, 'renders after the error must not ask for the spectrogram again');
    env.dom.window.close();
});

test('renderScript: a failed spectrogram is asked for again once the retry pause has passed', async () => {
    const env = setupEnvWithState(makeLazySpectrogramState());
    const button = env.dom.window.document.querySelector('[data-action="content-waveform"]') as HTMLButtonElement;
    button.click();
    await nextAnimationFrame(env.dom);
    const detailRequests = () => env.postedMessages.filter((msg: any) => msg.type === 'request-track-detail') as any[];
    const initial = detailRequests()[0];
    assert.ok(initial);
    const realNow = env.dom.window.Date.now;
    let now = realNow.call(env.dom.window.Date);
    env.dom.window.Date.now = () => now;
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        ...initial, type: 'track-detail-error', error: 'Python backend restarting',
    } }));
    now += 11_000;
    env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', { data: {
        type: 'comparison-panel-test-action', actionId: 'rerender-after-pause',
        actions: [{ action: 'set-loop-region', payload: { start: 0.1, end: 0.2 } }],
    } }));
    await nextAnimationFrame(env.dom);
    const failedTrackRequests = detailRequests().filter((msg: any) => msg.filePath === initial.filePath);
    assert.equal(failedTrackRequests.length, 2, 'after the pause the lane asks for its spectrogram again');
    env.dom.window.Date.now = realNow;
    env.dom.window.close();
});

