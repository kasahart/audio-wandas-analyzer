/**
 * The Tracks screen's cursor spectrum (カーソルスペクトル): the figure spec, data only (figure-design.md 第 4 節).
 * This is all of the figure's code; what it draws, counts and reads is the figure
 * service's (python-backend/figures/), of the answers the backend keeps by key (python-backend/services/tracks_answers.py).
 *
 * A line is one channel of one recording at the cursor. Lines are declared in the order they are drawn (仕様 1): the
 * tracks' rows top to bottom, each row's channels in order, so the last row is drawn on top; the order never follows
 * the levels (it does not change while playing).
 *
 * One lane holds the lines of one unit and reference (仕様 2: a lane's value axis is of one). Recordings in other
 * units or references (a sound pressure in Pa beside an acceleration, or beside an uncalibrated recording) are each
 * on a lane of their own, one above another over one frequency axis (`"axis": "own"`: the figure service matches a
 * lane's lines among its own keys). The lanes are in the order their first line is declared. With one unit and
 * reference there is one lane.
 *
 * A channel with no kept answer (its answer is on its way, failed, or its cursor is past the recording's end) has no
 * line here: the screen leaves it out of `lines`. While an answer is on its way the screen shows the spec it showed
 * last (the Figure keeps its last picture).
 */
import type { FigureKey, FigureLane, FigureSpec } from '../figure/index';

/** What a channel's levels are in: its unit, reference value and reference label (the backend's level identity). */
export interface CursorLevel {
    readonly unit: string;
    readonly ref: number;
    readonly label: string;
}

/** One channel's line at the cursor, in the order the rows show them. */
export interface CursorSpectrumLine {
    /** The line's id: its track and channel (cursorLineId), the same whatever the cursor. */
    readonly id: string;
    /** The kept answer's key (its version is the key itself: tracks_answers.py). */
    readonly key: string;
    readonly level: CursorLevel;
    /** Whether the channel is calibrated: the axis and the line say so (R4); calibrated and not share a lane. */
    readonly calibrated: boolean;
}

/** A line's id: the track (its id, the same while the track lives) and the channel's index from 0. */
export const cursorLineId = (track: string, channel: number): string => `${track}:${channel}`;
/** The track and channel a line id names; null for any other id. */
export const cursorLineOf = (id: string): { track: string; channel: number } | null => {
    const at = id.lastIndexOf(':');
    const channel = at > 0 ? Number(id.slice(at + 1)) : Number.NaN;
    return Number.isInteger(channel) && channel >= 0 ? { track: id.slice(0, at), channel } : null;
};

/** The lane of the first unit and reference declared; the others are named after their place (cursorLane). */
export const CURSOR_LANE = 'spectrum';
export const cursorLane = (at: number): string => (at === 0 ? CURSOR_LANE : `${CURSOR_LANE}-${at + 1}`);

/** One name per unit, reference and label: two levels with the same name are on one lane. */
const levelName = (level: CursorLevel): string => JSON.stringify([level.unit, level.ref, level.label]);

/** The spec of these lines; null with no line (a lane of no line is not a figure: the screen says there is no data). */
export const cursorSpectrum = (lines: readonly CursorSpectrumLine[]): FigureSpec | null => {
    if (!lines.length) return null;
    const groups = new Map<string, CursorSpectrumLine[]>();
    for (const line of lines) {
        const name = levelName(line.level);
        groups.set(name, [...(groups.get(name) ?? []), line]);
    }
    const own = groups.size > 1;
    const lanes: FigureLane[] = [...groups.values()].map((group, at) => ({
        id: cursorLane(at),
        kind: 'lines' as const,
        lines: group.map(line => ({ id: line.id, of: { key: line.key } })),
        ...(own ? { axis: 'own' as const } : {}),
    }));
    // Each key once: two tracks of one file at one place name the same kept answer.
    const keys = new Map<string, FigureKey>();
    for (const line of lines) {
        if (!keys.has(line.key)) keys.set(line.key, { key: line.key, state: 'usable', version: line.key, level: { ...line.level }, calibrated: line.calibrated });
    }
    return { lanes, keys: [...keys.values()] };
};
