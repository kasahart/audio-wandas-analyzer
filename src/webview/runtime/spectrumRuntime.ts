import { dbLevelUnitFor } from '../draw/canvasDrawers';
import { formatReadoutHz } from './canvasOverlays';
import type { SpectrumSlice, SpectrumSnap } from './types';
import { type NormalizedRange, zoomNormalizedRange } from './waveformInteraction';

export function zoomSpectrumRange(range: NormalizedRange, factor: number): NormalizedRange {
    return zoomNormalizedRange(range, factor);
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

export interface SpectrumPlotFrame {
    padLeft: number;
    plotWidth: number;
    padTop: number;
    plotHeight: number;
    frequencyMin: number;
    frequencyMax: number;
    dbMin: number;
    dbMax: number;
}

export interface SpectrumSnapHit<S> {
    s: S;
    snap: SpectrumSnap;
    dbVal: number;
    snapY: number;
}

export function spectrumBinAtHover(slice: SpectrumSlice, hoverNorm: number, frame: SpectrumPlotFrame): SpectrumSnap | null {
    const targetFreqHz = frame.frequencyMin + hoverNorm * (frame.frequencyMax - frame.frequencyMin);
    return spectrumBinAtFrequency(slice, targetFreqHz, frame.padLeft, frame.plotWidth, frame.padTop, frame.plotHeight,
        frame.frequencyMin, frame.frequencyMax, frame.dbMin, frame.dbMax);
}

export function nearestSpectrumSnap<S extends { slice: SpectrumSlice }>(
    series: readonly S[],
    hoverNorm: number,
    mouseY: number | null,
    frame: SpectrumPlotFrame,
): SpectrumSnapHit<S> | null {
    let nearest: SpectrumSnapHit<S> | null = null;
    let minDist = Infinity;
    for (const s of series) {
        const snap = spectrumBinAtHover(s.slice, hoverNorm, frame);
        if (!snap || snap.dbVal === undefined || snap.y === null) {
            continue;
        }
        const item = { s, snap, dbVal: snap.dbVal, snapY: snap.y };
        if (mouseY === null) {
            if (!nearest) {
                nearest = item;
            }
            continue;
        }
        const dist = Math.abs(snap.y - mouseY);
        if (dist < minDist) {
            minDist = dist;
            nearest = item;
        }
    }
    return nearest;
}

export function spectrumReadoutText(label: string, slice: SpectrumSlice, freqHz: number, dbVal: number): string {
    return label + ' / ' + formatReadoutHz(freqHz) + ' / ' + dbVal.toFixed(1) + ' ' + dbLevelUnitFor(slice);
}

export function trackSpectrumReadoutText(label: string, slice: SpectrumSlice, freqHz: number, dbVal: number | undefined): string {
    return label + ' ' + formatReadoutHz(freqHz) + (dbVal !== undefined ? '  ' + dbVal.toFixed(1) + ' ' + dbLevelUnitFor(slice) : '');
}
