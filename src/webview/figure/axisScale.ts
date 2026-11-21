/**
 * Values and places on screen, in one place
 * (figure-design.md 第 4 節: 値と画面の位置を行き来する座標変換。実装は 1 つで、段ごとに 1 つ作る). The scale
 * a read request carries (px per axis unit; on a log axis px per natural-log unit) comes from here too.
 *
 * Layer 3's alone (第 2 節): a logarithmic axis is a conversion between values and places, not a value.
 */

/** A part of an axis as fractions of the whole (0 at its low end, 1 at its high end). */
export interface AxisPart {
    start: number;
    end: number;
}

/** The whole axis (0–1). */
export const WHOLE_PART: AxisPart = { start: 0, end: 1 };

/** An axis from `low` to `high`: a value's fraction along it and the value at a fraction (log: geometric). */
export interface AxisScale {
    low: number;
    high: number;
    log: boolean;
    fraction: (value: number) => number;
    at: (fraction: number) => number;
}

/** The scale of an axis from `low` to `high`, logarithmic or linear. */
export function axisScale(low: number, high: number, log: boolean): AxisScale {
    if (log) return { low, high, log, fraction: value => Math.log(value / low) / Math.log(high / low), at: fraction => low * (high / low) ** fraction };
    return { low, high, log, fraction: value => (value - low) / (high - low || 1), at: fraction => low + fraction * (high - low) };
}

/**
 * The part of an axis on screen: `part` (fractions of the whole axis) stretched across the plot. A zoomed part's
 * ends are made at the decimals its range popover writes (`endsRule`: fieldWindow, R9): the plot is painted from
 * `low` and `high`, and the popover writes these very numbers. The whole axis keeps its own ends.
 */
export function windowedScale(scale: AxisScale, part: AxisPart, endsRule: (low: number, high: number, kept: { min: boolean; max: boolean }) => { min: number; max: number }): AxisScale {
    const kept = { min: part.start === 0, max: part.end === 1 };
    const ends = endsRule(kept.min ? scale.low : scale.at(part.start), kept.max ? scale.high : scale.at(part.end), kept);
    const start = kept.min ? 0 : scale.fraction(ends.min), end = kept.max ? 1 : scale.fraction(ends.max);
    const span = end - start || 1;
    return {
        low: ends.min, high: ends.max, log: scale.log,
        fraction: value => (scale.fraction(value) - start) / span,
        at: fraction => (fraction === 0 ? ends.min : fraction === 1 ? ends.max : scale.at(start + fraction * span)),
    };
}

/** A value axis drawn up a box: exact places for every decision, a held one for a mark (R14). */
export interface ValueScale {
    /** A value's exact y, held nowhere: the pick's scale, a hit test, the read mark's place. */
    yOf: (value: number) => number;
    /** A value's y held inside the box (a point's mark). */
    yAt: (value: number) => number;
    /** The box's height over the axis's span: px per value unit. */
    pixelsPerUnit: number;
    /** The value at a y. */
    levelOf: (y: number) => number;
}

/** The value axis `range` drawn up the box from `top`, `height` px tall (the one place a value axis becomes pixels). */
export function valueScale(range: { readonly min: number; readonly max: number }, box: { readonly top: number; readonly height: number }): ValueScale {
    const { min, max } = range;
    const { top, height } = box;
    const span = max - min;
    const yOf = (value: number): number => top + (1 - (value - min) / span) * height;
    return {
        yAt: value => yOf(Math.max(min, Math.min(max, value))),
        yOf,
        pixelsPerUnit: height / span,
        levelOf: y => min + (1 - (y - top) / height) * span,
    };
}
