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

type PointerSurface = Pick<HTMLElement, 'addEventListener' | 'contains'>;

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

/** Wheel events further apart than this start a new swipe. */
const SWIPE_PAUSE_MS = 150;

const TRACK_SELECTORS: PlotSelectors = { plot: '.track-canvas', axis: '.track-axis-canvas', focusKeepsArrows: true };

/**
 * The analyzer's pointer gestures on its plots, as the track lanes define them: hover, press–drag–release
 * (followed on the document), Ctrl+wheel to zoom, Shift+wheel or a sideways swipe on a plot to pan, double-click
 * to reset (or, on an axis, to set its range), ← / → to step the readout of the plot under the pointer one
 * point at a time (R7), and + / − / 0 to zoom that plot's horizontal axis around its middle or show it whole. plotInteraction.ts attaches every plot, the lanes too, through these listeners, and
 * nothing else attaches them (src/test/plotGestures.test.ts).
 */
export function attachTrackPointerListeners(tracksWrapper: PointerSurface, doc: Pick<Document, 'addEventListener'> & Partial<Pick<Document, 'elementFromPoint'>>, keys: Pick<KeyRouter, 'add'>, handlers: TrackPointerHandlers, selectors: PlotSelectors = TRACK_SELECTORS): void {
    tracksWrapper.addEventListener('dblclick', function (e) {
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
    tracksWrapper.addEventListener('mousemove', function (e) { over = plotOf(e.target); notePointer(over, e); focusGave = null; pointer = { x: e.clientX, y: e.clientY }; handlers.hover(e); });
    // A scroll under a still pointer moves another place of a plot, or another plot, under it: read there, as a
    // pointer moved there would (R7), never a readout only taken away, nor one left where the plot was.
    doc.addEventListener('scroll', function (e) {
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
    tracksWrapper.addEventListener('mouseleave', function () { if (shared.plot && shared.plot === over) shared.plot = null; over = null; pointer = null; handlers.clearHover(); });
    // A plot given the focus from the keyboard reads where it starts, so the arrows have a point to step from;
    // let go of the focus with the pointer elsewhere, its readout goes.
    // With the pointer over a plot, of this surface or another (one inside it too), the readout is the pointer's (A47).
    tracksWrapper.addEventListener('focusin', function (e) {
        const plot = plotOf(e.target);
        if (!plot || over || selectors.focusKeepsArrows || pointerElsewhere(plot)) return;
        if (handlers.step(plot, 0)) focusGave = plot;
    });
    // Only a readout the focus gave goes: one the pointer read since, here or on a plot inside this surface, stays.
    tracksWrapper.addEventListener('focusout', function (e) {
        const plot = plotOf(e.target);
        if (!plot || focusGave !== plot) return;
        focusGave = null;
        if (!over) handlers.clearHover();
    });
    keys.add({
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
            const plot = underPointer() ?? (elsewhere ? null : plotOf(e.target));
            if (plot && plot !== over && pointer) over = plot;
            // A key goes to the focused element: a lane with the focus moves its cursor, as its arrows always have.
            if (!plot || (selectors.focusKeepsArrows && plot === e.target)) return false;
            // The plot's readout steps; one that cannot (nothing read, an end, the edge of what is on screen) keeps the
            // key all the same: it never moves another surface's cursor, a focused lane's time (R7).
            // Where the pointer really is, with it on that plot: the step is read there, its own place kept apart (R7).
            if (handlers.step(plot, delta, over === plot && pointer ? { clientX: pointer.x, clientY: pointer.y } : null) === null) return false;
            e.preventDefault();
            return true;
        },
    });
    tracksWrapper.addEventListener('mousedown', function (e) { handlers.press(e); });
    doc.addEventListener('mousemove', function (e) { handlers.drag(e); });
    doc.addEventListener('mouseup', function (e) { handlers.release(e); });
    // A swipe keeps the direction its first events took until it pauses, so a diagonal one does not
    // alternate between panning the time and scrolling the lanes.
    let swipe: { sideways: boolean; at: number } | null = null;
    tracksWrapper.addEventListener('wheel', function (e) {
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
}
