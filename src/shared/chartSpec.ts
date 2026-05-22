/**
 * ChartSpec IR — the wire contract between python-backend/recipe_runner.py
 * and the webview renderer in src/webview/chartSpecRenderScript.ts.
 *
 * Kept hand-mirrored from python-backend/chart_spec.py. The
 * src/test/chartSpecSchema.test.ts test spawns python -m chart_spec and
 * compares its JSON Schema output against a checked-in snapshot at
 * src/test/__snapshots__/chartSpecSchema.json — any drift between the two
 * sides surfaces there.
 */

export type ChartKind = 'line' | 'heatmap' | 'bar' | 'scalar';

export interface LineSeries {
    name: string;
    ys: number[];
    unit?: string;
}

export interface LineChart {
    kind: 'line';
    title: string;
    xLabel: string;
    yLabel: string;
    xs: number[];
    series: LineSeries[];
    xScale?: 'linear' | 'log';
    yScale?: 'linear' | 'log' | 'db';
}

export interface HeatmapChart {
    kind: 'heatmap';
    title: string;
    xLabel: string;
    yLabel: string;
    xs: number[];
    ys: number[];
    matrix: number[][];
    unit?: string;
    colormap?: string;
    vmin?: number;
    vmax?: number;
}

export interface BarSeries {
    name: string;
    values: number[];
    unit?: string;
}

export interface BarChart {
    kind: 'bar';
    title: string;
    xLabel: string;
    yLabel: string;
    categories: string[];
    series: BarSeries[];
}

export interface ScalarRow {
    label: string;
    value: number | string;
    unit?: string;
}

export interface ScalarTable {
    kind: 'scalar';
    title: string;
    rows: ScalarRow[];
}

export type ChartSpec = LineChart | HeatmapChart | BarChart | ScalarTable;

export interface RecipeRunnerResult {
    charts: ChartSpec[];
}

export function isLineChart(c: ChartSpec): c is LineChart {
    return c.kind === 'line';
}

export function isHeatmapChart(c: ChartSpec): c is HeatmapChart {
    return c.kind === 'heatmap';
}

export function isBarChart(c: ChartSpec): c is BarChart {
    return c.kind === 'bar';
}

export function isScalarTable(c: ChartSpec): c is ScalarTable {
    return c.kind === 'scalar';
}
