import { normalizedColor, viridis } from '../../shared/gui-core/index';

export interface DrawTheme {
    /** 軸ラベル文字色 (--muted) */
    mutedColor: string;
    /** ラベル背景色 (--track-bg) */
    bgColor: string;
    /** 罫線色 (--line) */
    lineColor: string;
}

export const DEFAULT_THEME: DrawTheme = {
    mutedColor: '#888',
    bgColor: 'rgba(0,0,0,0.55)',
    lineColor: '#444',
};

export interface CanvasDrawCtx {
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    globalAlpha: number;
    lineWidth: number;
    setLineDash(segments: number[]): void;
    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    rotate(angle: number): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
    rect(x: number, y: number, w: number, h: number): void;
    clip(): void;
    clearRect(x: number, y: number, w: number, h: number): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    strokeRect(x: number, y: number, w: number, h: number): void;
    fillText(text: string, x: number, y: number): void;
    measureText(text: string): { width: number };
    createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
    putImageData(img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number): void;
}

export interface SpectrumSliceLike {
    values: number[];
    frequencyBins: number;
    maxFrequencyHz: number;
    minDb: number;
    maxDb: number;
    originalMaxFrequencyHz?: number;
    bandsPerOctave?: number;
    bandCentersHz?: number[];
    /** FFT slices cut for display: each point's frequency; absent on a whole row, which is evenly spaced. */
    frequenciesHz?: number[];
    unit?: string;
    axisLabel?: string;
    /** wandas' level label with the reference ("dB SPL re 20 µPa"); `unit` is the short unit ("dB SPL"). */
    levelReferenceLabel?: string;
}

/** A frequency span along a plot: linear for FFT bins, log for octave bands. */
export interface FrequencyScale {
    frequencyMin: number;
    frequencyMax: number;
    logFrequency?: boolean;
}

export function frequencyFraction(frequencyHz: number, scale: FrequencyScale): number {
    return scale.logFrequency
        ? Math.log(frequencyHz / scale.frequencyMin) / Math.log(scale.frequencyMax / scale.frequencyMin)
        : (frequencyHz - scale.frequencyMin) / (scale.frequencyMax - scale.frequencyMin);
}

export function frequencyAtFraction(fraction: number, scale: FrequencyScale): number {
    return scale.logFrequency
        ? scale.frequencyMin * Math.pow(scale.frequencyMax / scale.frequencyMin, fraction)
        : scale.frequencyMin + fraction * (scale.frequencyMax - scale.frequencyMin);
}

type SpectrumBinGrid = Pick<SpectrumSliceLike, 'frequencyBins' | 'maxFrequencyHz' | 'originalMaxFrequencyHz' | 'bandCentersHz' | 'frequenciesHz'>;

export function binFrequencyHz(slice: SpectrumBinGrid, index: number): number {
    if (slice.bandCentersHz) {
        return slice.bandCentersHz[index];
    }
    if (slice.frequenciesHz) {
        return slice.frequenciesHz[index];
    }
    return (index / Math.max(slice.frequencyBins - 1, 1)) * (slice.originalMaxFrequencyHz || slice.maxFrequencyHz);
}

/**
 * The bin closest to a frequency, unclamped on the FFT grid; for bands the centre closest on the log axis;
 * for a row cut for display the closest of its points.
 */
export function nearestBinIndex(slice: SpectrumBinGrid, frequencyHz: number): number {
    const centers = slice.bandCentersHz;
    if (centers) {
        let best = 0;
        for (let i = 1; i < centers.length; i++) {
            if (Math.abs(Math.log(centers[i] / frequencyHz)) < Math.abs(Math.log(centers[best] / frequencyHz))) {
                best = i;
            }
        }
        return best;
    }
    const points = slice.frequenciesHz;
    if (points) {
        let low = 0, high = points.length - 1;
        while (high - low > 1) {
            const middle = Math.floor((low + high) / 2);
            if (points[middle] <= frequencyHz) low = middle;
            else high = middle;
        }
        return Math.abs(points[high] - frequencyHz) <= Math.abs(points[low] - frequencyHz) ? high : low;
    }
    return Math.round((frequencyHz / (slice.originalMaxFrequencyHz || slice.maxFrequencyHz)) * Math.max(slice.frequencyBins - 1, 1));
}

const OCTAVE_TICKS_HZ = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export interface FrequencyAxisTick {
    fraction: number;
    text: string;
}

/** Min / middle / max on a linear axis; on a log axis both edges with the octave centres between them, so a zoom inside one octave keeps its edges labelled. */
export function frequencyAxisTicks(scale: FrequencyScale): FrequencyAxisTick[] {
    const edges = scale.logFrequency ? [0, 1] : [0, 0.5, 1];
    const ticks = edges.map(fraction => ({ fraction, text: formatHz(frequencyAtFraction(fraction, scale)) }));
    if (!scale.logFrequency) {
        return ticks;
    }
    const octaves = OCTAVE_TICKS_HZ
        .filter(hz => hz > scale.frequencyMin && hz < scale.frequencyMax)
        .map(hz => ({ fraction: frequencyFraction(hz, scale), text: hz >= 1000 ? hz / 1000 + 'k' : String(hz) }));
    return [ticks[0], ...octaves, ticks[1]];
}

export interface SpectrogramAxesOpts {
    dbLo?: number;
    dbHi?: number;
    maxFreq?: number;
}

export function formatHz(hz: number) {
    if (hz >= 1000) {
        return (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + ' kHz';
    }
    return Math.round(hz) + ' Hz';
}

export function dbToRgb(norm: number) {
    return normalizedColor(norm, viridis);
}


export interface SpectrumPlotFrame {
    padLeft: number;
    plotWidth: number;
    padTop: number;
    plotHeight: number;
    frequencyMin: number;
    frequencyMax: number;
    logFrequency?: boolean;
    dbMin: number;
    dbMax: number;
}

