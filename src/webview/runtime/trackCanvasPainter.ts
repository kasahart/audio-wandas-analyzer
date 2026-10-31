import type { SpectrogramData, WaveformEnvelope } from '../../shared/analysis/analysisTypes';
import { drawSpectrogramColorbar, SPECTROGRAM_COLORBAR_WIDTH, type DrawTheme } from '../draw/canvasDrawers';
import { paintSpectrogramRaster, type SpectrogramRasterView } from './spectrogramRaster';
import type { RuntimeWindow, WaveformCoverage } from './types';
import { traceXExtent, waveformCoverageFromExtent } from './waveformCoverage';

export function spectrogramPlotWidth(canvasWidth: number): number {
    return Math.max(1, canvasWidth - SPECTROGRAM_COLORBAR_WIDTH);
}

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
    const extent = traceXExtent(ctx, function () {
        ctx.save();
        try {
            const detail = src.detail;
            if (!detail) {
                pipeline(ctx, W, H, src.waveform, { ...view, dataStart: src.dataStart, dataEnd: src.dataEnd, color, amplitudeScale: src.amplitudeScale });
                return;
            }
            const span = Math.max(view.zoomEnd - view.zoomStart, 1e-12);
            const xAt = (fileNorm: number) => (view.offsetNorm + fileNorm * view.trackDurRatio - view.zoomStart) / span * W;
            // Whole pixels, so the two clips meet without an anti-aliased crack between them.
            const x0 = Math.max(0, Math.min(W, Math.round(xAt(detail.dataStart))));
            const x1 = Math.max(x0, Math.min(W, Math.round(xAt(detail.dataEnd))));
            const clipped = (rects: Array<[number, number]>, part: WaveformPaintSource) => {
                ctx.save();
                try {
                    ctx.beginPath();
                    rects.forEach(([from, to]) => { if (to > from) ctx.rect(from, 0, to - from, H); });
                    ctx.clip();
                    pipeline(ctx, W, H, part.waveform, { ...view, dataStart: part.dataStart, dataEnd: part.dataEnd, color, amplitudeScale: part.amplitudeScale });
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
}

/** Repaints the raster and colorbar only when the spectrogram, its view or the theme changed; otherwise the canvas keeps the previous pixels. */
export function paintTrackSpectrogram(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    spec: SpectrogramData,
    view: SpectrogramRasterView,
    cached: SpectrogramRasterCacheEntry | undefined,
    theme: DrawTheme,
): SpectrogramRasterCacheEntry {
    const plotW = spectrogramPlotWidth(W);
    const key = [plotW, H, view.zoomStart, view.zoomEnd, view.trackStart, view.trackDurRatio, view.dbLo, view.dbHi, view.maxFrequencyHz, view.minFrequencyHz, view.durationSec, theme.bgColor, theme.mutedColor].join(':');
    if (cached && cached.source === spec && cached.key === key) {
        return cached;
    }
    ctx.clearRect(0, 0, W, H);
    const imageData = ctx.createImageData(plotW, H);
    paintSpectrogramRaster(spec, plotW, H, view, imageData.data);
    ctx.putImageData(imageData, 0, 0);
    drawSpectrogramColorbar(ctx, W, H, spec, { dbLo: view.dbLo, dbHi: view.dbHi }, theme);
    return { source: spec, key };
}
