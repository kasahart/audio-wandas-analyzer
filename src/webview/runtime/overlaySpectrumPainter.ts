import { drawSpectrumAxes, drawSpectrumCrosshair, drawSpectrumSelectionBox, strokeSpectrumSeries, type CanvasDrawCtx, type DrawTheme } from '../draw/canvasDrawers';
import type { SpectrumBoxSpan } from './spectrumBoxDrag';
import type { SpectrumHoverTarget } from './spectrumHover';
import {
    nearestSpectrumSnap,
    OVERLAY_SPECTRUM_PAD,
    spectrumPlotFrame,
    spectrumReadoutText,
    spectrumSeriesRange,
    spectrumVisibleWindow,
    type SpectrumSnapHit,
    type SpectrumViewState,
} from './spectrumRuntime';
import type { SpectrumSeries } from './types';

export interface OverlaySpectrumHover {
    norm: number | null;
    yFrac: number | null;
    target: SpectrumHoverTarget | null;
}

export interface OverlaySpectrumPaint {
    maxFrequencyHz: number;
    logMinFrequencyHz?: number;
    dbMin: number;
    dbMax: number;
    /** False when the visible frequency window is empty and only the axes were drawn. */
    painted: boolean;
    /** null leaves the readout as is: the hover belongs to a per-track spectrum. */
    readout: { text: string; color: string } | null;
}

function overlayReadout(hover: OverlaySpectrumHover, nearest: SpectrumSnapHit<SpectrumSeries> | null): OverlaySpectrumPaint['readout'] {
    if (hover.norm !== null && hover.target === 'overlay') {
        return nearest
            ? { text: spectrumReadoutText(nearest.s.label, nearest.s.slice, nearest.snap.freqHz, nearest.dbVal), color: nearest.s.color }
            : { text: '', color: '' };
    }
    return hover.norm === null ? { text: '', color: '' } : null;
}

export function paintOverlaySpectrum(
    ctx: CanvasDrawCtx,
    W: number,
    H: number,
    slices: SpectrumSeries[],
    view: SpectrumViewState,
    hover: OverlaySpectrumHover,
    box: SpectrumBoxSpan | null,
    theme: DrawTheme,
): OverlaySpectrumPaint {
    ctx.clearRect(0, 0, W, H);
    const { minDb, maxDb, maxFrequencyHz, logMinFrequencyHz } = spectrumSeriesRange(slices);
    const pad = OVERLAY_SPECTRUM_PAD;
    const vis = spectrumVisibleWindow(maxFrequencyHz, minDb, maxDb, view, logMinFrequencyHz);
    const commonSlice = slices[0].slice;
    const sharedAxis = {
        values: [],
        frequencyBins: 1,
        maxFrequencyHz,
        minDb: vis.dbMin,
        maxDb: vis.dbMax,
        unit: commonSlice.unit,
        axisLabel: commonSlice.axisLabel,
    };
    drawSpectrumAxes(ctx, W, H, sharedAxis, pad.left, pad.right, pad.top, pad.bottom, vis.frequencyMin, vis.frequencyMax, vis.dbMin, vis.dbMax, theme, vis.logFrequency);
    const result: OverlaySpectrumPaint = { maxFrequencyHz, logMinFrequencyHz, dbMin: vis.dbMin, dbMax: vis.dbMax, painted: false, readout: null };
    if (vis.frequencyMax - vis.frequencyMin <= 0) {
        return result;
    }
    const frame = spectrumPlotFrame(W, H, pad, vis);
    strokeSpectrumSeries(ctx, frame, vis.dbMax - vis.dbMin > 0 ? slices : [], 1.4, maxFrequencyHz);
    let nearest: SpectrumSnapHit<SpectrumSeries> | null = null;
    if (hover.norm !== null && hover.target === 'overlay') {
        const mouseY = hover.yFrac !== null ? hover.yFrac * H : null;
        nearest = nearestSpectrumSnap(slices, hover.norm, mouseY, frame);
        if (nearest) {
            strokeSpectrumSeries(ctx, frame, [nearest.s], 2.5, maxFrequencyHz);
        }
        drawSpectrumCrosshair(
            ctx,
            frame,
            nearest ? nearest.snap.x : frame.padLeft + hover.norm * frame.plotWidth,
            nearest ? nearest.snapY : null,
            'rgba(255,255,255,0.7)',
            nearest ? nearest.s.color : '',
        );
    }
    if (box !== null) {
        drawSpectrumSelectionBox(ctx, frame, box.anchor, box.current);
    }
    result.painted = true;
    result.readout = overlayReadout(hover, nearest);
    return result;
}
