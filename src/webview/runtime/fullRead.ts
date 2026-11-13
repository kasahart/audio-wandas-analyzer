/**
 * How a plot reads its numbers (R7): decimated data is only for drawing lines; the readout under the pointer and the
 * point an arrow key steps to come from the data before it was thinned. Every layer a plot draws declares where its
 * full data is read (StageLayer.full, required): an InlineFullSource the webview holds every value of (bars and
 * bands, a pair spectrum's every bin, a histogram's bins, localLine / localCells), or a FetchedFullSource the backend
 * holds (fetchedSource). The plot component (stagePanes.ts) reads only through it, never from what it draws, bars
 * included. A layer whose caller has no full data is given NO_FULL_DATA: it reads no number, and the plot marks it
 * (`data-plot-full`), which every ui-smoke test fails (canvasAudit.ts).
 *
 * A source gives what full_read.py gives: the points in a window and some past each end (`complete`: every point
 * between `start` and `end`), or for a window too dense to send whole, per pixel column its lowest, highest and the
 * point nearest the level under the pointer. A source the webview holds the data of answers at once (localLine,
 * localCells); one the backend holds (fetchedSource) asks for the window around the pointer, or the next steps, once,
 * keeps what came, and says when it is in (`ready`): until then the plot shows its marks and no number.
 */
import { answerKey, createAnswerStore, type AnswerKey, type PendingRequest } from './answerStore';
import type { StagePoints, StageRead } from '../../shared/protocol/backendProtocol';
import type { Derived, Whole, WholeCells, WholeLine } from '../../shared/provenance';
import { claimMint } from '../../shared/wholeMint';

/** This module's mint (wholeMint.ts): claimed once, used only in this file's readers, never handed on. */
const mint = claimMint('fullRead');

/** A line's points between two places of its horizontal axis (its own units), with `beyond` more past each end. */
export interface LineQuery {
    x0: number;
    x1: number;
    beyond: number;
    /** For a window too dense to send whole: the level under the pointer, the pixel columns across, a log axis. */
    near?: number;
    columns?: number;
    log?: boolean;
    /**
     * The pointer's place on the axis (`near` is its level) and the screen's scale there, pixels per axis unit (per
     * natural-log unit on a log axis) and per value unit: a dense window then holds the point nearest the pointer
     * on screen by its true distance (full_read._nearest_on_screen), read only at that place.
     */
    at?: number;
    pixels?: readonly [number, number];
    /**
     * The values the plot shows, low and high (its level or amplitude axis, zoomed): a dense window's point nearest the
     * pointer and the one under it are of the points on screen (full_read._on_screen), never one the plot cannot read.
     */
    shown?: readonly [number, number];
    /**
     * An arrow key's read (x0 = x1): the first point with a value to read strictly past x toward larger (1) or smaller
     * (-1) x, however far, with `beyond` past it (and the point before it), as one complete window.
     */
    seek?: -1 | 1;
    /**
     * With `seek`: the place of the point read among the source's every point (FullPoints.offset + its index), where
     * the reader knows it. Points may share one x (two recordings of the same value on the distribution): by x alone a
     * seek "strictly past x" would jump over all of them, so the seek then goes by place: the next readable point after
     * (or before) `from` in the data's own order, every point visited once, → and ← through the same ones (R7).
     * Only a source that numbers its points (`offset`) is asked so; the backend's lines never share an x.
     */
    from?: number;
    /**
     * A line of plain values (stagePanes' `floorless`: a signal, a metric over time, their Δ): −250 and below is a
     * value to read, not the silent floor, for the seek and a dense window's nearest point alike.
     */
    plain?: boolean;
}

/** Whether a line's value is one a plot reads (not a gap, nor, unless `plain`, the silent floor drawn as one). */
export function readableValue(value: number | null | undefined, plain = false): value is number {
    return value !== null && value !== undefined && Number.isFinite(value) && (plain || value > -250);
}

/** An image's cells around a place: its columns `beyond` either side of the one at `x`, its rows around `y`. */
export interface CellQuery {
    x: number;
    y: number;
    beyond: number;
    /** The rows' axis is logarithmic: their cells' edges are geometric (cellEdges), as the plot reads them. */
    rowLog?: boolean;
}

/**
 * Every value of a line between two places of its axis (both in), for the order of overlaid lines (R6): a level's
 * power 10^(dB/10), silence (−250 dB and below) as none, or a signal's square (`square`).
 */
export interface LevelQuery {
    x0: number;
    x1: number;
    square: boolean;
}

/** The mean power of the `count` finite values a LevelQuery takes (full_read.read_level): of the full data. */
export interface LevelSum {
    power: Whole;
    count: number;
    /** Of a signal (`square`): the largest |sample| among those values (0 with none), from every sample. */
    peak?: Whole;
}

/** undefined: being fetched (`ready` is called once it is in); null: there is no full data to measure. */
export type LevelAnswer = LevelSum | null | undefined;

/** A value's power as the overlay orders lines by (full_read.read_level). */
export function valuePower(value: number, square: boolean): number {
    return square ? value * value : value <= -250 ? 0 : 10 ** (value / 10);
}

/**
 * The mean power of a whole line's `values` (over ascending `xs`) between x0 and x1, every finite value taken
 * (LevelQuery). Not exported: a level of the full data is read through a source's `level`, which only a line held
 * whole (localLine) or the backend gives.
 */
function levelOfValues(xs: ArrayLike<number>, values: WholeLine, query: LevelQuery): LevelSum {
    const low = Math.min(query.x0, query.x1), high = Math.max(query.x0, query.x1);
    let power = 0, count = 0, peak = 0;
    for (let index = firstFrom(xs, low), n = Math.min(xs.length, values.length); index < n && xs[index] <= high; index++) {
        const value = values[index];
        if (value === null || value === undefined || !Number.isFinite(value)) continue;
        power += valuePower(value, query.square);
        peak = Math.max(peak, Math.abs(value));
        count += 1;
    }
    // `values` is every value (a WholeLine): their mean, and a signal's peak, are of the full data.
    return { power: mint.value(count ? power / count : 0), count, ...(query.square ? { peak: mint.value(peak) } : {}) };
}

/**
 * Points as full_read.py gives them, every value of the full data (`Whole`): what a readout may write. An image's
 * cells may name their rows (the entry overview's recordings).
 */
export interface FullPoints {
    xs: Whole[];
    values?: (Whole | null)[];
    ys?: Whole[];
    matrix?: (Whole | null)[][];
    start: number | null;
    end: number | null;
    complete: boolean;
    under?: number;
    /**
     * For a line: each point's distance to its nearer neighbour in the SOURCE data (null: it has none), as the source
     * says (full_read.source_steps, sourceSteps). A readout's digits come of this, never of the gap between the
     * points sent (display rules R7).
     */
    steps?: (number | null)[];
    level?: LevelSum;
    rowNames?: readonly string[];
    offset?: number;
}

/** The level of no values: what a line with nothing to measure answers. */
export const NO_LEVEL: LevelSum = Object.freeze({ power: mint.value(0), count: 0 });

/**
 * A full read's points as the backend answers them (full_read.py; `StagePoints`, whose arrays the schema marks
 * `x-whole`), as `FullPoints`. Only this file gives it a reply, where it arrives (fetchedSource).
 */
function fullPointsOf(points: StagePoints): FullPoints {
    return {
        xs: mint.values(points.xs), start: points.start, end: points.end, complete: points.complete,
        ...(points.values ? { values: mint.valuesOrGaps(points.values) } : {}),
        ...(points.ys ? { ys: mint.values(points.ys) } : {}),
        ...(points.matrix ? { matrix: mint.rows(points.matrix) } : {}),
        ...(points.under !== undefined ? { under: points.under } : {}),
        ...(points.steps ? { steps: points.steps } : {}),
        ...(points.level ? { level: { power: mint.value(points.level.power), count: points.level.count, ...(points.level.peak !== undefined ? { peak: mint.value(points.level.peak) } : {}) } } : {}),
    };
}

/**
 * Cells of full data the webview holds, cut around a place (the entry strip's every row and band): `matrix` must be
 * whole values; `xs` and `ys` are where they sit. For a source written by hand (see localCells for the usual one).
 */
export function heldCells(xs: readonly number[], ys: readonly number[], matrix: ReadonlyArray<ReadonlyArray<Whole | null>>, rest: Pick<FullPoints, 'start' | 'end' | 'complete' | 'rowNames'>): FullPoints {
    return { ...rest, xs: mint.values(xs), ys: mint.values(ys), matrix: matrix.map(row => [...row]) };
}

/**
 * The `valueRange` of a picture the webview makes of values it holds every one of (a band table, a threshold): their
 * lowest and highest, as the backend sends with its pictures (R1). A plot's range is set from `valueRange` alone,
 * never from the points drawn, so a picture made in the webview carries one or has no range of its own.
 * `floored`: of a level, whose silent floor (−300 dB) is no value.
 */
export function heldValueRange(values: WholeLine, floored: boolean): { valueRange?: { min: number; max: number } } {
    let min = Infinity, max = -Infinity;
    for (const value of values) {
        if (value === null || !Number.isFinite(value) || (floored && value <= -250)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
    }
    return max >= min ? { valueRange: { min, max } } : {};
}

/** undefined: being fetched (`ready` is called once it is in); null: there is no full data to read. */
export type FullAnswer = FullPoints | null | undefined;

/**
 * The reads of a full-data source. Every source has every one: a kind of read it cannot give is `cannotRead` (or
 * `noEvent`), never left out. So a reader asks `source.cells === cannotRead` where it must tell "this source has no
 * cells" from a read that failed. They are plain functions, not methods: none uses `this`, so one can be passed on
 * or compared by itself.
 */
interface FullSourceReads {
    readonly line: (query: LineQuery, ready: () => void) => FullAnswer;
    readonly cells: (query: CellQuery, ready: () => void) => FullAnswer;
    /** The power of every value of the line in a window (R6), from its full data. */
    readonly level: (query: LevelQuery, ready: () => void) => LevelAnswer;
    /** A trigger's event drawn as a line of its own (eventLayers): its own points. */
    readonly event: (id: number) => FullSource;
}

/** The read of a kind a source does not have: there is nothing of that kind to read (null), now and later. */
export const cannotRead = (): null => null;
/** The event line of a source that has none: a source with nothing to read. */
export const noEvent = (): FullSource => NO_FULL_DATA;

/**
 * The reads a source is made with (`fullSource`): the kinds it has, and at least one of them. The kinds left out
 * become `cannotRead`. A source with no read at all cannot be written this way: that is `NO_FULL_DATA`, by name.
 */
export type GivenReads = Partial<FullSourceReads> & (Pick<FullSourceReads, 'line'> | Pick<FullSourceReads, 'cells'> | Pick<FullSourceReads, 'level'> | Pick<FullSourceReads, 'event'>);

/** Where a source's full data is: 'inline' the webview holds it, 'fetched' the backend does, 'none' there is none. */
type Held = 'inline' | 'fetched' | 'none';

/**
 * A full-data source. Only this module makes one (`fullSource`, `NO_FULL_DATA`): the class is not exported and
 * `made` is protected, so an object literal, or a spread of another source (`{ ...source, line }`), is not a source
 * to the compiler. That is what keeps "a source that reads nothing" to the named values (NO_FULL_DATA, and
 * pendingSource for a stand-in's wait on its request).
 */
class Source<H extends Held> implements FullSourceReads {
    protected readonly made = true;
    readonly line: FullSourceReads['line'];
    readonly cells: FullSourceReads['cells'];
    readonly level: FullSourceReads['level'];
    readonly event: FullSourceReads['event'];
    constructor(readonly held: H, reads: Partial<FullSourceReads>) {
        this.line = reads.line ?? cannotRead;
        this.cells = reads.cells ?? cannotRead;
        this.level = reads.level ?? cannotRead;
        this.event = reads.event ?? noEvent;
        Object.freeze(this);
    }
}

/**
 * Full data the webview holds every value of (localLine, localCells): it answers at once, never pending.
 * Bars, a pair spectrum's every bin, a histogram's bins and a band table are read through one of these, built from
 * their every value, never from what a plot draws.
 */
export type InlineFullSource = Source<'inline'>;
/** Full data the backend holds (fetchedSource): asked for around the pointer, pending until it is in. */
export type FetchedFullSource = Source<'fetched'>;
/** No full data: the type of `NO_FULL_DATA` alone. */
export type NoFullSource = Source<'none'>;

export type FullSource = InlineFullSource | FetchedFullSource | NoFullSource;

/** What every layer declares (StageLayer.full, required): the source of its full data, held or fetched, or `NO_FULL_DATA`. */
export type FullRead = FullSource;

/**
 * "No full data", by name: the source of a layer whose caller has none to give. Every read is unavailable, so the
 * layer reads no number (R7), and the plot marks it (`data-plot-full="missing: …"`), which every ui-smoke test
 * fails (canvasAudit.ts). It is the only source with no full data: `fullSource` refuses to make another, and a read
 * that can only fail (answer null) fails provenanceBoundary.test.ts (empty-read).
 */
export const NO_FULL_DATA: NoFullSource = new Source('none', {});

/**
 * "Its full data is on its way": the source of a stand-in drawn while the real picture is asked for (the cursor
 * spectrum's spectrogram column before its slice is in), tied to the request it waits on (answerStore.ts
 * PendingRequest). Every read stays pending (the cursor's marks, no number, R7) and its level is judged once the real
 * picture is in (R6). Its readers are told when the request is answered, so a still pointer reads the real picture
 * drawn then, which brings its own source; when the request is superseded (the cursor moved on) they are let go
 * untold, as the stand-in is drawn again for the newer one. With no request (none was asked: it is not shown for
 * reading), nobody is told. It reads nothing, as NO_FULL_DATA does, but says so as "not yet" where the plot shows a
 * wait; a read that can only wait is made here alone (provenanceBoundary.test.ts, empty-read).
 */
export function pendingSource(request: PendingRequest | undefined): FetchedFullSource {
    const wait = (ready: () => void): undefined => { if (request?.waiting) request.whenAnswered(ready); return undefined; };
    return new Source('fetched', { line: (_query, ready) => wait(ready), level: (_query, ready) => wait(ready) });
}

/** Whether a source has any read: false of `NO_FULL_DATA` only. */
export const readsFullData = (source: FullSource): source is InlineFullSource | FetchedFullSource => source.held !== 'none';

/**
 * A full-data source of the reads it has: `fullSource('inline', { cells(query) { … } })`. Give at least one read
 * (the type requires it); the kinds left out cannot be read. To say "this layer has no full data", pass
 * `NO_FULL_DATA` instead of making a source.
 */
export function fullSource(held: 'inline', reads: GivenReads): InlineFullSource;
export function fullSource(held: 'fetched', reads: GivenReads): FetchedFullSource;
export function fullSource(held: 'inline' | 'fetched', reads: GivenReads): InlineFullSource | FetchedFullSource {
    return reading(new Source(held, reads));
}

/** `source`, checked to have a read: the type asks for one, but a read passed on from another source can itself be `cannotRead`. */
function reading<S extends FullSource>(source: S): S {
    if (source.line === cannotRead && source.cells === cannotRead && source.level === cannotRead && source.event === noEvent) {
        throw new Error('fullRead: every read given is `cannotRead`, so this source would read nothing. Pass NO_FULL_DATA (fullRead.ts) where a layer has no full data, so the plot marks it.');
    }
    return source;
}

/**
 * `source` with some of its reads replaced or added (a trigger's `event` lines, a read gated in a test): the same
 * kind of source, its other reads kept. A spread (`{ ...source, event }`) does not compile, by design (see Source).
 */
export function sourceWith<S extends InlineFullSource | FetchedFullSource>(source: S, reads: GivenReads): S {
    return reading(new Source(source.held, { line: source.line, cells: source.cells, level: source.level, event: source.event, ...reads }) as S);
}

/** How many points past the one read an arrow key's read asks for, so the next steps need no request. */
export const STEP_AHEAD = 256;

/** The first index of ascending `xs` at or past `x` (`after`: strictly past it). */
function firstFrom(xs: ArrayLike<number>, x: number, after = false): number {
    let low = 0, high = xs.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (after ? xs[middle] <= x : xs[middle] < x) low = middle + 1; else high = middle;
    }
    return low;
}

/**
 * For the points [first, after) of ascending `xs`: each one's distance to its nearer neighbour among ALL of `xs`
 * (null for a point with none), as full_read.source_steps gives it. A readout's digits come of this (FullPoints.steps).
 */
export function sourceSteps(xs: readonly number[], first: number, after: number): Array<number | null> {
    const steps: Array<number | null> = [];
    for (let index = first; index < after; index++) {
        const gaps = [xs[index] - xs[index - 1], xs[index + 1] - xs[index]].filter(gap => Number.isFinite(gap) && gap > 0);
        steps.push(gaps.length ? Math.min(...gaps) : null);
    }
    return steps;
}

/** A seek (LineQuery.seek) in a line held whole: as full_read._seek_line answers it. */
function seekIn(xs: readonly Whole[], values: readonly (Whole | null)[], n: number, x: number, direction: -1 | 1, beyond: number, plain = false, from?: number): FullPoints {
    let found = -1;
    // From a known place, the very next point in the data's order, one at the same x too (LineQuery.from); else the
    // first strictly past x.
    const placed = from !== undefined && from >= 0 && from < n && xs[from] === x;
    if (direction > 0) { for (let index = placed ? from + 1 : firstFrom(xs, x, true); index < n && found < 0; index++) if (readableValue(values[index], plain)) found = index; }
    else for (let index = placed ? from - 1 : firstFrom(xs, x) - 1; index >= 0 && found < 0; index--) if (readableValue(values[index], plain)) found = index;
    if (found < 0) return { xs: [], values: [], start: null, end: null, complete: true };
    const first = Math.max(0, found - (direction > 0 ? 1 : beyond)), after = Math.min(n, found + (direction > 0 ? beyond : 1) + 1);
    return { xs: xs.slice(first, after), values: values.slice(first, after), start: first > 0 ? xs[first] : null, end: after < n ? xs[after - 1] : null, complete: true, offset: first, steps: sourceSteps(xs, first, after) };
}

/**
 * A number the webview computed of full data (a Δ of two bins, a mean over channels), as full data itself, typed
 * `Derived`. `from` is what it is computed of: at least one whole value (an empty list, a gap, a thinned point
 * (`Drawn`) or a plain number does not compile), and `compute` is handed those values and answers the number: the
 * number is made only of what the call names (display rules R7, "a whole collection is made only by its
 * producers"). provenanceBoundary.test.ts refuses a `compute` that is not written at the call or leaves one of the
 * values unused (rule `computed-unused`). What is still for the reader of the call is the arithmetic itself.
 * For a whole line computed value by value, use computedLine.
 */
export function computedWhole<const From extends readonly [Whole, ...Whole[]]>(from: From, compute: (...values: From) => number): Derived {
    return mint.derived(compute(...from));
}

/**
 * A line computed value by value of a whole line (a level in degrees, the Δ of two spectra bin by bin, the median
 * of several recordings' bins, the mean over channels): `map(value, index)` is the value at `index`, or null for a
 * gap, given `from`'s value there. The line made has one value for every value of `from` and no other, so it is
 * every value as `from` is; there is no length to give and no array of values to hand in (display rules R7).
 * Other lines it is computed of are read at `index` inside `map`; provenanceBoundary.test.ts refuses a `map` that is
 * not written at the call or leaves `from`'s value unused (rule `computed-unused`). As computedWhole, the
 * arithmetic is for the reader of the call.
 */
export function computedLine(from: WholeLine<Whole>, map: (value: Whole, index: number) => number): WholeLine<Whole>;
export function computedLine(from: WholeLine, map: (value: Whole | null, index: number) => number | null): WholeLine;
export function computedLine(from: WholeLine, map: LineMap): WholeLine {
    // A line of Whole is handed to its own overload's map only: each value it gives is one of `from`'s.
    const each = map as (value: Whole | null, index: number) => number | null;
    return mint.line(from.map((value, index) => each(value, index)));
}

/**
 * Cells computed cell by cell of whole cells (a Δ of two images, cell by cell): `map(value, row, column)` is the
 * cell at `row`, `column`, or null for a gap, given `from`'s cell there. Every row and every column of `from` is
 * kept and no other is made, so the cells are every row as `from`'s are (WholeCells). The same check as
 * computedLine holds of `map`.
 */
export function computedCells(from: WholeCells<Whole>, map: (value: Whole, row: number, column: number) => number): WholeCells<Whole>;
export function computedCells(from: WholeCells, map: (value: Whole | null, row: number, column: number) => number | null): WholeCells;
export function computedCells(from: WholeCells, map: CellMap): WholeCells {
    const each = map as (value: Whole | null, row: number, column: number) => number | null;
    return mint.cells(from.map((line, row) => line.map((value, column) => each(value, row, column))));
}

/** What computedLine's and computedCells' overloads take as `map`. */
type LineMap = ((value: Whole, index: number) => number) | ((value: Whole | null, index: number) => number | null);
type CellMap = ((value: Whole, row: number, column: number) => number) | ((value: Whole | null, row: number, column: number) => number | null);

/** The full data of a line that has no point at all (an axis drawn alone, a slice with no bins): read, it answers nothing. */
export const NO_POINTS: InlineFullSource = localLine([], mint.line([]));

/** A line of `length` gaps and no value: what stands where there is no data (no scan, nothing to compare). */
export function gapsLine(length = 0): WholeLine {
    return mint.line(new Array<null>(length).fill(null));
}

/**
 * A line of numbers the webview made to lay a figure out, which are not measurements: a histogram's counts, the
 * height a dot is stacked at, the top of a marker. Nothing of it is thinned, and it has no backend array behind it,
 * so it cannot come in as `Whole`; its layer writes its own readout text (`StageLayer.readout`). Only the modules
 * listed in provenanceBoundary.test.ts (LAYOUT_MODULES) may call this: a measured value never goes through here.
 */
export function layoutLine(xs: readonly number[], ys: readonly (number | null)[]): InlineFullSource {
    return localLine(xs, mint.line(ys));
}

/**
 * A line the webview holds every point of (ascending `xs`): its full data, read as the backend reads one.
 *
 * `values` is a `WholeLine`: every value of the line, which only its producers make (provenance.ts). A picture's
 * points, plain numbers, and a filtered or sliced array of whole values do not compile. A line shorter on screen
 * than its values (bands up to Nyquist) is given the whole line and the shorter `xs`: only the values that have a
 * place are read. `held` are the places the values sit at, which the caller lays out (bin × spacing, band centres).
 */
export function localLine(held: readonly number[], values: WholeLine): InlineFullSource {
    const xs = mint.values(held);
    return fullSource('inline', {
        line(query) {
            const n = Math.min(xs.length, values.length);
            if (query.seek) return seekIn(xs, values, n, query.x0, query.seek, query.beyond, !!query.plain, query.from);
            const low = firstFrom(xs, Math.min(query.x0, query.x1)), high = firstFrom(xs, Math.max(query.x0, query.x1), true);
            const first = Math.max(0, low - query.beyond), after = Math.min(n, Math.max(low, high) + query.beyond);
            return { xs: xs.slice(first, after), values: values.slice(first, after), start: first > 0 ? xs[first] : null, end: after < n ? xs[after - 1] : null, complete: true, offset: first, steps: sourceSteps(xs, first, after) };
        },
        level: query => levelOfValues(xs, values, query),
    });
}

/**
 * An image the webview holds every cell of: `matrix` rows over ascending `ys`, columns over ascending `xs`.
 * `matrix` is `WholeCells`: every row, each every value, which only its producers make (provenance.ts). Rows that
 * are each whole but filtered or sliced (`matrix.filter(…)`), a picture's cells and plain numbers do not compile.
 * `heldXs` and `heldYs` are the places the cells sit at, which the caller lays out, as localLine's.
 */
export function localCells(heldXs: readonly number[], heldYs: readonly number[], matrix: WholeCells, rowNames?: readonly string[]): InlineFullSource {
    const xs = mint.values(heldXs), ys = mint.values(heldYs);
    const nearest = (axis: readonly number[], value: number): number => {
        const at = Math.max(1, Math.min(axis.length - 1, firstFrom(axis, value)));
        return axis.length < 2 ? 0 : Math.abs(axis[at - 1] - value) <= Math.abs(axis[at] - value) ? at - 1 : at;
    };
    return fullSource('inline', {
        cells(query) {
            if (!xs.length || !ys.length) return { xs: [], ys: [], matrix: [], start: null, end: null, complete: true };
            const column = nearest(xs, query.x), row = nearest(ys, query.y);
            const c0 = Math.max(0, column - query.beyond), c1 = Math.min(xs.length, column + query.beyond + 1);
            const r0 = Math.max(0, row - 2), r1 = Math.min(ys.length, row + 3);
            return {
                xs: xs.slice(c0, c1), ys: ys.slice(r0, r1), matrix: matrix.slice(r0, r1).map(line => line.slice(c0, c1)),
                start: c0 > 0 ? xs[c0] : null, end: c1 < xs.length ? xs[c1 - 1] : null, complete: true,
                ...(rowNames ? { rowNames: rowNames.slice(r0, r1) } : {}),
            };
        },
    });
}

/** Whether a complete answer holds every point of [x0, x1] and `beyond` past each end it asked for (one is enough). */
function covers(points: FullPoints, x0: number, x1: number, beyond: number): boolean {
    // An answer with no points (a seek past the last value: nothing there to read) says nothing of any other window;
    // taken as covering every one (both ends null), it would keep the line from being read anywhere again (A41, R7).
    if (!points.complete || !points.xs.length) return false;
    const left = points.start === null || (beyond > 0 ? points.start < x0 : points.start <= x0);
    const right = points.end === null || (beyond > 0 ? points.end > x1 : points.end >= x1);
    return left && right;
}

/** How much wider than the pointer needs a line's window is asked for, each side, in widths of it. */
const PAD = 1.5;

/** How much of what was fetched a source keeps. */
const KEPT = 24;

/** How many columns either side, and rows above and below, an image's hover asks the backend for, so a pointer moving over it reads what came. */
const HOVER_CELLS = { beyond: 32, rows: 16 };

/** Whether `read` is a dense line window that holds [x0, x1] at least as finely as `columns` across it asks (R7). */
function holdsDense(read: StageRead, x0: number, x1: number, columns: number, log: boolean): boolean {
    if (!read.columns || read.x.length !== 2 || !!read.log !== log) return false;
    const [low, high] = read.x;
    if (x0 < low || x1 > high) return false;
    const measure = (at: number): number => (log ? Math.log(at) : at);
    const kept = (measure(high) - measure(low)) / read.columns;
    const asked = (measure(x1) - measure(x0)) / Math.max(1, columns);
    return kept <= asked * 1.01;
}

/** Whether a kept window answers a seek from `x` toward `direction` (LineQuery.seek): see fetchedSource. */
function seeks(points: FullPoints, x: number, direction: -1 | 1, plain: boolean): boolean {
    if (!points.complete || !points.values || !points.xs.length) return false;
    const xs = points.xs, values = points.values;
    if (direction > 0) {
        if (points.start !== null && points.start > x) return false;
        for (let index = 0; index < xs.length; index++) if (xs[index] > x && readableValue(values[index], plain)) return true;
        return points.end === null && xs[xs.length - 1] >= x;
    }
    if (points.end !== null && points.end < x) return false;
    for (let index = xs.length - 1; index >= 0; index--) if (xs[index] < x && readableValue(values[index], plain)) return true;
    return points.start === null && xs[0] <= x;
}

/**
 * A layer's full data held by the backend: `fetch` asks it for `read` (full_read.py) and answers with its points
 * (null: none). Each window is asked for once and kept; one request is on its way at a time, and the latest read
 * asked for meanwhile goes next, so a moving pointer never queues a request per pixel; the latest level asked for
 * meanwhile keeps a place of its own after it, so a moving pointer never starves the line's order (R6).
 */
export function fetchedSource(fetch: (read: StageRead, done: (points: StagePoints | null | undefined) => void) => void, extra: Omit<StageRead, 'x' | 'y' | 'beyond' | 'near' | 'columns' | 'log' | 'level'> = {}, now: () => number = () => Date.now()): FetchedFullSource {
    // The windows read, the latest KEPT: each one's points (ready) or its failure (asked again after the store's pause).
    const kept = createAnswerStore<{ read: StageRead; points: FullPoints }>({ capacity: KEPT, now });
    const keyOf = (key: string): AnswerKey => answerKey({ ask: key, version: { by: 'source' } });
    let busy: string | null = null;
    // Asked for while one is on its way: the pointer's latest read, and the latest level (of the window on screen
    // now). Each keeps its own place, so the line's order is never dropped for a newer read, nor a read for a level;
    // an older one of either kind is no longer wanted.
    let next: { key: string; read: StageRead } | null = null;
    let nextLevel: { key: string; read: StageRead } | null = null;
    const keep = (key: string, read: StageRead, points: FullPoints | null): void => {
        if (points) kept.ready(keyOf(key), { read, points });
        else kept.fail(keyOf(key));
    };
    /** A read waiting in line is no longer wanted (a newer one of its kind took its place): its readers wait on that one. */
    const supersede = (item: { key: string } | null, by: string): void => {
        if (item && item.key !== busy) kept.supersede(keyOf(item.key), keyOf(by));
    };
    const ask = (key: string, read: StageRead): void => {
        busy = key;
        fetch(read, points => {
            busy = null;
            // undefined: no answer (the backend let the data go and the picture is scanned again): nothing is kept and
            // nothing is asked again until the plot reads anew, once its picture is back.
            if (points === undefined) {
                for (const item of [{ key }, next, nextLevel]) if (item) kept.forget(keyOf(item.key));
                next = null; nextLevel = null;
                return;
            }
            // The pointer's read first, then the level: the first not answered meanwhile goes next. It takes the one
            // place on the way BEFORE the readers of this answer are told: a reader told below may read again at once
            // (an arrow key's next step), and that read must queue behind it, never be sent beside it.
            const unanswered = (item: { key: string } | null): boolean => !!item && kept.state(keyOf(item.key)) === 'pending';
            const queued = unanswered(next) ? next : unanswered(nextLevel) ? nextLevel : null;
            if (queued === next || !unanswered(next)) next = null;
            if (queued === nextLevel || !unanswered(nextLevel)) nextLevel = null;
            if (queued) busy = queued.key;
            // Kept, and every reader waiting on it is told by the store (whenSettled).
            keep(key, read, points ? fullPointsOf(points) : null);
            if (queued) ask(queued.key, queued.read);
        });
    };
    /**
     * `found`: whether kept points answer the read exactly. Nothing else is shown in its place: until its own points
     * come the read is undefined (pending), and the plot shows its marks and no number (R7).
     */
    const answer = (key: string, read: StageRead, ready: () => void, found: (points: FullPoints, asked: StageRead) => boolean): FullAnswer => {
        // A failed answer (null) holds for the store's pause, then is asked again: a passing failure does not stay (C2),
        // as the cursor spectrum's slice and the combined pictures do.
        const own = keyOf(key);
        for (const [held, item] of kept.newestFirst()) {
            if (held.id === own.id) {
                if (item.state === 'ready') return item.value.points;
                // The store's own pause (FAILED_RETRY_MS): the store tells the reader when it is over, and the read
                // made then asks again. No timer here: the store keeps the time.
                if (item.state === 'failed') { kept.whenFailureEnds(own, ready); return null; }
                // On its way, or waiting in line: told when it is in.
                if (item.state === 'pending') { kept.whenSettled(own, ready); return undefined; }
                continue;
            }
            if (item.state === 'ready' && found(item.value.points, item.value.read)) return item.value.points;
        }
        // Pending in the store from now (never evicted while it is), until its answer comes or a newer read takes its place.
        kept.ask(own);
        kept.whenSettled(own, ready);
        if (busy === null) ask(key, read);
        else if (read.level) { supersede(nextLevel, key); nextLevel = { key, read }; }
        else { supersede(next, key); next = { key, read }; }
        return undefined;
    };
    const source: FetchedFullSource = fullSource('fetched', {
        line(query, ready) {
            const x0 = Math.min(query.x0, query.x1), x1 = Math.max(query.x0, query.x1);
            // A window is asked for wider than the pointer needs (PAD times its width each side), so a pointer moving
            // within it, or an arrow key's step and the hover that follows it, read what came without asking again.
            const log = !!query.log && x0 > 0;
            const [low, high] = x0 === x1 ? [x0, x1] : log ? [x0 * (x0 / x1) ** PAD, x1 * (x1 / x0) ** PAD] : [x0 - (x1 - x0) * PAD, x1 + (x1 - x0) * PAD];
            const columns = query.columns ? Math.max(1, Math.min(512, Math.round(query.columns * (1 + 2 * PAD)))) : 0;
            const pointer = query.at !== undefined && query.pixels && [query.at, ...query.pixels].every(Number.isFinite);
            const read: StageRead = { ...extra, x: x0 === x1 ? [x0] : [low, high], beyond: query.beyond,
                ...(query.near !== undefined && Number.isFinite(query.near) ? { near: query.near } : {}),
                ...(columns ? { columns } : {}), ...(query.log ? { log: true } : {}),
                ...(pointer && query.pixels ? { at: query.at, pixels: [...query.pixels] } : {}),
                ...(query.shown && query.shown.every(Number.isFinite) ? { shown: [Math.min(...query.shown), Math.max(...query.shown)] } : {}),
                ...(query.seek ? { seek: query.seek } : {}), ...(query.plain ? { plain: true } : {}) };
            // An arrow key's seek is answered by a kept window that runs on, every point, from x to a point to read
            // past it (or to the data's end): the next keys after one seek need no request.
            if (query.seek) return answer(JSON.stringify(read), read, ready, points => seeks(points, x0, query.seek ?? 1, !!query.plain));
            // A window too dense to send whole comes as each pixel column's lowest, highest and the point nearest the
            // level under the pointer, with the one point nearest the pointer on screen: it answers only a read at
            // that place, level and scale. Elsewhere its nearest point is another's: the read waits for its own.
            const same = (asked: StageRead): boolean => asked.near === read.near && asked.at === read.at && asked.pixels?.[0] === read.pixels?.[0] && asked.pixels?.[1] === read.pixels?.[1]
                && asked.shown?.[0] === read.shown?.[0] && asked.shown?.[1] === read.shown?.[1];
            return answer(JSON.stringify(read), read, ready, (points, asked) => covers(points, x0, x1, query.beyond)
                || (!points.complete && query.columns !== undefined && holdsDense(asked, x0, x1, query.columns, log) && same(asked)));
        },
        level(query, ready) {
            // Every value of the window, measured where the data is (full_read.read_level): never the drawn points.
            const read: StageRead = { ...extra, x: [Math.min(query.x0, query.x1), Math.max(query.x0, query.x1)], level: query.square ? 'square' : 'db' };
            const got = answer(JSON.stringify(read), read, ready, () => false);
            return got === undefined ? undefined : got?.level ?? null;
        },
        cells(query, ready) {
            // A hover asks for a block of cells around the pointer (HOVER_CELLS), so moving to the next frame or bin
            // reads what came; a step asks for its own columns ahead, with the rows either side of the one read.
            const hover = query.beyond < HOVER_CELLS.beyond;
            const read: StageRead = { ...extra, x: [query.x], y: [query.y], beyond: hover ? HOVER_CELLS.beyond : query.beyond, ...(hover ? { rows: HOVER_CELLS.rows } : {}) };
            return answer(JSON.stringify(read), read, ready, points => {
                const xs = points.xs, ys = points.ys ?? [];
                // Kept rows answer a place whose cell (by the one cell rule, cellIndex, as the plot reads it) is a kept
                // row with a kept row either side, for its edges. By the cell, not by the rows' centres: a place in the
                // outer half of the next-to-last kept row is that row's, and a hair off a row's centre (a zoomed band's
                // ends at the field's numbers, R9) is no reason to ask again (R7).
                const row = ys.length >= 3 ? cellIndex(ys, query.y, !!query.rowLog, { low: true, high: true }) : -1;
                if (!points.complete || xs.length < 1 || row < 1 || row > ys.length - 2) return false;
                // The column nearest the pointer, with `beyond` (at least one, for the cell's edges) past it each side;
                // a data end counts as reached.
                let column = 0;
                for (let index = 1; index < xs.length; index++) if (Math.abs(xs[index] - query.x) < Math.abs(xs[column] - query.x)) column = index;
                const need = Math.max(1, query.beyond);
                return (points.start === null || column >= need) && (points.end === null || column + need <= xs.length - 1);
            });
        },
    });
    return source;
}

/**
 * The cell of `axis` (ascending) whose edges (halfway to its neighbours, in the axis's own measure) hold `value`;
 * -1 past the first or last cell's outer half when the axis ends there (`open`), else the nearest end cell.
 */
export function cellIndex(axis: readonly number[], value: number, log: boolean, open: { low: boolean; high: boolean }): number {
    const edges = cellEdges(axis, log);
    const n = axis.length;
    if (!n) return -1;
    const v = axisMeasure(value, log);
    if (v < edges[0]) return open.low ? -1 : 0;
    if (v > edges[n]) return open.high ? -1 : n - 1;
    // The first cell whose upper edge is at or past the value: a value on an edge is the lower cell's.
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (edges[mid + 1] < v) lo = mid + 1; else hi = mid; }
    return lo;
}

/** A value of an axis in the axis's own measure: its log on a log axis, so a cell's edges are where the screen halves it. */
export const axisMeasure = (value: number, log: boolean): number => (log ? Math.log(Math.max(value, 1e-12)) : value);

/**
 * The edges of each cell along an axis, in its own measure (axisMeasure): halfway between neighbouring points, and half
 * the end step past each end, so a cell holds the values nearest its point on screen. On a log axis that is the
 * geometric mean of two points (√(f1·f2): 100 and 125 Hz meet at 111.8 Hz, not 112.5). The one rule every chart
 * draws, hovers and steps a cell or a bar by (a heatmap's columns and rows, a band's bar, cellIndex).
 */
export function cellEdges(axis: readonly number[], log: boolean): number[] {
    const n = axis.length;
    if (!n) return [];
    const at = (index: number): number => axisMeasure(axis[index], log);
    const firstStep = n > 1 ? at(1) - at(0) : 1, lastStep = n > 1 ? at(n - 1) - at(n - 2) : 1;
    const edges = [at(0) - firstStep / 2];
    for (let index = 1; index < n; index++) edges.push((at(index - 1) + at(index)) / 2);
    edges.push(at(n - 1) + lastStep / 2);
    return edges;
}

/** cellEdges back in the axis's values (a log axis's edges exponentiated). */
export function cellEdgeValues(axis: readonly number[], log: boolean): number[] {
    return cellEdges(axis, log).map(edge => (log ? Math.exp(edge) : edge));
}

/**
 * A line query on another axis: its window and the pointer's place (`at`) mapped, and the screen's scale along x
 * (`pixels[0]`, pixels per unit) per unit of the new axis, so a dense window read through the map still holds the
 * point nearest the pointer on screen (R7).
 */
function mappedLine(query: LineQuery, to: (x: number) => number): LineQuery {
    const mapped: LineQuery = { ...query, x0: to(query.x0), x1: to(query.x1) };
    if (query.at !== undefined) mapped.at = to(query.at);
    if (query.pixels) {
        const at = query.at ?? query.x0, step = Math.abs(query.x1 - query.x0) || 1;
        const units = Math.abs(to(at + step) - to(at)) / step;
        mapped.pixels = [units > 0 ? query.pixels[0] / units : query.pixels[0], query.pixels[1]];
    }
    return mapped;
}

/**
 * `source` read on another axis: `to` takes this axis's values to the source's, `from` back (both increasing), so a
 * lane on the lanes' time axis reads a source over its file's 0..1.
 */
export function mappedSource(source: FullSource, to: (x: number) => number, from: (x: number) => number): FullSource {
    // Each point's step in the source data (FullPoints.steps) is carried to this axis as its place is: the same gap, mapped.
    const stepBack = (x: number, step: number | null): number | null => (step === null ? null : Math.abs(from(x + step) - from(x)));
    const back = (points: FullAnswer): FullAnswer => (points ? {
        ...points, xs: points.xs.map(x => mint.value(from(x))), start: points.start === null ? null : from(points.start), end: points.end === null ? null : from(points.end),
        ...(points.steps ? { steps: points.steps.map((step, index) => stepBack(points.xs[index], step)) } : {}),
    } : points);
    // No full data on one axis is no full data on another.
    if (!readsFullData(source)) return source;
    return new Source(source.held, {
        // A read the source cannot give stays one it cannot give.
        ...(source.line !== cannotRead ? { line: (query: LineQuery, ready: () => void) => back(source.line(mappedLine(query, to), ready)) } : {}),
        ...(source.cells !== cannotRead ? { cells: (query: CellQuery, ready: () => void) => back(source.cells({ ...query, x: to(query.x) }, ready)) } : {}),
        ...(source.level !== cannotRead ? { level: (query: LevelQuery, ready: () => void) => source.level({ ...query, x0: to(query.x0), x1: to(query.x1) }, ready) } : {}),
    });
}
