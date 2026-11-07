/**
 * R13: every plot is drawn by the one plot component (`paintOverlay`, stagePanes.ts), which marks its canvas
 * `data-plot`. A canvas on screen without the mark fails every ui-smoke test (canvasAudit.ts), unless it is listed
 * here: a plot still drawn its own way, waiting for its move (the numbers are the deviations of the unified plot
 * spec), or a layer of marks laid over a plot. The list only shrinks: a plot that moves over is taken off it.
 */
export const PLOTS_PENDING: ReadonlyArray<{ selector: string; why: string }> = [
    { selector: '.track-canvas:not(.track-spec-canvas)', why: '7: a track\'s waveform lane, drawn by waveformRenderer' },
    { selector: '.track-axis-canvas:not(.track-spec-axis)', why: '7: a waveform lane\'s amplitude axis, drawn apart from its plot' },
    { selector: '.track-spec-canvas', why: '4・7: a track\'s spectrogram lane; its colour bar is the shared one (8), its plot and time axis move with the waveform lanes' },
    { selector: '.track-spec-axis', why: '4・7: a spectrogram lane\'s frequency axis, drawn apart from its plot as the waveform lane\'s amplitude axis is' },
    { selector: '#ruler-canvas', why: '4: the track lanes\' time axis, drawn apart from them' },
];

/** Layers laid over a plot (its hover marks, a cursor): not plots of their own. */
export const PLOT_LAYERS: readonly string[] = ['.plot-hover-layer', '.track-spectrogram-overlay'];
