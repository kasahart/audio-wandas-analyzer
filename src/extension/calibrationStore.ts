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
    AnalysisResultWithError,
    CalibrationProfile,
    ChannelCalibrationDefinition,
} from '../shared/analysis/analysisTypes';

const CALIBRATION_PROFILES_KEY = 'audioWandasAnalyzer.calibrationProfiles.v1';
const PROFILE_UNCHANGED = Symbol('profile-unchanged');

export interface CalibrationChangeEvent {
    /** Canonical key from {@link calibrationFileKey}; compare it to a panel's paths through that same function. */
    filePath: string;
    analysisRevision: number;
}

/**
 * Canonical identity of an audio file for calibration state: absolute and symlink-free, so '/tmp/a.wav' and
 * '/private/tmp/a.wav' (macOS) or 'c:\\x.wav' and 'C:\\x.wav' (Windows) share one profile and revision.
 */
export function calibrationFileKey(filePath: string): string {
    const resolved = path.resolve(filePath);
    try {
        return fs.realpathSync.native(resolved);
    } catch {
        return resolved;
    }
}

function channelDescriptors(result: AnalysisResultWithError): CalibrationChannelDescriptor[] {
    return (result.channels ?? []).map((channel, channelIndex) => ({
        channelIndex,
        label: channel.label || fillTemplate(getStrings(vscode.env.language).calibrationChannelFallback, { n: channelIndex + 1 }),
        measurement: channel.measurement,
        rawPeakFullScale: channel.rawPeakFullScale,
    }));
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

/**
 * The workspace's calibration profiles and their analysis revisions. One store per activation owns the revision
 * counters, the change listeners and the write queue, so a test's store shares nothing with another's.
 */
export class CalibrationStore {
    private readonly analysisRevisions = new Map<string, number>();
    private readonly listeners = new Set<(event: CalibrationChangeEvent) => void>();
    private writeQueue: Promise<void> | undefined;

    constructor(private readonly context: Pick<vscode.ExtensionContext, 'workspaceState'>) {}

    onDidChange(listener: (event: CalibrationChangeEvent) => void): vscode.Disposable {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    profile(filePath: string): CalibrationProfile | undefined {
        const stored = this.profiles()[calibrationFileKey(filePath)];
        return stored ? cloneProfile(stored) : undefined;
    }

    analysisRevision(filePath: string): number {
        return this.analysisRevisions.get(calibrationFileKey(filePath)) ?? 0;
    }

    async discardStale(filePath: string, error: unknown, failedProfile: CalibrationProfile): Promise<boolean> {
        if (backendErrorCode(error) !== 'stale-calibration') {
            return false;
        }
        let discarded = false;
        await this.persistProfile(filePath, (current) => {
            if (!current || !profilesEqual(current, failedProfile)) {
                return PROFILE_UNCHANGED;
            }
            discarded = true;
            return undefined;
        });
        return discarded;
    }

    /** Asks for one channel's calibration of a displayed track and stores it; the channels come from the track, not the Webview. */
    async configureTrack(result: AnalysisResultWithError): Promise<void> {
        await this.configureProfile(result.filePath, channelDescriptors(result));
    }

    async configureProfile(filePath: string, channels: CalibrationChannelDescriptor[]): Promise<boolean> {
        const strings = getStrings(vscode.env.language);
        const channelName = (index: number, label: string): string => fillTemplate(strings.calChannelLabel, { n: index + 1, label });
        if (channels.length === 0) {
            void vscode.window.showInformationMessage(strings.calNoChannels);
            return false;
        }

        const current = profileForChannels(this.profile(filePath), channels);
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
            await this.persistProfile(filePath, () => undefined);
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
            await this.persistChannel(filePath, channels, channelIndex, identityChannel(channel));
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

        await this.persistChannel(filePath, channels, channelIndex, {
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

    private profiles(): Record<string, CalibrationProfile> {
        return this.context.workspaceState.get<Record<string, CalibrationProfile>>(CALIBRATION_PROFILES_KEY, {});
    }

    private bumpAnalysisRevision(canonicalPath: string): number {
        const next = (this.analysisRevisions.get(canonicalPath) ?? 0) + 1;
        this.analysisRevisions.set(canonicalPath, next);
        return next;
    }

    private async persistProfile(
        filePath: string,
        updateProfile: (
            current: CalibrationProfile | undefined,
        ) => CalibrationProfile | undefined | typeof PROFILE_UNCHANGED,
    ): Promise<void> {
        const key = calibrationFileKey(filePath);
        const previous = this.writeQueue ?? Promise.resolve();
        const operation = previous.catch(() => undefined).then(async () => {
            const next = { ...this.profiles() };
            const current = next[key] ? cloneProfile(next[key]) : undefined;
            const updated = updateProfile(current);
            if (updated === PROFILE_UNCHANGED) { return; }
            if (updated) {
                next[key] = cloneProfile(updated);
            } else {
                delete next[key];
            }
            await this.context.workspaceState.update(CALIBRATION_PROFILES_KEY, next);
            const analysisRevision = this.bumpAnalysisRevision(key);
            for (const listener of this.listeners) {
                listener({ filePath: key, analysisRevision });
            }
        });
        this.writeQueue = operation;
        try {
            await operation;
        } finally {
            if (this.writeQueue === operation) {
                this.writeQueue = undefined;
            }
        }
    }

    private async persistChannel(
        filePath: string,
        channels: CalibrationChannelDescriptor[],
        channelIndex: number,
        channel: ChannelCalibrationDefinition,
    ): Promise<void> {
        await this.persistProfile(filePath, (stored) => {
            const latest = profileForChannels(stored, channels);
            latest.channels[channelIndex] = channel;
            return latest.channels.some((entry) => entry.status === 'calibrated') ? latest : undefined;
        });
    }
}
