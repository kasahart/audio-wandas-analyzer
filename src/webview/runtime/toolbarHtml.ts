import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';

export interface ToolbarSpec {
    contentType: 'waveform' | 'spectrogram' | 'stage';
    appVersion: string;
}

/** Controls marked tb-track-only act on the track lanes (time zoom, the lanes' exports) and hide in the steps view. */
export function toolbarHtml(spec: ToolbarSpec, strings: UiStrings): string {
    function toolbarMenu(label: string, hint: string, content: string, classes: string, id: string) {
        return '<details class="tb-menu' + classes + '" id="' + id + '"><summary class="tb-btn"' + hintAttr(hint) + ' aria-label="' + escapeHtml(hint) + '">' + escapeHtml(label) + '</summary><div class="tb-menu-popover">' + content + '</div></details>';
    }
    // Every export of the panel is here: the lanes', the comparison's (steps view), the Recipe's and the table's.
    const exportMenu = '<button class="tb-btn tb-track-only" data-action="export-png"' + hintAttr(strings.btnExportPngTitle) + '>' + escapeHtml(strings.btnExportPng) + '</button>'
        + '<button class="tb-btn tb-track-only" data-action="export-csv"' + hintAttr(strings.btnExportCsvTitle) + '>' + escapeHtml(strings.btnExportCsv) + '</button>'
        + '<button class="tb-btn tb-track-only" data-action="export-wav"' + hintAttr(strings.btnExportWavTitle) + '>' + escapeHtml(strings.btnExportWav) + '</button>'
        + '<button class="tb-btn tb-track-only" data-action="export-report"' + hintAttr(strings.btnExportReportTitle) + '>' + escapeHtml(strings.btnExportReport) + '</button>'
        + '<button class="tb-btn tb-stage-only" data-action="stage-report"' + hintAttr(strings.compareReport) + '>' + escapeHtml(strings.compareReport) + '</button>'
        // The Recipe is the step bar's chain: it is saved, or one read and run, or written for many files, from here.
        + '<div class="tb-menu-sep"></div>'
        + '<button class="tb-btn" data-action="save-recipe"' + hintAttr(strings.hintSaveRecipe) + '>' + escapeHtml(strings.btnSaveRecipe) + '</button>'
        + '<button class="tb-btn" data-action="run-recipe"' + hintAttr(strings.hintRunRecipe) + '>' + escapeHtml(strings.btnRunRecipe) + '</button>'
        + '<button class="tb-btn tb-entry-only" data-action="entry-batch"' + hintAttr(strings.hintBatch) + '>' + escapeHtml(strings.dsBatch) + '</button>'
        + '<div class="tb-menu-sep tb-entry-only"></div>'
        + '<button class="tb-btn tb-entry-only" data-action="entry-export-csv"' + hintAttr(strings.dsExportTable) + '>' + escapeHtml(strings.dsExportTable) + '</button>'
        + '<button class="tb-btn tb-entry-only" data-action="entry-export-notes"' + hintAttr(strings.hintExportNotes) + '>' + escapeHtml(strings.dsExportNotes) + '</button>';
    const moreMenu = '<button class="tb-btn" id="btn-wave-mode-rect-zoom" data-action="wave-mode-rect-zoom"' + hintAttr(strings.hintRectZoom) + ' aria-pressed="false">' + escapeHtml(strings.waveModeLabelRectZoom) + '</button>'
        + '<button class="tb-btn" id="btn-zoom-to-selection" data-action="zoom-to-selection"' + hintAttr(strings.btnZoomToSelectionTitle) + ' disabled>' + escapeHtml(strings.btnZoomToSelection) + '</button>'
        + '<button class="tb-btn" data-action="toggle-follow-cursor"' + hintAttr(strings.btnFollowCursorTitle) + '>' + escapeHtml(strings.btnFollowCursor) + '</button>';
    return '<span class="tb-label">' + escapeHtml(strings.toolbarTrackLabel) + '</span>'
        + '<button class="tb-btn' + (spec.contentType === 'waveform' ? ' is-active' : '') + '" data-action="content-waveform"' + hintAttr(strings.hintContentWaveform) + '>' + escapeHtml(strings.btnWaveform) + '</button>'
        + '<button class="tb-btn' + (spec.contentType === 'spectrogram' ? ' is-active' : '') + '" data-action="content-spectrogram"' + hintAttr(strings.hintContentSpectrogram) + '>' + escapeHtml(strings.btnSpectrogram) + '</button>'
        + '<button class="tb-btn' + (spec.contentType === 'stage' ? ' is-active' : '') + '" data-action="content-stage"' + hintAttr(strings.hintContentStage) + '>' + escapeHtml(strings.btnStage) + '</button>'
        + '<button class="tb-btn" data-action="spectrogram-settings" data-hint="' + escapeHtml(strings.btnSpectrogramSettingsTitle) + '" aria-label="' + escapeHtml(strings.btnSpectrogramSettingsTitle) + '" style="display:none">⚙</button>'
        + '<div class="tb-sep tb-track-only"></div>'
        + '<span class="tb-label tb-track-only">' + escapeHtml(strings.toolbarZoomLabel) + '</span>'
        + '<button class="tb-btn tb-track-only" data-action="zoom-out"' + hintAttr(strings.hintZoomOut) + ' aria-label="' + escapeHtml(strings.ariaZoomOut) + '">－</button>'
        + '<button class="tb-btn tb-track-only" data-action="zoom-in"' + hintAttr(strings.hintZoomIn) + ' aria-label="' + escapeHtml(strings.ariaZoomIn) + '">＋</button>'
        + '<button class="tb-btn tb-track-only" data-action="zoom-reset"' + hintAttr(strings.hintZoomReset) + ' aria-label="' + escapeHtml(strings.ariaZoomReset) + '">' + escapeHtml(strings.btnZoomReset) + '</button>'
        + toolbarMenu('⋯', strings.toolbarMore, moreMenu, ' tb-track-only', 'tb-more-menu')
        + '<div class="tb-sep"></div>'
        + toolbarMenu(strings.toolbarExportLabel, strings.hintMenuExport, exportMenu, '', 'tb-export-menu')
        + '<div class="tb-sep tb-track-only"></div>'
        + '<span id="cursor-display" class="tb-track-only"' + hintAttr(strings.cursorDisplayHint) + '>—</span>'
        + '<span id="playback-display"' + hintAttr(strings.playbackDisplayTitle) + '></span>'
        + '<span id="loop-badge" style="display:none; color:#64a0ff; font-size:0.85em; margin-left:8px;">' + escapeHtml(strings.loopBadge) + '</span>'
        + '<span id="loop-time-display"' + hintAttr(strings.loopTimeDisplayTitle) + ' style="display:none;"></span>'
        + '<span class="tb-label tb-version" id="app-version">v' + escapeHtml(spec.appVersion) + '</span>';
}
