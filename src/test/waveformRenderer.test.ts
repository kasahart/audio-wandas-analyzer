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

// ── computeViewRange: オフセット付きテスト ────────────────────

test('computeViewRange: 正オフセットで visStartNorm が小さくなる（ファイル位置が前にシフト）', () => {
    // offsetNorm=0.1: 視野 [0.4, 0.6] に対応するファイル位置は [0.3, 0.5]
    // visStartNorm = (0.4 - 0.1 - 0) / 1.0 = 0.3
    // offsetNorm=0 の場合: visStartNorm = 0.4
    // → 正オフセットで i0 が小さくなる（より前のバケットから描画）
    const env = makeEnv(1200);
    const rNoOffset  = computeViewRange(env, 0, 1, 0,   0.4, 0.6, 800);
    const rWithOffset = computeViewRange(env, 0, 1, 0.1, 0.4, 0.6, 800);
    assert.ok(
        rWithOffset.i0 <= rNoOffset.i0,
        `正オフセット時 i0(${rWithOffset.i0}) <= オフセットなし i0(${rNoOffset.i0}) であること`,
    );
});

test('computeViewRange: 負オフセットで visStartNorm が大きくなる（ファイル位置が後にシフト）', () => {
    // offsetNorm=-0.1: 視野 [0.3, 0.5] に対応するファイル位置は [0.4, 0.6]
    // visStartNorm = (0.3 - (-0.1) - 0) / 1.0 = 0.4
    // offsetNorm=0 の場合: visStartNorm = 0.3
    // → 負オフセットで i0 が大きくなる（より後ろのバケットから描画）
    const env = makeEnv(1200);
    const rNoOffset  = computeViewRange(env, 0, 1,  0,   0.3, 0.5, 800);
    const rNegOffset = computeViewRange(env, 0, 1, -0.1, 0.3, 0.5, 800);
    assert.ok(
        rNegOffset.i0 >= rNoOffset.i0,
        `負オフセット時 i0(${rNegOffset.i0}) >= オフセットなし i0(${rNoOffset.i0}) であること`,
    );
});

test('computeViewRange + makeCoordTransform: 正オフセット時も i0 のバケット境界が x<=0', () => {
    // offsetNorm=0.1, zoom=[0.4, 0.6], overview
    // 視野のファイル位置: [0.3, 0.5]
    // i0 バケット境界を CoordTransform(offset=0.1) で変換すると x<=0 になるはず
    const env = makeEnv(1200);
    const offsetNorm = 0.1;
    const zoomStart = 0.4, zoomEnd = 0.6;
    const r = computeViewRange(env, 0, 1, offsetNorm, zoomStart, zoomEnd, 800);
    const tI0 = 0 + (r.i0 / 1200) * 1; // バケット境界時刻
    const t = makeCoordTransform(zoomStart, zoomEnd, offsetNorm, 800, 80, 1.0);
    assert.ok(
        t.toX(tI0) <= 0,
        `正オフセット時も i0 バケット境界 x=${t.toX(tI0).toFixed(1)} は 0 以下（off-canvas）`,
    );
});

test('computeViewRange + makeCoordTransform: 負オフセット時も i0 のバケット境界が x<=0', () => {
    const env = makeEnv(1200);
    const offsetNorm = -0.1;
    const zoomStart = 0.3, zoomEnd = 0.5;
    const r = computeViewRange(env, 0, 1, offsetNorm, zoomStart, zoomEnd, 800);
    const tI0 = 0 + (r.i0 / 1200) * 1;
    const t = makeCoordTransform(zoomStart, zoomEnd, offsetNorm, 800, 80, 1.0);
    assert.ok(
        t.toX(tI0) <= 0,
        `負オフセット時も i0 バケット境界 x=${t.toX(tI0).toFixed(1)} は 0 以下（off-canvas）`,
    );
});

test('computeViewRange: range データとオフセットの組合せで正しい範囲を返す', () => {
    // range cache: [0.25, 0.45] (10x zoom 用に取得されたデータ)
    // offsetNorm=0.05, zoom=[0.3, 0.4]
    // 視野のファイル位置: [0.25, 0.35]
    // dataStart=0.25 を基準にした visStartNorm = (0.3 - 0.05 - 0.25) / 0.20 = 0
    const env = makeEnv(1600);
    const r = computeViewRange(env, 0.25, 0.45, 0.05, 0.3, 0.4, 800);
    assert.ok(r.i0 >= 0, `i0=${r.i0}`);
    assert.ok(r.i1 <= 1599, `i1=${r.i1}`);
    // 可視開始がデータ先頭(visStartNorm≈0)なので i0 は 0 付近
    assert.ok(r.i0 < 100, `i0(${r.i0}) はデータ先頭付近のはず（extSpan 拡張で 0 になる）`);
});

// ── computeViewRange: extSpan の正/負オフセット ───────────────

test('[回帰] 正オフセット: extSpan は表示幅ではなく可視ファイル幅に基づく', () => {
    // offsetNorm=0.3, zoom=[0,0.5], overview(dataRange=1.0)
    // visStartNorm=-0.3, visEndNorm=0.2
    // clampedVisStart=0, clampedVisEnd=0.2 → extSpan=0.2
    // 旧実装なら extSpan = (0.5-0)/1.0 = 0.5 → i0=-960相当 → 「-8秒分の計算」になる
    const env = makeEnv(1200);
    const r = computeViewRange(env, 0, 1, 0.3, 0, 0.5, 800);
    // extSpan=0.2 なら i1 = ceil((0.2+0.2)*1200)+1 = ceil(480)+1 = 481
    // extSpan=0.5 なら i1 = ceil((0.2+0.5)*1200)+1 = ceil(840)+1 = 841
    // i1 が 841 以下なら extSpan が適切に制限されている
    assert.ok(r.i1 <= 841, `i1(${r.i1}) は extSpan 制限内のはず（extSpan=0.2 → 481 / extSpan=0.5 → 841）`);
    // i0 は0（visStartNorm<0 でクランプ）
    assert.equal(r.i0, 0);
});

test('[回帰] 負オフセット: extSpan は表示幅ではなく可視ファイル幅に基づく', () => {
    // offsetNorm=-0.3, zoom=[0.5,1.0], overview(dataRange=1.0)
    // visStartNorm=(0.5-(-0.3)-0)/1=0.8, visEndNorm=(1.0-(-0.3)-0)/1=1.3
    // clampedVisStart=0.8, clampedVisEnd=1.0 → extSpan=0.2
    // 旧実装なら extSpan = 0.5/1.0 = 0.5 → i1=ceil((1.3+0.5)*1200)+1 → ファイル末端を大幅超過
    const env = makeEnv(1200);
    const r = computeViewRange(env, 0, 1, -0.3, 0.5, 1.0, 800);
    // extSpan=0.2 なら i0 = floor((0.8-0.2)*1200) = floor(720) = 720
    // extSpan=0.5 なら i0 = floor((0.8-0.5)*1200) = floor(360) = 360
    // i0 が 360 以上なら extSpan が適切に制限されている（大きいほどより正確）
    assert.ok(r.i0 >= 360, `i0(${r.i0}) は extSpan 制限内のはず（extSpan=0.2 → 720 / extSpan=0.5 → 360）`);
    // i1 は n-1=1199（visEndNorm>1 でクランプ）
    assert.equal(r.i1, 1199);
});

test('[回帰] 正オフセット: extSpan が可視ファイル幅に基づき i1 が過大にならない', () => {
    // offsetNorm=0.3, zoom=[0,0.5], overview (dataRange=1.0, n=1200)
    // visStartNorm=-0.3, visEndNorm=0.2
    // extSpan_correct = min(1,0.2)-max(0,-0.3) = 0.2
    // extSpan_wrong   = (0.5-0)/1.0            = 0.5  ← 表示幅（5秒）を使うと過大
    // extSpan=0.2 → i1 = ceil((0.2+0.2)*1200)+1 = 481
    // extSpan=0.5 → i1 = ceil((0.2+0.5)*1200)+1 = 841
    const env = makeEnv(1200);
    const r = computeViewRange(env, 0, 1, 0.3, 0, 0.5, 800);
    assert.ok(r.i1 < 600,
        `i1(${r.i1}) は extSpan=0.2 で 481 のはず（extSpan=0.5 の誤実装なら 841 になる）`);
});

test('[回帰] 負オフセット: extSpan が可視ファイル幅に基づき i0 が過小にならない', () => {
    // offsetNorm=-0.3, zoom=[0.5,1.0], overview (dataRange=1.0, n=1200)
    // visStartNorm=0.8, visEndNorm=1.3
    // extSpan_correct = min(1,1.3)-max(0,0.8) = 0.2
    // extSpan_wrong   = (1.0-0.5)/1.0          = 0.5  ← 過大
    // extSpan=0.2 → i0 = floor((0.8-0.2)*1200) = 720
    // extSpan=0.5 → i0 = floor((0.8-0.5)*1200) = 360
    const env = makeEnv(1200);
    const r = computeViewRange(env, 0, 1, -0.3, 0.5, 1.0, 800);
    assert.ok(r.i0 >= 500,
        `i0(${r.i0}) は extSpan=0.2 で 720 のはず（extSpan=0.5 の誤実装なら 360 になる）`);
});

// ── trackDurRatio tests ──────────────────────────────────────

test('trackDurRatio: toX scales file position by trackDurRatio=0.5', () => {
    // Track occupies half of global span, starts at 0.1 in global space
    // trackDurRatio=0.5, offsetNorm=0.1, zoomStart=0, zoomEnd=1, W=1000
    // tNorm=0 → global pos = 0.1 + 0*0.5 = 0.1 → x = 100
    // tNorm=1 → global pos = 0.1 + 1*0.5 = 0.6 → x = 600
    // tNorm=0.5 → global pos = 0.1 + 0.5*0.5 = 0.35 → x = 350
    const t = makeCoordTransform(0, 1, 0.1, 1000, 80, 1.0, 0.5);
    assert.equal(t.toX(0), 100,  'tNorm=0 → x=100');
    assert.equal(t.toX(1), 600,  'tNorm=1 → x=600');
    assert.equal(t.toX(0.5), 350, 'tNorm=0.5 → x=350');
});

test('trackDurRatio: toX backward compat (trackDurRatio=1, default)', () => {
    // With trackDurRatio=1 (default), behavior must match current formula
    // offsetNorm=0.3, zoomStart=0, zoomEnd=1, W=1000
    // tNorm=0 → x = (0 + 0.3 - 0) / 1 * 1000 = 300
    // tNorm=1 → x = (1 + 0.3 - 0) / 1 * 1000 = 1300
    const tDefault = makeCoordTransform(0, 1, 0.3, 1000, 80, 1.0);
    const tExplicit = makeCoordTransform(0, 1, 0.3, 1000, 80, 1.0, 1);
    assert.equal(tDefault.toX(0), 300,   'default: tNorm=0 → x=300');
    assert.equal(tDefault.toX(1), 1300,  'default: tNorm=1 → x=1300 (off canvas)');
    assert.equal(tExplicit.toX(0), 300,  'explicit trackDurRatio=1: tNorm=0 → x=300');
    assert.equal(tExplicit.toX(1), 1300, 'explicit trackDurRatio=1: tNorm=1 → x=1300');
});

test('trackDurRatio: computeViewRange with trackDurRatio — visible file range', () => {
    // Track: durationSec=5, globalSpanSec=10, trackDurRatio=0.5
    // offsetNorm=0 (track starts at global pos 0)
    // dataStart=0, dataEnd=1, n=1000 buckets
    // zoomStart=0.2, zoomEnd=0.6 → view shows 2~6s in 10s global span
    // fileAtZoomStart = (0.2 - 0) / 0.5 = 0.4  (40% into 5s file = 2s)
    // fileAtZoomEnd   = (0.6 - 0) / 0.5 = 1.2  (beyond file end, clamped to 1.0)
    // visStartNorm = 0.4, visEndNorm = 1.2 → clamped visEnd = 1.0
    // i0 should be around floor(0.4 * 1000) = 400, i.e. > 300
    // i1 = 999 (clamped to n-1)
    const env = makeEnv(1000);
    const r = computeViewRange(env, 0, 1, 0, 0.2, 0.6, 800, 0.5);
    assert.ok(r.i0 > 300, `i0=${r.i0} should be > 300 (view starts at 40% into file, not at file start)`);
    assert.equal(r.i1, 999, 'i1 should be clamped to n-1=999 since view extends past file end');
});

test('trackDurRatio: computeViewRange backward compat (trackDurRatio=1 explicit)', () => {
    // Same as existing 'computeViewRange: i0 >= 0 かつ i1 <= n-1' test,
    // but with trackDurRatio=1 passed explicitly — results must match
    const env = makeEnv(1200);
    const rImplicit = computeViewRange(env, 0, 1, 0, 0.3, 0.5, 800);
    const rExplicit = computeViewRange(env, 0, 1, 0, 0.3, 0.5, 800, 1);
    assert.equal(rExplicit.i0, rImplicit.i0, 'i0 must match with trackDurRatio=1 explicit');
    assert.equal(rExplicit.i1, rImplicit.i1, 'i1 must match with trackDurRatio=1 explicit');
    assert.equal(rExplicit.div, rImplicit.div, 'div must match with trackDurRatio=1 explicit');
});

test('trackDurRatio: two-track global span — negative offset track positioning', () => {
    // Two tracks, each 5s duration, Track B starts at offset=-3s
    // Global: start=-3s, end=5s (0+5), span=8s
    // Track A: offsetSec=0,  trackStart=(0-(-3))/8=3/8, trackDurRatio=5/8
    // Track B: offsetSec=-3, trackStart=(−3−(−3))/8=0,  trackDurRatio=5/8
    const W = 1000;
    const trackDurRatio = 5 / 8;

    // Track B: offsetNorm=0, zoomStart=0, zoomEnd=1
    const tB = makeCoordTransform(0, 1, 0, W, 80, 1.0, trackDurRatio);
    // tNorm=0 → x = (0 + 0*5/8 - 0) / 1 * W = 0
    // tNorm=1 → x = (0 + 1*5/8 - 0) / 1 * W = 625
    assert.equal(tB.toX(0), 0,   'Track B tNorm=0 → x=0 (starts at canvas left)');
    assert.equal(tB.toX(1), 625, 'Track B tNorm=1 → x=625 (5 out of 8 seconds)');

    // Track A: offsetNorm=3/8, zoomStart=0, zoomEnd=1
    const offsetA = 3 / 8;
    const tA = makeCoordTransform(0, 1, offsetA, W, 80, 1.0, trackDurRatio);
    // tNorm=0 → x = (3/8 + 0*5/8 - 0) / 1 * W = 375
    // tNorm=1 → x = (3/8 + 1*5/8 - 0) / 1 * W = 1000
    assert.ok(Math.abs(tA.toX(0) - 375) < 0.001, `Track A tNorm=0 → x≈375, got ${tA.toX(0)}`);
    assert.ok(Math.abs(tA.toX(1) - 1000) < 0.001, `Track A tNorm=1 → x≈1000, got ${tA.toX(1)}`);
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
