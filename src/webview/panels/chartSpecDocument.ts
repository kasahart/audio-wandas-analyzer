import { escapeHtml, serializeForScript } from '../../shared/utils/webviewEscaping';
import type { ChartSpec } from '../../shared/chartSpec';
import { getStrings, pickLocale, type UiStrings } from '../../shared/i18n/strings';
import { getChartSpecRenderScript } from '../chartSpecRenderScript';

/** Globals the ChartSpec render script reads once when it loads. */
export interface ChartSpecGlobals {
    __CHART_SPECS__: ChartSpec[];
    __CHART_NO_RESULTS_LABEL__: string;
    __CHART_SCALAR_HEADERS__: [string, string, string];
}

export function chartSpecGlobals(charts: ChartSpec[], strings: UiStrings): ChartSpecGlobals {
    return {
        __CHART_SPECS__: charts,
        __CHART_NO_RESULTS_LABEL__: strings.chartSpecNoResults,
        __CHART_SCALAR_HEADERS__: [
            strings.chartSpecScalarLabelHeader,
            strings.chartSpecScalarValueHeader,
            strings.chartSpecScalarUnitHeader,
        ],
    };
}

export function renderChartSpecStyles(): string {
    return `:root {
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
canvas { display: block; max-width: 100%; }`;
}

export interface ChartSpecDocumentOptions {
    language: string;
    nonce: string;
}

/** Complete HTML document for a recipe result: used by the VS Code panel; the Web host mounts the same pieces in a frame. */
export function renderChartSpecDocument(title: string, charts: ChartSpec[], options: ChartSpecDocumentOptions): string {
    const strings = getStrings(options.language);
    const locale = pickLocale(options.language);
    const globals = chartSpecGlobals(charts, strings);
    return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${options.nonce}'; style-src 'unsafe-inline';">
<title>${escapeHtml(title)}</title>
<style>
${renderChartSpecStyles()}
</style>
</head>
<body>
<h2>${escapeHtml(title)}</h2>
<div id="charts"></div>
<script nonce="${options.nonce}">
window.__CHART_SPECS__ = ${serializeForScript(globals.__CHART_SPECS__)};
window.__CHART_NO_RESULTS_LABEL__ = ${serializeForScript(globals.__CHART_NO_RESULTS_LABEL__)};
window.__CHART_SCALAR_HEADERS__ = ${serializeForScript(globals.__CHART_SCALAR_HEADERS__)};
</script>
<script nonce="${options.nonce}">${getChartSpecRenderScript()}</script>
</body>
</html>`;
}
