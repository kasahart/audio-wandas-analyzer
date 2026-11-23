/**
 * The Tracks screen's pair figure (2 チャンネル間の図): the figure spec, data only (figure-design.md 第 4 節).
 * From the reference channel to each other channel: the gain (dB), the phase (degrees)
 * and the coherence (0 to 1), every bin. What it draws, counts and reads is the figure service's, of the answers the
 * backend keeps by key (python-backend/services/tracks_answers.py keep_pair_lines).
 *
 * The three quantities are a lane each, one above another over one frequency axis, each on a value axis of its own
 * (`"axis": "own"`: 設計書 第 4 節「値の軸と座標変換は段ごと」). A lane holds one line a channel, declared in the
 * order drawn (仕様 1): the tracks' rows top to bottom, each row's channels in order.
 *
 * A channel with no kept lines (its pair is on its way, failed, does not overlap the reference or is too short to
 * average) has no line here: the screen leaves it out and says why beside the figure.
 */
import type { FigureKey, FigureLane, FigureSpec } from '../figure/index';

/** The three quantities, in the order of their lanes (top to bottom). */
export const PAIR_PARTS = ['gain', 'phase', 'coherence'] as const;
export type PairPart = typeof PAIR_PARTS[number];

/** One channel's three lines against the reference channel. */
export interface PairSpectrumLine {
    /** The channel's id: its track and channel (charts/cursorSpectrum.ts cursorLineId), the same whatever the range. */
    readonly id: string;
    /** The three kept answers' keys (each one's version is the key itself: tracks_answers.py). */
    readonly keys: Readonly<Record<PairPart, string>>;
    /** Whether both channels of the pair are calibrated: the gain's axis says when they are not (R4). */
    readonly calibrated: boolean;
}

/** A line's id on a lane: the quantity, then the channel's id. A lane's id is its quantity. */
export const pairLineId = (part: PairPart, channel: string): string => `${part}|${channel}`;
/** The quantity and channel a line id names; null for any other id. */
export const pairLineOf = (id: string): { part: PairPart; channel: string } | null => {
    const at = id.indexOf('|');
    const part = PAIR_PARTS.find(item => item === id.slice(0, at));
    return at > 0 && part ? { part, channel: id.slice(at + 1) } : null;
};

/** The spec of these lines on the lanes of `parts`; null with no line or no lane (the screen says there is no data). */
export const pairSpectrum = (lines: readonly PairSpectrumLine[], parts: readonly PairPart[] = PAIR_PARTS): FigureSpec | null => {
    const shown = PAIR_PARTS.filter(part => parts.includes(part));
    if (!lines.length || !shown.length) return null;
    const lanes: FigureLane[] = shown.map(part => ({
        id: part,
        kind: 'lines' as const,
        lines: lines.map(line => ({ id: pairLineId(part, line.id), of: { key: line.keys[part] } })),
        axis: 'own' as const,
    }));
    const keys: FigureKey[] = shown.flatMap(part => lines.map(line => ({ key: line.keys[part], state: 'usable' as const, version: line.keys[part], calibrated: line.calibrated })));
    return { lanes, keys };
};
