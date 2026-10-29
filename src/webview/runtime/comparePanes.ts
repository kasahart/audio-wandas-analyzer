/**
 * The comparison's model and panes: the base (a condition's median or one file), the compared
 * file and their difference, each as a region-average spectrum on one frequency axis. Pure apart
 * from `paintPane`, which only draws.
 */
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { BAND_CENTERS_HZ, bandLabel, HEADLINE_WITHIN_DB, quantile, roundedDelta, type EntryModel } from './entryTable';
import { baseName } from '../../shared/analysis/entryMetadata';
import { median } from '../../shared/dataset/distribution';
import { powerMeanDb, powerMeanOrNull } from '../../shared/utils/levels';

type ScanOk = ScanResult & { ok: true };

export interface CompareSide {
    /** Card and pane title: the file name, or "Base group · L3 · 900rpm · 7 files". */
    title: string;
    filePaths: string[];
    spectrumDb: number[];
    leq: number;
    bands: (number | null)[];
    /** A group of three or more files: its lower and upper quartiles, point by point and band by band. */
    spread?: { spectrumDb: [number[], number[]]; bands: [(number | null)[], (number | null)[]] };
}

export interface CompareModel {
    base: CompareSide | null;
    compare: CompareSide | null;
    /** compare − base, point by point. */
    diffDb: number[] | null;
    /** Frequency of each spectrum point: log-spaced from 20 Hz to Nyquist (analysis spec v4). */
    frequencies: number[];
    /** Rounded so that base + delta = compare exactly as shown. */
    leq: { base: number; compare: number; delta: number } | null;
    /** The three 1/3-octave bands that differ most, largest |Δ| first; only peaks, not a peak's neighbours. */
    topBands: Array<{ band: number; delta: number }>;
    /** Δ per 1/3-octave band (null where either side has none), drawn as steps under the Δ curve. */
    bandDeltas: (number | null)[];
    /**
     * Why there is no Δ to read: the base is the compared file itself, a group of that one file, or
     * a base averaged over the entry region while the compare is over the comparison's. D and the report
     * are off while it is set.
     */
    blocked?: 'self' | 'single' | 'region';
    /** A file of the compare or its base has no result yet (a scan is running): nothing here is settled. */
    pending?: boolean;
}

export type CompareStrings = Pick<UiStrings, 'compareLevelsAt' | 'compareDiffShow' | 'compareDiffHide' | 'hintDiffToggle' | 'entryBaseGroup' | 'entryBase' | 'entryCount' | 'compareKeyHold' | 'compareKeyBack' | 'comparePlay' | 'compareDelta' | 'compareNotEntry' | 'comparePending' | 'compareBaseEntryRegion' | 'compareReport' | 'reportSaved' | 'compareSelfBase' | 'compareSingleBase' | 'compareRegionDiffers' | 'hintBaseCard' | 'hintSlotCard' | 'hintRegionMark' | 'hintCompareMark' | 'compareNoSignificant' | 'slotEmpty'>;

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** A band's Δ must exceed this (dB), or 3 MAD of the condition's files where there are enough, to head the list. */
export const MIN_HEADLINE_DB = 1.5;

/** Per band, 3 MAD of these files' levels (scaled to σ), at least MIN_HEADLINE_DB. */
function spreadOf(memberBands: ReadonlyArray<readonly (number | null)[]>): number[] {
    return BAND_CENTERS_HZ.map((_, band) => {
        const levels = memberBands.map(bands => bands[band]).filter((level): level is number => level !== null);
        if (levels.length < 2) return MIN_HEADLINE_DB;
        const center = median(levels)!;
        return Math.max(3 * median(levels.map(level => Math.abs(level - center)))! * 1.4826, MIN_HEADLINE_DB);
    });
}

/** The spectrum's lowest edge (analysis_spec.SPECTRUM_MIN_HZ); its points are log-spaced up to Nyquist. */
export const SPECTRUM_MIN_HZ = 20;

/** Each spectrum point's frequency: the geometric centre of its log-spaced edges. */
export function spectrumFrequencies(nyquist: number, points: number): number[] {
    if (!(nyquist > SPECTRUM_MIN_HZ) || points < 1) return [];
    const ratio = (nyquist / SPECTRUM_MIN_HZ) ** (1 / points);
    return Array.from({ length: points }, (_, index) => SPECTRUM_MIN_HZ * ratio ** (index + 0.5));
}

/** Nyquist back from the points' centres, for the axis' right edge. */
function topEdge(frequencies: readonly number[]): number {
    const n = frequencies.length;
    if (!n) return 0;
    return SPECTRUM_MIN_HZ * (frequencies[n - 1] / SPECTRUM_MIN_HZ) ** (n / (n - 0.5));
}

/** One spectrum, Leq and band row per file: channels are power-averaged, as in the entry table. */
function fileSide(result: ScanOk): Omit<CompareSide, 'title' | 'filePaths'> {
    const channels = result.spectrumDb!;
    return {
        spectrumDb: channels[0].map((_, point) => powerMeanDb(channels.map(row => row[point]))),
        leq: powerMeanDb(result.leqDbA!),
        bands: BAND_CENTERS_HZ.map((_, band) => {
            return powerMeanOrNull(result.thirdOctDb!.map(row => row[band]));
        }),
    };
}

/** The base a fixed difference is measured against, from these files' results: one file, or their median. */
export function baseOf(results: ReadonlyMap<string, ScanResult>, paths: readonly string[]): { leq: number; bands: (number | null)[] } | null {
    const sides = paths.map(path => results.get(path)).filter((result): result is ScanOk => !!result?.ok).map(fileSide);
    if (!sides.length || sides.length < paths.length) return null;
    const side = sides.length === 1 ? sides[0] : medianSide(sides);
    return { leq: side.leq, bands: side.bands };
}

function medianSide(sides: Array<Omit<CompareSide, 'title' | 'filePaths'>>): Omit<CompareSide, 'title' | 'filePaths'> {
    const bandsAt = (p: number): (number | null)[] => BAND_CENTERS_HZ.map((_, band) => {
        const levels = sides.map(side => side.bands[band]);
        return levels.some(level => level === null) ? null : quantile(levels as number[], p);
    });
    const spread = sides.length >= 3 ? {
        spectrumDb: [0.25, 0.75].map(p => sides[0].spectrumDb.map((_, point) => quantile(sides.map(side => side.spectrumDb[point]), p))) as [number[], number[]],
        bands: [bandsAt(0.25), bandsAt(0.75)] as [(number | null)[], (number | null)[]],
    } : undefined;
    return {
        ...(spread ? { spread } : {}),
        spectrumDb: sides[0].spectrumDb.map((_, point) => median(sides.map(side => side.spectrumDb[point]))!),
        leq: median(sides.map(side => side.leq))!,
        bands: BAND_CENTERS_HZ.map((_, band) => {
            const levels = sides.map(side => side.bands[band]);
            return levels.some(level => level === null) ? null : median(levels as number[])!;
        }),
    };
}

/**
 * The comparison for one compared file. The base is the file in slot 0 when there is one, otherwise the
 * median of the other files of the compared file's condition (as in the entry table, a file is never
 * part of its own base).
 */
export function buildCompareModel(
    model: EntryModel,
    results: ReadonlyMap<string, ScanResult>,
    comparePath: string | null,
    basePath: string | null,
    strings: CompareStrings,
    /** The base group kept the entry table's region while the compared file has the comparison's. */
    entryRegionBase = false,
    /** How far below the loudest band a band may be and still head the list (Infinity: no limit). */
    headlineWithinDb = HEADLINE_WITHIN_DB,
    /** The base group as the entry table defines it (its grouping, filters and channel), instead of the condition's other files. */
    group?: { paths: readonly string[]; title: string },
): CompareModel {
    const ok = (path: string | null): ScanOk | undefined => {
        const result = path ? results.get(path) : undefined;
        return result?.ok ? result as ScanOk : undefined;
    };
    const compared = ok(comparePath);
    const compare: CompareSide | null = compared ? { title: baseName(comparePath!), filePaths: [comparePath!], ...fileSide(compared) } : null;
    let base: CompareSide | null = null;
    /** The compared file is the only one of its condition: there is nothing to measure it against. */
    let loneGroup = false;
    /** Per band, how far a file of the base's condition typically sits from it by chance (3 MAD, at least 1.5 dB). */
    let bandSpread: number[] | null = null;
    const single = ok(basePath);
    if (single) {
        base = { title: `${strings.entryBase} · ${baseName(basePath!)}`, filePaths: [basePath!], ...fileSide(single) };
        // A single base file still belongs to a condition: its other files (not the base, not the compare)
        // tell how far files of that condition differ by chance. Too few of them: the 1.5 dB floor alone.
        const baseRow = model.rows.find(item => item.filePath === basePath);
        const peers = (baseRow?.group ? model.groups.get(baseRow.group) ?? [] : [])
            .filter(member => member.filePath !== basePath && member.filePath !== comparePath)
            .map(member => ok(member.filePath)).filter((result): result is ScanOk => !!result);
        bandSpread = peers.length >= 3 ? spreadOf(peers.map(fileSide).map(side => side.bands)) : BAND_CENTERS_HZ.map(() => MIN_HEADLINE_DB);
    } else if (comparePath && group) {
        const members = group.paths.filter(path => path !== comparePath);
        const sides = members.map(path => ok(path)).filter((result): result is ScanOk => !!result);
        if (sides.length) {
            bandSpread = sides.length >= 3 ? spreadOf(sides.map(fileSide).map(side => side.bands)) : BAND_CENTERS_HZ.map(() => MIN_HEADLINE_DB);
            base = { title: group.title, filePaths: members, ...medianSide(sides.map(fileSide)) };
        } else loneGroup = true;
    } else if (comparePath) {
        const row = model.rows.find(item => item.filePath === comparePath);
        const members = (row?.group ? model.groups.get(row.group) ?? [] : []).filter(member => member.filePath !== comparePath);
        const sides = members.map(member => ok(member.filePath)).filter((result): result is ScanOk => !!result);
        if (row && sides.length) {
            bandSpread = sides.length >= 3 ? spreadOf(sides.map(fileSide).map(side => side.bands)) : BAND_CENTERS_HZ.map(() => MIN_HEADLINE_DB);
            base = {
                title: [strings.entryBaseGroup, ...row.conditions, strings.entryCount.replace('{count}', String(sides.length))].join(' · '),
                filePaths: members.map(member => member.filePath),
                ...medianSide(sides.map(fileSide)),
            };
        } else if (row?.group) loneGroup = true;
    }
    // A member without any result yet is still being scanned; a failed one is simply left out.
    const basePaths = single ? [basePath!] : base?.filePaths ?? [];
    const pending = !!comparePath && [comparePath, ...basePaths].some(path => !results.has(path));
    const fs = (compared ?? single)?.input?.fs ?? 0;
    const points = (compare ?? base)?.spectrumDb.length ?? 0;
    const frequencies = spectrumFrequencies(fs / 2, points);
    // A base of another length (another sample rate) has no common axis; the entry table marks such rows ≠.
    const blocked: CompareModel['blocked'] = loneGroup && compare ? 'single'
        : !base || !compare ? undefined
            : single && basePath === comparePath ? 'self'
                : !single && entryRegionBase ? 'region' : undefined;
    const comparable = !blocked && !!base && !!compare && base.spectrumDb.length === compare.spectrumDb.length;
    const diffDb = comparable ? compare!.spectrumDb.map((level, index) => level - base!.spectrumDb[index]) : null;
    const leq = comparable ? { base: round1(base!.leq), compare: round1(compare!.leq), delta: round1(round1(compare!.leq) - round1(base!.leq)) } : null;
    const bandDeltas = comparable
        ? compare!.bands.map((level, band) => {
            const reference = base!.bands[band];
            return level === null || reference === null ? null : roundedDelta(level, reference);
        })
        : [];
    // A strong tone leaks into the filters of the bands beside it; a band whose neighbour differs more
    // is that leak, so only the peaks of |Δ| across bands are headline material.
    const size = (band: number): number => Math.abs(bandDeltas[band] ?? 0);
    // A band where both files are far below the loudest band is not what is heard: 20 → 30 dB under a
    // 60 dB band does not head the list, 60 → 65 dB does.
    const louder = (band: number): number => Math.max(base?.bands[band] ?? -Infinity, compare?.bands[band] ?? -Infinity);
    const loudest = comparable ? Math.max(...BAND_CENTERS_HZ.map((_, band) => (bandDeltas[band] === null ? -Infinity : louder(band)))) : -Infinity;
    const quiet = (band: number): boolean => louder(band) < loudest - headlineWithinDb;
    // Against a group, a band within the group's own spread is noise, not a finding: it is not headline material.
    const withinSpread = (band: number): boolean => !!bandSpread && size(band) <= bandSpread[band];
    const topBands = bandDeltas.flatMap((delta, band) => (delta === null || round1(size(band)) === 0 || withinSpread(band) || quiet(band) || size(band) < size(band - 1) || size(band) < size(band + 1) ? [] : [{ band, delta: round1(delta) }]))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
    // A blocked Δ still shows both levels; only the difference is withheld.
    const levels = blocked && base && compare ? { base: round1(base.leq), compare: round1(compare.leq), delta: Number.NaN } : leq;
    return { base, compare, diffDb, frequencies, leq: levels, topBands, bandDeltas, ...(blocked ? { blocked } : {}), ...(pending ? { pending } : {}) };
}

const signed = (value: number): string => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;
const level = (value: number): string => `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}`;

/** "3.15 kHz +23.7 · 25 Hz +13.9 · 4 kHz +3.9 · Leq +1.4 dB" */
export function diffHeadline(comparison: CompareModel, strings?: CompareStrings): string {
    if (!comparison.blocked && comparison.leq && !comparison.topBands.length && strings) {
        // Nothing beyond chance: said in words rather than an empty list.
        return [strings.compareNoSignificant, `Leq ${signed(comparison.leq.delta)} dB`].join(' · ');
    }
    if (comparison.blocked) {
        const why = comparison.blocked === 'self' ? strings?.compareSelfBase : comparison.blocked === 'single' ? strings?.compareSingleBase : strings?.compareRegionDiffers;
        return why ? `— · ${why}` : '—';
    }
    if (!comparison.leq) return '—';
    return [...comparison.topBands.map(item => `${bandLabel(item.band)} ${signed(item.delta)}`), `Leq ${signed(comparison.leq.delta)} dB`].join(' · ');
}

/**
 * The comparison's headline, with both levels rather than their difference alone: the headline bands (as
 * diffHeadline picks them), then Leq. "3.15 kHz base −45.2 / compare −31.1 · Leq base −34.6 / compare −28.6 dB"
 */
export function levelsHeadline(comparison: CompareModel, strings: CompareStrings): string {
    const pair = (at: string, base: number | null | undefined, compare: number | null | undefined): string => strings.compareLevelsAt
        .replace('{at}', at).replace('{base}', base === null || base === undefined ? '—' : level(base)).replace('{compare}', compare === null || compare === undefined ? '—' : level(compare));
    if (!comparison.leq) return '—';
    const leq = `${pair('Leq', comparison.leq.base, comparison.leq.compare)} dB`;
    if (comparison.blocked) return [leq, diffHeadline(comparison, strings)].join(' · ');
    if (!comparison.topBands.length) return [strings.compareNoSignificant, leq].join(' · ');
    return [...comparison.topBands.map(item => pair(bandLabel(item.band), comparison.base?.bands[item.band], comparison.compare?.bands[item.band])), leq].join(' · ');
}

/** A side's spectrum (or 1/3-octave levels) as a picture on the comparison's axes, for drawing it over others. */
export function sideView(side: Pick<CompareSide, 'spectrumDb' | 'bands'> | null | undefined, frequencies: number[], bands = false): StageView | null {
    if (!side) return null;
    if (bands) {
        // Only the bands up to Nyquist: the rest are empty for every file.
        const count = bandCount(frequencies);
        return { frame: 'NOctFrame', kind: 'bar', x: 'band', xScale: 'log', quantity: 'level', xs: BAND_CENTERS_HZ.slice(0, count), values: side.bands.slice(0, count) };
    }
    if (!frequencies.length || side.spectrumDb.length !== frequencies.length) return null;
    return { frame: 'SpectralFrame', kind: 'line', x: 'frequency', xScale: 'log', quantity: 'level', xs: frequencies, values: side.spectrumDb.map(value => Math.round(value * 100) / 100) };
}

/** How many 1/3-octave bands lie below the spectra's top edge (Nyquist). */
function bandCount(frequencies: readonly number[]): number {
    const top = topEdge(frequencies);
    return Math.max(1, BAND_CENTERS_HZ.filter(center => center * 2 ** (1 / 6) <= top).length);
}


/** One entry of the overlay's legend: a line in its colour and dash, a name, its Leq, and ▶ for one file. */
export interface LegendItem {
    color: string;
    label: string;
    value?: string;
    /** ▶ plays this file. */
    path?: string;
    active?: boolean;
    held?: boolean;
    /** The file's memo: ✎, with the memo as its hint. */
    memo?: string;
    /** The file's role chip (roleChip.ts), before its line. */
    chipHtml?: string;
    /** Its ▶ shows ■ while it plays. */
    playing?: boolean;
    /** Said in the hint footer over its label. */
    hint?: string;
}

export function legendHtml(items: readonly LegendItem[], strings: Pick<UiStrings, 'comparePlay'>): string {
    return items.map(item => {
        const mark = `<svg width="18" height="10" aria-hidden="true"><line x1="0" y1="5" x2="18" y2="5" stroke="${item.color}" stroke-width="${item.active ? 3 : 2}"/></svg>`;
        const play = item.path ? `<button type="button" class="compare-play" data-action="compare-play" data-path="${escapeHtml(item.path)}" aria-label="${escapeHtml(strings.comparePlay + ': ' + item.label)}" aria-pressed="${item.playing ? 'true' : 'false'}">${item.playing ? '■' : '▶'}</button>` : '';
        const value = item.value ? ` <span class="compare-value">${escapeHtml(item.value)}</span>` : '';
        const memo = item.memo ? ` <span class="compare-memo" data-memo title="${escapeHtml(item.memo)}" data-hint="${escapeHtml(item.memo)}">✎</span>` : '';
        return `<span class="compare-legend-item${item.active ? ' is-active' : ''}${item.held ? ' is-held' : ''}">${item.chipHtml ?? ''}${mark}<span class="compare-legend-label"${item.hint ? ` title="${escapeHtml(item.hint)}" data-hint="${escapeHtml(item.hint)}"` : ''}>${escapeHtml(item.label)}</span>${value}${memo}${play}</span>`;
    }).join('');
}

export interface PaneRange { min: number; max: number }

/** The plot's left edge: room for the tick numbers and the level axis' name written up the side. */
export const PANE_LEFT = 52;

/** Axis names (and the Δ pane's legend), the same on screen, in the report figures and the summary. */
export interface PaneAxes {
    x: string;
    y: string;
    legend?: { headline: string; leak: string; line: string };
}

/**
 * The comparison's axis names. The level axis follows the files' calibration: dBFS while uncalibrated,
 * dB re the calibration value otherwise.
 */
export function paneAxes(strings: Pick<UiStrings, 'axisFrequency' | 'axisLevelUncal' | 'axisLevelCal' | 'axisDelta' | 'legendHeadline' | 'legendLeak' | 'legendLine'>, input: { unit?: string; ref?: number } | undefined): { level: PaneAxes; delta: PaneAxes } {
    const uncalibrated = !input || (input.unit === 'FS' && input.ref === 1);
    const y = uncalibrated ? strings.axisLevelUncal : strings.axisLevelCal.replace('{ref}', String(input!.ref)).replace('{unit}', input!.unit ?? '');
    return {
        level: { x: strings.axisFrequency, y },
        delta: { x: strings.axisFrequency, y: strings.axisDelta, legend: { headline: strings.legendHeadline, leak: strings.legendLeak, line: strings.legendLine } },
    };
}


export { level as levelDb };
