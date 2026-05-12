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
import { getRenderScript } from './helpers/comparisonScriptLoader';
import { createWebviewEnv, evalScript } from './helpers/webviewTestEnv';

const WAVEFORM_PIPELINE_JS = readFileSync(
    join(__dirname, '..', '..', 'media', 'comparisonWaveform.js'),
    'utf8',
);

/** テスト用の最小 AnalysisResult JSON */
const DUMMY_APP_STATE = JSON.stringify({
    results: [
        {
            filePath: '/tmp/a.wav',
            fileName: 'a.wav',
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
    referenceIndex: 0,
});

function setupEnv() {
    const script = getRenderScript();
    const { dom, postedMessages, offscreenInstances } = createWebviewEnv(DUMMY_APP_STATE);
    // comparisonWaveform.js を先に eval して window.renderWaveformPipeline を登録する
    evalScript(dom, WAVEFORM_PIPELINE_JS);
    evalScript(dom, script);
    return { dom, postedMessages, offscreenInstances };
}

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
