/**
 * The full data of the comparison's pictures (R7, fullRead.ts), as the backend keeps it (stage_combine.py): a
 * recording's step at full resolution under its picture's `data` key, a base group's median and a recording's
 * difference taken from those. A plot reads its numbers from here, never from the picture thinned to be drawn:
 * 'compare-combine' with a `read` gives only the points around the pointer, or the next ones for an arrow key.
 */
import type { CompareCombineMessage, ComparePublication } from '../../shared/analysis/entryScan';
import type { StagePoints, StageRead, StageView } from '../../shared/protocol/backendProtocol';
import { fetchedSource, wholeBars, type FullRead, type FullSource } from './fullRead';

export interface StageReader {
    /** A recording's own picture's full data, by the key its scan kept it under (a band table's own bars); undefined without one. */
    of(view: StageView | null | undefined): FullRead | undefined;
    /** A combined picture's: the median of the `base` keys, or `compare` − that median (`of: 'diff'`). */
    combined(base: readonly string[], compare: string | null, of: 'base' | 'diff'): FullSource;
    /** Takes the host's answers to this reader's requests; false for anything else. */
    handle(message: { type: string }): boolean;
}

/**
 * `missing`: the backend no longer keeps the values under these keys (its store is bounded); the caller forgets those
 * pictures so they are scanned again, and the read is asked for again once they are back.
 */
export function createStageReader(prefix: string, post: (message: CompareCombineMessage) => void, missing: (keys: readonly string[]) => void = () => undefined): StageReader {
    const waiting = new Map<string, (points: StagePoints | null | undefined) => void>();
    const sources = new Map<string, FullSource>();
    let count = 0;
    const source = (base: readonly string[], compare: string | null, of: 'base' | 'diff', event?: number): FullSource => {
        const key = JSON.stringify([base, compare, of, event ?? null]);
        const known = sources.get(key);
        if (known) return known;
        const made: FullSource = {
            ...fetchedSource((read: StageRead, done) => {
                const requestId = `${prefix}-${++count}`;
                waiting.set(requestId, done);
                post({ type: 'compare-combine', requestId, base: [...base], ...(compare ? { compare } : {}), read: { ...read, of, ...(event !== undefined ? { event } : {}) } });
            }),
            // A trigger's events: each its own line, read by its id.
            ...(event === undefined ? { event: (id: number) => source(base, compare, of, id) } : {}),
        };
        sources.set(key, made);
        // Pictures come and go with the zoom: the sources of the least recently made ones are let go.
        if (sources.size > 256) sources.delete(sources.keys().next().value as string);
        return made;
    };
    return {
        // A band table without a key is sent whole: its bars are read from their every value.
        of: view => (view?.data ? source([view.data], null, 'base') : wholeBars(view)),
        combined: (base, compare, of) => source(base, compare, of),
        handle(message) {
            if (message.type !== 'compare-combine-result') return false;
            const publication = message as Extract<ComparePublication, { type: 'compare-combine-result' }>;
            if (!publication.requestId.startsWith(`${prefix}-`)) return false;
            const done = waiting.get(publication.requestId);
            waiting.delete(publication.requestId);
            const { result } = publication;
            if (!result.ok && result.missing?.length) {
                // Not an answer: nothing is kept, and the pictures are scanned again.
                done?.(undefined);
                missing(result.missing);
                return true;
            }
            done?.(result.ok ? result.points ?? null : null);
            return true;
        },
    };
}
