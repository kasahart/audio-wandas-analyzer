import test from 'node:test';
import assert from 'node:assert/strict';
import { isCacheSufficient, computeReqBounds } from '../webview/waveform/rangeRequestPolicy';

const W = 800;
const minPts = 1280; // pts(=1600) * 0.8

function makeCache(startNorm: number, endNorm: number, nPts: number) {
    const arr = Array(nPts).fill(0);
    return { startNorm, endNorm, channels: [{ min: arr, max: arr, samples: arr }] };
}

/** checkAndRequestRanges と同じパディング計算: ±5% of zoom range */
function reqBounds(zoomStart: number, zoomEnd: number) {
    const pad = 0.05 * (zoomEnd - zoomStart);
    return {
        reqStart: Math.max(0, zoomStart - pad),
        reqEnd: Math.min(1, zoomEnd + pad),
    };
}

test('キャッシュ null は false', () => {
    const { reqStart, reqEnd } = reqBounds(0.4, 0.6);
    assert.equal(isCacheSufficient(null, reqStart, reqEnd, minPts, W, 0.4, 0.6), false);
});

test('キャッシュが startNorm で視野をカバーしない場合は false', () => {
    // cache: [0.5, 1.0]、view は [0.3, 0.8] → startNorm が足りない
    const c = makeCache(0.5, 1.0, 1600);
    const { reqStart, reqEnd } = reqBounds(0.3, 0.8);
    assert.equal(isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0.3, 0.8), false);
});

test('キャッシュが endNorm で視野をカバーしない場合は false', () => {
    const c = makeCache(0.0, 0.5, 1600);
    const { reqStart, reqEnd } = reqBounds(0.3, 0.8);
    assert.equal(isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0.3, 0.8), false);
});

test('pts 不足 (nPts < minPts) は false', () => {
    const c = makeCache(0.0, 1.0, 100);
    const { reqStart, reqEnd } = reqBounds(0.4, 0.6);
    assert.equal(isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0.4, 0.6), false);
});

test('[回帰] 2x zoom 用 cache で 5x ズームは false（密度不足）', () => {
    // 2x zoom 時にキャッシュされたデータ: zoomRange=0.10 のパディング込み
    // cache: [0.445, 0.555] with 1600pts
    const c = makeCache(0.445, 0.555, 1600);
    // 5x zoom: view=[0.49, 0.51], zoomRange=0.02
    const { reqStart, reqEnd } = reqBounds(0.49, 0.51);
    // ptsVisible = 1600 * (0.02 / 0.11) ≈ 291, 291/800 = 0.36 < 0.5 → false
    assert.equal(
        isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0.49, 0.51),
        false,
        '5x zoom では 2x zoom 用 cache の密度が不足するため false',
    );
});

test('[回帰] 2x zoom 用 cache で 2x ズームは true（密度十分）', () => {
    // cache: [0.445, 0.555] with 1600pts（2x zoom 時に fetch したもの）
    const c = makeCache(0.445, 0.555, 1600);
    // 2x zoom: view=[0.45, 0.55]
    const { reqStart, reqEnd } = reqBounds(0.45, 0.55);
    // ptsVisible = 1600 * (0.10 / 0.11) ≈ 1455, 1455/800 = 1.82 >= 0.5 → true
    assert.equal(
        isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0.45, 0.55),
        true,
        '2x zoom では同じ zoom 用 cache で密度十分なので true',
    );
});

test('[回帰] 10x zoom 専用 cache で 10x ズームは true', () => {
    // 10x zoom: zoomRange=0.01, キャッシュはパディング済みの範囲より少し広め
    // cache: [0.494, 0.506] with 1600pts
    const c = makeCache(0.494, 0.506, 1600);
    const { reqStart, reqEnd } = reqBounds(0.495, 0.505);
    // ptsVisible = 1600 * (0.01 / 0.012) ≈ 1333, 1333/800 = 1.67 >= 0.5 → true
    assert.equal(
        isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0.495, 0.505),
        true,
    );
});

test('samples フィールドだけでも nPts が計算される', () => {
    // min/max なし、samples だけ存在。full-range cache で full-range zoom
    const c = {
        startNorm: 0.0, endNorm: 1.0,
        channels: [{ samples: Array(1600).fill(0) }]
    };
    // view = [0.0, 1.0]: ptsVisible = 1600 * (1.0/1.0) = 1600 >= 400 → true
    const { reqStart, reqEnd } = reqBounds(0.0, 1.0);
    assert.equal(isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0.0, 1.0), true);
});

// ── computeReqBounds のテスト ──────────────────────────────────

test('[回帰] 正オフセット時のリクエスト範囲は zoom - offset にシフトする', () => {
    // offset=0.05: 視野[0.3,0.5]に対し、ファイル[0.25,0.45]のデータが必要
    const { reqStart, reqEnd } = computeReqBounds(0.3, 0.5, 0.05);
    // reqStart = 0.3 - 0.05 - padding(=0.01) = 0.24
    assert.ok(reqStart < 0.30, `reqStart(${reqStart}) should be < 0.30 (shifted left)`);
    assert.ok(reqEnd   < 0.50, `reqEnd(${reqEnd}) should be < 0.50 (shifted left)`);
    assert.ok(reqStart < reqEnd, 'reqStart < reqEnd');
});

test('[回帰] 負オフセット時のリクエスト範囲は zoom + |offset| にシフトする', () => {
    // offset=-0.05: 視野[0.3,0.5]に対し、ファイル[0.35,0.55]のデータが必要
    const { reqStart, reqEnd } = computeReqBounds(0.3, 0.5, -0.05);
    assert.ok(reqStart > 0.30, `reqStart(${reqStart}) should be > 0.30 (shifted right)`);
    assert.ok(reqEnd   > 0.50, `reqEnd(${reqEnd}) should be > 0.50 (shifted right)`);
});

test('オフセット 0 では zoom ± padding と一致する', () => {
    const { reqStart, reqEnd } = computeReqBounds(0.3, 0.5, 0);
    // padding = 0.05 * 0.2 = 0.01
    assert.ok(Math.abs(reqStart - 0.29) < 1e-9, `reqStart=${reqStart}`);
    assert.ok(Math.abs(reqEnd   - 0.51) < 1e-9, `reqEnd=${reqEnd}`);
});

test('[回帰] 正オフセット: 正しい範囲のキャッシュは sufficient', () => {
    // offset=0.05, zoom=[0.3,0.5] → file range needed: [0.25,0.45]
    // cache [0.24, 0.46] with 1600pts covers it with good density
    const c = makeCache(0.24, 0.46, 1600);
    const { reqStart, reqEnd } = computeReqBounds(0.3, 0.5, 0.05);
    assert.equal(
        isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0.3, 0.5),
        true,
        '正しい範囲のキャッシュは sufficient',
    );
});

test('[回帰] 正オフセット: 誤方向 (+offset) キャッシュは insufficient', () => {
    // 誤実装でリクエストされた範囲 [0.34, 0.56] のキャッシュ
    // → file [0.29,0.45] をカバーしない (startNorm=0.34 > reqStart=0.24)
    const c = makeCache(0.34, 0.56, 1600);
    const { reqStart, reqEnd } = computeReqBounds(0.3, 0.5, 0.05);
    assert.equal(
        isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0.3, 0.5),
        false,
        '誤方向のキャッシュは insufficient',
    );
});

// ── resolveWaveformSource 境界クランプ相当のテスト ────────────
// checkAndRequestRanges は reqStart = max(0, zoomStart-offset-padding) を使うため
// 「ファイル範囲外の比較値をクランプしてから isCacheSufficient に渡す」パターンを検証

test('[回帰] 正オフセットで zoomStart-offset<0: reqStart=0 のキャッシュ startNorm=0 は sufficient', () => {
    // zoomStart=0, offsetNorm=0.3 → zoomStart-offset=-0.3 → reqStart=max(0,-0.3-padding)=0
    // キャッシュ [0, 0.225] で reqStart=0, reqEnd=0.2（padding≈0.01）
    // isCacheSufficient は reqStart=0 で比較するため startNorm=0 は 0<=0 で sufficient になるはず
    const c = makeCache(0, 0.225, 1600);
    const { reqStart, reqEnd } = computeReqBounds(0, 0.5, 0.3);
    // reqStart = max(0, 0-0.3-0.025) = 0, reqEnd = min(1, 0.5-0.3+0.025) = 0.225
    assert.equal(
        isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0, 0.5),
        true,
        '正オフセットでファイル先頭が視野外でも、クランプ後の reqStart=0 に対して startNorm=0 は sufficient',
    );
});

test('[回帰] 負オフセットで zoomEnd-offset>1: reqEnd=1 のキャッシュ endNorm=1 は sufficient', () => {
    // zoomEnd=1.0, offsetNorm=-0.3 → zoomEnd-offset=1.3 → reqEnd=min(1,1.3+padding)=1.0
    // キャッシュ [0.775, 1.0] で reqStart=0.775, reqEnd=1.0
    const c = makeCache(0.775, 1.0, 1600);
    const { reqStart, reqEnd } = computeReqBounds(0.5, 1.0, -0.3);
    // reqStart = max(0, 0.5+0.3-0.025) = 0.775, reqEnd = min(1, 1.0+0.3+0.025) = 1.0
    assert.equal(
        isCacheSufficient(c, reqStart, reqEnd, minPts, W, 0.5, 1.0),
        true,
        '負オフセットでファイル末端が視野外でも、クランプ後の reqEnd=1.0 に対して endNorm=1.0 は sufficient',
    );
});
