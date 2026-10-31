import type { CanvasSyncOptions } from './types';

export interface SizableCanvas {
    width: number;
    height: number;
    style: { width: string; height: string };
}

/** Writes only the properties that changed: assigning canvas.width/height clears the bitmap even when the value is equal. */
export function syncCanvasSize(canvas: SizableCanvas, width: number, height: number, options: CanvasSyncOptions = {}): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const syncStyle = options.syncStyle !== false;
    if (syncStyle && canvas.style.width !== w + 'px') {
        canvas.style.width = w + 'px';
    }
    if (syncStyle && canvas.style.height !== h + 'px') {
        canvas.style.height = h + 'px';
    }
    if (canvas.width !== w) {
        canvas.width = w;
    }
    if (canvas.height !== h) {
        canvas.height = h;
    }
}

/** Measures every item before writing any, so a pass over many elements forces one layout instead of one each. */
export function readThenWrite<T, M>(items: readonly T[], read: (item: T) => M, write: (item: T, measured: M) => void): void {
    const measured = items.map(item => read(item));
    items.forEach((item, k) => write(item, measured[k]));
}

export interface HorizontalPadding {
    paddingLeft: string;
    paddingRight: string;
}

export function contentBoxWidth(el: { clientWidth: number } | null, fallback: number, style: HorizontalPadding | null): number {
    if (!el || !el.clientWidth) {
        return fallback;
    }
    const padL = style ? parseFloat(style.paddingLeft || '0') || 0 : 0;
    const padR = style ? parseFloat(style.paddingRight || '0') || 0 : 0;
    return Math.max(1, el.clientWidth - padL - padR);
}
