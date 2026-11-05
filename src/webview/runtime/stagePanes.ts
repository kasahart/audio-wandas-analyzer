/**
 * The comparison's three panes for one step of the chain: the base's, the compared file's and their
 * difference, each drawn as its Frame type is (stage_view.py): a line over time, log frequency or
 * quefrency, a cross-correlation over lag, bars per band, an image over time and frequency, Bark or quefrency. The base
 * of a group (its median) and a difference are taken by the backend from the Frames' full resolution
 * (combineSource.ts) and drawn here like any picture; without one the Δ pane says why it is empty. Pure apart
 * from `paintStage`, which only draws.
 */
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { UiStrings } from '../../shared/i18n/strings';
import { BAND_CENTERS_HZ } from './entryTable';
import type { StageHeadline } from './combineSource';
import { PANE_LEFT, paneAxes, type LevelInput, type PaneRange } from './comparePanes';
import { uncalibratedUnits } from '../../shared/utils/format';
import type { NormalizedRange } from './waveformInteraction';
import { plotPointIn, type PlotMargins } from './plotInteraction';
import { nearestLine } from './plotHover';
import { paintWaveformLayer, waveformRange } from '../plot/waveformLayer';
import { drawValueAxis, fittedAxisTitle, readoutText, type AxisTick } from '../../shared/gui-core/index';
import { niceTicks } from '../../shared/utils/ticks';

/** Canvas x the level axis's turned title is centred on, in the gutter left of its tick labels. */
const AXIS_TITLE_X = 10;

export type StageStrings = Pick<UiStrings, 'axisFrequency' | 'axisTime' | 'axisTriggerTime' | 'axisBand' | 'axisBark' | 'axisQuefrency' | 'axisCepstrum' | 'axisLag' | 'axisCorrelation' | 'axisLevel' | 'axisLevelUncal' | 'axisLevelCal' | 'axisDelta' | 'dsValue' | 'axisGain' | 'axisCoherence' | 'legendHeadline' | 'legendLeak' | 'legendLine' | 'stageNoDelta' | 'stageEventCounts' | 'stageNoEvents' | 'stageMaxDelta' | 'stepNotDrawable' | 'compareLevelsAt' | 'waveRangeAxisAmplitude' | 'stagePairBase' | 'axisLoudness' | 'axisSharpness' | 'axisRoughness' | 'axisLevelOf'>;

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

/**
 * The comparison's headline for a step's picture: where base and compare differ most among the points loud
 * enough to be heard, with both their values: "1.00 kHz base −40.0 / compare −26.0 dB". `headline` is that point,
 * found in the Frames' full resolution (stage_combine.py), not in the decimated pictures.
 */
export function stageLevelsHeadline(base: StageView | null, compare: StageView | null, diff: StageView | null, headline: StageHeadline | null | undefined, strings: Pick<StageStrings, 'stageNoDelta' | 'compareLevelsAt'> & Partial<Pick<StageStrings, 'stageEventCounts'>>): string {
    // A trigger's events: how many each found, which is what tells the recordings apart first.
    if (strings.stageEventCounts && (isEventsView(base) || isEventsView(compare))) return strings.stageEventCounts.replace('{base}', base?.events ? String(base.events.length) : '—').replace('{compare}', compare?.events ? String(compare.events.length) : '—');
    if (!base || !compare || !diff || !headline) return strings.stageNoDelta;
    const shown = (value: number | null): string => (value === null ? '—' : Math.abs(value) >= 10 ? value.toFixed(1).replace(/^-/, '−') : value.toPrecision(3).replace(/^-/, '−'));
    return strings.compareLevelsAt.replace('{at}', atValue(diff, headline.x, headline.y)).replace('{base}', shown(headline.base)).replace('{compare}', shown(headline.compare))
        + (isDb(base) ? ' dB' : '');
}

/**
 * A trigger's events (or a step after it that keeps them): a group's median of them has no event lines of its
 * own, but it is still events, compared overlaid with no difference, over the time from the trigger.
 */
export function isEventsView(view: StageView | null | undefined): boolean {
    return !!view?.events || /Segments$/.test(view?.frame ?? '');
}

/** What an empty plot says: a trigger that found no event says so (and what to do), else that the step is not drawn. */
export function emptyStageText(strings: Pick<StageStrings, 'stepNotDrawable' | 'stageNoEvents'>, picture: StageView | null | undefined): string {
    return picture?.events ? strings.stageNoEvents : strings.stepNotDrawable.replace('{frame}', picture?.frame ?? '');
}

function points(view: StageView): Array<number | null> {
    const skip = skipsFirst(view) ? 1 : 0;
    // A trigger's events are each drawn: the range holds every one of them.
    if (view.events) return view.events.flatMap(event => event.values);
    return view.matrix ? view.matrix.slice(skip).flat() : (view.values ?? []).slice(skip);
}

/**
 * A layer of a trigger's events as one layer per event, in its colour and thinner, each named by its event (from 1,
 * as the tracks number them): the lines are drawn and read under the pointer like any other.
 */
export function eventLayers(layer: StageLayer): StageLayer[] {
    const events = layer.view.events;
    if (!events) return [layer];
    const { events: _events, ...view } = layer.view;
    const { source, excluded: _excluded, ...rest } = layer;
    return events.map(event => {
        // One left out is drawn faint, and stays to be clicked back.
        const out = !!layer.excluded?.includes(event.id);
        // Where in the recording it was cut (its trigger): the plot's time is from the trigger.
        const at = Number.isFinite(event.time) ? ` @ ${event.time.toFixed(2)} s` : '';
        return { ...rest, view: { ...view, values: event.values }, width: Math.min(layer.width ?? 1.5, 1.2), alpha: out ? 0.25 : 0.85, label: `${layer.label ? `${layer.label} ` : ''}#${event.id + 1}${at}`, ...(source !== undefined ? { event: { id: event.id, source, out } } : {}) };
    });
}

/** A silent stretch at the floor (−300 dB) is drawn as a gap; a plain value (a trigger's events' amplitudes) has no floor. */
const silent = (view: StageView, value: number): boolean => value <= -250 && view.quantity !== 'value';

function extent(views: ReadonlyArray<StageView | null>): { low: number; high: number } {
    let low = Infinity, high = -Infinity;
    for (const view of views) {
        if (!view) continue;
        for (const value of points(view)) {
            // Silent stretches sit at the floor (−300 dB): they would squash every other level into one line.
            if (value === null || !Number.isFinite(value) || silent(view, value)) continue;
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
    if (!Number.isFinite(high)) return quantity === 'coherence' ? { min: 0, max: 1 } : quantity === 'cepstrum' || quantity === 'correlation' ? { min: -1, max: 1 } : { min: -100, max: 0 };
    if (quantity === 'coherence') return { min: 0, max: 1 };
    // A normalized correlation coefficient lies in [-1, 1].
    if (quantity === 'correlation') return { min: -1, max: 1 };
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
export function stageAxes(strings: StageStrings, view: StageView | null, input: LevelInput | undefined, diff = false): StageAxes {
    const x = isEventsView(view) ? strings.axisTriggerTime : view?.x === 'time' ? strings.axisTime : view?.x === 'band' ? strings.axisBand : view?.x === 'quefrency' ? strings.axisQuefrency : view?.x === 'lag' ? strings.axisLag : strings.axisFrequency;
    if (view?.kind === 'heatmap') return { x, y: view.yAxis === 'bark' ? strings.axisBark : view.yAxis === 'quefrency' ? strings.axisQuefrency : strings.axisFrequency };
    if (diff && (!view || isDb(view))) return { x, y: strings.axisDelta };
    // A time signal is drawn as itself: its amplitude, in its unit (full scale, or raw input units without one, while uncalibrated).
    if (view?.waveform) return { x, y: `${strings.waveRangeAxisAmplitude} [${view.waveform.unit || uncalibratedUnits(!input || input.fullScale).linear}]` };
    // A trigger's events are their signals: amplitude in the signal's unit, as a waveform's.
    if (isEventsView(view)) return { x, y: `${strings.waveRangeAxisAmplitude} [${view?.unit || uncalibratedUnits(!input || input.fullScale).linear}]` };
    const unit = view?.unit ? ` [${view.unit}]` : '';
    const y = view?.quantity === 'level' ? paneAxes(strings, input).level.y
        : view?.quantity === 'gain' ? strings.axisGain
            : view?.quantity === 'coherence' ? strings.axisCoherence
                : view?.quantity === 'cepstrum' ? strings.axisCepstrum
                    : view?.quantity === 'correlation' ? strings.axisCorrelation
                    : `${metricName(strings, view?.unit)}${unit}`;
    // A cross-channel Frame names its pair: which channel over which reference, or the recording over the base slot's.
    const pair = view?.pair?.base ? ` · ${strings.stagePairBase}` : view?.pair ? ` · ch${view.pair.output} / ch${view.pair.input}` : '';
    return { x, y: diff ? `Δ ${y}${pair}` : `${y}${pair}` };
}

/** What a metric over time measures, named by its unit (stage_view.METRIC_SERIES_UNITS); a value otherwise. */
function metricName(strings: StageStrings, unit: string | undefined): string {
    if (unit === 'sone') return strings.axisLoudness;
    if (unit === 'acum') return strings.axisSharpness;
    if (unit === 'asper') return strings.axisRoughness;
    if (unit?.startsWith('dB')) return strings.axisLevelOf;
    return strings.dsValue;
}

const hz = (value: number): string => (value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz` : `${Math.round(value)} Hz`);
/** A signed difference: dB to a tenth with its unit, other values to three significant digits. */
const signed = (value: number, db = true): string => `${value >= 0 ? '+' : '−'}${db ? `${Math.abs(value).toFixed(1)} dB` : Math.abs(value).toPrecision(3)}`;
const quefrency = (seconds: number): string => `${(seconds * 1000).toFixed(seconds < 0.01 ? 2 : 1)} ms`;
/**
 * A signed lag: the output channel later than the input when positive. To 10 µs at any lag (a sample at 96 kHz,
 * since a delay is read sample by sample), and no sign on none.
 */
const lag = (seconds: number): string => {
    const ms = (Math.abs(seconds) * 1000).toFixed(2);
    return `${Number(ms) === 0 ? '' : seconds > 0 ? '+' : '−'}${ms} ms`;
};

/** Where along its axis a point of the picture is, for the readout and the headline. */
function atText(view: StageView, index: number, row?: number): string {
    return atValue(view, view.xs?.[index] ?? 0, row === undefined ? undefined : view.ys?.[row] ?? 0);
}

/** A point of `view`'s axes in their units: "1.00 kHz", "1.00 s · 100 Hz". */
function atValue(view: StageView, x: number, y?: number): string {
    const along = view.x === 'time' ? `${x.toFixed(2)} s` : view.x === 'quefrency' ? quefrency(x) : view.x === 'lag' ? lag(x) : hz(x);
    if (y === undefined) return along;
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
export function axisFractionOf(view: Pick<StageView, 'xs' | 'xScale' | 'xLimits'>, value: number): number { return axisScale(view).fraction(value); }
export function axisValueAt(view: Pick<StageView, 'xs' | 'xScale' | 'xLimits'>, fraction: number): number { return axisScale(view).at(fraction); }
/**
 * Overlaid lines in drawing order by level over the shown part of the axis: the loudest first, the quietest last on
 * top, so a louder recording does not cover a quieter one. Its level is the power mean of the dB values on screen (a
 * waveform's level over time, a spectrum's bins). Lines not in dB, or with nothing on screen, keep their place
 * among themselves after the rest; the colours and the legend are not changed.
 */
export function byLevel(layers: StageLayer[], axisView: Pick<StageView, 'xs' | 'xScale' | 'xLimits'> | undefined, window: NormalizedRange = FULL_WINDOW): StageLayer[] {
    const scale = axisView?.xs?.length ? axisScale(axisView) : null;
    const level = (layer: StageLayer): number => {
        const { view } = layer;
        if (!view.waveform && view.quantity !== 'level' && view.quantity !== 'gain') return -Infinity;
        const xs = view.xs ?? [], values = view.values ?? [];
        let power = 0, count = 0;
        values.forEach((value, index) => {
            if (value === null || !Number.isFinite(value) || value <= -250) return;
            const at = scale && xs[index] !== undefined ? scale.fraction(xs[index]) : 0.5;
            if (at < window.start || at > window.end) return;
            power += 10 ** (value / 10); count += 1;
        });
        return count ? 10 * Math.log10(power / count) : -Infinity;
    };
    return layers.map((layer, index) => ({ layer, index, level: level(layer) }))
        .sort((a, b) => (b.level === a.level ? a.index - b.index : b.level - a.level))
        .map(item => item.layer);
}
/** The same for a heatmap's rows (frequency, Bark or quefrency). */
export function rowFractionOf(view: StageView, value: number): number { return rowScale(view).fraction(value); }
export function rowValueAt(view: StageView, fraction: number): number { return rowScale(view).at(fraction); }
const rowScale = (view: StageView): AxisScale => axisScale({ xs: view.ys, xScale: view.yAxis === 'frequency' ? 'log' : 'linear' });

/**
 * A log axis spans its stated limits (a spectrum drawn as its own bins), or else the edges of its geometric points;
 * a linear one its first to last point.
 */
function axisScale(view: Pick<StageView, 'xs' | 'xScale' | 'xLimits'>): { low: number; high: number; log: boolean; fraction(value: number): number; at(fraction: number): number } {
    const xs = view.xs ?? [];
    const log = view.xScale === 'log' && xs.length > 1 && xs[0] > 0;
    if (log) {
        const ratio = Math.sqrt(xs[1] / xs[0]);
        const limits = view.xLimits;
        const stated = limits?.length === 2 && limits[0] > 0 && limits[1] > limits[0];
        const low = stated ? limits[0] : xs[0] / ratio, high = stated ? limits[1] : xs[xs.length - 1] * ratio;
        return { low, high, log, fraction: value => Math.log(value / low) / Math.log(high / low), at: fraction => low * (high / low) ** fraction };
    }
    const low = xs[0] ?? 0, high = xs.length > 1 ? xs[xs.length - 1] : low + 1;
    return { low, high, log, fraction: value => (value - low) / (high - low || 1), at: fraction => low + fraction * (high - low) };
}

function ticks(low: number, high: number, log: boolean): number[] {
    if (log) return [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(value => value > low * 1.05 && value < high * 0.95);
    return niceTicks(low, high, 8);
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
    /** What the readout calls it while the pointer is on it (the legend's name). */
    label?: string;
    /** The recording a trigger's events are of, whose events a click leaves out (or puts back), and those left out. */
    source?: string;
    excluded?: readonly number[];
    /** One event of `source` (eventLayers'), and whether it is left out. */
    event?: { id: number; source: string; out: boolean };
}

/**
 * Where a pane put its lines, for the pointer (plotHover.ts): the plot's frame on the canvas (CSS pixels), the
 * axes' values to pixels, and the pictures drawn as lines or steps (not a signal drawn as itself, nor an image).
 */
export interface StagePlot {
    frame: { left: number; top: number; width: number; height: number };
    xAt: (value: number) => number;
    yAt: (value: number) => number;
    /** A band's half width as a ratio of its centre, for steps. */
    ratioStep: number;
    lines: StageLayer[];
    diff: boolean;
    /**
     * Where `lines` holds signals drawn as themselves: the readout's unit for a signal without one (uncalibrated),
     * and the signal drawn again at another width (the hover's thicker line).
     */
    signal?: { unit: string; range?: { min: number; max: number }; paint(context: CanvasRenderingContext2D, layer: StageLayer, width: number): void };
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
    /**
     * A Δ figure's 1/3-octave Δ per band as steps under the curve: the headline's bands filled, a peak's
     * same-signed neighbours (its leak through the band filters) outlined, the rest faint; `legend` names them.
     */
    bandSteps?: { deltas: readonly (number | null)[]; headline: readonly number[]; color: string; legend?: { headline: string; leak: string; line: string } };
    /**
     * The pictures still being computed: `label` (the files done of all) and a bar of `done` / `total`, in the
     * middle of the pane while nothing is drawn, in its top right corner once some lines are in.
     */
    pending?: { done: number; total: number; label: string };
}

/**
 * `text` broken into lines no wider than `maxWidth` (by `measure`): at spaces where there are any, else between
 * characters (Japanese has no spaces). A word wider than the line is broken between its characters.
 */
export function wrapLines(text: string, maxWidth: number, measure: (part: string) => number): string[] {
    const lines: string[] = [];
    let current = '';
    // Words with the space before them kept, and each CJK character a word of its own.
    const words = text.match(/\s*[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]|\s*[^\s\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]+|\s+$/gu) ?? [text];
    for (const word of words) {
        if (measure(current + word) <= maxWidth || !current.trim()) current += word;
        else {
            lines.push(current.trim());
            current = word.trimStart();
        }
        // A word wider than the line: its characters go on as many lines as they take.
        while (measure(current) > maxWidth && current.length > 1) {
            let cut = current.length - 1;
            while (cut > 1 && measure(current.slice(0, cut)) > maxWidth) cut--;
            lines.push(current.slice(0, cut).trim());
            current = current.slice(cut);
        }
    }
    if (current.trim()) lines.push(current.trim());
    return lines.length ? lines : [''];
}

/** One picture on its own: the base, the compared file or their difference. */
export function paintStage(canvas: HTMLCanvasElement, view: StageView | null, range: PaneRange, color: string, axes: StageAxes, options: StagePaintOptions = {}): StagePlot | null {
    return paintOverlay(canvas, { layers: view ? [{ view, color, filled: true }] : [] }, range, axes, options);
}

/**
 * Draws one pane: the overlay's pictures within `range` (the level axis, or a heatmap's colours), with tick
 * numbers on both axes and the axes' names. `diff` draws a zero line and colours a heatmap green (compare
 * louder) and grey (quieter). Without a picture it says `empty` in the middle of the pane. Returns where its lines
 * are, for the pointer (null when nothing is drawn).
 */
export function paintOverlay(canvas: HTMLCanvasElement, overlay: StageOverlay, range: PaneRange, axes: StageAxes, options: StagePaintOptions = {}): StagePlot | null {
    const ratio = options.size ? 1 : canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const width = options.size?.width ?? (canvas.clientWidth || 600), height = options.size?.height ?? (canvas.clientHeight || 120);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return null;
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
    const layers = overlay.layers.flatMap(eventLayers);
    const view = layers.find(layer => layer.view.kind !== 'none' && layer.view.xs?.length)?.view;
    // Neutral: blue and the other colours are the roles'.
    const pendingColors = { muted, line, fill: text, back: style?.getPropertyValue('--track-bg').trim() || '#0b0d10' };
    if (!view) {
        if (options.pending) paintPending(context, options.pending, left + plotWidth / 2, top + plotHeight / 2, 'center', pendingColors);
        else if (options.empty) {
            // Across the whole pane (no axes are drawn), wrapped to its width: a narrow screen keeps every word.
            context.fillStyle = muted;
            context.textAlign = 'center';
            const lines = wrapLines(options.empty, Math.max(40, width - 16), part => context.measureText(part).width);
            const step = 13;
            const first = top + plotHeight / 2 - ((lines.length - 1) * step) / 2;
            lines.forEach((part, index) => context.fillText(part, width / 2, first + index * step));
            context.textAlign = 'start';
        }
        return null;
    }
    const xWindow = options.window?.x ?? FULL_WINDOW;
    const whole = options.axisView ?? view;
    const xAxis = windowed(axisScale(whole), xWindow);
    // Zoomed, the pictures run past the plot's edges: they are clipped to it.
    const xAt = (value: number): number => left + xAxis.fraction(value) * plotWidth;
    const heatmap = view.kind === 'heatmap';
    const yAxis = heatmap ? windowed(rowScale(whole), options.window?.y) : null;
    const yAt = (value: number): number => top + (1 - (Math.max(range.min, Math.min(range.max, value)) - range.min) / (range.max - range.min)) * plotHeight;

    let levelTicks: AxisTick[] = [];
    const plot: StagePlot = { frame: { left, top, width: plotWidth, height: plotHeight }, xAt, yAt, ratioStep: 1.12, lines: [], diff: !!options.diff };
    if (heatmap && yAxis && view.matrix) {
        const image = context.createImageData(Math.round(plotWidth * ratio), Math.round(plotHeight * ratio));
        const extentAbs = Math.max(Math.abs(range.min), Math.abs(range.max), 1e-9);
        // Which row and column each pixel shows (the nearest; none past the picture's ends), worked out once per
        // line, not per pixel, from the axes' values: a detail picture covers only part of them.
        const ys = view.ys ?? [], xs = view.xs ?? [];
        const rowOf = Array.from({ length: image.height }, (_, py) => nearestIndex(ys, yAxis.at(1 - (py + 0.5) / image.height), yAxis.log));
        const columnOf = Array.from({ length: image.width }, (_, px) => nearestIndex(xs, xAxis.at((px + 0.5) / image.width), false));
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
        levelTicks = ticks(yAxis.low, yAxis.high, yAxis.log).map(value => ({ text: tickText(value, yAxis.log), fraction: yAxis.fraction(value) }));
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
        for (const value of niceTicks(range.min, range.max, 4)) {
            context.beginPath(); context.moveTo(left, yAt(value)); context.lineTo(left + plotWidth, yAt(value)); context.stroke();
            levelTicks.push({ text: levelText(value, range.max - range.min), fraction: (value - range.min) / (range.max - range.min) });
        }
        if (options.diff) {
            context.strokeStyle = muted;
            context.beginPath(); context.moveTo(left, yAt(0)); context.lineTo(left + plotWidth, yAt(0)); context.stroke();
        }
        const bars = view.kind === 'bar';
        const barXs = view.xs ?? [];
        const ratioStep = bars && barXs.length > 1 ? Math.sqrt(barXs[1] / barXs[0]) : 1.12;
        plot.ratioStep = ratioStep;
        context.save();
        context.beginPath(); context.rect(left, top, plotWidth, plotHeight); context.clip();
        if (options.bandSteps) paintBandSteps(context, options.bandSteps, xAt, yAt);
        const wholeAxis = axisScale(whole);
        // Signals drawn as themselves share an amplitude axis: a picture without a signal (a group's median level) is left out.
        const signals = layers.some(layer => layer.view.waveform);
        for (const layer of layers) {
            const values = layer.view.values ?? [];
            const xs = layer.view.xs ?? [];
            if (layer.view.kind === 'heatmap' || layer.view.kind === 'none' || (signals && !layer.view.waveform)) continue;
            if (layer.view.waveform) {
                // The signal itself, by the track lanes' own pipeline, on the same axes; the pointer picks it as a line.
                const box = { left, top, width: plotWidth, height: plotHeight };
                plot.signal ??= {
                    // An uncalibrated signal's unit: the axis names it when the axis's own signal is uncalibrated, else full scale.
                    unit: (!layer.view.waveform.unit && /\[([^\]]*)\]$/.exec(axes.y)?.[1]) || uncalibratedUnits(true).linear,
                    range,
                    paint: (ctx, signal, lineWidth) => { if (signal.view.waveform) paintWaveformLayer(ctx, box, signal.view.waveform, wholeAxis, xWindow, range, signal.color, lineWidth); },
                };
                plot.signal.paint(context, layer, layer.width ?? 1.5);
                plot.lines.push(layer);
                continue;
            }
            plot.lines.push(layer);
            context.save();
            context.fillStyle = layer.color;
            context.globalAlpha = layer.alpha ?? 1;
            if (layer.view.kind === 'bar' && layer.filled) {
                const floor = options.diff ? yAt(0) : yAt(range.min);
                context.globalAlpha = 0.3 * (layer.alpha ?? 1);
                values.forEach((value, index) => {
                    if (value === null) return;
                    const x0 = xAt(xs[index] / ratioStep), x1 = xAt(xs[index] * ratioStep);
                    context.fillRect(x0, Math.min(floor, yAt(value)), Math.max(1, x1 - x0 - 1), Math.abs(floor - yAt(value)));
                });
                context.globalAlpha = layer.alpha ?? 1;
            }
            strokeStageLine(context, plot, layer, layer.width ?? (layer.view.kind !== 'bar' ? 1.5 : layer.filled ? 1 : 2));
            context.restore();
        }
        context.restore();
    }
    // The frequency or time axis: ticks along the bottom, its name at the right end; a tick label the name would
    // overlap is left out (its gridline stays).
    const xTitle = fittedAxisTitle(axes.x, plotWidth / 2, title => context.measureText(title).width);
    const xTitleLeft = left + plotWidth - context.measureText(xTitle).width;
    context.fillStyle = muted;
    context.strokeStyle = line;
    context.lineWidth = 1;
    for (const value of ticks(xAxis.low, xAxis.high, xAxis.log)) {
        const x = xAt(value), label = tickText(value, xAxis.log);
        if (!heatmap) { context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + plotHeight); context.stroke(); }
        if (x - 6 + context.measureText(label).width < xTitleLeft - 4) context.fillText(label, x - 6, height - 3);
    }
    if (options.region) paintRegion(context, options.region, view, { left, top, width: plotWidth, height: plotHeight }, xAt, { muted, text });
    if (options.bandSteps?.legend) paintBandLegend(context, options.bandSteps.legend, options.bandSteps.color, left + plotWidth - 6, top, muted);
    context.fillStyle = text;
    context.fillText(xTitle, xTitleLeft, height - 3);
    // The level axis: its ticks in the muted colour, and what it measures up the left edge in the text colour.
    const frame = { left, top, width: plotWidth, height: plotHeight };
    drawValueAxis(context, frame, levelTicks, '', { color: muted, font: context.font, titleX: AXIS_TITLE_X });
    drawValueAxis(context, frame, [], axes.y, { color: text, font: context.font, titleX: AXIS_TITLE_X });
    // Under the region's corner tag when there is one.
    if (options.pending) paintPending(context, options.pending, left + plotWidth - 6, top + (options.region?.mark === 'tag' ? 38 : 12), 'right', pendingColors);
    return plot;
}

/** One picture of a pane as its line (or its bands as steps), `width` wide, clipped to the plot. */
export function strokeStageLine(context: CanvasRenderingContext2D, plot: StagePlot, layer: StageLayer, width: number): void {
    if (layer.view.waveform) { plot.signal?.paint(context, layer, width); return; }
    const { xAt, yAt, ratioStep, frame } = plot;
    const values = layer.view.values ?? [], xs = layer.view.xs ?? [];
    context.save();
    context.beginPath(); context.rect(frame.left, frame.top, frame.width, frame.height); context.clip();
    context.strokeStyle = layer.color;
    context.globalAlpha = layer.alpha ?? 1;
    context.lineWidth = width;
    if (layer.view.kind === 'bar') {
        values.forEach((value, index) => {
            if (value === null) return;
            const x0 = xAt(xs[index] / ratioStep), x1 = xAt(xs[index] * ratioStep);
            context.beginPath(); context.moveTo(x0, yAt(value)); context.lineTo(x1 - 1, yAt(value)); context.stroke();
        });
    } else {
        context.beginPath();
        // A point between two gaps (a bucket's peak beside silent nulls) is drawn as a pixel-wide dash.
        let run = 0, lastX = 0, lastY = 0;
        const closeRun = (): void => { if (run === 1) context.lineTo(lastX + 1, lastY); run = 0; };
        values.forEach((value, index) => {
            if (value === null || silent(layer.view, value)) { closeRun(); return; }
            const x = xAt(xs[index]), y = yAt(value);
            if (run) context.lineTo(x, y); else context.moveTo(x, y);
            run += 1; lastX = x; lastY = y;
        });
        closeRun();
        context.stroke();
    }
    context.restore();
}

/**
 * A signal's point under the pointer at (`x`, `y`): of what its envelope draws in the pixel column at `x` (the
 * buckets in it, or the nearest one zoomed past single buckets), its lowest or highest point, whichever is nearer
 * `y`; null past its ends.
 */
function signalPointAt(plot: StagePlot, waveform: NonNullable<StageView['waveform']>, x: number, y: number): { index: number; time: number; x: number; y: number; value: number } | null {
    const { min, max, minT, maxT } = waveform;
    const timeOf = (index: number): number => ((minT[index] ?? maxT[index] ?? 0) + (maxT[index] ?? minT[index] ?? 0)) / 2;
    const n = Math.min(min.length, max.length, minT.length, maxT.length);
    // The envelope's ends as drawn: the first bucket's earlier time, the last one's later time.
    const start = Math.min(minT[0] ?? Infinity, maxT[0] ?? Infinity), end = Math.max(minT[n - 1] ?? -Infinity, maxT[n - 1] ?? -Infinity);
    if (!n || x < plot.xAt(start) - 0.5 || x > plot.xAt(end) + 0.5) return null;
    let low = 0, high = n - 1;
    while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (plot.xAt(timeOf(middle)) <= x) low = middle; else high = middle;
    }
    const nearest = Math.abs(plot.xAt(timeOf(high)) - x) < Math.abs(plot.xAt(timeOf(low)) - x) ? high : low;
    let best: { time: number; value: number } | null = null;
    // As the painter draws them: a missing value at 0, a missing time at the bucket's other one.
    const consider = (raw: number | null, time: number): void => {
        const value = raw ?? 0;
        // A point clipped off the plot (zoomed into part of the amplitude) is not on screen to pick.
        const shown = plot.signal?.range;
        if (shown && (value < shown.min || value > shown.max)) return;
        if (!best || Math.abs(plot.yAt(value) - y) < Math.abs(plot.yAt(best.value) - y)) best = { time, value };
    };
    const column = (index: number): boolean => Math.abs(plot.xAt(timeOf(index)) - x) <= 0.5;
    let first = nearest, last = nearest;
    while (first > 0 && column(first - 1)) first--;
    while (last < n - 1 && column(last + 1)) last++;
    for (let index = first; index <= last; index++) { consider(min[index], minT[index] ?? timeOf(index)); consider(max[index], maxT[index] ?? timeOf(index)); }
    const found = best as { time: number; value: number } | null;
    if (!found) return null;
    // A point off the plot (zoomed between two samples) keeps its cursor at the plot's edge.
    const at = Math.max(plot.frame.left, Math.min(plot.frame.left + plot.frame.width, plot.xAt(found.time)));
    return { index: -1, time: found.time, x: at, y: plot.yAt(found.value), value: found.value };
}

/** A time to the digits a pixel column of the plot tells apart (at least 10 ms). */
function timeText(plot: StagePlot, seconds: number): string {
    const perPixel = Math.abs(plot.xAt(1) - plot.xAt(0)) > 0 ? 1 / Math.abs(plot.xAt(1) - plot.xAt(0)) : 0.01;
    const digits = Math.max(2, Math.min(6, Math.ceil(-Math.log10(Math.max(perPixel, 1e-6)))));
    return `${seconds.toFixed(digits).replace(/^-/, '−')} s`;
}

/** A line's point nearest across to `x` (canvas CSS pixels): its index and where it is drawn; null where it has no value. */
function linePointAt(plot: StagePlot, layer: StageLayer, x: number): { index: number; x: number; y: number; value: number } | null {
    const xs = layer.view.xs ?? [], values = layer.view.values ?? [];
    if (!xs.length) return null;
    let low = 0, high = xs.length - 1;
    while (high - low > 1) {
        const middle = (low + high) >> 1;
        if (plot.xAt(xs[middle]) <= x) low = middle; else high = middle;
    }
    // A band is the one whose step the pointer is over (its centre may be off the plot, zoomed into part of it).
    const inBand = (index: number): boolean => x >= plot.xAt(xs[index] / plot.ratioStep) && x <= plot.xAt(xs[index] * plot.ratioStep);
    // Past a line's ends, or beside the bands, the pointer is over no point of it.
    if (layer.view.kind === 'bar' ? !inBand(low) && !inBand(high) : x < plot.xAt(xs[0]) || x > plot.xAt(xs[xs.length - 1])) return null;
    const index = layer.view.kind === 'bar' ? (inBand(high) ? high : low)
        : Math.abs(plot.xAt(xs[high]) - x) < Math.abs(plot.xAt(xs[low]) - x) ? high : low;
    const value = values[index];
    if (value === null || value === undefined || silent(layer.view, value)) return null;
    // A point off the plot (zoomed between two points) keeps its cursor at the plot's edge.
    const at = Math.max(plot.frame.left, Math.min(plot.frame.left + plot.frame.width, plot.xAt(xs[index])));
    return { index, x: at, y: plot.yAt(value), value };
}

/**
 * The line of a pane nearest the pointer at (`x`, `y`) on its canvas, as the spectrum overlay picks it
 * (plotHover.ts): that line, its point and the readout (its name, where, its value).
 */
export function stageHover(plot: StagePlot, x: number, y: number): { layer: StageLayer; x: number; y: number; text: string } | null {
    type Point = { index: number; time?: number; x: number; y: number; value: number };
    const hit = nearestLine<StageLayer, Point>(plot.lines, layer => (layer.view.waveform ? signalPointAt(plot, layer.view.waveform, x, y) : linePointAt(plot, layer, x)), y);
    if (!hit) return null;
    const view = hit.s.view;
    if (view.waveform) {
        // A signal reads its amplitude in its unit, to 3 figures, where its point is.
        const value = hit.point.value, unit = view.waveform.unit || plot.signal?.unit;
        const amount = `${(Math.abs(value) >= 10 ? value.toFixed(1) : value.toPrecision(3)).replace(/^-/, '−')}${unit ? ` ${unit}` : ''}`;
        return { layer: hit.s, x: hit.point.x, y: hit.point.y, text: readoutText([...(hit.s.label ? [hit.s.label] : []), timeText(plot, hit.point.time ?? 0), amount]) };
    }
    const amount = plot.diff ? signed(hit.point.value, isDb(view))
        // Levels to 0.1 dB, as the spectrum overlay reads them; other quantities (a coherence) to 3 figures.
        : (isDb(view) ? `${hit.point.value.toFixed(1)} dB` : Math.abs(hit.point.value) >= 10 ? hit.point.value.toFixed(1) : hit.point.value.toPrecision(3)).replace(/^-/, '−');
    return { layer: hit.s, x: hit.point.x, y: hit.point.y, text: readoutText([...(hit.s.label ? [hit.s.label] : plot.diff ? ['Δ'] : []), atText(view, hit.point.index), amount]) };
}

/**
 * "Computing 3 / 12" over a thin bar filled to the part done, centred at (x, y) or ending at x (`right`, over the
 * lines: on a backing of the plot's background).
 */
function paintPending(context: CanvasRenderingContext2D, pending: { done: number; total: number; label: string }, x: number, y: number, align: 'center' | 'right', colors: { muted: string; line: string; fill: string; back: string }): void {
    context.save();
    context.font = '12px sans-serif';
    const barWidth = Math.max(96, context.measureText(pending.label).width);
    const left = align === 'center' ? x - barWidth / 2 : x - barWidth;
    if (align === 'right') {
        context.fillStyle = colors.back;
        context.fillRect(left - 4, y - 12, barWidth + 8, 26);
    }
    context.fillStyle = colors.muted;
    context.textAlign = align;
    context.fillText(pending.label, x, y);
    context.fillStyle = colors.line;
    context.fillRect(left, y + 6, barWidth, 4);
    context.fillStyle = colors.fill;
    context.fillRect(left, y + 6, barWidth * Math.min(1, pending.done / Math.max(1, pending.total)), 4);
    context.restore();
}


/** A Δ figure's band steps (see StagePaintOptions.bandSteps), on the plot's frequency axis. */
function paintBandSteps(context: CanvasRenderingContext2D, steps: NonNullable<StagePaintOptions['bandSteps']>, xAt: (hz: number) => number, yAt: (value: number) => number): void {
    const { deltas, headline } = steps;
    const leak = (band: number): boolean => [band - 1, band + 1].some(peak => headline.includes(peak)
        && Math.sign(deltas[peak] ?? 0) === Math.sign(deltas[band] ?? 0) && Math.abs(deltas[band] ?? 0) < Math.abs(deltas[peak] ?? 0));
    context.save();
    context.fillStyle = steps.color;
    context.strokeStyle = steps.color;
    deltas.forEach((delta, band) => {
        if (delta === null) return;
        const center = BAND_CENTERS_HZ[band];
        const x0 = xAt(center * 2 ** (-1 / 6)), x1 = xAt(center * 2 ** (1 / 6));
        const box: [number, number, number, number] = [x0, Math.min(yAt(0), yAt(delta)), Math.max(1, x1 - x0), Math.abs(yAt(delta) - yAt(0))];
        if (leak(band)) { context.globalAlpha = 0.6; context.setLineDash([3, 2]); context.strokeRect(...box); context.setLineDash([]); return; }
        context.globalAlpha = headline.includes(band) ? 0.45 : 0.15;
        context.fillRect(...box);
    });
    context.restore();
}

/** Top right of a Δ figure: what the curve and the two kinds of step are. */
function paintBandLegend(context: CanvasRenderingContext2D, legend: { headline: string; leak: string; line: string }, color: string, right: number, top: number, muted: string): void {
    let x = right;
    const item = (draw: (at: number) => void, label: string): void => {
        x -= context.measureText(label).width;
        context.fillStyle = muted;
        context.fillText(label, x, top + 12);
        x -= 16;
        draw(x);
        x -= 12;
    };
    context.save();
    item(at => { context.strokeStyle = color; context.lineWidth = 1.5; context.beginPath(); context.moveTo(at, top + 8); context.lineTo(at + 12, top + 8); context.stroke(); }, legend.line);
    item(at => { context.strokeStyle = color; context.lineWidth = 1; context.setLineDash([3, 2]); context.strokeRect(at, top + 3, 12, 10); context.setLineDash([]); }, legend.leak);
    item(at => { context.fillStyle = color; context.globalAlpha = 0.45; context.fillRect(at, top + 3, 12, 10); context.globalAlpha = 1; }, legend.headline);
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
