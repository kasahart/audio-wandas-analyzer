/**
 * Per-step pictures (StageView) of files, as a screen asks the host for them with 'compare-scan': one request in
 * flight per source (a new one supersedes it on the host), results cached per spec (Recipe, region, step,
 * detail) and file. Request ids carry the source's prefix, so each screen takes only its own answers.
 */
import type { ComparePublication, CompareScanMessage } from '../../shared/analysis/entryScan';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import { HostRequests } from './hostRequests';

export interface StageSpec {
    key: string;
    message: Pick<CompareScanMessage, 'region' | 'recipe' | 'stage' | 'detail' | 'reference' | 'spectrumBins'>;
}

export interface StageSource {
    /** Asks for what `spec` lacks of `files` unless it is being scanned; true while any is missing. */
    ensure(spec: StageSpec, files: readonly string[]): boolean;
    /** A file's picture for `spec`: undefined while not in, null when the step could not run on it. */
    view(spec: StageSpec, filePath: string): StageView | null | undefined;
    /** A file's whole scan result for `spec` (its metrics, for a spec without a step). */
    result(spec: StageSpec, filePath: string): ScanResult | undefined;
    /** Drops a file's picture for `spec`, so it is asked for again (its kept values are gone from the backend). */
    forget(spec: StageSpec, filePath: string): void;
    /** Drops every picture whose values the backend kept under one of `keys` and has let go (`missing`). */
    forgetData(keys: readonly string[]): void;
    /** Takes the host's answers to this source's requests; false for anything else. */
    handle(message: { type: string }): boolean;
}

const CACHED_SPECS = 48;

/**
 * What a spec's pictures are cached and asked under: its key, and the part on screen exactly as it is sent (a zoomed
 * picture's StageDetail, JSON reads each number back to the same double). Two specs share it only when they ask the
 * host for the same samples or bins, whatever their keys round, so one window's detail is never drawn for another.
 */
export function stageCacheKey(spec: StageSpec): string {
    const detail = spec.message.detail;
    return detail ? `${spec.key}|${JSON.stringify([detail.x, detail.y ?? null, detail.points])}` : spec.key;
}

export function createStageSource(prefix: string, post: (message: CompareScanMessage) => void, changed: () => void): StageSource {
    const cache = new Map<string, Map<string, ScanResult>>();
    // One slot: the pictures being asked for. A superseded request's answers are still kept, under its own spec.
    const requests = new HostRequests<undefined>();
    let count = 0;
    function cacheFor(key: string): Map<string, ScanResult> {
        let results = cache.get(key);
        if (!results) {
            results = new Map();
            cache.set(key, results);
            for (const oldest of cache.keys()) {
                if (cache.size <= CACHED_SPECS) break;
                cache.delete(oldest);
            }
        }
        return results;
    }
    return {
        ensure(spec, files) {
            const key = stageCacheKey(spec);
            const results = cache.get(key);
            const need = files.filter(path => !results?.has(path));
            if (!need.length) return false;
            if (requests.pending('pictures')?.key === key) return true;
            cacheFor(key);
            requests.ask('pictures', `${prefix}-${++count}`, key, undefined, ({ requestId }) => post({ type: 'compare-scan', requestId, filePaths: need, ...spec.message }));
            return true;
        },
        result: (spec, filePath) => cache.get(stageCacheKey(spec))?.get(filePath),
        forget(spec, filePath) { cache.get(stageCacheKey(spec))?.delete(filePath); },
        forgetData(keys) {
            for (const results of cache.values()) {
                for (const [path, result] of results) if (result.ok && result.stage?.data && keys.includes(result.stage.data)) results.delete(path);
            }
        },
        view(spec, filePath) {
            const result = cache.get(stageCacheKey(spec))?.get(filePath);
            return result === undefined ? undefined : result.ok ? result.stage ?? null : null;
        },
        handle(message) {
            const publication = message as ComparePublication;
            if (!message.type.startsWith('compare-') || !('requestId' in publication) || !publication.requestId.startsWith(`${prefix}-`)) return false;
            const key = requests.find(publication.requestId)?.key;
            if (publication.type === 'compare-scan-result' && key !== undefined) cacheFor(key).set(publication.filePath, publication.result);
            if (publication.type === 'compare-scan-done') requests.settle(publication.requestId);
            changed();
            return true;
        },
    };
}
