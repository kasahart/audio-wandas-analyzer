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
import { PANE_LEFT, paneAxes, type LevelInput, type PaneRange } from './comparePanes';
import { uncalibratedUnits } from '../../shared/utils/format';
import type { NormalizedRange } from './waveformInteraction';
import { plotPointIn, type PlotMargins } from './plotInteraction';
import { HOVER_PICK_RADIUS_PX, nearestPoint } from './plotHover';
import { paintWaveformLayer, waveformRange, type SignalPointSink } from '../plot/waveformLayer';
import { packRgb, paletteColour, rasterizeHeatmap, unpackRgb } from '../plot/heatmapRaster';
import { drawValueAxis, readoutText, type AxisTick, type Palette } from '../../shared/gui-core/index';
import { axisName, axisNameParts, fitAxisTitle, fontPixels, scaledFont } from '../plot/axisTitle';
import { HEATMAP_DB_SPAN, heatmapDbRange, niceRange, niceTicks } from '../../shared/utils/ticks';
import { amountText, barkText, frequencyText, lagText, levelText, quefrencyText, secondsText, signedText, withMinus } from '../plot/plotText';
import { cellIndex, NO_FULL_DATA, STEP_AHEAD, type FullPoints, type FullRead, type FullSource, type LevelAnswer } from './fullRead';

/** Canvas x the level axis's turned title is centred on, in the gutter left of its tick labels. */
const AXIS_TITLE_X = 10;

export type StageStrings = Pick<UiStrings, 'axisFrequency' | 'axisTime' | 'axisTriggerTime' | 'axisBand' | 'axisBark' | 'axisQuefrency' | 'axisCepstrum' | 'axisLag' | 'axisCorrelation' | 'axisLevel' | 'axisLevelUncal' | 'axisLevelCal' | 'axisDelta' | 'dsValue' | 'axisGain' | 'axisCoherence' | 'legendHeadline' | 'legendLeak' | 'legendLine' | 'stageNoDelta' | 'stageEventCounts' | 'stageNoEvents' | 'stageMaxDelta' | 'stepNotDrawable' | 'waveRangeAxisAmplitude' | 'stagePairBase' | 'axisLoudness' | 'axisSharpness' | 'axisRoughness' | 'axisLevelOf' | 'axisRms' | 'axisRmsTimeWeighted' | 'axisPower' | 'axisUncalibrated' | 'axisUnitUnknown'>;

const DB_QUANTITIES = ['level', 'gain'];
const isDb = (view: StageView | null): boolean => DB_QUANTITIES.includes(view?.quantity ?? '');

/**
 * A cepstrum's first coefficient (zero quefrency) is the mean log magnitude, hundreds of times the rest:
 * the ranges leave it out, as wandas' cepstrogram plot leaves it out of its colour scale.
 */
const skipsFirst = (view: StageView): boolean => view.quantity === 'cepstrum';

/** A trigger's events in the row above the plots: how many each recording found, which tells them apart first. */
export function stageEventCounts(base: StageView | null, compare: StageView | null, strings: Pick<StageStrings, 'stageEventCounts'>): string {
    return strings.stageEventCounts.replace('{base}', base?.events ? String(base.events.length) : '—').replace('{compare}', compare?.events ? String(compare.events.length) : '—');
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
 * as the tracks number them): each is its own series, at its own xs, drawn and read under the pointer like any other.
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
        const at = Number.isFinite(event.time) ? ` @ ${secondsText(event.time)}` : '';
        // Each event's line reads its own full data (R7), not the recording's.
        const full: FullRead = layer.full.event?.(event.id) ?? NO_FULL_DATA;
        return { ...rest, view: { ...view, xs: event.xs, values: event.values }, width: Math.min(layer.width ?? 1.5, 1.2), alpha: out ? 0.25 : 0.85, label: `${layer.label ? `${layer.label} ` : ''}#${event.id + 1}${at}`, ...(source !== undefined ? { event: { id: event.id, source, out } } : {}), full };
    });
}

/** A silent stretch at the floor (−300 dB) is drawn as a gap; a plain value (a trigger's events' amplitudes) has no floor. */
const silent = (view: StageView, value: number): boolean => value <= -250 && view.quantity !== 'value';

/**
 * The lowest and highest value of the pictures: each one's every full-resolution value (`valueRange`, which the
 * backend takes before any is thinned or averaged into a cell, R1), or for a picture the webview made whole (a band
 * table, a level line) the values it draws, which are all of them.
 */
function extent(views: ReadonlyArray<StageView | null>): { low: number; high: number } {
    let low = Infinity, high = -Infinity;
    for (const view of views) {
        if (!view) continue;
        if (view.valueRange) { low = Math.min(low, view.valueRange.min); high = Math.max(high, view.valueRange.max); continue; }
        for (const value of points(view)) {
            // Silent stretches sit at the floor (−300 dB): they would squash every other level into one line.
            if (value === null || !Number.isFinite(value) || silent(view, value)) continue;
            low = Math.min(low, value); high = Math.max(high, value);
        }
    }
    return { low, high };
}

/**
 * The 99th percentile of the coefficients' magnitudes, as wandas' cepstrogram plot sets its colour range: of every
 * full-resolution coefficient (`valueRange.robust`), the largest of the pictures'; of the points drawn only for a
 * picture without it.
 */
function robustEdge(views: ReadonlyArray<StageView | null>): number {
    const full = views.map(view => view?.valueRange?.robust).filter((edge): edge is number => edge !== undefined && Number.isFinite(edge));
    if (full.length && full.length === views.filter(Boolean).length) return Math.max(...full);
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
        const edge = roundEdge((first?.kind === 'heatmap' ? robustEdge(views) : Math.max(Math.abs(low), Math.abs(high)) * 1.05) || 1);
        return { min: -edge, max: edge };
    }
    if (DB_QUANTITIES.includes(quantity ?? '') && first?.kind === 'heatmap') return heatmapDbRange(low, high);
    if (DB_QUANTITIES.includes(quantity ?? '')) {
        // Every value from the loudest down to at most 100 dB under it (as a heatmap's colours): never a value of the
        // full data off the axis, each end rounded outward to the step, so at most a step of slack on each side. The
        // step is the finest round one that gives at most six steps (−49.5…−9.5 dB: 10 dB, −50…0).
        const bottom = Math.max(low, high - HEATMAP_DB_SPAN);
        const edges = (step: number): { min: number; max: number } => ({ min: Math.floor(bottom / step) * step || 0, max: Math.ceil(high / step) * step || 0 });
        const step = DB_STEPS.find(size => { const { min, max } = edges(size); return (max - min) / size <= DB_MAX_STEPS; }) ?? DB_STEPS[DB_STEPS.length - 1];
        const { min, max } = edges(step);
        return max > min ? { min, max } : { min: min - step, max };
    }
    // Any other quantity (a loudness, a roughness, an amplitude): its extent padded, to round ends, as a dB range has.
    const pad = (high - low) * 0.05 || Math.abs(high) * 0.1 || 1;
    const { low: min, high: max } = niceRange(low - pad, high + pad);
    return { min, max };
}

/** A level axis's unit, from its name ("Level [dBFS]" → "dBFS"), for the plot's level readouts; none for another axis. */
function levelUnitOf(title: string | undefined): { levelUnit?: string } {
    const unit = axisNameParts(title ?? '')?.unit;
    return unit?.startsWith('dB') ? { levelUnit: unit } : {};
}

/** A dB axis's round steps, and the most steps it takes (stageRange). */
const DB_STEPS = [5, 10, 20, 25] as const;
const DB_MAX_STEPS = 6;

/** A symmetric range's edge, widened to a round value (±0.021 → ±0.022), as niceRange widens a range's ends. */
function roundEdge(edge: number): number {
    return niceRange(-edge, edge).high;
}

/** ± an edge with whole-number quarters, for a difference in dB; ± the largest difference otherwise. */
export function stageDiffRange(view: StageView | null): PaneRange {
    const { low, high } = extent([view]);
    if (view && !isDb(view)) {
        const edge = roundEdge((Number.isFinite(high) ? Math.max(Math.abs(low), Math.abs(high)) * 1.05 : 0) || 1);
        return { min: -edge, max: edge };
    }
    let edge = 6;
    if (Number.isFinite(high)) edge = Math.max(edge, Math.abs(low), Math.abs(high));
    const unit = edge > 40 ? 20 : edge > 16 ? 8 : 4;
    const rounded = Math.ceil(edge / unit) * unit;
    return { min: -rounded, max: rounded };
}

export interface StageAxes {
    x: string;
    y: string;
    /** A heatmap's colour: what it measures, with its unit and reference (the colour bar's name). */
    colour?: string;
}

/** What each axis of a picture measures; a heatmap's y is its rows' axis, its colour the level. */
export function stageAxes(strings: StageStrings, view: StageView | null, input: LevelInput | undefined, diff = false): StageAxes {
    const x = isEventsView(view) ? strings.axisTriggerTime : view?.x === 'time' ? strings.axisTime : view?.x === 'band' ? strings.axisBand : view?.x === 'quefrency' ? strings.axisQuefrency : view?.x === 'lag' ? strings.axisLag : strings.axisFrequency;
    if (view?.kind === 'heatmap') {
        const y = view.yAxis === 'bark' ? strings.axisBark : view.yAxis === 'quefrency' ? strings.axisQuefrency : strings.axisFrequency;
        const colour = view.quantity === 'level' ? paneAxes(strings, input).level.y
            : view.quantity === 'cepstrum' ? strings.axisCepstrum
                : metricAxisName(strings, view.unit);
        return { x, y, colour: diff ? (isDb(view) ? strings.axisDelta : `Δ ${colour}`) : colour };
    }
    if (diff && (!view || isDb(view))) return { x, y: strings.axisDelta };
    // A time signal is drawn as itself: its amplitude, in its unit (full scale, or raw input units without one), and
    // says it is uncalibrated as the level axis does. After rms_trend, sound_level or power it names that measure.
    const linear = (unit: string | undefined): string => amplitudeAxisTitle(strings, unit, input, view?.measure);
    // Its Δ is compare − base sample by sample (a ChannelFrame subtraction), in the same unit.
    if (view?.waveform) return { x, y: diff ? `Δ ${linear(view.waveform.unit)}` : linear(view.waveform.unit) };
    // A trigger's events are their signals: amplitude in the signal's unit, as a waveform's.
    if (isEventsView(view)) return { x, y: linear(view?.unit) };
    // rms_trend's series is its own values (a metric's series), in the signal's unit; so is a series no step names
    // (an RMS of a power, a power to another exponent): what it is, the signal's amplitude, never a bare "value".
    if (view?.quantity === 'value' && (view.measure || (view.x === 'time' && !namedByUnit(view.unit)))) return { x, y: diff ? `Δ ${linear(view.unit)}` : linear(view.unit) };
    // A level over time (sound_level or rms_trend in dB) names what it is the level of, in the files' reference.
    if (view?.quantity === 'level' && view.x === 'time') return { x, y: timeLevelTitle(strings, input, view.measure) };
    const y = view?.quantity === 'level' ? paneAxes(strings, input).level.y
        : view?.quantity === 'gain' ? strings.axisGain
            : view?.quantity === 'coherence' ? strings.axisCoherence
                : view?.quantity === 'cepstrum' ? strings.axisCepstrum
                    : view?.quantity === 'correlation' ? strings.axisCorrelation
                    : metricAxisName(strings, view?.unit);
    // A cross-channel Frame names its pair, after its quantity and before its unit: which channel over which
    // reference, or the recording over the base slot's.
    const pair = view?.pair?.base ? ` · ${strings.stagePairBase}` : view?.pair ? ` · ch${view.pair.output} / ch${view.pair.input}` : '';
    const parts = axisNameParts(y);
    const named = parts ? axisName(`${parts.quantity}${pair}`, parts.unit) : `${y}${pair}`;
    return { x, y: diff ? `Δ ${named}` : named };
}

/**
 * A time signal's amplitude axis, in its unit (full scale, or raw input units without one), saying whether it is
 * calibrated as the level axis does; after rms_trend, sound_level or power it names that measure. Compare's waveform
 * panes and the track lanes name their amplitude axis by it.
 */
export function amplitudeAxisTitle(strings: Pick<StageStrings, 'axisRms' | 'axisRmsTimeWeighted' | 'axisPower' | 'waveRangeAxisAmplitude' | 'axisUncalibrated'>, unit: string | undefined, input: LevelInput | undefined, measure?: StageView['measure']): string {
    const name = measure === 'rms' ? strings.axisRms : measure === 'timeWeightedRms' ? strings.axisRmsTimeWeighted : measure === 'power' ? strings.axisPower : strings.waveRangeAxisAmplitude;
    const base = unit || uncalibratedUnits(!input || input.fullScale).linear;
    return `${name}${input?.calibrationStatus === 'calibrated' ? '' : strings.axisUncalibrated} [${measure === 'power' ? `${base}²` : base}]`;
}

/** Whether a metric's unit names what it measures (loudness in sone, …, a level in dB). */
function namedByUnit(unit: string | undefined): boolean {
    return unit === 'sone' || unit === 'acum' || unit === 'asper' || !!unit?.startsWith('dB');
}

/**
 * A level over time's axis: the level of an RMS over a window, of a time-weighted one, or a level, in the files'
 * reference, saying it is uncalibrated as every level axis does ("Time-weighted RMS, uncalibrated [dBFS]").
 */
function timeLevelTitle(strings: StageStrings, input: LevelInput | undefined, measure: StageView['measure']): string {
    const reference = input ?? { levelReferenceLabel: uncalibratedUnits(true).level, calibrationStatus: 'uncalibrated' };
    const name = measure === 'rms' ? strings.axisRms : measure === 'timeWeightedRms' ? strings.axisRmsTimeWeighted : strings.axisLevelOf;
    return `${name}${reference.calibrationStatus === 'calibrated' ? '' : strings.axisUncalibrated} [${reference.levelReferenceLabel}]`;
}

/** A metric's axis name: what it measures and its unit, or that its unit is not known. */
function metricAxisName(strings: StageStrings, unit: string | undefined): string {
    return axisName(metricName(strings, unit), unit || strings.axisUnitUnknown);
}

/** What a metric over time measures, named by its unit (stage_view.METRIC_SERIES_UNITS); a value otherwise. */
function metricName(strings: StageStrings, unit: string | undefined): string {
    if (unit === 'sone') return strings.axisLoudness;
    if (unit === 'acum') return strings.axisSharpness;
    if (unit === 'asper') return strings.axisRoughness;
    if (unit?.startsWith('dB')) return strings.axisLevelOf;
    // Any other value a step gives is in the signal's unit: its amplitude (the backend names no other kind).
    return strings.waveRangeAxisAmplitude;
}

const hz = frequencyText;
const signed = signedText;
const quefrency = quefrencyText;
const lag = lagText;

/** Where along its axis a point of the picture is, for the readout and the headline. */
function atText(view: StageView, index: number, row?: number): string {
    return atValue(view, view.xs?.[index] ?? 0, row === undefined ? undefined : view.ys?.[row] ?? 0, spacingAt(view.xs, index), row === undefined ? undefined : spacingAt(view.ys, row));
}

/** The gap from a point to its nearer neighbour, so a readout writes the digits that tell the two apart (R7). */
function spacingAt(values: readonly number[] | undefined, index: number): number | undefined {
    if (!values) return undefined;
    const gaps = [values[index] - values[index - 1], values[index + 1] - values[index]].map(Math.abs).filter(gap => Number.isFinite(gap) && gap > 0);
    return gaps.length ? Math.min(...gaps) : undefined;
}

/** A point of `view`'s axes in their units: "1 kHz", "1.00 s · 100 Hz". */
function atValue(view: StageView, x: number, y?: number, xStep?: number, yStep?: number): string {
    const along = view.x === 'time' ? secondsText(x) : view.x === 'quefrency' ? quefrency(x) : view.x === 'lag' ? lag(x) : hz(x, xStep);
    if (y === undefined) return along;
    return `${along} · ${view.yAxis === 'bark' ? barkText(y) : view.yAxis === 'quefrency' ? quefrency(y) : hz(y, yStep)}`;
}

/**
 * The Δ pane's headline: where the difference is largest over the part on screen, or why there is none. The place
 * and value are the backend's (`peak`, stage_combine.difference_peak), found among every value before thinning (R2):
 * never the largest of the points drawn.
 */
export function stageHeadline(diff: StageView | null, strings: Pick<StageStrings, 'stageNoDelta' | 'stageMaxDelta'>): string {
    const peak = diff?.peak;
    if (!diff || !peak) return strings.stageNoDelta;
    const at = atValue(diff, peak.x, diff.matrix ? peak.y ?? 0 : undefined, peak.xStep, peak.yStep);
    return strings.stageMaxDelta.replace('{at}', at).replace('{delta}', signed(peak.value, isDb(diff)));
}

/**
 * The edges of each cell along an axis, in its own measure (log on a log axis): halfway between neighbouring points,
 * and half the end step past each end, so a cell holds the values nearest its point.
 */
function cellEdges(axis: readonly number[], log: boolean): number[] {
    const n = axis.length;
    if (!n) return [];
    const at = (index: number): number => (log ? Math.log(Math.max(axis[index], 1e-12)) : axis[index]);
    const firstStep = n > 1 ? at(1) - at(0) : 1, lastStep = n > 1 ? at(n - 1) - at(n - 2) : 1;
    const edges = [at(0) - firstStep / 2];
    for (let index = 1; index < n; index++) edges.push((at(index - 1) + at(index)) / 2);
    edges.push(at(n - 1) + lastStep / 2);
    return edges;
}

/** The cells [first, after) that a stretch from `low` to `high` of the axis (its own measure) overlaps; null for none. */
function cellSpan(edges: readonly number[], low: number, high: number): [number, number] | null {
    const n = edges.length - 1;
    if (n < 1 || !(high > low)) return null;
    // The first cell ending past `low`, and the cells starting before `high`.
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (edges[mid + 1] <= low) lo = mid + 1; else hi = mid; }
    const first = lo;
    lo = 0; hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (edges[mid] < high) lo = mid + 1; else hi = mid; }
    return lo > first ? [first, lo] : null;
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
 * top, so a louder recording does not cover a quieter one. A line's level is the power of its every value inside the
 * part on screen (R6), from the values before the line was thinned to be drawn (R2): a signal's mean square on the
 * amplitude axis the signals share, a spectrum's power mean of its dB (screenLevels). The drawn points are never
 * measured. Lines with no level (not a level, or nothing shown) keep their place among themselves after the rest; the
 * colours and the legend are not changed.
 */
export function byLevel(layers: StageLayer[], axisView: Pick<StageView, 'xs' | 'xScale' | 'xLimits'> | undefined, window: NormalizedRange = FULL_WINDOW, levels: ReadonlyMap<StageLayer, ScreenLevel> = screenLevels(layers, axisView, window)): StageLayer[] {
    const level = (layer: StageLayer): number => levels.get(layer)?.level ?? -Infinity;
    return layers.map((layer, index) => ({ layer, index, level: level(layer) }))
        .sort((a, b) => (b.level === a.level ? a.index - b.index : b.level - a.level))
        .map(item => item.layer);
}

/**
 * A compared line's level over the part of the axis on screen (dB; −Infinity for none): 'exact' from every value
 * inside it, 'pending' while those are being fetched (`level` is then the stretches' share on screen, until they are
 * in), 'unmeasured' for a level or signal with no values before thinning to measure, 'none' for a line that is not a
 * level (it keeps its place).
 */
export interface ScreenLevel { level: number; state: 'exact' | 'pending' | 'unmeasured' | 'none' }

/**
 * Each line's ScreenLevel. A line's `levelBins` (the backend's, or levelBinsOf) give it at once while every stretch
 * holding values is wholly on screen or wholly off it; a stretch the screen's edge cuts cannot say which of its values
 * are on screen, so the line is measured from its full data instead (`full`, fullRead.ts): its drawn points when they
 * are all its points, else every value of the window, read where the data is (`ready` is called once a fetched one is
 * in). A line with no levelBins is measured so only when it says so (`measured`).
 */
export function screenLevels(layers: readonly StageLayer[], axisView: Pick<StageView, 'xs' | 'xScale' | 'xLimits'> | undefined, window: NormalizedRange = FULL_WINDOW, context: { ready?: () => void } = {}): Map<StageLayer, ScreenLevel> {
    const scale = axisView?.xs?.length ? axisScale(axisView) : null;
    const whole = window.start <= 0 && window.end >= 1;
    const dB = (sum: { power: number; count: number }): number => (sum.count && sum.power > 0 ? 10 * Math.log10(sum.power) : -Infinity);
    const levels = new Map<StageLayer, ScreenLevel>();
    for (const layer of layers) {
        const { view } = layer;
        const bins = view.levelBins;
        const signal = !!view.waveform;
        if (!bins && !layer.measured) {
            levels.set(layer, { level: -Infinity, state: isDb(view) || signal ? 'unmeasured' : 'none' });
            continue;
        }
        let estimate = -Infinity;
        if (bins) {
            let power = 0, count = 0, shownPower = 0, shownCount = 0, cut = false;
            const last = bins.count.length - 1;
            for (let index = 0; index <= last; index++) {
                const n = bins.count[index] ?? 0;
                if (!n) continue;
                const low = scale ? scale.fraction(bins.edges[index]) : 0, high = scale ? scale.fraction(bins.edges[index + 1]) : 1;
                const [from, to] = low <= high ? [low, high] : [high, low];
                const stretchPower = (bins.power[index] ?? 0) * n;
                // Its values are from its first edge up to (the last stretch: up to and with) its second.
                const inside = whole || (from >= window.start && to <= window.end);
                const outside = !whole && (from > window.end || to < window.start || (to === window.start && index < last && to > from));
                if (inside) { power += stretchPower; count += n; }
                else if (!outside) cut = true;
                // Its share on screen, the level shown while a cut line's values are fetched.
                const shown = inside ? 1 : outside ? 0 : to > from ? (Math.min(to, window.end) - Math.max(from, window.start)) / (to - from) : 1;
                shownPower += stretchPower * shown; shownCount += n * shown;
            }
            if (!cut) { levels.set(layer, { level: dB({ power: count ? power / count : 0, count }), state: 'exact' }); continue; }
            estimate = dB({ power: shownCount ? shownPower / shownCount : 0, count: shownCount });
        }
        const xs = view.xs ?? [];
        const ends: [number, number] | null = scale ? [scale.at(window.start), scale.at(window.end)] : xs.length ? [xs[0], xs[xs.length - 1]] : null;
        const full = layer.full;
        let sum: LevelAnswer = null;
        if (ends && full.level) sum = full.level({ x0: ends[0], x1: ends[1], square: signal }, context.ready ?? (() => undefined));
        levels.set(layer, sum === undefined ? { level: estimate, state: 'pending' } : sum === null ? { level: estimate, state: 'unmeasured' } : { level: dB(sum), state: 'exact' });
    }
    return levels;
}

/**
 * A line's levelBins (see byLevel) from the values it has before thinning, for a line the webview holds in full (the
 * cursor spectrum's slice): its dB values' power in `bins` stretches of `span` on its axis, silence as no power.
 */
export function levelBinsOf(xs: ArrayLike<number>, values: ArrayLike<number | null>, span: readonly [number, number], log: boolean, bins = 256): NonNullable<StageView['levelBins']> {
    const [low, high] = log ? [Math.max(span[0], Number.MIN_VALUE), span[1]] : span;
    const edges = Array.from({ length: bins + 1 }, (_, i) => (log && low > 0 && high > low ? low * (high / low) ** (i / bins) : low + (high - low) * (i / bins)));
    const power = new Array<number>(bins).fill(0), count = new Array<number>(bins).fill(0);
    for (let index = 0; index < xs.length; index++) {
        const x = xs[index], value = values[index];
        if (value === null || value === undefined || !Number.isFinite(value) || !Number.isFinite(x) || x < low || x > high || (log && x <= 0)) continue;
        const at = log ? Math.log(x / low) / Math.log(high / low) : (x - low) / (high - low || 1);
        const bin = Math.min(bins - 1, Math.max(0, Math.floor(at * bins)));
        power[bin] += value <= -250 ? 0 : 10 ** (value / 10);
        count[bin] += 1;
    }
    return { edges, power: power.map((sum, i) => (count[i] ? sum / count[i] : 0)), count };
}

/**
 * Whether a picture is a line compared with the others on its plot, and so takes part in the overlay's order (R6):
 * a line or steps, not marks (dots, a rug), filled bars, a heatmap, or a part of one picture drawn over its own
 * stretch (`span`: a lane's finer data over part of the view).
 */
const comparedLine = (layer: StageLayer): boolean =>
    (layer.view.kind === 'line' || layer.view.kind === 'bar') && !layer.marks && !layer.filled && !layer.span;

/**
 * The order a plot draws its pictures in (R6), decided here for every plot: the lines compared by byLevel, the
 * quietest last on top, in the places the lines held among the caller's pictures; every other picture keeps its own
 * place. Whatever order a caller gives its lines in, the plot draws the quietest on top, in the caller's colours.
 */
export function overlayOrder(layers: readonly StageLayer[], axisView: Pick<StageView, 'xs' | 'xScale' | 'xLimits'> | undefined, window: NormalizedRange = FULL_WINDOW, levels?: ReadonlyMap<StageLayer, ScreenLevel>): StageLayer[] {
    const places = layers.flatMap((layer, index) => (comparedLine(layer) ? [index] : []));
    if (places.length < 2) return [...layers];
    const lines = places.map(index => layers[index]);
    const ordered = byLevel(lines, axisView, window, levels ?? screenLevels(lines, axisView, window));
    const drawn = [...layers];
    places.forEach((place, index) => { drawn[place] = ordered[index]; });
    return drawn;
}

/** Who a compared line is across redraws (a redraw makes new layers): its colour, name and recording, or event. */
function lineKey(layer: StageLayer): string {
    return [layer.color, layer.label ?? '', layer.source ?? '', layer.event?.id ?? ''].join('\u0000');
}

/** Each plot's last order judged on every value on screen, by axis, as lineKey's. */
const settledOrders = new WeakMap<object, { main?: string[]; secondary?: string[] }>();

/**
 * The order a plot draws in (R6) while a line's level is still being fetched: never one guessed from part of it. The
 * order last judged on every value (its lines in those places, a line it did not hold after them, in the caller's
 * order), else the caller's own until the levels are in; once every level is in, `exact`, and that is kept.
 */
function settledOrder(canvas: object, axis: 'main' | 'secondary', layers: readonly StageLayer[], exact: StageLayer[], levels: ReadonlyMap<StageLayer, ScreenLevel>): StageLayer[] {
    const kept = settledOrders.get(canvas) ?? {};
    if (![...levels.values()].some(level => level.state === 'pending')) {
        settledOrders.set(canvas, { ...kept, [axis]: exact.filter(comparedLine).map(lineKey) });
        return exact;
    }
    const previous = kept[axis] ?? [];
    const places = layers.flatMap((layer, index) => (comparedLine(layer) ? [index] : []));
    const rank = (layer: StageLayer): number => { const at = previous.indexOf(lineKey(layer)); return at < 0 ? previous.length : at; };
    const ordered = places.map(index => layers[index]).map((layer, index) => ({ layer, index, rank: rank(layer) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index).map(item => item.layer);
    const drawn = [...layers];
    places.forEach((place, index) => { drawn[place] = ordered[index]; });
    return drawn;
}

/**
 * The levels of a plot's compared lines in the order they were drawn, as the plot writes them on its canvas
 * (`data-plot-order`) for the ui-smoke audit (canvasAudit.ts) to check on every plot shown: never rising (R6).
 */
export function drawnLevelsText(drawn: readonly StageLayer[], axisView: Pick<StageView, 'xs' | 'xScale' | 'xLimits'> | undefined, window: NormalizedRange = FULL_WINDOW, levels?: ReadonlyMap<StageLayer, ScreenLevel>): string {
    const lines = drawn.filter(comparedLine);
    if (lines.length < 2) return '';
    const measured = levels ?? screenLevels(lines, axisView, window);
    // A level (or a signal) with no values before thinning to measure could only be ordered by its drawn points:
    // written as '?', which the audit fails on every plot shown (R2, R6). One whose values are still being fetched is
    // written as '…': the audit waits for it, and fails a plot that stays so.
    return lines.map(layer => {
        const level = measured.get(layer) ?? { level: -Infinity, state: 'none' };
        if (level.state === 'unmeasured') return '?';
        if (level.state === 'pending') return '…';
        return Number.isFinite(level.level) ? level.level.toFixed(2) : '-inf';
    }).join(',');
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
    if (log) {
        const inside = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(value => value > low * 1.05 && value < high * 0.95);
        // Zoomed between two of them, the window's ends are labelled, so the axis still says where it is.
        return inside.length > 1 ? inside : [low, ...(inside.length ? inside : [Math.sqrt(low * high)]), high];
    }
    return niceTicks(low, high, 8);
}

/** The text every plot's axes are written in: Compare's panes, the entry's plots and the track lanes' axes. */
export const PLOT_TEXT_FONT = '10px sans-serif';

/** How tall a tick label is (PLOT_TEXT_FONT's size), and the least room left between two on one axis. */
export const TICK_LABEL_PX = 10;
const TICK_LABEL_GAP_PX = 2;

/**
 * Where a value axis's tick label is drawn up an axis `height` px tall, from its top: as drawValueAxis sets it, the
 * top tick hangs below the top edge, the bottom one stands on the bottom edge, the others are centred on their place.
 */
export function tickLabelSpan(fraction: number, height: number): { top: number; bottom: number } {
    const y = (1 - fraction) * height;
    if (fraction >= 1) return { top: y, bottom: y + TICK_LABEL_PX };
    if (fraction <= 0) return { top: y - TICK_LABEL_PX, bottom: y };
    return { top: y - TICK_LABEL_PX / 2, bottom: y + TICK_LABEL_PX / 2 };
}

/** Whether no two of the ticks' labels touch on an axis `height` px tall (TICK_LABEL_GAP_PX apart at least). */
export function ticksFit(ticks: readonly AxisTick[], height: number): boolean {
    if (!Number.isFinite(height)) return true;
    const spans = ticks.map(tick => tickLabelSpan(tick.fraction, height)).sort((a, b) => a.top - b.top);
    return spans.every((span, index) => index === 0 || span.top - spans[index - 1].bottom >= TICK_LABEL_GAP_PX);
}

/**
 * The ticks whose labels fit up an axis `height` px tall: from the bottom up, each one that would touch the last one
 * kept is left out (its value stays readable from its neighbours), so no two labels on one axis ever overlap.
 */
export function spacedTicks<T extends AxisTick>(ticks: readonly T[], height: number): T[] {
    const kept: T[] = [];
    for (const tick of [...ticks].sort((a, b) => a.fraction - b.fraction)) {
        if (tick.fraction < -1e-9 || tick.fraction > 1 + 1e-9) continue;
        const last = kept[kept.length - 1];
        if (!last || ticksFit([last, tick], height)) kept.push(tick);
    }
    return kept;
}

/**
 * A level or amplitude axis's ticks over `range`, as fractions up the axis: the one rule for every plot's value axis
 * (Compare's panes and the track lanes' amplitude axis), with as many decimals as the span needs. On an axis
 * `height` px tall, as many round steps as fit without their labels touching: fewer on a short plot.
 */
export function valueAxisTicks(range: PaneRange, height = Infinity): AxisTick[] {
    const span = range.max - range.min || 1;
    const at = (count: number): AxisTick[] => {
        const values = niceTicks(range.min, range.max, count);
        return values.map(value => ({ text: valueTickTexts(values)(value), fraction: (value - range.min) / span }));
    };
    const full = at(4);
    if (ticksFit(full, height)) return full;
    // Coarser round steps, or every k-th of the finest (−80, −40, 0): whichever keeps the most labels apart.
    const everyKth = Array.from({ length: full.length }, (_, k) => Array.from({ length: k + 1 }, (_, offset) => full.filter((_, index) => index % (k + 1) === offset))).flat();
    const candidates = [at(3), at(2), at(1), ...everyKth, spacedTicks(full, height)].filter(ticks => ticksFit(ticks, height));
    return candidates.reduce<AxisTick[]>((best, ticks) => (ticks.length > best.length ? ticks : best), []);
}

/**
 * How a value axis writes its ticks: with as many decimals as their step needs (a step of 0.25 two, a step of 1
 * none), the same on every tick; a step finer than 0.00001 in powers of ten ("2.5e−7"), so a quiet signal's ticks
 * still read their own values. Each tick's place is a whole number of steps, so the step's decimals are all it needs.
 */
export function valueTickTexts(values: readonly number[]): (value: number) => string {
    const step = values.length > 1 ? Math.abs(values[1] - values[0]) : Math.abs(values[0] ?? 0);
    const whole = (x: number): boolean => Math.abs(x - Math.round(x)) <= 1e-6 * Math.max(1, Math.abs(x));
    let decimals = step > 0 && Number.isFinite(step) ? Math.max(0, Math.floor(-Math.log10(step))) : 0;
    while (decimals < 20 && step > 0 && !whole(step * 10 ** decimals)) decimals++;
    const minus = withMinus;
    if (decimals > 5) return value => (value === 0 ? '0' : minus((+value.toPrecision(6)).toExponential()));
    return value => minus(decimals ? value.toFixed(decimals) : String(Math.round(value)));
}

/**
 * A heatmap's row axis ticks between `low` and `high` (fractions up the axis): at a log axis's round values, or on a
 * linear one as many as `height` px is tall for. Compare's heatmaps and the track spectrogram lanes use it.
 */
export function rowAxisTicks(low: number, high: number, log: boolean, height: number, text?: (value: number) => string): Array<AxisTick & { value: number }> {
    const span = high - low || 1;
    const values = log ? ticks(low, high, true) : niceTicks(low, high, Math.max(2, Math.min(8, Math.floor(height / 22))));
    return values.map(value => ({ value, text: text?.(value) ?? tickText(value, log), fraction: log ? Math.log(value / low) / Math.log(high / low) : (value - low) / span }));
}

/** A time or frequency axis's ticks between `low` and `high` (a log frequency axis's at its round values), with their text. */
export function alongAxisTicks(low: number, high: number, log = false): Array<{ value: number; text: string }> {
    return ticks(low, high, log).map(value => ({ value, text: tickText(value, log) }));
}

const tickText = (value: number, log: boolean): string => (log ? (value >= 1000 ? `${Number((value / 1000).toPrecision(3))}k` : String(Number(value.toPrecision(3)))) : String(value));
/** A value on the level axis with as many decimals as its span needs (cepstral coefficients need four or five). */
const levelTick = (value: number, span: number): string => withMinus(span >= 8 ? String(Math.round(value)) : value.toFixed(Math.max(1, Math.min(6, Math.ceil(-Math.log10(span / 8))))));

/** One picture drawn on a pane: its colour and, over others, its line weight. */
export interface StageLayer {
    view: StageView;
    color: string;
    width?: number;
    alpha?: number;
    /** Bars filled down to the axis (a picture on its own); overlaid bars are drawn as steps. */
    filled?: boolean;
    /** How opaque the fill of filled bars is (0.3 by default: a band level under its step; 1 for a histogram's bars). */
    fill?: number;
    /** What the readout calls it while the pointer is on it (the legend's name). */
    label?: string;
    /** A dash pattern (px) for a line told apart by more than its colour: one read on the second level axis. */
    dash?: readonly number[];
    /** The recording a trigger's events are of, whose events a click leaves out (or puts back), and those left out. */
    source?: string;
    excluded?: readonly number[];
    /** One event of `source` (eventLayers'), and whether it is left out. */
    event?: { id: number; source: string; out: boolean };
    /** What the readout says of the point at `index` of the drawn line (−1 for a point of the full data, at `point.x`), in place of where and how much (a histogram's bin and its count, a dot's recording, a spectrum's level in its unit). */
    /** `step`: for a point of the full data, the spacing of its real neighbours (the digits a place needs, R7). */
    readout?: (index: number, point: { x: number; value: number; step?: number }) => string[];
    /**
     * Where every number read of this picture comes from (R7, fullRead.ts), required of every layer: a source the
     * webview holds every value of (InlineFullSource: bars, a pair spectrum's bins, a histogram's), or one the backend
     * holds (FetchedFullSource). Nothing is ever read from what the plot draws. A layer given NO_FULL_DATA reads no
     * number, and the plot marks it (`data-plot-full`), which every ui-smoke test fails.
     */
    full: FullRead;
    /**
     * A level line with no levelBins, measured for the overlay's order (R6) from every value on screen of its full
     * data (`full`): a cursor slice cut for display, which holds only the points kept to draw it.
     */
    measured?: boolean;
    /** Drawn as marks, not a line: a dot at each point (`width` its radius), or a rug tick up from the floor at each point's x. */
    marks?: 'dots' | 'rug';
    /** The stretch of the horizontal axis (its values) this picture is drawn over, clipped there: finer data over part of the view. */
    span?: readonly [number, number];
    /** A heatmap whose rows are things, not an axis (the entry strip's recordings): the readout's name for the cell at `row` of `view.ys`, `column` of `view.xs` (a cell may show the loudest of several things). */
    rowName?: (row: number, column: number) => string;
}

/**
 * Where a pane put its lines, for the pointer (plotHover.ts): the plot's frame on the canvas (CSS pixels), the
 * axes' values to pixels, and the pictures drawn as lines or steps (not a signal drawn as itself, nor an image).
 */
export interface StagePlot {
    frame: { left: number; top: number; width: number; height: number };
    xAt: (value: number) => number;
    yAt: (value: number) => number;
    /** The horizontal axis's value at a canvas x, and whether the axis is logarithmic; the level at a canvas y. */
    xOf?: (x: number) => number;
    xLog?: boolean;
    levelOf?: (y: number) => number;
    /** A figure no pointer reads (a report's): nothing is read on it. */
    noReadout?: boolean;
    /** A band's half width as a ratio of its centre, for steps. */
    ratioStep: number;
    /** On a linear axis, a bar's half width in the axis's values (a histogram's bins): bars are then that wide each side. */
    halfStep?: number;
    lines: StageLayer[];
    diff: boolean;
    /**
     * Where `lines` holds signals drawn as themselves: the readout's unit for a signal without one (uncalibrated),
     * and the signal drawn again at another width (the hover's thicker line).
     */
    signal?: { unit: string; range?: { min: number; max: number }; paint(context: CanvasRenderingContext2D, layer: StageLayer, width: number): void };
    /**
     * `yAt` without holding the value inside the range, for drawing a line: a stretch past the level axis leaves
     * the plot where it crosses the axis and is clipped, instead of running along the plot's edge.
     */
    lineYAt?: (value: number) => number;
    /** The lines read on the right-hand level axis (`StagePaintOptions.secondary`), placed by its range. */
    secondary?: StagePlot;
    /**
     * The unit a level on this plot reads in: its level axis's own (a heatmap's colour bar's), with the files'
     * reference ("dBFS", "dB SPL re 20 µPa"), so a readout never writes a bare "dB" beside an axis that says more.
     */
    levelUnit?: string;
    /** A heatmap drawn: its picture, and the cell (column, row of its matrix; −1 off the picture) at a point of the canvas. */
    image?: {
        layer: StageLayer;
        cellAt(x: number, y: number): { column: number; row: number };
        /** The axes' values at a canvas point (null off the picture), and back; whether the rows' axis is logarithmic. */
        valueAt(x: number, y: number): { x: number; y: number } | null;
        placeOf(x: number, y: number): { x: number; y: number };
        rowLog: boolean;
    };
    /** Where a heatmap's colour bar was painted (CSS pixels on the canvas). */
    colourBar?: ColourBarBox;
    /** The value axis' ticks as drawn (a heatmap's rows, a line's levels): a lane kept as painted draws its side axis again from them. */
    levelTicks?: AxisTick[];
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
     * Guides over the plot, in its axes' values: stretches of the horizontal axis shaded (a trigger's events, where
     * each was cut) and a level drawn dashed across it, named at its right end (the level a trigger fires at).
     */
    guides?: { spans?: ReadonlyArray<{ start: number; end: number }>; level?: { value: number; label: string } };
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
    /** false for a plot stacked over another on the same horizontal axis: its gridlines only, the one below labels it. */
    xAxisLabels?: boolean;
    /** false for a plot whose level axis is named beside it (the distribution's rows): no level ticks or name in its margin. */
    yAxisLabels?: boolean;
    /** The plot's margins in CSS pixels, for a plot whose pointer handling has its own (the comparison's by default). */
    margins?: PlotMargins;
    /** A stretch of the horizontal axis picked (its values): shaded behind the pictures. */
    highlight?: { start: number; end: number };
    /** A heatmap's row-axis tick text, for rows counted another way than their values (the entry strip's, down from the top). */
    yTickText?: (value: number) => string;
    /**
     * Lines read against a second level reference, on a level axis of their own at the right: `range` is that
     * axis' range and `title` its name. They are drawn after the left axis' lines, as lines (not signals).
     */
    secondary?: { layers: StageLayer[]; range: PaneRange; title: string };
    /**
     * A track lane's layout: its value axis on a canvas of its own beside the plot (its ticks and name are drawn
     * there), the plot filling its canvas at the canvas's own size, and no time labels (the ruler above has them).
     */
    axisCanvas?: HTMLCanvasElement | null;
    /** A heatmap's level colours (the track spectrogram lanes' viridis); grey levels when not given. */
    heatmapPalette?: Palette;
    /** Each point of a signal's line (CSS pixels on the canvas, its value and time, whether seen), for a pointer that reads them. */
    onSignalPoint?: SignalPointSink;
    /** false for a figure no pointer reads (a report's): its pictures need no full data, and nothing is read on it. */
    readout?: false;
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

/** One picture on its own: the base, the compared file or their difference; `full`, where its numbers are read (R7). */
export function paintStage(canvas: HTMLCanvasElement, view: StageView | null, range: PaneRange, color: string, axes: StageAxes, options: StagePaintOptions = {}, full?: FullRead): StagePlot | null {
    return paintOverlay(canvas, { layers: view ? [{ view, color, filled: true, full: full ?? NO_FULL_DATA }] : [] }, range, axes, options);
}

/**
 * Draws one pane: the overlay's pictures within `range` (the level axis, or a heatmap's colours), with tick
 * numbers on both axes and the axes' names. `diff` draws a zero line and colours a heatmap green (compare
 * louder) and grey (quieter). Without a picture it says `empty` in the middle of the pane. Returns where its lines
 * are, for the pointer (null when nothing is drawn).
 */
export function paintOverlay(canvas: HTMLCanvasElement, overlay: StageOverlay, range: PaneRange, axes: StageAxes, options: StagePaintOptions = {}): StagePlot | null {
    // While it draws, the page says so: the ui-smoke audit (canvasAudit.ts) fails a plot drawn into by anything else
    // (R13: what drew a canvas, not only its mark, is what makes it the plot component's).
    const scope = globalThis as { __plotPainting?: number };
    scope.__plotPainting = (scope.__plotPainting ?? 0) + 1;
    const generation = (paintedGenerations.get(canvas) ?? 0) + 1;
    paintedGenerations.set(canvas, generation);
    let plot: StagePlot | null = null;
    let again = false;
    // A line's level on screen fetched for the order (R6) is in: the plot is drawn again with it, in place, unless its
    // caller has drawn the canvas since. The caller's StagePlot is kept, with the lines in their new order.
    const ready = (): void => {
        if (again) return;
        again = true;
        queueMicrotask(() => {
            if (paintedGenerations.get(canvas) !== generation) return;
            const redrawn = paintOverlay(canvas, overlay, range, axes, options);
            if (plot && redrawn) Object.assign(plot, redrawn);
        });
    };
    try {
        plot = paintPlot(canvas, overlay, range, axes, options, ready);
        return plot;
    } finally {
        scope.__plotPainting -= 1;
    }
}

/** How many times each canvas was drawn by paintOverlay: a redraw for a fetched level is for the latest only. */
const paintedGenerations = new WeakMap<HTMLCanvasElement, number>();

function paintPlot(canvas: HTMLCanvasElement, overlay: StageOverlay, range: PaneRange, axes: StageAxes, options: StagePaintOptions, ready: () => void): StagePlot | null {
    const lane = options.axisCanvas !== undefined;
    // A lane keeps the size its layout gave its canvas; any other plot is sized to its box at the screen's ratio.
    const ratio = options.size ? 1 : lane ? canvas.width / (canvas.clientWidth || canvas.width || 1) : canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const width = options.size?.width ?? (lane ? canvas.width / ratio : canvas.clientWidth || 600), height = options.size?.height ?? (lane ? canvas.height / ratio : canvas.clientHeight || 120);
    if (!lane) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext('2d');
    if (!context) return null;
    // Drawn by the one plot component (R13): every ui-smoke test fails a plot on screen without this mark, and the
    // plot contract test gives each one marked the same gestures. Its axes are named on it for that test.
    if (canvas.dataset) {
        canvas.dataset.plot = '';
        canvas.dataset.plotAxes = overlay.layers.length ? `${axes.x}|${axes.y}` : '';
        canvas.dataset.plotOrder = '';
        canvas.dataset.plotFull = '';
        canvas.dataset.plotColour = '';
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const style = canvas.ownerDocument.defaultView?.getComputedStyle(canvas);
    const muted = style?.getPropertyValue('--muted').trim() || '#888';
    const line = style?.getPropertyValue('--line').trim() || '#444';
    const text = options.labels ? '#222' : style?.getPropertyValue('--text').trim() || '#ddd';
    const margins = options.margins ?? (lane ? { left: 0, top: 0, right: 0, bottom: 0 } : undefined);
    const xLabels = options.xAxisLabels !== false && !lane;
    const left = margins?.left ?? PANE_LEFT, top = margins?.top ?? (options.labels ? 40 : 4), bottom = margins?.bottom ?? 16, right = margins?.right ?? 4;
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
    context.font = PLOT_TEXT_FONT;
    // Each picture with a trigger's events drawn as one line each; the axes are the first picture's as the caller gave them.
    const events = new Map(overlay.layers.map(layer => [layer, eventLayers(layer)]));
    const view = overlay.layers.flatMap(layer => events.get(layer) ?? []).find(layer => layer.view.kind !== 'none' && layer.view.xs?.length)?.view;
    // Neutral: blue and the other colours are the roles'.
    const pendingColors = { muted, line, fill: text, back: style?.getPropertyValue('--track-bg').trim() || '#0b0d10' };
    if (!view) {
        // A lane with nothing to draw yet keeps its value axis (ticks and name) beside it, as data-plot-axes names it.
        if (options.axisCanvas) paintSideAxis(options.axisCanvas, valueAxisTicks(range, plotHeight), axes.y, { muted, text });
        if (options.pending) paintPending(context, options.pending, left + plotWidth / 2, top + plotHeight / 2, 'center', pendingColors);
        else if (options.empty) {
            // Across the whole pane (no axes are drawn), wrapped to its width: a narrow screen keeps every word.
            context.fillStyle = muted;
            context.textAlign = 'center';
            // Its own lines kept (a failure's summary, then the backend's text), each wrapped.
            const lines = options.empty.split('\n').flatMap(line => wrapLines(line, Math.max(40, width - 16), part => context.measureText(part).width));
            const step = 13;
            const first = top + plotHeight / 2 - ((lines.length - 1) * step) / 2;
            lines.forEach((part, index) => context.fillText(part, width / 2, first + index * step));
            context.textAlign = 'start';
        }
        return null;
    }
    const xWindow = options.window?.x ?? FULL_WINDOW;
    const whole = options.axisView ?? view;
    // Drawn in the plot's own order (R6): the quietest compared line last, on top, on every plot, by every value on
    // screen; a level still being fetched draws the plot again once it is in (`ready`).
    const levelContext = { ready };
    const levels = screenLevels(overlay.layers.filter(comparedLine), whole, xWindow, levelContext);
    const order = settledOrder(canvas, 'main', overlay.layers, overlayOrder(overlay.layers, whole, xWindow, levels), levels);
    const layers = order.flatMap(layer => events.get(layer) ?? []);
    // Each line drawn, as the caller's picture (a trigger's events are their recording's), in the order drawn.
    const pictureOf = new Map(order.flatMap(layer => (events.get(layer) ?? []).map(drawn => [drawn, layer] as const)));
    const drawnPictures: StageLayer[] = [];
    const secondDrawn: StageLayer[] = [];
    const drew = (layer: StageLayer): void => { const picture = pictureOf.get(layer) ?? layer; if (drawnPictures[drawnPictures.length - 1] !== picture) drawnPictures.push(picture); };
    const secondLevels = options.secondary ? screenLevels(options.secondary.layers.filter(comparedLine), whole, xWindow, levelContext) : undefined;
    const secondaryOrder = options.secondary && secondLevels ? settledOrder(canvas, 'secondary', options.secondary.layers, overlayOrder(options.secondary.layers, whole, xWindow, secondLevels), secondLevels) : [];
    const xAxis = windowed(axisScale(whole), xWindow);
    // Zoomed, the pictures run past the plot's edges: they are clipped to it.
    const xAt = (value: number): number => left + xAxis.fraction(value) * plotWidth;
    const heatmap = view.kind === 'heatmap';
    // The rows' axis is the picture's own when the whole axes given (a lane's time axis) have no rows.
    const yAxis = heatmap ? windowed(rowScale(whole.ys?.length ? whole : view), options.window?.y) : null;
    const levelAt = (axis: PaneRange) => (value: number): number => top + (1 - (Math.max(axis.min, Math.min(axis.max, value)) - axis.min) / (axis.max - axis.min)) * plotHeight;
    const yAt = levelAt(range);
    // Ten spans past either end is far outside the plot: a line's slope where it crosses the edge stays right.
    const looseAt = (axis: PaneRange) => {
        const span = axis.max - axis.min;
        return (value: number): number => top + (1 - (Math.max(axis.min - 10 * span, Math.min(axis.max + 10 * span, value)) - axis.min) / span) * plotHeight;
    };

    let levelTicks: AxisTick[] = [];
    const levelOf = (axis: PaneRange) => (y: number): number => axis.min + (1 - (y - top) / plotHeight) * (axis.max - axis.min);
    const plot: StagePlot = { frame: { left, top, width: plotWidth, height: plotHeight }, xAt, yAt, xOf: x => xAxis.at((x - left) / plotWidth), xLog: xAxis.log, levelOf: levelOf(range),
        lineYAt: looseAt(range), ratioStep: 1.12, lines: [], diff: !!options.diff, ...(options.readout === false ? { noReadout: true } : {}), ...levelUnitOf(heatmap ? axes.colour : axes.y) };
    // Every picture drawn says where its numbers are read (R7): a plot drawing one that does not is marked, and every
    // ui-smoke test fails it (canvasAudit.ts). A figure no pointer reads needs none.
    if (canvas.dataset) {
        const undeclared = [...layers, ...(options.secondary?.layers ?? [])].filter(layer => !declaresFullRead(layer));
        canvas.dataset.plotFull = options.readout === false ? 'none' : undeclared.length ? `missing: ${undeclared.map(layer => layer.label || layer.view.frame).join(', ')}` : 'declared';
    }
    if (heatmap && yAxis && view.matrix) {
        const image = context.createImageData(Math.round(plotWidth * ratio), Math.round(plotHeight * ratio));
        const extentAbs = Math.max(Math.abs(range.min), Math.abs(range.max), 1e-9);
        const ys = view.ys ?? [], xs = view.xs ?? [];
        // A signed picture (a difference, a cepstrum) shows its largest magnitude; levels, their loudest.
        const signedScale = !!options.diff || view.quantity === 'cepstrum';
        // The cells each pixel line covers (none past the picture's ends), worked out once per line, not per pixel,
        // from the axes' values: a detail picture covers only part of them.
        const rowEdges = cellEdges(ys, yAxis.log), columnEdges = cellEdges(xs, false);
        const measure = (value: number, log: boolean): number => (log ? Math.log(Math.max(value, 1e-12)) : value);
        const rowSpans = Array.from({ length: image.height }, (_, py) => cellSpan(rowEdges,
            measure(yAxis.at(1 - (py + 1) / image.height), yAxis.log), measure(yAxis.at(1 - py / image.height), yAxis.log)));
        // A picture with a span (a track's spectrogram on the lanes' axis) paints nothing past it, though its end
        // cells reach half a step beyond their frames' centres.
        const clip = layers.find(layer => layer.view === view)?.span ?? [-Infinity, Infinity];
        const columnSpans = Array.from({ length: image.width }, (_, px) => {
            const low = Math.max(clip[0], xAxis.at(px / image.width)), high = Math.min(clip[1], xAxis.at((px + 1) / image.width));
            return high > low ? cellSpan(columnEdges, low, high) : null;
        });
        const pixels = new Uint32Array(image.data.buffer);
        // A cell's colour, packed as the canvas stores it; `dim` for a difference where both levels are far below the loudest.
        const colourOfCell = (cell: number, dim = false): number => {
            if (options.diff) {
                // A difference where both levels are far below the loudest is dimmed: it is not what is heard.
                const amount = Math.min(1, Math.abs(cell) / extentAbs) * (dim ? 0.2 : 1);
                return cell >= 0 ? packRgb(Math.round(63 * amount), Math.round(185 * amount), Math.round(80 * amount)) : packRgb(Math.round(150 * amount), Math.round(150 * amount), Math.round(150 * amount));
            }
            if (view.quantity === 'cepstrum') {
                // Signed coefficients as wandas draws them (RdBu_r): blue below zero, white at zero, red above.
                const amount = Math.max(-1, Math.min(1, cell / extentAbs));
                const fade = Math.round(255 * (1 - Math.abs(amount)));
                return amount >= 0 ? packRgb(255, fade, fade) : packRgb(fade, fade, 255);
            }
            const fraction = Math.max(0, Math.min(1, (cell - range.min) / (range.max - range.min || 1)));
            if (options.heatmapPalette) return paletteColour(fraction, options.heatmapPalette);
            const level = Math.round(fraction * 255);
            return packRgb(level, level, level);
        };
        const matrix = view.matrix;
        const loud = options.loud;
        const raster = rasterizeHeatmap({
            matrix, width: image.width, height: image.height, rowSpans, columnSpans, signed: signedScale,
            colour: (cell, row, column) => colourOfCell(cell, !!loud && !loud[row]?.[column]),
        }, pixels);
        context.putImageData(image, Math.round(left * ratio), Math.round(top * ratio));
        const imageLayer = layers.find(layer => layer.view === view) ?? layers[0];
        plot.image = {
            layer: imageLayer,
            rowLog: yAxis.log,
            valueAt: (x, y) => {
                const fx = (x - left) / plotWidth, fy = (y - top) / plotHeight;
                return fx < 0 || fx > 1 || fy < 0 || fy > 1 ? null : { x: xAxis.at(fx), y: yAxis.at(1 - fy) };
            },
            placeOf: (x, y) => ({ x: xAt(x), y: top + (1 - yAxis.fraction(y)) * plotHeight }),
            cellAt: (x, y) => {
                const fx = (x - left) / plotWidth, fy = (y - top) / plotHeight;
                if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return { column: -1, row: -1 };
                // The cell drawn under the point: the strongest of those its pixel covers.
                return raster.cellAt(Math.min(image.width - 1, Math.floor(fx * image.width)), Math.min(image.height - 1, Math.floor(fy * image.height)));
            },
        };
        // A linear row axis (Bark, quefrency, the entry strip's rows) gets as many ticks as the plot is tall for.
        levelTicks = rowAxisTicks(yAxis.low, yAxis.high, yAxis.log, plotHeight, options.yTickText).map(tick => ({ text: tick.text, fraction: yAxis.fraction(tick.value) }));
        // The colour bar, top right inside the plot: what the colour measures, and its ends.
        const edge = Math.max(Math.abs(range.min), Math.abs(range.max));
        const low = signedScale ? -edge : range.min, high = signedScale ? edge : range.max;
        const endText = (value: number): string => levelTick(value, high - low);
        // Under the region's corner tag when there is one, as the pending note is.
        // What the colour measures, named on the canvas: every ui-smoke test fails a colour bar that does not draw it (R4).
        if (canvas.dataset) canvas.dataset.plotColour = axes.colour ?? '';
        plot.colourBar = paintColourBar(context, { left: left + 4, right: left + plotWidth - 4, top: colourBarTop(top, options.region?.mark === 'tag') }, axes.colour ?? '', endText(low), endText(high), fraction => {
            const [r, g, b] = unpackRgb(colourOfCell(low + fraction * (high - low)));
            return `rgb(${r}, ${g}, ${b})`;
        }, { text, back: pendingColors.back, line });
    } else {
        context.strokeStyle = line;
        context.lineWidth = 1;
        levelTicks = valueAxisTicks(range, plotHeight);
        for (const tick of levelTicks) {
            const y = top + (1 - tick.fraction) * plotHeight;
            context.beginPath(); context.moveTo(left, y); context.lineTo(left + plotWidth, y); context.stroke();
        }
        if (options.diff) {
            context.strokeStyle = muted;
            context.beginPath(); context.moveTo(left, yAt(0)); context.lineTo(left + plotWidth, yAt(0)); context.stroke();
        }
        const bars = view.kind === 'bar';
        const barXs = view.xs ?? [];
        // Bands on a log axis are a ratio wide; bins on a linear one (a histogram's) a step.
        const linearBars = bars && view.xScale === 'linear';
        const ratioStep = bars && !linearBars && barXs.length > 1 ? Math.sqrt(barXs[1] / barXs[0]) : 1.12;
        plot.ratioStep = ratioStep;
        if (linearBars) plot.halfStep = barXs.length > 1 ? (barXs[1] - barXs[0]) / 2 : 0.5;
        context.save();
        context.beginPath(); context.rect(left, top, plotWidth, plotHeight); context.clip();
        if (options.highlight) {
            const a = xAt(options.highlight.start), b = xAt(options.highlight.end);
            context.save();
            context.fillStyle = text;
            context.globalAlpha = 0.07;
            context.fillRect(Math.min(a, b), top, Math.max(1, Math.abs(b - a)), plotHeight);
            context.restore();
        }
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
                    paint: (ctx, signal, lineWidth) => { if (signal.view.waveform) paintWaveformLayer(ctx, box, signal.view.waveform, wholeAxis, xWindow, range, signal.color, lineWidth, { span: signal.span }); },
                };
                if (layer.view.waveform) {
                    paintWaveformLayer(context, box, layer.view.waveform, wholeAxis, xWindow, range, layer.color, layer.width ?? 1.5,
                        { span: layer.span, onPoint: options.onSignalPoint });
                }
                plot.lines.push(layer);
                drew(layer);
                continue;
            }
            plot.lines.push(layer);
            drew(layer);
            context.save();
            context.fillStyle = layer.color;
            context.globalAlpha = layer.alpha ?? 1;
            if (layer.view.kind === 'bar' && layer.filled) {
                const floor = options.diff ? yAt(0) : yAt(range.min);
                context.globalAlpha = (layer.fill ?? 0.3) * (layer.alpha ?? 1);
                values.forEach((value, index) => {
                    if (value === null) return;
                    const [x0, x1] = barEdges(plot, xs[index]);
                    context.fillRect(x0, Math.min(floor, yAt(value)), Math.max(1, x1 - x0 - 1), Math.abs(floor - yAt(value)));
                });
                context.globalAlpha = layer.alpha ?? 1;
            }
            strokeStageLine(context, plot, layer, layer.width ?? (layer.view.kind !== 'bar' ? 1.5 : layer.filled ? 1 : 2));
            context.restore();
        }
        if (options.secondary) {
            const { levelUnit: _main, ...shared } = plot;
            const secondPlot: StagePlot = { ...shared, yAt: levelAt(options.secondary.range), levelOf: levelOf(options.secondary.range), lineYAt: looseAt(options.secondary.range), lines: [], ...levelUnitOf(options.secondary.title) };
            plot.secondary = secondPlot;
            for (const layer of secondaryOrder) {
                if (layer.view.kind !== 'line' && layer.view.kind !== 'bar') continue;
                secondPlot.lines.push(layer);
                secondDrawn.push(layer);
                strokeStageLine(context, secondPlot, layer, layer.width ?? (layer.view.kind !== 'bar' ? 1.5 : 2));
            }
        }
        context.restore();
    }
    // What was drawn in which order, for the audit of every plot (R6): a trigger's events are their recording's line.
    if (canvas.dataset) {
        canvas.dataset.plotOrder = [drawnLevelsText(drawnPictures, whole, xWindow, levels), drawnLevelsText(secondDrawn, whole, xWindow, secondLevels)].filter(Boolean).join(';');
    }
    // The frequency or time axis: ticks along the bottom, its name at the right end; a tick label the name would
    // overlap is left out (its gridline stays).
    const xFitted = fitAxisTitle(axes.x, plotWidth / 2, title => context.measureText(title).width);
    const xTitle = xFitted.lines.join(' ');
    const xTitleLeft = left + plotWidth - context.measureText(xTitle).width * xFitted.scale;
    context.fillStyle = muted;
    context.strokeStyle = line;
    context.lineWidth = 1;
    for (const { value, text: label } of alongAxisTicks(xAxis.low, xAxis.high, xAxis.log)) {
        const x = xAt(value);
        if (!heatmap) { context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + plotHeight); context.stroke(); }
        if (xLabels && x - 6 + context.measureText(label).width < xTitleLeft - 4) context.fillText(label, x - 6, height - 3);
    }
    if (options.region) paintRegion(context, options.region, view, { left, top, width: plotWidth, height: plotHeight }, xAt, { muted, text });
    if (options.guides) paintGuides(context, options.guides, { left, top, width: plotWidth, height: plotHeight }, xAt, yAt, text);
    if (options.bandSteps?.legend) paintBandLegend(context, options.bandSteps.legend, options.bandSteps.color, left + plotWidth - 6, top, muted);
    context.fillStyle = text;
    if (xLabels) {
        context.font = scaledFont(PLOT_TEXT_FONT, xFitted.scale);
        context.fillText(xTitle, xTitleLeft, height - 3);
        context.font = PLOT_TEXT_FONT;
    }
    // The level axis: its ticks in the muted colour, and what it measures up the left edge in the text colour.
    const frame = { left, top, width: plotWidth, height: plotHeight };
    // No two tick labels on the value axis touch, whatever the plot's height (a heatmap's rows, a short pair plot).
    levelTicks = spacedTicks(levelTicks, plotHeight);
    plot.levelTicks = levelTicks;
    if (options.axisCanvas) paintSideAxis(options.axisCanvas, levelTicks, axes.y, { muted, text });
    else if (!lane && options.yAxisLabels !== false) {
        drawValueAxis(context, frame, levelTicks, '', { color: muted, font: context.font, titleX: AXIS_TITLE_X });
        paintValueTitle(context, frame, axes.y, text, AXIS_TITLE_X);
    }
    // The right-hand axis has its own round ticks, each written where its own value is (never the left axis's places
    // labelled with the right range's values there, rounded to a number that is not where it is drawn).
    if (options.secondary && !heatmap) paintRightAxis(context, frame, valueAxisTicks(options.secondary.range, plotHeight), options.secondary.range, options.secondary.title, width, { muted, line, text });
    // Under the region's corner tag when there is one.
    // A heatmap's colour bar holds that corner: the note goes under it.
    if (options.pending) paintPending(context, options.pending, left + plotWidth - 6, heatmap && plot.colourBar ? plot.colourBar.y + plot.colourBar.height + 9 : top + (options.region?.mark === 'tag' ? 38 : 12), 'right', pendingColors);
    return plot;
}

/**
 * A lane's value axis on its own canvas beside the plot (as tall as the plot): the ticks at its right edge in the
 * muted colour and the name up its left in the text colour, as every plot writes its value axis.
 */
export function paintSideAxis(canvas: HTMLCanvasElement, ticks: readonly AxisTick[], title: string, colors: { muted: string; text: string }): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const frame = { left: canvas.width, top: 0, width: 0, height: canvas.height };
    drawValueAxis(context, frame, spacedTicks(ticks, canvas.height), '', { color: colors.muted, font: PLOT_TEXT_FONT, titleX: AXIS_TITLE_X });
    context.font = PLOT_TEXT_FONT;
    paintValueTitle(context, frame, title, colors.text, AXIS_TITLE_X);
}

/**
 * A value axis's name up the gutter at canvas x `x`, in `color`, fitted to the frame's height: smaller, on two lines
 * or with its quantity shortened, but always its quantity and its unit (R4).
 */
function paintValueTitle(context: CanvasRenderingContext2D, frame: { top: number; height: number }, title: string, color: string, x: number): void {
    if (!title) return;
    const font = context.font;
    const fitted = fitAxisTitle(title, frame.height, part => context.measureText(part).width, { lines: 2 });
    context.save();
    context.fillStyle = color;
    context.font = scaledFont(font, fitted.scale);
    context.translate(x, frame.top + frame.height / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // Two lines side by side across the gutter, read as one: the quantity on the left, then the unit.
    const step = fontPixels(font) * fitted.scale * 1.1;
    fitted.lines.forEach((line, index) => context.fillText(line, 0, (index - (fitted.lines.length - 1) / 2) * step));
    context.restore();
}

/** Where a heatmap's colour bar starts: the plot's top right, or under the region's corner tag (top + 4 to + 21). */
export const colourBarTop = (top: number, tagged: boolean): number => top + (tagged ? 25 : 3);

/** A colour bar's box on its canvas, in the units it was drawn in (a double-click there opens its range). */
export interface ColourBarBox { x: number; y: number; width: number; height: number }

/**
 * A heatmap's colour bar, for every picture drawn in colours (the comparison's heatmaps, a track's spectrogram): its
 * name, then the low end, a strip of the colours and the high end, on a backing box. Returns the box.
 * The name is never left out (R4): beside the scale when it fits there whole; else on its own row(s) above the scale,
 * across the plot's width, fitted as every axis name is (axisTitle.ts fitAxisTitle: smaller, on two lines, then its
 * quantity shortened, but always its quantity and its unit).
 */
export function paintColourBar(context: CanvasRenderingContext2D, at: { left: number; right: number; top: number }, fullTitle: string, lowText: string, highText: string, colourAt: (fraction: number) => string, colors: { text: string; back: string; line: string }): ColourBarBox {
    const strip = 48, height = 6, gap = 4, pad = 3, row = 14, titleRow = 12;
    const measure = (text: string): number => context.measureText(text).width;
    const lowWidth = measure(lowText);
    const highWidth = measure(highText);
    const scale = pad + lowWidth + gap + strip + gap + highWidth + pad;
    const room = at.right - at.left - scale - gap * 2;
    const inline = fullTitle && measure(fullTitle) <= room ? fullTitle : '';
    // Not beside the scale: above it, as wide as the plot is.
    const above = fullTitle && !inline ? fitAxisTitle(fullTitle, Math.max(1, at.right - at.left - pad * 2), measure, { lines: 2 }) : null;
    const font = context.font;
    const titleFont = above ? scaledFont(font, above.scale) : font;
    context.save();
    context.font = titleFont;
    const aboveWidth = above ? Math.max(...above.lines.map(measure)) : 0;
    context.restore();
    const inlineWidth = inline ? measure(inline) + gap * 2 : 0;
    const width = Math.max(scale + inlineWidth, above ? aboveWidth + pad * 2 : 0);
    const titleHeight = above ? above.lines.length * titleRow : 0;
    const x = Math.max(at.left, at.right - width), y = at.top;
    const boxWidth = at.right - x;
    context.save();
    context.globalAlpha = 0.8;
    context.fillStyle = colors.back;
    context.fillRect(x, y, boxWidth, titleHeight + row);
    context.globalAlpha = 1;
    context.fillStyle = colors.text;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    if (above) {
        context.font = titleFont;
        above.lines.forEach((line, index) => context.fillText(line, at.right - pad - measure(line), y + titleRow * index + titleRow / 2 + 1));
        context.font = font;
    }
    const scaleY = y + titleHeight + row / 2;
    let cursor = at.right - scale - inlineWidth + pad;
    if (inline) { context.fillText(inline, cursor, scaleY); cursor += inlineWidth; }
    context.fillText(lowText, cursor, scaleY);
    cursor += lowWidth + gap;
    const gradient = context.createLinearGradient(cursor, 0, cursor + strip, 0);
    for (let step = 0; step <= 8; step++) gradient.addColorStop(step / 8, colourAt(step / 8));
    context.fillStyle = gradient;
    context.fillRect(cursor, scaleY - height / 2, strip, height);
    context.strokeStyle = colors.line;
    context.lineWidth = 1;
    context.strokeRect(cursor, scaleY - height / 2, strip, height);
    context.fillStyle = colors.text;
    context.fillText(highText, cursor + strip + gap, scaleY);
    context.restore();
    return { x, y, width: boxWidth, height: titleHeight + row };
}

/**
 * The right-hand level axis: its edge, its values at the left axis' gridlines (`fractions` up the plot), so a
 * gridline reads on either side, and its name up the canvas' right side.
 */
function paintRightAxis(context: CanvasRenderingContext2D, frame: { left: number; top: number; width: number; height: number }, ticks: readonly AxisTick[], range: PaneRange, title: string, width: number, colors: { muted: string; line: string; text: string }): void {
    const x = frame.left + frame.width;
    context.save();
    context.strokeStyle = colors.line;
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(x, frame.top); context.lineTo(x, frame.top + frame.height); context.stroke();
    context.fillStyle = colors.muted;
    context.textAlign = 'left';
    for (const tick of range.max > range.min ? ticks : []) {
        const y = frame.top + (1 - tick.fraction) * frame.height;
        context.beginPath(); context.moveTo(x, y); context.lineTo(x + 3, y); context.stroke();
        context.textBaseline = tick.fraction >= 1 ? 'top' : tick.fraction <= 0 ? 'bottom' : 'middle';
        context.fillText(tick.text, x + 4, y);
    }
    context.restore();
    paintValueTitle(context, frame, title, colors.text, width - AXIS_TITLE_X);
}

/** Where a bar centred on `x` starts and ends on the canvas: a ratio each side on a log axis, a step on a linear one. */
export function barEdges(plot: Pick<StagePlot, 'xAt' | 'ratioStep' | 'halfStep'>, x: number): [number, number] {
    return plot.halfStep !== undefined ? [plot.xAt(x - plot.halfStep), plot.xAt(x + plot.halfStep)] : [plot.xAt(x / plot.ratioStep), plot.xAt(x * plot.ratioStep)];
}

/** One picture of a pane as its line (or its bands as steps, or its points as marks), `width` wide, clipped to the plot. */
export function strokeStageLine(context: CanvasRenderingContext2D, plot: StagePlot, layer: StageLayer, width: number): void {
    if (layer.view.waveform) { plot.signal?.paint(context, layer, width); return; }
    const { frame, xAt } = plot;
    // Past the level axis a line leaves the plot (clipped), not along its edge.
    const yAt = plot.lineYAt ?? plot.yAt;
    const values = layer.view.values ?? [], xs = layer.view.xs ?? [];
    context.save();
    context.beginPath(); context.rect(frame.left, frame.top, frame.width, frame.height); context.clip();
    context.strokeStyle = layer.color;
    context.globalAlpha = layer.alpha ?? 1;
    context.lineWidth = width;
    if (layer.dash) context.setLineDash([...layer.dash]);
    if (layer.marks === 'dots') {
        // Each point a dot of the line's colour (its width the radius), the things a few points stand for.
        context.fillStyle = layer.color;
        values.forEach((value, index) => {
            if (value === null) return;
            context.beginPath(); context.arc(xAt(xs[index]), yAt(value), width, 0, 2 * Math.PI); context.fill();
        });
    } else if (layer.marks === 'rug') {
        // A short tick up from the plot's floor at each point, one per half pixel: many draw what can be seen.
        const ticks = new Set(xs.map(x => Math.round(xAt(x) * 2) / 2));
        context.beginPath();
        for (const x of ticks) { context.moveTo(x, frame.top + frame.height); context.lineTo(x, frame.top + frame.height - 5); }
        context.stroke();
    } else if (layer.view.kind === 'bar') {
        values.forEach((value, index) => {
            if (value === null) return;
            const [x0, x1] = barEdges(plot, xs[index]);
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

/** A time to the digits a pixel column of the plot tells apart (at least 10 ms). */
function timeText(plot: StagePlot, seconds: number): string {
    const perPixel = Math.abs(plot.xAt(1) - plot.xAt(0)) > 0 ? 1 / Math.abs(plot.xAt(1) - plot.xAt(0)) : 0.01;
    const digits = Math.max(2, Math.min(6, Math.ceil(-Math.log10(Math.max(perPixel, 1e-6)))));
    return secondsText(seconds, digits);
}

/** Whether (`x`, `y`) is inside the plot's frame: a point clipped off it is not on screen to pick. */
function onPlot(plot: StagePlot, x: number, y: number): boolean {
    const { left, top, width, height } = plot.frame;
    return x >= left && x <= left + width && y >= top && y <= top + height;
}

/**
 * The line of a pane nearest the pointer at (`x`, `y`) on its canvas, as the spectrum overlay picks it
 * (plotHover.ts): that line, its point and the readout (its name, where, its value).
 */
export interface StageRead {
    layer: StageLayer;
    x: number;
    y: number;
    text: string;
    name: string;
    values: string;
    image?: boolean;
    /** The point read: its index in the drawn line's values (−1 for a point of the full data, a signal's envelope point or an image's cell), and a signal's time. */
    index?: number;
    time?: number;
    /**
     * How far the point read is from the pointer, as nearestPoint orders it: a point within the pick radius by its
     * distance, any other (a line read at the pointer's column, its point perhaps held at the plot's edge) past the
     * radius. So the hits of two parts of a plot (its two level axes) are ordered as the hits of one are.
     */
    away?: number;
    /** Read from the layer's full data (fullRead.ts), not from what it draws: where it is on its axes and its value. */
    full?: boolean;
    at?: number;
    row?: number;
    value?: number;
    /** An image cell's row spacing (a spectrogram's bin width), so neighbouring rows read apart. */
    rowStep?: number;
    /** The full data around the pointer is still being fetched: the marks are shown, no number until it is in. */
    pending?: boolean;
}

/** A point a plot reads: where it is drawn, its value, where it is along its axis and its index in the drawn line. */
type ReadPoint = { index: number; time?: number; x: number; y: number; value: number; at: number; step?: number; full?: boolean };

/** Whether a layer drawn on a plot was given its full data (R7): every one is, held or fetched; nothing to read is none. */
export function declaresFullRead(layer: StageLayer): boolean {
    return (!!layer.full && layer.full !== NO_FULL_DATA) || layer.view.kind === 'none';
}

/**
 * A point of the full data on the plot: null where it has no value, or is silent. A signal's sample clipped off its
 * zoomed level axis is not picked by the pointer (null), but an arrow key steps to it all the same (`clipped` 'edge'),
 * held at the plot's edge as a line's value past its axis is: the keys step one sample at a time however it is zoomed.
 */
function fullPoint(plot: StagePlot, layer: StageLayer, points: FullPoints, index: number, clipped: 'skip' | 'edge' = 'skip'): ReadPoint | null {
    const value = points.values?.[index];
    const at = points.xs[index];
    if (value === null || value === undefined || at === undefined || silent(layer.view, value)) return null;
    const shown = layer.view.waveform ? plot.signal?.range : undefined;
    const off = !!shown && (value < shown.min || value > shown.max);
    if (off && clipped === 'skip') return null;
    const gaps = [at - points.xs[index - 1], points.xs[index + 1] - at].map(Math.abs).filter(gap => Number.isFinite(gap) && gap > 0);
    // Of a source the webview holds, the point's index in its every value (a histogram's bin, for its readout).
    const { top, height } = plot.frame;
    const y = off ? Math.min(top + height, Math.max(top, plot.yAt(value))) : plot.yAt(value);
    return { index: points.offset !== undefined ? points.offset + index : -1, at, x: plot.xAt(at), y, value, full: true, ...(layer.view.waveform ? { time: at } : {}), ...(gaps.length ? { step: Math.min(...gaps) } : {}) };
}

/**
 * A line's full-resolution points (R7) near the pointer at (`x`, `y`): those within `radius` and on the plot, and
 * the one nearest across to it (with none that near: zoomed past single points). undefined while they are fetched.
 */
function fullLineNear(plot: StagePlot, layer: StageLayer, source: FullSource, x: number, y: number, radius: number, ready: () => void): { near: ReadPoint[]; at: ReadPoint | null } | undefined {
    if (!source.line || !plot.xOf) return { near: [], at: null };
    // The pointer's place and the screen's scale there, so a window too dense to send whole holds the point nearest
    // the pointer by its true distance on screen (R7), not only each column's nearest in height.
    const place = plot.xOf(x), level = plot.levelOf?.(y);
    const lineY = plot.lineYAt ?? plot.yAt;
    const pixels: [number, number] | undefined = level === undefined ? undefined
        : [Math.abs(plot.xLog ? plot.xAt(place * Math.E) - plot.xAt(place) : plot.xAt(place + 1) - plot.xAt(place)), Math.abs(lineY(level + 1) - lineY(level))];
    const got = source.line({ x0: plot.xOf(x - radius), x1: plot.xOf(x + radius), beyond: 1, near: level, columns: 2 * radius + 1, log: !!plot.xLog, ...(pixels ? { at: place, pixels } : {}) }, ready);
    if (got === undefined) return undefined;
    if (!got?.xs.length) return { near: [], at: null };
    const near: ReadPoint[] = [];
    let at: ReadPoint | null = null;
    for (let index = 0; index < got.xs.length; index++) {
        const point = fullPoint(plot, layer, got, index);
        if (!point) continue;
        if (Math.abs(point.x - x) <= radius && onPlot(plot, point.x, (plot.lineYAt ?? plot.yAt)(point.value))) near.push(point);
        if (!at || Math.abs(point.x - x) < Math.abs(at.x - x)) at = point;
    }
    // Past the line's ends the pointer is over no point of it.
    const first = plot.xAt(got.xs[0]), last = plot.xAt(got.xs[got.xs.length - 1]);
    if ((got.start === null && x < first - 0.5) || (got.end === null && x > last + 0.5)) at = null;
    // A point off the plot (zoomed between two points) keeps its cursor at the plot's edge.
    if (at) at = { ...at, x: Math.max(plot.frame.left, Math.min(plot.frame.left + plot.frame.width, at.x)) };
    return { near, at };
}

/** The readout of `point` of `layer`, as every plot writes it (R7). */
function lineRead(plot: StagePlot, layer: StageLayer, point: ReadPoint, away?: number): StageRead {
    const view = layer.view;
    const full = { at: point.at, value: point.value, ...(point.full ? { full: true } : {}) };
    if (view.waveform) {
        // A signal reads its amplitude in its unit, to 3 figures, where its point is.
        const unit = view.waveform.unit || plot.signal?.unit;
        return { ...readoutOf(layer, point, layer.label ?? '', [timeText(plot, point.time ?? point.at), amountText(point.value, unit)]), index: -1, time: point.time ?? point.at, away, ...full };
    }
    if (layer.readout) return { ...readoutOf(layer, point, layer.label ?? '', layer.readout(point.index, { x: point.at, value: point.value, ...(point.full && point.step !== undefined ? { step: point.step } : {}) })), index: point.index, away, ...full };
    const amount = plot.diff ? signed(point.value, isDb(view))
        // Levels to 0.1 dB, as the spectrum overlay reads them; other quantities (a coherence) to 3 figures.
        : isDb(view) ? levelText(point.value, plot.levelUnit) : amountText(point.value, view.unit);
    const where = point.full ? atValue(view, point.at, undefined, point.step) : atText(view, point.index);
    return { ...readoutOf(layer, point, layer.label || (plot.diff ? 'Δ' : ''), [where, amount]), index: point.index, away, ...full };
}

/** What a read waiting for its layer's full data shows: the marks at the pointer, no number (R7). */
function pendingRead(layer: StageLayer, x: number, y: number, image = false): StageRead {
    return { layer, x, y, text: '', name: '', values: '', pending: true, ...(image ? { image: true } : {}) };
}

/**
 * The point the pointer at (`x`, `y`) reads (R7): of every line, the point nearest it within a few pixels, so a
 * narrow peak beside it is read at its top; else the line nearest in height at the pointer's column. A line with
 * a full-data source is read from its full-resolution points, never from what it draws: a point thinned out of the
 * line is read when it is the nearest. While any line's points near the pointer are fetched, the read is pending
 * (`ready` is called once they are in).
 */
export function stageHover(plot: StagePlot, x: number, y: number, ready: () => void = () => undefined): StageRead | null {
    if (plot.noReadout) return null;
    if (plot.image) return imageHover(plot, plot.image, x, y, ready);
    const fulls = new Map<StageLayer, { near: ReadPoint[]; at: ReadPoint | null }>();
    for (const layer of plot.lines) {
        const got = fullLineNear(plot, layer, layer.full, x, y, HOVER_PICK_RADIUS_PX, ready);
        if (got === undefined) return pendingRead(layer, x, y);
        fulls.set(layer, got);
    }
    // The point nearest the pointer within a few pixels, so a narrow peak beside it is read at its top (R7).
    const hit = nearestPoint<StageLayer, ReadPoint>(plot.lines, layer => fulls.get(layer)?.near ?? [], layer => fulls.get(layer)?.at ?? null, x, y, HOVER_PICK_RADIUS_PX);
    return hit ? lineRead(plot, hit.s, hit.point, hit.away) : null;
}

/**
 * What an arrow key reads `delta` along from `read` (R7), as the pointer on it would: of a line with full data, its
 * next full-resolution point (bin, sample, frame), however many share a pixel, at every zoom; of a line drawn whole,
 * its next value (a bar, a dot); of an image, the next column on the same row. Null past the end or off the plot;
 * undefined while the next points are fetched (`ready` is called once they are in).
 */
export function stageStep(plot: StagePlot, read: StageRead, delta: -1 | 1, ready: () => void = () => undefined): StageRead | null | undefined {
    if (read.pending) return null;
    if (read.image) {
        const source = read.layer.full;
        return plot.image && source.cells && read.full && read.at !== undefined && read.row !== undefined ? imageStep(plot, plot.image, source, read, delta, ready) : null;
    }
    const source = read.layer.full;
    if (read.full && read.at !== undefined) {
        // The first full point past the one read, in the key's direction, that has a value to read, however long the
        // silence before it: one read finds it (`seek`, full_read._seek_line) and brings STEP_AHEAD more past it, so
        // the next keys need none. Past the plot's side, or the data's end, there is nothing further to read.
        const at = read.at;
        const got = source.line?.({ x0: at, x1: at, beyond: STEP_AHEAD, seek: delta }, ready);
        if (got === undefined) return undefined;
        if (!got) return null;
        let index = -1;
        if (delta > 0) index = got.xs.findIndex(x => x > at);
        else for (let back = got.xs.length - 1; back >= 0 && index < 0; back--) if (got.xs[back] < at) index = back;
        for (; index >= 0 && index < got.xs.length; index += delta) {
            const point = fullPoint(plot, read.layer, got, index, 'edge');
            if (!point) continue;
            // Past the plot's side there is nothing further to read; a value above or below the level axis is read at
            // the plot's edge, where yAt holds it, as the pointer reads it there.
            if (point.x < plot.frame.left || point.x > plot.frame.left + plot.frame.width) return null;
            return lineRead(plot, read.layer, point);
        }
        return null;
    }
    return null;
}

/** The readout of an image's real cell (R7): its name (a row's thing, or the picture's), where it is and its value. */
function cellRead(plot: StagePlot, layer: StageLayer, got: FullPoints, column: number, row: number, x: number, y: number): StageRead | null {
    const view = layer.view;
    const value = got.matrix?.[row]?.[column];
    const at = got.xs[column], place = got.ys?.[row];
    if (value === null || value === undefined || at === undefined || place === undefined) return null;
    const amount = plot.diff ? signed(value, isDb(view)) : isDb(view) ? levelText(value, plot.levelUnit) : amountText(value);
    const where = layer.rowName ? atValue(view, at) : atValue(view, at, place, spacingAt(got.xs, column), spacingAt(got.ys, row));
    const name = got.rowNames?.[row] ?? layer.label ?? (plot.diff ? 'Δ' : '');
    const rowStep = spacingAt(got.ys, row);
    return { ...readoutOf(layer, { x, y }, name, [where, amount]), image: true, index: -1, full: true, at, row: place, value, ...(rowStep !== undefined ? { rowStep } : {}) };
}

/**
 * A heatmap's hover (R7): the cell under the pointer, read as its name (the row's, for rows that are things), where it
 * is and its value in the colour's unit. With full data it is the real cell there (one time frame, one frequency
 * bin), never a cell averaged for the screen. An image has no line to mark: the cursor alone, at the pointer.
 */
function imageHover(plot: StagePlot, image: NonNullable<StagePlot['image']>, x: number, y: number, ready: () => void): StageRead | null {
    const { layer } = image;
    const source = layer.full;
    if (!source.cells) return null;
    const place = image.valueAt(x, y);
    if (!place) return null;
    const got = source.cells({ x: place.x, y: place.y, beyond: 1 }, ready);
    if (got === undefined) return pendingRead(layer, x, y, true);
    if (!got?.xs.length || !got.ys?.length) return null;
    const column = cellIndex(got.xs, place.x, false, { low: got.start === null, high: got.end === null });
    const row = cellIndex(got.ys, place.y, image.rowLog, { low: true, high: true });
    return column < 0 || row < 0 ? null : cellRead(plot, layer, got, column, row, x, y);
}

/** An arrow key on an image with full data: the next real column (time frame) on the row read. */
function imageStep(plot: StagePlot, image: NonNullable<StagePlot['image']>, source: FullSource, read: StageRead, delta: -1 | 1, ready: () => void): StageRead | null | undefined {
    const at = read.at as number, place = read.row as number;
    const got = source.cells?.({ x: at, y: place, beyond: STEP_AHEAD }, ready);
    if (got === undefined) return undefined;
    if (!got?.xs.length || !got.ys?.length) return null;
    let from = 0;
    for (let index = 1; index < got.xs.length; index++) if (Math.abs(got.xs[index] - at) < Math.abs(got.xs[from] - at)) from = index;
    const row = cellIndex(got.ys, place, image.rowLog, { low: false, high: false });
    const column = from + delta;
    if (column < 0 || column >= got.xs.length) return null;
    const x = image.placeOf(got.xs[column], place).x;
    if (x < plot.frame.left || x > plot.frame.left + plot.frame.width) return null;
    return cellRead(plot, read.layer, got, column, row, x, read.y);
}

/** A hover's readout: the line's name (cut short first where there is no room) and where and what it reads. */
function readoutOf(layer: StageLayer, point: { x: number; y: number }, name: string, values: string[]): { layer: StageLayer; x: number; y: number; text: string; name: string; values: string } {
    return { layer, x: point.x, y: point.y, text: readoutText([...(name ? [name] : []), ...values]), name, values: readoutText(values) };
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
            context.fillText(secondsText(value), x + 3, plot.top + plot.height - 4);
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

function paintGuides(context: CanvasRenderingContext2D, guides: NonNullable<StagePaintOptions['guides']>, plot: { left: number; top: number; width: number; height: number }, xAt: (value: number) => number, yAt: (value: number) => number, text: string): void {
    context.save();
    context.beginPath(); context.rect(plot.left, plot.top, plot.width, plot.height); context.clip();
    context.fillStyle = text;
    context.globalAlpha = 0.08;
    for (const span of guides.spans ?? []) {
        const x0 = xAt(span.start), x1 = xAt(span.end);
        context.fillRect(x0, plot.top, Math.max(1, x1 - x0), plot.height);
    }
    if (guides.level) {
        context.globalAlpha = 0.9;
        context.strokeStyle = text;
        context.setLineDash([5, 3]);
        context.lineWidth = 1;
        const y = yAt(guides.level.value);
        context.beginPath(); context.moveTo(plot.left, y); context.lineTo(plot.left + plot.width, y); context.stroke();
        context.setLineDash([]);
        context.font = '10px sans-serif';
        context.fillText(guides.level.label, plot.left + plot.width - context.measureText(guides.level.label).width - 4, Math.max(plot.top + 10, y - 3));
    }
    context.restore();
}

/** The plot's margins on a pane (as paintOverlay leaves them without labels). */
export const STAGE_MARGINS: PlotMargins = { left: PANE_LEFT, top: 4, right: 4, bottom: 16 };

/** The pointer on a pane: its place on the plot, or which axis it is over. */
export function stagePlotPoint(canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>, clientX: number, clientY: number): { fx: number; fy: number; axis: 'x' | 'y' | null } {
    return plotPointIn(canvas, STAGE_MARGINS, clientX, clientY);
}
