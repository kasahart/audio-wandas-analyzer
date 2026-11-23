import type { FigureCommand, FigureRequestMessage, FigureResultMessage } from '../protocol/figureMessages';
import { type BackendPayload, type BackendResult, type ScanResult } from '../protocol/backendProtocol';
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

/** Webview → host: the folder was opened. The host answers with its Recipe and the folder's stored session (`entry-conditions`); nothing of a file is read. */
export interface EntryOpenMessage {
    type: 'entry-open';
    requestId: string;
    /** The opened folder, which its session is stored under. */
    rootPath?: string;
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
    | { type: 'entry-probe-result'; requestId: string; filePath: string; channels?: number; durationS?: number; sampleRate?: number; calibrated?: boolean; unknown?: true; error?: string }
    | { type: 'entry-probe-done'; requestId: string };

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
    /**
     * The step of the Recipe (node id) each result describes as `stage` (stage_view.py `describe`): what the step's
     * result is, its events and the key of its kept answer, with no drawn point. Figures are the figure service's.
     */
    stage: string;
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
    /** A file's calibration changed (its canonical path): what was drawn of it is of the old calibration. */
    | { type: 'entry-calibration-changed'; filePath: string; calibrated?: boolean }
    /** A file was written on disk (recorded again, replaced) while the panel names it: its header and pictures are of the old version. */
    | { type: 'entry-source-changed'; filePath: string };

export const ENTRY_SESSION_KEY = 'awa.session.v1';
export const ENTRY_SESSION_CSV_KEY = 'awa.sessionCsv.v1';
/** A folder's own key: one index and one session per opened folder, so a folder of 100,000 files does not rewrite another's. */
export const folderKey = (key: string, rootPath: string): string => `${key}:${rootPath}`;

/**
 * The asker a compare-scan request is of: its id up to the last '-' (the request's count after it). A newer request of
 * the same asker stops an older one on the host; askers that must not stop each other (each fixed difference measured
 * again) name themselves apart. compareScanId and compareScanAsker are the one place the two sides agree on it.
 */
export const compareScanAsker = (requestId: string): string => requestId.replace(/-[^-]*$/, '');
/** Host-specific halves of the entry and the comparison's scans: how a file's header is read, a file scanned, a session stored. */
export interface EntryScanPorts {
    /** Whether the file has a calibration now (its levels are in a physical unit); absent where the host has no calibration: every file is uncalibrated there. */
    calibrated?(filePath: string): boolean;
    scan(filePath: string, stage: string, region?: EntryRegion, recipe?: RecipeDocument, reference?: ScanReference): Promise<ScanResult>;
    /**
     * One request of the figure service (figure-draw / read / export / release / count), handed to the backend as it is,
     * under the webview's request id (by which a superseded draw is cancelled: cancelFigure).
     */
    figure?<K extends FigureCommand>(command: K, payload: BackendPayload<K>, requestId: string): Promise<BackendResult<K>>;
    /** Stops these figure requests if they still run (a superseded draw); the backend's own request table holds them. */
    cancelFigure?(requestIds: readonly string[]): void;
    /** The entry Recipe the host scans with by default, shown in the step bar. */
    recipe?(): Promise<RecipeDocument>;
    /** The bytes of a listed file, for reading the CSV/TSV files among them as metadata tables. */
    readFile?(filePath: string): Promise<Uint8Array>;
    /** A file's first `length` bytes, for its header. */
    readHead?: (filePath: string, length: number) => Promise<Uint8Array>;
    /** Stored values: the folder's session and CSV (large) may come from a file or IndexedDB, so a read may wait. */
    read(key: string): unknown;
    write(key: string, value: unknown): void | PromiseLike<void>;
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

/** The folder's stored session and CSV, as the webview saved them. */
async function readSession(ports: Pick<EntryScanPorts, 'read'>, rootPath: string): Promise<{ session?: Record<string, unknown>; csv?: { name: string; text: string } }> {
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

/** Publishes the host's Recipe and the folder's stored session (what the user chose, the CSV picked): the answer to `entry-open`. */
export async function runEntryOpen(
    ports: Pick<EntryScanPorts, 'recipe' | 'read'>,
    message: EntryOpenMessage,
    publish: (message: EntryPublication) => void | PromiseLike<unknown>,
): Promise<void> {
    let standard: RecipeDocument | undefined;
    try { standard = await ports.recipe?.(); } catch { /* The step bar then shows no chips; the comparison still runs the host's Recipe. */ }
    const stored = await readSession(ports, message.rootPath ?? '');
    await publish({ type: 'entry-conditions', requestId: message.requestId, table: null, ...(standard ? { recipe: standard } : {}), ...stored });
}

export async function runEntryProbe(
    ports: EntryScanPorts,
    message: EntryProbeMessage,
    publish: (message: EntryProbePublication) => void | PromiseLike<unknown>,
    isCurrent: () => boolean,
): Promise<void> {
    const readFile = ports.readFile?.bind(ports);
    const read = ports.readHead ?? (readFile ? (filePath: string) => readFile(filePath) : undefined);
    for (const filePath of message.filePaths) {
        if (!isCurrent()) return;
        let probe: ChannelProbe;
        try { probe = read ? channelsFromHeader(await read(filePath, AUDIO_HEAD_BYTES), filePath) : { unknown: true }; } catch (error) { probe = { error: reason(error) }; }
        if (!isCurrent()) return;
        await publish({ type: 'entry-probe-result', requestId: message.requestId, filePath, ...probe, calibrated: ports.calibrated?.(filePath) ?? false });
    }
    await publish({ type: 'entry-probe-done', requestId: message.requestId });
}

/** Scans the comparison's files over its region, one at a time. The values a scan keeps stay in the backend that ran it (the figure service draws from them). */
export async function runCompareScan(
    ports: EntryScanPorts,
    message: CompareScanMessage,
    publish: (message: ComparePublication) => void | PromiseLike<unknown>,
    isCurrent: () => boolean,
): Promise<void> {
    for (const filePath of message.filePaths) {
        if (!isCurrent()) return;
        let result: ScanResult;
        try {
            result = await ports.scan(filePath, message.stage, message.region, message.recipe, message.reference);
        } catch (error) {
            result = { ok: false, reason: reason(error) };
        }
        if (!isCurrent()) return;
        await publish({ type: 'compare-scan-result', requestId: message.requestId, filePath, result });
    }
    await publish({ type: 'compare-scan-done', requestId: message.requestId });
}

/**
 * Answers a 'figure-request': the figure service's answer as it is, or that it failed. The host decides nothing of it
 * (figure-design.md 第 6 節): which reply is current is the webview's answers/ to say.
 */
export async function runFigureRequest(
    ports: EntryScanPorts,
    message: FigureRequestMessage,
    publish: (message: FigureResultMessage) => void | PromiseLike<unknown>,
): Promise<void> {
    const { requestId, command, payload } = message;
    if (!ports.figure) { await publish({ type: 'figure-result', requestId, command, failed: 'no figure service' }); return; }
    let reply: FigureResultMessage;
    try {
        reply = { type: 'figure-result', requestId, command, result: await ports.figure(command, payload, requestId) };
    } catch (error) {
        reply = { type: 'figure-result', requestId, command, failed: reason(error) };
    }
    await publish(reply);
}

export function isEntryRegion(value: unknown): value is EntryRegion {
    return isRecord(value) && typeof value['start'] === 'number' && typeof value['end'] === 'number'
        && Number.isFinite(value['start']) && Number.isFinite(value['end']) && value['start'] >= 0 && value['end'] > value['start'];
}
