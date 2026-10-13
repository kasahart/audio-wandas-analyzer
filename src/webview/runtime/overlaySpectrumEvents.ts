import { clientToCanvasPixels } from './canvasOverlays';
import { overlaySpectrumRegionAt } from './spectrumRuntime';

export interface OverlaySpectrumDoubleClickHandlers {
    hasData(): boolean;
    openRangePopup(axis: 'db' | 'freq', clientX: number, clientY: number): void;
    resetZoom(): void;
}

type OverlayCanvas = Pick<HTMLCanvasElement, 'width' | 'height' | 'getBoundingClientRect' | 'addEventListener'>;

export function attachOverlaySpectrumDoubleClick(canvas: OverlayCanvas, handlers: OverlaySpectrumDoubleClickHandlers): void {
    canvas.addEventListener('dblclick', function (e) {
        if (!handlers.hasData()) {
            return;
        }
        const px = clientToCanvasPixels(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
        const region = overlaySpectrumRegionAt(px.x, px.y, canvas.width, canvas.height);
        if (region === 'db-axis') {
            handlers.openRangePopup('db', e.clientX, e.clientY);
        }
        else if (region === 'freq-axis') {
            handlers.openRangePopup('freq', e.clientX, e.clientY);
        }
        else if (region === 'plot') {
            handlers.resetZoom();
        }
    });
}
