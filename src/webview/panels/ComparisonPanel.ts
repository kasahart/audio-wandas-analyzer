import * as path from 'path';
import * as vscode from 'vscode';
import { escapeHtml, serializeForScript } from '../../shared/utils/webviewEscaping';
import { getComparisonRenderScript } from '../comparisonRenderScript';
import { getStrings, pickLocale } from '../../shared/i18n/strings';
import {
    DEFAULT_SPECTROGRAM_SETTINGS,
    type AnalysisResultWithError,
    type DirectoryTreeNode,
    type SpectrogramSettings,
} from '../../shared/analysis/analysisTypes';

interface ComparisonTrackState extends AnalysisResultWithError {
    audioSource?: string;
}

interface ComparisonResultsState {
    mode: 'results';
    results: ComparisonTrackState[];
    spectrogramSettings: SpectrogramSettings;
}

interface DirectorySelectionState {
    mode: 'directory-selection';
    results: ComparisonTrackState[];
    rootPath: string;
    directoryTree: DirectoryTreeNode[];
    allFilePaths: string[];
    selectedFilePaths: string[];
    pythonEnvironmentState: {
        pythonCommand: string;
        status: 'normal' | 'warning';
        tooltip: string;
    };
    spectrogramSettings: SpectrogramSettings;
}

export type ComparisonState = ComparisonResultsState | DirectorySelectionState;

interface ComparisonPanelTestSnapshot {
    title: string;
    html: string;
    fileNames: string[];
    resultCount: number;
    lastActionId?: string;
    renderedUi?: ComparisonPanelRenderedUi;
}

interface ComparisonPanelRenderedUi {
    hasToolbar: boolean;
    toolbarActions: string[];
    trackRowCount: number;
    audioElementCount: number;
    hasRulerCanvas: boolean;
    zoomStart: number;
    zoomEnd: number;
    cursorNorm: number;
    spectrumOverlayPresent: boolean;
    spectrumTrackCanvasCount: number;
    visibleSpectrumTrackCount: number;
    latestSpectrogram?: {
        windowSize: number;
        hopSize: number;
        dbMinApplied: number | null;
        dbMaxApplied: number | null;
        maxFrequencyHzApplied: number | null;
    };
    axisLabels: {
        spectrumOverlay: string[];
        spectrogramPerTrack: string[][];
        spectrumPerTrack: string[][];
        waveformPerTrack: string[][];
    };
    tracks: Array<{
        trackIndex: number;
        offsetSeconds: number;
        visibleFileStartNorm: number;
        visibleFileEndNorm: number;
        waveformFullyVisible: boolean;
        waveformCoversViewportLeft: boolean;
        waveformCoversViewportRight: boolean;
        waveformMinDrawX: number | null;
        waveformMaxDrawX: number | null;
        waveformCanvasWidth: number | null;
        resultError: string | null;
        spectrumCanvasPresent: boolean;
        spectrumSlicePresent: boolean;
    }>;
}

interface ComparisonPanelRenderedUiMessage {
    type: 'comparison-panel-test-snapshot';
    renderedUi: ComparisonPanelRenderedUi;
    actionId?: string;
}

interface ComparisonPanelTestActionMessage {
    type: 'comparison-panel-test-action';
    actionId: string;
    actions: Array<string | { action: string; trackIndex?: number; payload?: Record<string, unknown> }>;
}

export class ComparisonPanel {
    private static testSnapshot: ComparisonPanelTestSnapshot | undefined;
    private static activePanel: vscode.WebviewPanel | undefined;
    private static testMessageDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();

    public static show(
        extensionUri: vscode.Uri,
        results: AnalysisResultWithError[],
        existingPanel?: vscode.WebviewPanel,
        spectrogramSettings: SpectrogramSettings = DEFAULT_SPECTROGRAM_SETTINGS,
    ): vscode.WebviewPanel {
        const title = results.length === 1
            ? `Audio Analyzer: ${results[0].fileName}`
            : `Audio Compare: ${results.map((r) => r.fileName).join(', ')}`;

        const localResourceRoots = ComparisonPanel.buildLocalResourceRoots(extensionUri, results);
        const panel = existingPanel ?? vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.comparison',
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots,
            },
        );

        panel.title = title;
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots,
        };
        panel.reveal(vscode.ViewColumn.One, true);
        ComparisonPanel.activePanel = panel;
        panel.onDidDispose(() => {
            if (ComparisonPanel.activePanel === panel) {
                ComparisonPanel.activePanel = undefined;
            }
        });
        ComparisonPanel.testMessageDisposables.get(panel)?.dispose();
        const testMessageDisposable = panel.webview.onDidReceiveMessage((message: unknown) => {
            if (!ComparisonPanel.isRenderedUiMessage(message)) {
                return;
            }

            if (!ComparisonPanel.testSnapshot) {
                return;
            }

            ComparisonPanel.testSnapshot = {
                ...ComparisonPanel.testSnapshot,
                lastActionId: message.actionId,
                renderedUi: message.renderedUi,
            };
        });
        ComparisonPanel.testMessageDisposables.set(panel, testMessageDisposable);

        const state: ComparisonResultsState = {
            mode: 'results',
            results: results.map((result) => ({
                ...result,
                audioSource: panel.webview.asWebviewUri(vscode.Uri.file(result.filePath)).toString(),
            })),
            spectrogramSettings,
        };
        const html = renderComparisonHtml(panel.webview, state, extensionUri);
        panel.webview.html = html;
        ComparisonPanel.testSnapshot = {
            title,
            html,
            fileNames: state.results.map((result) => result.fileName),
            resultCount: state.results.length,
        };
        return panel;
    }

    public static showDirectorySelection(
        extensionUri: vscode.Uri,
        rootPath: string,
        directoryTree: DirectoryTreeNode[],
        allFilePaths: string[],
        selectedFilePaths: string[],
        results: AnalysisResultWithError[],
        pythonEnvironmentState: DirectorySelectionState['pythonEnvironmentState'],
        existingPanel?: vscode.WebviewPanel,
        spectrogramSettings: SpectrogramSettings = DEFAULT_SPECTROGRAM_SETTINGS,
    ): vscode.WebviewPanel {
        const title = `Audio Analyzer: ${path.basename(rootPath) || rootPath}`;
        const panel = existingPanel ?? vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.comparison',
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: ComparisonPanel.buildLocalResourceRoots(extensionUri, results),
            },
        );

        panel.title = title;
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: ComparisonPanel.buildLocalResourceRoots(extensionUri, results),
        };
        panel.reveal(vscode.ViewColumn.One, true);
        ComparisonPanel.activePanel = panel;
        panel.onDidDispose(() => {
            if (ComparisonPanel.activePanel === panel) {
                ComparisonPanel.activePanel = undefined;
            }
        });
        ComparisonPanel.testMessageDisposables.get(panel)?.dispose();
        const testMessageDisposable = panel.webview.onDidReceiveMessage((message: unknown) => {
            if (!ComparisonPanel.isRenderedUiMessage(message)) {
                return;
            }

            if (!ComparisonPanel.testSnapshot) {
                return;
            }

            ComparisonPanel.testSnapshot = {
                ...ComparisonPanel.testSnapshot,
                lastActionId: message.actionId,
                renderedUi: message.renderedUi,
            };
        });
        ComparisonPanel.testMessageDisposables.set(panel, testMessageDisposable);

        const state: DirectorySelectionState = {
            mode: 'directory-selection',
            results: results.map((result) => ({
                ...result,
                audioSource: panel.webview.asWebviewUri(vscode.Uri.file(result.filePath)).toString(),
            })),
            rootPath,
            directoryTree,
            allFilePaths,
            selectedFilePaths,
            pythonEnvironmentState,
            spectrogramSettings,
        };
        const html = renderComparisonHtml(panel.webview, state, extensionUri);
        panel.webview.html = html;
        ComparisonPanel.testSnapshot = {
            title,
            html,
            fileNames: state.results.map((result) => result.fileName),
            resultCount: state.results.length,
        };
        return panel;
    }

    public static getTestSnapshot(): ComparisonPanelTestSnapshot | undefined {
        return ComparisonPanel.testSnapshot;
    }

    public static clearTestSnapshot(): void {
        ComparisonPanel.testSnapshot = undefined;
    }

    public static async postTestActions(
        actionId: string,
        actions: Array<string | { action: string; trackIndex?: number; payload?: Record<string, unknown> }>,
    ): Promise<void> {
        if (!ComparisonPanel.activePanel) {
            throw new Error('No active ComparisonPanel is available for test actions');
        }

        const delivered = await ComparisonPanel.activePanel.webview.postMessage({
            type: 'comparison-panel-test-action',
            actionId,
            actions,
        } satisfies ComparisonPanelTestActionMessage);

        if (!delivered) {
            throw new Error('ComparisonPanel test actions could not be delivered to the webview');
        }
    }

    private static isRenderedUiMessage(message: unknown): message is ComparisonPanelRenderedUiMessage {
        if (!message || typeof message !== 'object') {
            return false;
        }

        const candidate = message as Partial<ComparisonPanelRenderedUiMessage>;
        return candidate.type === 'comparison-panel-test-snapshot'
            && !!candidate.renderedUi
            && Array.isArray(candidate.renderedUi.toolbarActions)
            && typeof candidate.renderedUi.trackRowCount === 'number';
    }

    private static buildLocalResourceRoots(
        extensionUri: vscode.Uri,
        results: AnalysisResultWithError[] = [],
    ): vscode.Uri[] {
        const roots = new Map<string, vscode.Uri>();
        const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media');
        roots.set(mediaRoot.toString(), mediaRoot);
        const webviewBuiltRoot = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
        roots.set(webviewBuiltRoot.toString(), webviewBuiltRoot);

        results.forEach((result) => {
            const audioDir = vscode.Uri.file(path.dirname(result.filePath));
            roots.set(audioDir.toString(), audioDir);
        });

        return Array.from(roots.values());
    }

    private static renderHtml(webview: vscode.Webview, state: ComparisonState, extensionUri: vscode.Uri): string {
        return renderComparisonHtml(webview, state, extensionUri);
    }

    private static renderStyles(): string {
        return renderComparisonStyles();
    }

    private static renderScript(): string {
        return renderComparisonScript();
    }
}

export function renderComparisonHtml(webview: vscode.Webview, state: ComparisonState, extensionUri: vscode.Uri): string {
    const nonce = Date.now().toString();
    const waveformScriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'comparisonWaveform.js'),
    );
    const language = typeof vscode.env?.language === 'string' ? vscode.env.language : 'en';
    const locale = pickLocale(language);
    const strings = getStrings(language);
    return `<!DOCTYPE html>
<html lang="${locale}">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; media-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(strings.panelTitle)}</title>
    <style>${renderComparisonStyles()}</style>
</head>
<body>
    <div id="app"></div>
    <script src="${waveformScriptUri}"></script>
    <script nonce="${nonce}">
        const __APP_STATE__ = ${serializeForScript(state)};
        const __APP_STRINGS__ = ${serializeForScript(strings)};
        const __APP_LOCALE__ = ${serializeForScript(locale)};
        ${renderComparisonScript()}
    </script>
    <div id="canvas-tooltip"></div>
</body>
</html>`;
}

export function renderComparisonStyles(): string {
    return `
        :root {
            color-scheme: light dark;
            --font-ui: var(--vscode-font-family, "Aptos", "Segoe UI", sans-serif);
            --font-mono: var(--vscode-editor-font-family, "Cascadia Mono", "SFMono-Regular", Consolas, monospace);
            --surface: #16181c;
            --panel: #1d2025;
            --line: #343942;
            --text: #d9dde3;
            --muted: #8f98a3;
            --accent: #0f7b6c;
            --track-bg: #090b0f;
            --track-header-bg: #14171c;
        }
        body.vscode-dark, body[data-theme-kind="dark"] {
            --surface: #1e1e1e;
            --panel: #252526;
            --line: #3c3c3c;
            --text: #cccccc;
            --muted: #888888;
            --track-bg: #0b0d10;
            --track-header-bg: #171a1f;
        }
        body.vscode-light, body[data-theme-kind="light"] {
            --surface: #ffffff;
            --panel: #f3f3f3;
            --line: #d4d4d4;
            --text: #1e1e1e;
            --muted: #6e7681;
            --track-bg: #f5f5f5;
            --track-header-bg: #ebebeb;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--surface); color: var(--text); font-family: var(--font-ui); overflow: hidden; height: 100vh; display: flex; flex-direction: column; }

        /* ── Toolbar ── */
        #toolbar {
            display: flex; align-items: center; gap: 8px; padding: 4px 10px;
            background: var(--panel); border-bottom: 1px solid var(--line);
            flex-shrink: 0; flex-wrap: wrap;
        }
        .tb-label { font-size: 11px; color: var(--muted); }
        .tb-btn {
            font-size: 11px; padding: 2px 8px; border-radius: 3px;
            border: 1px solid var(--line); background: var(--surface);
            color: var(--text); cursor: pointer;
        }
        .tb-btn.is-warning {
            background: var(--vscode-statusBarItem-warningBackground, #b89500);
            color: var(--vscode-statusBarItem-warningForeground, #111111);
            border-color: transparent;
        }
        .tb-btn.is-active { background: var(--accent); color: #fff; border-color: var(--accent); }
        .tb-btn:disabled { opacity: 0.4; cursor: default; }
        .tb-sep { width: 1px; height: 16px; background: var(--line); margin: 0 2px; }
        #cursor-display { font-size: 11px; font-family: var(--font-mono); color: var(--muted); min-width: 80px; }
        #playback-display { font-size: 11px; font-family: var(--font-mono); color: #64a0ff; min-width: 70px; display: none; }
        #loop-time-display { font-size: 0.85em; font-family: var(--font-mono); color: #64a0ff; margin-left: 6px; cursor: pointer; }

        #canvas-tooltip {
            position: fixed;
            background: rgba(30, 30, 30, 0.92);
            color: #ccc;
            font-size: 11px;
            padding: 4px 8px;
            border-radius: 4px;
            pointer-events: none;
            display: none;
            z-index: 100;
            white-space: pre;
            line-height: 1.6;
        }

        /* ── Track layout ── */
        #tracks-wrapper { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; background: var(--track-bg); }
        #ruler-row { display: flex; border-bottom: 1px solid var(--line); flex-shrink: 0; }
        #ruler-spacer { width: 130px; flex-shrink: 0; border-right: 1px solid var(--line); background: var(--track-header-bg); }
        #ruler-canvas { flex: 1; height: 20px; display: block; }

        .track-row { display: flex; border-bottom: 1px solid var(--line); flex-shrink: 0; }
        .track-header {
            width: 130px; flex-shrink: 0; border-right: 1px solid var(--line);
            padding: 5px 6px; display: flex; flex-direction: column; gap: 2px; font-size: 9px; background: var(--track-header-bg);
        }
        .track-name { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 600; }
        .clip-badge { display: inline-block; background: #d32f2f; color: #fff; font-size: 8px; font-weight: 700; border-radius: 2px; padding: 0px 3px; margin-left: 4px; vertical-align: middle; letter-spacing: 0.5px; cursor: default; }
        .track-meta { color: var(--muted); }
        .track-btns { display: flex; gap: 3px; margin-top: 2px; align-items: center; }
        .track-btn {
            font-size: 9px; padding: 1px 4px; border-radius: 2px;
            border: 1px solid var(--line); background: var(--surface);
            color: var(--muted); cursor: pointer;
        }
        .track-btn.is-playing { background: var(--accent); color: #fff; border-color: var(--accent); }
        .track-btn.is-muted { background: #555; color: #fff; }
        .track-btn.is-solo { background: #c8a020; color: #fff; border-color: #c8a020; }
        .track-offset { display: flex; align-items: center; gap: 2px; margin-top: 3px; }
        .track-offset-val {
            font-size: 9px; font-family: var(--font-mono);
            background: var(--surface); border: 1px solid var(--line);
            border-radius: 2px; padding: 1px 3px; width: 56px; text-align: right;
            cursor: text;
        }
        .track-offset-step { font-size: 9px; padding: 1px 3px; border-radius: 2px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); cursor: pointer; }
        .track-offset-input { width: 5em; font-size: inherit; font-family: var(--font-mono); text-align: right; background: var(--vscode-input-background, #1e1e1e); color: var(--vscode-input-foreground, #d4d4d4); border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 2px; }
        .track-canvas-wrap { flex: 1; position: relative; overflow: hidden; background: var(--track-bg); }
        .track-canvas { display: block; width: 100%; height: 80px; cursor: crosshair; }
        .track-spectrum-wrap { width: 180px; flex-shrink: 0; border-left: 1px solid var(--line); background: var(--track-bg); }
        .track-spectrum-canvas { display: block; width: 100%; height: 80px; cursor: crosshair; }

        /* ── Responsive power spectrum ── */
        @media (max-width: 900px) {
            .track-spectrum-wrap { width: 140px; }
        }
        @media (max-width: 700px) {
            .track-spectrum-wrap { width: 100px; }
        }
        @media (max-width: 500px) {
            .track-spectrum-wrap { display: none; }
        }

        /* ── Cursor power spectrum section ── */
        #spectrum-section {
            border-top: 1px solid var(--line); background: var(--panel);
            display: flex; flex-direction: column; flex-shrink: 0;
        }
        #spectrum-section-header {
            display: flex; align-items: center; gap: 8px; padding: 4px 10px;
            font-size: 11px; color: var(--muted); border-bottom: 1px solid var(--line);
        }
        #spectrum-overlay-wrap { padding: 6px 10px; background: var(--track-bg); }
        #spectrum-overlay-canvas { display: block; width: 100%; height: 140px; cursor: crosshair; }

        /* ── Metrics bar ── */
        #metrics-bar {
            display: flex; gap: 16px; padding: 5px 10px; font-size: 10px;
            border-top: 1px solid var(--line); background: var(--panel); flex-shrink: 0; flex-wrap: wrap;
        }
        .metrics-item { display: flex; align-items: center; gap: 4px; }
        .metrics-swatch { width: 8px; height: 8px; border-radius: 50%; }

        /* ── Empty state ── */
        #empty-state {
            display: none; flex: 1; align-items: center; justify-content: center;
            flex-direction: column; gap: 12px; color: var(--muted); font-size: 14px;
        }
        #empty-state.is-visible { display: flex; }
        #audio-host { display: none; }

        /* ── Directory selection ── */
        #directory-selection-layout {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        #selection-toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            border-bottom: 1px solid var(--line);
            background: var(--panel);
            flex-wrap: wrap;
        }
        #selection-python-environment {
            margin-left: auto;
            max-width: min(360px, 45vw);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        #selection-body {
            display: grid;
            grid-template-columns: minmax(280px, 420px) 1fr;
            gap: 0;
            flex: 1;
            min-height: 0;
        }
        #selection-sidebar {
            display: flex;
            flex-direction: column;
            min-height: 0;
            border-right: 1px solid var(--line);
            background: var(--panel);
        }
        #selection-summary {
            padding: 12px 14px;
            border-bottom: 1px solid var(--line);
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .selection-path {
            font-size: 11px;
            color: var(--muted);
            word-break: break-all;
        }
        .selection-count {
            font-size: 18px;
            font-weight: 700;
        }
        #selection-tree {
            flex: 1;
            overflow: auto;
            padding: 8px 10px 16px;
            font-size: 12px;
        }
        .selection-tree-list {
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding-left: 16px;
        }
        .selection-tree-list.is-root {
            padding-left: 0;
        }
        .selection-tree-directory {
            font-weight: 600;
            color: var(--text);
            padding: 4px 0 2px;
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .selection-tree-directory:hover {
            color: var(--accent);
        }
        .dir-toggle {
            font-size: 10px;
            display: inline-block;
            width: 12px;
            text-align: center;
        }
        .selection-file-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 2px 0;
        }
        .selection-file-checkbox {
            width: 14px;
            height: 14px;
            accent-color: var(--accent);
        }
        .selection-file-label {
            display: flex;
            flex-direction: column;
            gap: 1px;
            cursor: pointer;
        }
        .selection-file-name {
            color: var(--text);
        }
        .selection-file-path {
            font-size: 10px;
            color: var(--muted);
        }
        #selection-actions {
            display: flex;
            gap: 8px;
            padding: 10px;
            border-top: 1px solid var(--line);
            flex-wrap: wrap;
        }
        #selection-results-pane {
            display: flex;
            flex-direction: column;
            min-height: 0;
            background:
                radial-gradient(circle at top right, rgba(15,123,108,0.14), transparent 34%),
                linear-gradient(160deg, rgba(255,255,255,0.6), rgba(15,123,108,0.05));
        }
        @media (max-width: 900px) {
            #selection-body {
                grid-template-columns: 1fr;
            }
            #selection-sidebar {
                border-right: none;
                border-bottom: 1px solid var(--line);
            }
        }
        `;
}

export function renderComparisonScript(): string {
    return getComparisonRenderScript();
}
