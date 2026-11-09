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
import type { StagePoints, StageRead, StageView } from '../../shared/protocol/backendProtocol';

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
     * An arrow key's read (x0 = x1): the first point with a value to read strictly past x toward larger (1) or smaller
     * (-1) x, however far, with `beyond` past it (and the point before it), as one complete window.
     */
    seek?: -1 | 1;
}

/** Whether a line's value is one a plot reads (not a gap, nor the silent floor drawn as one). */
export function readableValue(value: number | null | undefined): value is number {
    return value !== null && value !== undefined && Number.isFinite(value) && value > -250;
}

/** An image's cells around a place: its columns `beyond` either side of the one at `x`, its rows around `y`. */
export interface CellQuery {
    x: number;
    y: number;
    beyond: number;
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

/** The mean power of the `count` finite values a LevelQuery takes (full_read.read_level). */
export interface LevelSum {
    power: number;
    count: number;
}

/** undefined: being fetched (`ready` is called once it is in); null: there is no full data to measure. */
export type LevelAnswer = LevelSum | null | undefined;

/** A value's power as the overlay orders lines by (full_read.read_level). */
export function valuePower(value: number, square: boolean): number {
    return square ? value * value : value <= -250 ? 0 : 10 ** (value / 10);
}

/** The mean power of `values` (over ascending `xs`) between x0 and x1, every finite value taken (LevelQuery). */
export function levelOfValues(xs: ArrayLike<number>, values: ArrayLike<number | null>, query: LevelQuery): LevelSum {
    const low = Math.min(query.x0, query.x1), high = Math.max(query.x0, query.x1);
    let power = 0, count = 0;
    for (let index = firstFrom(xs, low), n = Math.min(xs.length, values.length); index < n && xs[index] <= high; index++) {
        const value = values[index];
        if (value === null || value === undefined || !Number.isFinite(value)) continue;
        power += valuePower(value, query.square);
        count += 1;
    }
    return { power: count ? power / count : 0, count };
}

/** Points as full_read.py gives them; an image's cells may name their rows (the entry overview's recordings). */
export type FullPoints = StagePoints & { rowNames?: readonly string[]; offset?: number };

/** undefined: being fetched (`ready` is called once it is in); null: there is no full data to read. */
export type FullAnswer = FullPoints | null | undefined;

interface FullSourceReads {
    line?(query: LineQuery, ready: () => void): FullAnswer;
    cells?(query: CellQuery, ready: () => void): FullAnswer;
    /** The power of every value of the line in a window (R6), from its full data. */
    level?(query: LevelQuery, ready: () => void): LevelAnswer;
    /** A trigger's event drawn as a line of its own (eventLayers): its own points. */
    event?(id: number): FullSource;
}

/**
 * Full data the webview holds every value of (localLine, localCells, wholeOf): it answers at once, never pending.
 * Bars, a pair spectrum's every bin, a histogram's bins and a band table are read through one of these, built from
 * their every value, never from what a plot draws.
 */
export interface InlineFullSource extends FullSourceReads {
    readonly held: 'inline';
}

/** Full data the backend holds (fetchedSource): asked for around the pointer, pending until it is in. */
export interface FetchedFullSource extends FullSourceReads {
    readonly held: 'fetched';
}

export type FullSource = InlineFullSource | FetchedFullSource;

/** What every layer declares (StageLayer.full, required): the source of its full data, held or fetched. */
export type FullRead = FullSource;

/**
 * The full data of a layer whose caller has none to give: every read is unavailable (no number, R7), and the plot
 * marks the layer (`data-plot-full`), which every ui-smoke test fails (canvasAudit.ts).
 */
export const NO_FULL_DATA: FetchedFullSource = Object.freeze({ held: 'fetched' as const });

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

/** A seek (LineQuery.seek) in a line held whole: as full_read._seek_line answers it. */
function seekIn(xs: readonly number[], values: readonly (number | null)[], n: number, x: number, direction: -1 | 1, beyond: number): FullPoints {
    let found = -1;
    if (direction > 0) { for (let index = firstFrom(xs, x, true); index < n && found < 0; index++) if (readableValue(values[index])) found = index; }
    else for (let index = firstFrom(xs, x) - 1; index >= 0 && found < 0; index--) if (readableValue(values[index])) found = index;
    if (found < 0) return { xs: [], values: [], start: null, end: null, complete: true };
    const first = Math.max(0, found - (direction > 0 ? 1 : beyond)), after = Math.min(n, found + (direction > 0 ? beyond : 1) + 1);
    return { xs: xs.slice(first, after), values: values.slice(first, after), start: first > 0 ? xs[first] : null, end: after < n ? xs[after - 1] : null, complete: true, offset: first };
}

/** A line the webview holds every point of (ascending `xs`): its full data, read as the backend reads one. */
export function localLine(xs: readonly number[], values: readonly (number | null)[]): InlineFullSource {
    return {
        held: 'inline',
        line(query) {
            const n = Math.min(xs.length, values.length);
            if (query.seek) return seekIn(xs, values, n, query.x0, query.seek, query.beyond);
            const low = firstFrom(xs, Math.min(query.x0, query.x1)), high = firstFrom(xs, Math.max(query.x0, query.x1), true);
            const first = Math.max(0, low - query.beyond), after = Math.min(n, Math.max(low, high) + query.beyond);
            return { xs: xs.slice(first, after), values: values.slice(first, after), start: first > 0 ? xs[first] : null, end: after < n ? xs[after - 1] : null, complete: true, offset: first };
        },
        level: query => levelOfValues(xs, values, query),
    };
}

/** A band table's bars, which the backend sends whole (every band, none thinned): read from their every value. */
export function wholeBars(view: StageView | null | undefined): InlineFullSource | undefined {
    return view?.kind === 'bar' ? localLine(view.xs ?? [], view.values ?? []) : undefined;
}

/** An image the webview holds every cell of: `matrix` rows over ascending `ys`, columns over ascending `xs`. */
export function localCells(xs: readonly number[], ys: readonly number[], matrix: ReadonlyArray<ReadonlyArray<number | null>>, rowNames?: readonly string[]): InlineFullSource {
    const nearest = (axis: readonly number[], value: number): number => {
        const at = Math.max(1, Math.min(axis.length - 1, firstFrom(axis, value)));
        return axis.length < 2 ? 0 : Math.abs(axis[at - 1] - value) <= Math.abs(axis[at] - value) ? at - 1 : at;
    };
    return {
        held: 'inline',
        cells(query) {
            if (!xs.length || !ys.length) return null;
            const column = nearest(xs, query.x), row = nearest(ys, query.y);
            const c0 = Math.max(0, column - query.beyond), c1 = Math.min(xs.length, column + query.beyond + 1);
            const r0 = Math.max(0, row - 2), r1 = Math.min(ys.length, row + 3);
            return {
                xs: xs.slice(c0, c1), ys: ys.slice(r0, r1), matrix: matrix.slice(r0, r1).map(line => line.slice(c0, c1)),
                start: c0 > 0 ? xs[c0] : null, end: c1 < xs.length ? xs[c1 - 1] : null, complete: true,
                ...(rowNames ? { rowNames: rowNames.slice(r0, r1) } : {}),
            };
        },
    };
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
function seeks(points: FullPoints, x: number, direction: -1 | 1): boolean {
    if (!points.complete || !points.values || !points.xs.length) return false;
    const xs = points.xs, values = points.values;
    if (direction > 0) {
        if (points.start !== null && points.start > x) return false;
        for (let index = 0; index < xs.length; index++) if (xs[index] > x && readableValue(values[index])) return true;
        return points.end === null && xs[xs.length - 1] >= x;
    }
    if (points.end !== null && points.end < x) return false;
    for (let index = xs.length - 1; index >= 0; index--) if (xs[index] < x && readableValue(values[index])) return true;
    return points.start === null && xs[0] <= x;
}

/**
 * A layer's full data held by the backend: `fetch` asks it for `read` (full_read.py) and answers with its points
 * (null: none). Each window is asked for once and kept; one request is on its way at a time, and the latest read
 * asked for meanwhile goes next, so a moving pointer never queues a request per pixel; the latest level asked for
 * meanwhile keeps a place of its own after it, so a moving pointer never starves the line's order (R6).
 */
/** How long a failed answer is kept before the read is asked again (laneReads' slice, combineSource). */
export const FAILED_HOLD_MS = 5000;

export function fetchedSource(fetch: (read: StageRead, done: (points: StagePoints | null | undefined) => void) => void, extra: Omit<StageRead, 'x' | 'y' | 'beyond' | 'near' | 'columns' | 'log' | 'level'> = {}, now: () => number = () => Date.now()): FetchedFullSource {
    const kept: Array<{ key: string; read: StageRead; points: FullPoints | null; at: number }> = [];
    let busy: string | null = null;
    // Asked for while one is on its way: the pointer's latest read, and the latest level (of the window on screen
    // now). Each keeps its own place, so the line's order is never dropped for a newer read, nor a read for a level;
    // an older one of either kind is no longer wanted.
    let next: { key: string; read: StageRead } | null = null;
    let nextLevel: { key: string; read: StageRead } | null = null;
    const waiting = new Set<() => void>();
    const keep = (key: string, read: StageRead, points: FullPoints | null): void => {
        kept.push({ key, read, points, at: now() });
        if (kept.length > KEPT) kept.shift();
    };
    const ask = (key: string, read: StageRead): void => {
        busy = key;
        fetch(read, points => {
            busy = null;
            // undefined: no answer (the backend let the data go and the picture is scanned again): nothing is kept and
            // nothing is asked again until the plot reads anew, once its picture is back.
            if (points === undefined) { next = null; nextLevel = null; return; }
            keep(key, read, points);
            // The pointer's read first, then the level: the first not answered meanwhile is asked.
            const unanswered = (item: { key: string } | null): boolean => !!item && !kept.some(done => done.key === item.key);
            const queued = unanswered(next) ? next : unanswered(nextLevel) ? nextLevel : null;
            if (queued === next || !unanswered(next)) next = null;
            if (queued === nextLevel || !unanswered(nextLevel)) nextLevel = null;
            if (queued) ask(queued.key, queued.read);
            const calls = [...waiting];
            waiting.clear();
            for (const call of calls) call();
        });
    };
    /**
     * `found`: whether kept points answer the read exactly. Nothing else is shown in its place: until its own points
     * come the read is undefined (pending), and the plot shows its marks and no number (R7).
     */
    const answer = (key: string, read: StageRead, ready: () => void, found: (points: FullPoints, asked: StageRead) => boolean): FullAnswer => {
        for (let index = kept.length - 1; index >= 0; index--) {
            const item = kept[index];
            // A failed answer (null) holds for FAILED_HOLD_MS, then is asked again: a passing failure does not stay (C2),
            // as the cursor spectrum's slice and the combined pictures do.
            if (item.points === null && now() - item.at >= FAILED_HOLD_MS) { kept.splice(index, 1); continue; }
            if (item.key === key) return item.points;
            if (item.points && found(item.points, item.read)) return item.points;
        }
        waiting.add(ready);
        if (busy !== key) {
            if (busy === null) ask(key, read);
            else if (read.level) nextLevel = { key, read };
            else next = { key, read };
        }
        return undefined;
    };
    const source: FetchedFullSource = {
        held: 'fetched',
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
                ...(query.seek ? { seek: query.seek } : {}) };
            // An arrow key's seek is answered by a kept window that runs on, every point, from x to a point to read
            // past it (or to the data's end): the next keys after one seek need no request.
            if (query.seek) return answer(JSON.stringify(read), read, ready, points => seeks(points, x0, query.seek ?? 1));
            // A window too dense to send whole comes as each pixel column's lowest, highest and the point nearest the
            // level under the pointer, with the one point nearest the pointer on screen: it answers only a read at
            // that place, level and scale. Elsewhere its nearest point is another's: the read waits for its own.
            const same = (asked: StageRead): boolean => asked.near === read.near && asked.at === read.at && asked.pixels?.[0] === read.pixels?.[0] && asked.pixels?.[1] === read.pixels?.[1];
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
                if (!points.complete || xs.length < 1 || ys.length < 3 || query.y < ys[1] || query.y > ys[ys.length - 2]) return false;
                // The column nearest the pointer, with `beyond` (at least one, for the cell's edges) past it each side;
                // a data end counts as reached.
                let column = 0;
                for (let index = 1; index < xs.length; index++) if (Math.abs(xs[index] - query.x) < Math.abs(xs[column] - query.x)) column = index;
                const need = Math.max(1, query.beyond);
                return (points.start === null || column >= need) && (points.end === null || column + need <= xs.length - 1);
            });
        },
    };
    return source;
}

/**
 * The cell of `axis` (ascending) whose edges (halfway to its neighbours, in the axis's own measure) hold `value`;
 * -1 past the first or last cell's outer half when the axis ends there (`open`), else the nearest end cell.
 */
export function cellIndex(axis: readonly number[], value: number, log: boolean, open: { low: boolean; high: boolean }): number {
    const measure = (at: number): number => (log ? Math.log(Math.max(at, 1e-12)) : at);
    const n = axis.length;
    if (!n) return -1;
    const v = measure(value);
    for (let index = 0; index < n; index++) {
        const here = measure(axis[index]);
        const below = index > 0 ? (measure(axis[index - 1]) + here) / 2 : n > 1 ? here - (measure(axis[1]) - here) / 2 : here - 0.5;
        const above = index < n - 1 ? (here + measure(axis[index + 1])) / 2 : n > 1 ? here + (here - measure(axis[n - 2])) / 2 : here + 0.5;
        if (v >= below && v <= above) return index;
        if (index === 0 && v < below) return open.low ? -1 : 0;
    }
    return open.high ? -1 : n - 1;
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
    const back = (points: FullAnswer): FullAnswer => (points ? { ...points, xs: points.xs.map(from), start: points.start === null ? null : from(points.start), end: points.end === null ? null : from(points.end) } : points);
    return {
        held: source.held,
        ...(source.line ? { line: (query: LineQuery, ready: () => void) => back(source.line?.(mappedLine(query, to), ready)) } : {}),
        ...(source.cells ? { cells: (query: CellQuery, ready: () => void) => back(source.cells?.({ ...query, x: to(query.x) }, ready)) } : {}),
        ...(source.level ? { level: (query: LevelQuery, ready: () => void) => source.level?.({ ...query, x0: to(query.x0), x1: to(query.x1) }, ready) } : {}),
    };
}
