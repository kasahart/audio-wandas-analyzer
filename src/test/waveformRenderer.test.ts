import test from 'node:test';
import assert from 'node:assert/strict';
import { xOfNorm, buildBucketPoints, computeAnchorX } from '../panels/waveformRenderer';

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

test('[回帰] overview 左端ズーム: anchorX=0 のときはアンカー注入しない', () => {
    // overview: dataStart=0, n=1200, zoomStart=0, zoomEnd=0.1
    // anchorT = 0 → anchorX = 0 → 厳密に負ではないので null
    // (anchorX=0 を注入すると moveTo(0,H/2)+lineTo で直線バグが発生するため)
    const x = computeAnchorX(0, 1200, 0, 1, 0, 0, 0.1, 800);
    assert.equal(x, null, 'anchorX=0 のときはアンカー注入しない（直線バグ防止）');
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
