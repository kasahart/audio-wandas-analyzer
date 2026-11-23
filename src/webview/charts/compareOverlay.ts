/**
 * The comparison's spectrum overlay (比較台のスペクトルの重ね図) and its Δ lane: the figure spec, data only
 * (figure-design.md 第 4 節). This is all of the figure's code; what it draws, counts and reads is the figure
 * service's (python-backend/figures/).
 *
 * Lines are declared in the order they are drawn (仕様 1): the recordings with no role, the base (its recordings as a
 * set: whether it is one recording or their median is the figure service's to say, 計算ア, never the chart's; a
 * spectrum's group is never drawn a recording at a time), then compare 1 (the recording
 * compared), compare 2, 3 (the other slots). The Δ lane, on request, is compare 1 − the base. Ties of the pick go by
 * this order too (第 5 節 エ).
 *
 * Time signals (`signals`) are overlaid the same way on band lanes, except the base: no median is taken of sounds, so
 * each recording of the base is a line of its own, and the Δ lane is declared only against a base of one recording
 * (compare 1 − it, sample by sample).
 *
 * Images (`images`: a spectrogram, a roughness, a cepstrogram) are not overlaid: each recording is an image lane of
 * its own, in the same order (the base's recordings on screen, the compared ones, then those with no role). The
 * figure service looks at the lanes together: they show the same part and share one colour range.
 *
 * A trigger's events (`events`) are lines of one band lane over the time from their trigger, declared by the screen
 * in the order they are drawn (仕様 5): each recording's events by their number, a line each; a base group is one
 * line, the median of its recordings' events' means. No Δ lane: two recordings' events are not one another's.
 *
 * A lane a recording (`apart`: 「One lane per track」): the same lines, sounds or events not overlaid, each recording
 * on screen in a lane of its own, in the order the screen lists them (the tracks' own order, as the lanes always
 * were). No median and no Δ: every lane is one recording's own. The figure service looks at the lanes together (the
 * same part across, one range up).
 */
import type { FigureKey, FigureLine, FigureSpec } from '../figure/index';

export interface CompareOverlayInputs {
    /** The recordings on screen with no role, in display order: drawn first, under the rest. */
    readonly others: readonly string[];
    /**
     * The base's recordings (the table's order; empty: none), declared as one set with the base role. Whether its line
     * is one recording or their median is decided by the figure service (計算ア, members.py), never here.
     */
    readonly base: readonly string[];
    /** The recording compared (compare 1), then the other slots' recordings in slot order (compare 2, 3). */
    readonly compare: readonly string[];
    /** Whether the Δ lane is shown (compare 1 − the base). */
    readonly delta: boolean;
    /** The step shown is the sound itself (time signals): band lanes, the base a recording at a time. */
    readonly signals?: boolean;
    /** The step shown is an image: a lane a recording (never overlaid, no Δ lane). */
    readonly images?: boolean;
    /** The step shown is a trigger's: these lines (events, or a base group's median of means), in this order, on one band lane. */
    readonly events?: readonly FigureLine[];
    /**
     * Not overlaid: a lane a recording on screen (lines, sounds, or a trigger's events by their recording). The
     * recordings' keys in the lanes' order, top to bottom (events: the lines are declared in that order already).
     */
    readonly apart?: readonly string[];
    /** Every key the lines name, each once, with the state and version answers/ gave it. */
    readonly keys: readonly FigureKey[];
}

/** The line ids: the base's, compare n's, the n-th recording with no role's, and the Δ's. */
export const OVERLAY_LINE = {
    base: 'base',
    /** A base recording's own line, where the base is drawn a recording at a time (time signals). */
    baseEach: (n: number): string => `base${n}`,
    compare: (n: number): string => `compare${n}`,
    other: (n: number): string => `other${n}`,
    delta: 'delta',
} as const;

export const OVERLAY_LANE = 'overlay';
/** An image's lane, named by its one line. */
export const IMAGE_LANE = (line: string): string => `image-${line}`;
/** A recording's own lane where the lines are not overlaid, named by the recording's line. */
export const OWN_LANE = (line: string): string => `own-${line}`;
/** The recording's line of a lane that is one recording's (an image's, or its own lane of lines); null for any other lane. */
export const imageLaneLine = (lane: string): string | null => (lane.startsWith('image-') ? lane.slice('image-'.length) : lane.startsWith('own-') ? lane.slice('own-'.length) : null);
/** A trigger's event's line: its recording's line and the event's number from 1. */
export const eventLine = (line: string, number: number): string => `${line}#${number}`;
export const DELTA_LANE = 'delta';

/** Whether a line id is the base's (its one line, or one of its recordings' own). */
export const isBaseLine = (id: string): boolean => id === OVERLAY_LINE.base || /^base\d+$/u.test(id);

const signalOverlay = (s: CompareOverlayInputs): FigureSpec => {
    const lines: FigureLine[] = [
        ...s.others.map((key, at) => ({ id: OVERLAY_LINE.other(at + 1), of: { key } })),
        ...s.base.map((key, at) => ({ id: OVERLAY_LINE.baseEach(at + 1), of: { key }, role: 'base' })),
        ...s.compare.map((key, at) => ({ id: OVERLAY_LINE.compare(at + 1), of: { key }, role: `compare${at + 1}` })),
    ];
    const compared = s.compare[0];
    const delta = s.delta && compared !== undefined && s.base.length === 1;
    return {
        lanes: [
            { id: OVERLAY_LANE, kind: 'band', lines },
            ...(delta ? [{ id: DELTA_LANE, kind: 'band' as const, lines: [{ id: OVERLAY_LINE.delta, of: { delta: { compare: compared, base: [s.base[0]] } }, role: 'compare1' }] }] : []),
        ],
        keys: [...s.keys],
    };
};

const imageLanes = (s: CompareOverlayInputs): FigureSpec => {
    const lines: FigureLine[] = [
        ...s.base.map((key, at) => ({ id: OVERLAY_LINE.baseEach(at + 1), of: { key }, role: 'base' })),
        ...s.compare.map((key, at) => ({ id: OVERLAY_LINE.compare(at + 1), of: { key }, role: `compare${at + 1}` })),
        ...s.others.map((key, at) => ({ id: OVERLAY_LINE.other(at + 1), of: { key } })),
    ];
    return { lanes: lines.map(line => ({ id: IMAGE_LANE(line.id), kind: 'image' as const, lines: [line] })), keys: [...s.keys] };
};

/**
 * A lane a recording, of lines over one axis (`band`: of sounds), in the order of `order` (the recordings' keys). A
 * base recording's line on a lines lane is declared as the base is everywhere (its set, here of one: that recording's
 * own answer, 計算ア).
 */
const ownLanes = (s: CompareOverlayInputs, order: readonly string[], band: boolean): FigureSpec => {
    const lines: Array<[string, FigureLine]> = [
        ...s.base.map((key, at): [string, FigureLine] => [key, { id: OVERLAY_LINE.baseEach(at + 1), of: band ? { key } : { median: [key] }, role: 'base' }]),
        ...s.compare.map((key, at): [string, FigureLine] => [key, { id: OVERLAY_LINE.compare(at + 1), of: { key }, role: `compare${at + 1}` }]),
        ...s.others.map((key, at): [string, FigureLine] => [key, { id: OVERLAY_LINE.other(at + 1), of: { key } }]),
    ];
    const place = (key: string): number => { const at = order.indexOf(key); return at < 0 ? order.length : at; };
    // (A stable sort: recordings the order does not name keep their declared order, after the rest.)
    const lanes = [...lines].sort((a, b) => place(a[0]) - place(b[0])).map(([, line]) => ({ id: OWN_LANE(line.id), kind: band ? 'band' as const : 'lines' as const, lines: [line] }));
    return { lanes, keys: [...s.keys] };
};

/** A trigger's events a lane a recording: the lines as declared, each in the lane of its recording's line. */
const eventLanes = (lines: readonly FigureLine[], keys: readonly FigureKey[]): FigureSpec => {
    const lanes = new Map<string, FigureLine[]>();
    for (const line of lines) {
        const lane = OWN_LANE(line.id.split('#')[0]);
        lanes.set(lane, [...(lanes.get(lane) ?? []), line]);
    }
    return { lanes: [...lanes].map(([id, own]) => ({ id, kind: 'band' as const, lines: own })), keys: [...keys] };
};

/** A trigger's event is named as any answer (transport/figure_answers.py EVENT_MARK): its step's key, this mark, its number (or `mean`). */
export const eventKey = (key: string, event: number | 'mean'): string => `${key}#event:${event}`;

export const compareOverlay = (s: CompareOverlayInputs): FigureSpec => {
    if (s.events) return s.apart && s.events.length ? eventLanes(s.events, s.keys) : { lanes: [{ id: OVERLAY_LANE, kind: 'band', lines: [...s.events] }], keys: [...s.keys] };
    if (s.images) return imageLanes(s);
    if (s.apart) return ownLanes(s, s.apart, !!s.signals);
    if (s.signals) return signalOverlay(s);
    const baseKeys = [...s.base];
    const base: FigureLine[] = baseKeys.length ? [{ id: OVERLAY_LINE.base, of: { median: baseKeys }, role: 'base' }] : [];
    const lines: FigureLine[] = [
        ...s.others.map((key, at) => ({ id: OVERLAY_LINE.other(at + 1), of: { key } })),
        ...base,
        ...s.compare.map((key, at) => ({ id: OVERLAY_LINE.compare(at + 1), of: { key }, role: `compare${at + 1}` })),
    ];
    const compared = s.compare[0];
    const delta = s.delta && compared !== undefined && baseKeys.length > 0;
    return {
        lanes: [
            { id: OVERLAY_LANE, kind: 'lines', lines },
            ...(delta ? [{ id: DELTA_LANE, kind: 'lines' as const, lines: [{ id: OVERLAY_LINE.delta, of: { delta: { compare: compared, base: baseKeys } }, role: 'compare1' }] }] : []),
        ],
        keys: [...s.keys],
    };
};
