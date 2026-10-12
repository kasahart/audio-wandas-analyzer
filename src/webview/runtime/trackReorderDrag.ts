import { eventTarget } from './domAdapter';
import type { RuntimeDocument, RuntimeElement, TrackId } from './types';

export interface TrackReorderDragOptions {
    trackIdFromElement(element: RuntimeElement): TrackId | null;
    rowFor(trackId: TrackId): HTMLElement | null;
    onReorder(fromTrackId: TrackId, toTrackId: TrackId): void;
}

export function installTrackReorderDrag(document: RuntimeDocument, wrap: HTMLElement, options: TrackReorderDragOptions): void {
    let dragFrom: TrackId | null = null;

    function rowAt(e: Event): RuntimeElement | null {
        const target = eventTarget(e);
        return target.closest ? target.closest('.track-row') : null;
    }
    function clearDragOver(): void {
        document.querySelectorAll('.track-row').forEach(row => row.classList.remove('drag-over'));
    }
    function cleanup(): void {
        if (dragFrom !== null) {
            const row = options.rowFor(dragFrom);
            if (row) {
                row.style.opacity = '';
            }
        }
        clearDragOver();
        dragFrom = null;
    }

    wrap.addEventListener('dragstart', function (e: DragEvent) {
        const target = eventTarget(e);
        const handle = target.closest ? target.closest('.track-drag-handle') : null;
        if (!handle) {
            e.preventDefault();
            return;
        }
        dragFrom = options.trackIdFromElement(handle);
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
        }
        const row = dragFrom === null ? null : options.rowFor(dragFrom);
        if (row) {
            row.style.opacity = '0.4';
        }
    });
    wrap.addEventListener('dragover', function (e: DragEvent) {
        if (dragFrom === null) {
            return;
        }
        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
        const row = rowAt(e);
        clearDragOver();
        if (row) {
            const toId = options.trackIdFromElement(row);
            if (toId && toId !== dragFrom) {
                row.classList.add('drag-over');
            }
        }
    });
    wrap.addEventListener('drop', function (e: DragEvent) {
        if (dragFrom === null) {
            return;
        }
        e.preventDefault();
        const row = rowAt(e);
        if (row) {
            const toId = options.trackIdFromElement(row);
            if (toId && toId !== dragFrom) {
                options.onReorder(dragFrom, toId);
            }
        }
        cleanup();
    });
    wrap.addEventListener('dragend', cleanup);
}
