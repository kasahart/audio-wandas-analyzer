import type { SpectrogramDisplaySettings } from '../../shared/analysis/analysisTypes';
import { visibleFileRange } from './testSnapshot';
import type { ComparisonTrackState, TimelineSpan, TrackId } from './types';
import { trackTimelinePlacement } from './waveformCoverage';

export interface SnapshotTrack {
    trackId: TrackId;
    trackIndex: number;
    result: ComparisonTrackState;
    offsetSeconds: number;
    hidden: boolean;
}

export interface TrackSnapshotSource {
    /** The active tracks, in protocol order. */
    tracks: readonly SnapshotTrack[];
    globalSpan: TimelineSpan;
    zoomStart: number;
    zoomEnd: number;
    spectrogramDisplay: SpectrogramDisplaySettings;
    /** Whether the cursor spectrum's picture has a line of this track now: read from what is drawn, asking nothing. */
    spectrumLine(track: SnapshotTrack): boolean;
    waveformAxisLabels(track: SnapshotTrack): string[];
    /** The axis names the cursor spectrum's Figure drew, and the texts a track's row drew on its spectrogram lane: never made again here. */
    spectrumTexts(): string[];
    spectrogramTexts(track: SnapshotTrack): string[];
}

/** What the smoke tests read of the tracks: built from the runtime's state, without changing it or asking the host for anything. */
export function buildTrackSnapshot(source: TrackSnapshotSource) {
    let spectrumTracks = 0;
    const spectrogramPerTrack: string[][] = [];
    const waveformPerTrack: string[][] = [];
    const tracks = source.tracks.map(function (track) {
        const result = track.result;
        const placement = trackTimelinePlacement(track.offsetSeconds, result.durationSeconds, source.globalSpan);
        const visibleFile = visibleFileRange(source.zoomStart, source.zoomEnd, placement);
        const slice = !track.hidden && source.spectrumLine(track);
        if (slice) {
            spectrumTracks += 1;
        }
        waveformPerTrack.push(source.waveformAxisLabels(track));
        spectrogramPerTrack.push(source.spectrogramTexts(track));
        return {
            trackId: track.trackId,
            trackIndex: track.trackIndex,
            filePath: result.filePath,
            offsetSeconds: track.offsetSeconds,
            visibleFileStartNorm: visibleFile.startNorm,
            visibleFileEndNorm: visibleFile.endNorm,
            waveformFullyVisible: visibleFile.startNorm <= 0 && visibleFile.endNorm >= 1,
            resultError: result.error || null,
            spectrumSlicePresent: slice,
        };
    });
    return {
        tracks,
        visibleSpectrumTrackCount: spectrumTracks,
        axisLabels: {
            spectrumOverlay: spectrumTracks ? source.spectrumTexts() : [],
            spectrogramPerTrack,
            waveformPerTrack,
        },
    };
}
