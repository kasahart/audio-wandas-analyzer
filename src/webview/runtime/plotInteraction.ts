/**
 * The pointer gestures of every plot (the track lanes, the comparison's panes, the entry screen's plots), so a plot
 * answers the same hand the same way everywhere. Hover shows the cursor line and readout; a press dragged past the
 * lanes' threshold draws a box and zooms into it (both axes; a vertical axis defined to show all of its range, a
 * count axis, keeps it whole: VerticalAxis), Alt+drag picks a stretch of the horizontal axis and
 * Shift+drag moves what the plot shows along it, where the plot has those; Ctrl+wheel zooms the horizontal axis around
 * the pointer (over an axis, around its middle) and Shift+wheel pans it, by the lanes' steps, and a sideways swipe pans it with the fingers; a double-click resets the zoom, or on an axis
 * opens its range; ← / → step the readout to the next point, read as the pointer on it would read it (R7); + / − zoom
 * the horizontal axis of the plot under the pointer around its middle and 0 shows the whole of it. A press that stays
 * put is a click and acts at once; the second press of a double click takes back what the first did, so a double click
 * resets the zoom only, however slow; a drag under way owns the view, so no wheel or key changes it until it ends (R13).
 * Built on the low-level listeners of trackPointerEvents.ts, which nothing else attaches (src/test/plotGestures.test.ts).
 */
import { keyRouterFor } from './keyRouter';
import type { PlotPlace } from './plotHoverLayer';
import { attachTrackPointerListeners } from './trackPointerEvents';
import { exceedsDragThreshold, MIN_SELECTION_SPAN, PAN_STEP_RATIO, ZOOM_IN_FACTOR, panNormalizedRangeBy, wheelPanPixels, wheelStepDirection, wheelZoomFactor, zoomRangeAroundPivot, type NormalizedRange } from './waveformInteraction';

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

/**
 * What a plot's vertical axis is, for the box zoom (R13). 'zoom' (every plot but one): a box zooms it to the box, as it
 * does the horizontal one. 'all-counts': an axis defined to show every count, always: from 0 past the group's most
 * counted bin, whatever part of the value axis is on screen (the entry distribution's count per group). A box zooms such a plot's value axis only, so
 * no count is ever off the plot; it is what the axis is, not a zoom left out. The plot says which on the canvas
 * (`data-plot-y-axis`), so one test holds every plot to it.
 */
export type VerticalAxis = 'zoom' | 'all-counts';

/**
 * Names on the plot the part of each axis on screen ("x.start x.end y.start y.end") and what its vertical axis is, as
 * the shared gestures do after each one; a plot drawn anew (its canvas made again) names them as it is drawn.
 */
export function notePlotWindow(plot: HTMLElement, window: PlotWindow, vertical: VerticalAxis): void {
    plot.dataset.plotWindow = [window.x.start, window.x.end, window.y.start, window.y.end].map(value => value.toFixed(3)).join(' ');
    plot.dataset.plotYAxis = vertical;
}

/**
 * A box drawn on the screen part of a plot, as the window it zooms to; null when it is too thin on an axis it zooms.
 * On a plot whose vertical axis shows all counts, the vertical window stays whole, so a level drag zooms it.
 */
export function windowFromBox(window: PlotWindow, a: PlotPoint, b: PlotPoint, vertical: VerticalAxis = 'zoom'): PlotWindow | null {
    const [x0, x1] = [Math.min(a.fx, b.fx), Math.max(a.fx, b.fx)];
    const [y0, y1] = [Math.min(a.fy, b.fy), Math.max(a.fy, b.fy)];
    if (x1 - x0 <= MIN_SELECTION_SPAN * 10) return null;
    if (vertical === 'all-counts') return { x: { start: within(window.x, x0), end: within(window.x, x1) }, y: FULL_PLOT_WINDOW.y };
    if (y1 - y0 <= MIN_SELECTION_SPAN * 10) return null;
    return { x: { start: within(window.x, x0), end: within(window.x, x1) }, y: { start: within(window.y, y0), end: within(window.y, y1) } };
}

/** Ctrl+wheel at `point`: the horizontal axis zoomed around the pointer, by the lanes' wheel step. */
export function wheelZoomWindow(window: PlotWindow, point: PlotPoint, deltaY: number): PlotWindow {
    return { ...window, x: zoomRangeAroundPivot(window.x, within(window.x, point.fx), wheelZoomFactor(deltaY)) };
}

/**
 * The horizontal axis zoomed by `factor` about the middle of what is on screen: + / − over a plot, and Ctrl+wheel over
 * an axis (no point on the plot to zoom around), the same on every plot.
 */
export function centredZoomWindow(window: PlotWindow, factor: number): PlotWindow {
    return { ...window, x: zoomRangeAroundPivot(window.x, within(window.x, 0.5), factor) };
}

/** Shift+wheel or a sideways swipe: the horizontal axis panned by `fraction` of the visible span (positive: later). */
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
    /** On a plot with two level axes, the right-hand one: its own range is opened there (R13). */
    right?: boolean;
    /**
     * On a heatmap's colour bar (stagePanes.stagePlotPoint, the one hit test of it): a value axis (`axis` 'y'), so the
     * axis gestures answer there as on every axis; a double-click opens the colour range, not the rows' (R13).
     */
    colour?: boolean;
}

export interface PlotInteractionDeps {
    /** The plot under the pointer, or null where there is none (or it has nothing drawn). */
    locate(target: EventTarget | null, clientX: number, clientY: number): PlotHit | null;
    /** The same plot's point for a pointer that has left it while dragging (clamped to its edges). */
    pointOn(plot: HTMLElement, clientX: number, clientY: number): PlotPoint;
    window(plot: HTMLElement): PlotWindow;
    /** A new window for the plot (null: the whole of every axis). */
    setWindow(plot: HTMLElement, window: PlotWindow | null): void;
    /** The pointer (or an arrow key's step, at the point it steps to) over `hit`. */
    hover(event: PlotPointer, hit: PlotHit | null): void;
    clearHover(): void;
    /** The box being dragged (null: none). */
    showBox(plot: HTMLElement, from: PlotPoint, to: PlotPoint): void;
    hideBox(): void;
    /** Double-click on an axis (`element`: the one double-clicked): open its range; false when it has none, so the zoom is reset instead. */
    openAxisRange(hit: PlotHit, clientX: number, clientY: number, element: Element): boolean;
    /**
     * Where an arrow key reads on `plot`: the point `delta` along from the one it reads (0: that one), as its hover
     * layer gives it (PlotHoverLayer.stepFrom); null when the plot reads nothing, so the key goes on.
     */
    stepFrom(plot: HTMLElement, delta: -1 | 0 | 1, arrived?: (at: PlotPlace) => void): PlotPlace | null;
    /**
     * Alt+drag picks a stretch of the horizontal axis instead of zooming into a box (the distribution's value range,
     * the lanes' loop). `end` is told whether the press moved past the drag threshold.
     */
    altDrag?: PlotDrag;
    /** Shift+drag moves what the plot shows along its horizontal axis (the lanes' track time shift); Alt is taken first. */
    shiftDrag?: PlotDrag;
    /**
     * A press that stayed put with neither Alt nor Shift held, at its release (Alt and Shift tell their drag's `end`):
     * what it does is decided now, on the plot as it was clicked, and returned; it is done at once (R13). It acts on the
     * point the plot's readout read at the press (clickOnRead, PlotHoverLayer.clicked: the same read, the same
     * identity), never on a hit test of its own; where the readout reads nothing, it does nothing (R7). The action
     * returns how to take it back (put back what it changed: the selection, the cursor, the event left out): the
     * second press of a double click is no click, and takes back what its first press did, so a double click resets
     * the zoom only, however slow (the browser says it is one: `detail` 2). An action that changes nothing to take
     * back returns nothing. Any later press, on any plot, takes the click's place: `current` says whether it still
     * stands (for a click that waits further, for its data; its take-back then puts back what it did by then, if
     * anything). The second press of a double click, and a press whose release was lost, are told too, with
     * `current` false, and their action is never done.
     */
    tap?(plot: HTMLElement, event: MouseEvent, current: () => boolean): PlotClick | void;
    /**
     * Whether `plot` takes ← / → now, its picture still on its way too (the keys wait for it in the readout, R7);
     * where it is left out, a plot takes them where `locate` finds it.
     */
    takesKeys?(plot: HTMLElement): boolean;
    /** Any press on a plot, before it is known whether it drags (a lane takes the keyboard focus). */
    pressed?(hit: PlotHit, event: MouseEvent): void;
    /** What the plots' vertical axis is (VerticalAxis); 'zoom' when left out. */
    verticalAxis?: VerticalAxis;
    /**
     * The plot zooms into the box drawn itself, for axes that are not a linear part of a window (the lanes' amplitude,
     * a spectrogram's band in Hz); without it the box's window (windowFromBox) is set.
     */
    zoomToBox?(plot: HTMLElement, from: PlotPoint, to: PlotPoint, release: MouseEvent): void;
    /**
     * Where a Ctrl+wheel zoom or a pan acts, where that is not just `locate`: the lanes' time runs on under their
     * headers and beside them on their axes' canvases (a hit with `axis` set zooms about the middle).
     */
    wheelAt?(target: EventTarget | null, clientX: number, clientY: number, gesture: 'zoom' | 'pan'): PlotHit | null;
    /** Axes drawn on canvases of their own beside the plots: a double-click on one opens its range (`hit.axis` set). */
    axes?: { selector: string; locate(axis: HTMLElement, clientX: number, clientY: number): PlotHit | null };
    /** A plot with the keyboard focus keeps ← / → for itself (a focused lane moves its time cursor). */
    focusKeepsArrows?: boolean;
}

/** What a click does, done at once; it returns how to take it back, for the second press of a double click (R13). */
export type PlotClick = () => (() => void) | void;

/** A drag of the plot's own under a modifier key, in place of the box zoom. */
export interface PlotDrag {
    start(hit: PlotHit, event: MouseEvent): void;
    move(event: MouseEvent): void;
    end(event: MouseEvent, dragged: boolean): void;
}

/** What a hover is given of the pointer: a mouse event, or an arrow key's step at the point it reads. */
export type PlotPointer = Pick<MouseEvent, 'clientX' | 'clientY' | 'target'>;

/**
 * The presses on every plot of the page, shared by every surface's gestures (on the document): one count of presses,
 * so a click waiting for its data is taken back by the next press anywhere, and whether a drag is
 * under way, so no other plot reads the pointer during it (R7).
 */
const PLOT_PRESSES = Symbol.for('audio-wandas-analyzer.plotPresses');
/**
 * `click`: the last click done on a plot, at which press, how to take it back and how to reset that plot's zoom: what
 * the second press of a double click does, wherever it lands (R13).
 */
type PlotPresses = { count: number; dragging: boolean; endedBy: Event | null; click: { at: number; plot: HTMLElement; takeBack: () => void; reset: () => void } | null };
function plotPressesOf(doc: object): PlotPresses {
    const holder = doc as { [PLOT_PRESSES]?: PlotPresses };
    return holder[PLOT_PRESSES] ??= { count: 0, dragging: false, endedBy: null, click: null };
}

export function attachPlotInteraction(surface: HTMLElement, doc: Pick<Document, 'addEventListener'>, plotSelector: string, deps: PlotInteractionDeps): void {
    const presses = plotPressesOf(doc);
    /** Whether an event's target is on this surface (a release is told on the document). */
    const onSurface = (target: EventTarget | null): target is Element => !!target && 'nodeType' in target && surface.contains(target as Node);
    // A press that became a drag (a box zoom) is not a click: the click it ends with is not passed on, so a
    // plot's own click (picking a point, going to a row) answers only a press that stayed put, as on the lanes.
    let draggedAt = -Infinity;
    surface.addEventListener('click', event => {
        if (event.timeStamp - draggedAt < 300) { event.stopPropagation(); event.preventDefault(); }
        draggedAt = -Infinity;
    }, true);
    let press: { plot: HTMLElement; from: PlotPoint; clientX: number; clientY: number; isDrag: boolean; to: PlotPoint; drag: PlotDrag | null; last: { clientX: number; clientY: number } } | null = null;
    let lastDouble: PlotHit | null = null;
    // The window these gestures last set is named on the plot they were made on, so one test reads every plot's
    // gestures the same way (R13). Other ways to the window (an axis's range, a pane sharing it) do not write it.
    const vertical = deps.verticalAxis ?? 'zoom';
    const setWindow = (plot: HTMLElement, next: PlotWindow | null): void => {
        deps.setWindow(plot, next);
        notePlotWindow(plot, deps.window(plot), vertical);
    };
    // An axis on a canvas of its own (deps.axes) takes the wheel as the plot's own axis does.
    const onAxis = (target: EventTarget | null, clientX: number, clientY: number): PlotHit | null => {
        const element = target as Partial<Element> | null, axes = deps.axes;
        const axis = axes && typeof element?.closest === 'function' ? element.closest<HTMLElement>(axes.selector) : null;
        return axes && axis ? axes.locate(axis, clientX, clientY) : null;
    };
    /**
     * A drag under way, on this surface or another, owns the view (R7, R13): it reads nothing, and no key or wheel
     * steps, zooms or pans any plot until it ends, so the box (or stretch, or shift) is laid on the window it was
     * drawn on. The one test every gesture that could change what is read or shown asks.
     */
    const dragUnderWay = (): boolean => !!press?.isDrag || presses.dragging;
    // Every wheel gesture (Ctrl+wheel, Shift+wheel, a sideways swipe) finds its plot here: none during a drag.
    const wheelAt = (event: WheelEvent, gesture: 'zoom' | 'pan'): PlotHit | null => {
        if (dragUnderWay()) return null;
        return deps.wheelAt ? deps.wheelAt(event.target, event.clientX, event.clientY, gesture) : deps.locate(event.target, event.clientX, event.clientY) ?? onAxis(event.target, event.clientX, event.clientY);
    };
    const view = surface.ownerDocument.defaultView;
    attachTrackPointerListeners(surface, doc, view ? keyRouterFor(view) : { add: () => () => undefined }, {
        step(plot, delta, pointer) {
            // A plot these gestures do not answer now (locate finds none there: the steps' view off, the lanes in it): not theirs.
            const box = plot.getBoundingClientRect();
            if (deps.takesKeys ? !deps.takesKeys(plot as HTMLElement) : !deps.locate(plot, box.left + box.width / 2, box.top + box.height / 2)) return null;
            // A drag under way, on this surface or another, steps nothing and reads nothing (R7).
            if (dragUnderWay()) return false;
            // The owner hovers where the pointer really is (the layer reads the point stepped to there and keeps the
            // step's place apart), or, with the pointer on no plot (a plot given the focus), at the step's place.
            const hoverAt = (at: PlotPlace): void => {
                const place = pointer ?? at;
                deps.hover({ ...place, target: plot }, deps.locate(plot, place.clientX, place.clientY));
            };
            const at = deps.stepFrom(plot as HTMLElement, delta, hoverAt);
            if (!at) return false;
            hoverAt(at);
            return true;
        },
        zoomKey(plot, action) {
            // A drag under way, here or on another surface: the key is taken and zooms nothing (the box would be laid
            // on another window than it was drawn on).
            if (dragUnderWay()) return true;
            const box = plot.getBoundingClientRect();
            const hit = deps.locate(plot, box.left + box.width / 2, box.top + box.height / 2);
            if (!hit) return false;
            setWindow(hit.plot, action === 'reset' ? null : centredZoomWindow(deps.window(hit.plot), action === 'in' ? ZOOM_IN_FACTOR : 1 / ZOOM_IN_FACTOR));
            return true;
        },
        resetZoom() {
            const plot = lastDouble?.plot;
            if (plot) setWindow(plot, null);
        },
        openAxisRange(element, clientX, clientY) {
            const axes = deps.axes;
            lastDouble = axes && element.matches(axes.selector) ? axes.locate(element as HTMLElement, clientX, clientY) : deps.locate(element, clientX, clientY);
            return !!lastDouble?.axis && deps.openAxisRange(lastDouble, clientX, clientY, element);
        },
        hover(event) {
            // A drag under way, on this surface or another, reads nothing (R7); a move with the button up is no drag
            // (its release was lost: the press is let go on this very move, plotInteraction's abandon).
            const up = (event as Partial<MouseEvent>).buttons === 0;
            if (dragUnderWay() && !up) return;
            if (press?.isDrag) return;
            // A press held reads where it was pressed until it is let go: what a click acts on is what its readout
            // read at the press (R7, R13: PlotHoverLayer.clicked), never a place it slid to within the drag threshold.
            if (press && !up) return;
            const hit = deps.locate(event.target, event.clientX, event.clientY);
            if (hit) hit.plot.dataset.plotYAxis = vertical;
            deps.hover(event, hit);
        },
        clearHover: () => deps.clearHover(),
        press(event) {
            if (event.button !== 0) return;
            const hit = deps.locate(event.target, event.clientX, event.clientY);
            if (!hit || hit.axis) return;
            // The same hand everywhere: a drag zooms into its box, Alt+drag picks a stretch of the horizontal axis,
            // Shift+drag moves what the plot shows along it.
            const drag = (event.altKey ? deps.altDrag : undefined) ?? (event.shiftKey ? deps.shiftDrag : undefined) ?? null;
            // Read at the press, before its owner is told of it: the readout a click acts on is the one at the press.
            hit.plot.dataset.plotYAxis = vertical;
            deps.hover(event, hit);
            presses.count += 1;
            press = { plot: hit.plot, from: hit.point, to: hit.point, clientX: event.clientX, clientY: event.clientY, isDrag: false, drag, last: { clientX: event.clientX, clientY: event.clientY } };
            deps.pressed?.(hit, event);
            drag?.start(hit, event);
            event.preventDefault();
        },
        drag(event) {
            if (!press) return;
            press.last = { clientX: event.clientX, clientY: event.clientY };
            if (!press.isDrag && exceedsDragThreshold(event.clientX - press.clientX, event.clientY - press.clientY)) {
                press.isDrag = true;
                presses.dragging = true;
                // A drag under way reads nothing: the readout of the place it was pressed at goes (R7).
                deps.clearHover();
            }
            if (!press.isDrag) return;
            if (press.drag) { press.drag.move(event); return; }
            press.to = deps.pointOn(press.plot, event.clientX, event.clientY);
            deps.showBox(press.plot, press.from, press.to);
        },
        abandon(event) {
            // Its release lost: the press ends with nothing done (no zoom, no click), its owner told so (a drag's end,
            // a click no longer current), and every plot reads and takes keys again (R7).
            const done = press;
            press = null;
            if (presses.dragging && done) presses.dragging = false;
            if (!done) return;
            const MouseEventOf = surface.ownerDocument.defaultView?.MouseEvent;
            const end = event ?? (MouseEventOf ? new MouseEventOf('mouseup', { clientX: done.last.clientX, clientY: done.last.clientY }) : null);
            if (done.isDrag && !done.drag) deps.hideBox();
            if (end) {
                if (done.drag) done.drag.end(end, done.isDrag);
                else deps.tap?.(done.plot, end, () => false);
            }
            if (event && onSurface(event.target)) {
                const hit = deps.locate(event.target, event.clientX, event.clientY);
                if (hit && !hit.axis) { hit.plot.dataset.plotYAxis = vertical; deps.hover(event, hit); }
            }
        },
        release(event) {
            const done = press;
            press = null;
            if (!done) {
                // A drag pressed on another surface let go over a plot of this one: read where it was let go (R7),
                // whichever surface's release comes first.
                if ((presses.dragging || presses.endedBy === event) && onSurface(event.target)) {
                    const hit = deps.locate(event.target, event.clientX, event.clientY);
                    if (hit && !hit.axis) { hit.plot.dataset.plotYAxis = vertical; deps.hover(event, hit); }
                }
                return;
            }
            if (done.isDrag) presses.endedBy = event;
            presses.dragging = false;
            done.drag?.end(event, done.isDrag);
            if (!done.isDrag) {
                // The one arbitration of a click for every plot (R13): a press that stayed put is a click and acts at
                // once. The second press of a double click (the browser's: `detail` 2, at whatever interval its OS
                // sets) is no click: it takes back what its first press did, if no other press came between, and its
                // receiver is told the press ended with nothing to do. So a double click resets the zoom only, however
                // slow; no timer of ours decides it. A click that waits for its data stands until another press comes.
                if (!done.drag) {
                    const at = presses.count;
                    presses.click = null;
                    if (event.detail > 1) deps.tap?.(done.plot, event, () => false);
                    else {
                        const current = (): boolean => presses.count === at;
                        const action = deps.tap?.(done.plot, event, current);
                        const takeBack = typeof action === 'function' ? action() : undefined;
                        const plot = done.plot;
                        if (typeof takeBack === 'function') presses.click = { at, plot, takeBack, reset: () => setWindow(plot, null) };
                    }
                }
                // Let go where it moved to (within the drag threshold): the readout is the pointer's there, as the
                // time lines are (R7), whoever owns the press (read once its owner has let go of it).
                if (onSurface(event.target)) {
                    const hit = deps.locate(event.target, event.clientX, event.clientY);
                    if (hit && !hit.axis && (event.clientX !== done.clientX || event.clientY !== done.clientY)) { hit.plot.dataset.plotYAxis = vertical; deps.hover(event, hit); }
                }
                return;
            }
            draggedAt = event.timeStamp;
            if (!done.drag) {
                deps.hideBox();
                if (deps.zoomToBox) deps.zoomToBox(done.plot, done.from, done.to, event);
                else {
                    const next = windowFromBox(deps.window(done.plot), done.from, done.to, deps.verticalAxis);
                    if (next) setWindow(done.plot, next);
                }
            }
            // Let go, the readout is the pointer's where it is now, on what the drag left (a box zoom's view, a
            // stretch picked), never the place it was pressed at (R7): every owner reads its hover there again as it redraws.
            // What is under the pointer now: a plot drawn anew by the gesture (the distribution's rows) is another element.
            const released = event.target as Partial<Element> | null;
            const under = released?.isConnected === false ? surface.ownerDocument.elementFromPoint?.(event.clientX, event.clientY) : null;
            const target = under ?? (released?.closest ? event.target : done.plot);
            const hit = deps.locate(target, event.clientX, event.clientY);
            if (hit) hit.plot.dataset.plotYAxis = vertical;
            deps.hover({ clientX: event.clientX, clientY: event.clientY, target }, hit);
        },
        secondPress(event) {
            // The second press of a double click right after a click on a plot (no press between), wherever it lands:
            // the click is taken back and that plot's zoom is reset, so a double click resets the zoom only (R13), even
            // where the click moved what is under the pointer (a bin picked narrows the table). Told on the document,
            // before any surface counts the press; the surface the click was on answers it once.
            const first = presses.click;
            if (!first || first.at !== presses.count) return;
            presses.click = null;
            first.takeBack();
            // On the plot clicked, its own double click resets it (dblclick); landed elsewhere, it is reset here.
            const under = (event.target as Partial<Element> | null)?.closest?.(plotSelector);
            if (under !== first.plot) first.reset();
        },
        zoomWheel(event) {
            const hit = wheelAt(event, 'zoom');
            // Over an axis there is no point on the plot to zoom around: its middle, on every plot.
            if (hit) setWindow(hit.plot, hit.axis ? centredZoomWindow(deps.window(hit.plot), wheelZoomFactor(event.deltaY)) : wheelZoomWindow(deps.window(hit.plot), hit.point, event.deltaY));
        },
        panWheel(event, swipe) {
            const hit = wheelAt(event, 'pan');
            if (!hit) return;
            if (!swipe) {
                setWindow(hit.plot, wheelPanWindow(deps.window(hit.plot), wheelStepDirection(event) * PAN_STEP_RATIO));
                return;
            }
            // The plot's width from two points across its middle, so the content follows the fingers.
            const box = hit.plot.getBoundingClientRect(), middle = box.left + box.width / 2;
            const perPixel = deps.pointOn(hit.plot, middle + 1, event.clientY).fx - deps.pointOn(hit.plot, middle, event.clientY).fx;
            if (perPixel > 0) setWindow(hit.plot, wheelPanWindow(deps.window(hit.plot), wheelPanPixels(event, 1 / perPixel) * perPixel));
        },
    }, { plot: plotSelector, ...(deps.axes ? { axis: deps.axes.selector } : {}), ...(deps.focusKeepsArrows ? { focusKeepsArrows: true } : {}) });
}
