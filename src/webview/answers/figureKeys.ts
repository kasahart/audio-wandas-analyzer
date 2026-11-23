/**
 * The keys of a figure spec (図の宣言) with the state and version answers/ gives each (figure-design.md 第 6 節
 * 「描き直しの決まり」 1): the state is the answer store's freshness (runtime/answerStore.ts: an answer is pending,
 * ready, empty, failed, missing, or stale), said in the figure service's words. Layer 2 decides from these what is
 * shown and counted (計算ア); answers/ decides nothing of it.
 */
import type { FigureKey, FigureLevel } from '../../shared/protocol/generated/backendProtocolSchema';

/** An answer's freshness as the answer store says it (answerTypes.ts Answer['state'], held equal by a test). */
export type AnswerFreshness = 'ready' | 'stale' | 'pending' | 'empty' | 'failed' | 'missing';

/** The figure service's word for a freshness: a ready answer is usable; the store's missing (let go) is evicted. */
export function keyState(freshness: AnswerFreshness | 'too-large'): FigureKey['state'] {
    switch (freshness) {
        // Not an answer's freshness: the scan said its values are over what the backend keeps (stageDataTooLarge).
        case 'too-large': return 'too-large';
        case 'ready': return 'usable';
        case 'stale': return 'stale';
        case 'pending': return 'pending';
        case 'missing': return 'evicted';
        // An answer with nothing in it, or a failure: nothing to draw of it.
        case 'empty':
        case 'failed': return 'failed';
    }
}

/**
 * One key as a spec carries it: its state, the version of the answer it is of, and what answers/ knows of it before
 * its answer: its level identity, its calibration, the channel it is compared as (1 is the first) and its file's
 * channel count (the figure service counts a recording without that channel no-channel: 計算ア decides, not here).
 */
export function figureKey(key: string, freshness: AnswerFreshness | 'too-large', version: string, known: { level?: FigureLevel; calibrated?: boolean; channel?: number | null; channels?: number } = {}): FigureKey {
    return {
        key, state: keyState(freshness), version, ...(known.level ? { level: known.level } : {}), ...(known.calibrated !== undefined ? { calibrated: known.calibrated } : {}),
        ...(known.channel ? { channel: known.channel } : {}), ...(known.channels ? { channels: known.channels } : {}),
    };
}

/** A key of part of a kept answer (a trigger's events: charts/ eventKey, eventsKey): the answer's own key before the mark. */
const PART_MARK = /#event(?:s|:[^#]*)$/u;

/**
 * The kept answers a picture counted as let go (`evicted`) though the spec declared their keys usable: the backend
 * holds them no more (its store made room), so the screen's memory of their scans is of nothing. By the answers' own
 * keys (a part's mark taken off), for the screen to forget those scans and ask them again. A key declared in any other
 * state is not one: its recording is on its way, failed, or was never asked.
 */
export function answersLetGo(excluded: ReadonlyArray<{ key: string; reason: string }>, declared: readonly FigureKey[]): string[] {
    const usable = new Set(declared.filter(entry => entry.state === 'usable').map(entry => entry.key));
    return [...new Set(excluded.filter(item => item.reason === 'evicted' && usable.has(item.key)).map(item => item.key.replace(PART_MARK, '')))];
}

/** What changed between two specs' keys: nothing, only answers going stale (no new answer yet), or more. */
export function keysChange(before: readonly FigureKey[], after: readonly FigureKey[]): 'same' | 'stale-only' | 'changed' {
    if (before.length !== after.length) return 'changed';
    const was = new Map(before.map(entry => [entry.key, entry]));
    let stale = false;
    for (const entry of after) {
        const old = was.get(entry.key);
        if (!old) return 'changed';
        if (old.version !== entry.version || JSON.stringify(old.level ?? null) !== JSON.stringify(entry.level ?? null) || old.calibrated !== entry.calibrated) return 'changed';
        if (old.state === entry.state) continue;
        // A usable answer that went stale or is being asked again, with no new one yet: the picture stays (rule 1).
        if (old.state === 'usable' && (entry.state === 'stale' || entry.state === 'pending')) { stale = true; continue; }
        return 'changed';
    }
    return stale ? 'stale-only' : 'same';
}

/** The keys that are not usable now: the lines of them are not read (第 6 節 1: 古くなった線の読み値を止める). */
export function unusableKeys(keys: readonly FigureKey[]): ReadonlySet<string> {
    return new Set(keys.filter(entry => entry.state !== 'usable').map(entry => entry.key));
}
