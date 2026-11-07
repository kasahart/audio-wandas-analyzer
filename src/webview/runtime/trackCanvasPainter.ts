import type { SpectrogramData, WaveformEnvelope } from '../../shared/analysis/analysisTypes';
import { dbToRgb } from '../draw/canvasDrawers';
import { paintSpectrogramRaster, type SpectrogramRasterView } from './spectrogramRaster';
import { paintColourBar, type ColourBarBox } from './stagePanes';
import type { RuntimeWindow, WaveformCoverage } from './types';
import { traceXExtent, waveformCoverageFromExtent } from './waveformCoverage';
import type { LanePoint } from './trackLaneHover';

export function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

export type WaveformPipeline = NonNullable<RuntimeWindow['renderWaveformPipeline']>;

export interface WaveformPaintSource {
    waveform: WaveformEnvelope;
    dataStart: number;
    dataEnd: number;
    amplitudeScale: number | undefined;
    /**
     * Finer data over part of the view (a range fetched before a zoom out or a long pan): drawn over its own
     * span while `waveform` fills the rest, so the lines on screen keep their detail until the next range lands.
     */
    detail?: WaveformPaintSource;
}

export interface WaveformPaintView {
    zoomStart: number;
    zoomEnd: number;
    offsetNorm: number;
    trackDurRatio: number;
    amplitudeMinNorm: number | undefined;
    amplitudeMaxNorm: number | undefined;
}

export function paintTrackWaveform(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    color: string,
    src: WaveformPaintSource | null,
    view: WaveformPaintView,
    pipeline: WaveformPipeline | undefined,
    /** Filled with the points drawn on the canvas, for the pointer to read (trackLaneHover.ts). */
    points?: LanePoint[],
): WaveformCoverage | null {
    ctx.strokeStyle = hexToRgba(color, 0.25);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    if (!src || !pipeline) {
        return null;
    }
    // Each part keeps the points it draws inside its own span (a clip), on the canvas.
    const collect = (from: number, to: number) => points
        ? { onPoint: (x: number, y: number, value: number, t: number) => { if (x >= from && x <= to && y >= 0 && y <= H) points.push({ x, y, value, t }); } }
        : {};
    const extent = traceXExtent(ctx, function () {
        ctx.save();
        try {
            const detail = src.detail;
            if (!detail) {
                pipeline(ctx, W, H, src.waveform, { ...view, dataStart: src.dataStart, dataEnd: src.dataEnd, color, amplitudeScale: src.amplitudeScale, ...collect(0, W) });
                return;
            }
            const span = Math.max(view.zoomEnd - view.zoomStart, 1e-12);
            const xAt = (fileNorm: number) => (view.offsetNorm + fileNorm * view.trackDurRatio - view.zoomStart) / span * W;
            // Whole pixels, so the two clips meet without an anti-aliased crack between them.
            const x0 = Math.max(0, Math.min(W, Math.round(xAt(detail.dataStart))));
            const x1 = Math.max(x0, Math.min(W, Math.round(xAt(detail.dataEnd))));
            const clipped = (rects: Array<[number, number]>, part: WaveformPaintSource) => {
                const own = points ? (x: number, y: number, value: number, t: number) => {
                    if (y >= 0 && y <= H && rects.some(([from, to]) => to > from && x >= from && x < to)) points.push({ x, y, value, t });
                } : undefined;
                ctx.save();
                try {
                    ctx.beginPath();
                    rects.forEach(([from, to]) => { if (to > from) ctx.rect(from, 0, to - from, H); });
                    ctx.clip();
                    pipeline(ctx, W, H, part.waveform, { ...view, dataStart: part.dataStart, dataEnd: part.dataEnd, color, amplitudeScale: part.amplitudeScale, ...(own ? { onPoint: own } : {}) });
                }
                finally {
                    ctx.restore();
                }
            };
            clipped([[0, x0], [x1, W]], src);
            clipped([[x0, x1]], detail);
        }
        finally {
            ctx.restore();
        }
    });
    return waveformCoverageFromExtent(extent, W);
}

export interface SpectrogramRasterCacheEntry {
    source: SpectrogramData;
    key: string;
    /** Where its colour bar is on the canvas. */
    colourBar: ColourBarBox;
}

/** The colour bar's look: its text in the axes' colour on the lane's background, framed as the axes are. */
export interface SpectrogramColourBarStyle {
    /** What the colour measures, with its unit and reference, as the comparison's heatmaps name it. */
    title: string;
    text: string;
    back: string;
    line: string;
}

/**
 * Repaints the raster and its colour bar only when the spectrogram, its view or the look changed; otherwise the canvas
 * keeps the previous pixels. The raster takes the whole width, as every lane's time axis does, and the colour bar is
 * the one every coloured picture draws (paintColourBar), in the plot's top right (R13).
 */
export function paintTrackSpectrogram(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    spec: SpectrogramData,
    view: SpectrogramRasterView,
    cached: SpectrogramRasterCacheEntry | undefined,
    style: SpectrogramColourBarStyle,
): SpectrogramRasterCacheEntry {
    const key = [W, H, view.zoomStart, view.zoomEnd, view.trackStart, view.trackDurRatio, view.dbLo, view.dbHi, view.maxFrequencyHz, view.minFrequencyHz, view.durationSec, style.title, style.text, style.back, style.line].join(':');
    if (cached && cached.source === spec && cached.key === key) {
        return cached;
    }
    ctx.clearRect(0, 0, W, H);
    const imageData = ctx.createImageData(W, H);
    paintSpectrogramRaster(spec, W, H, view, imageData.data);
    ctx.putImageData(imageData, 0, 0);
    ctx.font = '10px sans-serif';
    const colourBar = paintColourBar(ctx, { left: 4, right: W - 4, top: 3 }, style.title, view.dbLo.toFixed(0), view.dbHi.toFixed(0), fraction => {
        const [r, g, b] = dbToRgb(fraction);
        return `rgb(${r}, ${g}, ${b})`;
    }, style);
    return { source: spec, key, colourBar };
}

/** Whether (x, y), in the canvas's own pixels, is on the colour bar last painted there. */
export function onColourBar(entry: Pick<SpectrogramRasterCacheEntry, 'colourBar'> | undefined, x: number, y: number): boolean {
    const box = entry?.colourBar;
    return !!box && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/**
 * Each lane's plot as last painted, before the lines that follow the cursor are drawn over it. A playback frame
 * copies it back instead of tracing the waveform again: stroking thousands of points per lane every frame was most of
 * what kept the main thread busy without GPU compositing.
 */
export class PaintedLayerCache {
    private readonly layers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

    constructor(private readonly createCanvas: () => HTMLCanvasElement) {}

    /** Keeps what `canvas` shows now. */
    keep(canvas: HTMLCanvasElement): void {
        let layer = this.layers.get(canvas);
        if (!layer) {
            layer = this.createCanvas();
            this.layers.set(canvas, layer);
        }
        if (layer.width !== canvas.width || layer.height !== canvas.height) {
            layer.width = canvas.width;
            layer.height = canvas.height;
        }
        const layerCtx = layer.getContext('2d');
        if (!layerCtx) {
            this.layers.delete(canvas);
            return;
        }
        layerCtx.clearRect(0, 0, layer.width, layer.height);
        layerCtx.drawImage(canvas, 0, 0);
    }

    /** Puts the kept plot back on `canvas`; false (and nothing drawn) when none is kept at its current size. */
    restore(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): boolean {
        const layer = this.layers.get(canvas);
        if (!layer || layer.width !== canvas.width || layer.height !== canvas.height) {
            return false;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(layer, 0, 0);
        return true;
    }

    forget(canvas: HTMLCanvasElement): void {
        this.layers.delete(canvas);
    }
}
