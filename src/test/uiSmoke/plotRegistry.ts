/**
 * R13: every plot is drawn by the one plot component (`paintOverlay`, stagePanes.ts), which marks its canvas
 * `data-plot`. A canvas on screen without the mark fails every ui-smoke test (canvasAudit.ts), unless it is listed
 * here: a plot still drawn its own way, waiting for its move (the numbers are the deviations of the unified plot
 * spec), or a layer of marks laid over a plot. The list only shrinks: a plot that moves over is taken off it.
 */
export const PLOTS_PENDING: ReadonlyArray<{ selector: string; why: string }> = [
    { selector: '.track-canvas:not(.track-spec-canvas)', why: '4: a track\'s waveform lane, drawn by waveformRenderer; its axes follow the plot rules (laneAxes.ts, 7), its gestures are its own' },
    { selector: '.track-axis-canvas:not(.track-spec-axis)', why: '4: a waveform lane\'s amplitude axis, by the plot rules (laneAxes.ts) on a canvas of its own beside the lane' },
    { selector: '.track-spec-canvas', why: '4: a track\'s spectrogram lane; its colour bar is the shared one (8), its plot and time axis move with the waveform lanes' },
    { selector: '.track-spec-axis', why: '4: a spectrogram lane\'s frequency axis, by the plot rules (laneAxes.ts) on a canvas of its own' },
    { selector: '#ruler-canvas', why: '4: the track lanes\' time axis, by the plot rules (laneAxes.ts), drawn once above them' },
];

/** Layers laid over a plot (its hover marks, a cursor): not plots of their own. */
export const PLOT_LAYERS: readonly string[] = ['.plot-hover-layer', '.track-spectrogram-overlay'];
