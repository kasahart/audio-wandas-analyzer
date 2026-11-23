/**
 * The lanes under a trigger's events (トリガーの下の段): the figure spec, data only (figure-design.md 第 4 節).
 * Each recording as the trigger takes it (the step before the trigger) is a band lane of its own, over the
 * recording's own time, with the trigger declared on it: the key of its events of that recording, its level, how long
 * before its firing an event begins and how long it is, and the events the user left out. The figure service makes
 * the lane's guide lines of that (目安の線: the level, each firing, each stretch cut) and counts the events used;
 * nothing is computed here.
 */
import type { FigureKey, FigureSpec } from '../figure/index';

/** After a trigger step's key: when its events fired (transport/figure_answers.py EVENTS_MARK). */
export const eventsKey = (key: string): string => `${key}#events`;

/** The lane of the recording at `at` (from 0), and its one line (the recording's signal). */
export const TRIGGER_LANE = (at: number): string => `track${at + 1}`;
export const triggerLaneLine = (lane: string): string => `${lane}-signal`;
/** Which recording (from 0) a lane is of; -1 for none of these lanes. */
export const triggerLaneAt = (lane: string): number => { const found = /^track(\d+)$/u.exec(lane); return found ? Number(found[1]) - 1 : -1; };

export interface TriggerLanesInputs {
    /** The recordings, in the order their lanes are drawn. */
    readonly lanes: ReadonlyArray<{
        /** The key of the recording's signal as the trigger takes it, and its role (base, compare1 …), if it has one. */
        readonly signal: string;
        readonly role?: string;
        /** The key of the trigger step's events of this recording (eventsKey), and the events left out. */
        readonly events: string;
        readonly out: readonly number[];
    }>;
    readonly trigger: { readonly threshold: number; readonly pre: number; readonly duration: number };
    /** Every key the lanes name, each once, with the state and version answers/ gave it. */
    readonly keys: readonly FigureKey[];
}

export const triggerLanes = (s: TriggerLanesInputs): FigureSpec => ({
    lanes: s.lanes.map((lane, at) => ({
        id: TRIGGER_LANE(at),
        kind: 'band' as const,
        lines: [{ id: triggerLaneLine(TRIGGER_LANE(at)), of: { key: lane.signal }, ...(lane.role ? { role: lane.role } : {}) }],
        trigger: { events: lane.events, threshold: s.trigger.threshold, pre: s.trigger.pre, duration: s.trigger.duration, out: [...lane.out] },
    })),
    keys: [...s.keys],
});
