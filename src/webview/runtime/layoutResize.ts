/**
 * Calls `onResize` when the window or any of the listed elements changes size. Elements are observed
 * individually because a track pane can change width (splitter, sidebar) without a window resize.
 */
export function installLayoutResizeHandling(
    win: Pick<Window, 'addEventListener'>,
    doc: Document,
    elementIds: readonly string[],
    onResize: () => void,
    Observer: typeof ResizeObserver | undefined,
): void {
    win.addEventListener('resize', onResize);
    if (!Observer) {
        return;
    }
    const observer = new Observer(function () { onResize(); });
    elementIds.forEach(function (id) {
        const el = doc.getElementById(id);
        if (el) {
            observer.observe(el);
        }
    });
}
