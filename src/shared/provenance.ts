/**
 * Where a number came from, in its type (display rules R1, R2, R7; docs/plot-layers.md, layer 4).
 *
 * - `Whole`: a value of the full data (a real bin, sample or cell, or a number the backend took of every one). The
 *   functions that write a data value a user reads (a readout, a headline, the point an arrow key steps to, a CSV
 *   cell) take `Whole`. A plain `number` is not a `Whole`: only the mints in wholeMint.ts make one, and only
 *   fullRead.ts and wholeAnswers.ts may call them.
 * - `Drawn`: a point thinned to be drawn (a picture's `values`, `matrix`, waveform envelope; which arrays these are
 *   is stated in python-backend/protocol_schema.py with `x-drawn`). A `Drawn` is not a `number`: it cannot be
 *   computed with, compared, formatted or minted. Drawing code turns it into pixels through drawnPoints.ts.
 *
 * So the compiler, for every value, keeps a thinned point from becoming a number a user reads: no expression takes
 * a `Drawn` to a `Whole`. src/test/provenanceBoundary.test.ts checks what the compiler cannot (who may mint, who
 * may unwrap, casts and coercions) and compiles deliberate violations to show each one fails.
 */
declare const WHOLE: unique symbol;
declare const THINNED: unique symbol;

/** A number of the full data. Usable wherever a number is; never made from a plain number outside wholeMint.ts. */
export type Whole = number & { readonly [WHOLE]: 'whole' };

/** What a `Drawn` is besides a number the wire or a test gave it: nothing a program can compute with. */
export interface Thinned { readonly [THINNED]: 'thinned' }

/**
 * A point thinned to be drawn. A number is assignable to it (the wire's JSON, a test's literal), but reading one
 * gives no number: arithmetic, comparison, formatting and number parameters refuse it until drawnPoints.ts unwraps it.
 */
export type Drawn = number | Thinned;

/** `fn` of whole values is whole (a Δ of two full values, a mean of every bin): the one way to compute with them. */
export function wholeOf<A extends readonly Whole[]>(fn: (...values: { [K in keyof A]: number }) => number, ...values: A): Whole {
    return fn(...(values as unknown as { [K in keyof A]: number })) as Whole;
}
