import { frequencyFraction, type FrequencyScale } from '../draw/canvasDrawers';
import { frequencyWindowHz, rightAxisLeftRange, spectrumDbRangeAfterZoom, zoomSpectrumRange, type RightAxisFollow, type SpectrumBoxZoom, type SpectrumViewState } from './spectrumRuntime';
import { exactFieldText } from '../plot/plotText';

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
    /** The level identity (levelKeyOf) the left axis was last drawn in; a dB zoom is in its dB. */
    private levelReference: string | null = null;

    state(): SpectrumViewState {
        return { freqStart: this.freqStart, freqEnd: this.freqEnd, dbMin: this.dbMin, dbMax: this.dbMax };
    }

    /**
     * Called with the left axis' level identity (its key, never its name's text) before each paint. When another
     * identity takes the left axis
     * (a track hidden, shown or moved), a dB zoom kept in the old reference's dB no longer applies, so it is cleared.
     */
    followLevelReference(key: string): void {
        if (this.levelReference !== null && key !== this.levelReference) {
            this.setDbRange(null, null);
        }
        this.levelReference = key;
    }

    recordPaint(painted: SpectrumPaintedRange): void {
        this.painted = { maxFrequencyHz: painted.maxFrequencyHz, logMinFrequencyHz: painted.logMinFrequencyHz, dbMin: painted.dbMin, dbMax: painted.dbMax };
    }

    /** Whether the frequency axis shows less than the whole spectrum: its slices are then asked for at full resolution (R3). */
    frequencyZoomed(): boolean {
        return this.freqStart > 0 || this.freqEnd < 1;
    }

    hasData(): boolean {
        return !!this.painted && this.painted.maxFrequencyHz > 0;
    }

    /** The Hz window of the last linear paint, for views that share its frequency zoom. */
    visibleFrequencyHz(): FrequencyScale | null {
        const painted = this.painted;
        if (!painted || painted.logMinFrequencyHz !== undefined || !(painted.maxFrequencyHz > 0)) {
            return null;
        }
        return frequencyWindowHz({ start: this.freqStart, end: this.freqEnd }, painted.maxFrequencyHz);
    }

    /** The last linear paint's frequency axis (0 to its top) and the part of it on screen; null on a log axis or before a paint. */
    linearFrequencyAxis(): { maxFrequencyHz: number; window: { start: number; end: number } } | null {
        const painted = this.painted;
        if (!painted || painted.logMinFrequencyHz !== undefined || !(painted.maxFrequencyHz > 0)) {
            return null;
        }
        return { maxFrequencyHz: painted.maxFrequencyHz, window: { start: this.freqStart, end: this.freqEnd } };
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

    /**
     * The dB ends typed in the range popover: an end applied as shown (the same number as its field, `value === shown`)
     * keeps its setting (following the data, or its zoom), so a range applied unchanged is the range it was.
     */
    applyDbFields(min: number | null, max: number | null): void {
        const painted = this.paintedDb();
        const kept = (value: number | null, shown: number | undefined, setting: number | null): number | null => (value !== null && value === shown ? setting : value);
        this.setDbRange(kept(min, this.dbMin ?? painted?.min, this.dbMin), kept(max, this.dbMax ?? painted?.max, this.dbMax));
    }

    /**
     * The right-hand level axis's ends typed (`shown`: its ends as painted, which its fields wrote): the left axis's
     * range that shows them there (rightAxisLeftRange), an end applied as shown keeping the left one's setting.
     */
    applyRightDbFields(shown: { min: number; max: number }, follow: RightAxisFollow, min: number, max: number): void {
        const left = rightAxisLeftRange(follow, { min, max });
        this.setDbRange(min === shown.min ? this.dbMin : left.min, max === shown.max ? this.dbMax : left.max);
    }

    dbRangeFields(): { min: string; max: string } {
        const painted = this.paintedDb();
        const field = (override: number | null, paintedEdge: number | undefined) =>
            // The end as painted, exactly (R9): a typed or zoomed end as it is, an automatic one as the axis drew it.
            override != null ? exactFieldText(override) : (paintedEdge != null ? exactFieldText(paintedEdge) : '');
        return { min: field(this.dbMin, painted?.min), max: field(this.dbMax, painted?.max) };
    }

    private paintedAxis(): FrequencyScale {
        const painted = this.painted;
        if (painted && painted.logMinFrequencyHz !== undefined) {
            return { frequencyMin: painted.logMinFrequencyHz, frequencyMax: painted.maxFrequencyHz, logFrequency: true };
        }
        return { frequencyMin: 0, frequencyMax: (painted && painted.maxFrequencyHz) || 0 };
    }

    /** The frequencies the axis was last painted between (spectrumRuntime.frequencyWindowHz, R9): what its popover writes. */
    shownFrequencyHz(): { min: number; max: number } {
        const painted = this.painted;
        const shown = frequencyWindowHz({ start: this.freqStart, end: this.freqEnd }, painted?.maxFrequencyHz ?? 0, painted?.logMinFrequencyHz);
        return { min: shown.frequencyMin, max: shown.frequencyMax };
    }

    frequencyRangeFieldsHz(): { min: string; max: string } {
        // The ends as painted, exactly (R9): a zoomed end is made at the field's numbers, so it is short.
        const shown = this.shownFrequencyHz();
        return { min: exactFieldText(shown.min), max: exactFieldText(shown.max) };
    }

    /**
     * Applies a Hz range (`null` = open edge). Returns false and keeps the view when min >= max. An end applied as
     * shown (the same number, `value === shown`) keeps its place, so a range applied unchanged is the range it was.
     */
    setFrequencyRangeHz(minHz: number | null, maxHz: number | null): boolean {
        const axis = this.paintedAxis();
        const unclamped = (hz: number) => axis.logFrequency ? (hz > 0 ? frequencyFraction(hz, axis) : 0) : hz / (axis.frequencyMax || 1);
        const fraction = (hz: number) => Math.max(0, Math.min(1, unclamped(hz)));
        const shown = this.shownFrequencyHz();
        const start = minHz === null ? 0 : minHz === shown.min ? this.freqStart : fraction(minHz);
        const end = maxHz === null ? 1 : maxHz === shown.max ? this.freqEnd : fraction(maxHz);
        if (start >= end) {
            return false;
        }
        this.freqStart = start;
        this.freqEnd = end;
        return true;
    }
}
