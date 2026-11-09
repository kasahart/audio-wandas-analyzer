/**
 * A base group's median and a recording's difference from its base, as the host's backend takes them from the
 * values its scans kept (stage_combine.py, 'compare-combine'): at the Frames' full resolution, then decimated to
 * be drawn. Decimation is only for drawing, so neither is ever taken of the pictures the webview has.
 *
 * Answers are cached per request (the pictures' keys and the part on screen). Values the backend no longer keeps
 * are scanned again once (`forget` drops those pictures, so they are asked for anew); a combination that still
 * finds them gone (more than the backend keeps at once) is given up, and says so.
 */
import type { CompareCombineMessage, ComparePublication } from '../../shared/analysis/entryScan';
import type { StageDetail, StageView } from '../../shared/protocol/backendProtocol';
import { answerKey, createAnswerStore, type AnswerKey } from './answerStore';

/** What a combination gives: the median (of two or more recordings) and the difference. */
export interface Combined {
    base: StageView | null;
    diff: StageView | null;
    /** The backend could not keep every recording's values at once. */
    tooLarge?: boolean;
    /** Why there is no difference when it is not the axes: time signals at other sample rates, or in another unit. */
    noDelta?: 'rate' | 'unit';
    /** The backend failed to take it (an error, not a reason the pictures cannot be combined). */
    failed?: boolean;
}

/** What the Δ plot and its headline say when there is no line: too much data, other sample rates or units, or other axes. */
export function noDeltaNote(combined: Pick<Combined, 'tooLarge' | 'noDelta' | 'failed'> | undefined, strings: { stageNoDelta: string; stageTooLarge: string; stageNoDeltaRate: string; stageNoDeltaUnit: string; stageCombineFailed: string }): string {
    if (combined?.failed) return strings.stageCombineFailed;
    if (combined?.tooLarge) return strings.stageTooLarge;
    if (combined?.noDelta === 'rate') return strings.stageNoDeltaRate;
    if (combined?.noDelta === 'unit') return strings.stageNoDeltaUnit;
    return strings.stageNoDelta;
}

export const NOTHING_COMBINED: Combined = { base: null, diff: null };

/** Nothing combined because a picture's values were over what the backend keeps (its scan said stageDataTooLarge). */
export const TOO_LARGE_COMBINED: Combined = { ...NOTHING_COMBINED, tooLarge: true };

/** Nothing combined because the backend failed (its answer ok: false with nothing missing). */
export const FAILED_COMBINED: Combined = { ...NOTHING_COMBINED, failed: true };

export interface CombineRequest {
    base: readonly string[];
    compare: string | null;
    detail?: StageDetail;
}

/**
 * The last zoomed answer a plot keeps on screen while the next window's comes (A35, C2): kept for the pictures it was
 * taken of (the request's data keys, which a new scan, a calibration or a file's new version changes), so a picture
 * taken since never shows it.
 */
export interface LastFine {
    keep(identity: string, asked: CombineRequest, combined: Combined): void;
    of(identity: string, asked: CombineRequest): Combined | undefined;
}

export function createLastFine(): LastFine {
    const kept = createAnswerStore<Combined>({ capacity: KEPT_FINE });
    const key = (identity: string, asked: CombineRequest): AnswerKey => answerKey({ ask: ['last-fine', asked.base, asked.compare], version: { by: 'data-keys' }, condition: identity });
    return {
        keep(identity, asked, combined) { kept.ready(key(identity, asked), combined); },
        of: (identity, asked) => kept.value(key(identity, asked)),
    };
}

/** Last zoomed answers kept: one per held plot and step, so a handful. */
const KEPT_FINE = 64;

export interface CombineSource {
    /**
     * The combination, undefined while it is asked for. `identity` names what is combined whatever its keys (the
     * files, the step, the part on screen): it is scanned again once at most. `forget` drops the pictures whose
     * keys the backend no longer has.
     */
    get(identity: string, request: CombineRequest, forget: (keys: readonly string[]) => void): Combined | undefined;
    /** Takes the host's answers to this source's requests; false for anything else. */
    handle(message: { type: string }): boolean;
}

const CACHED = 64;

/**
 * A combination's key: the data keys it combines (each the backend's hash of the file's version, the Recipe, region,
 * channels, calibration and step, scan_service._data_key) and the part on screen exactly as it is sent.
 */
const combineKey = (request: CombineRequest): AnswerKey => answerKey({ ask: ['combine', request.base, request.compare], version: { by: 'data-keys' }, region: JSON.stringify(request.detail ?? null) });

export function createCombineSource(prefix: string, post: (message: CompareCombineMessage) => void, changed: () => void, now: () => number = () => Date.now()): CombineSource {
    const answers = createAnswerStore<Combined>({ capacity: CACHED, now });
    /** The requests on their way, by id: what each asks, of what, and how to drop pictures the backend let go. */
    const asked = new Map<string, { key: AnswerKey; identity: string; forget: (keys: readonly string[]) => void }>();
    let count = 0;
    return {
        get(identity, request, forget) {
            const key = combineKey(request);
            const state = answers.state(key);
            if (state === 'ready') return answers.value(key);
            if (state === 'failed') return FAILED_COMBINED;
            // Missing and not to be asked: the backend could not keep its values even when they were scanned again.
            if (state === 'missing' && !answers.ask(key)) return TOO_LARGE_COMBINED;
            // Asked just now (a pending one is on its way).
            if (state === 'missing') {
                const requestId = `${prefix}-${++count}`;
                asked.set(requestId, { key, identity, forget });
                post({ type: 'compare-combine', requestId, base: [...request.base], ...(request.compare ? { compare: request.compare } : {}), ...(request.detail ? { detail: request.detail } : {}) });
            }
            return undefined;
        },
        handle(message) {
            if (message.type !== 'compare-combine-result') return false;
            const publication = message as Extract<ComparePublication, { type: 'compare-combine-result' }>;
            const request = asked.get(publication.requestId);
            if (!publication.requestId.startsWith(`${prefix}-`)) return false;
            if (!request) return true;
            asked.delete(publication.requestId);
            const { result } = publication;
            if (result.ok) answers.ready(request.key, { base: result.base ?? null, diff: result.diff ?? null, ...(result.noDelta ? { noDelta: result.noDelta } : {}) }, { group: request.key.id });
            else if (!result.missing?.length) answers.fail(request.key);
            // Once per combination: its data keys name the files' versions and calibrations (scan_service._data_key), so a
            // rescan brings the same keys back and a new version or calibration is a new combination, tried again once itself.
            else if (answers.unreached(request.key, request.key.id) === 'again') request.forget(result.missing ?? []);
            changed();
            return true;
        },
    };
}
