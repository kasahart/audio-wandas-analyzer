/**
 * The webview's half of the spectrogram's shared test data: what the code before the
 * figure service answered, for python-backend/tests/fixtures/figure_heatmap_cases.json. Recorded through these calls
 * and replayed through them (src/test/figureHeatmapCases.test.ts):
 * the automatic colour range of a dB heatmap from its full data's lowest and highest value (ticks.heatmapDbRange).
 * The cell cases of the file are the figure service's now (python-backend/test_figures_heatmap.py).
 */
import { heatmapDbRange } from '../../shared/utils/ticks';

export interface ColourRangeInput { low: number; high: number }
export interface CellIndexInput { axis: number[]; log: boolean; open: { low: boolean; high: boolean }; values: number[] }

/** The colour range of a dB heatmap whose full data spans `low` … `high` dB. */
export const runColourRange = (input: ColourRangeInput): unknown => heatmapDbRange(input.low, input.high);

/** A number as the JSON holds it (no number as "nan" / "inf" / "-inf", −0 as 0). */
export const jsonNumber = (value: number): number | string => (Number.isNaN(value) ? 'nan' : value === Infinity ? 'inf' : value === -Infinity ? '-inf' : value + 0);
