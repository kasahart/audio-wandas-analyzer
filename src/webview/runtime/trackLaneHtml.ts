import type { ChannelSummary } from '../../shared/analysis/analysisTypes';
import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';
import { calibrationBadgeHtml, calibrationButtonHtml, channelMetricSummaryHtml, isClipped } from './calibrationDecorations';
import { trackAxisCanvasId, trackCanvasId, trackCanvasWrapId, trackSpecAxisCanvasId, trackSpecCanvasId, trackSpecWrapId, trackSpectrogramOverlayCanvasId, trackSpectrumCanvasId, trackSpectrumWrapId } from './trackCanvasIds';

export interface ChannelLaneSpec {
    trackId: string;
    trackIndex: number;
    channelIndex: number;
    channelCount: number;
    channelLabel: string;
    metricSummaryHtml: string;
    fileName: string;
    axisWidth: number;
    spectrumTitle: string;
    /** The canvases' accessible names: the file, the channel and what the canvas shows. */
    waveformLabel: string;
    spectrogramLabel: string;
    axisHint: string;
    spectrogramAxisHint: string;
    splitHint: string;
    splitLabel: string;
    spectrumHint: string;
    /** Set on multi-channel tracks, whose lanes each get a reference button. */
    referenceButtonHtml?: string;
}

export function channelLaneHtml(spec: ChannelLaneSpec): string {
    const { trackId, trackIndex, channelIndex, channelLabel: label, axisWidth } = spec;
    const dataAttrs = ' data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '"';
    const header = spec.channelCount > 1
        ? '  <div class="track-channel-lane-header"><span class="track-channel-lane-label">' + escapeHtml(label) + '</span>' + spec.metricSummaryHtml + (spec.referenceButtonHtml ?? '') + '</div>'
        : '';
    return '<div class="track-channel-lane"' + dataAttrs + '>'
        + header
        + '  <div class="track-channel-lane-body">'
        // The waveform above the spectrogram on one time axis; the split between them is draggable.
        + '    <div class="track-canvas-stack">'
        + '    <div class="track-canvas-wrap" id="' + trackCanvasWrapId(trackIndex, channelIndex) + '">'
        + '      <canvas class="track-axis-canvas" id="' + trackAxisCanvasId(trackIndex, channelIndex) + '" style="width:' + axisWidth + 'px"' + dataAttrs + hintAttr(spec.axisHint) + '></canvas>'
        + '      <canvas class="track-canvas" id="' + trackCanvasId(trackIndex, channelIndex) + '"' + dataAttrs + ' tabindex="0" role="img" aria-label="' + escapeHtml(spec.waveformLabel) + '" style="flex:1"></canvas>'
        + '    </div>'
        + '    <div class="track-split" data-action="track-split-drag"' + dataAttrs + hintAttr(spec.splitHint) + ' role="separator" tabindex="0" aria-orientation="horizontal" aria-label="' + escapeHtml(spec.splitLabel) + '"></div>'
        + '    <div class="track-spec-wrap" id="' + trackSpecWrapId(trackIndex, channelIndex) + '">'
        + '      <canvas class="track-axis-canvas track-spec-axis" id="' + trackSpecAxisCanvasId(trackIndex, channelIndex) + '" style="width:' + axisWidth + 'px"' + dataAttrs + hintAttr(spec.spectrogramAxisHint) + '></canvas>'
        + '      <canvas class="track-canvas track-spec-canvas" id="' + trackSpecCanvasId(trackIndex, channelIndex) + '"' + dataAttrs + ' tabindex="-1" role="img" aria-label="' + escapeHtml(spec.spectrogramLabel) + '" style="flex:1"></canvas>'
        + '      <canvas class="track-spectrogram-overlay" id="' + trackSpectrogramOverlayCanvasId(trackIndex, channelIndex) + '"' + dataAttrs + ' aria-hidden="true" style="position:absolute;left:' + axisWidth + 'px;top:0;right:0;bottom:0;pointer-events:none"></canvas>'
        + '    </div>'
        + '    </div>'
        + '    <div class="track-spectrum-wrap" id="' + trackSpectrumWrapId(trackIndex, channelIndex) + '">'
        + '      <canvas class="track-spectrum-canvas" id="' + trackSpectrumCanvasId(trackIndex, channelIndex) + '"' + dataAttrs + ' tabindex="0" aria-label="' + escapeHtml(spec.fileName + ' ' + label + ' ' + spec.spectrumTitle) + '"' + hintAttr(spec.spectrumHint) + '></canvas>'
        + '    </div>'
        + '  </div>'
        + '</div>';
}

export interface TrackRowSpec {
    trackId: string;
    trackIndex: number;
    fileName: string;
    filePath: string;
    channelCount: number;
    sampleRateHz: number;
    channels: ChannelSummary[];
    playable: boolean;
    muted: boolean;
    lanesHtml: string;
    /** The role chip (roleChip.ts) in place of a plain colour swatch. */
    roleChipHtml: string;
    /** Set on mono tracks, whose one lane has no header of its own. */
    referenceButtonHtml?: string;
}

export type TrackRowStrings = Pick<UiStrings,
    | 'ariaDragHandle' | 'clipBadgeTitle' | 'trackMoreHint' | 'offsetStepUp' | 'offsetStepDown' | 'offsetEdit' | 'offsetReset'
    | 'trackPlayTitle' | 'trackNoAudio' | 'ariaTrackPlay' | 'trackStopTitle' | 'ariaTrackStop' | 'ariaTrackMute' | 'ariaRemoveTrack'
    | 'calibrationButtonLabel' | 'calibrationButtonTitle' | 'calibrationButtonAria'
    | 'trackOffsetResetHint' | 'ariaOffsetValue' | 'ariaOffsetUp' | 'ariaOffsetDown' | 'ariaResizeTrackHeight'
    | 'hintRemoveTrack' | 'hintOffsetUp' | 'hintOffsetDown' | 'hintTrackHeightResizer'
    | 'peakLabel' | 'calibrationBadgeUncalibratedHint' | 'calibrationBadgePartialHint' | 'calibrationFactorLabel'>;

export function trackRowHtml(spec: TrackRowSpec, strings: TrackRowStrings): string {
    const { trackId, trackIndex: i, channels } = spec;
    const monoSummary = channels.length === 1
        ? ' &nbsp; ' + channelMetricSummaryHtml(channels[0], strings.peakLabel)
        : '';
    const disabled = spec.playable ? '' : ' disabled';
    // Without decoded audio the buttons say why they do nothing (a disabled button still shows its hint).
    const playHint = (hint: string): string => spec.playable ? hint : strings.trackNoAudio;
    return '<div class="track-row" id="track-row-' + i + '" data-track-id="' + trackId + '" data-file-path="' + escapeHtml(spec.filePath) + '">'
        + '<div class="track-header">'
        + '  <div class="track-title-row">'
        + '    <div class="track-drag-handle" draggable="true" data-track-id="' + trackId + '" aria-label="' + escapeHtml(strings.ariaDragHandle) + '" data-hint="' + escapeHtml(strings.ariaDragHandle) + '">≡</div>'
        // The track's role chip (its colour without a role): the same slots as the entry table's 0–3.
        + '    ' + spec.roleChipHtml
        + '    <div class="track-name"' + hintAttr(spec.filePath) + '>' + escapeHtml(spec.fileName) + '</div>'
        + (isClipped(channels) ? '    <span class="clip-badge"' + hintAttr(strings.clipBadgeTitle) + '>CLIP</span>' : '')
        + '    ' + calibrationBadgeHtml(channels, strings)
        + '  </div>'
        + '  <div class="track-meta">' + spec.channelCount + ' ch &nbsp;' + (spec.sampleRateHz / 1000).toFixed(1) + 'kHz' + monoSummary + '</div>'
        + '  <div class="track-btns">'
        + '    <button class="track-btn" data-action="toggle-playback" data-track-id="' + trackId + '"' + hintAttr(playHint(strings.trackPlayTitle)) + ' aria-label="' + escapeHtml(strings.ariaTrackPlay) + '"' + disabled + '>▶</button>'
        + '    <button class="track-btn" data-action="stop-playback" data-track-id="' + trackId + '"' + hintAttr(playHint(strings.trackStopTitle)) + ' aria-label="' + escapeHtml(strings.ariaTrackStop) + '"' + disabled + '>■</button>'
        + '    <button class="track-btn" data-action="toggle-mute" data-track-id="' + trackId + '" aria-label="' + escapeHtml(strings.ariaTrackMute) + '" data-hint="' + escapeHtml(playHint(strings.ariaTrackMute)) + '" aria-pressed="' + spec.muted + '"' + disabled + '>' + (spec.muted ? '🔇' : '🔊') + '</button>'
        + '    <button class="track-btn" data-action="remove-track" data-track-id="' + trackId + '"' + hintAttr(strings.hintRemoveTrack) + ' aria-label="' + escapeHtml(strings.ariaRemoveTrack) + '">✕</button>'
        + '    ' + calibrationButtonHtml(trackId, strings)
        + (spec.referenceButtonHtml ? '    ' + spec.referenceButtonHtml : '')
        // The time offset: its steps live in the track's … menu; the value shows only while the track is shifted.
        + '    <details class="track-more"><summary class="track-btn"' + hintAttr(strings.trackMoreHint) + ' aria-label="' + escapeHtml(strings.trackMoreHint) + '">…</summary><div class="track-more-menu">'
        + '      <button class="track-btn" data-action="offset-up" data-track-id="' + trackId + '"' + hintAttr(strings.hintOffsetUp) + ' aria-label="' + escapeHtml(strings.ariaOffsetUp) + '">▲ ' + escapeHtml(strings.offsetStepUp) + '</button>'
        + '      <button class="track-btn" data-action="offset-down" data-track-id="' + trackId + '"' + hintAttr(strings.hintOffsetDown) + ' aria-label="' + escapeHtml(strings.ariaOffsetDown) + '">▼ ' + escapeHtml(strings.offsetStepDown) + '</button>'
        + '      <button class="track-btn" data-action="offset-edit" data-track-id="' + trackId + '"' + hintAttr(strings.offsetEdit) + '>' + escapeHtml(strings.offsetEdit) + '</button>'
        + '      <button class="track-btn" data-action="offset-reset" data-track-id="' + trackId + '"' + hintAttr(strings.offsetReset) + '>' + escapeHtml(strings.offsetReset) + '</button>'
        + '    </div></details>'
        + '  </div>'
        + '  <div class="track-offset">'
        + '    <span class="track-offset-val" id="offset-val-' + i + '" data-track-id="' + trackId + '"' + hintAttr(strings.trackOffsetResetHint) + ' aria-label="' + escapeHtml(strings.ariaOffsetValue) + '">+0.000s</span>'
        + '  </div>'
        + '</div>'
        + '<div class="track-channel-lanes">' + spec.lanesHtml + '</div>'
        + '<div class="height-resizer track-height-resizer" data-action="track-height-drag"' + hintAttr(strings.hintTrackHeightResizer) + ' role="separator" tabindex="0" aria-orientation="horizontal" aria-label="' + escapeHtml(strings.ariaResizeTrackHeight) + '"></div>'
        + '</div>';
}
