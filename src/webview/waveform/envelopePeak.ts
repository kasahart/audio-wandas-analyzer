/**
 * The largest |value| of a waveform envelope, over a region (seconds of the recording) when one is given: what a
 * level trigger on that channel can reach there. The envelope's minT/maxT are positions in the recording (0–1);
 * without them, or without a region, it is the whole recording's peak.
 */
import { drawableBuckets } from '../../shared/drawnPoints';
import type { Drawn } from '../../shared/provenance';

export interface PeakEnvelope {
    min: readonly Drawn[];
    max: readonly Drawn[];
    minT?: readonly Drawn[];
    maxT?: readonly Drawn[];
    absolutePeak: number;
}

export function envelopePeak(envelope: PeakEnvelope | undefined, durationS: number, region?: { start: number; end: number } | null): number {
    if (!envelope) return 0;
    const whole = Number.isFinite(envelope.absolutePeak) ? Math.abs(envelope.absolutePeak) : 0;
    if (!region || !(durationS > 0) || !envelope.minT || !envelope.maxT) return whole;
    const from = region.start / durationS, to = region.end / durationS;
    let peak = 0;
    const take = (values: readonly number[], at: readonly number[]): void => {
        values.forEach((value, index) => {
            const t = at[index];
            if (t !== undefined && t >= from && t <= to && Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
        });
    };
    // A min/max envelope keeps every bucket's extremes, so its largest is the samples' peak; only its time is the bucket's.
    take(drawableBuckets(envelope.min), drawableBuckets(envelope.minT));
    take(drawableBuckets(envelope.max), drawableBuckets(envelope.maxT));
    return peak;
}
