import {
    cloneProfile, identityChannel, profilesEqual,
    validateCalibrationValueInput, validateCalibrationFactorInput, profileForChannels,
    type CalibrationChannelDescriptor,
} from '../shared/analysis/calibrationModel';
import { fillTemplate, getStrings, type UiStrings } from '../shared/i18n/strings';
import { backendErrorCode } from '../shared/protocol/backendProtocol';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
    CalibrationProfile,
    ChannelCalibrationDefinition,
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


function profiles(context: vscode.ExtensionContext): Record<string, CalibrationProfile> {
    return context.workspaceState.get<Record<string, CalibrationProfile>>(CALIBRATION_PROFILES_KEY, {});
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

export async function discardStaleCalibrationProfile(
    context: vscode.ExtensionContext,
    filePath: string,
    error: unknown,
    failedProfile: CalibrationProfile,
): Promise<boolean> {
    if (backendErrorCode(error) !== 'stale-calibration') {
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


function describeCalibration(strings: UiStrings, channel: ChannelCalibrationDefinition): string {
    if (channel.status === 'uncalibrated') {
        return strings.calFullScale;
    }
    const level = channel.unit === 'Pa' && channel.referenceValue === 2e-5
        ? 'dB SPL re 20 µPa'
        : `dB re ${channel.referenceValue} ${channel.unit}`;
    return fillTemplate(strings.calSummary, { factor: channel.factor, unit: channel.unit, level });
}

export async function configureCalibrationProfile(
    context: vscode.ExtensionContext,
    filePath: string,
    channels: CalibrationChannelDescriptor[],
): Promise<boolean> {
    const strings = getStrings(vscode.env.language);
    const channelName = (index: number, label: string): string => fillTemplate(strings.calChannelLabel, { n: index + 1, label });
    if (channels.length === 0) {
        void vscode.window.showInformationMessage(strings.calNoChannels);
        return false;
    }

    const current = profileForChannels(getCalibrationProfile(context, filePath), channels);
    const resetAll = Symbol('reset-all');
    const picked = await vscode.window.showQuickPick(
        [
            {
                label: `$(discard) ${strings.calResetAllLabel}`,
                description: strings.calResetAllDescription,
                value: resetAll,
            },
            ...channels.map((channel) => ({
                label: `$(settings-gear) ${channelName(channel.channelIndex, channel.label)}`,
                description: describeCalibration(strings, current.channels[channel.channelIndex]),
                value: channel.channelIndex,
            })),
        ],
        {
            placeHolder: fillTemplate(strings.calConfigurePlaceholder, { file: path.basename(filePath) }),
            matchOnDescription: true,
        },
    );
    if (!picked) {
        return false;
    }

    if (picked.value === resetAll) {
        await persistProfile(context, filePath, () => undefined);
        void vscode.window.showInformationMessage(fillTemplate(strings.calResetDone, { file: path.basename(filePath) }));
        return true;
    }

    const channelIndex = picked.value as number;
    const channel = channels.find((candidate) => candidate.channelIndex === channelIndex);
    if (!channel) {
        throw new Error(`Calibration channel was not found: ${channelIndex}`);
    }
    const existing = current.channels[channelIndex] ?? identityChannel(channel);
    const name = channelName(channelIndex, channel.label);
    const mode = await vscode.window.showQuickPick(
        [
            {
                label: strings.calModeCalibratedLabel,
                description: strings.calModeCalibratedDescription,
                value: 'calibrated' as const,
            },
            {
                label: strings.calModeUncalibratedLabel,
                description: strings.calModeUncalibratedDescription,
                value: 'uncalibrated' as const,
            },
        ],
        {
            placeHolder: name,
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
        title: fillTemplate(strings.calFactorTitle, { channel: name }),
        prompt: strings.calFactorPrompt,
        value: existing.status === 'calibrated' ? String(existing.factor) : '1',
        validateInput: (value) => validateCalibrationFactorInput(value, channel.rawPeakFullScale),
    });
    if (factor === undefined) {
        return false;
    }

    const unit = await vscode.window.showInputBox({
        title: fillTemplate(strings.calUnitTitle, { channel: name }),
        prompt: strings.calUnitPrompt,
        value: existing.status === 'calibrated' ? existing.unit : 'Pa',
        validateInput: (value) => value.trim() ? undefined : strings.calUnitRequired,
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
        title: fillTemplate(strings.calReferenceTitle, { channel: name }),
        prompt: normalizedUnit === 'Pa'
            ? strings.calReferencePromptPa
            : fillTemplate(strings.calReferencePrompt, { unit: normalizedUnit }),
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
