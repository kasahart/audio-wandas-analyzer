import * as vscode from 'vscode';
import type { ChartSpec } from '../../shared/chartSpec';
import { renderChartSpecDocument } from './chartSpecDocument';

export class ChartSpecPanel {
    public static show(extensionUri: vscode.Uri, title: string, charts: ChartSpec[]): vscode.WebviewPanel {
        const panel = vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.chartSpec',
            title,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
            },
        );
        const language = typeof vscode.env?.language === 'string' ? vscode.env.language : 'en';
        panel.webview.html = renderChartSpecDocument(title, charts, { language, nonce: Date.now().toString() });
        return panel;
    }
}
