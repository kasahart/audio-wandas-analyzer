/** Extra span requested on each side of the visible range, as a fraction of the visible span. */
export const RANGE_REQUEST_PADDING_RATIO = 0.05;
/** Upper bound on points per range request (twice the canvas width, capped). */
export const MAX_RANGE_REQUEST_POINTS = 8000;
/** A cached range is reused while it has at least this fraction of the requested points... */
export const RANGE_CACHE_MIN_POINT_RATIO = 0.8;
/** ...and at least this many points per canvas pixel inside the visible range. */
export const RANGE_CACHE_MIN_POINTS_PER_PIXEL = 0.5;

export const OVERVIEW_POINTS = 1200;

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
    return Array.from({ length: channelCount }).every((_, channelIndex) => rangeHasDetail(
        waveformPointCount(cache.channels[channelIndex]), cache.startNorm, cache.endNorm, points, width, fileAtZoomStart, fileAtZoomEnd,
    ));
}

/**
 * Whether `cachedPoints` fetched over [cacheStart, cacheEnd] still draw the visible part finely enough: enough
 * points in all, and enough per pixel inside the view. The lanes and the comparison's zoomed pictures reuse a range by it.
 */
export function rangeHasDetail(cachedPoints: number, cacheStart: number, cacheEnd: number, points: number, width: number, viewStart: number, viewEnd: number): boolean {
    const cacheDataRange = Math.max(cacheEnd - cacheStart, 1e-9);
    const ptsVisible = cachedPoints * ((viewEnd - viewStart) / cacheDataRange);
    return cachedPoints >= points * RANGE_CACHE_MIN_POINT_RATIO && ptsVisible >= width * RANGE_CACHE_MIN_POINTS_PER_PIXEL;
}

export function visibleFileFraction(fileAtZoomStart: number, fileAtZoomEnd: number): number {
    const viewStart = Math.max(0, Math.min(fileAtZoomStart, fileAtZoomEnd));
    const viewEnd = Math.min(1, Math.max(fileAtZoomStart, fileAtZoomEnd));
    return Math.max(0, viewEnd - viewStart);
}

export function isOverviewSufficient(
    overviews: ReadonlyArray<RangeCacheEntry['channels'][number] | null | undefined>,
    width: number,
    fileAtZoomStart: number,
    fileAtZoomEnd: number,
): boolean {
    const visibleFraction = visibleFileFraction(fileAtZoomStart, fileAtZoomEnd);
    if (visibleFraction <= 0) {
        return true;
    }
    return overviews.every((waveform) => Math.max(waveformPointCount(waveform), OVERVIEW_POINTS) * visibleFraction >= width);
}

export function isRangeCacheDrawable(cache: RangeCacheEntry | null, channelIndex: number): boolean {
    const channel = cache && cache.channels ? cache.channels[channelIndex] : null;
    return waveformPointCount(channel) > 0;
}

export function rangeCacheCoversView(cache: RangeCacheEntry | null, channelIndex: number, fileAtZoomStart: number, fileAtZoomEnd: number): boolean {
    return !!cache && isRangeCacheDrawable(cache, channelIndex) &&
        cache.startNorm <= Math.max(0, fileAtZoomStart) &&
        cache.endNorm >= Math.min(1, fileAtZoomEnd);
}
