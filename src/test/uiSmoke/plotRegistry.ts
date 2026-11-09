/**
 * R13: every plot is drawn by the one plot component (`paintOverlay`, stagePanes.ts), which marks its canvas
 * `data-plot`. A canvas on screen without the mark fails every ui-smoke test (canvasAudit.ts), unless it is listed
 * here: a plot still drawn its own way, waiting for its move (the numbers are the deviations of the unified plot
 * spec), or a layer of marks laid over a plot. The list only shrinks: a plot that moves over is taken off it.
 */
export const PLOTS_PENDING: ReadonlyArray<{ selector: string; why: string }> = [];

/** Layers laid over a plot (its hover marks, a cursor): not plots of their own. */
export const PLOT_LAYERS: readonly string[] = ['.plot-hover-layer', '.track-spectrogram-overlay', '.track-waveform-overlay'];

/**
 * Plots drawn into by more than the plot component (lines added over its picture by their own code), waiting to
 * become layers of paintOverlay. The audit fails any other. The list only shrinks.
 */
export const DRAWN_OUTSIDE_PENDING: ReadonlyArray<{ selector: string; why: string }> = [];

/** Charts drawn as SVG, waiting for their move to the plot component. The list only shrinks. */
export const SVG_CHARTS_PENDING: ReadonlyArray<{ selector: string; why: string }> = [];
