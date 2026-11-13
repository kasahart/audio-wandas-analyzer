import { readoutText } from '../../shared/gui-core/index';
import { frequencyAtFraction, type SpectrumPlotFrame } from '../draw/canvasDrawers';
import { fieldDecimals, frequencyText, levelText } from '../plot/plotText';
import type { HostInboundMessage } from './hostMessaging';
import type { DragPoint, SpectrumSeries, SpectrumSlice } from './types';
import { backendTitle, byLevelKey, atDecimals, calibrationWordsBy, fieldWindow, levelKeyOf, levelLineRange, shownLevelOf, windowEnds, type FigureTitle } from './figureModel';
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
    // At the numbers the range popover writes for it (figureModel.fieldWindow, R9): never a float step off them.
    const ends = fieldWindow(center - halfSpan, center + halfSpan);
    return { dbMin: ends.min, dbMax: ends.max };
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
    return levelLineRange(low, high, typed);
}

/** The series' shared ranges: frequency to the highest, level by spectrumLevelRange over every series' extremes. */
/**
 * The series whose levels set a level axis' range: those of the cursor where it is. An earlier cursor's bands drawn
 * while this one's are on their way (standIn 'pending') set it only while no series has its own yet, so the axis
 * stays as it was drawn for them, never moved by another point's levels beside a current one.
 */
export function levelRangeSeries<S extends { slice: SpectrumSlice }>(series: readonly S[]): readonly S[] {
    const current = series.filter(({ slice }) => slice.standIn !== 'pending');
    return current.length ? current : series;
}

export function spectrumSeriesRange(series: ReadonlyArray<{ slice: SpectrumSlice }>): SpectrumSeriesRange {
    let minDb = Infinity, maxDb = -Infinity, maxFrequencyHz = 0, logMinFrequencyHz = Infinity;
    const ranged = new Set(levelRangeSeries(series));
    series.forEach(entry => {
        const { slice } = entry;
        if (ranged.has(entry)) {
            minDb = Math.min(minDb, slice.minDb);
            maxDb = Math.max(maxDb, slice.maxDb);
        }
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
    return [frequencyText(freqHz, stepHz ?? sliceStepHz(slice, freqHz)), levelText(dbVal, slice.unit || spectrumLevelReference(slice))];
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
        ...(channel.bins ? { bins: channel.bins } : {}),
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
    return shownLevelOf(slice);
}

/** What a line's levels are in, for sharing an axis (figureModel): its recording's identity and its slice's reference. */
type LevelKeyed = { slice: SpectrumSlice; level?: SpectrumSeries['level'] };
const levelOf = (level: SpectrumSeries['level']) => (level ? { unit: level.unit ?? '', ref: level.ref ?? 1, levelReferenceLabel: level.levelReferenceLabel ?? '' } : undefined);
const spectrumLevelKey = (s: LevelKeyed): string => levelKeyOf(levelOf(s.level), spectrumLevelReference(s.slice));

/**
 * The series with each uncalibrated one's label saying so where it shares a level axis (spectrumLevelReference) with
 * a calibrated one (R1, R4, A49): that axis is named calibrated, so the line says it is not, in its legend and its
 * readout (both read the label). Elsewhere the axis's own name says it, and no label repeats it.
 */
export function withCalibrationWords<S extends LevelKeyed & { label: string }>(series: readonly S[], calibrated: (series: S) => boolean, word: string): S[] {
    const said = calibrationWordsBy(series, spectrumLevelKey, calibrated, word);
    return series.map(s => { const extra = said(s); return extra ? { ...s, label: `${s.label}${extra}` } : s; });
}

export interface OverlayLevelAxis<S> {
    series: S[];
    /** The axis' title: the first series' level axis label, or its reference when it has none. */
    title: FigureTitle;
    reference: string;
    /** The axis' level identity (spectrumLevelKey): what a dB zoom on it is kept by, never its reference's text. */
    key: string;
    visible: SpectrumVisibleWindow;
    /** The right-hand axis's: the whole ranges it follows the left one's zoom between (secondaryDbWindow). */
    follow?: RightAxisFollow;
}

/** The whole ranges of the left level axis and of the right-hand one that follows its zoom as the same part. */
export interface RightAxisFollow {
    left: { min: number; max: number };
    right: { min: number; max: number };
}

/**
 * The right-hand level axis's range for the left one's range `left`: the same part of its own whole range, at the
 * numbers its range popover writes (figureModel.windowEnds, R9), so it is painted from the numbers written.
 */
export function secondaryDbWindow(left: { min: number; max: number }, follow: RightAxisFollow): { min: number; max: number } {
    const span = follow.left.max - follow.left.min || 1;
    const part = { start: left.min === follow.left.min ? 0 : (left.min - follow.left.min) / span, end: left.max === follow.left.max ? 1 : (left.max - follow.left.min) / span };
    return windowEnds(follow.right, part);
}

/**
 * The left level axis's range that shows `right` on the right-hand axis (a range typed on it): the shortest numbers
 * (the field's decimals for the left span, then one more at a time) whose right-hand range (secondaryDbWindow) is
 * `right` itself, so the right axis is painted at the numbers typed and the left one at numbers its field writes.
 */
export function rightAxisLeftRange(follow: RightAxisFollow, right: { min: number; max: number }): { min: number; max: number } {
    const rightSpan = follow.right.max - follow.right.min || 1, leftSpan = follow.left.max - follow.left.min;
    const kept = { min: right.min === follow.right.min, max: right.max === follow.right.max };
    const leftOf = (value: number): number => follow.left.min + (value - follow.right.min) / rightSpan * leftSpan;
    const exact = { min: kept.min ? follow.left.min : leftOf(right.min), max: kept.max ? follow.left.max : leftOf(right.max) };
    for (let decimals = fieldDecimals(exact.max - exact.min); decimals <= 15; decimals++) {
        const left = { min: kept.min ? exact.min : atDecimals(exact.min, decimals), max: kept.max ? exact.max : atDecimals(exact.max, decimals) };
        const shown = left.max > left.min ? secondaryDbWindow(left, follow) : null;
        if (shown && shown.min === right.min && shown.max === right.max) return left;
    }
    return exact;
}

/** A slice's own range, before a typed spectrogram dB range replaced it. */
function autoDbRange(series: ReadonlyArray<{ slice: SpectrumSlice }>): { minDb: number; maxDb: number } {
    let minDb = Infinity, maxDb = -Infinity;
    levelRangeSeries(series).forEach(({ slice }) => {
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
export function overlayLevelAxes<S extends LevelKeyed>(series: readonly S[], view: SpectrumViewState): OverlayLevelAxis<S>[] {
    const all = spectrumSeriesRange(series);
    const entries = byLevelKey(series, spectrumLevelKey).map(group => [group.key, group.items] as const);
    const axisFor = (key: string, members: S[], visible: SpectrumVisibleWindow): OverlayLevelAxis<S> => {
        // Named by a series of the cursor where it is, when one has come.
        const named = levelRangeSeries(members)[0];
        const reference = spectrumLevelReference(named.slice);
        return { series: members, title: backendTitle(named.slice.axisLabel || reference), reference, key, visible };
    };
    if (entries.length < 2) {
        const visible = spectrumVisibleWindow(all.maxFrequencyHz, all.minDb, all.maxDb, view, all.logMinFrequencyHz);
        return entries.length === 0 ? [{ series: [], title: backendTitle(''), reference: '', key: '', visible }] : [axisFor(entries[0][0], [...entries[0][1]], visible)];
    }
    const [[firstReference, firstOnes], [secondReference, secondOnes]] = entries;
    const first = [...firstOnes], second = [...secondOnes];
    const firstRange = spectrumSeriesRange(first);
    const primary = spectrumVisibleWindow(all.maxFrequencyHz, firstRange.minDb, firstRange.maxDb, view, all.logMinFrequencyHz);
    if (entries.length > 2) {
        return [axisFor(firstReference, first, primary)];
    }
    const secondRange = autoDbRange(second);
    const follow: RightAxisFollow = { left: { min: firstRange.minDb, max: firstRange.maxDb }, right: { min: secondRange.minDb, max: secondRange.maxDb } };
    const ends = secondaryDbWindow({ min: primary.dbMin, max: primary.dbMax }, follow);
    const secondary = { ...primary, dbMin: ends.min, dbMax: ends.max };
    return [axisFor(firstReference, first, primary), { ...axisFor(secondReference, second, secondary), follow }];
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
        // At the numbers the range popover writes for it (figureModel.windowEnds, R9).
        const ends = windowEnds(visibleDb, next.y);
        zoom.dbMin = ends.min;
        zoom.dbMax = ends.max;
    }
    return zoom;
}

export type OverlaySpectrumRegion = 'db-axis' | 'db-axis-right' | 'freq-axis' | 'plot' | null;

/** Where on the overlay a point is: either level axis (the right-hand one while drawn, A48, R13), the frequency axis or the plot. */
export function overlaySpectrumRegionAt(x: number, y: number, width: number, height: number): OverlaySpectrumRegion {
    const pad = OVERLAY_SPECTRUM_PAD;
    if (x < pad.left) {
        return 'db-axis';
    }
    if (x > width - pad.right) {
        // The right-hand level axis answers the axis gestures as the left one does: it follows the left one's levels.
        return pad.right > OVERLAY_PAD_RIGHT && y <= height - pad.bottom ? 'db-axis-right' : null;
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
    const shown = frequencyWindowHz({ start: view.freqStart, end: view.freqEnd }, maxFrequencyHz, logMinFrequencyHz);
    return { ...shown, ...(logMinFrequencyHz === undefined ? {} : { logFrequency: true }), ...db };
}

/**
 * The frequencies a spectrum's axis is painted between for the part `window` of its whole axis (0 Hz, or the log
 * axis's `logMinFrequencyHz`, to `maxFrequencyHz`): a zoomed end at the numbers its range popover writes
 * (figureModel.fieldWindow, R9), as a plot's windowed axis is (stagePanes.windowed), so the pair view that shares the
 * axis is painted between the same numbers. The whole axis keeps its own ends.
 */
export function frequencyWindowHz(window: NormalizedRange, maxFrequencyHz: number, logMinFrequencyHz?: number): { frequencyMin: number; frequencyMax: number } {
    const axis = logMinFrequencyHz === undefined ? null : { frequencyMin: logMinFrequencyHz, frequencyMax: maxFrequencyHz, logFrequency: true };
    const at = (fraction: number): number => (axis ? frequencyAtFraction(fraction, axis) : fraction * maxFrequencyHz);
    const kept = { min: window.start === 0, max: window.end === 1 };
    const ends = fieldWindow(kept.min ? (axis ? logMinFrequencyHz as number : 0) : at(window.start), kept.max ? maxFrequencyHz : at(window.end), kept);
    return { frequencyMin: ends.min, frequencyMax: ends.max };
}

export function sliceLogMinFrequencyHz(slice: SpectrumSlice): number | undefined {
    return slice.bandCentersHz && slice.minFrequencyHz ? slice.minFrequencyHz : undefined;
}

export function channelIndexAttribute(el: { getAttribute(name: string): string | null }): number | null {
    const channelIndex = parseInt(el.getAttribute('data-channel-index') ?? '', 10);
    return isNaN(channelIndex) ? null : channelIndex;
}

