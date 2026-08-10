export interface NormalizedRange {
    start: number;
    end: number;
}

export function zoomNormalizedRange(range: NormalizedRange, factor: number): NormalizedRange {
    const center = (range.start + range.end) / 2;
    const half = ((range.end - range.start) / 2) * factor;
    return {
        start: Math.max(0, center - half),
        end: Math.min(1, center + half),
    };
}

export function amplitudeNormToCanvasY(
    norm: number,
    height: number,
    amplitudeMin: number,
    amplitudeMax: number,
): number {
    if (amplitudeMin > -0.999999 || amplitudeMax < 0.999999) {
        return ((amplitudeMax - norm) / Math.max(amplitudeMax - amplitudeMin, 1e-9)) * height;
    }
    return height / 2 - norm * (height * 0.44);
}

export function canvasYToAmplitudeNorm(
    y: number,
    height: number,
    amplitudeMin: number,
    amplitudeMax: number,
): number {
    const clampedY = Math.max(0, Math.min(height, y));
    if (amplitudeMin > -0.999999 || amplitudeMax < 0.999999) {
        return amplitudeMax - (clampedY / Math.max(height, 1)) * (amplitudeMax - amplitudeMin);
    }
    return Math.max(-1, Math.min(1, (height / 2 - clampedY) / (height * 0.44)));
}
