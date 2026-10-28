import { rasterize, viridis, type RasterPlan } from '../../shared/gui-core/index';
import type { SpectrogramData, SpectrogramDisplaySettings } from '../../shared/analysis/analysisTypes';
import { spectrogramTimeBinEdges, spectrogramTimeBinSpan } from '../spectrum/spectrogramTimeBins';
export interface SpectrogramRasterView {
    zoomStart: number;
    zoomEnd: number;
    trackStart: number;
    trackDurRatio: number;
    dbLo: number;
    dbHi: number;
    maxFrequencyHz: number;
    /** Bottom edge of the plot; 0 when not given. */
    minFrequencyHz?: number;
    /** Track duration; with the spectrogram's frame centres it places each cell on its STFT window. */
    durationSec?: number;
}
export type SpectrogramDisplayBounds = Required<Pick<SpectrogramRasterView, 'dbLo' | 'dbHi' | 'maxFrequencyHz' | 'minFrequencyHz'>>;
type SpectrogramAutoBounds = Pick<SpectrogramData, 'minDb' | 'maxDb' | 'maxFrequencyHz'>;

/**
 * The colour and frequency range a lane is drawn with: the typed display settings, else `auto` (the lane's own
 * spectrogram, or the bounds shared by every lane while the scales are linked). Unlinked, the top stays at or below
 * the lane's Nyquist frequency; linked lanes keep the shared top and leave the band above their data blank.
 */
export function spectrogramDisplayBounds(
    spec: SpectrogramAutoBounds,
    display: SpectrogramDisplaySettings,
    auto: SpectrogramAutoBounds = spec,
): SpectrogramDisplayBounds {
    const lower = display.minFrequencyHz;
    const min = lower != null && lower > 0 && (display.maxFrequencyHz == null || lower < display.maxFrequencyHz) ? lower : 0;
    // An auto top at or below the lower bound leaves an empty band there, never the frequencies under it.
    const top = Math.max(display.maxFrequencyHz != null ? display.maxFrequencyHz : auto.maxFrequencyHz, min);
    // A band starting above the lane's own data keeps its range, so the lane shows it blank rather than other frequencies.
    const clamp = auto === spec && min < spec.maxFrequencyHz;
    return {
        dbLo: display.dbMin != null ? display.dbMin : auto.minDb,
        dbHi: display.dbMax != null ? display.dbMax : auto.maxDb,
        maxFrequencyHz: clamp ? Math.min(top, spec.maxFrequencyHz) : top,
        minFrequencyHz: min,
    };
}

/** The common auto bounds of the linked lanes: the widest dB range and the highest Nyquist frequency. */
export function linkedSpectrogramBounds(specs: readonly SpectrogramAutoBounds[]): SpectrogramAutoBounds | null {
    let minDb = Infinity, maxDb = -Infinity, maxFrequencyHz = 0;
    for (const spec of specs) {
        if (Number.isFinite(spec.minDb)) minDb = Math.min(minDb, spec.minDb);
        if (Number.isFinite(spec.maxDb)) maxDb = Math.max(maxDb, spec.maxDb);
        if (Number.isFinite(spec.maxFrequencyHz)) maxFrequencyHz = Math.max(maxFrequencyHz, spec.maxFrequencyHz);
    }
    return minDb <= maxDb && maxFrequencyHz > 0 ? { minDb, maxDb, maxFrequencyHz } : null;
}

export function paintSpectrogramRaster(spec: SpectrogramData, width: number, height: number, view: SpectrogramRasterView, destination?: Uint8ClampedArray) {
    const edges = spectrogramTimeBinEdges(spec, view.durationSec);
    const columns: RasterPlan['columns'] = Array.from({ length: width }, (_, px) => {
        const globalStart = view.zoomStart + (px / width) * (view.zoomEnd - view.zoomStart);
        const globalEnd = view.zoomStart + ((px + 1) / width) * (view.zoomEnd - view.zoomStart);
        const localStart = (globalStart - view.trackStart) / view.trackDurRatio;
        const localEnd = (globalEnd - view.trackStart) / view.trackDurRatio;
        if (edges) {
            return localEnd <= 0 || localStart >= 1 ? null : spectrogramTimeBinSpan(edges, localStart, localEnd);
        }
        const first = Math.max(0, Math.floor(localStart * spec.timeBins));
        const after = Math.min(spec.timeBins, Math.max(first + 1, Math.ceil(localEnd * spec.timeBins)));
        return localEnd <= 0 || localStart >= 1 || first >= spec.timeBins || after <= 0 ? null : [first, after];
    });
    // Plot rows as fractions of the spectrogram's own frequency span; rows above its data stay blank.
    const specMax = Math.max(spec.maxFrequencyHz, 1);
    const bottom = Math.max(0, view.minFrequencyHz ?? 0) / specMax;
    const top = Math.max(0, view.maxFrequencyHz) / specMax;
    const rows: RasterPlan['rows'] = Array.from({ length: height }, (_, row) => {
        const py = height - row - 1;
        const high = bottom + (1 - py / height) * (top - bottom);
        const low = bottom + (1 - (py + 1) / height) * (top - bottom);
        const intervals = Math.max(spec.frequencyBins - 1, 0);
        const halfBin = intervals > 0 ? 0.5 / intervals : 0;
        if (low >= 1 + halfBin || high <= low) {
            return null;
        }
        const first = Math.max(0, Math.floor(low * intervals + 0.5));
        if (first >= spec.frequencyBins) {
            return null;
        }
        return [first, Math.min(spec.frequencyBins, Math.max(first + 1, Math.ceil(Math.min(high, 1) * intervals + 0.5)))];
    });
    return rasterize({ layout: 'rows', values: spec.values, bins: spec.frequencyBins, level: { quantity: 'STFT amplitude', unit: spec.unit ?? 'dB', axisLabel: spec.axisLabel ?? 'STFT amplitude level', referenceValue: spec.referenceValue, referenceUnit: spec.referenceUnit, levelReferenceLabel: spec.levelReferenceLabel } }, { columns, rows, peakMode: 'comparison' }, { min: view.dbLo, max: view.dbHi }, viridis, destination);
}
