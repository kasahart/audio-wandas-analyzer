import * as vscode from 'vscode';
import type { ChartSpec } from '../../shared/chartSpec';
import { renderChartSpecDocument } from './chartSpecDocument';
import { createNonce } from './nonce';

export class ChartSpecPanel {
    public static show(extensionUri: vscode.Uri, title: string, charts: ChartSpec[]): vscode.WebviewPanel {
        const panel = vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.chartSpec',
            title,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
            },
        );
        const language = typeof vscode.env?.language === 'string' ? vscode.env.language : 'en';
        panel.webview.html = renderChartSpecDocument(title, charts, {
            language,
            nonce: createNonce(),
            rendererScriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'chartSpecRuntime.js')).toString(),
            cspSource: panel.webview.cspSource,
        });
        return panel;
    }
}
