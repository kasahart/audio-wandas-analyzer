import type { SpectrogramData } from '../../shared/analysis/analysisTypes';
import { spectrogramTimeBinAt, spectrogramTimeBinEdges } from './spectrogramTimeBins';

export interface SpectrumSlice {
    values: number[];
    frequencyBins: number;
    maxFrequencyHz: number;
    minDb: number;
    maxDb: number;
    unit?: string;
    axisLabel?: string;
    originalMaxFrequencyHz?: number;
    settingsSignature?: string;
    bandCentersHz?: number[];
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
    });
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
    const cachedIsCurrent = !!cached && cached.settingsSignature === context?.settingsSignature;
    if (trackLocalSec >= dur) {
        if (context?.bands) {
            return cached && cachedIsCurrent ? applySpectrumDisplaySettings({ ...cached, values: cached.values.map(() => cached.minDb) }) : null;
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
    });
}
