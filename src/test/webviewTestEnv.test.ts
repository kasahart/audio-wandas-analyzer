/**
 * webviewTestEnv の canvas mock が Proxy ベースであることの回帰テスト。
 *
 * 主目的: 描画コード側に新しい Canvas2D API が追加されても、
 * mock 側の更新忘れで無関係なテストが連鎖失敗しないことを保証する。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebviewEnv } from './helpers/webviewTestEnv';

const MINIMAL_APP_STATE = JSON.stringify({ mode: 'results', results: [] });

test('canvas mock: 未知メソッド呼び出しは no-op で例外を起こさない', () => {
    const { dom } = createWebviewEnv(MINIMAL_APP_STATE);
    const canvas = dom.window.document.createElement('canvas');
    canvas.id = 'test-canvas';
    const ctx = canvas.getContext('2d') as unknown as Record<string, (...args: unknown[]) => unknown>;
    assert.ok(ctx, '2d context が取得できる');

    // 旧実装ではメソッド未定義により TypeError が出ていたケース
    assert.doesNotThrow(() => ctx.bezierCurveTo(0, 0, 1, 1, 2, 2));
    assert.doesNotThrow(() => ctx.arc(0, 0, 10, 0, Math.PI));
    assert.doesNotThrow(() => ctx.closePath());
    assert.doesNotThrow(() => ctx.transform(1, 0, 0, 1, 0, 0));
    assert.doesNotThrow(() => ctx.resetTransform());
    assert.doesNotThrow(() => (ctx as unknown as { strokeRect: (...a: unknown[]) => unknown }).strokeRect(0, 0, 10, 10));

    dom.window.close();
});

test('canvas mock: 計測対象メソッドはカウンタを更新する', () => {
    const { dom, domCanvasContexts } = createWebviewEnv(MINIMAL_APP_STATE);
    const canvas = dom.window.document.createElement('canvas');
    canvas.id = 'counted-canvas';
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, 10, 10);
    ctx.beginPath();
    ctx.stroke();
    ctx.fillText('Hz', 0, 0);
    ctx.fillRect(0, 0, 1, 1);
    ctx.save();
    ctx.restore();

    const spy = domCanvasContexts.get('counted-canvas');
    assert.ok(spy);
    assert.equal(spy!.clearRectCalls, 1);
    assert.equal(spy!.beginPathCalls, 1);
    assert.equal(spy!.strokeCalls, 1);
    assert.deepEqual(spy!.fillTextCalls, ['Hz']);
    assert.equal(spy!.fillRectCalls, 1);
    assert.equal(spy!.saveCalls, 1);
    assert.equal(spy!.restoreCalls, 1);

    dom.window.close();
});

test('canvas mock: スタイルプロパティは set した値を read で返す', () => {
    const { dom } = createWebviewEnv(MINIMAL_APP_STATE);
    const canvas = dom.window.document.createElement('canvas');
    canvas.id = 'style-canvas';
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ff0000';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    assert.equal(ctx.fillStyle, '#ff0000');
    assert.equal(ctx.font, '12px sans-serif');
    assert.equal(ctx.textAlign, 'center');

    // 未設定プロパティは既定値を返す
    const fresh = dom.window.document.createElement('canvas');
    fresh.id = 'fresh-canvas';
    const freshCtx = fresh.getContext('2d')!;
    assert.equal(freshCtx.lineWidth, 1);
    assert.equal(freshCtx.textAlign, 'left');
    assert.equal(freshCtx.textBaseline, 'alphabetic');

    dom.window.close();
});

test('canvas mock: createImageData は要求サイズの Uint8ClampedArray を返す', () => {
    const { dom } = createWebviewEnv(MINIMAL_APP_STATE);
    const canvas = dom.window.document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    const img = ctx.createImageData(4, 3);
    assert.equal(img.width, 4);
    assert.equal(img.height, 3);
    assert.equal(img.data.length, 4 * 3 * 4);
    assert.ok(img.data instanceof Uint8ClampedArray);

    dom.window.close();
});

test('canvas mock: 未知プロパティの読み取りはエラーを起こさない', () => {
    const { dom } = createWebviewEnv(MINIMAL_APP_STATE);
    const canvas = dom.window.document.createElement('canvas');
    const ctx = canvas.getContext('2d') as unknown as Record<string, unknown>;
    assert.doesNotThrow(() => {
        const _ = ctx.imageSmoothingEnabled;
        const __ = ctx.shadowBlur;
        void _;
        void __;
    });
    dom.window.close();
});

test('canvas mock: OffscreenCanvas の未知メソッドも no-op で吸収する', () => {
    const { dom, offscreenInstances } = createWebviewEnv(MINIMAL_APP_STATE);
    const Off = (dom.window as unknown as { OffscreenCanvas: new (w: number, h: number) => { getContext: (t: string) => Record<string, (...a: unknown[]) => unknown> } }).OffscreenCanvas;
    const off = new Off(100, 50);
    const ctx = off.getContext('2d');

    assert.doesNotThrow(() => ctx.clearRect(0, 0, 100, 50));
    assert.doesNotThrow(() => ctx.bezierCurveTo(0, 0, 1, 1, 2, 2));
    assert.doesNotThrow(() => ctx.arc(0, 0, 5, 0, Math.PI));
    assert.equal(offscreenInstances[0].ctx.clearRectCalls, 1);

    dom.window.close();
});
