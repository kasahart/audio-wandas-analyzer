import { drawSpectrumAxes, drawSpectrumCrosshair, drawSpectrumLine, type CanvasDrawCtx, type DrawTheme } from '../draw/canvasDrawers';
import {
    sliceLogMinFrequencyHz,
    spectrumBinAtHover,
    spectrumPlotFrame,
    spectrumVisibleWindow,
    TRACK_SPECTRUM_PAD,
    trackSpectrumReadoutText,
    type SpectrumViewState,
} from './spectrumRuntime';
import type { SpectrumSlice } from './types';

export interface TrackSpectrumSeries {
    slice: SpectrumSlice;
    color: string;
    label: string;
}

export function paintTrackSpectrum(
    ctx: CanvasDrawCtx,
    W: number,
    H: number,
    series: TrackSpectrumSeries,
    view: SpectrumViewState,
    hoverNorm: number | null,
    theme: DrawTheme,
): { text: string; color: string } | null {
    const { slice, color } = series;
    ctx.clearRect(0, 0, W, H);
    const pad = TRACK_SPECTRUM_PAD;
    const vis = spectrumVisibleWindow(slice.maxFrequencyHz, slice.minDb, slice.maxDb, view, sliceLogMinFrequencyHz(slice));
    drawSpectrumAxes(ctx, W, H, slice, pad.left, pad.right, pad.top, pad.bottom, vis.frequencyMin, vis.frequencyMax, vis.dbMin, vis.dbMax, theme, vis.logFrequency);
    drawSpectrumLine(ctx, W, H, slice, color, { padL: pad.left, padR: pad.right, padT: pad.top, padB: pad.bottom }, vis.frequencyMin, vis.frequencyMax, vis.dbMin, vis.dbMax, vis.logFrequency);
    if (hoverNorm === null) {
        return null;
    }
    const frame = spectrumPlotFrame(W, H, pad, vis);
    const snap = spectrumBinAtHover(slice, hoverNorm, frame);
    if (!snap) {
        return null;
    }
    drawSpectrumCrosshair(ctx, frame, snap.x, snap.dbVal !== undefined ? snap.y : null, 'rgba(255,255,255,0.75)', color);
    return snap.dbVal !== undefined
        ? { text: trackSpectrumReadoutText(series.label, slice, snap.freqHz, snap.dbVal), color }
        : null;
}
