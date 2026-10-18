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
    browserRecipeNoSources: string;
    browserRecipeDone: string;
    btnCloseRecipeResult: string;

    panelTitle: string;
    panelTitlePrefix: string;
    panelComparePrefix: string;
    emptyAllExcluded: string;
    emptyNoTracks: string;
    selectionHeader: string;
    btnOpenFile: string;
    btnOpenAnotherFolder: string;
    btnOpenFolder: string;
    btnSelectAll: string;
    btnClear: string;
    selectionCountLabel: string;
    selectionNoSupported: string;
    treeFilterPlaceholder: string;
    spectrumSectionTitle: string;
    toolbarMain: string;
    toolbarTrackLabel: string;
    btnWaveform: string;
    btnSpectrogram: string;
    btnSpectrogramSettingsTitle: string;
    toolbarZoomLabel: string;
    btnZoomReset: string;
    toolbarAdjustLabel: string;
    toolbarWorkflowLabel: string;
    toolbarExportLabel: string;
    toolbarHeightLabel: string;
    heightTrackLabel: string;
    heightSpectrumLabel: string;
    btnHeightReset: string;
    ariaTrackHeightUp: string;
    ariaTrackHeightDown: string;
    ariaTrackHeightReset: string;
    ariaSpectrumHeightUp: string;
    ariaSpectrumHeightDown: string;
    ariaSpectrumHeightReset: string;
    btnRunRecipe: string;
    chartSpecNoResults: string;
    chartSpecScalarLabelHeader: string;
    chartSpecScalarValueHeader: string;
    chartSpecScalarUnitHeader: string;
    cursorDisplayHint: string;
    loopBadge: string;
    trackPlayTitle: string;
    trackStopTitle: string;
    trackOffsetResetHint: string;
    offsetEditPlaceholder: string;
    offsetEditAriaLabel: string;
    trackSpectrumTitle: string;
    trackChannelSelectLabel: string;
    ariaTrackChannelSelect: string;
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
    helpRowQuestion: string;
    helpRowEsc: string;
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
    btnCopySpec: string;
    specSettingsAuto: string;
    specSettingsStftLegend: string;
    specSettingsNFft: string;
    specSettingsHopSize: string;
    specSettingsWindow: string;
    specSettingsDisplayLegend: string;
    specSettingsDbMin: string;
    specSettingsDbMax: string;
    specSettingsMaxFreqHz: string;
    specSettingsReset: string;
    specSettingsApply: string;
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
    ariaSelectionTree: string;
    ariaSelectionTreeDir: string;
    btnExportReport: string;
    btnExportReportTitle: string;
    exportReportNoData: string;
    reportFormatMarkdown: string;
    reportFormatNotebook: string;
    reportFormatPlaceholder: string;
    reportSaveLabel: string;
    reportExportedPrefix: string;
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
    trackPickColor: string;
    trackColorReset: string;
    ariaDragHandle: string;
    ariaPickColor: string;
    announceAnalyzing: string;
    announceAnalysisDone: string;
    announceTrackRemoved: string;
    announceSpecCopied: string;
    announceSpecCopyFailed: string;
    announceExportPngStarted: string;
    announceExportPngFailed: string;
    announceExportCsvStarted: string;
    announceExportCsvFailed: string;
    spectrumZoomLabel: string;
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
    specRangeApply: string;
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
    hintMenuAdjust: string;
    hintMenuWorkflow: string;
    hintMenuExport: string;
    hintTrackHeightInput: string;
    hintSpectrumHeightInput: string;
    hintRunRecipe: string;
    hintCopySpec: string;
    hintSpecZoomOut: string;
    hintSpecZoomIn: string;
    hintSpecZoomReset: string;
    hintRemoveTrack: string;
    hintOffsetUp: string;
    hintOffsetDown: string;
    hintTrackHeightResizer: string;
    hintSpectrumHeightResizer: string;
    hintTreeResizer: string;
    hintOpenFile: string;
    hintOpenFolder: string;
    hintSelectAll: string;
    hintClearAll: string;
    hintTreeFilter: string;
    hintTreeDirectory: string;
    hintTreeFile: string;
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
    hintSpecHopSize: string;
    hintSpecWindow: string;
    hintSpecDisplay: string;
    hintSpecReset: string;
    hintSpecApply: string;
    hintBrowserOpenFolder: string;
    hintBrowserAbout: string;
}

const STRINGS: Record<SupportedLocale, UiStrings> = {
    en: {
        panelTitle: 'Audio Wandas Analyzer',
        panelTitlePrefix: 'Audio Analyzer: ',
        panelComparePrefix: 'Audio Compare: ',
        emptyAllExcluded: 'All tracks are excluded',
        emptyNoTracks: 'Files checked in the left tree appear here as tracks',
        selectionHeader: 'Select files to analyze',
        btnOpenFile: 'Open File',
        browserEmptyPrompt: 'Drop WAV files here, or open files or a folder, to start comparing',
        browserAbout: 'ⓘ About the browser version',
        browserAboutPrivacy: 'Audio is processed in this browser and never uploaded.',
        browserAboutFileLimits: 'Each file: up to 16 MiB, 30 s and 2 ch.',
        browserAboutSessionLimits: 'Comparison: up to 8 tracks and 64 MiB of input in total.',
        browserAboutRecipes: 'Bundled recipes run on the loaded tracks.',
        browserAboutUnsupported: 'Not available here: WDF, psychoacoustics, calibration configuration, vscode.dev.',
        browserInputTooLarge: 'WAV must be {mib} MiB or smaller.',
        browserAggregateLimit: 'Browser session limit: up to {count} WAV files / {mib} MiB total input. Remove a track first.',
        browserPreparing: 'Preparing local Python Worker / adding WAV files…',
        browserReady: 'waveform ready. {count} tracks; add more WAV files to compare. No automatic playback.',
        browserWorkerFailed: 'Audio Worker failed; select the WAV files again.',
        browserPythonStarting: 'Python: starting…',
        browserPythonReady: 'Python: ready',
        browserPythonFailed: 'Python: failed to start',
        browserPythonStopped: 'Python: stopped (restarts when needed)',
        browserCleared: 'Worker cleared; audio memory released. Add short WAV files.',
        browserRemoved: 'All tracks removed; audio memory released. Add short WAV files.',
        browserExported: 'Selected regions exported as PCM16 WAV.',
        browserFolderOpened: 'Opened a folder with {count} WAV files. Check files in the tree to add them as tracks.',
        browserDropNoWav: 'Drop .wav files to add them as tracks; use Open Folder for folders.',
        browserUnavailable: 'Not available in the browser version.',
        browserRecipePick: 'Select a recipe (enter its number):',
        browserRecipeNoSources: 'Add WAV files first; recipes run on the loaded tracks.',
        browserRecipeDone: 'Recipe finished: ',
        btnCloseRecipeResult: 'Close recipe result',

        btnOpenAnotherFolder: 'Open another folder',
        btnOpenFolder: 'Open Folder',
        btnSelectAll: 'Select all',
        btnClear: 'Clear',
        selectionCountLabel: 'selected',
        selectionNoSupported: 'No supported audio files found.',
        treeFilterPlaceholder: 'Filter files...',
        spectrumSectionTitle: 'Power spectrum at cursor (all tracks overlaid)',
        toolbarMain: 'Files',
        toolbarTrackLabel: 'Track:',
        btnWaveform: 'Waveform',
        btnSpectrogram: 'Spectrogram',
        btnSpectrogramSettingsTitle: 'Spectrogram settings',
        toolbarZoomLabel: 'Zoom:',
        btnZoomReset: 'Reset',
        toolbarAdjustLabel: 'Adjust',
        toolbarWorkflowLabel: 'Workflow',
        toolbarExportLabel: 'Export',
        toolbarHeightLabel: 'Height:',
        heightTrackLabel: 'Track',
        heightSpectrumLabel: 'Spectrum',
        btnHeightReset: 'Reset',
        ariaTrackHeightUp: 'Increase track height',
        ariaTrackHeightDown: 'Decrease track height',
        ariaTrackHeightReset: 'Reset track height',
        ariaSpectrumHeightUp: 'Increase power spectrum height',
        ariaSpectrumHeightDown: 'Decrease power spectrum height',
        ariaSpectrumHeightReset: 'Reset power spectrum height',
        btnRunRecipe: 'Run recipe',
        chartSpecNoResults: 'Recipe returned no charts.',
        chartSpecScalarLabelHeader: 'Label',
        chartSpecScalarValueHeader: 'Value',
        chartSpecScalarUnitHeader: 'Unit',
        cursorDisplayHint: 'Cursor time: click a waveform, then fine-tune with ← → (Shift: 100 ms)',
        loopBadge: '🔁 Looping',
        trackPlayTitle: 'Play / pause',
        trackStopTitle: 'Stop',
        trackOffsetResetHint: 'Click: type an offset in ms / Double-click: reset to 0',
        offsetEditPlaceholder: 'ms',
        offsetEditAriaLabel: 'Track offset in milliseconds',
        trackSpectrumTitle: 'Power spectrum at main cursor',
        trackChannelSelectLabel: 'Channel',
        ariaTrackChannelSelect: 'Displayed channel',
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
        helpRowQuestion: 'toggle this help',
        helpRowEsc: 'close popover / help',
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
        btnCopySpec: 'Copy spec',
        specSettingsAuto: 'Auto (defaults)',
        specSettingsStftLegend: 'STFT',
        specSettingsNFft: 'n_fft',
        specSettingsHopSize: 'hop_size',
        specSettingsWindow: 'window',
        specSettingsDisplayLegend: 'Display',
        specSettingsDbMin: 'dB min',
        specSettingsDbMax: 'dB max',
        specSettingsMaxFreqHz: 'max freq Hz',
        specSettingsReset: 'Reset',
        specSettingsApply: 'Apply',
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
        ariaSelectionTree: 'File selection tree',
        ariaSelectionTreeDir: 'Directory',
        btnExportReport: 'Report',
        btnExportReportTitle: 'Export analysis report as Markdown or Jupyter Notebook',
        exportReportNoData: 'No analysis data to export.',
        reportFormatMarkdown: 'Markdown (.md)',
        reportFormatNotebook: 'Jupyter Notebook (.ipynb)',
        reportFormatPlaceholder: 'Select report format',
        reportSaveLabel: 'Export Report',
        reportExportedPrefix: 'Report exported → ',
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
        trackPickColor: 'Change color',
        trackColorReset: 'Reset to default',
        ariaDragHandle: 'Drag to reorder track',
        ariaPickColor: 'Change track color',
        announceAnalyzing: 'Analyzing: {msg}',
        announceAnalysisDone: 'Analysis complete: {count} tracks',
        announceTrackRemoved: 'Track {n} removed',
        announceSpecCopied: 'Spec copied to clipboard',
        announceSpecCopyFailed: 'Copy failed: clipboard not available',
        announceExportPngStarted: 'PNG export started',
        announceExportPngFailed: 'PNG export failed: no visible canvases',
        announceExportCsvStarted: 'CSV export started',
        announceExportCsvFailed: 'CSV export failed: no spectrum data at cursor',
        spectrumZoomLabel: 'Spectrum',
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
        specRangeApply: 'Apply',
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
        hintMenuAdjust: 'Change the track and spectrum heights',
        hintMenuWorkflow: 'Run a recipe or copy the analysis spec',
        hintMenuExport: 'Export PNG, CSV, WAV or a report',
        hintTrackHeightInput: 'Track height in px (you can also drag the bottom edge of a track)',
        hintSpectrumHeightInput: 'Spectrum height in px (you can also drag the edge of the spectrum)',
        hintRunRecipe: 'Run an analysis recipe on the loaded tracks',
        hintCopySpec: 'Copy the current analysis spec to the clipboard',
        hintSpecZoomOut: 'Zoom the spectrum out',
        hintSpecZoomIn: 'Zoom the spectrum in (or drag a box on the spectrum)',
        hintSpecZoomReset: 'Show the whole spectrum (or double-click the plot)',
        hintRemoveTrack: 'Remove this track from the comparison',
        hintOffsetUp: 'Offset +10 ms',
        hintOffsetDown: 'Offset −10 ms',
        hintTrackHeightResizer: 'Drag to change the track height',
        hintSpectrumHeightResizer: 'Drag to change the spectrum height',
        hintTreeResizer: 'Drag to change the sidebar width',
        hintOpenFile: 'Open an audio file',
        hintOpenFolder: 'Open another folder of audio files',
        hintSelectAll: 'Check all visible files in the tree',
        hintClearAll: 'Uncheck all files',
        hintTreeFilter: 'Type to filter the files by name',
        hintTreeDirectory: 'Click or Enter / Space: expand or collapse',
        hintTreeFile: 'Check to show this file as a track',
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
        hintSpecHopSize: 'Samples between frames: smaller gives finer time resolution',
        hintSpecWindow: 'Window function applied to each frame',
        hintSpecDisplay: 'Display range, applied immediately (empty = auto)',
        hintSpecReset: 'Restore the default settings',
        hintSpecApply: 'Recompute the spectrogram with these STFT settings',
        hintBrowserOpenFolder: 'Open a folder and pick WAV files from the tree',
        hintBrowserAbout: 'Show limits, unavailable features and how audio is handled',
    },
    ja: {
        panelTitle: 'Audio Wandas Analyzer',
        panelTitlePrefix: 'Audio Analyzer: ',
        panelComparePrefix: 'Audio Compare: ',
        emptyAllExcluded: 'すべてのトラックが除外されています',
        emptyNoTracks: '左のツリーでチェックしたファイルがここにトラックとして表示されます',
        selectionHeader: '選択して解析',
        btnOpenFile: 'ファイルを開く',
        browserEmptyPrompt: 'WAVをここにドロップするか、ファイルまたはフォルダを開いて比較を始めます',
        browserAbout: 'ⓘ ブラウザ版について',
        browserAboutPrivacy: '音声はこのブラウザ内で処理され、外部には送信されません。',
        browserAboutFileLimits: '1ファイル: 16 MiB・30秒・2chまで',
        browserAboutSessionLimits: '比較: 最大8トラック・入力合計64 MiBまで',
        browserAboutRecipes: '同梱レシピは読み込んだトラックに対して実行できます。',
        browserAboutUnsupported: '未対応: WDF・心理音響・校正設定・vscode.dev',
        browserInputTooLarge: 'WAVは{mib} MiB以下を選択してください。',
        browserAggregateLimit: 'ブラウザ上限はWAV {count}件・入力合計{mib} MiBです。先にトラックを削除してください。',
        browserPreparing: 'ローカルPython Workerを準備・WAVを追加しています…',
        browserReady: '波形の準備完了。{count}トラック。WAVを追加して比較できます。自動再生は行いません。',
        browserWorkerFailed: '音声Workerで障害が発生しました。WAVを選択し直してください。',
        browserPythonStarting: 'Python: 起動中…',
        browserPythonReady: 'Python: 準備完了',
        browserPythonFailed: 'Python: 起動に失敗',
        browserPythonStopped: 'Python: 停止中（必要になると再起動）',
        browserCleared: 'Workerを終了し、音声メモリを解放しました。短いWAVを追加できます。',
        browserRemoved: '全トラックを削除し、音声メモリを解放しました。',
        browserExported: '選択区間をPCM16 WAVで書き出しました。',
        browserFolderOpened: 'WAVを{count}件含むフォルダを開きました。ツリーでチェックしたファイルがトラックになります。',
        browserDropNoWav: 'ドロップできるのは .wav ファイルです。フォルダは「フォルダを開く」から開いてください。',
        browserUnavailable: 'Web版では未対応です。',
        browserRecipePick: 'レシピを番号で選択してください:',
        browserRecipeNoSources: '先にWAVを追加してください。レシピは読み込んだトラックに対して実行します。',
        browserRecipeDone: 'レシピ実行完了: ',
        btnCloseRecipeResult: 'レシピ結果を閉じる',

        btnOpenAnotherFolder: '別のフォルダを開く',
        btnOpenFolder: 'フォルダを開く',
        btnSelectAll: 'すべて選択',
        btnClear: 'クリア',
        selectionCountLabel: '件を選択中',
        selectionNoSupported: '対応する音声ファイルは見つかりませんでした。',
        treeFilterPlaceholder: 'ファイルを絞り込む...',
        spectrumSectionTitle: 'カーソル時刻のパワースペクトル（全トラック重ね合わせ）',
        toolbarMain: 'ファイル',
        toolbarTrackLabel: 'トラック:',
        btnWaveform: '波形',
        btnSpectrogram: 'スペクトログラム',
        btnSpectrogramSettingsTitle: 'スペクトログラム設定',
        toolbarZoomLabel: 'ズーム:',
        btnZoomReset: 'リセット',
        toolbarAdjustLabel: '調整',
        toolbarWorkflowLabel: 'ワークフロー',
        toolbarExportLabel: '書き出し',
        toolbarHeightLabel: '高さ:',
        heightTrackLabel: 'トラック',
        heightSpectrumLabel: 'スペクトル',
        btnHeightReset: '戻す',
        ariaTrackHeightUp: 'トラックを高くする',
        ariaTrackHeightDown: 'トラックを低くする',
        ariaTrackHeightReset: 'トラックの高さをリセット',
        ariaSpectrumHeightUp: 'パワースペクトルを高くする',
        ariaSpectrumHeightDown: 'パワースペクトルを低くする',
        ariaSpectrumHeightReset: 'パワースペクトルの高さをリセット',
        btnRunRecipe: 'レシピ実行',
        chartSpecNoResults: 'レシピは何もチャートを返しませんでした。',
        chartSpecScalarLabelHeader: '項目',
        chartSpecScalarValueHeader: '値',
        chartSpecScalarUnitHeader: '単位',
        cursorDisplayHint: 'カーソル時刻: 波形をクリックし、← → で微調整（Shift: 100 ms）',
        loopBadge: '🔁 ループ再生中',
        trackPlayTitle: '再生 / 一時停止',
        trackStopTitle: '停止',
        trackOffsetResetHint: 'クリック: オフセットを ms で入力 / ダブルクリック: 0 に戻す',
        offsetEditPlaceholder: 'ms',
        offsetEditAriaLabel: 'トラックオフセット（ミリ秒）',
        trackSpectrumTitle: 'メインカーソル時刻のパワースペクトル',
        trackChannelSelectLabel: 'チャンネル',
        ariaTrackChannelSelect: '表示チャンネル',
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
        helpRowQuestion: 'このヘルプを開閉',
        helpRowEsc: 'ポップオーバー / ヘルプを閉じる',
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
        btnCopySpec: 'スペックをコピー',
        specSettingsAuto: '自動 (デフォルト)',
        specSettingsStftLegend: 'STFT',
        specSettingsNFft: 'n_fft',
        specSettingsHopSize: 'hop_size',
        specSettingsWindow: 'ウィンドウ',
        specSettingsDisplayLegend: '表示設定',
        specSettingsDbMin: 'dB 最小',
        specSettingsDbMax: 'dB 最大',
        specSettingsMaxFreqHz: '最大周波数 Hz',
        specSettingsReset: 'リセット',
        specSettingsApply: '適用',
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
        ariaSelectionTree: 'ファイル選択ツリー',
        ariaSelectionTreeDir: 'ディレクトリ',
        btnExportReport: 'レポート',
        btnExportReportTitle: '解析結果を Markdown または Jupyter Notebook として書き出す',
        exportReportNoData: 'エクスポートする解析データがありません。',
        reportFormatMarkdown: 'Markdown (.md)',
        reportFormatNotebook: 'Jupyter Notebook (.ipynb)',
        reportFormatPlaceholder: 'レポート形式を選択',
        reportSaveLabel: 'レポートを書き出す',
        reportExportedPrefix: 'レポートを書き出しました → ',
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
        trackPickColor: '色を変更',
        trackColorReset: 'デフォルトに戻す',
        ariaDragHandle: 'ドラッグしてトラックを並び替え',
        ariaPickColor: 'トラック色を変更',
        announceAnalyzing: '解析中: {msg}',
        announceAnalysisDone: '解析完了: {count}件',
        announceTrackRemoved: 'トラック{n}を削除',
        announceSpecCopied: 'スペックをクリップボードにコピーしました',
        announceSpecCopyFailed: 'コピー失敗：クリップボードが利用できません',
        announceExportPngStarted: 'PNG 出力を開始しました',
        announceExportPngFailed: 'PNG 出力失敗：表示中のキャンバスがありません',
        announceExportCsvStarted: 'CSV 出力を開始しました',
        announceExportCsvFailed: 'CSV 出力失敗：カーソル位置にスペクトルデータがありません',
        spectrumZoomLabel: 'スペクトル',
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
        specRangeApply: '適用',
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
        hintMenuAdjust: 'トラックとスペクトルの高さを変更',
        hintMenuWorkflow: 'レシピの実行、解析スペックのコピー',
        hintMenuExport: 'PNG・CSV・WAV・レポートを書き出す',
        hintTrackHeightInput: 'トラックの高さ (px)。トラック下端のドラッグでも変更できます',
        hintSpectrumHeightInput: 'スペクトルの高さ (px)。スペクトルの境界のドラッグでも変更できます',
        hintRunRecipe: '読み込んだトラックに解析レシピを実行',
        hintCopySpec: '現在の解析スペックをクリップボードにコピー',
        hintSpecZoomOut: 'スペクトルをズームアウト',
        hintSpecZoomIn: 'スペクトルをズームイン（スペクトル上のドラッグでも可）',
        hintSpecZoomReset: 'スペクトル全体を表示（グラフのダブルクリックでも可）',
        hintRemoveTrack: 'このトラックを比較から外す',
        hintOffsetUp: 'オフセット +10 ms',
        hintOffsetDown: 'オフセット −10 ms',
        hintTrackHeightResizer: 'ドラッグでトラックの高さを変更',
        hintSpectrumHeightResizer: 'ドラッグでスペクトルの高さを変更',
        hintTreeResizer: 'ドラッグでサイドバーの幅を変更',
        hintOpenFile: '音声ファイルを開く',
        hintOpenFolder: '別の音声フォルダを開く',
        hintSelectAll: 'ツリーに表示中のファイルをすべてチェック',
        hintClearAll: 'すべてのチェックを外す',
        hintTreeFilter: '入力した文字でファイルを絞り込む',
        hintTreeDirectory: 'クリックまたは Enter / Space: 開く / 閉じる',
        hintTreeFile: 'チェックするとトラックとして表示',
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
        hintSpecHopSize: 'フレーム間隔（サンプル）: 小さいほど時間分解能が細かくなります',
        hintSpecWindow: '各フレームにかける窓関数',
        hintSpecDisplay: '表示範囲。すぐに反映されます（空欄は自動）',
        hintSpecReset: '既定の設定に戻す',
        hintSpecApply: 'この STFT 設定でスペクトログラムを再計算',
        hintBrowserOpenFolder: 'フォルダを開き、ツリーから WAV を選ぶ',
        hintBrowserAbout: '制限・未対応機能・音声の扱いを表示',
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
        apply: strings.specRangeApply,
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
