import { HEATMAP_DB_SPAN, heatmapDbRange, niceRange } from '../../shared/utils/ticks';
import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';
import type { Answer, AnswerIdentity } from './answerTypes';
import { amplitudeAxisTitle, stageAxes, stageDiffRange, stageRange, type StageAxes, type StageStrings } from './stagePanes';
import { levelIdentityOf, paneAxes, type LevelInput, type PaneAxes, type PaneRange } from './comparePanes';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import { channelResult } from '../../shared/recipe/channelSelection';
import type { UiStrings } from '../../shared/i18n/strings';

/**
 * The figure model (docs/plot-layers.md, layer 2): what a figure draws of its answers and what it writes. Every figure's axes,
 * their names and their ranges, the calibration word a line carries, and which files a figure counts are decided
 * here, the same for the screen, the report's PNGs and the CSVs. It is pure: it keeps nothing between calls and holds
 * no answer (answerStore.ts does). paintOverlay takes only the names and ranges made here (FigureNames, FigureRange),
 * and src/test/figureModel.test.ts fails on axis names, ranges, level identities or counts made anywhere else.
 */

declare const figureBrand: unique symbol;
/** An axis' names, made only here: paintOverlay and the CSV writers take no other. */
export type FigureNames = Readonly<StageAxes> & { readonly [figureBrand]: 'names' };
/** An axis' range, made only here (from the full data by R9's rule, or as a window of one made here). */
export type FigureRange = Readonly<PaneRange> & { readonly [figureBrand]: 'range' };
/** A level axis' name on its own (a second level axis', a CSV column's reference). */
export type FigureTitle = string & { readonly [figureBrand]: 'title' };

const names = (axes: StageAxes): FigureNames => ({ ...axes }) as FigureNames;
const ranged = (range: PaneRange): FigureRange => ({ min: range.min, max: range.max }) as FigureRange;
const titled = (title: string): FigureTitle => title as FigureTitle;

// ── Names ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A name of an axis that is not a level (time, frequency, bands, rows, a count, a phase, a coherence, a CSV column),
 * made only here from the strings that name such axes: no level's name can be one, so no level axis is named
 * outside this layer's level names (FigureTitle).
 */
export type PlainTitle = string & { readonly [figureBrand]: 'plain' };
/** The strings that name an axis that is not a level. */
export type PlainKey = 'axisTime' | 'axisFrequency' | 'axisBand' | 'axisEntryRows' | 'pairPhaseLabel' | 'pairCoherenceLabel' | 'dsPeak' | 'dsCrest';
export const plainTitle = <K extends PlainKey>(strings: Readonly<Record<K, string>>, key: K): PlainTitle => strings[key] as PlainTitle;
/** A distribution's count axis (files or channels). */
export const countTitle = (strings: { dsDistCountAxis: string }, unit: string): PlainTitle => strings.dsDistCountAxis.replace('{unit}', unit) as PlainTitle;
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

/**
 * Names of axes made of titles made here: a non-level axis' (PlainTitle) or a level's (FigureTitle), never a string
 * written elsewhere, so a bare 'Level [dB]' cannot be wrapped into names (the type refuses it).
 */
export function plainNames(x: PlainTitle | FigureTitle | '', y: PlainTitle | FigureTitle | '', colour?: FigureTitle): FigureNames {
    return names({ x, y, ...(colour !== undefined ? { colour } : {}) });
}

/** An amplitude axis' title (stagePanes.amplitudeAxisTitle: the unit, or the level by `input`'s reference). */
export const amplitudeTitle = (...args: Parameters<typeof amplitudeAxisTitle>): FigureTitle => titled(amplitudeAxisTitle(...args));

/** What each axis of a picture measures (stagePanes.stageAxes): its level axis named by `input`'s reference. */
export function stageNames(strings: StageStrings, view: StageView | null, input: LevelInput | undefined, diff = false): FigureNames {
    return names(stageAxes(strings, view, input, diff));
}

/** The comparison's level and Δ axes (comparePanes.paneAxes) named by `input`'s reference. */
export function paneNames(strings: Parameters<typeof paneAxes>[0], input: LevelInput | undefined): { level: FigureNames & Pick<PaneAxes, 'legend'>; delta: FigureNames & Pick<PaneAxes, 'legend'> } {
    const axes = paneAxes(strings, input);
    return { level: names(axes.level), delta: names(axes.delta) };
}

/** A level axis' title as `template` ("Level{cal} [{label}]") writes it for a reference: the cursor spectrum's. */
export function levelTitle(strings: { axisLevelCal: string; axisLevelUncal: string }, reference: string, calibrated: boolean): FigureTitle {
    return titled((calibrated ? strings.axisLevelCal : strings.axisLevelUncal).replace('{label}', reference));
}

/** A level axis' title while no reference is known (nothing drawn yet): it says so, never a guessed dBFS (R4). */
export const unknownLevelTitle = (strings: { axisLevelCal: string; axisUnitUnknown: string }): FigureTitle => titled(strings.axisLevelCal.replace('{label}', strings.axisUnitUnknown));

/** A level axis' title as the backend wrote it (wandas' axis label of a slice), or its reference. */
export const backendTitle = (axisLabel: string): FigureTitle => titled(axisLabel);

/** The y title of names made here, for a second level axis. */
export const titleOf = (axes: FigureNames): FigureTitle => titled(axes.y);

/** Names made here with another title on the level axis (one made here too). */
export const withTitle = (axes: FigureNames, y: FigureTitle): FigureNames => names({ ...axes, y });

/** The uncalibrated word of the strings, for a line on an axis named calibrated (R4). */
export const uncalibratedWord = (strings: { axisUncalibrated: string }): string => strings.axisUncalibrated;

// ── Ranges ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A range given as is: an empty plot's, a typed window, the colour scale the settings fixed. */
export function plainRange(min: number, max: number): FigureRange {
    return ranged({ min, max });
}

/** Names and range of a plot with nothing on it. */
export const emptyFigure = (): { names: FigureNames; range: FigureRange } => ({ names: plainNames('', ''), range: plainRange(0, 1) });

/**
 * A level axis over lines from `low` to `high` dB: the comparison's dB line rule (stageRange, R9) — every value, each
 * end rounded out to a 5/10/20/25 dB step, never more than 100 dB, so a silent line (−300 dB) cannot squash the rest.
 * A typed end is kept exactly; with the top typed, the bottom is at most 100 dB under it.
 */
export function levelLineRange(low: number, high: number, typed: { min?: number; max?: number } = {}): { minDb: number; maxDb: number } {
    const auto = stageRange([{ kind: 'line', quantity: 'level', xs: [], values: [], valueRange: { min: low, max: high } } as unknown as StageView]);
    const maxDb = typed.max ?? auto.max;
    const minDb = typed.min ?? (typed.max !== undefined ? Math.max(auto.min, typed.max - HEATMAP_DB_SPAN) : auto.min);
    return maxDb > minDb ? { minDb, maxDb } : { minDb: auto.min, maxDb: auto.max };
}

/** Every value of the pictures, by R9's rule (stagePanes.stageRange). */
export function dataRange(views: ReadonlyArray<StageView | null>): FigureRange {
    return ranged(stageRange(views));
}

/** A difference's range, about zero (stagePanes.stageDiffRange). */
export function diffRange(view: StageView | null): FigureRange {
    return ranged(stageDiffRange(view));
}

/** A heatmap's colour range in dB (ticks.heatmapDbRange): its loudest cell down at most HEATMAP_DB_SPAN. */
export function heatmapRange(low: number, high: number): FigureRange {
    return ranged(heatmapDbRange(low, high));
}

/** `low`…`high` widened out to round ends (ticks.niceRange, R9). */
export function roundedRange(low: number, high: number): FigureRange {
    const nice = niceRange(low, high);
    return ranged({ min: nice.low, max: nice.high });
}

/** The part `y` (fractions of it) of a range made here: a vertical zoom (R13). */
export function narrowedRange(range: FigureRange, y: { start: number; end: number }): FigureRange {
    return ranged({ min: range.min + y.start * (range.max - range.min), max: range.min + y.end * (range.max - range.min) });
}

/**
 * The amplitude a waveform lane shows from its bottom edge to its top, in the channel's unit, as makeCoordTransform
 * places it: unzoomed, the peak at WAVEFORM_HALF_HEIGHT_RATIO of the half height; zoomed, the window's own ends.
 */
export function laneAmplitudeRange(peak: number, viewport?: { minNorm: number; maxNorm: number }): FigureRange {
    if (viewport) return ranged({ min: viewport.minNorm * peak, max: viewport.maxNorm * peak });
    const edge = peak / (2 * WAVEFORM_HALF_HEIGHT_RATIO);
    return ranged({ min: -edge, max: edge });
}

/** A range made here with its other fields kept (a lane's range carrying its picture's extra). */
export function rangeWith<R extends PaneRange>(range: R, min: number, max: number): R & FigureRange {
    return { ...range, min, max } as R & FigureRange;
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

/** The items by level key, in the order each key first appears. */
export function byLevelKey<T>(items: readonly T[], keyOf: (item: T) => string): Array<{ key: string; items: T[] }> {
    const groups: Array<{ key: string; items: T[] }> = [];
    for (const item of items) {
        const key = keyOf(item);
        const group = groups.find(entry => entry.key === key);
        if (group) group.items.push(item); else groups.push({ key, items: [item] });
    }
    return groups;
}

/** The members of one key (byLevelKey), or none. */
export const membersOf = <T>(groups: ReadonlyArray<{ key: string; items: T[] }>, key: string): T[] => groups.find(group => group.key === key)?.items ?? [];

/**
 * The word each item's legend name and readout carry (R1, R4, A49): where items of one level key differ in
 * calibration status, each uncalibrated one says `word`, since the axis they share is named by a calibrated one
 * (axisInputOf); '' elsewhere, where the axis' own name says it.
 */
export function calibrationWordsBy<T>(items: readonly T[], keyOf: (item: T) => string, calibrated: (item: T) => boolean, word: string): (item: T) => string {
    return item => {
        if (calibrated(item)) return '';
        const key = keyOf(item);
        return items.some(other => calibrated(other) && keyOf(other) === key) ? word : '';
    };
}

/**
 * The calibration word each recording's legend name and readout carry (R1, R4): where recordings of one level
 * identity (levelIdentityOf: they share an axis) differ in calibration status, each uncalibrated one says so, since
 * the axis they share names only the common quantity, unit and reference (axisInputOf); '' otherwise.
 */
export function calibrationWords(strings: { axisUncalibrated: string }, allTracks: ReadonlyArray<{ filePath: string; input?: LevelInput }>, paths: readonly (string | null | undefined)[], levelOf?: (path: string) => LevelInput | undefined): (path: string | null | undefined) => string {
    // A recording that is no track (a base group's) is known by its scan's input (levelOf).
    const inputOf = (path: string | null | undefined): LevelInput | undefined => (path ? allTracks.find(track => track.filePath === path)?.input ?? levelOf?.(path) : undefined);
    const known = [...new Set(paths)].filter(path => !!inputOf(path));
    const word = calibrationWordsBy(known, path => levelKeyOf(inputOf(path)), path => inputOf(path)?.calibrationStatus === 'calibrated', uncalibratedWord(strings));
    return path => (inputOf(path) ? word(path) : '');
}

/**
 * A CSV's level column and the per-row level-reference column beside it (C5, R1, R4), made only here: the CSV writers
 * take no other, so no level column goes out without the column that says what its dB are re.
 */
export type FigureColumns = { readonly level: string; readonly reference: string; readonly uncalibrated: string } & { readonly [figureBrand]: 'columns' };
const columns = (level: string, reference: string, uncalibrated: string): FigureColumns => ({ level, reference, uncalibrated }) as FigureColumns;
/** A file's own level column (Leq) and its reference column. */
export const levelColumns = (strings: { entryColLeq: string; reportLevelReference: string; entryLeqUncalibrated: string }): FigureColumns => columns(strings.entryColLeq, strings.reportLevelReference, strings.entryLeqUncalibrated);
/** The base group's level column and its reference column (the report's 基準群). */
export const baseLevelColumns = (strings: { reportBaseLeq: string; reportBaseLevelReference: string; entryLeqUncalibrated: string }): FigureColumns => columns(strings.reportBaseLeq, strings.reportBaseLevelReference, strings.entryLeqUncalibrated);

/** A band's level column (the chosen 1/3-octave band) and its reference column beside it. */
export const bandLevelColumns = (strings: { entryColBandLevel: string; reportLevelReference: string; entryLeqUncalibrated: string }, band: string): FigureColumns => {
    const level = strings.entryColBandLevel.replace('{band}', band);
    return columns(level, `${level} · ${strings.reportLevelReference}`, strings.entryLeqUncalibrated);
};

/** The frequency axis' name as a title (the spectrum CSV's frequency columns). */
export const frequencyTitle = (strings: { axisFrequency: string }): PlainTitle => plainTitle(strings, 'axisFrequency');

/**
 * The legend words of a stage figure (R1, R4): each recording's calibration word (calibrationWords, over the compared
 * one, the tracks and the base group) and the base group's own, said once when any base recording is uncalibrated.
 */
export function legendWords(strings: { axisUncalibrated: string }, allTracks: ReadonlyArray<{ filePath: string; input?: LevelInput }>, shownPaths: readonly (string | null | undefined)[], basePaths: readonly string[], levelOf?: (path: string) => LevelInput | undefined): { word: (path: string | null | undefined) => string; baseWord: string } {
    const word = calibrationWords(strings, allTracks, [...shownPaths, ...basePaths], levelOf);
    return { word, baseWord: basePaths.some(path => word(path)) ? uncalibratedWord(strings) : '' };
}

/** A level value's name from a template with {label} (its reference) and {uncal} (said while uncalibrated, R4). */
export function templatedLevelName(strings: { axisUncalibrated: string }, template: string, label: string, calibrated: boolean): FigureTitle {
    return titled(template.replace('{uncal}', calibrated ? '' : uncalibratedWord(strings)).replace('{label}', label));
}

/**
 * A value's name by its own row's level (R1, R4): the template with that row's own reference and, while it is
 * uncalibrated, the word that says so; null while its level is not known (never another row's reference).
 */
export function ownLevelName(strings: { axisUncalibrated: string }, template: string, level: Pick<LevelInput, 'levelReferenceLabel' | 'calibrationStatus'> | null | undefined): FigureTitle | null {
    return level?.levelReferenceLabel ? templatedLevelName(strings, template, level.levelReferenceLabel, level.calibrationStatus === 'calibrated') : null;
}

/** A heading over values whose rows may differ in reference: the template with no reference, each value names its own. */
export function unreferencedName(template: string): FigureTitle {
    return titled(template.replace('{uncal}', '').replace(/\s*\[\{label\}\]/u, '').trim());
}

/**
 * The mark a value carries beside a heading that names the folder's reference (R1, R4): '' for a fresh value of that
 * reference, else its own reference and calibration word (another reference's, or a stale value's, whatever it is).
 */
export function ownReferenceMark(strings: { axisUncalibrated: string }, reference: FolderReference, answer: Answer<unknown> | undefined): string {
    if (!answer || (answer.state !== 'ready' && answer.state !== 'stale')) return '';
    const level = answer.identity.level;
    if (answer.state === 'ready' && ofReference(reference, level)) return '';
    return level.levelReferenceLabel ? templatedLevelName(strings, '{uncal} [{label}]', level.levelReferenceLabel, level.calibrationStatus === 'calibrated') : '';
}

/**
 * The gain plot's axis name, in the UI's language (R4): a gain in plain dB where the two channels share a unit, else
 * the transfer level in dB re the units' ratio, as the backend measured it (its levelReferenceLabel, else the unit of
 * its own English name).
 */
export function gainAxisName(response: { axisLabel?: string; levelReferenceLabel?: string | null; calibrationStatus?: string } | undefined, strings: { axisGain: string; axisTransferLevel: string; axisUncalibrated: string }): FigureTitle {
    const unit = transferReferenceOf(response);
    const name = unit === null ? strings.axisGain : strings.axisTransferLevel.replace('{unit}', unit);
    // A pair is calibrated only when both of its channels are (the backend's calibrationStatus): an uncalibrated pair
    // says so before its unit, as every level does (R4).
    if (response?.calibrationStatus !== 'uncalibrated') return titled(name);
    const at = name.lastIndexOf(' [');
    const word = uncalibratedWord(strings);
    return titled(at < 0 ? `${name}${word}` : `${name.slice(0, at)}${word}${name.slice(at)}`);
}

/** A plain gain's unit: a ratio of one unit to itself, the one place a bare dB is not an absolute level (R7). */
const GAIN_DB = 'dB';

/** What a pair's gain is read in: dB re the units' ratio, or a plain gain's dB (GAIN_DB). */
export const gainUnit = (response: { axisLabel?: string; levelReferenceLabel?: string | null } | undefined): string => transferReferenceOf(response) ?? GAIN_DB;

/**
 * What a pair's gain is re: null for a gain of one unit (a plain ratio, written as a gain), else the units' ratio (its
 * levelReferenceLabel, else its own name's bracket). A gain is a difference of levels, never an absolute dB (R7).
 */
function transferReferenceOf(response: { axisLabel?: string; levelReferenceLabel?: string | null } | undefined): string | null {
    const given = response?.levelReferenceLabel ?? /\[([^\]]+)\]\s*$/u.exec(response?.axisLabel ?? '')?.[1] ?? null;
    return given === GAIN_DB ? null : given;
}

/**
 * The pair responses one gain axis draws (R1, R4): those of the first one's level reference (its units' ratio), by
 * that identity, never by the text of their axis names. The others stay in the legend, not drawn on its numbers.
 */
export function gainAxisLines<C extends { response: { axisLabel?: string; levelReferenceLabel?: string | null } }>(curves: readonly C[]): C[] {
    const groups = byLevelKey(curves, curve => levelKeyOf(undefined, transferReferenceOf(curve.response) ?? ''));
    return groups[0]?.items ?? [];
}

/**
 * The input an axis shared by `inputs` (all of one level key) is named by: a calibrated one's where any is, so the
 * axis says uncalibrated only when every line on it is (R4); each uncalibrated line then says so itself.
 */
export function axisInputOf<I extends { calibrationStatus?: string } | null | undefined>(inputs: readonly I[]): I | undefined {
    return inputs.find(input => input?.calibrationStatus === 'calibrated') ?? inputs.find(input => !!input);
}

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

/**
 * What a picture's own level axis says its levels are in: its bracketed reference ("dB SPL re 20 µPa"), else its
 * unit; '' when it says neither (never a bare "dB" standing for a reference nobody gave, R4, A50).
 */
export function shownLevelOf(reading: { axisLabel?: string; unit?: string }): string {
    const bracket = reading.axisLabel ? /\[([^\]]+)\]\s*$/.exec(reading.axisLabel) : null;
    return bracket ? bracket[1] : reading.unit ?? '';
}

/**
 * The level key of a picture the backend sent with its reference (a spectrogram): its reference unit and value as
 * wandas gave them, and its axis as drawn (unit and title), so two pictures share a colour scale only when both agree.
 */
export function levelKeyOfReading(reading: { referenceUnit?: string; referenceValue?: number; axisLabel?: string; unit?: string }): string {
    return levelKeyOf({ unit: reading.referenceUnit ?? '', ref: reading.referenceValue ?? 1, levelReferenceLabel: shownLevelOf(reading) }, `${reading.unit ?? ''}|${reading.axisLabel ?? ''}`);
}

// ── Level axes ────────────────────────────────────────────────────────────────────────────────────────────────────

/** One level axis: one level identity, its lines, the input that names it, its names and its range. */
export interface FigureAxis<L> {
    identity: string;
    lines: L[];
    input: LevelInput | undefined;
    names: FigureNames;
    range: FigureRange;
}

export interface LevelAxesSpec<L> {
    inputOf: (line: L) => LevelInput | undefined;
    /** The key lines share an axis by: levelKeyOf their input, unless a picture's own reference refines it. */
    keyOf?: (line: L) => string;
    /** The line whose axis is the left one (the base's), where there is one. */
    first?: L;
    /** One axis whatever the identities (an image has one colour bar). */
    one?: boolean;
    names: (input: LevelInput | undefined, lines: L[]) => FigureNames;
    range: (lines: L[]) => FigureRange;
    /** The input to name an axis by when none of its lines has one. */
    fallback?: LevelInput;
}

/**
 * A figure's level axes (R1, R4, C1): one per level identity of its lines, at most two (the first line's, or the
 * first identity's, on the left; the other on the right); with more, none (`tooMany`), so no line is read against
 * another reference's numbers. Each axis is named by axisInputOf its lines' inputs and ranged over its lines alone.
 */
export function levelAxes<L>(lines: readonly L[], spec: LevelAxesSpec<L>): { axes: FigureAxis<L>[]; tooMany: boolean } {
    const keyOf = spec.keyOf ?? ((line: L) => levelKeyOf(spec.inputOf(line)));
    const groups = spec.one ? [{ key: lines.length ? keyOf(lines[0]) : '', items: [...lines] }] : byLevelKey(lines, keyOf);
    if (groups.length > 2) return { axes: [], tooMany: true };
    const firstKey = spec.first !== undefined ? keyOf(spec.first) : groups[0]?.key;
    const ordered = groups.length === 2 && groups[1].key === firstKey ? [groups[1], groups[0]] : groups;
    const axes = ordered.map(group => {
        const input = axisInputOf(group.items.map(spec.inputOf)) ?? spec.fallback;
        return { identity: group.key, lines: group.items, input, names: spec.names(input, group.items), range: spec.range(group.items) };
    });
    return { axes, tooMany: false };
}

// ── Which files a figure counts ───────────────────────────────────────────────────────────────────────────────────

/**
 * Why an answer is not counted: still computing, of an earlier recipe, version or calibration (stale), failed, empty,
 * never asked (missing), of another level reference or on another axis than the figure's, or ready while the figure
 * has no identity yet (its compared recording has no ready answer of its own: 'no-identity').
 */
export type ExclusionReason = 'pending' | 'stale' | 'failed' | 'empty' | 'missing' | 'other-reference' | 'other-channels' | 'other-axis' | 'no-identity' | 'no-channel';
/** Every reason, in the order a heading, CSV and report say them ('no-channel': a group member without the channel compared). */
export const EXCLUSION_REASONS: readonly ExclusionReason[] = ['failed', 'empty', 'missing', 'pending', 'stale', 'other-reference', 'other-channels', 'other-axis', 'no-identity', 'no-channel'];

declare const setBrand: unique symbol;
declare const identityBrand: unique symbol;

/**
 * What a figure is of, made only here: the level key of its compared recording's ready answer (comparedIdentity,
 * scanIdentity, levelIdentity), or the folder's one chosen reference where nothing is compared (referenceIdentity).
 * Never the first ready member's, never a guess for an answer that does not say its own.
 */
export interface FigureIdentity<T> {
    readonly level: string;
    /** The axis its values are on where a median is taken point by point (a scan's sample rate, spec and points). */
    readonly axis: string | null;
    readonly axisOf?: (value: T) => string;
    /** How many channels its values are of (a scan read over its channels together): others' do not compare. */
    readonly channels?: number | null;
    readonly channelsOf?: (value: T) => number;
    readonly [identityBrand]: true;
}

/**
 * One figure's set, made only by figureUsed: the answers it is of, those it leaves out with why, its n and its files.
 * Every median, drawn member line, n, heading, chip, distribution base line, CSV row and report of a figure takes this
 * one object (they accept only a FigureSet), so no second set of the same figure can be built beside it.
 */
export interface FigureSet<T> {
    readonly used: ReadonlyArray<{ path: string; value: T; identity: AnswerIdentity }>;
    readonly excluded: ReadonlyArray<{ path: string; reason: ExclusionReason }>;
    readonly n: number;
    readonly paths: readonly string[];
    /** The identity it is of (null: none yet, every ready answer left out as 'no-identity'). */
    readonly level: string | null;
    readonly [setBrand]: true;
}

const identity = <T>(level: string, axis: string | null, axisOf?: (value: T) => string, channels: { of: number; channelsOf: (value: T) => number } | null = null): FigureIdentity<T> => ({ level, axis, ...(axisOf ? { axisOf } : {}), ...(channels ? { channels: channels.of, channelsOf: channels.channelsOf } : {}) }) as FigureIdentity<T>;

/**
 * What a set's levels are in, as a base's reference cell says it (報告.csv 基準 レベル基準, a fixed Δ's base): its
 * identity's reference, uncalibrated while any recording it counts is (each of full scale or of raw input units).
 */
export function baseLevelOf(set: FigureSet<unknown>): { levelReference?: string; uncalibrated?: 'full-scale' | 'raw-units' } {
    const first = set.used[0]?.identity.level;
    if (!first) return {};
    const raw = set.used.find(item => item.identity.level.calibrationStatus !== 'calibrated')?.identity.level;
    return { levelReference: first.levelReferenceLabel, ...(raw ? { uncalibrated: raw.fullScale ? 'full-scale' as const : 'raw-units' as const } : {}) };
}

/** A figure of a compared recording: its ready answer's level identity (and axis); null while it has none. */
export function comparedIdentity<T>(compared: Answer<T> | undefined, axisOf?: (value: T) => string, channelsOf?: (value: T) => number): FigureIdentity<T> | null {
    if (compared?.state !== 'ready') return null;
    return identity(levelKeyOf(compared.identity.level), axisOf ? axisOf(compared.value) : null, axisOf, channelsOf ? { of: channelsOf(compared.value), channelsOf } : null);
}

/** A figure of a level identity already known from a fresh answer (a stage picture's compared recording, its track's input). */
export function levelIdentity<T>(level: LevelOf | null | undefined, axisOf?: (value: T) => string, axis: string | null = null): FigureIdentity<T> | null {
    return level ? identity(levelKeyOf(level), axis, axisOf) : null;
}

/**
 * Which answers a figure's number is of (a median, a Δ, a count n, a heading, the CSV's 基準群 n and files, the drawn
 * member lines): the ready ones of `of`'s level identity and axis. Every other is excluded with why. Nothing pending
 * or stale is ever counted, and with no identity (`of` null) nothing is: the figure waits for its compared answer.
 */
export function figureUsed<T>(of: FigureIdentity<T> | null, answers: ReadonlyArray<Answer<T>>, left: FigureSet<T>['excluded'] = []): FigureSet<T> {
    const used: Array<FigureSet<T>['used'][number]> = [];
    // `left`: recordings of the figure's group already known left out with why (another reference or axis by their
    // fresh answers), so its heading, CSV and report list them though they are not asked for here.
    const excluded: Array<FigureSet<T>['excluded'][number]> = [...left];
    for (const answer of answers) {
        const path = answer.identity.path;
        if (answer.state !== 'ready') { excluded.push({ path, reason: answer.state }); continue; }
        if (!of) { excluded.push({ path, reason: 'no-identity' }); continue; }
        if (levelKeyOf(answer.identity.level) !== of.level) { excluded.push({ path, reason: 'other-reference' }); continue; }
        // Of another channel count than the compared recording's (read over its channels together): the entry table's ≠ ch.
        if (of.channels !== undefined && of.channels !== null && of.channelsOf && of.channelsOf(answer.value) !== of.channels) { excluded.push({ path, reason: 'other-channels' }); continue; }
        if (of.axis !== null && of.axisOf && of.axisOf(answer.value) !== of.axis) { excluded.push({ path, reason: 'other-axis' }); continue; }
        used.push({ path, value: answer.value, identity: answer.identity });
    }
    return { used, excluded, n: used.length, paths: used.map(item => item.path), level: of?.level ?? null } as unknown as FigureSet<T>;
}

/**
 * The part of a set over `paths` (one group of a distribution): its counted and left-out members among them, with why,
 * as one set, so a group's heading says its own n and left-out recordings of the one set the figure counts.
 */
export function setOver<T>(set: FigureSet<T>, paths: readonly string[]): FigureSet<T> {
    const used = set.used.filter(item => paths.includes(item.path));
    return { used, excluded: set.excluded.filter(item => paths.includes(item.path)), n: used.length, paths: used.map(item => item.path), level: set.level } as unknown as FigureSet<T>;
}

/**
 * A set's count in the unit a figure draws (R1): its recordings, or (`perChannel`, a level's distribution) the drawn
 * channels of its recordings alone, never the rows drawn of any recording.
 */
export function setDrawnCount<T>(set: FigureSet<T>, drawn: ReadonlyArray<{ filePath: string }>, perChannel: boolean): number {
    return perChannel ? drawn.filter(item => set.paths.includes(item.filePath)).length : set.n;
}

/** How many of a set's answers were left out for `reason`. */
export const excludedFor = (set: FigureSet<unknown>, ...reasons: ExclusionReason[]): number => set.excluded.filter(item => reasons.includes(item.reason)).length;

/** The paths a set left out for one of `reasons`. */
export const excludedPaths = (set: FigureSet<unknown>, ...reasons: ExclusionReason[]): string[] => set.excluded.filter(item => reasons.includes(item.reason)).map(item => item.path);

export type SetStrings = Pick<UiStrings, 'entryBaseMedian' | 'dsBaseFailed' | 'dsBaseEmpty' | 'dsBaseOtherChannels' | 'dsBaseMissing' | 'dsBasePending' | 'dsBaseStale' | 'dsBaseOtherUnits' | 'dsBaseOtherBins' | 'dsBaseNoIdentity'> & Partial<Pick<UiStrings, 'dsBaseFewer'>>;

/**
 * " · 1 failed left out · 1 still computing · …": what a set left out, with why, as every heading and file says it.
 * `channel`: the channel a group's members are compared as, named where members without it were left out.
 */
export function setExclusionText(set: FigureSet<unknown>, strings: Omit<SetStrings, 'entryBaseMedian'>, channel?: number | null): string {
    const fewer = excludedFor(set, 'no-channel');
    const without = fewer && strings.dsBaseFewer ? strings.dsBaseFewer.replace('{n}', String(fewer)).replace('{ch}', String(channel ?? '')) : '';
    const say = (template: string, n: number): string => (n ? template.replace('{n}', String(n)) : '');
    // An empty answer (nothing to show, e.g. a trigger that found no event) is said apart from a failed one.
    return say(strings.dsBaseFailed, excludedFor(set, 'failed')) + say(strings.dsBaseEmpty, excludedFor(set, 'empty')) + say(strings.dsBaseMissing, excludedFor(set, 'missing')) + say(strings.dsBasePending, excludedFor(set, 'pending'))
        + say(strings.dsBaseStale, excludedFor(set, 'stale')) + say(strings.dsBaseOtherUnits, excludedFor(set, 'other-reference')) + say(strings.dsBaseOtherChannels, excludedFor(set, 'other-channels')) + say(strings.dsBaseOtherBins, excludedFor(set, 'other-axis'))
        + say(strings.dsBaseNoIdentity, excludedFor(set, 'no-identity')) + without;
}

/**
 * "median of 3 · 1 failed left out · 1 still computing · …": a set's count and what it left out, as every heading,
 * chip and definition writes it. It takes only a FigureSet: a heading cannot say another count than the set drawn.
 */
export function setCountText(set: FigureSet<unknown>, strings: SetStrings, count = strings.entryBaseMedian, channel?: number | null): string {
    return count.replace('{count}', String(set.n)) + setExclusionText(set, strings, channel);
}

// ── Scans as a figure's answers ───────────────────────────────────────────────────────────────────────────────────

/** A scan that read its file. */
export type ReadScan = ScanResult & { ok: true };
type ScanAnswerOf = Answer<ReadScan>;

/** The level key of a scan's levels (levelIdentityOf); null for a scan that read no file. */
export function scanLevelKey(result: ScanResult | undefined): string | null {
    return result?.ok && result.input ? levelKeyOf(result.input) : null;
}

/** Whether the scans here that read their file are all of one level identity: levels are subtracted only then. */
export function oneLevelKey(results: ReadonlyArray<ScanResult | undefined>): boolean {
    return new Set(results.map(scanLevelKey).filter((key): key is string => key !== null)).size <= 1;
}

/**
 * The axis a scan's levels are on: its sample rate and spec (which fixes its bands and its spectrum's points). Never of
 * its 192 drawn points (R1): a median is taken of the bands and of every bin, whose spacing binsOf checks.
 */
export const scanAxis = (result: ReadScan): string => `${result.input?.fs ?? 0}|${result.specVersion ?? ''}`;

/** A scan figure of a compared recording: its ready answer's level identity and spectrum axis; null while it has none. */
export const scanIdentity = (compared: ScanAnswerOf | undefined): FigureIdentity<ReadScan> | null => comparedIdentity(compared, scanAxis, scanChannels);

/** How many channels a scan's values are of (one, once taken as a channel: channelAnswer). */
export const scanChannels = (result: ReadScan): number => result.input?.channels.length ?? 0;

/**
 * The folder's one level reference (R1): of the fresh ready answers, in the table's order, the most common level
 * identity, a tie going to the one whose first recording comes first in the table (never to the one answered first).
 * The entry table's comparable rows, its value columns' heading, the overview strip, the distribution's axis and a
 * group base with nothing compared all take this one choice.
 */
export interface FolderReference {
    readonly level: string | null;
    /** The reference as wandas names it ('' while nothing is read). */
    readonly label: string;
    /** Whether any of its recordings is calibrated: the axis says uncalibrated only when none is (R4). */
    readonly calibrated: boolean;
    /** Its recordings, in the table's order. */
    readonly paths: readonly string[];
    readonly [identityBrand]: 'folder';
}

export function folderReference(answers: ReadonlyArray<ScanAnswerOf>): FolderReference {
    const ready = answers.filter((answer): answer is Extract<ScanAnswerOf, { state: 'ready' }> => answer.state === 'ready');
    const counts = new Map<string, number>();
    for (const answer of ready) { const key = levelKeyOf(answer.identity.level); counts.set(key, (counts.get(key) ?? 0) + 1); }
    // Map keeps first-seen order: the sort is stable, so a tie keeps the one first in the table.
    const level = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const of = ready.filter(answer => levelKeyOf(answer.identity.level) === level);
    return {
        level, label: of[0]?.identity.level.levelReferenceLabel ?? '', calibrated: of.some(answer => answer.identity.level.calibrationStatus === 'calibrated'),
        paths: of.map(answer => answer.identity.path),
    } as unknown as FolderReference;
}

/** A figure of the folder's reference (nothing compared): its level identity, no axis; null while nothing is read. */
export function referenceIdentity<T>(reference: FolderReference): FigureIdentity<T> | null {
    return reference.level === null ? null : identity<T>(reference.level, null);
}

/** Whether an answer's levels are of the folder's reference (on its axis). */
export const ofReference = (reference: FolderReference, level: LevelOf | null | undefined): boolean => !!level && reference.level === levelKeyOf(level);

// ── Step pictures as a figure's answers ─────────────────────────────────────────────────────────────────────────────

/** The axis a step picture is on: its kind, axis and points (a backend median is taken only of aligned pictures). */
export function pictureAxis(view: StageView): string {
    // Over time, recordings of other lengths share the axis: a median and a Δ are taken over their common part (R1),
    // when their values start together at one step (the backend's _aligned, by the full-resolution timeAxis it sends).
    const time = view.timeAxis && view.timeAxis.step > 0 ? `${Math.round(view.timeAxis.start / view.timeAxis.step)}@${view.timeAxis.step.toPrecision(9)}` : '';
    const xs = view.x === 'time' ? time : `${view.xs?.length ?? 0}|${view.xs?.[0] ?? ''}|${view.xs?.at(-1) ?? ''}`;
    // A heatmap's rows are an axis too (its frequencies or bands).
    const ys = view.kind === 'heatmap' ? `|${view.ys?.length ?? 0}|${view.ys?.[0] ?? ''}|${view.ys?.at(-1) ?? ''}|${view.yAxis ?? ''}` : '';
    return `${view.kind}|${view.x ?? ''}|${xs}|${view.quantity ?? ''}|${view.unit ?? ''}${ys}`;
}

/**
 * A step figure's base set: the base's members, each counted only when its step picture is in and kept its values
 * and its own level identity is known from a fresh answer (`levelOf`: its track's input or its fresh scan's; none:
 * pending, never assumed the compared one's) and is the compared recording's (`compared`). `aligned`: a median is
 * taken of them, so a picture on another axis is left out too. The median requested, the member lines drawn, the
 * heading's n and the legend's words are all of this one set.
 */
export function pictureSet(members: readonly string[], answerOf: (path: string) => Answer<StageView>, levelOf: (path: string) => LevelInput | undefined, compared: { level: LevelInput | undefined; view: StageView | null | undefined }, aligned: boolean, left: FigureSet<StageView>['excluded'] = []): FigureSet<StageView> {
    // The compared recording's identity is its picture's, once it is in and kept its values: while it is on its way
    // or failed there is none, and nothing is counted (no-identity).
    const comparedIn = !!compared.view && !!(compared.view.data || compared.view.waveform) && !!compared.level;
    const of = comparedIn ? levelIdentity<StageView>(compared.level, aligned ? pictureAxis : undefined, aligned && compared.view ? pictureAxis(compared.view) : null) : null;
    const known: Array<FigureSet<StageView>['excluded'][number]> = [...left];
    const answers = members.flatMap((path): Array<Answer<StageView>> => {
        const level = levelOf(path);
        // A member whose fresh level is of another reference is that, whether its picture is in or not.
        if (of && level && levelKeyOf(level) !== of.level) { known.push({ path, reason: 'other-reference' }); return []; }
        // The answer store's answer (stageSource.answer) with the identity it was answered or asked under, counted by
        // the level the figure reads it in (a pair's unit ratio or reference, else its channel's). None is made here.
        const answer = answerOf(path);
        const id: AnswerIdentity = { ...answer.identity, level: level ?? answer.identity.level };
        // Not asked yet (it is asked with this figure) or on its way: pending.
        if (answer.state === 'pending' || answer.state === 'missing') return [{ state: 'pending', identity: id }];
        if (answer.state !== 'ready') return [answer.state === 'stale' ? { state: 'stale', identity: id } : { state: answer.state, identity: id }];
        // Its level not known yet (a pair's picture without its identity): not counted, still on its way.
        if (!level) return [{ state: 'pending', identity: id }];
        // Whether a picture has values to count is decided here: one without (a trigger that found no event) is empty.
        const view = answer.value;
        return [view.data || view.waveform ? { state: 'ready', value: view, identity: id } : { state: 'empty', identity: id }];
    });
    return figureUsed(of, answers, known);
}

/** A scan's answer as one channel of its recording (the channel it is compared as): its state and identity kept. */
export function channelAnswer<A extends Answer<ReadScan>>(answer: A, channel: number | null | undefined): A {
    if (!channel || (answer.state !== 'ready' && answer.state !== 'stale')) return answer;
    const one = channelResult(answer.value, channel);
    return one?.ok ? { ...answer, value: one as ReadScan } : answer;
}

