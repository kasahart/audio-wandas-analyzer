import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';
import { panelToggleHtml, type PanelCollapseStrings } from './panelCollapse';

export interface ResultsPaneParts {
    toolbarHtml: string;
    tracksHtml: string;
    audioHtml: string;
    emptyMessage: string;
    axisWidth: number;
    spectrumBandsPerOctave: SpectrumBandsSetting;
    spectrumCollapsed?: boolean;
}

/** 0 is the FFT spectrum; 1 and 3 are octave bands. */
export type SpectrumBandsSetting = 0 | 1 | 3;

export type ResultsPaneStrings = Pick<UiStrings,
    | 'ariaToolbar' | 'spectrumSectionTitle' | 'spectrumZoomLabel'
    | 'ariaSpecZoomOut' | 'ariaSpecZoomIn' | 'ariaSpecZoomReset' | 'btnSpecZoomReset' | 'heightSpectrumLabel'
    | 'hintSpecZoomOut' | 'hintSpecZoomIn' | 'hintSpecZoomReset' | 'btnSpectrumSettingsTitle' | 'hintSpectrumHeightResizer' | 'hintWheelGestures' | 'hintSpectrumPlot'
    | 'hintSpectrumFft' | 'hintSpectrumOctave1' | 'hintSpectrumOctave3'> & PanelCollapseStrings;

function spectrumBandsButtons(selected: SpectrumBandsSetting, strings: ResultsPaneStrings): string {
    const state = (bands: SpectrumBandsSetting) => (bands === selected ? ' is-active" aria-pressed="true"' : '" aria-pressed="false"');
    return '<button class="tb-btn' + state(0) + ' data-action="spectrum-fft"' + hintAttr(strings.hintSpectrumFft) + '>FFT</button>'
        + '<button class="tb-btn' + state(1) + ' data-action="spectrum-octave-1"' + hintAttr(strings.hintSpectrumOctave1) + '>1/1</button>'
        + '<button class="tb-btn' + state(3) + ' data-action="spectrum-octave-3"' + hintAttr(strings.hintSpectrumOctave3) + '>1/3</button>';
}

export function resultsPaneHtml(parts: ResultsPaneParts, strings: ResultsPaneStrings): string {
    return '<div id="toolbar" role="toolbar" aria-label="' + escapeHtml(strings.ariaToolbar) + '">' + parts.toolbarHtml + '</div>'
        + '<div id="tracks-wrapper">'
        + '  <div id="ruler-row"><div id="ruler-spacer"></div><div id="ruler-axis-spacer" style="width:' + parts.axisWidth + 'px;flex:none"></div><canvas id="ruler-canvas"' + hintAttr(strings.hintWheelGestures) + '></canvas></div>'
        + '  <div id="stacked-wrap">' + parts.tracksHtml + '</div>'
        + '  <div id="empty-state"><p>' + escapeHtml(parts.emptyMessage) + '</p></div>'
        + '</div>'
        + '<div id="spectrum-section"' + (parts.spectrumCollapsed ? ' class="is-collapsed"' : '') + '>'
        + '  <div class="height-resizer spectrum-height-resizer" data-action="spectrum-height-drag"' + hintAttr(strings.hintSpectrumHeightResizer) + ' role="separator" aria-orientation="horizontal" aria-label="' + escapeHtml(strings.heightSpectrumLabel + ' resize') + '"></div>'
        + '  <div id="spectrum-section-header"><span>' + escapeHtml(strings.spectrumSectionTitle) + '</span><span id="spectrum-cursor-time" style="font-family:var(--font-mono);"></span><span id="spectrum-freq-readout" style="font-family:var(--font-mono);margin-left:14px;"></span>' + panelToggleHtml('spectrum', Boolean(parts.spectrumCollapsed), strings) + '</div>'
        + '  <div id="spectrum-zoom-toolbar" style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:11px;">'
        + '    <span class="tb-label">' + escapeHtml(strings.spectrumZoomLabel) + '</span>'
        + '    <button class="tb-btn" data-action="spec-zoom-out"' + hintAttr(strings.hintSpecZoomOut) + ' aria-label="' + escapeHtml(strings.ariaSpecZoomOut) + '">－</button>'
        + '    <button class="tb-btn" data-action="spec-zoom-in"' + hintAttr(strings.hintSpecZoomIn) + ' aria-label="' + escapeHtml(strings.ariaSpecZoomIn) + '">＋</button>'
        + '    <button class="tb-btn" data-action="spec-zoom-reset"' + hintAttr(strings.hintSpecZoomReset) + ' aria-label="' + escapeHtml(strings.ariaSpecZoomReset) + '">' + escapeHtml(strings.btnSpecZoomReset) + '</button>'
        + '    <span style="margin-left:auto;display:flex;gap:2px;">' + spectrumBandsButtons(parts.spectrumBandsPerOctave, strings) + '</span>'
        + '    <button class="tb-btn" data-action="spectrum-settings"' + hintAttr(strings.btnSpectrumSettingsTitle) + ' aria-label="' + escapeHtml(strings.btnSpectrumSettingsTitle) + '">⚙</button>'
        + '  </div>'
        + '  <div id="spectrum-overlay-wrap"><canvas id="spectrum-overlay-canvas" tabindex="0" aria-label="' + escapeHtml(strings.spectrumSectionTitle) + '"' + hintAttr(strings.hintSpectrumPlot) + '></canvas></div>'
        + '</div>'
        + '<div id="audio-host">' + parts.audioHtml + '</div>';
}

export function trackAudioHtml(trackId: string, trackIndex: number, audioSource: string, muted: boolean): string {
    return '<audio id="track-audio-' + trackIndex + '" data-track-id="' + trackId + '" preload="metadata" crossorigin="anonymous"' + (muted ? ' muted' : '') + ' src="' + escapeHtml(audioSource) + '"></audio>';
}
