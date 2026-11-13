/**
 * The plot contract table's shapes. The table is one file per chart (charts/<id>.ts), gathered by index.ts:
 * every chart the webview shows or exports, and for each every value a user reads off it, where it is computed, what
 * data it is computed from, and the tests that hold it to that. Rows are recorded against claude/graph-contract as it
 * is; a row another branch is changing names that branch (`inFlight`).
 */

export type Severity = 'P1' | 'P2' | 'P3';

/** What a value is computed from. */
export type Source =
    /** Every bin, sample, frame or row of data that is also drawn thinned (the backend's Frame, or arrays the webview holds whole). */
    | 'full'
    /** Nothing was thinned: what is drawn is every point (bars, every bin, a histogram), or the value has no thinned form (a scan's metric, a count). */
    | 'whole'
    /** Points thinned to be drawn that keep each bucket's lowest and highest: the extremes are the full data's. */
    | 'extremes'
    /** Points thinned to be drawn by averaging (power-averaged cells, a display cut): not the full data's values. */
    | 'thinned'
    /** The axis's range or window on screen, not the data (ticks, a range popover's fields). */
    | 'axis'
    /** A value the user set or the file's metadata (a region, an offset, a threshold, a sample rate). */
    | 'input'
    /** Words: an axis's name. */
    | 'words';

export type ValueKind =
    | 'readout' | 'step' | 'delta' | 'median' | 'headline' | 'order' | 'range' | 'ticks' | 'axis' | 'export' | 'count' | 'summary' | 'label'
    /** Which data a value is of: a cache key, a match of a kept result to the one on screen. */
    | 'identity'
    /** What a plot shows while the data a value is read from is on its way. */
    | 'pending'
    /** What a click on the plot acts on (selects, toggles, goes to, moves the cursor to): the point its readout reads (R7, R13). */
    | 'click';

export interface TestRef {
    file: string;
    name: string;
    /** The test sets up data whose full resolution and drawn points differ, and checks the value is the full data's. */
    tells?: boolean;
}

/** A row as its chart's file writes it; index.ts adds its chart. */
export interface RowSpec {
    /** `<chart>.<value>`, unique. */
    id: string;
    value: ValueKind;
    /** What the user reads (Japanese, as docs/display-rules.md). */
    what: string;
    /** Where it is computed: `src/…ts:function` (a webview or shared function) or `python-backend/…py:function`. */
    computedIn: readonly string[];
    from: Source;
    /** How it gets there, traced through the code. */
    trace: string;
    tests: readonly TestRef[];
    /** An axis's name: whether it says the quantity, its unit, and for dB its reference. */
    names?: { quantity: boolean; unit: boolean; reference?: boolean };
    /** Not yet held: why, and how a strict reviewer would rate it. The chart's knownGaps lists every one. */
    gap?: { severity: Severity; why: string };
    /** An exception docs/display-rules.md approves: the rule, and the words of it that say so (quoted exactly). */
    exception?: { rule: string; quote: string };
    /** A rule of docs/display-rules.md the code does not keep here: the rule, and its words it does not keep (quoted exactly). */
    breaks?: { rule: string; quote: string };
    /** Another branch is changing this row. */
    inFlight?: string;
}

export interface ContractRow extends RowSpec { chart: string }

export interface Chart {
    id: string;
    name: string;
    /** The functions that draw or write it (`src/…ts:function`): every call of the plot component is in one chart. */
    paintedBy: readonly string[];
    /** Canvases plotRegistry.ts lists (PLOTS_PENDING) that are this chart's. */
    registry?: readonly string[];
    /** The kinds of value the chart must have rows for. */
    requires: readonly ValueKind[];
}

/** One chart's file: the chart, its rows, and its gaps with their severities (exactly its rows' gaps; only shrinks). */
export interface ChartContract {
    chart: Chart;
    rows: readonly RowSpec[];
    knownGaps: Readonly<Record<string, Severity>>;
}

export const t = (file: string, name: string): TestRef => ({ file, name });
/** A test that tells the full data from the drawn points (TestRef.tells). */
export const tt = (file: string, name: string): TestRef => ({ file, name, tells: true });
export const SP = 'src/webview/runtime/stagePanes.ts';
export const RT = 'src/webview/runtime/comparisonRuntime.ts';
/** What every plot's click acts on: the readout's read (PlotHoverLayer.clicked), handed to the plot's tap by clickOnRead. */
export const CLICK_READ = ['src/webview/runtime/plotHoverLayer.ts:clickOnRead', 'src/webview/runtime/plotHoverLayer.ts:clicked'] as const;
/** The browser test that clicks every plot with a click at its ties, overlapping points, bin edges and gaps (R7, R13). */
export const CLICK_TEST = 'every plot with a click acts on the point its readout reads at the press: the same pick and identity at ties, overlapping points, bin edges and gaps, never a hit test of its own (R7, R13)';
/** The test of the shared gestures that a press is read where it is pressed, and its click acts on that read. */
export const PRESS_READ_TEST = 'a press is read where it is pressed and holds that read until it is let go: a move within the drag threshold reads nothing new, so a click acts on what the readout read at the press (R7, R13)';
