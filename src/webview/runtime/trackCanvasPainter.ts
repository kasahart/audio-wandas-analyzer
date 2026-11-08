import type { SpectrogramData, WaveformEnvelope } from '../../shared/analysis/analysisTypes';
import { viridis, type AxisTick } from '../../shared/gui-core/index';
import { spectrogramTimeBinEdges } from '../spectrum/spectrogramTimeBins';
import { paintOverlay, paintSideAxis, type ColourBarBox, type StageLayer, type StageOverlay } from './stagePanes';
import type { NormalizedRange } from './waveformInteraction';
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
    /** Its frequency axis' ticks, to draw the side axis again while the picture is kept. */
    ticks: AxisTick[];
}

/** What a spectrogram lane shows: the time on screen (fractions of the lanes' axis), its frequency band and colour range. */
export interface LaneSpectrogramView {
    window: NormalizedRange;
    minFrequencyHz: number;
    maxFrequencyHz: number;
    dbLo: number;
    dbHi: number;
    /** The track's duration: with the frame centres it places each cell on its STFT window. */
    durationSec: number;
}

/** The names on a spectrogram lane: what the colour measures (as the comparison's heatmaps name it), its frequency axis, and the time axis. */
export interface LaneSpectrogramTitles {
    colour: string;
    frequency: string;
    time: string;
}

const laneMatrices = new WeakMap<SpectrogramData, number[][]>();

/**
 * A track's spectrogram as a heatmap picture on the lanes' time axis (R13): its frames' centres in seconds there, its
 * bins in Hz up a linear axis (the lanes' frequency axis is linear), its levels as rows of frequency.
 */
export function laneSpectrogramView(spec: SpectrogramData, place: LanePlacement, durationSec: number): StageView {
    const toSec = (fileNorm: number): number => place.startSec + (place.offsetNorm + fileNorm * place.trackDurRatio) * place.spanSec;
    const count = spec.timeBins, bins = spec.frequencyBins;
    const edges = spectrogramTimeBinEdges(spec, durationSec);
    const centres = spec.timeCentersSec;
    const xs = Array.from({ length: count }, (_, k) => toSec(edges && centres ? centres[k] / durationSec : (k + 0.5) / Math.max(1, count)));
    const ys = Array.from({ length: bins }, (_, bin) => (bins > 1 ? bin / (bins - 1) : 0) * spec.maxFrequencyHz);
    let matrix = laneMatrices.get(spec);
    if (!matrix) {
        matrix = Array.from({ length: bins }, (_, bin) => Array.from({ length: count }, (_, k) => spec.values[k]?.[bin] ?? Number.NEGATIVE_INFINITY));
        laneMatrices.set(spec, matrix);
    }
    // No yAxis: the rows are frequencies, but up a linear axis (a frequency yAxis is a log one).
    return { frame: 'SpectrogramFrame', kind: 'heatmap', x: 'time', xScale: 'linear', quantity: 'level', unit: spec.unit ?? 'dB', xs, ys, matrix };
}

/**
 * Paints a track's spectrogram lane with the plot component every picture is drawn by (paintOverlay, R13): its cells
 * placed on the lanes' time axis, each pixel the loudest of the cells it covers (R2), in the lanes' viridis colours,
 * its colour bar in the plot's top right and its frequency axis on its own canvas beside it. Only when the
 * spectrogram, its view or the look changed; otherwise the canvas keeps the previous pixels and the axis is drawn again.
 */
export function paintTrackSpectrogram(
    canvas: HTMLCanvasElement,
    axisCanvas: HTMLCanvasElement | null,
    spec: SpectrogramData,
    place: LanePlacement,
    view: LaneSpectrogramView,
    cached: SpectrogramRasterCacheEntry | undefined,
    titles: LaneSpectrogramTitles,
    look: string,
): SpectrogramRasterCacheEntry {
    const key = [canvas.width, canvas.height, view.window.start, view.window.end, place.startSec, place.spanSec, place.offsetNorm, place.trackDurRatio,
        view.dbLo, view.dbHi, view.maxFrequencyHz, view.minFrequencyHz, view.durationSec, titles.colour, titles.frequency, look].join(':');
    const colors = sideAxisColors(canvas);
    if (cached && cached.source === spec && cached.key === key) {
        if (axisCanvas) paintSideAxis(axisCanvas, cached.ticks, titles.frequency, colors);
        return cached;
    }
    const picture = laneSpectrogramView(spec, place, view.durationSec);
    const axisView: StageView = { frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', xs: [place.startSec, place.startSec + place.spanSec], values: [0, 0] };
    const top = spec.maxFrequencyHz || view.maxFrequencyHz || 1;
    // Clipped to the recording: its first and last cells reach half a frame past it, where the lane shows no file.
    const span: [number, number] = [place.startSec + place.offsetNorm * place.spanSec, place.startSec + (place.offsetNorm + place.trackDurRatio) * place.spanSec];
    const plot = paintOverlay(canvas, { layers: [{ view: picture, color: '', span }] }, { min: view.dbLo, max: view.dbHi },
        { x: titles.time, y: titles.frequency, colour: titles.colour },
        { axisCanvas, axisView, heatmapPalette: viridis, window: { x: view.window, y: { start: Math.max(0, view.minFrequencyHz) / top, end: view.maxFrequencyHz / top } } });
    return { source: spec, key, colourBar: plot?.colourBar ?? { x: 0, y: 0, width: 0, height: 0 }, ticks: plot?.levelTicks ?? [] };
}

function sideAxisColors(canvas: HTMLCanvasElement): { muted: string; text: string } {
    const style = canvas.ownerDocument.defaultView?.getComputedStyle(canvas);
    return { muted: style?.getPropertyValue('--muted').trim() || '#888', text: style?.getPropertyValue('--text').trim() || '#ddd' };
}

/** Whether (x, y), in the canvas's own pixels, is on the colour bar last painted there. */
export function onColourBar(entry: Pick<SpectrogramRasterCacheEntry, 'colourBar'> | undefined, x: number, y: number): boolean {
    const box = entry?.colourBar;
    return !!box && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

