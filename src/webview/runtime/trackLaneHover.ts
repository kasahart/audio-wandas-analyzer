/**
 * How a track lane's readout is written (R7): a waveform lane's sample, read by the plot component from the file's
 * samples (stagePanes.stageHover over laneReads.waveform), names the recording, its time and amplitude; a
 * spectrogram lane's real STFT cell its time, frequency bin and level.
 */
import { readoutText } from '../../shared/gui-core/index';
import { amountText, frequencyText, levelText, secondsText } from '../plot/plotText';

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

/** "name / 1.234 s / 1 kHz / −40.0 dB": the time as the waveform lanes read it, the cell's bin and level. */
export function spectrogramReadoutText(label: string, seconds: number, secondsPerPixel: number, cell: SpectrogramCell, unit: string): string {
    const [time] = laneReadoutText('', seconds, secondsPerPixel, 0, null).split(' / ');
    return readoutText([...(label ? [label] : []), time, frequencyText(cell.frequencyHz, cell.stepHz), levelText(cell.level, unit)]);
}
