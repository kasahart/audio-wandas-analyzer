/** Levels (dB) power-averaged: 10·log10 of the mean of 10^(L/10), as channels and recordings are combined. */
export function powerMeanDb(levels: readonly number[]): number {
    return 10 * Math.log10(levels.reduce((sum, level) => sum + 10 ** (level / 10), 0) / levels.length);
}

/** The power mean, or null without levels or with one missing (not computed, no band there). */
export function powerMeanOrNull(levels: readonly (number | null | undefined)[]): number | null {
    return levels.length && levels.every(level => typeof level === 'number') ? powerMeanDb(levels) : null;
}
