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
    /** The functions that draw or write it (`src/…ts:function`). */
    paintedBy: readonly string[];
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
export const RT = 'src/webview/runtime/comparisonRuntime.ts';
/**
 * The tests that hold each tick label of a chart's vertical axes (its level or value axis, a heatmap's rows, a
 * right-hand level axis) at the place its axis paints the number the label writes (display rules R9, R14), at several
 * vertical zooms where the chart zooms: the plot contract's 'tick places' (plotContract.spec.ts, whole, box-zoomed and
 * typed to a narrow window). Every chart with a ticks row names one of them in it (plotContracts.test.ts).
 */
export const TICK_PLACES = {
    comparison: t('src/test/uiSmoke/plotContract.spec.ts', 'every plot the comparison shows answers the same gestures: readout above it, ← / → step it, Ctrl+wheel zoom, double-click reset, axis range, both axes named (R13)'),
    trigger: t('src/test/uiSmoke/plotContract.spec.ts', 'a trigger\'s events plot and the lanes under it answer the same gestures as every plot (R13)'),
    distribution: t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s distribution answers the same gestures as every plot: each group\'s row, on the value axis below them (R13)'),
    spectrum: t('src/test/uiSmoke/plotContract.spec.ts', 'the cursor spectrum answers the same gestures as every plot (R13)'),
    spectrumRight: t('src/test/uiSmoke/plotContract.spec.ts', 'the cursor spectrum with two level references answers the axis gestures on its right-hand axis as on its left (A48, R13)'),
    pair: t('src/test/uiSmoke/plotContract.spec.ts', 'the pair view\'s gain, phase and γ² plots answer the same gestures as every plot (R13)'),
    lanes: t('src/test/uiSmoke/plotContract.spec.ts', 'the track view\'s waveform and spectrogram lanes answer the same gestures as every plot: readout in the toolbar above them (R13)'),
} as const;
