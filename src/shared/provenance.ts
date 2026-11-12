/**
 * Where a number came from, in its type (display rules R1, R2, R7; docs/plot-layers.md, layer 4).
 *
 * - `Whole`: a value of the full data (a real bin, sample or cell, or a number the backend took of every one). The
 *   functions that write a data value a user reads (a readout, a headline, the point an arrow key steps to, a CSV
 *   cell) take `Whole`. A plain `number` is not a `Whole`: only the mint of wholeMint.ts makes one, and
 *   only fullRead.ts and wholeAnswers.ts hold it (each claims it once; a second claim throws).
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
declare const EVERY: unique symbol;
declare const DERIVED: unique symbol;

/** A number of the full data. Usable wherever a number is; never made from a plain number outside wholeMint.ts. */
export type Whole = number & { readonly [WHOLE]: 'whole' };

/** What a `Drawn` is besides a number the wire or a test gave it: nothing a program can compute with. */
export interface Thinned { readonly [THINNED]: 'thinned' }

/**
 * A point thinned to be drawn. A number is assignable to it (the wire's JSON, a test's literal), but reading one
 * gives no number: arithmetic, comparison, formatting and number parameters refuse it until drawnPoints.ts unwraps it.
 */
export type Drawn = number | Thinned;

/**
 * Every value of one line of the full data, in order, none left out (a null is a gap in the data itself). This is
 * what "the line is held whole" means, and it is a different claim from "each value is whole": a `Whole[]` that was
 * filtered or sliced still holds whole values, but it is no longer every one, and it is not a `WholeLine`
 * (`line.filter(…)` answers a plain array). Only the producers make one: a backend array the schema marks
 * `x-whole` (wholeAnswers.ts), and fullRead.ts (`computedLine`: a line computed value by value of whole lines, as
 * long as they are). What holds a line as a plot's full data (fullRead.ts `localLine`) takes only this.
 * It reads as an array of its values.
 */
export type WholeLine<V extends Whole | null = Whole | null> = ReadonlyArray<V> & { readonly [EVERY]: 'every value' };

/**
 * A number the webview computed of whole values (a Δ of two bins, a mean over channels): made only by fullRead.ts
 * `computedWhole`, which takes what it was computed of. It is a `Whole` (a readout may write it); the type says it
 * is not a value the backend measured, so a reviewer can find every one.
 */
export type Derived = Whole & { readonly [DERIVED]: 'computed of whole values' };
