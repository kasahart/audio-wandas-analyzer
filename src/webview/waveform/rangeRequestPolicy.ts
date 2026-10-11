/** Extra span requested on each side of the visible range, as a fraction of the visible span. */
export const RANGE_REQUEST_PADDING_RATIO = 0.05;
/** Upper bound on points per range request (twice the canvas width, capped). */
export const MAX_RANGE_REQUEST_POINTS = 8000;
/** A cached range is reused while it has at least this fraction of the requested points... */
export const RANGE_CACHE_MIN_POINT_RATIO = 0.8;
/** ...and at least this many points per canvas pixel inside the visible range. */
export const RANGE_CACHE_MIN_POINTS_PER_PIXEL = 0.5;

export function rangeRequestPointCount(canvasWidth: number): number {
    return Math.min(canvasWidth * 2, MAX_RANGE_REQUEST_POINTS);
}

/**
 * checkAndRequestRanges で使うリクエスト範囲を計算する。
 * offset = offsetSeconds / durationSeconds（正なら波形が視覚上右にずれる）。
 * 視覚位置 v に対応するファイル位置は v - offset なので、
 * リクエスト範囲は [zoomStart - offset, zoomEnd - offset] ± padding。
 */
export function computeReqBounds(
    zoomStart: number,
    zoomEnd: number,
    offset = 0,
): { reqStart: number; reqEnd: number } {
    const padding = RANGE_REQUEST_PADDING_RATIO * (zoomEnd - zoomStart);
    return {
        reqStart: Math.max(0, zoomStart - offset - padding),
        reqEnd:   Math.min(1, zoomEnd   - offset + padding),
    };
}

export interface RangeCacheEntry {
    startNorm: number;
    endNorm: number;
    channels: Array<{ min?: number[]; max?: number[]; samples?: number[] }>;
}

export function waveformPointCount(waveform: RangeCacheEntry['channels'][number] | null | undefined): number {
    if (!waveform) {
        return 0;
    }
    return (waveform.min && waveform.min.length) || (waveform.samples && waveform.samples.length) || 0;
}

export function isCacheSufficient(
    cache: RangeCacheEntry | null,
    reqStart: number,
    reqEnd: number,
    points: number,
    width: number,
    fileAtZoomStart: number,
    fileAtZoomEnd: number,
    channelCount: number,
): boolean {
    if (!cache || cache.startNorm > reqStart || cache.endNorm < reqEnd || !cache.channels) {
        return false;
    }
    const cacheDataRange = Math.max(cache.endNorm - cache.startNorm, 1e-9);
    return Array.from({ length: channelCount }).every((_, channelIndex) => {
        const channel = cache.channels[channelIndex];
        const nPts = waveformPointCount(channel);
        const ptsVisible = nPts * ((fileAtZoomEnd - fileAtZoomStart) / cacheDataRange);
        return nPts >= points * RANGE_CACHE_MIN_POINT_RATIO && ptsVisible >= width * RANGE_CACHE_MIN_POINTS_PER_PIXEL;
    });
}
