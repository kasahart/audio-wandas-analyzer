/**
 * For tests only: a number a test made up, given the type of a value of the full data (`Whole`, provenance.ts), so a
 * test can hand one to a function that takes only full data. Product code may not do this (provenanceBoundary.test.ts).
 */
import { mintWhole } from '../../shared/wholeMint';

export const wholeValue = mintWhole;
