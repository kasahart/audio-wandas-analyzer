/**
 * Every function of the webview outside the plot component (stagePanes.ts) that makes a drawing surface (a canvas
 * or an SVG made, written as markup, or a canvas's context taken), and whose it is: the charts of the table whose
 * canvases it makes (each painted by its chart's paintedBy), or why it is no chart. A function in a chart's
 * paintedBy needs no line here. The contract test finds every surface by type and markup, so a chart drawn its own
 * way is found.
 */
export const SURFACES: Readonly<Record<string, { charts: readonly string[] } | string>> = {
    'src/webview/runtime/compareReport.ts:pngOf': { charts: ['report-overlay', 'report-delta'] },
    'src/webview/runtime/comparisonRuntime.ts:drawWaveformMarks': 'the cursor, loop and pointer lines on the layer laid over a waveform lane (PLOT_LAYERS, .track-waveform-overlay): no data of its own',
    'src/webview/runtime/comparisonRuntime.ts:renderCursorLayers': 'the cursor lines on the layer laid over a spectrogram lane (PLOT_LAYERS, .track-spectrogram-overlay): no data of its own',
    'src/webview/runtime/comparisonRuntime.ts:renderStackedTracks': 'clears the lanes of a track whose analysis failed: nothing drawn',
    'src/webview/runtime/comparisonRuntime.ts:tracks': 'clears the other channels\' lanes while a step\'s picture is drawn on the first: nothing drawn',
    'src/webview/runtime/plotHoverLayer.ts:cover': 'draws the pointer\'s marks on the hover layer laid over a plot (PLOT_LAYERS): no data of its own',
    'src/webview/runtime/comparePanes.ts:legendHtml': 'a legend\'s line swatch beside a recording\'s name (its colour and whether it is the active one): no data drawn',
    'src/webview/runtime/entryTableHtml.ts:distributionHtml': { charts: ['entry-distribution'] },
    'src/webview/runtime/entryTableHtml.ts:entryScreenHtml': { charts: ['entry-held', 'entry-overview'] },
    'src/webview/runtime/pairSpectrum.ts:<module>': 'the reference button\'s icon: no data drawn',
    'src/webview/runtime/plotHoverLayer.ts:createPlotHoverLayer': 'the hover marks\' layer laid over a plot (PLOT_LAYERS, .plot-hover-layer): it draws the pointer\'s marks, no data of its own',
    'src/webview/runtime/resultsPaneHtml.ts:resultsPaneHtml': { charts: ['track-axes', 'cursor-spectrum', 'pair-view'] },
    'src/webview/runtime/stepChips.ts:<module>': 'the step chips\' icons (slider, open, invalid, bypass): no data drawn',
    'src/webview/runtime/trackLaneHtml.ts:channelLaneHtml': { charts: ['track-waveform', 'track-spectrogram', 'track-axes'] },
    'src/webview/runtime/trackStageMode.ts:createTrackStageMode': { charts: ['compare-overlay', 'compare-delta'] },
};
