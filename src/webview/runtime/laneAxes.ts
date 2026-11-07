/**
 * The track lanes' axes, by the plot component's rules (R3): the amplitude and frequency axes beside each lane and the
 * time ruler above them take their ticks, number format, font and titles from stagePanes, as Compare's plots do.
 */
import { drawValueAxis, type AxisTick, type PlotContext } from '../../shared/gui-core/index';
import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';
import type { PaneRange } from './comparePanes';
import { alongAxisTicks, PLOT_TEXT_FONT, rowAxisTicks, valueAxisTicks } from './stagePanes';

/** Where the axis titles stand from the axis canvas's left edge, as on Compare's plots. */
const TITLE_X = 10;

/**
 * The amplitude a waveform lane shows from its bottom edge to its top, in the channel's unit, as makeCoordTransform
 * places it: unzoomed, the peak at WAVEFORM_HALF_HEIGHT_RATIO of the half height; zoomed, the window's own ends.
 */
export function laneAmplitudeRange(peak: number, viewport?: { minNorm: number; maxNorm: number }): PaneRange {
    if (viewport) return { min: viewport.minNorm * peak, max: viewport.maxNorm * peak };
    const edge = peak / (2 * WAVEFORM_HALF_HEIGHT_RATIO);
    return { min: -edge, max: edge };
}

/** A waveform lane's amplitude ticks: every plot's value axis rule. */
export function laneAmplitudeTicks(range: PaneRange): AxisTick[] {
    return valueAxisTicks(range);
}

/** A spectrogram lane's frequency ticks between the frequencies at its bottom and top (its raster is linear in Hz), as many as its height is for: every heatmap's row axis rule. */
export function laneFrequencyTicks(lowHz: number, highHz: number, height: number): AxisTick[] {
    return rowAxisTicks(lowHz, highHz, false, height).map(({ text, fraction }) => ({ text, fraction }));
}

/** The time ticks across `width` pixels showing `startSec`..`endSec`: Compare's time axis rule. */
export function laneTimeTicks(startSec: number, endSec: number, width: number): Array<{ x: number; text: string }> {
    const span = endSec - startSec || 1;
    return alongAxisTicks(startSec, endSec).map(tick => ({ x: (tick.value - startSec) / span * width, text: tick.text }));
}

/**
 * A lane's value axis on its own canvas (`width` × `height`, the plot's height): the ticks at the canvas's right edge
 * in the muted colour and the title up its left in the text colour, as drawValueAxis writes every plot's.
 */
export function paintLaneAxis(context: PlotContext & { clearRect(x: number, y: number, w: number, h: number): void }, width: number, height: number, ticks: readonly AxisTick[], title: string, colors: { muted: string; text: string }): void {
    context.clearRect(0, 0, width, height);
    const frame = { left: width, top: 0, width: 0, height };
    drawValueAxis(context, frame, ticks, '', { color: colors.muted, font: PLOT_TEXT_FONT, titleX: TITLE_X });
    drawValueAxis(context, frame, [], title, { color: colors.text, font: PLOT_TEXT_FONT, titleX: TITLE_X });
}
