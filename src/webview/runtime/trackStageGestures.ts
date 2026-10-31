/**
 * The track stage mode's plots answer the shared plot gestures (plotInteraction.ts): the pointer's marks and readout,
 * the box being dragged to zoom, and an axis's range, on the lanes' surface and on the overlaid and difference plots.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotHit } from './plotInteraction';
import { axisFractionOf, axisValueAt, rowFractionOf, rowValueAt, STAGE_MARGINS, stageHover, stagePlotPoint, stageReadout, strokeStageLine } from './stagePanes';
import { paintHoverMarks } from './plotHover';
import { installRangePopover, linearAxis, openAxisPart, type AxisMapping } from '../rangePopover';
import { positionPopover } from './settingsPopover';
import type { Drawn } from './trackStagePainter';
import type { TrackStageState } from './trackStageModel';

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
}): StageGestures {
    const { strings, state, drawnOn } = deps;
    // The pointer's marks (plotHover.ts: the nearest line thicker, the cursor at its point), its readout, the
    // box being dragged and an axis's range, for any plot of the mode. The marks are drawn on a canvas laid
    // over the plot, so a hover does not draw the plot again.
    const cursor = document.createElement('canvas');
    cursor.className = 'track-stage-cursor';
    const readout = document.createElement('div');
    readout.className = 'compare-readout track-stage-readout';
    const box = document.createElement('div');
    box.className = 'compare-zoom-box track-stage-box';
    for (const element of [cursor, readout, box]) { element.hidden = true; document.body.append(element); }
    const rangePopover = installRangePopover(document, { rootId: 'track-stage-range-popover', badgeId: 'track-stage-range-axis-badge', idPrefix: 'track-stage-range', strings: rangePopoverStrings(strings), position: positionPopover });
    /** The plot's rectangle on screen (inside its canvas's axis margins). */
    const plotBox = (plot: HTMLElement): { left: number; top: number; width: number; height: number } => {
        const rect = plot.getBoundingClientRect();
        return { left: rect.left + STAGE_MARGINS.left, top: rect.top + STAGE_MARGINS.top, width: Math.max(1, rect.width - STAGE_MARGINS.left - STAGE_MARGINS.right), height: Math.max(1, rect.height - STAGE_MARGINS.top - STAGE_MARGINS.bottom) };
    };
    const across = (fx: number): number => state.window.x.start + fx * (state.window.x.end - state.window.x.start);
    /** Where the pointer is over a plot, so its marks follow a plot drawn anew under a still pointer. */
    let hovered: { plot: HTMLElement; clientX: number; clientY: number; fx: number } | null = null;
    const hideHover = (): void => { cursor.hidden = true; readout.hidden = true; };
    /**
     * The hover as the spectrum overlay under the tracks draws it: the line nearest the pointer thicker, a dashed
     * cursor at its point and a dashed level line in its colour, its name, where and its value in the readout.
     * An image has no lines: the cursor alone. A signal drawn as itself keeps its levels' readout (base, compare, Δ).
     */
    const showHover = (): void => {
        const drawn = hovered ? drawnOn.get(hovered.plot) : undefined;
        if (!hovered || !drawn || !hovered.plot.isConnected || hovered.plot.closest('[hidden]')) { hideHover(); return; }
        const rect = hovered.plot.getBoundingClientRect();
        const ratio = document.defaultView?.devicePixelRatio || 1;
        Object.assign(cursor.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        cursor.width = Math.round(rect.width * ratio);
        cursor.height = Math.round(rect.height * ratio);
        const context = cursor.getContext('2d');
        if (!context) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, rect.width, rect.height);
        const x = hovered.clientX - rect.left, y = hovered.clientY - rect.top;
        const plot = drawn.plot;
        const hit = plot ? stageHover(plot, x, y) : null;
        const frame = plot?.frame ?? { left: STAGE_MARGINS.left, top: STAGE_MARGINS.top, width: plotBox(hovered.plot).width, height: plotBox(hovered.plot).height };
        paintHoverMarks(context, frame, hit ? hit.x : x, hit ? hit.y : null, hit?.layer.color ?? '', hit && plot ? (ctx, width) => strokeStageLine(ctx as CanvasRenderingContext2D, plot, hit.layer, width) : undefined);
        cursor.hidden = false;
        const text = hit ? hit.text : drawn.picture?.waveform ? stageReadout(drawn.views, across(hovered.fx)) : '';
        readout.textContent = text;
        readout.style.color = hit?.layer.color ?? '';
        readout.hidden = !text;
        // Beside the pointer, on its left where the right of the plot has no room for it.
        // Kept in the window: a plot scrolled partly out of view still shows it.
        const right = hovered.clientX + 12 + readout.offsetWidth > rect.right;
        Object.assign(readout.style, { left: `${Math.max(0, right ? hovered.clientX - 12 - readout.offsetWidth : hovered.clientX + 12)}px`, top: `${Math.max(4, rect.top + frame.top + 4)}px` });
    };
    // The marks sit where the plot was on screen: a scroll under a still pointer takes them away.
    document.addEventListener('scroll', () => { if (hovered) { hovered = null; hideHover(); } }, true);
    const gestures = (selector: string, container: HTMLElement): void => attachPlotInteraction(container, document, selector, {
        locate(target, clientX, clientY): PlotHit | null {
            const plot = (target as HTMLElement | null)?.closest?.<HTMLElement>(selector);
            if (!state.on || !plot || !deps.painted() || plot.closest('[hidden]')) return null;
            const { fx, fy, axis } = stagePlotPoint(plot, clientX, clientY);
            return { plot, point: { fx, fy }, axis };
        },
        pointOn(plot, clientX, clientY) { const { fx, fy } = stagePlotPoint(plot, clientX, clientY); return { fx, fy }; },
        window: () => state.window,
        setWindow(_plot, next) { state.window = next ?? FULL_PLOT_WINDOW; deps.moved(); deps.rerender(); },
        hover(event, hit) {
            // The lanes' surface holds the overlaid plot too: a miss there is the other plot's to answer.
            if (!hit && (event.target as Element | null)?.closest?.('.track-canvas, [data-stage-canvas]')) return;
            const drawn = hit ? drawnOn.get(hit.plot) : undefined;
            if (!hit || hit.axis || !drawn) { hovered = null; hideHover(); if (hit) deps.hint(strings.compareHintAxis); return; }
            deps.hint(strings.compareHintPlot);
            hovered = { plot: hit.plot, clientX: event.clientX, clientY: event.clientY, fx: hit.point.fx };
            showHover();
        },
        clearHover() { hovered = null; hideHover(); },
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
            // An axis's values for a part of it (0–1), and the part for typed values: the picture's own axes.
            const mapping: AxisMapping = hit.axis === 'x'
                ? { at: f => axisValueAt(picture, f), of: v => axisFractionOf(picture, v), label: drawn.axes.x }
                : heat ? { at: f => rowValueAt(picture, f), of: v => rowFractionOf(picture, v), label: drawn.axes.y }
                    : linearAxis(drawn.range.min, drawn.range.max, drawn.axes.y);
            openAxisPart(rangePopover, {
                mapping, horizontal: hit.axis === 'x', current: hit.axis === 'x' ? state.window.x : state.window.y, clientX, clientY, invalid: strings.specRangeErrorMinMax,
                set(part) { state.window = hit.axis === 'x' ? { ...state.window, x: part } : { ...state.window, y: part }; deps.moved(); deps.rerender(); },
            });
            return true;
        },
    });
    gestures('.track-canvas', surface);
    gestures('[data-stage-canvas]', root);
    return { hovering: () => hovered !== null, redraw: showHover };
}
