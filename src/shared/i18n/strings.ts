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
    browserAnalysisStopped: string;
    browserRemoveFailed: string;
    browserFolderReadFailed: string;
    browserFileFailed: string;
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
    btnStage: string;
    stageLayoutSide: string;
    /** A role chip's hint, its menu's "none", and the comparison's headline while nothing is compared. */
    roleChipHint: string;
    roleNone: string;
    stageChooseRoles: string;
    stageCompareMinusBase: string;
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
    toolbarCursorLabel: string;
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
    spectrogramFailed: string;
    settingsApplyHint: string;
    reanalyzingStft: string;
    reanalyzingDefault: string;
    reanalyzingFiles: string;
    configurePython: string;
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
    trackNoAudio: string;
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
    stepNeedChannels: string;
    stepNarrowedChannels: string;
    stepOffChannels: string;
    stepReference: string;
    stepReferenceChannel: string;
    stepReferenceSlot: string;
    stepReferenceSet: string;
    stagePairBase: string;
    stageVsBase: string;
    stageBaseLane: string;
    entryBatchNoBase: string;
    stageNeedBaseFile: string;
    stepPairSelf: string;
    stepNeedChannel: string;
    stepPair: string;
    stepPairOutput: string;
    stepPairInput: string;
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
    dsListSeparator: string;
    dsMoreCandidates: string;
    csvColumnsMismatch: string;
    csvColumnsHintExtra: string;
    csvColumnsHintMissing: string;
    csvDelimiterComma: string;
    csvDelimiterTab: string;
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
    dsFilterRangeSeparator: string;
    dsFilterMoreValues: string;
    dsFilterMore: string;
    dsFilterNone: string;
    dsFilterRange: string;
    dsFilterLow: string;
    dsFilterHigh: string;
    dsFilterAdd: string;
    dsTrackMark: string;
    dsTracksOnly: string;
    hintTracksOnly: string;
    dsTracksAll: string;
    dsTracksNone: string;
    dsTracksRest: string;
    dsTracksConfirm: string;
    dsTracksConfirmGo: string;
    dsFilterColumn: string;
    dsFilterPickOne: string;
    dsFilterApplied: string;
    dsFilterRemoved: string;
    dsFilterHead: string;
    dsFilterOn: string;
    dsChipRemove: string;
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
    dsExportTable: string;
    toolbarMore: string;
    hintEntryExport: string;
    dsBatch: string;
    stageBaseScan: string;
    stageBaseTableNote: string;
    stageBaseTableHint: string;
    stageBaseNoLine: string;
    stepRegionImported: string;
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
    dsBaseAuto: string;
    dsBaseGroupMedian: string;
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
    axisLag: string;
    axisCorrelation: string;
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
    helpRowStepKeys: string;
    helpRowStepBypass: string;
    helpRowStepUndo: string;
    helpSectionGeneral: string;
    helpSectionLanes: string;
    helpSectionEntry: string;
    helpSectionCompare: string;
    helpSectionSteps: string;
    helpSectionSymbols: string;
    helpRowResizeKeys: string;
    helpRowStepMenuEnter: string;
    helpEntryRows: string;
    helpEntrySlot: string;
    helpEntryBase: string;
    helpEntryOpen: string;
    helpEntryPlay: string;
    helpEntryTrack: string;
    helpEntryMemo: string;
    helpEntryEsc: string;
    helpCompareSlot: string;
    helpCompareBase: string;
    helpCompareZoom: string;
    helpCompareFix: string;
    helpComparePlay: string;
    helpCompareEsc: string;
    helpCompareLayoutKey: string;
    helpCompareLayout: string;
    helpCompareDiff: string;
    ariaWaveformCanvas: string;
    ariaSpectrogramCanvas: string;
    ariaStageOverlayCanvas: string;
    ariaStageDiffCanvas: string;
    ariaStageLaneCanvas: string;
    ariaResizeTrackHeight: string;
    ariaResizeSpectrumHeight: string;
    ariaResizeSidebar: string;
    ariaEntryOverview: string;
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
    btnLinkScales: string;
    hintLinkScales: string;
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
    specSettingsColorRange: string;
    specSettingsWindowBoxcar: string;
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
    fileNotInSession: string;
    directoryListingProgress: string;
    directoryListingTruncated: string;
    openTargetFailed: string;
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
    exportPngBusy: string;
    exportPngDone: string;
    exportCsvBusy: string;
    exportCsvDone: string;
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
    hintTrackSplit: string;
    trackSplitLabel: string;
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
    hintSpectrogramFrequencyAxis: string;
    hintSpectrogramColorbar: string;
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
    pyTooltipSelect: string;
    pyTooltipMissingDeps: string;
    pyTooltipMissingInterpreter: string;
    pyTooltipPipUnavailable: string;
    pyTooltipCheckFailed: string;
    pyTooltipImporting: string;
    pyTooltipBackendFailed: string;
    analysisPythonNotReady: string;
    pyTooltipBackendStopped: string;
    pyStatusImporting: string;
    pyPickPlaceholder: string;
    pyPickFromPythonExtension: string;
    pyPickFromVirtualEnv: string;
    pyPickWorkspaceVenv: string;
    pyPickCurrent: string;
    pyPickOther: string;
    pyPickCreateVenv: string;
    pyPickCreateVenvDetail: string;
    pyPickBrowse: string;
    pyPickBrowseOpenLabel: string;
    pyInterpreterNotFound: string;
    pyPipUnavailable: string;
    pyCheckFailed: string;
    pyMissingPackages: string;
    pyExternallyManaged: string;
    pyBtnInstall: string;
    pyBtnCreateVenv: string;
    pyBtnSelect: string;
    pyBtnShowLog: string;
    pyInstallProgress: string;
    pyCreateVenvProgress: string;
    pyInstallSucceeded: string;
    pyInstallFailed: string;
    pyInstallTimedOut: string;
    pyInstallCancelled: string;
    pyVenvFailed: string;
    pyVenvNoEnsurepip: string;
    pySavedToUserSettings: string;
    pyUntrustedWorkspacePath: string;
    pyTooltipUntrustedWorkspacePath: string;
    welcomeDropLabel: string;
    welcomeDropDescription: string;
    welcomeDropCommand: string;
    debugPathNotConfigured: string;
    debugPathNotFound: string;
    analysisProgressTitle: string;
    recipePickPlaceholder: string;
    recipeBrowseLabel: string;
    recipeBrowseDescription: string;
    recipeFileFilter: string;
    recipeOpenLabel: string;
    recipeInputsOpenLabel: string;
    recipeInputPlaceholder: string;
    recipeNotDocument: string;
    recipeReadFailed: string;
    recipeRunFailed: string;
    recipeRunning: string;
    calibrationNoPanel: string;
    calibrationNoChannels: string;
    calibrationPickTrack: string;
    calibrationChannelFallback: string;
}

const STRINGS: Record<SupportedLocale, UiStrings> = {
    en: {
        panelTitle: 'Audio Wandas Analyzer',
        emptyAllExcluded: 'All tracks are excluded',
        emptyNoTracks: 'Click ☐ on a row of the table to show its file here as a track; click ☑ to remove it',
        selectionEmptyHint: 'Open a folder to list every file here',
        btnOpenFile: '＋ Add files',
        browserEmptyPrompt: 'Drop audio or CSV files here, or open files or a folder, to start comparing',
        browserAbout: 'ⓘ About the browser version',
        browserAboutPrivacy: 'Audio is processed in this browser and never uploaded.',
        browserAboutFileLimits: 'Each file: up to 80 MiB and 2 ch.',
        browserAboutSessionLimits: 'Comparison: up to 8 tracks, 256 MiB of input and about 17 min of 48 kHz stereo in total.',
        browserAboutRecipes: 'Bundled recipes run on the loaded tracks.',
        browserAboutUnsupported: 'Not available here: WDF, calibration configuration, vscode.dev.',
        browserInputTooLarge: 'Each file must be {mib} MiB or smaller.',
        browserAggregateLimit: 'Browser session limit: up to {count} files / {mib} MiB total input. Remove a track first.',
        browserPreparing: 'Preparing local Python Worker / adding files…',
        browserReady: 'waveform ready. {count} tracks; add more files to compare. No automatic playback.',
        browserWorkerFailed: 'Audio Worker failed; select the files again.',
        browserAnalysisStopped: 'The analysis stopped: {error}',
        browserRemoveFailed: 'Could not remove the track: {error}',
        browserFolderReadFailed: 'Could not read the folder: {error}',
        browserFileFailed: '{file} could not be opened: {error}',
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
        toolbarTrackLabel: 'View:',
        btnWaveform: 'Tracks',
        btnStage: 'Compare',
        stageLayoutSide: 'One lane per track',
        roleChipHint: 'Role: base 0 or compare 1–3 (0–3 while focused)',
        roleNone: 'None',
        stageChooseRoles: 'Choose recordings to compare: their chips in the legend',
        stageCompareMinusBase: 'Compare {n} − base · ',
        stageLayoutOverlay: 'Overlay',
        compareFixedHint: 'Fixed: the difference is now the └ Δ row of the table (Esc to see it)',
        hintContentStage: 'Compare the tracks through an analysis: build it from wandas steps and see every track at any step, overlaid',
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
        toolbarCursorLabel: 'Cursor',
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
        canvasOutOfRange: 'Cursor is outside this track',
        spectrumNoData: 'No track has data at the cursor position',
        spectrumAnalysisWindow: 'window',
        spectrumAnalysisWindowPerTrack: 'window differs per track (see the bands)',
        spectrogramLoading: 'Loading spectrogram...',
        spectrogramFailed: 'Spectrogram failed: {reason}',
        settingsApplyHint: 'These recompute when you press Apply; the display below changes as you type.',
        reanalyzingStft: 'Recomputing STFT…',
        reanalyzingDefault: 'Recomputing…',
        reanalyzingFiles: 'Recomputing STFT… ({count} files)',
        configurePython: 'Configure Python environment',
        helpClose: 'Close (Esc / ?)',
        helpRowSpace: 'play / pause',
        helpRowArrow: 'move cursor  (Shift: fast)',
        helpRowWheel: 'scroll tracks  (Shift, or a sideways swipe: scroll in time)',
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
        entryOpen: 'Open Compare',
        entryBaseGroup: 'Base group',
        entryBase: 'Base',
        entryCount: '{count} files',
        trackNoAudio: 'No playback: this track has no decoded audio.',
        entryCsvGroupSize: 'Base group n',
        entrySourceGone: 'The file is no longer listed',
        entryFolderLevel: 'Folder {n}',
        compareKeyHold: 'hold 1–3 swap',
        compareKeyBack: 'Esc table',
        comparePlay: 'Play',
        compareDelta: 'Δ = compare − base',
        stepNeedBelow: 'Must be below {max}',
        stepNeedPow2: 'A power of two from 64 to {max}',
        compareReport: 'Export (comparison folder)',
        entryBaseMedian: 'median of {count}',
        stageBaseAggregate: 'Aggregate: the median at each point',
        stageBaseList: 'Show in the table',
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
        compareNotEntry: '≠ table',
        comparePending: 'computing…',
        compareBaseEntryRegion: 'base = table region',
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
        stepNeedChannels: 'Needs two channels, and a file here has only one. Set its reference to the base recording (⚙), or remove it.',
        stepNarrowedChannels: '{op} leaves one channel: this step needs two. Move it before {op}, or remove one of them.',
        stepOffChannels: 'Needs two channels: a file here has only one',
        stepReference: 'Reference',
        stepReferenceChannel: 'Channel of this recording',
        stepReferenceSlot: 'Base recording',
        stepReferenceSet: '{op}: reference {reference}',
        stagePairBase: 'vs base',
        stageVsBase: 'Measured against the base: {file}',
        stageBaseLane: 'Base (compared against): {file}',
        entryBatchNoBase: 'A step here compares each file with the base recording, so it cannot be exported for many files. Set its reference to a channel (⚙) first.',
        stageNeedBaseFile: 'This step compares each recording with the base recording: choose one recording as Base (a group cannot be Base)',
        stepPairSelf: 'Choose two different channels: a channel with itself always gives the same',
        stepNeedChannel: 'Channel 1 to {n}',
        stepPair: 'ch{output} / ch{input}',
        stepPairOutput: 'Channel',
        stepPairInput: 'Reference channel',
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
        dsListSeparator: ', ',
        dsMoreCandidates: '{n} more',
        csvColumnsMismatch: 'Data row {row} (line {lines} of the file) has {actual} columns, but the header (line {header}) has {expected}.',
        csvColumnsHintExtra: 'Look for a delimiter at the end of the row, or a {delimiter} inside a cell that is not in double quotes.',
        csvColumnsHintMissing: 'Keep a delimiter for every empty value, so the row has as many columns as the header.',
        csvDelimiterComma: 'comma (,)',
        csvDelimiterTab: 'tab',
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
        dsRowExcludeShort: 'Exclude',
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
        dsFilterRangeSeparator: '–',
        dsFilterMoreValues: '{first} +{count} more',
        dsFilterMore: '{n} more: narrow with the search',
        dsFilterNone: 'No matching values',
        dsFilterRange: 'Range',
        dsFilterLow: 'From',
        dsFilterHigh: 'To',
        dsFilterAdd: '＋ Filter',
        dsTrackMark: 'On a track (click to show or remove it)',
        dsTracksOnly: 'Tracks only {n}',
        hintTracksOnly: 'Show only the rows whose file is on a track',
        dsTracksAll: 'Show the {n} listed files as tracks',
        dsTracksNone: 'Take the {n} listed files off the tracks',
        dsTracksRest: 'Show the other {n} listed files as tracks too',
        dsTracksConfirm: '{n} files will be shown as tracks and analyzed.',
        dsTracksConfirmGo: 'Show',
        dsFilterColumn: 'Column',
        dsFilterPickOne: 'Pick at least one value',
        dsFilterApplied: 'Narrowed to {n} rows',
        dsFilterRemoved: 'Cleared the filter on {col}',
        dsFilterHead: 'Sort or filter by this column',
        dsFilterOn: 'Filtered: press to change',
        dsChipRemove: 'Remove this filter',
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
        dsExportTable: 'The table as CSV',
        toolbarMore: 'More zoom tools: box zoom, zoom to the selection, follow the cursor',
        hintEntryExport: 'The table\'s exports: the Recipe for many files, the table and its memos as CSV',
        dsBatch: 'Export the Recipe for many files',
        stageBaseScan: "Analyse the base group's {n} recordings with the same steps · about {time}",
        stageBaseTableNote: ' (table values · whole files)',
        stageBaseTableHint: "Drawn from the levels the table computed over each whole file ({m} of {n}); analysing the base group may move the line",
        stageBaseNoLine: ' (not analysed: no line yet)',
        stepRegionImported: "Region set from the tracks' selection (× or ↶ takes it off)",
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
        dsBaseAuto: 'Median of the group of slot 1',
        dsBaseGroupMedian: 'Median of {group}',
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
        axisLag: 'Lag [s]',
        axisCorrelation: 'Correlation coefficient',
        stageNoDelta: '— (Δ only between pictures of one kind on the same axes)',
        stageMaxDelta: 'largest Δ {at} {delta}',
        compareLevelsAt: '{at} base {base} / compare {compare}',
        compareHintPlot: 'Drag: zoom into the box / Ctrl+Wheel: zoom / Shift+Wheel, swipe sideways: scroll / + −: zoom / Double-click: reset zoom',
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
        compareRefuseFix: 'D: no Δ to fix ({why}). Put a file in slot 0 on the table, or wait for the scan.',
        compareRefuseSlot: 'Slot {n} is empty: fill it on the table (1–3 on a row).',
        entryLeqUncalibrated: 'uncalibrated',
        hintLeqUncalibrated: 'Uncalibrated: 0 dB is the file\'s full scale, so levels read below 0. Calibrate to read sound pressure.',
        hintSpectrogramGroup: 'Hold to show spectrograms; with a group as the base there is no single file to show, so put a file in slot 0',
        screenHelpTitle: 'Keys and symbols',
        screenHelpSymbols: '☐ / ☑ (first column)\ta row\'s file off / on a track (T, or Enter / Space on it); the head\'s ⊟: some of them\n● ■ ◆ (on a step)\ta step\'s output: a time signal / an image / a spectrum\ndistribution\tthe chosen value per group: bars, a dot per recording when a group has few, a tick per recording below them\ndrag on it\ta range of the value: a chip that narrows the table (× or Esc takes it off)\n┃ (coloured)\ta slotted row, in its slot\'s colour\n┆ (blue, dashed)\tthe base: the median of a group\nslot\tthe four places 0–3 at the bottom: 0 the base, 1–3 the files to compare\n└ Δ\ta difference fixed with D, under the row it was fixed on\nfilled / outlined step\ta headline band / its leak into the neighbouring band filter\nstrip\tthe table\'s rows as 1/3-octave levels (row = recording, bright = loud)\nblue\tbase\nyellow / purple / magenta\tslots 1 / 2 / 3 (card, badge and line)\ngreen\tΔ (compare − base), not good or bad\norange\ta step that cannot run, or a recording that could not be read',
        keyHelp: '?',
        hintOverview: 'Every file\'s 1/3-octave levels: one row per file, brighter is louder; the frame is the rows on screen',
        hintBaseCard: '0: the base the compared file is measured against',
        hintSlotCard: 'Tap to compare this file; hold to swap it in until released',
        hintRegionMark: 'The comparison uses another region than the table; click to go back to it',
        hintCompareMark: 'No Δ to read against this base',
        hintStepChip: 'A step of the scan Recipe; ⚙ changes its settings',
        hintEntryMaximize: 'Widen the table to the whole window (⤢) or back into the side panel (⤡); a double click on this bar, or dragging the panel\'s edge past 60 % of the window, does the same. Esc shrinks it',
        hintRowPlay: 'Play this file alone (shown as a track)',
        hintRowStop: 'Stop',
        compareSingleBase: 'n=1',
        compareRegionDiffers: '≠ region',
        helpRowStepKeys: 'step bar: press a step to see its Frame in the comparison, hold it to see what it does, ＋ adds a wandas operation, Delete on a step removes it',
        helpRowStepBypass: 'step bar: M on a step bypasses it (kept in place, skipped), M again brings it back',
        helpRowStepUndo: 'step bar: undo and redo its edits (↶ ↷)',
        helpSectionGeneral: 'Everywhere',
        helpSectionLanes: 'Tracks',
        helpSectionEntry: 'Table',
        helpSectionCompare: 'Compare',
        helpSectionSteps: 'Step bar',
        helpSectionSymbols: 'Symbols and colours',
        helpRowResizeKeys: 'on a focused resize edge: move it (Shift: faster; Home / End: smallest / largest)',
        helpRowStepMenuEnter: 'in ＋\'s filter: add the first operation listed',
        helpEntryRows: 'move between rows',
        helpEntrySlot: 'put the row in a slot (hold: its Δ spectrum)',
        helpEntryBase: 'make the row the base; on the base row, back to the group median (hold: show Δ)',
        helpEntryOpen: 'open the slotted rows in Compare',
        helpEntryPlay: 'play the row\'s recording',
        helpEntryTrack: 'show the row\'s file as a track, or take it off (as its ☐ / ☑)',
        helpEntryMemo: 'write a memo on the row',
        helpEntryEsc: 'close a setting, a filter, then the focused row; maximized, the table shrinks',
        helpCompareSlot: 'tap: compare that slot; hold: compare it until released',
        helpCompareBase: 'switch the base between the file in slot 0 and the group median',
        helpCompareZoom: 'zoom the horizontal axis in / out / back to all of it',
        helpCompareFix: 'fix the comparison as a row of the table',
        helpComparePlay: 'play the compared recording (▶ in the legend: any of them)',
        helpCompareEsc: 'close a setting, then go back to where Compare was opened from (the tracks or the table)',
        helpCompareLayoutKey: 'Overlay / One lane per track',
        helpCompareLayout: 'the tracks as a step of the Recipe, drawn over one another or each in its lane',
        helpCompareDiff: 'show the difference (compare − base) under the overlay',
        ariaWaveformCanvas: '{file} · {channel} · waveform',
        ariaSpectrogramCanvas: '{file} · {channel} · spectrogram',
        ariaStageOverlayCanvas: 'Compare: the tracks at the step shown',
        ariaStageDiffCanvas: 'Compare: the difference (compare − base)',
        ariaStageLaneCanvas: 'Compare: {file}',
        ariaResizeTrackHeight: 'Track height',
        ariaResizeSpectrumHeight: 'Spectrum panel height',
        ariaResizeSidebar: 'Width of the file list',
        ariaEntryOverview: '1/3-octave levels of the listed rows',
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
        btnLinkScales: 'Link scales',
        hintLinkScales: 'Same amplitude, colour (dB) and frequency scale on all tracks (per unit)',
        specSettingsAuto: 'Use the default analysis',
        specSettingsStftLegend: 'Analysis',
        specSettingsNFft: 'FFT size',
        specSettingsOverlap: 'Overlap',
        specSettingsWindow: 'Window',
        specSettingsDisplayLegend: 'Display',
        specSettingsDbMin: 'Colour range low (dB)',
        specSettingsDbMax: 'Colour range high (dB)',
        specSettingsMaxFreqHz: 'Max frequency (Hz)',
        specSettingsPlaceholderAuto: 'auto',
        specSettingsPlaceholderNyquist: 'Nyquist',
        specSettingsColorRange: 'Colour range (dB)',
        specSettingsWindowBoxcar: 'Rectangular',
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
        fileNotInSession: 'Not a file this panel lists: {path}',
        directoryListingProgress: 'Listing audio files in {path}',
        directoryListingTruncated: 'Listed the first {count} entries of {path} only. Open a subfolder to see the rest.',
        openTargetFailed: 'Could not open {path}: {reason}',
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
        exportPngBusy: 'Exporting PNG…',
        exportPngDone: 'PNG exported: {name}',
        exportCsvBusy: 'Exporting CSV…',
        exportCsvDone: 'CSV exported: {name}',
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
        hintContentWaveform: 'Show each track as its waveform over its spectrogram (⚙ for STFT settings); from Compare, Esc comes back here',
        hintTrackSplit: 'Drag to share the track between waveform and spectrogram (all tracks)',
        trackSplitLabel: 'Waveform / spectrogram split',
        hintZoomOut: 'Zoom out in time (key: −)',
        hintZoomIn: 'Zoom in in time (key: +)',
        hintZoomReset: 'Show the whole time range (key: 0, or double-click a waveform)',
        hintRectZoom: 'Box zoom mode: drag on a waveform to zoom into that box',
        hintMenuExport: 'Everything that is written out: the tracks (PNG, CSV, WAV, report), the comparison folder, the Recipe for many files, the table and its memos',
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
        hintOpenFile: 'Add audio files from anywhere: they join the table\'s "Added files" and are shown as tracks at once',
        hintOpenFolder: 'Open another folder of audio files',
        hintWheelGestures: 'Wheel: scroll tracks / Ctrl+Wheel: zoom / Shift+Wheel, swipe sideways: scroll in time',
        hintDoubleClickResetZoom: 'Double-click: reset zoom',
        hintRectZoomDrag: 'Drag: zoom into the box',
        hintSpectrumPlot: 'Drag: zoom into the box / Double-click: reset zoom / ← →: step through frequency bins',
        hintSpectrumDbAxis: 'Double-click: set the dB range',
        hintSpectrumFreqAxis: 'Double-click: set the frequency range',
        hintWaveformAmplitudeAxis: 'Double-click: set the amplitude range',
        hintSpectrogramFrequencyAxis: 'Double-click: set the frequency range',
        hintSpectrogramColorbar: 'Double-click: set the colour scale (dB)',
        hintSpectrumKeys: '← →: step through frequency bins',
        hintSpecAuto: 'Use the default STFT settings',
        hintSpecNFft: 'FFT length in samples: larger gives finer frequency resolution',
        hintSpecOverlap: 'Frame overlap: larger gives finer time resolution',
        hintSpecWindow: 'Window function applied to each frame',
        hintSpecDisplay: 'Display range, applied immediately (empty = auto)',
        hintSpecReset: 'Restore the default settings',
        hintSpecApply: 'Recompute the spectrogram with these STFT settings',
        hintBrowserOpenFolder: 'Open a folder in the table',
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
        pyTooltipSelect: 'Click to select the Python environment',
        pyTooltipMissingDeps: 'Python packages are missing or incompatible. Click to select an environment or install them.',
        pyTooltipMissingInterpreter: 'The Python interpreter was not found. Click to select another environment.',
        pyTooltipPipUnavailable: 'pip is not available in this environment. Click to select another environment.',
        pyTooltipCheckFailed: 'The Python environment check failed. Click to select another environment.',
        pyTooltipImporting: 'Importing the Python analysis modules in the background.',
        pyTooltipBackendFailed: 'The Python backend failed to start: {message}',
        analysisPythonNotReady: 'The Python environment is not ready for analysis. Install the packages or select another environment from the Python item in the status bar.',
        pyTooltipBackendStopped: 'The Python backend stopped: {message}. It restarts on the next request.',
        pyStatusImporting: 'Python: importing modules',
        pyPickPlaceholder: 'Select the Python environment for Audio Wandas Analyzer',
        pyPickFromPythonExtension: 'Selected in the Python extension',
        pyPickFromVirtualEnv: 'Active virtual environment (VIRTUAL_ENV)',
        pyPickWorkspaceVenv: 'Virtual environment in this workspace',
        pyPickCurrent: 'Current',
        pyPickOther: 'Other',
        pyPickCreateVenv: '$(add) Create .venv and install packages',
        pyPickCreateVenvDetail: 'Runs python -m venv .venv in the workspace and installs the required packages',
        pyPickBrowse: '$(folder) Browse...',
        pyPickBrowseOpenLabel: 'Select Python environment',
        pyInterpreterNotFound: 'Python interpreter not found: {command}',
        pyPipUnavailable: 'pip is not available in {command}. Select another environment or create a .venv.',
        pyCheckFailed: 'Could not check the Python packages in {command}. See the log for details.',
        pyMissingPackages: 'Audio Wandas Analyzer needs compatible Python packages in {command}: {packages}',
        pyExternallyManaged: '{command} is managed by the operating system (PEP 668), so packages cannot be installed into it. Create a .venv or select another environment.',
        pyBtnInstall: 'Install',
        pyBtnCreateVenv: 'Create .venv and Install',
        pyBtnSelect: 'Select Environment',
        pyBtnShowLog: 'Show Log',
        pyInstallProgress: 'Installing Python packages into {command}',
        pyCreateVenvProgress: 'Creating {path}',
        pyInstallSucceeded: 'Python packages installed.',
        pyInstallFailed: 'Installing the Python packages failed. See the log for details.',
        pyInstallTimedOut: 'Installing the Python packages took longer than {minutes} minutes and was stopped.',
        pyInstallCancelled: 'Installing the Python packages was cancelled.',
        pyVenvFailed: 'Creating {path} failed. See the log for details.',
        pyVenvNoEnsurepip: 'Creating {path} failed because the venv module is unavailable (on Debian or Ubuntu, install python3-venv).',
        pySavedToUserSettings: 'This workspace is in Restricted Mode, so {command} was saved to your user settings.',
        pyUntrustedWorkspacePath: '{command} is a path inside this workspace, and Restricted Mode does not start programs from an untrusted workspace. Trust the workspace or select an interpreter by its full path.',
        pyTooltipUntrustedWorkspacePath: 'Restricted Mode: the interpreter path points into this workspace. Click to select another environment.',
        welcomeDropLabel: 'Drop audio files or folders here',
        welcomeDropDescription: 'Click to choose a file or folder',
        welcomeDropCommand: 'Analyze File or Folder',
        debugPathNotConfigured: 'Debug audio path is not configured. Set audioWandasAnalyzer.debugFilePath to an audio file or directory.',
        debugPathNotFound: 'Debug audio path was not found: {path}. Update audioWandasAnalyzer.debugFilePath or add the file or directory.',
        analysisProgressTitle: 'Analyzing {files} with wandas',
        recipePickPlaceholder: 'Select a wandas recipe',
        recipeBrowseLabel: '$(folder-opened) Browse...',
        recipeBrowseDescription: 'Pick a recipe JSON from disk',
        recipeFileFilter: 'Recipe JSON',
        recipeOpenLabel: 'Use recipe',
        recipeInputsOpenLabel: 'Use as recipe input',
        recipeInputPlaceholder: 'Recipe input "{name}" ({index}/{total})',
        recipeNotDocument: '{path} is not a recipe document',
        recipeReadFailed: 'Could not read recipes: {message}',
        recipeRunFailed: 'Recipe execution failed: {message}',
        recipeRunning: 'Running recipe {title}…',
        calibrationNoPanel: 'Open an audio analysis panel before configuring calibration.',
        calibrationNoChannels: 'The active analysis panel has no calibratable audio channels.',
        calibrationPickTrack: 'Select a track to calibrate',
        calibrationChannelFallback: 'Channel {n}',
    },
    ja: {
        panelTitle: 'Audio Wandas Analyzer',
        emptyAllExcluded: 'すべてのトラックが除外されています',
        emptyNoTracks: '表の行の ☐ をクリックすると、そのファイルをここにトラックとして表示します。☑ をクリックで消えます',
        selectionEmptyHint: 'フォルダを開くと、全ファイルの表がここに出ます',
        btnOpenFile: '＋ファイルを追加',
        browserEmptyPrompt: '音声ファイルやCSVをここにドロップするか、ファイルまたはフォルダを開いて比較を始めます',
        browserAbout: 'ⓘ ブラウザ版について',
        browserAboutPrivacy: '音声はこのブラウザ内で処理され、外部には送信されません。',
        browserAboutFileLimits: '1ファイル: 80 MiB・2chまで',
        browserAboutSessionLimits: '比較: 最大8トラック・入力合計256 MiB・48 kHzステレオで合計約17分まで',
        browserAboutRecipes: '同梱レシピは読み込んだトラックに対して実行できます。',
        browserAboutUnsupported: '未対応: WDF・校正設定・vscode.dev',
        browserInputTooLarge: '1ファイル{mib} MiB以下を選択してください。',
        browserAggregateLimit: 'ブラウザ上限はファイル{count}件・入力合計{mib} MiBです。先にトラックを削除してください。',
        browserPreparing: 'ローカルPython Workerを準備・ファイルを追加しています…',
        browserReady: '波形の準備完了。{count}トラック。ファイルを追加して比較できます。自動再生は行いません。',
        browserWorkerFailed: '音声Workerで障害が発生しました。ファイルを選択し直してください。',
        browserAnalysisStopped: '解析を中断しました: {error}',
        browserRemoveFailed: 'トラックを外せませんでした: {error}',
        browserFolderReadFailed: 'フォルダを読めませんでした: {error}',
        browserFileFailed: '{file} を開けませんでした: {error}',
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
        toolbarTrackLabel: '表示:',
        btnWaveform: 'トラック',
        btnStage: '比較解析',
        stageLayoutSide: 'トラックごとに並べる',
        roleChipHint: '役割：基準 0・比較 1〜3（フォーカス中は 0〜3 キー）',
        roleNone: 'なし',
        stageChooseRoles: '比べる録音を選ぶ：凡例のチップで',
        stageCompareMinusBase: '比較 {n} − 基準 · ',
        stageLayoutOverlay: '重ねる',
        compareFixedHint: '差を表の └ Δ 行として残しました（Esc で一覧）',
        hintContentStage: '比較解析：wandas の手順を組んで、どの段でもトラックどうしを重ねて比べる',
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
        toolbarCursorLabel: 'カーソル',
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
        canvasOutOfRange: 'カーソルがこのトラックの外です',
        spectrumNoData: 'カーソル位置にデータがあるトラックがありません',
        spectrumAnalysisWindow: '解析窓',
        spectrumAnalysisWindowPerTrack: '解析窓はトラックごとに異なります（帯を参照）',
        spectrogramLoading: 'スペクトログラムを読み込み中...',
        spectrogramFailed: 'スペクトログラムを計算できませんでした: {reason}',
        settingsApplyHint: 'ここは「適用」で再計算します。下の表示は入力するとすぐ変わります',
        reanalyzingStft: 'STFT を再計算中…',
        reanalyzingDefault: '再計算中…',
        reanalyzingFiles: 'STFT を再計算中… ({count} ファイル)',
        configurePython: 'Python 環境を設定する',
        helpClose: '閉じる (Esc / ?)',
        helpRowSpace: '再生 / 停止',
        helpRowArrow: 'カーソル移動 (Shift: 高速)',
        helpRowWheel: 'トラックをスクロール (Shift か横スワイプ: 時間方向にスクロール)',
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
        entryOpen: '比較解析を開く',
        entryBaseGroup: '基準群',
        entryBase: '基準',
        entryCount: '{count} 件',
        trackNoAudio: '再生できません: このトラックには復号済みの音声がありません',
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
        comparePending: '計算中…',
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
        stepNeedChannels: '2 チャンネルが必要ですが、1 チャンネルのファイルがあります。⚙ で参照を「基準の録音」にするか、外してください',
        stepNarrowedChannels: '{op} で 1 チャンネルになっています。この手順には 2 チャンネルが必要です。{op} より前に動かすか、どちらかを外してください',
        stepOffChannels: '2 チャンネルが必要です（1 チャンネルのファイルあり）',
        stepReference: '参照',
        stepReferenceChannel: 'この録音のチャンネル',
        stepReferenceSlot: '基準の録音',
        stepReferenceSet: '{op}：参照 = {reference}',
        stagePairBase: '対 基準',
        stageVsBase: '基準 {file} と比べた値',
        stageBaseLane: '基準（比べる相手）：{file}',
        entryBatchNoBase: '各ファイルを基準の録音と比べる手順があるため、多数のファイル向けには書き出せません。先に ⚙ で参照を「この録音のチャンネル」にしてください',
        stageNeedBaseFile: 'この手順は各録音を基準の録音と比べます。基準に録音を 1 本選んでください（群は基準にできません）',
        stepPairSelf: '別々のチャンネルを選んでください（同じチャンネル同士は常に同じ値）',
        stepNeedChannel: 'チャンネルは 1〜{n}',
        stepPair: 'ch{output} / ch{input}',
        stepPairOutput: 'チャンネル',
        stepPairInput: '参照チャンネル',
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
        dsListSeparator: '、',
        dsMoreCandidates: 'ほか{n}件',
        csvColumnsMismatch: 'データ行 {row}（ファイル{lines}行目）の列数がヘッダーと一致しません。ヘッダー（{header}行目）は{expected}列、実際は{actual}列です。',
        csvColumnsHintExtra: '行末の余分な区切りや、引用符で囲まれていないセル内の{delimiter}がないか確認してください。',
        csvColumnsHintMissing: '値が空でも区切りを省略せず、ヘッダーと同じ列位置を保っているか確認してください。',
        csvDelimiterComma: 'カンマ（,）',
        csvDelimiterTab: 'タブ',
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
        dsRowExcludeShort: '集計から外す',
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
        dsFilterRangeSeparator: '〜',
        dsFilterMoreValues: '{first} ほか {count}',
        dsFilterMore: 'ほか {n} 件。検索で絞ってください',
        dsFilterNone: '当たる値がありません',
        dsFilterRange: '範囲',
        dsFilterLow: '下限',
        dsFilterHigh: '上限',
        dsFilterAdd: '＋ 絞り込み',
        dsTrackMark: 'トラックに表示中（クリックで表示・解除）',
        dsTracksOnly: 'トラックのみ {n}',
        hintTracksOnly: 'トラックに出ているファイルの行だけを表示',
        dsTracksAll: '表の {n} ファイルをすべてトラックに出す',
        dsTracksNone: '表の {n} ファイルをすべてトラックから消す',
        dsTracksRest: '表の残り {n} ファイルもトラックに出す',
        dsTracksConfirm: '{n} 本をトラックに出して解析します。',
        dsTracksConfirmGo: '出す',
        dsFilterColumn: '列',
        dsFilterPickOne: '値を 1 つ以上選んでください',
        dsFilterApplied: '{n} 行に絞りました',
        dsFilterRemoved: '{col} の絞り込みを外しました',
        dsFilterHead: 'この列で並べ替え・絞り込み',
        dsFilterOn: '絞り込み中。押すと直せます',
        dsChipRemove: 'この絞り込みを外す',
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
        dsExportTable: '表を CSV に書き出す',
        toolbarMore: 'ほかのズーム：矩形ズーム、選択範囲にズーム、追従',
        hintEntryExport: '表の書き出し：レシピのまとめ、表とメモの CSV',
        dsBatch: 'レシピをまとめて書き出す',
        stageBaseScan: '基準群 {n} 本も同じ手順で解析・約 {time}',
        stageBaseTableNote: '（表の値・全区間）',
        stageBaseTableHint: '表が各ファイルの全区間で計算した値（{n} 本中 {m} 本）から描いています。基準群を解析すると線が変わることがあります',
        stageBaseNoLine: '（未解析・線なし）',
        stepRegionImported: 'トラックの選択を区間にしました（× か ↶ で外す）',
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
        dsBaseAuto: '比較 1 と同じ群の中央値',
        dsBaseGroupMedian: '{group} の中央値',
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
        axisLag: 'ラグ [s]',
        axisCorrelation: '相関係数',
        stageNoDelta: '— 差は同じ種類・同じ軸の結果どうしでだけ出せます',
        stageMaxDelta: '最大 Δ {at} {delta}',
        compareLevelsAt: '{at} 基準 {base} / 比較 {compare}',
        compareHintPlot: 'ドラッグ: 囲んだ範囲にズーム / Ctrl+ホイール: ズーム / Shift+ホイール・横スワイプ: 横にスクロール / + −: ズーム / ダブルクリック: ズームをリセット',
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
        screenHelpSymbols: '☐ / ☑（先頭の列）\t行のファイルがトラックにない / ある（T、またはそこで Enter / Space）。見出しの ⊟ は一部だけ\n● ■ ◆（手順の上）\t手順の出力の種類：時間波形 / 画像 / スペクトル\n分布\t選んだ値の群ごとの分布。棒、録音が少ない群は 1 本ずつの点、下に 1 本ずつの目盛\n分布のドラッグ\t値の範囲。表を絞るチップになる（× か Esc で外す）\n┃（色付き）\tスロットに入れた行。スロットの色\n┆（青の破線）\t基準。群の中央値\nスロット\t下の 0–3 の 4 つの枠。0 が基準、1–3 が比べるファイル\n└ Δ\tD で固定した差。固定した行の下に出る\n塗りの帯 / 枠の帯\t見出しの帯域 / その隣の帯域フィルタへの漏れ\n俯瞰帯\t表の行の 1/3 oct（行＝録音、明るい＝大きい）\n青\t基準\n黄 / 紫 / 赤紫\tスロット 1 / 2 / 3（カード・番号・線）\n緑\tΔ（比較 − 基準）。良し悪しではない\n橙\t実行できない手順、読めなかった録音',
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
        helpRowStepKeys: '手順バー: 手順を押すとその結果、長押しでその手順あり／なし、＋ で wandas の操作を足す、手順で Delete で外す',
        helpRowStepBypass: '手順バー: 手順で M を押すとバイパス（残したまま飛ばす）、もう一度で戻す',
        helpRowStepUndo: '手順バー: 編集を元に戻す／やり直す（↶ ↷）',
        helpSectionGeneral: 'どこでも',
        helpSectionLanes: 'トラック',
        helpSectionEntry: 'ファイル一覧',
        helpSectionCompare: '比較解析',
        helpSectionSteps: '手順バー',
        helpSectionSymbols: '記号と色',
        helpRowResizeKeys: 'フォーカスした境界で: 動かす（Shift: 大きく、Home / End: 最小 / 最大）',
        helpRowStepMenuEnter: '＋ の絞り込みで: 先頭の操作を足す',
        helpEntryRows: '行を移動',
        helpEntrySlot: '行をスロットに入れる（長押しの間は Δ スペクトル）',
        helpEntryBase: '行を基準にする。基準の行でもう一度押すと群の中央値へ（長押しの間は Δ を表示）',
        helpEntryOpen: 'スロットの行を比較解析で開く',
        helpEntryPlay: '行の録音を再生',
        helpEntryTrack: '行のファイルをトラックに表示・解除（行の ☐ / ☑ と同じ）',
        helpEntryMemo: '行にメモを書く',
        helpEntryEsc: '設定 → 絞り込み → 行の選択の順に閉じる。最大化中は表を戻す',
        helpCompareSlot: '押して比較を切り替え、長押しの間だけ入れ替え',
        helpCompareBase: '基準をスロット 0 のファイル ⇄ 群の中央値で切り替え',
        helpCompareZoom: '横軸をズームイン / アウト / 全体に戻す',
        helpCompareFix: '比較を一覧の行として固定',
        helpComparePlay: '比べている録音を再生（凡例の ▶ でどれでも）',
        helpCompareEsc: '設定を閉じる → 比較解析を開いた画面（トラックか一覧）へ',
        helpCompareLayoutKey: '重ねる / トラックごとに並べる',
        helpCompareLayout: 'トラックを手順の段で描く。1 枚に重ねるか、トラックのレーンに並べる',
        helpCompareDiff: '重ね描きの下に差（比較 − 基準）を出す',
        ariaWaveformCanvas: '{file} · {channel} · 波形',
        ariaSpectrogramCanvas: '{file} · {channel} · スペクトログラム',
        ariaStageOverlayCanvas: '比較解析: 表示中の手順でのトラック',
        ariaStageDiffCanvas: '比較解析: 差（比較 − 基準）',
        ariaStageLaneCanvas: '比較解析: {file}',
        ariaResizeTrackHeight: 'トラックの高さ',
        ariaResizeSpectrumHeight: 'スペクトル欄の高さ',
        ariaResizeSidebar: 'ファイル一覧の幅',
        ariaEntryOverview: '表の行の 1/3 オクターブレベル',
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
        btnLinkScales: 'スケール連動',
        hintLinkScales: '全トラックで振幅・カラー (dB)・周波数のスケールを揃える（単位ごと）',
        specSettingsAuto: '既定の解析設定を使う',
        specSettingsStftLegend: '解析',
        specSettingsNFft: 'FFT サイズ',
        specSettingsOverlap: '重なり率',
        specSettingsWindow: '窓関数',
        specSettingsDisplayLegend: '表示',
        specSettingsDbMin: 'カラー範囲の下限 (dB)',
        specSettingsDbMax: 'カラー範囲の上限 (dB)',
        specSettingsMaxFreqHz: '最大周波数 (Hz)',
        specSettingsPlaceholderAuto: '自動',
        specSettingsPlaceholderNyquist: 'ナイキスト',
        specSettingsColorRange: 'カラー範囲 (dB)',
        specSettingsWindowBoxcar: '矩形',
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
        fileNotInSession: 'このパネルの一覧にないファイルです: {path}',
        directoryListingProgress: '{path} の音声ファイルを一覧にしています',
        directoryListingTruncated: '{path} は最初の {count} 項目だけを一覧にしました。残りはサブフォルダを開いてください。',
        openTargetFailed: '{path} を開けませんでした: {reason}',
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
        exportPngBusy: 'PNG を書き出し中…',
        exportPngDone: 'PNG を書き出しました: {name}',
        exportCsvBusy: 'CSV を書き出し中…',
        exportCsvDone: 'CSV を書き出しました: {name}',
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
        hintContentWaveform: 'トラックごとに波形とその下のスペクトログラムを表示（⚙ で STFT 設定）。比較解析からは Esc でも戻る',
        hintTrackSplit: 'ドラッグで波形とスペクトログラムの高さの配分を変更（全トラック共通）',
        trackSplitLabel: '波形とスペクトログラムの境目',
        hintZoomOut: '時間方向にズームアウト（キー: −）',
        hintZoomIn: '時間方向にズームイン（キー: +）',
        hintZoomReset: '全体を表示（キー: 0、または波形をダブルクリック）',
        hintRectZoom: '矩形ズームモード: 波形上をドラッグした範囲にズーム',
        hintMenuExport: '書き出しはすべてここ：トラック（PNG・CSV・WAV・レポート）、比較フォルダ、レシピのまとめ、表とメモ',
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
        hintWheelGestures: 'ホイール: トラックをスクロール / Ctrl+ホイール: ズーム / Shift+ホイール・横スワイプ: 時間方向にスクロール',
        hintDoubleClickResetZoom: 'ダブルクリック: ズームをリセット',
        hintRectZoomDrag: 'ドラッグ: 囲んだ範囲にズーム',
        hintSpectrumPlot: 'ドラッグ: 囲んだ範囲にズーム / ダブルクリック: ズームをリセット / ← →: 周波数ビンを移動',
        hintSpectrumDbAxis: 'ダブルクリック: dB 範囲を設定',
        hintSpectrumFreqAxis: 'ダブルクリック: 周波数範囲を設定',
        hintWaveformAmplitudeAxis: 'ダブルクリック: 振幅範囲を設定',
        hintSpectrogramFrequencyAxis: 'ダブルクリック: 周波数範囲を設定',
        hintSpectrogramColorbar: 'ダブルクリック: カラースケール (dB) を設定',
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
        pairReferenceHint: '伝達関数の参照',
        pairReferenceClearHint: '参照を解除',
        pairReferenceBadge: '参照',
        pairAverages: '{n}平均',
        pairFewAveragesHint: '平均回数が少なく γ² が高めに出ます。範囲を広げるかオーバーラップを上げてください',
        pairResampledHint: '参照のサンプルレートにリサンプル済み',
        pairNoOverlapHint: '範囲内に参照との重なりがありません',
        pairTooShortHint: '重なりが FFT 1 フレームより短い',
        pairOtherUnitHint: '校正の単位が異なるため、このゲイン軸には描画しません',
        pairPhaseLabel: '位相 [°]',
        pairCoherenceLabel: 'γ²',
        pairSectionTitle: '参照に対する伝達関数とコヒーレンス',
        pairWaiting: '計算中…',
        pairNoResponses: '参照と比べる別のチャンネルを表示してください',
        pairFailed: 'ペアスペクトルの計算に失敗しました: {error}',
        hintPairDivider: 'ドラッグで分割位置を変更',
        hintOctaveDisabledByPair: '参照の設定中はオクターブバンドを使えません',
        hintPairPlot: 'ループ範囲で平均。ループがなければ重なり全体で平均',
        pyTooltipSelect: 'クリックして Python 環境を選択',
        pyTooltipMissingDeps: 'Python パッケージが不足しているか互換性がありません。クリックして環境を選択するかインストールします。',
        pyTooltipMissingInterpreter: 'Python インタープリターが見つかりません。クリックして別の環境を選択します。',
        pyTooltipPipUnavailable: 'この環境では pip を使えません。クリックして別の環境を選択します。',
        pyTooltipCheckFailed: 'Python 環境の確認に失敗しました。クリックして別の環境を選択します。',
        pyTooltipImporting: 'Python の解析モジュールをバックグラウンドで読み込んでいます。',
        pyTooltipBackendFailed: 'Python バックエンドを起動できませんでした: {message}',
        analysisPythonNotReady: 'Python 環境の準備ができていないため解析できません。ステータスバーの Python からパッケージをインストールするか、別の環境を選択してください。',
        pyTooltipBackendStopped: 'Python バックエンドが停止しました: {message}。次の要求で再起動します。',
        pyStatusImporting: 'Python: モジュール読み込み中',
        pyPickPlaceholder: 'Audio Wandas Analyzer で使う Python 環境を選択',
        pyPickFromPythonExtension: 'Python 拡張機能で選択中',
        pyPickFromVirtualEnv: '有効な仮想環境 (VIRTUAL_ENV)',
        pyPickWorkspaceVenv: 'このワークスペースの仮想環境',
        pyPickCurrent: '現在の設定',
        pyPickOther: 'その他',
        pyPickCreateVenv: '$(add) .venv を作成してパッケージをインストール',
        pyPickCreateVenvDetail: 'ワークスペースで python -m venv .venv を実行し、必要なパッケージをインストールします',
        pyPickBrowse: '$(folder) 参照...',
        pyPickBrowseOpenLabel: 'Python 環境を選択',
        pyInterpreterNotFound: 'Python インタープリターが見つかりません: {command}',
        pyPipUnavailable: '{command} では pip を使えません。別の環境を選択するか .venv を作成してください。',
        pyCheckFailed: '{command} の Python パッケージを確認できませんでした。詳細はログを参照してください。',
        pyMissingPackages: 'Audio Wandas Analyzer には {command} に互換性のある Python パッケージが必要です: {packages}',
        pyExternallyManaged: '{command} は OS が管理している環境 (PEP 668) のため、パッケージをインストールできません。.venv を作成するか別の環境を選択してください。',
        pyBtnInstall: 'インストール',
        pyBtnCreateVenv: '.venv を作成してインストール',
        pyBtnSelect: '環境を選択',
        pyBtnShowLog: 'ログを表示',
        pyInstallProgress: '{command} に Python パッケージをインストールしています',
        pyCreateVenvProgress: '{path} を作成しています',
        pyInstallSucceeded: 'Python パッケージをインストールしました。',
        pyInstallFailed: 'Python パッケージのインストールに失敗しました。詳細はログを参照してください。',
        pyInstallTimedOut: 'Python パッケージのインストールが {minutes} 分を超えたため中止しました。',
        pyInstallCancelled: 'Python パッケージのインストールを取り消しました。',
        pyVenvFailed: '{path} を作成できませんでした。詳細はログを参照してください。',
        pyVenvNoEnsurepip: 'venv モジュールを使えないため {path} を作成できませんでした (Debian や Ubuntu では python3-venv をインストールしてください)。',
        pySavedToUserSettings: 'このワークスペースは制限モードのため、{command} をユーザー設定に保存しました。',
        pyUntrustedWorkspacePath: '{command} はこのワークスペース内のパスです。制限モードでは信頼されていないワークスペースのプログラムを起動しません。ワークスペースを信頼するか、インタープリターをフルパスで選択してください。',
        pyTooltipUntrustedWorkspacePath: '制限モード: インタープリターのパスがこのワークスペース内を指しています。クリックして別の環境を選択します。',
        welcomeDropLabel: 'ここに音声ファイルやフォルダをドロップ',
        welcomeDropDescription: 'クリックしてファイルまたはフォルダを選択',
        welcomeDropCommand: 'ファイルまたはフォルダを解析',
        debugPathNotConfigured: 'デバッグ用の音声パスが設定されていません。audioWandasAnalyzer.debugFilePath に音声ファイルかフォルダを指定してください。',
        debugPathNotFound: 'デバッグ用の音声パスが見つかりません: {path}。audioWandasAnalyzer.debugFilePath を直すか、ファイルまたはフォルダを追加してください。',
        analysisProgressTitle: 'wandas で {files} を解析しています',
        recipePickPlaceholder: 'wandas レシピを選択',
        recipeBrowseLabel: '$(folder-opened) 参照...',
        recipeBrowseDescription: 'ディスクからレシピ JSON を選択',
        recipeFileFilter: 'レシピ JSON',
        recipeOpenLabel: 'このレシピを使う',
        recipeInputsOpenLabel: 'レシピの入力にする',
        recipeInputPlaceholder: 'レシピの入力「{name}」({index}/{total})',
        recipeNotDocument: '{path} はレシピではありません',
        recipeReadFailed: 'レシピを読み込めませんでした: {message}',
        recipeRunFailed: 'レシピを実行できませんでした: {message}',
        recipeRunning: 'レシピ {title} を実行しています…',
        calibrationNoPanel: '校正を設定する前に音声解析パネルを開いてください。',
        calibrationNoChannels: 'アクティブな解析パネルに校正できる音声チャンネルがありません。',
        calibrationPickTrack: '校正するトラックを選択',
        calibrationChannelFallback: 'チャンネル {n}',
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
