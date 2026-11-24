/**
 * Small things the comparison's panes share: the 1/3-octave centres, a region's key and label, and how a Δ and a
 * quantile are taken. (What is left of the entry table's own analysis model, which is gone: the entry
 * computes nothing.)
 */


/**
 * A region as a key: its ends exactly as they are sent (JSON reads each back to the same double), so two regions share
 * a key only when they are the same request, and so ask for the same samples. regionLabel rounds it for reading, and is
 * never a key's part. The step answers of the Tracks are keyed by it (trackStageModel.ts), so two regions are one
 * condition exactly when they are one key (docs/display-rules.md R15).
 */
export function regionKey(region: { start: number; end: number } | null): string {
    return region ? JSON.stringify([region.start, region.end]) : 'all';
}

export function regionLabel(region: { start: number; end: number } | null): string {
    return region ? `${region.start.toFixed(2)}–${region.end.toFixed(2)}` : 'all';
}
