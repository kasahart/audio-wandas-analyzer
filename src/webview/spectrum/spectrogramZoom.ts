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
    /** STFT frames in the whole file (duration × sample rate / hop). */
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
