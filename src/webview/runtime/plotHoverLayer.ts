/**
 * The pointer's marks over a plot drawn by the plot component (R7, R13): the line nearest the pointer drawn thicker, a
 * dashed cursor at its point and a dashed level line in its colour, on a canvas laid over the plot (so a hover does
 * not draw the plot again), and its name, where and value in the plot's readout row just above it, never over a
 * plot. An image has no lines: the cursor alone. Every plot's hover goes through here, and so does an arrow key's
 * step to the next point (stepFrom), so a key reads a point exactly as the pointer on it would.
 */
import { STAGE_MARGINS, stageHover, stageNeighbour, strokeStageLine, type StagePlot, type StageRead } from './stagePanes';
import { hidePlotReadout, paintHoverMarks, showPlotReadout } from './plotHover';

/** A place on screen (client pixels) for the pointer, or an arrow key's step, to read. */
export interface PlotPlace {
    clientX: number;
    clientY: number;
}

export interface PlotHoverLayer {
    /** The marks over `plot` for the pointer at (clientX, clientY), and its readout in `slot`; returns where the
     *  point read is across the plot (CSS pixels from its left), or null when none is read. */
    show(plot: HTMLElement, drawn: StagePlot | null, clientX: number, clientY: number, slot: HTMLElement | null): number | null;
    /** Only the cursor line at `clientX` over `plot`: a plot linked to the one under the pointer follows it (R8). */
    line(plot: HTMLElement, drawn: StagePlot | null, clientX: number): void;
    /** No marks, and every readout this layer filled emptied. */
    hide(): void;
    /**
     * Where an arrow key reads on `plot` (R7): the point `delta` points along from the one last shown there (0: that
     * point again), or, with none read there, the plot's left edge halfway up. Null with nothing further to read.
     */
    stepFrom(plot: HTMLElement, drawn: StagePlot | null, delta: -1 | 0 | 1): PlotPlace | null;
    /** The point last shown, while the marks are on it. */
    reading(): StageRead | null;
}

/** `parent`: where the layer goes. A plot inside a screen laid over the page (a stacking context of its own) puts its
 *  layer in that screen, so the marks are drawn above the screen and not under it. */
export function createPlotHoverLayer(document: Document, className = '', parent: HTMLElement = document.body): PlotHoverLayer {
    const layer = document.createElement('canvas');
    layer.className = `plot-hover-layer ${className}`.trim();
    layer.hidden = true;
    parent.append(layer);
    const filled = new Set<HTMLElement>();
    /** The point the marks are on: the plot's element, the part of the plot it is read on (its own, or its right-hand axis') and the read. */
    let last: { plot: HTMLElement; on: StagePlot; read: StageRead } | null = null;
    const emptyAll = (): void => { for (const slot of filled) hidePlotReadout(slot); filled.clear(); };
    /** The layer laid over `plot`, cleared, with its context in CSS pixels and the plot's frame on it. */
    const cover = (plot: HTMLElement, drawn: StagePlot | null) => {
        const rect = plot.getBoundingClientRect();
        const ratio = document.defaultView?.devicePixelRatio || 1;
        Object.assign(layer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        layer.width = Math.round(rect.width * ratio);
        layer.height = Math.round(rect.height * ratio);
        const context = layer.getContext('2d');
        if (!context) return null;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, rect.width, rect.height);
        const frame = drawn?.frame ?? { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: Math.max(1, rect.width - STAGE_MARGINS.left - STAGE_MARGINS.right), height: Math.max(1, rect.height - STAGE_MARGINS.top - STAGE_MARGINS.bottom) };
        return { context, rect, frame };
    };
    /** The point (`x`, `y`) reads: of the plot's lines, or of those on its right-hand level axis, whichever point is nearer. */
    const readAt = (drawn: StagePlot, x: number, y: number): { on: StagePlot; read: StageRead } | null => {
        const own = stageHover(drawn, x, y);
        const second = drawn.secondary?.lines.length ? stageHover(drawn.secondary, x, y) : null;
        const away = (read: StageRead): number => Math.hypot(read.x - x, read.y - y);
        if (second && (!own || away(second) < away(own))) return { on: drawn.secondary as StagePlot, read: second };
        return own ? { on: drawn, read: own } : null;
    };
    return {
        show(plot, drawn, clientX, clientY, slot) {
            const on = cover(plot, drawn);
            if (!on) return null;
            const { context, rect, frame } = on;
            const x = clientX - rect.left, y = clientY - rect.top;
            const found = drawn ? readAt(drawn, x, y) : null;
            const hit = found?.read ?? null;
            last = found ? { plot, ...found } : null;
            // An image's cell is read at the pointer: the cursor line alone (R7).
            const line = hit && !hit.image ? hit : null;
            // With two level axes the level guide runs only to the axis the line is read on, so it is not read on the other.
            const guide = line && drawn?.secondary
                ? (found?.on === drawn ? { ...frame, width: line.x - frame.left } : { ...frame, left: line.x, width: frame.left + frame.width - line.x })
                : frame;
            paintHoverMarks(context, guide, hit ? hit.x : x, line ? line.y : null, line?.layer.color ?? '', line && found ? (ctx, width) => strokeStageLine(ctx as CanvasRenderingContext2D, found.on, line.layer, width) : undefined);
            layer.hidden = false;
            // Only this plot's row reads the pointer: another plot's readout left from before is emptied.
            for (const other of filled) if (other !== slot) hidePlotReadout(other);
            filled.clear();
            if (slot) { filled.add(slot); showPlotReadout(slot, hit?.name ?? '', hit?.values ?? '', line?.layer.color ?? ''); }
            return hit ? hit.x : null;
        },
        line(plot, drawn, clientX) {
            const on = cover(plot, drawn);
            if (!on) return;
            last = null;
            paintHoverMarks(on.context, on.frame, clientX - on.rect.left, null, '');
            layer.hidden = false;
            emptyAll();
        },
        hide() { last = null; layer.hidden = true; emptyAll(); },
        stepFrom(plot, drawn, delta) {
            if (!drawn) return null;
            const rect = plot.getBoundingClientRect();
            if (last && last.plot === plot && !layer.hidden) {
                const next = delta === 0 ? last.read : stageNeighbour(last.on, last.read, delta);
                return next ? { clientX: rect.left + next.x, clientY: rect.top + next.y } : null;
            }
            const { frame } = drawn;
            return { clientX: rect.left + frame.left, clientY: rect.top + frame.top + frame.height / 2 };
        },
        reading: () => (last && !layer.hidden ? last.read : null),
    };
}
