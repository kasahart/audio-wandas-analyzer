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

interface CanvasCtx {
    lineWidth: number;
    strokeStyle: string;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
}

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
    const n = env.min.length;
    if (n === 0) { return; }

    const dataRange = dataEnd - dataStart;
    const dur = durationSeconds || 1;
    const offsetNorm = offsetSeconds / dur;

    const visStartNorm = (zoomStart - offsetNorm - dataStart) / dataRange;
    const visEndNorm = (zoomEnd - offsetNorm - dataStart) / dataRange;
    const i0 = Math.max(0, Math.floor(visStartNorm * n) - 1);
    const i1 = Math.min(n - 1, Math.ceil(visEndNorm * n) + 1);
    if (i1 <= i0) { return; }

    const div = computeDiv(i1 - i0 + 1, W);

    function lo(i: number): number { return (env.min.length > i ? env.min[i] : (env.samples?.[i] ?? 0)); }
    function hi(i: number): number { return (env.max.length > i ? env.max[i] : (env.samples?.[i] ?? 0)); }
    function toX(tNorm: number): number {
        return xOfNorm(tNorm + offsetNorm, zoomStart, zoomEnd, W);
    }
    function toY(v: number): number { return H / 2 - (v / peak) * (H * 0.44); }

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

        const tMinIdx = env.minT ? (env.minT[minIdx] ?? minIdx / n) : dataStart + (minIdx / n) * dataRange;
        const tMaxIdx = env.maxT ? (env.maxT[maxIdx] ?? maxIdx / n) : dataStart + (maxIdx / n) * dataRange;

        const [first, second] = tMinIdx <= tMaxIdx
            ? [{ t: tMinIdx, v: minVal }, { t: tMaxIdx, v: maxVal }]
            : [{ t: tMaxIdx, v: maxVal }, { t: tMinIdx, v: minVal }];

        const x0 = toX(first.t), y0 = toY(first.v);
        const x1 = toX(second.t), y1 = toY(second.v);

        if (!started) { ctx.moveTo(x0, y0); started = true; } else { ctx.lineTo(x0, y0); }
        ctx.lineTo(x1, y1);
    }
    ctx.stroke();
}
