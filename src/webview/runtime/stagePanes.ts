/**
 * The comparison's three panes for one step of the chain: the base's, the compared file's and their
 * difference, each drawn as its Frame type is (stage_view.py): a line over time, log frequency or
 * quefrency, bars per band, an image over time and frequency, Bark or quefrency. The base of a group is
 * the median of its files' pictures, point by point. A difference is taken between two pictures of the
 * same quantity on the same axes, in what they measure (dB for levels); otherwise the Δ pane says why it
 * is empty. Pure apart from `paintStage`, which only draws.
 */
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { UiStrings } from '../../shared/i18n/strings';
import { HEADLINE_WITHIN_DB, median } from './entryTable';
import { PANE_LEFT, paneAxes, type PaneRange } from './comparePanes';
import type { NormalizedRange } from './waveformInteraction';
import { plotPointIn, type PlotMargins } from './plotInteraction';
import { paintWaveformLayer, waveformRange } from '../plot/waveformLayer';

export type StageStrings = Pick<UiStrings, 'axisFrequency' | 'axisTime' | 'axisBand' | 'axisBark' | 'axisQuefrency' | 'axisCepstrum' | 'axisLevel' | 'axisLevelUncal' | 'axisLevelCal' | 'axisDelta' | 'axisValue' | 'axisGain' | 'axisCoherence' | 'legendHeadline' | 'legendLeak' | 'legendLine' | 'stageNoDelta' | 'stageMaxDelta' | 'stepNotDrawable' | 'compareLevelsAt' | 'waveRangeAxisAmplitude'>;

const DB_QUANTITIES = ['level', 'gain'];
const isDb = (view: StageView | null): boolean => DB_QUANTITIES.includes(view?.quantity ?? '');

/**
 * A cepstrum's first coefficient (zero quefrency) is the mean log magnitude, hundreds of times the rest:
 * the ranges leave it out, as wandas' cepstrogram plot leaves it out of its colour scale.
 */
const skipsFirst = (view: StageView): boolean => view.quantity === 'cepstrum';

/**
 * Whether a heatmap column can head the comparison: an STFT's frame centred less than n_fft / 2 from either end of
 * the signal reads padding beyond it, so such columns (stage_view `whole`) are drawn but never named.
 */
const headlineColumn = (view: StageView, column: number): boolean => view.whole?.[column] !== false;

function sameAxes(a: StageView, b: StageView): boolean {
    return a.kind === b.kind && a.x === b.x && a.quantity === b.quantity && a.yAxis === b.yAxis
        && (a.xs?.length ?? 0) === (b.xs?.length ?? 0) && (a.ys?.length ?? 0) === (b.ys?.length ?? 0);
}

const medianOf = (values: Array<number | null>): number | null => {
    const known = values.filter((value): value is number => value !== null);
    return known.length === values.length && known.length ? median(known) : null;
};

/** The median of several files' pictures, point by point; null when they do not share their axes. */
export function medianView(views: readonly StageView[]): StageView | null {
    if (!views.length || views.some(view => !sameAxes(view, views[0]))) return null;
    if (views.length === 1) return views[0];
    // A group has a median level, not a median signal: its waveform is not drawn.
    const { waveform: _signal, ...first } = views[0];
    if (first.matrix) {
        return { ...first, matrix: first.matrix.map((row, r) => row.map((_, c) => medianOf(views.map(view => view.matrix![r][c])))) };
    }
    return { ...first, values: (first.values ?? []).map((_, index) => medianOf(views.map(view => view.values![index]))) };
}


/**
 * Where a difference can head the comparison: for pictures of dB levels, the points (or cells) where the louder
 * of base and compare is within HEADLINE_WITHIN_DB of the loudest of either; for other values, every point.
 */
export function loudPoints(base: StageView, compare: StageView, within = HEADLINE_WITHIN_DB): { values?: boolean[]; matrix?: boolean[][] } {
    const louder = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : Math.max(a, b));
    if (base.matrix && compare.matrix) {
        const cells = base.matrix.map((row, r) => row.map((value, c) => louder(value, compare.matrix![r]?.[c] ?? null)));
        const top = Math.max(...cells.flat().filter((value): value is number => value !== null && value > -250));
        return { matrix: cells.map(row => row.map(value => value !== null && (!isDb(base) || value >= top - within))) };
    }
    const points = (base.values ?? []).map((value, index) => louder(value, compare.values?.[index] ?? null));
    const top = Math.max(...points.filter((value): value is number => value !== null && value > -250));
    return { values: points.map(value => value !== null && (!isDb(base) || value >= top - within)) };
}

/**
 * The comparison's headline for a step's picture: where base and compare differ most among the points loud
 * enough to be heard (loudPoints), with both their values: "1.00 kHz base −40.0 / compare −26.0 dB".
 */
export function stageLevelsHeadline(base: StageView | null, compare: StageView | null, diff: StageView | null, strings: Pick<StageStrings, 'stageNoDelta' | 'compareLevelsAt'>): string {
    if (!base || !compare || !diff) return strings.stageNoDelta;
    const loud = loudPoints(base, compare);
    const skip = skipsFirst(diff) ? 1 : 0;
    let best: { value: number; index: number; row?: number } | null = null;
    if (diff.matrix) diff.matrix.forEach((cells, row) => row >= skip && cells.forEach((value, index) => { if (value !== null && loud.matrix?.[row]?.[index] && headlineColumn(diff, index) && (!best || Math.abs(value) > Math.abs(best.value))) best = { value, index, row }; }));
    else (diff.values ?? []).forEach((value, index) => { if (index >= skip && value !== null && loud.values?.[index] && (!best || Math.abs(value) > Math.abs(best.value))) best = { value, index }; });
    if (!best) return strings.stageNoDelta;
    const found = best as { value: number; index: number; row?: number };
    const at = (view: StageView): number | null => (found.row === undefined ? view.values?.[found.index] : view.matrix?.[found.row]?.[found.index]) ?? null;
    const shown = (value: number | null): string => (value === null ? '—' : Math.abs(value) >= 10 ? value.toFixed(1).replace(/^-/, '−') : value.toPrecision(3).replace(/^-/, '−'));
    return strings.compareLevelsAt.replace('{at}', atText(diff, found.index, found.row)).replace('{base}', shown(at(base))).replace('{compare}', shown(at(compare)))
        + (isDb(base) ? ' dB' : '');
}

/** compare − base, point by point, for two pictures of one quantity on the same axes (dB for levels); otherwise null. */
export function stageDifference(base: StageView | null, compare: StageView | null): StageView | null {
    if (!base || !compare || base.kind === 'none' || !base.quantity || !sameAxes(base, compare)) return null;
    // dB to a hundredth; small linear values (cepstral coefficients, coherence) keep more.
    const scale = isDb(base) ? 100 : 1e6;
    // The difference of two signals' levels: it has no waveform of its own.
    const { waveform: _signal, ...shape } = compare;
    const minus = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : Math.round((a - b) * scale) / scale);
    if (compare.matrix && base.matrix) {
        // A column is a whole window only where it is one for both.
        const whole = compare.whole || base.whole ? compare.matrix[0]?.map((_, c) => compare.whole?.[c] !== false && base.whole?.[c] !== false) : undefined;
        return { ...shape, matrix: compare.matrix.map((row, r) => row.map((value, c) => minus(value, base.matrix![r][c]))), ...(whole ? { whole } : {}) };
    }
    return { ...shape, values: (compare.values ?? []).map((value, index) => minus(value, base.values![index] ?? null)) };
}

function points(view: StageView): Array<number | null> {
    const skip = skipsFirst(view) ? 1 : 0;
    return view.matrix ? view.matrix.slice(skip).flat() : (view.values ?? []).slice(skip);
}

function extent(views: ReadonlyArray<StageView | null>): { low: number; high: number } {
    let low = Infinity, high = -Infinity;
    for (const view of views) {
        if (!view) continue;
        for (const value of points(view)) {
            // Silent stretches sit at the floor (−300 dB): they would squash every other level into one line.
            if (value === null || !Number.isFinite(value) || value <= -250) continue;
            low = Math.min(low, value); high = Math.max(high, value);
        }
    }
    return { low, high };
}

/** The 99th percentile of the points' magnitudes, as wandas' cepstrogram plot sets its colour range. */
function robustEdge(views: ReadonlyArray<StageView | null>): number {
    const magnitudes = views.flatMap(view => (view ? points(view) : [])).filter((value): value is number => value !== null && Number.isFinite(value)).map(Math.abs).sort((a, b) => a - b);
    return magnitudes.length ? magnitudes[Math.min(magnitudes.length - 1, Math.floor(0.99 * (magnitudes.length - 1)))] : 0;
}

/** One range for the base and compare panes, so their pictures compare at a glance. */
export function stageRange(views: ReadonlyArray<StageView | null>): PaneRange {
    // A time signal drawn as itself shares ± its largest peak.
    if (views.some(view => view?.waveform)) return waveformRange(views.map(view => view?.waveform));
    const { low, high } = extent(views);
    const first = views.find(Boolean);
    const quantity = first?.quantity;
    if (!Number.isFinite(high)) return quantity === 'coherence' ? { min: 0, max: 1 } : quantity === 'cepstrum' ? { min: -1, max: 1 } : { min: -100, max: 0 };
    if (quantity === 'coherence') return { min: 0, max: 1 };
    if (quantity === 'cepstrum') {
        // Signed coefficients around zero: symmetric, robust for an image, every peak for a line.
        const edge = (first?.kind === 'heatmap' ? robustEdge(views) : Math.max(Math.abs(low), Math.abs(high)) * 1.05) || 1;
        return { min: -edge, max: edge };
    }
    if (DB_QUANTITIES.includes(quantity ?? '')) {
        // Four equal steps of a round size, as the spectra's.
        const step = [5, 10, 20, 25].find(size => 4 * size >= Math.min(100, high - low)) ?? 25;
        const max = Math.ceil(high / step) * step;
        return { min: max - 4 * step, max };
    }
    const pad = (high - low) * 0.05 || Math.abs(high) * 0.1 || 1;
    return { min: low - pad, max: high + pad };
}

/** ± an edge with whole-number quarters, for a difference in dB; ± the largest difference otherwise. */
export function stageDiffRange(view: StageView | null): PaneRange {
    const { low, high } = extent([view]);
    if (view && !isDb(view)) {
        const edge = (Number.isFinite(high) ? Math.max(Math.abs(low), Math.abs(high)) * 1.05 : 0) || 1;
        return { min: -edge, max: edge };
    }
    let edge = 6;
    if (Number.isFinite(high)) edge = Math.max(edge, Math.abs(low), Math.abs(high));
    const unit = edge > 40 ? 20 : edge > 16 ? 8 : 4;
    const rounded = Math.ceil(edge / unit) * unit;
    return { min: -rounded, max: rounded };
}

export interface StageAxes { x: string; y: string }

/** What each axis of a picture measures; a heatmap's y is its rows' axis, its colour the level. */
export function stageAxes(strings: StageStrings, view: StageView | null, input: { unit?: string; ref?: number } | undefined, diff = false): StageAxes {
    const x = view?.x === 'time' ? strings.axisTime : view?.x === 'band' ? strings.axisBand : view?.x === 'quefrency' ? strings.axisQuefrency : strings.axisFrequency;
    if (view?.kind === 'heatmap') return { x, y: view.yAxis === 'bark' ? strings.axisBark : view.yAxis === 'quefrency' ? strings.axisQuefrency : strings.axisFrequency };
    if (diff && (!view || isDb(view))) return { x, y: strings.axisDelta };
    // A time signal is drawn as itself: its amplitude, in its unit (full scale while uncalibrated).
    if (view?.waveform) return { x, y: `${strings.waveRangeAxisAmplitude} ${view.waveform.unit && view.waveform.unit !== 'FS' ? view.waveform.unit : 'FS'}` };
    const unit = view?.unit ? ` ${view.unit}` : '';
    const y = view?.quantity === 'level' ? paneAxes(strings, input).level.y
        : view?.quantity === 'gain' ? strings.axisGain
            : view?.quantity === 'coherence' ? strings.axisCoherence
                : view?.quantity === 'cepstrum' ? strings.axisCepstrum
                    : `${strings.axisValue}${unit}`;
    return { x, y: diff ? `Δ ${y}` : y };
}

const hz = (value: number): string => (value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz` : `${Math.round(value)} Hz`);
/** A signed difference: dB to a tenth with its unit, other values to three significant digits. */
const signed = (value: number, db = true): string => `${value >= 0 ? '+' : '−'}${db ? `${Math.abs(value).toFixed(1)} dB` : Math.abs(value).toPrecision(3)}`;
const quefrency = (seconds: number): string => `${(seconds * 1000).toFixed(seconds < 0.01 ? 2 : 1)} ms`;

/** Where along its axis a point of the picture is, for the readout and the headline. */
function atText(view: StageView, index: number, row?: number): string {
    const x = view.xs?.[index] ?? 0;
    const along = view.x === 'time' ? `${x.toFixed(2)} s` : view.x === 'quefrency' ? quefrency(x) : hz(x);
    if (row === undefined) return along;
    const y = view.ys?.[row] ?? 0;
    return `${along} · ${view.yAxis === 'bark' ? `${y.toFixed(1)} Bark` : view.yAxis === 'quefrency' ? quefrency(y) : hz(y)}`;
}

/** The Δ pane's headline: where the difference is largest, or why there is none. */
export function stageHeadline(diff: StageView | null, strings: Pick<StageStrings, 'stageNoDelta' | 'stageMaxDelta'>): string {
    if (!diff) return strings.stageNoDelta;
    let best: { value: number; index: number; row?: number } | null = null;
    const skip = skipsFirst(diff) ? 1 : 0;
    if (diff.matrix) diff.matrix.forEach((cells, row) => row >= skip && cells.forEach((value, index) => { if (value !== null && headlineColumn(diff, index) && (!best || Math.abs(value) > Math.abs(best.value))) best = { value, index, row }; }));
    else (diff.values ?? []).forEach((value, index) => { if (index >= skip && value !== null && (!best || Math.abs(value) > Math.abs(best.value))) best = { value, index }; });
    if (!best) return strings.stageNoDelta;
    const found = best as { value: number; index: number; row?: number };
    return strings.stageMaxDelta.replace('{at}', atText(diff, found.index, found.row)).replace('{delta}', signed(found.value, isDb(diff)));
}

/** The point under the pointer (a fraction across the plot): where it is, then base, compare and Δ. */
export function stageReadout(views: { base: StageView | null; compare: StageView | null; diff: StageView | null }, fraction: number): string {
    const view = views.compare ?? views.base;
    if (!view?.xs?.length || view.kind === 'heatmap') return '';
    const scale = axisScale(view);
    let index = 0;
    view.xs.forEach((value, at) => { if (Math.abs(scale.fraction(value) - fraction) < Math.abs(scale.fraction(view.xs![index]) - fraction)) index = at; });
    const value = (side: StageView | null): string => {
        const level = side?.values?.[index];
        return level === null || level === undefined ? '—' : Math.abs(level) >= 10 ? level.toFixed(1).replace(/^-/, '−') : level.toPrecision(3).replace(/^-/, '−');
    };
    const delta = views.diff?.values?.[index];
    // Over a signal drawn as itself, the readout gives its level there (in dB, so it says so).
    const unit = view.waveform ? ' dB' : '';
    return [atText(view, index), value(views.base) + unit, value(views.compare) + unit, delta === null || delta === undefined ? '—' : signed(delta, isDb(view))].join(' · ');
}

/**
 * The index of the axis point nearest `value` (on a log axis, nearest in ratio), or −1 past the ends by more than
 * half the end step: an image drawn on wider axes than it covers leaves the rest empty.
 */
function nearestIndex(axis: readonly number[], value: number, log: boolean): number {
    const n = axis.length;
    if (!n) return -1;
    const at = (index: number): number => (log ? Math.log(Math.max(axis[index], 1e-12)) : axis[index]);
    const target = log ? Math.log(Math.max(value, 1e-12)) : value;
    const firstStep = n > 1 ? at(1) - at(0) : 1, lastStep = n > 1 ? at(n - 1) - at(n - 2) : 1;
    if (target < at(0) - firstStep / 2 || target > at(n - 1) + lastStep / 2) return -1;
    let low = 0, high = n - 1;
    while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (at(middle) <= target) low = middle; else high = middle;
    }
    return Math.abs(at(high) - target) < Math.abs(at(low) - target) ? high : low;
}

type AxisScale = { low: number; high: number; log: boolean; fraction(value: number): number; at(fraction: number): number };

/** The whole axis (0–1). */
/** The roles' colours: the base blue, slots 1–3 yellow, purple and magenta; a difference green. */
export const ROLE_COLORS: Readonly<Record<number, string>> = { 0: '#3b82f6', 1: '#d4b20f', 2: '#a371f7', 3: '#e85aad' };
export const DIFF_COLOR = '#3fb950';

export const FULL_WINDOW: NormalizedRange = { start: 0, end: 1 };

/** The part of an axis on screen: `window` (fractions of the whole axis) stretched across the plot. */
function windowed(scale: AxisScale, window: NormalizedRange = FULL_WINDOW): AxisScale {
    const span = window.end - window.start || 1;
    return {
        low: scale.at(window.start), high: scale.at(window.end), log: scale.log,
        fraction: value => (scale.fraction(value) - window.start) / span,
        at: fraction => scale.at(window.start + fraction * span),
    };
}

/** Where a value of the picture's horizontal axis sits on it (0–1 across the whole axis), and back. */
export function axisFractionOf(view: Pick<StageView, 'xs' | 'xScale'>, value: number): number { return axisScale(view).fraction(value); }
export function axisValueAt(view: Pick<StageView, 'xs' | 'xScale'>, fraction: number): number { return axisScale(view).at(fraction); }
/** The same for a heatmap's rows (frequency, Bark or quefrency). */
export function rowFractionOf(view: StageView, value: number): number { return rowScale(view).fraction(value); }
export function rowValueAt(view: StageView, fraction: number): number { return rowScale(view).at(fraction); }
const rowScale = (view: StageView): AxisScale => axisScale({ xs: view.ys, xScale: view.yAxis === 'frequency' ? 'log' : 'linear' });

/** A log axis spans the edges of its geometric points; a linear one its first to last point. */
function axisScale(view: Pick<StageView, 'xs' | 'xScale'>): { low: number; high: number; log: boolean; fraction(value: number): number; at(fraction: number): number } {
    const xs = view.xs ?? [];
    const log = view.xScale === 'log' && xs.length > 1 && xs[0] > 0;
    if (log) {
        const ratio = Math.sqrt(xs[1] / xs[0]);
        const low = xs[0] / ratio, high = xs[xs.length - 1] * ratio;
        return { low, high, log, fraction: value => Math.log(value / low) / Math.log(high / low), at: fraction => low * (high / low) ** fraction };
    }
    const low = xs[0] ?? 0, high = xs.length > 1 ? xs[xs.length - 1] : low + 1;
    return { low, high, log, fraction: value => (value - low) / (high - low || 1), at: fraction => low + fraction * (high - low) };
}

function ticks(low: number, high: number, log: boolean): number[] {
    if (log) return [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(value => value > low * 1.05 && value < high * 0.95);
    const span = high - low;
    const step = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].find(size => span / size <= 8) ?? 100;
    const values: number[] = [];
    for (let value = Math.ceil(low / step) * step; value <= high; value += step) values.push(Math.round(value * 1000) / 1000);
    return values;
}

const tickText = (value: number, log: boolean): string => (log ? (value >= 1000 ? `${value / 1000}k` : String(value)) : String(value));
/** A value on the level axis with as many decimals as its span needs (cepstral coefficients need four or five). */
const levelText = (value: number, span: number): string => (span >= 8 ? String(Math.round(value)) : value.toFixed(Math.max(1, Math.min(6, Math.ceil(-Math.log10(span / 8)))))).replace(/^-/, '−');

/** One picture drawn on a pane: its colour and, over others, its line weight. */
export interface StageLayer {
    view: StageView;
    color: string;
    width?: number;
    alpha?: number;
    /** Bars filled down to the axis (a picture on its own); overlaid bars are drawn as steps. */
    filled?: boolean;
}

/** Several pictures of one Frame type on one set of axes, as solid lines (or steps) told apart by colour. */
export interface StageOverlay {
    layers: StageLayer[];
}

export interface StageLabels {
    title: string;
    legend: Array<{ color: string; text: string }>;
}

export interface StagePaintOptions {
    diff?: boolean;
    empty?: string;
    /** Per heatmap cell (rows × columns): false where the difference is dimmed (both levels far below the loudest). */
    loud?: boolean[][] | null;
    /** A fixed size in CSS pixels at ratio 1, for a report figure. */
    size?: { width: number; height: number };
    /** A title and legend above the plot, as a report figure has. */
    labels?: StageLabels;
    /**
     * The part of each axis on screen (zoomed), as fractions of the whole: x for every picture, y for a
     * heatmap's rows (a line's level axis is zoomed through `range`).
     */
    window?: { x?: NormalizedRange; y?: NormalizedRange };
    /**
     * The whole picture whose axes a zoomed one is placed on: a detail picture (a part at full resolution) has
     * only the part on screen, so its points are placed on the whole picture's axes.
     */
    axisView?: StageView | null;
    /**
     * The region compared: on a time axis before the region's step, the parts outside it are veiled and its
     * ends drawn (`range`); a picture of the region alone says which part it is in a corner (`tag`).
     */
    region?: { start: number; end: number; mark: 'range' | 'tag'; label: string };
}

/** One picture on its own: the base, the compared file or their difference. */
export function paintStage(canvas: HTMLCanvasElement, view: StageView | null, range: PaneRange, color: string, axes: StageAxes, options: StagePaintOptions = {}): void {
    paintOverlay(canvas, { layers: view ? [{ view, color, filled: true }] : [] }, range, axes, options);
}

/**
 * Draws one pane: the overlay's pictures within `range` (the level axis, or a heatmap's colours), with tick
 * numbers on both axes and the axes' names. `diff` draws a zero line and colours a heatmap green (compare
 * louder) and grey (quieter). Without a picture it says `empty` in the middle of the pane.
 */
export function paintOverlay(canvas: HTMLCanvasElement, overlay: StageOverlay, range: PaneRange, axes: StageAxes, options: StagePaintOptions = {}): void {
    const ratio = options.size ? 1 : canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const width = options.size?.width ?? (canvas.clientWidth || 600), height = options.size?.height ?? (canvas.clientHeight || 120);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const style = canvas.ownerDocument.defaultView?.getComputedStyle(canvas);
    const muted = style?.getPropertyValue('--muted').trim() || '#888';
    const line = style?.getPropertyValue('--line').trim() || '#444';
    const text = options.labels ? '#222' : style?.getPropertyValue('--text').trim() || '#ddd';
    const left = PANE_LEFT, top = options.labels ? 40 : 4, bottom = 16, right = 4;
    const plotWidth = Math.max(1, width - left - right), plotHeight = Math.max(1, height - top - bottom);
    if (options.labels) {
        context.font = 'bold 14px sans-serif';
        context.fillStyle = '#222';
        context.fillText(options.labels.title, left, 18);
        context.font = '12px sans-serif';
        let x = left;
        for (const item of options.labels.legend) {
            context.strokeStyle = item.color;
            context.lineWidth = 2.5;
            context.beginPath(); context.moveTo(x, 30); context.lineTo(x + 18, 30); context.stroke();
            context.fillStyle = '#444';
            context.fillText(item.text, x + 22, 34);
            x += 30 + context.measureText(item.text).width;
        }
    }
    context.font = '10px sans-serif';
    const view = overlay.layers.find(layer => layer.view.kind !== 'none' && layer.view.xs?.length)?.view;
    if (!view) {
        if (options.empty) {
            context.fillStyle = muted;
            context.textAlign = 'center';
            context.fillText(options.empty, left + plotWidth / 2, top + plotHeight / 2);
            context.textAlign = 'start';
        }
        return;
    }
    const xWindow = options.window?.x ?? FULL_WINDOW;
    const whole = options.axisView ?? view;
    const xAxis = windowed(axisScale(whole), xWindow);
    // Zoomed, the pictures run past the plot's edges: they are clipped to it.
    const xAt = (value: number): number => left + xAxis.fraction(value) * plotWidth;
    const heatmap = view.kind === 'heatmap';
    const yAxis = heatmap ? windowed(rowScale(whole), options.window?.y) : null;
    const yAt = (value: number): number => top + (1 - (Math.max(range.min, Math.min(range.max, value)) - range.min) / (range.max - range.min)) * plotHeight;

    if (heatmap && yAxis && view.matrix) {
        const image = context.createImageData(Math.round(plotWidth * ratio), Math.round(plotHeight * ratio));
        const extentAbs = Math.max(Math.abs(range.min), Math.abs(range.max), 1e-9);
        // Which row and column each pixel shows (the nearest; none past the picture's ends), worked out once per
        // line, not per pixel, from the axes' values: a detail picture covers only part of them.
        const rowOf = Array.from({ length: image.height }, (_, py) => nearestIndex(view.ys!, yAxis.at(1 - (py + 0.5) / image.height), yAxis.log));
        const columnOf = Array.from({ length: image.width }, (_, px) => nearestIndex(view.xs!, xAxis.at((px + 0.5) / image.width), false));
        const pixels = new Uint32Array(image.data.buffer);
        // One colour per cell (ABGR as the canvas stores it), looked up for every pixel of that cell.
        const colours = view.matrix.map((cells, row) => cells.map((cell, column) => {
            if (cell === null || cell === undefined) return 0;
            if (options.diff) {
                // A difference where both levels are far below the loudest is dimmed: it is not what is heard.
                const amount = Math.min(1, Math.abs(cell) / extentAbs) * (options.loud && !options.loud[row]?.[column] ? 0.2 : 1);
                const [r, g, b] = (cell >= 0 ? [63, 185, 80] : [150, 150, 150]).map(channel => Math.round(channel * amount));
                return (255 << 24 | b << 16 | g << 8 | r) >>> 0;
            }
            if (view.quantity === 'cepstrum') {
                // Signed coefficients as wandas draws them (RdBu_r): blue below zero, white at zero, red above.
                const amount = Math.max(-1, Math.min(1, cell / extentAbs));
                const fade = Math.round(255 * (1 - Math.abs(amount)));
                const [r, g, b] = amount >= 0 ? [255, fade, fade] : [fade, fade, 255];
                return (255 << 24 | b << 16 | g << 8 | r) >>> 0;
            }
            const level = Math.round(Math.max(0, Math.min(1, (cell - range.min) / (range.max - range.min || 1))) * 255);
            return (255 << 24 | level << 16 | level << 8 | level) >>> 0;
        }));
        for (let py = 0; py < image.height; py++) {
            const cells = rowOf[py] < 0 ? [] : colours[rowOf[py]] ?? [];
            const offset = py * image.width;
            for (let px = 0; px < image.width; px++) pixels[offset + px] = columnOf[px] < 0 ? 0 : cells[columnOf[px]] ?? 0;
        }
        context.putImageData(image, Math.round(left * ratio), Math.round(top * ratio));
        context.fillStyle = muted;
        for (const value of ticks(yAxis.low, yAxis.high, yAxis.log)) {
            const y = top + (1 - yAxis.fraction(value)) * plotHeight;
            context.fillText(tickText(value, yAxis.log), 16, y + 3);
        }
        // The colours' range, top right, as the spectrograms say theirs.
        const edge = Math.max(Math.abs(range.min), Math.abs(range.max));
        const span = options.diff || view.quantity === 'cepstrum'
            ? `±${isDb(view) ? `${Math.round(edge)} dB` : levelText(edge, edge)}`
            : `${Math.round(range.min)}…${Math.round(range.max)}${view.quantity === 'level' ? ' dB' : ''}`;
        context.fillStyle = text;
        context.fillText(span, left + plotWidth - context.measureText(span).width - 4, top + 11);
    } else {
        context.strokeStyle = line;
        context.lineWidth = 1;
        context.fillStyle = muted;
        const step = (range.max - range.min) / 4;
        for (let tick = 0; tick <= 4; tick++) {
            const value = range.min + tick * step;
            context.beginPath(); context.moveTo(left, yAt(value)); context.lineTo(left + plotWidth, yAt(value)); context.stroke();
            context.fillText(levelText(value, range.max - range.min), 16, yAt(value) + (tick === 4 ? 10 : 3));
        }
        if (options.diff) {
            context.strokeStyle = muted;
            context.beginPath(); context.moveTo(left, yAt(0)); context.lineTo(left + plotWidth, yAt(0)); context.stroke();
        }
        const bars = view.kind === 'bar';
        const ratioStep = bars && view.xs!.length > 1 ? Math.sqrt(view.xs![1] / view.xs![0]) : 1.12;
        context.save();
        context.beginPath(); context.rect(left, top, plotWidth, plotHeight); context.clip();
        const wholeAxis = axisScale(whole);
        // Signals drawn as themselves share an amplitude axis: a picture without a signal (a group's median level) is left out.
        const signals = overlay.layers.some(layer => layer.view.waveform);
        for (const layer of overlay.layers) {
            const values = layer.view.values ?? [];
            if (layer.view.kind === 'heatmap' || layer.view.kind === 'none' || (signals && !layer.view.waveform)) continue;
            if (layer.view.waveform) {
                // The signal itself, by the track lanes' own pipeline, on the same axes.
                paintWaveformLayer(context, { left, top, width: plotWidth, height: plotHeight }, layer.view.waveform, wholeAxis, xWindow, range, layer.color, layer.width ?? 1.5);
                continue;
            }
            context.save();
            context.strokeStyle = layer.color;
            context.fillStyle = layer.color;
            context.globalAlpha = layer.alpha ?? 1;
            if (layer.view.kind === 'bar') {
                context.lineWidth = layer.width ?? (layer.filled ? 1 : 2);
                values.forEach((value, index) => {
                    if (value === null) return;
                    const x0 = xAt(layer.view.xs![index] / ratioStep), x1 = xAt(layer.view.xs![index] * ratioStep);
                    if (layer.filled) {
                        const floor = options.diff ? yAt(0) : yAt(range.min);
                        context.globalAlpha = 0.3 * (layer.alpha ?? 1);
                        context.fillRect(x0, Math.min(floor, yAt(value)), Math.max(1, x1 - x0 - 1), Math.abs(floor - yAt(value)));
                        context.globalAlpha = layer.alpha ?? 1;
                    }
                    context.beginPath(); context.moveTo(x0, yAt(value)); context.lineTo(x1 - 1, yAt(value)); context.stroke();
                });
            } else {
                context.lineWidth = layer.width ?? 1.5;
                context.beginPath();
                let drawing = false;
                values.forEach((value, index) => {
                    if (value === null || value <= -250) { drawing = false; return; }
                    const x = xAt(layer.view.xs![index]), y = yAt(value);
                    if (drawing) context.lineTo(x, y); else context.moveTo(x, y);
                    drawing = true;
                });
                context.stroke();
            }
            context.restore();
        }
        context.restore();
    }
    // The frequency or time axis: ticks along the bottom, its name at the right end.
    context.fillStyle = muted;
    context.strokeStyle = line;
    context.lineWidth = 1;
    for (const value of ticks(xAxis.low, xAxis.high, xAxis.log)) {
        const x = xAt(value);
        if (!heatmap) { context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + plotHeight); context.stroke(); }
        context.fillText(tickText(value, xAxis.log), x - 6, height - 3);
    }
    if (options.region) paintRegion(context, options.region, view, { left, top, width: plotWidth, height: plotHeight }, xAt, { muted, text });
    context.fillStyle = text;
    context.fillText(axes.x, left + plotWidth - context.measureText(axes.x).width, height - 3);
    // The level axis says what it measures, written up the left edge, in the text colour.
    context.save();
    context.translate(10, top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = 'center';
    context.fillText(axes.y, 0, 0);
    context.restore();
}


/** The region on a plot, in neutral colours (the role colours are the files'): see StagePaintOptions.region. */
function paintRegion(context: CanvasRenderingContext2D, region: NonNullable<StagePaintOptions['region']>, view: StageView, plot: { left: number; top: number; width: number; height: number }, xAt: (value: number) => number, colors: { muted: string; text: string }): void {
    context.save();
    context.beginPath(); context.rect(plot.left, plot.top, plot.width, plot.height); context.clip();
    if (region.mark === 'range' && view.x === 'time') {
        const a = Math.max(plot.left, Math.min(plot.left + plot.width, xAt(region.start)));
        const b = Math.max(plot.left, Math.min(plot.left + plot.width, xAt(region.end)));
        context.fillStyle = 'rgba(0, 0, 0, 0.45)';
        context.fillRect(plot.left, plot.top, a - plot.left, plot.height);
        context.fillRect(b, plot.top, plot.left + plot.width - b, plot.height);
        context.strokeStyle = colors.muted;
        context.fillStyle = colors.muted;
        context.setLineDash([4, 3]);
        for (const [x, value] of [[a, region.start], [b, region.end]] as const) {
            context.beginPath(); context.moveTo(x + 0.5, plot.top); context.lineTo(x + 0.5, plot.top + plot.height); context.stroke();
            context.fillText(`${value.toFixed(2)} s`, x + 3, plot.top + plot.height - 4);
        }
    } else if (region.mark === 'tag') {
        const width = context.measureText(region.label).width + 12;
        const x = plot.left + plot.width - width - 4, y = plot.top + 4;
        context.fillStyle = 'rgba(0, 0, 0, 0.55)';
        context.fillRect(x, y, width, 17);
        context.strokeStyle = colors.muted;
        context.strokeRect(x + 0.5, y + 0.5, width - 1, 16);
        context.fillStyle = colors.text;
        context.fillText(region.label, x + 6, y + 12);
    }
    context.restore();
}

/** The plot's margins on a pane (as paintOverlay leaves them without labels). */
export const STAGE_MARGINS: PlotMargins = { left: PANE_LEFT, top: 4, right: 4, bottom: 16 };

/** The pointer on a pane: its place on the plot, or which axis it is over. */
export function stagePlotPoint(canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>, clientX: number, clientY: number): { fx: number; fy: number; axis: 'x' | 'y' | null } {
    return plotPointIn(canvas, STAGE_MARGINS, clientX, clientY);
}
