/**
 * The largest |value| of a waveform envelope, over a region (seconds of the recording) when one is given: what a
 * level trigger on that channel can reach there. The envelope's minT/maxT are positions in the recording (0–1);
 * without them, or without a region, it is the whole recording's peak.
 */
export interface PeakEnvelope {
    min: readonly number[];
    max: readonly number[];
    minT?: readonly number[];
    maxT?: readonly number[];
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
    take(envelope.min, envelope.minT);
    take(envelope.max, envelope.maxT);
    return peak;
}
