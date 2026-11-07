import { clientToCanvasPixels } from './canvasOverlays';
import type { HintFooter } from './hintFooter';
import { overlaySpectrumRegionAt, type OverlaySpectrumRegion } from './spectrumRuntime';

type OverlayCanvas = Pick<HTMLCanvasElement, 'width' | 'height' | 'getBoundingClientRect' | 'addEventListener'>;

export type OverlaySpectrumHints = Record<Exclude<OverlaySpectrumRegion, null>, string>;

export function attachOverlaySpectrumHints(canvas: OverlayCanvas, footer: Pick<HintFooter, 'show' | 'clear'>, hints: OverlaySpectrumHints): void {
    canvas.addEventListener('mousemove', function (e) {
        const px = clientToCanvasPixels(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
        const region = overlaySpectrumRegionAt(px.x, px.y, canvas.width, canvas.height);
        if (region) {
            footer.show(hints[region]);
        }
        else {
            footer.clear();
        }
    });
}
