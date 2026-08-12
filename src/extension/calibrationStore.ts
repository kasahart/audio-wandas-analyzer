import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    isSafeCalibrationValue,
    MAX_SAFE_CALIBRATED_SAMPLE,
} from '../shared/analysis/analysisTypes';
import type {
    CalibrationProfile,
    ChannelCalibrationDefinition,
    ChannelMeasurementContext,
} from '../shared/analysis/analysisTypes';

const CALIBRATION_PROFILES_KEY = 'audioWandasAnalyzer.calibrationProfiles.v1';
const analysisRevisions = new Map<string, number>();
const calibrationChangeListeners = new Set<(event: CalibrationChangeEvent) => void>();
const profileWriteQueues = new WeakMap<vscode.ExtensionContext, Promise<void>>();
const PROFILE_UNCHANGED = Symbol('profile-unchanged');

export interface CalibrationChangeEvent {
    filePath: string;
    analysisRevision: number;
}

export interface CalibrationChannelDescriptor {
    channelIndex: number;
    label: string;
    measurement?: ChannelMeasurementContext;
    rawPeakFullScale?: number;
}

function fileKey(filePath: string): string {
    const resolved = path.resolve(filePath);
    try {
        return fs.realpathSync.native(resolved);
    } catch {
        return resolved;
    }
}

export function onDidChangeCalibration(
    listener: (event: CalibrationChangeEvent) => void,
): vscode.Disposable {
    calibrationChangeListeners.add(listener);
    return { dispose: () => { calibrationChangeListeners.delete(listener); } };
}

function cloneProfile(profile: CalibrationProfile): CalibrationProfile {
    return {
        schemaVersion: 1,
        channels: profile.channels.map((channel) => ({ ...channel })),
    };
}

function profiles(context: vscode.ExtensionContext): Record<string, CalibrationProfile> {
    return context.workspaceState.get<Record<string, CalibrationProfile>>(CALIBRATION_PROFILES_KEY, {});
}

function identityChannel(channel: CalibrationChannelDescriptor): ChannelCalibrationDefinition {
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

export function getCalibrationProfile(
    context: vscode.ExtensionContext,
    filePath: string,
): CalibrationProfile | undefined {
    const stored = profiles(context)[fileKey(filePath)];
    return stored ? cloneProfile(stored) : undefined;
}

export function getAnalysisRevision(filePath: string): number {
    return analysisRevisions.get(fileKey(filePath)) ?? 0;
}

function isStaleCalibrationProfileError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('Calibration channel count mismatch')
        || message.includes('Calibration channel label mismatch')
        || /^Calibration factor for channel \d+ exceeds the safe limit/u.test(message);
}

export async function discardStaleCalibrationProfile(
    context: vscode.ExtensionContext,
    filePath: string,
    error: unknown,
    failedProfile: CalibrationProfile,
): Promise<boolean> {
    if (!isStaleCalibrationProfileError(error)) {
        return false;
    }
    let discarded = false;
    await persistProfile(context, filePath, (current) => {
        if (!current || !profilesEqual(current, failedProfile)) {
            return PROFILE_UNCHANGED;
        }
        discarded = true;
        return undefined;
    });
    return discarded;
}

function profilesEqual(left: CalibrationProfile, right: CalibrationProfile): boolean {
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

function bumpAnalysisRevision(canonicalPath: string): number {
    const next = (analysisRevisions.get(canonicalPath) ?? 0) + 1;
    analysisRevisions.set(canonicalPath, next);
    return next;
}

async function persistProfile(
    context: vscode.ExtensionContext,
    filePath: string,
    updateProfile: (
        current: CalibrationProfile | undefined,
    ) => CalibrationProfile | undefined | typeof PROFILE_UNCHANGED,
): Promise<void> {
    const key = fileKey(filePath);
    const previous = profileWriteQueues.get(context) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
        const next = { ...profiles(context) };
        const current = next[key] ? cloneProfile(next[key]) : undefined;
        const updated = updateProfile(current);
        if (updated === PROFILE_UNCHANGED) { return; }
        if (updated) {
            next[key] = cloneProfile(updated);
        } else {
            delete next[key];
        }
        await context.workspaceState.update(CALIBRATION_PROFILES_KEY, next);
        const analysisRevision = bumpAnalysisRevision(key);
        for (const listener of calibrationChangeListeners) {
            listener({ filePath: key, analysisRevision });
        }
    });
    profileWriteQueues.set(context, operation);
    try {
        await operation;
    } finally {
        if (profileWriteQueues.get(context) === operation) {
            profileWriteQueues.delete(context);
        }
    }
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

async function persistChannel(
    context: vscode.ExtensionContext,
    filePath: string,
    channels: CalibrationChannelDescriptor[],
    channelIndex: number,
    channel: ChannelCalibrationDefinition,
): Promise<void> {
    await persistProfile(context, filePath, (stored) => {
        const latest = profileForChannels(stored, channels);
        latest.channels[channelIndex] = channel;
        return latest.channels.some((entry) => entry.status === 'calibrated') ? latest : undefined;
    });
}

function profileForChannels(
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

function describeCalibration(channel: ChannelCalibrationDefinition): string {
    if (channel.status === 'uncalibrated') {
        return 'Full scale (FS / dBFS)';
    }
    const level = channel.unit === 'Pa' && channel.referenceValue === 2e-5
        ? 'dB SPL re 20 µPa'
        : `dB re ${channel.referenceValue} ${channel.unit}`;
    return `factor ${channel.factor}; ${channel.unit}; ${level}`;
}

export async function configureCalibrationProfile(
    context: vscode.ExtensionContext,
    filePath: string,
    channels: CalibrationChannelDescriptor[],
): Promise<boolean> {
    if (channels.length === 0) {
        void vscode.window.showInformationMessage('No audio channels are available for calibration.');
        return false;
    }

    const current = profileForChannels(getCalibrationProfile(context, filePath), channels);
    const resetAll = Symbol('reset-all');
    const picked = await vscode.window.showQuickPick(
        [
            {
                label: '$(discard) Reset all channels to full scale',
                description: 'Remove the saved calibration profile for this file',
                value: resetAll,
            },
            ...channels.map((channel) => ({
                label: `$(settings-gear) Channel ${channel.channelIndex + 1}: ${channel.label}`,
                description: describeCalibration(current.channels[channel.channelIndex]),
                value: channel.channelIndex,
            })),
        ],
        {
            placeHolder: `Configure calibration for ${path.basename(filePath)}`,
            matchOnDescription: true,
        },
    );
    if (!picked) {
        return false;
    }

    if (picked.value === resetAll) {
        await persistProfile(context, filePath, () => undefined);
        void vscode.window.showInformationMessage(`Calibration reset to full scale: ${path.basename(filePath)}`);
        return true;
    }

    const channelIndex = picked.value as number;
    const channel = channels.find((candidate) => candidate.channelIndex === channelIndex);
    if (!channel) {
        throw new Error(`Calibration channel was not found: ${channelIndex}`);
    }
    const existing = current.channels[channelIndex] ?? identityChannel(channel);
    const mode = await vscode.window.showQuickPick(
        [
            {
                label: 'Calibrated physical quantity',
                description: 'Apply a raw-FS-to-physical conversion before analysis',
                value: 'calibrated' as const,
            },
            {
                label: 'Uncalibrated full scale',
                description: 'Use FS and dBFS for this channel',
                value: 'uncalibrated' as const,
            },
        ],
        {
            placeHolder: `Channel ${channelIndex + 1}: ${channel.label}`,
        },
    );
    if (!mode) {
        return false;
    }

    if (mode.value === 'uncalibrated') {
        await persistChannel(context, filePath, channels, channelIndex, identityChannel(channel));
        return true;
    }

    const factor = await vscode.window.showInputBox({
        title: `Calibration factor — Channel ${channelIndex + 1}: ${channel.label}`,
        prompt: 'Physical value = raw full-scale sample × factor',
        value: existing.status === 'calibrated' ? String(existing.factor) : '1',
        validateInput: (value) => validateCalibrationFactorInput(value, channel.rawPeakFullScale),
    });
    if (factor === undefined) {
        return false;
    }

    const unit = await vscode.window.showInputBox({
        title: `Physical unit — Channel ${channelIndex + 1}: ${channel.label}`,
        prompt: "Examples: Pa, m/s^2, V. Use '1' for a dimensionless physical quantity.",
        value: existing.status === 'calibrated' ? existing.unit : 'Pa',
        validateInput: (value) => value.trim() ? undefined : "Enter a unit, or '1' for dimensionless data.",
    });
    if (unit === undefined) {
        return false;
    }
    const normalizedUnit = unit.trim();

    const defaultReference = existing.status === 'calibrated'
        ? existing.referenceValue
        : normalizedUnit === 'Pa'
            ? 2e-5
            : 1;
    const referenceValue = await vscode.window.showInputBox({
        title: `Level reference — Channel ${channelIndex + 1}: ${channel.label}`,
        prompt: normalizedUnit === 'Pa'
            ? '20 µPa is 0.00002 Pa and produces dB SPL.'
            : `Reference value in ${normalizedUnit}.`,
        value: String(defaultReference),
        validateInput: validateCalibrationValueInput,
    });
    if (referenceValue === undefined) {
        return false;
    }

    await persistChannel(context, filePath, channels, channelIndex, {
        channelIndex,
        expectedLabel: channel.label,
        status: 'calibrated',
        source: 'manual',
        factor: Number(factor),
        unit: normalizedUnit,
        referenceValue: Number(referenceValue),
    });
    return true;
}
