import { isSafeCalibrationValue, MAX_SAFE_CALIBRATED_SAMPLE } from './analysisTypes';
import type { CalibrationProfile, ChannelCalibrationDefinition, ChannelMeasurementContext } from './analysisTypes';

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface CalibrationChannelDescriptor {
    channelIndex: number;
    label: string;
    measurement?: ChannelMeasurementContext;
    rawPeakFullScale?: number;
}

export function cloneProfile(profile: CalibrationProfile): CalibrationProfile {
    return {
        schemaVersion: 1,
        channels: profile.channels.map((channel) => ({ ...channel })),
    };
}

export function identityChannel(channel: CalibrationChannelDescriptor): ChannelCalibrationDefinition {
    return {
        channelIndex: channel.channelIndex,
        expectedLabel: channel.label,
        status: 'uncalibrated',
        source: 'default',
        factor: 1,
        unit: '',
        referenceValue: 1,
    };
}

export function identityCalibrationProfile(channels: CalibrationChannelDescriptor[]): CalibrationProfile {
    return {
        schemaVersion: 1,
        channels: channels.map(identityChannel),
    };
}

export function profilesEqual(left: CalibrationProfile, right: CalibrationProfile): boolean {
    return left.schemaVersion === right.schemaVersion
        && left.channels.length === right.channels.length
        && left.channels.every((channel, index) => {
            const other = right.channels[index];
            return other !== undefined
                && channel.channelIndex === other.channelIndex
                && channel.expectedLabel === other.expectedLabel
                && channel.status === other.status
                && channel.source === other.source
                && channel.factor === other.factor
                && channel.unit === other.unit
                && channel.referenceValue === other.referenceValue;
        });
}

export function validateCalibrationValueInput(value: string): string | undefined {
    const numberValue = Number(value);
    return isSafeCalibrationValue(numberValue)
        ? undefined
        : 'Enter a finite number from 1e-150 through 1e150.';
}

export function validateCalibrationFactorInput(
    value: string,
    rawPeakFullScale: number | undefined,
): string | undefined {
    const scalarError = validateCalibrationValueInput(value);
    if (scalarError) {
        return scalarError;
    }
    if (rawPeakFullScale === undefined || !Number.isFinite(rawPeakFullScale) || rawPeakFullScale <= 0) {
        return undefined;
    }
    const maximum = MAX_SAFE_CALIBRATED_SAMPLE / rawPeakFullScale;
    return Number(value) <= maximum
        ? undefined
        : `For this channel's source peak, enter ${maximum.toExponential(6)} or less.`;
}

export function profileForChannels(
    stored: CalibrationProfile | undefined,
    channels: CalibrationChannelDescriptor[],
): CalibrationProfile {
    if (!stored || stored.channels.length !== channels.length) {
        return identityCalibrationProfile(channels);
    }
    const matches = channels.every((channel, index) => {
        const entry = stored.channels[index];
        return entry?.channelIndex === channel.channelIndex
            && entry.expectedLabel === channel.label;
    });
    return matches ? cloneProfile(stored) : identityCalibrationProfile(channels);
}

export function isCalibrationStatus(value: unknown): boolean {
    return value === 'uncalibrated' || value === 'calibrated';
}

export function isCalibrationSource(value: unknown): boolean {
    return value === 'default' || value === 'manual' || value === 'derived' || value === 'embedded';
}

export function isCalibrationProfile(value: unknown): value is CalibrationProfile {
    return isJsonObject(value)
        && value['schemaVersion'] === 1
        && Array.isArray(value['channels'])
        && value['channels'].every((channel) => isJsonObject(channel)
            && typeof channel['channelIndex'] === 'number' && Number.isInteger(channel['channelIndex']) && channel['channelIndex'] >= 0
            && typeof channel['expectedLabel'] === 'string'
            && isCalibrationStatus(channel['status'])
            && isCalibrationSource(channel['source'])
            && isSafeCalibrationValue(channel['factor'])
            && typeof channel['unit'] === 'string'
            && isSafeCalibrationValue(channel['referenceValue']));
}
