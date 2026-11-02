/**
 * A canvas is drawn at the size it has then. One resized afterwards by a layout change (a panel shown beside or under
 * it, the step bar grown, the window narrowed past a breakpoint) would show its bitmap stretched, under hover marks
 * drawn at the new size. A plot watched here is drawn again at the size it now has, whatever resized it.
 */

/** A canvas on screen whose bitmap is not the size it is shown at (CSS pixels × devicePixelRatio). */
export function drawnAtOtherSize(canvas: HTMLCanvasElement): boolean {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (width === 0 || height === 0) return false;
    const ratio = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    return Math.abs(canvas.width - Math.round(width * ratio)) > 1 || Math.abs(canvas.height - Math.round(height * ratio)) > 1;
}

/** Calls `redraw` when one of `canvases` is resized to another size than it was drawn at. */
export function redrawWhenResized(Observer: typeof ResizeObserver | undefined, canvases: Iterable<HTMLCanvasElement>, redraw: () => void): void {
    if (!Observer) return;
    const observer = new Observer(entries => {
        if (entries.some(entry => drawnAtOtherSize(entry.target as HTMLCanvasElement))) redraw();
    });
    for (const canvas of canvases) observer.observe(canvas);
}
