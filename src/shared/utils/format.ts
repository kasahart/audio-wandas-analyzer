// Display formatters shared by the bundled comparison runtime and the inlined render scripts.
// Each function is self-contained (no module references beyond the other functions listed in
// FORMAT_SCRIPT_SOURCE) so render scripts can inline them through Function.prototype.toString().

export interface LevelMeasurement {
    calibrationStatus?: string;
    linearUnit?: string;
    levelUnit?: string;
}

export interface ChannelLabelSource {
    channels?: ReadonlyArray<{ label?: string } | null | undefined>;
    channelCount?: number;
}

/** Linear measurement values: 0 / 2 / 3 decimals by magnitude, 3 significant digits below 0.01. */
export function formatMeasurementNumber(value: unknown): string {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) { return '—'; }
    const absolute = Math.abs(numberValue);
    if (absolute >= 100) { return numberValue.toFixed(0); }
    if (absolute >= 1) { return numberValue.toFixed(2); }
    if (absolute >= 0.01) { return numberValue.toFixed(3); }
    return numberValue.toPrecision(3);
}

/** "<linear> <unit> / <level> <levelUnit>" for calibrated channels, "<level> <levelUnit>" otherwise; null without a finite level. */
export function formatMeasuredLevel(linearValue: unknown, levelValue: unknown, measurement: LevelMeasurement | null | undefined): string | null {
    if (!Number.isFinite(levelValue)) { return null; }
    const level = Number(levelValue).toFixed(1) + ' ' + ((measurement && measurement.levelUnit) || 'dB');
    if (!measurement || measurement.calibrationStatus === 'uncalibrated') { return level; }
    return formatMeasurementNumber(linearValue) + ' ' + measurement.linearUnit + ' / ' + level;
}

/** Timeline clock: "m:ss.ss". */
export function formatClockTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = (seconds % 60).toFixed(2);
    return m + ':' + (parseFloat(s) < 10 ? '0' : '') + s;
}

/** Report durations: "1m 2.500s" / "2.500s". */
export function formatReportDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = (seconds - m * 60).toFixed(3);
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

/** Source of the formatters for render scripts that run as inline strings. */
export const FORMAT_SCRIPT_SOURCE = [formatMeasurementNumber, formatMeasuredLevel, channelsForResult].map(fn => fn.toString()).join('\n');
