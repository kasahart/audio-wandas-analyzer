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
 * An auto range widened outward to round ends: the coarsest step of 1, 2 or 5 times a power of ten (at most a fifth
 * of the span) that moves neither end by more than 8% of the span, so -120…-23.21 dB becomes -120…-20 and
 * -120…-19.9 becomes -120…-15 rather than -120…-10.
 */
export function niceRange(low: number, high: number): { low: number; high: number } {
    if (!Number.isFinite(low) || !Number.isFinite(high) || !(high > low)) return { low, high };
    const span = high - low, slack = span * 0.08;
    // Rounded to the step's precision (and -0 to 0) so -120 never comes back as -120.00000000000001.
    const round = (value: number) => +value.toPrecision(12) + 0;
    const widened = (step: number) => ({ low: round(Math.floor(round(low / step)) * step), high: round(Math.ceil(round(high / step)) * step) });
    let power = 10 ** Math.floor(Math.log10(span / 5));
    for (;;) {
        for (const size of [5, 2, 1]) {
            const step = size * power;
            if (step > span / 5 * (1 + 1e-9)) continue;
            const range = widened(step);
            // A step no wider than the slack always fits, so the loop ends there at the latest.
            // A span below the rounding precision would collapse to one value; it keeps its own ends.
            // Only ever widened: a span below the rounding precision may round its ends inward past the data, and then
            // it keeps its own ends (else the extremes would fall off the axis).
            if (step <= slack || (range.high - high <= slack && low - range.low <= slack)) return range.high > range.low && range.low <= low && range.high >= high ? range : { low, high };
        }
        power /= 10;
    }
}

/** How far below its loudest value a heatmap's colours reach, as a spectrum's level axis spans at most 100 dB. */
export const HEATMAP_DB_SPAN = 100;

/**
 * A heatmap's automatic colour range in dB (R9), from its full data's lowest and highest value: the top is the
 * highest, the bottom the lowest but no more than HEATMAP_DB_SPAN under the top (digital silence, −240 dB, would
 * leave every sound in a few colours), both widened to round values.
 */
export function heatmapDbRange(low: number, high: number): { min: number; max: number } {
    const bottom = Math.max(low, high - HEATMAP_DB_SPAN);
    const { low: min, high: max } = niceRange(bottom, high > bottom ? high : bottom + 1);
    return { min, max };
}
