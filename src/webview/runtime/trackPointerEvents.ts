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
}

type PointerSurface = Pick<HTMLElement, 'addEventListener'>;

/** Which elements are plots (a double-click resets their zoom) and which are axes (it opens their range). */
export interface PlotSelectors {
    plot: string;
    axis?: string;
}

/** Wheel events further apart than this start a new swipe. */
const SWIPE_PAUSE_MS = 150;

const TRACK_SELECTORS: PlotSelectors = { plot: '.track-canvas', axis: '.track-axis-canvas' };

/**
 * The analyzer's pointer gestures on its plots, as the track lanes define them: hover, press–drag–release
 * (followed on the document), Ctrl+wheel to zoom, Shift+wheel or a sideways swipe on a plot to pan, double-click
 * to reset (or, on an axis, to set its range). The comparison's panes use the same listeners through plotInteraction.ts.
 */
export function attachTrackPointerListeners(tracksWrapper: PointerSurface, doc: Pick<Document, 'addEventListener'>, handlers: TrackPointerHandlers, selectors: PlotSelectors = TRACK_SELECTORS): void {
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
    tracksWrapper.addEventListener('mousemove', function (e) { handlers.hover(e); });
    tracksWrapper.addEventListener('mouseleave', function () { handlers.clearHover(); });
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
