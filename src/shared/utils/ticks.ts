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
