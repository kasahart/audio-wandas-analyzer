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
import { STAGE_MARGINS, floorless, stageHover, stageReadAgain, stageStep, strokeStageLine, type StagePlot, type StageRead } from './stagePanes';
import { hidePlotReadout, paintHoverMarks, showPlotReadout } from './plotHover';

/** A place on screen (client pixels) for the pointer, or an arrow key's step, to read. */
export interface PlotPlace {
    clientX: number;
    clientY: number;
}

/**
 * How a plot's owner words its readout, where it is not the line's own name and values (a track lane's time on the
 * lanes' axis, the distribution's place on its value axis), and what it does with each point read (a lane's time line
 * on the other lanes). Kept with the show, so a read whose full data comes in later is worded the same.
 */
export interface PlotReadoutWords {
    /** The readout of a point read; null: none. */
    of?(read: StageRead): { name: string; values: string; color?: string } | null;
    /** The readout with no point read at (x, y), CSS pixels on the plot (default: an empty row). */
    none?(x: number, y: number): { name: string; values: string } | null;
    /** Told the point read on every show (null: none, or still waiting for its full data), its full data's arrival too. */
    read?(read: StageRead | null): void;
}

export interface PlotHoverLayer {
    /** The marks over `plot` for the pointer at (clientX, clientY), and its readout in `slot`; returns where the
     *  point read is across the plot (CSS pixels from its left), or null when none is read. */
    show(plot: HTMLElement, drawn: StagePlot | null, clientX: number, clientY: number, slot: HTMLElement | null, words?: PlotReadoutWords): number | null;
    /** Only the cursor line at `clientX` over `plot`: a plot linked to the one under the pointer follows it (R8). */
    line(plot: HTMLElement, drawn: StagePlot | null, clientX: number): void;
    /** No marks, and every readout this layer filled emptied. */
    hide(): void;
    /**
     * Where an arrow key reads on `plot` (R7): the point `delta` points along from the one last shown there (0: that
     * point again), or, with nothing shown on the plot, its left edge halfway up. Null when it cannot step: nothing
     * read under the pointer, the data's end, or the edge of the window on screen. A key pressed while the read waits
     * for its full data (or its read failed) is taken once the points are in: `arrived` is told where (as is a step
     * whose next points were not in), for the plot's owner to hover there as on any step; keys pressed meanwhile add up.
     */
    stepFrom(plot: HTMLElement, drawn: StagePlot | null, delta: -1 | 0 | 1, arrived?: (at: PlotPlace) => void): PlotPlace | null;
    /** The point last shown, while the marks are on it. */
    reading(): StageRead | null;
}

/**
 * Whether two reads are of one point (its line and its identity, else its place, row and index), whichever drawing they were read on: a plot
 * drawn anew makes its layers anew (a lane on every frame), so a line is known by its full data, else its name and
 * colour, as stageReadAgain finds it.
 */
const sameLine = (a: StageRead['layer'], b: StageRead['layer']): boolean => a === b || a.full === b.full || (a.label === b.label && a.color === b.color && a.view.kind === b.view.kind);
/**
 * Whether two plot elements are one plot: the same element, or one drawn anew in place of the other (a pane that makes
 * its canvases anew on every repaint, the distribution's rows) that names it by the same `data-plot-key`.
 */
export const samePlot = (a: HTMLElement | null | undefined, b: HTMLElement | null | undefined): boolean =>
    !!a && !!b && (a === b || (!!a.dataset?.plotKey && a.dataset.plotKey === b.dataset?.plotKey && (!a.isConnected || !b.isConnected)));
// A point that is a thing (StageLayer.identity: a recording) is the same point when it is the same thing, wherever a
// redraw put it; any other by its place (and, of a line drawn whole, its index there).
const samePoint = (a: StageRead, b: StageRead): boolean => sameLine(a.layer, b.layer)
    && (a.identity !== undefined || b.identity !== undefined ? a.identity === b.identity : a.at === b.at && a.row === b.row && a.index === b.index);

/** A read with no number yet: its full data on the way, or its read failed (asked again after a pause). */
const waits = (read: StageRead | null | undefined): boolean => !!read && (!!read.pending || !!read.failed);

/** `parent`: where the layer goes. A plot inside a screen laid over the page (a stacking context of its own) puts its
 *  layer in that screen, so the marks are drawn above the screen and not under it. */
export function createPlotHoverLayer(document: Document, className = '', parent: HTMLElement = document.body): PlotHoverLayer {
    const layer = document.createElement('canvas');
    layer.className = `plot-hover-layer ${className}`.trim();
    layer.hidden = true;
    parent.append(layer);
    const filled = new Set<HTMLElement>();
    /** The point the marks are on: the plot's element, the part of the plot it is read on (its own, or its right-hand axis') and the read. */
    let last: { plot: HTMLElement; drawn: StagePlot | null; on: StagePlot; read: StageRead } | null = null;
    /** What the last show was asked, so a read whose full data comes in later is shown again where it was. */
    let asked: { plot: HTMLElement; drawn: StagePlot | null; clientX: number; clientY: number; slot: HTMLElement | null; words?: PlotReadoutWords } | null = null;
    /**
     * The point an arrow key stepped to (several points may share a pixel), apart from the pointer: `pointer` is where
     * the pointer really is (null: a plot given the focus, read at the step's place), `place` where the point is drawn,
     * `drawnOn` the drawing it was read on and `left` / `top` where the plot was on screen. A show at the pointer reads
     * that point, read again on every drawing anew; once it is let go, the pointer's place is read, never the step's.
     */
    let stepped: { plot: HTMLElement; pointer: PlotPlace | null; place: PlotPlace; left: number; top: number; drawnOn: StagePlot | null; found: { on: StagePlot; read: StageRead } } | null = null;
    /** Keys pressed while the read at the pointer waited for its points: taken once they are in, unless the pointer moved. */
    let queued: { plot: HTMLElement; clientX: number; clientY: number; delta: number; arrived?: (at: PlotPlace) => void } | null = null;
    /** A step waiting for its points: taken once they are in, unless the pointer moved on. */
    let stepping = 0;
    /** A step waiting for its next points: from which point, and how many points still to take (keys pressed meanwhile add up). */
    let waitingTake: { token: number; plot: HTMLElement; at: StageRead; left: number } | null = null;
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
        // Either part still waiting for its full data (or failed): no number yet, on either axis.
        if (waits(own)) return { on: drawn, read: own as StageRead };
        if (waits(second)) return { on: drawn.secondary as StagePlot, read: second as StageRead };
        const away = (read: StageRead): number => read.away ?? Math.hypot(read.x - x, read.y - y);
        if (second && (!own || away(second) < away(own))) return { on: drawn.secondary as StagePlot, read: second };
        return own ? { on: drawn, read: own } : null;
    };
    /**
     * The point a step went to, on the plot as drawn now: the same plot, or that point read again on its new drawing
     * (a zoom, a pan, a resize, a scroll of the view). Null where the new drawing no longer shows it (off the window):
     * the pointer's place is read instead, never a point off the plot.
     */
    const rebased = (at: { drawnOn: StagePlot | null; found: { on: StagePlot; read: StageRead } }, drawn: StagePlot | null, ready: () => void): { on: StagePlot; read: StageRead } | null => {
        // Drawn anew with nothing to read on it (a step computing, a lane with no picture): the point is kept and
        // reads nothing until a drawing with its data is in (R7), never its old value or line.
        if (!drawn) return { on: at.found.on, read: { ...at.found.read, pending: true } };
        if (at.drawnOn === drawn) return at.found;
        const onRight = at.drawnOn?.secondary === at.found.on;
        const on = onRight ? drawn.secondary : drawn;
        const read = on ? stageReadAgain(on, at.found.read, ready) : null;
        // Its points on the new drawing on their way, or their read failed: the step is kept, still of the old drawing
        // (no step is taken from it meanwhile), and read once they are in (no number meanwhile, R7).
        if (on && read === undefined) return { on, read: { ...at.found.read, pending: true } };
        if (on && read?.failed) return { on, read };
        if (!on || !read) return null;
        at.drawnOn = drawn;
        at.found = { on, read };
        return at.found;
    };
    /** The place on screen of a point read on `plot`, kept with the point so the show there reads that very point. */
    const carry = (plot: HTMLElement, drawn: StagePlot | null, on: StagePlot, read: StageRead): PlotPlace => {
        const rect = plot.getBoundingClientRect();
        const place = { clientX: rect.left + read.x, clientY: rect.top + read.y };
        // The pointer stays where it was: the one the last step kept, or the place last shown.
        const pointer = stepped && samePlot(stepped.plot, plot) ? stepped.pointer : asked && samePlot(asked.plot, plot) ? { clientX: asked.clientX, clientY: asked.clientY } : null;
        stepped = { plot, pointer, place, left: rect.left, top: rect.top, drawnOn: drawn, found: { on, read } };
        return place;
    };
    /** Where the step on `plot` is shown: at the pointer, or at the step's place with no pointer on the plot. */
    const atStep = (clientX: number, clientY: number): boolean => !!stepped && (
        (stepped.pointer !== null && stepped.pointer.clientX === clientX && stepped.pointer.clientY === clientY)
        || (stepped.place.clientX === clientX && stepped.place.clientY === clientY));
    /** A step's place shown: through the owner's hover, as any step is, so its kept place is this one and a redraw keeps it. */
    const deliver = (plot: HTMLElement, at: PlotPlace, arrived?: (at: PlotPlace) => void): void => {
        const shown = asked;
        if (arrived) arrived(at);
        else if (shown && samePlot(shown.plot, plot)) layerApi.show(plot, shown.drawn, shown.clientX, shown.clientY, shown.slot, shown.words);
    };
    /** Shown again as last asked (the pointer still): a read come in, or a step let go. */
    const showAgain = (): void => {
        const shown = asked;
        if (shown && !layer.hidden) layerApi.show(shown.plot, shown.drawn, shown.clientX, shown.clientY, shown.slot, shown.words);
    };
    // A scroll that moves the plot from under a still pointer lets the step go: the place now under the pointer is read
    // (R7). A resize or a redraw keeps it (no scroll): the point stepped to is read on.
    document.addEventListener('scroll', () => {
        const step = stepped;
        if (!step) return;
        const rect = step.plot.getBoundingClientRect();
        if (rect.left === step.left && rect.top === step.top) return;
        stepped = null;
        queued = null;
        waitingTake = null;
        stepping++;
        showAgain();
    }, true);
    /**
     * `delta` steps (its sign the way, its size how many) from `from` on `plot`, one full-resolution point each (R7):
     * the place of the point reached, null when not one could be taken (the data's end, the edge of the window). Where
     * the next points are not in, the steps taken so far are shown, and the rest are taken once they are, if the
     * marks are still on the point reached.
     */
    const take = (plot: HTMLElement, drawn: StagePlot | null, from: { on: StagePlot; read: StageRead }, delta: number, arrived?: (at: PlotPlace) => void): PlotPlace | null => {
        // `drawn`: the drawing `from` was read on, so the point reached is kept with it and read again on the next.
        const sign: -1 | 1 = delta < 0 ? -1 : 1;
        const token = ++stepping;
        waitingTake = null;
        let read = from.read, left = Math.abs(delta), waiting = false;
        // The next points in: the steps still to take (those keys pressed meanwhile added too), from the point reached,
        // if the marks are still on it.
        const ready = (): void => {
            const wait = waitingTake, now = last;
            if (!wait || wait.token !== token || token !== stepping || !now || !samePlot(now.plot, plot) || !samePoint(now.read, wait.at) || layer.hidden) return;
            waitingTake = null;
            if (!wait.left) return;
            const place = take(now.plot, now.drawn, { on: now.on, read: now.read }, wait.left, arrived);
            if (place) deliver(now.plot, place, arrived);
        };
        while (left > 0) {
            const next = stageStep(from.on, read, sign, ready);
            if (next === undefined) { waiting = true; break; }
            if (next === null) break;
            read = next;
            left -= 1;
        }
        if (waiting) waitingTake = { token, plot, at: read, left: sign * left };
        if (read !== from.read) return carry(plot, drawn, from.on, read);
        // Waiting for the next points: the point stays read where it is until they are in.
        return waiting ? carry(plot, drawn, from.on, from.read) : null;
    };
    const note = notePlotRead;
    /** The plot this layer last noted a read on. */
    let noted: HTMLElement | null = null;
    const layerApi: PlotHoverLayer = {
        show(plot, drawn, clientX, clientY, slot, words) {
            const on = cover(plot, drawn);
            if (!on) return null;
            const { context, rect, frame } = on;
            const x = clientX - rect.left, y = clientY - rect.top;
            const now = { plot, drawn, clientX, clientY, slot, ...(words ? { words } : {}) };
            asked = now;
            // The full data around the pointer came in: read again, if the pointer is still where it was.
            const again = (): void => { if (asked === now && !layer.hidden) layerApi.show(plot, drawn, clientX, clientY, slot, words); };
            // A step carries its point; the point stepped to stays read at its place until the pointer moves: a redraw
            // there reads that very point on the plot drawn anew (stageReadAgain), never the neighbour the pointer
            // would pick at a value held at the edge (A46), and one the new drawing does not show is let go.
            const kept = stepped && samePlot(stepped.plot, plot) && atStep(clientX, clientY) ? stepped : null;
            // Only a scroll lets it go (the listener above); a resize that moves the plot keeps it, where it is now (R7).
            const here = kept;
            if (!here) stepped = null;
            else { here.plot = plot; here.left = rect.left; here.top = rect.top; }
            if (queued && (!samePlot(queued.plot, plot) || queued.clientX !== clientX || queued.clientY !== clientY)) queued = null;
            const step = here ? rebased(here, drawn, again) : null;
            if (here && !step) stepped = null;
            // A step the new drawing no longer shows is let go: the true pointer's place is read, never the step's.
            const gone = kept && !step ? kept.pointer : null;
            const looks = gone ? { x: gone.clientX - rect.left, y: gone.clientY - rect.top } : { x, y };
            const found = step ?? (drawn ? readAt(drawn, looks.x, looks.y, again) : null);
            const hit = found?.read ?? null;
            // The plot read before, another one: it reads nothing now (its noted point would be another plot's).
            if (noted && noted !== plot) note(noted, null);
            noted = plot;
            last = found ? { plot, drawn, ...found } : null;
            note(plot, hit, drawn);
            for (const other of filled) if (other !== slot) hidePlotReadout(other);
            filled.clear();
            if (waits(hit)) {
                // No number until the full data is in (R7): the cursor at the pointer, the readout's row kept empty.
                paintHoverMarks(context, frame, looks.x, null, '');
                layer.hidden = false;
                if (slot) { filled.add(slot); showPlotReadout(slot, '', '', ''); }
                words?.read?.(null);
                return null;
            }
            // An image's cell is read at the pointer: the cursor line alone (R7).
            const line = hit && !hit.image ? hit : null;
            // With two level axes the level guide runs only to the axis the line is read on, so it is not read on the other.
            const guide = line && drawn?.secondary
                ? (found?.on === drawn ? { ...frame, width: line.x - frame.left } : { ...frame, left: line.x, width: frame.left + frame.width - line.x })
                : frame;
            paintHoverMarks(context, guide, hit ? hit.x : looks.x, line ? line.y : null, line?.layer.color ?? '', line && found ? (ctx, width) => strokeStageLine(ctx as CanvasRenderingContext2D, found.on, line.layer, width) : undefined);
            layer.hidden = false;
            // Only this plot's row reads the pointer: another plot's readout left from before is emptied.
            if (slot) {
                filled.add(slot);
                const text: { name: string; values: string; color?: string } | null = hit ? (words?.of ? words.of(hit) : { name: hit.name, values: hit.values, color: line?.layer.color ?? '' }) : words?.none?.(looks.x, looks.y) ?? null;
                showPlotReadout(slot, text?.name ?? '', text?.values ?? '', text?.color ?? '');
            }
            words?.read?.(hit);
            // Keys pressed while this read waited: taken now its points are in (A42, R7), from the point read here.
            const keys = queued;
            if (keys && found && hit) {
                queued = null;
                const at = take(plot, step ? here?.drawnOn ?? drawn : drawn, found, keys.delta, keys.arrived);
                if (at) deliver(plot, at, keys.arrived);
            }
            return hit ? hit.x : null;
        },
        line(plot, drawn, clientX) {
            const on = cover(plot, drawn);
            if (!on) return;
            last = null;
            asked = null;
            queued = null;
            paintHoverMarks(on.context, on.frame, clientX - on.rect.left, null, '');
            layer.hidden = false;
            emptyAll();
        },
        hide() {
            last = null; asked = null; stepped = null; queued = null; waitingTake = null; stepping++; layer.hidden = true; emptyAll();
            // Nothing read: the plot read before says so too.
            if (noted) note(noted, null);
            noted = null;
        },
        stepFrom(plot, drawn, delta, arrived) {
            const shown = !layer.hidden;
            const shownHere = shown && samePlot(asked?.plot, plot);
            /** The key waits with the read: taken once its points are in (A42), keys pressed meanwhile adding up. */
            const queue = (read: StageRead): PlotPlace => {
                const place = asked ? { clientX: asked.clientX, clientY: asked.clientY } : { clientX: plot.getBoundingClientRect().left + read.x, clientY: plot.getBoundingClientRect().top + read.y };
                queued = queued && samePlot(queued.plot, plot) && queued.clientX === place.clientX && queued.clientY === place.clientY
                    ? { ...queued, delta: queued.delta + delta, ...(arrived ? { arrived } : {}) }
                    : { plot, ...place, delta, ...(arrived ? { arrived } : {}) };
                return place;
            };
            // The read shown waits for its points (on the plot drawn anew too, or an empty drawing), or failed: never a
            // step from the drawing before it (R7).
            const lastHere = shown && last && samePlot(last.plot, plot) ? last : null;
            if (lastHere && waits(lastHere.read)) return queue(lastHere.read);
            // No drawing yet (a picture on its way): the key waits with the point read, taken once one is drawn (R7).
            if (!drawn) {
                const held = shown && stepped && samePlot(stepped.plot, plot) ? stepped.found.read : lastHere?.read;
                return held ? queue(held) : null;
            }
            // The point to step from, on the drawing the owner has now: a step carried but not yet shown (an owner that
            // shows on its next frame, the lanes), else the point shown; read again first where it was read on another.
            const base = shown && stepped && samePlot(stepped.plot, plot) ? stepped : lastHere ? { drawnOn: lastHere.drawn, found: { on: lastHere.on, read: lastHere.read } } : null;
            let from: { on: StagePlot; read: StageRead } | null = base ? base.found : null;
            if (base && base.drawnOn !== drawn) {
                const again = rebased(base, drawn, showAgain);
                if (again && waits(again.read)) return queue(again.read);
                if (!again && base === stepped) stepped = null;
                from = again;
            }
            if (from) {
                if (delta === 0) return carry(plot, drawn, from.on, from.read);
                // A step already waiting for its next points from this point: this key adds to it (R7: as many points as keys).
                const wait = waitingTake;
                if (wait && wait.token === stepping && samePlot(wait.plot, plot) && samePoint(wait.at, from.read)) {
                    wait.left += delta;
                    return carry(plot, drawn, from.on, from.read);
                }
                return take(plot, drawn, from, delta, arrived);
            }
            // Under the pointer with nothing read there (past the data's end, a gap): nothing to step from.
            if (shownHere) return null;
            const { frame } = drawn;
            const rect = plot.getBoundingClientRect();
            return { clientX: rect.left + frame.left, clientY: rect.top + frame.top + frame.height / 2 };
        },
        reading: () => (last && !layer.hidden && !waits(last.read) ? last.read : null),
    };
    return layerApi;
}

/**
 * A plot element with the point it reads kept on it (`__plotRead`): its layer and so the full data it is read from
 * (StageLayer.full, or the layer's own points), for the test of every plot that one arrow key moves the readout
 * exactly one full-resolution point (plotContract.spec.ts).
 */
export type PlotReadNoted = HTMLElement & { __plotRead?: StageRead | null };

/**
 * Writes on a plot what it reads (R7), for the tests of every plot: where the number is from and the point read.
 * `drawn` is the drawing it was read on: with it, `data-plot-read-floorless` says whether the line read has no silent
 * floor (stagePanes' `floorless`: a Δ, a plain value), which is the rule ← / → seek by, so the browser's contract test
 * (plotContract.spec.ts nextPoint) expects the next point by the very rule the keys follow.
 */
export function notePlotRead(plot: HTMLElement, read: StageRead | null, drawn?: Pick<StagePlot, 'diff'> | null): void {
    if (!plot.dataset) return;
    (plot as PlotReadNoted).__plotRead = read && !read.pending && !read.failed ? read : null;
    plot.dataset.plotRead = !read ? '' : read.pending ? 'pending' : read.failed ? 'failed' : read.full ? 'full' : 'drawn';
    plot.dataset.plotReadAt = read?.full && read.at !== undefined ? String(read.at) : '';
    plot.dataset.plotReadRow = read?.full && read.row !== undefined ? String(read.row) : '';
    plot.dataset.plotReadValue = read?.full && read.value !== undefined ? String(read.value) : '';
    plot.dataset.plotReadFloorless = read && !read.pending && !read.failed && !read.image ? String(floorless(read.layer.view, !!drawn?.diff)) : '';
}
