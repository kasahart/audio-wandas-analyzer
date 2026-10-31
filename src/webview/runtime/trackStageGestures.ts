/**
 * The track stage mode's plots answer the shared plot gestures (plotInteraction.ts): the cursor line and readout,
 * the box being dragged to zoom, and an axis's range, on the lanes' surface and on the overlaid and difference plots.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotHit } from './plotInteraction';
import { axisFractionOf, axisValueAt, rowFractionOf, rowValueAt, STAGE_MARGINS, stagePlotPoint, stageReadout } from './stagePanes';
import { installRangePopover, linearAxis, openAxisPart, type AxisMapping } from '../rangePopover';
import { positionPopover } from './settingsPopover';
import type { Drawn } from './trackStagePainter';
import type { TrackStageState } from './trackStageModel';

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
}): void {
    const { strings, state, drawnOn } = deps;
    // The lanes' cursor line and readout, the box being dragged and an axis's range, for any plot of the mode.
    const cursor = document.createElement('div');
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
            if (!hit || hit.axis || !drawn) { cursor.hidden = true; readout.hidden = true; if (hit) deps.hint(strings.compareHintAxis); return; }
            deps.hint(strings.compareHintPlot);
            // The cursor line across the plot, and the pictures' values where it is (the lanes' readout).
            const rect = plotBox(hit.plot);
            Object.assign(cursor.style, { left: `${event.clientX}px`, top: `${rect.top}px`, height: `${rect.height}px` });
            cursor.hidden = false;
            const text = drawn.picture?.kind === 'heatmap' ? '' : stageReadout(drawn.views, across(hit.point.fx));
            readout.textContent = text;
            Object.assign(readout.style, { left: `${event.clientX + 12}px`, top: `${rect.top + 4}px` });
            readout.hidden = !text;
        },
        clearHover() { cursor.hidden = true; readout.hidden = true; },
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
}
