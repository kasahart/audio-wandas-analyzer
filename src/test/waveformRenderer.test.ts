import test from 'node:test';
import assert from 'node:assert/strict';
import {
    xOfNorm, buildBucketPoints, computeAnchorX,
    makeCoordTransform, computeViewRange, decimateBuckets, paintDecimatedPoints,
} from '../panels/waveformRenderer';

test('xOfNorm maps zoomStart to 0', () => {
    assert.equal(xOfNorm(0.2, 0.2, 0.8, 800), 0);
});

test('xOfNorm maps zoomEnd to W', () => {
    assert.equal(xOfNorm(0.8, 0.2, 0.8, 800), 800);
});

test('xOfNorm maps midpoint correctly', () => {
    assert.equal(xOfNorm(0.5, 0.2, 0.8, 800), 400);
});

test('buildBucketPoints returns chronological (minFirst) order when minT < maxT', () => {
    const env = {
        min: [-0.5],
        max: [0.8],
        minT: [0.1],
        maxT: [0.3],
        absolutePeak: 0.8,
    };
    const pts = buildBucketPoints(env, 0, 0, 0, 1, 0, 1);
    assert.equal(pts[0].tNorm, 0.1);
    assert.equal(pts[0].value, -0.5);
    assert.equal(pts[1].tNorm, 0.3);
    assert.equal(pts[1].value, 0.8);
});

test('buildBucketPoints returns chronological (maxFirst) order when maxT < minT', () => {
    const env = {
        min: [-0.5],
        max: [0.8],
        minT: [0.5],
        maxT: [0.2],
        absolutePeak: 0.8,
    };
    const pts = buildBucketPoints(env, 0, 0, 0, 1, 0, 1);
    assert.equal(pts[0].tNorm, 0.2);
    assert.equal(pts[1].tNorm, 0.5);
});

test('buildBucketPoints falls back to uniform spacing when minT/maxT absent', () => {
    const env = {
        min: [-0.5, -0.3],
        max: [0.8, 0.6],
        absolutePeak: 0.8,
    } as any;
    const pts = buildBucketPoints(env, 0, 0, 0, 1, 0, 1);
    assert.ok(pts.length > 0);
});

// ── computeAnchorX ──────────────────────────────────────────

test('[回帰] overview 左端ズーム: anchorX=0 のときもアンカーを注入する', () => {
    // overview: dataStart=0, n=1200, zoomStart=0, zoomEnd=0.1
    // anchorT = 0 → anchorX = 0 → <= 0 なので注入（samples[i0] の振幅で）
    const x = computeAnchorX(0, 1200, 0, 1, 0, 0, 0.1, 800);
    assert.ok(x !== null, 'anchorX=0 のときもアンカーを注入すべき');
    assert.ok((x as number) <= 0, `anchorX=${x} は 0 以下であること`);
});

test('[回帰] overview 中央ズーム: i0>0 のアンカーは負の x を返す', () => {
    // zoomStart=0.3, zoomEnd=0.4 (10x zoom at center)
    // i0 = floor(0.3 * 1200) - 1 = 359
    // anchorT = 0 + 359/1200 * 1 ≈ 0.299 < 0.3 → anchorX < 0
    const i0 = Math.max(0, Math.floor(0.3 * 1200) - 1);
    const x = computeAnchorX(i0, 1200, 0, 1, 0, 0.3, 0.4, 800);
    assert.ok(x !== null, 'アンカーを注入すべき');
    assert.ok((x as number) < 0, `anchorX=${x} は負であること（off-canvas）`);
});

test('アンカーが正の場合は null を返す（データ開始が視野内）', () => {
    // range data: dataStart=0.31, i0=0
    // anchorT = 0.31 + 0/n * dataRange = 0.31
    // anchorX = (0.31 - 0.30) / 0.10 * 800 = 80 > 0 → null
    const x = computeAnchorX(0, 1600, 0.31, 0.20, 0, 0.30, 0.40, 800);
    assert.equal(x, null, 'データが視野内に始まる場合はアンカーを注入しない');
});

// ── makeCoordTransform ────────────────────────────────────────

test('makeCoordTransform: zoomStart → x=0', () => {
    const t = makeCoordTransform(0.2, 0.8, 0, 800, 80, 1.0);
    assert.equal(t.toX(0.2), 0);
});

test('makeCoordTransform: zoomEnd → x=W', () => {
    const t = makeCoordTransform(0.2, 0.8, 0, 800, 80, 1.0);
    assert.equal(t.toX(0.8), 800);
});

test('makeCoordTransform: 中点 → x=W/2', () => {
    const t = makeCoordTransform(0.2, 0.8, 0, 800, 80, 1.0);
    assert.equal(t.toX(0.5), 400);
});

test('makeCoordTransform: 振幅 0 → y=H/2', () => {
    const t = makeCoordTransform(0, 1, 0, 800, 80, 1.0);
    assert.equal(t.toY(0), 40);
});

test('makeCoordTransform: offsetNorm が x にシフトする', () => {
    // offset=0.1: zoomStart=0.3 に対応する file time は 0.3-0.1=0.2
    const t = makeCoordTransform(0.3, 0.5, 0.1, 800, 80, 1.0);
    // t=0.2 (file) → visual 0.2+0.1=0.3 → zoomStart → x=0
    assert.equal(t.toX(0.2), 0);
});

// ── computeViewRange ──────────────────────────────────────────

function makeEnv(n: number) {
    return {
        min: Array(n).fill(-0.5),
        max: Array(n).fill(0.5),
        minT: Array.from({ length: n }, (_, i) => i / n),
        maxT: Array.from({ length: n }, (_, i) => (i + 0.5) / n),
        absolutePeak: 0.5,
    };
}

test('computeViewRange: i0 >= 0 かつ i1 <= n-1', () => {
    const env = makeEnv(1200);
    const r = computeViewRange(env, 0, 1, 0, 0.3, 0.5, 800);
    assert.ok(r.i0 >= 0, `i0=${r.i0}`);
    assert.ok(r.i1 <= 1199, `i1=${r.i1}`);
});

test('computeViewRange: extSpan で i0 が可視開始より前になる', () => {
    const env = makeEnv(1200);
    const r = computeViewRange(env, 0, 1, 0, 0.3, 0.5, 800);
    // i0 は visStartNorm - extSpan から算出。visStartNorm=0.3。
    // extSpan = (0.5-0.3)/1.0 = 0.2 → i0 = floor((0.3-0.2)*1200) = 120
    // x座標: (120/1200 - 0.3)/0.2 * 800 = (0.1-0.3)/0.2*800 = -800 → off-canvas
    const tI0 = 0 + (r.i0 / 1200) * 1;
    const t = makeCoordTransform(0.3, 0.5, 0, 800, 80, 1.0);
    assert.ok(t.toX(tI0) <= 0, `i0のバケット境界 x=${t.toX(tI0)} は0以下のはず`);
});

test('computeViewRange: div >= 1', () => {
    const env = makeEnv(1600);
    const r = computeViewRange(env, 0, 1, 0, 0, 1, 800);
    assert.ok(r.div >= 1, `div=${r.div}`);
});

test('computeViewRange: n=0 で i1 < i0（データなし）', () => {
    const env = { min: [], max: [], absolutePeak: 0 };
    const r = computeViewRange(env as any, 0, 1, 0, 0, 1, 800);
    assert.ok(r.i1 < r.i0, '空データは i1 < i0 を返すべき');
});

// ── decimateBuckets ───────────────────────────────────────────

test('decimateBuckets: div=1 で各バケットが1ペア', () => {
    const env = makeEnv(4);
    const range = computeViewRange(env, 0, 1, 0, 0, 1, 800);
    const pts = decimateBuckets(env, { i0: 0, i1: 3, div: 1 }, 0, 1);
    assert.equal(pts.length, 4);
});

test('decimateBuckets: 各ペアが時系列順（first.tNorm <= second.tNorm）', () => {
    const env = makeEnv(10);
    const pts = decimateBuckets(env, { i0: 0, i1: 9, div: 1 }, 0, 1);
    for (const [a, b] of pts) {
        assert.ok(a.tNorm <= b.tNorm, `${a.tNorm} <= ${b.tNorm}`);
    }
});

test('decimateBuckets: div=2 で約 n/2 ペア', () => {
    const env = makeEnv(8);
    const pts = decimateBuckets(env, { i0: 0, i1: 7, div: 2 }, 0, 1);
    assert.equal(pts.length, 4);
});

test('decimateBuckets: Canvas API なしで実行できる（純粋関数）', () => {
    const env = makeEnv(5);
    assert.doesNotThrow(() => {
        decimateBuckets(env, { i0: 0, i1: 4, div: 1 }, 0, 1);
    });
});

test('decimateBuckets: min/max が正しいバケットから選択される', () => {
    const env = {
        min: [-0.1, -0.9, -0.2, -0.3],
        max: [0.1, 0.9, 0.2, 0.3],
        minT: [0.0, 0.25, 0.5, 0.75],
        maxT: [0.1, 0.35, 0.6, 0.85],
        absolutePeak: 0.9,
    };
    // div=2: バケット[0,1]と[2,3]
    const pts = decimateBuckets(env, { i0: 0, i1: 3, div: 2 }, 0, 1);
    // バケット[0,1]: min=-0.9(idx=1), max=0.9(idx=1)
    assert.equal(pts[0][0].value, -0.9);
    assert.equal(pts[0][1].value, 0.9);
});

// ── paintDecimatedPoints ──────────────────────────────────────

function makeMockCtx() {
    const calls: string[] = [];
    return {
        calls,
        lineWidth: 1.5 as number,
        strokeStyle: '' as string,
        beginPath() { calls.push('beginPath'); },
        moveTo(x: number, y: number) { calls.push(`moveTo(${x.toFixed(1)},${y.toFixed(1)})`); },
        lineTo(x: number, y: number) { calls.push(`lineTo(${x.toFixed(1)},${y.toFixed(1)})`); },
        stroke() { calls.push('stroke'); },
    };
}

test('paintDecimatedPoints: 最初の点は moveTo', () => {
    const env = makeEnv(2);
    const pts = decimateBuckets(env, { i0: 0, i1: 1, div: 1 }, 0, 1);
    const t = makeCoordTransform(0, 1, 0, 800, 80, 0.5);
    const ctx = makeMockCtx();
    paintDecimatedPoints(ctx, pts, t, '#fff', 1.5);
    assert.ok(ctx.calls.includes('beginPath'), 'beginPath が呼ばれる');
    assert.ok(ctx.calls.includes('stroke'), 'stroke が呼ばれる');
    assert.ok(ctx.calls.some(c => c.startsWith('moveTo')), '最初の点は moveTo');
});

test('paintDecimatedPoints: 空の点列は何も描画しない', () => {
    const ctx = makeMockCtx();
    const t = makeCoordTransform(0, 1, 0, 800, 80, 1.0);
    paintDecimatedPoints(ctx, [], t, '#fff', 1.5);
    assert.ok(!ctx.calls.includes('stroke'), '空の場合 stroke を呼ばない');
});
