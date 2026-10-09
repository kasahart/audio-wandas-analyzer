import * as vscode from 'vscode';
import type {
    AnalysisResultWithError,
} from '../shared/analysis/analysisTypes';
import { isConfigureCalibrationMessage } from '../shared/utils/audioTarget';
import { ComparisonPanel } from '../webview/panels/ComparisonPanel';
import {
    configureCalibrationProfile,
} from './calibrationStore';
import type { CalibrationChannelDescriptor } from '../shared/analysis/calibrationModel';

const panelMessageDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();
const panelLifecycleInstalled = new WeakSet<vscode.WebviewPanel>();
let installed = false;
let activePanel: vscode.WebviewPanel | undefined;

function channelDescriptors(result: AnalysisResultWithError): CalibrationChannelDescriptor[] {
    return (result.channels ?? []).map((channel, channelIndex) => ({
        channelIndex,
        label: channel.label || `Channel ${channelIndex + 1}`,
        measurement: channel.measurement,
        rawPeakFullScale: channel.rawPeakFullScale,
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

export function installCalibrationPanelRuntime(extensionContext: vscode.ExtensionContext): void {
    contextExtension = extensionContext;
    if (installed) {
        return;
    }
    installed = true;

    ComparisonPanel.setShownListener(installOnPanel);

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('audioWandasAnalyzer.configureCalibration', async () => {
            await configureActivePanel(extensionContext);
        }),
    );
}
