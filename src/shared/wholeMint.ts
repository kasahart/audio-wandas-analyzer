/**
 * The mints of `Whole` (provenance.ts): the only places a plain number becomes a value of the full data. They do
 * nothing at run time; they are where the claim "this is full data" is made, so they may be called only from the
 * modules that read full data (fullRead.ts) or adapt a backend answer whose field is full by the protocol
 * (wholeAnswers.ts). provenanceBoundary.test.ts fails on a reference anywhere else, and on a cast to `Whole`.
 */
import type { Drawn, Whole } from './provenance';

export const mintWhole = (value: number): Whole => value as Whole;
export const mintWholeOrGap = (value: number | null): Whole | null => value as Whole | null;
export const mintWholes = (values: readonly number[]): Whole[] => values as Whole[];
export const mintWholesOrGaps = (values: readonly (number | null)[]): (Whole | null)[] => values as (Whole | null)[];
export const mintWholeRows = (rows: ReadonlyArray<ReadonlyArray<number | null>>): (Whole | null)[][] => rows as (Whole | null)[][];
/**
 * An array typed `Drawn` taken as full data: only where the protocol says that array is every value after all (a
 * 'bar' picture's bands, a slice without `frequenciesHz`). The caller checks that condition first (wholeAnswers.ts).
 */
export const mintWholeDrawn = (values: readonly (Drawn | null)[]): (Whole | null)[] => values as (Whole | null)[];
export const mintWholeBins = (values: readonly Drawn[]): Whole[] => values as Whole[];
