import { HEATMAP_DB_SPAN, heatmapDbRange, niceRange } from '../../shared/utils/ticks';
import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';
import type { Answer, AnswerIdentity } from './answerTypes';
import { scanAnswer } from './answerStore';
import { stageAxes, stageDiffRange, stageRange, type StageAxes, type StageStrings } from './stagePanes';
import { levelIdentityOf, paneAxes, type LevelInput, type PaneAxes, type PaneRange } from './comparePanes';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';

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

export type ExclusionReason = 'pending' | 'stale' | 'failed' | 'empty' | 'missing' | 'other-reference' | 'other-axis';

/**
 * What a figure counts its answers against: the level key of the line they are compared with (`level`; null: the
 * first ready answer's) and, where a median is taken point by point, the axis its values are on (`axisOf`: the
 * sample rate and spec of a scan's spectrum), so no median is of values at different frequencies.
 */
export interface FigureOf<T> {
    level: string | null;
    axis?: string | null;
    axisOf?: (value: T) => string;
}

/** One figure's set: the answers it is of, the ones it leaves out with why, its n and its files. */
export interface FigureSet<T> {
    used: Array<{ path: string; value: T; identity: AnswerIdentity }>;
    excluded: Array<{ path: string; reason: ExclusionReason }>;
    n: number;
    paths: string[];
}

/**
 * Which answers a figure's number is of (a median, a Δ, a count n, a heading, the CSV's 基準群 n and files): the ready
 * ones of `of`'s level identity and axis. Every other is excluded with why: still computing, of an earlier recipe,
 * version or calibration (stale), failed, empty, missing, of another level reference or on another axis. Nothing
 * pending or stale is ever counted. Every count of every output takes its set here, with the figure's identity.
 */
export function figureUsed<T>(answers: ReadonlyArray<Answer<T>>, of: FigureOf<T>): FigureSet<T> {
    const used: FigureSet<T>['used'] = [];
    const excluded: FigureSet<T>['excluded'] = [];
    const first = answers.find(answer => answer.state === 'ready');
    const firstReady = first?.state === 'ready' ? first : undefined;
    const level = of.level ?? (firstReady ? levelKeyOf(firstReady.identity.level) : null);
    const axis = of.axisOf ? of.axis ?? (firstReady ? of.axisOf(firstReady.value) : null) : null;
    for (const answer of answers) {
        const path = answer.identity.path;
        if (answer.state !== 'ready') { excluded.push({ path, reason: answer.state }); continue; }
        if (level !== null && levelKeyOf(answer.identity.level) !== level) { excluded.push({ path, reason: 'other-reference' }); continue; }
        if (axis !== null && of.axisOf && of.axisOf(answer.value) !== axis) { excluded.push({ path, reason: 'other-axis' }); continue; }
        used.push({ path, value: answer.value, identity: answer.identity });
    }
    return { used, excluded, n: used.length, paths: used.map(item => item.path) };
}

/** How many of a set's answers were left out for `reason`. */
export const excludedFor = (set: Pick<FigureSet<unknown>, 'excluded'>, ...reasons: ExclusionReason[]): number => set.excluded.filter(item => reasons.includes(item.reason)).length;

// ── Scans as a figure's answers ───────────────────────────────────────────────────────────────────────────────────

/** A scan that read its file. */
type ReadScan = ScanResult & { ok: true };

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

/** What a set of scans is counted against: the compared scan's level identity and spectrum axis (none: the first ready one's). */
export function scanFigureOf(like: ScanResult | undefined): FigureOf<ReadScan> {
    return { level: scanLevelKey(like), axis: like?.ok ? scanAxis(like as ReadScan) : null, axisOf: scanAxis };
}

/** The set of `paths` a map of scans gives, counted against `like` (the compared scan). */
export function scanSet(results: ReadonlyMap<string, ScanResult>, paths: readonly string[], like: ScanResult | undefined): FigureSet<ReadScan> {
    return figureUsed(paths.map(path => scanAnswer(path, results.get(path))), scanFigureOf(like));
}

/**
 * A step figure's base set: of the base recordings (already the comparison's set), those whose step picture is in and
 * kept its values. A picture on its way is pending, a failed one failed, one without kept values empty, so the
 * median, the heading's n and the drawn waveforms are of the same recordings.
 */
export function pictureSet(paths: readonly string[], viewOf: (path: string) => StageView | null | undefined, levelOf: (path: string) => LevelInput | undefined, like: LevelInput | undefined): FigureSet<StageView> {
    const answers = paths.map((path): Answer<StageView> => {
        const view = viewOf(path);
        const identity: AnswerIdentity = { path, fileVersion: '', calibrationSignature: '', level: levelOf(path) ?? like ?? { unit: '', ref: 1, levelReferenceLabel: '', calibrationStatus: 'uncalibrated', fullScale: true }, recipeKey: '', region: '', conditionId: '' };
        if (view === undefined) return { state: 'pending', identity };
        if (view === null) return { state: 'failed', identity };
        return view.data || view.waveform ? { state: 'ready', value: view, identity } : { state: 'empty', identity };
    });
    return figureUsed(answers, { level: like ? levelKeyOf(like) : null });
}
