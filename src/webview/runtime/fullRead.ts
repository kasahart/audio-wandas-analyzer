/**
 * How a plot reads its numbers (R7): decimated data is only for drawing lines; the readout under the pointer and the
 * point an arrow key steps to come from the data before it was thinned. Every layer a plot draws declares where its
 * full data is read (StageLayer.full): 'drawn' when what it draws is every point (bars, a pair spectrum's every bin, a
 * histogram's bins), or a source that gives the full-resolution points around a place. The plot component
 * (stagePanes.ts) reads only through it, and marks a plot that draws a layer without one (`data-plot-full`), which
 * every ui-smoke test fails (canvasAudit.ts).
 *
 * A source gives what full_read.py gives: the points in a window and some past each end (`complete`: every point
 * between `start` and `end`), or for a window too dense to send whole, per pixel column its lowest, highest and the
 * point nearest the level under the pointer. A source the webview holds the data of answers at once (localLine,
 * localCells); one the backend holds (fetchedSource) asks for the window around the pointer, or the next steps, once,
 * keeps what came, and says when it is in (`ready`): until then the plot shows its marks and no number.
 */
import type { StagePoints, StageRead } from '../../shared/protocol/backendProtocol';

/** A line's points between two places of its horizontal axis (its own units), with `beyond` more past each end. */
export interface LineQuery {
    x0: number;
    x1: number;
    beyond: number;
    /** For a window too dense to send whole: the level under the pointer, the pixel columns across, a log axis. */
    near?: number;
    columns?: number;
    log?: boolean;
}

/** An image's cells around a place: its columns `beyond` either side of the one at `x`, its rows around `y`. */
export interface CellQuery {
    x: number;
    y: number;
    beyond: number;
}

/** Points as full_read.py gives them; an image's cells may name their rows (the entry overview's recordings). */
export type FullPoints = StagePoints & { rowNames?: readonly string[] };

/** undefined: being fetched (`ready` is called once it is in); null: there is no full data to read. */
export type FullAnswer = FullPoints | null | undefined;

export interface FullSource {
    line?(query: LineQuery, ready: () => void): FullAnswer;
    cells?(query: CellQuery, ready: () => void): FullAnswer;
    /** A trigger's event drawn as a line of its own (eventLayers): its own points. */
    event?(id: number): FullSource;
}

/** What a layer declares: its drawn points are all its points, or the source of its full data. */
export type FullRead = 'drawn' | FullSource;

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

/** A line the webview holds every point of (ascending `xs`): its full data, read as the backend reads one. */
export function localLine(xs: readonly number[], values: readonly (number | null)[]): FullSource {
    return {
        line(query) {
            const n = Math.min(xs.length, values.length);
            const low = firstFrom(xs, Math.min(query.x0, query.x1)), high = firstFrom(xs, Math.max(query.x0, query.x1), true);
            const first = Math.max(0, low - query.beyond), after = Math.min(n, Math.max(low, high) + query.beyond);
            return { xs: xs.slice(first, after), values: values.slice(first, after), start: first > 0 ? xs[first] : null, end: after < n ? xs[after - 1] : null, complete: true };
        },
    };
}

/** An image the webview holds every cell of: `matrix` rows over ascending `ys`, columns over ascending `xs`. */
export function localCells(xs: readonly number[], ys: readonly number[], matrix: ReadonlyArray<ReadonlyArray<number | null>>, rowNames?: readonly string[]): FullSource {
    const nearest = (axis: readonly number[], value: number): number => {
        const at = Math.max(1, Math.min(axis.length - 1, firstFrom(axis, value)));
        return axis.length < 2 ? 0 : Math.abs(axis[at - 1] - value) <= Math.abs(axis[at] - value) ? at - 1 : at;
    };
    return {
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
    if (!points.complete) return false;
    const left = points.start === null || (beyond > 0 ? points.start < x0 : points.start <= x0);
    const right = points.end === null || (beyond > 0 ? points.end > x1 : points.end >= x1);
    return left && right;
}

/** How much wider than the pointer needs a line's window is asked for, each side, in widths of it. */
const PAD = 1.5;

/** How much of what was fetched a source keeps. */
const KEPT = 24;

/**
 * A layer's full data held by the backend: `fetch` asks it for `read` (full_read.py) and answers with its points
 * (null: none). Each window is asked for once and kept; one request is on its way at a time, and the latest one
 * asked for meanwhile goes next, so a moving pointer never queues a request per pixel.
 */
export function fetchedSource(fetch: (read: StageRead, done: (points: StagePoints | null) => void) => void, extra: Omit<StageRead, 'x' | 'y' | 'beyond' | 'near' | 'columns' | 'log'> = {}): FullSource {
    const kept: Array<{ key: string; points: FullPoints | null }> = [];
    let busy: string | null = null;
    let next: { key: string; read: StageRead } | null = null;
    const waiting = new Set<() => void>();
    const keep = (key: string, points: FullPoints | null): void => {
        kept.push({ key, points });
        if (kept.length > KEPT) kept.shift();
    };
    const ask = (key: string, read: StageRead): void => {
        busy = key;
        fetch(read, points => {
            keep(key, points);
            busy = null;
            const queued = next;
            next = null;
            if (queued && !kept.some(item => item.key === queued.key)) ask(queued.key, queued.read);
            const calls = [...waiting];
            waiting.clear();
            for (const call of calls) call();
        });
    };
    const answer = (key: string, read: StageRead, ready: () => void, found: (points: FullPoints) => boolean): FullAnswer => {
        for (let index = kept.length - 1; index >= 0; index--) {
            const item = kept[index];
            if (item.key === key) return item.points;
            if (item.points && found(item.points)) return item.points;
        }
        waiting.add(ready);
        if (busy === key) return undefined;
        if (busy !== null) next = { key, read };
        else ask(key, read);
        return undefined;
    };
    const source: FullSource = {
        line(query, ready) {
            const x0 = Math.min(query.x0, query.x1), x1 = Math.max(query.x0, query.x1);
            // A window is asked for wider than the pointer needs (PAD times its width each side), so a pointer moving
            // within it, or an arrow key's step and the hover that follows it, read what came without asking again.
            const log = !!query.log && x0 > 0;
            const [low, high] = x0 === x1 ? [x0, x1] : log ? [x0 * (x0 / x1) ** PAD, x1 * (x1 / x0) ** PAD] : [x0 - (x1 - x0) * PAD, x1 + (x1 - x0) * PAD];
            const columns = query.columns ? Math.max(1, Math.min(512, Math.round(query.columns * (1 + 2 * PAD)))) : 0;
            const read: StageRead = { ...extra, x: x0 === x1 ? [x0] : [low, high], beyond: query.beyond,
                ...(query.near !== undefined && Number.isFinite(query.near) ? { near: query.near } : {}),
                ...(columns ? { columns } : {}), ...(query.log ? { log: true } : {}) };
            return answer(JSON.stringify(read), read, ready, points => covers(points, x0, x1, query.beyond));
        },
        cells(query, ready) {
            const read: StageRead = { ...extra, x: [query.x], y: [query.y], beyond: query.beyond };
            return answer(JSON.stringify(read), read, ready, points => {
                const ys = points.ys ?? [];
                return covers(points, query.x, query.x, query.beyond) && ys.length > 2 && query.y >= ys[1] && query.y <= ys[ys.length - 2];
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
 * `source` read on another axis: `to` takes this axis's values to the source's, `from` back (both increasing), so a
 * lane on the lanes' time axis reads a source over its file's 0..1.
 */
export function mappedSource(source: FullSource, to: (x: number) => number, from: (x: number) => number): FullSource {
    const back = (points: FullAnswer): FullAnswer => (points ? { ...points, xs: points.xs.map(from), start: points.start === null ? null : from(points.start), end: points.end === null ? null : from(points.end) } : points);
    return {
        ...(source.line ? { line: (query: LineQuery, ready: () => void) => back(source.line?.({ ...query, x0: to(query.x0), x1: to(query.x1) }, ready)) } : {}),
        ...(source.cells ? { cells: (query: CellQuery, ready: () => void) => back(source.cells?.({ ...query, x: to(query.x) }, ready)) } : {}),
    };
}
