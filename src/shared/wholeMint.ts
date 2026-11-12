/**
 * The mint of `Whole` (provenance.ts): the only place a number becomes a value of the full data.
 *
 * Nothing here is a function that turns a number into a `Whole` for whoever imports it. A module gets the mint by
 * claiming it (`claimMint`), and it can be claimed once for each holder named in `Mints`: fullRead.ts, which reads
 * full data, and wholeAnswers.ts, which adapts the backend answers that are full by the protocol. A second claim
 * throws when the page loads, so no other module can take a holder's mint; provenanceBoundary.test.ts also fails on
 * any other reference to this file, on a holder handing its mint on, and on a cast to `Whole`.
 *
 * To make a new number readable: read it through a layer's FullSource (fullRead.ts), or, for a number the backend
 * takes of every value, add an adapter to wholeAnswers.ts. Do not add a holder here unless a new module's whole job
 * is reading full data; a holder widens what every readout trusts.
 *
 * In tests, src/test/helpers/whole.ts makes a `Whole` of a made-up number. Product code cannot use it.
 */
import type { WholeFields } from './protocol/generated/backendProtocolSchema';
import type { Drawn, Whole } from './provenance';

/** fullRead.ts's mint: values the webview holds every one of (a full read's reply, an array a caller held whole). */
export interface HeldMint {
    value(held: number): Whole;
    values(held: readonly number[]): Whole[];
    valuesOrGaps(held: readonly (number | null)[]): (Whole | null)[];
    rows(held: ReadonlyArray<ReadonlyArray<number | null>>): (Whole | null)[][];
}

/** The names of the fields of `T` that hold a number. */
type NumberFields<T> = { [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never }[keyof T];

/** `T` with its numbers as `Whole`: an array (of arrays) of numbers and gaps. */
type Wholed<T> = T extends number ? Whole : T extends ReadonlyArray<infer Item> ? Wholed<Item>[] : T;

/** wholeAnswers.ts's mint: it takes a backend answer and says which part is full, never a bare number. */
export interface AnswerMint {
    /**
     * A number of a backend answer that the protocol says is taken of every value. Given as the answer and the
     * field's name, so each call shows which answer the number came from. The caller checks the field is present.
     */
    field<T extends object>(answer: T, name: NumberFields<T>): Whole;
    /**
     * An array of a backend answer that the protocol's schema marks as every value of the data (`x-whole` in
     * python-backend/protocol_schema.py; the generated `WholeFields` lists them). `definition` is the answer's type
     * in the schema and `name` one of its whole arrays: any other field, or any other array, does not compile.
     */
    every<N extends keyof WholeFields, K extends keyof WholeFields[N]>(definition: N, answer: Pick<WholeFields[N], K>, name: K): Wholed<WholeFields[N][K]>;
    /**
     * An array typed `Drawn` that is every value after all (a 'bar' picture's bands). The caller checks that
     * condition first and says so in its comment.
     */
    everyValue(values: readonly (Drawn | null)[]): (Whole | null)[];
    /** The same for an array without gaps (a slice the backend did not cut for display). */
    everyBin(values: readonly Drawn[]): Whole[];
}

interface Mints { fullRead: HeldMint; wholeAnswers: AnswerMint }

// These do nothing at run time: a mint is where the claim "this is full data" is made. Each is taken out as it is
// claimed, so it can be given once.
const unclaimed: Partial<Mints> = {
    fullRead: {
        value: held => held as Whole,
        values: held => held as Whole[],
        valuesOrGaps: held => held as (Whole | null)[],
        rows: held => held as (Whole | null)[][],
    },
    wholeAnswers: {
        field: (answer, name) => answer[name] as Whole,
        every: (_definition, answer, name) => answer[name] as never,
        everyValue: values => values as (Whole | null)[],
        everyBin: values => values as Whole[],
    },
};

/**
 * The mint of `holder`, given once: the holder's own module claims it as it loads (`const mint = claimMint('fullRead')`)
 * and keeps it to itself. A second claim of the same holder throws.
 */
export function claimMint<H extends keyof Mints>(holder: H): Mints[H] {
    const mint = unclaimed[holder];
    if (!mint) {
        throw new Error(`The mint of Whole for ${holder}.ts was claimed twice. Only src/webview/runtime/${holder}.ts may claim it, once. To read a full-data value elsewhere, read it through a FullSource (fullRead.ts) or add an adapter to wholeAnswers.ts. See src/shared/wholeMint.ts.`);
    }
    delete unclaimed[holder];
    return mint;
}
