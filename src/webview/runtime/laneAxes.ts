/**
 * The track lanes' axes, by the plot component's rules (R3): the amplitude ticks and the time ruler above the lanes
 * take their ticks and number format from stagePanes, as Compare's plots do; each lane's value axis beside it (the
 * amplitude, or a spectrogram's frequency) is painted by the plot component itself (paintOverlay's paintSideAxis).
 */
import type { AxisTick } from '../../shared/gui-core/index';
import type { PaneRange } from './comparePanes';
import { alongAxisTicks, valueAxisTicks } from './stagePanes';

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
 * plotInteraction names a plot's window. The lane is drawn by paintOverlay, so it is held to the same gestures as
 * every plot.
 */
export function markLanePlot(canvas: HTMLElement, axes: { x: string; y: string }, axisId: string, window: { x: { start: number; end: number }; y: { start: number; end: number } }): void {
    // Not its `data-plot` mark: only paintOverlay sets that, as it draws the lane (R13).
    canvas.dataset.plotAxes = `${axes.x}|${axes.y}`;
    canvas.dataset.plotAxis = axisId;
    // The time axis every lane shares, drawn once above them by the component (paintTimeAxis): its range is set there.
    canvas.dataset.plotXAxis = 'ruler-canvas';
    canvas.dataset.plotWindow = [window.x.start, window.x.end, window.y.start, window.y.end].map(value => value.toFixed(3)).join(' ');
}
