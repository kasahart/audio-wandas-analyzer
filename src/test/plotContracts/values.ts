/**
 * What the contract test scans the code for: the functions that write a number (VALUE_HELPERS and the number
 * primitives), and the functions that read drawn (thinned) arrays (DRAWN_FIELDS, DRAWN_ACCESSORS, PY_DECIMATORS),
 * each classified in DRAWN_READERS so a row's `from` is checked against what its functions read.
 */
import { SP } from './model';

/**
 * The functions that only turn a number into text, or compute a range, an order or a statistic for the functions that
 * show it (`src/…ts:function`): their callers are what the table registers. A call of one of these (or of a number
 * primitive: toFixed, toPrecision, toExponential, toLocaleString) is a value-producing path.
 */
export const VALUE_HELPERS: readonly string[] = [
    ...['withMinus', 'frequencyText', 'secondsText', 'amountText', 'quefrencyText', 'lagText', 'barkText', 'levelText', 'signedNumberText', 'signedText', 'significant', 'stepText', 'spacingDecimals', 'fieldNumberText'].map(name => `src/webview/plot/plotText.ts:${name}`),
    ...['formatMeasurementNumber', 'formatMeasuredLevel', 'formatClockTime', 'formatReportDuration'].map(name => `src/shared/utils/format.ts:${name}`),
    ...['niceStep', 'niceTicks', 'niceRange', 'widened', 'round'].map(name => `src/shared/utils/ticks.ts:${name}`),
    'src/shared/utils/levels.ts:powerMeanDb', 'src/shared/utils/levels.ts:powerMeanOrNull',
    'src/shared/dataset/distribution.ts:median', 'src/shared/dataset/distribution.ts:binCounts',
    'src/webview/runtime/entryTable.ts:csvNumber', 'src/webview/runtime/entryTable.ts:quantile',
    'src/webview/runtime/entryTableHtml.ts:plotValueText', 'src/webview/runtime/entryTableHtml.ts:formatValue',
    'src/webview/runtime/comparePanes.ts:minMaxLine', 'src/webview/runtime/comparePanes.ts:signed', 'src/webview/runtime/comparePanes.ts:level', 'src/webview/runtime/comparePanes.ts:medianOfSome', 'src/webview/runtime/comparePanes.ts:bandsAt',
    'src/webview/runtime/compareReport.ts:dB',
    'src/webview/runtime/spectrumRuntime.ts:spectrumReadoutValues',
    'src/webview/plot/waveformLayer.ts:waveformRange',
    'src/webview/draw/canvasDrawers.ts:formatHz',
    ...['laneAmplitudeTicks', 'laneTimeTicks'].map(name => `src/webview/runtime/laneAxes.ts:${name}`),
    'src/webview/runtime/figureModel.ts:laneAmplitudeRange',
    ...['valueTickTexts', 'valueAxisTicks', 'rowAxisTicks', 'alongAxisTicks', 'tickTexts', 'timeDigits', 'colourEndText', 'ticks', 'stageRange', 'stageDiffRange', 'roundEdge', 'robustEdge', 'overlayOrder', 'byLevel', 'levelBinsOf', 'timeText', 'atValue', 'atText', 'drawnLevelsText', 'readoutOf'].map(name => `${SP}:${name}`),
];

/** Functions that write a number nobody reads as a value of a chart, each with why. */
export const NOT_CHART_VALUES: Readonly<Record<string, string>> = {
    'src/shared/analysis/calibrationModel.ts:validateCalibrationFactorInput': 'the calibration form\'s own error message about the factor typed',
    'src/webview/draw/canvasDrawers.ts:frequencyAxisTicks': 'the old frequency ticks, used only by the test snapshot (testSnapshot.ts)',
    'src/webview/runtime/laneAxes.ts:markLanePlot': 'the lane\'s data-plot-window attribute for the plot contract test, not shown',
    'src/webview/runtime/plotInteraction.ts:notePlotWindow': 'a plot\'s data-plot-window attribute for the plot contract test, not shown',
    'src/webview/runtime/entrySidePlots.ts:paint': 'the side plots\' data-window attribute for tests, not shown',
    'src/webview/runtime/trackStageMode.ts:span': 'a zoom window in a data attribute and a request key, not shown',
    'src/webview/runtime/pairSpectrumPanel.ts:applySplit': 'the pair pane\'s CSS height, not a value',
    'src/webview/runtime/stepBarModel.ts:startValues': 'a new step\'s starting parameter (the trigger level, two figures of the tracks\' peak), a setting the user edits',
    'src/webview/runtime/stepForm.ts:field': 'a step parameter\'s field, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:fieldNumber': 'a step chip\'s parameter, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:stepLabel': 'a step chip\'s parameter, the user\'s own setting',
    'src/shared/recipe/channelSelection.ts:withBaseInput': 'a Recipe\'s region end, kept to the microsecond: a setting, not a value shown',
    'src/webview/plot/axisTitle.ts:scaledFont': 'a CSS font size in pixels, not a value',
    'src/webview/runtime/stagePanes.ts:paintValueTitle': 'the axis name\'s font size (scaledFont), not a value',
    'src/webview/runtime/stagePanes.ts:paintValueTicks': 'the tick numbers\' font size (scaledFont) to keep clear of the axis name; the numbers are valueTickTexts\'',
    'src/webview/rangePopover.ts:openAxisPart': 'the axis range field\'s starting text (shownNumber), which the user edits',
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
 * The arrays the backend or the webview thinned to draw, by the type that carries them: a property access of one of
 * these on a value of that type is a read of drawn points (found with the type checker).
 */
export const DRAWN_FIELDS: Readonly<Record<string, readonly string[]>> = {
    StageView: ['values', 'matrix', 'waveform', 'events'],
    SpectrumSlice: ['values'],
    SpectrogramData: ['values'],
    WaveformEnvelope: ['min', 'max'],
};

/** Functions whose result is drawn points: a call of one is a read of drawn points too. Each reads DRAWN_FIELDS itself. */
export const DRAWN_ACCESSORS: readonly string[] = [`${SP}:points`];

/** The backend's functions that thin data to draw it: a def that calls one reads (or makes) drawn points. */
export const PY_DECIMATORS: readonly string[] = [
    ...['decimated_waveform'].map(name => `python-backend/decimator.py:${name}`),
    ...['min_max_indices', 'min_max_line', 'min_max_rows', 'spectrum_line', 'samples_waveform', '_time_blocks', '_block_peaks', '_signed_peaks', '_envelope', '_cepstrum_envelope'].map(name => `python-backend/stage_view.py:${name}`),
    ...['resample_frequency_bins', '_resample_time_bins', 'min_max_spectrum'].map(name => `python-backend/analyzer.py:${name}`),
];

export type DrawnUse =
    /** Reads drawn points only to draw them, place marks, or tell what kind of picture it is: no number comes of them. */
    | 'draws'
    /** Reads drawn points as values only where they are every point (a band table's bars, events drawn whole). */
    | 'whole'
    /** A number shown comes of drawn points: its rows are from 'extremes' or 'thinned'. */
    | 'value';

/**
 * Every function the scan finds reading drawn points (and every backend def that calls a decimator), with
 * what it does with them. A row from full data may name no 'value' reader; a row from thinned points must name one.
 */
export const DRAWN_READERS: Readonly<Record<string, { use: DrawnUse; why: string }>> = {
    [`${SP}:emptyStageText`]: { use: 'draws', why: 'whether a picture has events, for its empty note' },
    [`${SP}:eventLayers`]: { use: 'draws', why: 'a layer per event drawn; its readout reads the event\'s full samples' },
    [`${SP}:extent`]: { use: 'whole', why: 'the lowest and highest value: the full data\'s valueRange; the drawn points only of a picture the webview holds whole (a band table, a level line)' },
    [`${SP}:fullPoint`]: { use: 'draws', why: 'whether the layer is a signal drawn as itself, to place a full point on its range' },
    ['src/webview/runtime/fullRead.ts:wholeBars']: { use: 'whole', why: 'a band table\'s bars, which the backend sends whole (every band), held as their InlineFullSource' },
    [`${SP}:isEventsView`]: { use: 'draws', why: 'whether a picture is a trigger\'s events' },
    [`${SP}:lineRead`]: { use: 'draws', why: 'whether the layer is a signal drawn as itself' },
    [`${SP}:paint`]: { use: 'draws', why: 'draws a signal\'s envelope' },
    [`${SP}:paintPlot`]: { use: 'draws', why: 'draws the pictures' },
    [`${SP}:points`]: { use: 'whole', why: 'every drawn value of a picture, for the range of one without valueRange (which the webview holds whole)' },
    [`${SP}:screenLevels`]: { use: 'whole', why: 'a line\'s level on screen from its values only where the webview holds every value; else levelBins or its full read (R6)' },
    [`${SP}:stageAxes`]: { use: 'draws', why: 'whether a picture is a signal, for the amplitude axis\'s name' },
    [`${SP}:stageDiffRange`]: { use: 'whole', why: 'the Δ\'s auto range from extent: the full Δ\'s valueRange' },
    [`${SP}:stageEventCounts`]: { use: 'whole', why: 'counts a picture\'s events, every one of which it carries' },
    [`${SP}:stageHeadline`]: { use: 'draws', why: 'whether the Δ is an image, to write the backend\'s peak with a y' },
    [`${SP}:stageRange`]: { use: 'whole', why: 'an auto range from extent: the full data\'s valueRange (a signal\'s from its absolute peak)' },
    [`${SP}:strokeStageLine`]: { use: 'draws', why: 'draws a line' },
    ['python-backend/analyzer.py:build_waveform_envelope']: { use: 'draws', why: "thins the lanes' samples to draw them (decimated_waveform); the readout reads the full samples (track-waveform)" },
    ['python-backend/analyzer.py:min_max_spectrum']: { use: 'draws', why: "cuts a spectrum row to its drawn buckets (min_max_rows); its range is every bin's, taken before" },
    ['python-backend/stage_combine.py:_image']: { use: 'draws', why: "reduces a combined picture's cells to draw them (_signed_peaks); its colour range is the full cells' (with_value_range)" },
    ['python-backend/stage_combine.py:_line']: { use: 'draws', why: 'thins a combined line to draw it; its range, level bins and Δ peak are of the full data (with_value_range, with_level_bins, difference_peak)' },
    ['python-backend/stage_combine.py:_signal_line']: { use: 'draws', why: 'picks the samples of a combined signal to draw (min_max_indices); its readout reads the full samples' },
    ['python-backend/stage_combine.py:difference_line']: { use: 'draws', why: "a difference's drawn buckets (min_max_line); its headline's peak is of the full difference (difference_peak)" },
    ['python-backend/stage_combine.py:draw']: { use: 'draws', why: 'a combined picture as drawn (samples_waveform of the full samples); every number of it is of the full data' },
    ['python-backend/stage_view.py:_cepstral_view']: { use: 'draws', why: "draws a cepstrum's envelope; its readout reads the full coefficients" },
    ['python-backend/stage_view.py:_cepstrogram_view']: { use: 'draws', why: "reduces a cepstrogram's cells to draw them; its colour range is every full cell's" },
    ['python-backend/stage_view.py:_cepstrum_envelope']: { use: 'draws', why: "a cepstrum's drawn envelope (_envelope)" },
    ['python-backend/stage_view.py:_channel_view']: { use: 'draws', why: 'draws a series over time as its envelope; its readout and range are of the full series' },
    ['python-backend/stage_view.py:_correlation_view']: { use: 'draws', why: "draws a correlation's envelope; its readout reads the full lags" },
    ['python-backend/stage_view.py:_detail_view']: { use: 'draws', why: 'draws the part on screen again finer; every number is read from the full data (full_read)' },
    ['python-backend/stage_view.py:_envelope']: { use: 'draws', why: "a line's drawn envelope (min_max_line)" },
    ['python-backend/stage_view.py:_events_view']: { use: 'draws', why: "draws each event's line and their mean as envelopes; the readout reads each event's full samples" },
    ['python-backend/stage_view.py:_roughness_view']: { use: 'draws', why: "averages roughness cells per time block to draw them; its colour range is every full cell's" },
    ['python-backend/stage_view.py:_signed_peaks']: { use: 'draws', why: "a block's drawn extreme (_block_peaks)" },
    ['python-backend/stage_view.py:_spectral_view']: { use: 'draws', why: 'draws a spectrum line (spectrum_line); its readout and range are of every bin' },
    ['python-backend/stage_view.py:_waveform']: { use: 'draws', why: "draws the signal by the lanes' decimation (samples_waveform); its readout reads the full samples" },
    ['python-backend/stage_view.py:min_max_line']: { use: 'draws', why: "a line's drawn buckets (min_max_indices)" },
    ['python-backend/stage_view.py:min_max_rows']: { use: 'draws', why: "a row's drawn buckets" },
    ['python-backend/stage_view.py:samples_waveform']: { use: 'draws', why: "a waveform's drawn envelope; its absolute peak is of the samples it is given, whole" },
    ['python-backend/stage_view.py:spectrum_line']: { use: 'draws', why: "a spectrum's drawn buckets (min_max_line)" },
    ['python-backend/analysis_service.py:spectrum_slice']: { use: 'draws', why: 'cuts the row to draw it (min_max_spectrum); minDb / maxDb are every bin\'s, taken before (cursor-spectrum.range)' },
    ['python-backend/analyzer.py:_build_spectrogram']: { use: 'draws', why: 'resamples the cells to draw them; minDb / maxDb are every full cell\'s, taken before (track-spectrogram.range)' },
    ['python-backend/stage_view.py:_spectrogram_view']: { use: 'draws', why: 'power-averages the cells per time block to draw them; the colour range is every full cell\'s (valueRange, compare-overlay.range-image)' },
    ['src/shared/protocol/backendProtocol.ts:hasAlignedEnvelopeArrays']: { use: 'draws', why: 'checks an answer\'s envelope arrays line up; shows nothing' },
    ['src/shared/protocol/backendProtocol.ts:hasSpectrogramShape']: { use: 'draws', why: 'checks an answer\'s spectrogram shape; shows nothing' },
    ['src/webview/runtime/compareReport.ts:deltaFigure']: { use: 'whole', why: 'the report Δ figure\'s range: every bin\'s Δ (binsView\'s valueRange) and every band\'s (report-delta.range)' },
    ['src/webview/runtime/comparisonRuntime.ts:exportCsv']: { use: 'whole', why: 'starts writeCsvWhenDetailed' },
    ['src/webview/runtime/comparisonRuntime.ts:writeCsvWhenDetailed']: { use: 'whole', why: 'writes a slice only when it holds every bin, else waits or leaves it out (spectrum-csv.export)' },
    ['src/webview/runtime/overlaySpectrumPainter.ts:spectrumLayer']: { use: 'whole', why: 'reads a slice\'s values as every bin when it has no frequenciesHz, and a cut one from laneReads; a stand-in (the lane spectrogram\'s column meanwhile, the floor past the end) is drawn and never read or measured (cursor-spectrum.pending)' },
    ['src/webview/runtime/runtimeExports.ts:buildSpectrumCsv']: { use: 'whole', why: 'writes a slice that holds every bin (spectrum-csv.export)' },
    ['src/webview/runtime/trackCanvasPainter.ts:laneSpectrogramView']: { use: 'draws', why: 'the lane\'s picture of its display spectrogram' },
    ['src/webview/runtime/trackCanvasPainter.ts:laneWaveform']: { use: 'draws', why: 'the lane\'s picture of its envelope' },
    ['src/webview/runtime/trackStageMode.ts:events']: { use: 'draws', why: 'the events drawn, for the exclusion marks' },
    ['src/webview/runtime/trackStageMode.ts:paintNow']: { use: 'draws', why: 'whether a picture is a signal, to paint it' },
    ['src/webview/runtime/trackStageMode.ts:snapshot']: { use: 'draws', why: 'a test hook\'s summary of what is drawn' },
    ['src/webview/runtime/trackStageModel.ts:pictureSummary']: { use: 'draws', why: 'a test hook\'s count and median of the drawn points, not shown' },
    ['src/webview/runtime/trackStageModel.ts:plotsOf']: { use: 'draws', why: 'whether pictures are signals, to choose how to draw them' },
    ['src/webview/runtime/trackStagePainter.ts:eventsOf']: { use: 'draws', why: 'the events drawn, as layers' },
    ['src/webview/spectrum/cursorSpectrum.ts:extractSpectrumAtCursor']: { use: 'draws', why: 'until the backend\'s slice at this cursor is in (a cached slice of an earlier cursor is not it: sliceIsAtCursor), the lane\'s display spectrogram column is drawn, marked a stand-in that is never read (cursor-spectrum.pending)' },
};
