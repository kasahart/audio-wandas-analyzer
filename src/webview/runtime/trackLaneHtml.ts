import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { trackAxisCanvasId, trackCanvasId, trackCanvasWrapId, trackSpectrogramOverlayCanvasId, trackSpectrumCanvasId, trackSpectrumWrapId } from './trackCanvasIds';

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
}

export function channelLaneHtml(spec: ChannelLaneSpec): string {
    const { trackId, trackIndex, channelIndex, channelLabel: label, axisWidth } = spec;
    const dataAttrs = ' data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '"';
    const header = spec.channelCount > 1
        ? '  <div class="track-channel-lane-header"><span class="track-channel-lane-label">' + escapeHtml(label) + '</span>' + spec.metricSummaryHtml + '</div>'
        : '';
    return '<div class="track-channel-lane"' + dataAttrs + '>'
        + header
        + '  <div class="track-channel-lane-body">'
        + '    <div class="track-canvas-wrap" id="' + trackCanvasWrapId(trackIndex, channelIndex) + '">'
        + '      <canvas class="track-axis-canvas" id="' + trackAxisCanvasId(trackIndex, channelIndex) + '" style="width:' + axisWidth + 'px"' + dataAttrs + '></canvas>'
        + '      <canvas class="track-canvas" id="' + trackCanvasId(trackIndex, channelIndex) + '"' + dataAttrs + ' tabindex="0" style="outline:none;flex:1"></canvas>'
        + '      <canvas class="track-spectrogram-overlay" id="' + trackSpectrogramOverlayCanvasId(trackIndex, channelIndex) + '"' + dataAttrs + ' aria-hidden="true" style="display:none;position:absolute;left:' + axisWidth + 'px;top:0;right:0;bottom:0;pointer-events:none"></canvas>'
        + '    </div>'
        + '    <div class="track-spectrum-wrap" id="' + trackSpectrumWrapId(trackIndex, channelIndex) + '" title="' + escapeHtml(spec.spectrumTitle) + '">'
        + '      <canvas class="track-spectrum-canvas" id="' + trackSpectrumCanvasId(trackIndex, channelIndex) + '"' + dataAttrs + ' tabindex="0" aria-label="' + escapeHtml(spec.fileName + ' ' + label + ' ' + spec.spectrumTitle) + '"></canvas>'
        + '    </div>'
        + '  </div>'
        + '</div>';
}
