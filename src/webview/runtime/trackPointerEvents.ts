export interface TrackPointerHandlers {
    resetZoom(): void;
    hover(e: MouseEvent): void;
    clearHover(): void;
    press(e: MouseEvent): void;
    drag(e: MouseEvent): void;
    release(e: MouseEvent): void;
    zoomWheel(e: WheelEvent): void;
    panWheel(e: WheelEvent): void;
}

type PointerSurface = Pick<HTMLElement, 'addEventListener'>;

export function attachTrackPointerListeners(tracksWrapper: PointerSurface, doc: Pick<Document, 'addEventListener'>, handlers: TrackPointerHandlers): void {
    tracksWrapper.addEventListener('dblclick', function (e) {
        const target = e.target as Partial<Element> | null;
        if (target && target.closest && target.closest('.track-canvas, .track-axis-canvas')) {
            handlers.resetZoom();
        }
    });
    tracksWrapper.addEventListener('mousemove', function (e) { handlers.hover(e); });
    tracksWrapper.addEventListener('mouseleave', function () { handlers.clearHover(); });
    tracksWrapper.addEventListener('mousedown', function (e) { handlers.press(e); });
    doc.addEventListener('mousemove', function (e) { handlers.drag(e); });
    doc.addEventListener('mouseup', function (e) { handlers.release(e); });
    tracksWrapper.addEventListener('wheel', function (e) {
        if (e.ctrlKey) {
            e.preventDefault();
            handlers.zoomWheel(e);
        }
        else if (e.shiftKey) {
            e.preventDefault();
            handlers.panWheel(e);
        }
    }, { passive: false });
}
