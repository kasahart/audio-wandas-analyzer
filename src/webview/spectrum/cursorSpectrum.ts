import type { Drawn } from '../../shared/provenance';
import type { SpectrogramData } from '../../shared/analysis/analysisTypes';
import type { SpectrumStandIn } from '../runtime/types';
import { spectrogramTimeBinAt, spectrogramTimeBinEdges } from './spectrogramTimeBins';

export interface SpectrumSlice {
    /** As drawn: every bin when the slice has no `frequenciesHz`, else cut for display (wholeAnswers.ts everyBin). */
    values: Drawn[];
    frequencyBins: number;
    maxFrequencyHz: number;
    minDb: number;
    maxDb: number;
    unit?: string;
    axisLabel?: string;
    originalMaxFrequencyHz?: number;
    settingsSignature?: string;
    /** Track-normalized cursor the backend transformed this slice at. */
    cursorNorm?: number;
    bandCentersHz?: number[];
    /** Drawn in place of the backend's slice, never read as one (types.ts SpectrumStandIn). */
    standIn?: SpectrumStandIn;
}

export interface SpectrumSource {
    durationSeconds: number;
    sampleRateHz?: number;
    channels: Array<{ spectrogram?: SpectrogramData | null }>;
    error?: string;
}

export interface GlobalSpan {
    startSec: number;
    spanSec: number;
}

export interface CursorSpectrumContext {
    trackIndex: number;
    channelIndex?: number;
    cached: SpectrumSlice | null;
    settingsSignature: string;
    /** How far (track-normalized) a cached slice's cursor may lie from this one and still be this cursor's slice. */
    cursorTolerance: number;
    /** Octave bands come only from the backend; the spectrogram column is an FFT and cannot stand in for them. */
    bands?: boolean;
    requestSlice(trackIndex: number, cursorNorm: number): void;
    applyDisplaySettings: (slice: SpectrumSlice) => SpectrumSlice;
}

function makeSilentSpectrumSlice(
    result: SpectrumSource,
    spec: SpectrogramData | null,
    cached: SpectrumSlice | null,
    applySpectrumDisplaySettings: (slice: SpectrumSlice) => SpectrumSlice,
): SpectrumSlice {
    const fallbackBins = spec && spec.frequencyBins ? spec.frequencyBins : (cached && cached.frequencyBins ? cached.frequencyBins : 192);
    const fallbackMaxF = spec && spec.maxFrequencyHz ? spec.maxFrequencyHz : (cached && (cached.originalMaxFrequencyHz || cached.maxFrequencyHz) ? (cached.originalMaxFrequencyHz || cached.maxFrequencyHz) : ((result.sampleRateHz || 0) / 2));
    const floorDb = spec && Number.isFinite(spec.minDb) ? spec.minDb : (cached && Number.isFinite(cached.minDb) ? cached.minDb : -120);
    const topDb = spec && Number.isFinite(spec.maxDb) ? spec.maxDb : (cached && Number.isFinite(cached.maxDb) ? cached.maxDb : 0);
    return applySpectrumDisplaySettings({
        values: new Array<number>(Math.max(1, fallbackBins)).fill(floorDb),
        frequencyBins: Math.max(1, fallbackBins),
        originalMaxFrequencyHz: fallbackMaxF,
        maxFrequencyHz: fallbackMaxF,
        minDb: floorDb,
        maxDb: Math.max(topDb, floorDb + 1),
        unit: (spec && spec.unit) || (cached && cached.unit) || undefined,
        axisLabel: (spec && spec.axisLabel) || (cached && cached.axisLabel) || undefined,
        standIn: 'silence',
    });
}

/** Whether a slice was transformed at this track-normalized cursor (within the tolerance a cursor move needs). */
export function sliceIsAtCursor(slice: Pick<SpectrumSlice, 'cursorNorm'> | null | undefined, localNorm: number, tolerance: number): boolean {
    return !!slice && slice.cursorNorm !== undefined && Number.isFinite(slice.cursorNorm)
        && Math.abs(slice.cursorNorm - localNorm) < tolerance;
}

export function extractSpectrumAtCursor(
    result: SpectrumSource | null | undefined,
    offsetSeconds: number,
    cursorNormValue: number,
    globalSpan: GlobalSpan,
    context?: CursorSpectrumContext,
): SpectrumSlice | null {
    if (!result || result.error) {
        return null;
    }
    const dur = result.durationSeconds || 0;
    if (dur <= 0) {
        return null;
    }
    const idx = context?.trackIndex ?? -1;
    const channelIndex = context?.channelIndex ?? 0;
    const applySpectrumDisplaySettings = context?.applyDisplaySettings ?? ((slice: SpectrumSlice) => slice);
    const chIdx = Number.isInteger(channelIndex) ? channelIndex : 0;
    const gs = globalSpan;
    const cursorSec = gs.startSec + cursorNormValue * gs.spanSec;
    const trackLocalSec = cursorSec - offsetSeconds;
    if (trackLocalSec < 0) {
        return null;
    }
    const ch = Array.isArray(result.channels) ? result.channels[chIdx] : undefined;
    const spec = ch && ch.spectrogram;
    const cached = idx >= 0 ? context?.cached ?? null : null;
    const cachedHasSettings = !!cached && cached.settingsSignature === context?.settingsSignature;
    // A slice is this cursor's only when it was transformed here: one from an earlier cursor (its successor still on
    // its way, or failed) is never drawn or read as the current one (R7).
    const cachedIsCurrent = cachedHasSettings && !!context && sliceIsAtCursor(cached, trackLocalSec / dur, context.cursorTolerance);
    if (trackLocalSec >= dur) {
        if (context?.bands) {
            return cached && cachedHasSettings ? applySpectrumDisplaySettings({ ...cached, values: cached.values.map(() => cached.minDb), standIn: 'silence' }) : null;
        }
        return makeSilentSpectrumSlice(result, spec ?? null, cached, applySpectrumDisplaySettings);
    }
    if (idx >= 0) {
        context?.requestSlice(idx, cursorNormValue);
        if (cached && cachedIsCurrent) {
            return applySpectrumDisplaySettings(cached);
        }
    }
    if (context?.bands) {
        // Octave bands have no spectrogram column at this cursor to stand in, and an earlier cursor's bands are of
        // another point: nothing is drawn, nor sets the axis, until this cursor's come.
        return null;
    }
    if (!spec || !spec.values || spec.timeBins <= 0 || spec.frequencyBins <= 0) {
        return null;
    }
    const edges = spectrogramTimeBinEdges(spec, dur);
    let timeIndex = edges ? spectrogramTimeBinAt(edges, trackLocalSec / dur) : Math.floor((trackLocalSec / dur) * spec.timeBins);
    timeIndex = Math.max(0, Math.min(spec.timeBins - 1, timeIndex));
    const values = spec.values[timeIndex];
    if (!values || values.length === 0) {
        return null;
    }
    return applySpectrumDisplaySettings({
        values: values,
        frequencyBins: spec.frequencyBins,
        originalMaxFrequencyHz: spec.maxFrequencyHz,
        maxFrequencyHz: spec.maxFrequencyHz,
        minDb: spec.minDb,
        maxDb: spec.maxDb,
        unit: spec.unit,
        axisLabel: spec.axisLabel,
        // The display spectrogram's column, its cells power-averaged to draw: drawn until the slice comes, never read.
        standIn: 'pending',
    });
}
