import { type NormalizedRange } from './waveformInteraction';

interface DashedLineStyle {
    color: string;
    alpha: number;
}

export const CURSOR_LINE_STYLE: DashedLineStyle = { color: '#ffffff', alpha: 0.7 };

/** The cursor over a waveform lane takes the theme's text colour: white vanishes on a light lane. */
export function waveformCursorLineStyle(textColor: string): DashedLineStyle {
    return textColor ? { color: textColor, alpha: CURSOR_LINE_STYLE.alpha } : CURSOR_LINE_STYLE;
}

export interface ClientRectLike {
    left: number;
    top: number;
    width: number;
    height: number;
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

export interface AnalysisWindowBand {
    startNorm: number;
    endNorm: number;
    window?: string;
}

/** The band's colour, for a dark and a light lane: a neutral grey, since every hue is a role's (R5). */
export const ANALYSIS_WINDOW_COLORS = { dark: '201, 209, 217', light: '87, 96, 106' } as const;
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
    light = false,
): void {
    const color = light ? ANALYSIS_WINDOW_COLORS.light : ANALYSIS_WINDOW_COLORS.dark;
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
        ctx.fillStyle = 'rgba(' + color + ', 0.45)';
        ctx.fillRect(mid - half, 0, half * 2, height);
        ctx.restore();
        return;
    }
    ctx.fillStyle = 'rgba(' + color + ', 0.08)';
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
    ctx.fillStyle = 'rgba(' + color + ', 0.18)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(' + color + ', 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

/**
 * A layer laid over a box of several plots (a Tracks row's Figure: its waveform and spectrogram lanes): sized to the
 * box in device pixels, cleared, then `paint` is called once a plot, drawing in that plot's own pixels (its top left
 * at 0, 0) and cut to it. `plots`: where each was drawn in the box (CSS px).
 */
export function paintOverPlots(
    layer: HTMLCanvasElement, box: { width: number; height: number }, ratio: number,
    plots: ReadonlyArray<{ id: string; frame: { left: number; top: number; width: number; height: number } }>,
    paint: (ctx: CanvasRenderingContext2D, width: number, height: number, plot: string) => void,
): void {
    const ctx = layer.getContext('2d');
    if (!ctx) return;
    const width = Math.max(1, Math.round(box.width * ratio)), height = Math.max(1, Math.round(box.height * ratio));
    if (layer.width !== width) layer.width = width;
    if (layer.height !== height) layer.height = height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const plot of plots) {
        const w = Math.round(plot.frame.width * ratio), h = Math.round(plot.frame.height * ratio);
        ctx.save();
        ctx.translate(Math.round(plot.frame.left * ratio), Math.round(plot.frame.top * ratio));
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();
        paint(ctx, w, h, plot.id);
        ctx.restore();
    }
}

/**
 * The loop region over a row: what is outside it dimmed, the region tinted, a grip line and a corner mark at each
 * end. `loopStart`/`loopEnd` and the window shown (`zoomStart`..`zoomEnd`) are fractions of the timeline.
 */
export function paintLoopRegion(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    loopStart: number,
    loopEnd: number,
    zoomStart: number,
    zoomEnd: number,
): void {
    if (loopStart >= loopEnd) { return; }
    const span = zoomEnd - zoomStart;
    if (span <= 0) { return; }
    const toX = (norm: number) => (norm - zoomStart) / span * W;
    const x0 = toX(loopStart);
    const x1 = toX(loopEnd);
    const left = Math.max(0, x0);
    const right = Math.min(W, x1);
    if (right <= left) { return; }

    ctx.save();
    ctx.setLineDash([]);

    // 区間外を暗く
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, left, H);
    ctx.fillRect(right, 0, W - right, H);

    // 区間内を青くハイライト
    ctx.fillStyle = 'rgba(100, 160, 255, 0.15)';
    ctx.fillRect(left, 0, right - left, H);

    // グリップハンドル（縦線）
    ctx.strokeStyle = 'rgba(100, 160, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(left, H);
    ctx.moveTo(right, 0);
    ctx.lineTo(right, H);
    ctx.stroke();

    // 三角マーカー
    const TH = 8;
    ctx.fillStyle = 'rgba(100, 160, 255, 0.9)';
    ctx.beginPath();
    ctx.moveTo(left, 0);
    ctx.lineTo(left + TH, 0);
    ctx.lineTo(left, TH);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(right, 0);
    ctx.lineTo(right - TH, 0);
    ctx.lineTo(right, TH);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}
