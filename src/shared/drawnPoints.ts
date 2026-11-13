/**
 * Where a `Drawn` (provenance.ts) becomes a number: only to be turned into pixels. A picture's thinned points are
 * typed `Drawn` so that no code computes with them or writes them as text; the code that draws them calls
 * `drawable` to place them on the canvas. Only the drawing modules listed in src/test/provenanceBoundary.test.ts may
 * refer to this file. A number a user reads is never taken from here: it is a `Whole`, read through fullRead.ts.
 */
import type { Drawn } from './provenance';

/** A drawn point as the number of pixels' worth it is: for placing it on a canvas, nothing else. */
export const drawable = (value: Drawn): number => value as number;
/** A line of drawn points (a gap is null), for drawing. */
export const drawableLine = (line: ReadonlyArray<Drawn | null>): ReadonlyArray<number | null> => line as ReadonlyArray<number | null>;
/** An image's rows of drawn cells, for drawing. */
export const drawableRows = (rows: ReadonlyArray<ReadonlyArray<Drawn | null>>): ReadonlyArray<ReadonlyArray<number | null>> => rows as ReadonlyArray<ReadonlyArray<number | null>>;
/** A waveform envelope's buckets (no gaps), for drawing. */
export const drawableBuckets = (line: readonly Drawn[]): readonly number[] => line as readonly number[];
