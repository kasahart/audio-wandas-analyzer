/**
 * Every function of the webview outside the Figure (src/webview/figure/, held by its own rules) that makes a drawing surface (a canvas
 * or an SVG made, written as markup, or a canvas's context taken), and whose it is: the charts of the table whose
 * canvases it makes (each painted by its chart's paintedBy), or why it is no chart. A function in a chart's
 * paintedBy needs no line here. The contract test finds every surface by type and markup, so a chart drawn its own
 * way is found.
 */
export const SURFACES: Readonly<Record<string, { charts: readonly string[] } | string>> = {
    'src/webview/runtime/canvasOverlays.ts:paintOverPlots': 'the cursor and loop lines on the layer laid over a Tracks row\'s Figure (PLOT_LAYERS, .track-row-layer): no data of its own',
    'src/webview/runtime/comparePanes.ts:legendHtml': 'a legend\'s line swatch beside a recording\'s name (its colour and whether it is the active one): no data drawn',
    'src/webview/runtime/pairSpectrum.ts:<module>': 'the reference button\'s icon: no data drawn',
    'src/webview/runtime/resultsPaneHtml.ts:resultsPaneHtml': { charts: ['time-ruler', 'pair-view'] },
    'src/webview/runtime/stepChips.ts:<module>': 'the step chips\' icons (slider, open, invalid, bypass): no data drawn',
    'src/webview/runtime/trackLaneHtml.ts:channelLaneHtml': 'the box a row\'s Figure is put in and the layer of cursor and loop lines over it (.track-row-layer): the picture is the Figure\'s, no data drawn here',
};
