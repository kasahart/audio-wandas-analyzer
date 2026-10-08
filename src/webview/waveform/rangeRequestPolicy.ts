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
    const padding = 0.05 * (zoomEnd - zoomStart);
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
        return nPts >= points * 0.8 && ptsVisible >= width * 0.5;
    });
}
