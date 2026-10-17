import { fadeSecondsForSpan } from './audioFade';

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

/** Starting this close to the end of a track restarts it from the top instead. */
export const END_RESTART_MARGIN_SECONDS = 0.05;

export function playbackStartTime(mapping: TrackTimeMapping | null, startNorm: number, durationSeconds: number): number {
    const startTime = mapping ? trackTimeFromGlobalNorm(mapping, startNorm) : 0;
    if (durationSeconds > 0 && startTime >= Math.max(0, durationSeconds - END_RESTART_MARGIN_SECONDS)) {
        return 0;
    }
    return startTime;
}

export function loopRestartTime(mapping: TrackTimeMapping | null, currentTime: number, loop: { start: number; end: number } | null): number | null {
    if (!mapping || !loop || globalNormFromTrackTime(mapping, currentTime) < loop.end) {
        return null;
    }
    return trackTimeFromGlobalNorm(mapping, loop.start);
}

/** How far playback is from where it stops or loops back, and how long the fade before that point lasts. */
export function playbackEndFade(
    mapping: TrackTimeMapping | null,
    currentTime: number,
    loop: { start: number; end: number } | null,
    durationSeconds: number,
): { remaining: number; fadeSeconds: number } | null {
    let start = mapping && loop ? trackTimeFromGlobalNorm(mapping, loop.start) : 0;
    let end = mapping && loop ? trackTimeFromGlobalNorm(mapping, loop.end) : durationSeconds;
    if (!(end > start)) {
        // A loop outside this track clamps to one point; the track then simply plays to its end.
        start = 0;
        end = durationSeconds;
    }
    if (!(end > start)) {
        return null;
    }
    return { remaining: end - currentTime, fadeSeconds: fadeSecondsForSpan(end - start) };
}
