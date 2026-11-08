/**
 * When a zoomed spectrogram lane asks the host for its time window again (R3). The whole file's spectrogram comes
 * with at most a fixed number of columns (the host averages frames down to it), so a lane zoomed in far enough shows
 * fewer columns than its pixels can hold: it then asks for the window it shows, whose frames come back at full
 * resolution up to the same column limit.
 */

/** A spectrogram's time window, as fractions of its file. */
export interface SpectrogramWindow {
    startNorm: number;
    endNorm: number;
}

export interface SpectrogramZoomSource {
    /** Columns of the whole file's spectrogram: the host's column limit when its frames were averaged down. */
    columns: number;
    /**
     * Frames a window of the whole file can bring: the file's STFT frames (duration × sample rate / hop) with set
     * settings, or its samples with the automatic ones, where the host gives each window a hop of its own.
     */
    frames: number;
}

/** One column per this many pixels is enough, as a line is drawn with a bucket per two pixels (R2). */
const PIXELS_PER_COLUMN = 2;
/** Column counts are rounded by the host (one frame beside each end): a window this close to the target still serves. */
const COLUMN_SLACK = 0.95;

function visible(view: SpectrogramWindow): SpectrogramWindow | null {
    const startNorm = Math.max(0, view.startNorm), endNorm = Math.min(1, view.endNorm);
    return endNorm > startNorm ? { startNorm, endNorm } : null;
}

/** Columns the lane wants between the view's ends: one per two pixels, but never more than there are frames or than a window can bring. */
function wantedColumns(source: SpectrogramZoomSource, shown: SpectrogramWindow, widthPx: number): number {
    return Math.min(widthPx / PIXELS_PER_COLUMN, source.frames * (shown.endNorm - shown.startNorm), source.columns);
}

/** Columns a spectrogram of `window` has between the view's ends. */
function columnsShown(source: SpectrogramZoomSource, window: SpectrogramWindow, shown: SpectrogramWindow): number {
    const span = window.endNorm - window.startNorm;
    if (!(span > 0)) return 0;
    return Math.min(source.columns, source.frames * span) * (shown.endNorm - shown.startNorm) / span;
}

/** Whether a spectrogram of `window` covers the view and has the columns it wants. */
export function spectrogramWindowServes(source: SpectrogramZoomSource, window: SpectrogramWindow, view: SpectrogramWindow, widthPx: number): boolean {
    const shown = visible(view);
    if (!shown) return true;
    if (window.startNorm > shown.startNorm + 1e-9 || window.endNorm < shown.endNorm - 1e-9) return false;
    return columnsShown(source, window, shown) >= COLUMN_SLACK * wantedColumns(source, shown, widthPx);
}

/**
 * The window to ask for, or null while the whole file's spectrogram serves the view. The window reaches past the
 * view (up to half its span each side) so a short pan stays covered, but no further than keeps the columns it wants.
 */
export function spectrogramZoomWindow(source: SpectrogramZoomSource, view: SpectrogramWindow, widthPx: number): SpectrogramWindow | null {
    const shown = visible(view);
    if (!shown || !(source.columns > 0) || !(source.frames > 0)) return null;
    if (spectrogramWindowServes(source, { startNorm: 0, endNorm: 1 }, shown, widthPx)) return null;
    const viewSpan = shown.endNorm - shown.startNorm;
    const span = Math.min(1, 2 * viewSpan, source.columns * viewSpan / wantedColumns(source, shown, widthPx));
    const margin = (span - viewSpan) / 2;
    const startNorm = Math.max(0, Math.min(1 - span, shown.startNorm - margin));
    return { startNorm, endNorm: Math.min(1, startNorm + span) };
}

/**
 * Up the frequency axis, as along time: the whole file's spectrogram comes with at most a fixed number of rows (the
 * host averages FFT bins down to it), so a lane zoomed to a narrow band shows fewer rows than its pixels can hold.
 * It then asks for the band it shows, whose own FFT bins come back up to the same row limit.
 */
export interface SpectrogramBand {
    lowHz: number;
    highHz: number;
}

export interface SpectrogramBandSource {
    /** Rows of the whole file's spectrogram: the host's row limit when its bins were averaged down. */
    rows: number;
    /** The FFT's bins from 0 Hz to Nyquist (window size / 2 + 1). */
    bins: number;
    nyquistHz: number;
}

const PIXELS_PER_ROW = 2;

function shownBand(source: SpectrogramBandSource, view: SpectrogramBand): SpectrogramBand | null {
    const lowHz = Math.max(0, view.lowHz), highHz = Math.min(source.nyquistHz, view.highHz);
    return highHz > lowHz ? { lowHz, highHz } : null;
}

/** Rows the lane wants across the band shown: one per two pixels, but never more than there are bins or than a band can bring. */
function wantedRows(source: SpectrogramBandSource, shown: SpectrogramBand, heightPx: number): number {
    const binsShown = (source.bins - 1) * (shown.highHz - shown.lowHz) / source.nyquistHz;
    return Math.min(heightPx / PIXELS_PER_ROW, binsShown, source.rows);
}

/** Rows a spectrogram of `band` (null: every frequency) has across the band shown. */
function rowsShown(source: SpectrogramBandSource, band: SpectrogramBand | null, shown: SpectrogramBand): number {
    const whole = band ?? { lowHz: 0, highHz: source.nyquistHz };
    const span = whole.highHz - whole.lowHz;
    if (!(span > 0)) return 0;
    return Math.min(source.rows, (source.bins - 1) * span / source.nyquistHz) * (shown.highHz - shown.lowHz) / span;
}

/** Whether a spectrogram of `band` (null: every frequency) covers the band shown and has the rows it wants. */
export function spectrogramBandServes(source: SpectrogramBandSource, band: SpectrogramBand | null, view: SpectrogramBand, heightPx: number): boolean {
    const shown = shownBand(source, view);
    if (!shown || !(source.rows > 0) || !(source.bins > 1) || !(source.nyquistHz > 0)) return true;
    if (band && (band.lowHz > shown.lowHz + 1e-6 || band.highHz < shown.highHz - 1e-6)) return false;
    return rowsShown(source, band, shown) >= COLUMN_SLACK * wantedRows(source, shown, heightPx);
}

/**
 * The band to ask for, or null while the whole range's rows serve it. The band reaches past the one shown (up to half
 * its span each side) so a short pan up or down stays covered, but no further than keeps the rows it wants.
 */
export function spectrogramZoomBand(source: SpectrogramBandSource, view: SpectrogramBand, heightPx: number): SpectrogramBand | null {
    const shown = shownBand(source, view);
    if (!shown || spectrogramBandServes(source, null, shown, heightPx)) return null;
    const viewSpan = shown.highHz - shown.lowHz;
    const span = Math.min(source.nyquistHz, 2 * viewSpan, source.rows * viewSpan / wantedRows(source, shown, heightPx));
    const lowHz = Math.max(0, Math.min(source.nyquistHz - span, shown.lowHz - (span - viewSpan) / 2));
    return { lowHz, highHz: Math.min(source.nyquistHz, lowHz + span) };
}

/** The frequencies a spectrogram's first and last rows sit at: its band's, else 0 Hz to its Nyquist frequency. */
export function spectrogramRowSpan(spec: { maxFrequencyHz: number; bandLowHz?: number; bandHighHz?: number }): SpectrogramBand {
    return spec.bandLowHz !== undefined && spec.bandHighHz !== undefined && spec.bandHighHz > spec.bandLowHz
        ? { lowHz: spec.bandLowHz, highHz: spec.bandHighHz } : { lowHz: 0, highHz: spec.maxFrequencyHz };
}
