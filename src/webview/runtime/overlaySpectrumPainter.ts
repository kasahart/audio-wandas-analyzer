import { binFrequencyHz, drawSpectrumSelectionBox } from '../draw/canvasDrawers';
import type { SpectrumBoxSpan } from './spectrumBoxDrag';
import { paintHoverMarks } from './plotHover';
import type { SpectrumHoverTarget } from './spectrumHover';
import { paintOverlay, strokeStageLine, type StageLayer, type StagePlot } from './stagePanes';
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
    type SpectrumVisibleWindow,
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
    levelAxes: Array<{ title: string; reference: string; colors: string[] }>;
}

/** Marks the right-hand axis in the legend. */
export const SECONDARY_AXIS_MARK = '▶';

function overlayReadout(hover: OverlaySpectrumHover, nearest: (SpectrumSnapHit<SpectrumSeries> & { axisIndex: number }) | null, axisTitles: string[]): OverlaySpectrumPaint['readout'] {
    if (!nearest || hover.norm === null || hover.target !== 'overlay') {
        return { text: '', color: '' };
    }
    // With two level axes, "dB" alone could be either: the value names its reference ("-17.0 dB re 1 m/s^2").
    const level = axisTitles.length > 1 ? { unit: axisTitles[nearest.axisIndex] } : nearest.s.slice;
    return { text: spectrumReadoutText(nearest.s.label, { ...nearest.s.slice, ...level }, nearest.snap.freqHz, nearest.dbVal), color: nearest.s.color };
}

/**
 * A slice as the comparison draws a level spectrum (stage_view): a line over its bins, or octave bands as steps;
 * bins past the slice's top frequency (a cut for display) are left out.
 */
export function spectrumLayer(series: SpectrumSeries, cutoffHz: number): StageLayer {
    const { slice } = series;
    const bands = !!slice.bandCentersHz?.length;
    const xs: number[] = [], values: number[] = [];
    for (let index = 0; index < slice.frequencyBins && index < slice.values.length; index++) {
        const hz = binFrequencyHz(slice, index);
        if (hz > cutoffHz) break;
        xs.push(hz);
        values.push(slice.values[index]);
    }
    return {
        view: { frame: 'spectrum', kind: bands ? 'bar' : 'line', x: 'frequency', xScale: bands ? 'log' : 'linear', quantity: 'level', xs, values },
        color: series.color,
        width: bands ? 2 : 1.4,
        label: series.label,
    };
}

/** The visible frequency window as an axis the stage plot spans end to end. */
function frequencyAxis(visible: SpectrumVisibleWindow): { frame: string; kind: 'line'; xs: number[]; xLimits: number[]; xScale: 'log' | 'linear' } {
    const ends = [visible.frequencyMin, visible.frequencyMax];
    return { frame: 'spectrum', kind: 'line', xs: ends, xLimits: ends, xScale: visible.logFrequency ? 'log' : 'linear' };
}

export function paintOverlaySpectrum(
    canvas: HTMLCanvasElement,
    W: number,
    H: number,
    slices: SpectrumSeries[],
    view: SpectrumViewState,
    hover: OverlaySpectrumHover,
    box: SpectrumBoxSpan | null,
    frequencyTitle = '',
): OverlaySpectrumPaint {
    const { maxFrequencyHz, logMinFrequencyHz } = spectrumSeriesRange(slices);
    const axes = overlayLevelAxes(slices, view);
    setOverlaySecondaryLevelAxis(axes.length > 1);
    const pad = OVERLAY_SPECTRUM_PAD;
    const vis = axes[0].visible;
    const levelAxes = axes.map(axis => ({ title: axis.title, reference: axis.reference, colors: [...new Set(axis.series.map(s => s.color))] }));
    const result: OverlaySpectrumPaint = { maxFrequencyHz, logMinFrequencyHz, dbMin: vis.dbMin, dbMax: vis.dbMax, painted: false, readout: null, levelAxes };
    const empty = vis.frequencyMax - vis.frequencyMin <= 0;
    // Each series' layer, so the hover draws the line it read thicker on the same axes.
    const layerOf = new Map<SpectrumSeries, StageLayer>();
    const layersOf = (series: readonly SpectrumSeries[], visible: SpectrumVisibleWindow): StageLayer[] => (visible.dbMax - visible.dbMin > 0 && !empty ? series : []).map(s => {
        const layer = spectrumLayer(s, maxFrequencyHz);
        layerOf.set(s, layer);
        return layer;
    });
    const [primary, secondary] = axes;
    const plot = paintOverlay(canvas, { layers: layersOf(primary.series, vis) }, { min: vis.dbMin, max: vis.dbMax }, { x: frequencyTitle, y: primary.title }, {
        size: { width: W, height: H },
        margins: { ...pad },
        axisView: frequencyAxis(empty ? { ...vis, frequencyMax: vis.frequencyMin + 1 } : vis),
        ...(secondary ? { secondary: { layers: layersOf(secondary.series, secondary.visible), range: { min: secondary.visible.dbMin, max: secondary.visible.dbMax }, title: secondary.title } } : {}),
    });
    const ctx = canvas.getContext('2d');
    if (empty || !ctx) {
        return result;
    }
    const frameFor = (visible: typeof vis) => spectrumPlotFrame(W, H, pad, visible);
    const frame = frameFor(vis);
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
        const hitLayer = hit ? layerOf.get(hit.s) : undefined;
        const hitPlot: StagePlot | null | undefined = hit && hit.axisIndex > 0 ? plot?.secondary : plot;
        paintHoverMarks(
            ctx,
            guide,
            hit ? hit.snap.x : frame.padLeft + hover.norm * frame.plotWidth,
            hit ? hit.snapY : null,
            hit ? hit.s.color : '',
            hitLayer && hitPlot ? (context, width) => strokeStageLine(context as CanvasRenderingContext2D, hitPlot, hitLayer, width) : undefined,
        );
    }
    if (box !== null) {
        drawSpectrumSelectionBox(ctx, frame, box.anchor, box.current);
    }
    result.painted = true;
    result.readout = overlayReadout(hover, nearest, axes.map(axis => axis.reference));
    return result;
}

/** The overlay draws at most this many level axes: a second level reference gets the right-hand one. */
export const OVERLAY_LEVEL_AXES = 2;

/**
 * Only with two level axes: which lines are read on which side, as the lines' colours beside each axis' level
 * ("◀ ■ ■ dB SPL re 20 µPa   ■ dB re 1 V ▶"). With one axis the legend is empty and the panel reads as before.
 */
export function renderSpectrumAxisLegend(el: HTMLElement | null, levelAxes: OverlaySpectrumPaint['levelAxes']): void {
    if (!el) {
        return;
    }
    // The overlay repaints on every cursor move; the legend is rebuilt only when what it says changes.
    const key = levelAxes.length < 2 ? '' : JSON.stringify(levelAxes.map(axis => [axis.reference, axis.colors]));
    if (el.getAttribute('data-legend-key') === key) {
        return;
    }
    el.setAttribute('data-legend-key', key);
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
        label.textContent = axis.reference;
        item.appendChild(label);
        if (index > 0) { item.appendChild(mark(SECONDARY_AXIS_MARK)); }
        item.title = axis.title;
        el.appendChild(item);
    });
}
