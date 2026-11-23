/**
 * The zoom and pan steps every plot takes (R13): + / − and a Ctrl+wheel notch zoom the axis across by a fixed factor
 * about a point of it, Shift+wheel pans it a tenth of what is on screen, a sideways swipe by as far as the fingers went.
 * They work on fractions of the whole axis (0–1). Moved here from runtime/waveformInteraction.ts so the old plots and
 * the Figure take one rule (figure-design.md 第 2 節 D): the old module
 * re-exports them.
 */

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

/** A sideways swipe's move in CSS pixels (positive: later), lines and pages converted. */
export function wheelPanPixels(event: Pick<WheelEvent, 'deltaX' | 'deltaMode'>, pagePx: number): number {
    return event.deltaX * (event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? pagePx : 1);
}

/**
 * A Shift+wheel notch's direction (1: later, 0: none): its leading part, which is sideways where the system
 * turns Shift+wheel sideways (macOS).
 */
export function wheelStepDirection(event: Pick<WheelEvent, 'deltaX' | 'deltaY'>): -1 | 0 | 1 {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    return delta > 0 ? 1 : delta < 0 ? -1 : 0;
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

/** A swipe keeps the direction its first events took until it pauses this long (ms), so a diagonal one does not alternate. */
export const SWIPE_PAUSE_MS = 150;
