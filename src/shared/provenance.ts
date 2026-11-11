/**
 * Where a number came from, in its type (display rules R1, R2, R7; docs/plot-contracts-guide.md).
 *
 * `Whole` is a value of the full data: a real bin, sample or cell, or a number the backend took of every one. The
 * functions that write a data value a user reads (a readout, a headline, the point an arrow key steps to) take
 * `Whole`. A plain `number` is not a `Whole`: only the mints in wholeMint.ts make one, and only the modules listed in
 * src/test/provenanceBoundary.test.ts may call them. So the compiler, not a scan, keeps a number that did not come
 * from the full data out of a readout.
 */
declare const WHOLE: unique symbol;

/** A number of the full data. Usable wherever a number is; never made from a plain number outside wholeMint.ts. */
export type Whole = number & { readonly [WHOLE]: 'whole' };

/** `fn` of whole values is whole (a Δ of two full values, a mean of every bin): the one way to compute with them. */
export function wholeOf<A extends readonly Whole[]>(fn: (...values: { [K in keyof A]: number }) => number, ...values: A): Whole {
    return fn(...(values as unknown as { [K in keyof A]: number })) as Whole;
}

/** The smallest and largest of whole values are whole. */
export const wholeMin = (values: readonly Whole[]): Whole => Math.min(...values) as Whole;
export const wholeMax = (values: readonly Whole[]): Whole => Math.max(...values) as Whole;
