/**
 * The ends of a specified range (指定範囲) as layer 3 makes them: today's rule (R9), unchanged, in one place for the
 * old plots (figureModel.ts names it) and the Figure (figure-design.md 第 1 節: 指定範囲の端を作るのは 3 層目で、
 * 作り方はいまの規則（fieldWindow、R9）のまま). Layer 2 takes these ends exactly and never rounds them again.
 */
import { fieldDecimals } from '../shell/numberText';

/**
 * A zoom window's ends as it is painted and as its range popover writes them (R9): each at the decimals a range field
 * writes for the window's span (shell/numberText.ts fieldDecimals: a thousandth of it, at least 0.001), so the window is painted
 * from the very numbers the field shows, never a float step (a fraction times a span, a norm times a peak) off them.
 * A `kept` end (an axis's own end, or a typed one) is as it is. A window finer than the field's last decimal keeps
 * its own ends rather than closing up. Every window a plot is painted on, across or up, is made here.
 */
export function fieldWindow(low: number, high: number, kept: { min: boolean; max: boolean } = { min: false, max: false }): { min: number; max: number } {
    const decimals = fieldDecimals(high - low);
    const ends = { min: kept.min ? low : atDecimals(low, decimals), max: kept.max ? high : atDecimals(high, decimals) };
    return ends.max > ends.min ? ends : { min: low, max: high };
}

/** `value` at `decimals` decimals, the nearest such number (never −0); a number too large for decimals as it is. */
export function atDecimals(value: number, decimals: number): number {
    return Math.abs(value) < 1e21 ? Number(value.toFixed(decimals)) + 0 : value;
}
