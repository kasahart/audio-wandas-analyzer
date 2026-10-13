import type { SpectrumSeries, SpectrumSlice } from './types';

export interface SpectrumSeriesTrack<R> {
    index: number;
    result: R;
    hidden: boolean;
    offsetSeconds: number;
}

export interface SpectrumSeriesSource<R> {
    channelCount(result: R): number;
    slice(result: R, index: number, offsetSeconds: number, cursorNorm: number, channelIndex: number): SpectrumSlice | null;
    isPending(index: number, cursorNorm: number): boolean;
    color(index: number): string;
    label(result: R, channelIndex: number): string;
}

export interface CollectedSpectrumSeries {
    series: SpectrumSeries[];
    /** True when a visible channel has no slice yet but its request is still in flight. */
    pending: boolean;
}

export function collectSpectrumSeries<R>(tracks: Iterable<SpectrumSeriesTrack<R>>, cursorNorm: number, source: SpectrumSeriesSource<R>): CollectedSpectrumSeries {
    const series: SpectrumSeries[] = [];
    let pending = false;
    for (const track of tracks) {
        if (track.hidden) {
            continue;
        }
        const channels = source.channelCount(track.result);
        for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
            const slice = source.slice(track.result, track.index, track.offsetSeconds, cursorNorm, channelIndex);
            if (slice) {
                series.push({ slice, color: source.color(track.index), index: track.index, channelIndex, label: source.label(track.result, channelIndex) });
            }
            else if (source.isPending(track.index, cursorNorm)) {
                pending = true;
            }
        }
    }
    return { series, pending };
}
