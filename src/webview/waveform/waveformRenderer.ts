import { clippedPath } from '../plot/lineClip';
import { WAVEFORM_HALF_HEIGHT_RATIO } from './waveformLayout';

export interface WaveformEnv {
    min: number[];
    max: number[];
    minT?: number[];
    maxT?: number[];
    samples?: number[];
    absolutePeak: number;
}

export interface CanvasCtx {
    lineWidth: number;
    strokeStyle: string | CanvasGradient | CanvasPattern;
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

export interface AmplitudeViewport {
    minNorm: number;
    maxNorm: number;
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
    amplitudeViewport?: AmplitudeViewport,
): CoordTransform {
    const span = Math.max(zoomEnd - zoomStart, 1e-9);
    const ampSpan = amplitudeViewport
        ? Math.max(amplitudeViewport.maxNorm - amplitudeViewport.minNorm, 1e-9)
        : null;
    return {
        toX(tNorm: number): number {
            const raw = ((offsetNorm + tNorm * trackDurRatio - zoomStart) / span) * W;
            return Math.round(raw * 1e10) / 1e10;
        },
        toY(v: number): number {
            const valueNorm = v / (peak || 1);
            if (amplitudeViewport && ampSpan !== null) {
                return ((amplitudeViewport.maxNorm - valueNorm) / ampSpan) * H;
            }
            return H / 2 - valueNorm * (H * WAVEFORM_HALF_HEIGHT_RATIO);
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
 * バケットは div の倍数の位置から始まる（描画範囲の先頭からではない）。パンしても同じ点が同じバケットに入り、線が揺れない。
 * 座標変換は行わない（Canvas に依存しない純粋関数）。
 *
 * A bucket of the envelope whose value is not finite (a gap of the signal, sent as null) is never joined across
 * (docs/display-rules.md R2): the env buckets on either side of it are thinned apart, each run its own lowest and
 * highest, and a gap pair (`isGap`, its values NaN) stands between them, where paintDecimatedPoints lifts the pen.
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
    const gapAt = (i: number): void => {
        const last = result[result.length - 1];
        if (last && isGap(last)) return;
        const t = tOfMin(i);
        result.push([{ tNorm: t, value: Number.NaN }, { tNorm: t, value: Number.NaN }]);
    };

    for (let b = i0 - (i0 % div); b <= i1; b += div) {
        const bEnd = Math.min(n, b + div);
        // Each run of the bucket between gaps: its lowest and highest, in time order.
        let minIdx = -1, maxIdx = -1, minVal = 0, maxVal = 0;
        const closeRun = (): void => {
            if (minIdx < 0) return;
            const tMin = tOfMin(minIdx);
            const tMax = tOfMax(maxIdx);
            const a: DecimatedPoint = { tNorm: tMin, value: minVal };
            const b2: DecimatedPoint = { tNorm: tMax, value: maxVal };
            result.push(tMin <= tMax ? [a, b2] : [b2, a]);
            minIdx = -1; maxIdx = -1;
        };
        for (let i = b; i < bEnd; i++) {
            const l = lo(i), h = hi(i);
            if (!Number.isFinite(l) || !Number.isFinite(h)) { closeRun(); gapAt(i); continue; }
            if (minIdx < 0 || l < minVal) { minVal = l; minIdx = i; }
            if (maxIdx < 0 || h > maxVal) { maxVal = h; maxIdx = i; }
        }
        closeRun();
    }

    return result;
}

/** Whether a pair of decimateBuckets is a gap of the signal: the line breaks there. */
export function isGap(pair: readonly [DecimatedPoint, DecimatedPoint]): boolean {
    return !Number.isFinite(pair[0].value) || !Number.isFinite(pair[1].value);
}

// ── Layer 3: Painting ─────────────────────────────────────────

/**
 * DecimatedPoint ペア列を Canvas に描画する。
 * Canvas API を触るのはこの関数だけ。
 *
 * Lines are clipped, not clamped (docs/display-rules.md R2, plot/lineClip.ts): each point at its exact y, each segment
 * cut where it crosses `box` (the plot in the transform's coordinates) grown by the line's width. A line wholly in the
 * box is the same moveTo/lineTo path as without clipping. A gap pair (isGap) lifts the pen.
 */
export function paintDecimatedPoints(
    ctx: CanvasCtx,
    points: Array<[DecimatedPoint, DecimatedPoint]>,
    transform: CoordTransform,
    color: string,
    lineWidth: number,
    box: { left: number; top: number; width: number; height: number },
): void {
    if (points.length === 0) { return; }
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.beginPath();
    const path = clippedPath({ start: (x, y) => ctx.moveTo(x, y), to: (x, y) => ctx.lineTo(x, y) }, box, lineWidth);
    let last: [number, number] | null = null;

    for (const pair of points) {
        // A gap of the signal lifts the pen: the line is never joined across it (R2).
        if (isGap(pair)) { last = null; path.lift(); continue; }
        const [first, second] = pair;
        const x0 = transform.toX(first.tNorm),  y0 = transform.toY(first.value);
        const x1 = transform.toX(second.tNorm), y1 = transform.toY(second.value);
        // The first pair starts the line; each later one is joined to the one before it, as one run.
        if (last) path.segment(last[0], last[1], x0, y0);
        path.segment(x0, y0, x1, y1);
        last = [x1, y1];
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
