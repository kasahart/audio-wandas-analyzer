import * as vscode from 'vscode';
import type { AnalysisResultWithError, SpectrogramSettings } from '../shared/analysis/analysisTypes';
import { isConfigureCalibrationMessage } from '../shared/utils/audioTarget';
import { ComparisonPanel } from '../webview/panels/ComparisonPanel';
import { PythonBackendServer } from './pythonBackendServer';
import {
    configureCalibrationProfile,
    discardMismatchedCalibrationProfile,
    getAnalysisRevision,
    getCalibrationProfile,
    type CalibrationChannelDescriptor,
} from './calibrationStore';

const panelMessageDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();
const panelLifecycleInstalled = new WeakSet<vscode.WebviewPanel>();
let installed = false;
let backendPatched = false;
let activePanel: vscode.WebviewPanel | undefined;

function channelDescriptors(result: AnalysisResultWithError): CalibrationChannelDescriptor[] {
    return (result.channels ?? []).map((channel, channelIndex) => ({
        channelIndex,
        label: channel.label || `Channel ${channelIndex + 1}`,
        measurement: channel.measurement,
    }));
}

async function configureChannels(
    extensionContext: vscode.ExtensionContext,
    filePath: string,
    channels: CalibrationChannelDescriptor[],
): Promise<void> {
    await configureCalibrationProfile(
        extensionContext,
        filePath,
        channels,
    );
}

async function configureResult(
    extensionContext: vscode.ExtensionContext,
    result: AnalysisResultWithError,
): Promise<void> {
    await configureChannels(extensionContext, result.filePath, channelDescriptors(result));
}

async function configureActivePanel(extensionContext: vscode.ExtensionContext): Promise<void> {
    const panel = activePanel;
    if (!panel) {
        void vscode.window.showInformationMessage('Open an audio analysis panel before configuring calibration.');
        return;
    }
    const available = ComparisonPanel.getResults(panel).filter((result) => !result.error && result.channels.length > 0);
    if (available.length === 0) {
        void vscode.window.showInformationMessage('The active analysis panel has no calibratable audio channels.');
        return;
    }
    let selected = available[0];
    if (available.length > 1) {
        const picked = await vscode.window.showQuickPick(
            available.map((result) => ({ label: result.fileName, description: result.filePath, result })),
            { placeHolder: 'Select a track to calibrate', matchOnDescription: true },
        );
        if (!picked) {
            return;
        }
        selected = picked.result;
    }
    await configureResult(extensionContext, selected);
}

const originalShow = ComparisonPanel.show.bind(ComparisonPanel);
const originalShowDirectorySelection = ComparisonPanel.showDirectorySelection.bind(ComparisonPanel);
let contextExtension: vscode.ExtensionContext;

function installPanelLifecycle(panel: vscode.WebviewPanel): void {
    if (panelLifecycleInstalled.has(panel)) {
        return;
    }
    panelLifecycleInstalled.add(panel);
    panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.active) {
            activePanel = event.webviewPanel;
        } else if (activePanel === event.webviewPanel) {
            activePanel = undefined;
        }
    });
    panel.onDidDispose(() => {
        panelMessageDisposables.get(panel)?.dispose();
        panelMessageDisposables.delete(panel);
        if (activePanel === panel) {
            activePanel = undefined;
        }
    });
}

function installOnPanel(panel: vscode.WebviewPanel): void {
    if (panel.active) {
        activePanel = panel;
    }
    installPanelLifecycle(panel);

    panelMessageDisposables.get(panel)?.dispose();
    const disposable = panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (isConfigureCalibrationMessage(message)) {
            const result = ComparisonPanel.getResults(panel).find(
                (candidate) => candidate.filePath === message.filePath,
            );
            if (result) {
                await configureResult(contextExtension, result);
            }
            return;
        }
    });
    panelMessageDisposables.set(panel, disposable);
}

function patchBackendCalibration(extensionContext: vscode.ExtensionContext): void {
    if (backendPatched) {
        return;
    }
    backendPatched = true;
    const prototype = PythonBackendServer.prototype;
    const analyze = prototype.analyze;
    const requestRange = prototype.requestRange;
    const requestTrackDetail = prototype.requestTrackDetail;
    const requestSpectrumSlice = prototype.requestSpectrumSlice;

    prototype.analyze = async function(filePath, options) {
        const calibrationProfile = getCalibrationProfile(extensionContext, filePath);
        try {
            return await analyze.call(this, filePath, {
                ...options,
                calibrationProfile,
                analysisRevision: getAnalysisRevision(filePath),
            });
        } catch (error) {
            const discarded = await discardMismatchedCalibrationProfile(extensionContext, filePath, error);
            if (!discarded) {
                throw error;
            }
            return analyze.call(this, filePath, {
                ...options,
                calibrationProfile: undefined,
                analysisRevision: getAnalysisRevision(filePath),
            });
        }
    };
    prototype.requestRange = function(filePath, startNorm, endNorm, points, requestId, calibration = {}) {
        return requestRange.call(
            this,
            filePath,
            startNorm,
            endNorm,
            points,
            requestId,
            {
                ...calibration,
                calibrationProfile: getCalibrationProfile(extensionContext, filePath),
                analysisRevision: getAnalysisRevision(filePath),
            },
        );
    };
    prototype.requestTrackDetail = function(filePath, payload, requestId) {
        return requestTrackDetail.call(this, filePath, {
            ...payload,
            calibrationProfile: getCalibrationProfile(extensionContext, filePath),
            analysisRevision: getAnalysisRevision(filePath),
        }, requestId);
    };
    prototype.requestSpectrumSlice = function(filePath, payload, requestId) {
        return requestSpectrumSlice.call(this, filePath, {
            ...payload,
            calibrationProfile: getCalibrationProfile(extensionContext, filePath),
            analysisRevision: getAnalysisRevision(filePath),
        }, requestId);
    };
}

export function installCalibrationPanelRuntime(extensionContext: vscode.ExtensionContext): void {
    contextExtension = extensionContext;
    patchBackendCalibration(extensionContext);
    if (installed) {
        return;
    }
    installed = true;

    ComparisonPanel.show = function(
        extensionUri: vscode.Uri,
        results: AnalysisResultWithError[],
        existingPanel?: vscode.WebviewPanel,
        spectrogramSettings?: SpectrogramSettings,
    ): vscode.WebviewPanel {
        const resolvedSettings = spectrogramSettings ?? {
            auto: true,
            stft: { nFft: 1024, hopSize: 256, window: 'hann' },
            display: { dbMin: null, dbMax: null, maxFrequencyHz: null },
        };
        const panel = originalShow(extensionUri, results, existingPanel, resolvedSettings);
        installOnPanel(panel);
        return panel;
    };

    ComparisonPanel.showDirectorySelection = function(
        extensionUri: vscode.Uri,
        rootPath: string,
        allFilePaths: string[],
        selectedFilePaths: string[],
        results: AnalysisResultWithError[],
        pythonEnvironmentState: {
            pythonCommand: string;
            status: 'normal' | 'warning';
            tooltip: string;
        },
        existingPanel?: vscode.WebviewPanel,
        spectrogramSettings?: SpectrogramSettings,
    ): vscode.WebviewPanel {
        const resolvedSettings = spectrogramSettings ?? {
            auto: true,
            stft: { nFft: 1024, hopSize: 256, window: 'hann' },
            display: { dbMin: null, dbMax: null, maxFrequencyHz: null },
        };
        const panel = originalShowDirectorySelection(
            extensionUri,
            rootPath,
            allFilePaths,
            selectedFilePaths,
            results,
            pythonEnvironmentState,
            existingPanel,
            resolvedSettings,
        );
        installOnPanel(panel);
        return panel;
    };

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('audioWandasAnalyzer.configureCalibration', async () => {
            await configureActivePanel(extensionContext);
        }),
    );
}
