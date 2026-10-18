import { frequencyAtFraction, frequencyFraction, type FrequencyScale } from '../draw/canvasDrawers';
import { spectrumDbRangeAfterZoom, zoomSpectrumRange, type SpectrumBoxZoom, type SpectrumViewState } from './spectrumRuntime';

export interface SpectrumPaintedRange {
    maxFrequencyHz: number;
    /** Set when the painted axis is log (octave bands). */
    logMinFrequencyHz?: number;
    dbMin: number;
    dbMax: number;
}

/** Frequency/dB view of the overlay spectrum plus the range it was last painted with. */
export class SpectrumView {
    freqStart = 0;
    freqEnd = 1;
    /** `null` follows the data; a number overrides that edge of the dB axis. */
    dbMin: number | null = null;
    dbMax: number | null = null;
    private painted: SpectrumPaintedRange | null = null;

    state(): SpectrumViewState {
        return { freqStart: this.freqStart, freqEnd: this.freqEnd, dbMin: this.dbMin, dbMax: this.dbMax };
    }

    recordPaint(painted: SpectrumPaintedRange): void {
        this.painted = { maxFrequencyHz: painted.maxFrequencyHz, logMinFrequencyHz: painted.logMinFrequencyHz, dbMin: painted.dbMin, dbMax: painted.dbMax };
    }

    hasData(): boolean {
        return !!this.painted && this.painted.maxFrequencyHz > 0;
    }

    paintedDb(): { min: number; max: number } | null {
        return this.painted ? { min: this.painted.dbMin, max: this.painted.dbMax } : null;
    }

    zoomBy(factor: number): void {
        const range = zoomSpectrumRange({ start: this.freqStart, end: this.freqEnd }, factor);
        this.freqStart = range.start;
        this.freqEnd = range.end;
        const db = spectrumDbRangeAfterZoom(range, factor, this.paintedDb());
        if (db) {
            this.dbMin = db.dbMin;
            this.dbMax = db.dbMax;
        }
    }

    applyBoxZoom(zoom: SpectrumBoxZoom): void {
        this.freqStart = zoom.freqStart;
        this.freqEnd = zoom.freqEnd;
        if (zoom.dbMin !== undefined && zoom.dbMax !== undefined) {
            this.dbMin = zoom.dbMin;
            this.dbMax = zoom.dbMax;
        }
    }

    reset(): void {
        this.resetFrequency();
        this.setDbRange(null, null);
    }

    resetFrequency(): void {
        this.freqStart = 0;
        this.freqEnd = 1;
    }

    setDbRange(min: number | null, max: number | null): void {
        this.dbMin = min;
        this.dbMax = max;
    }

    dbRangeFields(): { min: string; max: string } {
        const painted = this.paintedDb();
        const field = (override: number | null, paintedEdge: number | undefined) =>
            override != null ? String(override) : (paintedEdge != null ? String(Math.round(paintedEdge)) : '');
        return { min: field(this.dbMin, painted?.min), max: field(this.dbMax, painted?.max) };
    }

    private paintedAxis(): FrequencyScale {
        const painted = this.painted;
        if (painted && painted.logMinFrequencyHz !== undefined) {
            return { frequencyMin: painted.logMinFrequencyHz, frequencyMax: painted.maxFrequencyHz, logFrequency: true };
        }
        return { frequencyMin: 0, frequencyMax: (painted && painted.maxFrequencyHz) || 0 };
    }

    frequencyRangeFieldsHz(): { min: string; max: string } {
        const axis = this.paintedAxis();
        return { min: String(Math.round(frequencyAtFraction(this.freqStart, axis))), max: String(Math.round(frequencyAtFraction(this.freqEnd, axis))) };
    }

    /** Applies a Hz range (`null` = open edge). Returns false and keeps the view when min >= max. */
    setFrequencyRangeHz(minHz: number | null, maxHz: number | null): boolean {
        const axis = this.paintedAxis();
        const unclamped = (hz: number) => axis.logFrequency ? (hz > 0 ? frequencyFraction(hz, axis) : 0) : hz / (axis.frequencyMax || 1);
        const fraction = (hz: number) => Math.max(0, Math.min(1, unclamped(hz)));
        const start = minHz === null ? 0 : fraction(minHz);
        const end = maxHz === null ? 1 : fraction(maxHz);
        if (start >= end) {
            return false;
        }
        this.freqStart = start;
        this.freqEnd = end;
        return true;
    }
}
