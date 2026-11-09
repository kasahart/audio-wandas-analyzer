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
    'src/webview/runtime/plotInteraction.ts:notePlotWindow': 'a plot\'s data-plot-window attribute for the plot contract test, not shown',
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
 * Every function the scan finds reading drawn points (and every backend def a row names that calls a decimator), with
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
    [`${SP}:robustEdge`]: { use: 'whole', why: 'a cepstrogram\'s colour edge: its full coefficients\' 99th percentile (valueRange.robust); the drawn cells only of a picture without it' },
    [`${SP}:screenLevels`]: { use: 'whole', why: 'a line\'s level on screen from its values only where the webview holds every value; else levelBins or its full read (R6)' },
    [`${SP}:stageAxes`]: { use: 'draws', why: 'whether a picture is a signal, for the amplitude axis\'s name' },
    [`${SP}:stageDiffRange`]: { use: 'whole', why: 'the Δ\'s auto range from extent: the full Δ\'s valueRange' },
    [`${SP}:stageEventCounts`]: { use: 'whole', why: 'counts a picture\'s events, every one of which it carries' },
    [`${SP}:stageHeadline`]: { use: 'draws', why: 'whether the Δ is an image, to write the backend\'s peak with a y' },
    [`${SP}:stageRange`]: { use: 'whole', why: 'an auto range from extent: the full data\'s valueRange (a signal\'s from its absolute peak)' },
    [`${SP}:stageStep`]: { use: 'draws', why: 'whether the layer is a signal drawn as itself, to stop past its clipped level axis; every step is read from the layer\'s full data' },
    [`${SP}:strokeStageLine`]: { use: 'draws', why: 'draws a line' },
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
    ['src/webview/spectrum/cursorSpectrum.ts:extractSpectrumAtCursor']: { use: 'draws', why: 'until the backend\'s slice is in, the lane\'s display spectrogram column is drawn, marked a stand-in that is never read (cursor-spectrum.pending)' },
};
