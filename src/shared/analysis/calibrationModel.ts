import { isSafeCalibrationValue, MAX_SAFE_CALIBRATED_SAMPLE } from './analysisTypes';
import type { CalibrationProfile, ChannelCalibrationDefinition, ChannelMeasurementContext } from './analysisTypes';
import { fillTemplate, type UiStrings } from '../i18n/strings';

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A source's level as wandas reads it, before calibration: "FS" / "dBFS" for audio, "" / "dB re 1 input unit" for a CSV. */
export interface SourceLevel {
    unit: string;
    levelReferenceLabel: string;
}

/** Filled with the source's scale and units; `calResetDone` still holds `{file}`. */
export type CalibrationPickerStrings = Pick<UiStrings, 'calUncalibratedSummary' | 'calResetAllLabel' | 'calResetDone'
    | 'calModeCalibratedDescription' | 'calModeUncalibratedLabel' | 'calModeUncalibratedDescription' | 'calFactorPrompt'>;

/** The calibration picker's words for an uncalibrated channel, in wandas' unit and level label for the source as read. */
export function calibrationPickerStrings(strings: UiStrings, source: SourceLevel): CalibrationPickerStrings {
    const values = {
        scale: source.unit === 'FS' ? strings.calScaleFullScale : strings.calScaleRawUnits,
        units: [source.unit, source.levelReferenceLabel].filter(Boolean).join(' / '),
    };
    return {
        calUncalibratedSummary: fillTemplate(strings.calUncalibratedSummary, values),
        calResetAllLabel: fillTemplate(strings.calResetAllLabel, values),
        calResetDone: fillTemplate(strings.calResetDone, values),
        calModeCalibratedDescription: fillTemplate(strings.calModeCalibratedDescription, values),
        calModeUncalibratedLabel: fillTemplate(strings.calModeUncalibratedLabel, values),
        calModeUncalibratedDescription: fillTemplate(strings.calModeUncalibratedDescription, values),
        calFactorPrompt: fillTemplate(strings.calFactorPrompt, values),
    };
}

/**
 * The picker's line for a channel's stored calibration. A calibrated one names its level reference with wandas' label
 * from the analysis, when the analysis used that same calibration.
 */
export function describeChannelCalibration(
    strings: UiStrings,
    wording: CalibrationPickerStrings,
    channel: ChannelCalibrationDefinition,
    measurement: ChannelMeasurementContext | undefined,
): string {
    if (channel.status === 'uncalibrated') {
        return wording.calUncalibratedSummary;
    }
    const summary = fillTemplate(strings.calSummary, { factor: channel.factor, unit: channel.unit });
    const analyzed = measurement?.calibrationStatus === 'calibrated'
        && measurement.factor === channel.factor
        && measurement.referenceUnit === channel.unit
        && measurement.referenceValue === channel.referenceValue;
    return analyzed ? `${summary}; ${measurement.levelReferenceLabel}` : summary;
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
