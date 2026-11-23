import { fieldDecimals } from '../shell/numberText';
import { atDecimals, fieldWindow } from '../figure/fieldWindow';

// The specified range's ends are made by figure/fieldWindow.ts (one rule for the old plots and the Figure).
export { atDecimals, fieldWindow };
import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';
import { levelIdentityOf, type LevelInput, type PaneRange } from './comparePanes';
import type { StageView } from '../../shared/protocol/backendProtocol';
import type { UiStrings } from '../../shared/i18n/strings';

/**
 * The figure model (docs/plot-layers.md, part 2): the words and counts a screen writes outside a figure. Which files a
 * set counts and why one was left out, the calibration word a line carries, the titles of the count and CSV columns,
 * and a typed range's ends are decided here, the same for the screen and the CSVs. It is pure: it keeps nothing
 * between calls and holds no answer (answerStore.ts does). A figure's own axis names and ranges are not made here:
 * the Figure names the axes from its picture (figure/axisNames.ts) and the figure service decides the ranges
 * (python-backend/figures/ranges.py), and which recordings a figure counts is the service's too (figures/members.py).
 */

declare const figureBrand: unique symbol;
/**
 * An axis' range, made only here (from the full data by R9's rule, or as a window of one made here). `typed`: which
 * ends the user typed (a colour scale's typed ends are painted and written exactly as typed, colourScale).
 */
export type FigureRange = Readonly<PaneRange> & { readonly typed?: Readonly<{ min: boolean; max: boolean }>; readonly [figureBrand]: 'range' };

const ranged = (range: PaneRange): FigureRange => ({ min: range.min, max: range.max }) as FigureRange;

// ── Names ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A name of an axis that is not a level (time, frequency, bands, rows, a count, a phase, a coherence, a CSV column),
 * made only here from the strings that name such axes: no level's name can be one.
 */
export type PlainTitle = string & { readonly [figureBrand]: 'plain' };
/**
 * A CSV column's value axis: its name and the unit its header gives ("temp [°C]", "temp (°C)"), or that the unit is not
 * known (R4: every axis names its unit). A CSV's own column is never one of the levels the scan measured.
 */
export function csvColumnTitle(column: string, strings: { dsDistCsvAxis: string; axisUnitUnknown: string }): PlainTitle {
    const given = /^(.*\S)\s*(?:\[([^\]]+)\]|\(([^)]+)\))$/su.exec(column.trim());
    const unit = given ? (given[2] ?? given[3]).trim() : '';
    const name = given && unit ? given[1] : column;
    return strings.dsDistCsvAxis.replace('{col}', () => name).replace('{unit}', () => unit || strings.axisUnitUnknown) as PlainTitle;
}

// ── Ranges ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `value` written with `decimals` decimals, moved by `steps` of its last decimal (decimal arithmetic, no float step). */
function decimalStep(text: string, decimals: number, steps: -1 | 1): number {
    const negative = text.startsWith('-');
    const units = BigInt(text.replace('-', '').replace('.', '')) * (negative ? -1n : 1n) + BigInt(steps);
    const digits = (units < 0n ? -units : units).toString().padStart(decimals + 1, '0');
    return Number(`${units < 0n ? '-' : ''}${decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits}`) + 0;
}

/** The smallest number written with `decimals` decimals that is not below `value` (floorTo's mirror). */
export function ceilTo(value: number, decimals: number): number {
    if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return value;
    const text = value.toFixed(decimals), near = Number(text) + 0;
    return near >= value ? near : decimalStep(text, decimals, 1);
}

/**
 * The amplitude a waveform lane shows from its bottom edge to its top, in the channel's unit, as it is painted and as
 * its range popover writes it: unzoomed, the peak at WAVEFORM_HALF_HEIGHT_RATIO of the half height widened out to the
 * field's decimals; zoomed, the window's ends at the field's decimals (fieldWindow).
 */
export function laneAmplitudeRange(peak: number, viewport?: { minNorm: number; maxNorm: number }): FigureRange {
    // A norm times the peak is a float step off the number typed: the window is painted at the field's decimals (R9).
    if (viewport) return ranged(fieldWindow(viewport.minNorm * peak, viewport.maxNorm * peak));
    // The automatic range widened out to the decimals its range popover writes (R9), as a colour scale is.
    const exact = peak / (2 * WAVEFORM_HALF_HEIGHT_RATIO);
    const edge = ceilTo(exact, fieldDecimals(2 * exact));
    return ranged({ min: -edge + 0, max: edge });
}

// ── Level identity ────────────────────────────────────────────────────────────────────────────────────────────────

/** What levels are in for sharing an axis (R1, R4: unit, reference value, level reference name). */
export type LevelOf = Pick<LevelInput, 'unit' | 'ref' | 'levelReferenceLabel'>;

/**
 * The key lines share an axis by (levelIdentityOf). `shownAs` is what a picture's own axis says its levels are in (a
 * slice's or a spectrogram's bracketed reference): lines whose pictures say different things never share an axis
 * either, even where their recordings' identity agrees. A line without an input is keyed by `shownAs` alone.
 */
export function levelKeyOf(input: LevelOf | null | undefined, shownAs?: string): string {
    const identity = input ? levelIdentityOf(input) : '';
    return shownAs === undefined ? identity : JSON.stringify([identity, shownAs]);
}

/** A plain gain's unit: a ratio of one unit to itself, the one place a bare dB is not an absolute level (R7). */
const GAIN_DB = 'dB';

/**
 * The input one line made of several recordings (a base group's median, a recording's channels read together) is of:
 * their reference, calibrated only when every one of them is, so the line says uncalibrated while any of its own
 * recordings is (R4). The screen's axis and legend, the report's axis and the comparison's sides all take it here.
 */
export function medianInputOf<I extends { calibrationStatus?: string }>(inputs: ReadonlyArray<I | null | undefined>): I | undefined {
    const known = inputs.filter((input): input is I => !!input);
    const first = known[0];
    if (!first) return undefined;
    return { ...first, calibrationStatus: known.every(input => input.calibrationStatus === 'calibrated') ? 'calibrated' : 'uncalibrated' };
}

/**
 * What a step picture's values are re (R1): a transfer function's gain is re its pair's unit ratio (plain dB for one
 * unit), so two recordings' gains compare whatever their channels are calibrated in; a cross spectrum against the
 * base slot is re the pair's reference (its unit, as the backend names it); anything else is its channel's level.
 */
export function pictureLevelOf(view: StageView | null | undefined, own: PairInput | undefined, pairFrame = false): LevelInput | undefined {
    // A pair's step whose picture is not in yet: its identity is not known (pending), never its channels' level.
    if (pairFrame && !view) return undefined;
    if (view?.quantity === 'gain') return { unit: view.unit || '1', ref: 1, levelReferenceLabel: view.unit || GAIN_DB, calibrationStatus: pairCalibration(view, own), fullScale: false };
    if (view?.quantity === 'level' && view.pair && view.unit) return { unit: view.unit, ref: 1, levelReferenceLabel: view.unit, calibrationStatus: pairCalibration(view, own), fullScale: false };
    return own;
}

/** A scan's input with each channel's own status and, against the base slot, the base channel's (scan_service). */
export type PairInput = LevelInput & { channelCalibration?: ReadonlyArray<LevelInput['calibrationStatus']>; baseCalibrationStatus?: LevelInput['calibrationStatus'] };

/**
 * A pair's calibration (R4): calibrated only when both of its sides are. Against the base slot: the recording's
 * channel and the base's; within one recording: its two channels (ch output / ch input); unknown sides are not.
 */
export function pairCalibration(view: Pick<StageView, 'pair'>, own: PairInput | undefined): LevelInput['calibrationStatus'] {
    if (!own) return 'uncalibrated';
    const pair = view.pair;
    const sides = !pair ? [own.calibrationStatus]
        : pair.base ? [own.calibrationStatus, own.baseCalibrationStatus]
            : [own.channelCalibration?.[pair.output - 1] ?? own.calibrationStatus, own.channelCalibration?.[pair.input - 1] ?? own.calibrationStatus];
    // One line of two sides: calibrated only when every side is (medianInputOf's rule); an unknown side is not.
    return medianInputOf(sides.map(side => ({ calibrationStatus: side ?? 'uncalibrated' })))?.calibrationStatus === 'calibrated' ? 'calibrated' : 'uncalibrated';
}

/** The step Frames whose values are of a pair, counted by their pictures' identity (R1). */
export const pairLevelFrame = (frame: string | undefined): boolean => frame === 'TransferFunctionFrame' || frame === 'CrossSpectralFrame';

// ── Which files a figure counts ───────────────────────────────────────────────────────────────────────────────────

/**
 * Why an answer is not counted: still computing, of an earlier recipe, version or calibration (stale), failed, empty,
 * never asked (missing), of another level reference or on another axis than the figure's, or ready while the figure
 * has no identity yet (its compared recording has no ready answer of its own: 'no-identity').
 */
export type ExclusionReason = 'pending' | 'stale' | 'failed' | 'too-large' | 'empty' | 'missing' | 'other-reference' | 'other-channels' | 'other-axis' | 'no-identity' | 'no-channel';

declare const setBrand: unique symbol;
/**
 * One figure's counts as a heading says them, made only by countedSet from what the figure service returned (計算ア):
 * its n, its files, and who was left out with why. Every heading, chip and definition takes this one object.
 */
export interface FigureSet {
    readonly excluded: ReadonlyArray<{ path: string; reason: ExclusionReason }>;
    readonly n: number;
    readonly paths: readonly string[];
    readonly [setBrand]: true;
}

/** The figure service's reasons for a recording left out (計算ア, members.py), as a heading says them. */
const SERVICE_REASONS: Readonly<Record<string, ExclusionReason>> = {
    pending: 'pending', stale: 'stale', failed: 'failed', 'too-large': 'too-large', evicted: 'missing', version: 'stale', 'no-identity': 'no-identity', 'other-reference': 'other-reference', 'other-axis': 'other-axis',
    'other-channels': 'other-channels', 'no-channel': 'no-channel',
};

/**
 * The counts the figure service returned for a figure on the new path (計算ア: python-backend/figures/members.py), as a
 * set for a heading's words (setCountText, setExclusionText): its n, its files and who was left out why, in the
 * service's reasons. Nothing is counted or judged here; the set holds no answers.
 */
export function countedSet(paths: readonly string[], excluded: ReadonlyArray<{ path: string; reason: string }>): FigureSet {
    return { excluded: excluded.map(item => ({ path: item.path, reason: SERVICE_REASONS[item.reason] ?? 'missing' })), n: paths.length, paths: [...paths] } as unknown as FigureSet;
}

/** How many of a set's answers were left out for `reason`. */
export const excludedFor = (set: FigureSet, ...reasons: ExclusionReason[]): number => set.excluded.filter(item => reasons.includes(item.reason)).length;

export type SetStrings = Pick<UiStrings, 'entryBaseMedian' | 'dsBaseFailed' | 'dsBaseTooLarge' | 'dsBaseEmpty' | 'dsBaseOtherChannels' | 'dsBaseMissing' | 'dsBasePending' | 'dsBaseStale' | 'dsBaseOtherUnits' | 'dsBaseOtherBins' | 'dsBaseNoIdentity'> & Partial<Pick<UiStrings, 'dsBaseFewer'>>;

/**
 * " · 1 failed left out · 1 still computing · …": what a set left out, with why, as every heading and file says it.
 * `channel`: the channel a group's members are compared as, named where members without it were left out.
 */
export function setExclusionText(set: FigureSet, strings: Omit<SetStrings, 'entryBaseMedian'>, channel?: number | null): string {
    const fewer = excludedFor(set, 'no-channel');
    const without = fewer && strings.dsBaseFewer ? strings.dsBaseFewer.replace('{n}', String(fewer)).replace('{ch}', String(channel ?? '')) : '';
    const say = (template: string, n: number): string => (n ? template.replace('{n}', String(n)) : '');
    // An empty answer (nothing to show, e.g. a trigger that found no event) is said apart from a failed one.
    return say(strings.dsBaseFailed, excludedFor(set, 'failed')) + say(strings.dsBaseTooLarge, excludedFor(set, 'too-large')) + say(strings.dsBaseEmpty, excludedFor(set, 'empty')) + say(strings.dsBaseMissing, excludedFor(set, 'missing')) + say(strings.dsBasePending, excludedFor(set, 'pending'))
        + say(strings.dsBaseStale, excludedFor(set, 'stale')) + say(strings.dsBaseOtherUnits, excludedFor(set, 'other-reference')) + say(strings.dsBaseOtherChannels, excludedFor(set, 'other-channels')) + say(strings.dsBaseOtherBins, excludedFor(set, 'other-axis'))
        + say(strings.dsBaseNoIdentity, excludedFor(set, 'no-identity')) + without;
}

/**
 * "median of 3 · 1 failed left out · 1 still computing · …": a set's count and what it left out, as every heading,
 * chip and definition writes it. It takes only a FigureSet: a heading cannot say another count than the set drawn.
 */
export function setCountText(set: FigureSet, strings: SetStrings, count = strings.entryBaseMedian, channel?: number | null): string {
    return count.replace('{count}', String(set.n)) + setExclusionText(set, strings, channel);
}
