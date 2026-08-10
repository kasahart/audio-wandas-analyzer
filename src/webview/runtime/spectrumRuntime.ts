import type { SpectrumSlice, SpectrumSnap } from './types';
import type { NormalizedRange } from './waveformInteraction';

export function zoomSpectrumRange(range: NormalizedRange, factor: number): NormalizedRange {
    const center = (range.start + range.end) / 2;
    const half = ((range.end - range.start) / 2) * factor;
    return {
        start: Math.max(0, center - half),
        end: Math.min(1, center + half),
    };
}

export function spectrumBinAtFrequency(
    slice: SpectrumSlice,
    targetFreqHz: number,
    padLeft: number,
    plotWidth: number,
    padTop: number,
    plotHeight: number,
    visibleFrequencyMin: number,
    visibleFrequencyMax: number,
    visibleDbMin: number,
    visibleDbMax: number,
): SpectrumSnap | null {
    const frequencyBins = slice.frequencyBins;
    const originalMaxFrequency = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
    const visibleFrequencyRange = visibleFrequencyMax - visibleFrequencyMin;
    const dbRange = visibleDbMax - visibleDbMin;
    if (frequencyBins <= 0 || originalMaxFrequency <= 0 || visibleFrequencyRange <= 0) {
        return null;
    }
    const maxVisibleFrequency = Math.min(visibleFrequencyMax, slice.maxFrequencyHz);
    let minIndex = Math.ceil((Math.max(0, visibleFrequencyMin) / originalMaxFrequency) * Math.max(frequencyBins - 1, 1));
    let maxIndex = Math.floor((maxVisibleFrequency / originalMaxFrequency) * Math.max(frequencyBins - 1, 1));
    minIndex = Math.max(0, Math.min(frequencyBins - 1, minIndex));
    maxIndex = Math.max(0, Math.min(frequencyBins - 1, maxIndex));
    if (maxIndex < minIndex) {
        minIndex = 0;
        maxIndex = frequencyBins - 1;
    }
    let binIndex = Math.round((targetFreqHz / originalMaxFrequency) * Math.max(frequencyBins - 1, 1));
    binIndex = Math.max(minIndex, Math.min(maxIndex, binIndex));
    const frequencyHz = (binIndex / Math.max(frequencyBins - 1, 1)) * originalMaxFrequency;
    const dbValue = slice.values[binIndex];
    const x = padLeft + ((frequencyHz - visibleFrequencyMin) / visibleFrequencyRange) * plotWidth;
    const y = dbValue === undefined || dbRange <= 0
        ? null
        : padTop + (1 - Math.max(0, Math.min(1, (dbValue - visibleDbMin) / dbRange))) * plotHeight;
    return { binIdx: binIndex, freqHz: frequencyHz, x, dbVal: dbValue, y };
}

export function hoverNormForFrequency(frequencyHz: number, visibleMin: number, visibleMax: number): number {
    const range = visibleMax - visibleMin;
    return range <= 0 ? 0 : Math.max(0, Math.min(1, (frequencyHz - visibleMin) / range));
}
