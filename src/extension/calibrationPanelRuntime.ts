import * as vscode from 'vscode';
import { getStrings } from '../shared/i18n/strings';
import { isConfigureCalibrationMessage } from '../shared/utils/audioTarget';
import { ComparisonPanel } from '../webview/panels/ComparisonPanel';
import type { CalibrationStore } from './calibrationStore';

const panelMessageDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();
const panelLifecycleInstalled = new WeakSet<vscode.WebviewPanel>();
let installed = false;
let activePanel: vscode.WebviewPanel | undefined;

async function configureActivePanel(store: CalibrationStore): Promise<void> {
    const strings = getStrings(vscode.env.language);
    const panel = activePanel;
    if (!panel) {
        void vscode.window.showInformationMessage(strings.calibrationNoPanel);
        return;
    }
    const available = ComparisonPanel.getResults(panel).filter((result) => !result.error && result.channels.length > 0);
    if (available.length === 0) {
        void vscode.window.showInformationMessage(strings.calibrationNoChannels);
        return;
    }
    let selected = available[0];
    if (available.length > 1) {
        const picked = await vscode.window.showQuickPick(
            available.map((result) => ({ label: result.fileName, description: result.filePath, result })),
            { placeHolder: strings.calibrationPickTrack, matchOnDescription: true },
        );
        if (!picked) {
            return;
        }
        selected = picked.result;
    }
    await store.configureTrack(selected);
}

let calibrationStore: CalibrationStore;

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
                await calibrationStore.configureTrack(result);
            }
            return;
        }
    });
    panelMessageDisposables.set(panel, disposable);
}

export function installCalibrationPanelRuntime(extensionContext: vscode.ExtensionContext, store: CalibrationStore): void {
    calibrationStore = store;
    if (installed) {
        return;
    }
    installed = true;

    ComparisonPanel.setShownListener(installOnPanel);

    extensionContext.subscriptions.push(
        vscode.commands.registerCommand('audioWandasAnalyzer.configureCalibration', async () => {
            await configureActivePanel(store);
        }),
    );
}
