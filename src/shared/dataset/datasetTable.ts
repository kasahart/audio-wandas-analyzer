/**
 * The entry table's dataset: one row per recording and channel, its attributes from the CSV the user picked
 * (read and matched by asd-insight's rules, asdData.ts), its subfolders, and the values computed from its
 * sound (per channel, never averaged over channels). Which column groups the rows, which value is shown, the
 * filters and the order are the user's; this module only answers them. Pure, so it is unit-tested.
 */
import type { ScanResult } from '../protocol/backendProtocol';
import { auditAudioMatches, finiteNumber, MAX_CSV_BYTES, parseCSV, profileColumns, resolveAudio, sourceColumns, summarizeAudioCandidates, type DataRow } from './asdData';

/** The CSV the user picked, read: its columns (the source columns left out) and which of them are numeric. */
export interface DatasetCsv {
    name: string;
    columns: string[];
    rows: DataRow[];
    /** Attribute columns: every column but the audio and sample-name ones. */
    attributes: string[];
    numeric: Record<string, boolean>;
    idColumn: string;
    audioColumn: string;
}

/** Reads a picked CSV/TSV as asd-insight does: ≤ 20 MiB, UTF-8 only, ≤ 128 named columns, ≥ 1 numeric column. */
export function readDatasetCsv(bytes: Uint8Array, name: string): DatasetCsv {
    if (!/\.(csv|tsv)$/i.test(name)) throw new Error('CSVまたはTSV形式のファイルを選んでください。');
    if (bytes.byteLength > MAX_CSV_BYTES) throw new Error('CSVは20MB・128列までです。');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('UTF-8のCSVまたはTSVとして保存し直してください。'); }
    const data = parseCSV(text, name);
    const { idColumn, audioColumn } = sourceColumns(data.columns);
    const numeric = Object.fromEntries(profileColumns(data).map(profile => [profile.column, profile.numeric]));
    return { name, columns: data.columns, rows: data.rows, attributes: data.columns.filter(column => column !== idColumn && column !== audioColumn), numeric, idColumn, audioColumn };
}

/** Why a CSV row or a recording has no partner. */
export type UnmatchedReason = 'missing' | 'ambiguous' | 'repeated' | 'no-row';

export interface Unmatched {
    /** A CSV row (1-based data row) or a recording (its path). */
    row?: number;
    filePath?: string;
    reason: UnmatchedReason;
    /** What was looked for, or the candidates, or the rows that named the same recording. */
    detail: string;
}

export interface CsvMatch {
    /** Each recording's attributes: the first CSV row that names it. */
    attributes: Map<string, DataRow>;
    unmatched: Unmatched[];
}

/** The recording's path below the opened folder, as tables name it. */
export function recordingKey(filePath: string, rootPath: string): string {
    const path = filePath.replaceAll('\\', '/');
    const root = rootPath.replaceAll('\\', '/').replace(/\/+$/, '');
    return root && path.startsWith(root + '/') ? path.slice(root.length + 1) : path.slice(path.lastIndexOf('/') + 1);
}

/** Matches the CSV's rows to the recordings by asd-insight's rule; the first row for a recording wins. */
export function matchCsv(csv: DatasetCsv, filePaths: readonly string[], rootPath: string): CsvMatch {
    const files = new Map(filePaths.map(filePath => [recordingKey(filePath, rootPath), filePath]));
    const attributes = new Map<string, DataRow>();
    csv.rows.forEach((row, index) => {
        const resolution = resolveAudio(row, index, csv.idColumn, csv.audioColumn, files);
        if (resolution.file && !attributes.has(resolution.file)) attributes.set(resolution.file, row);
    });
    const audit = auditAudioMatches({ name: csv.name, columns: csv.columns, rows: csv.rows }, csv.idColumn, csv.audioColumn, files);
    const unmatched: Unmatched[] = [
        ...audit.missing.map(item => ({ row: item.row, reason: 'missing' as const, detail: item.expected })),
        ...audit.ambiguous.map(item => ({ row: item.row, reason: 'ambiguous' as const, detail: summarizeAudioCandidates(item.candidates) })),
        ...audit.repeated.flatMap(item => item.rows.slice(1).map(row => ({ row, reason: 'repeated' as const, detail: `${item.key} · ${item.rows[0]}` }))),
        ...audit.unused.map(key => ({ filePath: files.get(key)!, reason: 'no-row' as const, detail: key })),
    ];
    return { attributes, unmatched };
}

/** One row of the table: a recording's channel (ch 1 until the recording's channels are known). */
export interface DatasetRow {
    key: string;
    filePath: string;
    name: string;
    ch: number;
    /** The recording's channels; undefined until a result says. */
    channels?: number;
    attributes?: DataRow;
    /** The recording's subfolders below the opened folder, outermost first. */
    folders: string[];
}

export const rowKey = (filePath: string, ch: number, channels: number | undefined): string => ((channels ?? 1) > 1 ? `${filePath}#ch${ch}` : filePath);
export const fileOfKey = (key: string): string => key.replace(/#ch\d+$/, '');

/** Rows by channel: the channels a result says, else those its header said (`headers`), else one row with ch unknown. */
export function datasetRows(filePaths: readonly string[], rootPath: string, attributes: ReadonlyMap<string, DataRow>, results: Results, headers: ReadonlyMap<string, number> = new Map()): DatasetRow[] {
    return filePaths.flatMap(filePath => {
        const result = results.get(filePath);
        const channels = result?.ok ? result.input!.channels.length : headers.get(filePath);
        const relative = recordingKey(filePath, rootPath);
        const folders = relative.split('/').slice(0, -1);
        const name = relative.slice(relative.lastIndexOf('/') + 1);
        return Array.from({ length: channels ?? 1 }, (_, index) => ({
            key: rowKey(filePath, index + 1, channels), filePath, name, ch: index + 1, channels, attributes: attributes.get(filePath), folders,
        }));
    });
}

/** A value column: a numeric CSV column, or one computed from the sound per channel. */
export type ValueId = `csv:${string}` | 'leq' | 'peak' | 'crest' | `band:${number}`;
/** A grouping: a CSV column, a subfolder level, the channel, or none. */
export type GroupId = `csv:${string}` | `folder:${number}` | 'ch' | 'none';

export const isComputed = (value: ValueId): boolean => !value.startsWith('csv:');

export function valueOf(row: DatasetRow, value: ValueId, results: Results): number | null {
    if (value.startsWith('csv:')) return finiteNumber(row.attributes?.[value.slice(4)] ?? '');
    const result = results.get(row.filePath);
    if (!result?.ok) return null;
    const index = row.ch - 1;
    if (value === 'leq') return result.leqDbA?.[index] ?? null;
    if (value === 'peak') return result.peakHz?.[index] ?? null;
    if (value === 'crest') return result.crest?.[index] ?? null;
    return result.thirdOctDb?.[index]?.[Number(value.slice(5))] ?? null;
}

export function groupOf(row: DatasetRow, group: GroupId): string {
    if (group === 'none') return '';
    if (group === 'ch') return String(row.ch);
    if (group.startsWith('folder:')) return row.folders[Number(group.slice(7)) - 1] ?? '';
    return row.attributes?.[group.slice(4)]?.trim() ?? '';
}

/** A column of the table to filter by: the name, a grouping, or a value. */
export type ColumnId = 'name' | GroupId | ValueId;

export type DatasetFilter =
    | { column: ColumnId; kind: 'values'; values: string[] }
    | { column: ColumnId; kind: 'range'; low: number; high: number };

/** What a row's values are read from: the recordings' results. */
export type Results = ReadonlyMap<string, ScanResult>;

/** A row's text in a column, as a filter's check list shows and matches it (numbers as they read in the CSV). */
export function textOf(row: DatasetRow, column: ColumnId, results: Results): string {
    if (column === 'name') return row.name;
    if (column === 'ch' || column === 'none' || column.startsWith('folder:') || column.startsWith('csv:')) return groupOf(row, column as GroupId);
    const value = valueOf(row, column as ValueId, results);
    return value === null ? '' : String(value);
}

export function passes(row: DatasetRow, filter: DatasetFilter, results: Results): boolean {
    if (filter.kind === 'values') return filter.values.includes(textOf(row, filter.column, results));
    const value = valueOf(row, filter.column as ValueId, results);
    return value !== null && value >= filter.low && value <= filter.high;
}

export interface DatasetView {
    rows: DatasetRow[];
    group: GroupId;
    value: ValueId;
    filters: readonly DatasetFilter[];
    sort: { column: 'name' | 'ch' | 'group' | 'value'; descending: boolean };
    excluded: ReadonlySet<string>;
}

/** Text in natural order ("run9" before "run10"); one collator, as a sort compares 100,000 rows many times. */
const natural = new Intl.Collator(undefined, { numeric: true }).compare;

/** The rows not excluded and through every filter, in their own order. */
export function filteredRows(view: Pick<DatasetView, 'rows' | 'filters' | 'excluded'>, results: Results): DatasetRow[] {
    if (!view.filters.length && !view.excluded.size) return view.rows.slice();
    return view.rows.filter(row => !view.excluded.has(row.key) && view.filters.every(filter => passes(row, filter, results)));
}

/** Each name's place in natural order, kept between sorts while the names stay: a sort then compares numbers, not text. */
let nameOrder = new Map<string, number>();
function nameRanks(rows: readonly DatasetRow[]): ReadonlyMap<string, number> {
    if (rows.every(row => nameOrder.has(row.name))) return nameOrder;
    // Code-unit order first, which is cheap and mostly natural already: the collator's sort then confirms long runs.
    const names = [...new Set(rows.map(row => row.name))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).sort(natural);
    nameOrder = new Map();
    // Names the collator holds equal share a place, so ties still fall to the channel.
    names.forEach((name, index) => nameOrder.set(name, index > 0 && natural(names[index - 1], name) === 0 ? nameOrder.get(names[index - 1])! : index));
    return nameOrder;
}

/** The rows on screen: not excluded, through every filter, in the chosen order (ties by name, then channel). */
export function visibleRows(view: DatasetView, results: Results): DatasetRow[] {
    const rows = filteredRows(view, results);
    const by = view.sort.column;
    const rank = nameRanks(rows);
    const keyOf = (row: DatasetRow): string | number | null => (by === 'name' ? rank.get(row.name)! : by === 'ch' ? row.ch : by === 'group' ? groupOf(row, view.group) : valueOf(row, view.value, results));
    const sign = view.sort.descending ? -1 : 1;
    const keyed = rows.map(row => ({ row, key: keyOf(row), place: rank.get(row.name)! }));
    keyed.sort((a, b) => {
        // A missing value sorts last whichever way.
        if (a.key === null || b.key === null) return a.key === b.key ? 0 : a.key === null ? 1 : -1;
        const order = typeof a.key === 'number' && typeof b.key === 'number' ? a.key - b.key : natural(String(a.key), String(b.key));
        return sign * order || a.place - b.place || a.row.ch - b.row.ch;
    });
    return keyed.map(item => item.row);
}

/** A column's distinct texts over the rows (not excluded), with how many rows have each, for a filter's check list. */
export function columnValues(rows: readonly DatasetRow[], column: ColumnId, results: Results): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const row of rows) { const text = textOf(row, column, results); counts.set(text, (counts.get(text) ?? 0) + 1); }
    return [...counts.entries()].sort(([a], [b]) => natural(a, b));
}

/** Middle ellipsis: a long name keeps its start and its end, where the number that tells files apart usually is. */
export function middleEllipsis(name: string, max = 34): string {
    if (name.length <= max) return name;
    const head = Math.ceil((max - 1) * 0.35);
    return `${name.slice(0, head)}…${name.slice(name.length - (max - 1 - head))}`;
}

/**
 * A compared recording's base group, from `pool` (the table's rows through its filters): the group's other
 * recordings (`name` under `group`; every row when not grouped), of `channel` when one channel is compared.
 * Recordings without that channel cannot be a member: they are left out and counted.
 */
export function baseGroupMembers(pool: readonly DatasetRow[], comparePath: string, group: GroupId, name: string, channel: number | null): { paths: string[]; fewerChannels: number } {
    const others = pool.filter(row => row.filePath !== comparePath && (group === 'none' || groupOf(row, group) === name));
    const members = channel ? others.filter(row => row.ch === channel) : others;
    const fewerChannels = channel ? new Set(others.filter(row => (row.channels ?? 1) < channel).map(row => row.filePath)).size : 0;
    return { paths: [...new Set(members.map(row => row.filePath))], fewerChannels };
}

/**
 * 「メモと除外を CSV に書き出す」: the picked CSV as it was (its columns and rows, in order) with two columns
 * after, `memo` and `excluded`, so it goes back to whoever made it. A recording's memos per channel read
 * "ch1: …; ch2: …"; excluded is 1 for the whole recording, else its channels ("ch2"). Without a CSV, one row
 * per recording by its path below the folder. UTF-8 with a BOM, as the Analyzer's other CSV files.
 */
export function annotatedCsv(csv: DatasetCsv | null, match: CsvMatch | null, filePaths: readonly string[], rootPath: string,
    rows: readonly DatasetRow[], memo: ReadonlyMap<string, string>, excluded: ReadonlySet<string>): string {
    const keysOf = new Map<string, DatasetRow[]>();
    for (const row of rows) keysOf.set(row.filePath, [...(keysOf.get(row.filePath) ?? []), row]);
    const memoOf = (filePath: string): string => {
        const own = (keysOf.get(filePath) ?? []).filter(row => memo.has(row.key));
        if (own.length === 1 && (own[0].channels ?? 1) <= 1) return memo.get(own[0].key)!;
        return own.map(row => `ch${row.ch}: ${memo.get(row.key)}`).join('; ');
    };
    const excludedOf = (filePath: string): string => {
        const all = keysOf.get(filePath) ?? [];
        const out = all.filter(row => excluded.has(row.key));
        if (!out.length) return '';
        return out.length === all.length ? '1' : out.map(row => `ch${row.ch}`).join(';');
    };
    const cell = (text: string): string => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const name = (base: string, taken: readonly string[]): string => (taken.includes(base) ? `${base}_analyzer` : base);
    let lines: string[][];
    if (csv && match) {
        const fileOfRow = new Map<DataRow, string>([...match.attributes].map(([filePath, row]) => [row, filePath]));
        lines = [[...csv.columns, name('memo', csv.columns), name('excluded', csv.columns)],
            ...csv.rows.map(row => { const filePath = fileOfRow.get(row); return [...csv.columns.map(column => row[column] ?? ''), filePath ? memoOf(filePath) : '', filePath ? excludedOf(filePath) : '']; })];
    } else {
        lines = [['audio_file', 'memo', 'excluded'], ...filePaths.map(filePath => [recordingKey(filePath, rootPath), memoOf(filePath), excludedOf(filePath)])];
    }
    return '\uFEFF' + lines.map(line => line.map(cell).join(',')).join('\r\n') + '\r\n';
}
