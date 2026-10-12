import { dbLevelUnitFor, type SpectrumPlotFrame } from '../draw/canvasDrawers';
import { formatReadoutHz } from './canvasOverlays';
import type { HostInboundMessage } from './hostMessaging';
import type { DragPoint, SpectrumSlice, SpectrumSnap } from './types';
import { type NormalizedRange, zoomNormalizedRange } from './waveformInteraction';

export function zoomSpectrumRange(range: NormalizedRange, factor: number): NormalizedRange {
    return zoomNormalizedRange(range, factor);
}

/**
 * dB range to apply after a button zoom: `{ dbMin: null, dbMax: null }` restores auto scaling once the
 * frequency axis is fully zoomed out, and `null` means the caller keeps its current dB range.
 */
export function spectrumDbRangeAfterZoom(
    freqRange: NormalizedRange,
    factor: number,
    lastVisibleDb: { min: number; max: number } | null,
): { dbMin: number | null; dbMax: number | null } | null {
    if (factor > 1 && freqRange.start <= 0 && freqRange.end >= 1) {
        return { dbMin: null, dbMax: null };
    }
    if (!lastVisibleDb) {
        return null;
    }
    const center = (lastVisibleDb.min + lastVisibleDb.max) / 2;
    const halfSpan = (lastVisibleDb.max - lastVisibleDb.min) / 2 * factor;
    return { dbMin: center - halfSpan, dbMax: center + halfSpan };
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

export interface SpectrumReadoutElement {
    textContent: string | null;
    style: { color: string };
}

export function setSpectrumReadout(el: SpectrumReadoutElement | null, text: string, color: string): void {
    if (!el) {
        return;
    }
    el.textContent = text;
    el.style.color = color;
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

export const TRACK_SPECTRUM_PAD = { left: 32, right: 6, top: 4, bottom: 14 } as const;

export interface SpectrumViewState {
    freqStart: number;
    freqEnd: number;
    dbMin: number | null;
    dbMax: number | null;
}

export interface SpectrumVisibleWindow {
    frequencyMin: number;
    frequencyMax: number;
    dbMin: number;
    dbMax: number;
}

export function spectrumVisibleWindow(maxFrequencyHz: number, minDb: number, maxDb: number, view: SpectrumViewState): SpectrumVisibleWindow {
    return {
        frequencyMin: view.freqStart * maxFrequencyHz,
        frequencyMax: view.freqEnd * maxFrequencyHz,
        dbMin: view.dbMin != null ? view.dbMin : minDb,
        dbMax: view.dbMax != null ? view.dbMax : maxDb,
    };
}

export function spectrumPlotFrame(
    width: number,
    height: number,
    pad: { left: number; right: number; top: number; bottom: number },
    visible: SpectrumVisibleWindow,
): SpectrumPlotFrame {
    return {
        padLeft: pad.left,
        plotWidth: width - pad.left - pad.right,
        padTop: pad.top,
        plotHeight: height - pad.top - pad.bottom,
        ...visible,
    };
}

export function steppedSpectrumHoverNorm(slice: SpectrumSlice, binIdx: number, deltaIdx: number, frequencyMin: number, frequencyMax: number): number {
    const nextIdx = Math.max(0, Math.min(slice.frequencyBins - 1, binIdx + deltaIdx));
    const originalMaxFreq = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
    const freqHz = (nextIdx / Math.max(slice.frequencyBins - 1, 1)) * originalMaxFreq;
    return hoverNormForFrequency(freqHz, frequencyMin, frequencyMax);
}

const UNIT_PLOT = { padLeft: 0, plotWidth: 1, padTop: 0, plotHeight: 1 };

export function steppedTrackSpectrumHoverNorm(slice: SpectrumSlice, hoverNorm: number, freqStart: number, freqEnd: number, deltaIdx: number): number | null {
    const frequencyMin = freqStart * slice.maxFrequencyHz;
    const frequencyMax = freqEnd * slice.maxFrequencyHz;
    const snap = spectrumBinAtHover(slice, hoverNorm, { ...UNIT_PLOT, frequencyMin, frequencyMax, dbMin: slice.minDb, dbMax: slice.maxDb });
    return snap ? steppedSpectrumHoverNorm(slice, snap.binIdx, deltaIdx, frequencyMin, frequencyMax) : null;
}

export function steppedOverlaySpectrumHoverNorm(
    series: ReadonlyArray<{ slice: SpectrumSlice }>,
    hoverNorm: number,
    yFrac: number | null,
    canvas: { width: number; height: number } | null,
    visible: SpectrumVisibleWindow,
    deltaIdx: number,
): number | null {
    if (series.length === 0) {
        return null;
    }
    // mouseY must be in the same pixel space as the painter's frame, or the nearest series differs from the highlighted one.
    const frame = canvas ? spectrumPlotFrame(canvas.width, canvas.height, OVERLAY_SPECTRUM_PAD, visible) : { ...UNIT_PLOT, ...visible };
    const mouseY = canvas && yFrac !== null ? yFrac * canvas.height : null;
    const nearest = nearestSpectrumSnap(series, hoverNorm, mouseY, frame);
    const chosen = nearest ? nearest.s : series[0];
    const snap = nearest ? nearest.snap : spectrumBinAtHover(chosen.slice, hoverNorm, frame);
    return snap ? steppedSpectrumHoverNorm(chosen.slice, snap.binIdx, deltaIdx, visible.frequencyMin, visible.frequencyMax) : null;
}

export function channelIndexAttribute(el: { getAttribute(name: string): string | null }): number | null {
    const channelIndex = parseInt(el.getAttribute('data-channel-index') ?? '', 10);
    return isNaN(channelIndex) ? null : channelIndex;
}

export interface SpectrumPointerHover {
    hoverNorm: number;
    yFrac: number;
}

export function spectrumHoverAt(x: number, y: number, width: number, height: number, padLeft: number, padRight: number): SpectrumPointerHover | null {
    const plotWidth = width - padLeft - padRight;
    if (plotWidth <= 0) {
        return null;
    }
    return {
        hoverNorm: Math.max(0, Math.min(1, (x - padLeft) / plotWidth)),
        yFrac: Math.max(0, Math.min(1, y / (height || 140))),
    };
}
