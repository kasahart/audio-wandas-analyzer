import type { TimelineSpan, WaveformCoverage } from './types';

interface PathCtx {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
}

export interface XExtent {
    minX: number;
    maxX: number;
}

// The waveform pipeline draws through moveTo/lineTo only, so wrapping them is
// the cheapest way to learn which horizontal span actually received samples.
export function traceXExtent(ctx: PathCtx, draw: () => void): XExtent | null {
    /* eslint-disable @typescript-eslint/unbound-method -- saved only to be called with ctx and restored onto it */
    const originalMoveTo = ctx.moveTo;
    const originalLineTo = ctx.lineTo;
    /* eslint-enable @typescript-eslint/unbound-method */
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    const track = function (x: number) {
        if (Number.isFinite(x)) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
        }
    };
    ctx.moveTo = function (x: number, y: number) {
        track(x);
        return originalMoveTo.call(ctx, x, y);
    };
    ctx.lineTo = function (x: number, y: number) {
        track(x);
        return originalLineTo.call(ctx, x, y);
    };
    try {
        draw();
    }
    finally {
        ctx.moveTo = originalMoveTo;
        ctx.lineTo = originalLineTo;
    }
    return Number.isFinite(minX) && Number.isFinite(maxX) ? { minX, maxX } : null;
}

export function waveformCoverageFromExtent(extent: XExtent | null, canvasWidth: number): WaveformCoverage | null {
    if (!extent) {
        return null;
    }
    return {
        minX: extent.minX,
        maxX: extent.maxX,
        canvasWidth,
        coversLeft: extent.minX <= 1,
        coversRight: extent.maxX >= canvasWidth - 1,
    };
}

export function trackTimelinePlacement(offsetSeconds: number, durationSeconds: number, span: TimelineSpan): { offsetNorm: number; trackDurRatio: number } {
    return {
        offsetNorm: (offsetSeconds - span.startSec) / span.spanSec,
        trackDurRatio: (durationSeconds || 1) / span.spanSec,
    };
}
