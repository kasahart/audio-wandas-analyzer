/**
 * Which host messages are a long computation (spec 4, figure-design.md 第 6 節「読む要求の上限」): a scan of the
 * comparison or of the entry table (走査), a recipe computed again (手順の再計算: the tracks analysed again) and an
 * export (書き出し: the figure's own, counted by figureRequests.ts). One begins when it is asked (waiting for the
 * Worker too) and ends when its answer comes (a failure too), or when a newer one of the same kind takes its place: the
 * host drops a superseded scan without saying it is done. The count is answers/'s (LongComputations); the Figures read
 * it through their requests (readsHeld), and only the browser build holds reads by it (VS Code is unchanged).
 */
import type { LongComputations } from './figureRequests';

/** A host message as far as this looks at it. */
type Message = { readonly type: string; readonly requestId?: unknown; readonly cachedOnly?: unknown };

export interface LongComputationWatch {
    /** A message the webview posted to the host. */
    posted(message: Message): void;
    /** A message the host sent the webview. */
    received(message: Message): void;
}

/** The asker of a comparison scan: its request id without its number ("track-stage-12" → "track-stage"). */
const askerOf = (requestId: string): string => requestId.replace(/-\d+$/u, '');

export function watchLongComputations(computations: LongComputations): LongComputationWatch {
    /** What is under way, by what ends it: the asker of a comparison scan, or the kind of the others. */
    const running = new Map<string, { requestId: string; end: () => void }>();
    const begin = (slot: string, requestId: string): void => {
        // A newer one of the same asker or kind takes the older one's place: the host drops the older one. The newer
        // one begins before the older one ends, so the count never passes 0 in between (no gap in the hold, and the
        // Figures are not told to read again in the middle of it).
        const older = running.get(slot);
        running.set(slot, { requestId, end: computations.begin() });
        older?.end();
    };
    const end = (slot: string, requestId?: string): void => {
        const found = running.get(slot);
        if (!found || (requestId !== undefined && found.requestId !== requestId)) return;
        running.delete(slot);
        found.end();
    };
    const idOf = (message: Message): string => (typeof message.requestId === 'string' ? message.requestId : '');
    return {
        posted(message) {
            switch (message.type) {
                case 'compare-scan': begin(`compare:${askerOf(idOf(message))}`, idOf(message)); return;
                default: return;
            }
        },
        received(message) {
            switch (message.type) {
                case 'compare-scan-done': end(`compare:${askerOf(idOf(message))}`, idOf(message)); return;
                case 'reanalyze-start': begin('reanalyze', ''); return;
                case 'reanalyze-end': end('reanalyze'); return;
                default: return;
            }
        },
    };
}
