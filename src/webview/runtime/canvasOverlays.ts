import { amplitudeNormToCanvasY, type NormalizedRange } from './waveformInteraction';
import type { RectZoomSelection } from './types';

interface DashedLineStyle {
    color: string;
    alpha: number;
}

export const CURSOR_LINE_STYLE: DashedLineStyle = { color: '#ffffff', alpha: 0.7 };
export const HOVER_LINE_STYLE: DashedLineStyle = { color: '#aaaaaa', alpha: 0.4 };

export interface CanvasTimeHit {
    x: number;
    timeWidth: number;
    norm: number;
}

/** Maps a pointer X to normalized file time; null when it falls outside the time axis (e.g. on the colorbar). */
export function canvasTimeHit(rectLeft: number, clientX: number, timeWidth: number, view: NormalizedRange): CanvasTimeHit | null {
    const x = clientX - rectLeft;
    if (x < 0 || x > timeWidth) {
        return null;
    }
    return { x, timeWidth, norm: view.start + (x / timeWidth) * (view.end - view.start) };
}

export interface ClientRectLike {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Converts client coordinates to canvas backing-store pixels, so hit tests stay correct when CSS scales the canvas. */
export function clientToCanvasPixels(clientX: number, clientY: number, rect: ClientRectLike, width: number, height: number): { x: number; y: number } {
    return {
        x: (clientX - rect.left) * (width / (rect.width || width)),
        y: (clientY - rect.top) * (height / (rect.height || height)),
    };
}

export function clampedCanvasNorm(rectLeft: number, clientX: number, timeWidth: number, view: NormalizedRange): number {
    const x = Math.max(0, Math.min(timeWidth, clientX - rectLeft));
    return Math.max(0, Math.min(1, view.start + (x / timeWidth) * (view.end - view.start)));
}

export function formatReadoutHz(hz: number): string {
    const rounded = Math.round(hz);
    const value = Math.abs(hz - rounded) < 0.05 ? String(rounded) : hz.toFixed(1);
    return value + ' Hz';
}

export function drawDashedTimeLine(
    ctx: CanvasRenderingContext2D,
    norm: number,
    view: NormalizedRange,
    width: number,
    height: number,
    style: DashedLineStyle,
): void {
    const span = view.end - view.start;
    if (span <= 0) {
        return;
    }
    const x = (norm - view.start) / span * width;
    if (x < 0 || x > width) {
        return;
    }
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.globalAlpha = style.alpha;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.restore();
}

export function drawRectZoomSelection(
    ctx: CanvasRenderingContext2D,
    selection: RectZoomSelection,
    view: NormalizedRange,
    amplitude: NormalizedRange,
    width: number,
    height: number,
): void {
    const span = view.end - view.start;
    if (span <= 0) {
        return;
    }
    const x0 = (selection.startNorm - view.start) / span * width;
    const x1 = (selection.endNorm - view.start) / span * width;
    const y0 = amplitudeNormToCanvasY(selection.startAmpNorm, height, amplitude.start, amplitude.end);
    const y1 = amplitudeNormToCanvasY(selection.endAmpNorm, height, amplitude.start, amplitude.end);
    const left = Math.max(0, Math.min(x0, x1));
    const right = Math.min(width, Math.max(x0, x1));
    const top = Math.max(0, Math.min(y0, y1));
    const bottom = Math.min(height, Math.max(y0, y1));
    if (right <= left || bottom <= top) {
        return;
    }
    ctx.save();
    ctx.fillStyle = 'rgba(100, 160, 255, 0.16)';
    ctx.strokeStyle = 'rgba(100, 160, 255, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.restore();
}
