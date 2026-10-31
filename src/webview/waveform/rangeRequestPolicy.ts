/** Extra span requested on each side of the visible range, as a fraction of the visible span. */
export const RANGE_REQUEST_PADDING_RATIO = 0.05;
/** Upper bound on points per range request (twice the canvas width, capped). */
export const MAX_RANGE_REQUEST_POINTS = 8000;
/** A cached range is reused while it has at least this fraction of the requested points... */
export const RANGE_CACHE_MIN_POINT_RATIO = 0.8;
/** ...and at least this many points per canvas pixel inside the visible range. */
export const RANGE_CACHE_MIN_POINTS_PER_PIXEL = 0.5;

export const OVERVIEW_POINTS = 1200;

/**
 * The lanes fetch their detail for this many screens on each side of the view, so a pan stays on lines already
 * decimated at full density instead of showing the coarse overview until the next range arrives...
 */
export const RANGE_PREFETCH_SCREENS = 2;
/** ...and ask again once less than this many screens of fetched detail remain on a side. */
export const RANGE_KEEP_SCREENS = 1;
/** Upper bound on points of one prefetching range request (the backend's limit). */
export const MAX_PREFETCH_POINTS = 32768;

/** View ± `screens` visible spans, clamped to the file. */
export function screensAround(viewStart: number, viewEnd: number, screens: number): { reqStart: number; reqEnd: number } {
    const margin = screens * Math.max(0, viewEnd - viewStart);
    return { reqStart: Math.max(0, viewStart - margin), reqEnd: Math.min(1, viewEnd + margin) };
}

/** Points for [reqStart, reqEnd] at the density one screen gets (rangeRequestPointCount), within MAX_PREFETCH_POINTS. */
export function prefetchPointCount(canvasWidth: number, reqStart: number, reqEnd: number, viewStart: number, viewEnd: number): number {
    const screens = Math.max(1, (reqEnd - reqStart) / Math.max(viewEnd - viewStart, 1e-12));
    return Math.max(1, Math.min(MAX_PREFETCH_POINTS, Math.ceil(rangeRequestPointCount(canvasWidth) * screens - 1e-6)));
}

export interface LaneRangePlan {
    /** The range to ask for, and how many points. */
    reqStart: number;
    reqEnd: number;
    points: number;
    /** The range a cached (or pending) answer must cover for the lane not to ask again. */
    keepStart: number;
    keepEnd: number;
}

/** What a lane showing file positions [viewStart, viewEnd] on a canvas `width` px wide fetches, and keeps using. */
export function planLaneRange(viewStart: number, viewEnd: number, width: number): LaneRangePlan {
    const { reqStart, reqEnd } = screensAround(viewStart, viewEnd, RANGE_PREFETCH_SCREENS);
    const keep = screensAround(viewStart, viewEnd, RANGE_KEEP_SCREENS);
    return { reqStart, reqEnd, points: prefetchPointCount(width, reqStart, reqEnd, viewStart, viewEnd), keepStart: keep.reqStart, keepEnd: keep.reqEnd };
}

/** The `start|end|points` key a lane's range request carries, read back; null for any other key. */
export function parseRangeRequestKey(key: string): { startNorm: number; endNorm: number; points: number } | null {
    const parts = key.split('|');
    if (parts.length !== 3) return null;
    const [startNorm, endNorm, points] = parts.map(Number) as [number, number, number];
    return [startNorm, endNorm, points].every(Number.isFinite) ? { startNorm, endNorm, points } : null;
}

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
