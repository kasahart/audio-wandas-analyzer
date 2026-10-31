/**
 * A time signal's waveform on any plot, drawn exactly as the track lanes draw theirs: the backend's per-bucket
 * minimum and maximum (decimator.py), thinned on screen to two points per pixel column by the lanes' own
 * pipeline (computeViewRange → decimateBuckets → paintDecimatedPoints). The comparison's ChannelFrame panes use it.
 */
import type { StageView } from '../../shared/protocol/backendProtocol';
import { computeViewRange, decimateBuckets, makeCoordTransform, paintDecimatedPoints, type WaveformEnv } from '../waveform/waveformRenderer';

export type StageWaveform = NonNullable<StageView['waveform']>;

export interface PlotBox {
    left: number;
    top: number;
    width: number;
    height: number;
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
): void {
    const span = axis.high - axis.low || 1;
    const norm = (times: ReadonlyArray<number | null>): number[] => times.map(time => ((time ?? axis.low) - axis.low) / span);
    const value = (values: ReadonlyArray<number | null>): number[] => values.map(item => item ?? 0);
    const minT = norm(waveform.minT), maxT = norm(waveform.maxT);
    const env: WaveformEnv = { min: value(waveform.min), max: value(waveform.max), minT, maxT, absolutePeak: waveform.absolutePeak };
    // The part of the axis the envelope covers (a zoomed request covers only the view and its margin), as the
    // lanes pass a range request's bounds.
    const dataStart = Math.min(minT[0] ?? 0, maxT[0] ?? 0), dataEnd = Math.max(minT.at(-1) ?? 1, maxT.at(-1) ?? 1);
    const range = computeViewRange(env, dataStart, dataEnd, 0, window.start, window.end, plot.width);
    if (range.i1 < range.i0) return;
    const points = decimateBuckets(env, range, dataStart, dataEnd);
    // Values in the signal's own units: a peak of 1 and the amplitude range as the viewport.
    const transform = makeCoordTransform(window.start, window.end, 0, plot.width, plot.height, 1, 1, { minNorm: amplitude.min, maxNorm: amplitude.max });
    context.save();
    context.beginPath(); context.rect(plot.left, plot.top, plot.width, plot.height); context.clip();
    context.translate(plot.left, plot.top);
    paintDecimatedPoints(context, points, transform, color, lineWidth);
    context.restore();
}

/** ± the largest peak of these waveforms (a little room above it), the amplitude axis they share. */
export function waveformRange(waveforms: ReadonlyArray<StageWaveform | null | undefined>): { min: number; max: number } {
    const peak = Math.max(0, ...waveforms.map(item => item?.absolutePeak ?? 0)) * 1.05 || 1;
    return { min: -peak, max: peak };
}
