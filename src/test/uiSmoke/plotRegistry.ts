/**
 * R13: every chart is drawn by the Figure (src/webview/figure/), which marks its canvas `data-figure`. Any other
 * canvas on screen fails every ui-smoke test (canvasAudit.ts), unless it is an axis the screen paints on a canvas of
 * its own (`data-plot-axis-canvas`) or one of these: layers of marks laid over a plot (a Tracks row's cursor and loop
 * lines), which are no plots of their own.
 */
export const PLOT_LAYERS: readonly string[] = ['.track-row-layer'];
