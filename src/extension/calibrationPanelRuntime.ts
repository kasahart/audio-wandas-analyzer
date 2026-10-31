import * as vscode from 'vscode';
import { getStrings } from '../shared/i18n/strings';
import { ComparisonPanel } from '../webview/panels/ComparisonPanel';
import type { CalibrationStore } from './calibrationStore';

/**
 * The Configure Calibration command: it acts on the comparison panel in front. A panel's own calibration button
 * reaches the store through that panel's message handler (PanelController), not through here.
 */
export class CalibrationPanels implements vscode.Disposable {
    private readonly tracked = new WeakSet<vscode.WebviewPanel>();
    private activePanel: vscode.WebviewPanel | undefined;
    private readonly command: vscode.Disposable;

    constructor(private readonly store: Pick<CalibrationStore, 'configureTrack'>) {
        ComparisonPanel.setShownListener((panel) => { this.track(panel); });
        this.command = vscode.commands.registerCommand('audioWandasAnalyzer.configureCalibration', async () => {
            await this.configureActivePanel();
        });
    }

    dispose(): void {
        this.command.dispose();
        this.activePanel = undefined;
    }

    private track(panel: vscode.WebviewPanel): void {
        if (panel.active) {
            this.activePanel = panel;
        }
        if (this.tracked.has(panel)) {
            return;
        }
        this.tracked.add(panel);
        panel.onDidChangeViewState((event) => {
            if (event.webviewPanel.active) {
                this.activePanel = event.webviewPanel;
            } else if (this.activePanel === event.webviewPanel) {
                this.activePanel = undefined;
            }
        });
        panel.onDidDispose(() => {
            if (this.activePanel === panel) {
                this.activePanel = undefined;
            }
        });
    }

    private async configureActivePanel(): Promise<void> {
        const strings = getStrings(vscode.env.language);
        const panel = this.activePanel;
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
        await this.store.configureTrack(selected);
    }
}
