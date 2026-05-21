/**
 * i18n の wiring 検証: VS Code の env.language に応じて
 * - HTML の <html lang> 属性
 * - panel title (<title>)
 * - __APP_STRINGS__ JSON 内のラベル (波形/Waveform 等)
 * が切り替わることを統合的に確認する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// vscode モジュールは module 解決時にスタブする必要がある
// (comparisonScriptLoader と同じパターン)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeModule = require('node:module');
const originalLoad = NodeModule._load;

interface VsCodeStub {
    env: { language: string };
    window: Record<string, unknown>;
    ViewColumn: { One: number; Active: number; Beside: number };
    Uri: { joinPath: (...a: unknown[]) => { fsPath: string; toString: () => string } };
    workspace: { getConfiguration: () => { get: (k: string, d: unknown) => unknown } };
}

const vscodeStub: VsCodeStub = {
    env: { language: 'en' },
    window: {},
    ViewColumn: { One: 1, Active: 1, Beside: 2 },
    Uri: { joinPath: (..._args: unknown[]) => ({ fsPath: '/x', toString: () => 'webview://x' }) },
    workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) },
};

NodeModule._load = function (id: string, ...rest: unknown[]) {
    if (id === 'vscode') { return vscodeStub; }
    return originalLoad.call(this, id, ...rest);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ComparisonPanel } = require('../webview/panels/ComparisonPanel');

function renderHtmlWith(language: string): string {
    vscodeStub.env.language = language;
    const fakeWebview = {
        asWebviewUri: (uri: { fsPath: string; toString: () => string }) => uri,
        cspSource: 'mock-csp',
    };
    const state = {
        mode: 'results' as const,
        results: [],
        spectrogramSettings: {
            nFft: 1024,
            hopSize: 512,
            window: 'hann',
            auto: true,
            dbMin: null,
            dbMax: null,
            maxFrequencyHz: null,
        },
    };
    const extensionUri = { fsPath: '/ext', toString: () => '/ext' };
    // private static renderHtml を呼ぶ
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (ComparisonPanel as any).renderHtml(fakeWebview, state, extensionUri);
}

test('i18n: env.language="ja" は HTML lang="ja" を出力する', () => {
    const html = renderHtmlWith('ja');
    assert.match(html, /<html lang="ja">/);
});

test('i18n: env.language="en-US" は HTML lang="en" を出力する', () => {
    const html = renderHtmlWith('en-US');
    assert.match(html, /<html lang="en">/);
});

test('i18n: 日本語ロケールではタイトルが "比較パネル"', () => {
    const html = renderHtmlWith('ja');
    assert.match(html, /<title>比較パネル<\/title>/);
});

test('i18n: 英語ロケールではタイトルが "Comparison Panel"', () => {
    const html = renderHtmlWith('en-US');
    assert.match(html, /<title>Comparison Panel<\/title>/);
});

test('i18n: __APP_STRINGS__ に btnWaveform="波形" (ja) が含まれる', () => {
    const html = renderHtmlWith('ja');
    assert.match(html, /"btnWaveform":\s*"波形"/);
    assert.match(html, /"btnSpectrogram":\s*"スペクトログラム"/);
});

test('i18n: __APP_STRINGS__ に btnWaveform="Waveform" (en) が含まれる', () => {
    const html = renderHtmlWith('en');
    assert.match(html, /"btnWaveform":\s*"Waveform"/);
    assert.match(html, /"btnSpectrogram":\s*"Spectrogram"/);
});

test('i18n: __APP_LOCALE__ も注入される', () => {
    assert.match(renderHtmlWith('ja-JP'), /const __APP_LOCALE__\s*=\s*"ja";/);
    assert.match(renderHtmlWith('fr'), /const __APP_LOCALE__\s*=\s*"en";/);
});
