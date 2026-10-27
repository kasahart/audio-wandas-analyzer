function channelCanvasSuffix(channelIndex: number): string {
    return channelIndex === 0 ? '' : '-' + channelIndex;
}

export function trackCanvasId(trackIndex: number, channelIndex: number): string {
    return 'track-canvas-' + trackIndex + channelCanvasSuffix(channelIndex);
}

export function trackAxisCanvasId(trackIndex: number, channelIndex: number): string {
    return 'track-axis-canvas-' + trackIndex + channelCanvasSuffix(channelIndex);
}

export function trackSpectrogramOverlayCanvasId(trackIndex: number, channelIndex: number): string {
    return 'track-spectrogram-overlay-' + trackIndex + channelCanvasSuffix(channelIndex);
}

export function trackSpectrumCanvasId(trackIndex: number, channelIndex: number): string {
    return 'track-spectrum-' + trackIndex + channelCanvasSuffix(channelIndex);
}

export function trackCanvasWrapId(trackIndex: number, channelIndex: number): string {
    return 'track-canvas-wrap-' + trackIndex + channelCanvasSuffix(channelIndex);
}

export function trackSpectrumWrapId(trackIndex: number, channelIndex: number): string {
    return 'track-spectrum-wrap-' + trackIndex + channelCanvasSuffix(channelIndex);
}

export function trackSpecCanvasId(trackIndex: number, channelIndex: number): string {
    return 'track-spec-canvas-' + trackIndex + channelCanvasSuffix(channelIndex);
}

export function trackSpecAxisCanvasId(trackIndex: number, channelIndex: number): string {
    return 'track-spec-axis-canvas-' + trackIndex + channelCanvasSuffix(channelIndex);
}

export function trackSpecWrapId(trackIndex: number, channelIndex: number): string {
    return 'track-spec-wrap-' + trackIndex + channelCanvasSuffix(channelIndex);
}
