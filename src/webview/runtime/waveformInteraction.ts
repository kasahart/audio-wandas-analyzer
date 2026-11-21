import { formatClockTime } from '../../shared/utils/format';
import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';

// The zoom and pan steps are figure/zoomSteps.ts's (one rule for the old plots and the Figure).
export { normAtPlotX, panNormalizedRange, panNormalizedRangeBy, PAN_STEP_RATIO, WHEEL_LINE_PX, wheelPanPixels, wheelStepDirection, wheelZoomFactor, zoomNormalizedRange, zoomRangeAroundPivot, ZOOM_IN_FACTOR, type NormalizedRange } from '../figure/zoomSteps';
import type { NormalizedRange } from '../figure/zoomSteps';

export function centerRangeOn(range: NormalizedRange, norm: number): NormalizedRange {
    const span = range.end - range.start;
    const start = Math.max(0, norm - span / 2);
    if (start + span > 1) {
        return { start: Math.max(0, 1 - span), end: 1 };
    }
    return { start, end: start + span };
}

export function rangeAroundRegion(region: NormalizedRange, padRatio: number): NormalizedRange {
    const pad = (region.end - region.start) * padRatio;
    return { start: Math.max(0, region.start - pad), end: Math.min(1, region.end + pad) };
}


export function canvasYToAmplitudeNorm(
    y: number,
    height: number,
    amplitudeMin: number,
    amplitudeMax: number,
    explicit = false,
): number {
    if (height <= 0) {
        return 0;
    }
    const clampedY = Math.max(0, Math.min(height, y));
    if (explicit || amplitudeMin > -0.999999 || amplitudeMax < 0.999999) {
        return amplitudeMax - (clampedY / Math.max(height, 1)) * (amplitudeMax - amplitudeMin);
    }
    return Math.max(-1, Math.min(1, (height / 2 - clampedY) / (height * WAVEFORM_HALF_HEIGHT_RATIO)));
}

/** Loop-edge drags never shrink a region below this normalized span, and narrower rect-zoom boxes are ignored. */
export const MIN_SELECTION_SPAN = 0.001;

// The drag threshold is the page's one press arbitration's (figure/pressArbiter.ts), shared with the Figure.
export { DRAG_START_THRESHOLD_PX, exceedsDragThreshold } from '../figure/pressArbiter';

export interface RectZoomTarget {
    zoomStart: number;
    zoomEnd: number;
    amplitudeMin: number;
    amplitudeMax: number;
}

export function loopRegionClockText(region: NormalizedRange, span: { startSec: number; spanSec: number }): string {
    const startSec = span.startSec + region.start * span.spanSec;
    const endSec = span.startSec + region.end * span.spanSec;
    return formatClockTime(startSec) + ' – ' + formatClockTime(endSec);
}
