import type { SpectrogramData } from '../../shared/analysis/analysisTypes';

export interface SpectrumSlice {
    values: number[];
    frequencyBins: number;
    maxFrequencyHz: number;
    minDb: number;
    maxDb: number;
}

export interface SpectrumSource {
    durationSeconds: number;
    channels: Array<{ spectrogram?: SpectrogramData | null }>;
    error?: string;
}

export interface GlobalSpan {
    startSec: number;
    spanSec: number;
}

// 同じロジックが ComparisonPanel.ts の renderScript() 内にもインラインで存在する。
// 片方を変更したらもう片方も合わせること。
export function extractSpectrumAtCursor(
    result: SpectrumSource | null | undefined,
    offsetSeconds: number,
    cursorNorm: number,
    globalSpan: GlobalSpan,
): SpectrumSlice | null {
    if (!result || result.error) {
        return null;
    }
    const ch = result.channels && result.channels[0];
    const spec = ch && ch.spectrogram;
    if (!spec || !spec.values || spec.timeBins <= 0 || spec.frequencyBins <= 0) {
        return null;
    }
    const dur = result.durationSeconds || 0;
    if (dur <= 0) {
        return null;
    }
    const cursorSec = globalSpan.startSec + cursorNorm * globalSpan.spanSec;
    const trackLocalSec = cursorSec - offsetSeconds;
    if (trackLocalSec < 0 || trackLocalSec > dur) {
        return null;
    }
    let tIdx = Math.floor((trackLocalSec / dur) * spec.timeBins);
    if (tIdx < 0) {
        tIdx = 0;
    }
    if (tIdx >= spec.timeBins) {
        tIdx = spec.timeBins - 1;
    }
    const slice = spec.values[tIdx];
    if (!slice || slice.length === 0) {
        return null;
    }
    return {
        values: slice,
        frequencyBins: spec.frequencyBins,
        maxFrequencyHz: spec.maxFrequencyHz,
        minDb: spec.minDb,
        maxDb: spec.maxDb,
    };
}
