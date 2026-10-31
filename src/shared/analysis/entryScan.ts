import { parseBackendResult, type ScanResult, type StageDetail } from '../protocol/backendProtocol';
import { isMetadataCandidate } from './entryMetadata';
import { recipeKey } from '../recipe/recipeSteps';
import { AUDIO_HEAD_BYTES, channelsFromHeader, type ChannelProbe } from './audioHeader';
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
    /**
     * Only what is stored for these files (same file, calibration and Recipe) comes back: opening a folder
     * computes nothing until the user asks (「計算」).
     */
    cachedOnly?: boolean;
}

/** Webview → host: read each file's channel count from its header (no audio decoded), for the rows by channel. */
export interface EntryProbeMessage {
    type: 'entry-probe';
    requestId: string;
    filePaths: string[];
}

/** Webview → host: stop reading headers after the current file. */
export interface EntryProbeCancelMessage {
    type: 'entry-probe-cancel';
}

/** Host → webview: one file's header: its channels, unknown (a format read only by its decoder), or why it could not be read. */
export type EntryProbePublication =
    | { type: 'entry-probe-result'; requestId: string; filePath: string; channels?: number; durationS?: number; unknown?: true; error?: string }
    | { type: 'entry-probe-done'; requestId: string };

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
    /** The recording a cross-channel step (`step`) pairs each scanned one with (the base slot's), and its own Recipe. */
    reference?: ScanReference;
}

export interface ScanReference {
    filePath: string;
    step: string;
    recipe: RecipeDocument;
}

/** Webview → host: the comparison's report, written as one folder of these files. */
export interface SaveReportFolderMessage {
    type: 'save-report-folder';
    folder: string;
    files: Array<{ name: string; base64?: string; text?: string }>;
}

/**
 * Webview → host: the entry table's session for the opened folder (what the user chose: the value, the
 * grouping, the filters, the base, the slots, memos, exclusions, fixed differences), and the CSV picked when it
 * changed (null: none; omitted: as stored). The host keeps them in its own storage, never in the user's folder.
 */
export interface EntrySaveSessionMessage {
    type: 'entry-save-session';
    rootPath: string;
    session: Record<string, unknown>;
    csv?: { name: string; text: string } | null;
}

export type ComparePublication =
    | { type: 'compare-scan-result'; requestId: string; filePath: string; result: ScanResult }
    | { type: 'compare-scan-done'; requestId: string };

export type EntryPublication =
    /** `metadataPath` is the listed file read as the metadata table; it is not scanned and gets no row. */
    | { type: 'entry-conditions'; requestId: string; table: EntryConditionTable | null; metadataPath?: string; recipe?: RecipeDocument;
        /** The folder's stored session and CSV, at open. */
        session?: Record<string, unknown>; csv?: { name: string; text: string } }
    | { type: 'entry-scan-result'; requestId: string; filePath: string; result: ScanResult }
    | { type: 'entry-scan-done'; requestId: string };

/** Storage keys; a new layout gets a new suffix and the old key is simply never read again. */
export const ENTRY_SCAN_INDEX_KEY = 'awa.scanIndex.v2';
export const ENTRY_CONDITIONS_KEY = 'awa.conditions.v1';
export const ENTRY_SESSION_KEY = 'awa.session.v1';
export const ENTRY_SESSION_CSV_KEY = 'awa.sessionCsv.v1';
/** A folder's own key: one index and one session per opened folder, so a folder of 100,000 files does not rewrite another's. */
export const folderKey = (key: string, rootPath: string): string => `${key}:${rootPath}`;
/** Results kept per file: one per Recipe (a channel is one of the result's arrays), the most recent first. */
const RECIPES_PER_FILE = 4;
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
type ScanIndex = Record<string, ScanIndexEntry[]>;

/** Host-specific halves of the entry scan: how a file is identified, scanned and stored. */
export interface EntryScanPorts {
    /** A string that changes whenever the file's content may have; undefined never reuses a stored result. */
    identity(filePath: string): Promise<string | undefined>;
    calibration?(filePath: string): string;
    scan(filePath: string, region?: EntryRegion, recipe?: RecipeDocument, stage?: string, detail?: StageDetail, reference?: ScanReference): Promise<ScanResult>;
    /** The entry Recipe the host scans with by default, shown in the step bar. */
    recipe?(): Promise<RecipeDocument>;
    /** The bytes of a listed file, for reading the CSV/TSV files among them as metadata tables. */
    readFile?(filePath: string): Promise<Uint8Array>;
    /** A file's first `length` bytes, for its header. */
    readHead?: (filePath: string, length: number) => Promise<Uint8Array>;
    /** Stored values: the folder's index and session (large) may come from a file or IndexedDB, so a read may wait. */
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
        && (value['source'] === undefined || typeof value['source'] === 'string');
}

function isScanResult(value: unknown): value is ScanResult {
    try { parseBackendResult('scan', value); return true; } catch { return false; }
}

async function readIndex(ports: EntryScanPorts, rootPath: string): Promise<ScanIndex> {
    const stored = await ports.read(folderKey(ENTRY_SCAN_INDEX_KEY, rootPath));
    if (!isRecord(stored)) return {};
    const index: ScanIndex = {};
    for (const [filePath, entries] of Object.entries(stored)) {
        if (!Array.isArray(entries)) continue;
        const valid = entries.filter((entry): entry is ScanIndexEntry => isRecord(entry) && typeof entry['identity'] === 'string' && typeof entry['calibration'] === 'string'
            && isScanResult(entry['result']) && entry['result'].ok);
        if (valid.length) index[filePath] = valid;
    }
    return index;
}

/** The folder's stored session and CSV, as the webview saved them. */
async function readSession(ports: EntryScanPorts, rootPath: string): Promise<{ session?: Record<string, unknown>; csv?: { name: string; text: string } }> {
    const session = await ports.read(folderKey(ENTRY_SESSION_KEY, rootPath));
    const csv = await ports.read(folderKey(ENTRY_SESSION_CSV_KEY, rootPath));
    return {
        ...(isRecord(session) ? { session } : {}),
        ...(isRecord(csv) && typeof csv['name'] === 'string' && typeof csv['text'] === 'string' ? { csv: { name: csv['name'], text: csv['text'] } } : {}),
    };
}

export async function saveSession(ports: Pick<EntryScanPorts, 'write'>, message: EntrySaveSessionMessage): Promise<void> {
    await ports.write(folderKey(ENTRY_SESSION_KEY, message.rootPath), message.session);
    if (message.csv !== undefined) await ports.write(folderKey(ENTRY_SESSION_CSV_KEY, message.rootPath), message.csv);
}

function reason(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.split('\n')[0] || 'Scan failed';
}

/**
 * Publishes the entry Recipe, then one result per file in order: the stored one when the file and its
 * calibration are unchanged, otherwise a fresh scan (none with `cachedOnly`). The attribute CSV is the
 * user's pick, read by the webview; the host no longer looks for one. The stored index keeps the files of
 * this scan and, with `cachedOnly`, the rest it had, so it stays the size of one folder. Failures are
 * results too (`ok: false`), never kept, so the next scan tries the file again.
 */
export async function runEntryScan(
    ports: EntryScanPorts,
    message: EntryScanMessage,
    publish: (message: EntryPublication) => void | PromiseLike<unknown>,
    isCurrent: () => boolean,
): Promise<void> {
    const { requestId } = message;
    let standard: RecipeDocument | undefined;
    try { standard = await ports.recipe?.(); } catch { /* The step bar then shows no chips; scans still use the host's Recipe. */ }
    const used = recipeKey(message.recipe ?? standard);
    // At open (stored results only) the folder's session comes back with them: what the user chose, the CSV picked.
    const stored = message.cachedOnly ? await readSession(ports, message.rootPath ?? '') : {};
    await publish({ type: 'entry-conditions', requestId, table: null, ...(standard ? { recipe: standard } : {}), ...stored });
    const filePaths = message.filePaths.filter(filePath => !isMetadataCandidate(filePath));
    const indexKey = folderKey(ENTRY_SCAN_INDEX_KEY, message.rootPath ?? '');
    const index = await readIndex(ports, message.rootPath ?? '');
    // Every stored result stays: a computation adds this Recipe's for its files, beside the other Recipes' (most recent first).
    const kept: ScanIndex = { ...index };
    let unsaved = 0;
    let scanned = 0;
    let completed = false;
    const save = async (): Promise<void> => { unsaved = 0; await ports.write(indexKey, kept); };
    try {
        for (const filePath of filePaths) {
            if (!isCurrent()) return;
            let result: ScanResult;
            try {
                const identity = await ports.identity(filePath);
                const calibration = ports.calibration?.(filePath) ?? '';
                // The file as it is now (its size and time, or its content), its calibration and this Recipe: else it is not computed.
                const previous = (index[filePath] ?? []).find(entry => entry.identity === identity && entry.calibration === calibration && entry.recipe === used);
                if (identity !== undefined && previous) {
                    result = previous.result;
                } else if (message.cachedOnly) {
                    continue;
                } else {
                    scanned++;
                    result = await ports.scan(filePath, undefined, message.recipe);
                    if (result.ok && identity !== undefined) {
                        const others = (kept[filePath] ?? []).filter(entry => entry.recipe !== used && entry.identity === identity);
                        kept[filePath] = [{ identity, calibration, recipe: used, result }, ...others].slice(0, RECIPES_PER_FILE);
                        if (++unsaved >= INDEX_WRITE_EVERY) await save();
                    }
                }
            } catch (error) {
                result = { ok: false, reason: reason(error) };
            }
            if (!isCurrent()) return;
            await publish({ type: 'entry-scan-result', requestId, filePath, result });
        }
        if (!message.cachedOnly) await save();
        completed = true;
    } finally {
        await ports.afterScan?.(scanned);
    }
    // Done only once the host has settled after the scan (a Web Worker restart), so whatever the table
    // asks for next (a fixed Δ measured again) is not cut short by it.
    if (completed) await publish({ type: 'entry-scan-done', requestId });
}

/** Reads each file's header for its channel count, one file at a time; a file it cannot open is an error, not a stop. */
export async function runEntryProbe(
    ports: EntryScanPorts,
    message: EntryProbeMessage,
    publish: (message: EntryProbePublication) => void | PromiseLike<unknown>,
    isCurrent: () => boolean,
): Promise<void> {
    const read = ports.readHead ?? (ports.readFile ? (filePath: string) => ports.readFile!(filePath) : undefined);
    for (const filePath of message.filePaths) {
        if (!isCurrent()) return;
        let probe: ChannelProbe;
        try { probe = read ? channelsFromHeader(await read(filePath, AUDIO_HEAD_BYTES), filePath) : { unknown: true }; } catch (error) { probe = { error: reason(error) }; }
        if (!isCurrent()) return;
        await publish({ type: 'entry-probe-result', requestId: message.requestId, filePath, ...probe });
    }
    await publish({ type: 'entry-probe-done', requestId: message.requestId });
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
                result = await ports.scan(filePath, message.region, message.recipe, message.stage, message.detail, message.reference);
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
