/**
 * checkAndRequestRanges で使うリクエスト範囲を計算する。
 * offset = offsetSeconds / durationSeconds（正なら波形が視覚上右にずれる）。
 * 視覚位置 v に対応するファイル位置は v - offset なので、
 * リクエスト範囲は [zoomStart - offset, zoomEnd - offset] ± padding。
 */
export function computeReqBounds(
    zoomStart: number,
    zoomEnd: number,
    offset: number,
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

/**
 * 既存キャッシュが現在のズームに対して十分な密度を持つか判定する。
 * true  = スキップ可（新規リクエスト不要）
 * false = 新規リクエストが必要
 *
 * 密度基準: 現在のズームウィンドウ内で visible なキャッシュポイントが
 * W * 0.5 pt/px 以上あること。
 */
export function isCacheSufficient(
    cache: RangeCacheEntry | null,
    reqStart: number,
    reqEnd: number,
    minPts: number,
    W: number,
    zoomStart: number,
    zoomEnd: number,
): boolean {
    if (!cache) { return false; }
    if (cache.startNorm > reqStart || cache.endNorm < reqEnd) { return false; }
    const ch0 = cache.channels[0];
    if (!ch0) { return false; }
    const nPts = (ch0.min && ch0.min.length) || (ch0.samples && ch0.samples.length) || 0;
    if (nPts < minPts) { return false; }
    const cacheDataRange = Math.max(cache.endNorm - cache.startNorm, 1e-9);
    const ptsVisible = nPts * ((zoomEnd - zoomStart) / cacheDataRange);
    return ptsVisible >= W * 0.5;
}
