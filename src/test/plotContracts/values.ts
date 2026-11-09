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
    ...['withMinus', 'frequencyText', 'secondsText', 'amountText', 'quefrencyText', 'lagText', 'barkText', 'levelText', 'signedNumberText', 'signedText', 'significant'].map(name => `src/webview/plot/plotText.ts:${name}`),
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
    'src/webview/draw/canvasDrawers.ts:formatHz', 'src/webview/draw/canvasDrawers.ts:formatDbLevel',
    ...['laneAmplitudeRange', 'laneAmplitudeTicks', 'laneTimeTicks'].map(name => `src/webview/runtime/laneAxes.ts:${name}`),
    ...['valueTickTexts', 'valueAxisTicks', 'rowAxisTicks', 'alongAxisTicks', 'tickText', 'levelTick', 'ticks', 'stageRange', 'stageDiffRange', 'roundEdge', 'robustEdge', 'overlayOrder', 'byLevel', 'levelBinsOf', 'timeText', 'atValue', 'atText', 'drawnLevelsText', 'readoutOf'].map(name => `${SP}:${name}`),
];

/** Functions that write a number nobody reads as a value of a chart, each with why. */
export const NOT_CHART_VALUES: Readonly<Record<string, string>> = {
    'src/shared/analysis/calibrationModel.ts:validateCalibrationFactorInput': 'the calibration form\'s own error message about the factor typed',
    'src/webview/draw/canvasDrawers.ts:frequencyAxisTicks': 'the old frequency ticks, used only by the test snapshot (testSnapshot.ts)',
    'src/webview/runtime/testSnapshot.ts:spectrogramAxisLabelTexts': 'a test hook\'s snapshot of the axis texts',
    'src/webview/runtime/testSnapshot.ts:spectrumAxisLabelTexts': 'a test hook\'s snapshot of the axis texts',
    'src/webview/runtime/laneAxes.ts:markLanePlot': 'the lane\'s data-plot-window attribute for the plot contract test, not shown',
    'src/webview/runtime/plotInteraction.ts:setWindow': 'a plot\'s data-plot-window attribute for the plot contract test, not shown',
    'src/webview/runtime/entrySidePlots.ts:paint': 'the side plots\' data-window attribute for tests, not shown',
    'src/webview/runtime/trackStageMode.ts:span': 'a zoom window in a data attribute and a request key, not shown',
    'src/webview/runtime/pairSpectrumPanel.ts:applySplit': 'the pair pane\'s CSS height, not a value',
    'src/webview/runtime/stepBarModel.ts:startValues': 'a new step\'s starting parameter (the trigger level, two figures of the tracks\' peak), a setting the user edits',
    'src/webview/runtime/stepForm.ts:field': 'a step parameter\'s field, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:fieldNumber': 'a step chip\'s parameter, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:stepLabel': 'a step chip\'s parameter, the user\'s own setting',
};

/**
 * The arrays the backend or the webview thinned to draw, by the type that carries them: a property access of one of
 * these on a value of that type is a read of drawn points (found with the type checker).
 */
export const DRAWN_FIELDS: Readonly<Record<string, readonly string[]>> = {
    StageView: ['values', 'matrix', 'waveform', 'events'],
    SpectrumSlice: ['values', 'minDb', 'maxDb'],
    SpectrogramData: ['values', 'minDb', 'maxDb'],
    WaveformEnvelope: ['min', 'max'],
};

/** Functions whose result is drawn points: a call of one is a read of drawn points too. Each reads DRAWN_FIELDS itself. */
export const DRAWN_ACCESSORS: readonly string[] = [`${SP}:points`, `${SP}:linePointAt`, `${SP}:linePointsNear`];

/** The backend's functions that thin data to draw it: a def that calls one reads (or makes) drawn points. */
export const PY_DECIMATORS: readonly string[] = [
    ...['decimated_waveform'].map(name => `python-backend/decimator.py:${name}`),
    ...['min_max_indices', 'min_max_line', 'min_max_rows', 'spectrum_line', 'samples_waveform', '_time_blocks', '_block_peaks', '_signed_peaks', '_envelope', '_shared_envelope', '_cepstrum_envelope'].map(name => `python-backend/stage_view.py:${name}`),
    ...['resample_frequency_bins', '_resample_time_bins', 'min_max_spectrum'].map(name => `python-backend/analyzer.py:${name}`),
];

export type DrawnUse =
    /** Reads drawn points only to draw them, place marks, or tell what kind of picture it is: no number comes of them. */
    | 'draws'
    /** Reads drawn points as values only where they are every point (bars, a layer whose full is 'drawn', events drawn whole). */
    | 'whole'
    /** A number shown comes of drawn points: its rows are from 'extremes' or 'thinned'. */
    | 'value';

/**
 * Every function the scan finds reading drawn points (and every backend def a row names that calls a decimator), with
 * what it does with them. A row from full data may name no 'value' reader; a row from thinned points must name one.
 */
export const DRAWN_READERS: Readonly<Record<string, { use: DrawnUse; why: string }>> = {
    [`${SP}:emptyStageText`]: { use: 'draws', why: 'whether a picture has events, for its empty note' },
    [`${SP}:eventLayers`]: { use: 'draws', why: 'a layer per event drawn; its readout reads the event\'s full samples' },
    [`${SP}:extent`]: { use: 'value', why: 'the lowest and highest drawn point, for stageRange and stageDiffRange' },
    [`${SP}:fullPoint`]: { use: 'draws', why: 'whether the layer is a signal drawn as itself, to place a full point on its range' },
    [`${SP}:imageHover`]: { use: 'whole', why: 'reads the drawn cell only for an image whose full is \'drawn\'; else its full cells' },
    [`${SP}:isEventsView`]: { use: 'draws', why: 'whether a picture is a trigger\'s events' },
    [`${SP}:linePointAt`]: { use: 'whole', why: 'the drawn point under the pointer: its value is read only for bars and \'drawn\' layers, else the full read replaces it' },
    [`${SP}:linePointsNear`]: { use: 'whole', why: 'the drawn points near the pointer, as linePointAt' },
    [`${SP}:lineRead`]: { use: 'draws', why: 'whether the layer is a signal drawn as itself' },
    [`${SP}:paint`]: { use: 'draws', why: 'draws a signal\'s envelope' },
    [`${SP}:paintPlot`]: { use: 'draws', why: 'draws the pictures' },
    [`${SP}:points`]: { use: 'value', why: 'every drawn value of a picture, for its range' },
    [`${SP}:robustEdge`]: { use: 'value', why: 'the 99th percentile of a cepstrogram\'s drawn (block-averaged) cells, for its colour range (compare-overlay.range-image)' },
    [`${SP}:screenLevels`]: { use: 'whole', why: 'a line\'s level on screen from its values only where the webview holds every value; else levelBins or its full read (R6)' },
    [`${SP}:stageAxes`]: { use: 'draws', why: 'whether a picture is a signal, for the amplitude axis\'s name' },
    [`${SP}:stageDiffRange`]: { use: 'value', why: 'the Δ\'s auto range from the drawn points\' extent' },
    [`${SP}:stageEventCounts`]: { use: 'whole', why: 'counts a picture\'s events, every one of which it carries' },
    [`${SP}:stageHeadline`]: { use: 'draws', why: 'whether the Δ is an image, to write the backend\'s peak with a y' },
    [`${SP}:stageHover`]: { use: 'whole', why: 'the drawn points find the line under the pointer; the number is the full read\'s unless the layer is whole' },
    [`${SP}:stageNeighbour`]: { use: 'whole', why: 'the next drawn point, for bars and \'drawn\' layers only' },
    [`${SP}:stageRange`]: { use: 'value', why: 'an auto range from the drawn points\' extent (a signal\'s from its absolute peak)' },
    [`${SP}:stageStep`]: { use: 'whole', why: 'an arrow key\'s next drawn point, for bars and \'drawn\' layers only; else the full read\'s' },
    [`${SP}:strokeStageLine`]: { use: 'draws', why: 'draws a line' },
    ['python-backend/analysis_service.py:spectrum_slice']: { use: 'value', why: 'minDb / maxDb of the row min_max_spectrum cut for display (cursor-spectrum.range)' },
    ['python-backend/analyzer.py:_build_spectrogram']: { use: 'value', why: 'minDb / maxDb of the cells resampled to draw (track-spectrogram.range)' },
    ['python-backend/stage_view.py:_spectrogram_view']: { use: 'value', why: 'the heatmap\'s cells, power-averaged per time block, that its colour range is taken from (compare-overlay.range-image)' },
    ['src/shared/protocol/backendProtocol.ts:hasAlignedEnvelopeArrays']: { use: 'draws', why: 'checks an answer\'s envelope arrays line up; shows nothing' },
    ['src/shared/protocol/backendProtocol.ts:hasSpectrogramShape']: { use: 'draws', why: 'checks an answer\'s spectrogram shape; shows nothing' },
    ['src/webview/runtime/compareReport.ts:deltaFigure']: { use: 'value', why: 'the report Δ figure\'s range from the Δ thinned by binsView (report-delta.range)' },
    ['src/webview/runtime/comparisonRuntime.ts:applySpectrumDisplaySettings']: { use: 'value', why: 'the cursor spectrum\'s level range from the slice\'s minDb / maxDb, those of the row cut for display (cursor-spectrum.range)' },
    ['src/webview/runtime/comparisonRuntime.ts:exportCsv']: { use: 'whole', why: 'starts writeCsvWhenDetailed' },
    ['src/webview/runtime/comparisonRuntime.ts:writeCsvWhenDetailed']: { use: 'whole', why: 'writes a slice only when it holds every bin, else waits or leaves it out (spectrum-csv.export)' },
    ['src/webview/runtime/overlaySpectrumPainter.ts:spectrumLayer']: { use: 'whole', why: 'reads a slice\'s values as every bin when it has no frequenciesHz, and a cut one from laneReads; the lane spectrogram\'s column standing in meanwhile also has none (cursor-spectrum.pending)' },
    ['src/webview/runtime/runtimeExports.ts:buildSpectrumCsv']: { use: 'whole', why: 'writes a slice that holds every bin (spectrum-csv.export)' },
    ['src/webview/runtime/spectrumRuntime.ts:autoDbRange']: { use: 'value', why: 'the overlay\'s auto level range from each slice\'s minDb / maxDb (cursor-spectrum.range)' },
    ['src/webview/runtime/spectrumRuntime.ts:overlayLevelAxes']: { use: 'value', why: 'the overlay\'s level axes, from autoDbRange (cursor-spectrum.range)' },
    ['src/webview/runtime/spectrumRuntime.ts:spectrumSeriesRange']: { use: 'value', why: 'the overlay\'s level range from each slice\'s minDb / maxDb (cursor-spectrum.range)' },
    ['src/webview/runtime/trackCanvasPainter.ts:laneSpectrogramView']: { use: 'draws', why: 'the lane\'s picture of its display spectrogram' },
    ['src/webview/runtime/trackCanvasPainter.ts:laneWaveform']: { use: 'draws', why: 'the lane\'s picture of its envelope' },
    ['src/webview/runtime/trackStageMode.ts:events']: { use: 'draws', why: 'the events drawn, for the exclusion marks' },
    ['src/webview/runtime/trackStageMode.ts:paintNow']: { use: 'draws', why: 'whether a picture is a signal, to paint it' },
    ['src/webview/runtime/trackStageMode.ts:snapshot']: { use: 'draws', why: 'a test hook\'s summary of what is drawn' },
    ['src/webview/runtime/trackStageModel.ts:pictureSummary']: { use: 'draws', why: 'a test hook\'s count and median of the drawn points, not shown' },
    ['src/webview/runtime/trackStageModel.ts:plotsOf']: { use: 'draws', why: 'whether pictures are signals, to choose how to draw them' },
    ['src/webview/runtime/trackStagePainter.ts:eventsOf']: { use: 'draws', why: 'the events drawn, as layers' },
    ['src/webview/spectrum/cursorSpectrum.ts:extractSpectrumAtCursor']: { use: 'value', why: 'until the backend\'s slice is in, the cursor spectrum is the lane\'s display spectrogram column, power-averaged to draw (cursor-spectrum.pending)' },
    ['src/webview/spectrum/cursorSpectrum.ts:makeSilentSpectrumSlice']: { use: 'value', why: 'past the track\'s end, a floor at the display spectrogram\'s minDb (cursor-spectrum.pending)' },
};
