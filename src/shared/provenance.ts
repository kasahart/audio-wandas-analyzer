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
declare const EVERY_ROW: unique symbol;
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
 * `x-whole` (wholeAnswers.ts), and fullRead.ts `computedLine(from, map)`, which maps every value of one whole line
 * (and its index) to one value, so the line it makes is exactly as long as `from`: there is no way to give it a
 * length or an array of values (display rules R7, "a whole collection is made only by its producers").
 * What holds a line as a plot's full data (fullRead.ts `localLine`) takes only this. It reads as an array of its values.
 */
export type WholeLine<V extends Whole | null = Whole | null> = ReadonlyArray<V> & { readonly [EVERY]: 'every value' };

/**
 * Every row of an image of the full data, each row a `WholeLine`, none left out: what `WholeLine` is to a line, this is
 * to cells. A `ReadonlyArray<WholeLine>` says only that each row is whole; filtered or sliced rows
 * (`cells.filter(…)` answers a plain array) are no longer every row, and are not `WholeCells`. Only the producers
 * make one: a backend array of arrays the schema marks `x-whole` (wholeAnswers.ts), and fullRead.ts
 * `computedCells(from, map)`, which maps every cell of other `WholeCells` and keeps its rows and columns. What holds
 * cells as a plot's full data (fullRead.ts `localCells`) takes only this.
 */
export type WholeCells<V extends Whole | null = Whole | null> = ReadonlyArray<WholeLine<V>> & { readonly [EVERY_ROW]: 'every row' };

/**
 * A number the webview computed of whole values (a Δ of two bins, a mean over channels): made only by fullRead.ts
 * `computedWhole(from, compute)`, which hands `compute` the values of `from` and names whole what it answers, so the
 * number is computed of those values (provenanceBoundary.test.ts refuses a `compute` that ignores one). It is a
 * `Whole` (a readout may write it); the type says it is not a value the backend measured, so a reviewer can find
 * every one.
 */
export type Derived = Whole & { readonly [DERIVED]: 'computed of whole values' };
