/**
 * The mints of `Whole` (provenance.ts): the only places a plain number becomes a value of the full data. They do
 * nothing at run time; they are where the claim "this is full data" is made, so they may be called only from the
 * modules that read full data (fullRead.ts) or adapt a backend answer whose field is full by the protocol
 * (wholeAnswers.ts). provenanceBoundary.test.ts fails on a reference anywhere else, and on a cast to `Whole`.
 */
import type { Whole } from './provenance';

export const mintWhole = (value: number): Whole => value as Whole;
export const mintWholeOrGap = (value: number | null): Whole | null => value as Whole | null;
export const mintWholes = (values: readonly number[]): Whole[] => values as Whole[];
export const mintWholesOrGaps = (values: readonly (number | null)[]): (Whole | null)[] => values as (Whole | null)[];
export const mintWholeRows = (rows: ReadonlyArray<ReadonlyArray<number | null>>): (Whole | null)[][] => rows as (Whole | null)[][];
