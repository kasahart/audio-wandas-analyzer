/**
 * One channel of a Tracks row (録音の行): the figure spec, data only (figure-design.md 第 4 節).
 * This is all of the figure's code; what it draws, counts and reads is the figure
 * service's (python-backend/figures/), of the answers the backend keeps by key (python-backend/services/tracks_answers.py:
 * the channel's samples and its STFT's levels).
 *
 * The channel's waveform is a band lane (each pixel its lowest and highest sample; single samples where few are on
 * screen) and its spectrogram an image lane under it, over one time axis: the recording's own time, in seconds from
 * its start. Where the recording lies on the screen's shared time axis (its offset) is the screen's: it asks for the
 * range across in the recording's own time.
 *
 * A lane the row does not show, or whose answer is not kept (on its way, failed, too large to keep), is not in the
 * spec; with neither there is no spec and the screen says why in the row.
 */
import type { FigureLane, FigureSpec } from '../figure/index';

export const TRACK_WAVE_LANE = 'wave';
export const TRACK_SPECTROGRAM_LANE = 'spectrogram';
/** The one line of each lane (a lane is one channel's). */
export const TRACK_WAVE_LINE = 'signal';
export const TRACK_SPECTROGRAM_LINE = 'levels';

/** The kept answers of one channel (their keys; a key's version is the key itself). */
export interface TrackRowAnswers {
    readonly signal?: string;
    readonly image?: string;
    /** Whether the channel is calibrated: its axes say when it is not (R4). Not said where it is not known. */
    readonly calibrated?: boolean;
}

/** The kept answers of the other rows a row's scales are linked with (Link scales): their keys, nothing of them. */
export interface TrackRowLinked {
    readonly signals: readonly string[];
    readonly images: readonly string[];
}

/**
 * The spec of one channel's lanes: the waveform over the spectrogram; null with neither. `stale`: the answers are of
 * a version of the file that is no more (it changed since it was analysed): they stay drawn and are never read (R7).
 * `linked`: each lane's automatic scale is shared with those answers (`scaleWith`); which of them are of its unit and
 * reference, and the scale they share, are the figure service's to decide.
 */
export const trackRow = (answers: TrackRowAnswers, shows: { waveform: boolean; spectrogram: boolean }, stale = false, linked: TrackRowLinked | null = null): FigureSpec | null => {
    const lanes: FigureLane[] = [];
    const keys: string[] = [];
    const others: string[] = [];
    const shared = (own: string, with_: readonly string[] | undefined): { scaleWith: string[] } | Record<string, never> => {
        const rest = (with_ ?? []).filter(key => key !== own);
        others.push(...rest);
        return rest.length ? { scaleWith: rest } : {};
    };
    if (shows.waveform && answers.signal !== undefined) {
        lanes.push({ id: TRACK_WAVE_LANE, kind: 'band', lines: [{ id: TRACK_WAVE_LINE, of: { key: answers.signal } }], ...shared(answers.signal, linked?.signals) });
        keys.push(answers.signal);
    }
    if (shows.spectrogram && answers.image !== undefined) {
        lanes.push({ id: TRACK_SPECTROGRAM_LANE, kind: 'image', lines: [{ id: TRACK_SPECTROGRAM_LINE, of: { key: answers.image } }], ...shared(answers.image, linked?.images) });
        keys.push(answers.image);
    }
    if (!lanes.length) return null;
    // The row's own answers are stale with its file; the others' are named for their scale only.
    const calibrated = answers.calibrated === undefined ? {} : { calibrated: answers.calibrated };
    const own = keys.map(key => ({ key, state: stale ? 'stale' as const : 'usable' as const, version: key, ...calibrated }));
    const named = [...new Set(others)].filter(key => !keys.includes(key)).map(key => ({ key, state: 'usable' as const, version: key }));
    return { lanes, keys: [...own, ...named] };
};
