/**
 * The track stage mode's plots answer the shared plot gestures (plotInteraction.ts): the pointer's marks and readout,
 * the box being dragged to zoom, and an axis's range, on the lanes' surface and on the overlaid and difference plots.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotHit, type PlotWindow } from './plotInteraction';
import { axisFractionOf, axisValueAt, drawnMargins, rowFractionOf, rowValueAt, stageHover, stagePlotPoint, type StagePlot } from './stagePanes';
import { createPlotHoverLayer } from './plotHoverLayer';
import { installRangePopover, linearAxis, openAxisPart, type AxisMapping } from '../rangePopover';
import { positionPopover } from './settingsPopover';
import type { Drawn } from './trackStagePainter';
import type { TrackStageState } from './trackStageModel';

/** How near (px) a click must be to an event's line to leave it out. */
const EVENT_PICK_PX = 6;

/** The pointer over the mode's plots, while it is over one. */
export interface StageGestures {
    hovering(): boolean;
    /** Draws the hover marks again on what the plot under the still pointer now shows. */
    redraw(): void;
}

export function attachStageGestures(surface: HTMLElement, root: HTMLElement, document: Document, deps: {
    strings: UiStrings;
    state: TrackStageState;
    /** What each plot last drew, and whether the plots have drawn a picture since the last paint began. */
    drawnOn: ReadonlyMap<Element, Drawn>;
    painted: () => boolean;
    /** The zoom moved: the fine pictures are asked for anew once it settles. */
    moved: () => void;
    rerender: () => void;
    hint: (text: string) => void;
    /** The lanes sit under a trigger's events: over the recording's time, so they zoom on their own. */
    lanesApart: () => boolean;
    /** A click on a trigger's event line: left out, or put back. */
    /** Takes what the click is on at once, and returns the edit to make once no double-click follows. */
    toggleEvent?: (event: { id: number; source: string; out: boolean }) => (() => void) | undefined;
}): StageGestures {
    const { strings, state, drawnOn } = deps;
    // Each plot's zoom: the Δ pane shares the overlay's frequency axis but not its level axis, and the lanes under a
    // trigger's events are over another time than the events plot. The rest share one window.
    const zoomOf = (plot: HTMLElement): 'diff' | 'lanes' | 'shared' =>
        plot.matches('[data-stage-canvas="diff"]') ? 'diff' : plot.matches('.track-canvas') && deps.lanesApart() ? 'lanes' : 'shared';
    const windowOf = (plot: HTMLElement): PlotWindow => {
        const zoom = zoomOf(plot);
        return zoom === 'diff' ? { x: state.window.x, y: state.diffY } : zoom === 'lanes' ? state.lanesWindow : state.window;
    };
    const setWindowOf = (plot: HTMLElement, next: PlotWindow): void => {
        const zoom = zoomOf(plot);
        if (zoom === 'diff') { state.window = { ...state.window, x: next.x }; state.diffY = next.y; } else if (zoom === 'lanes') state.lanesWindow = next; else state.window = next;
        deps.moved();
        deps.rerender();
    };
    // The pointer's marks (plotHover.ts: the nearest line thicker, the cursor at its point), the box being dragged
    // and an axis's range, for any plot of the mode. The marks are drawn on a canvas laid over the plot, so a hover
    // does not draw the plot again; the readout is in the controls row above the plots, never over a plot (R7).
    const marks = createPlotHoverLayer(document, 'track-stage-cursor');
    const box = document.createElement('div');
    box.className = 'compare-zoom-box track-stage-box';
    box.hidden = true;
    document.body.append(box);
    /** Each plot's readout row, just above it: the Δ pane's own head; the lanes' row while they sit under a trigger's
     *  events plot; else the controls row over the plots. */
    const slotOf = (plot: HTMLElement): HTMLElement | null => {
        const lanesHead = root.querySelector<HTMLElement>('[data-stage-lanes-head]');
        const row = plot.closest('[data-stage-diff]')
            ?? (!root.contains(plot) && lanesHead && lanesHead.getClientRects().length ? lanesHead : root.querySelector('.track-stage-controls'));
        return row?.querySelector<HTMLElement>('[data-plot-readout]') ?? null;
    };
    const rangePopover = installRangePopover(document, { rootId: 'track-stage-range-popover', badgeId: 'track-stage-range-axis-badge', idPrefix: 'track-stage-range', strings: rangePopoverStrings(strings), position: positionPopover });
    /** What `plot` last drew (its frame: a second level axis widens its right margin), so a gesture is placed on it as drawn. */
    const drawnPlot = (plot: HTMLElement): StagePlot | null => drawnOn.get(plot)?.plot ?? null;
    /** The plot's rectangle on screen (inside the margins it was drawn with). */
    const plotBox = (plot: HTMLElement): { left: number; top: number; width: number; height: number } => {
        const rect = plot.getBoundingClientRect(), margins = drawnMargins(plot, drawnPlot(plot));
        return { left: rect.left + margins.left, top: rect.top + margins.top, width: Math.max(1, rect.width - margins.left - margins.right), height: Math.max(1, rect.height - margins.top - margins.bottom) };
    };
    /**
     * The trigger's event whose line is under the pointer (within a few pixels), if any. Read from the events' full
     * data (R7): undefined while it is fetched (`ready` is called once it is in).
     */
    const eventAt = (plot: HTMLElement, clientX: number, clientY: number, ready?: () => void, on?: StagePlot, box?: { left: number; top: number }): { id: number; source: string; out: boolean } | null | undefined => {
        const drawn = on ?? drawnOn.get(plot)?.plot;
        if (!drawn || !plot.isConnected) return null;
        const rect = box ?? plot.getBoundingClientRect();
        const hit = stageHover(drawn, clientX - rect.left, clientY - rect.top, ready);
        if (hit?.pending) return undefined;
        return hit && !hit.failed && hit.layer.event && Math.abs(hit.y - (clientY - rect.top)) <= EVENT_PICK_PX ? hit.layer.event : null;
    };
    /** On an event's line the pointer says it can be clicked; said again once the line's full data is in. */
    const hintAt = (plot: HTMLElement, clientX: number, clientY: number, late = false): void => {
        const again = (): void => { if (hovered && hovered.plot === plot && hovered.clientX === clientX && hovered.clientY === clientY) hintAt(plot, clientX, clientY, true); };
        const line = deps.toggleEvent ? eventAt(plot, clientX, clientY, again) ?? null : null;
        // Once the data is in, only a line found says so: a message written meanwhile (a key's) is not covered by the plot's hint.
        if (late && !line) return;
        plot.style.cursor = line ? 'pointer' : '';
        deps.hint(line ? (line.out ? strings.stageEventClickIn : strings.stageEventClickOut) : strings.compareHintPlot);
    };
    /** Where the pointer is over a plot, so its marks follow a plot drawn anew under a still pointer. */
    let hovered: { plot: HTMLElement; clientX: number; clientY: number } | null = null;
    const hideHover = (): void => marks.hide();
    const showHover = (): void => {
        const drawn = hovered ? drawnOn.get(hovered.plot) : undefined;
        if (!hovered || !drawn || !hovered.plot.isConnected || hovered.plot.closest('[hidden]')) { hideHover(); return; }
        marks.show(hovered.plot, drawn.plot ?? null, hovered.clientX, hovered.clientY, slotOf(hovered.plot));
    };
    // A scroll under a still pointer: the shared gestures hover again at the pointer (trackPointerEvents.ts), so the
    // plot now under it is read there (R7).
    // A click on an event's line (the plot gestures' tap: a press that stayed put, a drag zooms instead) leaves it out
    // or puts it back, once no double click (which resets the zoom) follows: plotInteraction.ts arbitrates the click.
    // It is decided on the plot as it was clicked; a click while the lines' full data is on its way is decided once it
    // is in (R7), never dropped, unless a later press anywhere (a drag, another click) takes its place first.
    const view = document.defaultView;
    const tap = (plot: HTMLElement, event: MouseEvent, current: () => boolean): (() => void) | undefined => {
        const toggle = deps.toggleEvent;
        if (!state.on || !toggle || !view) return undefined;
        const { clientX, clientY } = event;
        // Decided on the plot as it was clicked: a redraw meanwhile (a zoom by the wheel, which is no press) draws other
        // lines under that pixel, and the click is of the line it was on (R7).
        // Where the plot was on screen as clicked too: a scroll meanwhile moves it, never the line clicked on.
        const clicked = drawnPlot(plot) ?? undefined;
        const { left, top } = plot.getBoundingClientRect();
        const decide = (): void => {
            if (!current() || !state.on) return;
            const line = eventAt(plot, clientX, clientY, decide, clicked, { left, top });
            if (line === undefined) return;
            const edit = line ? toggle(line) : undefined;
            edit?.();
        };
        return decide;
    };
    const gestures = (selector: string, container: HTMLElement): void => attachPlotInteraction(container, document, selector, {
        locate(target, clientX, clientY): PlotHit | null {
            const plot = (target as HTMLElement | null)?.closest?.<HTMLElement>(selector);
            if (!state.on || !plot || !deps.painted() || plot.closest('[hidden]')) return null;
            const { fx, fy, axis } = stagePlotPoint(plot, clientX, clientY, drawnPlot(plot));
            return { plot, point: { fx, fy }, axis };
        },
        pointOn(plot, clientX, clientY) { const { fx, fy } = stagePlotPoint(plot, clientX, clientY, drawnPlot(plot)); return { fx, fy }; },
        window: windowOf,
        setWindow(plot, next) { setWindowOf(plot, next ?? FULL_PLOT_WINDOW); },
        hover(event, hit) {
            // The lanes' surface holds the overlaid plot too: a miss there is the other plot's to answer.
            if (!hit && (event.target as Element | null)?.closest?.('.track-canvas, [data-stage-canvas]')) return;
            const drawn = hit ? drawnOn.get(hit.plot) : undefined;
            if (!hit || hit.axis || !drawn) { hovered = null; hideHover(); if (hit) deps.hint(strings.compareHintAxis); return; }
            hovered = { plot: hit.plot, clientX: event.clientX, clientY: event.clientY };
            hintAt(hit.plot, event.clientX, event.clientY);
            showHover();
        },
        clearHover() { hovered = null; hideHover(); },
        tap,
        // A picture on its way (or none yet) is no drawing: the readout keeps the keys for it (R7).
        takesKeys: plot => state.on && plot.matches(selector) && !plot.closest('[hidden]'),
        stepFrom(plot, delta, arrived) {
            if (!state.on) return null;
            const drawn = drawnOn.get(plot)?.plot ?? null;
            return marks.stepFrom(plot, deps.painted() ? drawn : null, delta, arrived);
        },
        showBox(plot, from, to) {
            const rect = plotBox(plot);
            const [x0, x1] = [Math.min(from.fx, to.fx), Math.max(from.fx, to.fx)], [y0, y1] = [Math.min(from.fy, to.fy), Math.max(from.fy, to.fy)];
            Object.assign(box.style, { left: `${rect.left + x0 * rect.width}px`, top: `${rect.top + (1 - y1) * rect.height}px`, width: `${(x1 - x0) * rect.width}px`, height: `${(y1 - y0) * rect.height}px` });
            box.hidden = false;
        },
        hideBox() { box.hidden = true; },
        openAxisRange(hit, clientX, clientY) {
            const drawn = drawnOn.get(hit.plot);
            if (!drawn?.picture) return false;
            const picture = drawn.picture;
            const heat = picture.kind === 'heatmap';
            // The right-hand level axis of a plot with two answers a double-click too (R13): its own levels.
            const right = hit.axis === 'y' && !!stagePlotPoint(hit.plot, clientX, clientY, drawnPlot(hit.plot)).right && drawn.second;
            // An axis's values for a part of it (0–1), and the part for typed values: the picture's own axes.
            const mapping: AxisMapping = hit.axis === 'x'
                ? { at: f => axisValueAt(picture, f), of: v => axisFractionOf(picture, v), label: drawn.axes.x }
                : right ? linearAxis(right.range.min, right.range.max, right.title)
                : heat ? { at: f => rowValueAt(picture, f), of: v => rowFractionOf(picture, v), label: drawn.axes.y }
                    : linearAxis(drawn.range.min, drawn.range.max, drawn.axes.y);
            openAxisPart(rangePopover, {
                mapping, horizontal: hit.axis === 'x', current: hit.axis === 'x' ? windowOf(hit.plot).x : windowOf(hit.plot).y, clientX, clientY, invalid: strings.specRangeErrorMinMax,
                set(part) { const now = windowOf(hit.plot); setWindowOf(hit.plot, hit.axis === 'x' ? { ...now, x: part } : { ...now, y: part }); },
            });
            return true;
        },
    });
    gestures('.track-canvas', surface);
    gestures('[data-stage-canvas]', root);
    return {
        hovering: () => hovered !== null,
        redraw: showHover,
    };
}
