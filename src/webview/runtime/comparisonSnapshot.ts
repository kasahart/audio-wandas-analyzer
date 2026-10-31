import type { SpectrogramDisplaySettings } from '../../shared/analysis/analysisTypes';
import { channelsForResult } from '../../shared/utils/format';
import type { SpectrumViewState } from './spectrumRuntime';
import { overlaySpectrumAxisLabels, sliceSpectrumAxisLabels, spectrogramAxisLabelTexts, visibleFileRange, waveformCoverageSnapshot } from './testSnapshot';
import type { ComparisonTrackState, SpectrumSlice, TimelineSpan, TrackId, WaveformCoverage } from './types';
import { trackTimelinePlacement } from './waveformCoverage';

export interface SnapshotTrack {
    trackId: TrackId;
    trackIndex: number;
    result: ComparisonTrackState;
    offsetSeconds: number;
    hidden: boolean;
    waveformCoverage: WaveformCoverage | null;
    spectrumCanvasPresent: boolean;
}

export interface TrackSnapshotSource {
    /** The active tracks, in protocol order. */
    tracks: readonly SnapshotTrack[];
    globalSpan: TimelineSpan;
    zoomStart: number;
    zoomEnd: number;
    spectrumView: SpectrumViewState;
    spectrogramDisplay: SpectrogramDisplaySettings;
    /** The cursor spectrum a shown track draws now, from what it already has: reading it never asks the host for one. */
    peekSlice(track: SnapshotTrack): SpectrumSlice | null;
    waveformAxisLabels(track: SnapshotTrack): string[];
}

/** What the smoke tests read of the tracks: built from the runtime's state, without changing it or asking the host for anything. */
export function buildTrackSnapshot(source: TrackSnapshotSource) {
    const visibleSlices: SpectrumSlice[] = [];
    const spectrogramPerTrack: string[][] = [];
    const spectrumPerTrack: string[][] = [];
    const waveformPerTrack: string[][] = [];
    const tracks = source.tracks.map(function (track) {
        const result = track.result;
        const placement = trackTimelinePlacement(track.offsetSeconds, result.durationSeconds, source.globalSpan);
        const visibleFile = visibleFileRange(source.zoomStart, source.zoomEnd, placement);
        const slice = track.hidden ? null : source.peekSlice(track);
        if (slice) {
            visibleSlices.push(slice);
        }
        waveformPerTrack.push(source.waveformAxisLabels(track));
        const ch = channelsForResult(result)[0];
        spectrogramPerTrack.push(spectrogramAxisLabelTexts(
            ch && ch.spectrogram,
            source.spectrogramDisplay,
            result.sampleRateHz ? result.sampleRateHz / 2 : 0,
        ));
        spectrumPerTrack.push(sliceSpectrumAxisLabels(slice, source.spectrumView));
        return {
            trackId: track.trackId,
            trackIndex: track.trackIndex,
            filePath: result.filePath,
            offsetSeconds: track.offsetSeconds,
            visibleFileStartNorm: visibleFile.startNorm,
            visibleFileEndNorm: visibleFile.endNorm,
            waveformFullyVisible: visibleFile.startNorm <= 0 && visibleFile.endNorm >= 1,
            ...waveformCoverageSnapshot(track.waveformCoverage),
            resultError: result.error || null,
            spectrumCanvasPresent: track.spectrumCanvasPresent,
            spectrumSlicePresent: !!slice,
        };
    });
    return {
        tracks,
        visibleSpectrumTrackCount: visibleSlices.length,
        axisLabels: {
            spectrumOverlay: overlaySpectrumAxisLabels(visibleSlices, source.spectrumView),
            spectrogramPerTrack,
            spectrumPerTrack,
            waveformPerTrack,
        },
    };
}
