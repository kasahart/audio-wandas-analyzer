import { HEATMAP_DB_SPAN, heatmapDbRange, niceRange } from '../../shared/utils/ticks';
import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import type { Answer, AnswerIdentity } from './answerTypes';
import { levelIdentityOf, paneAxes, type LevelInput, type PaneAxes, type PaneRange } from './comparePanes';
import { stageAxes, stageDiffRange, stageRange, type StageAxes, type StageStrings } from './stagePanes';
import type { StageView } from '../../shared/protocol/backendProtocol';

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

/** A range made here from one made elsewhere by R9's rule inside this layer's callers (a lane's waveform range). */
export const asFigureRange = <R extends PaneRange>(range: R): R & FigureRange => range as R & FigureRange;

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
export function calibrationWords(strings: { axisUncalibrated: string }, allTracks: ReadonlyArray<{ filePath: string; input?: LevelInput }>, paths: readonly (string | null | undefined)[]): (path: string | null | undefined) => string {
    const inputOf = (path: string | null | undefined): LevelInput | undefined => (path ? allTracks.find(track => track.filePath === path)?.input : undefined);
    const known = [...new Set(paths)].filter(path => !!inputOf(path));
    const word = calibrationWordsBy(known, path => levelKeyOf(inputOf(path)), path => inputOf(path)?.calibrationStatus === 'calibrated', uncalibratedWord(strings));
    return path => (inputOf(path) ? word(path) : '');
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

export type ExclusionReason = 'pending' | 'failed' | 'empty' | 'missing' | 'other-reference';

/**
 * Which answers a figure's number is of (a median, a Δ, a count n, the CSV's 基準群 n and files): the ready ones of
 * `identity` (the compared file's level key) where given. Every other is excluded with why: still computing, failed,
 * empty, missing, or of another level reference. Nothing pending is ever counted.
 */
export function figureUsed<T>(answers: ReadonlyArray<Answer<T>>, identity?: string | null): {
    used: Array<{ path: string; value: T; identity: AnswerIdentity }>;
    excluded: Array<{ path: string; reason: ExclusionReason }>;
    n: number;
    paths: string[];
} {
    const used: Array<{ path: string; value: T; identity: AnswerIdentity }> = [];
    const excluded: Array<{ path: string; reason: ExclusionReason }> = [];
    for (const answer of answers) {
        const path = answer.identity.path;
        if (answer.state !== 'ready') { excluded.push({ path, reason: answer.state }); continue; }
        if (identity != null && levelKeyOf(answer.identity.level) !== identity) { excluded.push({ path, reason: 'other-reference' }); continue; }
        used.push({ path, value: answer.value, identity: answer.identity });
    }
    return { used, excluded, n: used.length, paths: used.map(item => item.path) };
}

// ── Adapters (until the answer store hands Answers) ───────────────────────────────────────────────────────────────

const UNKNOWN = '';

/** An answer's identity from what a scan says of its file: only its path and level are known here. */
function identityOf(path: string, level: LevelInput | undefined): AnswerIdentity {
    return { path, fileVersion: UNKNOWN, calibrationSignature: UNKNOWN, level: level ?? { unit: '', ref: 1, levelReferenceLabel: '', calibrationStatus: 'uncalibrated', fullScale: true }, recipeKey: UNKNOWN, region: UNKNOWN, conditionId: UNKNOWN };
}

/** A scan's result as an answer: none yet is pending, one that did not read its file failed. */
export function scanAnswer(path: string, result: ScanResult | undefined): Answer<ScanResult & { ok: true }> {
    if (!result) return { state: 'pending', identity: identityOf(path, undefined) };
    if (!result.ok) return { state: 'failed', identity: identityOf(path, undefined) };
    return { state: 'ready', value: result as ScanResult & { ok: true }, identity: identityOf(path, result.input) };
}
