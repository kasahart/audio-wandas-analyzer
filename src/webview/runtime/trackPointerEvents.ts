import { isTextEntryTarget, type KeyRouter } from './keyRouter';
import { zoomKeyAction } from './shortcuts';

export interface TrackPointerHandlers {
    resetZoom(): void;
    /** Returns false when no axis with settings was hit (on an axis or a plot), so the double-click resets the zoom instead. */
    openAxisRange(axis: Element, clientX: number, clientY: number): boolean;
    hover(e: MouseEvent): void;
    clearHover(): void;
    press(e: MouseEvent): void;
    drag(e: MouseEvent): void;
    release(e: MouseEvent): void;
    /**
     * The end of a press was lost (its release never reached the page: the pointer let go outside it, the window lost
     * the focus or was hidden, the pointer was cancelled or its capture lost): the press and any drag end there, with
     * nothing done, so the readout and the keys answer again on every plot (R7). `e` is the move that found the
     * button up, where the pointer is now; none for the window's blur or hiding.
     */
    abandon?(e?: MouseEvent): void;
    /**
     * The second press of a double click (the browser's: `detail` 2), anywhere on the page, before any surface takes
     * the press: what a click on a plot changed can move what is under the pointer, and the double click is still that
     * plot's (R13).
     */
    secondPress?(e: MouseEvent): void;
    zoomWheel(e: WheelEvent): void;
    /** `swipe`: a sideways swipe, moved as far as the fingers went; else a Shift+wheel notch, by the lanes' step. */
    panWheel(e: WheelEvent, swipe: boolean): void;
    /**
     * ← / → over a plot (or on a focused one): its readout steps to the next point that way (0, a plot given the focus
     * with the pointer elsewhere: it reads where it starts). False when it could not step (nothing read, the data's
     * end, the edge of the window on screen, a drag under way): the key is the plot's all the same and goes to no
     * other surface's cursor (R7). Null when these gestures do not answer the plot now (another mode's gestures on the
     * same surface do: the lanes' and the steps' view share it), so the key goes on to them.
     */
    step(plot: Element, delta: -1 | 0 | 1, pointer?: { clientX: number; clientY: number } | null): boolean | null;
    /** + / − / 0 over a plot: its horizontal axis zoomed in or out around its middle, or shown whole. False when the plot shows nothing, so the key goes on. */
    zoomKey(plot: Element, action: 'in' | 'out' | 'reset'): boolean;
}

type PointerSurface = Pick<HTMLElement, 'addEventListener' | 'removeEventListener' | 'contains'>;

/**
 * Takes off every listener a plot's gestures added (on the surface, the document, the window) and its key context, so
 * nothing of them answers again. Call it when the plot or lane it was attached for is torn down; calling it again does nothing.
 */
export type PlotGesturesDisposer = () => void;

/** Which elements are plots (a double-click resets their zoom) and which are axes (it opens their range). */
export interface PlotSelectors {
    plot: string;
    axis?: string;
    /** A plot with the keyboard focus keeps ← / → for itself, pointer over it or not: a focused lane moves its time cursor. */
    focusKeepsArrows?: boolean;
}

/**
 * The plot the pointer is over on any surface of the page, shared by every surface's listeners (on the document, as
 * the key router is on the window): a key the pointer's plot would take is never taken first by a plot of another
 * surface that only has the focus (A47, R7).
 */
const POINTER_PLOT = Symbol.for('audio-wandas-analyzer.pointerPlot');
type PointerPlot = { plot: Element | null; event: Event | null };
type PointerPlotHolder = { [POINTER_PLOT]?: PointerPlot };
function pointerPlotOf(doc: object): PointerPlot {
    const holder = doc as PointerPlotHolder;
    return holder[POINTER_PLOT] ??= { plot: null, event: null };
}

/**
 * The plot under the pointer, of any surface, whether or not its gestures answer it now (a spectrum with no data yet):
 * a key over it is never another surface's, a focused lane's time cursor (R7).
 */
export function plotUnderPointer(doc: object): Element | null {
    const plot = pointerPlotOf(doc).plot;
    return plot && plot.isConnected ? plot : null;
}

/** Wheel events further apart than this start a new swipe. */
const SWIPE_PAUSE_MS = 150;

const TRACK_SELECTORS: PlotSelectors = { plot: '.track-canvas', axis: '.track-axis-canvas', focusKeepsArrows: true };

/**
 * The analyzer's pointer gestures on its plots, as the track lanes define them: hover, press–drag–release
 * (followed on the document), Ctrl+wheel to zoom, Shift+wheel or a sideways swipe on a plot to pan, double-click
 * to reset (or, on an axis, to set its range), ← / → to step the readout of the plot under the pointer one
 * point at a time (R7), and + / − / 0 to zoom that plot's horizontal axis around its middle or show it whole. plotInteraction.ts attaches every plot, the lanes too, through these listeners, and
 * nothing else attaches them (src/test/plotGestures.test.ts).
 *
 * Clean-up promise: the returned disposer takes off every listener added here (the surface's, the document's, the
 * window's blur) and the 'plot' key context, so none of them fires again; calling it twice does nothing.
 * plotInteraction.ts returns it to the plot's owner, who calls it when it tears the plot or lane down.
 */
export function attachTrackPointerListeners(tracksWrapper: PointerSurface, doc: Pick<Document, 'addEventListener' | 'removeEventListener'> & Partial<Pick<Document, 'elementFromPoint'>>, keys: Pick<KeyRouter, 'add'>, handlers: TrackPointerHandlers, selectors: PlotSelectors = TRACK_SELECTORS): PlotGesturesDisposer {
    const removers: Array<() => void> = [];
    /** Every listener goes through here, so the disposer takes each one off again. */
    function listen<K extends keyof DocumentEventMap>(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, type: K, listener: (event: DocumentEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void {
        const fn = listener as EventListener;
        target.addEventListener(type, fn, options);
        const capture = typeof options === 'boolean' ? options : !!options?.capture;
        removers.push(() => target.removeEventListener(type, fn, capture));
    }
    listen(tracksWrapper, 'dblclick', function (e) {
        const target = e.target as Partial<Element> | null;
        const hit = target && target.closest ? target.closest([selectors.plot, selectors.axis].filter(Boolean).join(', ')) : null;
        if (!hit) {
            return;
        }
        // A plot is asked too: it can draw an axis inside its canvas (the comparison's panes, the spectrogram's
        // colour bar), and only it knows whether the double-click was on one.
        if (handlers.openAxisRange(hit, e.clientX, e.clientY)) {
            return;
        }
        handlers.resetZoom();
    });
    const onPlot = (e: Event): boolean => {
        const target = e.target as Partial<Element> | null;
        return !!(target && target.closest && target.closest(selectors.plot));
    };
    /** The plot under the pointer, whose readout the arrow keys step. */
    let over: Element | null = null;
    const plotOf = (target: EventTarget | null): Element | null => {
        const element = target as Partial<Element> | null;
        const plot = element && element.closest ? element.closest(selectors.plot) : null;
        return plot && tracksWrapper.contains(plot) ? plot : null;
    };
    /** Where the pointer last was, so a key finds the plot under it after the one it was over is made again. */
    let pointer: { x: number; y: number } | null = null;
    const underPointer = (): Element | null => {
        if (over && over.isConnected) return over;
        const doc = (tracksWrapper as Partial<HTMLElement>).ownerDocument;
        return pointer && doc && typeof doc.elementFromPoint === 'function' ? plotOf(doc.elementFromPoint(pointer.x, pointer.y)) : null;
    };
    const shared = pointerPlotOf(doc);
    /**
     * The plot this surface finds under the pointer, told to every surface: a surface inside another (the steps' plots
     * inside the lanes' wrapper) sees the event first, and the one around it, which finds none of its own plots
     * there, does not take that plot back (A47).
     */
    const notePointer = (plot: Element | null, event: Event): void => {
        if (plot || shared.event !== event) shared.plot = plot;
        shared.event = event;
    };
    /** The pointer is over a plot, of any surface, other than `plot`. */
    const pointerElsewhere = (plot: Element): boolean => !!shared.plot && shared.plot !== plot && shared.plot.isConnected;
    /** The plot whose readout the focus gave (none since the pointer read one here): only that readout goes with the focus. */
    let focusGave: Element | null = null;
    listen(tracksWrapper, 'mousemove', function (e) { over = plotOf(e.target); notePointer(over, e); focusGave = null; pointer = { x: e.clientX, y: e.clientY }; handlers.hover(e); });
    // A scroll under a still pointer moves another place of a plot, or another plot, under it: read there, as a
    // pointer moved there would (R7), never a readout only taken away, nor one left where the plot was.
    listen(doc, 'scroll', function (e) {
        const at = pointer;
        const under = at && typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(at.x, at.y) : null;
        if (!at || !under) return;
        // Scrolled off this surface altogether: its readout and marks go, as when the pointer leaves it.
        if (!tracksWrapper.contains(under)) {
            if (shared.plot && shared.plot === over) shared.plot = null;
            over = null;
            pointer = null;
            handlers.clearHover();
            return;
        }
        over = plotOf(under);
        notePointer(over, e);
        handlers.hover({ clientX: at.x, clientY: at.y, target: under, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, buttons: 0 } as unknown as MouseEvent);
    }, true);
    listen(tracksWrapper, 'mouseleave', function () { if (shared.plot && shared.plot === over) shared.plot = null; over = null; pointer = null; handlers.clearHover(); });
    // A plot given the focus from the keyboard reads where it starts, so the arrows have a point to step from;
    // let go of the focus with the pointer elsewhere, its readout goes.
    // With the pointer over a plot, of this surface or another (one inside it too), the readout is the pointer's (A47).
    listen(tracksWrapper, 'focusin', function (e) {
        const plot = plotOf(e.target);
        if (!plot || over || selectors.focusKeepsArrows || pointerElsewhere(plot)) return;
        if (handlers.step(plot, 0)) focusGave = plot;
    });
    // Only a readout the focus gave goes: one the pointer read since, here or on a plot inside this surface, stays.
    listen(tracksWrapper, 'focusout', function (e) {
        const plot = plotOf(e.target);
        if (!plot || focusGave !== plot) return;
        focusGave = null;
        if (!over) handlers.clearHover();
    });
    removers.push(keys.add({
        layer: 'plot',
        keydown(e) {
            // + / − / 0 zoom the plot under the pointer (not one only focused: the view's own keys take those).
            const zoom = zoomKeyAction(e.key);
            if (zoom) {
                const plot = e.ctrlKey || e.metaKey || e.altKey || isTextEntryTarget(e.target) ? null : underPointer();
                if (!plot || !handlers.zoomKey(plot, zoom)) return false;
                e.preventDefault();
                return true;
            }
            const delta = e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0;
            if (!delta || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTextEntryTarget(e.target)) return false;
            // The plot under the pointer, found again where the one it was over was made anew (a redrawn
            // distribution row), as + / − / 0 find it: the arrows step the plot the pointer is on (A26).
            // A plot that only has the focus takes the arrows only while the pointer is over no other plot (A47): the
            // plot under the pointer, on another surface too, is the one they step.
            const elsewhere = shared.plot && shared.plot.isConnected && !tracksWrapper.contains(shared.plot);
            // With the pointer on no plot (a header of this surface, a gap), the focused plot steps from its own
            // point, read at its place: the pointer's place there is no point of it, and it does not become the
            // pointer's plot (+ / − / 0 stay the view's).
            const under = underPointer();
            const plot = under ?? (elsewhere ? null : plotOf(e.target));
            if (under && under !== over) over = under;
            // A key goes to the focused element: a lane with the focus moves its cursor, as its arrows always have.
            if (!plot || (selectors.focusKeepsArrows && plot === e.target)) return false;
            // The plot's readout steps; one that cannot (nothing read, an end, the edge of what is on screen) keeps the
            // key all the same: it never moves another surface's cursor, a focused lane's time (R7).
            // Where the pointer really is, with it on that plot: the step is read there, its own place kept apart (R7).
            if (handlers.step(plot, delta, under === plot && pointer ? { clientX: pointer.x, clientY: pointer.y } : null) === null) return false;
            e.preventDefault();
            return true;
        },
    }));
    listen(tracksWrapper, 'mousedown', function (e) { handlers.press(e); });
    listen(doc, 'mousedown', function (e) { if (e.detail > 1) handlers.secondPress?.(e); }, true);
    // A move with no button down is a press whose release was lost (let go outside the page): it ends there.
    listen(doc, 'mousemove', function (e) { if (e.buttons === 0 && handlers.abandon) handlers.abandon(e); else handlers.drag(e); });
    listen(doc, 'mouseup', function (e) { handlers.release(e); });
    // Every other way a press ends without its release reaching the page ends it too, with nothing done.
    const lost = (): void => handlers.abandon?.();
    listen(doc, 'pointercancel', lost, true);
    listen(doc, 'lostpointercapture', lost, true);
    listen(doc, 'visibilitychange', function () { if ((doc as Partial<Document>).hidden) lost(); });
    const view = (doc as Partial<Document>).defaultView;
    if (view) listen(view, 'blur', lost);
    // A swipe keeps the direction its first events took until it pauses, so a diagonal one does not
    // alternate between panning the time and scrolling the lanes.
    let swipe: { sideways: boolean; at: number } | null = null;
    listen(tracksWrapper, 'wheel', function (e) {
        if (e.ctrlKey || e.shiftKey) {
            swipe = null;
            e.preventDefault();
            if (e.ctrlKey) handlers.zoomWheel(e);
            else handlers.panWheel(e, false);
            return;
        }
        const sideways = swipe && e.timeStamp - swipe.at < SWIPE_PAUSE_MS ? swipe.sideways : Math.abs(e.deltaX) > Math.abs(e.deltaY);
        swipe = { sideways, at: e.timeStamp };
        if (sideways && onPlot(e)) {
            // A sideways swipe on a plot pans it rather than scrolling the page (or going back a page).
            e.preventDefault();
            handlers.panWheel(e, true);
        }
    }, { passive: false });
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        for (const remove of removers.splice(0)) remove();
    };
}
