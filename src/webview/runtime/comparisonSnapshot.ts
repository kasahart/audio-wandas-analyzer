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
    /** Where the track's first row has its waveform drawn now, in the canvas's pixels (the ends of its points and its frame); null with nothing drawn. */
    waveformDrawn(track: SnapshotTrack): { minX: number; maxX: number; left: number; width: number } | null;
    /** The waveform lane of the track's first row: its frame in the row's canvas and the amplitude range it shows; null with no picture. */
    waveformLane(track: SnapshotTrack): { frame: { left: number; top: number; width: number; height: number }; range: [number, number] } | null;
    /** The axis names the cursor spectrum's Figure drew, and the texts a track's row drew on its spectrogram lane: never made again here. */
    spectrumTexts(): string[];
    spectrogramTexts(track: SnapshotTrack): string[];
}

/** How near a side of the frame the outermost point drawn has to be for the waveform to cover that side. */
const EDGE_PX = 2;

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
        const drawn = source.waveformDrawn(track);
        const waveLane = source.waveformLane(track);
        return {
            trackId: track.trackId,
            trackIndex: track.trackIndex,
            filePath: result.filePath,
            offsetSeconds: track.offsetSeconds,
            visibleFileStartNorm: visibleFile.startNorm,
            visibleFileEndNorm: visibleFile.endNorm,
            waveformFullyVisible: visibleFile.startNorm <= 0 && visibleFile.endNorm >= 1,
            // The points drawn reach each side of the frame (to within the pixel a point is placed in).
            waveformCoversViewportLeft: drawn !== null && drawn.minX <= drawn.left + EDGE_PX,
            waveformCoversViewportRight: drawn !== null && drawn.maxX >= drawn.left + drawn.width - EDGE_PX,
            waveformMinDrawX: drawn?.minX ?? null,
            waveformMaxDrawX: drawn?.maxX ?? null,
            waveformCanvasWidth: drawn?.width ?? null,
            waveformFrame: waveLane?.frame ?? null,
            waveformRange: waveLane?.range ?? null,
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
