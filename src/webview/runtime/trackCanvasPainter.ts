import type { SpectrogramData, WaveformEnvelope } from '../../shared/analysis/analysisTypes';
import { dbToRgb } from '../draw/canvasDrawers';
import { paintSpectrogramRaster, type SpectrogramRasterView } from './spectrogramRaster';
import { paintColourBar, type ColourBarBox, type StageLayer, type StageOverlay } from './stagePanes';
import type { StageView } from '../../shared/protocol/backendProtocol';

export function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

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

/** Where a track sits on the lanes' time axis: the whole axis in seconds, and the track's place on it (fractions). */
export interface LanePlacement {
    startSec: number;
    spanSec: number;
    offsetNorm: number;
    trackDurRatio: number;
}

/** A lane's waveform as the plot component draws it: the pictures in seconds on the lanes' time axis, and that axis. */
export interface LaneWaveformOverlay {
    overlay: StageOverlay;
    /** The whole time axis the lanes share, for paintOverlay's axisView. */
    axisView: StageView;
    /** A time on that axis back to the file's 0..1 (where a lane point is in its file). */
    fileNormOf(seconds: number): number;
}

/**
 * The lane's waveform as signal layers for paintOverlay (R13): the envelope's times placed on the lanes' time axis,
 * in seconds. Finer data over part of the view (`detail`) is drawn over its own stretch, the overview only around it,
 * so the lines on screen keep their detail until the next range lands.
 */
export function laneWaveformOverlay(src: WaveformPaintSource | null, place: LanePlacement, color: string, unit: string): LaneWaveformOverlay {
    const toSec = (fileNorm: number): number => place.startSec + (place.offsetNorm + fileNorm * place.trackDurRatio) * place.spanSec;
    const axisLow = place.startSec, axisHigh = place.startSec + place.spanSec;
    const axisView: StageView = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', xs: [axisLow, axisHigh], values: [0, 0] };
    const fileStart = toSec(0), fileSpan = toSec(1) - fileStart || 1;
    const fileNormOf = (seconds: number): number => (seconds - fileStart) / fileSpan;
    if (!src) return { overlay: { layers: [] }, axisView, fileNormOf };
    const layerOf = (part: WaveformPaintSource, span?: readonly [number, number]): StageLayer => {
        const envelope = part.waveform;
        const count = Math.max(envelope.min?.length ?? 0, envelope.max?.length ?? 0, envelope.samples?.length ?? 0);
        const range = part.dataEnd - part.dataStart;
        // A bucket without its times sits at its place across the part's stretch, as the lanes always placed it.
        const times = (given: readonly number[] | undefined): number[] => Array.from({ length: count }, (_, index) => toSec(given?.[index] ?? part.dataStart + index / Math.max(1, count) * range));
        const values = (given: readonly number[] | undefined): number[] => Array.from({ length: count }, (_, index) => given?.[index] ?? envelope.samples?.[index] ?? 0);
        // The axis is in the channel's unit: the amplitude scale the lane's range was made from is the peak's.
        const waveform = { min: values(envelope.min), max: values(envelope.max), minT: times(envelope.minT), maxT: times(envelope.maxT),
            absolutePeak: part.amplitudeScale ?? envelope.absolutePeak, unit, ref: 1 };
        return { view: { ...axisView, waveform }, color, ...(span ? { span } : {}) };
    };
    const detail = src.detail;
    if (!detail) return { overlay: { layers: [layerOf(src)] }, axisView, fileNormOf };
    const from = toSec(detail.dataStart), to = toSec(detail.dataEnd);
    const around = axisHigh - axisLow;
    return {
        overlay: { layers: [layerOf(src, [axisLow - around, from]), layerOf(src, [to, axisHigh + around]), layerOf(detail, [from, to])] },
        axisView,
        fileNormOf,
    };
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
