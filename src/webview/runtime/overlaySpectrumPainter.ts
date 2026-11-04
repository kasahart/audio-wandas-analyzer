import { drawSpectrumAxes, drawSpectrumSecondaryLevelAxis, drawSpectrumSelectionBox, strokeSpectrumSeries, type CanvasDrawCtx, type DrawTheme } from '../draw/canvasDrawers';
import type { SpectrumBoxSpan } from './spectrumBoxDrag';
import { paintHoverMarks } from './plotHover';
import type { SpectrumHoverTarget } from './spectrumHover';
import {
    nearestOverlaySnap,
    OVERLAY_SPECTRUM_PAD,
    overlayLevelAxes,
    setOverlaySecondaryLevelAxis,
    spectrumPlotFrame,
    spectrumReadoutText,
    spectrumSeriesRange,
    type SpectrumSnapHit,
    type SpectrumViewState,
} from './spectrumRuntime';
import type { SpectrumSeries } from './types';

export interface OverlaySpectrumHover {
    norm: number | null;
    yFrac: number | null;
    target: SpectrumHoverTarget | null;
    stepped?: boolean;
}

export interface OverlaySpectrumPaint {
    maxFrequencyHz: number;
    logMinFrequencyHz?: number;
    dbMin: number;
    dbMax: number;
    /** False when the visible frequency window is empty and only the axes were drawn. */
    painted: boolean;
    /** null leaves the readout as is: nothing was drawn to read. */
    readout: { text: string; color: string } | null;
    /** Each level axis with the colours of the lines read on it, left first; one entry when the references agree. */
    levelAxes: Array<{ title: string; colors: string[] }>;
}

/** Marks the right-hand axis in the legend. */
export const SECONDARY_AXIS_MARK = '▶';

function overlayReadout(hover: OverlaySpectrumHover, nearest: (SpectrumSnapHit<SpectrumSeries> & { axisIndex: number }) | null, axisTitles: string[]): OverlaySpectrumPaint['readout'] {
    if (!nearest || hover.norm === null || hover.target !== 'overlay') {
        return { text: '', color: '' };
    }
    // With two level axes, "dB" alone could be either: the value names its reference ("-17.0 dB re 1 m/s^2").
    const level = axisTitles.length > 1 ? { unit: legendLevelText(axisTitles[nearest.axisIndex]) } : nearest.s.slice;
    return { text: spectrumReadoutText(nearest.s.label, { ...nearest.s.slice, ...level }, nearest.snap.freqHz, nearest.dbVal), color: nearest.s.color };
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
    const { maxFrequencyHz, logMinFrequencyHz } = spectrumSeriesRange(slices);
    const axes = overlayLevelAxes(slices, view);
    setOverlaySecondaryLevelAxis(axes.length > 1);
    const pad = OVERLAY_SPECTRUM_PAD;
    const vis = axes[0].visible;
    const commonSlice = axes[0].series[0].slice;
    const sharedAxis = {
        values: [],
        frequencyBins: 1,
        maxFrequencyHz,
        minDb: vis.dbMin,
        maxDb: vis.dbMax,
        unit: commonSlice.unit,
        axisLabel: commonSlice.axisLabel,
    };
    drawSpectrumAxes(ctx, W, H, sharedAxis, pad.left, pad.right, pad.top, pad.bottom, vis.frequencyMin, vis.frequencyMax, vis.dbMin, vis.dbMax, theme, vis.logFrequency, axes[0].title);
    const levelAxes = axes.map(axis => ({ title: axis.title, colors: [...new Set(axis.series.map(s => s.color))] }));
    const result: OverlaySpectrumPaint = { maxFrequencyHz, logMinFrequencyHz, dbMin: vis.dbMin, dbMax: vis.dbMax, painted: false, readout: null, levelAxes };
    if (vis.frequencyMax - vis.frequencyMin <= 0) {
        return result;
    }
    const frameFor = (visible: typeof vis) => spectrumPlotFrame(W, H, pad, visible);
    const frame = frameFor(vis);
    axes.forEach((axis, index) => {
        if (index > 0) {
            drawSpectrumSecondaryLevelAxis(ctx, W, frame, axis.visible.dbMin, axis.visible.dbMax, axis.title, theme);
        }
        strokeSpectrumSeries(ctx, frameFor(axis.visible), axis.visible.dbMax - axis.visible.dbMin > 0 ? axis.series : [], 1.4, maxFrequencyHz);
    });
    let nearest: (SpectrumSnapHit<SpectrumSeries> & { axisIndex: number; frame: typeof frame }) | null = null;
    if (hover.norm !== null && hover.target === 'overlay') {
        // With no pointer height (the cursor follows the pair plot) no line is nearest, so only the frequency line shows.
        nearest = hover.yFrac !== null ? nearestOverlaySnap(axes, frameFor, hover.norm, hover.yFrac * H, !hover.stepped) : null;
        const hit = nearest;
        const full = { left: frame.padLeft, top: frame.padTop, width: frame.plotWidth, height: frame.plotHeight };
        // With two level axes the level guide runs only to the axis the line is read on, so it is not read on the other.
        const guide = hit && axes.length > 1
            ? (hit.axisIndex === 0 ? { ...full, width: hit.snap.x - full.left } : { ...full, left: hit.snap.x, width: full.left + full.width - hit.snap.x })
            : full;
        paintHoverMarks(
            ctx,
            guide,
            hit ? hit.snap.x : frame.padLeft + hover.norm * frame.plotWidth,
            hit ? hit.snapY : null,
            hit ? hit.s.color : '',
            hit ? (context, width) => strokeSpectrumSeries(context, hit.frame, [hit.s], width, maxFrequencyHz) : undefined,
        );
    }
    if (box !== null) {
        drawSpectrumSelectionBox(ctx, frame, box.anchor, box.current);
    }
    result.painted = true;
    result.readout = overlayReadout(hover, nearest, axes.map(axis => axis.title));
    return result;
}

/** The overlay draws at most this many level axes: a second level reference gets the right-hand one. */
export const OVERLAY_LEVEL_AXES = 2;

/** "Spectrum amplitude level [dB SPL re 20 µPa]" reads "dB SPL re 20 µPa" in the legend. */
function legendLevelText(title: string): string {
    const bracket = /\[([^\]]+)\]\s*$/.exec(title);
    return bracket ? bracket[1] : title;
}

/**
 * Only with two level axes: which lines are read on which side, as the lines' colours beside each axis' level
 * ("◀ ■ ■ dB SPL re 20 µPa   ■ dB re 1 V ▶"). With one axis the legend is empty and the panel reads as before.
 */
export function renderSpectrumAxisLegend(el: HTMLElement | null, levelAxes: OverlaySpectrumPaint['levelAxes']): void {
    if (!el) {
        return;
    }
    el.replaceChildren();
    el.hidden = levelAxes.length < 2;
    if (levelAxes.length < 2) {
        return;
    }
    const doc = el.ownerDocument;
    levelAxes.slice(0, OVERLAY_LEVEL_AXES).forEach((axis, index) => {
        const item = doc.createElement('span');
        item.className = 'spectrum-axis-legend-item';
        item.setAttribute('data-axis', index === 0 ? 'left' : 'right');
        const mark = (text: string) => { const m = doc.createElement('span'); m.className = 'spectrum-axis-legend-mark'; m.textContent = text; return m; };
        if (index === 0) { item.appendChild(mark('◀')); }
        axis.colors.forEach(color => {
            const swatch = doc.createElement('span');
            swatch.className = 'spectrum-axis-legend-swatch';
            swatch.style.background = color;
            item.appendChild(swatch);
        });
        const label = doc.createElement('span');
        label.textContent = legendLevelText(axis.title);
        item.appendChild(label);
        if (index > 0) { item.appendChild(mark(SECONDARY_AXIS_MARK)); }
        item.title = axis.title;
        el.appendChild(item);
    });
}
