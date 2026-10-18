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
import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';

// The unzoomed lane keeps ±1 (the channel peak) inside a margin, so its edges sit slightly beyond ±1.
const AUTO_AMPLITUDE_EDGE = 1 / (2 * WAVEFORM_HALF_HEIGHT_RATIO);

/** Visible time window (normalized over the global span) and amplitude window of the waveform lanes. */
export class WaveformView {
    start = 0;
    end = 1;
    amplitudeMin = -1;
    amplitudeMax = 1;
    private amplitudeSet = false;

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
        this.resetAmplitude();
    }

    /** Peak-normalized bounds typed into the axis popover; `null` keeps that edge where the unzoomed lane has it. */
    setAmplitudeRange(min: number | null, max: number | null): boolean {
        const lo = min ?? -AUTO_AMPLITUDE_EDGE;
        const hi = max ?? AUTO_AMPLITUDE_EDGE;
        if (!(lo < hi)) {
            return false;
        }
        this.amplitudeMin = lo;
        this.amplitudeMax = hi;
        this.amplitudeSet = true;
        return true;
    }

    resetAmplitude(): void {
        this.amplitudeMin = -1;
        this.amplitudeMax = 1;
        this.amplitudeSet = false;
    }

    /** Peak-normalized values at the lane's top and bottom edges as currently drawn. */
    paintedAmplitudeRange(): { min: number; max: number } {
        return this.isAmplitudeZoomed()
            ? { min: this.amplitudeMin, max: this.amplitudeMax }
            : { min: -AUTO_AMPLITUDE_EDGE, max: AUTO_AMPLITUDE_EDGE };
    }

    isAmplitudeZoomed(): boolean {
        return this.amplitudeSet || this.amplitudeMin > -0.999999 || this.amplitudeMax < 0.999999;
    }

    canvasYToAmplitude(y: number, height: number): number {
        return canvasYToAmplitudeNorm(y, height, this.amplitudeMin, this.amplitudeMax, this.amplitudeSet);
    }

    /** The amplitude window for overlays drawn with the same mapping as the waveform. */
    amplitudeViewport(): { start: number; end: number; explicit: boolean } {
        return { start: this.amplitudeMin, end: this.amplitudeMax, explicit: this.amplitudeSet };
    }
}
