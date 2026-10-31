/**
 * The entry table's work with the host before and during a computation: reading the files' headers (their
 * channels and lengths, no audio decoded) and the progress and cost of the scan the user started with 「計算」.
 */
import type { EntryProbeMessage, EntryProbePublication } from '../../shared/analysis/entryScan';

/**
 * What a computation takes, for the estimate on 「計算」: a fixed part per file and a part per second of audio
 * (a 10-minute recording takes far longer than a 2-second one). The per-second part is measured once a
 * computation has done a few files. A file whose length is not known yet counts as UNKNOWN_DURATION_S.
 */
export const PER_FILE_MS = 100, UNKNOWN_DURATION_S = 10;
const INITIAL_PER_AUDIO_SECOND_MS = 35;
/** Files a computation does before its pace replaces the initial guess. */
const CALIBRATE_AFTER = 5;

export interface ScanProgress {
    /** A computation the user started is running. */
    readonly running: boolean;
    /** Files done, of the files it was started on. */
    readonly done: number;
    readonly total: number;
    /** About how long computing these files takes, by their lengths. */
    estimateMs(paths: readonly string[]): number;
    /** How much audio these files are. */
    seconds(paths: readonly string[]): number;
    start(total: number): void;
    /** A file of the running computation is done (nothing while none runs). */
    fileDone(path: string): void;
    /** Ends the computation; whether one was running. */
    stop(): boolean;
}

export function createScanProgress(now: () => number, durationOf: (path: string) => number | undefined): ScanProgress {
    let perAudioSecondMs = INITIAL_PER_AUDIO_SECOND_MS;
    let running = false;
    let started = 0;
    let done = 0;
    let total = 0;
    let doneSeconds = 0;
    const lengthOf = (path: string): number => durationOf(path) ?? UNKNOWN_DURATION_S;
    return {
        get running() { return running; },
        get done() { return done; },
        get total() { return total; },
        estimateMs: paths => paths.reduce((sum, path) => sum + PER_FILE_MS + perAudioSecondMs * lengthOf(path), 0),
        seconds: paths => paths.reduce((sum, path) => sum + lengthOf(path), 0),
        start(files) {
            running = true;
            started = now();
            done = 0;
            doneSeconds = 0;
            total = files;
        },
        fileDone(path) {
            if (!running) return;
            done++;
            doneSeconds += lengthOf(path);
            const elapsed = now() - started;
            if (done >= CALIBRATE_AFTER && doneSeconds > 0) perAudioSecondMs = Math.max(1, (elapsed - PER_FILE_MS * done) / doneSeconds);
        },
        stop() {
            const was = running;
            running = false;
            return was;
        },
    };
}

export interface HeaderProbe {
    /** Channels read from the headers, the headers that could not be read (why), and the lengths the headers say. */
    readonly channels: ReadonlyMap<string, number>;
    readonly errors: ReadonlyMap<string, string>;
    readonly durations: ReadonlyMap<string, number>;
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
}

export function createHeaderProbe(): HeaderProbe {
    const channels = new Map<string, number>();
    const errors = new Map<string, string>();
    const durations = new Map<string, number>();
    let running: { requestId: string; done: number; total: number } | null = null;
    return {
        channels, errors, durations,
        progress: () => (running ? { done: running.done, total: running.total } : null),
        start(paths, nextId) {
            const pending = paths.filter(path => !channels.has(path) && !errors.has(path));
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
            if (header.durationS !== undefined) durations.set(header.filePath, header.durationS);
            if (header.channels) channels.set(header.filePath, header.channels);
            else if (header.error) errors.set(header.filePath, header.error);
            return 'result';
        },
        clear() {
            channels.clear(); errors.clear(); durations.clear();
            running = null;
        },
    };
}
