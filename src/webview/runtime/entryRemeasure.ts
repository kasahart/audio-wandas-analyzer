/**
 * Fixed differences over a region measured again (the entry table's ≠ rows after a computation): each one its own
 * asker on the host, its files' scans kept in the answer store under the difference, its region, the chain asked
 * under and each file's epoch (B1). A difference is found again by its key, never by the row object (another one
 * measured again meanwhile makes new rows, V5), and written only while the chain it was measured under is the one now,
 * under that chain's name (V6), and while every file is of the epoch it was asked under (an answer is of the version it
 * was asked under: otherwise it is void and the difference is asked again).
 */
import type { ComparePublication, CompareScanMessage } from '../../shared/analysis/entryScan';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { recipeKey } from '../../shared/recipe/recipeSteps';
import { answerKey, createAnswerStore, type AnswerKey, type ScanAnswer } from './answerStore';
import { regionAnswers } from './entryBase';
import { derivedKey, type DerivedRow } from './entryTable';
import { HostRequests } from './hostRequests';

export interface RemeasureDeps {
    /** The fixed differences now. */
    derived(): readonly DerivedRow[];
    /** The chain the table scans with now. */
    recipe(): RecipeDocument | undefined;
    /** Each file's epoch on screen (its calibration and version on disk): a scan of an earlier one is no answer now. */
    fileEpoch(path: string): string;
    post(message: CompareScanMessage): void;
    /** A difference's next id on the host: each its own asker (derivedRemeasureId). */
    requestId(row: DerivedRow): string;
    /** A difference measured again from these answers under `recipe`, or null while they do not count every file (compareReport.remeasured). */
    remeasured(row: DerivedRow, compared: ScanAnswer, base: readonly ScanAnswer[], recipe: string): DerivedRow | null;
    /** Keeps the row measured again, judging only it anew (entryRuntime.keepDerived with `only`), and draws. */
    replace(row: DerivedRow, next: DerivedRow): void;
}

export interface Remeasure {
    /** Asks the host for the region's scans of a difference (its compared file and its base). */
    ask(row: DerivedRow): void;
    /** Takes a compare-scan answer of one of these asks; false for anything else. */
    handle(publication: ComparePublication): boolean;
}

export function createRemeasure(deps: RemeasureDeps): Remeasure {
    const scans = createAnswerStore<ScanResult>({ capacity: 512 });
    // A scan is of the file's epoch it was ASKED under (the answer layer's rule): each path's key is made once, in
    // `ask`, and kept with the request. No key is made again when an answer arrives.
    const keyOf = (key: string, region: string, path: string, recipe: string) => answerKey({ ask: ['derived', key], file: path, region, recipe, version: { basis: deps.fileEpoch(path) } });
    // One slot per difference (its key): the slot's current request is its newest ask. A superseded ask is still
    // known (find) and its answers kept under its own keys, so measuring one difference never stops another's.
    const asking = new HostRequests<{ key: string; region: string; recipe: string; paths: Array<{ path: string; key: AnswerKey }> }>();
    const ask = (row: DerivedRow): void => {
        const [start, end] = row.region.split('–').map(Number);
        const recipe = deps.recipe();
        const id = deps.requestId(row);
        const key = derivedKey(row), asked = recipeKey(recipe);
        const paths = [row.parentPath, ...(row.base.paths ?? [])].map(path => ({ path, key: keyOf(key, row.region, path, asked) }));
        for (const path of paths) scans.ask(path.key);
        asking.ask(key, id, key, { key, region: row.region, recipe: asked, paths }, () => deps.post({ type: 'compare-scan', requestId: id, filePaths: paths.map(item => item.path), region: { start, end }, ...(recipe ? { recipe } : {}) }));
    };
    return {
        ask,
        handle(publication) {
            const pending = asking.find(publication.requestId)?.meta;
            if (!pending) return false;
            if (publication.type === 'compare-scan-result') {
                const asked = pending.paths.find(item => item.path === publication.filePath);
                if (asked) scans.ready(asked.key, publication.result);
                return true;
            }
            // Whether this is the difference's newest ask: a void answer asks again only when no newer one is on its way.
            const latest = asking.answering(pending.key, publication.requestId) !== undefined;
            asking.settle(publication.requestId);
            const row = deps.derived().find(item => derivedKey(item) === pending.key);
            // Measured under another chain than the one now: not a Δ of it; the row stays ≠ until the next computation.
            if (!row || !row.stale || pending.recipe !== recipeKey(deps.recipe())) return true;
            // A file's calibration or version changed after the ask: the whole remeasurement is of an earlier epoch, so
            // the row stays ≠ and is asked again under the epoch now, unless a newer ask is already on its way. Each ask
            // takes the epoch then, so this asks again only as often as an epoch changes under it: it cannot loop.
            if (row.region !== pending.region || pending.paths.some(item => item.key.id !== keyOf(pending.key, row.region, item.path, pending.recipe).id)) {
                if (latest) ask(row);
                return true;
            }
            const now = new Map(pending.paths.flatMap(({ path, key }) => {
                const value = scans.value(key);
                return value ? [[path, value] as [string, ScanResult]] : [];
            }));
            const [compared, ...base] = regionAnswers(now).answers([row.parentPath, ...(row.base.paths ?? [])]);
            const next = compared ? deps.remeasured(row, compared, base, pending.recipe) : null;
            if (next) deps.replace(row, next);
            return true;
        },
    };
}
