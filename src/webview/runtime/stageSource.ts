/**
 * Per-step pictures (StageView) of files, as a screen asks the host for them with 'compare-scan': one request in
 * flight per source (a new one supersedes it on the host), results cached per spec (Recipe, region, step,
 * detail) and file. Request ids carry the source's prefix, so each screen takes only its own answers.
 */
import type { ComparePublication, CompareScanMessage } from '../../shared/analysis/entryScan';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import { answerKey, createAnswerStore, createLatestAnswers, type AnswerKey } from './answerStore';
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
 * What a file's pictures depend on beyond their spec (Recipe, region, step, detail): the version of the file and its
 * calibration. From the screen's own scan of the file (its conditionId: the backend's hash of the file's version,
 * calibration, unit and reference) and the track's analysis (its calibration signature and revision), whichever the
 * screen has. A file being scanned again keeps the condition it last had, so a rescan alone asks for nothing.
 * Changing either asks every picture of the file again (createStageSource's basisOf).
 */
export function stageBasis(
    scanOf: (filePath: string) => ScanResult | undefined,
    analysisOf: (filePath: string) => { calibrationSignature?: string; analysisRevision?: number } | null | undefined = () => undefined,
): (filePath: string) => string {
    const known = createLatestAnswers<string>();
    return filePath => {
        const scan = scanOf(filePath);
        const condition = scan?.ok ? scan.conditionId ?? scan.input?.id ?? '' : known.get(filePath) ?? '';
        if (scan?.ok) known.set(filePath, condition);
        const analysis = analysisOf(filePath);
        return JSON.stringify([condition, analysis?.calibrationSignature ?? '', analysis?.analysisRevision ?? null]);
    };
}

/**
 * What a spec's pictures are cached and asked under: its key, and the part on screen exactly as it is sent (a zoomed
 * picture's StageDetail, JSON reads each number back to the same double). Two specs share it only when they ask the
 * host for the same samples or bins, whatever their keys round, so one window's detail is never drawn for another.
 */
export function stageCacheKey(spec: StageSpec): string {
    const detail = spec.message.detail;
    return detail ? `${spec.key}|${JSON.stringify([detail.x, detail.y ?? null, detail.points])}` : spec.key;
}

/** A file's answer to a spec, under the file's basis (its version and calibration) when it was asked for. */
const fileKey = (cacheKey: string, filePath: string, basis: string): AnswerKey => answerKey({ ask: cacheKey, file: filePath, fileVersion: basis });

/**
 * `basisOf` names what a file's pictures depend on beyond the spec: the version of the file and its calibration, as
 * the screen knows them now (stageBasis). A picture asked for under another basis is not this file's any more: it is
 * not drawn, and asked for again. A file the screen knows nothing of has the basis ''.
 */
export function createStageSource(prefix: string, post: (message: CompareScanMessage) => void, changed: () => void, basisOf: (filePath: string) => string = () => ''): StageSource {
    // The CACHED_SPECS specs last answered, each with every file's answer to it.
    const answers = createAnswerStore<ScanResult>({ capacity: CACHED_SPECS, evictBy: 'ask' });
    // One slot: the pictures being asked for. A superseded request's answers are still kept, under its own spec.
    const requests = new HostRequests<{ key: string; bases: ReadonlyMap<string, string> }>();
    let count = 0;
    /** A file's answer for this cache key, while it is of the file's current basis. */
    const current = (key: string, filePath: string): ScanResult | undefined => answers.value(fileKey(key, filePath, basisOf(filePath)));
    return {
        ensure(spec, files) {
            const key = stageCacheKey(spec);
            const need = files.filter(path => current(key, path) === undefined);
            if (!need.length) return false;
            const bases = new Map(need.map(path => [path, basisOf(path)]));
            // The same request is in flight only when it asks for these files under the same bases.
            const asked = `${key}|${JSON.stringify([...bases])}`;
            if (requests.pending('pictures')?.key === asked) return true;
            requests.ask('pictures', `${prefix}-${++count}`, asked, { key, bases }, ({ requestId }) => post({ type: 'compare-scan', requestId, filePaths: need, ...spec.message }));
            return true;
        },
        result: (spec, filePath) => current(stageCacheKey(spec), filePath),
        forget(spec, filePath) { answers.forget(fileKey(stageCacheKey(spec), filePath, basisOf(filePath))); },
        forgetData(keys) {
            answers.forgetWhere(result => !!(result.ok && result.stage?.data && keys.includes(result.stage.data)));
        },
        view(spec, filePath) {
            const result = current(stageCacheKey(spec), filePath);
            return result === undefined ? undefined : result.ok ? result.stage ?? null : null;
        },
        handle(message) {
            const publication = message as ComparePublication;
            if (!message.type.startsWith('compare-') || !('requestId' in publication) || !publication.requestId.startsWith(`${prefix}-`)) return false;
            const request = requests.find(publication.requestId);
            if (publication.type === 'compare-scan-result' && request) {
                const { key, bases } = request.meta;
                answers.ready(fileKey(key, publication.filePath, bases.get(publication.filePath) ?? basisOf(publication.filePath)), publication.result);
            }
            if (publication.type === 'compare-scan-done') requests.settle(publication.requestId);
            changed();
            return true;
        },
    };
}
