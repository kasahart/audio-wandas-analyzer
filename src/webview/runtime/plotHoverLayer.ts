/**
 * The pointer's marks over a plot drawn by the plot component (R7, R13): the line nearest the pointer drawn thicker, a
 * dashed cursor at its point and a dashed level line in its colour, on a canvas laid over the plot (so a hover does
 * not draw the plot again), and its name, where and value in the plot's readout row just above it, never over a
 * plot. An image has no lines: the cursor alone. Every plot's hover goes through here.
 */
import { STAGE_MARGINS, stageHover, strokeStageLine, type StagePlot } from './stagePanes';
import { hidePlotReadout, paintHoverMarks, showPlotReadout } from './plotHover';

export interface PlotHoverLayer {
    /** The marks over `plot` for the pointer at (clientX, clientY), and its readout in `slot`; returns where the
     *  point read is across the plot (CSS pixels from its left), or null when none is read. */
    show(plot: HTMLElement, drawn: StagePlot | null, clientX: number, clientY: number, slot: HTMLElement | null): number | null;
    /** Only the cursor line at `clientX` over `plot`: a plot linked to the one under the pointer follows it (R8). */
    line(plot: HTMLElement, drawn: StagePlot | null, clientX: number): void;
    /** No marks, and every readout this layer filled emptied. */
    hide(): void;
}

/** `parent`: where the layer goes. A plot inside a screen laid over the page (a stacking context of its own) puts its
 *  layer in that screen, so the marks are drawn above the screen and not under it. */
export function createPlotHoverLayer(document: Document, className = '', parent: HTMLElement = document.body): PlotHoverLayer {
    const layer = document.createElement('canvas');
    layer.className = `plot-hover-layer ${className}`.trim();
    layer.hidden = true;
    parent.append(layer);
    const filled = new Set<HTMLElement>();
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
    return {
        show(plot, drawn, clientX, clientY, slot) {
            const on = cover(plot, drawn);
            if (!on) return null;
            const { context, rect, frame } = on;
            const x = clientX - rect.left, y = clientY - rect.top;
            const hit = drawn ? stageHover(drawn, x, y) : null;
            // An image's cell is read at the pointer: the cursor line alone (R7).
            const line = hit && !hit.image ? hit : null;
            paintHoverMarks(context, frame, hit ? hit.x : x, line ? line.y : null, line?.layer.color ?? '', line && drawn ? (ctx, width) => strokeStageLine(ctx as CanvasRenderingContext2D, drawn, line.layer, width) : undefined);
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
            paintHoverMarks(on.context, on.frame, clientX - on.rect.left, null, '');
            layer.hidden = false;
            emptyAll();
        },
        hide() { layer.hidden = true; emptyAll(); },
    };
}
