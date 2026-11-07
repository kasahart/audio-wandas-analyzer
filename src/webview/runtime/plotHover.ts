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

/** How near the pointer (CSS pixels, across and up together) a line's point is picked over the one under it. */
export const HOVER_PICK_RADIUS_PX = 20;

/**
 * The point the pointer at (`x`, `y`) reads (R7): of every series' points within `radius` of it (`pointsNear`,
 * in the plot's pixels), the nearest by distance across and up, so a narrow peak a few pixels beside the pointer
 * is read at its top; with none that near, the series nearest in height at the pointer's own column
 * (`pointAt`, as nearestLine). `away` orders hits of several plots: any point within the radius before any other.
 */
export function nearestPoint<S, P extends { x: number; y: number }>(
    series: readonly S[],
    pointsNear: (s: S) => Iterable<P>,
    pointAt: (s: S) => P | null,
    x: number,
    y: number,
    radius: number,
): { s: S; point: P; away: number } | null {
    let nearest: { s: S; point: P; away: number } | null = null;
    for (const s of series) {
        for (const point of pointsNear(s)) {
            const away = Math.hypot(point.x - x, point.y - y);
            if (away <= radius && (!nearest || away < nearest.away)) nearest = { s, point, away };
        }
    }
    if (nearest) return nearest;
    const under = nearestLine(series, pointAt, y);
    return under ? { ...under, away: radius + Math.abs(under.point.y - y) } : null;
}

/**
 * The marks of a hover: the nearest line drawn again at HOVER_LINE_WIDTH (`restroke`, with the width set), and
 * the cursor at (`x`, `y`): `y` null draws only the cursor across, where no line is nearest.
 */
export function paintHoverMarks(ctx: CanvasDrawCtx, frame: HoverFrame, x: number, y: number | null, color: string, restroke?: (ctx: CanvasDrawCtx, width: number) => void): void {
    if (restroke) restroke(ctx, HOVER_LINE_WIDTH);
    drawCrosshair(ctx, frame, x, y, HOVER_CURSOR_COLOR, color);
}

/**
 * Where every plot's hover readout is shown (R7): in the row just above the plots, never laid over one, so the lines
 * under the pointer stay in view. Compare's plots have their controls row (trackStageMode), the cursor spectrum and the
 * pair plot their header; the track lanes, with no row of their own, the toolbar's (toolbarHtml). A row's readout
 * keeps its room while it is empty, so a hover never moves the plots.
 */
export const PLOT_READOUT_ID = 'plot-readout';

/** Shows `name / values` in the readout `slot` in `color`; short of room, the name is cut, never the values. */
export function showPlotReadout(slot: HTMLElement | null, name: string, values: string, color: string): void {
    if (!slot) return;
    const [nameEl, valuesEl] = Array.from(slot.children) as HTMLElement[];
    if (nameEl) nameEl.textContent = name;
    if (valuesEl) valuesEl.textContent = `${name && values ? ' / ' : ''}${values}`;
    slot.style.color = color;
    slot.hidden = !(name || values);
}

export function hidePlotReadout(slot: HTMLElement | null): void {
    if (slot) slot.hidden = true;
}
