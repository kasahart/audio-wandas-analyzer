/**
 * For tests only: numbers a test made up, given the type of values of the full data (`Whole`, provenance.ts), so a
 * test can hand them to code that takes only full data. Product code cannot do this: it may not cast to `Whole`,
 * and it may not import anything under src/test (provenanceBoundary.test.ts fails on both).
 */
import type { Whole } from '../../shared/provenance';
import { localCells, localLine, type InlineFullSource } from '../../webview/runtime/fullRead';

export const wholeValue = (value: number): Whole => value as Whole;
/** An array (or rows) of made-up numbers and gaps as whole values. */
export function wholeValues(values: readonly number[]): Whole[];
export function wholeValues(values: readonly (number | null)[]): (Whole | null)[];
export function wholeValues(values: readonly (number | null)[]): (Whole | null)[] {
    return values as (Whole | null)[];
}
export const wholeRows = (rows: ReadonlyArray<ReadonlyArray<number | null>>): (Whole | null)[][] => rows as (Whole | null)[][];
/** `localLine` of made-up values: a test's stand-in for a line held whole. */
export const testLine = (xs: readonly number[], values: readonly (number | null)[]): InlineFullSource => localLine(xs, wholeValues(values));
/** `localCells` of made-up cells. */
export const testCells = (xs: readonly number[], ys: readonly number[], matrix: ReadonlyArray<ReadonlyArray<number | null>>, rowNames?: readonly string[]): InlineFullSource => localCells(xs, ys, wholeRows(matrix), rowNames);
/** A table's band levels by row key, of made-up numbers. */
export const wholeBands = (entries: Iterable<readonly [string, (number | null)[]]>): Map<string, (Whole | null)[]> => new Map(entries) as Map<string, (Whole | null)[]>;
