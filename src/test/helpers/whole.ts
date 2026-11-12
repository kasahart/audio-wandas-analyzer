/**
 * For tests only: a number a test made up, given the type of a value of the full data (`Whole`, provenance.ts), so a
 * test can hand one to a function that takes only full data. Product code cannot do this: it may not cast to
 * `Whole`, and it may not import anything under src/test (provenanceBoundary.test.ts fails on both).
 */
import type { Whole } from '../../shared/provenance';

export const wholeValue = (value: number): Whole => value as Whole;
