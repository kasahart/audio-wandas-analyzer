import { levelText, withMinus } from '../../webview/plot/plotText';
// Display formatters shared by the comparison runtime and the report builders.

export interface LevelMeasurement {
    calibrationStatus?: string;
    linearUnit?: string;
    levelUnit?: string;
    /** The level's reference as the axes name it ("dB SPL re 20 µPa", "dB re 1 V"): written in place of levelUnit when given (R7). */
    levelReferenceLabel?: string;
}

export interface ChannelLabelSource {
    channels?: ReadonlyArray<{ label?: string } | null | undefined>;
    channelCount?: number;
}

/**
 * What an uncalibrated value is relative to: the file's full scale, or, for a source without one (CSV, `fullScale: false`),
 * one raw input unit, as the backend's level reference names it.
 */
export function uncalibratedUnits(fullScale: boolean): { linear: string; level: string } {
    return fullScale ? { linear: 'FS', level: 'dBFS' } : { linear: 'input unit', level: 'dB re 1 input unit' };
}

/**
 * The level reference most of these files have, as wandas names it ("dBFS", "dB SPL re 20 µPa"); dBFS before any. Never
 * plain dB: an absolute level always names its reference (R4), so files of another reference are shown apart, not
 * under a common bare "dB" (the entry table compares only files of its most common shape, too).
 */
export function commonLevelLabel(labels: Iterable<string>): string {
    const counts = new Map<string, number>();
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
    let best = 'dBFS', most = 0;
    for (const [label, count] of counts) if (count > most) { best = label; most = count; }
    return best;
}

/** Linear measurement values: 0 / 2 / 3 decimals by magnitude, 3 significant digits below 0.01. */
export function formatMeasurementNumber(value: unknown): string {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) { return '—'; }
    const absolute = Math.abs(numberValue);
    if (absolute >= 100) { return withMinus(numberValue.toFixed(0)); }
    if (absolute >= 1) { return withMinus(numberValue.toFixed(2)); }
    if (absolute >= 0.01) { return withMinus(numberValue.toFixed(3)); }
    return withMinus(numberValue.toPrecision(3));
}

/** "<linear> <unit> / <level> <levelUnit>" for calibrated channels, "<level> <levelUnit>" otherwise; null without a finite level. */
export function formatMeasuredLevel(linearValue: unknown, levelValue: unknown, measurement: LevelMeasurement | null | undefined): string | null {
    if (!Number.isFinite(levelValue)) { return null; }
    // An absolute level names its reference as its axis does: wandas' levelUnit is bare "dB" for any reference but FS and SPL.
    const level = levelText(Number(levelValue), (measurement && (measurement.levelReferenceLabel || measurement.levelUnit)) || 'dB');
    if (!measurement || measurement.calibrationStatus === 'uncalibrated') { return level; }
    return formatMeasurementNumber(linearValue) + ' ' + measurement.linearUnit + ' / ' + level;
}

/** Timeline clock: "m:ss.ss". */
export function formatClockTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = withMinus((seconds % 60).toFixed(2));
    return m + ':' + (parseFloat(s) < 10 ? '0' : '') + s;
}

/** Report durations: "1m 2.500s" / "2.500s". */
export function formatReportDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = withMinus((seconds - m * 60).toFixed(3));
    return (m > 0 ? m + 'm ' : '') + s + 's';
}

export function channelsForResult<T extends ChannelLabelSource>(result: T | null | undefined): NonNullable<T['channels']> | [] {
    return result && Array.isArray(result.channels) ? result.channels as NonNullable<T['channels']> : [];
}

/** "Channel 2 / 4 (Mic B)": the custom label is shown only when it differs from the default name. */
export function channelLabel(result: ChannelLabelSource | null | undefined, channelIndex: number): string {
    const channels = channelsForResult(result);
    const count = result && Number.isFinite(result.channelCount) ? Number(result.channelCount) : channels.length;
    const channelNumber = channelIndex + 1;
    const base = 'Channel ' + channelNumber + (count > 1 ? ' / ' + count : '');
    const channel = channels[channelIndex];
    return channel && channel.label && channel.label !== 'Channel ' + channelNumber ? base + ' (' + channel.label + ')' : base;
}
