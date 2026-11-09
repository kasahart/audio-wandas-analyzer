import { binFrequencyHz } from '../draw/canvasDrawers';
import { levelBinsOf, paintOverlay, type StageLayer, type StagePlot } from './stagePanes';
import type { StageView } from '../../shared/protocol/backendProtocol';
import { minMaxLine } from './comparePanes';
import { localLine, NO_FULL_DATA, type FullSource } from './fullRead';
import {
    OVERLAY_SPECTRUM_PAD,
    overlayLevelAxes,
    setOverlaySecondaryLevelAxis,
    spectrumReadoutValues,
    spectrumSeriesRange,
    type SpectrumViewState,
    type SpectrumVisibleWindow,
} from './spectrumRuntime';
import type { SpectrumSeries } from './types';

export interface OverlaySpectrumPaint {
    maxFrequencyHz: number;
    logMinFrequencyHz?: number;
    dbMin: number;
    dbMax: number;
    /** False when the visible frequency window is empty and only the axes were drawn. */
    painted: boolean;
    /** Where the plot component put the lines, for the pointer's marks and readout (plotHoverLayer.ts); null when none are drawn. */
    plot: StagePlot | null;
    /** Each level axis with the colours of the lines read on it, left first; one entry when the references agree. */
    levelAxes: Array<{ title: string; reference: string; colors: string[]; lines: Array<{ color: string; label: string }> }>;
}

/**
 * Where a stand-in's numbers are read (types.ts SpectrumStandIn): nowhere. While the slice is on its way its read is
 * pending (R7: the cursor's marks, no number) and it is measured for the overlay's order once the slice comes; past
 * the track's end there is no point to read, and silence has no power (the quietest, drawn last on top, R6).
 */
const STAND_IN_READ: Record<NonNullable<SpectrumSeries['slice']['standIn']>, FullSource> = {
    pending: { held: 'fetched', line: () => undefined, level: () => undefined },
    silence: { held: 'fetched', line: () => null, level: () => ({ power: 0, count: 0 }) },
};

/** Marks the right-hand axis in the legend. */
export const SECONDARY_AXIS_MARK = '▶';

/**
 * A slice as the comparison draws a level spectrum (stage_view): a line over its bins, or octave bands as steps;
 * FFT bins past the slice's top frequency (a cut for display) are left out.
 */
export function spectrumLayer(series: SpectrumSeries, cutoffHz: number, visible?: { frequencyMin: number; frequencyMax: number; buckets: number; logFrequency?: boolean }, levelUnit?: string): StageLayer {
    const { slice } = series;
    const bands = !!slice.bandCentersHz?.length;
    let xs: number[] = [], values: number[] = [];
    let levelBins: StageView['levelBins'];
    for (let index = 0; index < slice.frequencyBins && index < slice.values.length; index++) {
        const hz = binFrequencyHz(slice, index);
        // Bands are kept whole: their spacing is each band's width, and the plot clips them at the axis' end.
        if (!bands && hz > cutoffHz) break;
        xs.push(hz);
        values.push(slice.values[index]);
    }
    // Every number read off it is a bin of the slice (R7): the bins kept here, before any thinning, or for a slice cut
    // for display the slice read again at every bin (series.full).
    // A stand-in is drawn only: none of its values is a bin of a slice.
    const standIn = slice.standIn ? STAND_IN_READ[slice.standIn] : undefined;
    // Bands are every band of the slice; a slice cut for display without its every bin (series.full) has none to read.
    const full = standIn ?? series.full ?? (slice.frequenciesHz && !bands ? NO_FULL_DATA : localLine(xs, values));
    // Ordered among the overlaid slices by every bin's power before thinning (R6), over the axis drawn.
    // Over the frequencies on screen when known (the whole slice is in hand: measured again at every zoom), on the axis
    // drawn: a linear one keeps the 0 Hz bin, a log one starts at the first bin above it. A slice cut for display holds
    // only the points kept to be drawn: it has no levelBins, and the plot measures it from every bin (`full`, `measured`).
    const firstPositive = xs.find(hz => hz > 0);
    const log = bands || (visible ? !!visible.logFrequency : true);
    const span: [number, number] | null = visible ? [log ? Math.max(visible.frequencyMin, firstPositive ?? visible.frequencyMin) : visible.frequencyMin, visible.frequencyMax]
        : xs.length ? [log ? firstPositive ?? xs[0] : xs[0], xs[xs.length - 1]] : null;
    if (!slice.frequenciesHz && !standIn && span && span[1] > span[0]) levelBins = levelBinsOf(xs, values, span, log);
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
    // Read as the cursor spectrum reads a point (R7): its frequency to the digits its bins need, its level in the
    // slice's unit, or with two level axes in the reference of the axis it is read on.
    const level = levelUnit ? { ...slice, unit: levelUnit } : slice;
    return {
        // Bars are read from every band (whole): a stand-in's floor past the end is drawn as a line, read as none.
        view: { frame: 'spectrum', kind: bands && !standIn ? 'bar' : 'line', x: 'frequency', xScale: bands ? 'log' : 'linear', quantity: 'level', xs, values, ...(levelBins ? { levelBins } : {}) },
        color: series.color,
        width: bands ? 2 : 1.4,
        label: series.label,
        readout: (_index, point) => spectrumReadoutValues(level, point.x, point.value, point.step),
        full,
        ...(!levelBins && (!bands || standIn) ? { measured: true } : {}),
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
    const empty = vis.frequencyMax - vis.frequencyMin <= 0;
    // With two level axes, "dB" alone could be either: a point read names its axis' reference ("−17.0 dB re 1 m/s^2").
    const two = axes.length > 1;
    // A line read on the right-hand axis is dashed, as its swatch in the legend: lines of one colour (grey, without a role) are told apart.
    const layersOf = (series: readonly SpectrumSeries[], visible: SpectrumVisibleWindow, reference: string, dash?: readonly number[]): StageLayer[] => (visible.dbMax - visible.dbMin > 0 && !empty ? series : [])
        .map(s => ({ ...spectrumLayer(s, maxFrequencyHz, { frequencyMin: visible.frequencyMin, frequencyMax: visible.frequencyMax, buckets: lineBuckets, logFrequency: visible.logFrequency }, two ? reference : undefined), ...(dash ? { dash } : {}) }));
    const [primary, secondary] = axes;
    // About two pixels a bucket across the plot, as every line is thinned (R2).
    const lineBuckets = Math.max(64, Math.round((W - pad.left - pad.right) / 2));
    const plot = paintOverlay(canvas, { layers: layersOf(primary.series, vis, primary.reference) }, { min: vis.dbMin, max: vis.dbMax }, { x: frequencyTitle, y: primary.title }, {
        size: { width: W, height: H },
        margins: { ...pad },
        axisView: frequencyAxis(empty ? { ...vis, frequencyMax: vis.frequencyMin + 1 } : vis),
        ...(secondary ? { secondary: { layers: layersOf(secondary.series, secondary.visible, secondary.reference, SECONDARY_AXIS_DASH), range: { min: secondary.visible.dbMin, max: secondary.visible.dbMax }, title: secondary.title } } : {}),
    });
    return { maxFrequencyHz, logMinFrequencyHz, dbMin: vis.dbMin, dbMax: vis.dbMax, painted: !empty, plot: empty ? null : plot, levelAxes };
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
