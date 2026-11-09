import type { SpectrogramData, SpectrogramDisplaySettings } from '../../shared/analysis/analysisTypes';
import { middleEllipsis } from '../../shared/dataset/datasetTable';
import { HEATMAP_DB_SPAN, niceRange } from '../../shared/utils/ticks';
import type { UiStrings } from '../../shared/i18n/strings';
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
/** The lane's two lines for a failed spectrogram: the summary in the sentence, then the backend's text, both shortened. */
export function spectrogramFailureText(strings: Pick<UiStrings, 'spectrogramFailed'>, reason: string): string {
    const [summary = '', ...detail] = reason.split('\n');
    const first = strings.spectrogramFailed.replace('{reason}', () => middleEllipsis(summary, 120));
    return detail.length ? `${first}\n${middleEllipsis(detail.join(' '), 120)}` : first;
}

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
    // Typed ends stay as typed; auto ends are widened to round values for the range actually shown. The auto bottom
    // is the STFT's lowest cell but no more than HEATMAP_DB_SPAN under its loudest (as every heatmap's, heatmapDbRange):
    // digital silence's −240 dB would leave the sound in a few colours.
    const rounded = niceRange(display.dbMin ?? Math.max(auto.minDb, auto.maxDb - HEATMAP_DB_SPAN), display.dbMax ?? auto.maxDb);
    return {
        dbLo: display.dbMin != null ? display.dbMin : rounded.low,
        dbHi: display.dbMax != null ? display.dbMax : rounded.high,
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
