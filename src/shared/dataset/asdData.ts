/**
 * Reading an attribute CSV/TSV and matching its rows to recordings, ported from asd-insight's domain
 * (packages/domain/data.ts, distribution.ts finiteNumber, audio-import.ts and src/lib/dataset-import.ts,
 * commit 40ea4a0) so one CSV reads the same in both tools. The parsing and matching code is kept as
 * asd-insight has it; only the type names, the derived-column support (unused here) and the import paths
 * differ.
 */
import type { UiStrings } from '../i18n/strings';
import { CSVColumnCountError, columnCountDiagnostic } from './csvDiagnostics';

export type DataRow = Record<string, string>;
export type Dataset = { name: string; columns: string[]; rows: DataRow[] };
export type Profile = { column: string; numeric: boolean; values: string[]; validNumbers: number; nonempty: number };

/** asd-insight's limits for one table. */
export const MAX_CSV_BYTES = 20 * 1024 ** 2;
export const MAX_CSV_COLUMNS = 128;
/** The extensions a sample name is tried with, as asd-insight does. */
export const AUDIO_EXTENSIONS = ['.wav', '.flac', '.mp3', '.ogg', '.m4a'] as const;
/** asd-insight initialSetup: the sample name column, else a path-like column, and the audio column. */
const ID_COLUMN = /^(sample_id|sample_name|id|inspection_id|検査id|サンプル名)$/i;
const ID_PATH_COLUMN = /^(audio_file|audio_path|wav_path|file_path|filename|path)$/i;
const AUDIO_COLUMN = /^(audio_file|audio_path|wav_path|file_path|filename|audio|path)$/i;

/** A strict number: optional sign, digits with an optional `.`, an optional exponent. `1,000`, `0x10`, `Inf` are not. */
export function finiteNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
}

function csvDelimiter(text: string): ',' | '\t' {
    let quoted = false;
    let commas = 0;
    let tabs = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') { i++; continue; }
            quoted = !quoted;
        }
        if (quoted) continue;
        if (c === '\n' || c === '\r') {
            // Header detection uses the first nonblank logical record. Leading
            // blank physical lines must not make a TSV look like a one-column CSV.
            if (text.slice(start, i).trim()) break;
            if (c === '\r' && text[i + 1] === '\n') i++;
            start = i + 1;
            commas = 0;
            tabs = 0;
        } else if (c === ',') commas++;
        else if (c === '\t') tabs++;
    }
    return tabs > commas ? '\t' : ',';
}

export function parseCSV(input: string, name = 'data.csv'): Dataset {
    const text = input.replace(/^﻿/, '');
    if (!text.trim()) throw new Error('CSVが空です。ヘッダーとデータ行を用意してください。');
    const delimiter = csvDelimiter(text);
    const columns: string[] = [];
    const rows: DataRow[] = [];
    let hasHeader = false;
    let headerLine = 1;
    let physicalLine = 1;
    let recordStartLine = 1;
    let recordStartIndex = 0;
    let record: string[] = [], field = '', quoted = false, closed = false;
    const addRow = (endIndex: number): void => {
        // Plain empty/whitespace lines are not data records. An explicit quoted
        // empty cell or delimiter-separated row is a record, even if all cells are
        // empty, and must not disappear instead of producing a column diagnostic.
        const blank = hasHeader ? !record.length && !closed && !field.trim() : !text.slice(recordStartIndex, endIndex).trim();
        const cells = [...record, field];
        if (!blank) {
            if (!hasHeader) {
                const headers = cells.map(cell => cell.trim());
                if (headers.length > MAX_CSV_COLUMNS) throw new Error('初版では128列まで読めます。');
                if (headers.some(header => !header)) throw new Error('空の列名があります。各列に名前を付けてください。');
                if (new Set(headers).size !== headers.length) throw new Error('同じ列名が複数あります。列名を一意にしてください。');
                columns.push(...headers);
                hasHeader = true;
                headerLine = recordStartLine;
            } else {
                const dataRow = rows.length + 1;
                if (cells.length !== columns.length) {
                    throw new CSVColumnCountError(columnCountDiagnostic({
                        fileName: name, dataRow, startLine: recordStartLine, endLine: physicalLine, headerLine, delimiter,
                        headers: columns, cells, rawRecord: text.slice(recordStartIndex, endIndex),
                    }));
                }
                rows.push(Object.fromEntries(columns.map((column, index) => [column, cells[index]])));
            }
        }
        record = [];
        field = '';
        closed = false;
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; }
            } else if (c === '\r') {
                field += c;
                if (text[i + 1] === '\n') field += text[++i];
                physicalLine++;
            } else {
                field += c;
                if (c === '\n') physicalLine++;
            }
            continue;
        }
        if (c === delimiter) { record.push(field); field = ''; closed = false; continue; }
        if (c === '\n' || c === '\r') {
            addRow(i);
            if (c === '\r' && text[i + 1] === '\n') i++;
            physicalLine++;
            recordStartLine = physicalLine;
            recordStartIndex = i + 1;
            continue;
        }
        if (closed) {
            if (c === ' ' || c === '\t') continue;
            throw new Error('引用符の後に不正な文字があります。CSVの書式を確認してください。');
        }
        if (c === '"') {
            if (field.length) throw new Error('セル途中の引用符は二重引用符で囲んでください。');
            quoted = true;
            continue;
        }
        field += c;
    }
    if (quoted) throw new Error('閉じられていない引用符があります。CSVの書式を確認してください。');
    if (field.length || record.length || closed) addRow(text.length);
    if (!rows.length) throw new Error('データ行がありません。');
    const result = { name, columns, rows };
    if (!profileColumns(result).some(profile => profile.numeric)) throw new Error('数値として読める列がありません。小数点は「.」で、桁区切りなしで入力してください。');
    return result;
}

/** Each column's values: numeric when at least one of them is a strict number. */
export function profileColumns(data: Dataset): Profile[] {
    return data.columns.map(column => {
        const values = new Set<string>();
        let validNumbers = 0, nonempty = 0;
        for (const row of data.rows) {
            const v = row[column]?.trim() ?? '';
            if (!v) continue;
            nonempty++;
            if (values.size <= 200) values.add(v);
            if (finiteNumber(v) !== null) validNumbers++;
        }
        return { column, numeric: validNumbers > 0, values: [...values], validNumbers, nonempty };
    });
}

/** The sample-name and audio columns, chosen by name as asd-insight's initialSetup does ('' = none). */
export function sourceColumns(columns: readonly string[]): { idColumn: string; audioColumn: string } {
    return {
        idColumn: columns.find(column => ID_COLUMN.test(column)) ?? columns.find(column => ID_PATH_COLUMN.test(column)) ?? '',
        audioColumn: columns.find(column => AUDIO_COLUMN.test(column)) ?? '',
    };
}

export function normalizedAudioPath(value: string): string {
    return value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

export type AudioResolution<T> = {
    file: T | undefined;
    reason: 'matched' | 'ambiguous' | 'name-mismatch' | 'audio-column-empty' | 'source-id-empty' | 'no-files';
    expectedNames: readonly string[];
    candidates?: readonly string[];
    key?: string;
    source: 'audio-column' | 'sample-id';
    sourceColumn?: string;
};

const audioIndexes = new WeakMap<object, Map<string, string[]>>();
function audioBasenames<T>(files: Map<string, T>): Map<string, string[]> {
    let index = audioIndexes.get(files);
    if (!index) {
        index = new Map();
        for (const key of files.keys()) {
            const name = key.split('/').at(-1) ?? key;
            const candidates = index.get(name);
            if (candidates) candidates.push(key); else index.set(name, [key]);
        }
        audioIndexes.set(files, index);
    }
    return index;
}

/**
 * One row's recording, keyed by its path below the opened folder: a value with `/` matches only that exact
 * path; a bare name matches only when one recording has it; without an audio column, the sample name is
 * tried as it is and with each audio extension. Matching is case-sensitive.
 */
export function resolveAudio<T>(row: DataRow, index: number, idColumn: string, audioColumn: string, files: Map<string, T>): AudioResolution<T> {
    const source = audioColumn ? 'audio-column' : 'sample-id';
    const sourceColumn = audioColumn || undefined;
    const rawName = audioColumn ? (row[audioColumn] ?? '') : '';
    const id = audioColumn ? '' : idColumn ? (row[idColumn] ?? '') : 'row-' + (index + 1);
    const expectedNames = audioColumn ? [normalizedAudioPath(rawName)] : [id, ...AUDIO_EXTENSIONS.map(extension => id + extension)];
    const base = { expectedNames, source, sourceColumn } as const;
    if (audioColumn && !expectedNames[0]) return { ...base, file: undefined, reason: 'audio-column-empty' };
    if (!files.size) return { ...base, file: undefined, reason: 'no-files' };
    for (const name of expectedNames) {
        if (name.includes('/')) {
            // A path is explicit. Never guess from its basename when it is missing.
            const file = files.get(name);
            if (file) return { ...base, file, key: name, reason: 'matched' };
            continue;
        }
        const candidates = audioBasenames(files).get(name) ?? [];
        if (candidates.length === 1) {
            const key = candidates[0];
            return { ...base, file: files.get(key), key, reason: 'matched' };
        }
        if (candidates.length > 1) return { ...base, file: undefined, candidates, reason: 'ambiguous' };
    }
    if (!audioColumn && !id) return { ...base, file: undefined, reason: 'source-id-empty' };
    return { ...base, file: undefined, reason: 'name-mismatch' };
}

export const AUDIO_REASON_CANDIDATE_LIMIT = 5;

export function summarizeAudioCandidates(candidates: readonly string[], strings: Pick<UiStrings, 'dsCandidateSeparator' | 'dsCandidatesMore'>, limit = AUDIO_REASON_CANDIDATE_LIMIT): string {
    const visible = candidates.slice(0, limit);
    const omitted = candidates.length - visible.length;
    return visible.join(strings.dsCandidateSeparator) + (omitted ? strings.dsCandidatesMore.replace('{n}', String(omitted)) : '');
}

/** A read-only preview of the complete prospective attachment set. */
export function auditAudioMatches<T>(data: Dataset, idColumn: string, audioColumn: string, files: Map<string, T>) {
    const missing: { row: number; expected: string }[] = [];
    const ambiguous: { row: number; candidates: readonly string[] }[] = [];
    const references = new Map<string, number[]>();
    for (const [index, row] of data.rows.entries()) {
        const result = resolveAudio(row, index, idColumn, audioColumn, files);
        if (result.key) {
            const rows = references.get(result.key);
            if (rows) rows.push(index + 1); else references.set(result.key, [index + 1]);
        } else if (result.reason === 'ambiguous') ambiguous.push({ row: index + 1, candidates: result.candidates ?? [] });
        else missing.push({ row: index + 1, expected: result.expectedNames.join(' / ') });
    }
    return {
        matched: data.rows.length - missing.length - ambiguous.length,
        missing,
        ambiguous,
        unused: [...files.keys()].filter(key => !references.has(key)),
        repeated: [...references].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({ key, rows })),
    };
}
