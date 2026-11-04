import { readoutText } from '../../shared/gui-core/index';
import { binFrequencyHz, dbLevelUnitFor, frequencyAtFraction, frequencyFraction, nearestBinIndex, type SpectrumPlotFrame } from '../draw/canvasDrawers';
import { formatReadoutHz } from './canvasOverlays';
import { nearestLine } from './plotHover';
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
    logFrequency = false,
    pixelPeak = false,
): SpectrumSnap | null {
    const frequencyBins = slice.frequencyBins;
    const originalMaxFrequency = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
    const visibleFrequencyRange = visibleFrequencyMax - visibleFrequencyMin;
    const dbRange = visibleDbMax - visibleDbMin;
    if (frequencyBins <= 0 || originalMaxFrequency <= 0 || visibleFrequencyRange <= 0) {
        return null;
    }
    const maxVisibleFrequency = Math.min(visibleFrequencyMax, slice.maxFrequencyHz);
    let minIndex: number;
    let maxIndex: number;
    const points = slice.bandCentersHz ?? slice.frequenciesHz;
    if (points) {
        const visible = points.flatMap((centerHz, index) => centerHz >= visibleFrequencyMin && centerHz <= maxVisibleFrequency ? [index] : []);
        minIndex = visible.length > 0 ? visible[0] : 0;
        maxIndex = visible.length > 0 ? visible[visible.length - 1] : frequencyBins - 1;
    }
    else {
        minIndex = Math.ceil((Math.max(0, visibleFrequencyMin) / originalMaxFrequency) * Math.max(frequencyBins - 1, 1));
        maxIndex = Math.floor((maxVisibleFrequency / originalMaxFrequency) * Math.max(frequencyBins - 1, 1));
        minIndex = Math.max(0, Math.min(frequencyBins - 1, minIndex));
        maxIndex = Math.max(0, Math.min(frequencyBins - 1, maxIndex));
    }
    if (maxIndex < minIndex) {
        minIndex = 0;
        maxIndex = frequencyBins - 1;
    }
    const scale = { frequencyMin: visibleFrequencyMin, frequencyMax: visibleFrequencyMax, logFrequency };
    const nearest = Math.max(minIndex, Math.min(maxIndex, nearestBinIndex(slice, targetFreqHz)));
    let binIndex = nearest;
    if (pixelPeak) {
        // Bins denser than pixels: the line drawn under the pointer peaks at the loudest bin within a pixel of it
        // (pointer positions are whole pixels), so the readout shows that bin rather than a sidelobe beside it.
        const pointerX = frequencyFraction(targetFreqHz, scale) * plotWidth;
        const near = (index: number) => Math.abs(frequencyFraction(binFrequencyHz(slice, index), scale) * plotWidth - pointerX) <= 1;
        for (let index = nearest - 1; index >= minIndex && near(index); index--) {
            if (slice.values[index] > slice.values[binIndex]) binIndex = index;
        }
        for (let index = nearest + 1; index <= maxIndex && near(index); index++) {
            if (slice.values[index] > slice.values[binIndex]) binIndex = index;
        }
    }
    const frequencyHz = binFrequencyHz(slice, binIndex);
    const dbValue = slice.values[binIndex];
    const x = padLeft + frequencyFraction(frequencyHz, scale) * plotWidth;
    const y = dbValue === undefined || dbRange <= 0
        ? null
        : padTop + (1 - Math.max(0, Math.min(1, (dbValue - visibleDbMin) / dbRange))) * plotHeight;
    return { binIdx: binIndex, freqHz: frequencyHz, x, dbVal: dbValue, y };
}

export function hoverNormForFrequency(frequencyHz: number, visibleMin: number, visibleMax: number, logFrequency = false): number {
    const range = visibleMax - visibleMin;
    return range <= 0 ? 0 : Math.max(0, Math.min(1, frequencyFraction(frequencyHz, { frequencyMin: visibleMin, frequencyMax: visibleMax, logFrequency })));
}

export type { SpectrumPlotFrame };

export interface SpectrumSeriesRange {
    minDb: number;
    maxDb: number;
    maxFrequencyHz: number;
    /** Set when the series are octave bands: the lower edge of their shared log axis. */
    logMinFrequencyHz?: number;
}

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
    return { minDb, maxDb, maxFrequencyHz, ...(isFinite(logMinFrequencyHz) ? { logMinFrequencyHz } : {}) };
}

export interface SpectrumSnapHit<S> {
    s: S;
    snap: SpectrumSnap;
    dbVal: number;
    snapY: number;
}

/**
 * `pixelPeak` is for a readout under the pointer on a canvas frame. Keyboard steps leave it off: they move bin by
 * bin from the nearest bin, which a readout snapping to the loudest bin of its pixel would hold in place.
 */
export function spectrumBinAtHover(slice: SpectrumSlice, hoverNorm: number, frame: SpectrumPlotFrame, pixelPeak = false): SpectrumSnap | null {
    const targetFreqHz = frequencyAtFraction(hoverNorm, frame);
    return spectrumBinAtFrequency(slice, targetFreqHz, frame.padLeft, frame.plotWidth, frame.padTop, frame.plotHeight,
        frame.frequencyMin, frame.frequencyMax, frame.dbMin, frame.dbMax, frame.logFrequency, pixelPeak);
}

export function nearestSpectrumSnap<S extends { slice: SpectrumSlice }>(
    series: readonly S[],
    hoverNorm: number,
    mouseY: number | null,
    frame: SpectrumPlotFrame,
    pixelPeak = false,
): SpectrumSnapHit<S> | null {
    const hit = nearestLine(series, s => {
        const snap = spectrumBinAtHover(s.slice, hoverNorm, frame, pixelPeak);
        return snap && snap.dbVal !== undefined && snap.y !== null ? { snap, dbVal: snap.dbVal, y: snap.y } : null;
    }, mouseY);
    return hit ? { s: hit.s, snap: hit.point.snap, dbVal: hit.point.dbVal, snapY: hit.point.y } : null;
}

export function spectrumReadoutText(label: string, slice: SpectrumSlice, freqHz: number, dbVal: number): string {
    return readoutText([label, formatReadoutHz(freqHz), dbVal.toFixed(1) + ' ' + dbLevelUnitFor(slice)]);
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
        windowStartNorm: msg.windowStartNorm,
        windowEndNorm: msg.windowEndNorm,
        window: msg.window,
        ...(msg.bandCentersHz ? { bandsPerOctave: msg.bandsPerOctave, bandCentersHz: msg.bandCentersHz, minFrequencyHz: msg.minFrequencyHz } : {}),
        ...(msg.frequenciesHz ? { frequenciesHz: msg.frequenciesHz } : {}),
    }));
}

const overlayPad = { left: 48, right: 8, top: 8, bottom: 18 };
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
    return { minDb, maxDb };
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

/** The line nearest the pointer over every axis, each series read in its own axis' frame. */
export function nearestOverlaySnap<S extends { slice: SpectrumSlice }>(
    axes: ReadonlyArray<OverlayLevelAxis<S>>,
    frameFor: (visible: SpectrumVisibleWindow) => SpectrumPlotFrame,
    hoverNorm: number,
    mouseY: number | null,
    pixelPeak = false,
): (SpectrumSnapHit<S> & { axisIndex: number; frame: SpectrumPlotFrame }) | null {
    let best: (SpectrumSnapHit<S> & { axisIndex: number; frame: SpectrumPlotFrame }) | null = null;
    axes.forEach((axis, axisIndex) => {
        const frame = frameFor(axis.visible);
        const hit = nearestSpectrumSnap(axis.series, hoverNorm, mouseY, frame, pixelPeak);
        if (hit && (best === null || (mouseY !== null && Math.abs(hit.snapY - mouseY) < Math.abs(best.snapY - mouseY)))) {
            best = { ...hit, axisIndex, frame };
        }
    });
    return best;
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

export function steppedSpectrumHoverNorm(slice: SpectrumSlice, binIdx: number, deltaIdx: number, frequencyMin: number, frequencyMax: number, logFrequency = false): number {
    const nextIdx = Math.max(0, Math.min(slice.frequencyBins - 1, binIdx + deltaIdx));
    return hoverNormForFrequency(binFrequencyHz(slice, nextIdx), frequencyMin, frequencyMax, logFrequency);
}

const UNIT_PLOT = { padLeft: 0, plotWidth: 1, padTop: 0, plotHeight: 1 };

export function sliceLogMinFrequencyHz(slice: SpectrumSlice): number | undefined {
    return slice.bandCentersHz && slice.minFrequencyHz ? slice.minFrequencyHz : undefined;
}

export function steppedOverlaySpectrumHoverNorm(
    series: ReadonlyArray<{ slice: SpectrumSlice }>,
    hoverNorm: number,
    yFrac: number | null,
    canvas: { width: number; height: number } | null,
    visible: SpectrumVisibleWindow,
    deltaIdx: number,
    fromPointer = false,
    axes?: ReadonlyArray<OverlayLevelAxis<{ slice: SpectrumSlice }>>,
): number | null {
    if (series.length === 0) {
        return null;
    }
    // mouseY must be in the same pixel space as the painter's frame, or the nearest series differs from the highlighted one.
    const frameFor = (vis: SpectrumVisibleWindow) => canvas ? spectrumPlotFrame(canvas.width, canvas.height, OVERLAY_SPECTRUM_PAD, vis) : { ...UNIT_PLOT, ...vis };
    const mouseY = canvas && yFrac !== null ? yFrac * canvas.height : null;
    // After the pointer, the first step starts from the bin its readout shows, which reads its pixel's loudest bin.
    const pixelPeak = fromPointer && canvas !== null;
    const nearest = axes
        ? nearestOverlaySnap(axes, frameFor, hoverNorm, mouseY, pixelPeak)
        : nearestSpectrumSnap(series, hoverNorm, mouseY, frameFor(visible), pixelPeak);
    const chosen = nearest ? nearest.s : series[0];
    const snap = nearest ? nearest.snap : spectrumBinAtHover(chosen.slice, hoverNorm, frameFor(visible), pixelPeak);
    return snap ? steppedSpectrumHoverNorm(chosen.slice, snap.binIdx, deltaIdx, visible.frequencyMin, visible.frequencyMax, visible.logFrequency) : null;
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
