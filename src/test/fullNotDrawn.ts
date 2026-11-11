import assert from 'node:assert/strict';

/**
 * The second half of a proof that code computes from the full data (plot contracts, docs/plot-contracts.md): its
 * answer is not the one the points thinned to draw would give.
 *
 * A proof test sets up data whose full resolution and drawn points differ, asserts the code's answer outright
 * (`assert.equal(answer, expected)`), and then calls this with the same answer and the answer worked out from the
 * drawn points (the thinned line, the envelope, the averaged cells) in the test itself. The contract test
 * (plotContracts.test.ts, `distinguishes`) requires both sides to be made of the test's inputs: never null, a
 * literal, or the same expression twice.
 */
export function assertNotDrawn(answer: unknown, drawn: unknown, message?: string): void {
    assert.notDeepEqual(answer, drawn, message ?? 'the answer is the one the drawn points give: it must come from the full data');
}

/** The value of `xs` nearest `x`: where a readout taken from the drawn points would be. */
export function nearestOf(xs: Iterable<number | null>, x: number): number {
    let best = NaN;
    for (const value of xs) if (value !== null && (Number.isNaN(best) || Math.abs(value - x) < Math.abs(best - x))) best = value;
    return best;
}

/** The `n`th value of `xs` after `x` (n = 1: the next): where `n` arrow keys would land on the drawn points. */
export function nthAfter(xs: Iterable<number | null>, x: number, n = 1): number {
    return [...xs].filter((value): value is number => value !== null && value > x).sort((a, b) => a - b)[n - 1] ?? NaN;
}

/** `values` thinned by averaging into `count` points: what a picture that averages its buckets would hold. */
export function averagedInto(values: readonly number[], count: number): number[] {
    const size = Math.max(1, Math.floor(values.length / count));
    const out: number[] = [];
    for (let start = 0; start + size <= values.length; start += size) out.push(values.slice(start, start + size).reduce((sum, value) => sum + value, 0) / size);
    return out;
}

/** `values` thinned to each bucket's highest, into `count` points: what an envelope kept for drawing holds. */
export function peaksInto(values: readonly number[], count: number): number[] {
    const size = Math.max(1, Math.ceil(values.length / count));
    const out: number[] = [];
    for (let start = 0; start < values.length; start += size) out.push(Math.max(...values.slice(start, start + size)));
    return out;
}
