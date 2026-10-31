/**
 * The pointer over a plot of lines, as every such plot answers it: the line nearest the pointer (by its height
 * where the pointer is across) is drawn thicker, a dashed cursor crosses the plot at that line's point, and a
 * dashed level line runs across at its value in the line's colour; the readout names that line, where it is and
 * its value. The spectrum overlay under the tracks set this; the comparison's plots share it.
 */
import { drawCrosshair } from '../../shared/gui-core/index';
import type { CanvasDrawCtx } from '../draw/canvasDrawers';

/** The nearest line's weight while the pointer is on it. */
export const HOVER_LINE_WIDTH = 2.5;
/** The cursor across the plot (its level line takes the line's colour). */
export const HOVER_CURSOR_COLOR = 'rgba(255,255,255,0.7)';

export interface HoverFrame {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * Of `series`, the one whose point (`pointOf`, in the plot's pixels; null where it has none) is nearest the
 * pointer's height `mouseY`; without a height, the first that has a point.
 */
export function nearestLine<S, P extends { y: number }>(series: readonly S[], pointOf: (s: S) => P | null, mouseY: number | null): { s: S; point: P } | null {
    let nearest: { s: S; point: P } | null = null;
    let distance = Infinity;
    for (const s of series) {
        const point = pointOf(s);
        if (!point) continue;
        if (mouseY === null) return { s, point };
        const away = Math.abs(point.y - mouseY);
        if (away < distance) {
            distance = away;
            nearest = { s, point };
        }
    }
    return nearest;
}

/**
 * The marks of a hover: the nearest line drawn again at HOVER_LINE_WIDTH (`restroke`, with the width set), and
 * the cursor at (`x`, `y`): `y` null draws only the cursor across, where no line is nearest.
 */
export function paintHoverMarks(ctx: CanvasDrawCtx, frame: HoverFrame, x: number, y: number | null, color: string, restroke?: (ctx: CanvasDrawCtx, width: number) => void): void {
    if (restroke) restroke(ctx, HOVER_LINE_WIDTH);
    drawCrosshair(ctx, frame, x, y, HOVER_CURSOR_COLOR, color);
}
