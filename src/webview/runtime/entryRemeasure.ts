/**
 * Fixed differences over a region measured again (the entry table's ≠ rows after a computation): each one its own
 * asker on the host, its files' scans kept in the answer store under the difference, its region, the chain asked
 * under and each file's epoch (B1). A difference is found again by its key, never by the row object (another one
 * measured again meanwhile makes new rows, V5), and written only while the chain it was measured under is the one now,
 * under that chain's name (V6).
 */
import type { ComparePublication, CompareScanMessage } from '../../shared/analysis/entryScan';
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { recipeKey } from '../../shared/recipe/recipeSteps';
import { answerKey, createAnswerStore, type ScanAnswer } from './answerStore';
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
    const keyOf = (key: string, region: string, path: string, recipe: string) => answerKey({ ask: ['derived', key], file: path, region, recipe, version: { basis: deps.fileEpoch(path) } });
    const asking = new HostRequests<{ key: string; recipe: string; paths: string[] }>();
    return {
        ask(row) {
            const [start, end] = row.region.split('–').map(Number);
            const recipe = deps.recipe();
            const id = deps.requestId(row);
            const key = derivedKey(row), asked = recipeKey(recipe), paths = [row.parentPath, ...(row.base.paths ?? [])];
            for (const path of paths) scans.ask(keyOf(key, row.region, path, asked));
            asking.ask(id, id, key, { key, recipe: asked, paths }, () => deps.post({ type: 'compare-scan', requestId: id, filePaths: paths, region: { start, end }, ...(recipe ? { recipe } : {}) }));
        },
        handle(publication) {
            const pending = asking.find(publication.requestId)?.meta;
            if (!pending) return false;
            const row = deps.derived().find(item => derivedKey(item) === pending.key);
            if (publication.type === 'compare-scan-result') {
                if (row && pending.paths.includes(publication.filePath)) scans.ready(keyOf(pending.key, row.region, publication.filePath, pending.recipe), publication.result);
                return true;
            }
            asking.settle(publication.requestId);
            // Measured under another chain than the one now: not a Δ of it; the row stays ≠ until the next computation.
            if (!row || !row.stale || pending.recipe !== recipeKey(deps.recipe())) return true;
            const now = new Map(pending.paths.flatMap(path => {
                const value = scans.value(keyOf(pending.key, row.region, path, pending.recipe));
                return value ? [[path, value] as [string, ScanResult]] : [];
            }));
            const [compared, ...base] = regionAnswers(now).answers([row.parentPath, ...(row.base.paths ?? [])]);
            const next = compared ? deps.remeasured(row, compared, base, pending.recipe) : null;
            if (next) deps.replace(row, next);
            return true;
        },
    };
}
