import { HEATMAP_DB_SPAN, heatmapDbRange, niceRange } from '../../shared/utils/ticks';
import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';
import type { Answer, AnswerIdentity } from './answerTypes';
import { stageAxes, stageDiffRange, stageRange, type StageAxes, type StageStrings } from './stagePanes';
import { levelIdentityOf, paneAxes, type LevelInput, type PaneAxes, type PaneRange } from './comparePanes';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import type { UiStrings } from '../../shared/i18n/strings';

/**
 * The figure model (layers-design.md): what a figure draws of its answers and what it writes. Every figure's axes,
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

/** Names of axes that are not levels (time, frequency, a count, a row's name): written as given. */
export function plainNames(x: string, y: string, colour?: string): FigureNames {
    return names({ x, y, ...(colour !== undefined ? { colour } : {}) });
}

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
export const frequencyTitle = (strings: { axisFrequency: string }): FigureTitle => titled(strings.axisFrequency);

/**
 * The legend words of a stage figure (R1, R4): each recording's calibration word (calibrationWords, over the compared
 * one, the tracks and the base group) and the base group's own, said once when any base recording is uncalibrated.
 */
export function legendWords(strings: { axisUncalibrated: string }, allTracks: ReadonlyArray<{ filePath: string; input?: LevelInput }>, shownPaths: readonly (string | null | undefined)[], basePaths: readonly string[], levelOf?: (path: string) => LevelInput | undefined): { word: (path: string | null | undefined) => string; baseWord: string } {
    const word = calibrationWords(strings, allTracks, [...shownPaths, ...basePaths], levelOf);
    return { word, baseWord: basePaths.some(path => word(path)) ? uncalibratedWord(strings) : '' };
}

/** A level value's name from a template with {label} (its reference) and {uncal} (said while uncalibrated, R4). */
export function templatedLevelName(strings: { axisUncalibrated: string }, template: string, label: string, calibrated: boolean): string {
    return template.replace('{uncal}', calibrated ? '' : uncalibratedWord(strings)).replace('{label}', label);
}

/**
 * The gain plot's axis name, in the UI's language (R4): a gain in plain dB where the two channels share a unit, else
 * the transfer level in dB re the units' ratio, as the backend measured it (its levelReferenceLabel, else the unit of
 * its own English name).
 */
export function gainAxisName(response: { axisLabel?: string; levelReferenceLabel?: string | null } | undefined, strings: { axisGain: string; axisTransferLevel: string }): string {
    const unit = transferReferenceOf(response);
    return unit === 'dB' ? strings.axisGain : strings.axisTransferLevel.replace('{unit}', unit);
}

/** What a pair's gain is in: plain dB for one unit, else dB re the units' ratio (its levelReferenceLabel, else its own name's). */
function transferReferenceOf(response: { axisLabel?: string; levelReferenceLabel?: string | null } | undefined): string {
    return response?.levelReferenceLabel ?? /\[([^\]]+)\]\s*$/u.exec(response?.axisLabel ?? '')?.[1] ?? 'dB';
}

/**
 * The pair responses one gain axis draws (R1, R4): those of the first one's level reference (its units' ratio), by
 * that identity, never by the text of their axis names. The others stay in the legend, not drawn on its numbers.
 */
export function gainAxisLines<C extends { response: { axisLabel?: string; levelReferenceLabel?: string | null } }>(curves: readonly C[]): C[] {
    const groups = byLevelKey(curves, curve => levelKeyOf(undefined, transferReferenceOf(curve.response)));
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
export type ExclusionReason = 'pending' | 'stale' | 'failed' | 'empty' | 'missing' | 'other-reference' | 'other-axis' | 'no-identity';

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

const identity = <T>(level: string, axis: string | null, axisOf?: (value: T) => string): FigureIdentity<T> => ({ level, axis, ...(axisOf ? { axisOf } : {}) }) as FigureIdentity<T>;

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
export function comparedIdentity<T>(compared: Answer<T> | undefined, axisOf?: (value: T) => string): FigureIdentity<T> | null {
    if (compared?.state !== 'ready') return null;
    return identity(levelKeyOf(compared.identity.level), axisOf ? axisOf(compared.value) : null, axisOf);
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
export function figureUsed<T>(of: FigureIdentity<T> | null, answers: ReadonlyArray<Answer<T>>): FigureSet<T> {
    const used: Array<FigureSet<T>['used'][number]> = [];
    const excluded: Array<FigureSet<T>['excluded'][number]> = [];
    for (const answer of answers) {
        const path = answer.identity.path;
        if (answer.state !== 'ready') { excluded.push({ path, reason: answer.state }); continue; }
        if (!of) { excluded.push({ path, reason: 'no-identity' }); continue; }
        if (levelKeyOf(answer.identity.level) !== of.level) { excluded.push({ path, reason: 'other-reference' }); continue; }
        if (of.axis !== null && of.axisOf && of.axisOf(answer.value) !== of.axis) { excluded.push({ path, reason: 'other-axis' }); continue; }
        used.push({ path, value: answer.value, identity: answer.identity });
    }
    return { used, excluded, n: used.length, paths: used.map(item => item.path), level: of?.level ?? null } as unknown as FigureSet<T>;
}

/** How many of a set's answers were left out for `reason`. */
export const excludedFor = (set: FigureSet<unknown>, ...reasons: ExclusionReason[]): number => set.excluded.filter(item => reasons.includes(item.reason)).length;

/** The paths a set left out for one of `reasons`. */
export const excludedPaths = (set: FigureSet<unknown>, ...reasons: ExclusionReason[]): string[] => set.excluded.filter(item => reasons.includes(item.reason)).map(item => item.path);

export type SetStrings = Pick<UiStrings, 'entryBaseMedian' | 'dsBaseFailed' | 'dsBasePending' | 'dsBaseStale' | 'dsBaseOtherUnits' | 'dsBaseOtherBins' | 'dsBaseNoIdentity'>;

/** " · 1 failed left out · 1 still computing · …": what a set left out, with why, as every heading and file says it. */
export function setExclusionText(set: FigureSet<unknown>, strings: Omit<SetStrings, 'entryBaseMedian'>): string {
    const say = (template: string, n: number): string => (n ? template.replace('{n}', String(n)) : '');
    return say(strings.dsBaseFailed, excludedFor(set, 'failed', 'empty', 'missing')) + say(strings.dsBasePending, excludedFor(set, 'pending'))
        + say(strings.dsBaseStale, excludedFor(set, 'stale')) + say(strings.dsBaseOtherUnits, excludedFor(set, 'other-reference')) + say(strings.dsBaseOtherBins, excludedFor(set, 'other-axis'))
        + say(strings.dsBaseNoIdentity, excludedFor(set, 'no-identity'));
}

/**
 * "median of 3 · 1 failed left out · 1 still computing · …": a set's count and what it left out, as every heading,
 * chip and definition writes it. It takes only a FigureSet: a heading cannot say another count than the set drawn.
 */
export function setCountText(set: FigureSet<unknown>, strings: SetStrings, count = strings.entryBaseMedian): string {
    return count.replace('{count}', String(set.n)) + setExclusionText(set, strings);
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

/** The axis a scan's spectrum is on: its sample rate, spec and points (a median is taken point by point). */
export const scanAxis = (result: ReadScan): string => `${result.input?.fs ?? 0}|${result.specVersion ?? ''}|${result.spectrumDb?.[0]?.length ?? 0}`;

/** A scan figure of a compared recording: its ready answer's level identity and spectrum axis; null while it has none. */
export const scanIdentity = (compared: ScanAnswerOf | undefined): FigureIdentity<ReadScan> | null => comparedIdentity(compared, scanAxis);

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
export const pictureAxis = (view: StageView): string => `${view.kind}|${view.x ?? ''}|${view.xs?.length ?? 0}|${view.xs?.[0] ?? ''}|${view.xs?.at(-1) ?? ''}|${view.unit ?? ''}`;

/**
 * A step figure's base set: the base's members, each counted only when its step picture is in and kept its values
 * and its own level identity is known from a fresh answer (`levelOf`: its track's input or its fresh scan's; none:
 * pending, never assumed the compared one's) and is the compared recording's (`compared`). `aligned`: a median is
 * taken of them, so a picture on another axis is left out too. The median requested, the member lines drawn, the
 * heading's n and the legend's words are all of this one set.
 */
export function pictureSet(members: readonly string[], viewOf: (path: string) => StageView | null | undefined, levelOf: (path: string) => LevelInput | undefined, compared: { level: LevelInput | undefined; view: StageView | null | undefined }, aligned: boolean): FigureSet<StageView> {
    const answers = members.map((path): Answer<StageView> => {
        const level = levelOf(path);
        const view = viewOf(path);
        const id: AnswerIdentity = { path, fileVersion: '', calibrationSignature: '', level: level ?? UNKNOWN_LEVEL, recipeKey: '', region: '', conditionId: '' };
        if (view === undefined || !level) return { state: 'pending', identity: id };
        if (view === null) return { state: 'failed', identity: id };
        return view.data || view.waveform ? { state: 'ready', value: view, identity: id } : { state: 'empty', identity: id };
    });
    const axis = aligned && compared.view ? pictureAxis(compared.view) : null;
    return figureUsed(levelIdentity<StageView>(compared.level, aligned ? pictureAxis : undefined, axis), answers);
}

const UNKNOWN_LEVEL: LevelInput = { unit: '', ref: 1, levelReferenceLabel: '', calibrationStatus: 'uncalibrated', fullScale: false };
