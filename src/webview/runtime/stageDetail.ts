/**
 * When a zoomed per-step picture needs its detail: only the part on screen (with a 5 % margin, computeReqBounds),
 * twice the plot's width in points (rangeRequestPointCount), reusing a range already fetched while it covers the
 * view finely enough (rangeHasDetail), and asked for only once the zoom has settled (a wheel turned notch by notch
 * asks once).
 *
 * A line over time (a waveform, a level over time) is panned along: as the track lanes do (planLaneRange), its
 * detail is fetched for a couple of screens either side at one screen's density, asked again once less than a
 * screen of it is left, at once while only panning, and the detail already fetched is drawn until the new one is
 * in (drawn), so neither a pan nor a zoom in shows the coarse whole-file line.
 */
import type { StageDetail, StageView } from '../../shared/protocol/backendProtocol';
import { computeReqBounds, planLaneRange, RANGE_CACHE_MIN_POINT_RATIO, rangeHasDetail, rangeRequestPointCount } from '../waveform/rangeRequestPolicy';
import { axisValueAt, rowValueAt } from './stagePanes';
import type { NormalizedRange } from './waveformInteraction';
import type { StageSpec } from './stageSource';

export const DETAIL_SETTLE_MS = 200;
/** A view this much wider or narrower than the one last asked for is a zoom (it waits to settle), not a pan. */
const PAN_SPAN_TOLERANCE = 0.01;

export interface DetailPlanner {
    /** The zoom just moved: its detail waits until it settles. */
    moved(): void;
    /**
     * The detail spec for `coarse` zoomed to `x` (and, for an image, `y`) on a plot `width` px wide; null when
     * the whole picture is on screen or the zoom is still settling (then `later` is called once it has).
     */
    spec(base: { key: string; message: StageSpec['message'] }, coarse: StageView, x: NormalizedRange, y: NormalizedRange | null, width: number): StageSpec | null;
    /**
     * The details already asked for of a line over time that cover `x`, the finest first: what it is drawn from
     * while the one `spec` gives is not in yet (on a pan, and on a zoom until it settles). Empty for any other picture.
     */
    drawn(base: { key: string }, coarse: StageView, x: NormalizedRange): StageSpec[];
}

interface Asked {
    x: NormalizedRange;
    y: NormalizedRange | null;
    points: number;
    /** The span of the view it was asked for. */
    span: number;
    spec: StageSpec;
}

/** Whether `coarse` is fetched a few screens either side of the view (a line over time). */
export function prefetchesAround(coarse: StageView): boolean {
    return coarse.kind === 'line' && coarse.x === 'time';
}

export function createDetailPlanner(clock: { now(): number }, timers: Pick<Window, 'setTimeout'>, later: () => void): DetailPlanner {
    const asked = new Map<string, Asked[]>();
    let movedAt = -Infinity;
    let timer: number | undefined;
    const whole = (range: NormalizedRange): boolean => range.start <= 0 && range.end >= 1;
    const covers = (range: NormalizedRange, view: NormalizedRange): boolean => range.start <= view.start && range.end >= view.end;
    const spanOf = (range: NormalizedRange): number => Math.max(range.end - range.start, 1e-12);
    // The points a prefetched range gives one screen of `x` (one screen's density, within the request's limit)...
    const perScreen = (x: NormalizedRange, width: number): number => {
        const plan = planLaneRange(x.start, x.end, width);
        return plan.points * spanOf(x) / spanOf({ start: plan.reqStart, end: plan.reqEnd });
    };
    // ...and whether one asked for draws `view` finely enough: it covers it at (nearly) that density.
    const dense = (item: Asked, view: NormalizedRange, x: NormalizedRange, density: number): boolean =>
        covers(item.x, view) && item.points * (spanOf(x) / spanOf(item.x)) >= density * RANGE_CACHE_MIN_POINT_RATIO - 1e-6;
    const settling = (): boolean => {
        const since = clock.now() - movedAt;
        if (since >= DETAIL_SETTLE_MS) return false;
        if (timer === undefined) timer = timers.setTimeout(() => { timer = undefined; later(); }, DETAIL_SETTLE_MS - since + 10);
        return true;
    };
    const keep = (key: string, item: Asked): StageSpec => {
        asked.set(key, [...(asked.get(key) ?? []), item].slice(-8));
        return item.spec;
    };
    const detailSpec = (base: { key: string; message: StageSpec['message'] }, detail: StageDetail): StageSpec => ({
        key: `detail|${base.key}|${[...detail.x, ...(detail.y ?? [])].map(value => value.toPrecision(6)).join(',')}|${detail.points}`,
        message: { ...base.message, detail },
    });
    function around(base: { key: string; message: StageSpec['message'] }, coarse: StageView, x: NormalizedRange, width: number): StageSpec | null {
        const done = asked.get(base.key) ?? [];
        const plan = planLaneRange(x.start, x.end, width);
        // Enough of a range asked for is left on both sides: it is kept (still coming in, or in).
        const density = perScreen(x, width);
        const kept = [...done].reverse().find(item => dense(item, { start: plan.keepStart, end: plan.keepEnd }, x, density));
        if (kept) return kept.spec;
        // Panning (the view as wide as the last one asked for) asks at once; a zoom waits until it settles.
        const last = done.at(-1);
        const panning = !!last && Math.abs(spanOf(x) / last.span - 1) <= PAN_SPAN_TOLERANCE;
        if (!panning && settling()) return null;
        const detail: StageDetail = { x: [axisValueAt(coarse, plan.reqStart), axisValueAt(coarse, plan.reqEnd)], points: plan.points };
        return keep(base.key, { x: { start: plan.reqStart, end: plan.reqEnd }, y: null, points: plan.points, span: spanOf(x), spec: detailSpec(base, detail) });
    }
    return {
        moved() { movedAt = clock.now(); },
        spec(base, coarse, x, y, width) {
            const rows = coarse.kind === 'heatmap' ? y : null;
            if (whole(x) && (!rows || whole(rows))) return null;
            if (prefetchesAround(coarse)) return around(base, coarse, x, width);
            const done = asked.get(base.key) ?? [];
            const points = rangeRequestPointCount(width);
            const reuse = done.find(item => covers(item.x, x) && (!rows || (!!item.y && covers(item.y, rows))) && rangeHasDetail(item.points, item.x.start, item.x.end, points, width, x.start, x.end));
            if (reuse) return reuse.spec;
            if (settling()) return null;
            const xs = computeReqBounds(x.start, x.end), ys = rows ? computeReqBounds(rows.start, rows.end) : null;
            const detail: StageDetail = { x: [axisValueAt(coarse, xs.reqStart), axisValueAt(coarse, xs.reqEnd)], points, ...(ys ? { y: [rowValueAt(coarse, ys.reqStart), rowValueAt(coarse, ys.reqEnd)] } : {}) };
            return keep(base.key, { x: { start: xs.reqStart, end: xs.reqEnd }, y: ys ? { start: ys.reqStart, end: ys.reqEnd } : null, points, span: spanOf(x), spec: detailSpec(base, detail) });
        },
        drawn(base, coarse, x) {
            if (!prefetchesAround(coarse) || whole(x)) return [];
            // Every one covering the view, the finest first: zoomed in past them, a fetched detail is still finer
            // than the whole-file picture until the zoom's own is in.
            const density = (item: Asked): number => item.points / spanOf(item.x);
            return (asked.get(base.key) ?? []).filter(item => covers(item.x, x)).reverse().sort((a, b) => density(b) - density(a)).map(item => item.spec);
        },
    };
}

/** The range a detail spec covers, as a key: the same for every file, channel and step asked over one range. */
export function detailRangeKey(spec: StageSpec): string {
    const detail = spec.message.detail;
    return detail ? [...detail.x, ...(detail.y ?? [])].join(',') : '';
}

/**
 * Pictures drawn together (a median, a difference) taken from one range, never one member's newer detail beside
 * another's older one: `specs` lists each member's specs in the order it is drawn from them, `view` reads its
 * picture under one. The pictures of the first range every member has one of; null while there is none.
 */
export function onOneRange<T>(members: readonly T[], specs: (member: T) => readonly StageSpec[], view: (spec: StageSpec, member: T) => StageView | null | undefined): Map<T, StageView> | null {
    if (!members.length) return null;
    const at = (member: T, range: string): StageView | undefined => {
        for (const spec of specs(member)) {
            if (detailRangeKey(spec) !== range) continue;
            const found = view(spec, member);
            if (found) return found;
        }
        return undefined;
    };
    for (const spec of specs(members[0])) {
        const range = detailRangeKey(spec);
        const views = members.map(member => at(member, range));
        if (views.every((found): found is StageView => !!found)) return new Map(members.map((member, index) => [member, views[index]]));
    }
    return null;
}
