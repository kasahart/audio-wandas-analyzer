/**
 * The pointer gestures of the track lanes, for any other plot: the comparison's panes use them so a plot answers
 * the same hand the same way everywhere. Hover shows the cursor line and readout; a press dragged past the
 * lanes' threshold draws a box and zooms into it (both axes); Ctrl+wheel zooms the horizontal axis around
 * the pointer by the lanes' step, and Shift+wheel or a sideways swipe pans it as far as the wheel moved; a double-click resets the zoom, or on an axis
 * opens its range. Built on the lanes' own listeners (attachTrackPointerListeners) and zoom arithmetic.
 */
import { attachTrackPointerListeners } from './trackPointerEvents';
import { exceedsDragThreshold, MIN_SELECTION_SPAN, panNormalizedRangeBy, wheelPanPixels, wheelZoomFactor, zoomRangeAroundPivot, type NormalizedRange } from './waveformInteraction';

/** A point on a plot: across (0 at the left) and up (0 at the bottom) the part on screen. */
export interface PlotPoint {
    fx: number;
    fy: number;
}

/** The part of each axis on screen, as fractions of the whole axis. */
export interface PlotWindow {
    x: NormalizedRange;
    y: NormalizedRange;
}

export const FULL_PLOT_WINDOW: PlotWindow = { x: { start: 0, end: 1 }, y: { start: 0, end: 1 } };

const within = (range: NormalizedRange, fraction: number): number => range.start + fraction * (range.end - range.start);

/** A box drawn on the screen part of a plot, as the window it zooms to; null when it is too thin on either axis. */
export function windowFromBox(window: PlotWindow, a: PlotPoint, b: PlotPoint): PlotWindow | null {
    const [x0, x1] = [Math.min(a.fx, b.fx), Math.max(a.fx, b.fx)];
    const [y0, y1] = [Math.min(a.fy, b.fy), Math.max(a.fy, b.fy)];
    if (x1 - x0 <= MIN_SELECTION_SPAN * 10 || y1 - y0 <= MIN_SELECTION_SPAN * 10) return null;
    return { x: { start: within(window.x, x0), end: within(window.x, x1) }, y: { start: within(window.y, y0), end: within(window.y, y1) } };
}

/** Ctrl+wheel at `point`: the horizontal axis zoomed around the pointer, by the lanes' wheel step. */
export function wheelZoomWindow(window: PlotWindow, point: PlotPoint, deltaY: number): PlotWindow {
    return { ...window, x: zoomRangeAroundPivot(window.x, within(window.x, point.fx), wheelZoomFactor(deltaY)) };
}

/** Shift+wheel or a sideways swipe: the horizontal axis panned by `fraction` of the plot's width (positive: later). */
export function wheelPanWindow(window: PlotWindow, fraction: number): PlotWindow {
    return { ...window, x: panNormalizedRangeBy(window.x, fraction) };
}

/** The margins around a canvas's plot (its axes' numbers and names), in CSS pixels. */
export interface PlotMargins {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * The pointer on a canvas: its place across and up the plot (0–1, from the left and the bottom, clamped),
 * and which axis it is over: the vertical one left of the plot, the horizontal one under it.
 */
export function plotPointIn(canvas: Pick<Element, 'getBoundingClientRect'>, margins: PlotMargins, clientX: number, clientY: number): PlotPoint & { axis: 'x' | 'y' | null } {
    const box = canvas.getBoundingClientRect();
    const x = clientX - box.left, y = clientY - box.top;
    const width = Math.max(1, box.width - margins.left - margins.right), height = Math.max(1, box.height - margins.top - margins.bottom);
    const fx = Math.max(0, Math.min(1, (x - margins.left) / width)), fy = Math.max(0, Math.min(1, 1 - (y - margins.top) / height));
    return { fx, fy, axis: margins.left > 0 && x < margins.left ? 'y' : margins.bottom > 0 && y > box.height - margins.bottom ? 'x' : null };
}

/** Where the pointer is over one plot: the element, the point (on the plot) and the axis it is over, if any. */
export interface PlotHit {
    plot: HTMLElement;
    point: PlotPoint;
    axis: 'x' | 'y' | null;
}

export interface PlotInteractionDeps {
    /** The plot under the pointer, or null where there is none (or it has nothing drawn). */
    locate(target: EventTarget | null, clientX: number, clientY: number): PlotHit | null;
    /** The same plot's point for a pointer that has left it while dragging (clamped to its edges). */
    pointOn(plot: HTMLElement, clientX: number, clientY: number): PlotPoint;
    window(plot: HTMLElement): PlotWindow;
    /** A new window for the plot (null: the whole of every axis). */
    setWindow(plot: HTMLElement, window: PlotWindow | null): void;
    hover(event: MouseEvent, hit: PlotHit | null): void;
    clearHover(): void;
    /** The box being dragged (null: none). */
    showBox(plot: HTMLElement, from: PlotPoint, to: PlotPoint): void;
    hideBox(): void;
    /** Double-click on an axis: open its range; false when it has none, so the zoom is reset instead. */
    openAxisRange(hit: PlotHit, clientX: number, clientY: number): boolean;
}

export function attachPlotInteraction(surface: HTMLElement, doc: Pick<Document, 'addEventListener'>, plotSelector: string, deps: PlotInteractionDeps): void {
    // A press that became a drag (a box zoom) is not a click: the click it ends with is not passed on, so a
    // plot's own click (picking a point, going to a row) answers only a press that stayed put, as on the lanes.
    let draggedAt = -Infinity;
    surface.addEventListener('click', event => {
        if (event.timeStamp - draggedAt < 300) { event.stopPropagation(); event.preventDefault(); }
        draggedAt = -Infinity;
    }, true);
    let press: { plot: HTMLElement; from: PlotPoint; clientX: number; clientY: number; isDrag: boolean; to: PlotPoint } | null = null;
    let lastDouble: PlotHit | null = null;
    attachTrackPointerListeners(surface, doc, {
        resetZoom() {
            const plot = lastDouble?.plot;
            if (plot) deps.setWindow(plot, null);
        },
        openAxisRange(element, clientX, clientY) {
            lastDouble = deps.locate(element, clientX, clientY);
            return !!lastDouble?.axis && deps.openAxisRange(lastDouble, clientX, clientY);
        },
        hover(event) {
            if (press?.isDrag) return;
            deps.hover(event, deps.locate(event.target, event.clientX, event.clientY));
        },
        clearHover: () => deps.clearHover(),
        press(event) {
            if (event.button !== 0) return;
            const hit = deps.locate(event.target, event.clientX, event.clientY);
            if (!hit || hit.axis) return;
            press = { plot: hit.plot, from: hit.point, to: hit.point, clientX: event.clientX, clientY: event.clientY, isDrag: false };
            event.preventDefault();
        },
        drag(event) {
            if (!press) return;
            if (!press.isDrag && exceedsDragThreshold(event.clientX - press.clientX, event.clientY - press.clientY)) press.isDrag = true;
            if (!press.isDrag) return;
            press.to = deps.pointOn(press.plot, event.clientX, event.clientY);
            deps.showBox(press.plot, press.from, press.to);
        },
        release(event) {
            const done = press;
            press = null;
            if (!done?.isDrag) return;
            draggedAt = event.timeStamp;
            deps.hideBox();
            const next = windowFromBox(deps.window(done.plot), done.from, done.to);
            if (next) deps.setWindow(done.plot, next);
        },
        zoomWheel(event) {
            const hit = deps.locate(event.target, event.clientX, event.clientY);
            if (hit) deps.setWindow(hit.plot, wheelZoomWindow(deps.window(hit.plot), hit.point, event.deltaY));
        },
        panWheel(event) {
            const hit = deps.locate(event.target, event.clientX, event.clientY);
            if (!hit) return;
            // The plot's width from two points across its middle, so the content follows the fingers.
            const box = hit.plot.getBoundingClientRect(), middle = box.left + box.width / 2;
            const perPixel = deps.pointOn(hit.plot, middle + 1, event.clientY).fx - deps.pointOn(hit.plot, middle, event.clientY).fx;
            if (perPixel > 0) deps.setWindow(hit.plot, wheelPanWindow(deps.window(hit.plot), wheelPanPixels(event, 1 / perPixel) * perPixel));
        },
    }, { plot: plotSelector });
}
