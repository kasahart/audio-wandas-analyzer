import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';

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
}

export function toolbarHtml(spec: ToolbarSpec, strings: UiStrings): string {
    function toolbarMenu(label: string, content: string) {
        return '<details class="tb-menu"><summary class="tb-btn">' + escapeHtml(label) + '</summary><div class="tb-menu-popover">' + content + '</div></details>';
    }
    const adjustMenu = '<div class="tb-menu-row"><span class="tb-label">' + escapeHtml(strings.toolbarHeightLabel) + '</span></div>'
        + '<div class="tb-menu-row"><span class="tb-label">' + escapeHtml(strings.heightTrackLabel) + '</span>'
        + '<input class="tb-number" type="number" min="' + spec.trackHeightRange.min + '" max="' + spec.trackHeightRange.max + '" step="1" value="' + spec.trackHeight + '" data-action="track-height-input" aria-label="' + escapeHtml(strings.heightTrackLabel + ' px') + '">'
        + '<button class="tb-btn" data-action="track-height-reset" aria-label="' + escapeHtml(strings.ariaTrackHeightReset) + '">' + escapeHtml(strings.heightTrackLabel + ' ' + strings.btnHeightReset) + '</button></div>'
        + '<div class="tb-menu-row"><span class="tb-label">' + escapeHtml(strings.heightSpectrumLabel) + '</span>'
        + '<input class="tb-number" type="number" min="' + spec.spectrumHeightRange.min + '" max="' + spec.spectrumHeightRange.max + '" step="1" value="' + spec.spectrumHeight + '" data-action="spectrum-height-input" aria-label="' + escapeHtml(strings.heightSpectrumLabel + ' px') + '">'
        + '<button class="tb-btn" data-action="spectrum-height-reset" aria-label="' + escapeHtml(strings.ariaSpectrumHeightReset) + '">' + escapeHtml(strings.heightSpectrumLabel + ' ' + strings.btnHeightReset) + '</button></div>';
    const workflowMenu = '<button class="tb-btn" data-action="run-recipe">' + escapeHtml(strings.btnRunRecipe) + '</button>'
        + '<button class="tb-btn" data-action="copy-spec">' + escapeHtml(strings.btnCopySpec) + '</button>';
    const exportMenu = '<button class="tb-btn" data-action="export-png" title="' + escapeHtml(strings.btnExportPngTitle) + '">' + escapeHtml(strings.btnExportPng) + '</button>'
        + '<button class="tb-btn" data-action="export-csv" title="' + escapeHtml(strings.btnExportCsvTitle) + '">' + escapeHtml(strings.btnExportCsv) + '</button>'
        + '<button class="tb-btn" data-action="export-wav" title="' + escapeHtml(strings.btnExportWavTitle) + '">' + escapeHtml(strings.btnExportWav) + '</button>'
        + '<button class="tb-btn" data-action="export-report" title="' + escapeHtml(strings.btnExportReportTitle) + '">' + escapeHtml(strings.btnExportReport) + '</button>';
    return '<span class="tb-label">' + escapeHtml(strings.toolbarTrackLabel) + '</span>'
        + '<button class="tb-btn' + (spec.contentType === 'waveform' ? ' is-active' : '') + '" data-action="content-waveform">' + escapeHtml(strings.btnWaveform) + '</button>'
        + '<button class="tb-btn' + (spec.contentType === 'spectrogram' ? ' is-active' : '') + '" data-action="content-spectrogram">' + escapeHtml(strings.btnSpectrogram) + '</button>'
        + '<button class="tb-btn" data-action="spectrogram-settings" title="' + escapeHtml(strings.btnSpectrogramSettingsTitle) + '" aria-label="' + escapeHtml(strings.btnSpectrogramSettingsTitle) + '" style="display:none">⚙</button>'
        + '<div class="tb-sep"></div>'
        + '<span class="tb-label">' + escapeHtml(strings.toolbarZoomLabel) + '</span>'
        + '<button class="tb-btn" data-action="zoom-out" aria-label="' + escapeHtml(strings.ariaZoomOut) + '">－</button>'
        + '<button class="tb-btn" data-action="zoom-in" aria-label="' + escapeHtml(strings.ariaZoomIn) + '">＋</button>'
        + '<button class="tb-btn" data-action="zoom-reset" aria-label="' + escapeHtml(strings.ariaZoomReset) + '">' + escapeHtml(strings.btnZoomReset) + '</button>'
        + '<button class="tb-btn" id="btn-wave-mode-rect-zoom" data-action="wave-mode-rect-zoom" aria-pressed="false">' + escapeHtml(strings.waveModeLabelRectZoom) + '</button>'
        + '<button class="tb-btn" id="btn-zoom-to-selection" data-action="zoom-to-selection" title="' + escapeHtml(strings.btnZoomToSelectionTitle) + '" disabled>' + escapeHtml(strings.btnZoomToSelection) + '</button>'
        + '<button class="tb-btn" data-action="toggle-follow-cursor" title="' + escapeHtml(strings.btnFollowCursorTitle) + '">' + escapeHtml(strings.btnFollowCursor) + '</button>'
        + '<div class="tb-sep"></div>'
        + toolbarMenu(strings.toolbarAdjustLabel, adjustMenu)
        + toolbarMenu(strings.toolbarWorkflowLabel, workflowMenu)
        + toolbarMenu(strings.toolbarExportLabel, exportMenu)
        + '<div class="tb-sep"></div>'
        + '<span id="cursor-display" title="' + escapeHtml(strings.cursorDisplayHint) + '">—</span>'
        + '<span id="playback-display" title="' + escapeHtml(strings.playbackDisplayTitle) + '"></span>'
        + '<span id="loop-badge" style="display:none; color:#64a0ff; font-size:0.85em; margin-left:8px;">' + escapeHtml(strings.loopBadge) + '</span>'
        + '<span id="loop-time-display" title="' + escapeHtml(strings.loopTimeDisplayTitle) + '" style="display:none;"></span>';
}
