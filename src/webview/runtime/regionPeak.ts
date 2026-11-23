/**
 * The peak of a region of the recordings compared (the steps view: where a new trigger's level starts): one answer of
 * the backend's, of every sample ('request-region-peak', AnalysisService.region_peak; figure-design.md 第 1 節: a
 * first-layer answer). Asked once and kept; nothing is computed of it here.
 */
import type { RegionPeakRequest } from '../../shared/utils/audioTarget';
import { answerKey, createAnswerStore } from './answerStore';

/** A track as a read names it: its file, and the version and calibration it was analysed under. */
export interface PeakTrack {
    filePath: string;
    /** The version of the file the track was analysed from (sourceVersion): the read names it and is kept under it. */
    sourceVersion: string | undefined;
    calibrationSignature: string | undefined;
}

/** One track's channels (none: every channel) and the stretch of its file a region's peak is taken over. */
export interface PeakOf {
    /** The recording: recordings, not channels, are counted against the limit. */
    filePath: string;
    /** The track as a read names it; null for a file changed since it was analysed, which no read names (its peak is unknown). */
    track: PeakTrack | null;
    channels: readonly number[];
    startNorm: number;
    endNorm: number;
}

/**
 * - 'ready': the backend's answer is in; `value` is the peak (0 for silence).
 * - 'pending': it is on its way.
 * - 'failed': the read failed, or a recording has no data to read; it is asked again once the answer store's pause is over.
 * - 'tooMany': the peak would need the samples of more recordings than the limit (`limit`, for the message). Nothing
 *   is read: the project never starts a computation over that many files unasked (display rules R1; the limit is
 *   trackStageMode's LARGE_BASE, the same one that holds back a large base group).
 *
 * Only 'ready' carries a number: a caller cannot show an estimate while the others last.
 */
export type RegionPeak = { state: 'ready'; value: number } | { state: 'pending' } | { state: 'failed' } | { state: 'tooMany'; limit: number };

export interface RegionPeaks {
    /**
     * The largest |sample| of the tracks' channels, each over its stretch (the file's 0..1). undefined with nothing to
     * take it of. With more recordings than `maxFiles` nothing is asked at all ('tooMany').
     */
    peak(of: readonly PeakOf[], maxFiles: number): RegionPeak | undefined;
    /** Takes the host's answers to these reads; false for anything else. */
    handle(message: { type: string; requestId?: string }): boolean;
    /** Forgets everything read (a new analysis). */
    clear(): void;
}

const PREFIX = 'read-peak';

export function createRegionPeaks(post: (message: RegionPeakRequest) => void, now: () => number = () => Date.now()): RegionPeaks {
    let count = 0;
    /** The regions' peaks asked for: each one answer of the backend's for its tracks, channels and stretches. */
    const peaks = createAnswerStore<number>({ capacity: 32, now });
    /** Each peak on its way: what to call with the backend's number, or with none when it failed. */
    const waiting = new Map<string, (peak: number | null) => void>();
    return {
        peak(given, maxFiles) {
            if (!given.length) return undefined;
            if (new Set(given.map(one => one.filePath)).size > maxFiles) return { state: 'tooMany', limit: maxFiles };
            const of = given.flatMap(one => (one.track ? [{ ...one, track: one.track }] : []));
            if (of.length < given.length) return { state: 'failed' };
            // Of each track's file version and calibration: a file analysed again is asked again.
            const key = answerKey({ ask: ['peak', of.map(({ track, channels, startNorm, endNorm }) => [track.filePath, track.sourceVersion ?? '', track.calibrationSignature ?? '', [...channels], startNorm, endNorm])], version: { by: 'request' } });
            if (peaks.ask(key)) {
                const requestId = `${PREFIX}-${++count}`;
                waiting.set(requestId, peak => {
                    if (peak === null) peaks.fail(key);
                    else peaks.ready(key, peak);
                });
                post({ type: 'request-region-peak', requestId, sources: of.map(({ track, channels, startNorm, endNorm }) => ({ filePath: track.filePath, sourceVersion: track.sourceVersion, channels: [...channels], startNorm, endNorm })) });
            }
            const state = peaks.state(key);
            const value = peaks.value(key);
            return value !== undefined ? { state: 'ready', value } : state === 'failed' ? { state: 'failed' } : { state: 'pending' };
        },
        handle(message) {
            const { requestId } = message;
            if (typeof requestId !== 'string' || !requestId.startsWith(`${PREFIX}-`)) return false;
            const done = waiting.get(requestId);
            waiting.delete(requestId);
            const peak = (message as { peak?: unknown }).peak;
            // The backend's number as it is, or none: the read failed.
            done?.(message.type === 'region-peak-result' && typeof peak === 'number' && Number.isFinite(peak) ? peak : null);
            return true;
        },
        clear() { peaks.clear(); waiting.clear(); },
    };
}
