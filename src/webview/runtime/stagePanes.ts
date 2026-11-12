/**
 * The comparison's three panes for one step of the chain: the base's, the compared file's and their
 * difference, each drawn as its Frame type is (stage_view.py): a line over time, log frequency or
 * quefrency, a cross-correlation over lag, bars per band, an image over time and frequency, Bark or quefrency. The base
 * of a group (its median) and a difference are taken by the backend from the Frames' full resolution
 * (combineSource.ts) and drawn here like any picture; without one the Δ pane says why it is empty. Pure apart
 * from `paintStage`, which only draws.
 */
import { colourScale, fieldWindow, uncalibratedWord, type FigureAxis, type FigureNames, type FigureRange, type FigureTitle } from './figureModel';
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { UiStrings } from '../../shared/i18n/strings';
import { BAND_CENTERS_HZ } from './entryTable';
import { paneAxes, type LevelInput, type PaneRange } from './comparePanes';
import { PANE_LEFT } from './paneLayout';
import { uncalibratedUnits } from '../../shared/utils/format';
import { middleEllipsis } from '../../shared/dataset/datasetTable';
import type { NormalizedRange } from './waveformInteraction';
import { plotPointIn, type PlotMargins } from './plotInteraction';
import { HOVER_PICK_RADIUS_PX, nearestPoint } from './plotHover';
import { clippedPath, nearPlot } from '../plot/lineClip';
import { paintWaveformLayer, waveformRange, type PlotBox, type SignalPointSink } from '../plot/waveformLayer';
import { packRgb, paletteColour, rasterizeHeatmap, unpackRgb } from '../plot/heatmapRaster';
import { readoutText, type AxisTick, type Palette } from '../../shared/gui-core/index';
import { axisName, axisNameParts, fitAxisTitle, fontPixels, scaledFont } from '../plot/axisTitle';
import { HEATMAP_DB_SPAN, heatmapDbRange, niceRange, niceTicks } from '../../shared/utils/ticks';
import { amountText, barkText, colourDecimals, exactDecimals, frequencyText, lagText, levelText, quefrencyText, secondsText, signedText, spacingDecimals, stepText, withMinus } from '../plot/plotText';
import type { Whole, WholeLine } from '../../shared/provenance';
import { drawableLine, drawableRows } from '../../shared/drawnPoints';
import { backendPeak } from './wholeAnswers';
import { axisMeasure, cellEdgeValues, cellEdges, cellIndex, readsFullData, STEP_AHEAD, type FullPoints, type FullRead, type FullSource, type LevelAnswer, cannotRead } from './fullRead';

/** Canvas x the level axis's turned title is centred on, in the gutter left of its tick labels. */
const AXIS_TITLE_X = 10;

export type StageStrings = Pick<UiStrings, 'axisFrequency' | 'axisTime' | 'axisTriggerTime' | 'axisBand' | 'axisBark' | 'axisQuefrency' | 'axisCepstrum' | 'axisLag' | 'axisCorrelation' | 'axisLevelUncal' | 'axisLevelCal' | 'axisDelta' | 'dsValue' | 'axisGain' | 'axisTransferLevel' | 'axisCoherence' | 'legendHeadline' | 'legendLeak' | 'legendLine' | 'stageNoDelta' | 'stageEventCounts' | 'stageNoEvents' | 'stageMaxDelta' | 'stepNotDrawable' | 'waveRangeAxisAmplitude' | 'stagePairBase' | 'axisLoudness' | 'axisSharpness' | 'axisRoughness' | 'axisSpecificRoughness' | 'axisLevelOf' | 'axisRms' | 'axisRmsTimeWeighted' | 'axisPower' | 'axisRaised' | 'axisQuantityUnknown' | 'axisUncalibrated' | 'axisUnitUnknown'>;

const DB_QUANTITIES = ['level', 'gain'];
const isDb = (view: StageView | null): boolean => DB_QUANTITIES.includes(view?.quantity ?? '');

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
        const full: FullRead = layer.full.event(event.id);
        return { ...rest, ofEvents: true as const, view: { ...view, xs: event.xs, values: event.values }, width: Math.min(layer.width ?? 1.5, 1.2), alpha: out ? 0.25 : 0.85, label: `${layer.label ? `${layer.label} ` : ''}#${event.id + 1}${at}`, ...(source !== undefined ? { event: { id: event.id, source, out } } : {}), full };
    });
}

/**
 * Whether a line's values have no silent floor. Only a level (or a gain) in dB has one: the backend floors silence and
 * an undefined level at −300 dB, and −250 and below is that silence. Every other value reads −250 and below as the
 * value it is, decided by what the picture measures: a difference (`diff`, a Δ of levels too: −260 dB is a Δ), a plain
 * value (a signal's samples, a metric over time, a trigger's events' amplitudes), a coherence, a cepstrum, a
 * correlation, a roughness. The pointer, the arrow keys' seek (fullRead.ts, full_read.py: LineQuery.plain), the
 * drawing and the range take this one definition (as the backend's value_range does).
 */
export const floorless = (view: Pick<StageView, 'quantity' | 'waveform'>, diff = false): boolean =>
    diff || !!view.waveform || !FLOORED_QUANTITIES.includes(view.quantity ?? 'level');

/** The quantities floored at −300 dB by the backend (a level, a gain; a picture that names none is a level). */
const FLOORED_QUANTITIES: ReadonlyArray<NonNullable<StageView['quantity']>> = ['level', 'gain'];

/** A silent stretch at the floor (−300 dB) is drawn as a gap; a value with no floor (floorless) is drawn. */
const silent = (view: StageView, value: number, diff = false): boolean => value <= -250 && !floorless(view, diff);

/**
 * The lowest and highest value of the pictures: each one's `valueRange`, taken of its every full-resolution value
 * before any is thinned or averaged into a cell (R1). The backend sends one with every picture
 * (stage_combine.value_range: silence and a cepstrum's zero quefrency left out); a picture the webview makes of
 * values it holds whole carries its own (fullRead.heldValueRange). A picture without one adds nothing: the points
 * drawn are typed `Drawn` and never set a range.
 */
function extent(views: ReadonlyArray<StageView | null>): { low: number; high: number } {
    let low = Infinity, high = -Infinity;
    for (const view of views) {
        if (!view?.valueRange) continue;
        low = Math.min(low, view.valueRange.min); high = Math.max(high, view.valueRange.max);
    }
    return { low, high };
}

/**
 * The 99th percentile of the coefficients' magnitudes, as wandas' cepstrogram plot sets its colour range: of every
 * full-resolution coefficient (`valueRange.robust`, which the backend sends with every cepstrogram), the largest of
 * the pictures'. Never of the cells drawn, which are block averages (A28, R1): with none sent there is no edge (0).
 */
function robustEdge(views: ReadonlyArray<StageView | null>): number {
    const full = views.map(view => view?.valueRange?.robust).filter((edge): edge is number => edge !== undefined && Number.isFinite(edge));
    return full.length ? Math.max(...full) : 0;
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
        // Every value of the full data, each end rounded outward to the step (an end already on one stays put), so at
        // most a step of slack on each side; but never more than 100 dB (as a heatmap's colours): the top rounded up,
        // the bottom at most 100 dB under it, exactly. The step is the finest round one that gives at most six steps
        // (−49.5…−9.5 dB: 10 dB, −50…0). Each step divides 100, so a capped bottom is on it too.
        const edges = (step: number): { min: number; max: number } => {
            const max = Math.ceil(high / step) * step || 0;
            return { min: Math.max(Math.floor(low / step) * step, max - HEATMAP_DB_SPAN) || 0, max };
        };
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
    // says it is uncalibrated as the level axis does. After rms_trend, sound_level or power it names that measure,
    // raised to the power the backend sent (stage_view.signal_measure), or says the quantity is not known.
    const linear = (unit: string | undefined): string => amplitudeAxisTitle(strings, unit, input, view?.measure, true, view?.measureExponent);
    // Its Δ is compare − base sample by sample (a ChannelFrame subtraction), in the same unit.
    if (view?.waveform) return { x, y: diff ? `Δ ${linear(view.waveform.unit)}` : linear(view.waveform.unit) };
    // A trigger's events are their signals: amplitude in the signal's unit, as a waveform's.
    if (isEventsView(view)) return { x, y: linear(view?.unit) };
    // rms_trend's series is its own values (a metric's series), in the signal's unit; so is a series no step names:
    // the signal's amplitude, never a bare "value" (only a quantity the backend says is not known is one, R4).
    if (view?.quantity === 'value' && (view.measure || (view.x === 'time' && !namedByUnit(view.unit)))) return { x, y: diff ? `Δ ${linear(view.unit)}` : linear(view.unit) };
    // A level over time (sound_level or rms_trend in dB) names what it is the level of, in the files' reference.
    if (view?.quantity === 'level' && view.x === 'time') return { x, y: view.measure === 'unknown' ? unknownQuantityTitle(strings) : timeLevelTitle(strings, input, view.measure) };
    const y = view?.quantity === 'level' ? paneAxes(strings, input).level.y
        // A transfer function of two units is a transfer level in dB re their ratio, named as the pair view names it (A33).
        : view?.quantity === 'gain' ? (view.unit ? strings.axisTransferLevel.replace('{unit}', view.unit) : strings.axisGain)
            : view?.quantity === 'coherence' ? strings.axisCoherence
                : view?.quantity === 'cepstrum' ? strings.axisCepstrum
                    : view?.quantity === 'correlation' ? strings.axisCorrelation
                    : metricAxisName(strings, view?.unit);
    // A cross-channel Frame names its pair, after its quantity and before its unit: which channel over which
    // reference, or the recording over the base slot's.
    const pair = view?.pair?.base ? ` · ${strings.stagePairBase}` : view?.pair ? ` · ch${view.pair.output} / ch${view.pair.input}` : '';
    // A gain or transfer level is calibrated only when both sides of its pair are (figureModel.pictureLevelOf): an
    // uncalibrated pair says so, as every level does (R4).
    const uncal = view?.quantity === 'gain' && input && input.calibrationStatus !== 'calibrated' ? uncalibratedWord(strings) : '';
    const parts = axisNameParts(y);
    const named = parts ? axisName(`${parts.quantity}${uncal}${pair}`, parts.unit) : `${y}${uncal}${pair}`;
    return { x, y: diff ? `Δ ${named}` : named };
}

/**
 * A time signal's amplitude axis, in its unit (full scale, or raw input units without one), saying whether it is
 * calibrated as the level axis does; after rms_trend, sound_level or power it names that measure, raised to
 * `exponent` when the backend sent one ("Amplitude^3 [Pa³]"). A quantity the backend could not tell ("unknown") is
 * "Value [unit unknown]": no quantity and no unit claimed, never "Amplitude" (R4). Compare's waveform panes and the
 * track lanes name their amplitude axis by it.
 */
export function amplitudeAxisTitle(strings: Pick<StageStrings, 'axisRms' | 'axisRmsTimeWeighted' | 'axisPower' | 'axisRaised' | 'axisQuantityUnknown' | 'waveRangeAxisAmplitude' | 'axisUncalibrated' | 'axisUnitUnknown'>, unit: string | undefined, input: LevelInput | undefined, measure?: StageView['measure'], sent = false, exponent?: number): string {
    if (measure === 'unknown') return unknownQuantityTitle(strings);
    const quantity = measure === 'rms' ? strings.axisRms : measure === 'timeWeightedRms' ? strings.axisRmsTimeWeighted : measure === 'power' ? strings.axisPower : strings.waveRangeAxisAmplitude;
    const name = exponent === undefined || exponent === 1 ? quantity : strings.axisRaised.replace('{quantity}', quantity).replace('{p}', exponentText(exponent));
    // Without an input nothing says what the values are relative to: the unit is not known, never a guessed FS (R4).
    // A picture's unit is the backend's (stage_view.signal_unit, after every operation): none sent is none claimed.
    if (!unit && (sent || !input)) return `${name} [${strings.axisUnitUnknown}]`;
    // The unit is written as given: a power's is already the unit raised (Pa²), never edited here.
    const shown = unit || uncalibratedUnits(!input || input.fullScale).linear;
    return `${name}${input?.calibrationStatus === 'calibrated' ? '' : strings.axisUncalibrated} [${shown}]`;
}

/** A quantity the backend could not tell, and so no unit either (stage_view.signal_measure "unknown"). */
function unknownQuantityTitle(strings: Pick<StageStrings, 'axisQuantityUnknown' | 'axisUnitUnknown'>): string {
    return axisName(strings.axisQuantityUnknown, strings.axisUnitUnknown);
}

/** An exponent as the backend writes it in the unit (Python's `:g`: 3, 0.5, 0.333333). */
function exponentText(exponent: number): string {
    return String(Number(exponent.toPrecision(6)));
}

/** Whether a metric's unit names what it measures (loudness in sone, …, a level in dB). */
function namedByUnit(unit: string | undefined): boolean {
    return unit === 'sone' || unit === 'acum' || unit === 'asper' || unit === 'asper/Bark' || !!unit?.startsWith('dB');
}

/**
 * A level over time's axis: the level of an RMS over a window, of a time-weighted one, or a level, in the files'
 * reference, saying it is uncalibrated as every level axis does ("Time-weighted RMS, uncalibrated [dBFS]").
 */
function timeLevelTitle(strings: StageStrings, input: LevelInput | undefined, measure: StageView['measure']): string {
    const name = measure === 'rms' ? strings.axisRms : measure === 'timeWeightedRms' ? strings.axisRmsTimeWeighted : strings.axisLevelOf;
    // Without an input no reference is known: the axis says so, never a guessed dBFS (R4).
    if (!input) return `${name} [${strings.axisUnitUnknown}]`;
    return `${name}${input.calibrationStatus === 'calibrated' ? '' : strings.axisUncalibrated} [${input.levelReferenceLabel}]`;
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
    // Per Bark band (roughness_dw_spec): the specific roughness, told apart from the total over time.
    if (unit === 'asper/Bark') return strings.axisSpecificRoughness;
    if (unit?.startsWith('dB')) return strings.axisLevelOf;
    // Any other value a step gives is in the signal's unit: its amplitude (the backend names no other kind).
    return strings.waveRangeAxisAmplitude;
}

const hz = frequencyText;
const signed = signedText;

/**
 * A value of `view` as every readout and headline writes it (R4, R7): a Δ signed, in dB or in the view's own unit; a
 * level to 0.1 dB in the plot's level unit; any other amount (a coherence, a roughness) to 3 figures in its unit.
 */
function valueText(view: StageView, value: Whole, diff: boolean, levelUnit?: string): string {
    if (diff) return signed(value, isDb(view), view.unit);
    return isDb(view) ? levelText(value, levelUnit ?? view.unit ?? '') : amountText(value, view.unit);
}
const quefrency = quefrencyText;
const lag = lagText;

/** The gap from a point to its nearer neighbour, so a readout writes the digits that tell the two apart (R7). */
function spacingAt(values: readonly number[] | undefined, index: number): number | undefined {
    if (!values) return undefined;
    const gaps = [values[index] - values[index - 1], values[index + 1] - values[index]].map(Math.abs).filter(gap => Number.isFinite(gap) && gap > 0);
    return gaps.length ? Math.min(...gaps) : undefined;
}

/**
 * The decimals a time needs so that points `step` s apart never read the same (R7, as a frequency's do): at least
 * 10 ms, to the nanosecond at most (a hop of 256 at 48 kHz, 5.3 ms apart: "1.008 s", "1.013 s").
 */
export const timeDigits = (step?: number): number => spacingDecimals(step, 2, 9);

/** A point of the full data on `view`'s axes, in their units: "1 kHz", "1.00 s · 100 Hz". Never a drawn point's place (R7). */
function atValue(view: StageView, x: Whole, y?: Whole, xStep?: number, yStep?: number): string {
    const along = view.x === 'time' ? secondsText(x, timeDigits(xStep)) : view.x === 'quefrency' ? quefrency(x, xStep) : view.x === 'lag' ? lag(x, xStep) : hz(x, xStep);
    if (y === undefined) return along;
    return `${along} · ${view.yAxis === 'bark' ? barkText(y) : view.yAxis === 'quefrency' ? quefrency(y, yStep) : hz(y, yStep)}`;
}

/**
 * The Δ pane's headline: where the difference is largest over the part on screen, or why there is none. The place
 * and value are the backend's (`peak`, stage_combine.difference_peak), found among every value before thinning (R2):
 * never the largest of the points drawn.
 */
export function stageHeadline(diff: StageView | null, strings: Pick<StageStrings, 'stageNoDelta' | 'stageMaxDelta'>, ofWindow = true): string {
    // Zoomed, the backend's peak is of the window on screen (stage_combine._on_screen) once that window's difference
    // is in; until then no point is named (C4), never one off screen or of an earlier window.
    if (!ofWindow) return '';
    const peak = diff ? backendPeak(diff) : undefined;
    if (!diff || !peak) return strings.stageNoDelta;
    const at = atValue(diff, peak.x, diff.matrix ? peak.y : undefined, peak.xStep, peak.yStep);
    return strings.stageMaxDelta.replace('{at}', at).replace('{delta}', valueText(diff, peak.value, true));
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

/**
 * The part of an axis on screen: `window` (fractions of the whole axis) stretched across the plot. A zoomed window's
 * ends are made at the decimals its range popover writes (figureModel.fieldWindow, R9): the plot is painted from
 * `low` and `high`, and the popover writes these very numbers. The whole axis keeps its own ends.
 */
function windowed(scale: AxisScale, window: NormalizedRange = FULL_WINDOW): AxisScale {
    const kept = { min: window.start === 0, max: window.end === 1 };
    const ends = fieldWindow(kept.min ? scale.low : scale.at(window.start), kept.max ? scale.high : scale.at(window.end), kept);
    const start = kept.min ? 0 : scale.fraction(ends.min), end = kept.max ? 1 : scale.fraction(ends.max);
    const span = end - start || 1;
    return {
        low: ends.min, high: ends.max, log: scale.log,
        fraction: value => (scale.fraction(value) - start) / span,
        at: fraction => (fraction === 0 ? ends.min : fraction === 1 ? ends.max : scale.at(start + fraction * span)),
    };
}

/**
 * The ends a linear axis from `low` to `high` is painted with over the part `window` (fractions of it): the numbers
 * paintOverlay paints such an axis from and records (StagePlot.xRange), for what is drawn beside a plot on the same
 * axis (the lanes' time ruler) and the range popover that types it.
 */
export function linearWindowEnds(low: number, high: number, window: NormalizedRange): { min: number; max: number } {
    const shown = windowed({ low, high, log: false, fraction: value => (value - low) / (high - low || 1), at: fraction => low + fraction * (high - low) }, window);
    return { min: shown.low, max: shown.high };
}

/** The part of the whole axis `scale` a windowed axis paints, as fractions of it: its window at the field's numbers. */
function paintedPart(scale: AxisScale, shown: AxisScale): NormalizedRange {
    return { start: shown.low === scale.low ? 0 : scale.fraction(shown.low), end: shown.high === scale.high ? 1 : scale.fraction(shown.high) };
}

/** Where a value of the picture's horizontal axis sits on it (0–1 across the whole axis), and back. */
export function axisFractionOf(view: AxisView, value: number): number { return axisScale(view).fraction(value); }
export function axisValueAt(view: AxisView, fraction: number): number { return axisScale(view).at(fraction); }
/**
 * Overlaid lines in drawing order by level over the shown part of the axis: the loudest first, the quietest last on
 * top, so a louder recording does not cover a quieter one. A line's level is the power of its every value inside the
 * part on screen (R6), from the values before the line was thinned to be drawn (R2): a signal's mean square on the
 * amplitude axis the signals share, a spectrum's power mean of its dB (screenLevels). Which of the two is the backend's
 * to say (`levelBins.of`), and is used unchanged at every zoom. The drawn points are never
 * measured. Lines with no level (not a level, or nothing shown) keep their place among themselves after the rest; the
 * colours and the legend are not changed.
 */
export function byLevel(layers: StageLayer[], axisView: AxisView | undefined, window: NormalizedRange = FULL_WINDOW, levels: ReadonlyMap<StageLayer, ScreenLevel> = screenLevels(layers, axisView, window)): StageLayer[] {
    const level = (layer: StageLayer): number => levels.get(layer)?.level ?? -Infinity;
    return layers.map((layer, index) => ({ layer, index, level: level(layer) }))
        .sort((a, b) => (b.level === a.level ? a.index - b.index : b.level - a.level))
        .map(item => item.layer);
}

/**
 * A compared line's level over the part of the axis on screen (dB; −Infinity for none), and how it is known:
 *
 * - 'exact': from every value inside the part on screen. Only these settle the order (settledOrder).
 * - 'pending': those values are being fetched. `level` is an estimate (the stretches' share on screen), never used to
 *   settle the order.
 * - 'failed': the read of those values failed. Nothing is known of the level (−Infinity, no estimate): the order
 *   stays unsettled, exactly as while pending, and the read is asked again after the answer store's pause
 *   (fetchedSource, answerStore FAILED_RETRY_MS), which draws the plot again.
 * - 'unmeasured': a level or signal with no values before thinning to measure at all (a caller's mistake, which the
 *   ui-smoke audit fails).
 * - 'none': a line that is not a level; it keeps its place.
 */
export interface ScreenLevel { level: number; state: 'exact' | 'pending' | 'failed' | 'unmeasured' | 'none' }

/** Whether a line's level is not known yet (being fetched, or its read failed): the plot's order is then not settled. */
const levelUnsettled = (level: ScreenLevel): boolean => level.state === 'pending' || level.state === 'failed';

/**
 * Each line's ScreenLevel. A line's `levelBins` (the backend's, or levelBinsOf) give it at once while every stretch
 * holding values is wholly on screen or wholly off it; a stretch the screen's edge cuts cannot say which of its values
 * are on screen, so the line is measured from its full data instead (`full`, fullRead.ts): its drawn points when they
 * are all its points, else every value of the window, read where the data is (`ready` is called once a fetched one is
 * in). A line with no levelBins is measured so only when it says so (`measured`).
 *
 * What the level is (a mean square of samples, or a power mean of dB) is the one quantity its levelBins say (`of`, set
 * by the backend's stage_combine.level_bins or by levelBinsOf), whole and zoomed alike: the exact read of a cut window
 * asks for that same quantity, never one guessed from which fields the picture has (a trigger's events have no
 * `waveform`, yet are samples). A `measured` line with no bins is a level in dB (a cursor slice).
 */
export function screenLevels(layers: readonly StageLayer[], axisView: AxisView | undefined, window: NormalizedRange = FULL_WINDOW, context: { ready?: () => void } = {}): Map<StageLayer, ScreenLevel> {
    const scale = axisView && axisExtent(axisView) ? axisScale(axisView) : null;
    const whole = window.start <= 0 && window.end >= 1;
    const dB = (sum: { power: number; count: number }): number => (sum.count && sum.power > 0 ? 10 * Math.log10(sum.power) : -Infinity);
    const levels = new Map<StageLayer, ScreenLevel>();
    for (const layer of layers) {
        const { view } = layer;
        const bins = view.levelBins;
        if (!bins && !layer.measured) {
            // A trigger's events are their recording's signal, ordered by their samples (A44): unmeasured without bins.
            levels.set(layer, { level: -Infinity, state: isDb(view) || !!view.waveform || !!view.events || !!layer.ofEvents ? 'unmeasured' : 'none' });
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
        const own = scale ? null : axisExtent(view);
        const ends: [number, number] | null = scale ? [scale.at(window.start), scale.at(window.end)] : own ? [own.first, own.last] : null;
        const full = layer.full;
        let sum: LevelAnswer = null;
        if (ends && full.level !== cannotRead) sum = full.level({ x0: ends[0], x1: ends[1], square: bins?.of === 'square' }, context.ready ?? (() => undefined));
        // null from data the backend holds is a read that failed (as a line's read, fullLineNear): not a level of 0 and
        // not the estimate. From a source with no level to give, there is nothing to measure.
        const failed = sum === null && full.held === 'fetched' && full.level !== cannotRead && !!ends;
        levels.set(layer, sum === undefined ? { level: estimate, state: 'pending' }
            : failed ? { level: -Infinity, state: 'failed' }
            : sum === null ? { level: estimate, state: 'unmeasured' } : { level: dB(sum), state: 'exact' });
    }
    return levels;
}

/**
 * A line's levelBins (see byLevel) from the values it has before thinning, for a line the webview holds in full (the
 * cursor spectrum's slice): its dB values' power in `bins` stretches of `span` on its axis, silence as no power
 * (`of: 'dbPower'`, as the backend's level_bins says of a level's).
 */
export function levelBinsOf(xs: ArrayLike<number>, values: WholeLine, span: readonly [number, number], log: boolean, bins = 256): NonNullable<StageView['levelBins']> {
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
    return { of: 'dbPower', edges, power: power.map((sum, i) => (count[i] ? sum / count[i] : 0)), count };
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
export function overlayOrder(layers: readonly StageLayer[], axisView: AxisView | undefined, window: NormalizedRange = FULL_WINDOW, levels?: ReadonlyMap<StageLayer, ScreenLevel>): StageLayer[] {
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
 * The order a plot draws in (R6) while a line's level is not known (still being fetched, or its read failed): never
 * one guessed from part of it. The order last judged on every value (its lines in those places, a line it did not
 * hold after them, in the caller's order), else the caller's own until the levels are in; once every level is in,
 * `exact`, and that is kept.
 */
function settledOrder(canvas: object, axis: 'main' | 'secondary', layers: readonly StageLayer[], exact: StageLayer[], levels: ReadonlyMap<StageLayer, ScreenLevel>): StageLayer[] {
    const kept = settledOrders.get(canvas) ?? {};
    if (![...levels.values()].some(levelUnsettled)) {
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
export function drawnLevelsText(drawn: readonly StageLayer[], axisView: AxisView | undefined, window: NormalizedRange = FULL_WINDOW, levels?: ReadonlyMap<StageLayer, ScreenLevel>): string {
    const lines = drawn.filter(comparedLine);
    if (lines.length < 2) return '';
    const measured = levels ?? screenLevels(lines, axisView, window);
    // A level (or a signal) with no values before thinning to measure could only be ordered by its drawn points:
    // written as '?', which the audit fails on every plot shown (R2, R6). One whose values are still being fetched is
    // written as '…', one whose read failed as '!': the audit waits for both, and fails a plot that stays so.
    return lines.map(layer => {
        const level = measured.get(layer) ?? { level: -Infinity, state: 'none' };
        if (level.state === 'unmeasured') return '?';
        if (level.state === 'pending') return '…';
        if (level.state === 'failed') return '!';
        return Number.isFinite(level.level) ? level.level.toFixed(2) : '-inf';
    }).join(',');
}
/** The same for a heatmap's rows (frequency, Bark or quefrency). */
export function rowFractionOf(view: StageView, value: number): number { return rowScale(view).fraction(value); }
export function rowValueAt(view: StageView, fraction: number): number { return rowScale(view).at(fraction); }
const rowScale = (view: StageView): AxisScale => axisScale({ xs: view.ys, xSource: view.ySource, xLimits: view.yLimits, xScale: view.yAxis === 'frequency' ? 'log' : 'linear' });

/** What an axis's range is taken from: a picture's source axis, stated limits, and its places for a held picture. */
type AxisView = Pick<StageView, 'xs' | 'xScale' | 'xLimits' | 'xSource'>;

/**
 * Where an axis's values start and end, and the second one (for a log axis's ratio): the backend's source axis
 * (`xSource`, `ySource`), taken of the data before it was thinned and whatever part is drawn (display rules R2). The
 * first and last drawn points are not the data's ends. A picture with no source axis is one the webview made of every
 * value it holds (a cursor spectrum's slice, the entry plots): its places are its data, and only for it are they read.
 * Null for an axis with no values.
 */
function axisExtent(view: AxisView): { first: number; second: number | undefined; last: number } | null {
    const source = view.xSource;
    if (source) return { first: source.first, second: source.step !== undefined ? source.first + source.step : undefined, last: source.last };
    const held = view.xs ?? [];
    return held.length ? { first: held[0], second: held.length > 1 ? held[1] : undefined, last: held[held.length - 1] } : null;
}

/**
 * A log axis spans its stated limits (a spectrum drawn as its own bins, a spectrogram's rows), or else the edges of
 * its geometric places from the first to the last (half a ratio beyond each); a linear one its first to last value.
 * Both from the axis's source (`axisExtent`), never from the drawn points.
 */
function axisScale(view: AxisView): { low: number; high: number; log: boolean; fraction(value: number): number; at(fraction: number): number } {
    const extent = axisExtent(view);
    const limits = view.xLimits;
    const stated = limits?.length === 2 && limits[0] > 0 && limits[1] > limits[0] ? { low: limits[0], high: limits[1] } : null;
    // Half a ratio beyond the first and last source place: a band axis's edges.
    const ratio = extent && extent.first > 0 && extent.second !== undefined && extent.second > extent.first ? Math.sqrt(extent.second / extent.first) : null;
    const ends = stated ?? (extent && ratio !== null ? { low: extent.first / ratio, high: extent.last * ratio } : null);
    const log = view.xScale === 'log' && ends !== null;
    if (log && ends) {
        const { low, high } = ends;
        return { low, high, log, fraction: value => Math.log(value / low) / Math.log(high / low), at: fraction => low * (high / low) ** fraction };
    }
    const low = extent?.first ?? 0;
    const high = extent && extent.last > low ? extent.last : low + 1;
    return { low, high, log, fraction: value => (value - low) / (high - low || 1), at: fraction => low + fraction * (high - low) };
}

function ticks(low: number, high: number, log: boolean): number[] {
    if (log) {
        const inside = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(value => value > low * 1.05 && value < high * 0.95);
        if (inside.length > 1) return inside;
        // Zoomed between two of them: round values inside the window (1001, 1002, … Hz), each written where it is
        // (tickTexts), so no tick names a frequency it is not at.
        return niceTicks(low, high, 4).filter(value => value > 0 && value >= low && value <= high);
    }
    return niceTicks(low, high, 8);
}

/** The text every plot's axes are written in: Compare's panes, the entry's plots and the track lanes' axes. */
export const PLOT_TEXT_FONT = '10px sans-serif';

/** How tall a tick label is (PLOT_TEXT_FONT's size), and the least room left between two on one axis. */
export const TICK_LABEL_PX = 10;
const TICK_LABEL_GAP_PX = 2;

/**
 * Where a value axis's tick label is drawn up an axis `height` px tall, from its top: as paintValueTicks sets it, the
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
    // In powers of ten, to the figures that tell ticks a step apart (a window of a few millionths around 0.0897:
    // "8.96728e−2", "8.96730e−2"), at most 15 (as many as a double holds).
    const largest = Math.max(...values.map(Math.abs));
    const figures = Math.min(15, Math.max(6, Math.ceil(Math.log10(largest / step) - 1e-9) + 1));
    if (decimals > 5) return value => (value === 0 ? '0' : minus((+value.toPrecision(figures)).toExponential()));
    return value => minus(decimals ? value.toFixed(decimals) : String(Math.round(value)));
}

/**
 * A heatmap's row axis ticks between `low` and `high` (fractions up the axis): at a log axis's round values, or on a
 * linear one as many as `height` px is tall for. Compare's heatmaps and the track spectrogram lanes use it.
 */
export function rowAxisTicks(low: number, high: number, log: boolean, height: number, text?: (value: number) => string): Array<AxisTick & { value: number }> {
    const span = high - low || 1;
    const values = log ? ticks(low, high, true) : niceTicks(low, high, Math.max(2, Math.min(8, Math.floor(height / 22))));
    const texts = tickTexts(values, log);
    const drawn = values.map((value, index) => ({ value, text: text?.(value) ?? texts[index], fraction: log ? Math.log(value / low) / Math.log(high / low) : (value - low) / span }));
    // A caller's own text (a table's whole row numbers) may write two ticks alike: each number is written once (C3).
    return drawn.filter((tick, index) => drawn.findIndex(other => other.text === tick.text) === index);
}

/** A time or frequency axis's ticks between `low` and `high` (a log frequency axis's at its round values), with their text. */
export function alongAxisTicks(low: number, high: number, log = false): Array<{ value: number; text: string }> {
    const values = ticks(low, high, log);
    const texts = tickTexts(values, log);
    // A window finer than the digits' cap (under a nanosecond) writes each number once, as rowAxisTicks does (C3).
    return values.map((value, index) => ({ value, text: texts[index] })).filter((tick, index) => texts.indexOf(tick.text) === index);
}

// A negative tick (a lag, the time from a trigger) with a true minus, as every number a plot writes (plotText.ts).
/**
 * An axis's tick texts, each to the digits that tell it from its neighbours (plotText.ts spacingDecimals, the rule
 * every readout's digits follow), so two ticks never read the same and none reads a value it is not at. A log
 * frequency axis writes kHz from 1 kHz ("500", "1k", "1.002k"), all of a window under a decade that crosses 1 kHz
 * in kHz ("0.998k", "1k"), never "1000" beside "1k". A negative tick (a lag, the time from a trigger) with a true minus.
 */
export function tickTexts(values: readonly number[], log: boolean): string[] {
    const gaps = values.slice(1).map((value, index) => Math.abs(value - values[index])).filter(gap => gap > 0);
    const step = gaps.length ? Math.min(...gaps) : undefined;
    if (!log) return values.map(value => (step === undefined ? withMinus(String(value)) : stepText(value, step)));
    const low = Math.min(...values), high = Math.max(...values);
    const allK = high >= 1000 && low < 1000 && high / low < 10;
    return values.map(value => (value >= 1000 || allK ? `${stepText(value / 1000, step === undefined ? undefined : step / 1000)}k` : stepText(value, step)));
}
/**
 * An end of a colour bar, written as the very number the colours are painted from (R9): with as many decimals as its
 * span needs (colourDecimals: cepstral coefficients need four or five), and never fewer than the end itself has
 * (exactDecimals), so a range typed as −23.5 to 0 reads −23.5, not −23 (A31, C5), and 1000000.5 reads 1000000.5.
 * It only writes, it never rounds: an automatic scale's ends are made at the span's decimals where the range is made
 * (figureModel.colourScale), so they are written no longer than the span needs.
 */
export function colourEndText(value: number, span: number): string {
    let decimals = Math.min(100, Math.max(colourDecimals(span), exactDecimals(value)));
    let text = value.toFixed(decimals);
    // Written past its shortest digits, an end next to a power of two can land outside its own rounding interval.
    while (Number(text) !== value && decimals < 100) text = value.toFixed(++decimals);
    return withMinus(Number(text) === 0 ? text.replace(/^-/u, '') : text);
}

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
    /** The recording the line is of: its reference and calibration name the axis it is read on (C1). */
    recording?: string;
    /** What a line of no one recording (a base group's median) has its levels in: its recordings' (C1, R1). */
    levelInput?: LevelInput;
    /** A dash pattern (px) for a line told apart by more than its colour: one read on the second level axis. */
    dash?: readonly number[];
    /** The recording a trigger's events are of, whose events a click leaves out (or puts back), and those left out. */
    source?: string;
    excluded?: readonly number[];
    /** One event of `source` (eventLayers'), and whether it is left out. */
    event?: { id: number; source: string; out: boolean };
    /** A line of a trigger's events (eventLayers'): a signal, ordered by its samples' power (R6, A44). */
    ofEvents?: true;
    /** What the readout says of the point at `index` of the drawn line (−1 for a point of the full data, at `point.x`), in place of where and how much (a histogram's bin and its count, a dot's recording, a spectrum's level in its unit). */
    /** `step`: for a point of the full data, the spacing of its real neighbours (the digits a place needs, R7). */
    readout?: (index: number, point: { x: Whole; value: Whole; step?: number }) => string[];
    /**
     * What the point at `index` of the layer's full data is, where its points are things and not places on an axis
     * (a recording on the distribution: its key). A point kept across a redraw (the one ← / → stepped to, R7) is then
     * found again by this identity, never by its index or its x: after a redraw the same index or the same x may be
     * another recording (the order changed, one was removed or added, two share a value). Gone from the new drawing,
     * the point is let go. Stable for as long as the thing exists and unique among the plot's layers that give one.
     * Only for a line the webview holds whole (fullRead.ts localLine: its points are numbered). A layer without it is
     * read again by its x, which is what its points are (a bin, a sample, a frame).
     */
    identity?: (index: number) => string;
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
    /**
     * How single points look where a state of theirs changes it (a recording inside a picked range): the colour of the
     * dot at `index` of the drawn points, in place of `color`.
     * A state of some points is always shown this way (or as `share`), on the one layer that holds every point of the
     * line, never as a second layer of only those points: a layer is what the pointer and ← / → read, so points split
     * over two layers could not be stepped across, and each would skip the other's (R7: a selection changes the look,
     * never what the keys visit).
     */
    colorAt?: (index: number) => string;
    /**
     * Of filled bars: the part of each bar that is in some state (a bin's count inside a picked range), drawn again
     * from the floor up to `values[index]` in `color` over the bar. Looks only: the bars are read as the one layer.
     */
    share?: { values: readonly (number | null)[]; color: string };
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
    /** A value's y held inside the plot: where a point's mark is drawn. */
    yAt: (value: number) => number;
    /**
     * A value's exact y, never held anywhere (AxisTransform.yOf), and the exact pixels per value unit
     * (AxisTransform.pixelsPerUnit): what every decision takes, the pointer's pick, the scale sent to the backend,
     * a hit test, the read mark's place (display rules R14). Never a scale made by differencing two y's.
     */
    yOf: (value: number) => number;
    pixelsPerUnit: number;
    /** The horizontal axis's value at a canvas x, and whether the axis is logarithmic; the level at a canvas y. */
    xOf?: (x: number) => number;
    xLog?: boolean;
    levelOf?: (y: number) => number;
    /** A figure no pointer reads (a report's): nothing is read on it. */
    noReadout?: boolean;
    /** A band's half width as a ratio of its centre, for steps. */
    ratioStep: number;
    lines: StageLayer[];
    diff: boolean;
    /**
     * Where `lines` holds signals drawn as themselves: the readout's unit for a signal without one (uncalibrated),
     * and the signal drawn again at another width (the hover's thicker line).
     */
    signal?: { unit: string; range?: { min: number; max: number }; paint(context: CanvasRenderingContext2D, layer: StageLayer, width: number): void };
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
        /** Whether the columns' axis is logarithmic: a hover finds its column by the same edges the picture is drawn by. */
        columnLog: boolean;
    };
    /** Where a heatmap's colour bar was painted (CSS pixels on the canvas). */
    colourBar?: ColourBarBox;
    /** The colour scale a heatmap was painted from (figureModel.colourScale): its bar's end numbers are these (R9). */
    colourScale?: { low: number; high: number };
    /** The value range a line plot was painted on (its level axis as drawn, zoomed or not): what its range popover writes. */
    valueRange?: { min: number; max: number };
    /** The ends of the horizontal axis as painted (its window at the field's numbers, R9): what its range popover writes. */
    xRange?: { min: number; max: number };
    /** A heatmap's rows' axis ends as painted (its window up, at the field's numbers): what its range popover writes. */
    rowRange?: { min: number; max: number };
    /** The value axis' ticks as drawn (a heatmap's rows, a line's levels): a lane kept as painted draws its side axis again from them. */
    levelTicks?: AxisTick[];
    /** Every text drawn for the plot (its ticks' numbers, its axes' names, its colour bar's ends), as drawn: what a test reads of it. */
    drawnTexts?: string[];
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
     * axis' range and `title` its name. They are drawn after the left axis' lines, by that axis's own transform
     * (axisTransform, R14): a signal among them as itself, on the right-hand range.
     */
    secondary?: { layers: StageLayer[]; range: FigureRange; title: FigureTitle };
    /**
     * A track lane's layout: its value axis on a canvas of its own beside the plot (its ticks and name are drawn
     * there), the plot filling its canvas at the canvas's own size, and no time labels (the ruler above has them).
     */
    axisCanvas?: HTMLCanvasElement | null;
    /**
     * The canvas that draws this plot's horizontal axis, numbers and name, for the plots stacked on it, where this
     * plot draws none of its own (the lanes' ruler, the pair view's γ² plot, the distribution rows' value axis).
     */
    xAxisCanvas?: HTMLCanvasElement | null;
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

/**
 * One picture on its own: the base, the compared file or their difference.
 * `full` is where its numbers are read (R7) and must be given: the picture's full-data source, or `NO_FULL_DATA`
 * (fullRead.ts) to say in the call that there is none, which the plot then marks (`data-plot-full`).
 */
export function paintStage(canvas: HTMLCanvasElement, view: StageView | null, range: FigureRange, color: string, axes: FigureNames, full: FullRead, options: StagePaintOptions = {}): StagePlot | null {
    return paintOverlay(canvas, { layers: view ? [{ view, color, filled: true, full }] : [] }, range, axes, options);
}

/**
 * Draws one pane: the overlay's pictures within `range` (the level axis, or a heatmap's colours), with tick
 * numbers on both axes and the axes' names. `diff` draws a zero line and colours a heatmap green (compare
 * louder) and grey (quieter). Without a picture it says `empty` in the middle of the pane. Returns where its lines
 * are, for the pointer (null when nothing is drawn).
 */
export function paintOverlay(canvas: HTMLCanvasElement, overlay: StageOverlay, range: FigureRange, axes: FigureNames, options: StagePaintOptions = {}): StagePlot | null {
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
    const texts: string[] = [];
    const outer = drawing;
    drawing = texts;
    try {
        plot = paintPlot(canvas, overlay, range, axes, options, ready);
        if (plot) plot.drawnTexts = texts;
        return plot;
    } finally {
        drawing = outer;
        scope.__plotPainting -= 1;
    }
}

/** The texts the plot being painted has drawn so far (paintOverlay), or null between paints. */
let drawing: string[] | null = null;
const recorded = new WeakSet<CanvasRenderingContext2D>();
/** A plot's context (its canvas's, its side axis's) notes each text it draws while a plot is painted on it. */
function recording(context: CanvasRenderingContext2D): CanvasRenderingContext2D {
    if (recorded.has(context) || typeof context.fillText !== 'function') return context;
    recorded.add(context);
    const fill = context.fillText.bind(context);
    context.fillText = (text: string, x: number, y: number, maxWidth?: number): void => {
        drawing?.push(String(text));
        if (maxWidth === undefined) fill(text, x, y);
        else fill(text, x, y, maxWidth);
    };
    return context;
}

/** How many times each canvas was drawn by paintOverlay: a redraw for a fetched level is for the latest only. */
const paintedGenerations = new WeakMap<HTMLCanvasElement, number>();

/**
 * A value axis's value-to-pixel transform on a plot (display rules R14), the one every use takes: the lines on the axis
 * are painted by it (a signal by the lanes' waveform pipeline over its range, any other line by `yOf`), the
 * pointer picks their points and places the read mark by it (`yOf`, `pixelsPerUnit`), and the values it shows are its
 * range. A plot with a right-hand axis makes one for each axis (FigureModel's axes), and each line takes its own
 * axis's, never the plot's first one.
 *
 * Scale for decisions is exact (R14): `yOf` and `pixelsPerUnit` come from the range and the box alone. A line is
 * painted by the same exact `yOf` and clipped segment by segment where it leaves the plot (strokeStageLine, R2): no y
 * is held for painting a line. The one held y is `yAt`, a point's mark held inside the plot, and fills (a bar's body)
 * held to the plot's edge: a held y is never a scale (two of them differenced, pickScaleBoundary.test.ts).
 */
export interface AxisTransform {
    /** The axis's ends as painted: what it shows of a line's values, and what its range popover writes. */
    valueRange: { min: number; max: number };
    /** A value's y on the canvas, held inside the plot (a point's mark). */
    yAt: (value: number) => number;
    /** A value's exact y on the canvas, held nowhere: for every decision (the pick, a hit test, the read mark). */
    yOf: (value: number) => number;
    /** The axis's exact pixels per value unit (its box's height over its span): the scale every decision takes. */
    pixelsPerUnit: number;
    /** The value at a canvas y. */
    levelOf: (y: number) => number;
    /** A signal on this axis drawn as itself (its waveform envelope), over this axis's range. */
    paintSignal: (context: CanvasRenderingContext2D, layer: StageLayer, width: number, onPoint?: SignalPointSink) => void;
}

/**
 * `axis`'s transform on the plot `box`, its signals' times on `time` with the part `window` across the plot. The one
 * place a value axis's range becomes pixels (R14): the left axis and the right-hand one are both made here.
 */
export function axisTransform(axis: Pick<FigureAxis<unknown>, 'range'> | { readonly range: PaneRange }, on: { box: PlotBox; time: { low: number; high: number }; window: NormalizedRange }): AxisTransform {
    const { min, max } = axis.range;
    const { top, height } = on.box;
    const span = max - min;
    const yOf = (value: number): number => top + (1 - (value - min) / span) * height;
    return {
        valueRange: { min, max },
        yAt: value => yOf(Math.max(min, Math.min(max, value))),
        yOf,
        pixelsPerUnit: height / span,
        levelOf: y => min + (1 - (y - top) / height) * span,
        paintSignal: (context, layer, width, onPoint) => {
            if (!layer.view.waveform) return;
            paintWaveformLayer(context, on.box, layer.view.waveform, on.time, on.window, { min, max }, layer.color, width, { span: layer.span, ...(onPoint ? { onPoint } : {}) });
        },
    };
}

/** A plot's signals on `axis` (StagePlot.signal): their unit as the backend sent it, the axis's range, painted by it. */
function signalOn(axis: AxisTransform, unit: string): NonNullable<StagePlot['signal']> {
    // The signal's unit as the backend sent it (stage_view.signal_unit): none sent, none read out.
    return { unit, range: axis.valueRange, paint: (context, layer, width) => axis.paintSignal(context, layer, width) };
}

function paintPlot(canvas: HTMLCanvasElement, overlay: StageOverlay, range: PaneRange, axes: StageAxes, options: StagePaintOptions, ready: () => void): StagePlot | null {
    const lane = options.axisCanvas !== undefined;
    // A lane keeps the size its layout gave its canvas; any other plot is sized to its box at the screen's ratio.
    const ratio = options.size ? 1 : lane ? canvas.width / (canvas.clientWidth || canvas.width || 1) : canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const width = options.size?.width ?? (lane ? canvas.width / ratio : canvas.clientWidth || 600), height = options.size?.height ?? (lane ? canvas.height / ratio : canvas.clientHeight || 120);
    if (!lane) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
    }
    const drawn = canvas.getContext('2d');
    const context = drawn && recording(drawn);
    if (!context) return null;
    // Drawn by the one plot component (R13): every ui-smoke test fails a plot on screen without this mark, and the
    // plot contract test gives each one marked the same gestures. Its axes are named on it for that test.
    if (canvas.dataset) {
        canvas.dataset.plot = '';
        // The right-hand level axis's name too, where there is one: it is drawn and audited as the others are (R4).
        canvas.dataset.plotAxes = overlay.layers.length ? [axes.x, axes.y, ...(options.secondary && !overlay.layers.some(layer => layer.view.kind === 'heatmap') ? [options.secondary.title] : [])].join('|') : '';
        // The canvases that draw its axes' names besides itself, by id (its value axis's, its shared horizontal
        // axis's): the only other places the audit and the plot contract look for its names (R4). An axis canvas
        // with no id names no plot.
        canvas.dataset.plotNamedBy = [options.axisCanvas, options.xAxisCanvas].map(other => other?.id ?? '').filter(Boolean).join(' ');
        if (options.xAxisCanvas?.id) canvas.dataset.plotXAxis = options.xAxisCanvas.id;
        else delete canvas.dataset.plotXAxis;
        canvas.dataset.plotOrder = '';
        canvas.dataset.plotFull = '';
        canvas.dataset.plotColour = '';
        delete canvas.dataset.plotColourScale;
        delete canvas.dataset.plotColourEnds;
        delete canvas.dataset.plotEnds;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const style = canvas.ownerDocument.defaultView?.getComputedStyle(canvas);
    const muted = style?.getPropertyValue('--muted').trim() || '#888';
    const line = style?.getPropertyValue('--line').trim() || '#444';
    const text = options.labels ? '#222' : style?.getPropertyValue('--text').trim() || '#ddd';
    const margins = options.margins ?? (lane ? { left: 0, top: 0, right: 0, bottom: 0 } : undefined);
    const xLabels = options.xAxisLabels !== false && !lane;
    const left = margins?.left ?? PANE_LEFT, top = margins?.top ?? (options.labels ? 40 : 4), bottom = margins?.bottom ?? 16, right = margins?.right ?? (options.secondary ? PANE_LEFT : 4);
    const plotWidth = Math.max(1, width - left - right), plotHeight = Math.max(1, height - top - bottom);
    if (options.labels) {
        // A figure's title and legend stay on the canvas (A37, R4): the title cut in the middle, and the legend's
        // names, where all of them do not fit one row, each given an equal share of it and cut in the middle to it.
        const room = Math.max(0, width - left - 4);
        context.font = 'bold 14px sans-serif';
        context.fillStyle = '#222';
        const title = fitToWidth(options.labels.title, room, text => context.measureText(text).width);
        if (title) context.fillText(title, left, 18);
        context.font = '12px sans-serif';
        const legend = options.labels.legend;
        const natural = legend.reduce((sum, item) => sum + 30 + context.measureText(item.text).width, 0) - 8;
        const share = legend.length ? room / legend.length : 0;
        let x = left;
        for (const item of legend) {
            if (x + 18 > width - 4) break;
            context.strokeStyle = item.color;
            context.lineWidth = 2.5;
            context.beginPath(); context.moveTo(x, 30); context.lineTo(x + 18, 30); context.stroke();
            context.fillStyle = '#444';
            const name = natural <= room ? item.text : fitToWidth(item.text, Math.min(share - 30, width - 4 - (x + 22)), text => context.measureText(text).width);
            if (name) context.fillText(name, x + 22, 34);
            x += natural <= room ? 30 + context.measureText(item.text).width : share;
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
    const whole = options.axisView ?? view;
    const wholeAxis = axisScale(whole);
    const xAxis = windowed(wholeAxis, options.window?.x ?? FULL_WINDOW);
    // The part across as painted: the window at the numbers its range popover writes (R9), every use takes this one.
    const xWindow = paintedPart(wholeAxis, xAxis);
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
    // Zoomed, the pictures run past the plot's edges: they are clipped to it.
    const xAt = (value: number): number => left + xAxis.fraction(value) * plotWidth;
    const heatmap = view.kind === 'heatmap';
    // The rows' axis is the picture's own when the whole axes given (a lane's time axis) have no rows.
    const yAxis = heatmap ? windowed(rowScale(axisExtent({ xs: whole.ys, xSource: whole.ySource }) ? whole : view), options.window?.y) : null;
    // Each value axis's one value-to-pixel transform (display rules R14): its lines are painted, picked and marked by it.
    const box: PlotBox = { left, top, width: plotWidth, height: plotHeight };
    const mainAxis = axisTransform({ range }, { box, time: wholeAxis, window: xWindow });
    const yAt = mainAxis.yAt;

    let levelTicks: AxisTick[] = [];
    const plot: StagePlot = { frame: { left, top, width: plotWidth, height: plotHeight }, xAt, yAt, xOf: x => xAxis.at((x - left) / plotWidth), xLog: xAxis.log, levelOf: mainAxis.levelOf,
        yOf: mainAxis.yOf, pixelsPerUnit: mainAxis.pixelsPerUnit, ratioStep: 1.12, lines: [], diff: !!options.diff, xRange: { min: xAxis.low, max: xAxis.high }, ...(yAxis ? { rowRange: { min: yAxis.low, max: yAxis.high } } : {}), ...(heatmap ? {} : { valueRange: mainAxis.valueRange }), ...(options.readout === false ? { noReadout: true } : {}), ...levelUnitOf(heatmap ? axes.colour : axes.y) };
    // Where its data is drawn on the canvas (CSS pixels: left, top, width, height), so a gesture test can tell what a
    // drag or a wheel at a pixel should show from the pixel alone, not from the plot's own answer (C6).
    if (canvas.dataset) canvas.dataset.plotFrame = [left, top, plotWidth, plotHeight].map(String).join(' ');
    // The ends its axes are painted with, exactly (across, and up: a heatmap's rows or the level axis), which its range
    // popovers write (R9): a test compares the fields with these, never with numbers of its own.
    const paintedEnds = (): string => JSON.stringify({ x: [xAxis.low, xAxis.high], y: yAxis ? [yAxis.low, yAxis.high] : [mainAxis.valueRange.min, mainAxis.valueRange.max],
        ...(plot.secondary?.valueRange ? { right: [plot.secondary.valueRange.min, plot.secondary.valueRange.max] } : {}) });
    if (canvas.dataset) canvas.dataset.plotEnds = paintedEnds();
    // Every picture drawn says where its numbers are read (R7): a plot drawing one that does not is marked, and every
    // ui-smoke test fails it (canvasAudit.ts). A figure no pointer reads needs none.
    if (canvas.dataset) {
        const undeclared = [...layers, ...(options.secondary?.layers ?? [])].filter(layer => !declaresFullRead(layer));
        canvas.dataset.plotFull = options.readout === false ? 'none' : undeclared.length ? `missing: ${undeclared.map(layer => layer.label || layer.view.frame).join(', ')}` : 'declared';
    }
    if (heatmap && yAxis && view.matrix) {
        const image = context.createImageData(Math.round(plotWidth * ratio), Math.round(plotHeight * ratio));
        const ys = view.ys ?? [], xs = view.xs ?? [];
        // A signed picture (a difference, a cepstrum) shows its largest magnitude; levels, their loudest.
        const signedScale = !!options.diff || view.quantity === 'cepstrum';
        // The one colour scale its cells, its colour bar and the bar's end numbers are painted from (R9): ends
        // widened to the numbers the bar writes, so the numbers are the scale (figureModel.colourScale).
        const { low, high } = colourScale(range, signedScale);
        const extentAbs = Math.max(Math.abs(low), Math.abs(high), 1e-9);
        // The cells each pixel line covers (none past the picture's ends), worked out once per line, not per pixel,
        // from the axes' values: a detail picture covers only part of them.
        // Both axes by one rule (fullRead.cellEdges): a log axis's cells meet at the geometric mean of their points.
        const rowEdges = cellEdges(ys, yAxis.log), columnEdges = cellEdges(xs, xAxis.log);
        const measure = axisMeasure;
        const rowSpans = Array.from({ length: image.height }, (_, py) => cellSpan(rowEdges,
            measure(yAxis.at(1 - (py + 1) / image.height), yAxis.log), measure(yAxis.at(1 - py / image.height), yAxis.log)));
        // A picture with a span (a track's spectrogram on the lanes' axis) paints nothing past it, though its end
        // cells reach half a step beyond their frames' centres.
        const clip = layers.find(layer => layer.view === view)?.span ?? [-Infinity, Infinity];
        const columnSpans = Array.from({ length: image.width }, (_, px) => {
            const low = Math.max(clip[0], xAxis.at(px / image.width)), high = Math.min(clip[1], xAxis.at((px + 1) / image.width));
            return high > low ? cellSpan(columnEdges, measure(low, xAxis.log), measure(high, xAxis.log)) : null;
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
            const fraction = Math.max(0, Math.min(1, (cell - low) / (high - low || 1)));
            if (options.heatmapPalette) return paletteColour(fraction, options.heatmapPalette);
            const level = Math.round(fraction * 255);
            return packRgb(level, level, level);
        };
        const matrix = drawableRows(view.matrix);
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
            columnLog: xAxis.log,
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
        const endText = (value: number): string => colourEndText(value, high - low);
        plot.colourScale = { low, high };
        // The scale painted and the end numbers written, for every ui-smoke test to hold one to the other (R9,
        // canvasAudit.ts): exact (the shortest text that parses back), never rounded.
        if (canvas.dataset) {
            canvas.dataset.plotColourScale = `${String(low)} ${String(high)}`;
            canvas.dataset.plotColourEnds = JSON.stringify([endText(low), endText(high)]);
        }
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
            // The Δ's 0 at its exact y, and only where it is on the plot (R2: a line past the axis is clipped, never
            // drawn along the plot's edge as if 0 were there).
            const zero = mainAxis.yOf(0);
            if (zero >= top && zero <= top + plotHeight) { context.beginPath(); context.moveTo(left, zero); context.lineTo(left + plotWidth, zero); context.stroke(); }
        }
        const bars = view.kind === 'bar';
        const barXs = view.xs ?? [];
        // Bands on a log axis are a ratio wide; bins on a linear one (a histogram's) a step.
        const linearBars = bars && view.xScale === 'linear';
        const ratioStep = bars && !linearBars && barXs.length > 1 ? Math.sqrt(barXs[1] / barXs[0]) : 1.12;
        plot.ratioStep = ratioStep;
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
        if (options.bandSteps) paintBandSteps(context, options.bandSteps, box, xAt, mainAxis.yOf);
        // Signals drawn as themselves share an amplitude axis: a picture without a signal (a group's median level) is left out.
        const signals = layers.some(layer => layer.view.waveform);
        for (const layer of layers) {
            const values = drawableLine(layer.view.values ?? []);
            const xs = layer.view.xs ?? [];
            if (layer.view.kind === 'heatmap' || layer.view.kind === 'none' || (signals && !layer.view.waveform)) continue;
            if (layer.view.waveform) {
                // The signal itself, by the track lanes' own pipeline, on the same axes; the pointer picks it as a line.
                plot.signal ??= signalOn(mainAxis, layer.view.waveform.unit);
                mainAxis.paintSignal(context, layer, layer.width ?? 1.5, options.onSignalPoint);
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
                const edges = barEdges(plot, xs);
                values.forEach((value, index) => {
                    if (value === null) return;
                    const [x0, x1] = edges[index];
                    context.fillRect(x0, Math.min(floor, yAt(value)), Math.max(1, x1 - x0 - 1), Math.abs(floor - yAt(value)));
                });
                // The part of each bar in a state (StageLayer.share), over it, with its own top edge.
                const share = layer.share;
                if (share) {
                    context.fillStyle = share.color;
                    share.values.forEach((value, index) => {
                        if (value === null || !edges[index]) return;
                        const [x0, x1] = edges[index];
                        context.fillRect(x0, Math.min(floor, yAt(value)), Math.max(1, x1 - x0 - 1), Math.abs(floor - yAt(value)));
                    });
                    context.fillStyle = layer.color;
                }
                context.globalAlpha = layer.alpha ?? 1;
            }
            strokeStageLine(context, plot, layer, layer.width ?? (layer.view.kind !== 'bar' ? 1.5 : layer.filled ? 1 : 2));
            context.restore();
        }
        if (options.secondary) {
            // The right-hand axis's lines on its own transform, a signal among them too: never the left axis's (R14).
            const { levelUnit: _main, signal: _left, ...shared } = plot;
            const rightAxis = axisTransform(options.secondary, { box, time: wholeAxis, window: xWindow });
            const rightSignal = options.secondary.layers.find(layer => layer.view.waveform)?.view.waveform;
            const secondPlot: StagePlot = { ...shared, valueRange: rightAxis.valueRange, yAt: rightAxis.yAt, yOf: rightAxis.yOf, pixelsPerUnit: rightAxis.pixelsPerUnit, levelOf: rightAxis.levelOf, lines: [],
                ...(rightSignal ? { signal: signalOn(rightAxis, rightSignal.unit) } : {}), ...levelUnitOf(options.secondary.title) };
            plot.secondary = secondPlot;
            if (canvas.dataset) canvas.dataset.plotEnds = paintedEnds();
            // A trigger's events on the right-hand axis are drawn one line each, as on the left (A43).
            for (const layer of secondaryOrder.flatMap(eventLayers)) {
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
    // At the right end; never left of the plot, into the value axis's side, where it does not fit even fitted (A28).
    const xTitleLeft = Math.max(left, left + plotWidth - context.measureText(xTitle).width * xFitted.scale);
    context.fillStyle = muted;
    context.strokeStyle = line;
    context.lineWidth = 1;
    // A label that would touch the one before it is left out too (a log axis in a narrow plot), its gridline kept.
    let labelsEnd = -Infinity;
    for (const { value, text: label } of alongAxisTicks(xAxis.low, xAxis.high, xAxis.log)) {
        const x = xAt(value);
        if (!heatmap) { context.beginPath(); context.moveTo(x, top); context.lineTo(x, top + plotHeight); context.stroke(); }
        const end = x - 6 + context.measureText(label).width;
        if (xLabels && end < xTitleLeft - 4 && x - 6 >= labelsEnd + X_LABEL_GAP_PX) { context.fillText(label, x - 6, height - 3); labelsEnd = end; }
    }
    if (options.region) paintRegion(context, options.region, view, { left, top, width: plotWidth, height: plotHeight }, xAt, { muted, text });
    if (options.guides) paintGuides(context, options.guides, { left, top, width: plotWidth, height: plotHeight }, xAt, mainAxis.yOf, text);
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
        const titleRight = paintValueTitle(context, frame, axes.y, text, AXIS_TITLE_X, { min: 0, max: frame.left })?.right ?? 0;
        paintValueTicks(context, frame, levelTicks, muted, titleRight);
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
    const drawn = canvas.getContext('2d');
    const context = drawn && recording(drawn);
    if (!context) return;
    paintingAxis(canvas, () => {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        const frame = { left: canvas.width, top: 0, width: 0, height: canvas.height };
        context.font = PLOT_TEXT_FONT;
        const titleRight = paintValueTitle(context, frame, title, colors.text, AXIS_TITLE_X, { min: 0, max: frame.left })?.right ?? 0;
        paintValueTicks(context, frame, spacedTicks(ticks, canvas.height), colors.muted, titleRight);
    });
}

/**
 * A lane's value axis canvas left empty, by the plot component: the plot beside it draws its axis itself (the
 * comparison's lanes) or has nothing to draw yet.
 */
export function clearSideAxis(canvas: HTMLCanvasElement): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    paintingAxis(canvas, () => {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
    });
}

/**
 * The time axis plots stacked on it share, on its own canvas above them (the track lanes' ruler): its ticks along
 * the bottom over `width` pixels, their numbers, and its name at the right end, as every plot writes its time axis;
 * a number the name would cover is left out.
 */
export function paintTimeAxis(canvas: HTMLCanvasElement, ticks: ReadonlyArray<{ x: number; text: string }>, title: string, width: number, colors: { muted: string; line: string; text: string }): void {
    const drawn = canvas.getContext('2d');
    const context = drawn && recording(drawn);
    if (!context) return;
    paintingAxis(canvas, () => {
        const height = canvas.height;
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, height);
        context.font = PLOT_TEXT_FONT;
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        // Its name fitted as every axis name is (fitAxisTitle: smaller, its quantity shortened, never dropped, A36).
        const fitted = fitAxisTitle(title, width / 2, part => context.measureText(part).width);
        const fittedTitle = fitted.lines.join(' ');
        const titleLeft = Math.max(0, width - context.measureText(fittedTitle).width * fitted.scale - 2);
        context.fillStyle = colors.muted;
        context.strokeStyle = colors.line;
        context.lineWidth = 1;
        context.beginPath();
        // A number that would touch the one before it is left out too, as on every plot's horizontal axis.
        let labelsEnd = -Infinity;
        for (const tick of ticks) {
            const x = Math.round(tick.x) + 0.5;
            context.moveTo(x, height - 4);
            context.lineTo(x, height);
            const end = tick.x + 2 + context.measureText(tick.text).width;
            if (end < titleLeft - 4 && tick.x + 2 >= labelsEnd + X_LABEL_GAP_PX) { context.fillText(tick.text, tick.x + 2, height - 6); labelsEnd = end; }
        }
        context.stroke();
        context.fillStyle = colors.text;
        context.font = scaledFont(PLOT_TEXT_FONT, fitted.scale);
        context.fillText(fittedTitle, titleLeft, height - 6);
        context.font = PLOT_TEXT_FONT;
    });
}

/**
 * An axis drawn on a canvas of its own by the plot component, beside or above the plots it serves (a lane's value
 * axis, the lanes' time axis): marked as the component's (`data-plot-axis-canvas`), and drawn while the page knows
 * the component is drawing, so the audit holds it to the component as it holds a plot (R13).
 */
function paintingAxis(canvas: HTMLCanvasElement, paint: () => void): void {
    const scope = globalThis as { __plotPainting?: number };
    scope.__plotPainting = (scope.__plotPainting ?? 0) + 1;
    try {
        if (canvas.dataset) canvas.dataset.plotAxisCanvas = '';
        paint();
    } finally {
        scope.__plotPainting = (scope.__plotPainting ?? 1) - 1;
    }
}

/**
 * A value axis's name up the gutter at canvas x `x`, in `color`, fitted to the frame's height: smaller, on two lines
 * or with its quantity shortened, but always its quantity and its unit (R4).
 * The name is always drawn inside its canvas (R4): along the axis it is fitted to the frame's height (fitAxisTitle
 * never returns a name longer than the room it is given), and across the gutter its centre is moved in from `x` as far
 * as its lines need to stay between `gutter.min` and `gutter.max` (the canvas's edge and the plot's side; two lines at
 * the full font are wider than the gutter's usual centre allows). Returns its sides across the gutter; null with no name.
 */
function paintValueTitle(context: CanvasRenderingContext2D, frame: { top: number; height: number }, title: string, color: string, x: number, gutter: { min: number; max: number }): { left: number; right: number } | null {
    if (!title) return null;
    const font = context.font;
    const fitted = fitAxisTitle(title, frame.height, part => context.measureText(part).width, { lines: 2 });
    const size = fontPixels(font) * fitted.scale;
    const step = size * 1.1;
    // Half of what the lines take across the gutter: from the first line's far side to the last line's.
    const half = ((fitted.lines.length - 1) * step + size) / 2;
    // The canvas's edge wins where the gutter is narrower than the name (min for a left gutter, max for a right one).
    const centre = gutter.min === 0 ? Math.max(gutter.min + half, Math.min(gutter.max - half, x)) : Math.min(gutter.max - half, Math.max(gutter.min + half, x));
    context.save();
    context.fillStyle = color;
    context.font = scaledFont(font, fitted.scale);
    context.translate(centre, frame.top + frame.height / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // Two lines side by side across the gutter, read as one: the quantity on the left, then the unit.
    fitted.lines.forEach((line, index) => context.fillText(line, 0, (index - (fitted.lines.length - 1) / 2) * step));
    context.restore();
    // Its sides across the gutter (turned, a line's height runs across it): the numbers are written clear of them.
    return { left: centre - half, right: centre + half };
}

/**
 * How much a value axis's numbers are shrunk to keep clear of its name (R4): as far as the widest needs, with no floor,
 * since a number over the name is never drawn (A-P3); `room` at or under nothing leaves them unwritten.
 */
const tickScale = (room: number, widest: number): number => (widest > room && widest > 0 ? Math.max(0, room) / widest : 1);
/** `text` as it fits `room` px: whole, or cut in the middle ("start…end"); '' where not even "…" fits. */
export function fitToWidth(text: string, room: number, measure: (text: string) => number): string {
    if (measure(text) <= room) return text;
    let low = 0, high = text.length - 1;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (measure(middleEllipsis(text, mid + 1)) <= room) low = mid; else high = mid - 1;
    }
    const cut = middleEllipsis(text, low + 1);
    return measure(cut) <= room ? cut : '';
}

/** The least room between two numbers along the horizontal axis. */
const X_LABEL_GAP_PX = 4;

/**
 * A value axis's numbers, right-aligned against the frame's left edge (the top one hangs below the top, the bottom
 * one stands on the bottom): smaller, all of them, where the widest would reach left of `clearOf` into the axis's
 * name, so a number never covers the name (R4).
 */
function paintValueTicks(context: CanvasRenderingContext2D, frame: { left: number; top: number; height: number }, ticks: readonly AxisTick[], color: string, clearOf: number): void {
    context.save();
    context.fillStyle = color;
    const font = context.font;
    const room = frame.left - 2 - clearOf - 1;
    const widest = ticks.reduce((most, tick) => Math.max(most, context.measureText(tick.text).width), 0);
    context.font = scaledFont(font, tickScale(room, widest));
    context.textAlign = 'right';
    for (const tick of ticks) {
        context.textBaseline = tick.fraction >= 1 ? 'top' : tick.fraction <= 0 ? 'bottom' : 'middle';
        context.fillText(tick.text, frame.left - 2, frame.top + (1 - tick.fraction) * frame.height);
    }
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
    // Its name first, so its numbers are written clear of it: all smaller where the widest would reach it (A36, R4),
    // as the left axis's are.
    const centre = width - AXIS_TITLE_X;
    const titleLeft = paintValueTitle(context, frame, title, colors.text, centre, { min: x, max: width })?.left ?? width;
    context.fillStyle = colors.muted;
    context.textAlign = 'left';
    const shown = range.max > range.min ? ticks : [];
    const room = titleLeft - 1 - (x + 4);
    const widest = shown.reduce((most, tick) => Math.max(most, context.measureText(tick.text).width), 0);
    context.font = scaledFont(typeof context.font === 'string' ? context.font : PLOT_TEXT_FONT, tickScale(room, widest));
    for (const tick of shown) {
        const y = frame.top + (1 - tick.fraction) * frame.height;
        context.beginPath(); context.moveTo(x, y); context.lineTo(x + 3, y); context.stroke();
        context.textBaseline = tick.fraction >= 1 ? 'top' : tick.fraction <= 0 ? 'bottom' : 'middle';
        context.fillText(tick.text, x + 4, y);
    }
    context.restore();
}

/**
 * Where each bar of `xs` starts and ends on the canvas: its cell's edges by the one rule a heatmap's cells and a hover
 * use too (fullRead.cellEdges: the geometric mean of two bands on a log axis, the midpoint on a linear one).
 */
export function barEdges(plot: Pick<StagePlot, 'xAt' | 'xLog'>, xs: readonly number[]): Array<[number, number]> {
    const edges = cellEdgeValues(xs, !!plot.xLog);
    return xs.map((_, index) => [plot.xAt(edges[index]), plot.xAt(edges[index + 1])]);
}

/**
 * One picture of a pane as its line (or its bands as steps, or its points as marks), `width` wide, clipped to the plot.
 *
 * Lines are clipped, not clamped (display rules R2, plot/lineClip.ts): every point is placed by the axis's exact `yOf`,
 * never held, and each segment is cut where it crosses the plot's box grown by the line's width. So the part of a line
 * on the plot is exactly its segments however far the next point is past the axis, at every zoom.
 */
export function strokeStageLine(context: CanvasRenderingContext2D, plot: StagePlot, layer: StageLayer, width: number): void {
    if (layer.view.waveform) { plot.signal?.paint(context, layer, width); return; }
    const { frame, xAt, yOf } = plot;
    const values = drawableLine(layer.view.values ?? []), xs = layer.view.xs ?? [];
    const path = clippedPath({ start: (x, y) => context.moveTo(x, y), to: (x, y) => context.lineTo(x, y) }, frame, width);
    context.save();
    context.beginPath(); context.rect(frame.left, frame.top, frame.width, frame.height); context.clip();
    context.strokeStyle = layer.color;
    context.globalAlpha = layer.alpha ?? 1;
    context.lineWidth = width;
    if (layer.dash) context.setLineDash([...layer.dash]);
    if (layer.marks === 'dots') {
        // Each point a dot of the line's colour (its width the radius), the things a few points stand for: one wholly
        // past the plot is not drawn.
        values.forEach((value, index) => {
            if (value === null) return;
            const x = xAt(xs[index]), y = yOf(value);
            if (!nearPlot(frame, x, y, width)) return;
            context.fillStyle = layer.colorAt?.(index) ?? layer.color;
            context.beginPath(); context.arc(x, y, width, 0, 2 * Math.PI); context.fill();
        });
    } else if (layer.marks === 'rug') {
        // A short tick up from the plot's floor at each point, one per half pixel: many draw what can be seen.
        const ticks = new Set(xs.map(x => Math.round(xAt(x) * 2) / 2));
        context.beginPath();
        for (const x of ticks) { context.moveTo(x, frame.top + frame.height); context.lineTo(x, frame.top + frame.height - 5); }
        context.stroke();
    } else if (layer.view.kind === 'bar') {
        const edges = barEdges(plot, xs);
        values.forEach((value, index) => {
            if (value === null) return;
            const [x0, x1] = edges[index];
            context.beginPath(); path.lift(); path.segment(x0, yOf(value), x1 - 1, yOf(value)); context.stroke();
        });
    } else {
        context.beginPath();
        // A point between two gaps (a bucket's peak beside silent nulls) is drawn as a pixel-wide dash.
        let run = 0, lastX = 0, lastY = 0;
        const closeRun = (): void => { if (run === 1) path.segment(lastX, lastY, lastX + 1, lastY); run = 0; path.lift(); };
        values.forEach((value, index) => {
            if (value === null || silent(layer.view, value, plot.diff)) { closeRun(); return; }
            const x = xAt(xs[index]), y = yOf(value);
            if (run) path.segment(lastX, lastY, x, y);
            run += 1; lastX = x; lastY = y;
        });
        closeRun();
        context.stroke();
    }
    context.restore();
}

/**
 * A signal's time to the digits that tell its neighbouring points apart (`step`, the spacing of the samples read: at
 * 48 kHz "3.27002 s", "3.27004 s"), as every time is; at least 10 ms. Without a spacing (an envelope point), to the
 * digits a pixel column of the plot tells apart.
 */
function timeText(plot: StagePlot, seconds: number, step?: number): string {
    const perPixel = Math.abs(plot.xAt(1) - plot.xAt(0)) > 0 ? 1 / Math.abs(plot.xAt(1) - plot.xAt(0)) : 0.01;
    return secondsText(seconds, timeDigits(step ?? perPixel));
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
    /** What the point read is (StageLayer.identity), where its layer says: how it is found again after a redraw. */
    identity?: string;
    at?: Whole;
    row?: Whole;
    value?: Whole;
    /** An image cell's row spacing (a spectrogram's bin width), so neighbouring rows read apart. */
    rowStep?: number;
    /** The spacing along the horizontal axis of the points around the one read (a signal's samples, an image's frames). */
    step?: number;
    /** The full data around the pointer is still being fetched: the marks are shown, no number until it is in. */
    pending?: boolean;
    /**
     * A line's full data near the pointer could not be read (the backend failed): no number, as while pending, and
     * never another line's in its place; read again once the failure's pause is over (fullRead.ts).
     */
    failed?: boolean;
}

/** A point a plot reads: where it is drawn, its value, where it is along its axis and its index in the drawn line. */
type ReadPoint = { index: number; time?: number; x: number; y: number; value: Whole; at: Whole; step?: number; full?: boolean };

/** Whether a layer drawn on a plot was given its full data (R7): every one is, held or fetched; nothing to read is none. */
export function declaresFullRead(layer: StageLayer): boolean {
    return readsFullData(layer.full) || layer.view.kind === 'none';
}

/**
 * A point of the full data on the plot, for every kind of line alike (display rules R7): null where it has no value,
 * or is silent. A value past the value axis (zoomed) is still the line's point there: its mark is held at the plot's
 * edge and its readout writes its true value. Whether the pointer may pick it as its nearest point is not decided
 * here (valueOnScreen, in fullLineNear).
 *
 * `step` is the point's distance to its nearer neighbour in the source data, as the source says (FullPoints.steps):
 * never the gap between the points sent, which in a dense window are only a few per pixel column.
 */
function fullPoint(plot: StagePlot, layer: StageLayer, points: FullPoints, index: number): ReadPoint | null {
    const value = points.values?.[index];
    const at = points.xs[index];
    // A value that is not finite (NaN, ±Infinity) is no value, as a seek and the backend read it (fullRead.readableValue,
    // full_read._readable): the pointer never reads it under itself, nor does a step land on it (R7's pick table).
    if (value === null || value === undefined || !Number.isFinite(value) || at === undefined || silent(layer.view, value, plot.diff)) return null;
    const { top, height } = plot.frame;
    // Its exact place (R14), held at the plot's edge only when its value is past the axis.
    const y = Math.min(top + height, Math.max(top, plot.yOf(value)));
    const step = points.steps?.[index];
    // Of a source the webview holds, the point's index in its every value (a histogram's bin, for its readout).
    return { index: points.offset !== undefined ? points.offset + index : -1, at, x: plot.xAt(at), y, value, full: true, ...(layer.view.waveform ? { time: at } : {}), ...(step !== null && step !== undefined && step > 0 ? { step } : {}) };
}

/** Whether `value` of `layer` is within the values the plot shows (shownValues); true where the plot names none. */
function valueOnScreen(plot: StagePlot, layer: StageLayer, value: number): boolean {
    const shown = shownValues(plot, layer);
    if (!shown) return true;
    // A value on the axis's very end is on screen: the ends come back through the pixel scale, a rounding apart.
    const slack = (shown[1] - shown[0]) * 1e-9;
    return value >= shown[0] - slack && value <= shown[1] + slack;
}

/** The values a plot shows of `layer` (low, high): a signal's amplitude range, else its level axis between the plot's edges. */
function shownValues(plot: StagePlot, layer: StageLayer): [number, number] | undefined {
    if (layer.view.waveform) {
        const range = plot.signal?.range;
        return range ? [range.min, range.max] : undefined;
    }
    if (!plot.levelOf) return undefined;
    const a = plot.levelOf(plot.frame.top), b = plot.levelOf(plot.frame.top + plot.frame.height);
    return Number.isFinite(a) && Number.isFinite(b) ? [Math.min(a, b), Math.max(a, b)] : undefined;
}

/**
 * A line's full-resolution points (R7) for the pointer at (`x`, `y`). The one rule for every kind of line (a signal,
 * a spectrum, a level over time, a difference), written in docs/display-rules.md R7:
 *
 * - `near`: the points the pointer may pick as its nearest, within `radius` of it along x AND on screen (their value
 *   within the value axis shown). A point past a zoomed value axis is not drawn, so it is never picked.
 * - `at`: the point under the pointer, read when none is within the radius: the point with a value whose x is nearest
 *   the pointer's, WHATEVER its value. Past the value axis it is still the line's point there (its mark held at the
 *   plot's edge, its true value written), as an arrow key reads it.
 *
 * The backend follows the same rule for a window too dense to send whole (full_read._nearest_on_screen for `near`,
 * full_read._nearest_along for `at`, sent as `under`). undefined while the points are fetched.
 */
function fullLineNear(plot: StagePlot, layer: StageLayer, source: FullSource, x: number, y: number, radius: number, ready: () => void): { near: ReadPoint[]; at: ReadPoint | null } | null | undefined {
    if (source.line === cannotRead || !plot.xOf) return { near: [], at: null };
    // The pointer's place and the screen's scale there, so a window too dense to send whole holds the point nearest
    // the pointer by its true distance on screen (R7), not only each column's nearest in height.
    // The value scale is the axis's exact one (R14: pixelsPerUnit), never a difference of two mapped y's (a held one,
    // as a mark's yAt, is too small a scale on a narrow axis).
    const place = plot.xOf(x), level = plot.levelOf?.(y);
    const pixels: [number, number] | undefined = level === undefined ? undefined
        : [Math.abs(plot.xLog ? plot.xAt(place * Math.E) - plot.xAt(place) : plot.xAt(place + 1) - plot.xAt(place)), Math.abs(plot.pixelsPerUnit)];
    // The values on screen (a signal's amplitude range, else the level axis's between the plot's edges), so a dense
    // window's nearest point is one of those the plot reads, never one past a zoomed axis that is then left out (R7).
    const shown = shownValues(plot, layer);
    const got = source.line({ x0: plot.xOf(x - radius), x1: plot.xOf(x + radius), beyond: 1, near: level, columns: 2 * radius + 1, log: !!plot.xLog, ...(pixels ? { at: place, pixels } : {}), ...(shown ? { shown } : {}), ...(floorless(layer.view, plot.diff) ? { plain: true } : {}) }, ready);
    if (got === undefined) return undefined;
    // A read the backend failed is not a line with no points there: nothing is known of it (null), and the read waits.
    if (got === null && source.held === 'fetched') return null;
    if (!got?.xs.length) return { near: [], at: null };
    const near: ReadPoint[] = [];
    let at: ReadPoint | null = null;
    for (let index = 0; index < got.xs.length; index++) {
        const point = fullPoint(plot, layer, got, index);
        if (!point) continue;
        if (Math.abs(point.x - x) <= radius && valueOnScreen(plot, layer, point.value) && onPlot(plot, point.x, plot.yOf(point.value))) near.push(point);
        if (!at || Math.abs(point.x - x) < Math.abs(at.x - x)) at = point;
    }
    // A window too dense to send whole names the real point under the pointer (`under`, full_read._nearest_along): the
    // one read when no point is near the pointer on screen, never the nearest of the few points sent for the columns.
    const under = got.under !== undefined ? fullPoint(plot, layer, got, got.under) : null;
    if (under) at = under;
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
    const full = { at: point.at, value: point.value, ...(point.full ? { full: true } : {}), ...(point.full && point.index >= 0 && layer.identity ? { identity: layer.identity(point.index) } : {}) };
    if (view.waveform) {
        // A signal reads its amplitude in its unit, to 3 figures, where its point is.
        const unit = view.waveform.unit || plot.signal?.unit;
        return { ...readoutOf(layer, point, layer.label ?? '', [timeText(plot, point.time ?? point.at, point.full ? point.step : undefined), amountText(point.value, unit)]), index: -1, time: point.time ?? point.at, away, ...full, ...(point.full && point.step !== undefined ? { step: point.step } : {}) };
    }
    if (layer.readout) return { ...readoutOf(layer, point, layer.label ?? '', layer.readout(point.index, { x: point.at, value: point.value, ...(point.full && point.step !== undefined ? { step: point.step } : {}) })), index: point.index, away, ...full };
    const amount = valueText(view, point.value, plot.diff, plot.levelUnit);
    const where = atValue(view, point.at, undefined, point.step);
    return { ...readoutOf(layer, point, layer.label || (plot.diff ? 'Δ' : ''), [where, amount]), index: point.index, away, ...full };
}

/** What a read waiting for its layer's full data shows: the marks at the pointer, no number (R7); `failed`: its read failed. */
function pendingRead(layer: StageLayer, x: number, y: number, image = false, failed = false): StageRead {
    return { layer, x, y, text: '', name: '', values: '', ...(failed ? { failed: true } : { pending: true }), ...(image ? { image: true } : {}) };
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
        // A line whose read failed may be the one nearest: no other line is read in its place (R7).
        if (got === null) return pendingRead(layer, x, y, false, true);
        fulls.set(layer, got);
    }
    // The point nearest the pointer within a few pixels, so a narrow peak beside it is read at its top (R7).
    const hit = nearestPoint<StageLayer, ReadPoint>(plot.lines, layer => fulls.get(layer)?.near ?? [], layer => fulls.get(layer)?.at ?? null, x, y, HOVER_PICK_RADIUS_PX);
    return hit ? lineRead(plot, hit.s, hit.point, hit.away) : null;
}

/**
 * The very point `read` reads, on `plot` drawn anew (its layer by its full data, else its name and colour): where an
 * arrow key stepped to stays read after a redraw, a value above or below the level axis at the plot's edge as the
 * step read it, never the neighbour the pointer would pick there (A46, R7). Undefined while its points are fetched;
 * null where the plot no longer draws it.
 */
export function stageReadAgain(plot: StagePlot, read: StageRead, ready: () => void = () => undefined): StageRead | null | undefined {
    if (read.pending || read.failed || !read.full || read.at === undefined) return null;
    if (read.image) return imageReadAgain(plot, read, ready);
    const layer = plot.lines.find(line => line === read.layer) ?? plot.lines.find(line => line.full === read.layer.full)
        ?? plot.lines.find(line => line.label === read.layer.label && line.color === read.layer.color);
    // A point that is a thing (a recording) is found by what it is, on whichever line of the new drawing holds it now.
    if (read.identity !== undefined) return identifiedReadAgain(plot, read.identity, layer);
    if (!layer || layer.full.line === cannotRead) return null;
    const at = read.at;
    const got = layer.full.line({ x0: at, x1: at, beyond: 1 }, ready);
    if (got === undefined) return undefined;
    // Its read failed on the new drawing (the backend's passing failure): the point is kept, read as failed until it is
    // asked again (`ready`, once the store's pause is over), never let go for a point that is not drawn.
    if (got === null && layer.full.held === 'fetched') return { ...read, layer, failed: true };
    const index = got?.xs.indexOf(at) ?? -1;
    const point = got && index >= 0 ? fullPoint(plot, layer, got, index) : null;
    if (!point || point.x < plot.frame.left || point.x > plot.frame.left + plot.frame.width) return null;
    return lineRead(plot, layer, point);
}

/**
 * Where the point of identity `identity` (StageLayer.identity) is now: the line of `plot` that holds it and its index
 * in that line's every point. `first` is looked in first. Null when no line holds it any more.
 * By identity only, never by the index or the x it had: after a redraw those may be another recording's (R7).
 */
function identifiedPlace(plot: StagePlot, identity: string, first?: StageLayer): { layer: StageLayer; points: FullPoints; index: number } | null {
    for (const layer of [...(first ? [first] : []), ...plot.lines.filter(line => line !== first)]) {
        if (!layer.identity || layer.full.held !== 'inline' || !layer.full.line) continue;
        // Every point of the line, which the webview holds (numbered from `offset`).
        const points = layer.full.line({ x0: -Infinity, x1: Infinity, beyond: 0 }, () => undefined);
        if (!points || points.offset === undefined) continue;
        for (let index = 0; index < points.xs.length; index++) if (layer.identity(points.offset + index) === identity) return { layer, points, index };
    }
    return null;
}

/** stageReadAgain for a point with an identity: read where that very thing is now, or let go (null) when it is gone. */
function identifiedReadAgain(plot: StagePlot, identity: string, first?: StageLayer): StageRead | null {
    const place = identifiedPlace(plot, identity, first);
    const point = place ? fullPoint(plot, place.layer, place.points, place.index) : null;
    if (!place || !point || point.x < plot.frame.left || point.x > plot.frame.left + plot.frame.width) return null;
    return lineRead(plot, place.layer, point);
}

/**
 * Where in `got` an arrow key's step from the point at `at` starts looking (R7). By place when the point's place among
 * the source's every point is known (`from`) and the answer is numbered (`offset`): the neighbour in the data's order,
 * one at the same x too, so recordings of one value are each stepped onto once. Otherwise by x: the first point
 * strictly past `at` (a backend line's x never repeats). −1 with none.
 */
export function stepStart(got: Pick<FullPoints, 'xs' | 'offset'>, at: number, delta: -1 | 1, from?: number): number {
    if (from !== undefined && got.offset !== undefined && got.xs[from - got.offset] === at) {
        const next = from - got.offset + delta;
        return next >= 0 && next < got.xs.length ? next : -1;
    }
    if (delta > 0) return got.xs.findIndex(x => x > at);
    for (let back = got.xs.length - 1; back >= 0; back--) if (got.xs[back] < at) return back;
    return -1;
}

/**
 * What an arrow key reads `delta` along from `read` (R7), as the pointer on it would: of a line with full data, its
 * next full-resolution point (bin, sample, frame), however many share a pixel, at every zoom; of a line drawn whole,
 * its next value (a bar, a dot); of an image, the next column on the same row. Null past the end or off the plot;
 * undefined while the next points are fetched, or their read failed (`ready` is called once they are in, or asked again).
 */
export function stageStep(plot: StagePlot, read: StageRead, delta: -1 | 1, ready: () => void = () => undefined): StageRead | null | undefined {
    if (read.pending || read.failed) return null;
    if (read.image) {
        const source = read.layer.full;
        return plot.image && source.cells !== cannotRead && read.full && read.at !== undefined && read.row !== undefined ? imageStep(plot, plot.image, source, read, delta, ready) : null;
    }
    const source = read.layer.full;
    if (read.full && read.at !== undefined) {
        // The first full point past the one read, in the key's direction, that has a value to read, however long the
        // silence before it: one read finds it (`seek`, full_read._seek_line) and brings STEP_AHEAD more past it, so
        // the next keys need none. Past the plot's side, or the data's end, there is nothing further to read.
        const at = read.at;
        // A source that numbers its points (FullPoints.offset: one the webview holds whole) is stepped by place, so
        // points sharing one x are each visited once, in the data's order (LineQuery.from); see stepStart.
        // The place of a point that is a thing (a recording) is where that thing is in the line now, by its identity:
        // the index it was read at is only a place in the drawing it was read on.
        let from = read.index !== undefined && read.index >= 0 && source.held === 'inline' ? read.index : undefined;
        if (read.layer.identity) {
            const place = read.identity === undefined ? null : identifiedPlace({ ...plot, lines: [read.layer] }, read.identity);
            if (!place) return null;
            from = (place.points.offset ?? 0) + place.index;
        }
        const got = source.line({ x0: at, x1: at, beyond: STEP_AHEAD, seek: delta, ...(from !== undefined ? { from } : {}), ...(floorless(read.layer.view, plot.diff) ? { plain: true } : {}) }, ready);
        if (got === undefined) return undefined;
        // The seek failed (not the data's end): the step waits for it to be asked again once the store's pause is over
        // (`ready`), and the keys pressed meanwhile with it (R7).
        if (got === null && source.held === 'fetched') return undefined;
        if (!got) return null;
        let index = stepStart(got, at, delta, from);
        for (; index >= 0 && index < got.xs.length; index += delta) {
            const point = fullPoint(plot, read.layer, got, index);
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
    const amount = valueText(view, value, plot.diff, plot.levelUnit);
    const where = layer.rowName ? atValue(view, at) : atValue(view, at, place, spacingAt(got.xs, column), spacingAt(got.ys, row));
    const name = got.rowNames?.[row] ?? layer.label ?? (plot.diff ? 'Δ' : '');
    const rowStep = spacingAt(got.ys, row), step = spacingAt(got.xs, column);
    return { ...readoutOf(layer, { x, y }, name, [where, amount]), image: true, index: -1, full: true, at, row: place, value, ...(rowStep !== undefined ? { rowStep } : {}), ...(step !== undefined ? { step } : {}) };
}

/**
 * A heatmap's hover (R7): the cell under the pointer, read as its name (the row's, for rows that are things), where it
 * is and its value in the colour's unit. With full data it is the real cell there (one time frame, one frequency
 * bin), never a cell averaged for the screen. An image has no line to mark: the cursor alone, at the pointer.
 */
function imageHover(plot: StagePlot, image: NonNullable<StagePlot['image']>, x: number, y: number, ready: () => void): StageRead | null {
    const { layer } = image;
    const source = layer.full;
    if (source.cells === cannotRead) return null;
    const place = image.valueAt(x, y);
    if (!place) return null;
    const got = source.cells({ x: place.x, y: place.y, beyond: 1, rowLog: image.rowLog }, ready);
    if (got === undefined) return pendingRead(layer, x, y, true);
    if (got === null && source.held === 'fetched') return pendingRead(layer, x, y, true, true);
    if (!got?.xs.length || !got.ys?.length) return null;
    const column = cellIndex(got.xs, place.x, image.columnLog, { low: got.start === null, high: got.end === null });
    const row = cellIndex(got.ys, place.y, image.rowLog, { low: true, high: true });
    return column < 0 || row < 0 ? null : cellRead(plot, layer, got, column, row, x, y);
}

/** The very cell `read` reads, on an image drawn anew: its column and row by their values, at its new place; null off the plot. */
function imageReadAgain(plot: StagePlot, read: StageRead, ready: () => void): StageRead | null | undefined {
    const image = plot.image;
    const source = image?.layer.full;
    if (!image || !source?.cells || read.at === undefined || read.row === undefined) return null;
    const got = source.cells({ x: read.at, y: read.row, beyond: 1, rowLog: image.rowLog }, ready);
    if (got === undefined) return undefined;
    if (got === null && source.held === 'fetched') return { ...read, layer: image.layer, failed: true };
    if (!got?.xs.length || !got.ys?.length) return null;
    const column = got.xs.indexOf(read.at), row = got.ys.indexOf(read.row);
    if (column < 0 || row < 0) return null;
    const placed = image.placeOf(read.at, read.row);
    if (placed.x < plot.frame.left || placed.x > plot.frame.left + plot.frame.width) return null;
    return cellRead(plot, image.layer, got, column, row, placed.x, placed.y);
}

/** An arrow key on an image with full data: the next real column (time frame) on the row read. */
function imageStep(plot: StagePlot, image: NonNullable<StagePlot['image']>, source: FullSource, read: StageRead, delta: -1 | 1, ready: () => void): StageRead | null | undefined {
    const at = read.at as number, place = read.row as number;
    const got = source.cells({ x: at, y: place, beyond: STEP_AHEAD, rowLog: image.rowLog }, ready);
    if (got === undefined) return undefined;
    // The next cells' read failed: the step waits, and is taken once they are asked again (`ready`), never dropped.
    if (got === null && source.held === 'fetched') return undefined;
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
function paintBandSteps(context: CanvasRenderingContext2D, steps: NonNullable<StagePaintOptions['bandSteps']>, frame: PlotBox, xAt: (hz: number) => number, yOf: (value: number) => number): void {
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
        // The step from 0 to its Δ at their exact y's (R2: clipped, not clamped). Its body filled over the part on the
        // plot; a leak's outline stroked with an edge past the plot put just past the plot's clip, so no edge is drawn
        // where the step is cut and what is seen is the exact rectangle's.
        const exactLow = Math.max(yOf(0), yOf(delta)), exactHigh = Math.min(yOf(0), yOf(delta));
        const bottom = frame.top + frame.height;
        const within = (margin: number): [number, number, number, number] => {
            const high = Math.max(frame.top - margin, Math.min(bottom + margin, exactHigh)), low = Math.max(frame.top - margin, Math.min(bottom + margin, exactLow));
            return [x0, high, Math.max(1, x1 - x0), low - high];
        };
        if (leak(band)) { context.globalAlpha = 0.6; context.setLineDash([3, 2]); context.strokeRect(...within(1)); context.setLineDash([]); return; }
        context.globalAlpha = headline.includes(band) ? 0.45 : 0.15;
        context.fillRect(...within(0));
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

function paintGuides(context: CanvasRenderingContext2D, guides: NonNullable<StagePaintOptions['guides']>, plot: { left: number; top: number; width: number; height: number }, xAt: (value: number) => number, yOf: (value: number) => number, text: string): void {
    context.save();
    context.beginPath(); context.rect(plot.left, plot.top, plot.width, plot.height); context.clip();
    context.fillStyle = text;
    context.globalAlpha = 0.08;
    for (const span of guides.spans ?? []) {
        const x0 = xAt(span.start), x1 = xAt(span.end);
        context.fillRect(x0, plot.top, Math.max(1, x1 - x0), plot.height);
    }
    // The level guide at its exact y, and only where it is on the plot (R2: a line past the axis is clipped, never
    // drawn along the plot's edge as if the level were there).
    const levelY = guides.level ? yOf(guides.level.value) : NaN;
    if (guides.level && levelY >= plot.top && levelY <= plot.top + plot.height) {
        context.globalAlpha = 0.9;
        context.strokeStyle = text;
        context.setLineDash([5, 3]);
        context.lineWidth = 1;
        const y = levelY;
        context.beginPath(); context.moveTo(plot.left, y); context.lineTo(plot.left + plot.width, y); context.stroke();
        context.setLineDash([]);
        context.font = '10px sans-serif';
        context.fillText(guides.level.label, plot.left + plot.width - context.measureText(guides.level.label).width - 4, Math.max(plot.top + 10, y - 3));
    }
    context.restore();
}

/** The plot's margins on a pane (as paintOverlay leaves them without labels). */
export const STAGE_MARGINS: PlotMargins = { left: PANE_LEFT, top: 4, right: 4, bottom: 16 };

/**
 * The margins `plot` was drawn with on `canvas` (its frame: paintOverlay widens the right one for a second level
 * axis), so a gesture is placed on the plot as it is drawn; STAGE_MARGINS where nothing is drawn.
 */
export function drawnMargins(canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>, plot: Pick<StagePlot, 'frame'> | null | undefined): PlotMargins {
    if (!plot) return STAGE_MARGINS;
    const rect = canvas.getBoundingClientRect(), { frame } = plot;
    return { left: frame.left, top: frame.top, right: Math.max(0, rect.width - frame.left - frame.width), bottom: Math.max(0, rect.height - frame.top - frame.height) };
}

/**
 * The pointer on a pane: its place on the plot as `drawn` (the frame it was painted in, its right-hand level axis
 * too), or which axis it is over; the right-hand axis of a plot with two answers as a value axis ('y').
 */
export function stagePlotPoint(canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>, clientX: number, clientY: number, drawn?: Pick<StagePlot, 'frame' | 'secondary'> | null): { fx: number; fy: number; axis: 'x' | 'y' | null; right?: boolean } {
    const margins = drawnMargins(canvas, drawn);
    const point = plotPointIn(canvas, margins, clientX, clientY);
    const rect = canvas.getBoundingClientRect();
    const right = !!drawn?.secondary && margins.right > 0 && clientX - rect.left > rect.width - margins.right;
    return right && !point.axis ? { ...point, axis: 'y', right: true } : point;
}
