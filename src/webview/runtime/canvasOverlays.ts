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
    amplitude: NormalizedRange & { explicit?: boolean },
    width: number,
    height: number,
): void {
    const span = view.end - view.start;
    if (span <= 0) {
        return;
    }
    const x0 = (selection.startNorm - view.start) / span * width;
    const x1 = (selection.endNorm - view.start) / span * width;
    const y0 = amplitudeNormToCanvasY(selection.startAmpNorm, height, amplitude.start, amplitude.end, amplitude.explicit);
    const y1 = amplitudeNormToCanvasY(selection.endAmpNorm, height, amplitude.start, amplitude.end, amplitude.explicit);
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

export interface AnalysisWindowBand {
    startNorm: number;
    endNorm: number;
    window?: string;
}

const ANALYSIS_WINDOW_COLOR = '255, 190, 70';
const ANALYSIS_WINDOW_MIN_PX = 3;
const ANALYSIS_WINDOW_CURVE_MIN_PX = 12;

/** Weight of the named STFT window at phase 0..1, matching the backend's window names. */
export function analysisWindowWeight(window: string | undefined, phase: number): number {
    const a = 2 * Math.PI * phase;
    switch (window) {
        case 'hann': return 0.5 - 0.5 * Math.cos(a);
        case 'hamming': return 0.54 - 0.46 * Math.cos(a);
        case 'blackman': return Math.max(0, 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a));
        default: return 1;
    }
}

/**
 * Shades the samples behind the cursor-linked spectrum and draws the window's weighting curve over them,
 * so the parts of the waveform the window suppresses stay visible. Narrow bands keep a minimum width.
 */
export function drawAnalysisWindowBand(
    ctx: CanvasRenderingContext2D,
    band: AnalysisWindowBand,
    view: NormalizedRange,
    width: number,
    height: number,
): void {
    const span = view.end - view.start;
    if (span <= 0 || !(band.endNorm > band.startNorm)) {
        return;
    }
    const x0 = (band.startNorm - view.start) / span * width;
    const x1 = (band.endNorm - view.start) / span * width;
    if (x1 < 0 || x0 > width) {
        return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    if (x1 - x0 < ANALYSIS_WINDOW_CURVE_MIN_PX) {
        const mid = (x0 + x1) / 2;
        const half = Math.max(ANALYSIS_WINDOW_MIN_PX, x1 - x0) / 2;
        ctx.fillStyle = 'rgba(' + ANALYSIS_WINDOW_COLOR + ', 0.45)';
        ctx.fillRect(mid - half, 0, half * 2, height);
        ctx.restore();
        return;
    }
    ctx.fillStyle = 'rgba(' + ANALYSIS_WINDOW_COLOR + ', 0.08)';
    ctx.fillRect(x0, 0, x1 - x0, height);
    const steps = Math.max(8, Math.min(256, Math.ceil(x1 - x0)));
    // Mirrored about the centre line, the curve reads as the envelope the window imposes on the waveform.
    const centre = height / 2;
    const reach = centre - height * 0.04;
    const xAt = (i: number) => x0 + (i / steps) * (x1 - x0);
    const offsetAt = (i: number) => analysisWindowWeight(band.window, i / steps) * reach;
    ctx.beginPath();
    ctx.moveTo(x0, centre);
    for (let i = 0; i <= steps; i++) {
        ctx.lineTo(xAt(i), centre - offsetAt(i));
    }
    for (let i = steps; i >= 0; i--) {
        ctx.lineTo(xAt(i), centre + offsetAt(i));
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(' + ANALYSIS_WINDOW_COLOR + ', 0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(' + ANALYSIS_WINDOW_COLOR + ', 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}
