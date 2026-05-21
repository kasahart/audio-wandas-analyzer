export interface WaveformEnv {
    min: number[];
    max: number[];
    minT?: number[];
    maxT?: number[];
    samples?: number[];
    absolutePeak: number;
}

export interface BucketPoint {
    tNorm: number;
    value: number;
}

export function xOfNorm(
    tNorm: number,
    zoomStart: number,
    zoomEnd: number,
    W: number,
): number {
    const raw = ((tNorm - zoomStart) / (zoomEnd - zoomStart)) * W;
    // Round to avoid IEEE-754 floating-point drift at pixel-level precision
    return Math.round(raw * 1e10) / 1e10;
}

export function buildBucketPoints(
    env: WaveformEnv,
    bucketIndex: number,
    offsetSeconds: number,
    dataStart: number,
    dataEnd: number,
    zoomStart: number,
    zoomEnd: number,
): BucketPoint[] {
    const n = env.min.length;
    const minVal = env.min[bucketIndex] ?? 0;
    const maxVal = env.max[bucketIndex] ?? 0;

    let tMin: number;
    let tMax: number;

    if (env.minT && env.maxT) {
        tMin = env.minT[bucketIndex] ?? bucketIndex / n;
        tMax = env.maxT[bucketIndex] ?? bucketIndex / n;
    } else {
        const tCenter = dataStart + (bucketIndex / n) * (dataEnd - dataStart);
        tMin = tCenter;
        tMax = tCenter;
    }

    const minPoint: BucketPoint = { tNorm: tMin, value: minVal };
    const maxPoint: BucketPoint = { tNorm: tMax, value: maxVal };
    return tMin <= tMax ? [minPoint, maxPoint] : [maxPoint, minPoint];
}

export function computeDiv(visibleCount: number, W: number): number {
    return Math.max(1, Math.floor(visibleCount / (W * 2)));
}

/**
 * renderWaveformData の最初の path 点として使うアンカーの x 座標を返す。
 * i0 番目のバケット境界がキャンバス左端以前（x ≤ 0）なら、その x 座標を返す。
 * x > 0 の場合は null を返し、アンカーを注入しないことを示す。
 *
 * @param i0 - 描画開始バケットインデックス
 * @param n  - データ点数
 * @param dataStart - データ範囲の開始（全ファイル正規化）
 * @param dataRange - データ範囲の幅
 * @param offsetNorm - offsetSeconds / durationSeconds
 * @param zoomStart - ズーム開始位置
 * @param zoomEnd   - ズーム終了位置
 * @param W - キャンバス幅 px
 */
export function computeAnchorX(
    i0: number,
    n: number,
    dataStart: number,
    dataRange: number,
    offsetNorm: number,
    zoomStart: number,
    zoomEnd: number,
    W: number,
): number | null {
    const anchorT = dataStart + (i0 / n) * dataRange;
    const anchorX = ((anchorT + offsetNorm - zoomStart) / (zoomEnd - zoomStart)) * W;
    return anchorX <= 0 ? anchorX : null;
}

export interface CanvasCtx {
    lineWidth: number;
    strokeStyle: string;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
}

export interface LoopRegionCtx {
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    globalAlpha: number;
    save(): void;
    restore(): void;
    setLineDash(segments: number[]): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath(): void;
    stroke(): void;
    fill(): void;
}

// ── Layer 1: CoordTransform ───────────────────────────────────

export interface CoordTransform {
    /** ファイル正規化時刻 tNorm → canvas x (px) */
    toX(tNorm: number): number;
    /** 振幅値 v → canvas y (px) */
    toY(v: number): number;
}

/**
 * 座標変換オブジェクトを生成する。
 * offsetNorm = offsetSeconds / durationSeconds（呼び元が計算する）。
 * trackDurRatio = durationSeconds / globalSpanSec（マルチトラック時に使用、デフォルト=1）。
 */
export function makeCoordTransform(
    zoomStart: number,
    zoomEnd: number,
    offsetNorm: number,
    W: number,
    H: number,
    peak: number,
    trackDurRatio: number = 1,
): CoordTransform {
    const span = Math.max(zoomEnd - zoomStart, 1e-9);
    return {
        toX(tNorm: number): number {
            const raw = ((offsetNorm + tNorm * trackDurRatio - zoomStart) / span) * W;
            return Math.round(raw * 1e10) / 1e10;
        },
        toY(v: number): number {
            return H / 2 - (v / (peak || 1)) * (H * 0.44);
        },
    };
}

// ── Layer 2: Decimation ───────────────────────────────────────

/** 1 バケットを代表する点ペア（座標変換前）。 */
export interface DecimatedPoint {
    tNorm: number;
    value: number;
}

/** 描画対象インデックス範囲とデシメーション率。 */
export interface ViewRange {
    i0: number;
    i1: number;
    div: number;
}

/**
 * 可視範囲に基づく描画インデックス範囲を算出する。
 * i0/i1 はビュースパン 1 つ分前後に拡張し、Canvas クリップで左右端を自然に処理する。
 * div は可視バケット数から算出し、拡張分が解像度に影響しないようにする。
 * trackDurRatio = durationSeconds / globalSpanSec（マルチトラック時に使用、デフォルト=1）。
 */
export function computeViewRange(
    env: WaveformEnv,
    dataStart: number,
    dataEnd: number,
    offsetNorm: number,
    zoomStart: number,
    zoomEnd: number,
    W: number,
    trackDurRatio: number = 1,
): ViewRange {
    const n = (env.min && env.min.length) || (env.samples && env.samples.length) || 0;
    if (n === 0) { return { i0: 0, i1: -1, div: 1 }; }

    const dataRange = Math.max(dataEnd - dataStart, 1e-9);
    const fileAtZoomStart = (zoomStart - offsetNorm) / trackDurRatio;
    const fileAtZoomEnd   = (zoomEnd   - offsetNorm) / trackDurRatio;
    const visStartNorm = (fileAtZoomStart - dataStart) / dataRange;
    const visEndNorm   = (fileAtZoomEnd   - dataStart) / dataRange;

    // 可視ファイル範囲を 1 つ分前後に拡張して描画（off-canvas は Canvas がクリップ）。
    // extSpan は「今見えているファイル区間の幅」を使い、左右対称に拡張する。
    const clampedVisStartNorm = Math.max(0, visStartNorm);
    const clampedVisEndNorm = Math.min(1, visEndNorm);
    const extSpan = Math.max(clampedVisEndNorm - clampedVisStartNorm, 1 / n);
    const i0 = Math.max(0, Math.floor((visStartNorm - extSpan) * n));
    const i1 = Math.min(n - 1, Math.ceil((visEndNorm + extSpan) * n));

    // div は可視バケット数のみで計算
    const visI0 = Math.max(0, Math.floor(visStartNorm * n) - 1);
    const visI1 = Math.min(n - 1, Math.ceil(visEndNorm * n) + 1);
    const div = Math.max(1, Math.floor(Math.max(1, visI1 - visI0 + 1) / (W * 2)));

    return { i0, i1, div };
}

/**
 * バケットごとに argmin/argmax を選択し、時系列順ペアで返す。
 * 座標変換は行わない（Canvas に依存しない純粋関数）。
 */
export function decimateBuckets(
    env: WaveformEnv,
    range: ViewRange,
    dataStart: number,
    dataEnd: number,
): Array<[DecimatedPoint, DecimatedPoint]> {
    const { i0, i1, div } = range;
    if (i1 < i0) { return []; }

    const minArr = env.min || [];
    const maxArr = env.max || [];
    const samplesArr = env.samples ?? [];
    const n = minArr.length || samplesArr.length;
    const dataRange = Math.max(dataEnd - dataStart, 1e-9);

    function lo(i: number): number { return minArr.length > i ? minArr[i] : (samplesArr[i] ?? 0); }
    function hi(i: number): number { return maxArr.length > i ? maxArr[i] : (samplesArr[i] ?? 0); }
    function tOfMin(idx: number): number {
        return env.minT && env.minT.length > idx ? env.minT[idx] : dataStart + (idx / n) * dataRange;
    }
    function tOfMax(idx: number): number {
        return env.maxT && env.maxT.length > idx ? env.maxT[idx] : dataStart + (idx / n) * dataRange;
    }

    const result: Array<[DecimatedPoint, DecimatedPoint]> = [];

    for (let b = i0; b <= i1; b += div) {
        const bEnd = Math.min(i1 + 1, b + div);
        let minIdx = b, maxIdx = b;
        let minVal = lo(b), maxVal = hi(b);
        for (let i = b + 1; i < bEnd; i++) {
            const l = lo(i), h = hi(i);
            if (l < minVal) { minVal = l; minIdx = i; }
            if (h > maxVal) { maxVal = h; maxIdx = i; }
        }
        const tMin = tOfMin(minIdx);
        const tMax = tOfMax(maxIdx);
        const a: DecimatedPoint = { tNorm: tMin, value: minVal };
        const b2: DecimatedPoint = { tNorm: tMax, value: maxVal };
        result.push(tMin <= tMax ? [a, b2] : [b2, a]);
    }

    return result;
}

// ── Layer 3: Painting ─────────────────────────────────────────

/**
 * DecimatedPoint ペア列を Canvas に描画する。
 * Canvas API を触るのはこの関数だけ。
 */
export function paintDecimatedPoints(
    ctx: CanvasCtx,
    points: Array<[DecimatedPoint, DecimatedPoint]>,
    transform: CoordTransform,
    color: string,
    lineWidth: number,
): void {
    if (points.length === 0) { return; }
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.beginPath();
    let started = false;

    for (const [first, second] of points) {
        const x0 = transform.toX(first.tNorm),  y0 = transform.toY(first.value);
        const x1 = transform.toX(second.tNorm), y1 = transform.toY(second.value);
        if (!started) { ctx.moveTo(x0, y0); started = true; } else { ctx.lineTo(x0, y0); }
        ctx.lineTo(x1, y1);
    }
    ctx.stroke();
}

export function paintLoopRegion(
    ctx: LoopRegionCtx,
    W: number,
    H: number,
    loopStart: number,
    loopEnd: number,
    zoomStart: number,
    zoomEnd: number,
): void {
    if (loopStart >= loopEnd) { return; }
    const span = zoomEnd - zoomStart;
    if (span <= 0) { return; }
    const toX = (norm: number) => (norm - zoomStart) / span * W;
    const x0 = toX(loopStart);
    const x1 = toX(loopEnd);
    const left = Math.max(0, x0);
    const right = Math.min(W, x1);
    if (right <= left) { return; }

    ctx.save();
    ctx.setLineDash([]);

    // 区間外を暗く
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, left, H);
    ctx.fillRect(right, 0, W - right, H);

    // 区間内を青くハイライト
    ctx.fillStyle = 'rgba(100, 160, 255, 0.15)';
    ctx.fillRect(left, 0, right - left, H);

    // グリップハンドル（縦線）
    ctx.strokeStyle = 'rgba(100, 160, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(left, H);
    ctx.moveTo(right, 0);
    ctx.lineTo(right, H);
    ctx.stroke();

    // 三角マーカー
    const TH = 8;
    ctx.fillStyle = 'rgba(100, 160, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(left + TH, 0);
    ctx.lineTo(left, TH);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(right, 0);
    ctx.lineTo(right - TH, 0);
    ctx.lineTo(right, TH);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

/** 後方互換ファサード。内部は 3 層パイプラインを使用する。 */
export function renderWaveform(
    ctx: CanvasCtx,
    W: number,
    H: number,
    env: WaveformEnv,
    dataStart: number,
    dataEnd: number,
    offsetSeconds: number,
    durationSeconds: number,
    zoomStart: number,
    zoomEnd: number,
    color: string,
    lineWidth: number = 1.5,
): void {
    const peak = env.absolutePeak || 1;
    const offsetNorm = offsetSeconds / (durationSeconds || 1);

    const range = computeViewRange(env, dataStart, dataEnd, offsetNorm, zoomStart, zoomEnd, W);
    if (range.i1 < range.i0) { return; }

    const points = decimateBuckets(env, range, dataStart, dataEnd);
    const transform = makeCoordTransform(zoomStart, zoomEnd, offsetNorm, W, H, peak);
    paintDecimatedPoints(ctx, points, transform, color, lineWidth);
}

export interface WaveformPipelineParams {
    zoomStart: number;
    zoomEnd: number;
    offsetNorm: number;
    dataStart: number;
    dataEnd: number;
    color: string;
    trackDurRatio?: number;
    lineWidth?: number;
}

/**
 * マルチトラック比較パネル用の描画関数。
 *
 * offsetNorm / trackDurRatio はグローバルスパン基準の正規化座標で、
 * 単一トラック内の正規化時刻 t (0..1) をグローバル座標へ写像する:
 *   global = offsetNorm + t * trackDurRatio
 *
 * media/comparisonWaveform.js が長らく公開していた window.renderWaveformPipeline
 * と同一の挙動を持つ単一ソース実装。webview からは scripts/build-webview.js が
 * 生成する dist/webview/comparisonWaveform.js 経由で window.renderWaveformPipeline
 * として呼び出される。
 */
export function renderWaveformPipeline(
    ctx: CanvasCtx,
    W: number,
    H: number,
    env: WaveformEnv,
    params: WaveformPipelineParams,
): void {
    const { zoomStart, zoomEnd, offsetNorm, dataStart, dataEnd, color } = params;
    const trackDurRatio = params.trackDurRatio ?? 1;
    const lineWidth = params.lineWidth ?? 1.5;
    const peak = env.absolutePeak || 1;
    const minArr = env.min || [];
    const maxArr = env.max || [];
    const samplesArr = env.samples || [];
    const n = minArr.length || samplesArr.length;
    if (n === 0) { return; }

    const dataRange = Math.max(dataEnd - dataStart, 1e-9);
    const span = Math.max(zoomEnd - zoomStart, 1e-9);

    const fileAtZoomStart = (zoomStart - offsetNorm) / trackDurRatio;
    const fileAtZoomEnd = (zoomEnd - offsetNorm) / trackDurRatio;
    const visStartNorm = (fileAtZoomStart - dataStart) / dataRange;
    const visEndNorm = (fileAtZoomEnd - dataStart) / dataRange;
    const clampedVisStartNorm = Math.max(0, visStartNorm);
    const clampedVisEndNorm = Math.min(1, visEndNorm);
    const extSpan = Math.max(clampedVisEndNorm - clampedVisStartNorm, 1 / n);
    const i0 = Math.max(0, Math.floor((visStartNorm - extSpan) * n));
    const i1 = Math.min(n - 1, Math.ceil((visEndNorm + extSpan) * n));
    if (i1 < i0) { return; }

    const visI0 = Math.max(0, Math.floor(visStartNorm * n) - 1);
    const visI1 = Math.min(n - 1, Math.ceil(visEndNorm * n) + 1);
    const div = Math.max(1, Math.floor(Math.max(1, visI1 - visI0 + 1) / (W * 2)));

    const lo = (i: number): number => (minArr.length > i ? minArr[i] : (samplesArr[i] ?? 0));
    const hi = (i: number): number => (maxArr.length > i ? maxArr[i] : (samplesArr[i] ?? 0));
    const tOfMin = (idx: number): number => (env.minT && env.minT.length > idx
        ? env.minT[idx]
        : dataStart + (idx / n) * dataRange);
    const tOfMax = (idx: number): number => (env.maxT && env.maxT.length > idx
        ? env.maxT[idx]
        : dataStart + (idx / n) * dataRange);

    const toX = (t: number): number => ((offsetNorm + t * trackDurRatio - zoomStart) / span) * W;
    const toY = (v: number): number => H / 2 - (v / peak) * (H * 0.44);

    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.beginPath();
    let started = false;

    for (let b = i0; b <= i1; b += div) {
        const bEnd = Math.min(i1 + 1, b + div);
        let minIdx = b, maxIdx = b;
        let minVal = lo(b), maxVal = hi(b);
        for (let i = b + 1; i < bEnd; i++) {
            const l = lo(i), h = hi(i);
            if (l < minVal) { minVal = l; minIdx = i; }
            if (h > maxVal) { maxVal = h; maxIdx = i; }
        }
        const tMin = tOfMin(minIdx);
        const tMax = tOfMax(maxIdx);
        const fx = tMin <= tMax ? toX(tMin) : toX(tMax);
        const fy = tMin <= tMax ? toY(minVal) : toY(maxVal);
        const sx = tMin <= tMax ? toX(tMax) : toX(tMin);
        const sy = tMin <= tMax ? toY(maxVal) : toY(minVal);
        if (!started) { ctx.moveTo(fx, fy); started = true; } else { ctx.lineTo(fx, fy); }
        ctx.lineTo(sx, sy);
    }
    ctx.stroke();
}
