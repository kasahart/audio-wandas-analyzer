import type { SpectrogramData } from '../../shared/analysis/analysisTypes';

type TimeBinSource = Pick<SpectrogramData, 'timeBins' | 'timeCentersSec'>;

/**
 * Edges of each spectrogram time bin as track-local norms (0 = file start, 1 = file end), timeBins + 1 long.
 * With frame centres each cell is centred on its STFT window and ends halfway to its neighbours, so the
 * outer cells may reach past the file. Null when the centres are unknown or not increasing: the bins then split
 * the duration evenly.
 */
export function spectrogramTimeBinEdges(spec: TimeBinSource, durationSec: number | undefined): number[] | null {
    const count = spec.timeBins;
    const centers = spec.timeCentersSec;
    if (!centers || centers.length !== count || count < 2 || !durationSec || !(durationSec > 0)
        || !centers.every((center, k) => Number.isFinite(center) && (k === 0 || center > centers[k - 1]))) {
        return null;
    }
    const edges = new Array<number>(count + 1);
    edges[0] = centers[0] - (centers[1] - centers[0]) / 2;
    for (let k = 1; k < count; k++) {
        edges[k] = (centers[k - 1] + centers[k]) / 2;
    }
    edges[count] = centers[count - 1] + (centers[count - 1] - centers[count - 2]) / 2;
    return edges.map((sec) => sec / durationSec);
}

/** Number of edges at or below x (edges ascending). */
function countAtOrBelow(edges: number[], x: number): number {
    let lo = 0, hi = edges.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (edges[mid] <= x) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

/** Number of edges below x (edges ascending). */
function countBelow(edges: number[], x: number): number {
    let lo = 0, hi = edges.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (edges[mid] < x) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

/** The bin whose cell holds the local norm x, clamped to the first and last bins. */
export function spectrogramTimeBinAt(edges: number[], x: number): number {
    const count = edges.length - 1;
    return Math.max(0, Math.min(count - 1, countAtOrBelow(edges, x) - 1));
}

/** Bins [first, after) whose cells overlap the local span (start, end); at least one bin. */
export function spectrogramTimeBinSpan(edges: number[], start: number, end: number): [number, number] {
    const count = edges.length - 1;
    const first = spectrogramTimeBinAt(edges, start);
    const after = Math.min(count, Math.max(first + 1, countBelow(edges, end)));
    return [first, after];
}
