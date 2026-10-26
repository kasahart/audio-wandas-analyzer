/**
 * "Report": the comparison as one folder, `<recipe>_<date-time>/`, holding each slot's base and compare drawn
 * over one another as a titled PNG figure (and their Δ when the comparison shows it), 報告.csv (one row per
 * slot 1–3), the scan Recipe with the region written in, and 定義.json: what each number means and the
 * steps' parameters in decimals.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { encodeNumber, plainFloats, recipeSteps, timeSignalStep, upToStep, withDefaults, withParam, TIME_SLICE } from '../../shared/recipe/recipeSteps';
import { BAND_CENTERS_HZ, bandLabel, csvNumber, EDGE_GUARD_S, fileName, HEADLINE_WITHIN_DB, isOutlierRow, measuredRegion, regionCells, type EntryModel } from './entryTable';
import { buildCompareModel, diffHeadline, diffRange, levelsHeadline, paintPane, paneAxes, sideView, type CompareModel, type CompareStrings } from './comparePanes';
import { paintOverlay, stageRange } from './stagePanes';
import type { EntryRegion } from '../../shared/analysis/entryScan';
import type { ScanResult } from '../../shared/protocol/backendProtocol';

export interface ReportFile {
    name: string;
    /** PNG bytes as base64, or the text of a CSV / JSON file. */
    base64?: string;
    text?: string;
}

export type ReportStrings = CompareStrings & Pick<UiStrings,
    | 'entryColFile' | 'entryColCondition' | 'entryCsvRegion' | 'entryColLeq' | 'entryColPeak' | 'entryCsvGroupSize' | 'entryOutliers'
    | 'reportBase' | 'reportCompare' | 'reportDiff' | 'reportCsv' | 'reportBaseLeq' | 'reportBandDelta' | 'reportGroupFiles' | 'reportSpecVersion' | 'entryLeqUncalibrated' | 'reportSummary' | 'reportStepsLegend' | 'axisFrequency' | 'axisLevelUncal' | 'axisLevelCal' | 'axisDelta' | 'legendHeadline' | 'legendLeak' | 'legendLine' | 'hintLeqUncalibrated' | 'reportRegion' | 'reportRegionStart' | 'reportRegionEnd' | 'reportWhole' | 'reportDefinitions' | 'compareDelta' | 'defLeq' | 'defSpectrum' | 'defThirdOct' | 'defChannels' | 'defBase' | 'defDelta' | 'defRegion' | 'defHeadline' | 'defHeadlineEdges' | 'outsideLeq' | 'outside192' | 'outsideMedian' | 'outsideDelta' | 'outsideOutliers' | 'reportChain' | 'reportChainCurrent' | 'reportChainPrevious'>;

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
    stale?: ReadonlySet<string>;
    /** The comparison shows the difference pane: the report has its Δ figures too. */
    showDiff?: boolean;
}

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

/** "Leq dB(A) 未校正" when the files are relative to full scale, so a level below 0 dB is not read as sound pressure. */
export function leqLabel(model: EntryModel, strings: Pick<UiStrings, 'entryColLeq' | 'entryLeqUncalibrated'>): string {
    return model.rows.some(row => row.uncalibrated) ? `${strings.entryColLeq} ${strings.entryLeqUncalibrated}` : strings.entryColLeq;
}

/** The band with the largest |Δ| against this comparison's base, as "3150", "14.1". */
function maxBandCells(comparison: CompareModel): [string, string] {
    let best = -1;
    comparison.bandDeltas.forEach((delta, band) => { if (delta !== null && (best < 0 || Math.abs(delta) > Math.abs(comparison.bandDeltas[best]!))) best = band; });
    return best < 0 || comparison.blocked ? ['', ''] : [csvNumber(BAND_CENTERS_HZ[best], 0), csvNumber(comparison.bandDeltas[best], 1)];
}

/** The region in seconds, as the CSV and the figures write it. */
function regionText(region: EntryRegion | null, strings: Pick<UiStrings, 'reportWhole'>): string {
    return region ? `${region.start.toFixed(2)}–${region.end.toFixed(2)}` : strings.reportWhole;
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
        return path ? [{ path, comparison: buildCompareModel(input.model, input.results, path, input.slots[0] ?? null, strings, input.entryRegionBase?.(path)) }] : [];
    });
    const bandDelta = (comparison: CompareModel, band: number): number | null => {
        const level = comparison.compare?.bands[band], reference = comparison.base?.bands[band];
        return comparison.blocked || level === null || level === undefined || reference === null || reference === undefined ? null : level - reference;
    };
    const bands = BAND_CENTERS_HZ.map((_, band) => band).filter(band => comparisons.some(({ comparison }) => bandDelta(comparison, band) !== null));
    const header = [
        strings.entryColFile, `${strings.entryColPeak} Hz`, `${strings.entryColPeak} dB`,
        ...columns.map((column, index) => column.name || strings.entryColCondition.replace('{n}', String(index + 1))),
        strings.reportRegionStart, strings.reportRegionEnd, leqLabel(input.model, strings), strings.reportBaseLeq, `Δ ${strings.entryColLeq}`,
        ...bands.map(band => strings.reportBandDelta.replace('{band}', bandLabel(band))),
        strings.entryCsvGroupSize, strings.reportGroupFiles, strings.reportSpecVersion, strings.entryOutliers, strings.reportChain,
    ];
    const lines = [header.map(cell).join(',')];
    for (const { path, comparison } of comparisons) {
        const row = input.model.rows.find(item => item.filePath === path);
        const result = input.results.get(path);
        lines.push([
            // What a reader looks for first: where the file differs most from its base, and by how much.
            fileName(path), ...maxBandCells(comparison), ...(row?.cells ?? columns.map(() => '')), ...regionCells(measuredRegion(input.region, reportDuration(input))),
            dB(comparison.leq?.compare ?? comparison.compare?.leq), dB(comparison.leq?.base), dB(comparison.leq?.delta),
            ...bands.map(band => dB(bandDelta(comparison, band))),
            comparison.base ? String(comparison.base.filePaths.length) : '', (comparison.base?.filePaths ?? []).map(fileName).join(';'),
            result?.ok ? String(result.specVersion) : '', row && isOutlierRow(row) ? '1' : '',
            // Which chain the row's numbers are of: the Recipe written beside it, or the one before.
            [path, ...(comparison.base?.filePaths ?? [])].some(file => input.stale?.has(file)) ? strings.reportChainPrevious : strings.reportChainCurrent,
        ].map(cell).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
}

const PNG_SIZE = { width: 1200, height: 400 };

/**
 * What the app computes outside the Recipe, from its frames: one list for 定義.json (the full text) and
 * for the step bar (the short tag), so the two never say different things.
 */
export function outsideRecipe(strings: Pick<UiStrings, 'outsideLeq' | 'outside192' | 'outsideMedian' | 'outsideDelta' | 'outsideOutliers'>, welch?: Record<string, unknown>): Array<{ tag: string; text: string }> {
    return [
        { tag: strings.outsideLeq, text: 'Leq dB(A) = 20·log10(rms / ref) of the time slice\'s frame.a_weighting(): an RMS is an array, not a frame, so it is not a Recipe step' },
        { tag: strings.outside192, text: `spectrum: the SpectralFrame's dB (n_fft ${welch?.['n_fft'] ?? 1024}, ${welch?.['window'] ?? 'hann'}), bins power-averaged into 192 log-spaced points from 20 Hz to Nyquist (narrower than a bin: interpolated); 1/3 octave: the NOctFrame's dB, bands centred outside the Recipe's filter passband left empty; channels: power mean (10·log10 of the mean of 10^(L/10))` },
        { tag: strings.outsideMedian, text: 'base: the slot-0 file, or the median per point and band of the compared file\'s condition without it' },
        { tag: strings.outsideDelta, text: 'Δ = round(compare, 0.1 dB) − round(base, 0.1 dB); Δ max band = the band with the largest |Δ|; headline: see "headline"' },
        { tag: strings.outsideOutliers, text: 'outliers: Leq beyond 3 MAD, or the Δ max band beyond 8 MAD, from the condition\'s other files' },
    ];
}

/** The compared files' sample rate, which sets the highest 1/3-octave band. */
function reportSampleRate(input: ReportInput): number | undefined {
    for (const path of input.slots.slice(1)) {
        const result = path ? input.results.get(path) : undefined;
        if (result?.ok) return result.input!.fs;
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
    } as unknown as RecipeDocument;
}

/** The compared files' length, which the measured region is cut from. */
function reportDuration(input: ReportInput): number | undefined {
    for (const path of input.slots.slice(1)) {
        const result = path ? input.results.get(path) : undefined;
        if (result?.ok) return result.input!.durationS;
    }
    return undefined;
}

/** What the scan computes, in words and decimals, beside the Recipe (whose own floats are hex). */
export function reportDefinitions(input: ReportInput, specVersion: number | undefined, strings: Pick<UiStrings, 'defLeq' | 'defSpectrum' | 'defThirdOct' | 'defChannels' | 'defBase' | 'defDelta' | 'defRegion' | 'defHeadline' | 'defHeadlineEdges' | 'outsideLeq' | 'outside192' | 'outsideMedian' | 'outsideDelta' | 'outsideOutliers'>): Record<string, unknown> {
    const welch = input.recipe ? recipeSteps(input.recipe).find(step => step.name === 'welch') : undefined;
    return {
        specVersion: specVersion ?? null,
        region: input.region ? { startS: input.region.start, endS: input.region.end } : null,
        metrics: {
            'Leq dB(A)': strings.defLeq,
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
        steps: input.recipe ? recipeSteps(reportRecipe(input.recipe, input.region, reportDuration(input))).map(step => ({ operation: step.operation, params: step.params })) : [],
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

const BASE_COLOR = '#3b82f6';
/** The comparison's slot colours: slot 1 yellow, 2 purple, 3 magenta. */
const SLOT_COLORS: Readonly<Record<number, string>> = { 1: '#d4b20f', 2: '#a371f7', 3: '#e85aad' };

/** One slot's base and compare on one set of axes, as the comparison's overlay: solid lines, no fills. */
function paintOverlayFigure(canvas: HTMLCanvasElement, comparison: CompareModel, slot: number, title: string, strings: ReportStrings, input: ReportInput, size: { width: number; height: number }): void {
    const axes = paneAxes(strings, input.results.get(comparison.compare?.filePaths[0] ?? '')?.input).level;
    const base = sideView(comparison.base, comparison.frequencies);
    const compare = sideView(comparison.compare, comparison.frequencies);
    const color = SLOT_COLORS[slot] ?? SLOT_COLORS[1];
    paintOverlay(canvas, {
        layers: [...(base ? [{ view: base, color: BASE_COLOR, width: 2 }] : []), ...(compare ? [{ view: compare, color, width: 2 }] : [])],
    }, stageRange([base, compare]), { x: axes.x, y: axes.y }, {
        size,
        labels: {
            title,
            legend: [
                { color: BASE_COLOR, text: `${strings.reportBase}: ${comparison.base?.title ?? '—'}` },
                { color, text: `${strings.reportCompare} ${slot}: ${comparison.compare?.title ?? '—'}` },
            ],
        },
    });
}

/**
 * 要約.png: the whole report on one page for whoever reads only the conclusion. For each slot, the base
 * and the compared file on one set of axes headed by the headline (both levels), then, when the comparison
 * shows it, their Δ with its band steps; the page head gives the outlier count, the measured region and
 * whether the levels are uncalibrated.
 */
export function summaryPng(document: Document, input: ReportInput, comparisons: ReadonlyArray<{ slot: number; comparison: CompareModel }>, strings: ReportStrings): string {
    const axesFor = (comparison: CompareModel) => paneAxes(strings, input.results.get(comparison.compare?.filePaths[0] ?? '')?.input);
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
    const outliers = input.model.rows.filter(row => !row.derived && isOutlierRow(row)).length;
    const uncalibrated = input.model.rows.some(row => row.uncalibrated);
    context.fillText([input.recipeName, `${strings.entryOutliers} ${outliers}`, ...(uncalibrated ? [strings.hintLeqUncalibrated] : [])].join(' · '), 16, 24);
    context.font = '13px sans-serif';
    const measured = measuredRegion(input.region, reportDuration(input));
    context.fillText(`${strings.entryCsvRegion} ${measured ? `${measured.start.toFixed(2)}–${measured.end.toFixed(2)} s` : strings.reportWhole}`, 16, 46);
    comparisons.forEach(({ slot, comparison }, index) => {
        const top = head + index * pane * perSlot;
        const levels = document.createElement('canvas');
        paintOverlayFigure(levels, comparison, slot, `${slot} · ${levelsHeadline(comparison, strings)}`, strings, input, { width, height: pane });
        context.drawImage(levels, 0, top);
        if (!input.showDiff) return;
        const delta = document.createElement('canvas');
        paintPane(delta, comparison.diffDb, comparison.frequencies, diffRange(comparison), '#3fb950', true, { width, height: pane }, {
            title: `${slot} · ${diffHeadline(comparison, strings)}`,
            legend: [{ color: '#3fb950', text: strings.compareDelta }, { color: '#3fb950', text: strings.reportStepsLegend }],
        }, { deltas: comparison.bandDeltas, headline: comparison.topBands.map(item => item.band) }, undefined, axesFor(comparison).delta);
        context.drawImage(delta, 0, top + pane);
    });
    return page.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

/** Every file of the report folder, in the order they are listed. */
export function reportFiles(document: Document, input: ReportInput, strings: ReportStrings): { folder: string; files: ReportFile[] } {
    const axesFor = (comparison: CompareModel) => paneAxes(strings, input.results.get(comparison.compare?.filePaths[0] ?? '')?.input);
    const files: ReportFile[] = [];
    const comparisons: Array<{ slot: number; comparison: CompareModel }> = [1, 2, 3]
        .filter(slot => input.slots[slot])
        .map(slot => ({ slot, comparison: buildCompareModel(input.model, input.results, input.slots[slot]!, input.slots[0] ?? null, strings, input.entryRegionBase?.(input.slots[slot]!)) }));
    const region = `${regionText(input.region, strings)}${input.region ? ' s' : ''}`;
    // Each figure says on its own what it is: role, file, region, and the base it is against.
    for (const { slot, comparison } of comparisons) {
        const baseName = comparison.base?.title ?? '—';
        // The comparison's overlay: base and compare on one set of axes, headed by both levels where they differ most.
        files.push({ name: `${strings.reportCompare} ${slot}.png`, base64: pngOf(document, canvas => paintOverlayFigure(canvas, comparison, slot, `${strings.reportCompare} ${slot} · ${region} · ${levelsHeadline(comparison, strings)}`, strings, input, PNG_SIZE)) });
        if (!input.showDiff) continue;
        // The Δ figure also says what its steps are: filled = a headline band, outlined = its leak.
        files.push({
            name: `${strings.reportDiff} ${slot}.png`,
            base64: pngOf(document, canvas => paintPane(canvas, comparison.diffDb, comparison.frequencies, diffRange(comparison), '#3fb950', true, PNG_SIZE, {
                title: `${strings.reportDiff} ${slot} · ${diffHeadline(comparison, strings)} · ${region}`,
                legend: [{ color: '#3fb950', text: `${strings.compareDelta} · ${baseName}` }, { color: '#3fb950', text: strings.reportStepsLegend }],
            }, { deltas: comparison.bandDeltas, headline: comparison.topBands.map(item => item.band) }, undefined, axesFor(comparison).delta)),
        });
    }
    if (comparisons.length) files.unshift({ name: `${strings.reportSummary}.png`, base64: summaryPng(document, input, comparisons, strings) });
    files.push({ name: `${strings.reportCsv}.csv`, text: reportCsv(input, strings) });
    if (input.recipe) {
        files.push({ name: `${input.recipeName}.recipe.json`, text: JSON.stringify(reportRecipe(input.recipe, input.region, reportDuration(input)), null, 2) + '\n' });
        const fs = reportSampleRate(input);
        if (fs) files.push({ name: `${input.recipeName}.1-3oct.recipe.json`, text: JSON.stringify(reportOctaveRecipe(input.recipe, input.region, reportDuration(input), fs), null, 2) + '\n' });
    }
    const specVersion = comparisons.map(({ comparison }) => comparison.compare?.filePaths[0]).map(path => input.results.get(path ?? '')).find(result => result?.ok)?.specVersion;
    files.push({ name: `${strings.reportDefinitions}.json`, text: JSON.stringify(reportDefinitions(input, specVersion, strings), null, 2) + '\n' });
    return { folder: reportFolderName(input.recipeName, input.now), files };
}

