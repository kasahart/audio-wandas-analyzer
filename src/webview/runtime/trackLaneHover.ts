/**
 * The pointer over a track's waveform lane reads it as every plot of lines does (R7, plotHover.ts): the point
 * drawn nearest the pointer within a few pixels, else the one under it nearest in height; the cursor at that
 * point, a level line in the lane's colour, and a readout naming the recording, its time and amplitude.
 */
import { readoutText } from '../../shared/gui-core/index';
import { HOVER_PICK_RADIUS_PX, nearestPoint } from './plotHover';

/** A point of a lane's waveform as drawn: where on the canvas (bitmap pixels), its value and time (the file's 0..1). */
export interface LanePoint {
    x: number;
    y: number;
    value: number;
    t: number;
}

/**
 * The point the pointer at (`x`, `y`) reads on a lane drawn as `points` (bitmap pixels; `pixelRatio` bitmap
 * pixels to a CSS pixel, so the pick radius is the same on screen as on every other plot).
 */
export function laneHoverPoint(points: readonly LanePoint[], x: number, y: number, pixelRatio = 1): LanePoint | null {
    const radius = HOVER_PICK_RADIUS_PX * pixelRatio;
    const hit = nearestPoint([points],
        line => line.filter(point => Math.abs(point.x - x) <= radius),
        // With none that near: of the points in the nearest column, the one nearest in height, anywhere over the
        // waveform (zoomed in, its samples may lie farther apart than the radius); past its ends, nothing.
        line => {
            let column = Infinity, first = Infinity, last = -Infinity;
            for (const point of line) {
                column = Math.min(column, Math.abs(point.x - x));
                first = Math.min(first, point.x);
                last = Math.max(last, point.x);
            }
            if (!isFinite(column) || x < first - radius || x > last + radius) return null;
            let best: LanePoint | null = null;
            for (const point of line) {
                if (Math.abs(point.x - x) <= column + pixelRatio * 0.5 && (!best || Math.abs(point.y - y) < Math.abs(best.y - y))) best = point;
            }
            return best;
        }, x, y, radius);
    return hit ? hit.point : null;
}

/** "name / 1.234 s / 0.123 FS": the time to the digits a pixel tells apart (at least 10 ms), the amplitude to 3 figures. */
export function laneReadoutText(label: string, seconds: number, secondsPerPixel: number, value: number, unit: string | null): string {
    const digits = Math.max(2, Math.min(6, Math.ceil(-Math.log10(Math.max(secondsPerPixel, 1e-6)))));
    const time = `${seconds.toFixed(digits).replace(/^-/, '−')} s`;
    const amount = `${(Math.abs(value) >= 10 ? value.toFixed(1) : value.toPrecision(3)).replace(/^-/, '−')}${unit ? ` ${unit}` : ''}`;
    return readoutText([...(label ? [label] : []), time, amount]);
}
