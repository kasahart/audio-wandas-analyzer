/**
 * The comparison's model of the files: what each file measured, which files share a condition, Δ against
 * the median of the condition's other files, and the CSV of it all. Pure functions over scan results.
 *
 * A file is never part of its own base: its Δ and its "Δ max band" are measured against the other files of
 * its condition, as on the comparison. No file is marked as an outlier: the user reads that off the
 * distribution.
 */
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import type { EntryConditionTable } from '../../shared/analysis/entryScan';
import { baseName } from '../../shared/analysis/entryMetadata';
import { median } from '../../shared/dataset/distribution';
import { powerMeanOrNull } from '../../shared/utils/levels';
import { csvFile } from '../../shared/utils/csv';
import { spacingDecimals } from '../plot/plotText';
import { folderReference, type ExclusionReason, scanLevelKey, type FigureColumns, type FolderReference } from './figureModel';
import { scanAnswer } from './answerStore';


/** A group of fewer files says nothing about which band separates them. */
const MIN_TELLING_GROUP = 3;
/** The 27 nominal centres the scan reports (analysis_spec.THIRD_OCTAVE_CENTERS_HZ). */
export const BAND_CENTERS_HZ = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000,
] as const;
const FALLBACK_BAND = BAND_CENTERS_HZ.indexOf(1000);

/** `peak` is the "Δ max band" column: values.peak its centre in Hz, delta.peak its Δ in dB. */
export type EntryColumn = 'leq' | 'peak' | 'band';

export interface EntryConditionColumn {
    /** The metadata column's name; empty for the two conditions read from file names. */
    name: string;
    /** Checked columns decide which rows share a condition. */
    checked: boolean;
    numeric: boolean;
    /** The column's index in the metadata table, -1 for file-name conditions. */
    index: number;
}

/**
 * What a compared file is measured against, as the report and a fixed difference record it: the slot-0 file,
 * or the median of a group's recordings over the table's filters (the value's own range not applied), of one
 * channel when the compared row is a channel; recordings without that channel are left out and counted.
 */
/** A left-out reason as the CSVs, 報告.csv and 定義.json write it (each apart: another axis is not another unit). */
export const LEFT_WORDS: Record<ExclusionReason, string> = { failed: 'failed', empty: 'empty', missing: 'not scanned', pending: 'pending', stale: 'stale', 'other-reference': '≠ reference', 'other-channels': '≠ channels', 'other-axis': '≠ axis', 'no-identity': 'waiting for compared', 'no-channel': 'no such channel' };

/** What a base left out, each reason apart; members without its channel by its own count where its set did not list them. */
export const leftOf = (definition: BaseDefinition): BaseDefinition['left'] => (definition.fewerChannels && !definition.left?.['no-channel'] ? { ...definition.left, 'no-channel': definition.fewerChannels } : definition.left);

/** "-1 (failed) · -2 (≠ axis) · -1 (< ch2)": a base's left-out recordings, each reason apart; `channel`: the one compared. */
export function leftText(left: BaseDefinition['left'], channel?: number | null): string {
    const word = (reason: ExclusionReason): string => (reason === 'no-channel' && channel ? `< ch${channel}` : LEFT_WORDS[reason]);
    return Object.entries(left ?? {}).flatMap(([reason, n]) => (n ? [`-${n} (${word(reason as ExclusionReason)})`] : [])).join(' · ');
}

export interface BaseDefinition {
    kind: 'file' | 'group';
    /** The slot-0 recording ("name ch2"), for a file base. */
    file?: string;
    /** The grouping column and the group's value, for a group base ('' when not grouped). */
    group?: { column: string; name: string };
    /** Recordings the median is taken over. */
    count: number;
    channel: number | null;
    /** The filters applied, as their chips say them. */
    filters: string[];
    /** Recordings of the group left out for having fewer channels than `channel`. */
    fewerChannels: number;
    /** The group's recordings left out of its set, by reason (figureModel's: failed, pending, stale, another reference or axis, …). */
    left?: Partial<Record<ExclusionReason, number>>;
}

/**
 * A difference fixed on the comparison (D): the compared file over a region, with the base it was compared
 * against. It joins the table under its parent row, keeps the parent's condition and never counts
 * toward a group's size or median.
 */
export interface DerivedRow {
    parentPath: string;
    /** The channel compared (a channel row's slot), else the recording's channels together. */
    ch?: number;
    /** "0.50–1.50", as the table and the CSV write regions. */
    region: string;
    result: ScanResult;
    /** What it was measured against: the slot-0 file or the group's other files (`paths`), named by `label`. */
    base: { leq: number; bands: (number | null)[]; label?: string; paths?: string[]; definition?: BaseDefinition; level?: { levelReference?: string; uncalibrated?: 'full-scale' | 'raw-units' } };
    /** The Recipe it was measured under (recipeKey). */
    recipeKey?: string;
    /** Fixed under another Recipe and not measured again yet: shown as ≠. */
    stale?: boolean;
    /** Each file's condition (the scan's conditionId: its version and calibration) when it was fixed: another one makes it ≠. */
    conditions?: Record<string, string>;
}

/**
 * A region as a key: its ends exactly as they are sent (JSON reads each back to the same double), so two regions share
 * a key only when they ask for the same samples. regionLabel rounds it for reading, and is never a key's part.
 */
export function regionKey(region: { start: number; end: number } | null): string {
    return region ? JSON.stringify([region.start, region.end]) : 'all';
}

export function regionLabel(region: { start: number; end: number } | null): string {
    return region ? `${region.start.toFixed(2)}–${region.end.toFixed(2)}` : 'all';
}

export interface EntryFile {
    filePath: string;
    result?: ScanResult;
    /** Its result is of an earlier recipe, version or calibration (the answer store's stale): shown greyed, never counted or written. */
    stale?: boolean;
}

export interface EntryRow {
    filePath: string;
    name: string;
    status: 'pending' | 'failed' | 'mismatch' | 'ok';
    reason?: string;
    /** "≠ 1 ch · 48 kHz": how this row differs from the files it would be compared with. */
    mismatch?: string;
    /** The values of the checked columns, which decide the row's condition. */
    conditions: string[];
    /** One value per model column, in the model's column order. */
    cells: string[];
    /** Rows with the same key share a condition; undefined when the row has none. */
    group?: string;
    values: Record<EntryColumn, number | null>;
    /**
     * A derived row's Δ against the base it was fixed with. A file row's is null: what it is measured against now is the
     * entry screen's base (entryBase), which the CSV asks for (`entryCsv`'s `measure`), never a group made here.
     */
    delta: Record<EntryColumn, number | null>;
    /** The file's length, which the measured region is cut from. */
    durationS?: number;
    /** Set without calibration: the level is relative to full scale, or to 1 raw input unit for a source without one (CSV). */
    uncalibrated?: 'full-scale' | 'raw-units';
    /** What the row's levels are relative to: wandas' level reference for its file ("dBFS", "dB SPL re 20 µPa"). */
    levelReference?: string;
    /** The file's 1/3-octave levels, for Δ against another base (slot 0). */
    levels?: (number | null)[];
    /** Set on a derived row: its parent's path and region. */
    /** Set on a derived row: its parent's path and region, and its base's n and left-out recordings as it was fixed. */
    derived?: { parent: string; region: string; count?: number; left?: string };
    /** Its values are of an earlier recipe, version or calibration: shown greyed, never in a group, a choice or the CSV. */
    stale?: boolean;
}

export interface EntryModel {
    rows: EntryRow[];
    band: number;
    /** Checked columns first, then the rest of the metadata table's columns. */
    columns: EntryConditionColumn[];
    groups: Map<string, EntryRow[]>;
    /** The folder's one level reference (figureModel.folderReference), of its fresh results: the one choice everything takes. */
    reference: FolderReference;
}

/**
 * Conditions in a name like `L3_900rpm_run018`: split on `_` or `-`, the last token is the run and the
 * two before it are the conditions. Names with fewer than three tokens carry none.
 */
export function filenameConditions(filePath: string): string[] {
    const name = baseName(filePath);
    const dot = name.lastIndexOf('.');
    const tokens = (dot > 0 ? name.slice(0, dot) : name).split(/[_-]/).filter(Boolean);
    return tokens.length >= 3 ? tokens.slice(-3, -1) : [];
}


/** One number per file: levels are power-averaged over channels, the dominant frequency is the loudest channel's. */
function fileValues(result: ScanResult, band: number): Record<EntryColumn, number | null> {
    const leq = result.leqDbA ?? [];
    return {
        leq: powerMeanOrNull(leq),
        peak: null,
        band: powerMeanOrNull((result.thirdOctDb ?? []).map(row => row[band] ?? null)),
    };
}

/** A scan that read its file: the only kind the model compares. */
type MeasuredResult = ScanResult & { input: NonNullable<ScanResult['input']> };
const isMeasured = (result: ScanResult | undefined): result is MeasuredResult => !!result?.ok && result.input !== undefined;

/** What rows must share to be compared: channels, sample rate, level identity (figureModel.scanLevelKey) and spec. */
function profile(result: MeasuredResult): string {
    const input = result.input;
    return JSON.stringify([input.channels.length, input.fs, scanLevelKey(result), result.specVersion]);
}

function mismatchLabel(result: MeasuredResult, reference: MeasuredResult): string {
    const input = result.input;
    const base = reference.input;
    const parts: string[] = [];
    if (input.channels.length !== base.channels.length) parts.push(`${input.channels.length} ch`);
    if (input.fs !== base.fs) parts.push(`${input.fs % 1000 === 0 ? input.fs / 1000 : (input.fs / 1000).toFixed(1)} kHz`);
    // What differs of the level identity: the unit, else the reference value or its name (its level reference).
    // A unit is named only when it has one (a raw input of no unit says its level reference: "dB re 1 input unit").
    if (scanLevelKey(result) !== scanLevelKey(reference)) parts.push(input.unit && input.unit !== base.unit ? input.unit : input.levelReferenceLabel);
    if (result.specVersion !== reference.specVersion) parts.push(`v${result.specVersion}`);
    return `≠ ${parts.join(' · ')}`;
}

function conditionColumns(table: EntryConditionTable | null): EntryConditionColumn[] {
    if (!table) return [0, 1].map(() => ({ name: '', checked: true, numeric: false, index: -1 }));
    const checked = table.checked.filter(index => index < table.columns.length);
    const rest = table.columns.map((_, index) => index).filter(index => !checked.includes(index));
    return [...checked, ...rest].map(index => ({
        name: table.columns[index], checked: checked.includes(index), numeric: table.numeric?.[index] ?? false, index,
    }));
}

/**
 * A row's cells and condition: from the metadata table (with its folder columns) when there is one, and
 * a recording the table does not name has none; without a table, from the file name.
 */
function rowConditions(filePath: string, table: EntryConditionTable | null, columns: EntryConditionColumn[]): { cells: string[]; conditions: string[] } {
    if (table) {
        const row = table.rows[filePath];
        if (!row) return { cells: columns.map(() => ''), conditions: [] };
        const conditions = columns.filter(column => column.checked).map(column => row[column.index]);
        return { cells: columns.map(column => row[column.index]), conditions: conditions.some(Boolean) ? conditions : [] };
    }
    const fromName = filenameConditions(filePath);
    return { cells: columns.map((_, index) => fromName[index] ?? ''), conditions: fromName };
}

/** The band whose Δ separates rows most, so the table opens on the band most worth a look. */
function mostTellingBand(rows: EntryRow[], files: Map<string, MeasuredResult>): number {
    let best = FALLBACK_BAND;
    let bestSpread = 0;
    BAND_CENTERS_HZ.forEach((_, band) => {
        const groups = new Map<string, number[]>();
        for (const row of rows) {
            const result = files.get(row.filePath);
            if (!row.group || !result) continue;
            const value = fileValues(result, band).band;
            if (value === null) return;
            groups.set(row.group, [...(groups.get(row.group) ?? []), value]);
        }
        for (const values of groups.values()) {
            if (values.length < MIN_TELLING_GROUP) continue;
            const center = median(values);
            if (center === null) continue;
            const spread = values.reduce((most, value) => Math.max(most, Math.abs(value - center)), -Infinity);
            if (spread > bestSpread) { bestSpread = spread; best = band; }
        }
    });
    return best;
}

/** A row's level reference and, while its file is uncalibrated, what that is relative to. */
function levelOfRow(result: ScanResult): Pick<EntryRow, 'uncalibrated' | 'levelReference'> {
    const input = result.ok ? result.input : undefined;
    if (!input) return {};
    return {
        levelReference: input.levelReferenceLabel,
        ...(input.calibrationStatus === 'uncalibrated' ? { uncalibrated: input.fullScale ? 'full-scale' as const : 'raw-units' as const } : {}),
    };
}

/**
 * The CSV cell that says what a row's levels are in (R1, R4): its level reference, with the calibration word while
 * uncalibrated ("dBFS 未校正"). Each row says its own: never one word for the whole table.
 */
export function levelReferenceCell(row: Pick<EntryRow, 'uncalibrated' | 'levelReference'> | undefined, cols: FigureColumns): string {
    if (!row?.levelReference) return '';
    return row.uncalibrated ? `${row.levelReference} ${cols.uncalibrated}` : row.levelReference;
}

/** Builds the model: a row per file with its values, condition and Δ, in the table's order (else by name). */
export function buildEntryModel(
    files: readonly EntryFile[],
    table: EntryConditionTable | null,
    options: { band?: number; derived?: readonly DerivedRow[] } = {},
): EntryModel {
    const columns = conditionColumns(table);
    const results = new Map<string, MeasuredResult>();
    files.forEach(file => { if (isMeasured(file.result)) results.set(file.filePath, file.result); });
    const fresh = new Set(files.filter(file => !file.stale && isMeasured(file.result)).map(file => file.filePath));
    // The folder's one level reference (figureModel.folderReference: the value columns' heading, the overview, the
    // distribution and a group base with nothing compared take the same), of the fresh results in the table's order.
    const folder = folderReference(files.map(file => (fresh.has(file.filePath) ? scanAnswer(file.filePath, file.result) : { state: 'stale' as const, identity: scanAnswer(file.filePath, undefined).identity })));
    // Rows are compared only with files of that reference and the most common shape among them (channels, rate, spec),
    // a tie going to the shape first in the table; a stale result is never counted.
    const counts = new Map<string, { count: number; result: MeasuredResult }>();
    files.forEach(file => {
        const result = results.get(file.filePath);
        if (!result || !fresh.has(file.filePath) || scanLevelKey(result) !== folder.level) return;
        const key = profile(result);
        counts.set(key, { count: (counts.get(key)?.count ?? 0) + 1, result: counts.get(key)?.result ?? result });
    });
    const reference = [...counts.values()].sort((a, b) => b.count - a.count)[0]?.result;
    const rows: EntryRow[] = files.map(file => {
        const name = baseName(file.filePath);
        const empty = { leq: null, peak: null, band: null };
        const { cells, conditions } = rowConditions(file.filePath, table, columns);
        const row: EntryRow = {
            filePath: file.filePath, name, status: 'pending', conditions, cells,
            values: { ...empty }, delta: { ...empty },
        };
        const result = file.result;
        if (!result) return row;
        if (!result.ok) { row.status = 'failed'; row.reason = result.reason; return row; }
        if (!isMeasured(result)) return row;
        if (file.stale) row.stale = true;
        if (reference && profile(result) !== profile(reference)) {
            row.status = 'mismatch';
            row.mismatch = mismatchLabel(result, reference);
            return row;
        }
        row.status = 'ok';
        row.durationS = result.input.durationS;
        Object.assign(row, levelOfRow(result));
        if (conditions.length) row.group = JSON.stringify(conditions);
        return row;
    });
    const band = options.band ?? mostTellingBand(rows.filter(row => row.status === 'ok' && !row.stale), results);
    const groups = new Map<string, EntryRow[]>();
    for (const row of rows) {
        const result = results.get(row.filePath);
        if (row.status !== 'ok' || !result) continue;
        // A stale row keeps its values to be shown greyed; it is in no group.
        row.values = fileValues(result, band);
        row.levels = bandLevels(result);
        if (row.group && !row.stale) groups.set(row.group, [...(groups.get(row.group) ?? []), row]);
    }
    return { rows: withDerived(fileOrder(rows, table), options.derived ?? [], band), band, columns, groups, reference: folder };
}

/**
 * A Δ as every screen and file takes it: the full-precision levels subtracted, never levels rounded first (−9.996
 * against −10.004 is +0.008, which reads 0.0, not the 0.1 of two rounded levels' difference). Only the text a user
 * reads rounds it, at display (R7).
 */
export function levelDelta(value: number, reference: number): number {
    return value - reference;
}

/** A file's 1/3-octave levels, channels power-averaged. */
function bandLevels(result: ScanResult): (number | null)[] {
    return BAND_CENTERS_HZ.map((_, band) => powerMeanOrNull((result.thirdOctDb ?? []).map(row => row[band] ?? null)));
}

/** The band where a file differs most from the median of `others`: the "Δ max band" column. */
function maxBandDelta(levels: readonly (number | null)[], others: ReadonlyArray<readonly (number | null)[]>): { band: number; delta: number } | null {
    let best: { band: number; delta: number } | null = null;
    levels.forEach((level, band) => {
        const reference = others.map(item => item[band]).filter((item): item is number => item !== null && item !== undefined);
        if (level === null || !reference.length) return;
        const center = median(reference);
        if (center === null) return;
        const delta = level - center;
        if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { band, delta };
    });
    return best;
}

/** One fixed difference per parent, region and base. */
export function derivedKey(item: Pick<DerivedRow, 'parentPath' | 'region' | 'base' | 'ch'>): string {
    return `${item.parentPath}#${item.region}#${item.base.label ?? ''}${item.ch ? `#ch${item.ch}` : ''}`;
}

/** Each derived row right under its parent, in the order they were fixed; Δ is against the base it was fixed with. */
function withDerived(rows: EntryRow[], derived: readonly DerivedRow[], band: number): EntryRow[] {
    if (!derived.length) return rows;
    const out: EntryRow[] = [];
    for (const row of rows) {
        out.push(row);
        derived.filter(item => item.parentPath === row.filePath).forEach(item => {
            // A ≠ row has no number to read until it is measured again: nothing to show or to export.
            const values = item.result.ok && !item.stale ? fileValues(item.result, band) : { leq: null, peak: null, band: null };
            const reference = item.base.bands[band] ?? null;
            const levels = item.result.ok ? bandLevels(item.result) : [];
            const max = item.stale ? null : maxBandDelta(levels, [item.base.bands]);
            if (max) values.peak = BAND_CENTERS_HZ[max.band];
            out.push({
                // The name says what the Δ is against, so two fixed against different bases read apart.
                filePath: derivedKey(item), name: [item.region === 'all' ? '└ Δ' : `└ Δ ${item.region} s`, ...(item.base.label ? [item.base.label] : [])].join(' · '),
                // Fixed under an earlier Recipe: kept (only a click removes it), but no longer a number to read.
                // Its stale flag goes with it: a stale derived row is ≠, has no values, writes no base n nor left-out
                // files (entryCsv), and its status column says ≠, not the file-stale word.
                status: item.stale ? 'mismatch' : item.result.ok ? 'ok' : 'failed', ...(item.stale ? { mismatch: '≠', stale: true } : {}),
                conditions: row.conditions, cells: row.cells, values, durationS: row.durationS, ...levelOfRow(item.result),
                delta: {
                    leq: values.leq === null ? null : levelDelta(values.leq, item.base.leq),
                    peak: max ? max.delta : null,
                    band: values.band === null || reference === null ? null : levelDelta(values.band, reference),
                },
                derived: { parent: row.filePath, region: item.region, ...(item.base.definition ? { count: item.base.definition.count, left: leftText(leftOf(item.base.definition), item.base.definition.channel) } : {}) },
            });
        });
    }
    return out;
}

/** The metadata table's row order, then the remaining files by name: a scan fills rows without moving them. */
function fileOrder(rows: EntryRow[], table: EntryConditionTable | null): EntryRow[] {
    const position = new Map((table?.order ?? Object.keys(table?.rows ?? {})).map((key, index) => [key, index]));
    return [...rows].sort((a, b) => {
        const byTable = (position.get(a.filePath) ?? Infinity) - (position.get(b.filePath) ?? Infinity);
        if (byTable) return byTable;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
}

export function bandLabel(band: number): string {
    const center = BAND_CENTERS_HZ[band];
    return center >= 1000 ? `${center / 1000} kHz` : `${center} Hz`;
}

/** One CSV cell's text (`csvFile` quotes it when it must be): empty for none, a number formatted by `csvNumber`. */
export function csvCell(value: string | number | null): string {
    if (value === null) return '';
    return typeof value === 'number' ? csvNumber(value, 2) : value;
}

/**
 * A 1/3-octave band's centre as the CSVs write it: the nominal centre exactly as its column header names it ("31.5",
 * "3150"), never rounded to a whole Hz ("32" is no band).
 */
export function bandCentreCell(hz: number | null | undefined): string {
    return hz === null || hz === undefined || !Number.isFinite(hz) ? '' : String(hz);
}

/** A number for the CSVs: dB to 1 decimal, seconds to 2; never "-0.0". A band's centre is `bandCentreCell`. */
export function csvNumber(value: number | null | undefined, decimals: number): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    const text = value.toFixed(decimals);
    return Number(text) === 0 ? (0).toFixed(decimals) : text;
}

/** The scan skips this much where a region touches the file's start or end (analysis_spec.EDGE_GUARD_S). */
export const EDGE_GUARD_S = 0.15;

/**
 * The comparison's headline names a difference only where the louder of base and compare is within this many dB
 * of the loudest point of the picture: 60 → 65 dB is heard, 20 → 30 dB under a 60 dB peak is not.
 */
export const HEADLINE_WITHIN_DB = 20;

/** The `p` quantile (0–1) of `values`, linearly interpolated between the sorted values. */
export function quantile(values: readonly number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (sorted.length - 1) * p;
    const low = Math.floor(at), high = Math.ceil(at);
    return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** The region a scan actually measured: the asked region (or the whole file) less the guarded ends. */
export function measuredRegion(region: string | { start: number; end: number } | null | undefined, durationS: number | undefined): { start: number; end: number } | null {
    const asked = !region || region === 'all' ? null : typeof region === 'string' ? (([start, end]) => ({ start, end }))(region.split('–').map(Number)) : region;
    if (durationS === undefined) return asked;
    const start = Math.max(asked?.start ?? 0, EDGE_GUARD_S);
    const end = Math.min(asked?.end ?? durationS, durationS - EDGE_GUARD_S);
    return { start: Math.round(start * 1e6) / 1e6, end: Math.round(end * 1e6) / 1e6 };
}

/**
 * The region as two cells, start and end in seconds; both empty for the whole file. To 10 ms, finer where the region
 * is so short its ends would read alike (to a tenth of its length, as secondsSpanText writes it: plotText.ts spacingDecimals).
 */
export function regionCells(region: string | { start: number; end: number } | null | undefined): [string, string] {
    if (!region || region === 'all') return ['', ''];
    const { start, end } = typeof region !== 'string' ? region : (([a, b]) => ({ start: a, end: b }))(region.split('–').map(Number));
    const digits = spacingDecimals(Math.abs(end - start) / 10, 2, 6);
    return [csvNumber(start, digits), csvNumber(end, digits)];
}

/**
 * What a file row of the entry CSV is measured against, as the comparison measures it now (entryBase.fileComparison):
 * its Δ Leq, the chosen band's Δ, the band of the largest |Δ| and the count of recordings in the base.
 */
export interface EntryMeasure {
    leq: number | null;
    band: number | null;
    peak: { hz: number; db: number } | null;
    count: number;
    /** What the base left out of its set, with why ("1 still computing"): written beside its n. */
    left: string;
}

/**
 * The entry table as CSV, UTF-8 with a BOM so spreadsheet apps read Japanese names (U-01). Rows keep
 * the table's order; the same input always gives the same bytes. A file row's Δ columns are `measure`'s: the base the
 * screen, the comparison and the report measure from, so the CSV never has a Δ of its own.
 */
export function entryCsv(model: EntryModel, labels: { file: string; condition: (n: number) => string; regionStart: string; regionEnd: string; level: FigureColumns; peak: string; bandLevel: FigureColumns; deltaLeq: string; deltaBand: string; groupSize: string; groupLeft: string; status: string; stale: string },
    measure: (filePath: string) => EntryMeasure | null): string {
    // Every metadata column goes out, checked ones first, so the CSV keeps what the table was read from.
    const header = [labels.file, ...model.columns.map((column, index) => column.name || labels.condition(index + 1)), labels.regionStart, labels.regionEnd, labels.level.level, labels.level.reference, `${labels.peak} Hz`, `${labels.peak} dB`, labels.bandLevel.level, labels.bandLevel.reference, labels.deltaLeq, labels.deltaBand, labels.groupSize, labels.groupLeft, labels.status];
    const dB = (value: number | null): string => csvNumber(value, 1);
    const lines: string[][] = [];
    for (const row of model.rows) {
        // A row of an earlier recipe, version or calibration writes none of its numbers, and says so.
        const ok = row.status === 'ok' && !row.stale;
        // A derived row keeps the Δ it was fixed with; a file row is measured against the base it has now.
        const now = ok && !row.derived ? measure(row.filePath) : null;
        // A ≠ (stale) fixed row writes no number at all: neither its Δ nor its base's n and left-out files (R4).
        const delta = row.derived && row.stale ? { leq: null, band: null, hz: null, peak: null, count: null, left: '' }
            : row.derived ? { leq: row.delta.leq, band: row.delta.band, hz: row.values.peak, peak: row.delta.peak, count: row.derived.count ?? null, left: row.derived.left ?? '' }
            : { leq: now?.leq ?? null, band: now?.band ?? null, hz: now?.peak?.hz ?? null, peak: now?.peak?.db ?? null, count: now?.count ?? null, left: now?.left ?? '' };
        lines.push([
            row.derived ? baseName(row.derived.parent) : row.name,
            // The region the numbers were measured over, never blank: the scan skips the file's guarded ends.
            ...row.cells, ...regionCells(ok ? measuredRegion(row.derived?.region, row.durationS) : row.derived?.region),
            ok ? dB(row.values.leq) : null, ok ? levelReferenceCell(row, labels.level) : null, ok ? bandCentreCell(delta.hz) : null, ok ? dB(delta.peak) : null, ok ? dB(row.values.band) : null, ok ? levelReferenceCell(row, labels.bandLevel) : null,
            // n is the set's, 0 too (a base whose every recording was left out says so, with why), never blank or 1.
            dB(delta.leq), dB(delta.band), delta.count === null ? null : String(delta.count), delta.left || null,
            row.stale && !row.derived ? labels.stale : row.status === 'failed' ? '✕' : row.status === 'mismatch' ? row.mismatch ?? '' : '',
        ].map(csvCell));
    }
    return csvFile(header.map(csvCell), lines);
}
