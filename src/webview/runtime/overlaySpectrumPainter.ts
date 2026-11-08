import { binFrequencyHz, drawSpectrumSelectionBox } from '../draw/canvasDrawers';
import { HOVER_PICK_RADIUS_PX, paintHoverMarks } from './plotHover';
import type { SpectrumHoverTarget } from './spectrumHover';
import { paintOverlay, strokeStageLine, type StageLayer, type StagePlot } from './stagePanes';
import { minMaxLine } from './comparePanes';
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
import type { DragPoint, SpectrumSeries } from './types';

/** A box being dragged on the cursor spectrum, from where the press was to where the pointer is (0–1 of the plot). */
export interface SpectrumBoxSpan {
    anchor: DragPoint;
    current: DragPoint;
}

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
    /** The frequency of the point the cursor reads; null when no line is read. */
    hoverFrequencyHz?: number | null;
    /** Each level axis with the colours of the lines read on it, left first; one entry when the references agree. */
    levelAxes: Array<{ title: string; reference: string; colors: string[]; lines: Array<{ color: string; label: string }> }>;
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
 * FFT bins past the slice's top frequency (a cut for display) are left out.
 */
export function spectrumLayer(series: SpectrumSeries, cutoffHz: number, visible?: { frequencyMin: number; frequencyMax: number; buckets: number }): StageLayer {
    const { slice } = series;
    const bands = !!slice.bandCentersHz?.length;
    let xs: number[] = [], values: number[] = [];
    for (let index = 0; index < slice.frequencyBins && index < slice.values.length; index++) {
        const hz = binFrequencyHz(slice, index);
        // Bands are kept whole: their spacing is each band's width, and the plot clips them at the axis' end.
        if (!bands && hz > cutoffHz) break;
        xs.push(hz);
        values.push(slice.values[index]);
    }
    // A slice at full resolution (asked for while zoomed in, R3) is thinned here, only to be drawn, by the rule every
    // spectrum is thinned by (R2: each bucket's lowest and highest bin), between the frequencies on screen and a bin
    // past each, so the line reaches the plot's edges.
    if (!bands && visible && !slice.frequenciesHz && xs.length > 2 * visible.buckets && xs.length > 1) {
        const binHz = xs[1] - xs[0];
        const line = minMaxLine(xs, values, visible.buckets, [Math.max(binHz, visible.frequencyMin - binHz), visible.frequencyMax + binHz]);
        const dc = visible.frequencyMin <= 0 && xs[0] === 0 ? 1 : 0;
        xs = [...xs.slice(0, dc), ...line.xs];
        values = [...values.slice(0, dc), ...line.values];
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
    /** Names a level axis from its reference and the lines read on it (the UI's words, calibrated or not); the slice's own label otherwise. */
    levelTitle?: (reference: string, series: readonly SpectrumSeries[]) => string,
): OverlaySpectrumPaint {
    const { maxFrequencyHz, logMinFrequencyHz } = spectrumSeriesRange(slices);
    const axes = overlayLevelAxes(slices, view).map(axis => (levelTitle && axis.series.length ? { ...axis, title: levelTitle(axis.reference, axis.series) } : axis));
    setOverlaySecondaryLevelAxis(axes.length > 1);
    const pad = OVERLAY_SPECTRUM_PAD;
    const vis = axes[0].visible;
    const levelAxes = axes.map(axis => ({
        title: axis.title, reference: axis.reference, colors: [...new Set(axis.series.map(s => s.color))],
        lines: axis.series.filter((s, i, all) => all.findIndex(o => o.label === s.label && o.color === s.color) === i).map(s => ({ color: s.color, label: s.label })),
    }));
    const result: OverlaySpectrumPaint = { maxFrequencyHz, logMinFrequencyHz, dbMin: vis.dbMin, dbMax: vis.dbMax, painted: false, readout: null, levelAxes };
    const empty = vis.frequencyMax - vis.frequencyMin <= 0;
    // Each series' layer, so the hover draws the line it read thicker on the same axes.
    const layerOf = new Map<SpectrumSeries, StageLayer>();
    // A line read on the right-hand axis is dashed, as its swatch in the legend: lines of one colour (grey, without a role) are told apart.
    const layersOf = (series: readonly SpectrumSeries[], visible: SpectrumVisibleWindow, dash?: readonly number[]): StageLayer[] => (visible.dbMax - visible.dbMin > 0 && !empty ? series : []).map(s => {
        const layer = { ...spectrumLayer(s, maxFrequencyHz, { frequencyMin: visible.frequencyMin, frequencyMax: visible.frequencyMax, buckets: lineBuckets }), ...(dash ? { dash } : {}) };
        layerOf.set(s, layer);
        return layer;
    });
    const [primary, secondary] = axes;
    // About two pixels a bucket across the plot, as every line is thinned (R2).
    const lineBuckets = Math.max(64, Math.round((W - pad.left - pad.right) / 2));
    const plot = paintOverlay(canvas, { layers: layersOf(primary.series, vis) }, { min: vis.dbMin, max: vis.dbMax }, { x: frequencyTitle, y: primary.title }, {
        size: { width: W, height: H },
        margins: { ...pad },
        axisView: frequencyAxis(empty ? { ...vis, frequencyMax: vis.frequencyMin + 1 } : vis),
        ...(secondary ? { secondary: { layers: layersOf(secondary.series, secondary.visible, SECONDARY_AXIS_DASH), range: { min: secondary.visible.dbMin, max: secondary.visible.dbMax }, title: secondary.title } } : {}),
    });
    // The pointer's marks and a dragged box go on the layer over the plot: the plot holds only what paintOverlay drew (R13).
    const ctx = overlaySpectrumMarks(canvas, W, H);
    if (empty) {
        return result;
    }
    const frameFor = (visible: typeof vis) => spectrumPlotFrame(W, H, pad, visible);
    const frame = frameFor(vis);
    let nearest: (SpectrumSnapHit<SpectrumSeries> & { axisIndex: number; frame: typeof frame }) | null = null;
    if (hover.norm !== null && hover.target === 'overlay') {
        // With no pointer height (the cursor follows the pair plot) no line is nearest, so only the frequency line shows.
        // A pointer reads the point nearest it within a few pixels (R7); an arrow key's step reads the bin stepped to.
        const radius = hover.stepped ? 0 : HOVER_PICK_RADIUS_PX * (W / (canvas.clientWidth || W));
        nearest = hover.yFrac !== null ? nearestOverlaySnap(axes, frameFor, hover.norm, hover.yFrac * H, !hover.stepped, radius) : null;
        const hit = nearest;
        const full = { left: frame.padLeft, top: frame.padTop, width: frame.plotWidth, height: frame.plotHeight };
        // With two level axes the level guide runs only to the axis the line is read on, so it is not read on the other.
        const guide = hit && axes.length > 1
            ? (hit.axisIndex === 0 ? { ...full, width: hit.snap.x - full.left } : { ...full, left: hit.snap.x, width: full.left + full.width - hit.snap.x })
            : full;
        const hitLayer = hit ? layerOf.get(hit.s) : undefined;
        const hitPlot: StagePlot | null | undefined = hit && hit.axisIndex > 0 ? plot?.secondary : plot;
        if (ctx) paintHoverMarks(
            ctx,
            guide,
            hit ? hit.snap.x : frame.padLeft + hover.norm * frame.plotWidth,
            // A level past the axis is drawn along its edge: the level guide is drawn there too, not in the margin.
            hit ? Math.max(full.top, Math.min(full.top + full.height, hit.snapY)) : null,
            hit ? hit.s.color : '',
            hitLayer && hitPlot ? (context, width) => strokeStageLine(context as CanvasRenderingContext2D, hitPlot, hitLayer, width) : undefined,
        );
    }
    if (box !== null && ctx) {
        drawSpectrumSelectionBox(ctx, frame, box.anchor, box.current);
    }
    result.painted = true;
    result.readout = overlayReadout(hover, nearest, axes.map(axis => axis.reference));
    // The frequency the cursor is drawn at, for the pair plot to follow: the point read, else the pointer's.
    result.hoverFrequencyHz = nearest ? (nearest as SpectrumSnapHit<SpectrumSeries>).snap.freqHz : null;
    return result;
}

const MARKS_CLASS = 'spectrum-overlay-marks';

/**
 * The layer laid over the cursor spectrum for its pointer's marks and a box being dragged, cleared, at the plot's size
 * in pixels and its place and size on screen; made once beside the plot. Null with no place for it.
 */
export function overlaySpectrumMarks(canvas: HTMLCanvasElement, W: number, H: number): CanvasRenderingContext2D | null {
    const wrap = canvas.parentElement;
    if (!wrap) return null;
    let marks = wrap.querySelector<HTMLCanvasElement>(`:scope > canvas.${MARKS_CLASS}`);
    if (!marks) {
        marks = canvas.ownerDocument.createElement('canvas');
        marks.className = MARKS_CLASS;
        marks.setAttribute('aria-hidden', 'true');
        wrap.append(marks);
    }
    Object.assign(marks.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, width: `${canvas.clientWidth}px`, height: `${canvas.clientHeight}px` });
    if (marks.width !== W) marks.width = W;
    if (marks.height !== H) marks.height = H;
    const context = marks.getContext('2d');
    context?.clearRect(0, 0, W, H);
    return context;
}

/** The dash (px) of a line read on the right-hand level axis, and of its swatches in the legend. */
export const SECONDARY_AXIS_DASH: readonly number[] = [5, 3];

/** The overlay draws at most this many level axes: a second level reference gets the right-hand one. */
export const OVERLAY_LEVEL_AXES = 2;

/**
 * The panel's legend: the level's name, then each line's colour and name, so overlaid lines are named without a hover
 * ("Amplitude, uncalibrated [dBFS] ■ A ■ B"). With two level axes the lines are grouped by the side they are read on
 * ("◀ Amplitude [dB SPL re 20 µPa] ■ A   Amplitude, uncalibrated [dB re 1 V] ┄ C ▶"), the right-hand side's swatches dashed as its lines are.
 */
export function renderSpectrumAxisLegend(el: HTMLElement | null, levelAxes: OverlaySpectrumPaint['levelAxes']): void {
    if (!el) {
        return;
    }
    const shown = levelAxes.slice(0, OVERLAY_LEVEL_AXES).filter(axis => axis.lines.length > 0);
    // The overlay repaints on every cursor move; the legend is rebuilt only when what it says changes (calibrated or not, too).
    const key = JSON.stringify(shown.map(axis => [axis.title, axis.reference, axis.lines.map(line => [line.color, line.label])]));
    if (el.getAttribute('data-legend-key') === key) {
        return;
    }
    el.setAttribute('data-legend-key', key);
    el.replaceChildren();
    el.hidden = shown.length === 0;
    const two = shown.length > 1;
    const doc = el.ownerDocument;
    shown.forEach((axis, index) => {
        const item = doc.createElement('span');
        item.className = 'spectrum-axis-legend-item';
        item.setAttribute('data-axis', index === 0 ? 'left' : 'right');
        const text = (className: string, value: string) => { const m = doc.createElement('span'); m.className = className; m.textContent = value; return m; };
        if (two && index === 0) { item.appendChild(text('spectrum-axis-legend-mark', '◀')); }
        // The level's whole name first (a short panel's axis has room for its unit alone), then its lines: many lines are cut, not the name.
        item.appendChild(text('spectrum-axis-legend-reference', axis.title || axis.reference));
        axis.lines.forEach(line => {
            const swatch = doc.createElement('span');
            swatch.className = 'spectrum-axis-legend-swatch';
            // The right-hand axis' lines are dashed: so are their swatches.
            swatch.style.background = index === 0 ? line.color : `repeating-linear-gradient(90deg, ${line.color} 0 ${SECONDARY_AXIS_DASH[0]}px, transparent ${SECONDARY_AXIS_DASH[0]}px ${SECONDARY_AXIS_DASH[0] + SECONDARY_AXIS_DASH[1]}px)`;
            item.appendChild(swatch);
            // A long file name is cut, not the channel after it: two channels of one recording stay apart.
            const cut = line.label.indexOf(' / ');
            const label = text('spectrum-axis-legend-label', cut < 0 ? line.label : '');
            if (cut >= 0) {
                label.appendChild(text('spectrum-axis-legend-file', line.label.slice(0, cut)));
                label.appendChild(text('spectrum-axis-legend-channel', line.label.slice(cut)));
            }
            item.appendChild(label);
        });
        if (two && index > 0) { item.appendChild(text('spectrum-axis-legend-mark', SECONDARY_AXIS_MARK)); }
        // Named in the footer, as every hint is: a long name is cut short on the line.
        const hint = [axis.title, ...axis.lines.map(line => line.label)].join(' · ');
        item.setAttribute('data-hint', hint);
        item.setAttribute('aria-description', hint);
        el.appendChild(item);
    });
}
