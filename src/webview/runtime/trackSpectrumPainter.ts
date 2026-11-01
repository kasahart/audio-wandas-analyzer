import { drawSpectrumAxes, drawSpectrumCrosshair, drawSpectrumLine, type CanvasDrawCtx, type DrawTheme } from '../draw/canvasDrawers';
import {
    sliceLogMinFrequencyHz,
    spectrumBinAtHover,
    spectrumPlotFrame,
    spectrumVisibleWindow,
    spectrumReadoutText,
    TRACK_SPECTRUM_PAD,
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
    stepped = false,
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
    // A pointer reads its pixel's peak; an arrow-key step reads the bin it stepped to, so each press moves one bin.
    const snap = spectrumBinAtHover(slice, hoverNorm, frame, !stepped);
    if (!snap) {
        return null;
    }
    drawSpectrumCrosshair(ctx, frame, snap.x, snap.dbVal !== undefined ? snap.y : null, 'rgba(255,255,255,0.75)', color);
    return snap.dbVal !== undefined
        ? { text: spectrumReadoutText(series.label, slice, snap.freqHz, snap.dbVal), color }
        : null;
}
