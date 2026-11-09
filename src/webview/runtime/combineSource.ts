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

const requestKey = (request: CombineRequest): string => JSON.stringify([request.base, request.compare, request.detail ?? null]);

export function createCombineSource(prefix: string, post: (message: CompareCombineMessage) => void, changed: () => void): CombineSource {
    const results = new Map<string, Combined>();
    const asked = new Map<string, { key: string; identity: string; forget: (keys: readonly string[]) => void }>();
    const retried = new Set<string>();
    let count = 0;
    function keep(key: string, combined: Combined): void {
        results.delete(key);
        results.set(key, combined);
        for (const oldest of results.keys()) {
            if (results.size <= CACHED) break;
            results.delete(oldest);
        }
    }
    return {
        get(identity, request, forget) {
            const key = requestKey(request);
            const done = results.get(key);
            if (done) return done;
            if (![...asked.values()].some(item => item.key === key)) {
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
            if (result.ok) {
                retried.delete(request.identity);
                keep(request.key, { base: result.base ?? null, diff: result.diff ?? null, ...(result.noDelta ? { noDelta: result.noDelta } : {}) });
            } else if (!result.missing?.length) {
                keep(request.key, FAILED_COMBINED);
            } else if (!retried.has(request.identity)) {
                retried.add(request.identity);
                request.forget(result.missing ?? []);
            } else {
                keep(request.key, TOO_LARGE_COMBINED);
            }
            changed();
            return true;
        },
    };
}
