/**
 * "Report": the comparison as one folder, `<recipe>_<date-time>/`, holding each slot's base and compare drawn
 * over one another as a titled PNG figure (and their Δ when the comparison shows it), 報告.csv (one row per
 * slot 1–3), the scan Recipe with the region written in, and 定義.json: what each number means and the
 * steps' parameters in decimals.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { encodeNumber, plainFloats, recipeSteps, timeSignalStep, upToStep, withDefaults, withParam, TIME_SLICE } from '../../shared/recipe/recipeSteps';
import { BAND_CENTERS_HZ, bandCentreCell, bandLabel, csvNumber, EDGE_GUARD_S, HEADLINE_WITHIN_DB, leftOf, leftText, levelReferenceCell, measuredRegion, regionCells, type BaseDefinition, type DerivedRow, type EntryMeasure, type EntryModel } from './entryTable';
import { withBaseInput, withChannel } from '../../shared/recipe/channelSelection';
import { baseLevelColumns, baseLevelOf, channelAnswer, medianInputOf, dataRange, diffRange, figureUsed, levelAxes, scanIdentity, setExclusionText, type SetStrings, levelColumns, paneNames, plainNames, plainTitle, titleOf, withTitle, type FigureColumns, type FigureRange, type FigureTitle, type PlainTitle } from './figureModel';
import { setMedian, bandsSource, binsSource, binsView, deltaViews, diffHeadline, levelsHeadline, sideView, type CompareModel, type CompareStrings, type LevelInput } from './comparePanes';
import { SECONDARY_AXIS_DASH } from './overlaySpectrumPainter';
import { paintOverlay } from './stagePanes';
import type { InlineFullSource } from './fullRead';
import { secondsSpanText } from '../plot/plotText';
import type { EntryRegion } from '../../shared/analysis/entryScan';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import type { ScanAnswer } from './answerStore';
import { baseName } from '../../shared/analysis/entryMetadata';
import { powerMeanDb, powerMeanOrNull } from '../../shared/utils/levels';
import { DIFF_COLOR, ROLE_COLORS } from '../../shared/gui/roleColors';

export interface ReportFile {
    name: string;
    /** PNG bytes as base64, or the text of a CSV / JSON file. */
    base64?: string;
    text?: string;
}

export type ReportStrings = CompareStrings & Pick<UiStrings,
    | 'entryColFile' | 'entryColCondition' | 'stepRegion' | 'entryColLeq' | 'entryColPeak' | 'entryCsvGroupSize' | 'entryBase' | 'entryBaseGroup'
    | 'reportBase' | 'reportCompare' | 'reportDiff' | 'reportCsv' | 'reportBaseLeq' | 'reportLevelReference' | 'reportBaseLevelReference' | 'reportBandDelta' | 'reportGroupFiles' | 'reportSpecVersion' | 'entryLeqUncalibrated' | 'reportSummary' | 'reportStepsLegend' | 'axisFrequency' | 'axisBand' | 'axisLevelUncal' | 'axisLevelCal' | 'axisUnitUnknown' | 'axisDelta' | 'legendHeadline' | 'legendLeak' | 'legendLine' | 'hintLeqUncalibrated' | 'hintLeqUncalibratedRaw' | 'reportRegion' | 'reportRegionStart' | 'reportRegionEnd' | 'reportWhole' | 'reportDefinitions' | 'compareDelta' | 'defLeq' | 'defSpectrum' | 'defThirdOct' | 'defChannels' | 'defBase' | 'defDelta' | 'defRegion' | 'defHeadline' | 'defHeadlineEdges' | 'outside192' | 'outsideMedian' | 'outsideDelta' | 'outsideOutliers' | 'stepOctave' | 'reportChain' | 'reportChainCurrent' | 'reportChainPrevious' | 'reportMemo' | 'reportShownValue' | 'dsCh' | 'reportBaseDefinition' | 'reportDerived'>;

export interface ReportInput {
    model: EntryModel;
    results: ReadonlyMap<string, ScanResult>;
    slots: readonly (string | null)[];
    region: EntryRegion | null;
    recipe: RecipeDocument | null;
    recipeName: string;
    now: Date;
    /** Whether a compared file's base kept the entry region (see CompareModel.blocked). */
    entryRegionBase?(path: string): boolean;
    /** Files whose values are of the previous chain (the comparison's measuring of them was cancelled). */
    stale: ReadonlySet<string>;
    /** The comparison shows the difference pane: the report has its Δ figures too. */
    showDiff?: boolean;
    /**
     * A compared file's comparison as the entry table defines its base (entryBase.comparison: its grouping, filters,
     * slots and channel). Required: the report never builds a base of its own.
     */
    compare(path: string): CompareModel;
    /** A compared file as the table has it: its name with its channel, its value on show, its memo, and its base. */
    rowInfo?: (path: string) => { label: string; value: string; memo: string; channel: number | null; base: BaseDefinition };
    /** What the table was narrowed to. */
    selection?: { value: string; group: string; filters: string[]; excluded: number };
    /** The differences fixed with D, written after the comparisons. */
    derived?: readonly DerivedRow[];
    /** Cross-channel steps measured against the base slot's recording: written with a `base` input. */
    slotReference?: readonly string[];
}

/** A base as one line: the slot-0 recording, or the group, its count, channel and the filters it was taken within. */
export function baseDefinitionText(definition: BaseDefinition, strings: Pick<UiStrings, 'entryBase' | 'entryBaseGroup'>): string {
    const what = definition.kind === 'file' ? `${strings.entryBase} ${definition.file ?? ''}` : `${strings.entryBaseGroup} ${[definition.group?.column, definition.group?.name].filter(Boolean).join(' ')}`.trim();
    return [
        what, `n=${definition.count}`, ...(definition.channel ? [`ch${definition.channel}`] : []),
        // Every recording the set left out, each reason apart, as the heading says them (a base fixed before the
        // channel's members were in the set says them by its own count).
        ...(leftText(leftOf(definition), definition.channel) ? [leftText(leftOf(definition), definition.channel)] : []),
        ...definition.filters,
    ].join(' · ');
}

const comparisonOf = (input: ReportInput, path: string): CompareModel => input.compare(path);

const dB = (value: number | null | undefined): string => csvNumber(value, 1);

function cell(value: string): string {
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function reportFolderName(recipeName: string, now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${recipeName}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}


/**
 * The scan Recipe with the region it measured as its time slice and every default written out, so it
 * replays exactly what the report shows. With the file's duration, the slice is the measured region:
 * the region less the 0.15 s the scan skips at the file's ends.
 */
export function reportRecipe(recipe: RecipeDocument, region: EntryRegion | null, durationS?: number): RecipeDocument {
    const full = withDefaults(recipe);
    const slice = recipeSteps(full).find(step => step.operation === TIME_SLICE);
    if (!slice) return full;
    let start = region?.start ?? 0;
    let end: number | null = region?.end ?? null;
    if (durationS !== undefined) {
        start = Math.max(start, EDGE_GUARD_S);
        end = Math.round(Math.min(end ?? durationS, durationS - EDGE_GUARD_S) * 1e6) / 1e6;
    }
    const withStart = withParam(full, slice.id, { name: 'start', kind: 'float' }, start);
    return end === null ? withStart : withParam(withStart, slice.id, { name: 'end', kind: 'float' }, end);
}

/** A scan's level reference as an entry row has it. */
function levelRowOf(result: ScanResult): { levelReference?: string; uncalibrated?: 'full-scale' } {
    const level = result.ok ? result.input : undefined;
    return level ? { levelReference: level.levelReferenceLabel, ...(level.calibrationStatus !== 'calibrated' ? { uncalibrated: 'full-scale' as const } : {}) } : {};
}

/** What a side's levels are in, as the CSV writes it beside them ("dBFS 未校正", "dB SPL re 20 µPa"): its own, never the table's. */
function sideReferenceCell(side: CompareModel['base'], input: ReportInput, cols: FigureColumns): string {
    const level = sideInput(side, input);
    return level ? levelReferenceCell({ levelReference: level.levelReferenceLabel, ...(level.calibrationStatus !== 'calibrated' ? { uncalibrated: 'full-scale' as const } : {}) }, cols) : '';
}

/** The band with the largest |Δ| against this comparison's base: its centre and Δ; none while the Δ is withheld. */
function maxBand(comparison: CompareModel): { hz: number; db: number } | null {
    let best = -1;
    comparison.bandDeltas.forEach((delta, band) => { if (delta !== null && (best < 0 || Math.abs(delta) > Math.abs(comparison.bandDeltas[best] ?? 0))) best = band; });
    const db = best < 0 ? null : comparison.bandDeltas[best];
    return db === null || db === undefined || comparison.blocked ? null : { hz: BAND_CENTERS_HZ[best], db };
}

/** The band with the largest |Δ| against this comparison's base, as "31.5", "14.1" (the centre as its column names it). */
function maxBandCells(comparison: CompareModel): [string, string] {
    const best = maxBand(comparison);
    return best ? [bandCentreCell(best.hz), csvNumber(best.db, 1)] : ['', ''];
}

/**
 * A file row of the entry CSV as this comparison measures it (entryBase.fileComparison): the same Δ Leq, band Δ,
 * largest-Δ band and base count the comparison, its held picture and 報告.csv show.
 */
/**
 * The base's recordings the figure's numbers are of: the comparison's one base set (CompareModel.baseSet); n is how
 * many. A comparison with its Δ withheld (the file is its own base, another reference, another region) measures from
 * no base: n 0, no files.
 */
export function baseUsed(comparison: Pick<CompareModel, 'baseSet' | 'blocked'>): { n: number; paths: readonly string[] } {
    if (comparison.blocked || !comparison.baseSet) return { n: 0, paths: [] };
    return { n: comparison.baseSet.n, paths: comparison.baseSet.paths };
}

/**
 * Which of a report's files have numbers of an earlier chain or calibration: the table's stale ones, but for those
 * measured afresh for the report (a region's scans, made under the current chain), whose numbers replace them.
 */
export function reportStale(stale: ReadonlySet<string>, measuredNow: ReadonlyMap<string, unknown>): Set<string> {
    return new Set([...stale].filter(path => !measuredNow.has(path)));
}

/**
 * A fixed Δ (D) measured again from the answer store's answers: only when its compared recording is ready and every
 * base recording it was fixed with is counted by the figure model now (figureUsed: ready, of the current chain and
 * calibration, of the compared one's reference and axis); else null and the row stays ≠. Its base's median, files
 * and level reference (the report's 基準 レベル基準 cell) are all taken anew of that one set.
 */
export function remeasured(row: DerivedRow, whole: ScanAnswer, wholeBase: readonly ScanAnswer[], recipeKey: string): DerivedRow | null {
    // A channel's row is measured again as that channel, its base's recordings as the same channel (as it was fixed).
    const compared = channelAnswer(whole, row.ch), base = wholeBase.map(answer => channelAnswer(answer, row.ch));
    if (compared.state !== 'ready' || !base.length) return null;
    const set = figureUsed(scanIdentity(compared), base);
    const middle = set.n === base.length ? setMedian(set) : null;
    if (!middle) return null;
    return { ...row, result: compared.value, base: { ...row.base, leq: middle.leq, bands: middle.bands, paths: [...set.paths], level: baseLevelOf(set) }, recipeKey, stale: false };
}

/**
 * A file row of the entry CSV as this comparison measures it (entryBase.fileComparison): the same Δ Leq, band Δ,
 * largest-Δ band, base count and what the base left out with why that the comparison, its held picture and 報告.csv show.
 */
export function entryMeasure(comparison: CompareModel, band: number, strings: Omit<SetStrings, 'entryBaseMedian'>): EntryMeasure | null {
    if (!comparison.compare) return null;
    const left = comparison.baseSet ? setExclusionText(comparison.baseSet, strings).replace(/^ · /u, '') : '';
    // A base whose set counts none: no Δ, its n 0 and every recording it left out with why.
    if (!comparison.base) return comparison.baseSet ? { leq: null, band: null, peak: null, count: 0, left } : null;
    const withheld = !!comparison.blocked;
    return {
        leq: withheld ? null : comparison.leq?.delta ?? null,
        band: withheld ? null : comparison.bandDeltas[band] ?? null,
        peak: maxBand(comparison),
        count: baseUsed(comparison).n,
        left,
    };
}

/**
 * 報告.csv: one row per slot 1–3 (requirements §4). Values are numbers and marks only, dB to one
 * decimal, missing values empty, UTF-8 with a BOM. Each 1/3-octave band has its own Δ column, headed
 * with its centre ("Δ 3.15 kHz dB"), so the columns mean the same in every row.
 */
export function reportCsv(input: ReportInput, strings: ReportStrings): string {
    const columns = input.model.columns;
    const comparisons = [1, 2, 3].flatMap(slot => {
        const path = input.slots[slot];
        return path ? [{ path, comparison: comparisonOf(input, path) }] : [];
    });
    const bandDelta = (comparison: CompareModel, band: number): number | null => {
        const level = comparison.compare?.bands[band], reference = comparison.base?.bands[band];
        return comparison.blocked || level === null || level === undefined || reference === null || reference === undefined ? null : level - reference;
    };
    const bands = BAND_CENTERS_HZ.map((_, band) => band).filter(band => comparisons.some(({ comparison }) => bandDelta(comparison, band) !== null));
    // Every level column goes out beside its per-row reference column (C5): the file's own and the base group's.
    const own = levelColumns(strings), base = baseLevelColumns(strings);
    const header = [
        strings.entryColFile, `${strings.entryColPeak} Hz`, `${strings.entryColPeak} dB`,
        ...columns.map((column, index) => column.name || strings.entryColCondition.replace('{n}', String(index + 1))),
        strings.reportRegionStart, strings.reportRegionEnd, own.level, own.reference, base.level, base.reference, `Δ ${own.level}`,
        ...bands.map(band => strings.reportBandDelta.replace('{band}', bandLabel(band))),
        strings.entryCsvGroupSize, strings.reportGroupFiles, strings.reportSpecVersion, strings.reportChain,
        strings.dsCh, ...(input.selection ? [strings.reportShownValue.replace('{value}', () => input.selection?.value ?? '')] : []), strings.reportMemo, strings.reportBaseDefinition,
    ];
    const lines = [header.map(cell).join(',')];
    for (const { path, comparison } of comparisons) {
        const row = input.model.rows.find(item => item.filePath === path);
        const result = input.results.get(path);
        lines.push([
            // What a reader looks for first: where the file differs most from its base, and by how much.
            input.rowInfo?.(path).label ?? baseName(path), ...maxBandCells(comparison), ...(row?.cells ?? columns.map(() => '')), ...regionCells(measuredRegion(input.region, fileDuration(input, path))),
            dB(comparison.leq?.compare ?? comparison.compare?.leq), sideReferenceCell(comparison.compare, input, own),
            dB(comparison.leq?.base), comparison.leq ? sideReferenceCell(comparison.base, input, base) : '', dB(comparison.leq?.delta),
            ...bands.map(band => dB(bandDelta(comparison, band))),
            // The 基準群 n and files: the base set the Δ is of (none while the Δ is withheld).
            comparison.base && !comparison.blocked ? String(baseUsed(comparison).n) : '', baseUsed(comparison).paths.map(baseName).join(';'),
            result?.ok ? String(result.specVersion) : '',
            // Which chain the row's numbers are of: the Recipe written beside it, or the one before.
            [path, ...(comparison.base?.filePaths ?? [])].some(file => input.stale?.has(file)) ? strings.reportChainPrevious : strings.reportChainCurrent,
            ...infoCells(input, path, strings),
        ].map(cell).join(','));
    }
    // The differences fixed with D: each against the base it was fixed with, as that base was defined then.
    for (const item of input.derived ?? []) {
        if (!item.result.ok) continue;
        // A ≠ row (fixed under an earlier chain) has no number to read, as the table says: its numbers are not written either.
        const numbers = !item.stale;
        const leq = numbers ? powerMeanDb(item.result.leqDbA ?? []) : null;
        const bandLevel = (band: number): number | null => (numbers ? powerMeanOrNull((item.result.thirdOctDb ?? []).map(channel => channel[band])) : null);
        const definition = item.base.definition;
        lines.push([
            `${strings.reportDerived} · ${baseName(item.parentPath)}${item.ch ? ` ch${item.ch}` : ''} · ${item.region}`, '', '', ...columns.map(() => ''),
            ...regionCells(measuredRegion(item.region === 'all' ? null : parseRegion(item.region), item.result.input?.durationS)),
            // Fixed only when both are of one level reference (no Δ across references): the base is in the row's.
            // The base's own reference and calibration, as fixed with it (never the compared row's).
            dB(leq), levelReferenceCell(levelRowOf(item.result), own), dB(numbers ? item.base.leq : null), levelReferenceCell(item.base.level, base), dB(leq === null ? null : leq - item.base.leq),
            ...bands.map(band => { const level = bandLevel(band), reference = item.base.bands[band]; return dB(level === null || reference === null || reference === undefined ? null : level - reference); }),
            // n as the base's set counted it when fixed (its definition), not a count of its files.
            definition ? String(definition.count) : '', (item.base.paths ?? []).map(baseName).join(';'), String(item.result.specVersion ?? ''),
            item.stale ? strings.reportChainPrevious : strings.reportChainCurrent,
            item.ch ? String(item.ch) : '', ...(input.selection ? [''] : []), '', definition ? baseDefinitionText(definition, strings) : item.base.label ?? '',
        ].map(cell).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
}

/** "0.50–1.50" back to its seconds. */
function parseRegion(text: string): EntryRegion | null {
    const [start, end] = text.split('–').map(Number);
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

/** The compared row's channel, its value on show, its memo and its base, as the CSV's last columns. */
function infoCells(input: ReportInput, path: string, strings: ReportStrings): string[] {
    const info = input.rowInfo?.(path);
    return [info?.channel ? String(info.channel) : '', ...(input.selection ? [info?.value ?? ''] : []), info?.memo ?? '', info ? baseDefinitionText(info.base, strings) : ''];
}

const PNG_SIZE = { width: 1200, height: 400 };

/**
 * What the app computes outside the Recipe, from its frames: one list for 定義.json (the full text) and
 * for the step bar (the short tag), so the two never say different things.
 */
export function outsideRecipe(strings: Pick<UiStrings, 'entryColLeq' | 'outside192' | 'stepOctave' | 'outsideMedian' | 'outsideDelta' | 'outsideOutliers'>, welch?: Record<string, unknown>): Array<{ tag: string; text: string }> {
    return [
        { tag: strings.entryColLeq, text: 'Leq A-weighted, in dB re each channel\'s own level reference = 20·log10(rms / ref) of the time slice\'s frame.a_weighting(): an RMS is an array, not a frame, so it is not a Recipe step' },
        // eslint-disable-next-line @typescript-eslint/no-base-to-string, @typescript-eslint/restrict-template-expressions -- Recipe params are JSON scalars
        { tag: strings.outside192, text: `spectrum: the SpectralFrame's dB (n_fft ${welch?.['n_fft'] ?? 1024}, ${welch?.['window'] ?? 'hann'}), bins power-averaged into 192 log-spaced points from 20 Hz to Nyquist (narrower than a bin: interpolated), as the table shows it; the report's figures, base median and Δ: every bin, decimated only to be drawn (each of 640 log-spaced buckets' lowest and highest bin); channels: power mean (10·log10 of the mean of 10^(L/10))` },
        { tag: strings.stepOctave, text: '1/3 octave bands (the table\'s band values, Δ max band): noct_spectrum (fmin 20, fmax = the highest nominal centre ≤ 0.88 × Nyquist, n = 3) of the chain\'s time signal over the time slice, beside the chain rather than a step of it; the NOctFrame\'s dB, bands centred outside the Recipe\'s filter passband left empty; channels: power mean' },
        { tag: strings.outsideMedian, text: 'base: the slot-0 file, or the median per bin and band of the compared file\'s condition without it' },
        { tag: strings.outsideDelta, text: 'Δ = compare − base at full precision, rounded to 0.1 dB only as written; Δ max band = the band with the largest |Δ|; headline: see "headline"' },
    ];
}

/** The compared files' sample rate, which sets the highest 1/3-octave band. */
function reportSampleRate(input: ReportInput): number | undefined {
    for (const path of input.slots.slice(1)) {
        const result = path ? input.results.get(path) : undefined;
        if (result?.ok) return result.input?.fs;
    }
    return undefined;
}

/**
 * The Recipe's 1/3-octave branch as a Recipe of its own (wandas 0.9.0 plans have one output): the chain's
 * steps to its time signal (the time slice and the time-signal steps after it, as the scan reads them),
 * then noct_spectrum over the bands the scan used (20 Hz to the highest nominal centre at most 0.88 ×
 * Nyquist), so RecipePlan.from_dict → apply gives the NOctFrame behind the 1/3-octave numbers.
 */
export function reportOctaveRecipe(recipe: RecipeDocument, region: EntryRegion | null, durationS: number | undefined, sampleRate: number): RecipeDocument {
    const timed = reportRecipe(recipe, region, durationS);
    const signal = timeSignalStep(timed);
    const base = (signal ? upToStep(timed, signal.id) : timed) as RecipeDocument & { nodes: Array<Record<string, unknown>>; output: string };
    const fmax = [...BAND_CENTERS_HZ].filter(center => center <= 0.88 * sampleRate / 2).at(-1) ?? BAND_CENTERS_HZ[0];
    return {
        ...base,
        nodes: [...base.nodes, {
            id: 'node-noct', operation: 'wandas.audio.noct_spectrum', version: 1, inputs: [base.output],
            params: { $type: 'map', entries: [['fmax', encodeNumber(fmax, 'float', plainFloats(base))], ['fmin', encodeNumber(BAND_CENTERS_HZ[0], 'float', plainFloats(base))], ['n', 3]] },
        }],
        output: 'node-noct',
    };
}

/**
 * One file's length, which its own measured region is cut from (the scan guards each file's ends within its own
 * length, scan_service): never another file's.
 */
function fileDuration(input: ReportInput, path: string | null | undefined): number | undefined {
    const result = path ? input.results.get(path) : undefined;
    return result?.ok ? result.input?.durationS : undefined;
}

/** The region each compared slot was measured over, in slot order. */
function slotRegions(input: ReportInput): Array<{ slot: number; path: string; measured: { start: number; end: number } | null }> {
    return [1, 2, 3].flatMap(slot => {
        const path = input.slots[slot];
        return path ? [{ slot, path, measured: measuredRegion(input.region, fileDuration(input, path)) }] : [];
    });
}

const regionSeconds = (region: { start: number; end: number }): string => secondsSpanText(region.start, region.end);

/** What the scan computes, in words and decimals, beside the Recipe (whose own floats are hex). */
export function reportDefinitions(input: ReportInput, specVersion: number | undefined, strings: Pick<UiStrings, 'defLeq' | 'defSpectrum' | 'defThirdOct' | 'defChannels' | 'defBase' | 'defDelta' | 'defRegion' | 'defHeadline' | 'defHeadlineEdges' | 'entryColLeq' | 'outside192' | 'outsideMedian' | 'outsideDelta' | 'outsideOutliers' | 'stepOctave'>): Record<string, unknown> {
    const welch = input.recipe ? recipeSteps(input.recipe).find(step => step.name === 'welch') : undefined;
    return {
        specVersion: specVersion ?? null,
        region: input.region ? { startS: input.region.start, endS: input.region.end } : null,
        metrics: {
            'Leq A-weighted': strings.defLeq,
            spectrum: strings.defSpectrum.replace('{n_fft}', String(welch?.params['n_fft'] ?? 1024)).replace('{window}', String(welch?.params['window'] ?? 'hann')),
            '1/3 octave': strings.defThirdOct,
            region: strings.defRegion,
            channels: strings.defChannels,
            base: strings.defBase,
            'Δ': strings.defDelta,
        },
        // The scan's own calls after the Recipe, with their arguments, so the numbers replay in wandas.
        // What wandas runs (the two Recipe files replay it) and what the app computes from its frames.
        recipes: {
            [`${input.recipeName}.recipe.json`]: `the Recipe's steps to its time slice (the region measured: ${EDGE_GUARD_S} s guarded at the file's ends), then welch → SpectralFrame`,
            [`${input.recipeName}.1-3oct.recipe.json`]: 'the same steps to the time slice, then noct_spectrum (fmin 20, fmax = the highest nominal centre ≤ 0.88 × Nyquist, n = 3) → NOctFrame',
        },
        outsideRecipe: outsideRecipe(strings, welch?.params).map(item => item.text),
        headline: strings.defHeadline.replace('{within}', String(HEADLINE_WITHIN_DB)),
        headlineWithinDb: HEADLINE_WITHIN_DB,
        headlineEdges: strings.defHeadlineEdges,
        // The steps as asked; each comparison below says the region it was measured over (its own guarded ends).
        steps: input.recipe ? recipeSteps(reportRecipe(input.recipe, input.region)).map(step => ({ operation: step.operation, params: step.params })) : [],
        // What the comparison was taken from: the value and grouping on show, the filters, and each base.
        ...(input.selection ? { selection: input.selection } : {}),
        comparisons: [1, 2, 3].flatMap(slot => {
            const path = input.slots[slot];
            if (!path || !input.rowInfo) return [];
            const info = input.rowInfo(path);
            const measured = measuredRegion(input.region, fileDuration(input, path));
            return [{ slot, file: info.label, channel: info.channel, base: info.base, measured: measured ? { startS: measured.start, endS: measured.end } : null }];
        }),
    };
}

function pngOf(document: Document, paint: (canvas: HTMLCanvasElement) => void): string {
    const canvas = document.createElement('canvas');
    paint(canvas);
    // A report is read on paper or a slide: a white page under the plot.
    const context = canvas.getContext('2d');
    if (context) {
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
    return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

/** A report figure's horizontal axis as the comparison names the same picture (stagePanes.stageAxes): band centres for 1/3-octave bands. */
function figureXAxis(views: ReadonlyArray<StageView | null>, strings: Pick<UiStrings, 'axisFrequency' | 'axisBand'>): PlainTitle {
    return plainTitle(strings, views.find(Boolean)?.x === 'band' ? 'axisBand' : 'axisFrequency');
}

function sideInput(side: CompareModel['base'], input: ReportInput): LevelInput | undefined {
    const inputs = (side?.filePaths ?? []).map(path => input.results.get(path)).flatMap(result => (result?.ok && result.input ? [result.input] : []));
    // One definition of a median line's calibration (figureModel.medianInputOf), as the screen's.
    return medianInputOf(inputs);
}

/**
 * The level axes of a report figure (R1, R4: as the comparison's overlay, trackStagePainter.byReference): base and
 * compared on one axis when their levels are of one level identity (figureModel.levelKeyOf), else the base's on the left
 * and the compared one's on the right, never one read on the other's numbers. An axis is "uncalibrated" only when
 * every line on it is; each uncalibrated line says so itself in the legend.
 */
export function reportLevelAxes(comparison: Pick<CompareModel, 'base' | 'compare'>, input: Pick<ReportInput, 'results'>, strings: ReportStrings, views: { base?: StageView | null; compare?: StageView | null } = {}): {
    left: FigureTitle; right: FigureTitle | null; legend: { base: string; compare: string }; leftRange: FigureRange; rightRange: FigureRange | null;
} {
    const base = sideInput(comparison.base, input as ReportInput), compare = sideInput(comparison.compare, input as ReportInput);
    const sides = [{ side: 'base' as const, input: base, view: views.base ?? null }, { side: 'compare' as const, input: compare, view: views.compare ?? null }].filter(item => !!item.input || !!item.view);
    // As every figure's level axes (figureModel.levelAxes): one per level identity, the base's on the left.
    const { axes } = levelAxes(sides, {
        inputOf: item => item.input, first: sides[0],
        names: axisInput => paneNames(strings, axisInput ?? compare).level,
        range: members => dataRange(members.map(item => item.view)),
    });
    const [left, right] = axes;
    const leftTitle = titleOf(left?.names ?? paneNames(strings, compare).level);
    const rightTitle = right ? titleOf(right.names) : null;
    const word = (item: LevelInput | undefined): string => (item && item.calibrationStatus !== 'calibrated' ? ` · ${strings.entryLeqUncalibrated}` : '');
    return {
        left: leftTitle, right: rightTitle, leftRange: left?.range ?? dataRange([]), rightRange: right?.range ?? null,
        legend: {
            base: `${word(base)}${right ? ` · ${leftTitle}` : ''}`,
            compare: `${word(compare)}${rightTitle ? ` · ${rightTitle}` : ''}`,
        },
    };
}

/** One slot's base and compare as the comparison's overlay: solid lines, no fills, each on its own level reference's axis. */
export function paintOverlayFigure(canvas: HTMLCanvasElement, comparison: CompareModel, slot: number, title: string, strings: ReportStrings, input: ReportInput, size: { width: number; height: number }): void {
    // Every bin, decimated only to be drawn, as the comparison draws a spectrum. Where a scan gave no bins, the
    // 1/3-octave levels (each the scan's own, from every bin; a group's median band by band): never the 192 points.
    const { bins } = comparison;
    const base = bins?.base ? binsView(bins, 'base') : sideView(comparison.base, comparison.frequencies, true);
    const compare = bins?.compare ? binsView(bins, 'compare') : sideView(comparison.compare, comparison.frequencies, true);
    const color = ROLE_COLORS[slot] ?? ROLE_COLORS[1];
    const level = reportLevelAxes(comparison, input, strings, { base, compare });
    // Ordered by every bin (or every band, which the figure draws whole), never the points thinned to draw (R6).
    const fullOf = (which: 'base' | 'compare'): InlineFullSource => (bins?.[which] ? binsSource(bins, which) : null) ?? bandsSource(comparison[which]?.bands ?? [], comparison.frequencies);
    const baseLayers = base ? [{ view: base, color: ROLE_COLORS[0], width: 2, full: fullOf('base') }] : [];
    const compareLayers = compare ? [{ view: compare, color, width: 2, full: fullOf('compare'), ...(level.right ? { dash: SECONDARY_AXIS_DASH } : {}) }] : [];
    // Levels of another reference are drawn on the right-hand axis, by their own range (never the left one's numbers).
    const secondary = level.right && level.rightRange && compareLayers.length ? { layers: compareLayers, range: level.rightRange, title: level.right } : undefined;
    paintOverlay(canvas, { layers: secondary ? baseLayers : [...baseLayers, ...compareLayers] }, level.leftRange, withTitle(plainNames(figureXAxis([base, compare], strings), ''), level.left), {
        // A figure on paper: no pointer reads it, so it reads no number (R7).
        size, readout: false,
        ...(secondary ? { secondary } : {}),
        labels: {
            title,
            legend: [
                { color: ROLE_COLORS[0], text: `${strings.reportBase}: ${comparison.base?.title ?? '—'}${level.legend.base}` },
                { color, text: `${strings.reportCompare} ${slot}: ${comparison.compare?.title ?? '—'}${level.legend.compare}` },
            ],
        },
    });
}

/**
 * What a Δ figure draws (R1): compare − base bin by bin, decimated only to be drawn, or, without the bins, the
 * 1/3-octave Δ (the held plot's own picture). The range covers the band steps too, so a step is never cut off.
 */
export function deltaFigure(comparison: Pick<CompareModel, 'bins' | 'bandDeltas' | 'frequencies'>): { view: StageView | null; range: FigureRange; binned: boolean } {
    const view = deltaViews(comparison).picture;
    // Every bin's Δ (binsView's valueRange) and every band's: a step is never cut off.
    const bands = comparison.bandDeltas.filter((value): value is number => value !== null && Number.isFinite(value));
    const whole = view?.valueRange;
    const valueRange = whole || bands.length ? { min: Math.min(whole?.min ?? Infinity, ...bands), max: Math.max(whole?.max ?? -Infinity, ...bands) } : undefined;
    const range = diffRange(view && { ...view, values: [...(view.values ?? []), ...comparison.bandDeltas], ...(valueRange ? { valueRange } : {}) });
    return { view, range, binned: !!comparison.bins?.diff };
}

/** A Δ figure: compare − base per point, the 1/3-octave Δ as steps under it, titled and with its legend. */
function paintDeltaFigure(canvas: HTMLCanvasElement, comparison: CompareModel, title: string, curve: string, strings: ReportStrings, input: ReportInput, size: { width: number; height: number }): void {
    const { view, range, binned } = deltaFigure(comparison);
    // The Δ axis names the compared recording's levels as its fresh answer read them (never a raw, maybe stale, scan).
    const axes = paneNames(strings, comparison.compareResult?.input).delta;
    const full = (comparison.bins ? binsSource(comparison.bins, 'diff') : null) ?? bandsSource(comparison.bandDeltas, comparison.frequencies);
    paintOverlay(canvas, { layers: view ? [{ view, color: DIFF_COLOR, width: 1.5, full }] : [] }, range, withTitle(plainNames(figureXAxis([view], strings), ''), titleOf(axes)), {
        size, diff: true, readout: false,
        labels: { title, legend: [...(binned ? [{ color: DIFF_COLOR, text: curve }] : []), { color: DIFF_COLOR, text: strings.reportStepsLegend }] },
        bandSteps: { deltas: comparison.bandDeltas, headline: comparison.topBands.map(item => item.band), color: DIFF_COLOR, legend: axes.legend },
    });
}

/**
 * 要約.png: the whole report on one page for whoever reads only the conclusion. For each slot, the base
 * and the compared file on one set of axes headed by the headline (both levels), then, when the comparison
 * shows it, their Δ with its band steps; the page head gives the outlier count, the measured region and
 * whether the levels are uncalibrated.
 */
export function summaryPng(document: Document, input: ReportInput, comparisons: ReadonlyArray<{ slot: number; comparison: CompareModel }>, strings: ReportStrings): string {
    const width = 1200, pane = 300, head = 56;
    const perSlot = input.showDiff ? 2 : 1;
    const page = document.createElement('canvas');
    page.width = width;
    page.height = head + comparisons.length * pane * perSlot;
    const context = page.getContext('2d');
    if (!context) return '';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, page.width, page.height);
    context.fillStyle = '#222';
    context.font = 'bold 18px sans-serif';
    // The page head's calibration note is of the recordings on this page (each compared one and its base), not the table's.
    const shown = new Set(comparisons.flatMap(({ comparison }) => [...(comparison.compare?.filePaths ?? []), ...(comparison.base?.filePaths ?? [])]));
    // From each recording's own scan (a row the table marks ≠ keeps its calibration status there too).
    const uncalibrated = new Set([...shown].map(path => input.results.get(path)).flatMap(result => (result?.ok && result.input && result.input.calibrationStatus !== 'calibrated' ? [result.input.fullScale ? 'full-scale' : 'raw-units'] : [])));
    const hints = [...(uncalibrated.has('full-scale') ? [strings.hintLeqUncalibrated] : []), ...(uncalibrated.has('raw-units') ? [strings.hintLeqUncalibratedRaw] : [])];
    context.fillText([input.recipeName, ...(input.selection?.filters ?? []), ...hints].join(' · '), 16, 24);
    context.font = '13px sans-serif';
    context.fillText(`${strings.stepRegion} ${summaryRegionText(input, strings)}`, 16, 46);
    comparisons.forEach(({ slot, comparison }, index) => {
        const top = head + index * pane * perSlot;
        const levels = document.createElement('canvas');
        paintOverlayFigure(levels, comparison, slot, `${slot} · ${levelsHeadline(comparison, strings)}`, strings, input, { width, height: pane });
        context.drawImage(levels, 0, top);
        if (!input.showDiff) return;
        const delta = document.createElement('canvas');
        paintDeltaFigure(delta, comparison, `${slot} · ${diffHeadline(comparison, strings)}`, strings.compareDelta, strings, input, { width, height: pane });
        context.drawImage(delta, 0, top + pane);
    });
    return page.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

/** The region the summary heads: the one every compared file was measured over, or each slot's where they differ. */
export function summaryRegionText(input: ReportInput, strings: Pick<UiStrings, 'reportWhole'>): string {
    const slots = slotRegions(input);
    const texts = slots.map(({ measured }) => measured ? regionSeconds(measured) : strings.reportWhole);
    if (new Set(texts).size <= 1) return texts[0] ?? (input.region ? regionSeconds(input.region) : strings.reportWhole);
    return slots.map(({ slot }, index) => `${slot}: ${texts[index]}`).join(' · ');
}

/** Every file of the report folder, in the order they are listed. */
export function reportFiles(document: Document, input: ReportInput, strings: ReportStrings): { folder: string; files: ReportFile[] } {
    const files: ReportFile[] = [];
    const comparisons: Array<{ slot: number; path: string; comparison: CompareModel }> = [1, 2, 3].flatMap(slot => {
        const path = input.slots[slot];
        return path ? [{ slot, path, comparison: comparisonOf(input, path) }] : [];
    });
    // The figures' region as every region is written (R7): to a tenth of its length, never fixed at 10 ms.
    const region = input.region ? secondsSpanText(input.region.start, input.region.end) : strings.reportWhole;
    // Each figure says on its own what it is: role, file, region, and the base it is against.
    for (const { slot, comparison } of comparisons) {
        const baseName = comparison.base?.title ?? '—';
        // The comparison's overlay: base and compare on one set of axes, headed by both levels where they differ most.
        files.push({ name: `${strings.reportCompare} ${slot}.png`, base64: pngOf(document, canvas => paintOverlayFigure(canvas, comparison, slot, `${strings.reportCompare} ${slot} · ${region} · ${levelsHeadline(comparison, strings)}`, strings, input, PNG_SIZE)) });
        if (!input.showDiff) continue;
        // The Δ figure also says what its steps are: filled = a headline band, outlined = its leak.
        files.push({
            name: `${strings.reportDiff} ${slot}.png`,
            base64: pngOf(document, canvas => paintDeltaFigure(canvas, comparison, `${strings.reportDiff} ${slot} · ${diffHeadline(comparison, strings)} · ${region}`, `${strings.compareDelta} · ${baseName}`, strings, input, PNG_SIZE)),
        });
    }
    if (comparisons.length) files.unshift({ name: `${strings.reportSummary}.png`, base64: summaryPng(document, input, comparisons, strings) });
    files.push({ name: `${strings.reportCsv}.csv`, text: reportCsv(input, strings) });
    if (input.recipe) {
        // A compared channel row is that channel in wandas too: a get_channel step at the Recipe's head; slots
        // of different channels get one Recipe each (".ch2"), the channels together none.
        const channels = [...new Set(comparisons.map(({ path }) => input.rowInfo?.(path).channel ?? null))];
        // A chain that compares two channels names its own (withChannel leaves it as it is): one Recipe. One that
        // measures against the base slot takes a channel of each recording, the slots' rows'.
        const slotted = input.slotReference ?? [];
        const ownPair = !slotted.length && withChannel(input.recipe, 1) === input.recipe;
        const byChannel = ownPair ? [{ suffix: '', ch: null }] : channels.length > 1 ? channels.map(ch => ({ suffix: ch ? `.ch${ch}` : '', ch })) : [{ suffix: '', ch: channels[0] ?? null }];
        // Each compared file is sliced within its own length, as the scan measured it: files whose measured regions
        // differ get one Recipe each (".slot2"), so every Recipe replays its rows' numbers.
        const regions = slotRegions(input);
        const lengths = [...new Set(regions.map(({ path }) => fileDuration(input, path)))];
        const regionsDiffer = new Set(regions.map(({ measured }) => JSON.stringify(measured))).size > 1;
        const variants = byChannel.flatMap(variant => {
            const own = regions.filter(({ path }) => ownPair || channels.length <= 1 || (input.rowInfo?.(path).channel ?? null) === variant.ch);
            if (!regionsDiffer) return [{ ...variant, durationS: lengths.length === 1 ? lengths[0] : fileDuration(input, own[0]?.path) }];
            const groups = new Map<string, { slots: number[]; durationS: number | undefined }>();
            for (const { slot, path, measured } of own) {
                const key = JSON.stringify(measured);
                const group = groups.get(key) ?? { slots: [], durationS: fileDuration(input, path) };
                group.slots.push(slot);
                groups.set(key, group);
            }
            return [...groups.values()].map(group => ({ suffix: `${variant.suffix}.slot${group.slots.join('-')}`, ch: variant.ch, durationS: group.durationS }));
        });
        const fs = reportSampleRate(input);
        for (const { suffix, ch, durationS } of variants) {
            const recipe = ch ? withChannel(input.recipe, ch, slotted.length > 0) : input.recipe;
            const baseChannel = input.slots[0] ? input.rowInfo?.(input.slots[0]).channel ?? null : null;
            // The base is sliced within its own length, as the scan does (its end guard, not the compared file's).
            const baseResult = input.slots[0] ? input.results.get(input.slots[0]) : undefined;
            const baseEnd = baseResult?.ok && baseResult.input ? baseResult.input.durationS - EDGE_GUARD_S : undefined;
            const measured = slotted.reduce((paired, id) => withBaseInput(paired, id, { channel: baseChannel, endS: baseEnd }), reportRecipe(recipe, input.region, durationS));
            files.push({ name: `${input.recipeName}${suffix}.recipe.json`, text: JSON.stringify(measured, null, 2) + '\n' });
            if (fs) files.push({ name: `${input.recipeName}${suffix}.1-3oct.recipe.json`, text: JSON.stringify(reportOctaveRecipe(recipe, input.region, durationS, fs), null, 2) + '\n' });
        }
    }
    const specVersion = comparisons.map(({ comparison }) => comparison.compare?.filePaths[0]).map(path => input.results.get(path ?? '')).find(result => result?.ok)?.specVersion;
    files.push({ name: `${strings.reportDefinitions}.json`, text: JSON.stringify(reportDefinitions(input, specVersion, strings), null, 2) + '\n' });
    return { folder: reportFolderName(input.recipeName, input.now), files };
}

