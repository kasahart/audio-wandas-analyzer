import { readoutText } from '../../shared/gui-core/index';
import { dbLevelUnitFor, frequencyAtFraction, type SpectrumPlotFrame } from '../draw/canvasDrawers';
import { frequencyText, levelText } from '../plot/plotText';
import { HEATMAP_DB_SPAN } from '../../shared/utils/ticks';
import type { StageView } from '../../shared/protocol/backendProtocol';
import { stageRange } from './stagePanes';
import type { HostInboundMessage } from './hostMessaging';
import type { DragPoint, SpectrumSlice } from './types';
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

export type { SpectrumPlotFrame };

export interface SpectrumSeriesRange {
    minDb: number;
    maxDb: number;
    maxFrequencyHz: number;
    /** Set when the series are octave bands: the lower edge of their shared log axis. */
    logMinFrequencyHz?: number;
}

/**
 * A level axis over lines from `low` to `high` dB: the comparison's dB line rule (stageRange, R9) — every value, each
 * end rounded out to a 5/10/20/25 dB step, never more than 100 dB, so a silent line (−300 dB) cannot squash the rest.
 * A typed end is kept exactly; with the top typed, the bottom is at most 100 dB under it.
 */
export function spectrumLevelRange(low: number, high: number, typed: { min?: number; max?: number } = {}): { minDb: number; maxDb: number } {
    const auto = stageRange([{ kind: 'line', quantity: 'level', xs: [], values: [], valueRange: { min: low, max: high } } as unknown as StageView]);
    const maxDb = typed.max ?? auto.max;
    const minDb = typed.min ?? (typed.max !== undefined ? Math.max(auto.min, typed.max - HEATMAP_DB_SPAN) : auto.min);
    return maxDb > minDb ? { minDb, maxDb } : { minDb: auto.min, maxDb: auto.max };
}

/** The series' shared ranges: frequency to the highest, level by spectrumLevelRange over every series' extremes. */
export function spectrumSeriesRange(series: ReadonlyArray<{ slice: SpectrumSlice }>): SpectrumSeriesRange {
    let minDb = Infinity, maxDb = -Infinity, maxFrequencyHz = 0, logMinFrequencyHz = Infinity;
    series.forEach(({ slice }) => {
        minDb = Math.min(minDb, slice.minDb);
        maxDb = Math.max(maxDb, slice.maxDb);
        maxFrequencyHz = Math.max(maxFrequencyHz, slice.maxFrequencyHz);
        // An FFT slice has a 0 Hz bin, so a log axis is used only when every series is octave bands.
        const bandMin = sliceLogMinFrequencyHz(slice);
        logMinFrequencyHz = bandMin === undefined ? NaN : Math.min(logMinFrequencyHz, bandMin);
    });
    const level = series.length ? spectrumLevelRange(minDb, maxDb, series[0].slice.typedDb) : { minDb, maxDb };
    return { ...level, maxFrequencyHz, ...(isFinite(logMinFrequencyHz) ? { logMinFrequencyHz } : {}) };
}

export function spectrumReadoutText(label: string, slice: SpectrumSlice, freqHz: number, dbVal: number): string {
    return readoutText([label, ...spectrumReadoutValues(slice, freqHz, dbVal)]);
}

/** Where and how loud a spectrum's point reads: its frequency to the digits its bins need, its level in the slice's unit. */
/** `stepHz`: the spacing of the real bins around a point read at full resolution, in place of the slice's drawn points'. */
export function spectrumReadoutValues(slice: SpectrumSlice, freqHz: number, dbVal: number, stepHz?: number): string[] {
    return [frequencyText(freqHz, stepHz ?? sliceStepHz(slice, freqHz)), levelText(dbVal, dbLevelUnitFor(slice))];
}

/** The spacing of a slice's points around `freqHz` (its drawn points', else its even bins'), for the readout's digits. */
function sliceStepHz(slice: SpectrumSlice, freqHz: number): number | undefined {
    const points = slice.bandCentersHz ?? slice.frequenciesHz;
    if (points && points.length > 1) {
        let at = 0;
        for (let i = 1; i < points.length; i++) if (Math.abs(points[i] - freqHz) < Math.abs(points[at] - freqHz)) at = i;
        const gaps = [points[at] - points[at - 1], points[at + 1] - points[at]].filter(gap => Number.isFinite(gap) && gap > 0);
        return gaps.length ? Math.min(...gaps) : undefined;
    }
    return slice.frequencyBins > 1 && slice.maxFrequencyHz > 0 ? slice.maxFrequencyHz / (slice.frequencyBins - 1) : undefined;
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
        windowStartNorm: msg.windowStartNorm,
        windowEndNorm: msg.windowEndNorm,
        window: msg.window,
        ...(msg.bandCentersHz ? { bandsPerOctave: msg.bandsPerOctave, bandCentersHz: msg.bandCentersHz, minFrequencyHz: msg.minFrequencyHz } : {}),
        ...(msg.frequenciesHz ? { frequenciesHz: msg.frequenciesHz } : {}),
    }));
}

// As the comparison's plots: the frequency ticks and, at their right end, the frequency axis' title in the bottom
// margin; the level axis' numbers and name in the left one (stagePanes.ts draws both).
const overlayPad = { left: 52, right: 8, top: 8, bottom: 16 };
/** The overlay's margins. The right one widens while a secondary level axis is drawn; every reader follows it. */
export const OVERLAY_SPECTRUM_PAD: Readonly<typeof overlayPad> = overlayPad;
const OVERLAY_PAD_RIGHT = 8;
const OVERLAY_PAD_RIGHT_SECONDARY_AXIS = 48;

export function setOverlaySecondaryLevelAxis(shown: boolean): void {
    overlayPad.right = shown ? OVERLAY_PAD_RIGHT_SECONDARY_AXIS : OVERLAY_PAD_RIGHT;
}

/**
 * The level reference a slice is read in ("dB SPL re 20 µPa"), whatever quantity its axis names: a backend slice
 * ("Spectrum amplitude level [...]") and one cut from the spectrogram ("STFT amplitude level [...]") agree.
 */
export function spectrumLevelReference(slice: SpectrumSlice): string {
    const bracket = slice.axisLabel ? /\[([^\]]+)\]\s*$/.exec(slice.axisLabel) : null;
    return bracket ? bracket[1] : dbLevelUnitFor(slice);
}

export interface OverlayLevelAxis<S> {
    series: S[];
    /** The axis' title: the first series' level axis label, or its reference when it has none. */
    title: string;
    reference: string;
    visible: SpectrumVisibleWindow;
}

/** A slice's own range, before a typed spectrogram dB range replaced it. */
function autoDbRange(series: ReadonlyArray<{ slice: SpectrumSlice }>): { minDb: number; maxDb: number } {
    let minDb = Infinity, maxDb = -Infinity;
    series.forEach(({ slice }) => {
        minDb = Math.min(minDb, slice.autoMinDb ?? slice.minDb);
        maxDb = Math.max(maxDb, slice.autoMaxDb ?? slice.maxDb);
    });
    return series.length ? spectrumLevelRange(minDb, maxDb) : { minDb, maxDb };
}

/**
 * The overlay's level axes. Series with one level reference share one axis. With exactly two references the second
 * is read on its own axis at the right, over its own range (a typed dB range is the left axis' alone); it follows
 * the left axis' zoom as the same fraction of that range. With three or more only the first reference's lines are
 * drawn, so no line is read against another reference's axis (the panel is hidden behind a warning then).
 */
export function overlayLevelAxes<S extends { slice: SpectrumSlice }>(series: readonly S[], view: SpectrumViewState): OverlayLevelAxis<S>[] {
    const all = spectrumSeriesRange(series);
    const groups = new Map<string, S[]>();
    series.forEach(s => {
        const key = spectrumLevelReference(s.slice);
        const group = groups.get(key);
        if (group) { group.push(s); } else { groups.set(key, [s]); }
    });
    const entries = [...groups.entries()];
    const axisFor = (reference: string, members: S[], visible: SpectrumVisibleWindow): OverlayLevelAxis<S> =>
        ({ series: members, title: members[0].slice.axisLabel || reference, reference, visible });
    if (entries.length < 2) {
        const visible = spectrumVisibleWindow(all.maxFrequencyHz, all.minDb, all.maxDb, view, all.logMinFrequencyHz);
        return entries.length === 0 ? [{ series: [], title: '', reference: '', visible }] : [axisFor(entries[0][0], entries[0][1], visible)];
    }
    const [[firstReference, first], [secondReference, second]] = entries;
    const firstRange = spectrumSeriesRange(first);
    const primary = spectrumVisibleWindow(all.maxFrequencyHz, firstRange.minDb, firstRange.maxDb, view, all.logMinFrequencyHz);
    if (entries.length > 2) {
        return [axisFor(firstReference, first, primary)];
    }
    const secondRange = autoDbRange(second);
    const span = firstRange.maxDb - firstRange.minDb || 1;
    const secondSpan = secondRange.maxDb - secondRange.minDb;
    const secondary = {
        ...primary,
        dbMin: secondRange.minDb + (primary.dbMin - firstRange.minDb) / span * secondSpan,
        dbMax: secondRange.minDb + (primary.dbMax - firstRange.minDb) / span * secondSpan,
    };
    return [axisFor(firstReference, first, primary), axisFor(secondReference, second, secondary)];
}

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

/**
 * The cursor spectrum's zoom for a window the plot gestures set (plotInteraction.ts): across, the part of the whole
 * frequency axis; up, the part of the levels on screen, kept as dB since the level axis follows the data. A window that
 * keeps every level on screen leaves the dB axis as it is.
 */
export function spectrumZoomFromWindow(next: { x: { start: number; end: number }; y: { start: number; end: number } }, visibleDb: { min: number; max: number } | null): SpectrumBoxZoom {
    const zoom: SpectrumBoxZoom = { freqStart: next.x.start, freqEnd: next.x.end };
    if (visibleDb && (next.y.start !== 0 || next.y.end !== 1)) {
        const span = visibleDb.max - visibleDb.min;
        zoom.dbMin = visibleDb.min + next.y.start * span;
        zoom.dbMax = visibleDb.min + next.y.end * span;
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

export interface SpectrumViewState {
    freqStart: number;
    freqEnd: number;
    dbMin: number | null;
    dbMax: number | null;
}

export interface SpectrumVisibleWindow {
    frequencyMin: number;
    frequencyMax: number;
    logFrequency?: boolean;
    dbMin: number;
    dbMax: number;
}

/** `logMinFrequencyHz` switches the axis to log from that edge (octave bands); otherwise it is linear from 0 Hz. */
export function spectrumVisibleWindow(maxFrequencyHz: number, minDb: number, maxDb: number, view: SpectrumViewState, logMinFrequencyHz?: number): SpectrumVisibleWindow {
    const db = { dbMin: view.dbMin != null ? view.dbMin : minDb, dbMax: view.dbMax != null ? view.dbMax : maxDb };
    if (logMinFrequencyHz === undefined) {
        return { frequencyMin: view.freqStart * maxFrequencyHz, frequencyMax: view.freqEnd * maxFrequencyHz, ...db };
    }
    const axis = { frequencyMin: logMinFrequencyHz, frequencyMax: maxFrequencyHz, logFrequency: true };
    return { frequencyMin: frequencyAtFraction(view.freqStart, axis), frequencyMax: frequencyAtFraction(view.freqEnd, axis), logFrequency: true, ...db };
}

export function sliceLogMinFrequencyHz(slice: SpectrumSlice): number | undefined {
    return slice.bandCentersHz && slice.minFrequencyHz ? slice.minFrequencyHz : undefined;
}

export function channelIndexAttribute(el: { getAttribute(name: string): string | null }): number | null {
    const channelIndex = parseInt(el.getAttribute('data-channel-index') ?? '', 10);
    return isNaN(channelIndex) ? null : channelIndex;
}

