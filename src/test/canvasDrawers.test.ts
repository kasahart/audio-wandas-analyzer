/**
 * src/webview/draw/canvasDrawers.ts の純粋関数を jsdom なしで直接 import して検証する。
 *
 * これらの関数は webview のインライン JS から切り出され、theme パラメータを
 * 取ることで DOM 依存を排除している。テストでは軽量な mock ctx を渡すだけで済む。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatHz,
    dbToRgb,
} from '../webview/draw/canvasDrawers';

// ── formatHz ──

test('formatHz: 1000 未満は "<n> Hz" を返す', () => {
    assert.equal(formatHz(0), '0 Hz');
    assert.equal(formatHz(440), '440 Hz');
    assert.equal(formatHz(999), '999 Hz');
});

test('formatHz: 1000 以上 10000 未満は "<n.n> kHz"', () => {
    assert.equal(formatHz(1000), '1.0 kHz');
    assert.equal(formatHz(5500), '5.5 kHz');
});

test('formatHz: 10000 以上は整数 kHz', () => {
    assert.equal(formatHz(10000), '10 kHz');
    assert.equal(formatHz(22050), '22 kHz');
});

// ── dbToRgb ──

test('dbToRgb: norm=0 は暗い紫系 (viridis 下端)', () => {
    const [r, g, b] = dbToRgb(0);
    assert.equal(r, 68);
    assert.equal(g, 1);
    assert.equal(b, 84);
});

test('dbToRgb: norm=1 は明るい黄系 (viridis 上端)', () => {
    const [r, g, b] = dbToRgb(1);
    assert.ok(r >= 240);
    assert.ok(g >= 200);
    assert.ok(b < 80);
});

test('dbToRgb: 各セグメント境界で連続している', () => {
    // viridis は単一チャンネルで単調でないが、norm の閾値 (0.25/0.5/0.75) で
    // ジャンプしないこと (区分線形補間が連続) を確認する。
    const eps = 1e-3;
    for (const boundary of [0.25, 0.5, 0.75]) {
        const lo = dbToRgb(boundary - eps);
        const hi = dbToRgb(boundary + eps);
        for (let c = 0; c < 3; c++) {
            assert.ok(Math.abs(lo[c] - hi[c]) <= 2,
                `discontinuity at norm=${boundary} channel ${c}: ${lo[c]} -> ${hi[c]}`);
        }
    }
});

