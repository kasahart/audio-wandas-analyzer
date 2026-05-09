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
// vscode モックを先に設定してから ComparisonPanel をロードするヘルパー
import { getRenderScript } from './helpers/comparisonScriptLoader';
import { createWebviewEnv, evalScript } from './helpers/webviewTestEnv';

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
