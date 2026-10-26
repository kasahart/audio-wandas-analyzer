/**
 * Metadata tables for the entry table, read by the same rules as asd-insight so one CSV serves both:
 * a CSV/TSV beside the recordings (or pasted / dropped), one row per recording, matched to the opened
 * folder's files by the relative path or file name in its audio column, or by its sample name.
 * See asd-insight packages/domain/data.ts (csvDelimiter, resolveAudio) and audio-import.ts.
 */
import type { EntryConditionTable } from './entryScan';

/** asd-insight initialSetup: the column that names the recording's file or path. */
const AUDIO_COLUMN = /^(audio_file|audio_path|wav_path|file_path|filename|audio|path)$/i;
/** asd-insight initialSetup: the sample name, matched with the usual audio extensions added. */
const SAMPLE_COLUMN = /^(sample_id|sample_name|id|inspection_id|検査id|サンプル名)$/i;
/** asd-insight's id fallback: a path-like column when no sample-name column exists. */
const PATH_COLUMN = /^(audio_file|audio_path|wav_path|file_path|filename|path)$/i;
const SAMPLE_EXTENSIONS = ['.wav', '.flac', '.mp3', '.ogg', '.m4a'];
/** asd-insight's limits for one table. */
export const MAX_TABLE_COLUMNS = 128;
export const MAX_TABLE_BYTES = 20 * 1024 ** 2;
/** A table is the folder's metadata when it names at least this share of the recordings. */
export const METADATA_MIN_MATCH = 0.5;
export const METADATA_EXTENSIONS = ['.csv', '.tsv'] as const;

export function baseName(filePath: string): string {
    return filePath.slice(filePath.replace(/\\/g, '/').lastIndexOf('/') + 1);
}

export function isMetadataCandidate(filePath: string): boolean {
    const name = baseName(filePath).toLowerCase();
    return METADATA_EXTENSIONS.some(extension => name.endsWith(extension));
}

/** asd-insight normalizedAudioPath: `/` separators, no leading `./`. */
export function normalizedAudioPath(value: string): string {
    return value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

/** The recording's path below the opened folder, as tables name it (asd-insight audioFileKey). */
export function audioKey(filePath: string, rootPath: string): string {
    const path = filePath.replaceAll('\\', '/');
    const root = rootPath.replaceAll('\\', '/').replace(/\/+$/, '');
    return root && path.startsWith(root + '/') ? path.slice(root.length + 1) : baseName(path);
}

/**
 * UTF-8 (a BOM is dropped), as asd-insight reads tables. Bytes that are not valid UTF-8 are read as
 * Shift_JIS, which Excel writes in Japan; asd-insight asks for UTF-8 instead.
 */
export function decodeTableText(bytes: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch {
        return new TextDecoder('shift_jis').decode(bytes);
    }
}

/** asd-insight csvDelimiter: tab when the first non-blank record has more tabs than commas. */
export function tableDelimiter(text: string): ',' | '\t' {
    let quoted = false, commas = 0, tabs = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') { i++; continue; }
            quoted = !quoted;
        }
        if (quoted) continue;
        if (c === '\n' || c === '\r') {
            if (text.slice(start, i).trim()) break;
            if (c === '\r' && text[i + 1] === '\n') i++;
            start = i + 1; commas = 0; tabs = 0;
        } else if (c === ',') commas++;
        else if (c === '\t') tabs++;
    }
    return tabs > commas ? '\t' : ',';
}

export interface ParsedTable {
    columns: string[];
    rows: string[][];
}

/** Records of a delimited text; quoted fields may hold delimiters, quotes and line breaks. */
function records(text: string, delimiter: string): string[][] {
    const out: string[][] = [];
    let record: string[] = [], field = '', quoted = false, touched = false;
    const end = (): void => {
        if (touched || record.length || field.trim()) out.push([...record, field]);
        record = []; field = ''; touched = false;
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"' && !field.trim()) { field = ''; quoted = true; touched = true; }
        else if (c === delimiter) { record.push(field); field = ''; touched = true; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; end(); }
        else field += c;
    }
    end();
    return out;
}

/**
 * A table with a header row, as asd-insight accepts it: at most 128 named, distinct columns, every row
 * as wide as the header. Anything else is not a metadata table (null).
 */
export function parseTable(input: string): ParsedTable | null {
    const text = input.replace(/^﻿/, '');
    if (!text.trim()) return null;
    const [header, ...body] = records(text, tableDelimiter(text));
    const columns = header.map(cell => cell.trim());
    if (!body.length || columns.length > MAX_TABLE_COLUMNS || columns.some(column => !column) || new Set(columns).size !== columns.length) return null;
    if (body.some(row => row.length !== columns.length)) return null;
    return { columns, rows: body.map(row => row.map(cell => cell.trim())) };
}

export interface MetadataAudit {
    /** Recordings a row was attached to, of all recordings. */
    matched: number;
    recordings: number;
    /** Rows with no recording (未対応), naming several (曖昧), or repeating one already taken (重複非採用). */
    missing: number;
    ambiguous: number;
    repeated: number;
}

const isNumber = (value: string): boolean => value !== '' && Number.isFinite(Number(value));

/**
 * Attaches a table's rows to the listed recordings (asd-insight resolveAudio): by the audio column's
 * relative path (exact) or file name (only when one recording has it), else by the sample name with
 * an audio extension added; without either column the first column is the sample name. Matching is
 * case-sensitive and the first row for a recording wins. The audio and sample columns are not
 * conditions; the first two other columns decide which rows share one.
 */
export function resolveTable(
    parsed: ParsedTable,
    recordings: readonly string[],
    rootPath: string,
    source?: string,
): { table: EntryConditionTable; audit: MetadataAudit } {
    const audioColumn = parsed.columns.findIndex(column => AUDIO_COLUMN.test(column));
    let idColumn = parsed.columns.findIndex(column => SAMPLE_COLUMN.test(column));
    if (idColumn < 0) idColumn = parsed.columns.findIndex(column => PATH_COLUMN.test(column));
    if (audioColumn < 0 && idColumn < 0) idColumn = 0;
    const byKey = new Map(recordings.map(filePath => [audioKey(filePath, rootPath), filePath]));
    const byName = new Map<string, string[]>();
    for (const key of byKey.keys()) {
        const name = key.split('/').at(-1)!;
        byName.set(name, [...(byName.get(name) ?? []), key]);
    }
    const attributes = parsed.columns.map((_, index) => index).filter(index => index !== audioColumn && index !== idColumn);
    const rows: Record<string, string[]> = {};
    const order: string[] = [];
    let missing = 0, ambiguous = 0, repeated = 0;
    for (const row of parsed.rows) {
        const id = audioColumn >= 0 ? '' : row[idColumn];
        const expected = audioColumn >= 0
            ? [normalizedAudioPath(row[audioColumn])]
            : id ? [id, ...SAMPLE_EXTENSIONS.map(extension => id + extension)] : [];
        let key: string | undefined;
        let unclear = false;
        for (const name of expected) {
            if (!name) continue;
            // A path is explicit: never guessed from its file name when it is missing.
            if (name.includes('/')) { if (byKey.has(name)) { key = name; break; } continue; }
            const candidates = byName.get(name) ?? [];
            if (candidates.length === 1) { key = candidates[0]; break; }
            if (candidates.length > 1) { unclear = true; break; }
        }
        if (!key) { if (unclear) ambiguous++; else missing++; continue; }
        const filePath = byKey.get(key)!;
        if (filePath in rows) { repeated++; continue; }
        rows[filePath] = attributes.map(index => row[index]);
        order.push(filePath);
    }
    const columns = attributes.map(index => parsed.columns[index]);
    const numeric = columns.map((_, column) => {
        const values = order.map(filePath => rows[filePath][column]).filter(value => value !== '');
        return values.length > 0 && values.every(isNumber);
    });
    const audit = { matched: order.length, recordings: recordings.length, missing, ambiguous, repeated };
    return {
        table: { columns, checked: columns.map((_, index) => index).slice(0, 2), rows, order, numeric, audit, ...(source ? { source } : {}) },
        audit,
    };
}

/**
 * Subfolders as condition columns (asd-insight withFolderAttributes): level n holds each recording's
 * n-th folder below the opened one. When the table has no columns of its own, they decide the
 * condition by default.
 */
export function withFolderColumns(
    table: EntryConditionTable | null,
    recordings: readonly string[],
    rootPath: string,
    label: (level: number) => string,
): EntryConditionTable | null {
    const folders = new Map(recordings.map(filePath => [filePath, audioKey(filePath, rootPath).split('/').slice(0, -1)]));
    const levels = Math.max(0, ...[...folders.values()].map(parts => parts.length));
    if (!levels) return table;
    const base = table ?? { columns: [], checked: [], rows: {}, order: [] };
    const width = base.columns.length;
    const added = Array.from({ length: levels }, (_, index) => label(index + 1));
    const rows: Record<string, string[]> = {};
    for (const filePath of recordings) {
        rows[filePath] = [...(base.rows[filePath] ?? Array(width).fill('')), ...added.map((_, level) => folders.get(filePath)![level] ?? '')];
    }
    return {
        ...base,
        columns: [...base.columns, ...added],
        rows,
        numeric: [...(base.numeric ?? base.columns.map(() => false)), ...added.map(() => false)],
        checked: width ? base.checked : added.map((_, level) => width + level).slice(0, 2),
    };
}

export interface MetadataCandidate {
    path: string;
    /** Bytes of the file, when known without reading it, so a file over 20 MiB is skipped unread. */
    size?: number;
    read(): Promise<Uint8Array>;
}

/**
 * The candidate attached to the most recordings, if to at least half of them; ties go to the first by
 * name. Candidates that cannot be read, are too large or are not tables are skipped.
 */
export async function pickMetadataTable(
    candidates: readonly MetadataCandidate[],
    recordings: readonly string[],
    rootPath: string,
): Promise<{ path: string; table: EntryConditionTable } | undefined> {
    if (!recordings.length) return undefined;
    let best: { path: string; table: EntryConditionTable; matched: number } | undefined;
    const byName = [...candidates].sort((a, b) => (baseName(a.path) < baseName(b.path) ? -1 : baseName(a.path) > baseName(b.path) ? 1 : 0));
    for (const candidate of byName) {
        if ((candidate.size ?? 0) > MAX_TABLE_BYTES) continue;
        let parsed: ParsedTable | null;
        try {
            const bytes = await candidate.read();
            if (bytes.byteLength > MAX_TABLE_BYTES) continue;
            parsed = parseTable(decodeTableText(bytes));
        } catch { continue; }
        if (!parsed) continue;
        const { table, audit } = resolveTable(parsed, recordings, rootPath, baseName(candidate.path));
        if (audit.matched / recordings.length >= METADATA_MIN_MATCH && (!best || audit.matched > best.matched)) {
            best = { path: candidate.path, table, matched: audit.matched };
        }
    }
    return best && { path: best.path, table: best.table };
}
