import test from 'node:test';
import assert from 'node:assert/strict';
import { traceXExtent, trackTimelinePlacement, waveformCoverageFromExtent } from '../webview/runtime/waveformCoverage';

function makePathCtx() {
    const calls: Array<[string, number, number]> = [];
    const ctx = {
        moveTo(x: number, y: number) { calls.push(['moveTo', x, y]); },
        lineTo(x: number, y: number) { calls.push(['lineTo', x, y]); },
    };
    return { ctx, calls };
}

test('traceXExtent: 描画中の moveTo/lineTo の有限な x の最小・最大を返し、元の呼び出しも通す', () => {
    const { ctx, calls } = makePathCtx();
    const extent = traceXExtent(ctx, () => {
        ctx.moveTo(12, 1);
        ctx.lineTo(Number.NaN, 2);
        ctx.lineTo(3, 3);
        ctx.lineTo(40, 4);
    });
    assert.deepEqual(extent, { minX: 3, maxX: 40 });
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0], ['moveTo', 12, 1]);
});

test('traceXExtent: 何も描かなければ null を返す', () => {
    const { ctx } = makePathCtx();
    assert.equal(traceXExtent(ctx, () => {}), null);
});

test('traceXExtent: 描画が例外を投げても moveTo/lineTo を元に戻す', () => {
    const { ctx } = makePathCtx();
    const originalMoveTo = ctx.moveTo;
    const originalLineTo = ctx.lineTo;
    assert.throws(() => traceXExtent(ctx, () => { throw new Error('boom'); }), /boom/);
    assert.equal(ctx.moveTo, originalMoveTo);
    assert.equal(ctx.lineTo, originalLineTo);
});

test('waveformCoverageFromExtent: 両端 1px 以内に届いていれば端を覆っているとみなす', () => {
    assert.deepEqual(waveformCoverageFromExtent({ minX: 1, maxX: 99 }, 100), {
        minX: 1, maxX: 99, canvasWidth: 100, coversLeft: true, coversRight: true,
    });
    const partial = waveformCoverageFromExtent({ minX: 1.5, maxX: 98.5 }, 100);
    assert.equal(partial?.coversLeft, false);
    assert.equal(partial?.coversRight, false);
    assert.equal(waveformCoverageFromExtent(null, 100), null);
});

test('trackTimelinePlacement: 全体タイムライン上の開始位置と長さの比を返す', () => {
    const span = { startSec: -2, endSec: 8, spanSec: 10 };
    assert.deepEqual(trackTimelinePlacement(3, 4, span), { offsetNorm: 0.5, trackDurRatio: 0.4 });
});

test('trackTimelinePlacement: 長さ 0 のトラックは 1 秒として扱う', () => {
    const span = { startSec: 0, endSec: 10, spanSec: 10 };
    assert.equal(trackTimelinePlacement(0, 0, span).trackDurRatio, 0.1);
});
