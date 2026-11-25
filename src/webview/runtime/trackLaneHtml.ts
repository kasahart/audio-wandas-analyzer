import type { ChannelSummary } from '../../shared/analysis/analysisTypes';
import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';
import { frequencyText } from '../shell/numberText';
import { calibrationBadgeHtml, calibrationButtonHtml, channelMetricSummaryHtml, isClipped } from './calibrationDecorations';
import { trackRowFigureId } from './trackCanvasIds';

export interface ChannelLaneSpec {
    trackId: string;
    trackIndex: number;
    channelIndex: number;
    channelCount: number;
    channelLabel: string;
    metricSummaryHtml: string;
    splitHint: string;
    splitLabel: string;
    /** Set on multi-channel tracks, whose lanes each get a reference button. */
    referenceButtonHtml?: string;
}

export function channelLaneHtml(spec: ChannelLaneSpec): string {
    const { trackId, trackIndex, channelIndex, channelLabel: label } = spec;
    const dataAttrs = ' data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '"';
    const header = spec.channelCount > 1
        ? '  <div class="track-channel-lane-header"><span class="track-channel-lane-label">' + escapeHtml(label) + '</span>' + spec.metricSummaryHtml + (spec.referenceButtonHtml ?? '') + '</div>'
        : '';
    return '<div class="track-channel-lane"' + dataAttrs + '>'
        + header
        + '  <div class="track-channel-lane-body">'
        // The channel's one Figure (screens/trackRows.ts: the waveform above the spectrogram on one time axis), the
        // layer of the cursor's and the loop's lines over it, and what the row says while it draws nothing. The split
        // between the Figure's two lanes is draggable, and lies over the room between them.
        + '    <div class="track-canvas-stack">'
        + '    <div class="track-split" data-action="track-split-drag"' + dataAttrs + hintAttr(spec.splitHint) + ' role="separator" tabindex="0" aria-orientation="horizontal" aria-label="' + escapeHtml(spec.splitLabel) + '"></div>'
        + '    <div class="track-row-figure" id="' + trackRowFigureId(trackIndex, channelIndex) + '"><canvas class="track-row-layer" aria-hidden="true"></canvas><div class="track-row-says" hidden></div></div>'
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
    lanesHtml: string;
    /** The role chip (roleChip.ts) in place of a plain colour swatch. */
    roleChipHtml: string;
    /** Set on mono tracks, whose one lane has no header of its own. */
    referenceButtonHtml?: string;
}

export type TrackRowStrings = Pick<UiStrings,
    | 'ariaDragHandle' | 'clipBadgeTitle' | 'trackMoreHint' | 'offsetStepUp' | 'offsetStepDown' | 'offsetEdit' | 'offsetReset'
    | 'trackPlayTitle' | 'trackNoAudio' | 'ariaTrackPlay' | 'trackStopTitle' | 'ariaTrackStop' | 'ariaRemoveTrack'
    | 'calibrationButtonLabel' | 'calibrationButtonTitle' | 'calibrationButtonAria' | 'reanalyzeChanged' | 'reanalyzeChangedHint'
    | 'trackOffsetResetHint' | 'ariaOffsetValue' | 'ariaOffsetUp' | 'ariaOffsetDown' | 'ariaResizeTrackHeight'
    | 'hintRemoveTrack' | 'hintOffsetUp' | 'hintOffsetDown' | 'hintTrackHeightResizer'
    | 'peakLabel' | 'calibrationBadgeUncalibratedHint' | 'calibrationBadgeRawHint' | 'calibrationBadgePartialHint' | 'calibrationFactorLabel'>;

/** How many of a name's last characters (before its extension) stay in sight in a track's header: the run number. */
const TRACK_NAME_TAIL = 6;

/**
 * A track's name in its narrow header (about 60 px). A long one gives way in its middle: the head takes the ellipsis,
 * the last characters before the extension (the run number) stay, and the extension is not drawn (every track is a
 * recording; the full path is the hint). So tracks of files named alike (…run001.wav, …run002.wav) stay told apart.
 * The element's text is still the whole name (the PNG export labels its rows with it).
 */
export function trackNameHtml(fileName: string, filePath: string): string {
    const dot = fileName.lastIndexOf('.');
    const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
    const extension = fileName.slice(stem.length);
    if (stem.length <= TRACK_NAME_TAIL + 4) return '<div class="track-name"' + hintAttr(filePath) + '>' + escapeHtml(fileName) + '</div>';
    const cut = stem.length - TRACK_NAME_TAIL;
    return '<div class="track-name is-split"' + hintAttr(filePath) + '><span class="track-name-head">' + escapeHtml(stem.slice(0, cut))
        + '</span><span class="track-name-tail">' + escapeHtml(stem.slice(cut)) + '</span><span class="track-name-ext">' + escapeHtml(extension) + '</span></div>';
}

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
        + '    ' + trackNameHtml(spec.fileName, spec.filePath)
        + (isClipped(channels) ? '    <span class="clip-badge"' + hintAttr(strings.clipBadgeTitle) + '>CLIP</span>' : '')
        + '    ' + calibrationBadgeHtml(channels, strings)
        + '  </div>'
        + '  <div class="track-meta">' + spec.channelCount + ' ch &nbsp;' + frequencyText(spec.sampleRateHz) + monoSummary + '</div>'
        + '  <div class="track-btns">'
        + '    <button class="track-btn" data-action="toggle-playback" data-track-id="' + trackId + '"' + hintAttr(playHint(strings.trackPlayTitle)) + ' aria-label="' + escapeHtml(strings.ariaTrackPlay) + '"' + disabled + '>▶</button>'
        + '    <button class="track-btn" data-action="stop-playback" data-track-id="' + trackId + '"' + hintAttr(playHint(strings.trackStopTitle)) + ' aria-label="' + escapeHtml(strings.ariaTrackStop) + '"' + disabled + '>■</button>'
        + '    <button class="track-btn" data-action="remove-track" data-track-id="' + trackId + '"' + hintAttr(strings.hintRemoveTrack) + ' aria-label="' + escapeHtml(strings.ariaRemoveTrack) + '">✕</button>'
        + '    ' + calibrationButtonHtml(trackId, strings)
        // Shown only once the file changed on disk after it was analysed (the runtime unhides it): its one way on.
        + '    <button class="track-btn" data-action="reanalyze-changed" data-track-id="' + trackId + '"' + hintAttr(strings.reanalyzeChangedHint) + ' hidden>' + escapeHtml(strings.reanalyzeChanged) + '</button>'
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
