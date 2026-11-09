/**
 * The answer store: the one place the webview keeps what the host answered, under which key, and whether it is still
 * right (layers-design: 答えの置き場). Every cache of answers (a step's pictures, a combination, a read of the full
 * data, a scan's result, a header) is one of these, so what an answer is keyed by, how long a failure stands, and what
 * an answer that never comes does are decided here alone:
 *
 * - The key (answerKey) is the file's version and calibration, the full recipe, the region and the analysis condition
 *   with what is asked of them; two answers share a key only when every part is the same, never by a partial match.
 * - An answer is pending (asked, not in), ready (a value), empty (answered with nothing to show), failed (asked again
 *   once FAILED_RETRY_MS have passed: a passing failure never stays) or missing (the backend let the data go and it
 *   could not be had again).
 * - A ready answer carries the identity it is of (AnswerIdentity, answerTypes.ts); the figure model reads it there.
 *
 * What a figure draws of the answers, and which files it counts, is the figure model's (figureModel.ts), never this.
 */
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import type { Answer, AnswerIdentity } from './answerTypes';

/** How long a failed answer stands (ms): until then it reads as failed; after it, the next ask sends it again. */
export const FAILED_RETRY_MS = 5000;
/** How long an asked answer is waited for before it is asked again (ms), for requests a failure leaves unanswered. */
export const UNANSWERED_RETRY_MS = 2000;

declare const answerKeyBrand: unique symbol;

/** A key made by answerKey only: `id` names the answer, `ask` what was asked (the group a store may evict by). */
export interface AnswerKey {
    readonly id: string;
    readonly ask: string;
    readonly [answerKeyBrand]: true;
}

/**
 * Where an answer's file version and calibration are in its key, which every key says (never left out by default):
 * - `fileVersion` and `calibration` given apart;
 * - `basis`: one string the screen names both by (stageSource.stageBasis: the scan's condition and the track's calibration);
 * - `by`: the ask itself names them: the backend's data keys (each a hash of the file version, Recipe, region, channels,
 *   calibration and step), the full request as sent (a pair request names each file's sourceVersion), or the source
 *   the answer is kept in (itself kept under its track's file version and calibration). A track's analysis is no
 *   version: the file can be rewritten under it, so a lane's answers name the track's sourceVersion instead.
 */
export type AnswerVersion =
    | { fileVersion: string; calibration: string }
    | { basis: string }
    | { by: 'data-keys' | 'request' | 'source' };

/** What an answer is of. Every part a source knows goes in; a part it does not know is left out, never guessed. */
export interface AnswerKeyParts {
    /** What is asked of the file(s): the source's name and its request (a spec, a window, a read, a combination). */
    ask: unknown;
    /** Where the file's version and calibration are (AnswerVersion): required, so no key leaves them out unsaid. */
    version: AnswerVersion;
    /** The file (or subject) answered for. */
    file?: string;
    /** The full recipe text (recipeKey). */
    recipe?: string;
    /** The measured region, in whole samples, or the part on screen as it is sent. */
    region?: string;
    /** The analysis condition (the table's conditionId, the track's analysis and its settings signature). */
    condition?: string;
}

/** The key of an answer: every part, in one order, written exactly (JSON reads each number back to the same double). */
export function answerKey(parts: AnswerKeyParts): AnswerKey {
    const ask = typeof parts.ask === 'string' ? parts.ask : JSON.stringify(parts.ask ?? null);
    const version = 'by' in parts.version ? ['by', parts.version.by] : 'basis' in parts.version ? ['basis', parts.version.basis] : [parts.version.fileVersion, parts.version.calibration];
    const id = JSON.stringify([ask, parts.file ?? '', version, parts.recipe ?? '', parts.region ?? '', parts.condition ?? '']);
    return { id, ask } as AnswerKey;
}

export type AnswerState = Answer<unknown>['state'];

type Slot<T> =
    | { state: 'pending'; since: number }
    | { state: 'ready'; value: T; identity?: AnswerIdentity }
    | { state: 'empty'; identity?: AnswerIdentity }
    | { state: 'failed'; retryAt: number; reason?: string }
    | { state: 'missing' };

/** One answer as the store holds it, for a source that searches its answers (a kept read that covers another). */
export type HeldAnswer<T> = Readonly<Slot<T>>;

export interface AnswerStoreOptions {
    /** How many answers are kept (or, with `evictBy: 'ask'`, how many asks with all their files' answers). */
    capacity: number;
    /** 'ask': the least recently used ask is let go with every file's answer to it (a step's pictures of a folder). */
    evictBy?: 'answer' | 'ask';
    /** An answer asked for and not in after UNANSWERED_RETRY_MS is asked again (its request may have been lost). */
    retryUnanswered?: boolean;
    now?: () => number;
    /**
     * Called once a failure's pause is over (FAILED_RETRY_MS after it), so its owner draws again and the answer is asked
     * for anew: the store keeps the time, no source keeps a timer of its own.
     */
    retried?: () => void;
}

/** Calls `then` once a failure's pause is over (a timer that keeps nothing alive). */
function afterPause(then: (() => void) | undefined): void {
    if (!then) return;
    (setTimeout(then, FAILED_RETRY_MS + 10) as { unref?: () => void }).unref?.();
}

export interface AnswerStore<T> {
    /** The answer's state now: missing when it was never asked, was let go, or its failure is past its retry. */
    state(key: AnswerKey): AnswerState;
    /** The value of a ready answer; undefined otherwise. */
    value(key: AnswerKey): T | undefined;
    /** Whether the answer is to be asked for now (none, its failure past FAILED_RETRY_MS, or long unanswered); if so it is pending. */
    ask(key: AnswerKey): boolean;
    /** The answer came with a value. `group` names what it is of beyond its key, for unreached(). */
    ready(key: AnswerKey, value: T, options?: { identity?: AnswerIdentity; group?: string }): void;
    /** The answer came with nothing to show (an empty window, a step that gives no picture). */
    empty(key: AnswerKey, identity?: AnswerIdentity): void;
    /**
     * The answer failed (and why, when the host said): it reads as failed until FAILED_RETRY_MS have passed, then is
     * asked again; `lasting` (asking again cannot mend it: the file changed since its track was analysed) keeps the
     * failure until the key is forgotten or the store cleared, and nobody is told to ask again.
     */
    fail(key: AnswerKey, reason?: string, lasting?: boolean): void;
    /** Why a failed answer failed, while its failure stands. */
    reason(key: AnswerKey): string | undefined;
    /**
     * The answer could not be had because the backend let go of what it is taken from: the first time for `group` it is
     * let go here too, so it is asked for again once that is back ('again'); a second time it is missing ('given-up').
     */
    unreached(key: AnswerKey, group: string): 'again' | 'given-up';
    /** Lets the answer go: it is asked for anew. */
    forget(key: AnswerKey): void;
    /** Lets go every ready answer `gone` names (the values the backend no longer keeps). */
    forgetWhere(gone: (value: T, key: AnswerKey) => boolean): void;
    clear(): void;
    /** The answer in the shared form the figure model reads, of `identity`. */
    answer(key: AnswerKey, identity: AnswerIdentity): Answer<T>;
    /** Calls `then` once the answer is in (ready, empty, failed or missing), or at once if it is. */
    whenSettled(key: AnswerKey, then: () => void): void;
    /** The value kept under `key`, made (and kept as ready) the first time it is wanted: a source's handle on its data. */
    keep(key: AnswerKey, make: () => T): T;
    /** Every answer held, the most recent first. */
    newestFirst(): Iterable<[AnswerKey, HeldAnswer<T>]>;
    readonly size: number;
}

export function createAnswerStore<T>(options: AnswerStoreOptions): AnswerStore<T> {
    const now = options.now ?? (() => Date.now());
    const slots = new Map<string, { key: AnswerKey; slot: Slot<T> }>();
    const settled = new Map<string, Array<() => void>>();
    const retried = new Set<string>();
    /** The slot now, with a failure past its retry let go. */
    const held = (key: AnswerKey): Slot<T> | undefined => {
        const found = slots.get(key.id)?.slot;
        if (found?.state === 'failed' && now() >= found.retryAt) {
            slots.delete(key.id);
            return undefined;
        }
        return found;
    };
    const evict = (): void => {
        if (options.evictBy === 'ask') {
            const asks = new Set([...slots.values()].map(item => item.key.ask));
            for (const oldest of asks) {
                if (asks.size <= options.capacity) break;
                // An ask with an answer on its way stays: its answers are about to be wanted.
                if ([...slots.values()].some(item => item.key.ask === oldest && item.slot.state === 'pending')) continue;
                for (const [id, item] of slots) if (item.key.ask === oldest) slots.delete(id);
                asks.delete(oldest);
            }
            return;
        }
        for (const [id, item] of slots) {
            if (slots.size <= options.capacity) break;
            if (item.slot.state !== 'pending') slots.delete(id);
        }
    };
    const put = (key: AnswerKey, slot: Slot<T>): void => {
        slots.delete(key.id);
        slots.set(key.id, { key, slot });
        evict();
        if (slot.state === 'pending') return;
        const calls = settled.get(key.id);
        settled.delete(key.id);
        for (const call of calls ?? []) call();
    };
    const store: AnswerStore<T> = {
        state: key => held(key)?.state ?? 'missing',
        value(key) {
            const found = held(key);
            return found?.state === 'ready' ? found.value : undefined;
        },
        ask(key) {
            const found = held(key);
            if (found?.state === 'pending' && !(options.retryUnanswered && now() - found.since >= UNANSWERED_RETRY_MS)) return false;
            if (found && found.state !== 'pending') return false;
            put(key, { state: 'pending', since: now() });
            return true;
        },
        ready(key, value, extra) {
            if (extra?.group !== undefined) retried.delete(extra.group);
            put(key, { state: 'ready', value, ...(extra?.identity ? { identity: extra.identity } : {}) });
        },
        empty(key, identity) { put(key, { state: 'empty', ...(identity ? { identity } : {}) }); },
        fail(key, reason, lasting) {
            put(key, { state: 'failed', retryAt: lasting ? Infinity : now() + FAILED_RETRY_MS, ...(reason !== undefined ? { reason } : {}) });
            if (!lasting) afterPause(options.retried);
        },
        reason(key) {
            const found = held(key);
            return found?.state === 'failed' ? found.reason : undefined;
        },
        unreached(key, group) {
            if (!retried.has(group)) {
                retried.add(group);
                slots.delete(key.id);
                return 'again';
            }
            put(key, { state: 'missing' });
            return 'given-up';
        },
        forget(key) { slots.delete(key.id); },
        forgetWhere(gone) {
            for (const [id, item] of slots) if (item.slot.state === 'ready' && gone(item.slot.value, item.key)) slots.delete(id);
        },
        clear() { slots.clear(); retried.clear(); },
        answer(key, identity) {
            const found = held(key);
            if (found?.state === 'ready') return { state: 'ready', value: found.value, identity: found.identity ?? identity };
            if (found?.state === 'failed') return { state: 'failed', identity, retryAt: found.retryAt };
            return { state: found?.state ?? 'missing', identity: (found?.state === 'empty' ? found.identity : undefined) ?? identity };
        },
        whenSettled(key, then) {
            const state = held(key)?.state;
            if (state !== undefined && state !== 'pending') { then(); return; }
            settled.set(key.id, [...(settled.get(key.id) ?? []), then]);
        },
        keep(key, make) {
            const found = held(key);
            if (found?.state === 'ready') {
                // Used again: it is the most recent.
                put(key, found);
                return found.value;
            }
            const value = make();
            put(key, { state: 'ready', value });
            return value;
        },
        *newestFirst() {
            const items = [...slots.values()];
            for (let index = items.length - 1; index >= 0; index--) {
                const { key } = items[index];
                const slot = held(key);
                if (slot) yield [key, slot];
            }
        },
        get size() { return slots.size; },
    };
    return store;
}

/**
 * The latest answer for each subject (a file, a track's channel): what a table shows of each file whatever it was last
 * asked under, with what it was asked under (`recipeKey`, `condition`) so a stale one is told apart. `view` is the
 * ready values, for the readers that take a map of them.
 */
export interface LatestAnswers<T, K extends string | number = string> {
    readonly view: ReadonlyMap<K, T>;
    get(subject: K): T | undefined;
    has(subject: K): boolean;
    /** What the subject's answer was asked under (the recipe, the condition), as it was set. */
    under(subject: K): { recipeKey?: string; condition?: string } | undefined;
    set(subject: K, value: T, under?: { recipeKey?: string; condition?: string }): void;
    /** The subject could not be answered, and why (a header that could not be read). */
    fail(subject: K, reason: string): void;
    /** Why the subject's answer failed, while it has none. */
    failure(subject: K): string | undefined;
    readonly failures: ReadonlyMap<K, string>;
    delete(subject: K): void;
    clear(): void;
}

export function createLatestAnswers<T, K extends string | number = string>(): LatestAnswers<T, K> {
    const values = new Map<K, T>();
    const unders = new Map<K, { recipeKey?: string; condition?: string }>();
    const failures = new Map<K, string>();
    return {
        view: values,
        failures,
        get: subject => values.get(subject),
        has: subject => values.has(subject),
        under: subject => unders.get(subject),
        set(subject, value, under) {
            values.set(subject, value);
            failures.delete(subject);
            if (under) unders.set(subject, under);
            else unders.delete(subject);
        },
        fail(subject, reason) {
            // The failure is the subject's answer now: what it had before is not shown for it.
            values.delete(subject);
            unders.delete(subject);
            failures.set(subject, reason);
        },
        failure: subject => failures.get(subject),
        delete(subject) { values.delete(subject); unders.delete(subject); failures.delete(subject); },
        clear() { values.clear(); unders.clear(); failures.clear(); },
    };
}

/**
 * When each request on its way was sent, for the requests whose answer may never come (a lane's range): one asked for
 * longer than UNANSWERED_RETRY_MS ago is asked again, and an answer asked for before one already landed is older.
 */
export interface RequestClock {
    sent(requestId: string): void;
    /** Whether the request is still waited for (sent less than UNANSWERED_RETRY_MS ago). */
    waiting(requestId: string | undefined): boolean;
    /** When it was sent (-Infinity if never), and it is no longer waited for. */
    landed(requestId: string): number;
}

export function createRequestClock(now: () => number, capacity = 256): RequestClock {
    const sentAt = new Map<string, number>();
    return {
        sent(requestId) {
            sentAt.set(requestId, now());
            for (const oldest of sentAt.keys()) {
                if (sentAt.size <= capacity) break;
                sentAt.delete(oldest);
            }
        },
        waiting: requestId => requestId !== undefined && now() - (sentAt.get(requestId) ?? -Infinity) < UNANSWERED_RETRY_MS,
        landed(requestId) {
            const at = sentAt.get(requestId) ?? -Infinity;
            sentAt.delete(requestId);
            return at;
        },
    };
}

/**
 * Failures by subject for answers held elsewhere in one slot (a lane's whole-file spectrogram, its zoom window): a
 * failed one is not asked again until FAILED_RETRY_MS have passed, under the same condition.
 */
export interface FailureHold {
    fail(subject: string, condition?: string): void;
    /** Whether a failure of the subject under `condition` still stands. */
    holds(subject: string, condition?: string): boolean;
    clear(subject?: string): void;
}

export function createFailureHold(now: () => number = () => Date.now(), retried?: () => void): FailureHold {
    const failed = new Map<string, { condition: string; retryAt: number }>();
    return {
        fail(subject, condition = '') { failed.set(subject, { condition, retryAt: now() + FAILED_RETRY_MS }); afterPause(retried); },
        holds(subject, condition = '') {
            const found = failed.get(subject);
            return !!found && found.condition === condition && now() < found.retryAt;
        },
        clear(subject) {
            if (subject === undefined) failed.clear();
            else failed.delete(subject);
        },
    };
}

/** A scan's answer: ready with its result when it read its file, failed when it did not, pending while none is in. */
export type ScanAnswer = Answer<ScanResult & { ok: true }>;

/** What a scan without a file read says its levels are in: nothing known, so uncalibrated full scale. */
const UNREAD_LEVEL: AnswerIdentity['level'] = { unit: '', ref: 1, levelReferenceLabel: '', calibrationStatus: 'uncalibrated', fullScale: true };

/**
 * A file's scan as an answer, with the identity the scan gives it: its file version (input.id), calibration status,
 * level, condition (conditionId: the backend's hash of the version, calibration, unit and reference) and, when known,
 * the recipe and region it was measured with. Whether a scan counts is decided here alone: no result yet is pending,
 * one that did not read its file is failed.
 */
export function scanAnswer(path: string, result: ScanResult | undefined, under?: { recipeKey?: string; region?: string }): ScanAnswer {
    const identity: AnswerIdentity = {
        path,
        fileVersion: result?.input?.id ?? '',
        calibrationSignature: result?.input?.calibrationStatus ?? '',
        level: result?.ok && result.input ? result.input : UNREAD_LEVEL,
        recipeKey: under?.recipeKey ?? '',
        region: under?.region ?? '',
        conditionId: result?.conditionId ?? '',
    };
    if (!result) return { state: 'pending', identity };
    if (!result.ok) return { state: 'failed', identity };
    return { state: 'ready', value: result as ScanResult & { ok: true }, identity };
}

declare const currentBrand: unique symbol;
declare const shownBrand: unique symbol;
/**
 * The scans of the current chain and calibration (ready, and failed with why), as only the answer store makes them:
 * what a median, a Δ, an n, a level reference or an axis name is taken from. A map of every scan cannot pass for it.
 * It stands in for the answers until every figure takes Answers itself (figureModel's FigureSet).
 */
export type CurrentAnswers = ReadonlyMap<string, ScanResult> & { readonly [currentBrand]: 'current' };
/** Every file's latest scan, an earlier chain's too, for the table to show (greyed when stale): never counted. */
export type ShownAnswers = ReadonlyMap<string, ScanResult> & { readonly [shownBrand]: 'shown' };

/** What a scan is asked under: the recipe and the file's condition (its calibration epoch) when it is asked. */
export interface ScanUnder {
    recipeKey: string;
    condition: string;
}

/**
 * The latest scan of each file, handed out only as answers with their state (scanAnswer): stale when measured under
 * another recipe or condition than the current one, pending only while asked, missing when never asked. No raw map of
 * the scans leaves the store: the current ones as CurrentAnswers, every one for showing as ShownAnswers.
 */
export interface ScanAnswers {
    /** A file's scan as an answer (stale: its value shown greyed, never counted). */
    answer(path: string): ScanAnswer;
    /** Several files' answers, against one reading of what is current. */
    answers(paths: readonly string[]): ScanAnswer[];
    /** Whether the file's result (read or failed) is of another recipe or condition than the current one. */
    stale(path: string): boolean;
    /** The scans of the current recipe and condition (a failed one too, with why): what is counted. */
    current(): CurrentAnswers;
    /** Every file's latest scan, for the table to show: an earlier chain's is there greyed. */
    shown(): ShownAnswers;
    /** Why a file's scan failed, and the step that cannot run on it if that is why; undefined when it did not fail. */
    failure(path: string): { reason: string; failedStep?: string } | undefined;
    /** These files are asked for now, each under what is current as it is asked: until it answers or the asking ends, it is pending. */
    asking(paths: readonly string[]): void;
    /**
     * A scan asked for came in: kept under what it was asked under (a calibration changed meanwhile makes it stale).
     * One not asked for (an asking already ended) is not kept, and false is said.
     */
    answered(path: string, result: ScanResult): boolean;
    /** The asking ended (done or stopped): a file not answered is missing again. */
    settled(): void;
    /** A scan kept under `under` as it is (tests, stored sessions). */
    set(path: string, result: ScanResult, under: ScanUnder): void;
    delete(path: string): void;
    clear(): void;
    /** Bumped on every change to the scans kept: what is derived of them all (the chain's limits) is made again after one. */
    readonly revision: number;
}

/** What a scan must be of now: the current recipe's key (asked once per question, it may be costly) and each file's condition. */
export interface ScanCurrent {
    recipeKey: string;
    condition(path: string): string;
    /** Changed whenever any file's condition does (a calibration changed): the current scans are taken again then. */
    conditions?: number;
}

export function createScanAnswers(currentOf: () => ScanCurrent = () => ({ recipeKey: '', condition: () => '' })): ScanAnswers {
    const latest = createLatestAnswers<ScanResult>();
    /** Each file asked for now, with what it was asked under. */
    const asked = new Map<string, ScanUnder>();
    const staleUnder = (path: string, now: ScanCurrent): boolean => {
        if (!latest.has(path)) return false;
        const under = latest.under(path);
        return under?.recipeKey !== now.recipeKey || (under?.condition ?? '') !== now.condition(path);
    };
    const answerUnder = (path: string, now: ScanCurrent): ScanAnswer => {
        const result = latest.get(path);
        const under = latest.under(path);
        const found = scanAnswer(path, result, under);
        const identity = { ...found.identity, calibrationSignature: `${found.identity.calibrationSignature}|${under?.condition ?? ''}` };
        if (!result) return asked.has(path) ? { state: 'pending', identity } : { state: 'missing', identity };
        if (found.state === 'ready') return staleUnder(path, now) ? { state: 'stale', value: found.value, identity } : { ...found, identity };
        return { ...found, identity };
    };
    let revision = 0;
    /** The current scans as last taken, and what they were taken under. */
    let made: { revision: number; recipeKey: string; conditions?: number; answers: CurrentAnswers } | null = null;
    const keep = (path: string, result: ScanResult, under: ScanUnder): void => { asked.delete(path); latest.set(path, result, under); revision++; };
    return {
        get revision() { return revision; },
        answer: path => answerUnder(path, currentOf()),
        answers(paths) { const now = currentOf(); return paths.map(path => answerUnder(path, now)); },
        stale: path => staleUnder(path, currentOf()),
        current() {
            const now = currentOf();
            if (made && made.revision === revision && made.recipeKey === now.recipeKey && now.conditions !== undefined && made.conditions === now.conditions) return made.answers;
            const out = new Map<string, ScanResult>();
            for (const [path, result] of latest.view) if (!staleUnder(path, now)) out.set(path, result);
            made = { revision, recipeKey: now.recipeKey, conditions: now.conditions, answers: out as unknown as CurrentAnswers };
            return made.answers;
        },
        shown: () => latest.view as unknown as ShownAnswers,
        failure(path) {
            const result = latest.get(path);
            return result && !result.ok ? { reason: result.reason ?? '', ...(result.failedStep ? { failedStep: result.failedStep } : {}) } : undefined;
        },
        asking(paths) {
            const now = currentOf();
            for (const path of paths) asked.set(path, { recipeKey: now.recipeKey, condition: now.condition(path) });
        },
        answered(path, result) {
            const under = asked.get(path);
            if (!under) return false;
            keep(path, result, under);
            return true;
        },
        settled() { asked.clear(); },
        set: keep,
        delete(path) { asked.delete(path); latest.delete(path); revision++; },
        clear() { asked.clear(); latest.clear(); revision++; },
    };
}

/**
 * One answer held for one subject (a track's range, its zoom window, its spectrogram's failure): its value, or its
 * failure under the condition it was asked under, standing for FAILED_RETRY_MS and then asked again.
 */
export interface AnswerSlot<T> {
    get(): T | null;
    set(value: T): void;
    /** The answer failed under `condition` (and why): what was held is let go. */
    fail(reason: string, condition?: string): void;
    /** Why the answer failed under `condition`, while it has not been asked again. */
    failure(condition?: string): string | undefined;
    /** Whether a failure under `condition` still stands (it is not asked again until it does not). */
    holds(condition?: string): boolean;
    /** Lets go the value and the failure (asked anew, a new analysis). */
    clear(): void;
}

export function createAnswerSlot<T>(now: () => number = () => Date.now(), retried?: () => void): AnswerSlot<T> {
    let value: T | null = null;
    let failed: { reason: string; condition: string; until: number } | null = null;
    return {
        get: () => value,
        set(next) { value = next; failed = null; },
        fail(reason, condition = '') { value = null; failed = { reason, condition, until: now() + FAILED_RETRY_MS }; afterPause(retried); },
        failure: (condition = '') => (failed && failed.condition === condition ? failed.reason : undefined),
        holds: (condition = '') => !!failed && failed.condition === condition && now() < failed.until,
        clear() { value = null; failed = null; },
    };
}
