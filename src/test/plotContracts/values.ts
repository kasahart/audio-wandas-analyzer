/**
 * What the contract test scans the code for: the functions that write a number (VALUE_HELPERS and the number
 * primitives), and the backend's functions that compute with thinned points (PY_DECIMATORS, BACKEND_READERS).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SP } from './model';

/**
 * The functions that only turn a number into text, or compute a range, an order or a statistic for the functions that
 * show it (`src/…ts:function`): their callers are what the table registers. A call of one of these (or of a number
 * primitive: toFixed, toPrecision, toExponential, toLocaleString) is a value-producing path.
 */
export const VALUE_HELPERS: readonly string[] = [
    ...['withMinus', 'frequencyText', 'secondsText', 'amountText', 'quefrencyText', 'lagText', 'barkText', 'levelText', 'signedNumberText', 'signedText', 'significant', 'stepText', 'spacingDecimals', 'fieldDecimals', 'colourDecimals', 'exactDecimals', 'exactFieldText'].map(name => `src/webview/plot/plotText.ts:${name}`),
    ...['formatMeasurementNumber', 'formatMeasuredLevel', 'formatClockTime', 'formatReportDuration'].map(name => `src/shared/utils/format.ts:${name}`),
    ...['niceStep', 'niceTicks', 'niceRange', 'widened', 'round'].map(name => `src/shared/utils/ticks.ts:${name}`),
    'src/shared/utils/levels.ts:powerMeanDb', 'src/shared/utils/levels.ts:powerMeanOrNull',
    'src/shared/dataset/distribution.ts:median', 'src/shared/dataset/distribution.ts:binCounts',
    'src/webview/runtime/entryTable.ts:csvNumber', 'src/webview/runtime/entryTable.ts:quantile',
    'src/webview/runtime/entryTableHtml.ts:plotValueText', 'src/webview/runtime/entryTableHtml.ts:formatValue',
    'src/webview/runtime/comparePanes.ts:minMaxLine', 'src/webview/runtime/comparePanes.ts:signed', 'src/webview/runtime/comparePanes.ts:level', 'src/webview/runtime/comparePanes.ts:medianOfSome', 'src/webview/runtime/comparePanes.ts:bandsAt',
    'src/webview/runtime/compareReport.ts:dB',
    'src/webview/runtime/stagePanes.ts:valueText',
    // The exponent written into an axis's quantity ("Amplitude^3"), as the backend writes it in the unit.
    'src/webview/runtime/stagePanes.ts:exponentText',
    'src/webview/runtime/spectrumRuntime.ts:spectrumReadoutValues',
    'src/webview/plot/waveformLayer.ts:waveformRange',
    'src/webview/draw/canvasDrawers.ts:formatHz',
    ...['laneAmplitudeTicks', 'laneTimeTicks'].map(name => `src/webview/runtime/laneAxes.ts:${name}`),
    'src/webview/runtime/figureModel.ts:laneAmplitudeRange',
    ...['floorTo', 'ceilTo', 'colourScale', 'windowEnds', 'fieldWindow', 'atDecimals'].map(name => `src/webview/runtime/figureModel.ts:${name}`),
    ...['secondaryDbWindow', 'rightAxisLeftRange', 'frequencyWindowHz', 'spectrumDbRangeAfterZoom', 'spectrumVisibleWindow'].map(name => `src/webview/runtime/spectrumRuntime.ts:${name}`),
    ...['shownFrequencyHz', 'visibleFrequencyHz', 'zoomBy'].map(name => `src/webview/runtime/spectrumView.ts:${name}`),
    'src/webview/runtime/pairSpectrumPanel.ts:frequencyAxis',
    ...['valueTickTexts', 'valueAxisTicks', 'rowAxisTicks', 'alongAxisTicks', 'tickTexts', 'timeDigits', 'colourEndText', 'ticks', 'stageRange', 'stageDiffRange', 'roundEdge', 'robustEdge', 'overlayOrder', 'byLevel', 'levelBinsOf', 'timeText', 'atValue', 'drawnLevelsText', 'readoutOf', 'windowed', 'linearWindowEnds'].map(name => `${SP}:${name}`),
];

/** Functions that write a number nobody reads as a value of a chart, each with why. */
export const NOT_CHART_VALUES: Readonly<Record<string, string>> = {
    'src/webview/runtime/comparisonRuntime.ts:drawSpectrogram': 'the lane\'s data-spectrogram-band / -window / data-colour-bar attributes for the plot tests, not shown',
    'src/webview/runtime/comparisonRuntime.ts:drawTrackWaveform': 'the lane\'s data-waveform-height attribute (CSS px) for the plot tests, not shown',
    'src/webview/runtime/comparisonRuntime.ts:startComparisonRuntime': 'the page\'s layout markup (buildLayout): toolbar states and counts of the files listed, not a chart\'s value',
    'src/webview/runtime/comparisonRuntime.ts:syncRoleChips': 'a track\'s role chip (base, compare 1–3): which slot it is, not a value',
    'src/webview/runtime/roleChip.ts:attachRoleChips': 'the role chip\'s menu of slots (compare 1–3), not a value',
    'src/webview/runtime/comparisonRuntime.ts:syncSelectionSummary': 'how many of the files listed are shown (3/10) on the folded side panel, a count of files, not a chart\'s value',
    'src/webview/runtime/entryHeldPlot.ts:paint': 'the held slot\'s number (its key 1–9) in the held plot\'s title, not a value',
    'src/webview/runtime/entryRuntime.ts:syncColumns': 'the table\'s column count for the layout (data-cols), not shown',
    'src/webview/runtime/offsetInlineEditor.ts:openOffsetEditor': 'the offset field\'s starting text, the user\'s own setting in milliseconds',
    'src/webview/runtime/pairSpectrumPanel.ts:noteCursorHz': 'the data-cursor-hz attribute for the linked-cursor tests, not shown',
    'src/webview/runtime/separatorKeys.ts:syncHandle': 'a splitter\'s aria-valuenow / min / max in pixels, for assistive technology: a layout position, not a value',
    'src/webview/runtime/spectrogramSettingsPopover.ts:syncFromSettings': 'the STFT and display settings fields\' text, the user\'s own settings',
    'src/shared/analysis/calibrationModel.ts:validateCalibrationFactorInput': 'the calibration form\'s own error message about the factor typed',
    'src/webview/draw/canvasDrawers.ts:frequencyAxisTicks': 'the old frequency ticks, used only by the test snapshot (testSnapshot.ts)',
    'src/webview/runtime/laneAxes.ts:markLanePlot': 'the lane\'s data-plot-window attribute for the plot contract test, not shown',
    'src/webview/runtime/plotInteraction.ts:notePlotWindow': 'a plot\'s data-plot-window attribute for the plot contract test, not shown',
    'src/webview/runtime/entrySidePlots.ts:paint': 'the side plots\' data-window attribute for tests, not shown',
    'src/webview/runtime/trackStageMode.ts:span': 'a zoom window in a data attribute and a request key, not shown',
    'src/webview/runtime/figureModel.ts:sourceAxisKey': 'a source axis\'s count, first, last and step in the key pictures are counted on one axis by, not shown',
    'src/webview/runtime/pairSpectrumPanel.ts:applySplit': 'the pair pane\'s CSS height, not a value',
    'src/webview/runtime/stepBarModel.ts:startValues': 'a new step\'s starting parameter (the trigger level, two figures of the tracks\' peak), a setting the user edits',
    'src/webview/runtime/stepForm.ts:field': 'a step parameter\'s field, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:fieldNumber': 'a step chip\'s parameter, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:stepLabel': 'a step chip\'s parameter, the user\'s own setting',
    'src/shared/recipe/channelSelection.ts:withBaseInput': 'a Recipe\'s region end, kept to the microsecond: a setting, not a value shown',
    'src/webview/plot/axisTitle.ts:scaledFont': 'a CSS font size in pixels, not a value',
    'src/webview/runtime/stagePanes.ts:paintValueTitle': 'the axis name\'s font size (scaledFont), not a value',
    'src/webview/runtime/stagePanes.ts:paintValueTicks': 'the tick numbers\' font size (scaledFont) to keep clear of the axis name; the numbers are valueTickTexts\'',
    'src/webview/rangePopover.ts:openAxisPart': 'the axis range field\'s starting text (the painted ends, exactly: exactFieldText, R9), which the user edits',
    'src/webview/runtime/spectrumView.ts:field': 'the cursor spectrum dB range field\'s starting text (the painted end, exactly), which the user edits',
    'src/webview/runtime/entryDistributionPane.ts:openAxisRange': 'the value axis range field\'s starting text (the painted ends, exactly), which the user edits',
    'src/webview/runtime/spectrumView.ts:applyRightDbFields': 'the left level axis\'s range set from the right-hand one\'s typed ends (a setting the user typed), made at the right one\'s numbers',
    'src/webview/runtime/spectrumView.ts:frequencyRangeFieldsHz': 'the cursor spectrum frequency range field\'s starting text (the painted ends, exactly), which the user edits',
    'src/webview/runtime/comparisonRuntime.ts:openSpectrumRangePopup': 'the cursor spectrum right-hand level axis range field\'s starting text (the painted ends, exactly), which the user edits',
    'src/webview/runtime/compareReport.ts:reportRecipe': 'the region a report\'s Recipe is cut to, kept to the microsecond: a setting',
    'src/webview/runtime/compareReport.ts:reportDefinitions': 'the report\'s Recipe (reportRecipe): a setting',
    'src/webview/runtime/compareReport.ts:reportOctaveRecipe': 'the report\'s Recipe (reportRecipe): a setting',
    'src/webview/runtime/comparisonRuntime.ts:currentOffsetMs': 'a track\'s time offset in whole milliseconds for the offset field the user edits',
    'src/webview/runtime/entryTable.ts:measuredRegion': 'the region measured, kept to the microsecond: the edges the user set, less the guard',
    'src/webview/runtime/trackStagePainter.ts:paintBaseGate': 'the time a base scan will take, in whole seconds or minutes on its button',
    'src/webview/runtime/stepBar.ts:add': 'a new step\'s parameters, the user\'s own setting',
    'src/webview/runtime/stepBar.ts:addRegion': 'a new region step\'s edges, the user\'s own setting',
    'src/webview/runtime/stepBar.ts:regionDraft': 'a region step\'s edges as typed, the user\'s own setting',
    'src/webview/runtime/stepChips.ts:stepChipHtml': 'a step chip\'s text about its parameters, the user\'s own setting',
    'src/webview/runtime/stepForm.ts:checkStepForm': 'a step form\'s check of the parameters typed, the user\'s own setting',
    'src/webview/runtime/stepForm.ts:regionFormDraft': 'a region step\'s edges as typed, the user\'s own setting',
    'src/webview/runtime/stepForm.ts:stepFormHtml': 'a step form\'s fields, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:bandRange': 'a step chip\'s band, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:formatNumber': 'a step chip\'s parameter, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:hzLabel': 'a step\'s frequency parameter, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:hzText': 'a step\'s frequency parameter, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:invalidReason': 'why a step\'s parameter is refused, with the limit it is held to',
    'src/webview/runtime/stepMenu.ts:item': 'a step menu item\'s parameter, the user\'s own setting',
    'src/webview/waveform/waveformRenderer.ts:toX': 'a pixel position cleaned of float noise, not a value',
    'src/webview/waveform/waveformRenderer.ts:paintLoopRegion': 'the loop region\'s pixel positions (toX), not a value',
};

/**
 * The backend's side of "thinned points are only drawn" (python-backend/drawn_points_contract.json): the functions
 * that thin data to draw it, and every function that computes with thinned points with what it does with them.
 * The webview needs no such list: there a thinned point is typed `Drawn` (src/shared/provenance.ts) and the compiler
 * refuses to compute with it. Python has no such type, so scripts/check_decimation_flow.py follows the data instead,
 * and reads the same JSON file.
 */
export interface BackendReader {
    /** 'draws': it only makes the picture (checked by data flow). 'value': a number is made of thinned points (a gap). */
    use: 'draws' | 'value';
    why: string;
}
const BACKEND_CONTRACT = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', '..', 'python-backend', 'drawn_points_contract.json'), 'utf8')) as { decimators: string[]; readers: Record<string, BackendReader> };
export const PY_DECIMATORS: readonly string[] = BACKEND_CONTRACT.decimators;
export const BACKEND_READERS: Readonly<Record<string, BackendReader>> = BACKEND_CONTRACT.readers;
