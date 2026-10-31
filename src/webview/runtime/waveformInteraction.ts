import { formatClockTime } from '../../shared/utils/format';
import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';

export interface NormalizedRange {
    start: number;
    end: number;
}

/** One zoom-in step keeps this fraction of the visible span (zoom-out divides by it). */
export const ZOOM_IN_FACTOR = 0.7;

/** One Ctrl+wheel notch: away from you zooms out (the span × 1.15), towards you zooms in (× 0.85). */
export function wheelZoomFactor(deltaY: number): number {
    return deltaY > 0 ? 1.15 : 0.85;
}

export function zoomNormalizedRange(range: NormalizedRange, factor: number): NormalizedRange {
    const center = (range.start + range.end) / 2;
    const half = ((range.end - range.start) / 2) * factor;
    return {
        start: Math.max(0, center - half),
        end: Math.min(1, center + half),
    };
}

export function zoomRangeAroundPivot(range: NormalizedRange, pivotNorm: number, factor: number): NormalizedRange {
    const currentSpan = range.end - range.start;
    const span = currentSpan * factor;
    const pivotRatio = currentSpan > 0 ? (pivotNorm - range.start) / currentSpan : 0.5;
    let start = pivotNorm - pivotRatio * span;
    let end = start + span;
    if (end > 1) {
        end = 1;
        start = Math.max(0, 1 - span);
    }
    if (start < 0) {
        start = 0;
        end = Math.min(1, span);
    }
    return { start, end };
}

export function normAtPlotX(range: NormalizedRange, plotX: number, plotWidth: number): number | null {
    if (plotWidth <= 0 || plotX < 0 || plotX > plotWidth) {
        return null;
    }
    return range.start + (plotX / plotWidth) * (range.end - range.start);
}

/** One wheel pan step moves the view by this fraction of the visible span. */
export const PAN_STEP_RATIO = 0.1;

export function panNormalizedRange(range: NormalizedRange, direction: -1 | 1): NormalizedRange {
    return panNormalizedRangeBy(range, PAN_STEP_RATIO * direction);
}

/** One wheel line, in CSS pixels (a mouse notch is about three). */
export const WHEEL_LINE_PX = 40;

/**
 * A wheel event as a sideways move in CSS pixels (positive: later): its sideways part when that leads (a
 * trackpad's two-finger swipe, or Shift+wheel where the system turns it sideways), else its turn (Shift+wheel).
 */
export function wheelPanPixels(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>, pagePx: number): number {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    return delta * (event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? pagePx : 1);
}

/** The range moved by `fraction` of its span (positive: later), stopping at the edges. */
export function panNormalizedRangeBy(range: NormalizedRange, fraction: number): NormalizedRange {
    const shift = (range.end - range.start) * fraction;
    if (range.start + shift < 0) {
        return { start: 0, end: range.end - range.start };
    }
    if (range.end + shift > 1) {
        return { start: range.start + 1 - range.end, end: 1 };
    }
    return { start: range.start + shift, end: range.end + shift };
}

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

export function amplitudeNormToCanvasY(
    norm: number,
    height: number,
    amplitudeMin: number,
    amplitudeMax: number,
    explicit = false,
): number {
    if (explicit || amplitudeMin > -0.999999 || amplitudeMax < 0.999999) {
        return ((amplitudeMax - norm) / Math.max(amplitudeMax - amplitudeMin, 1e-9)) * height;
    }
    return height / 2 - norm * (height * WAVEFORM_HALF_HEIGHT_RATIO);
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

export function loopRegionFromDrag(anchorNorm: number, norm: number): NormalizedRange | null {
    const start = Math.min(anchorNorm, norm);
    const end = Math.max(anchorNorm, norm);
    return end > start ? { start, end } : null;
}

export function moveLoopEdge(region: NormalizedRange, edge: 'start' | 'end', norm: number): NormalizedRange {
    return edge === 'start'
        ? { start: Math.max(0, Math.min(region.end - MIN_SELECTION_SPAN, norm)), end: region.end }
        : { start: region.start, end: Math.max(region.start + MIN_SELECTION_SPAN, Math.min(1, norm)) };
}

/** Pointer travel in px, on either axis, before a press on a waveform counts as a drag rather than a click. */
export const DRAG_START_THRESHOLD_PX = 3;

export function exceedsDragThreshold(dx: number, dy: number): boolean {
    return Math.abs(dx) > DRAG_START_THRESHOLD_PX || Math.abs(dy) > DRAG_START_THRESHOLD_PX;
}

export type LoopDragKind = 'loop' | 'gripStart' | 'gripEnd';

export function loopRegionForDrag(kind: LoopDragKind, anchorNorm: number, current: NormalizedRange | null, norm: number): NormalizedRange | null {
    if (kind === 'loop') {
        return loopRegionFromDrag(anchorNorm, norm);
    }
    return current ? moveLoopEdge(current, kind === 'gripStart' ? 'start' : 'end', norm) : null;
}

/** Grips are hit within 1.5% of the visible span, so they stay grabbable at any zoom level. */
const LOOP_GRIP_VIEW_FRACTION = 0.015;

export function loopGripAt(region: NormalizedRange | null, norm: number, viewSpan: number): Exclude<LoopDragKind, 'loop'> | null {
    if (!region) {
        return null;
    }
    const thresh = viewSpan * LOOP_GRIP_VIEW_FRACTION;
    if (Math.abs(norm - region.start) < thresh) {
        return 'gripStart';
    }
    if (Math.abs(norm - region.end) < thresh) {
        return 'gripEnd';
    }
    return null;
}

export interface RectZoomTarget {
    zoomStart: number;
    zoomEnd: number;
    amplitudeMin: number;
    amplitudeMax: number;
}

export function rectZoomTarget(selection: { startNorm: number; endNorm: number; startAmpNorm: number; endAmpNorm: number }): RectZoomTarget | null {
    const start = Math.min(selection.startNorm, selection.endNorm);
    const end = Math.max(selection.startNorm, selection.endNorm);
    const amplitudeMin = Math.min(selection.startAmpNorm, selection.endAmpNorm);
    const amplitudeMax = Math.max(selection.startAmpNorm, selection.endAmpNorm);
    if (end - start <= MIN_SELECTION_SPAN || amplitudeMax - amplitudeMin <= MIN_SELECTION_SPAN) {
        return null;
    }
    return { zoomStart: Math.max(0, start), zoomEnd: Math.min(1, end), amplitudeMin, amplitudeMax };
}

export function loopRegionClockText(region: NormalizedRange, span: { startSec: number; spanSec: number }): string {
    const startSec = span.startSec + region.start * span.spanSec;
    const endSec = span.startSec + region.end * span.spanSec;
    return formatClockTime(startSec) + ' – ' + formatClockTime(endSec);
}
