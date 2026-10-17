import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';

interface HeightRange {
    min: number;
    max: number;
}

export interface ToolbarSpec {
    contentType: 'waveform' | 'spectrogram';
    trackHeight: number;
    trackHeightRange: HeightRange;
    spectrumHeight: number;
    spectrumHeightRange: HeightRange;
    appVersion: string;
}

export function toolbarHtml(spec: ToolbarSpec, strings: UiStrings): string {
    function toolbarMenu(label: string, hint: string, content: string) {
        return '<details class="tb-menu"><summary class="tb-btn"' + hintAttr(hint) + '>' + escapeHtml(label) + '</summary><div class="tb-menu-popover">' + content + '</div></details>';
    }
    const adjustMenu = '<div class="tb-menu-row"><span class="tb-label">' + escapeHtml(strings.toolbarHeightLabel) + '</span></div>'
        + '<div class="tb-menu-row"><span class="tb-label">' + escapeHtml(strings.heightTrackLabel) + '</span>'
        + '<input class="tb-number" type="number" min="' + spec.trackHeightRange.min + '" max="' + spec.trackHeightRange.max + '" step="1" value="' + spec.trackHeight + '" data-action="track-height-input"' + hintAttr(strings.hintTrackHeightInput) + ' aria-label="' + escapeHtml(strings.heightTrackLabel + ' px') + '">'
        + '<button class="tb-btn" data-action="track-height-reset" aria-label="' + escapeHtml(strings.ariaTrackHeightReset) + '" data-hint="' + escapeHtml(strings.ariaTrackHeightReset) + '">' + escapeHtml(strings.heightTrackLabel + ' ' + strings.btnHeightReset) + '</button></div>'
        + '<div class="tb-menu-row"><span class="tb-label">' + escapeHtml(strings.heightSpectrumLabel) + '</span>'
        + '<input class="tb-number" type="number" min="' + spec.spectrumHeightRange.min + '" max="' + spec.spectrumHeightRange.max + '" step="1" value="' + spec.spectrumHeight + '" data-action="spectrum-height-input"' + hintAttr(strings.hintSpectrumHeightInput) + ' aria-label="' + escapeHtml(strings.heightSpectrumLabel + ' px') + '">'
        + '<button class="tb-btn" data-action="spectrum-height-reset" aria-label="' + escapeHtml(strings.ariaSpectrumHeightReset) + '" data-hint="' + escapeHtml(strings.ariaSpectrumHeightReset) + '">' + escapeHtml(strings.heightSpectrumLabel + ' ' + strings.btnHeightReset) + '</button></div>';
    const workflowMenu = '<button class="tb-btn" data-action="run-recipe"' + hintAttr(strings.hintRunRecipe) + '>' + escapeHtml(strings.btnRunRecipe) + '</button>'
        + '<button class="tb-btn" data-action="copy-spec"' + hintAttr(strings.hintCopySpec) + '>' + escapeHtml(strings.btnCopySpec) + '</button>';
    const exportMenu = '<button class="tb-btn" data-action="export-png"' + hintAttr(strings.btnExportPngTitle) + '>' + escapeHtml(strings.btnExportPng) + '</button>'
        + '<button class="tb-btn" data-action="export-csv"' + hintAttr(strings.btnExportCsvTitle) + '>' + escapeHtml(strings.btnExportCsv) + '</button>'
        + '<button class="tb-btn" data-action="export-wav"' + hintAttr(strings.btnExportWavTitle) + '>' + escapeHtml(strings.btnExportWav) + '</button>'
        + '<button class="tb-btn" data-action="export-report"' + hintAttr(strings.btnExportReportTitle) + '>' + escapeHtml(strings.btnExportReport) + '</button>';
    return '<span class="tb-label">' + escapeHtml(strings.toolbarTrackLabel) + '</span>'
        + '<button class="tb-btn' + (spec.contentType === 'waveform' ? ' is-active' : '') + '" data-action="content-waveform"' + hintAttr(strings.hintContentWaveform) + '>' + escapeHtml(strings.btnWaveform) + '</button>'
        + '<button class="tb-btn' + (spec.contentType === 'spectrogram' ? ' is-active' : '') + '" data-action="content-spectrogram"' + hintAttr(strings.hintContentSpectrogram) + '>' + escapeHtml(strings.btnSpectrogram) + '</button>'
        + '<button class="tb-btn" data-action="spectrogram-settings" data-hint="' + escapeHtml(strings.btnSpectrogramSettingsTitle) + '" aria-label="' + escapeHtml(strings.btnSpectrogramSettingsTitle) + '" style="display:none">⚙</button>'
        + '<div class="tb-sep"></div>'
        + '<span class="tb-label">' + escapeHtml(strings.toolbarZoomLabel) + '</span>'
        + '<button class="tb-btn" data-action="zoom-out"' + hintAttr(strings.hintZoomOut) + ' aria-label="' + escapeHtml(strings.ariaZoomOut) + '">－</button>'
        + '<button class="tb-btn" data-action="zoom-in"' + hintAttr(strings.hintZoomIn) + ' aria-label="' + escapeHtml(strings.ariaZoomIn) + '">＋</button>'
        + '<button class="tb-btn" data-action="zoom-reset"' + hintAttr(strings.hintZoomReset) + ' aria-label="' + escapeHtml(strings.ariaZoomReset) + '">' + escapeHtml(strings.btnZoomReset) + '</button>'
        + '<button class="tb-btn" id="btn-wave-mode-rect-zoom" data-action="wave-mode-rect-zoom"' + hintAttr(strings.hintRectZoom) + ' aria-pressed="false">' + escapeHtml(strings.waveModeLabelRectZoom) + '</button>'
        + '<button class="tb-btn" id="btn-zoom-to-selection" data-action="zoom-to-selection"' + hintAttr(strings.btnZoomToSelectionTitle) + ' disabled>' + escapeHtml(strings.btnZoomToSelection) + '</button>'
        + '<button class="tb-btn" data-action="toggle-follow-cursor"' + hintAttr(strings.btnFollowCursorTitle) + '>' + escapeHtml(strings.btnFollowCursor) + '</button>'
        + '<div class="tb-sep"></div>'
        + toolbarMenu(strings.toolbarAdjustLabel, strings.hintMenuAdjust, adjustMenu)
        + toolbarMenu(strings.toolbarWorkflowLabel, strings.hintMenuWorkflow, workflowMenu)
        + toolbarMenu(strings.toolbarExportLabel, strings.hintMenuExport, exportMenu)
        + '<div class="tb-sep"></div>'
        + '<span id="cursor-display"' + hintAttr(strings.cursorDisplayHint) + '>—</span>'
        + '<span id="playback-display"' + hintAttr(strings.playbackDisplayTitle) + '></span>'
        + '<span id="loop-badge" style="display:none; color:#64a0ff; font-size:0.85em; margin-left:8px;">' + escapeHtml(strings.loopBadge) + '</span>'
        + '<span id="loop-time-display"' + hintAttr(strings.loopTimeDisplayTitle) + ' style="display:none;"></span>'
        + '<span class="tb-label tb-version" id="app-version">v' + escapeHtml(spec.appVersion) + '</span>';
}
