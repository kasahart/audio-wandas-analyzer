import * as vscode from 'vscode';
import { escapeHtml, serializeForScript } from '../../shared/utils/webviewEscaping';
import type { ChartSpec } from '../../shared/chartSpec';
import { getStrings, pickLocale } from '../../shared/i18n/strings';
import { getChartSpecRenderScript } from '../chartSpecRenderScript';

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
        panel.webview.html = ChartSpecPanel.renderHtml(title, charts);
        return panel;
    }

    private static renderHtml(title: string, charts: ChartSpec[]): string {
        const nonce = Date.now().toString();
        const serialized = serializeForScript(charts);
        const renderScript = getChartSpecRenderScript();
        const language = typeof vscode.env?.language === 'string' ? vscode.env.language : 'en';
        const strings = getStrings(language);
        const locale = pickLocale(language);
        return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<title>${escapeHtml(title)}</title>
<style>
:root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --panel: var(--vscode-editorWidget-background, #252526);
    --text: var(--vscode-editor-foreground, #ddd);
    --muted: var(--vscode-descriptionForeground, #999);
    --line: var(--vscode-editorWidget-border, #444);
    --accent: var(--vscode-textLink-foreground, #4ea1ff);
}
body { background: var(--bg); color: var(--text); font-family: var(--vscode-font-family, sans-serif); padding: 12px; margin: 0; }
h2 { font-size: 14px; margin: 0 0 12px; color: var(--accent); }
.chart-card { background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 10px 12px; margin-bottom: 12px; }
.chart-title { font-size: 12px; margin: 0 0 6px; color: var(--text); font-weight: 600; }
.scalar-table { border-collapse: collapse; font-size: 12px; }
.scalar-table th, .scalar-table td { border-bottom: 1px solid var(--line); padding: 4px 12px 4px 0; text-align: left; }
.scalar-table th { color: var(--muted); font-weight: 600; }
canvas { display: block; }
</style>
</head>
<body>
<h2>${escapeHtml(title)}</h2>
<div id="charts"></div>
<script nonce="${nonce}">
window.__CHART_SPECS__ = ${serialized};
window.__CHART_NO_RESULTS_LABEL__ = ${serializeForScript(strings.chartSpecNoResults)};
</script>
<script nonce="${nonce}">${renderScript}</script>
</body>
</html>`;
    }
}

