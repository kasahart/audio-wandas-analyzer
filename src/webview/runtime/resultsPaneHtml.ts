import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';

export interface ResultsPaneParts {
    toolbarHtml: string;
    tracksHtml: string;
    audioHtml: string;
    emptyMessage: string;
    axisWidth: number;
}

export type ResultsPaneStrings = Pick<UiStrings,
    | 'ariaToolbar' | 'spectrumSectionTitle' | 'spectrumZoomLabel'
    | 'ariaSpecZoomOut' | 'ariaSpecZoomIn' | 'ariaSpecZoomReset' | 'btnSpecZoomReset' | 'heightSpectrumLabel'
    | 'hintSpecZoomOut' | 'hintSpecZoomIn' | 'hintSpecZoomReset' | 'hintSpectrumHeightResizer' | 'hintWheelGestures'>;

export function resultsPaneHtml(parts: ResultsPaneParts, strings: ResultsPaneStrings): string {
    return '<div id="toolbar" role="toolbar" aria-label="' + escapeHtml(strings.ariaToolbar) + '">' + parts.toolbarHtml + '</div>'
        + '<div id="tracks-wrapper">'
        + '  <div id="ruler-row"><div id="ruler-spacer"></div><div id="ruler-axis-spacer" style="width:' + parts.axisWidth + 'px;flex:none"></div><canvas id="ruler-canvas"' + hintAttr(strings.hintWheelGestures) + '></canvas></div>'
        + '  <div id="stacked-wrap">' + parts.tracksHtml + '</div>'
        + '  <div id="empty-state"><p>' + escapeHtml(parts.emptyMessage) + '</p></div>'
        + '</div>'
        + '<div id="spectrum-section">'
        + '  <div class="height-resizer spectrum-height-resizer" data-action="spectrum-height-drag"' + hintAttr(strings.hintSpectrumHeightResizer) + ' role="separator" aria-orientation="horizontal" aria-label="' + escapeHtml(strings.heightSpectrumLabel + ' resize') + '"></div>'
        + '  <div id="spectrum-section-header"><span>' + escapeHtml(strings.spectrumSectionTitle) + '</span><span id="spectrum-cursor-time" style="font-family:var(--font-mono);"></span><span id="spectrum-freq-readout" style="font-family:var(--font-mono);margin-left:14px;"></span></div>'
        + '  <div id="spectrum-zoom-toolbar" style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:11px;">'
        + '    <span class="tb-label">' + escapeHtml(strings.spectrumZoomLabel) + '</span>'
        + '    <button class="tb-btn" data-action="spec-zoom-out"' + hintAttr(strings.hintSpecZoomOut) + ' aria-label="' + escapeHtml(strings.ariaSpecZoomOut) + '">－</button>'
        + '    <button class="tb-btn" data-action="spec-zoom-in"' + hintAttr(strings.hintSpecZoomIn) + ' aria-label="' + escapeHtml(strings.ariaSpecZoomIn) + '">＋</button>'
        + '    <button class="tb-btn" data-action="spec-zoom-reset"' + hintAttr(strings.hintSpecZoomReset) + ' aria-label="' + escapeHtml(strings.ariaSpecZoomReset) + '">' + escapeHtml(strings.btnSpecZoomReset) + '</button>'
        + '  </div>'
        + '  <div id="spectrum-overlay-wrap"><canvas id="spectrum-overlay-canvas" tabindex="0" aria-label="' + escapeHtml(strings.spectrumSectionTitle) + '"></canvas></div>'
        + '</div>'
        + '<div id="audio-host">' + parts.audioHtml + '</div>';
}

export function trackAudioHtml(trackId: string, trackIndex: number, audioSource: string, muted: boolean): string {
    return '<audio id="track-audio-' + trackIndex + '" data-track-id="' + trackId + '" preload="metadata"' + (muted ? ' muted' : '') + ' src="' + escapeHtml(audioSource) + '"></audio>';
}
