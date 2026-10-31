import type { SpectrogramDisplaySettings, SpectrogramSettings } from '../../shared/analysis/analysisTypes';

function defaultSpectrogramSettings(): SpectrogramSettings {
    return { auto: true, stft: { nFft: 1024, overlapPercent: 75, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } };
}

function numberOrNull(value: number | null): number | null {
    return value == null ? null : Number(value);
}

/**
 * The spectrogram's STFT and display settings, as the ⚙ popover and the axis range popovers change them, and
 * whether a re-analysis they asked for is still running.
 */
export class SpectrogramSettingsStore {
    private current: SpectrogramSettings;
    private reanalyzing = false;

    constructor(initial: SpectrogramSettings | null | undefined) {
        this.current = initial || defaultSpectrogramSettings();
    }

    get settings(): SpectrogramSettings { return this.current; }
    get display(): SpectrogramDisplaySettings { return this.current.display; }
    get reanalyzeBusy(): boolean { return this.reanalyzing; }

    /** What the host's spectrum data depends on (not the display range): a cached spectrum is current while it matches. */
    get dataSignature(): string {
        return JSON.stringify({ auto: this.current.auto, stft: this.current.stft });
    }

    /** The display range as set; the ⚙ popover has no lower frequency, so leaving it out keeps the one set on the axis. */
    setDisplay(display: SpectrogramDisplaySettings): void {
        this.current.display = {
            dbMin: numberOrNull(display.dbMin),
            dbMax: numberOrNull(display.dbMax),
            maxFrequencyHz: numberOrNull(display.maxFrequencyHz),
            minFrequencyHz: display.minFrequencyHz !== undefined ? numberOrNull(display.minFrequencyHz) : numberOrNull(this.current.display.minFrequencyHz ?? null),
        };
    }

    reset(): void {
        this.current = defaultSpectrogramSettings();
    }

    /** New STFT settings from the ⚙ popover; the lower frequency set on the axis survives them. */
    applyStft(settings: SpectrogramSettings): void {
        this.current = { ...settings, display: { ...settings.display, minFrequencyHz: this.current.display.minFrequencyHz ?? null } };
    }

    setReanalyzeBusy(busy: boolean): void {
        this.reanalyzing = busy;
    }
}
