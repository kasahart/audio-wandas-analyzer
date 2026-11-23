/**
 * What the contract test scans the code for: the functions that write a number (VALUE_HELPERS and the number
 * primitives).
 */

/**
 * The functions that only turn a number into text, or compute a range, an order or a statistic for the functions that
 * show it (`src/…ts:function`): their callers are what the table registers. A call of one of these (or of a number
 * primitive: toFixed, toPrecision, toExponential, toLocaleString) is a value-producing path.
 */
export const VALUE_HELPERS: readonly string[] = [
    ...['withMinus', 'frequencyText', 'secondsText', 'amountText', 'tableValueText', 'quefrencyText', 'lagText', 'levelText', 'signedNumberText', 'signedText', 'significant', 'stepText', 'spacingDecimals', 'fieldDecimals', 'exactFieldText'].map(name => `src/webview/shell/numberText.ts:${name}`),
    ...['formatMeasurementNumber', 'formatMeasuredLevel', 'formatClockTime', 'formatReportDuration', 'uiNumber'].map(name => `src/shared/utils/format.ts:${name}`),
    ...['niceStep', 'niceTicks', 'niceRange', 'niceRangeOnStep', 'heatmapDbRange', 'widened', 'roundOff'].map(name => `src/shared/utils/ticks.ts:${name}`),
    'src/shared/utils/csv.ts:csvNumber',
    'src/webview/runtime/entryTableHtml.ts:formatValue',
    'src/webview/runtime/comparePanes.ts:level',
    'src/webview/figure/axisNames.ts:exponentText',
    'src/webview/runtime/figureModel.ts:laneAmplitudeRange',
    'src/webview/runtime/figureModel.ts:ceilTo',
    // The specified range's ends (R9; figureModel.ts names them).
    ...['fieldWindow', 'atDecimals'].map(name => `src/webview/figure/fieldWindow.ts:${name}`),
    // Tick placement and text (figure/ticks.ts).
    ...['valueTickTexts', 'valueAxisTicks', 'alongAxisTicks', 'tickTexts', 'alongTickValues'].map(name => `src/webview/figure/ticks.ts:${name}`),
    // The value axis's name and a tick's text (figure/).
    'src/webview/figure/axisNames.ts:valueAxisName', 'src/webview/figure/axisNames.ts:lineAxisNames', 'src/webview/figure/axisNames.ts:colourAxisName', 'src/webview/figure/ticks.ts:at',
];

/** Functions that write a number nobody reads as a value of a chart, each with why. */
export const NOT_CHART_VALUES: Readonly<Record<string, string>> = {
    'src/webview/runtime/comparisonRuntime.ts:zoomedAmplitude': 'the amplitude window a row\'s Figure is asked to show (the range typed, or the linked peak\'s): a view sent with the row\'s spec, which the Figure writes; not written here',
    'src/webview/runtime/comparisonRuntime.ts:moveCursor': 'the lanes\' data-cursor-at attribute (where the time cursor is on the lanes\' axis, s) for the test that a lane\'s click moves it to the time read, not shown',
    'src/webview/runtime/comparisonRuntime.ts:startComparisonRuntime': 'the page\'s layout markup (buildLayout): toolbar states and counts of the files listed, not a chart\'s value',
    'src/webview/runtime/comparisonRuntime.ts:syncRoleChips': 'a track\'s role chip (base, compare 1–3): which slot it is, not a value',
    'src/webview/runtime/roleChip.ts:attachRoleChips': 'the role chip\'s menu of slots (compare 1–3), not a value',
    'src/webview/runtime/comparisonRuntime.ts:syncSelectionSummary': 'how many of the files listed are shown (3/10) on the folded side panel, a count of files, not a chart\'s value',
    'src/webview/runtime/entryRuntime.ts:syncColumns': 'the table\'s column count for the layout (data-cols), not shown',
    'src/webview/runtime/offsetInlineEditor.ts:openOffsetEditor': 'the offset field\'s starting text, the user\'s own setting in milliseconds',
    'src/webview/runtime/separatorKeys.ts:syncHandle': 'a splitter\'s aria-valuenow / min / max in pixels, for assistive technology: a layout position, not a value',
    'src/webview/runtime/spectrogramSettingsPopover.ts:syncFromSettings': 'the STFT and display settings fields\' text, the user\'s own settings',
    'src/shared/analysis/calibrationModel.ts:validateCalibrationFactorInput': 'the calibration form\'s own error message about the factor typed',
    'src/webview/runtime/plotInteraction.ts:notePlotWindow': 'a plot\'s data-plot-window attribute for the plot contract test, not shown',
    'src/webview/runtime/trackStageMode.ts:paintNow': 'the comparison\'s words around its Figure (how many events each recording found, counts in data attributes for tests, a step\'s reason): the figure\'s own numbers are the figure service\'s and the Figure\'s (docs/figure-list.md)',
    'src/webview/runtime/trackStageMode.ts:drawn': 'how many lanes under a trigger\'s events are drawn, in a data attribute for tests, not shown',
    'src/webview/runtime/pairSpectrumPanel.ts:applySplit': 'the pair pane\'s CSS height, not a value',
    'src/webview/runtime/stepBarModel.ts:startValues': 'a new step\'s starting parameter (the trigger level, two figures of the tracks\' peak), a setting the user edits',
    'src/webview/runtime/stepForm.ts:field': 'a step parameter\'s field, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:fieldNumber': 'a step chip\'s parameter, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:stepLabel': 'a step chip\'s parameter, the user\'s own setting',
    'src/shared/recipe/channelSelection.ts:withBaseInput': 'a Recipe\'s region end, kept to the microsecond: a setting, not a value shown',
    'src/webview/shell/rangePopover.ts:openAxisPart': 'the axis range field\'s starting text (the painted ends, exactly: exactFieldText, R9), which the user edits',
    'src/webview/runtime/compareReport.ts:reportFiles': 'the report\'s Recipe with its base input (withBaseInput): a setting',
    'src/webview/runtime/comparisonRuntime.ts:currentOffsetMs': 'a track\'s time offset in whole milliseconds for the offset field the user edits',
    'src/webview/runtime/compareBasics.ts:regionLabel': 'the comparison\'s region as its root\'s data-region attribute says it, for tests: a key, not shown',
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
};
