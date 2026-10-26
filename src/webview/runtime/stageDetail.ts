/**
 * When a zoomed per-step picture needs its detail, as the track lanes fetch theirs: only the part on screen
 * (with the lanes' 5 % margin, computeReqBounds), twice the plot's width in points (rangeRequestPointCount),
 * reusing a range already fetched while it covers the view finely enough (rangeHasDetail), and asked for only
 * once the zoom has settled (a wheel turned notch by notch asks once).
 */
import type { StageDetail, StageView } from '../../shared/protocol/backendProtocol';
import { computeReqBounds, rangeHasDetail, rangeRequestPointCount } from '../waveform/rangeRequestPolicy';
import { axisValueAt, rowValueAt } from './stagePanes';
import type { NormalizedRange } from './waveformInteraction';
import type { StageSpec } from './stageSource';

export const DETAIL_SETTLE_MS = 200;

export interface DetailPlanner {
    /** The zoom just moved: its detail waits until it settles. */
    moved(): void;
    /**
     * The detail spec for `coarse` zoomed to `x` (and, for an image, `y`) on a plot `width` px wide; null when
     * the whole picture is on screen or the zoom is still settling (then `later` is called once it has).
     */
    spec(base: { key: string; message: StageSpec['message'] }, coarse: StageView, x: NormalizedRange, y: NormalizedRange | null, width: number): StageSpec | null;
}

export function createDetailPlanner(clock: { now(): number }, timers: Pick<Window, 'setTimeout'>, later: () => void): DetailPlanner {
    const asked = new Map<string, Array<{ x: NormalizedRange; y: NormalizedRange | null; points: number; spec: StageSpec }>>();
    let movedAt = -Infinity;
    let timer: number | undefined;
    const whole = (range: NormalizedRange): boolean => range.start <= 0 && range.end >= 1;
    const covers = (range: NormalizedRange, view: NormalizedRange): boolean => range.start <= view.start && range.end >= view.end;
    return {
        moved() { movedAt = clock.now(); },
        spec(base, coarse, x, y, width) {
            const rows = coarse.kind === 'heatmap' ? y : null;
            if (whole(x) && (!rows || whole(rows))) return null;
            const done = asked.get(base.key) ?? [];
            const points = rangeRequestPointCount(width);
            const reuse = done.find(item => covers(item.x, x) && (!rows || (!!item.y && covers(item.y, rows))) && rangeHasDetail(item.points, item.x.start, item.x.end, points, width, x.start, x.end));
            if (reuse) return reuse.spec;
            const since = clock.now() - movedAt;
            if (since < DETAIL_SETTLE_MS) {
                if (timer === undefined) timer = timers.setTimeout(() => { timer = undefined; later(); }, DETAIL_SETTLE_MS - since + 10);
                return null;
            }
            const xs = computeReqBounds(x.start, x.end), ys = rows ? computeReqBounds(rows.start, rows.end) : null;
            const detail: StageDetail = { x: [axisValueAt(coarse, xs.reqStart), axisValueAt(coarse, xs.reqEnd)], points, ...(ys ? { y: [rowValueAt(coarse, ys.reqStart), rowValueAt(coarse, ys.reqEnd)] } : {}) };
            const spec: StageSpec = {
                key: `detail|${base.key}|${[...detail.x, ...(detail.y ?? [])].map(value => value.toPrecision(6)).join(',')}|${points}`,
                message: { ...base.message, detail },
            };
            asked.set(base.key, [...done, { x: { start: xs.reqStart, end: xs.reqEnd }, y: ys ? { start: ys.reqStart, end: ys.reqEnd } : null, points, spec }].slice(-8));
            return spec;
        },
    };
}
