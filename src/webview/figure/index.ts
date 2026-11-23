/**
 * The Figure's public face (figure-design.md 第 8 節): what a screen makes a Figure with, the signals it gives,
 * and the spec's types a chart is written in. Nothing else of src/webview/figure/ is for screens or charts.
 */
export { createFigure, FigureExportDropped, type Figure, type FigureInspection, type FigureLineName, type FigureOptions, type FigurePick, type FigurePlacedLane, type FigureRange, type FigureSelection, type FigureSignals, type FigureTable, type FigureTypedAxis, type FigureWords } from './figure';
export type { FigureColumn, FigureKey, FigureLane, FigureLine, FigureMembers, FigureSpec, FigureView } from '../answers/protocol';
export { withLegend, type LegendEntry } from './pngLegend';
