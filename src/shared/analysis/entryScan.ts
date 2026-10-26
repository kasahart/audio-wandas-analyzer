import { parseBackendResult, type ScanResult, type StageDetail } from '../protocol/backendProtocol';
import { isMetadataCandidate, pickMetadataTable, type MetadataAudit, type MetadataCandidate } from './entryMetadata';
import { recipeKey } from '../recipe/recipeSteps';
import type { RecipeDocument } from '../recipe/recipeSelection';

/**
 * A condition table pasted from a spreadsheet: one row per file, keyed by the file name without its
 * extension in lower case, with one value per column. `checked` lists the columns whose values must
 * all match for two rows to share a condition.
 */
export interface EntryConditionTable {
    columns: string[];
    checked: number[];
    /** One row per recording, keyed by the listed file path it was attached to. */
    rows: Record<string, string[]>;
    /** The recordings in the table's own row order. */
    order?: string[];
    /** How the table's rows met the recordings. */
    audit?: MetadataAudit;
    /** Columns whose values all read as numbers. */
    numeric?: boolean[];
    /** The metadata file's name, when the table came from one rather than a paste. */
    source?: string;
}

/** Webview → host: scan these files with the entry Recipe, in this order. */
export interface EntryScanMessage {
    type: 'entry-scan';
    requestId: string;
    filePaths: string[];
    /** The opened folder, below which metadata tables name recordings by relative path. */
    rootPath?: string;
    /** The Recipe edited in the step bar; without it the host scans with the entry Recipe. */
    recipe?: RecipeDocument;
}

/** Webview → host: stop the running entry scan after its current file; what it scanned stays. */
export interface EntryScanCancelMessage {
    type: 'entry-scan-cancel';
}

/** Webview → host: keep this condition table for the next session (null forgets it). */
/** Seconds into each file; the comparison scans its files over a region of its own. */
export interface EntryRegion {
    start: number;
    end: number;
}

/** Webview → host: scan these files over `region` (the whole file without one) for the comparison (nothing is stored). */
export interface CompareScanMessage {
    type: 'compare-scan';
    requestId: string;
    filePaths: string[];
    region?: EntryRegion;
    recipe?: RecipeDocument;
    /** A step of the Recipe (node id) whose Frame each result carries as `stage`. */
    stage?: string;
    /** Only the part of that Frame's picture on screen (a zoomed comparison), at its full resolution. */
    detail?: StageDetail;
}

/** Webview → host: the comparison's report, written as one folder of these files. */
export interface SaveReportFolderMessage {
    type: 'save-report-folder';
    folder: string;
    files: Array<{ name: string; base64?: string; text?: string }>;
}

export interface EntrySaveConditionsMessage {
    type: 'entry-save-conditions';
    table: EntryConditionTable | null;
}

export type ComparePublication =
    | { type: 'compare-scan-result'; requestId: string; filePath: string; result: ScanResult }
    | { type: 'compare-scan-done'; requestId: string };

export type EntryPublication =
    /** `metadataPath` is the listed file read as the metadata table; it is not scanned and gets no row. */
    | { type: 'entry-conditions'; requestId: string; table: EntryConditionTable | null; metadataPath?: string; recipe?: RecipeDocument }
    | { type: 'entry-scan-result'; requestId: string; filePath: string; result: ScanResult }
    | { type: 'entry-scan-done'; requestId: string };

/** Storage keys; a new layout gets a new suffix and the old key is simply never read again. */
export const ENTRY_SCAN_INDEX_KEY = 'awa.scanIndex.v1';
export const ENTRY_CONDITIONS_KEY = 'awa.conditions.v1';
/** Results are written in batches of this many, so a 100-file scan stores a few times rather than 100. */
const INDEX_WRITE_EVERY = 10;

interface ScanIndexEntry {
    /** The host's identity for the file when it was scanned: path, size and mtime, or a content hash. */
    identity: string;
    /** The calibration the scan used, so a changed profile scans again. */
    calibration: string;
    /** The Recipe the result was scanned with (recipeKey). */
    recipe?: string;
    result: ScanResult;
}
type ScanIndex = Record<string, ScanIndexEntry>;

/** Host-specific halves of the entry scan: how a file is identified, scanned and stored. */
export interface EntryScanPorts {
    /** A string that changes whenever the file's content may have; undefined never reuses a stored result. */
    identity(filePath: string): Promise<string | undefined>;
    calibration?(filePath: string): string;
    scan(filePath: string, region?: EntryRegion, recipe?: RecipeDocument, stage?: string, detail?: StageDetail): Promise<ScanResult>;
    /** The entry Recipe the host scans with by default, shown in the step bar. */
    recipe?(): Promise<RecipeDocument>;
    /** The bytes of a listed file, for reading the CSV/TSV files among them as metadata tables. */
    readFile?(filePath: string): Promise<Uint8Array>;
    /** Metadata tables beside the listed files that are not listed themselves, e.g. in the folder above. */
    metadataCandidates?(filePaths: readonly string[]): Promise<MetadataCandidate[]>;
    read(key: string): unknown;
    write(key: string, value: unknown): void | PromiseLike<void>;
    /** Runs once after the last file with how many were scanned, e.g. to give the browser's Worker its memory back. */
    afterScan?(scanned: number): void | PromiseLike<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

export function isEntryConditionTable(value: unknown): value is EntryConditionTable {
    if (!isRecord(value) || !isStrings(value['columns']) || !isRecord(value['rows'])) return false;
    const columns = value['columns'].length;
    const checked = value['checked'];
    return Array.isArray(checked) && checked.every(index => Number.isInteger(index) && index >= 0 && index < columns)
        && Object.values(value['rows']).every(row => isStrings(row) && row.length === columns)
        && (value['order'] === undefined || isStrings(value['order']))
        && (value['numeric'] === undefined || (Array.isArray(value['numeric']) && value['numeric'].every(item => typeof item === 'boolean')))
        && (value['source'] === undefined || typeof value['source'] === 'string')
        && (value['audit'] === undefined || (isRecord(value['audit'])
            && ['matched', 'recordings', 'missing', 'ambiguous', 'repeated'].every(key => Number.isInteger((value['audit'] as Record<string, unknown>)[key]))));
}

function isScanResult(value: unknown): value is ScanResult {
    try { parseBackendResult('scan', value); return true; } catch { return false; }
}

function readIndex(ports: EntryScanPorts): ScanIndex {
    const stored = ports.read(ENTRY_SCAN_INDEX_KEY);
    if (!isRecord(stored)) return {};
    const index: ScanIndex = {};
    for (const [filePath, entry] of Object.entries(stored)) {
        if (isRecord(entry) && typeof entry['identity'] === 'string' && typeof entry['calibration'] === 'string'
            && isScanResult(entry['result']) && entry['result'].ok) {
            index[filePath] = entry as unknown as ScanIndexEntry;
        }
    }
    return index;
}

export function readConditionTable(ports: Pick<EntryScanPorts, 'read'>): EntryConditionTable | null {
    const stored = ports.read(ENTRY_CONDITIONS_KEY);
    return isEntryConditionTable(stored) ? stored : null;
}

/** The listed CSV/TSV files and the host's extra candidates, matched against the other listed files. */
async function findMetadata(ports: EntryScanPorts, filePaths: readonly string[], rootPath: string) {
    const listed = ports.readFile ? filePaths.filter(isMetadataCandidate) : [];
    const recordings = filePaths.filter(filePath => !isMetadataCandidate(filePath));
    let extra: MetadataCandidate[] = [];
    try { extra = await ports.metadataCandidates?.(filePaths) ?? []; } catch { /* An unreadable folder only means no extra candidates. */ }
    const candidates: MetadataCandidate[] = [...listed.map(path => ({ path, read: () => ports.readFile!(path) })), ...extra];
    const picked = await pickMetadataTable(candidates, recordings, rootPath);
    return picked && { ...picked, listed: listed.includes(picked.path) };
}

function reason(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.split('\n')[0] || 'Scan failed';
}

/**
 * Publishes the stored condition table, then one result per file in order: the stored one when the
 * file and its calibration are unchanged, otherwise a fresh scan. The stored index keeps only the
 * files of this scan, so it stays the size of one folder. Failures are results too (`ok: false`),
 * never kept, so the next scan tries the file again.
 */
export async function runEntryScan(
    ports: EntryScanPorts,
    message: EntryScanMessage,
    publish: (message: EntryPublication) => void | PromiseLike<unknown>,
    isCurrent: () => boolean,
): Promise<void> {
    const { requestId } = message;
    const metadata = await findMetadata(ports, message.filePaths, message.rootPath ?? '');
    const stored = readConditionTable(ports);
    // A metadata file keeps the condition columns the user last checked for it.
    const table = metadata
        ? (stored && stored.source === metadata.table.source && JSON.stringify(stored.columns) === JSON.stringify(metadata.table.columns)
            ? { ...metadata.table, checked: stored.checked } : metadata.table)
        : stored;
    let standard: RecipeDocument | undefined;
    try { standard = await ports.recipe?.(); } catch { /* The step bar then shows no chips; scans still use the host's Recipe. */ }
    const used = recipeKey(message.recipe ?? standard);
    await publish({ type: 'entry-conditions', requestId, table, ...(metadata?.listed ? { metadataPath: metadata.path } : {}), ...(standard ? { recipe: standard } : {}) });
    const filePaths = metadata?.listed ? message.filePaths.filter(filePath => filePath !== metadata.path) : message.filePaths;
    const index = readIndex(ports);
    const kept: ScanIndex = {};
    let unsaved = 0;
    let scanned = 0;
    let completed = false;
    const save = async (): Promise<void> => { unsaved = 0; await ports.write(ENTRY_SCAN_INDEX_KEY, kept); };
    try {
        for (const filePath of filePaths) {
            if (!isCurrent()) return;
            let result: ScanResult;
            try {
                const identity = await ports.identity(filePath);
                const calibration = ports.calibration?.(filePath) ?? '';
                const previous = index[filePath];
                if (identity !== undefined && previous && previous.identity === identity && previous.calibration === calibration && previous.recipe === used) {
                    result = previous.result;
                    kept[filePath] = previous;
                } else {
                    scanned++;
                    result = await ports.scan(filePath, undefined, message.recipe);
                    if (result.ok && identity !== undefined) {
                        kept[filePath] = { identity, calibration, recipe: used, result };
                        if (++unsaved >= INDEX_WRITE_EVERY) await save();
                    }
                }
            } catch (error) {
                result = { ok: false, reason: reason(error) };
            }
            if (!isCurrent()) return;
            await publish({ type: 'entry-scan-result', requestId, filePath, result });
        }
        await save();
        completed = true;
    } finally {
        await ports.afterScan?.(scanned);
    }
    // Done only once the host has settled after the scan (a Web Worker restart), so whatever the table
    // asks for next (a fixed Δ measured again) is not cut short by it.
    if (completed) await publish({ type: 'entry-scan-done', requestId });
}

/** Scans the comparison's files over its region, one at a time, without touching the stored index. */
export async function runCompareScan(
    ports: EntryScanPorts,
    message: CompareScanMessage,
    publish: (message: ComparePublication) => void | PromiseLike<unknown>,
    isCurrent: () => boolean,
): Promise<void> {
    let scanned = 0;
    try {
        for (const filePath of message.filePaths) {
            if (!isCurrent()) return;
            let result: ScanResult;
            try {
                scanned++;
                result = await ports.scan(filePath, message.region, message.recipe, message.stage, message.detail);
            } catch (error) {
                result = { ok: false, reason: reason(error) };
            }
            if (!isCurrent()) return;
            await publish({ type: 'compare-scan-result', requestId: message.requestId, filePath, result });
        }
        await publish({ type: 'compare-scan-done', requestId: message.requestId });
    } finally {
        await ports.afterScan?.(scanned);
    }
}

export function isEntryRegion(value: unknown): value is EntryRegion {
    return isRecord(value) && typeof value['start'] === 'number' && typeof value['end'] === 'number'
        && Number.isFinite(value['start']) && Number.isFinite(value['end']) && value['start'] >= 0 && value['end'] > value['start'];
}
