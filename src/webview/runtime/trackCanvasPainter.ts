import type { SpectrogramData, WaveformEnvelope } from '../../shared/analysis/analysisTypes';
import { drawSpectrogramColorbar, type DrawTheme } from '../draw/canvasDrawers';
import { paintSpectrogramRaster, type SpectrogramRasterView } from './spectrogramRaster';
import type { RuntimeWindow, WaveformCoverage } from './types';
import { traceXExtent, waveformCoverageFromExtent } from './waveformCoverage';

export const SPECTROGRAM_COLORBAR_WIDTH = 50;

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
            pipeline(ctx, W, H, src.waveform, { ...view, dataStart: src.dataStart, dataEnd: src.dataEnd, color, amplitudeScale: src.amplitudeScale });
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

/** Repaints the raster and colorbar only when the spectrogram or its view changed; otherwise the canvas keeps the previous pixels. */
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
    const key = [plotW, H, view.zoomStart, view.zoomEnd, view.trackStart, view.trackDurRatio, view.dbLo, view.dbHi, view.maxFrequencyHz].join(':');
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
