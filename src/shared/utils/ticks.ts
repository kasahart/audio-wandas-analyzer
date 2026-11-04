/** Axis ticks at round values, shared by the app's plots (the clock-time ruler keeps its own minute steps). */

/** A tick step of 1, 2, 2.5 or 5 times a power of ten, about `raw` wide. */
export function niceStep(raw: number): number {
    if (!(raw > 0) || !Number.isFinite(raw)) return 1;
    const power = 10 ** Math.floor(Math.log10(raw));
    return ([1, 2, 2.5, 5, 10].find(step => step * power >= raw) ?? 10) * power;
}

/** The round values from `low` to `high`, at most about `count` of them, one niceStep apart. */
export function niceTicks(low: number, high: number, count: number): number[] {
    const step = niceStep((high - low) / Math.max(1, count));
    const values: number[] = [];
    // Each value is computed from its index and rounded to the step, so no floating-point drift accumulates.
    for (let index = Math.ceil(low / step); index * step <= high + step * 1e-9; index++) values.push(+(index * step).toPrecision(12));
    return values;
}

/**
 * An auto range widened outward to round ends: the step is the largest 1, 2 or 5 times a power of ten that fits ten
 * times in the span, so -23.21…-120 dB becomes -20…-120 and each end moves by less than a tenth of the span.
 */
export function niceRange(low: number, high: number): { low: number; high: number } {
    if (!Number.isFinite(low) || !Number.isFinite(high) || !(high > low)) return { low, high };
    const raw = (high - low) / 10;
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = ([5, 2, 1].find(size => size * power <= raw * (1 + 1e-9)) ?? 1) * power;
    // Rounded to the step's precision (and -0 to 0) so -120 never comes back as -120.00000000000001.
    const round = (value: number) => +value.toPrecision(12) + 0;
    return { low: round(Math.floor(round(low / step)) * step), high: round(Math.ceil(round(high / step)) * step) };
}
