import type { TimelineSpan } from './types';



export function trackTimelinePlacement(offsetSeconds: number, durationSeconds: number, span: TimelineSpan): { offsetNorm: number; trackDurRatio: number } {
    return {
        offsetNorm: (offsetSeconds - span.startSec) / span.spanSec,
        trackDurRatio: (durationSeconds || 1) / span.spanSec,
    };
}
