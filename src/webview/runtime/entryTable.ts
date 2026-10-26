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
    base: { leq: number; bands: (number | null)[]; label?: string; paths?: string[]; definition?: BaseDefinition };
    /** The Recipe it was measured under (recipeKey). */
    recipeKey?: string;
    /** Fixed under another Recipe and not measured again yet: shown as ≠. */
    stale?: boolean;
}

export function regionLabel(region: { start: number; end: number } | null): string {
    return region ? `${region.start.toFixed(2)}–${region.end.toFixed(2)}` : 'all';
}

export interface EntryFile {
    filePath: string;
    result?: ScanResult;
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
    delta: Record<EntryColumn, number | null>;
    groupSize: number;
    /** The file's length, which the measured region is cut from. */
    durationS?: number;
    /** Whether the level is relative to full scale (no calibration): Leq then reads below 0 dB. */
    uncalibrated?: boolean;
    /** The file's 1/3-octave levels, for Δ against another base (slot 0). */
    levels?: (number | null)[];
    /** Set on a derived row: its parent's path and region. */
    derived?: { parent: string; region: string };
}

export interface EntryModel {
    rows: EntryRow[];
    band: number;
    /** Checked columns first, then the rest of the metadata table's columns. */
    columns: EntryConditionColumn[];
    groups: Map<string, EntryRow[]>;
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
function fileValues(result: Extract<ScanResult, { ok: true }> | ScanResult, band: number): Record<EntryColumn, number | null> {
    const leq = result.leqDbA ?? [];
    return {
        leq: powerMeanOrNull(leq),
        peak: null,
        band: powerMeanOrNull((result.thirdOctDb ?? []).map(row => row[band] ?? null)),
    };
}

function profile(result: ScanResult): string {
    const input = result.input!;
    return JSON.stringify([input.channels.length, input.fs, input.unit, input.ref, result.specVersion]);
}

function mismatchLabel(result: ScanResult, reference: ScanResult): string {
    const input = result.input!;
    const base = reference.input!;
    const parts: string[] = [];
    if (input.channels.length !== base.channels.length) parts.push(`${input.channels.length} ch`);
    if (input.fs !== base.fs) parts.push(`${input.fs % 1000 === 0 ? input.fs / 1000 : (input.fs / 1000).toFixed(1)} kHz`);
    if (input.unit !== base.unit || input.ref !== base.ref) parts.push(input.unit);
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
function mostTellingBand(rows: EntryRow[], files: Map<string, ScanResult>): number {
    let best = FALLBACK_BAND;
    let bestSpread = 0;
    BAND_CENTERS_HZ.forEach((_, band) => {
        const groups = new Map<string, number[]>();
        for (const row of rows) {
            if (!row.group) continue;
            const value = fileValues(files.get(row.filePath)!, band).band;
            if (value === null) return;
            groups.set(row.group, [...(groups.get(row.group) ?? []), value]);
        }
        for (const values of groups.values()) {
            if (values.length < MIN_TELLING_GROUP) continue;
            const center = median(values)!;
            const spread = values.reduce((most, value) => Math.max(most, Math.abs(value - center)), -Infinity);
            if (spread > bestSpread) { bestSpread = spread; best = band; }
        }
    });
    return best;
}

/** Builds the model: a row per file with its values, condition and Δ, in the table's order (else by name). */
export function buildEntryModel(
    files: readonly EntryFile[],
    table: EntryConditionTable | null,
    options: { band?: number; derived?: readonly DerivedRow[] } = {},
): EntryModel {
    const columns = conditionColumns(table);
    const results = new Map<string, ScanResult>();
    files.forEach(file => { if (file.result?.ok) results.set(file.filePath, file.result); });
    // Rows are compared only with files of the most common shape (channels, rate, unit, spec version).
    const counts = new Map<string, { count: number; result: ScanResult }>();
    results.forEach(result => {
        const key = profile(result);
        counts.set(key, { count: (counts.get(key)?.count ?? 0) + 1, result });
    });
    const reference = [...counts.values()].sort((a, b) => b.count - a.count)[0]?.result;
    const rows: EntryRow[] = files.map(file => {
        const name = baseName(file.filePath);
        const empty = { leq: null, peak: null, band: null };
        const { cells, conditions } = rowConditions(file.filePath, table, columns);
        const row: EntryRow = {
            filePath: file.filePath, name, status: 'pending', conditions, cells,
            values: { ...empty }, delta: { ...empty }, groupSize: 0,
        };
        const result = file.result;
        if (!result) return row;
        if (!result.ok) { row.status = 'failed'; row.reason = result.reason; return row; }
        if (reference && profile(result) !== profile(reference)) {
            row.status = 'mismatch';
            row.mismatch = mismatchLabel(result, reference);
            return row;
        }
        row.status = 'ok';
        row.durationS = result.input!.durationS;
        row.uncalibrated = result.input!.unit === 'FS' && result.input!.ref === 1;
        if (conditions.length) row.group = JSON.stringify(conditions);
        return row;
    });
    const band = options.band ?? mostTellingBand(rows.filter(row => row.status === 'ok'), results);
    const groups = new Map<string, EntryRow[]>();
    const levels = new Map<string, (number | null)[]>();
    for (const row of rows) {
        if (row.status !== 'ok') continue;
        row.values = fileValues(results.get(row.filePath)!, band);
        row.levels = bandLevels(results.get(row.filePath)!);
        levels.set(row.filePath, row.levels);
        if (row.group) groups.set(row.group, [...(groups.get(row.group) ?? []), row]);
    }
    for (const members of groups.values()) {
        for (const row of members) {
            // The other files of the condition: a row is not part of its own base.
            const others = members.filter(member => member !== row);
            // The files a row is measured against: the same count as the comparison's base group and the slot chip.
            row.groupSize = others.length;
            if (!others.length) continue;
            for (const column of ['leq', 'band'] as const) {
                const value = row.values[column];
                const values = others.map(member => member.values[column]).filter((item): item is number => item !== null);
                if (value === null || !values.length) continue;
                row.delta[column] = roundedDelta(value, median(values)!);
            }
            const max = maxBandDelta(levels.get(row.filePath)!, others.map(member => levels.get(member.filePath)!));
            if (max) {
                row.values.peak = BAND_CENTERS_HZ[max.band];
                const level = levels.get(row.filePath)![max.band]!;
                row.delta.peak = roundedDelta(level, level - max.delta);
            }
        }
    }
    return { rows: withDerived(fileOrder(rows, table), options.derived ?? [], band), band, columns, groups };
}

/**
 * A Δ as every screen and file shows it: both levels to one decimal, then subtracted, so the shown
 * levels add up to the shown Δ and the table, comparison and CSVs agree to the last digit.
 */
export function roundedDelta(value: number, reference: number): number {
    return Math.round((Math.round(value * 10) - Math.round(reference * 10))) / 10;
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
        const delta = level - median(reference)!;
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
                status: item.stale ? 'mismatch' : item.result.ok ? 'ok' : 'failed', ...(item.stale ? { mismatch: '≠' } : {}),
                conditions: row.conditions, cells: row.cells, values, groupSize: 0, durationS: row.durationS,
                delta: {
                    leq: values.leq === null ? null : roundedDelta(values.leq, item.base.leq),
                    peak: max ? Math.round(max.delta * 10) / 10 : null,
                    band: values.band === null || reference === null ? null : roundedDelta(values.band, reference),
                },
                derived: { parent: row.filePath, region: item.region },
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

/** One CSV cell: text quoted when it must be, numbers already formatted by `csvNumber`. */
export function csvCell(value: string | number | null): string {
    if (value === null) return '';
    const text = typeof value === 'number' ? csvNumber(value, 2) : value;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A number for the CSVs: dB to 1 decimal, seconds to 2, Hz whole; never "-0.0". */
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

/** The region as two cells, start and end in seconds; both empty for the whole file. */
export function regionCells(region: string | { start: number; end: number } | null | undefined): [string, string] {
    if (!region || region === 'all') return ['', ''];
    if (typeof region !== 'string') return [csvNumber(region.start, 2), csvNumber(region.end, 2)];
    const [start, end] = region.split('–').map(Number);
    return [csvNumber(start, 2), csvNumber(end, 2)];
}

/**
 * The entry table as CSV, UTF-8 with a BOM so spreadsheet apps read Japanese names (U-01). Rows keep
 * the table's order; the same input always gives the same bytes.
 */
export function entryCsv(model: EntryModel, labels: { file: string; condition: (n: number) => string; regionStart: string; regionEnd: string; leq: string; peak: string; band: string; deltaLeq: string; deltaBand: string; groupSize: string; status: string }): string {
    // Every metadata column goes out, checked ones first, so the CSV keeps what the table was read from.
    const header = [labels.file, ...model.columns.map((column, index) => column.name || labels.condition(index + 1)), labels.regionStart, labels.regionEnd, labels.leq, `${labels.peak} Hz`, `${labels.peak} dB`, labels.band, labels.deltaLeq, labels.deltaBand, labels.groupSize, labels.status];
    const dB = (value: number | null): string => csvNumber(value, 1);
    const lines = [header.map(csvCell).join(',')];
    for (const row of model.rows) {
        const ok = row.status === 'ok';
        lines.push([
            row.derived ? baseName(row.derived.parent) : row.name,
            // The region the numbers were measured over, never blank: the scan skips the file's guarded ends.
            ...row.cells, ...regionCells(ok ? measuredRegion(row.derived?.region, row.durationS) : row.derived?.region),
            ok ? dB(row.values.leq) : null, ok ? csvNumber(row.values.peak, 0) : null, ok ? dB(row.delta.peak) : null, ok ? dB(row.values.band) : null,
            dB(row.delta.leq), dB(row.delta.band), row.groupSize ? String(row.groupSize) : null,
            row.status === 'failed' ? '✕' : row.status === 'mismatch' ? row.mismatch! : '',
        ].map(csvCell).join(','));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
}
