/**
 * The pointer's marks over a plot drawn by the plot component (R7, R13): the line nearest the pointer drawn thicker, a
 * dashed cursor at its point and a dashed level line in its colour, on a canvas laid over the plot (so a hover does
 * not draw the plot again), and its name, where and value in the plot's readout row just above it, never over a
 * plot. An image has no lines: the cursor alone. Every plot's hover goes through here, and so does an arrow key's
 * step to the next point (stepFrom), so a key reads a point exactly as the pointer on it would.
 *
 * Every number comes from the layers' full data, never from what they draw (R7, fullRead.ts): while the points
 * around the pointer are fetched, the marks are shown with an empty readout, filled once they are in. A step carries
 * the point it reads (the next full-resolution point, however many share a pixel), not just where it is on screen:
 * stepFrom gives the place, and the show at that place reads that very point.
 */
import { STAGE_MARGINS, stageHover, stageStep, strokeStageLine, type StagePlot, type StageRead } from './stagePanes';
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
    /** `arrived`: where a step waiting for its points is taken once they are in, for the plot's owner to hover there as on any step. */
    stepFrom(plot: HTMLElement, drawn: StagePlot | null, delta: -1 | 0 | 1, arrived?: (at: PlotPlace) => void): PlotPlace | null;
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
    /** What the last show was asked, so a read whose full data comes in later is shown again where it was. */
    let asked: { plot: HTMLElement; drawn: StagePlot | null; clientX: number; clientY: number; slot: HTMLElement | null } | null = null;
    /** The point an arrow key stepped to, which the show at its place reads (several points may share a pixel). */
    let stepped: { plot: HTMLElement; clientX: number; clientY: number; found: { on: StagePlot; read: StageRead } } | null = null;
    /** A step waiting for its points: taken once they are in, unless the pointer moved on. */
    let stepping = 0;
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
    /**
     * The point (`x`, `y`) reads: of the plot's lines, or of those on its right-hand level axis, whichever is nearer as
     * one plot's lines are ordered (stageHover's `away`): a point within the pick radius before any line read only at
     * the pointer's column, whose point a level zoom may hold at the plot's edge.
     */
    const readAt = (drawn: StagePlot, x: number, y: number, ready: () => void): { on: StagePlot; read: StageRead } | null => {
        const own = stageHover(drawn, x, y, ready);
        const second = drawn.secondary?.lines.length ? stageHover(drawn.secondary, x, y, ready) : null;
        // Either part still waiting for its full data: no number yet, on either axis.
        if (own?.pending) return { on: drawn, read: own };
        if (second?.pending) return { on: drawn.secondary as StagePlot, read: second };
        const away = (read: StageRead): number => read.away ?? Math.hypot(read.x - x, read.y - y);
        if (second && (!own || away(second) < away(own))) return { on: drawn.secondary as StagePlot, read: second };
        return own ? { on: drawn, read: own } : null;
    };
    const note = notePlotRead;
    const layerApi: PlotHoverLayer = {
        show(plot, drawn, clientX, clientY, slot) {
            const on = cover(plot, drawn);
            if (!on) return null;
            const { context, rect, frame } = on;
            const x = clientX - rect.left, y = clientY - rect.top;
            const now = { plot, drawn, clientX, clientY, slot };
            asked = now;
            // The full data around the pointer came in: read again, if the pointer is still where it was.
            const again = (): void => { if (asked === now && !layer.hidden) layerApi.show(plot, drawn, clientX, clientY, slot); };
            const step = stepped && stepped.plot === plot && stepped.clientX === clientX && stepped.clientY === clientY ? stepped.found : null;
            stepped = null;
            const found = step ?? (drawn ? readAt(drawn, x, y, again) : null);
            const hit = found?.read ?? null;
            last = found ? { plot, ...found } : null;
            note(plot, hit);
            if (hit?.pending) {
                // No number until the full data is in (R7): the cursor at the pointer, the readout's row kept empty.
                paintHoverMarks(context, frame, x, null, '');
                layer.hidden = false;
                for (const other of filled) if (other !== slot) hidePlotReadout(other);
                filled.clear();
                if (slot) { filled.add(slot); showPlotReadout(slot, '', '', ''); }
                return null;
            }
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
            asked = null;
            paintHoverMarks(on.context, on.frame, clientX - on.rect.left, null, '');
            layer.hidden = false;
            emptyAll();
        },
        hide() { last = null; asked = null; stepping++; layer.hidden = true; emptyAll(); },
        stepFrom(plot, drawn, delta, arrived) {
            if (!drawn) return null;
            const rect = plot.getBoundingClientRect();
            if (last && last.plot === plot && !layer.hidden) {
                const from = last;
                const place = (read: StageRead): { clientX: number; clientY: number } => ({ clientX: rect.left + read.x, clientY: rect.top + read.y });
                // The point itself goes with its place: the show there reads it, not whichever point shares its pixel.
                const carry = (read: StageRead): { clientX: number; clientY: number } => {
                    const at = place(read);
                    stepped = { plot, ...at, found: { on: from.on, read } };
                    return at;
                };
                if (delta === 0 || from.read.pending) return carry(from.read);
                const token = ++stepping;
                // The next points were not in: the step is taken once they are, where the read was shown.
                const ready = (): void => {
                    // Still on the point stepped from (a redraw there makes a new read of the same point; a move or a hide does not).
                    const still = last && last.plot === plot && last.read.layer === from.read.layer && last.read.at === from.read.at && last.read.row === from.read.row && last.read.index === from.read.index;
                    if (token !== stepping || !still || layer.hidden) return;
                    const next = stageStep(from.on, from.read, delta, ready);
                    const shown = asked;
                    if (!next || !shown) return;
                    const at = carry(next);
                    // Through the owner's hover, as any step is, so its kept place is this one and a redraw keeps it.
                    if (arrived) arrived(at);
                    else layerApi.show(plot, shown.drawn, at.clientX, at.clientY, shown.slot);
                };
                const next = stageStep(from.on, from.read, delta, ready);
                if (next === undefined) return carry(from.read);
                return next ? carry(next) : null;
            }
            const { frame } = drawn;
            return { clientX: rect.left + frame.left, clientY: rect.top + frame.top + frame.height / 2 };
        },
        reading: () => (last && !layer.hidden && !last.read.pending ? last.read : null),
    };
    return layerApi;
}

/**
 * A plot element with the point it reads kept on it (`__plotRead`): its layer and so the full data it is read from
 * (StageLayer.full, or the layer's own points), for the test of every plot that one arrow key moves the readout
 * exactly one full-resolution point (plotContract.spec.ts).
 */
export type PlotReadNoted = HTMLElement & { __plotRead?: StageRead | null };

/** Writes on a plot what it reads (R7), for the tests of every plot: where the number is from and the point read. */
export function notePlotRead(plot: HTMLElement, read: StageRead | null): void {
    if (!plot.dataset) return;
    (plot as PlotReadNoted).__plotRead = read && !read.pending ? read : null;
    plot.dataset.plotRead = !read ? '' : read.pending ? 'pending' : read.full ? 'full' : 'drawn';
    plot.dataset.plotReadAt = read?.full && read.at !== undefined ? String(read.at) : '';
    plot.dataset.plotReadRow = read?.full && read.row !== undefined ? String(read.row) : '';
    plot.dataset.plotReadValue = read?.full && read.value !== undefined ? String(read.value) : '';
}
