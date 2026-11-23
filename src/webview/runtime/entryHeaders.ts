/**
 * The entry table's reading of the files' headers (their channels, lengths and sample rates; no audio decoded), and
 * what reading a set of recordings costs by those lengths.
 */
import { createFailureHold, createLatestAnswers } from './answerStore';
import type { EntryProbeMessage, EntryProbePublication } from '../../shared/analysis/entryScan';

/**
 * What reading recordings takes, for the estimate before a large base group is read: a fixed part per file and a
 * part per second of audio (a 10-minute recording takes far longer than a 2-second one). A file whose length is not
 * known yet counts as UNKNOWN_DURATION_S.
 */
export const PER_FILE_MS = 100, UNKNOWN_DURATION_S = 10;
const PER_AUDIO_SECOND_MS = 35;

/** How much audio these files are, and about how long reading them takes. */
export function readCost(paths: readonly string[], durationOf: (path: string) => number | undefined): { seconds: number; ms: number } {
    const seconds = paths.reduce((sum, path) => sum + (durationOf(path) ?? UNKNOWN_DURATION_S), 0);
    return { seconds, ms: paths.length * PER_FILE_MS + PER_AUDIO_SECOND_MS * seconds };
}

export interface HeaderInfo { durationS?: number; sampleRate?: number; calibrated?: boolean }

export interface HeaderProbe {
    /** Channels read from the headers, the headers that could not be read (why), and the lengths the headers say. */
    readonly channels: ReadonlyMap<string, number>;
    readonly errors: ReadonlyMap<string, string>;
    /** Each file's own information: the length and the sample rate its header says, and whether the host has a calibration for it. */
    readonly info: ReadonlyMap<string, HeaderInfo>;
    /** The reading running, as far as it has come. */
    progress(): { done: number; total: number } | null;
    /**
     * The request for the headers of `paths` not read yet (none when all are), replacing one still running;
     * `nextId` is asked only when there is one.
     */
    start(paths: readonly string[], nextId: () => string): EntryProbeMessage | null;
    /** Stops the reading; whether one was running. */
    cancel(): boolean;
    /** A header from the host: of another request (ignored), one file's, or the end of the reading. */
    take(publication: EntryProbePublication): 'stale' | 'result' | 'done';
    /** Forgets every header and the reading running (another folder). */
    clear(): void;
    /**
     * One file's header is read again by the next reading (the file was written on disk). What it said stays until
     * the new header is in: the file's rows and their channels do not go and come back, and what is compared as one
     * of its channels stays that channel meanwhile.
     */
    forget(path: string): void;
    /** The host says the file's calibration is another now: whether it has one (its header is as it was). */
    calibrated(path: string, calibrated: boolean): void;
}

/** `retried`: called once a header that could not be read may be read again (its pause is over): the screen reads it then. */
export function createHeaderProbe(now: () => number = () => Date.now(), retried?: () => void): HeaderProbe {
    // Each file's header as read: its channels (or why it could not be read) and its length.
    const channelAnswers = createLatestAnswers<number>();
    const infoAnswers = createLatestAnswers<HeaderInfo>();
    const channels = channelAnswers.view, errors = channelAnswers.failures;
    // A header that could not be read (a file still being written) is read again once the store's pause is over.
    const unread = createFailureHold(now, retried);
    let running: { requestId: string; done: number; total: number } | null = null;
    // Headers to read again though one is held (forget).
    const again = new Set<string>();
    return {
        channels, errors, info: infoAnswers.view,
        progress: () => (running ? { done: running.done, total: running.total } : null),
        start(paths, nextId) {
            const pending = paths.filter(path => again.has(path) || (!channels.has(path) && !unread.holds(path)));
            if (!pending.length) return null;
            const requestId = nextId();
            running = { requestId, done: 0, total: pending.length };
            return { type: 'entry-probe', requestId, filePaths: [...pending] };
        },
        cancel() {
            if (!running) return false;
            running = null;
            return true;
        },
        take(header) {
            if (!running || header.requestId !== running.requestId) return 'stale';
            if (header.type === 'entry-probe-done') { running = null; return 'done'; }
            running.done++;
            again.delete(header.filePath);
            const { durationS, sampleRate, calibrated } = header;
            if (durationS !== undefined || sampleRate !== undefined || calibrated !== undefined) {
                infoAnswers.set(header.filePath, { ...(durationS !== undefined ? { durationS } : {}), ...(sampleRate !== undefined ? { sampleRate } : {}), ...(calibrated !== undefined ? { calibrated } : {}) });
            }
            if (header.channels) channelAnswers.set(header.filePath, header.channels);
            else if (header.error) { channelAnswers.fail(header.filePath, header.error); unread.fail(header.filePath); }
            return 'result';
        },
        clear() {
            channelAnswers.clear(); infoAnswers.clear(); unread.clear(); again.clear();
            running = null;
        },
        forget(path) {
            again.add(path); unread.clear(path);
        },
        calibrated(path, calibrated) { infoAnswers.set(path, { ...infoAnswers.view.get(path), calibrated }); },
    };
}
