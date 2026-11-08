import { isTextEntryTarget, type KeyRouter } from './keyRouter';

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
     * with the pointer elsewhere: it reads where it starts). False when the plot reads nothing, so the key goes on.
     */
    step(plot: Element, delta: -1 | 0 | 1): boolean;
}

type PointerSurface = Pick<HTMLElement, 'addEventListener' | 'contains'>;

/** Which elements are plots (a double-click resets their zoom) and which are axes (it opens their range). */
export interface PlotSelectors {
    plot: string;
    axis?: string;
    /** A plot with the keyboard focus keeps ← / → for itself, pointer over it or not: a focused lane moves its time cursor. */
    focusKeepsArrows?: boolean;
}

/** Wheel events further apart than this start a new swipe. */
const SWIPE_PAUSE_MS = 150;

const TRACK_SELECTORS: PlotSelectors = { plot: '.track-canvas', axis: '.track-axis-canvas', focusKeepsArrows: true };

/**
 * The analyzer's pointer gestures on its plots, as the track lanes define them: hover, press–drag–release
 * (followed on the document), Ctrl+wheel to zoom, Shift+wheel or a sideways swipe on a plot to pan, double-click
 * to reset (or, on an axis, to set its range), and ← / → to step the readout of the plot under the pointer one
 * point at a time (R7). plotInteraction.ts attaches every plot, the lanes too, through these listeners, and
 * nothing else attaches them (src/test/plotGestures.test.ts).
 */
export function attachTrackPointerListeners(tracksWrapper: PointerSurface, doc: Pick<Document, 'addEventListener'>, keys: Pick<KeyRouter, 'add'>, handlers: TrackPointerHandlers, selectors: PlotSelectors = TRACK_SELECTORS): void {
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
    tracksWrapper.addEventListener('mousemove', function (e) { over = plotOf(e.target); handlers.hover(e); });
    tracksWrapper.addEventListener('mouseleave', function () { over = null; handlers.clearHover(); });
    // A plot given the focus from the keyboard reads where it starts, so the arrows have a point to step from;
    // let go of the focus with the pointer elsewhere, its readout goes.
    tracksWrapper.addEventListener('focusin', function (e) { const plot = plotOf(e.target); if (plot && !over && !selectors.focusKeepsArrows) handlers.step(plot, 0); });
    tracksWrapper.addEventListener('focusout', function (e) { const plot = plotOf(e.target); if (plot && plot !== over) handlers.clearHover(); });
    keys.add({
        layer: 'plot',
        keydown(e) {
            const delta = e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0;
            if (!delta || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTextEntryTarget(e.target)) return false;
            const plot = over && over.isConnected ? over : plotOf(e.target);
            // A key goes to the focused element: a lane with the focus moves its cursor, as its arrows always have.
            if (!plot || (selectors.focusKeepsArrows && plot === e.target) || !handlers.step(plot, delta)) return false;
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
