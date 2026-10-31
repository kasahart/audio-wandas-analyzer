/**
 * The folder's session, kept by the host (its workspace storage, IndexedDB on the Web): what the user chose on the
 * entry table, saved a moment after each change once the stored one has come back at open (so the defaults of a
 * fresh open never overwrite it), and read back with anything that no longer fits the folder's files left out.
 */
import { fileOfKey, type DatasetFilter, type GroupId, type ValueId } from '../../shared/dataset/datasetTable';
import { isRecipeChain } from '../../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import type { DerivedRow } from './entryTable';
import type { DatasetScreenView } from './entryTableHtml';
import { restoredSlots, type Slots } from './entrySlots';

export const SESSION_VERSION = 1;

/** A stored session's parts that still fit the folder; a part not stored (or unreadable) is absent. */
export interface StoredSession {
    value?: ValueId;
    group?: GroupId;
    filters?: DatasetFilter[];
    sort?: DatasetScreenView['sort'];
    baseGroup: string | null;
    slots?: Slots;
    memo: Array<[string, string]>;
    excluded: string[];
    derived?: DerivedRow[];
    recipe?: RecipeDocument;
}

const SORT_COLUMNS: ReadonlyArray<DatasetScreenView['sort']['column']> = ['name', 'ch', 'group', 'value'];

const isFilter = (filter: DatasetFilter | null | undefined): filter is DatasetFilter => !!filter && typeof filter.column === 'string'
    && (filter.kind === 'values' ? Array.isArray(filter.values) : filter.kind === 'range' && typeof filter.low === 'number' && typeof filter.high === 'number');

/** A session as it came back from the host, of the folder's `files`; null when there is none of this version. */
export function readStoredSession(session: Record<string, unknown> | undefined, files: ReadonlySet<string>): StoredSession | null {
    if (!session || session['version'] !== SESSION_VERSION) return null;
    const keyOk = (key: unknown): key is string => typeof key === 'string' && files.has(fileOfKey(key));
    const stored: StoredSession = { baseGroup: typeof session['baseGroup'] === 'string' ? session['baseGroup'] : null, memo: [], excluded: [] };
    if (typeof session['value'] === 'string') stored.value = session['value'] as ValueId;
    if (typeof session['group'] === 'string') stored.group = session['group'] as GroupId;
    if (Array.isArray(session['filters'])) stored.filters = (session['filters'] as Array<DatasetFilter | null | undefined>).filter(isFilter);
    const sort = session['sort'] as DatasetScreenView['sort'] | undefined;
    if (sort && SORT_COLUMNS.includes(sort.column)) stored.sort = { column: sort.column, descending: !!sort.descending };
    if (Array.isArray(session['slots'])) stored.slots = restoredSlots(session['slots'], path => files.has(path));
    if (Array.isArray(session['memo'])) for (const item of session['memo'] as unknown[]) if (Array.isArray(item) && keyOk(item[0]) && typeof item[1] === 'string') stored.memo.push([item[0], item[1]]);
    if (Array.isArray(session['excluded'])) for (const key of session['excluded'] as unknown[]) if (keyOk(key)) stored.excluded.push(key);
    if (Array.isArray(session['derived'])) stored.derived = (session['derived'] as Array<DerivedRow | null | undefined>).filter((row): row is DerivedRow => !!row && files.has(row.parentPath) && !!row.result && !!row.base);
    if (isRecipeChain(session['recipe'])) stored.recipe = session['recipe'];
    return stored;
}

export interface SessionSaver {
    /** The stored session has come back and the table settled on it: from now on a change is saved. */
    readonly loaded: boolean;
    /** Another folder: nothing is saved until its stored session is back. */
    reset(): void;
    /** What the table shows now is what is stored. */
    markLoaded(): void;
    /** The CSV to save with the next session (null: forget the stored one; undefined: unchanged). */
    keepCsv(csv: { name: string; text: string } | null | undefined): void;
    /** Saves a moment after the last change, when anything changed since the last save. */
    schedule(): void;
}

export function createSessionSaver(
    timers: Pick<Window, 'setTimeout' | 'clearTimeout'>, delayMs: number, snapshot: () => Record<string, unknown>,
    save: (session: Record<string, unknown>, csv: { name: string; text: string } | null | undefined) => void,
): SessionSaver {
    let loaded = false;
    let timer: number | undefined;
    let saved = '';
    let csvToSave: { name: string; text: string } | null | undefined;
    return {
        get loaded() { return loaded; },
        reset() {
            loaded = false; saved = ''; csvToSave = undefined;
            if (timer !== undefined) { timers.clearTimeout(timer); timer = undefined; }
        },
        markLoaded() {
            saved = JSON.stringify(snapshot());
            loaded = true;
        },
        keepCsv(csv) { csvToSave = csv; },
        schedule() {
            if (!loaded || timer !== undefined) return;
            timer = timers.setTimeout(() => {
                timer = undefined;
                const session = snapshot();
                const text = JSON.stringify(session);
                if (text === saved && csvToSave === undefined) return;
                saved = text;
                save(session, csvToSave);
                csvToSave = undefined;
            }, delayMs);
        },
    };
}
