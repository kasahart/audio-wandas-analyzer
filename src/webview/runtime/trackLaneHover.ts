/**
 * The pointer over a track's waveform lane reads it as every plot of lines does (R7, plotHover.ts): the point
 * drawn nearest the pointer within a few pixels, else the one under it nearest in height; the cursor at that
 * point, a level line in the lane's colour, and a readout naming the recording, its time and amplitude.
 */
import { readoutText } from '../../shared/gui-core/index';
import { HOVER_PICK_RADIUS_PX, nearestPoint } from './plotHover';
import { amountText, frequencyText, levelText, secondsText } from '../plot/plotText';
import { spectrogramTimeBinAt, spectrogramTimeBinEdges } from '../spectrum/spectrogramTimeBins';
import { spectrogramRowSpan } from '../spectrum/spectrogramZoom';
import type { SpectrogramData } from '../../shared/analysis/analysisTypes';

/** A point of a lane's waveform as drawn: where on the canvas (bitmap pixels), its value and time (the file's 0..1). */
export interface LanePoint {
    x: number;
    y: number;
    value: number;
    t: number;
}

/**
 * The point the pointer at (`x`, `y`) reads on a lane drawn as `points` (bitmap pixels; `pixelRatio` bitmap
 * pixels to a CSS pixel, so the pick radius is the same on screen as on every other plot).
 */
export function laneHoverPoint(points: readonly LanePoint[], x: number, y: number, pixelRatio = 1): LanePoint | null {
    const radius = HOVER_PICK_RADIUS_PX * pixelRatio;
    const hit = nearestPoint([points],
        line => line.filter(point => Math.abs(point.x - x) <= radius),
        // With none that near: of the points in the nearest column, the one nearest in height, anywhere over the
        // waveform (zoomed in, its samples may lie farther apart than the radius); past its ends, nothing.
        line => {
            let column = Infinity, first = Infinity, last = -Infinity;
            for (const point of line) {
                column = Math.min(column, Math.abs(point.x - x));
                first = Math.min(first, point.x);
                last = Math.max(last, point.x);
            }
            if (!isFinite(column) || x < first - radius || x > last + radius) return null;
            let best: LanePoint | null = null;
            for (const point of line) {
                if (Math.abs(point.x - x) <= column + pixelRatio * 0.5 && (!best || Math.abs(point.y - y) < Math.abs(best.y - y))) best = point;
            }
            return best;
        }, x, y, radius);
    return hit ? hit.point : null;
}

/** "name / 1.234 s / 0.123 FS": the time to the digits a pixel tells apart (at least 10 ms), the amplitude to 3 figures. */
export function laneReadoutText(label: string, seconds: number, secondsPerPixel: number, value: number, unit: string | null): string {
    const digits = Math.max(2, Math.min(6, Math.ceil(-Math.log10(Math.max(secondsPerPixel, 1e-6)))));
    const time = secondsText(seconds, digits);
    const amount = amountText(value, unit);
    return readoutText([...(label ? [label] : []), time, amount]);
}

/** The part of a track's spectrogram the pointer reads: its cell's frequency bin and level. */
export interface SpectrogramCell {
    frequencyHz: number;
    level: number;
    /** The spacing of the spectrogram's bins, so neighbouring bins read apart (R7). */
    stepHz?: number;
}

/**
 * The cell of a spectrogram under the pointer (R7): the time bin holding `localNorm` (the file's 0..1, as the
 * raster places its cells), the frequency bin nearest `frequencyHz`; null off the file or above the data.
 */
export function spectrogramCellAt(spec: Pick<SpectrogramData, 'values' | 'timeBins' | 'frequencyBins' | 'maxFrequencyHz' | 'timeCentersSec' | 'bandLowHz' | 'bandHighHz'>, localNorm: number, frequencyHz: number, durationSec?: number): SpectrogramCell | null {
    if (!(spec.timeBins > 0 && spec.frequencyBins > 0 && spec.maxFrequencyHz > 0) || !(localNorm >= 0 && localNorm <= 1) || !(frequencyHz >= 0)) return null;
    const edges = spectrogramTimeBinEdges(spec, durationSec);
    const time = edges ? spectrogramTimeBinAt(edges, localNorm) : Math.min(spec.timeBins - 1, Math.floor(localNorm * spec.timeBins));
    const intervals = Math.max(spec.frequencyBins - 1, 1);
    // A zoomed band's rows run across that band only (spectrogramRowSpan).
    const { lowHz, highHz } = spectrogramRowSpan(spec);
    const stepHz = (highHz - lowHz) / intervals;
    const bin = Math.round((frequencyHz - lowHz) / stepHz);
    const level = bin >= 0 && bin < spec.frequencyBins ? spec.values[time]?.[bin] : undefined;
    return level === undefined || !Number.isFinite(level) ? null : { frequencyHz: lowHz + bin * stepHz, level, stepHz };
}

/**
 * Where an arrow key reads next on a spectrogram lane (R7): the centre of the time bin `delta` along from the one
 * holding `localNorm` (the file's 0..1), as a track-local norm; null past the first or last bin. The bins are placed
 * as the raster places them (spectrogramTimeBinEdges): a zoomed detail's columns cover only its window of the file,
 * at their own frame centres.
 */
export function spectrogramNeighbourNorm(spec: Pick<SpectrogramData, 'timeBins' | 'timeCentersSec'>, localNorm: number, delta: -1 | 1, durationSec?: number): number | null {
    if (!(spec.timeBins > 0) || !Number.isFinite(localNorm)) return null;
    const edges = spectrogramTimeBinEdges(spec, durationSec);
    const from = edges ? spectrogramTimeBinAt(edges, localNorm) : Math.min(spec.timeBins - 1, Math.max(0, Math.floor(localNorm * spec.timeBins)));
    // Off a detail's window the first key reads its nearest column, not the one past it.
    const outside = edges ? (localNorm < edges[0] && delta > 0) || (localNorm >= edges[spec.timeBins] && delta < 0) : false;
    const bin = outside ? from : from + delta;
    if (!(bin >= 0 && bin < spec.timeBins)) return null;
    return edges && durationSec ? (spec.timeCentersSec as number[])[bin] / durationSec : (bin + 0.5) / spec.timeBins;
}

/** "name / 1.234 s / 1 kHz / −40.0 dB": the time as the waveform lanes read it, the cell's bin and level. */
export function spectrogramReadoutText(label: string, seconds: number, secondsPerPixel: number, cell: SpectrogramCell, unit: string): string {
    const [time] = laneReadoutText('', seconds, secondsPerPixel, 0, null).split(' / ');
    return readoutText([...(label ? [label] : []), time, frequencyText(cell.frequencyHz, cell.stepHz), levelText(cell.level, unit)]);
}
