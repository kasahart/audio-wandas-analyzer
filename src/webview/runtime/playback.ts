export interface GlobalTimeline {
    startSeconds: number;
    spanSeconds: number;
}

export interface TrackTimeMapping {
    durationSeconds: number;
    trackStart: number;
    trackDurRatio: number;
}

export function createTrackTimeMapping(
    durationSeconds: number,
    offsetSeconds: number,
    timeline: GlobalTimeline,
): TrackTimeMapping | null {
    if (durationSeconds <= 0 || timeline.spanSeconds <= 0) {
        return null;
    }
    return {
        durationSeconds,
        trackStart: (offsetSeconds - timeline.startSeconds) / timeline.spanSeconds,
        trackDurRatio: durationSeconds / timeline.spanSeconds,
    };
}

export function globalNormFromTrackTime(mapping: TrackTimeMapping, timeSeconds: number): number {
    return mapping.trackStart + (timeSeconds / mapping.durationSeconds) * mapping.trackDurRatio;
}

export function trackTimeFromGlobalNorm(mapping: TrackTimeMapping, norm: number): number {
    const fileNorm = (norm - mapping.trackStart) / mapping.trackDurRatio;
    return Math.max(0, Math.min(1, fileNorm)) * mapping.durationSeconds;
}
