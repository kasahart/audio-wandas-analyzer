/**
 * The shape of the comparison overlay's shared test data, python-backend/tests/fixtures/figure_overlay_cases.json
 *: the scenes and the inputs of its recorded cases.
 *
 * The cases were recorded from the old path's code (the track stage's overlay and Δ canvases) before it was deleted
 *; the old path can no longer be run, so the file is not regenerated. It is the new Figure's test
 * data now: src/test/figureComponent.test.ts and python-backend/test_figure_overlay_cases.py replay it.
 *
 * Every number goes into JSON as it is; a value that is no number is "nan", "inf" or "-inf" (pick_cases.json's way).
 */

/** A part of each whole axis, 0..1 (a recorded case's zoom). */
type PlotWindow = { x: { start: number; end: number }; y: { start: number; end: number } };

/** A value of a line as the JSON holds it: a number, or "nan" / "inf" / "-inf" (no number). */
export type JsonValue = number | 'nan' | 'inf' | '-inf';
export type LineId = 'median' | 'compare' | 'other' | 'delta';
export interface LineSpec { xs: number[]; values: JsonValue[] }
/** The figure's data: the base group's median, the compared recording, a track with no role, and their Δ. */
export interface Scene {
    lines: Record<LineId, LineSpec>;
    /** The frequency axis's stated limits (StageView.xLimits), log. */
    xLimits: [number, number];
    /** The plot frames asked for, in CSS px. */
    overlayBox: { width: number; height: number };
    diffBox: { width: number; height: number };
}
export type Pane = 'overlay' | 'diff';

/** A number as the JSON holds it. */
export const jsonNumber = (value: number): JsonValue => (Number.isNaN(value) ? 'nan' : value === Infinity ? 'inf' : value === -Infinity ? '-inf' : value + 0);

// ── R7: the pointer's read ─────────────────────────────────────────────────────────────────────────────────────

export interface R7Input {
    scene: string;
    pane: Pane;
    window?: PlotWindow;
    diffY?: { start: number; end: number };
    /** CSS px from the pane's frame's top left. */
    pointer: { x: number; y: number };
    /** Arrow keys pressed after the hover, in order. */
    steps?: Array<-1 | 1>;
}

// ── R9: the range fields ───────────────────────────────────────────────────────────────────────────────────────

export interface R9Input {
    scene: string;
    pane: Pane;
    axis: 'x' | 'y';
    window?: PlotWindow;
    diffY?: { start: number; end: number };
    /** What is typed in the fields before Apply (null: left as shown); "" clears a field (that end automatic). */
    type?: { min: string | null; max: string | null };
}

// ── R13: the one arbitration of presses ────────────────────────────────────────────────────────────────────────

export type PlotName = 'overlay' | 'diff' | 'lane';
export interface PressEvent {
    /** down / move (button held) / up / dblclick / lost (a move with no button: the release was lost). */
    type: 'down' | 'move' | 'up' | 'dblclick' | 'lost';
    on: PlotName | 'body';
    /** CSS px on a 100 × 100 px plot. */
    x: number;
    y: number;
    detail?: number;
    /** Time since the sequence began (ms): told, though the arbitration reads no clock (a double click is the browser's `detail`). */
    t_ms: number;
}
export interface R13Input { events: PressEvent[] }

// ── A click waiting for its read ───────────────────────────────────────────────────────────────────────────────

export interface PendingStep {
    /** move: the pointer over the pane; down / up: a press and its release there (detail: the browser's count);
     *  answer / fail: the backend answers (or fails) every read of the compared line asked so far; redraw: the figure
     *  painted anew; remove: the pane's canvas taken off the page; press_other: a press and release on the Δ pane;
     *  drag: a press dragged past the threshold and let go; lost: a press whose release is lost (a move with no button). */
    do: 'move' | 'down' | 'up' | 'answer' | 'fail' | 'redraw' | 'remove' | 'press_other' | 'drag' | 'lost';
    at?: { x: number; y: number };
    detail?: number;
}
export interface PendingInput {
    scene: string;
    fetchedCompare: boolean;
    steps: PendingStep[];
    /** (Recorded with the old figure's own gestures instead of the click path with a recording act.) */
    stageTap?: boolean;
}

// ── The range fields' text ─────────────────────────────────────────────────────────────────────────────────────

export interface RangeTextInput {
    /** An end as painted: the text the field writes for it and what Apply parses that text back to. */
    end?: JsonValue;
    /** Text typed into both fields, parsed by the popover's own Apply. */
    typed?: { min: string; max: string };
}
