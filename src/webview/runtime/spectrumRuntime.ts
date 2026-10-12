import { dbLevelUnitFor, type SpectrumPlotFrame } from '../draw/canvasDrawers';
import { formatReadoutHz } from './canvasOverlays';
import type { HostInboundMessage } from './hostMessaging';
import type { DragPoint, SpectrumSlice, SpectrumSnap } from './types';
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

export type { SpectrumPlotFrame };

export interface SpectrumSeriesRange {
    minDb: number;
    maxDb: number;
    maxFrequencyHz: number;
}

export function spectrumSeriesRange(series: ReadonlyArray<{ slice: SpectrumSlice }>): SpectrumSeriesRange {
    let minDb = Infinity, maxDb = -Infinity, maxFrequencyHz = 0;
    series.forEach(({ slice }) => {
        minDb = Math.min(minDb, slice.minDb);
        maxDb = Math.max(maxDb, slice.maxDb);
        maxFrequencyHz = Math.max(maxFrequencyHz, slice.maxFrequencyHz);
    });
    return { minDb, maxDb, maxFrequencyHz };
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

export type SpectrumSliceResultMessage = Extract<HostInboundMessage, { type: 'spectrum-slice-result' }>;

export function spectrumSlicesFromResult(msg: SpectrumSliceResultMessage, cursorNorm: number | undefined): Array<SpectrumSlice & { channelIndex: number }> {
    return msg.channels.map((channel) => ({
        settingsSignature: msg.settingsSignature,
        cursorNorm,
        channelIndex: channel.channelIndex,
        values: channel.values,
        frequencyBins: msg.frequencyBins,
        originalMaxFrequencyHz: msg.maxFrequencyHz,
        maxFrequencyHz: msg.maxFrequencyHz,
        minDb: channel.minDb,
        maxDb: channel.maxDb,
        unit: channel.unit,
        axisLabel: channel.axisLabel,
    }));
}

export const OVERLAY_SPECTRUM_PAD = { left: 36, right: 8, top: 8, bottom: 18 } as const;

export function overlayPlotPoint(x: number, y: number, width: number, height: number): DragPoint | null {
    const pad = OVERLAY_SPECTRUM_PAD;
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    if (plotW <= 0 || plotH <= 0) {
        return null;
    }
    return {
        freqNorm: Math.max(0, Math.min(1, (x - pad.left) / plotW)),
        dbNorm: Math.max(0, Math.min(1, 1 - (y - pad.top) / plotH)),
    };
}

export interface SpectrumBoxZoom {
    freqStart: number;
    freqEnd: number;
    dbMin?: number;
    dbMax?: number;
}

const MIN_BOX_ZOOM_PX = 5;

export function spectrumBoxZoom(
    anchor: DragPoint,
    current: DragPoint,
    width: number,
    height: number,
    view: { freqStart: number; freqEnd: number },
    visibleDb: { min: number; max: number } | null,
): SpectrumBoxZoom | null {
    const pad = OVERLAY_SPECTRUM_PAD;
    const pxDx = Math.abs((anchor.freqNorm - current.freqNorm) * (width - pad.left - pad.right));
    const pxDy = Math.abs((anchor.dbNorm - current.dbNorm) * (height - pad.top - pad.bottom));
    if (pxDx < MIN_BOX_ZOOM_PX || pxDy < MIN_BOX_ZOOM_PX) {
        return null;
    }
    const f0 = Math.min(anchor.freqNorm, current.freqNorm);
    const f1 = Math.max(anchor.freqNorm, current.freqNorm);
    const freqSpan = view.freqEnd - view.freqStart;
    const zoom: SpectrumBoxZoom = {
        freqStart: view.freqStart + f0 * freqSpan,
        freqEnd: view.freqStart + f1 * freqSpan,
    };
    if (visibleDb) {
        const dbSpan = visibleDb.max - visibleDb.min;
        zoom.dbMin = visibleDb.min + Math.min(anchor.dbNorm, current.dbNorm) * dbSpan;
        zoom.dbMax = visibleDb.min + Math.max(anchor.dbNorm, current.dbNorm) * dbSpan;
    }
    return zoom;
}

export type OverlaySpectrumRegion = 'db-axis' | 'freq-axis' | 'plot' | null;

export function overlaySpectrumRegionAt(x: number, y: number, width: number, height: number): OverlaySpectrumRegion {
    const pad = OVERLAY_SPECTRUM_PAD;
    if (x < pad.left) {
        return 'db-axis';
    }
    if (x > width - pad.right) {
        return null;
    }
    if (y > height - pad.bottom) {
        return 'freq-axis';
    }
    return y >= pad.top ? 'plot' : null;
}
