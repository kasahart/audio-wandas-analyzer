/**
 * i18n の wiring 検証: VS Code の env.language に応じて
 * - HTML の <html lang> 属性
 * - panel title (<title>)
 * - __APP_STRINGS__ JSON 内のラベル (波形/Waveform 等)
 * が切り替わることを統合的に確認する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// vscode モジュールを stub に差し替えてから ComparisonPanel を require する。
// 一度キャッシュに載れば後続 require('vscode') は cache hit で stub が返るので、
// グローバル _load の上書きは ComparisonPanel ロード直後に元に戻して他テストへの
// 漏出を防ぐ。env.language の動的変更は stub の env プロパティを書き換える形で行う。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeModule = require('node:module');

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

const originalLoad = NodeModule._load;
NodeModule._load = function (id: string, ...rest: unknown[]) {
    if (id === 'vscode') { return vscodeStub; }
    return originalLoad.call(this, id, ...rest);
};
let renderComparisonHtml: (...args: unknown[]) => string;
try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    renderComparisonHtml = require('../webview/panels/ComparisonPanel').renderComparisonHtml;
} finally {
    // 後続テストや並列実行への漏出を防ぐため、即座に元に戻す。
    // ComparisonPanel は require cache に入ったので以後の require('vscode') は触らない。
    NodeModule._load = originalLoad;
}

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
    return renderComparisonHtml(fakeWebview, state, extensionUri);
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

test('i18n: toolbarMain ラベルが "Files" (en) / "ファイル" (ja) であること', () => {
    assert.match(renderHtmlWith('en'), /"toolbarMain":\s*"Files"/);
    assert.match(renderHtmlWith('ja'), /"toolbarMain":\s*"ファイル"/);
    assert.doesNotMatch(renderHtmlWith('en'), /"toolbarMain":\s*"[^"]*Main[^"]*"/);
    assert.doesNotMatch(renderHtmlWith('ja'), /"toolbarMain":\s*"[^"]*メイン[^"]*"/);
});
