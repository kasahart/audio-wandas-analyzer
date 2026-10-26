/**
 * UI 文字列の英日辞書と locale 選択ロジック。
 *
 * 設計:
 * - VS Code 拡張側 (extension/index.ts, ComparisonPanel.ts) も Webview JS 側も
 *   同じ辞書を共有する。Webview には ComparisonPanel.renderHtml() が生成する
 *   inline `<script>` で `__APP_STRINGS__` (および locale 値の `__APP_LOCALE__`)
 *   としてグローバル注入される。renderScript IIFE 冒頭で `STR` に alias される。
 * - locale は VS Code の `vscode.env.language` (e.g. 'ja', 'en-US') から決定。
 *   'ja' で始まる場合のみ日本語、それ以外は英語。
 * - キーは英語半角の短いスラッグ。階層なし (フラット) で 1 ファイルに集約。
 */

export type SupportedLocale = 'en' | 'ja';

export interface UiStrings {
    browserEmptyPrompt: string;
    browserAbout: string;
    browserAboutPrivacy: string;
    browserAboutFileLimits: string;
    browserAboutSessionLimits: string;
    browserAboutRecipes: string;
    browserAboutUnsupported: string;
    browserPreparing: string;
    browserInputTooLarge: string;
    browserAggregateLimit: string;
    browserReady: string;
    browserWorkerFailed: string;
    browserPythonStarting: string;
    browserPythonReady: string;
    browserPythonFailed: string;
    browserPythonStopped: string;
    browserCleared: string;
    browserRemoved: string;
    browserExported: string;
    browserFolderOpened: string;
    browserDropNoWav: string;
    browserUnavailable: string;
    browserRecipePick: string;
    browserRecipeOpenFile: string;
    browserRecipeRun: string;
    hintRecipeOpenFile: string;
    browserRecipeNoSources: string;
    browserRecipeDone: string;
    btnCloseRecipeResult: string;

    panelTitle: string;
    emptyAllExcluded: string;
    emptyNoTracks: string;
    selectionEmptyHint: string;
    btnOpenFile: string;
    btnOpenAnotherFolder: string;
    btnOpenFolder: string;
    selectionNoSupported: string;
    spectrumSectionTitle: string;
    toolbarTrackLabel: string;
    btnWaveform: string;
    btnSpectrogram: string;
    btnStage: string;
    stageLayoutSide: string;
    stageLayoutOverlay: string;
    compareFixedHint: string;
    hintContentStage: string;
    btnSpectrogramSettingsTitle: string;
    btnSpectrumSettingsTitle: string;
    toolbarZoomLabel: string;
    btnZoomReset: string;
    toolbarExportLabel: string;
    heightTrackLabel: string;
    heightSpectrumLabel: string;
    btnRunRecipe: string;
    btnSaveRecipe: string;
    chartSpecNoResults: string;
    chartSpecScalarLabelHeader: string;
    chartSpecScalarUnitHeader: string;
    cursorDisplayHint: string;
    loopBadge: string;
    trackPlayTitle: string;
    trackStopTitle: string;
    trackOffsetResetHint: string;
    offsetEditPlaceholder: string;
    offsetEditAriaLabel: string;
    trackSpectrumTitle: string;
    analysisFailed: string;
    cursorHelpKeys: string;
    tooltipLoopResize: string;
    tooltipLoopClear: string;
    tooltipLoopOrShift: string;
    canvasOutOfRange: string;
    spectrumNoData: string;
    spectrumAnalysisWindow: string;
    spectrumAnalysisWindowPerTrack: string;
    spectrogramLoading: string;
    settingsApplyHint: string;
    reanalyzingStft: string;
    reanalyzingDefault: string;
    reanalyzingFiles: string;
    configurePython: string;
    helpTitle: string;
    helpClose: string;
    helpRowSpace: string;
    helpRowArrow: string;
    helpRowWheel: string;
    helpRowCtrlWheel: string;
    helpRowDrag: string;
    helpRowShiftDrag: string;
    helpRowDoubleClickEdge: string;
    helpRowQuestion: string;
    helpRowEsc: string;
    entryColFile: string;
    entryColCondition: string;
    entryColLeq: string;
    entryColPeak: string;
    entryOpen: string;
    entryBaseGroup: string;
    entryBase: string;
    entryCount: string;
    entryKeySlot: string;
    entryCsvGroupSize: string;
    entrySourceGone: string;
    entryFolderLevel: string;
    compareKeyHold: string;
    compareKeyBack: string;
    comparePlay: string;
    compareDelta: string;
    stepNeedBelow: string;
    stepNeedPow2: string;
    compareReport: string;
    entryBaseMedian: string;
    stageBaseAggregate: string;
    stageBaseList: string;
    reportBase: string;
    reportCompare: string;
    reportDiff: string;
    reportCsv: string;
    reportBaseLeq: string;
    reportBandDelta: string;
    reportRegion: string;
    reportSummary: string;
    reportStepsLegend: string;
    reportRegionStart: string;
    reportRegionEnd: string;
    reportWhole: string;
    reportDefinitions: string;
    defLeq: string;
    defSpectrum: string;
    defThirdOct: string;
    defChannels: string;
    defBase: string;
    defDelta: string;
    defRegion: string;
    defHeadline: string;
    defHeadlineEdges: string;
    reportGroupFiles: string;
    reportSpecVersion: string;
    reportSaved: string;
    stepRegion: string;
    stepAll: string;
    stepMetrics: string;
    stepAverage: string;
    stepSettings: string;
    stepApply: string;
    stepRecipeWarning: string;
    compareNotEntry: string;
    comparePending: string;
    compareBaseEntryRegion: string;
    compareSelfBase: string;
    stepRecipeName: string;
    stepHoldHint: string;
    stepHintNoHold: string;
    stepAdd: string;
    stepMenuTitle: string;
    stepMenuFilter: string;
    stepOffFrame: string;
    stepOffRequired: string;
    stepOffRefuses: string;
    stepOffUnavailable: string;
    stepDefaultsOnly: string;
    stepNoSettings: string;
    stepInputFiles: string;
    stepInput: string;
    stepHintLocale: string;
    stepGroupFilter: string;
    stepGroupPrepare: string;
    stepGroupTime: string;
    stepGroupFrequency: string;
    stepGroupOther: string;
    stepDragHint: string;
    stepMoved: string;
    stepRemoveChip: string;
    stepHighpass: string;
    stepLowpass: string;
    stepBandpass: string;
    stepAverageFft: string;
    stepOctaveHint: string;
    stepRemove: string;
    stepNeedFrame: string;
    stepFailedOn: string;
    stepAfterBroken: string;
    stepOctaveBroken: string;
    entryChainBroken: string;
    stepTapHint: string;
    stepAdded: string;
    stepRemoved: string;
    dsValue: string;
    dsGroup: string;
    dsGroupNone: string;
    dsFromCsv: string;
    dsFromSound: string;
    dsLeq: string;
    dsPeak: string;
    dsCrest: string;
    dsBand: string;
    dsNotComputed: string;
    dsRows: string;
    dsPickCsv: string;
    dsCsvSource: string;
    hintPickCsv: string;
    dsCsvError: string;
    dsCsvRead: string;
    dsUnmatched: string;
    hintUnmatched: string;
    dsUnreadable: string;
    hintUnreadable: string;
    dsExcluded: string;
    hintExcluded: string;
    dsReasonMissing: string;
    dsReasonAmbiguous: string;
    dsReasonRepeated: string;
    dsReasonNoRow: string;
    dsReasonUnreadable: string;
    dsCsvRow: string;
    dsReason: string;
    dsCompute: string;
    hintCompute: string;
    dsComputing: string;
    dsUncomputed: string;
    dsRowSlot: string;
    dsSlotCompare: string;
    dsSlotOut: string;
    dsRowMemo: string;
    dsRowExclude: string;
    dsRowExcludeShort: string;
    dsRowRestore: string;
    dsMemoPlaceholder: string;
    dsMemoClose: string;
    dsSortAsc: string;
    dsSortDesc: string;
    dsFilterClear: string;
    dsFilterSearch: string;
    dsFilterAll: string;
    dsFilterAllFound: string;
    dsFilterBlank: string;
    dsFilterMore: string;
    dsFilterNone: string;
    dsFilterRange: string;
    dsFilterLow: string;
    dsFilterHigh: string;
    dsFilterAdd: string;
    dsFilterColumn: string;
    dsFilterPickOne: string;
    dsFilterApplied: string;
    dsFilterRemoved: string;
    dsFilterHead: string;
    dsFilterOn: string;
    dsChipRemove: string;
    dsSlotEmptyHint: string;
    dsSlotFilledHint: string;
    dsSlotClear: string;
    dsBaseReset: string;
    dsCh: string;
    dsCancel: string;
    dsProbing: string;
    dsDistMax: string;
    dsUnitRecording: string;
    dsDistCountAxis: string;
    dsDistCsvAxis: string;
    dsDistDrag: string;
    dsDistNotComputed: string;
    dsDistEmpty: string;
    dsDistGroups: string;
    dsDistAll: string;
    dsDerivedRemove: string;
    dsBaseNarrowed: string;
    dsBaseFewer: string;
    reportMemo: string;
    reportBaseDefinition: string;
    reportDerived: string;
    dsExportNotes: string;
    dsSlotTrackChannel: string;
    dsBatch: string;
    stageBaseGated: string;
    stageBaseFromTable: string;
    stageBaseScan: string;
    hintBatch: string;
    dsBatchFiltered: string;
    dsBatchAll: string;
    dsBatchNote: string;
    dsBatchGo: string;
    dsBatchSaved: string;
    hintExportNotes: string;
    dsDistLabel: string;
    dsDistBack: string;
    dsDistBackHint: string;
    dsDistPicked: string;
    dsComputeRest: string;
    dsLegendBaseMedian: string;
    dsBaseMenu: string;
    dsBaseAuto: string;
    dsBaseGroupMedian: string;
    dsBaseRow: string;
    dsBaseSet: string;
    dsBaseSetAuto: string;
    stepUndo: string;
    stepRedo: string;
    stepUndone: string;
    stepRedone: string;
    stepBypass: string;
    stepBypassOff: string;
    stepBypassed: string;
    stepUnbypassed: string;
    stepBypassing: string;
    stepMenuEarlier: string;
    stepGoesBefore: string;
    stepMenuOff: string;
    stepRegionStart: string;
    stepRegionEnd: string;
    stepRegionPurpose: string;
    stepRegionAdded: string;
    stepRegionCleared: string;
    stepRegionClear: string;
    stepRegionOrder: string;
    stepRegionThere: string;
    stepCannotShow: string;
    stepCannotShowFix: string;
    stepInputHint: string;
    entryScanCancel: string;
    entryMinutes: string;
    entrySeconds: string;
    reportChain: string;
    reportChainCurrent: string;
    reportChainPrevious: string;
    stepNotDrawable: string;
    stepOpenCompare: string;
    axisLevel: string;
    axisGain: string;
    axisCoherence: string;
    axisBand: string;
    axisBark: string;
    axisQuefrency: string;
    axisCepstrum: string;
    stageNoDelta: string;
    stageMaxDelta: string;
    compareLevelsAt: string;
    compareHintPlot: string;
    compareHintAxis: string;
    compareDiffShow: string;
    compareDiffHide: string;
    hintDiffToggle: string;
    stepHeldWithout: string;
    stepHeldRow: string;
    stepHeldNoRow: string;
    outside192: string;
    outsideMedian: string;
    outsideDelta: string;
    outsideOutliers: string;
    stepOutsideHeading: string;
    stepOpen: string;
    stepClose: string;
    stepOctave: string;
    stepFrameHint: string;
    slotEmpty: string;
    axisFrequency: string;
    axisLevelUncal: string;
    axisLevelCal: string;
    axisDelta: string;
    axisTime: string;
    legendHeadline: string;
    legendLeak: string;
    legendLine: string;
    compareNoSignificant: string;
    stepNeedAbove: string;
    stepNeedInteger: string;
    stepNeedValue: string;
    hintSpectrogram: string;
    compareRefuseFix: string;
    compareRefuseSlot: string;
    entryLeqUncalibrated: string;
    hintLeqUncalibrated: string;
    hintSpectrogramGroup: string;
    screenHelpTitle: string;
    screenHelpEntry: string;
    screenHelpCompare: string;
    screenHelpSymbols: string;
    keyHelp: string;
    hintOverview: string;
    hintBaseCard: string;
    hintSlotCard: string;
    hintRegionMark: string;
    hintCompareMark: string;
    hintStepChip: string;
    hintEntryMaximize: string;
    hintRowPlay: string;
    hintRowStop: string;
    compareSingleBase: string;
    compareRegionDiffers: string;
    helpRowEntryKeys: string;
    helpRowCompareKeys: string;
    helpRowStepKeys: string;
    helpRowStepBypass: string;
    helpRowStepUndo: string;
    helpRowStepDrag: string;
    helpRowZoomKeys: string;
    playbackTimePrefix: string;
    playbackDisplayTitle: string;
    clipBadgeTitle: string;
    peakLabel: string;
    waveformAmplitudeLabel: string;
    calibrationBadgeUncalibratedHint: string;
    calibrationBadgePartialHint: string;
    calibrationFactorLabel: string;
    calibrationButtonLabel: string;
    calibrationButtonTitle: string;
    calibrationButtonAria: string;
    calibrationOverlayIncompatible: string;
    loopTimeDisplayTitle: string;
    btnFollowCursor: string;
    btnFollowCursorTitle: string;
    specSettingsAuto: string;
    specSettingsStftLegend: string;
    specSettingsNFft: string;
    specSettingsOverlap: string;
    specSettingsWindow: string;
    specSettingsDisplayLegend: string;
    specSettingsDbMin: string;
    specSettingsDbMax: string;
    specSettingsMaxFreqHz: string;
    specSettingsPlaceholderAuto: string;
    specSettingsPlaceholderNyquist: string;
    btnExportPng: string;
    btnExportPngTitle: string;
    btnExportCsv: string;
    btnExportCsvTitle: string;
    btnZoomToSelection: string;
    btnZoomToSelectionTitle: string;
    helpRowFollowCursor: string;
    helpRowZoomToSelection: string;
    btnExportWav: string;
    btnExportWavTitle: string;
    exportWavNoLoop: string;
    exportWavNoOverlap: string;
    // Accessibility: toolbar aria-labels
    ariaToolbar: string;
    ariaZoomOut: string;
    ariaZoomIn: string;
    ariaZoomReset: string;
    ariaRemoveTrack: string;
    ariaTrackPlay: string;
    ariaTrackMute: string;
    ariaTrackStop: string;
    ariaOffsetUp: string;
    ariaOffsetDown: string;
    ariaOffsetValue: string;
    btnExportReport: string;
    btnExportReportTitle: string;
    exportReportNoData: string;
    recipeSaveNoData: string;
    reportFormatMarkdown: string;
    reportFormatNotebook: string;
    reportFormatPlaceholder: string;
    reportSaveLabel: string;
    reportExportedPrefix: string;
    recipeSaveLabel: string;
    recipeSavedPrefix: string;
    fileCountOne: string;
    fileCountMany: string;
    exportSelectOutputFolder: string;
    exportWavComplete: string;
    exportWavPartial: string;
    noSupportedAudioFiles: string;
    progressSyncCalibration: string;
    progressRecomputeSpectrogram: string;
    progressApplyCalibration: string;
    dialogSelectAudioDirectory: string;
    dialogSelectAudioFile: string;
    dialogAnalyzeAudioTarget: string;
    dialogAudioFilesFilter: string;
    calFullScale: string;
    calSummary: string;
    calNoChannels: string;
    calResetAllLabel: string;
    calResetAllDescription: string;
    calChannelLabel: string;
    calConfigurePlaceholder: string;
    calResetDone: string;
    calModeCalibratedLabel: string;
    calModeCalibratedDescription: string;
    calModeUncalibratedLabel: string;
    calModeUncalibratedDescription: string;
    calFactorTitle: string;
    calFactorPrompt: string;
    calUnitTitle: string;
    calUnitPrompt: string;
    calUnitRequired: string;
    calReferenceTitle: string;
    calReferencePromptPa: string;
    calReferencePrompt: string;
    ariaDragHandle: string;
    announceAnalyzing: string;
    announceAnalysisDone: string;
    announceTrackRemoved: string;
    announceExportPngStarted: string;
    announceExportPngFailed: string;
    announceExportCsvStarted: string;
    announceExportCsvFailed: string;
    ariaSpecZoomIn: string;
    ariaSpecZoomOut: string;
    ariaSpecZoomReset: string;
    btnSpecZoomReset: string;
    specRangeTitle: string;
    specRangeAxisFreq: string;
    specRangeAxisDb: string;
    waveRangeAxisAmplitude: string;
    waveRangeErrorTooNarrow: string;
    specRangeMin: string;
    specRangeMax: string;
    specRangeAuto: string;
    specRangeErrorMinMax: string;
    specRangeClose: string;
    rangeAxisX: string;
    rangeAxisY: string;
    rangeAxisColor: string;
    helpRowSpectrumDrag: string;
    helpRowWaveRectZoom: string;
    waveModeLabelRectZoom: string;
    hintContentWaveform: string;
    hintContentSpectrogram: string;
    hintZoomOut: string;
    hintZoomIn: string;
    hintZoomReset: string;
    hintRectZoom: string;
    hintMenuExport: string;
    hintRunRecipe: string;
    hintSaveRecipe: string;
    hintSpecZoomOut: string;
    hintSpecZoomIn: string;
    hintSpecZoomReset: string;
    hintSpectrumFft: string;
    hintSpectrumOctave1: string;
    hintSpectrumOctave3: string;
    hintRemoveTrack: string;
    hintOffsetUp: string;
    trackMoreHint: string;
    offsetStepUp: string;
    offsetStepDown: string;
    offsetEdit: string;
    offsetReset: string;
    hintOffsetDown: string;
    hintTrackHeightResizer: string;
    hintSpectrumHeightResizer: string;
    hintTreeResizer: string;
    hintCollapseSidebar: string;
    hintExpandSidebar: string;
    hintCollapseSpectrum: string;
    hintExpandSpectrum: string;
    hintMaximizeSpectrum: string;
    hintRestoreSpectrum: string;
    hintOpenFile: string;
    hintOpenFolder: string;
    hintWheelGestures: string;
    hintDoubleClickResetZoom: string;
    hintRectZoomDrag: string;
    hintSpectrumPlot: string;
    hintSpectrumDbAxis: string;
    hintSpectrumFreqAxis: string;
    hintWaveformAmplitudeAxis: string;
    hintSpectrumKeys: string;
    hintSpecAuto: string;
    hintSpecNFft: string;
    hintSpecOverlap: string;
    hintSpecWindow: string;
    hintSpecDisplay: string;
    hintSpecReset: string;
    hintSpecApply: string;
    hintBrowserOpenFolder: string;
    hintBrowserAbout: string;
    pairReferenceHint: string;
    pairReferenceClearHint: string;
    pairReferenceBadge: string;
    pairAverages: string;
    pairFewAveragesHint: string;
    pairResampledHint: string;
    pairNoOverlapHint: string;
    pairTooShortHint: string;
    pairOtherUnitHint: string;
    pairPhaseLabel: string;
    pairCoherenceLabel: string;
    pairSectionTitle: string;
    pairWaiting: string;
    pairNoResponses: string;
    pairFailed: string;
    hintPairDivider: string;
    hintOctaveDisabledByPair: string;
    hintPairPlot: string;
}

const STRINGS: Record<SupportedLocale, UiStrings> = {
    en: {
        panelTitle: 'Audio Wandas Analyzer',
        emptyAllExcluded: 'All tracks are excluded',
        emptyNoTracks: 'Files you put in slots 0–3 or add with ＋ on the entry table appear here as tracks',
        selectionEmptyHint: 'Open a folder to list every file here',
        btnOpenFile: '＋ Add files',
        browserEmptyPrompt: 'Drop audio or CSV files here, or open files or a folder, to start comparing',
        browserAbout: 'ⓘ About the browser version',
        browserAboutPrivacy: 'Audio is processed in this browser and never uploaded.',
        browserAboutFileLimits: 'Each file: up to 16 MiB, 30 s and 2 ch.',
        browserAboutSessionLimits: 'Comparison: up to 8 tracks and 64 MiB of input in total.',
        browserAboutRecipes: 'Bundled recipes run on the loaded tracks.',
        browserAboutUnsupported: 'Not available here: WDF, calibration configuration, vscode.dev.',
        browserInputTooLarge: 'Each file must be {mib} MiB or smaller.',
        browserAggregateLimit: 'Browser session limit: up to {count} files / {mib} MiB total input. Remove a track first.',
        browserPreparing: 'Preparing local Python Worker / adding files…',
        browserReady: 'waveform ready. {count} tracks; add more files to compare. No automatic playback.',
        browserWorkerFailed: 'Audio Worker failed; select the files again.',
        browserPythonStarting: 'Python: starting…',
        browserPythonReady: 'Python: ready',
        browserPythonFailed: 'Python: failed to start',
        browserPythonStopped: 'Python: stopped (restarts when needed)',
        browserCleared: 'Worker cleared; audio memory released. Add short files.',
        browserRemoved: 'All tracks removed; audio memory released. Add short files.',
        browserExported: 'Selected regions exported as PCM16 WAV.',
        browserFolderOpened: 'Opened a folder with {count} readable files. Put files in slots 0–3 or press ＋ on a row to show them as tracks.',
        browserDropNoWav: 'Drop audio or CSV files to add them as tracks; use Open Folder for folders.',
        browserUnavailable: 'Not available in the browser version.',
        browserRecipePick: 'Recipes',
        browserRecipeOpenFile: 'From file…',
        browserRecipeRun: 'Run',
        hintRecipeOpenFile: 'Run a wandas .recipe.json from your computer',
        browserRecipeNoSources: 'Add files first; recipes run on the loaded tracks.',
        browserRecipeDone: 'Recipe finished: ',
        btnCloseRecipeResult: 'Close recipe result',

        btnOpenAnotherFolder: 'Open another folder',
        btnOpenFolder: 'Open Folder',
        selectionNoSupported: 'No supported audio files found.',
        spectrumSectionTitle: 'Power spectrum at cursor (all tracks overlaid)',
        toolbarTrackLabel: 'Track:',
        btnWaveform: 'Waveform',
        btnSpectrogram: 'Spectrogram',
        btnStage: 'Steps',
        stageLayoutSide: 'Side by side',
        stageLayoutOverlay: 'Overlay',
        compareFixedHint: 'Fixed: the difference is a row of the entry table now (Esc to see it)',
        hintContentStage: 'Pick a step of the scan Recipe and draw every track as that step\'s Frame (the entry table\'s Recipe)',
        btnSpectrogramSettingsTitle: 'Spectrogram settings',
        btnSpectrumSettingsTitle: 'Frequency analysis settings (shared with the spectrogram)',
        toolbarZoomLabel: 'Zoom:',
        btnZoomReset: 'Reset',
        toolbarExportLabel: 'Export',
        heightTrackLabel: 'Track',
        heightSpectrumLabel: 'Spectrum',
        btnRunRecipe: 'Run recipe',
        btnSaveRecipe: 'Save as recipe',
        chartSpecNoResults: 'Recipe returned no charts.',
        chartSpecScalarLabelHeader: 'Label',
        chartSpecScalarUnitHeader: 'Unit',
        cursorDisplayHint: 'Cursor time: click a waveform, then fine-tune with ← → (Shift: 100 ms)',
        loopBadge: '🔁 Looping',
        trackPlayTitle: 'Play / pause',
        trackStopTitle: 'Stop',
        trackOffsetResetHint: 'Click: type an offset in ms / Double-click: reset to 0',
        offsetEditPlaceholder: 'ms',
        offsetEditAriaLabel: 'Track offset in milliseconds',
        trackSpectrumTitle: 'Power spectrum at main cursor',
        analysisFailed: 'Analysis failed: ',
        cursorHelpKeys: '← →: move cursor   Shift+←→: 100 ms step   Space: play/pause',
        tooltipLoopResize: 'Drag to resize loop region',
        tooltipLoopClear: 'Click to clear loop',
        tooltipLoopOrShift: 'Drag: set loop region / Shift+Drag: shift track in time',
        canvasOutOfRange: 'Out of range',
        spectrumNoData: 'No track has data at the cursor position',
        spectrumAnalysisWindow: 'window',
        spectrumAnalysisWindowPerTrack: 'window differs per track (see the bands)',
        spectrogramLoading: 'Loading spectrogram...',
        settingsApplyHint: 'Click Apply to commit changes',
        reanalyzingStft: 'Recomputing STFT…',
        reanalyzingDefault: 'Recomputing…',
        reanalyzingFiles: 'Recomputing STFT… ({count} files)',
        configurePython: 'Configure Python environment',
        helpTitle: 'Keyboard Shortcuts',
        helpClose: 'Close (Esc / ?)',
        helpRowSpace: 'play / pause',
        helpRowArrow: 'move cursor  (Shift: fast)',
        helpRowWheel: 'scroll tracks  (Shift: scroll in time)',
        helpRowCtrlWheel: 'zoom in time',
        helpRowDrag: 'create / resize loop',
        helpRowShiftDrag: 'adjust track offset',
        helpRowDoubleClickEdge: 'collapse the file list; collapse or expand the spectrum',
        helpRowQuestion: 'toggle this help',
        helpRowEsc: 'close popover / help, restore a maximized spectrum',
        entryColFile: 'File',
        entryColCondition: 'Cond. {n}',
        entryColLeq: 'Leq dB(A)',
        entryColPeak: 'Δ max band',
        entryOpen: 'Compare',
        entryBaseGroup: 'Base group',
        entryBase: 'Base',
        entryCount: '{count} files',
        entryKeySlot: '1–3 slot',
        entryCsvGroupSize: 'Base group n',
        entrySourceGone: 'The file is no longer listed',
        entryFolderLevel: 'Folder {n}',
        compareKeyHold: 'hold 1–3 swap',
        compareKeyBack: 'Esc entry',
        comparePlay: 'Play',
        compareDelta: 'Δ = compare − base',
        stepNeedBelow: 'Must be below {max}',
        stepNeedPow2: 'A power of two from 64 to {max}',
        compareReport: 'Export (comparison folder)',
        entryBaseMedian: 'median of {count}',
        stageBaseAggregate: 'Aggregate: the median at each point',
        stageBaseList: 'Show on the list',
        reportBase: 'base',
        reportCompare: 'compare',
        reportDiff: 'delta',
        reportCsv: 'report',
        reportBaseLeq: 'Base Leq',
        reportBandDelta: 'Δ {band} dB',
        reportRegion: 'Region s',
        reportSummary: 'summary',
        reportStepsLegend: 'bands: filled = headline, outlined = leak into the neighbour',
        reportRegionStart: 'Start s',
        reportRegionEnd: 'End s',
        reportWhole: 'whole',
        reportDefinitions: 'definitions',
        defLeq: 'A-weighted RMS over the region, 20·log10(rms / ref); ref is the channel calibration (1 = full scale, so an uncalibrated file reads below 0 dB).',
        defSpectrum: 'Welch power spectrum (wandas welch, n_fft {n_fft}, {window} window) in dB re the channel ref; its bins are power-averaged into 192 log-spaced points from 20 Hz to Nyquist (a point narrower than one bin is interpolated), so a narrow peak reads lower with a longer n_fft.',
        defHeadline: 'The headline lists up to three bands whose |Δ| is larger than both neighbours, beyond chance (3 MAD of the base condition\'s other files, at least 1.5 dB) and where the louder of base and compare is within {within} dB of the loudest band, largest |Δ| first, each with both levels; or it says "no clear difference". A band beside such a peak with the same sign is the peak\'s leak through the band filters, drawn as an outline and not listed.',
        defHeadlineEdges: 'In a step\'s spectrogram or cepstrogram, a column whose STFT frames are centred less than n_fft / 2 from the start or end of the signal reads the padding beyond it (its window sticks out of the signal): it is drawn, but never named in the headline.',
        defRegion: 'Every metric skips the first and last 0.15 s of the file, where the Recipe\'s filters ring; the Recipe\'s time slice is the region actually measured.',
        defThirdOct: 'wandas noct_spectrum (n = 3), bands from 25 Hz up to 0.88 × Nyquist, in dB; a band centred outside the Recipe\'s filter passband is left empty.',
        defChannels: 'Channels are combined by their power mean (10·log10 of the mean of 10^(L/10)).',
        defBase: 'The file in slot 0, or else the median per point and band of the other files of the compared file\'s condition.',
        defDelta: 'compare − base, in dB, point by point and band by band; Δ max band is the 1/3-octave band with the largest |Δ|.',
        reportGroupFiles: 'Base group files',
        reportSpecVersion: 'Spec version',
        reportSaved: 'Report saved: ',
        stepRegion: 'Region',
        stepAll: 'all',
        stepMetrics: 'Metrics',
        stepAverage: 'Average spectrum',
        stepSettings: 'Settings',
        stepApply: 'Apply',
        stepRecipeWarning: 'The saved recipe could not be read; the standard one is used.',
        compareNotEntry: '≠ entry',
        comparePending: 'pending',
        compareBaseEntryRegion: 'base = entry region',
        compareSelfBase: '≠ same file',
        stepRecipeName: 'Standard',
        stepHoldHint: 'Hold to see what this step does',
        stepHintNoHold: 'Nothing to compare on this screen; ⚙ changes its settings',
        stepAdd: 'Add a step',
        stepMenuTitle: 'Add a step here',
        stepMenuFilter: 'Filter operations',
        stepOffFrame: 'Cannot take the result here',
        stepOffRequired: 'Needs {params}, which the app cannot set yet',
        stepOffRefuses: 'Does not run on a {frame} ({reason})',
        stepOffUnavailable: 'Not available in the Web version (no {packages})',
        stepDefaultsOnly: 'defaults',
        stepNoSettings: "No settings known for this step: it runs with wandas' defaults.",
        stepInputFiles: 'Input · {n} files',
        stepInput: 'Input',
        stepHintLocale: 'en',
        stepGroupFilter: 'Filters',
        stepGroupPrepare: 'Preparation',
        stepGroupTime: 'Over time',
        stepGroupFrequency: 'Frequency',
        stepGroupOther: 'Other',
        stepDragHint: 'drag to move it',
        stepMoved: 'Moved {op}',
        stepRemoveChip: 'Remove this step (Del)',
        stepHighpass: 'HPF',
        stepLowpass: 'LPF',
        stepBandpass: 'BPF',
        stepAverageFft: '{name} {n}',
        stepOctaveHint: 'The value in the table\'s band column',
        stepRemove: 'Remove',
        stepNeedFrame: '{op} cannot take the result before it. Move it or remove it.',
        stepFailedOn: 'Failed on a file ({reason}). Change the step or remove it.',
        stepAfterBroken: 'The step before ({op}) cannot run, so this one cannot either.',
        stepOctaveBroken: "The steps cannot run, so the table's 1/3-octave values cannot be computed.",
        entryChainBroken: "The steps cannot run · the table keeps the previous chain's values",
        stepTapHint: "Press: see this step's result · bypass: see it without this step · hold: the same while held",
        stepAdded: 'Added {op}. The files on screen are measured again; Scan all updates the table.',
        stepRemoved: 'Removed {op}. Every file is measured again.',
        dsValue: 'Value',
        dsGroup: 'Group',
        dsGroupNone: 'None',
        dsFromCsv: 'CSV columns',
        dsFromSound: 'Computed from the sound',
        dsLeq: 'Leq A-weighted [dBFS]',
        dsPeak: 'Peak frequency [Hz]',
        dsCrest: 'Crest factor [ratio]',
        dsBand: '{band} band [dBFS]',
        dsNotComputed: 'Not computed: press 「Compute」 first',
        dsRows: '{n} rows',
        dsPickCsv: 'Pick a CSV',
        dsCsvSource: '{name} · {matched}/{total}',
        hintPickCsv: 'Pick one attribute CSV/TSV for these recordings (UTF-8, up to 20 MB and 128 columns)',
        dsCsvError: 'Could not read the CSV: {reason}',
        dsCsvRead: 'Read {name}: {matched} of {total} recordings matched',
        dsUnmatched: 'Unmatched {n}',
        hintUnmatched: 'CSV rows and recordings that did not match, and recordings that could not be read',
        dsUnreadable: 'Unreadable {n}',
        hintUnreadable: 'Recordings that could not be read',
        dsExcluded: 'Excluded {n}',
        hintExcluded: 'Recordings taken out of the table; restore them here',
        dsReasonMissing: 'No recording',
        dsReasonAmbiguous: 'Ambiguous',
        dsReasonRepeated: 'Repeated, not used',
        dsReasonNoRow: 'No CSV row',
        dsReasonUnreadable: 'Unreadable',
        dsCsvRow: 'CSV row {n}',
        dsReason: 'Reason',
        dsCompute: 'Compute {n} files · about {time}',
        hintCompute: 'Compute the chosen value for the recordings in the table (its filters applied)',
        dsComputing: 'Computing {done} / {n}',
        dsUncomputed: 'Not computed {n} ch',
        dsRowSlot: 'Put in a slot: 0 base, 1–3 compare (keys 0–3)',
        dsSlotCompare: 'Compare {n}',
        dsSlotOut: 'Take out of its slot',
        dsRowMemo: 'Memo (M)',
        dsRowExclude: 'Take out of the table (restore it from 「Excluded」)',
        dsRowExcludeShort: 'Out',
        dsRowRestore: 'Restore',
        dsMemoPlaceholder: 'What you noticed',
        dsMemoClose: 'Save and close',
        dsSortAsc: 'Ascending',
        dsSortDesc: 'Descending',
        dsFilterClear: 'Clear the filter from 「{col}」',
        dsFilterSearch: 'Search',
        dsFilterAll: '(Select all)',
        dsFilterAllFound: '(Select all found)',
        dsFilterBlank: '(Blank)',
        dsFilterMore: '{n} more: narrow with the search',
        dsFilterNone: 'No matching values',
        dsFilterRange: 'Range',
        dsFilterLow: 'From',
        dsFilterHigh: 'To',
        dsFilterAdd: '＋ Filter',
        dsFilterColumn: 'Column',
        dsFilterPickOne: 'Pick at least one value',
        dsFilterApplied: 'Narrowed to {n} rows',
        dsFilterRemoved: 'Cleared the filter on {col}',
        dsFilterHead: 'Sort or filter by this column',
        dsFilterOn: 'Filtered: press to change',
        dsChipRemove: 'Remove this filter',
        dsSlotEmptyHint: 'Slot {n}: press to put the selected row in (or its slot button, key {n})',
        dsSlotFilledHint: 'Slot {n}: press to go to its row',
        dsSlotClear: 'Empty slot {n}',
        dsBaseReset: 'The base was reset to the group median of the new grouping',
        dsCh: 'ch',
        dsCancel: 'Cancel',
        dsProbing: 'Reading channels {done} / {n}',
        dsDistMax: 'max {n}',
        dsUnitRecording: 'recordings',
        dsDistCountAxis: 'Height: {unit} per group',
        dsDistCsvAxis: '{col} (CSV column)',
        dsDistDrag: 'Drag on the distribution to pick a range',
        dsDistNotComputed: '{value} is not computed yet: it is computed per channel.',
        dsDistEmpty: 'No recording has this value under the filters.',
        dsDistGroups: '{n} groups',
        dsDistAll: 'All',
        dsDerivedRemove: 'Delete this fixed difference',
        dsBaseNarrowed: ' (within {filters})',
        dsBaseFewer: ' · {n} without ch {ch} left out',
        reportMemo: 'Memo',
        reportBaseDefinition: 'Base definition',
        reportDerived: 'Fixed Δ (D)',
        dsExportNotes: 'Memos and exclusions as CSV',
        dsSlotTrackChannel: 'The track shows ch{ch}',
        dsBatch: 'Export the Recipe for many files',
        stageBaseGated: "The base group has {n} recordings: they are not analysed until you ask.",
        stageBaseFromTable: "Base: the table's computed levels ({m} of {n}); the steps' pictures need the {n} analysed.",
        stageBaseScan: "Analyse the base group's {n} recordings · about {time}",
        hintBatch: 'The Recipe, the list of recordings and a script that runs it with wandas, as one folder: nothing runs in the app',
        dsBatchFiltered: 'Filtered: {n} recordings ({m} ch)',
        dsBatchAll: 'All: {n} recordings ({m} ch)',
        dsBatchNote: 'Nothing runs here: run run_recipe.py from the folder on your machine.',
        dsBatchGo: 'Export',
        dsBatchSaved: 'Exported the Recipe for {n} recordings: {folder}',
        hintExportNotes: 'The picked CSV as it was, with a memo and an excluded column added, to give back to whoever made it',
        dsDistLabel: 'Distribution by group',
        dsDistBack: '← Back to the distribution',
        dsDistBackHint: 'Close the comparison and choose again from the distribution (⤢)',
        dsDistPicked: 'Narrowed to {n} rows: × on the chip takes it off',
        dsComputeRest: 'Compute the rest · about {time}',
        dsLegendBaseMedian: 'Base (median of {group})',
        dsBaseMenu: 'Use as the base',
        dsBaseAuto: 'Median of the group of slot 1',
        dsBaseGroupMedian: 'Median of {group}',
        dsBaseRow: 'The selected recording (0)',
        dsBaseSet: 'The base is now the median of {group}',
        dsBaseSetAuto: 'The base is now the median of the group of slot 1',
        stepUndo: 'Undo (Ctrl+Z)',
        stepRedo: 'Redo (Ctrl+Shift+Z)',
        stepUndone: 'Undone',
        stepRedone: 'Redone',
        stepBypass: 'Bypass: compute without this step (M)',
        stepBypassOff: 'Turn the bypass off (M)',
        stepBypassed: 'Computing without {op}. Press bypass again to bring it back.',
        stepUnbypassed: '{op} is back in the chain',
        stepBypassing: ' ({ops} bypassed)',
        stepMenuEarlier: 'Goes in earlier',
        stepGoesBefore: 'Goes in before {step}',
        stepMenuOff: 'Not usable here',
        stepRegionStart: 'Start s',
        stepRegionEnd: 'End s',
        stepRegionPurpose: 'Cut a time range',
        stepRegionAdded: 'Added a region. ⚙ changes its range.',
        stepRegionCleared: 'Back to the whole file',
        stepRegionClear: 'Remove the region: the whole file again',
        stepRegionOrder: 'Enter the region as start < end, within the file',
        stepRegionThere: 'There is a region already (change it with its ⚙)',
        stepCannotShow: 'This step cannot be shown: {why}',
        stepCannotShowFix: 'Drag the ⚠ step to a place it fits, or remove it with ×',
        stepInputHint: "Press: the files' waveforms as they come in",
        entryScanCancel: 'Cancel',
        entryMinutes: '{n} min',
        entrySeconds: '{n} s',
        reportChain: 'Chain',
        reportChainCurrent: 'current (the Recipe in this folder)',
        reportChainPrevious: 'previous chain',
        stepNotDrawable: 'This step cannot be shown ({frame})',
        stepOpenCompare: 'Put files in slots 1–3 to compare them at this step.',
        axisLevel: 'Level [dB]',
        axisGain: 'Gain [dB]',
        axisCoherence: 'Coherence',
        axisBand: 'Band centre [Hz]',
        axisBark: 'Critical band [Bark]',
        axisQuefrency: 'Quefrency [s]',
        axisCepstrum: 'Real cepstrum',
        stageNoDelta: '— (Δ only between pictures of one kind on the same axes)',
        stageMaxDelta: 'largest Δ {at} {delta}',
        compareLevelsAt: '{at} base {base} / compare {compare}',
        compareHintPlot: 'Drag: zoom into the box / Ctrl+Wheel: zoom / Shift+Wheel: scroll / + −: zoom / Double-click: reset zoom',
        compareHintAxis: 'Double-click: set the range of this axis',
        compareDiffShow: 'Show Δ',
        compareDiffHide: 'Hide Δ',
        hintDiffToggle: 'Show the difference (compare − base) under the overlay, or hide it again',
        stepHeldWithout: 'without {step}',
        stepHeldRow: '{what} · {file}',
        stepHeldNoRow: 'Pick a row (click it) to see what the step does to it.',
        outside192: '192 points',
        outsideMedian: 'group median',
        outsideDelta: 'Δ',
        outsideOutliers: 'outliers',
        stepOutsideHeading: 'Outside the Recipe (computed by the app)',
        stepOpen: 'Details: each step\'s Frame, and ＋ between steps',
        stepClose: 'Hide details',
        stepOctave: '1/3 oct',
        stepFrameHint: 'wandas {op}',
        slotEmpty: 'empty',
        axisFrequency: 'Frequency [Hz]',
        axisLevelUncal: 'Amplitude, uncalibrated [dBFS]',
        axisLevelCal: 'Amplitude [dB re {ref} {unit}]',
        axisDelta: 'Δ [dB]',
        axisTime: 'Time [s]',
        legendHeadline: '1/3 oct headline',
        legendLeak: 'leak',
        legendLine: 'per point',
        compareNoSignificant: 'no clear difference',
        stepNeedAbove: 'Must be above {min}',
        stepNeedInteger: 'Must be a whole number',
        stepNeedValue: 'Enter a value (the field is empty)',
        hintSpectrogram: 'Average spectrum (n_fft, window): the curves of the comparison; hold to show the spectrograms instead',
        compareRefuseFix: 'D: no Δ to fix ({why}). Put a file in slot 0 on the entry table, or wait for the scan.',
        compareRefuseSlot: 'Slot {n} is empty: fill it on the entry table (1–3 on a row).',
        entryLeqUncalibrated: 'uncalibrated',
        hintLeqUncalibrated: 'Uncalibrated: 0 dB is the file\'s full scale, so levels read below 0. Calibrate to read sound pressure.',
        hintSpectrogramGroup: 'Hold to show spectrograms; with a group as the base there is no single file to show, so put a file in slot 0',
        screenHelpTitle: 'Keys and symbols',
        screenHelpEntry: '↑ / ↓\tmove between rows\n1–3\tput the row in a slot (hold: its Δ spectrum)\n0\tmake the row the base; on the base row, back to the group median (hold: show Δ)\nEnter\topen the slotted rows on the comparison\nEsc\tclose a setting, a filter, then the focused row (the old screen: the last line of this list)\n? / F1\tthis list',
        screenHelpCompare: '1–3\ttap: compare that slot; hold: compare it until released\n0\tswitch the base between the file in slot 0 and the group median\nD\tfix the comparison as a row of the entry table\nSteps / Overlay · Side by side\tthe tracks as a step of the Recipe, drawn over one another or each in its lane\nShow Δ\tshow the difference (compare − base) under the overlay\nEsc\tclose a setting, then go back to the entry table\n? / F1\tthis list',
        screenHelpSymbols: 'distribution\tthe chosen value per group: bars, a dot per recording when a group has few, a tick per recording below them\ndrag on it\ta range of the value: a chip that narrows the table (× or Esc takes it off)\n┃ (coloured)\ta slotted row, in its slot\'s colour\n┆ (blue, dashed)\tthe base: the median of a group\nslot\tthe four places 0–3 at the bottom: 0 the base, 1–3 the files to compare\n└ Δ\ta difference fixed with D, under the row it was fixed on\nfilled / outlined step\ta headline band / its leak into the neighbouring band filter\nstrip\tthe table\'s rows as 1/3-octave levels (row = recording, bright = loud)\nblue\tbase\nyellow / purple / magenta\tslots 1 / 2 / 3 (card, badge and line)\ngreen\tΔ (compare − base), not good or bad\norange\ta step that cannot run, or a recording that could not be read',
        keyHelp: '?',
        hintOverview: 'Every file\'s 1/3-octave levels: one row per file, brighter is louder; the frame is the rows on screen',
        hintBaseCard: '0: the base the compared file is measured against',
        hintSlotCard: 'Tap to compare this file; hold to swap it in until released',
        hintRegionMark: 'The comparison uses another region than the entry table; click to go back to it',
        hintCompareMark: 'No Δ to read against this base',
        hintStepChip: 'A step of the scan Recipe; ⚙ changes its settings',
        hintEntryMaximize: 'Widen the table to the whole window (⤢) or back into the side panel (⤡); a double click on this bar, or dragging the panel\'s edge past 60 % of the window, does the same. Esc shrinks it',
        hintRowPlay: 'Play this file alone (shown as a track)',
        hintRowStop: 'Stop',
        compareSingleBase: 'n=1',
        compareRegionDiffers: '≠ region',
        helpRowEntryKeys: 'entry table: 0 base (hold: Δ), 1–3 slot, Enter open, Esc close (old screen: from the ? list), ↑/↓ row',
        helpRowCompareKeys: 'comparing: hold 1–3 to swap the compared file, tap 1–3 to keep it, 0 base on the compared file, D fix the difference, Esc back to the entry table',
        helpRowStepKeys: 'step bar: press a step to see its Frame in the comparison, hold it to see what it does, ＋ adds a wandas operation, Delete on a step removes it',
        helpRowStepBypass: 'step bar: M on a step bypasses it (kept in place, skipped), M again brings it back',
        helpRowStepUndo: 'step bar: undo and redo its edits (↶ ↷)',
        helpRowStepDrag: 'step bar: drag a step to move it (the region stays where it is)',
        helpRowZoomKeys: 'zoom in / out / reset',
        playbackTimePrefix: '▶',
        playbackDisplayTitle: 'Playback position',
        clipBadgeTitle: 'Peak ≥ 0.99 — possible clipping',
        peakLabel: 'Peak',
        waveformAmplitudeLabel: 'Amp',
        calibrationBadgeUncalibratedHint: 'Uncalibrated full scale (dBFS)',
        calibrationBadgePartialHint: 'Some channels use physical calibration',
        calibrationFactorLabel: 'factor',
        calibrationButtonLabel: 'Cal',
        calibrationButtonTitle: 'Configure per-channel calibration',
        calibrationButtonAria: 'Configure calibration',
        calibrationOverlayIncompatible: 'Spectrum overlay is unavailable because visible channels use incompatible level references. Per-channel spectra remain available.',
        loopTimeDisplayTitle: 'Click to copy loop range',
        btnFollowCursor: 'Follow',
        btnFollowCursorTitle: 'Auto-scroll to keep cursor centered during playback (key: F)',
        specSettingsAuto: 'Auto (defaults)',
        specSettingsStftLegend: 'STFT',
        specSettingsNFft: 'n_fft',
        specSettingsOverlap: 'overlap',
        specSettingsWindow: 'window',
        specSettingsDisplayLegend: 'Display',
        specSettingsDbMin: 'dB min',
        specSettingsDbMax: 'dB max',
        specSettingsMaxFreqHz: 'max freq Hz',
        specSettingsPlaceholderAuto: 'auto',
        specSettingsPlaceholderNyquist: 'Nyquist',
        btnExportPng: 'Export PNG',
        btnExportPngTitle: 'Export visible tracks as PNG',
        btnExportCsv: 'Export CSV',
        btnExportCsvTitle: 'Export spectrum data as CSV',
        btnZoomToSelection: '⇔',
        btnZoomToSelectionTitle: 'Zoom to loop selection (L)',
        helpRowFollowCursor: 'toggle follow-cursor (auto-scroll during playback)',
        helpRowZoomToSelection: 'zoom to loop selection',
        btnExportWav: 'WAV',
        btnExportWavTitle: 'Export loop region as WAV (requires loop selection)',
        exportWavNoOverlap: 'Selected time range does not overlap a visible track.',
        exportWavNoLoop: 'No loop region selected. Drag on the waveform to create a loop first.',
        ariaToolbar: 'Main toolbar',
        ariaZoomOut: 'Zoom out',
        ariaZoomIn: 'Zoom in',
        ariaZoomReset: 'Reset zoom',
        ariaRemoveTrack: 'Remove track',
        ariaTrackPlay: 'Play / pause track',
        ariaTrackMute: 'Mute / unmute track',
        ariaTrackStop: 'Stop track',
        ariaOffsetUp: 'Increase offset',
        ariaOffsetDown: 'Decrease offset',
        ariaOffsetValue: 'Track offset',
        btnExportReport: 'Report',
        btnExportReportTitle: 'Export analysis report as Markdown or Jupyter Notebook',
        exportReportNoData: 'No analysis data to export.',
        recipeSaveNoData: 'No analysis to save as a recipe.',
        reportFormatMarkdown: 'Markdown (.md)',
        reportFormatNotebook: 'Jupyter Notebook (.ipynb)',
        reportFormatPlaceholder: 'Select report format',
        reportSaveLabel: 'Export Report',
        reportExportedPrefix: 'Report exported → ',
        recipeSaveLabel: 'Save Recipe',
        recipeSavedPrefix: 'Recipe saved → ',
        fileCountOne: '1 file',
        fileCountMany: '{count} files',
        exportSelectOutputFolder: 'Select output folder',
        exportWavComplete: 'WAV export complete ({files}) → {folder}',
        exportWavPartial: 'WAV export: {succeeded} succeeded, {failed} failed — {errors}',
        noSupportedAudioFiles: 'No supported audio files were found in {path}',
        progressSyncCalibration: 'Synchronizing calibration ({files})',
        progressRecomputeSpectrogram: 'Recomputing spectrogram ({files})',
        progressApplyCalibration: 'Applying calibration ({files})',
        dialogSelectAudioDirectory: 'Select audio directory',
        dialogSelectAudioFile: 'Select audio file',
        dialogAnalyzeAudioTarget: 'Analyze audio file or folder',
        dialogAudioFilesFilter: 'Audio Files',
        calFullScale: 'Full scale (FS / dBFS)',
        calSummary: 'factor {factor}; {unit}; {level}',
        calNoChannels: 'No audio channels are available for calibration.',
        calResetAllLabel: 'Reset all channels to full scale',
        calResetAllDescription: 'Remove the saved calibration profile for this file',
        calChannelLabel: 'Channel {n}: {label}',
        calConfigurePlaceholder: 'Configure calibration for {file}',
        calResetDone: 'Calibration reset to full scale: {file}',
        calModeCalibratedLabel: 'Calibrated physical quantity',
        calModeCalibratedDescription: 'Apply a raw-FS-to-physical conversion before analysis',
        calModeUncalibratedLabel: 'Uncalibrated full scale',
        calModeUncalibratedDescription: 'Use FS and dBFS for this channel',
        calFactorTitle: 'Calibration factor — {channel}',
        calFactorPrompt: 'Physical value = raw full-scale sample × factor',
        calUnitTitle: 'Physical unit — {channel}',
        calUnitPrompt: 'Examples: Pa, m/s^2, V. Use \'1\' for a dimensionless physical quantity.',
        calUnitRequired: 'Enter a unit, or \'1\' for dimensionless data.',
        calReferenceTitle: 'Level reference — {channel}',
        calReferencePromptPa: '20 µPa is 0.00002 Pa and produces dB SPL.',
        calReferencePrompt: 'Reference value in {unit}.',
        ariaDragHandle: 'Drag to reorder track',
        announceAnalyzing: 'Analyzing: {msg}',
        announceAnalysisDone: 'Analysis complete: {count} tracks',
        announceTrackRemoved: 'Track {n} removed',
        announceExportPngStarted: 'PNG export started',
        announceExportPngFailed: 'PNG export failed: no visible canvases',
        announceExportCsvStarted: 'CSV export started',
        announceExportCsvFailed: 'CSV export failed: no spectrum data at cursor',
        ariaSpecZoomIn: 'Spectrum zoom in',
        ariaSpecZoomOut: 'Spectrum zoom out',
        ariaSpecZoomReset: 'Spectrum zoom reset',
        btnSpecZoomReset: 'All',
        specRangeTitle: 'Range',
        specRangeAxisFreq: 'Frequency (Hz)',
        specRangeAxisDb: 'Level (dB)',
        waveRangeAxisAmplitude: 'Amplitude',
        waveRangeErrorTooNarrow: 'Range is too narrow for this channel',
        specRangeMin: 'Min',
        specRangeMax: 'Max',
        specRangeAuto: 'Auto',
        specRangeErrorMinMax: 'Min must be smaller than Max',
        specRangeClose: 'Close',
        rangeAxisX: 'X axis',
        rangeAxisY: 'Y axis',
        rangeAxisColor: 'Color',
        helpRowSpectrumDrag: 'drag zoom (spectrum)',
        helpRowWaveRectZoom: 'drag zoom (waveform zoom mode)',
        waveModeLabelRectZoom: 'Rect Zoom',
        hintContentWaveform: 'Show tracks as waveforms',
        hintContentSpectrogram: 'Show tracks as spectrograms (⚙ for STFT settings)',
        hintZoomOut: 'Zoom out in time (key: −)',
        hintZoomIn: 'Zoom in in time (key: +)',
        hintZoomReset: 'Show the whole time range (key: 0, or double-click a waveform)',
        hintRectZoom: 'Box zoom mode: drag on a waveform to zoom into that box',
        hintMenuExport: 'Export PNG, CSV, WAV or a report',
        hintRunRecipe: 'Run an analysis recipe on the loaded tracks',
        hintSaveRecipe: 'Save the bottom panel analysis over whole files, with its current settings, as a recipe',
        hintSpecZoomOut: 'Zoom the spectrum out',
        hintSpecZoomIn: 'Zoom the spectrum in (or drag a box on the spectrum)',
        hintSpecZoomReset: 'Show the whole spectrum (or double-click the plot)',
        hintSpectrumFft: 'FFT spectrum at the cursor',
        hintSpectrumOctave1: '1/1 octave band levels at the cursor (wandas noct_spectrum)',
        hintSpectrumOctave3: '1/3 octave band levels at the cursor (wandas noct_spectrum)',
        hintRemoveTrack: 'Remove this track from the comparison',
        hintOffsetUp: 'Offset +10 ms',
        trackMoreHint: 'Time offset',
        offsetStepUp: '+10 ms',
        offsetStepDown: '−10 ms',
        offsetEdit: 'Type an offset…',
        offsetReset: 'Reset the offset to 0',
        hintOffsetDown: 'Offset −10 ms',
        hintTrackHeightResizer: 'Drag to change the track height',
        hintSpectrumHeightResizer: 'Drag to change the spectrum height; double-click to collapse or expand it',
        hintTreeResizer: 'Drag to change the sidebar width; double-click to collapse it',
        hintCollapseSidebar: 'Collapse the file list',
        hintExpandSidebar: 'Show the file list',
        hintCollapseSpectrum: 'Collapse the power spectrum',
        hintExpandSpectrum: 'Show the power spectrum',
        hintMaximizeSpectrum: 'Maximize the power spectrum (Esc restores)',
        hintRestoreSpectrum: 'Restore the layout (Esc)',
        hintOpenFile: 'Add audio files from anywhere: they join the entry table\'s "Added files" and are shown as tracks at once',
        hintOpenFolder: 'Open another folder of audio files',
        hintWheelGestures: 'Wheel: scroll tracks / Ctrl+Wheel: zoom / Shift+Wheel: scroll in time',
        hintDoubleClickResetZoom: 'Double-click: reset zoom',
        hintRectZoomDrag: 'Drag: zoom into the box',
        hintSpectrumPlot: 'Drag: zoom into the box / Double-click: reset zoom / ← →: step through frequency bins',
        hintSpectrumDbAxis: 'Double-click: set the dB range',
        hintSpectrumFreqAxis: 'Double-click: set the frequency range',
        hintWaveformAmplitudeAxis: 'Double-click: set the amplitude range',
        hintSpectrumKeys: '← →: step through frequency bins',
        hintSpecAuto: 'Use the default STFT settings',
        hintSpecNFft: 'FFT length in samples: larger gives finer frequency resolution',
        hintSpecOverlap: 'Frame overlap: larger gives finer time resolution',
        hintSpecWindow: 'Window function applied to each frame',
        hintSpecDisplay: 'Display range, applied immediately (empty = auto)',
        hintSpecReset: 'Restore the default settings',
        hintSpecApply: 'Recompute the spectrogram with these STFT settings',
        hintBrowserOpenFolder: 'Open a folder on the entry table',
        hintBrowserAbout: 'Show limits, unavailable features and how audio is handled',
        pairReferenceHint: 'Transfer function reference',
        pairReferenceClearHint: 'Clear the reference',
        pairReferenceBadge: 'Ref',
        pairAverages: '{n} avg',
        pairFewAveragesHint: 'Few averages: γ² reads high. Widen the range or raise the overlap',
        pairResampledHint: 'Resampled to the reference rate',
        pairNoOverlapHint: 'No overlap with the reference in the range',
        pairTooShortHint: 'Overlap shorter than one FFT frame',
        pairOtherUnitHint: 'Calibrated to a different unit, so not drawn on this gain axis',
        pairPhaseLabel: 'Phase [°]',
        pairCoherenceLabel: 'γ²',
        pairSectionTitle: 'Transfer function and coherence against the reference',
        pairWaiting: 'Computing…',
        pairNoResponses: 'Show another channel to compare with the reference',
        pairFailed: 'Pair spectrum failed: {error}',
        hintPairDivider: 'Drag to change the split',
        hintOctaveDisabledByPair: 'Octave bands are off while a reference is set',
        hintPairPlot: 'Averaged over the loop region, or the whole overlap without one',
    },
    ja: {
        panelTitle: 'Audio Wandas Analyzer',
        emptyAllExcluded: 'すべてのトラックが除外されています',
        emptyNoTracks: '一覧で 1–3 や ▶ を押したファイルが、ここにトラックとして表示されます',
        selectionEmptyHint: 'フォルダを開くと、全ファイルの表がここに出ます',
        btnOpenFile: '＋ファイルを追加',
        browserEmptyPrompt: '音声ファイルやCSVをここにドロップするか、ファイルまたはフォルダを開いて比較を始めます',
        browserAbout: 'ⓘ ブラウザ版について',
        browserAboutPrivacy: '音声はこのブラウザ内で処理され、外部には送信されません。',
        browserAboutFileLimits: '1ファイル: 16 MiB・30秒・2chまで',
        browserAboutSessionLimits: '比較: 最大8トラック・入力合計64 MiBまで',
        browserAboutRecipes: '同梱レシピは読み込んだトラックに対して実行できます。',
        browserAboutUnsupported: '未対応: WDF・校正設定・vscode.dev',
        browserInputTooLarge: '1ファイル{mib} MiB以下を選択してください。',
        browserAggregateLimit: 'ブラウザ上限はファイル{count}件・入力合計{mib} MiBです。先にトラックを削除してください。',
        browserPreparing: 'ローカルPython Workerを準備・ファイルを追加しています…',
        browserReady: '波形の準備完了。{count}トラック。ファイルを追加して比較できます。自動再生は行いません。',
        browserWorkerFailed: '音声Workerで障害が発生しました。ファイルを選択し直してください。',
        browserPythonStarting: 'Python: 起動中…',
        browserPythonReady: 'Python: 準備完了',
        browserPythonFailed: 'Python: 起動に失敗',
        browserPythonStopped: 'Python: 停止中（必要になると再起動）',
        browserCleared: 'Workerを終了し、音声メモリを解放しました。短いファイルを追加できます。',
        browserRemoved: '全トラックを削除し、音声メモリを解放しました。',
        browserExported: '選択区間をPCM16 WAVで書き出しました。',
        browserFolderOpened: '読み込めるファイルを{count}件含むフォルダを開きました。0〜3 のスロットに入れるか、行の ＋ でトラックとして表示します。',
        browserDropNoWav: 'ドロップできるのは音声ファイルとCSVです。フォルダは「フォルダを開く」から開いてください。',
        browserUnavailable: 'Web版では未対応です。',
        browserRecipePick: 'レシピ',
        browserRecipeOpenFile: 'ファイルから…',
        browserRecipeRun: '実行',
        hintRecipeOpenFile: '手元の wandas .recipe.json を実行',
        browserRecipeNoSources: '先にファイルを追加してください。レシピは読み込んだトラックに対して実行します。',
        browserRecipeDone: 'レシピ実行完了: ',
        btnCloseRecipeResult: 'レシピ結果を閉じる',

        btnOpenAnotherFolder: '別のフォルダを開く',
        btnOpenFolder: 'フォルダを開く',
        selectionNoSupported: '対応する音声ファイルは見つかりませんでした。',
        spectrumSectionTitle: 'カーソル時刻のパワースペクトル（全トラック重ね合わせ）',
        toolbarTrackLabel: 'トラック:',
        btnWaveform: '波形',
        btnSpectrogram: 'スペクトログラム',
        btnStage: '手順',
        stageLayoutSide: '並べる',
        stageLayoutOverlay: '重ねる',
        compareFixedHint: '差を一覧の行として残しました（Esc で一覧）',
        hintContentStage: '手順ごとの結果を、比較するファイルどうし重ねて表示',
        btnSpectrogramSettingsTitle: 'スペクトログラム設定',
        btnSpectrumSettingsTitle: '周波数解析の設定（スペクトログラムと共通）',
        toolbarZoomLabel: 'ズーム:',
        btnZoomReset: 'リセット',
        toolbarExportLabel: '書き出し',
        heightTrackLabel: 'トラック',
        heightSpectrumLabel: 'スペクトル',
        btnRunRecipe: 'レシピ実行',
        btnSaveRecipe: 'レシピとして保存',
        chartSpecNoResults: 'レシピは何もチャートを返しませんでした。',
        chartSpecScalarLabelHeader: '項目',
        chartSpecScalarUnitHeader: '単位',
        cursorDisplayHint: 'カーソル時刻: 波形をクリックし、← → で微調整（Shift: 100 ms）',
        loopBadge: '🔁 ループ再生中',
        trackPlayTitle: '再生 / 一時停止',
        trackStopTitle: '停止',
        trackOffsetResetHint: 'クリック: オフセットを ms で入力 / ダブルクリック: 0 に戻す',
        offsetEditPlaceholder: 'ms',
        offsetEditAriaLabel: 'トラックオフセット（ミリ秒）',
        trackSpectrumTitle: 'メインカーソル時刻のパワースペクトル',
        analysisFailed: '解析失敗: ',
        cursorHelpKeys: '← →: カーソル移動　Shift+←→: 100ms移動　Space: 再生/停止',
        tooltipLoopResize: 'ドラッグでループ区間をリサイズ',
        tooltipLoopClear: 'クリックでループ解除',
        tooltipLoopOrShift: 'ドラッグ: ループ区間を設定 / Shift+ドラッグ: トラックの時間をずらす',
        canvasOutOfRange: '範囲外',
        spectrumNoData: 'カーソル位置にデータがあるトラックがありません',
        spectrumAnalysisWindow: '解析窓',
        spectrumAnalysisWindowPerTrack: '解析窓はトラックごとに異なります（帯を参照）',
        spectrogramLoading: 'スペクトログラムを読み込み中...',
        settingsApplyHint: '変更は「適用」で反映',
        reanalyzingStft: 'STFT を再計算中…',
        reanalyzingDefault: '再計算中…',
        reanalyzingFiles: 'STFT を再計算中… ({count} ファイル)',
        configurePython: 'Python 環境を設定する',
        helpTitle: 'キーボードショートカット',
        helpClose: '閉じる (Esc / ?)',
        helpRowSpace: '再生 / 停止',
        helpRowArrow: 'カーソル移動 (Shift: 高速)',
        helpRowWheel: 'トラックをスクロール (Shift: 時間方向にスクロール)',
        helpRowCtrlWheel: '時間方向にズーム',
        helpRowDrag: 'ループ作成 / リサイズ',
        helpRowShiftDrag: 'トラックのオフセット調整',
        helpRowDoubleClickEdge: 'ファイル一覧を畳む、スペクトルを畳む/戻す',
        helpRowQuestion: 'このヘルプを開閉',
        helpRowEsc: 'ポップオーバー / ヘルプを閉じる、最大化を戻す',
        entryColFile: 'ファイル',
        entryColCondition: '条件 {n}',
        entryColLeq: 'Leq dB(A)',
        entryColPeak: 'Δ最大帯域',
        entryOpen: '比較を表示',
        entryBaseGroup: '基準群',
        entryBase: '基準',
        entryCount: '{count} 件',
        entryKeySlot: '1–3 スロット',
        entryCsvGroupSize: '基準群 n',
        entrySourceGone: 'ファイルが一覧から外れました',
        entryFolderLevel: 'フォルダ階層{n}',
        compareKeyHold: '1–3 長押しで入れ替え',
        compareKeyBack: 'Esc 一覧へ',
        comparePlay: '再生',
        compareDelta: 'Δ = 比較 − 基準',
        stepNeedBelow: '{max} 未満にしてください',
        stepNeedPow2: '64〜{max} の 2 の冪にしてください',
        compareReport: '書き出し（比較フォルダ）',
        entryBaseMedian: '{count} 件の中央値',
        stageBaseAggregate: '集約：点ごとの中央値',
        stageBaseList: '一覧で見る',
        reportBase: '基準',
        reportCompare: '比較',
        reportDiff: '差',
        reportCsv: '報告',
        reportBaseLeq: '基準 Leq',
        reportBandDelta: 'Δ {band} dB',
        reportRegion: '区間 s',
        reportSummary: '要約',
        reportStepsLegend: '帯域：塗り＝見出し、枠＝隣への漏れ',
        reportRegionStart: '開始 s',
        reportRegionEnd: '終了 s',
        reportWhole: '全区間',
        reportDefinitions: '定義',
        defLeq: '区間の A 特性 RMS を 20·log10(rms / ref) で dB にした値。ref はチャンネルの校正値（1 = フルスケール。校正していないファイルは 0 dB より小さくなる）。',
        defSpectrum: 'Welch パワースペクトル（wandas welch、n_fft {n_fft}、{window} 窓）。dB はチャンネルの ref 基準。ビンを 20 Hz〜ナイキストの対数間隔の 192 点にパワー平均でまとめる（1 ビンより狭い点は補間）ので、細いピークは n_fft を長くすると低く出る。',
        defHeadline: '見出しは、|Δ| が両隣の帯域より大きく、偶然の範囲（基準の条件の他のファイルの 3 MAD（中央絶対偏差）、最小 1.5 dB）を超え、基準と比較の大きい方が最大の帯域から {within} dB 以内の帯域を、|Δ| の大きい順に 3 つまで、両方のレベルで出す。無ければ「有意な差なし」と出す。その山の隣で同じ符号の帯域は、帯域フィルタへの漏れなので枠だけで描き、見出しには出さない。',
        defHeadlineEdges: '手順のスペクトログラム・ケプストログラムでは、STFT のフレームの中心が信号の先頭・末尾から n_fft / 2 未満の列は、窓が信号からはみ出して外側の詰め物を読むので、描くが見出しには選ばない。',
        defRegion: 'どの指標も、手順のフィルタが響くファイルの最初と最後の 0.15 s を除いて測る。手順の time slice は実際に測った区間。',
        defThirdOct: 'wandas noct_spectrum（n = 3）。25 Hz から 0.88 × ナイキストまでの帯域の dB。中心が手順のフィルタの通過帯域の外にある帯域は空欄。',
        defChannels: 'チャンネルはパワー平均でまとめる（10^(L/10) の平均を 10·log10）。',
        defBase: 'スロット 0 のファイル。無ければ、比較するファイルと同じ条件の他のファイルの、点ごと・帯域ごとの中央値。',
        defDelta: '比較 − 基準（dB、点ごと・帯域ごと）。Δ最大帯域は |Δ| が最大の 1/3 oct 帯域。',
        reportGroupFiles: '基準群ファイル',
        reportSpecVersion: '解析仕様版',
        reportSaved: '報告を保存しました: ',
        stepRegion: '区間',
        stepAll: '全体',
        stepMetrics: '指標',
        stepAverage: '平均スペクトル',
        stepSettings: '設定',
        stepApply: '適用',
        stepRecipeWarning: '保存していたレシピを読めないため、標準のレシピを使います。',
        compareNotEntry: '≠ 一覧',
        comparePending: '未確定',
        compareBaseEntryRegion: '基準 = 一覧の区間',
        compareSelfBase: '≠ 同じファイル',
        stepRecipeName: '標準',
        stepHoldHint: '長押しの間、この手順あり／なしを比べる',
        stepHintNoHold: 'この画面では比べるものが無い。⚙ で設定',
        stepAdd: '手順を足す',
        stepMenuTitle: 'ここに手順を足す',
        stepMenuFilter: '操作を絞り込む',
        stepOffFrame: 'この位置の結果には使えません',
        stepOffRequired: '必須の設定 {params} を、アプリはまだ設定できません',
        stepOffRefuses: '{frame} では動きません（{reason}）',
        stepOffUnavailable: 'Web 版では使えません（{packages} が無い）',
        stepDefaultsOnly: '既定値',
        stepNoSettings: '設定項目の情報なし（wandas の既定値で実行します）',
        stepInputFiles: '入力 {n} 本',
        stepInput: '入力',
        stepHintLocale: 'ja',
        stepGroupFilter: 'フィルタ',
        stepGroupPrepare: '前処理',
        stepGroupTime: '時間変化',
        stepGroupFrequency: '周波数',
        stepGroupOther: 'その他',
        stepDragHint: 'ドラッグで並べ替え',
        stepMoved: '{op} を移しました',
        stepRemoveChip: 'このステップを削除（Del）',
        stepHighpass: 'ハイパス',
        stepLowpass: 'ローパス',
        stepBandpass: 'バンドパス',
        stepAverageFft: '{name}（FFT {n} 点）',
        stepOctaveHint: '表の帯域列の値',
        stepRemove: '外す',
        stepNeedFrame: '{op} は前の手順の結果に使えません。動かすか外してください',
        stepFailedOn: 'ファイルで失敗（{reason}）。設定を変えるか外してください',
        stepAfterBroken: '前の手順（{op}）が成立しないので表示できません',
        stepOctaveBroken: '手順が成立しないので、表の 1/3 oct の値を計算できません',
        entryChainBroken: '手順が成立しません · 表は前の手順の値です',
        stepTapHint: 'クリック: この手順の結果 · バイパス: この手順を飛ばして見る · 長押し: 押している間だけ飛ばして見る',
        stepAdded: '{op} を足しました。表示中のファイルを計算し直します。一覧は「全件を計算」で更新します。',
        stepRemoved: '{op} を外しました。全ファイルを計算し直します。',
        dsValue: '値',
        dsGroup: '群',
        dsGroupNone: 'なし',
        dsFromCsv: 'CSV の列',
        dsFromSound: '音から計算',
        dsLeq: 'Leq A特性 [dBFS]',
        dsPeak: 'ピーク周波数 [Hz]',
        dsCrest: '波高率 [比]',
        dsBand: '{band} 帯 [dBFS]',
        dsNotComputed: '未計算：先に「計算」を押してください',
        dsRows: '{n} 行',
        dsPickCsv: 'CSV を選ぶ',
        dsCsvSource: '{name} · {matched}/{total}',
        hintPickCsv: '録音の属性の CSV/TSV を 1 つ選ぶ（UTF-8、20 MB・128 列まで）',
        dsCsvError: 'CSV を読めませんでした：{reason}',
        dsCsvRead: '{name} を読みました：{total} 本中 {matched} 本が対応',
        dsUnmatched: '対応なし {n}',
        hintUnmatched: 'CSV と対応しなかった行と録音、読めなかった録音',
        dsUnreadable: '読めない {n}',
        hintUnreadable: '読めなかった録音',
        dsExcluded: '除外 {n}',
        hintExcluded: '集計から外した録音。ここから戻せます',
        dsReasonMissing: '未対応',
        dsReasonAmbiguous: '曖昧',
        dsReasonRepeated: '重複で不採用',
        dsReasonNoRow: '属性なし',
        dsReasonUnreadable: '読めない',
        dsCsvRow: 'CSV {n} 行目',
        dsReason: '理由',
        dsCompute: '計算 {n} 本 · 約 {time}',
        hintCompute: '選んでいる値を、表に出ている録音で計算する（絞り込みのとおり）',
        dsComputing: '計算中 {done} / {n}',
        dsUncomputed: '未計算 {n} ch',
        dsRowSlot: 'スロットに入れる：0 基準・1–3 比較（キー 0–3）',
        dsSlotCompare: '比較 {n}',
        dsSlotOut: 'スロットから外す',
        dsRowMemo: 'メモ（M）',
        dsRowExclude: '集計から外す（「除外」から戻せます）',
        dsRowExcludeShort: '外す',
        dsRowRestore: '戻す',
        dsMemoPlaceholder: '気付いたこと',
        dsMemoClose: '保存して閉じる',
        dsSortAsc: '昇順',
        dsSortDesc: '降順',
        dsFilterClear: '「{col}」から絞り込みを外す',
        dsFilterSearch: '検索',
        dsFilterAll: '（すべて選択）',
        dsFilterAllFound: '（検索結果をすべて選択）',
        dsFilterBlank: '（空欄）',
        dsFilterMore: 'ほか {n} 件。検索で絞ってください',
        dsFilterNone: '当たる値がありません',
        dsFilterRange: '範囲',
        dsFilterLow: '下限',
        dsFilterHigh: '上限',
        dsFilterAdd: '＋ 絞り込み',
        dsFilterColumn: '列',
        dsFilterPickOne: '値を 1 つ以上選んでください',
        dsFilterApplied: '{n} 行に絞りました',
        dsFilterRemoved: '{col} の絞り込みを外しました',
        dsFilterHead: 'この列で並べ替え・絞り込み',
        dsFilterOn: '絞り込み中。押すと直せます',
        dsChipRemove: 'この絞り込みを外す',
        dsSlotEmptyHint: 'スロット {n}：押すと選んでいる行を入れます（行のスロットボタン、キー {n} でも）',
        dsSlotFilledHint: 'スロット {n}：押すとその行へ移ります',
        dsSlotClear: 'スロット {n} を空ける',
        dsBaseReset: '群を変えたので、基準を群の中央値に戻しました',
        dsCh: 'ch',
        dsCancel: 'キャンセル',
        dsProbing: 'チャンネル数を読み込み中 {done} / {n}',
        dsDistMax: '最大 {n}',
        dsUnitRecording: '録音',
        dsDistCountAxis: '縦：{unit}数（群ごと）',
        dsDistCsvAxis: '{col}（CSV の列）',
        dsDistDrag: '分布をドラッグで範囲を囲む',
        dsDistNotComputed: '{value} はまだ計算していません。チャンネルごとに計算します。',
        dsDistEmpty: '絞り込みに当たる録音がありません。',
        dsDistGroups: '{n} 群',
        dsDistAll: '全体',
        dsDerivedRemove: 'この固定した差を消す',
        dsBaseNarrowed: '（{filters} に絞った中で）',
        dsBaseFewer: ' · ch {ch} のない {n} 本は除外',
        reportMemo: 'メモ',
        reportBaseDefinition: '基準の定義',
        reportDerived: '固定した差（D）',
        dsExportNotes: 'メモと除外を CSV に書き出す',
        dsSlotTrackChannel: 'トラックは ch{ch} で表示',
        dsBatch: 'レシピをまとめて書き出す',
        stageBaseGated: '基準の群は {n} 本です。押すまで解析しません。',
        stageBaseFromTable: '基準は表で計算済みの値（{n} 本中 {m} 本）から。手順の絵には {n} 本の解析が要ります。',
        stageBaseScan: '基準の群 {n} 本を解析する · 約 {time}',
        hintBatch: 'Recipe と録音の一覧、それを wandas で実行するスクリプトを 1 つのフォルダに書き出します。アプリの中では実行しません',
        dsBatchFiltered: '絞り込んだ {n} 本 ({m} ch)',
        dsBatchAll: 'すべて {n} 本 ({m} ch)',
        dsBatchNote: 'アプリの中では実行しません。書き出したフォルダの run_recipe.py を手元で実行します。',
        dsBatchGo: '書き出す',
        dsBatchSaved: '{n} 本分のレシピを書き出しました：{folder}',
        hintExportNotes: '選んだ CSV をそのまま、メモと除外の列を足して書き出します。CSV を作った人に返せます',
        dsDistLabel: '群ごとの分布',
        dsDistBack: '← 分布に戻る',
        dsDistBackHint: '比較を閉じて、分布から選び直す（⤢）',
        dsDistPicked: '{n} 行に絞りました。チップの × で外せます',
        dsComputeRest: '残りを計算 · 約 {time}',
        dsLegendBaseMedian: '基準（{group} の中央値）',
        dsBaseMenu: '基準にする',
        dsBaseAuto: '比較 1 と同じ群の中央値',
        dsBaseGroupMedian: '{group} の中央値',
        dsBaseRow: '選んでいる録音を基準にする（0）',
        dsBaseSet: '基準を {group} の中央値にしました',
        dsBaseSetAuto: '基準を比較 1 と同じ群の中央値にしました',
        stepUndo: '元に戻す（Ctrl+Z）',
        stepRedo: 'やり直す（Ctrl+Shift+Z）',
        stepUndone: '元に戻しました',
        stepRedone: 'やり直しました',
        stepBypass: 'バイパス：この手順を飛ばして計算する（M）',
        stepBypassOff: 'バイパスを外す（M）',
        stepBypassed: '{op} を飛ばして計算しています。もう一度バイパスを押すと戻ります',
        stepUnbypassed: '{op} を戻しました',
        stepBypassing: '（{ops} をバイパス中）',
        stepMenuEarlier: '前の段に入る手順',
        stepGoesBefore: '{step} の前に入ります',
        stepMenuOff: 'ここでは使えない手順',
        stepRegionStart: '始め s',
        stepRegionEnd: '終わり s',
        stepRegionPurpose: '時間の範囲を切り出す',
        stepRegionAdded: '区間を足しました。⚙ で範囲を変えられます',
        stepRegionCleared: 'ファイル全体に戻しました',
        stepRegionClear: '区間を外してファイル全体に戻す',
        stepRegionOrder: '区間は 0 ≤ 始め < 終わり で入れてください',
        stepRegionThere: 'もう区間があります（区間のチップの ⚙ で変更）',
        stepCannotShow: 'この手順は表示できません：{why}',
        stepCannotShowFix: '⚠ の手順をドラッグで正しい位置へ動かすか、× で外してください',
        stepInputHint: 'クリック: 入力のファイルの波形',
        entryScanCancel: '中止',
        entryMinutes: '{n} 分',
        entrySeconds: '{n} 秒',
        reportChain: '手順',
        reportChainCurrent: '現在の手順（同じフォルダの Recipe）',
        reportChainPrevious: '前の手順',
        stepNotDrawable: 'この手順の結果は表示できません（{frame}）',
        stepOpenCompare: '行の 1–3 を押すと、この手順の結果を比べられます',
        axisLevel: 'レベル [dB]',
        axisGain: '利得 [dB]',
        axisCoherence: 'コヒーレンス',
        axisBand: '帯域中心 [Hz]',
        axisBark: '臨界帯域 [Bark]',
        axisQuefrency: 'ケフレンシー [s]',
        axisCepstrum: '実ケプストラム',
        stageNoDelta: '— 差は同じ種類・同じ軸の結果どうしでだけ出せます',
        stageMaxDelta: '最大 Δ {at} {delta}',
        compareLevelsAt: '{at} 基準 {base} / 比較 {compare}',
        compareHintPlot: 'ドラッグ: 囲んだ範囲にズーム / Ctrl+ホイール: ズーム / Shift+ホイール: 横にスクロール / + −: ズーム / ダブルクリック: ズームをリセット',
        compareHintAxis: 'ダブルクリック: この軸の範囲を設定',
        compareDiffShow: '差も表示',
        compareDiffHide: '差を隠す',
        hintDiffToggle: '重ね描きの下に差（比較 − 基準）を出す。もう一度押すと隠す',
        stepHeldWithout: '{step} なし',
        stepHeldRow: '{what} · {file}',
        stepHeldNoRow: '行を選ぶと（クリック）、その行で手順の効果を見せます。',
        outside192: '192 点',
        outsideMedian: '群の中央値',
        outsideDelta: 'Δ',
        outsideOutliers: '外れ値',
        stepOutsideHeading: 'Recipe の外（アプリで計算）',
        stepOpen: '詳しく：各手順の結果の種類と、手順の間に足す＋',
        stepClose: '詳しくを閉じる',
        stepOctave: '1/3 oct 帯域（表の値）',
        stepFrameHint: 'wandas {op}',
        slotEmpty: '空き',
        axisFrequency: '周波数 [Hz]',
        axisLevelUncal: '振幅 未校正 [dBFS]',
        axisLevelCal: '振幅 [dB re {ref} {unit}]',
        axisDelta: '差 [dB]',
        axisTime: '時間 [s]',
        legendHeadline: '1/3 oct 見出し',
        legendLeak: '漏れ',
        legendLine: '点ごとの差',
        compareNoSignificant: '有意な差なし',
        stepNeedAbove: '{min} より大きくしてください',
        stepNeedInteger: '整数にしてください',
        stepNeedValue: '値を入れてください（欄が空）',
        hintSpectrogram: '平均スペクトルの設定（FFT 長・窓）。長押しでスペクトログラム',
        compareRefuseFix: 'D：残せる差がありません（{why}）。一覧でスロット 0 にファイルを入れるか、一括計算が終わるのを待ってください',
        compareRefuseSlot: 'スロット {n} は空です。一覧の行で 1–3 を押して入れてください',
        entryLeqUncalibrated: '未校正',
        hintLeqUncalibrated: '未校正：0 dB はファイルのフルスケールなので、値は 0 より小さくなる。音圧として読むには校正が要る。',
        hintSpectrogramGroup: '長押しでスペクトログラム。基準が群のときは 1 本のファイルが無いので、スロット 0 にファイルを入れる',
        screenHelpTitle: 'キーと記号',
        screenHelpEntry: '↑ / ↓\t行を移動\n1–3\t行をスロットに入れる（長押しの間は Δ スペクトル）\n0\t行を基準にする。基準の行でもう一度押すと群の中央値へ（長押しの間は Δ を表示）\nEnter\tスロットの行を比較を表示\nEsc\t設定 → 絞り込み → 行の選択の順に閉じる\n? / F1\tこの一覧',
        screenHelpCompare: '1–3\t押して比較を切り替え、長押しの間だけ入れ替え\n0\t基準をスロット 0 のファイル ⇄ 群の中央値で切り替え\nD\t比較を一覧の行として固定\n手順 / 重ねる・並べる\tトラックを手順で描く。1 枚に重ねるか、レーンに並べる\n差も表示\t重ね描きの下に差（比較 − 基準）を出す\nEsc\t設定を閉じる → 一覧へ\n? / F1\tこの一覧',
        screenHelpSymbols: '分布\t選んだ値の群ごとの分布。棒、録音が少ない群は 1 本ずつの点、下に 1 本ずつの目盛\n分布のドラッグ\t値の範囲。表を絞るチップになる（× か Esc で外す）\n┃（色付き）\tスロットに入れた行。スロットの色\n┆（青の破線）\t基準。群の中央値\nスロット\t下の 0–3 の 4 つの枠。0 が基準、1–3 が比べるファイル\n└ Δ\tD で固定した差。固定した行の下に出る\n塗りの帯 / 枠の帯\t見出しの帯域 / その隣の帯域フィルタへの漏れ\n俯瞰帯\t表の行の 1/3 oct（行＝録音、明るい＝大きい）\n青\t基準\n黄 / 紫 / 赤紫\tスロット 1 / 2 / 3（カード・番号・線）\n緑\tΔ（比較 − 基準）。良し悪しではない\n橙\t実行できない手順、読めなかった録音',
        keyHelp: '?',
        hintOverview: '全ファイルの 1/3 oct。1 行が 1 ファイル、明るいほど大きい。枠は表に見えている行',
        hintBaseCard: '0: 比較するファイルの基準',
        hintSlotCard: 'クリックで比較、長押しの間だけ入れ替え',
        hintRegionMark: '比較の区間が一覧と違う。押すと一覧の区間に戻す',
        hintCompareMark: 'この基準とは差を出せない（形が違う）',
        hintStepChip: '一覧の計算に使う手順。⚙ で設定',
        hintEntryMaximize: '表をウィンドウ全体に広げる（⤢）／左パネルに戻す（⤡）。このバーのダブルクリック、パネルの端をウィンドウの 6 割より先までドラッグしても同じ。Esc で縮める',
        hintRowPlay: 'このファイルだけを再生（トラックにも表示）',
        hintRowStop: '止める',
        compareSingleBase: 'n=1',
        compareRegionDiffers: '≠ 区間',
        helpRowEntryKeys: 'ファイル一覧: 0 基準（長押しで差）、1–3 スロット、Enter 比較を表示、Esc 閉じる、↑/↓ 行',
        helpRowCompareKeys: '比較: 1–3 長押しで比較を入れ替え、押して固定、0 比較中を基準に、D 差を残す、Esc 一覧へ',
        helpRowStepKeys: '手順バー: 手順を押すとその結果、長押しでその手順あり／なし、＋ で wandas の操作を足す、手順で Delete で外す',
        helpRowStepBypass: '手順バー: 手順で M を押すとバイパス（残したまま飛ばす）、もう一度で戻す',
        helpRowStepUndo: '手順バー: 編集を元に戻す／やり直す（↶ ↷）',
        helpRowStepDrag: '手順バー: 手順をドラッグして並べ替え（区間は動かせない）',
        helpRowZoomKeys: 'ズームイン / アウト / リセット',
        playbackTimePrefix: '▶',
        playbackDisplayTitle: '再生位置',
        clipBadgeTitle: 'ピーク ≥ 0.99 — クリッピングの可能性',
        peakLabel: 'ピーク',
        waveformAmplitudeLabel: '振幅',
        calibrationBadgeUncalibratedHint: '未校正のフルスケール (dBFS)',
        calibrationBadgePartialHint: '一部のチャンネルのみ物理量に校正済み',
        calibrationFactorLabel: '係数',
        calibrationButtonLabel: '校正',
        calibrationButtonTitle: 'チャンネルごとの校正を設定',
        calibrationButtonAria: '校正を設定',
        calibrationOverlayIncompatible: '表示中のチャンネルのレベル基準が互換でないため、スペクトルの重ね表示は使用できません。チャンネルごとのスペクトルは引き続き表示できます。',
        loopTimeDisplayTitle: 'クリックでループ範囲をコピー',
        btnFollowCursor: '追従',
        btnFollowCursorTitle: '再生中にカーソルを中央に保つ（キー: F）',
        specSettingsAuto: '自動 (デフォルト)',
        specSettingsStftLegend: 'STFT',
        specSettingsNFft: 'n_fft',
        specSettingsOverlap: '重なり率',
        specSettingsWindow: 'ウィンドウ',
        specSettingsDisplayLegend: '表示設定',
        specSettingsDbMin: 'dB 最小',
        specSettingsDbMax: 'dB 最大',
        specSettingsMaxFreqHz: '最大周波数 Hz',
        specSettingsPlaceholderAuto: '自動',
        specSettingsPlaceholderNyquist: 'ナイキスト',
        btnExportPng: 'PNG 出力',
        btnExportPngTitle: '表示中のトラックを PNG として出力',
        btnExportCsv: 'CSV 出力',
        btnExportCsvTitle: 'スペクトルデータを CSV として出力',
        btnZoomToSelection: '⇔',
        btnZoomToSelectionTitle: 'ループ選択範囲にズーム (L)',
        helpRowFollowCursor: 'フォロー追従のオン/オフ（再生中にカーソルを追従）',
        helpRowZoomToSelection: 'ループ選択範囲にズーム',
        btnExportWav: 'WAV',
        btnExportWavTitle: 'ループ区間を WAV として書き出す（ループ選択が必要）',
        exportWavNoOverlap: '選択した時間区間に重なる表示トラックがありません。',
        exportWavNoLoop: 'ループ区間が選択されていません。波形上をドラッグしてループ区間を作成してください。',
        ariaToolbar: 'メインツールバー',
        ariaZoomOut: 'ズームアウト',
        ariaZoomIn: 'ズームイン',
        ariaZoomReset: 'ズームリセット',
        ariaRemoveTrack: 'トラックを削除',
        ariaTrackPlay: 'トラックを再生／一時停止',
        ariaTrackMute: 'トラックをミュート／解除',
        ariaTrackStop: 'トラックを停止',
        ariaOffsetUp: 'オフセットを増やす',
        ariaOffsetDown: 'オフセットを減らす',
        ariaOffsetValue: 'トラックオフセット',
        btnExportReport: 'レポート',
        btnExportReportTitle: '解析結果を Markdown または Jupyter Notebook として書き出す',
        exportReportNoData: 'エクスポートする解析データがありません。',
        recipeSaveNoData: 'レシピにする解析がありません。',
        reportFormatMarkdown: 'Markdown (.md)',
        reportFormatNotebook: 'Jupyter Notebook (.ipynb)',
        reportFormatPlaceholder: 'レポート形式を選択',
        reportSaveLabel: 'レポートを書き出す',
        reportExportedPrefix: 'レポートを書き出しました → ',
        recipeSaveLabel: 'レシピを保存',
        recipeSavedPrefix: 'レシピを保存しました → ',
        fileCountOne: '1 ファイル',
        fileCountMany: '{count} ファイル',
        exportSelectOutputFolder: '出力フォルダを選択',
        exportWavComplete: 'WAV を書き出しました ({files}) → {folder}',
        exportWavPartial: 'WAV 書き出し: 成功 {succeeded} 件、失敗 {failed} 件 — {errors}',
        noSupportedAudioFiles: '{path} に対応する音声ファイルが見つかりませんでした',
        progressSyncCalibration: '校正を同期中 ({files})',
        progressRecomputeSpectrogram: 'スペクトログラムを再計算中 ({files})',
        progressApplyCalibration: '校正を適用中 ({files})',
        dialogSelectAudioDirectory: '音声フォルダを選択',
        dialogSelectAudioFile: '音声ファイルを選択',
        dialogAnalyzeAudioTarget: '解析する音声ファイルまたはフォルダを選択',
        dialogAudioFilesFilter: '音声ファイル',
        calFullScale: 'フルスケール (FS / dBFS)',
        calSummary: '係数 {factor}; {unit}; {level}',
        calNoChannels: '校正できる音声チャンネルがありません。',
        calResetAllLabel: 'すべてのチャンネルをフルスケールに戻す',
        calResetAllDescription: 'このファイルの保存済み校正プロファイルを削除します',
        calChannelLabel: 'チャンネル {n}: {label}',
        calConfigurePlaceholder: '{file} の校正を設定',
        calResetDone: '校正をフルスケールに戻しました: {file}',
        calModeCalibratedLabel: '校正済みの物理量',
        calModeCalibratedDescription: '解析の前に生の FS 値を物理量に換算します',
        calModeUncalibratedLabel: '未校正のフルスケール',
        calModeUncalibratedDescription: 'このチャンネルは FS と dBFS で扱います',
        calFactorTitle: '校正係数 — {channel}',
        calFactorPrompt: '物理量 = 生のフルスケール値 × 係数',
        calUnitTitle: '物理単位 — {channel}',
        calUnitPrompt: '例: Pa、m/s^2、V。無次元の物理量には \'1\' を入力します。',
        calUnitRequired: '単位を入力してください。無次元のデータには \'1\' を入力します。',
        calReferenceTitle: 'レベル基準値 — {channel}',
        calReferencePromptPa: '20 µPa は 0.00002 Pa で、dB SPL になります。',
        calReferencePrompt: '{unit} での基準値。',
        ariaDragHandle: 'ドラッグしてトラックを並び替え',
        announceAnalyzing: '解析中: {msg}',
        announceAnalysisDone: '解析完了: {count}件',
        announceTrackRemoved: 'トラック{n}を削除',
        announceExportPngStarted: 'PNG 出力を開始しました',
        announceExportPngFailed: 'PNG 出力失敗：表示中のキャンバスがありません',
        announceExportCsvStarted: 'CSV 出力を開始しました',
        announceExportCsvFailed: 'CSV 出力失敗：カーソル位置にスペクトルデータがありません',
        ariaSpecZoomIn: 'スペクトル拡大',
        ariaSpecZoomOut: 'スペクトル縮小',
        ariaSpecZoomReset: 'スペクトルズームリセット',
        btnSpecZoomReset: '全域',
        specRangeTitle: 'レンジ',
        specRangeAxisFreq: '周波数 (Hz)',
        specRangeAxisDb: 'レベル (dB)',
        waveRangeAxisAmplitude: '振幅',
        waveRangeErrorTooNarrow: 'このチャンネルには狭すぎる範囲です',
        specRangeMin: 'Min',
        specRangeMax: 'Max',
        specRangeAuto: '自動',
        specRangeErrorMinMax: 'Min は Max より小さい値を入力してください',
        specRangeClose: '閉じる',
        rangeAxisX: 'X 軸',
        rangeAxisY: 'Y 軸',
        rangeAxisColor: 'カラー',
        helpRowSpectrumDrag: '矩形ズーム (スペクトル)',
        helpRowWaveRectZoom: '矩形ズーム (波形ズームモード時)',
        waveModeLabelRectZoom: '矩形ズーム',
        hintContentWaveform: 'トラックを波形で表示',
        hintContentSpectrogram: 'トラックをスペクトログラムで表示（⚙ で STFT 設定）',
        hintZoomOut: '時間方向にズームアウト（キー: −）',
        hintZoomIn: '時間方向にズームイン（キー: +）',
        hintZoomReset: '全体を表示（キー: 0、または波形をダブルクリック）',
        hintRectZoom: '矩形ズームモード: 波形上をドラッグした範囲にズーム',
        hintMenuExport: 'PNG・CSV・WAV・レポートを書き出す',
        hintRunRecipe: '読み込んだトラックに解析レシピを実行',
        hintSaveRecipe: '下のパネルの解析を、今の設定でファイル全体を計算するレシピとして保存',
        hintSpecZoomOut: 'スペクトルをズームアウト',
        hintSpecZoomIn: 'スペクトルをズームイン（スペクトル上のドラッグでも可）',
        hintSpecZoomReset: 'スペクトル全体を表示（グラフのダブルクリックでも可）',
        hintSpectrumFft: 'カーソル位置の FFT スペクトル',
        hintSpectrumOctave1: 'カーソル位置の 1/1 オクターブバンドレベル（wandas noct_spectrum）',
        hintSpectrumOctave3: 'カーソル位置の 1/3 オクターブバンドレベル（wandas noct_spectrum）',
        hintRemoveTrack: 'このトラックを比較から外す',
        hintOffsetUp: 'オフセット +10 ms',
        trackMoreHint: '時間オフセット',
        offsetStepUp: '+10 ms',
        offsetStepDown: '−10 ms',
        offsetEdit: '値を入力…',
        offsetReset: 'オフセットを 0 に戻す',
        hintOffsetDown: 'オフセット −10 ms',
        hintTrackHeightResizer: 'ドラッグでトラックの高さを変更',
        hintSpectrumHeightResizer: 'ドラッグでスペクトルの高さを変更、ダブルクリックで畳む/戻す',
        hintTreeResizer: 'ドラッグでサイドバーの幅を変更、ダブルクリックで畳む',
        hintCollapseSidebar: 'ファイル一覧を畳む',
        hintExpandSidebar: 'ファイル一覧を表示',
        hintCollapseSpectrum: 'パワースペクトルを畳む',
        hintExpandSpectrum: 'パワースペクトルを表示',
        hintMaximizeSpectrum: 'パワースペクトルを最大化（Esc で戻す）',
        hintRestoreSpectrum: '元の配置に戻す（Esc）',
        hintOpenFile: 'どこからでも音声ファイルを追加。一覧の「追加したファイル」に入り、すぐトラックとして表示される',
        hintOpenFolder: '別の音声フォルダを開く',
        hintWheelGestures: 'ホイール: トラックをスクロール / Ctrl+ホイール: ズーム / Shift+ホイール: 時間方向にスクロール',
        hintDoubleClickResetZoom: 'ダブルクリック: ズームをリセット',
        hintRectZoomDrag: 'ドラッグ: 囲んだ範囲にズーム',
        hintSpectrumPlot: 'ドラッグ: 囲んだ範囲にズーム / ダブルクリック: ズームをリセット / ← →: 周波数ビンを移動',
        hintSpectrumDbAxis: 'ダブルクリック: dB 範囲を設定',
        hintSpectrumFreqAxis: 'ダブルクリック: 周波数範囲を設定',
        hintWaveformAmplitudeAxis: 'ダブルクリック: 振幅範囲を設定',
        hintSpectrumKeys: '← →: 周波数ビンを移動',
        hintSpecAuto: 'STFT 設定を既定値にする',
        hintSpecNFft: 'FFT 長（サンプル）: 大きいほど周波数分解能が細かくなります',
        hintSpecOverlap: 'フレームの重なり: 大きいほど時間分解能が細かくなります',
        hintSpecWindow: '各フレームにかける窓関数',
        hintSpecDisplay: '表示範囲。すぐに反映されます（空欄は自動）',
        hintSpecReset: '既定の設定に戻す',
        hintSpecApply: 'この STFT 設定でスペクトログラムを再計算',
        hintBrowserOpenFolder: 'フォルダを開き、一覧で選ぶ',
        hintBrowserAbout: '制限・未対応機能・音声の扱いを表示',
        pairReferenceHint: '伝達関数の基準',
        pairReferenceClearHint: '基準を解除',
        pairReferenceBadge: '基準',
        pairAverages: '{n}平均',
        pairFewAveragesHint: '平均回数が少なく γ² が高めに出ます。範囲を広げるかオーバーラップを上げてください',
        pairResampledHint: '基準のサンプルレートにリサンプル済み',
        pairNoOverlapHint: '範囲内に基準との重なりがありません',
        pairTooShortHint: '重なりが FFT 1 フレームより短い',
        pairOtherUnitHint: '校正の単位が異なるため、このゲイン軸には描画しません',
        pairPhaseLabel: '位相 [°]',
        pairCoherenceLabel: 'γ²',
        pairSectionTitle: '基準に対する伝達関数とコヒーレンス',
        pairWaiting: '計算中…',
        pairNoResponses: '基準と比べる別のチャンネルを表示してください',
        pairFailed: 'ペアスペクトルの計算に失敗しました: {error}',
        hintPairDivider: 'ドラッグで分割位置を変更',
        hintOctaveDisabledByPair: '基準の設定中はオクターブバンドを使えません',
        hintPairPlot: 'ループ範囲で平均。ループがなければ重なり全体で平均',
    },
};

/**
 * VS Code の言語 (例: 'ja', 'en-US') から SupportedLocale を選ぶ。
 * 'ja' で始まる場合のみ日本語、それ以外は英語フォールバック。
 */
export function pickLocale(language: string | undefined): SupportedLocale {
    if (typeof language !== 'string') { return 'en'; }
    return language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/** Labels for the shared axis range popover (comparison spectrum and recipe charts). */
export function rangePopoverStrings(strings: UiStrings) {
    return {
        title: strings.specRangeTitle,
        min: strings.specRangeMin,
        max: strings.specRangeMax,
        apply: strings.stepApply,
        auto: strings.specRangeAuto,
        close: strings.specRangeClose,
        invalid: strings.specRangeErrorMinMax,
        axisX: strings.rangeAxisX,
        axisY: strings.rangeAxisY,
        axisColor: strings.rangeAxisColor,
    };
}

/** Replaces each `{name}` placeholder in `template` with `values[name]`; unknown placeholders stay as is. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

export function fileCountLabel(strings: UiStrings, count: number): string {
    return fillTemplate(count === 1 ? strings.fileCountOne : strings.fileCountMany, { count });
}

export function getStrings(language: string | undefined): UiStrings {
    return STRINGS[pickLocale(language)];
}

/** テストや拡張ホスト側で必要なときのために辞書全体を露出する。 */
export function getAllStrings(): Record<SupportedLocale, UiStrings> {
    return STRINGS;
}
