/**
 * The track lanes' axes, by the plot component's rules (R3): the amplitude ticks and the time ruler above the lanes
 * take their ticks and number format from stagePanes, as Compare's plots do; each lane's value axis beside it (the
 * amplitude, or a spectrogram's frequency) is painted by the plot component itself (paintOverlay's paintSideAxis).
 */
import type { AxisTick } from '../../shared/gui-core/index';
import { WAVEFORM_HALF_HEIGHT_RATIO } from '../waveform/waveformLayout';
import type { PaneRange } from './comparePanes';
import { alongAxisTicks, valueAxisTicks } from './stagePanes';

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

/** The time ticks across `width` pixels showing `startSec`..`endSec`: Compare's time axis rule. */
export function laneTimeTicks(startSec: number, endSec: number, width: number): Array<{ x: number; text: string }> {
    const span = endSec - startSec || 1;
    return alongAxisTicks(startSec, endSec).map(tick => ({ x: (tick.value - startSec) / span * width, text: tick.text }));
}

/**
 * Marks a lane as a plot that answers the plot contract (R13): its axes' names, the element holding its value axis
 * (a canvas of its own beside the lane), and the part of each axis on screen ("x.start x.end y.start y.end"), as
 * plotInteraction names a plot's window. The lane's line is drawn by the shared waveform layer and its axes by
 * these rules, so it is held to the same gestures as every plot.
 */
export function markLanePlot(canvas: HTMLElement, axes: { x: string; y: string }, axisId: string, window: { x: { start: number; end: number }; y: { start: number; end: number } }): void {
    canvas.dataset.plot = '';
    canvas.dataset.plotAxes = `${axes.x}|${axes.y}`;
    canvas.dataset.plotAxis = axisId;
    canvas.dataset.plotWindow = [window.x.start, window.x.end, window.y.start, window.y.end].map(value => value.toFixed(3)).join(' ');
}

/** A lane with nothing drawn yet (a message in its place): still the plot component's, with no axes, as paintOverlay marks an empty pane. */
export function markEmptyLanePlot(canvas: HTMLElement): void {
    canvas.dataset.plot = '';
    canvas.dataset.plotAxes = '';
    delete canvas.dataset.plotAxis;
    delete canvas.dataset.plotWindow;
}
