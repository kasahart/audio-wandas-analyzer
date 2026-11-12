/**
 * The largest |sample| of the compared channels over a region: where a new trigger's level starts (half of it,
 * stepBarModel.startValues). Display rules R1: it is a number computed with, so it comes from every sample.
 *
 * It is read from each channel's full data through the same route as a readout (FullSource.level: the backend takes
 * the peak of the source samples, full_read.read_level; fetchedSource keeps the answer and asks a failed one again
 * after the answer store's pause). It is never taken from the envelope a lane draws: that is thinned, for drawing.
 *
 * There is no cache and no retry here. To change how long an answer is kept or when a failure is asked again, change
 * answerStore.ts; to change what the backend measures, change full_read.read_level.
 */
import type { Whole } from '../../shared/provenance';
import type { FullSource } from './fullRead';

/**
 * - 'ready': every channel's peak is in; `value` is the largest (0 for silence).
 * - 'pending': at least one is still being fetched. `ready` (regionPeak's argument) is called once it is in.
 * - 'failed': at least one read failed or the channel has no full data to read. `ready` is called once the answer
 *   store's pause is over, and the read is asked again then.
 *
 * Only 'ready' carries a number: a caller cannot show an estimate while the others last.
 */
export type RegionPeak = { state: 'ready'; value: Whole } | { state: 'pending' } | { state: 'failed' };

/** One channel's samples and the stretch of its own axis to measure (a lane's axis is its file's 0..1). */
export interface PeakWindow {
    full: FullSource;
    x0: number;
    x1: number;
}

/** The peak over every window (see RegionPeak); undefined with no window at all (nothing is compared). */
export function regionPeak(windows: readonly PeakWindow[], ready: () => void): RegionPeak | undefined {
    if (!windows.length) return undefined;
    // Every window is asked before any answer is judged, so the reads go out together, not one per repaint.
    const answers = windows.map(window => window.full.level({ x0: window.x0, x1: window.x1, square: true }, ready));
    const peaks: Whole[] = [];
    let pending = false;
    for (const answer of answers) {
        if (answer === undefined) { pending = true; continue; }
        // null: the read failed, or the source has nothing to measure. An answer without a peak is not one of a signal.
        if (answer === null || answer.peak === undefined) return { state: 'failed' };
        peaks.push(answer.peak);
    }
    if (pending) return { state: 'pending' };
    // The largest of the channels' peaks: one of the values read, so it is still a number of the full data.
    let largest = peaks[0];
    for (const peak of peaks) if (peak > largest) largest = peak;
    return { state: 'ready', value: largest };
}
