/**
 * What a ui-smoke test knows of a plot's full data apart from the plot (C6): the raw data the test itself posted or
 * built the page with, which the page's stand-ins answer every read from (fullReadStandIn.ts, buildHtml.ts). The arrow
 * keys' check of every plot (plotContract.spec.ts) takes the point → must read from here, by the pick rule's step
 * (docs/display-rules.md R7, the table python-backend/tests/fixtures/pick_cases.json): from the point read, the next one
 * in the data's order that has a value, one at the same x too. Never from the plot's own full source (`layer.full`):
 * an expectation asked of the implementation agrees with it however wrong it is.
 */
import { uiSmokeEnvelopePoints } from './fullReadStandIn';
import type { PreviewState } from './buildHtml';

/** A point read, as the test tells points apart: its place, an image's row, its index in its source's every point, its identity. */
export type PointAt = { at: number; row: number | null; index: number | null; identity: string | null };

/**
 * The read whose next point is asked: the plot and the line it reads (its name, its Frame kind, its view's x extent),
 * and the recording whose lane the plot is (`filePath`: the lane's row on the page, null for a plot of no one lane).
 */
export type ReadOf = {
    id: string; stage: string | null; attrs: readonly string[]; label: string | null; frame: string | null; image: boolean; filePath: string | null;
    ends: readonly [number, number] | null; trackIndex: number | null; channelIndex: number | null;
};

/** A line's points in the data's own order (values: null for none; keys: each point's identity, where it has one). */
export type KnownLine = { kind: 'line'; xs: readonly number[]; values?: ReadonlyArray<number | null>; keys?: readonly string[] };
/** An image's columns. */
export type KnownImage = { kind: 'image'; xs: readonly number[] };
export type Known = KnownLine | KnownImage;
/** The data a test knows for a read, or null where it knows none (the check then says so: plotContract's NO_KNOWN_DATA). */
export type KnownData = (read: ReadOf) => Known | null;

export const samePlace = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Whether a line's value is one the plot reads (fullRead.ts readableValue, written apart from it). */
const readable = (value: number | null | undefined, plain: boolean): boolean => value === undefined || (value !== null && Number.isFinite(value) && (plain || value > -250));

/**
 * The point an arrow key (`delta`) reads from `from` in `known` (R7): an image's next column on its row; a line's next
 * point in the data's order with a value to read, one at the same x too (the table's step with `from`). The point
 * read is found by its identity, else by its index where the data numbers it so, else by its place. 'unknown' where
 * the point read is not in the data the test knows (the plot reads a point the data does not have); null past the end.
 */
export function stepOf(from: PointAt, known: Known, delta: 1 | -1, plain: boolean): PointAt | 'unknown' | null {
    if (known.kind === 'image') {
        const column = known.xs.findIndex(x => samePlace(x, from.at));
        if (column < 0) return 'unknown';
        const next = column + delta;
        return next >= 0 && next < known.xs.length ? { at: known.xs[next], row: from.row, index: null, identity: null } : null;
    }
    const xs = known.xs;
    let place = from.identity !== null && known.keys ? known.keys.indexOf(from.identity)
        : from.index !== null && from.index < xs.length && samePlace(xs[from.index], from.at) ? from.index : xs.findIndex(x => samePlace(x, from.at));
    if (place < 0 || !samePlace(xs[place], from.at)) return 'unknown';
    for (place += delta; place >= 0 && place < xs.length; place += delta) {
        if (readable(known.values?.[place], plain)) return { at: xs[place], row: from.row, index: place, identity: known.keys?.[place] ?? null };
    }
    return null;
}

/**
 * Whether `read` is the point `expected`: at its place (and row), and, where the two tell points apart, the same one:
 * its identity, or its index where both have one, so a point beside it at the same x is never taken for it.
 */
export function isPoint(read: PointAt | null, expected: PointAt | null): boolean {
    if (!read || !expected || !samePlace(read.at, expected.at)) return false;
    if ((read.row === null) !== (expected.row === null) || (read.row !== null && expected.row !== null && !samePlace(read.row, expected.row))) return false;
    if (expected.identity !== null) return read.identity === expected.identity;
    return read.index === null || expected.index === null || read.index === expected.index;
}

/** The first of `providers` that knows the read. */
export const firstKnown = (...providers: KnownData[]): KnownData => read => {
    for (const provider of providers) {
        const known = provider(read);
        if (known) return known;
    }
    return null;
};

type Picture = Record<string, unknown> & { frame?: string; kind?: string; xs?: number[]; values?: Array<number | null>; matrix?: unknown[];
    waveform?: { min: number[]; max: number[]; minT?: number[]; maxT?: number[] }; events?: Array<{ id: number; xs?: number[]; values: Array<number | null> }> };

/**
 * The comparison's groups as the test itself slotted them: the base group's recordings (their files) and the compared
 * one. A line no single recording is (the base's median, the Δ) is known from these, never from one of them.
 */
export type ComparedGroups = { base: readonly string[]; compare: string | null };

/**
 * The median of the members' values at one point (R1, stage_combine's rule written apart from it): the middle value,
 * or the mean of the two middle ones of an even count; none where any member has none.
 */
function medianOf(values: ReadonlyArray<number | null | undefined>): number | null {
    if (!values.length || values.some(value => value === null || value === undefined || !Number.isFinite(value))) return null;
    const sorted = (values as number[]).slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The comparison's plots, read from the pictures the test posted (`posted`: each recording's, by its file) and the
 * groups it slotted (`groups`), as the backend makes them (R1): the picture of the read's Frame kind and x extent,
 * each recording's latest; a recording's own in its lane or where the line names its file; else the base group's median, point by
 * point over every member's values; a Δ the compared recording's values minus that median (no floor, unrounded). A
 * line made of several recordings is never one of them: a median's readable points are not its first member's.
 * A signal is its envelope's points, a trigger's event its own line, an image its columns.
 */
export function postedPictures(posted: ReadonlyArray<{ filePath: string; picture: Picture }>, groups: ComparedGroups): KnownData {
    return read => {
        // A trigger's event is drawn on its own xs (each event's line), the picture on its own.
        const fitting = posted.filter(({ picture }) => picture.frame === read.frame
            && (extentFits(picture.xs, read.ends) || !!picture.events?.some(event => extentFits(event.xs ?? picture.xs, read.ends))));
        // A recording answered again (another step, the same Frame kind) is drawn from its latest picture.
        const latest = (filePath: string): Picture | undefined => [...fitting].reverse().find(item => item.filePath === filePath)?.picture;
        const nameOf = (filePath: string): string => filePath.split('/').at(-1) ?? filePath;
        // A recording's lane is its own line; else the file the line names (of names one inside another, 1.wav and
        // 11.wav, the longest it holds).
        const files = [...new Set(fitting.map(item => item.filePath))];
        const named = read.stage === 'diff' ? undefined : files.find(filePath => filePath === read.filePath)
            ?? files.filter(filePath => !!read.label && read.label.includes(nameOf(filePath))).sort((a, b) => nameOf(b).length - nameOf(a).length)[0];
        if (named) return ownLine(latest(named)!, read);
        const members = groups.base.map(latest);
        if (!members.length || members.some(member => !member)) return null;
        const base = members as Picture[];
        const xs = base[0].xs ?? [];
        // A median is of recordings on one axis: pictures on others are not known to be combined here.
        if (base.some(member => !sameXs(member.xs ?? [], xs))) return null;
        const compare = groups.compare !== null ? latest(groups.compare) : undefined;
        if (read.stage === 'diff' && (!compare || !sameXs(compare.xs ?? [], xs))) return null;
        if (base.some(member => member.kind === 'heatmap' || member.matrix)) return { kind: 'image', xs };
        // A line whose values the test never gave is not known (never taken as every point readable).
        if (base.some(member => !member.values) || (read.stage === 'diff' && !compare?.values)) return null;
        const median = xs.map((_, index) => medianOf(base.map(member => member.values?.[index])));
        if (read.stage !== 'diff' || !compare) return { kind: 'line', xs, values: median };
        return { kind: 'line', xs, values: differenceFromMedian(compare.values!, base.map(member => member.values!)) };
    };
}

/** A recording's own line: an image's columns, a trigger's event line, a signal's envelope points, else its values. */
function ownLine(picture: Picture, read: ReadOf): Known | null {
    const xs = picture.xs ?? [];
    if (picture.kind === 'heatmap' || picture.matrix) return { kind: 'image', xs };
    if (picture.events?.length) {
        // A trigger's event line is named "#n @ t s", n counted from 1 (its id + 1).
        const number = /#(\d+)\s*@/u.exec(read.label ?? '')?.[1];
        const event = picture.events.find(item => number !== undefined && item.id === Number(number) - 1);
        return event ? { kind: 'line', xs: event.xs ?? xs, values: event.values } : null;
    }
    if (picture.waveform) {
        const line = uiSmokeEnvelopePoints(picture.waveform, (index, count) => (xs.length ? xs[0] + (xs[xs.length - 1] - xs[0]) * (index + 0.5) / count : index));
        return { kind: 'line', xs: line.xs, values: line.values };
    }
    return { kind: 'line', xs, ...(picture.values ? { values: picture.values } : {}) };
}

const sameXs = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, index) => samePlace(x, b[index]));

/**
 * A track's lanes, read from the results the page was given (an analysis-update the test posted, or the app state it
 * built the page with), as the stand-in answers them (fullReadStandIn.ts uiSmokeReadAnswer): a waveform lane's
 * envelope points (in 0–1 of the file) and a spectrogram lane's frame centres, on the lane's time axis, the file's
 * duration across. A lane reading a comparison's picture is not one of these (its x extent is the picture's).
 */
export function recordingLanes(results: PreviewState['results']): KnownData {
    return read => {
        if (read.trackIndex === null || !read.id.startsWith('track-')) return null;
        const result = results[read.trackIndex] as { durationSeconds?: number; channels: Array<Record<string, unknown>> } | undefined;
        const channel = result?.channels[read.channelIndex ?? 0] as { waveform?: Picture['waveform']; spectrogram?: { timeBins: number; timeCentersSec?: number[] } } | undefined;
        const duration = result?.durationSeconds ?? 1;
        if (!channel) return null;
        if (read.image) {
            const spectrogram = channel.spectrogram;
            if (!spectrogram) return null;
            const columns = Array.from({ length: spectrogram.timeBins }, (_, column) => spectrogram.timeCentersSec?.[column] ?? (column + 0.5) / spectrogram.timeBins * duration);
            return extentFits(columns, read.ends) ? { kind: 'image', xs: columns } : null;
        }
        if (!channel.waveform || !extentFits([0, duration], read.ends)) return null;
        const line = uiSmokeEnvelopePoints(channel.waveform, (index, count) => index / count);
        return { kind: 'line', xs: line.xs.map(x => x * duration), values: line.values };
    };
}

/**
 * Evenly spaced bins from 0 Hz to `maxHz` (a spectrum's every bin, as a stand-in answers them), for the plots `on`
 * names, with the values the page was given for the line read (`valuesOf`, `bins` of them): the next point is then
 * the next readable one, past silence (on a line with a floor) and gaps, as on every line. A line whose values the
 * test does not have (or not every bin of) is not known: its check says so, never taking every bin as readable.
 */
export function binGrid(on: (read: ReadOf) => boolean, bins: number, maxHz: number, valuesOf: (read: ReadOf, bins: number) => ReadonlyArray<number | null> | null | undefined): KnownData {
    return read => {
        if (!on(read)) return null;
        const values = valuesOf(read, bins);
        if (!values || values.length !== bins) return null;
        return { kind: 'line', xs: Array.from({ length: bins }, (_, bin) => bin / (bins - 1) * maxHz), values };
    };
}

/** What a page's stand-in served a plot: a recording's channel's every bin (fullReadStandIn.ts uiSmokeServe). */
export type Served = { plot: string; filePath: string; channelIndex: number; values: ReadonlyArray<number | null> };

/**
 * The values `served` holds for the line read on `plot`, `bins` long: the recording's channel the line names (its
 * file's name and "Channel n", n counted from 1), as the stand-in answered it last. None where no one answer is it.
 */
export function servedBins(served: readonly Served[], plot: string, read: ReadOf, bins: number): ReadonlyArray<number | null> | null {
    const label = read.label ?? '';
    const names = served.filter(item => item.plot === plot && item.values.length === bins
        && label.includes(item.filePath.split('/').at(-1) ?? '\u0000') && new RegExp(`Channel ${item.channelIndex + 1}(?!\\d)`, 'u').test(label));
    return names.length === 1 ? names[0].values : null;
}

/**
 * A Δ against a base group (R1), point by point: the compared values minus the median of the members' values; none
 * where the compared one or any member has none.
 */
export function differenceFromMedian(compare: ReadonlyArray<number | null | undefined>, members: ReadonlyArray<ReadonlyArray<number | null | undefined>>): Array<number | null> {
    return compare.map((value, index) => {
        const middle = medianOf(members.map(member => member[index]));
        return value === null || value === undefined || !Number.isFinite(value) || middle === null ? null : value - middle;
    });
}

/** Whether a picture with these xs is the one a read's view spans (its first and last x). */
function extentFits(xs: readonly number[] | undefined, ends: readonly [number, number] | null): boolean {
    if (!ends || !xs?.length) return !ends;
    return samePlace(xs[0], ends[0]) && samePlace(xs[xs.length - 1], ends[1]);
}
