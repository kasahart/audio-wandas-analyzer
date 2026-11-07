/**
 * R13: every plot is drawn by the one plot component (`paintOverlay`, stagePanes.ts), which marks its canvas
 * `data-plot`. A canvas on screen without the mark fails every ui-smoke test (canvasAudit.ts), unless it is listed
 * here: a plot still drawn its own way, waiting for its move (the numbers are the deviations of the unified plot
 * spec), or a layer of marks laid over a plot. The list only shrinks: a plot that moves over is taken off it.
 */
export const PLOTS_PENDING: ReadonlyArray<{ selector: string; why: string }> = [
    { selector: '.track-axis-canvas:not(.track-spec-axis)', why: 'a waveform lane\'s amplitude axis (the lane\'s data-plot-axis), by the plot rules (laneAxes.ts) on a canvas of its own beside the lane' },
    { selector: '.track-spec-axis', why: 'a spectrogram lane\'s frequency axis (the lane\'s data-plot-axis), by the plot rules (laneAxes.ts) on a canvas of its own' },
    { selector: '#ruler-canvas', why: 'the track lanes\' shared time axis, by the plot rules (laneAxes.ts), drawn once above them' },
];

/** Layers laid over a plot (its hover marks, a cursor): not plots of their own. */
export const PLOT_LAYERS: readonly string[] = ['.plot-hover-layer', '.track-spectrogram-overlay'];
