import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';

export interface NormalizedRange {
    start: number;
    end: number;
}

/** One zoom-in step keeps this fraction of the visible span (zoom-out divides by it). */
export const ZOOM_IN_FACTOR = 0.7;

export function zoomNormalizedRange(range: NormalizedRange, factor: number): NormalizedRange {
    const center = (range.start + range.end) / 2;
    const half = ((range.end - range.start) / 2) * factor;
    return {
        start: Math.max(0, center - half),
        end: Math.min(1, center + half),
    };
}

export function amplitudeNormToCanvasY(
    norm: number,
    height: number,
    amplitudeMin: number,
    amplitudeMax: number,
): number {
    if (amplitudeMin > -0.999999 || amplitudeMax < 0.999999) {
        return ((amplitudeMax - norm) / Math.max(amplitudeMax - amplitudeMin, 1e-9)) * height;
    }
    return height / 2 - norm * (height * WAVEFORM_HALF_HEIGHT_RATIO);
}

export function canvasYToAmplitudeNorm(
    y: number,
    height: number,
    amplitudeMin: number,
    amplitudeMax: number,
): number {
    if (height <= 0) {
        return 0;
    }
    const clampedY = Math.max(0, Math.min(height, y));
    if (amplitudeMin > -0.999999 || amplitudeMax < 0.999999) {
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
