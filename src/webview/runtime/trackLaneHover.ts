/**
 * How a track lane's readout is written (R7): a waveform lane's sample, read by the plot component from the file's
 * samples (stagePanes.stageHover over laneReads.waveform), names the recording, its time and amplitude; a
 * spectrogram lane's real STFT cell its time, frequency bin and level; and where a click on a lane seeks to.
 */
import { readoutText } from '../../shared/gui-core/index';
import { amountText, frequencyText, levelText, secondsText, spacingDecimals } from '../plot/plotText';
import type { PlotClickRead } from './plotHoverLayer';
import type { StageRead } from './stagePanes';

/**
 * Where a click on a lane seeks to on the lanes' time axis (R7, R13): seeking is an act on a time, not on a point.
 * A reading: the time of the point read (`timeOf`: the sample's, the cell's frame's). No reading at all (`got` null:
 * no readout on the lane, its read failed; or no point read: a lane with no readout, a file changed since it was
 * analysed, no value there; or a read with no time of its own): the pointer's time (`pointer`), as nothing is claimed
 * there. A read still on its way is never given here: clickOnRead waits for it.
 */
export function laneClickNorm(got: PlotClickRead | null, timeOf: (read: StageRead) => number | null, pointer: number): number {
    return (got?.read ? timeOf(got.read) : null) ?? pointer;
}

/**
 * "name / 1.234 s / 0.123 FS": the time to the digits that tell the points read apart (`step`, the samples' spacing:
 * at 48 kHz "3.27002 s"), as every time is (plotText.ts spacingDecimals); at least 10 ms; without a spacing, to the
 * digits a pixel tells apart. The amplitude to 3 figures.
 */
export function laneReadoutText(label: string, seconds: number, secondsPerPixel: number, value: number, unit: string | null, step?: number): string {
    const digits = spacingDecimals(step ?? Math.max(secondsPerPixel, 1e-9), 2, 9);
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

/** "name / 1.234 s / 1 kHz / −40.0 dB": the time as the waveform lanes read it, the cell's bin and level. */
export function spectrogramReadoutText(label: string, seconds: number, secondsPerPixel: number, cell: SpectrogramCell, unit: string, step?: number): string {
    const [time] = laneReadoutText('', seconds, secondsPerPixel, 0, null, step).split(' / ');
    return readoutText([...(label ? [label] : []), time, frequencyText(cell.frequencyHz, cell.stepHz), levelText(cell.level, unit)]);
}
