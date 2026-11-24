/**
 * Per-step pictures (StageView) of files, as a screen asks the host for them with 'compare-scan': one request in
 * flight per source (a new one supersedes it on the host), results cached per spec (Recipe, region, step,
 * step) and file. Request ids carry the source's prefix, so each screen takes only its own answers.
 */
import type { ComparePublication, CompareScanMessage } from '../../shared/analysis/entryScan';
import type { ScanResult, StageView } from '../../shared/protocol/backendProtocol';
import { recipeKey } from '../../shared/recipe/recipeSteps';
import { answerKey, createAnswerStore, createLatestAnswers, pictureIdentity, type AnswerKey } from './answerStore';
import type { Answer, AnswerIdentity } from './answerTypes';
import { HostRequests } from './hostRequests';

export interface StageSpec {
    key: string;
    message: Pick<CompareScanMessage, 'region' | 'recipe' | 'stage' | 'reference'>;
}

export interface StageSource {
    /** Asks for what `spec` lacks of `files` unless it is being scanned; true while any is missing. */
    ensure(spec: StageSpec, files: readonly string[]): boolean;
    /** A file's picture for `spec`: undefined while not in, null when the step could not run on it. */
    view(spec: StageSpec, filePath: string): StageView | null | undefined;
    /** A file's whole scan result for `spec` (its metrics, for a spec without a step). */
    result(spec: StageSpec, filePath: string): ScanResult | undefined;
    /** Why a file's scan for `spec` failed, while that failure stands (it is asked again after FAILED_RETRY_MS). */
    failure(spec: StageSpec, filePath: string): string | undefined;
    /** Drops a file's picture for `spec`, so it is asked for again (its kept values are gone from the backend). */
    forget(spec: StageSpec, filePath: string): void;
    /** Drops every picture whose values the backend kept under one of `keys` and has let go (`missing`). */
    forgetData(keys: readonly string[]): void;
    /**
     * A file's picture for `spec` as an answer, with the identity it was answered under (the file's version and
     * calibration status its scan read, the full recipe, the region, the condition and the basis it was asked under):
     * ready with its picture, failed while a failure stands or for a step that cannot run on the file, pending while
     * asked. The figure model reads the identity here, never makes one.
     */
    answer(spec: StageSpec, filePath: string): Answer<StageView>;
    /**
     * The file's scan for `spec` (its picture and what its levels are in) under an earlier basis (the file recorded again, its calibration changed) while its
     * picture now is not in: an answer gone stale, kept so its figure keeps the picture and stops reading it until the
     * new one comes (第 6 節「描き直しの決まり」1). Undefined when there is none.
     */
    previous(spec: StageSpec, filePath: string): ScanResult | undefined;
    /** Takes the host's answers to this source's requests; false for anything else. */
    handle(message: { type: string }): boolean;
}

/** What a file's picture for `spec` is of (pictureIdentity): the full recipe, the region, the spec and the basis it was asked under. */
export function stageIdentity(spec: StageSpec, filePath: string, result: ScanResult | undefined, basis: string): AnswerIdentity {
    return pictureIdentity(filePath, result, { recipeKey: recipeKey(spec.message.recipe), region: JSON.stringify(spec.message.region ?? null), asked: JSON.stringify([spec.key, basis]) });
}

const CACHED_SPECS = 48;

/**
 * What a file's pictures depend on beyond their spec (Recipe, region, step, detail): the version of the file and its
 * calibration. From the screen's own scan of the file (its input id: the version of the file that was read) and
 * the track's analysis (its calibration signature and revision), whichever the
 * screen has. A file being scanned again keeps the condition it last had, so a rescan alone asks for nothing; a
 * rescan that failed is not that condition (the file as it is now could not be read).
 * Changing either asks every picture of the file again (createStageSource's basisOf).
 */
export function stageBasis(
    scanOf: (filePath: string) => ScanResult | undefined,
    analysisOf: (filePath: string) => { calibrationSignature?: string; analysisRevision?: number; sourceVersion?: string } | null | undefined = () => undefined,
    fileEpoch: (filePath: string) => string = () => '',
): (filePath: string) => string {
    const known = createLatestAnswers<string>();
    return filePath => {
        const scan = scanOf(filePath);
        // A scan that failed is of no version the pictures were taken of: none of them is this file's now.
        const condition = scan?.ok ? scan.input?.id ?? '' : scan ? `failed|${scan.reason ?? ''}` : known.get(filePath) ?? '';
        if (scan?.ok) known.set(filePath, condition);
        const analysis = analysisOf(filePath);
        // The track's file version (sourceVersion: a track analysed again after its file changed is another), and the
        // file's calibration or the file itself changed since its scan (the host said so, a track or not, fileEpoch):
        // its pictures are of the old one.
        return JSON.stringify([condition, analysis?.sourceVersion ?? '', analysis?.calibrationSignature ?? '', analysis?.analysisRevision ?? null, fileEpoch(filePath)]);
    };
}

/** A file's answer to a spec, under the file's basis (its version and calibration) when it was asked for. */
const fileKey = (cacheKey: string, filePath: string, basis: string): AnswerKey => answerKey({ ask: cacheKey, file: filePath, version: { basis } });

/**
 * `basisOf` names what a file's pictures depend on beyond the spec: the version of the file and its calibration, as
 * the screen knows them now (stageBasis). A picture asked for under another basis is not this file's any more: it is
 * not drawn, and asked for again. A file the screen knows nothing of has the basis ''.
 */
export function createStageSource(prefix: string, post: (message: CompareScanMessage) => void, changed: () => void, basisOf: (filePath: string) => string = () => '', now: () => number = () => Date.now()): StageSource {
    // The CACHED_SPECS specs last answered, each with every file's answer to it.
    // A failure's pause over, the screen draws again and the picture is asked for anew (the store keeps the time).
    const answers = createAnswerStore<ScanResult>({ capacity: CACHED_SPECS, evictBy: 'ask', now, retried: () => changed() });
    // One slot: the pictures being asked for. A superseded request's answers are still kept, under its own spec.
    const requests = new HostRequests<{ key: string; spec: StageSpec; bases: ReadonlyMap<string, string> }>();
    let count = 0;
    /** A file's answer for this cache key, while it is of the file's current basis. */
    /**
     * What a file's picture for `spec` is of beyond the spec: the file's basis and, for a step measured against
     * another recording (the base slot's: `reference`), that recording's basis too: a new version or calibration of
     * either is another picture.
     */
    const basisFor = (spec: StageSpec, filePath: string): string => {
        const against = spec.message.reference?.filePath;
        return against ? JSON.stringify([basisOf(filePath), against, basisOf(against)]) : basisOf(filePath);
    };
    const current = (spec: StageSpec, filePath: string): ScanResult | undefined => answers.value(fileKey(spec.key, filePath, basisFor(spec, filePath)));
    const stateOf = (spec: StageSpec, filePath: string) => answers.state(fileKey(spec.key, filePath, basisFor(spec, filePath)));
    return {
        ensure(spec, files) {
            const key = spec.key;
            // A failed picture is asked again only once the store's pause is over (then it is missing again).
            const need = files.filter(path => stateOf(spec, path) === 'missing');
            if (!need.length) return false;
            const bases = new Map(need.map(path => [path, basisFor(spec, path)]));
            // The same request is in flight only when it asks for these files under the same bases.
            const asked = `${key}|${JSON.stringify([...bases])}`;
            if (requests.pending('pictures')?.key === asked) return true;
            requests.ask('pictures', `${prefix}-${++count}`, asked, { key, spec, bases }, ({ requestId }) => post({ type: 'compare-scan', requestId, filePaths: need, ...spec.message }));
            return true;
        },
        result: (spec, filePath) => current(spec, filePath),
        failure(spec, filePath) {
            const key = fileKey(spec.key, filePath, basisFor(spec, filePath));
            return answers.state(key) === 'failed' ? answers.reason(key) ?? '' : undefined;
        },
        forget(spec, filePath) { answers.forget(fileKey(spec.key, filePath, basisFor(spec, filePath))); },
        forgetData(keys) {
            answers.forgetWhere(result => !!(result.ok && result.stage?.data && keys.includes(result.stage.data)));
        },
        view(spec, filePath) {
            // A failure that stands is drawn as no picture, and asked for again after the pause.
            if (stateOf(spec, filePath) === 'failed') return null;
            const result = current(spec, filePath);
            return result === undefined ? undefined : result.ok ? result.stage ?? null : null;
        },
        answer(spec, filePath) {
            const basis = basisFor(spec, filePath);
            const found = answers.answer(fileKey(spec.key, filePath, basis), stageIdentity(spec, filePath, undefined, basis));
            if (found.state === 'missing') {
                // Asked for and on its way, under this spec and basis: pending.
                const asked = requests.pending('pictures')?.meta;
                return asked?.key === spec.key && asked.bases.get(filePath) === basis ? { state: 'pending', identity: found.identity } : found;
            }
            if (found.state !== 'ready') return found.state === 'stale' ? { state: 'stale', identity: found.identity } : found;
            // Whether a step's result has values to count is the figure service's (figures/members.py), not decided here.
            const view = found.value.ok ? found.value.stage : undefined;
            return view ? { state: 'ready', value: view, identity: found.identity } : { state: 'failed', identity: found.identity };
        },
        previous(spec, filePath) {
            const ask = spec.key;
            for (const [key, held] of answers.newestFirst()) {
                if (key.ask !== ask || held.state !== 'ready' || held.identity?.path !== filePath) continue;
                return held.value.ok && held.value.stage ? held.value : undefined;
            }
            return undefined;
        },
        handle(message) {
            const publication = message as ComparePublication;
            if (!message.type.startsWith('compare-') || !('requestId' in publication) || !publication.requestId.startsWith(`${prefix}-`)) return false;
            const request = requests.find(publication.requestId);
            // An answer is of the basis its file was ASKED under (kept with the request), never the basis now; a file
            // the request did not ask for is no answer of it.
            const basis = request?.meta.bases.get(publication.type === 'compare-scan-result' ? publication.filePath : '');
            if (publication.type === 'compare-scan-result' && request && basis !== undefined) {
                const { key, spec } = request.meta;
                const answer = fileKey(key, publication.filePath, basis);
                // A step that cannot run on the file (failedStep) is its answer. A request that does not fit the file
                // (lasting: a region past its end) fails the same way until the key changes, so it is not asked again;
                // any other failure (the file unreadable for now, the backend restarted) may pass: it stands for the
                // store's pause and is then asked again. Asking again is a scan, which holds the figure's reads in
                // the browser build, so a lasting failure asked every pause made the figure blink.
                if (publication.result.ok || publication.result.failedStep) answers.ready(answer, publication.result, { identity: stageIdentity(spec, publication.filePath, publication.result, basis) });
                else answers.fail(answer, publication.result.reason, publication.result.lasting === true);
            }
            if (publication.type === 'compare-scan-done') requests.settle(publication.requestId);
            changed();
            return true;
        },
    };
}
