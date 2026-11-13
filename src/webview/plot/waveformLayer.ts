/**
 * A time signal's waveform on any plot, drawn exactly as the track lanes draw theirs: the backend's per-bucket
 * minimum and maximum (decimator.py), thinned on screen to two points per pixel column by the lanes' own
 * pipeline (computeViewRange → decimateBuckets → paintDecimatedPoints). The comparison's ChannelFrame panes use it.
 */
import type { StageView } from '../../shared/protocol/backendProtocol';
import { drawableLine } from '../../shared/drawnPoints';
import { niceRange } from '../../shared/utils/ticks';
import { computeViewRange, decimateBuckets, isGap, makeCoordTransform, paintDecimatedPoints, type WaveformEnv } from '../waveform/waveformRenderer';

export type StageWaveform = NonNullable<StageView['waveform']>;

/** A point of a signal's line: where on the canvas (CSS pixels), its value and time, and whether it is seen. */
export type SignalPointSink = (x: number, y: number, value: number, time: number, seen: boolean) => void;

export interface PlotBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Each waveform's envelope with its times as fractions of an axis, kept while the waveform and the axis are the same. */
const envelopes = new WeakMap<StageWaveform, { low: number; span: number; env: WaveformEnv & { minT: number[]; maxT: number[] } }>();

/**
 * `waveform` with its times as fractions of the axis from `low` over `span`: made once per waveform and axis, not on
 * every paint (a track lane is painted again on each zoom, pan and hover over thousands of points).
 */
function envelopeOn(waveform: StageWaveform, low: number, span: number): WaveformEnv & { minT: number[]; maxT: number[] } {
    const kept = envelopes.get(waveform);
    if (kept && kept.low === low && kept.span === span) return kept.env;
    const norm = (times: ReadonlyArray<number | null>): number[] => times.map(time => ((time ?? low) - low) / span);
    // A gap of the signal (null) stays one (NaN), drawn as a break, never as a sample at 0 (R2).
    const value = (values: ReadonlyArray<number | null>): number[] => values.map(item => item ?? Number.NaN);
    const env = { min: value(drawableLine(waveform.min)), max: value(drawableLine(waveform.max)), minT: norm(drawableLine(waveform.minT)), maxT: norm(drawableLine(waveform.maxT)), absolutePeak: waveform.absolutePeak };
    envelopes.set(waveform, { low, span, env });
    return env;
}

/**
 * Draws `waveform` inside `plot`: its times (s) placed on the whole axis [axis.low, axis.high] and the part
 * `window` of it across the plot, its values between amplitude.min and amplitude.max (the signal's units).
 */
export function paintWaveformLayer(
    context: CanvasRenderingContext2D,
    plot: PlotBox,
    waveform: StageWaveform,
    axis: { low: number; high: number },
    window: { start: number; end: number },
    amplitude: { min: number; max: number },
    color: string,
    lineWidth = 1.5,
    /**
     * `span`: the stretch of the axis (its values) drawn, clipped there, for finer data over part of the view.
     * `onPoint`: each point of the line (canvas pixels, its value and time, and whether it is inside the plot and
     * the stretch drawn, so seen), for a pointer that reads them and for where the line reaches.
     */
    options: { span?: readonly [number, number]; onPoint?: SignalPointSink } = {},
): void {
    const span = axis.high - axis.low || 1;
    const env = envelopeOn(waveform, axis.low, span);
    const { minT, maxT } = env;
    // The part of the axis the envelope covers (a zoomed request covers only the view and its margin), as the
    // lanes pass a range request's bounds.
    const dataStart = Math.min(minT[0] ?? 0, maxT[0] ?? 0), dataEnd = Math.max(minT.at(-1) ?? 1, maxT.at(-1) ?? 1);
    const range = computeViewRange(env, dataStart, dataEnd, 0, window.start, window.end, plot.width);
    if (range.i1 < range.i0) return;
    const points = decimateBuckets(env, range, dataStart, dataEnd);
    // Values in the signal's own units: a peak of 1 and the amplitude range as the viewport.
    const transform = makeCoordTransform(window.start, window.end, 0, plot.width, plot.height, 1, 1, { minNorm: amplitude.min, maxNorm: amplitude.max });
    // A part's stretch in whole pixels, so two parts side by side meet without an anti-aliased crack between them.
    const xOf = (value: number): number => plot.left + ((value - axis.low) / span - window.start) / (window.end - window.start || 1) * plot.width;
    const from = options.span ? Math.max(plot.left, Math.round(xOf(options.span[0]))) : plot.left;
    const to = options.span ? Math.min(plot.left + plot.width, Math.round(xOf(options.span[1]))) : plot.left + plot.width;
    if (to <= from) return;
    context.save();
    context.beginPath(); context.rect(from, plot.top, to - from, plot.height); context.clip();
    context.translate(plot.left, plot.top);
    paintDecimatedPoints(context, points, transform, color, lineWidth, { left: 0, top: 0, width: plot.width, height: plot.height });
    context.restore();
    if (options.onPoint) {
        for (const pair of points) {
            if (isGap(pair)) continue;
            for (const point of pair) {
                const x = plot.left + transform.toX(point.tNorm), y = plot.top + transform.toY(point.value);
                options.onPoint(x, y, point.value, axis.low + point.tNorm * span, x >= from && x < to && y >= plot.top && y <= plot.top + plot.height);
            }
        }
    }
}

/**
 * ± the largest peak of these waveforms (every sample's, a little room above it), the amplitude axis they share,
 * widened to round ends as every automatic range is (R9): ±0.35, not ±0.34272.
 */
export function waveformRange(waveforms: ReadonlyArray<StageWaveform | null | undefined>): { min: number; max: number } {
    const peak = Math.max(0, ...waveforms.map(item => item?.absolutePeak ?? 0)) * 1.05 || 1;
    const { low, high } = niceRange(-peak, peak);
    return { min: low, max: high };
}
