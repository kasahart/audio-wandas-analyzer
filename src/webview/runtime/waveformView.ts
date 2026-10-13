import {
    canvasYToAmplitudeNorm,
    centerRangeOn,
    panNormalizedRange,
    rangeAroundRegion,
    zoomNormalizedRange,
    zoomRangeAroundPivot,
    type NormalizedRange,
    type RectZoomTarget,
} from './waveformInteraction';

/** Visible time window (normalized over the global span) and amplitude window of the waveform lanes. */
export class WaveformView {
    start = 0;
    end = 1;
    amplitudeMin = -1;
    amplitudeMax = 1;

    timeRange(): NormalizedRange {
        return { start: this.start, end: this.end };
    }

    span(): number {
        return this.end - this.start;
    }

    setTimeRange(range: NormalizedRange): void {
        this.start = range.start;
        this.end = range.end;
    }

    zoomBy(factor: number): void {
        this.setTimeRange(zoomNormalizedRange(this.timeRange(), factor));
    }

    zoomAround(pivotNorm: number, factor: number): void {
        this.setTimeRange(zoomRangeAroundPivot(this.timeRange(), pivotNorm, factor));
    }

    pan(direction: -1 | 1): void {
        this.setTimeRange(panNormalizedRange(this.timeRange(), direction));
    }

    centerOn(norm: number): void {
        this.setTimeRange(centerRangeOn(this.timeRange(), norm));
    }

    showRegion(region: NormalizedRange, padRatio: number): void {
        this.setTimeRange(rangeAroundRegion(region, padRatio));
    }

    applyRectZoom(target: RectZoomTarget): void {
        this.setTimeRange({ start: target.zoomStart, end: target.zoomEnd });
        this.amplitudeMin = target.amplitudeMin;
        this.amplitudeMax = target.amplitudeMax;
    }

    reset(): void {
        this.setTimeRange({ start: 0, end: 1 });
        this.amplitudeMin = -1;
        this.amplitudeMax = 1;
    }

    isAmplitudeZoomed(): boolean {
        return this.amplitudeMin > -0.999999 || this.amplitudeMax < 0.999999;
    }

    canvasYToAmplitude(y: number, height: number): number {
        return canvasYToAmplitudeNorm(y, height, this.amplitudeMin, this.amplitudeMax);
    }
}
