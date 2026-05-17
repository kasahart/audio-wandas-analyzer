import * as path from 'path';
import * as vscode from 'vscode';
import { serializeForScript } from '../../shared/utils/webviewEscaping';
import type { AnalysisResultWithError, DirectoryTreeNode } from '../../shared/analysis/analysisTypes';

interface ComparisonTrackState extends AnalysisResultWithError {
    audioSource?: string;
}

interface ComparisonResultsState {
    mode: 'results';
    results: ComparisonTrackState[];
}

interface DirectorySelectionState {
    mode: 'directory-selection';
    results: ComparisonTrackState[];
    rootPath: string;
    directoryTree: DirectoryTreeNode[];
    allFilePaths: string[];
    selectedFilePaths: string[];
}

type ComparisonState = ComparisonResultsState | DirectorySelectionState;

interface ComparisonPanelTestSnapshot {
    title: string;
    html: string;
    fileNames: string[];
    resultCount: number;
    lastActionId?: string;
    renderedUi?: {
        hasToolbar: boolean;
        toolbarActions: string[];
        trackRowCount: number;
        audioElementCount: number;
        hasRulerCanvas: boolean;
        zoomStart: number;
        zoomEnd: number;
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
            waveformCoverageReason: string;
        }>;
    };
}

interface ComparisonPanelRenderedUiMessage {
    type: 'comparison-panel-test-snapshot';
    renderedUi: {
        hasToolbar: boolean;
        toolbarActions: string[];
        trackRowCount: number;
        audioElementCount: number;
        hasRulerCanvas: boolean;
        zoomStart: number;
        zoomEnd: number;
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
            waveformCoverageReason: string;
        }>;
    };
    actionId?: string;
}

interface ComparisonPanelTestActionMessage {
    type: 'comparison-panel-test-action';
    actionId: string;
    actions: Array<string | { action: string; trackIndex?: number }>;
}

export class ComparisonPanel {
    private static testSnapshot: ComparisonPanelTestSnapshot | undefined;
    private static activePanel: vscode.WebviewPanel | undefined;
    private static testMessageDisposables = new WeakMap<vscode.WebviewPanel, vscode.Disposable>();

    public static show(
        extensionUri: vscode.Uri,
        results: AnalysisResultWithError[],
        existingPanel?: vscode.WebviewPanel,
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
        };
        const html = ComparisonPanel.renderHtml(panel.webview, state, extensionUri);
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
        existingPanel?: vscode.WebviewPanel,
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
        };
        const html = ComparisonPanel.renderHtml(panel.webview, state, extensionUri);
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
        actions: Array<string | { action: string; trackIndex?: number }>,
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

        results.forEach((result) => {
            const audioDir = vscode.Uri.file(path.dirname(result.filePath));
            roots.set(audioDir.toString(), audioDir);
        });

        return Array.from(roots.values());
    }

    private static renderHtml(webview: vscode.Webview, state: ComparisonState, extensionUri: vscode.Uri): string {
        const nonce = Date.now().toString();
        const waveformScriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'media', 'comparisonWaveform.js'),
        );
        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; media-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>比較パネル</title>
    <style>${ComparisonPanel.renderStyles()}</style>
</head>
<body>
    <div id="app"></div>
    <script src="${waveformScriptUri}"></script>
    <script nonce="${nonce}">
        const __APP_STATE__ = ${serializeForScript(state)};
        ${ComparisonPanel.renderScript()}
    </script>
    <div id="canvas-tooltip"></div>
</body>
</html>`;
    }

    private static renderStyles(): string {
        return `
        :root {
            color-scheme: light dark;
            --font-ui: "Aptos", "Segoe UI", sans-serif;
            --font-mono: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
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
            --surface: #16181c;
            --panel: #1d2025;
            --line: #343942;
            --text: #d9dde3;
            --muted: #8f98a3;
            --track-bg: #090b0f;
            --track-header-bg: #14171c;
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
        .tb-btn.is-active { background: var(--accent); color: #fff; border-color: var(--accent); }
        .tb-btn:disabled { opacity: 0.4; cursor: default; }
        .tb-sep { width: 1px; height: 16px; background: var(--line); margin: 0 2px; }
        #cursor-display { font-size: 11px; font-family: var(--font-mono); color: var(--muted); min-width: 80px; }

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
        .track-meta { color: var(--muted); }
        .track-btns { display: flex; gap: 3px; margin-top: 2px; align-items: center; }
        .track-btn {
            font-size: 9px; padding: 1px 4px; border-radius: 2px;
            border: 1px solid var(--line); background: var(--surface);
            color: var(--muted); cursor: pointer;
        }
        .track-btn.is-playing { background: var(--accent); color: #fff; border-color: var(--accent); }
        .track-btn.is-muted { background: #555; color: #fff; }
        .track-offset { display: flex; align-items: center; gap: 2px; margin-top: 3px; }
        .track-offset-val {
            font-size: 9px; font-family: var(--font-mono);
            background: var(--surface); border: 1px solid var(--line);
            border-radius: 2px; padding: 1px 3px; width: 56px; text-align: right;
            cursor: text;
        }
        .track-offset-step { font-size: 9px; padding: 1px 3px; border-radius: 2px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); cursor: pointer; }
        .track-canvas-wrap { flex: 1; position: relative; overflow: hidden; background: var(--track-bg); }
        .track-canvas { display: block; width: 100%; height: 80px; cursor: crosshair; }

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

    private static renderScript(): string {
        return `
        (function() {
            const vscode = acquireVsCodeApi();
            const state = __APP_STATE__;
            const isSelectionMode = state.mode === 'directory-selection';
            const selectedFilePaths = new Set(Array.isArray(state.selectedFilePaths) ? state.selectedFilePaths : []);
            const allSelectableFilePaths = Array.isArray(state.allFilePaths) ? state.allFilePaths.slice() : [];
            let selectionMessageSeq = 0;

            const TRACK_COLORS = ['#4ec994','#ff8c4a','#4a9eff','#e8637a','#c084fc'];

            function hexToRgba(hex, alpha) {
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
            }

            // ── Runtime state ──
            let rafPending = false;
            const canvasWidthCache = {};
            let playbackEl = null;
            let playbackRafId = null;
            let playbackTrackIndex = null;

            function scheduleRender() {
                if (rafPending) { return; }
                rafPending = true;
                requestAnimationFrame(function() { rafPending = false; renderAll(); });
            }
            let contentType = 'waveform'; // 'waveform' | 'spectrogram'
            let zoomStart = 0;
            let zoomEnd = 1;
            let cursorNorm = 0;           // グローバルカーソル（常に number）
            let hoverNorm = null;         // ホバープレビュー位置（null = 非表示）
            let playbackStartNorm = 0;    // 再生開始位置の記憶
            let dragState = null;         // { trackIndex, startClientX, startOffset, canvasWidth, isDrag, isShift, startNorm, dragType }
            let loopRegion = null;        // null or { start: number, end: number }（正規化グローバル時間）
            const lastWaveformCoverage = state.results.map(function() { return null; });

            const trackRuntime = state.results.map(function() {
                return { offsetSeconds: 0, hidden: false };
            });

            function showTooltip(e, text) {
                const el = document.getElementById('canvas-tooltip');
                if (!el) { return; }
                el.textContent = text;
                el.style.display = 'block';
                el.style.left = (e.clientX + 14) + 'px';
                el.style.top = (e.clientY + 14) + 'px';
            }

            function hideTooltip() {
                const el = document.getElementById('canvas-tooltip');
                if (el) { el.style.display = 'none'; }
            }

            function computeGlobalSpan() {
                let startSec = Infinity, endSec = -Infinity;
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden || result.error) { return; }
                    const off = trackRuntime[i].offsetSeconds;
                    const dur = result.durationSeconds || 0;
                    if (off < startSec) { startSec = off; }
                    if (off + dur > endSec) { endSec = off + dur; }
                });
                if (!isFinite(startSec)) { startSec = 0; }
                if (!isFinite(endSec) || endSec <= startSec) { endSec = startSec + 1; }
                return { startSec, endSec, spanSec: endSec - startSec };
            }

            // ── On-demand range cache ──
            // Per track: { startNorm, endNorm, channels[] } once a range response arrives
            const rangeCache = state.results.map(function() { return null; });
            // Per track: requestId of the in-flight request (null = no pending request)
            const pendingRequests = state.results.map(function() { return null; });
            let rangeRequestTimer = null;

            // Receive high-res range data from Extension Host
            window.addEventListener('message', function(event) {
                const msg = event.data;
                if (!msg || msg.type !== 'waveform-range-result') { return; }
                const i = msg.trackIndex;
                if (i < 0 || i >= pendingRequests.length) { return; }
                if (pendingRequests[i] !== msg.requestId) { return; } // stale
                pendingRequests[i] = null;
                rangeCache[i] = { startNorm: msg.startNorm, endNorm: msg.endNorm, channels: msg.channels };
                renderAll();
            });

            window.addEventListener('message', function(event) {
                const msg = event.data;
                if (!msg || msg.type !== 'comparison-panel-test-action' || !Array.isArray(msg.actions)) { return; }
                msg.actions.forEach(function(entry) {
                    handleTestAction(entry);
                });
                requestAnimationFrame(function() {
                    publishTestSnapshot(msg.actionId);
                });
            });

            function handleTestAction(entry) {
                if (typeof entry === 'string') {
                    if (handleSelectionAction(entry)) {
                        return;
                    }
                    handleToolbarAction(entry);
                    return;
                }
                if (!entry || typeof entry !== 'object' || typeof entry.action !== 'string') {
                    return;
                }
                const idx = typeof entry.trackIndex === 'number' ? entry.trackIndex : -1;
                if (entry.action === 'offset-up' && idx >= 0) { adjustOffset(idx, 0.01); }
                if (entry.action === 'offset-down' && idx >= 0) { adjustOffset(idx, -0.01); }
                if (entry.action === 'toggle-mute' && idx >= 0) { toggleMute(idx); }
                if (entry.action === 'remove-track' && idx >= 0) { removeTrack(idx); }
            }

            function scheduleRangeRequests() {
                if (rangeRequestTimer) { clearTimeout(rangeRequestTimer); }
                rangeRequestTimer = setTimeout(function() { checkAndRequestRanges(); }, 80);
            }

            function checkAndRequestRanges() {
                const OVERVIEW_PTS = 1200;
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden || result.error) { return; }
                    const canvas = document.getElementById('track-canvas-' + i);
                    const W = (canvas ? canvas.width : 0) || 800;
                    const visibleOverview = OVERVIEW_PTS * (zoomEnd - zoomStart);
                    // Request when overview resolution is insufficient: < 0.5 pts per pixel
                    if (visibleOverview >= W * 1.0) { return; }

                    const dur = result.durationSeconds || 1;
                    const gs = computeGlobalSpan();
                    const trackStart = (trackRuntime[i].offsetSeconds - gs.startSec) / gs.spanSec;
                    const trackDurRatio = dur / gs.spanSec;
                    const fileAtZoomStart = (zoomStart - trackStart) / trackDurRatio;
                    const fileAtZoomEnd   = (zoomEnd   - trackStart) / trackDurRatio;
                    const fileSpan = fileAtZoomEnd - fileAtZoomStart;
                    const reqStart = Math.max(0, fileAtZoomStart - 0.05 * fileSpan);
                    const reqEnd   = Math.min(1, fileAtZoomEnd   + 0.05 * fileSpan);
                    const pts = Math.min(W * 2, 8000);

                    // Skip if cached range covers current view with sufficient density
                    const c = rangeCache[i];
                    if (c && c.startNorm <= reqStart && c.endNorm >= reqEnd &&
                        c.channels && c.channels[0]) {
                        const ch0 = c.channels[0];
                        const nPts = (ch0.min && ch0.min.length) || (ch0.samples && ch0.samples.length) || 0;
                        if (nPts >= pts * 0.8) {
                            const cacheDataRange = Math.max(c.endNorm - c.startNorm, 1e-9);
                            const ptsVisible = nPts * ((fileAtZoomEnd - fileAtZoomStart) / cacheDataRange);
                            if (ptsVisible >= W * 0.5) { return; }
                        }
                    }

                    const requestId = i + '-' + Date.now();
                    pendingRequests[i] = requestId;
                    vscode.postMessage({
                        type: 'request-waveform-range',
                        requestId: requestId,
                        trackIndex: i,
                        filePath: result.filePath,
                        startNorm: reqStart,
                        endNorm: reqEnd,
                        points: pts,
                    });
                });
            }

            // ── Build DOM ──
            const app = document.getElementById('app');
            app.innerHTML = buildLayout();
            attachEvents();
            // Defer first render so the browser has time to calculate flex layout
            requestAnimationFrame(function() {
                renderAll();
                publishTestSnapshot();
            });

            function publishTestSnapshot(actionId) {
                const toolbar = document.getElementById('toolbar');
                vscode.postMessage({
                    type: 'comparison-panel-test-snapshot',
                    actionId: actionId,
                    renderedUi: {
                        hasToolbar: !!toolbar,
                        toolbarActions: Array.from(document.querySelectorAll('#toolbar [data-action]')).map(function(el) {
                            return el.getAttribute('data-action');
                        }).filter(function(action) {
                            return !!action;
                        }),
                        trackRowCount: document.querySelectorAll('.track-row').length,
                        audioElementCount: document.querySelectorAll('#audio-host audio').length,
                        hasRulerCanvas: !!document.getElementById('ruler-canvas'),
                        zoomStart: zoomStart,
                        zoomEnd: zoomEnd,
                        tracks: state.results.map(function(result, trackIndex) {
                            const dur = result.durationSeconds || 1;
                            const gs = computeGlobalSpan();
                            const trackStart = (trackRuntime[trackIndex].offsetSeconds - gs.startSec) / gs.spanSec;
                            const trackDurRatio = dur / gs.spanSec;
                            const visibleFileStartNorm = Math.max(0, (zoomStart - trackStart) / trackDurRatio);
                            const visibleFileEndNorm = Math.min(1, (zoomEnd - trackStart) / trackDurRatio);
                            const coverage = lastWaveformCoverage[trackIndex];
                            return {
                                trackIndex: trackIndex,
                                offsetSeconds: trackRuntime[trackIndex].offsetSeconds,
                                visibleFileStartNorm: visibleFileStartNorm,
                                visibleFileEndNorm: visibleFileEndNorm,
                                waveformFullyVisible: visibleFileStartNorm <= 0 && visibleFileEndNorm >= 1,
                                waveformCoversViewportLeft: !!coverage && coverage.coversLeft,
                                waveformCoversViewportRight: !!coverage && coverage.coversRight,
                                waveformMinDrawX: coverage ? coverage.minX : null,
                                waveformMaxDrawX: coverage ? coverage.maxX : null,
                                waveformCanvasWidth: coverage ? coverage.canvasWidth : null,
                                waveformCoverageReason: coverage ? coverage.reason : 'never-painted',
                            };
                        }),
                    },
                });
            }

            function buildLayout() {
                if (isSelectionMode) {
                    return buildDirectorySelectionLayout();
                }
                return buildResultsPane('すべてのトラックが除外されています');
            }

            function buildDirectorySelectionLayout() {
                return '<div id="directory-selection-layout">'
                    + '  <div id="selection-toolbar">'
                    + '    <span style="font-weight:700;font-size:12px;color:var(--accent)">選択して解析</span>'
                    + '    <div class="tb-sep"></div>'
                    + '    <button class="tb-btn" data-action="open-file">ファイルを開く</button>'
                    + '    <button class="tb-btn" data-action="open-folder">別のフォルダを開く</button>'
                    + '  </div>'
                    + '  <div id="selection-body">'
                    + '    <div id="selection-sidebar">'
                    + '      <div id="selection-summary">'
                    + '        <div class="selection-count" id="selection-count"></div>'
                    + '        <div class="selection-path">' + escHtml(state.rootPath || '') + '</div>'
                    + '      </div>'
                    + '      <div id="selection-tree">' + buildSelectionTree(state.directoryTree || [], true) + '</div>'
                    + '      <div id="selection-actions">'
                    + '        <button class="tb-btn" data-action="selection-select-all">すべて選択</button>'
                    + '        <button class="tb-btn" data-action="selection-clear-all">クリア</button>'
                    + '      </div>'
                    + '    </div>'
                    + '    <div id="selection-results-pane">'
                    + buildResultsPane('左のツリーでチェックしたファイルがここにトラックとして表示されます')
                    + '    </div>'
                    + '  </div>'
                    + '</div>';
            }

            function buildResultsPane(emptyMessage) {
                const tracks = state.results.map(function(result, i) {
                    return buildTrackRow(result, i);
                }).join('');
                const metrics = state.results.map(function(result, i) {
                    const ch = result.channels[0];
                    const rmsDb = ch ? (20 * Math.log10(Math.max(ch.rms, 1e-9))).toFixed(1) + ' dBFS' : '—';
                    const peakDb = ch ? (20 * Math.log10(Math.max(ch.peakAbsolute, 1e-9))).toFixed(1) + ' dBFS' : '—';
                    const domHz = ch && ch.dominantFrequencies && ch.dominantFrequencies[0]
                        ? Math.round(ch.dominantFrequencies[0].frequencyHz) + ' Hz' : '—';
                    return '<div class="metrics-item"><div class="metrics-swatch" style="background:' + TRACK_COLORS[i % TRACK_COLORS.length] + '"></div>'
                        + '<span>' + escHtml(result.fileName) + ': RMS ' + rmsDb + ' / Peak ' + peakDb + ' / ' + domHz + '</span></div>';
                }).join('');

                return '<div id="toolbar">' + buildToolbar() + '</div>'
                    + '<div id="tracks-wrapper">'
                    + '  <div id="ruler-row"><div id="ruler-spacer"></div><canvas id="ruler-canvas"></canvas></div>'
                    + '  <div id="stacked-wrap">' + tracks + '</div>'
                    + '  <div id="empty-state"><p>' + escHtml(emptyMessage) + '</p></div>'
                    + '</div>'
                    + '<div id="audio-host">' + buildAudioElements() + '</div>'
                    + '<div id="metrics-bar">' + metrics + '</div>';
            }

            function buildSelectionTree(nodes, isRoot) {
                if (!Array.isArray(nodes) || nodes.length === 0) {
                    return '<div class="selection-path">対応する音声ファイルは見つかりませんでした。</div>';
                }
                return '<ul class="selection-tree-list' + (isRoot ? ' is-root' : '') + '">'
                    + nodes.map(function(node) {
                        if (node.type === 'directory') {
                            return '<li>'
                                + '<div class="selection-tree-directory">' + escHtml(node.name) + '</div>'
                                + buildSelectionTree(node.children || [], false)
                                + '</li>';
                        }

                        const filePath = node.filePath || '';
                        const checked = selectedFilePaths.has(filePath) ? ' checked' : '';
                        return '<li>'
                            + '<label class="selection-file-row">'
                            + '  <input class="selection-file-checkbox" type="checkbox" data-file-path="' + escHtml(filePath) + '"' + checked + '>'
                            + '  <span class="selection-file-label">'
                            + '    <span class="selection-file-name">' + escHtml(node.name) + '</span>'
                            + '    <span class="selection-file-path">' + escHtml(node.relativePath) + '</span>'
                            + '  </span>'
                            + '</label>'
                            + '</li>';
                    }).join('')
                    + '</ul>';
            }

            function buildAudioElements() {
                return state.results.map(function(result, i) {
                    if (!result.audioSource) { return ''; }
                    return '<audio id="track-audio-' + i + '" preload="metadata" src="' + escHtml(result.audioSource) + '"></audio>';
                }).join('');
            }

            function buildToolbar() {
                return '<span style="font-weight:700;font-size:12px;color:var(--accent)">⚡ メイン</span>'
                    + '<div class="tb-sep"></div>'
                    + '<button class="tb-btn" data-action="open-file">ファイルを開く</button>'
                    + '<button class="tb-btn" data-action="open-folder">フォルダを開く</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">トラック:</span>'
                    + '<button class="tb-btn is-active" data-action="content-waveform">波形</button>'
                    + '<button class="tb-btn" data-action="content-spectrogram">スペクトログラム</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">ズーム:</span>'
                    + '<button class="tb-btn" data-action="zoom-out">－</button>'
                    + '<button class="tb-btn" data-action="zoom-in">＋</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span id="cursor-display" title="← →キーで微調整できます">—</span>'
                    + '<span id="loop-badge" style="display:none; color:#64a0ff; font-size:0.85em; margin-left:8px;">🔁 ループ再生中</span>';
            }

            function buildTrackRow(result, i) {
                return '<div class="track-row" id="track-row-' + i + '" data-track-index="' + i + '">'
                    + '<div class="track-header">'
                    + '  <div class="track-name" title="' + escHtml(result.filePath) + '">' + escHtml(result.fileName) + '</div>'
                    + '  <div class="track-meta">Ch: ' + result.channelCount + ' &nbsp;' + (result.sampleRateHz / 1000).toFixed(1) + 'kHz</div>'
                    + '  <div class="track-meta">RMS: ' + (result.channels[0] ? (20 * Math.log10(Math.max(result.channels[0].rms, 1e-9))).toFixed(1) + ' dBFS' : '—') + '</div>'
                    + '  <div class="track-btns">'
                    + '    <button class="track-btn" data-action="toggle-mute" data-track-index="' + i + '">M</button>'
                    + '    <button class="track-btn" data-action="toggle-playback" data-track-index="' + i + '" title="再生 / 一時停止"' + (result.audioSource ? '' : ' disabled') + '>▶</button>'
                    + '    <button class="track-btn" data-action="stop-playback" data-track-index="' + i + '" title="停止"' + (result.audioSource ? '' : ' disabled') + '>■</button>'
                    + '    <button class="track-btn" data-action="remove-track" data-track-index="' + i + '">✕</button>'
                    + '  </div>'
                    + '  <div class="track-offset">'
                    + '    <span class="track-offset-val" id="offset-val-' + i + '" data-track-index="' + i + '" title="ダブルクリックでリセット">+0.000s</span>'
                    + '    <button class="track-offset-step" data-action="offset-up" data-track-index="' + i + '">▲</button>'
                    + '    <button class="track-offset-step" data-action="offset-down" data-track-index="' + i + '">▼</button>'
                    + '  </div>'
                    + '</div>'
                    + '<div class="track-canvas-wrap" id="track-canvas-wrap-' + i + '">'
                    + '  <canvas class="track-canvas" id="track-canvas-' + i + '" data-track-index="' + i + '" tabindex="0" style="outline:none"></canvas>'
                    + '</div>'
                    + '</div>';
            }

            function escHtml(str) {
                return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            }

            // ── Rendering ──
            function renderAll() {
                resizeAllCanvases();
                renderRuler();
                renderStackedTracks();
                updateVisibility();
                updateOffsetDisplays();
                if (contentType === 'waveform') { scheduleRangeRequests(); }
            }

            function resizeAllCanvases() {
                state.results.forEach(function(_, i) {
                    const canvas = document.getElementById('track-canvas-' + i);
                    if (!canvas) { return; }
                    const wrap = document.getElementById('track-canvas-wrap-' + i);
                    if (!wrap) { return; }
                    const newW = wrap.clientWidth || 800;
                    if (canvasWidthCache[i] === newW) { return; }
                    canvasWidthCache[i] = newW;
                    canvas.width = newW;
                    canvas.height = 80;
                });
                const rulerCanvas = document.getElementById('ruler-canvas');
                if (rulerCanvas) {
                    const row = document.getElementById('ruler-row');
                    if (row) { rulerCanvas.width = row.clientWidth - 130; }
                    rulerCanvas.height = 20;
                }
            }

            function renderRuler() {
                const canvas = document.getElementById('ruler-canvas');
                if (!canvas) { return; }
                const ctx = canvas.getContext('2d');
                const W = canvas.width;
                const H = canvas.height;
                ctx.clearRect(0, 0, W, H);
                const gs = computeGlobalSpan();
                const visStart = gs.startSec + zoomStart * gs.spanSec;
                const visEnd   = gs.startSec + zoomEnd   * gs.spanSec;
                const visDur = visEnd - visStart;
                ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
                ctx.font = '9px monospace';
                ctx.textAlign = 'left';
                const step = niceTimeStep(visDur);
                let t = Math.ceil(visStart / step) * step;
                while (t <= visEnd) {
                    const x = (t - visStart) / visDur * W;
                    ctx.fillText(formatTime(t), x + 2, H - 4);
                    t += step;
                }
            }

            function niceTimeStep(dur) {
                const steps = [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30];
                for (let i = 0; i < steps.length; i++) {
                    if (dur / steps[i] <= 8) { return steps[i]; }
                }
                return 60;
            }

            function formatTime(seconds) {
                const m = Math.floor(seconds / 60);
                const s = (seconds % 60).toFixed(2);
                return m + ':' + (parseFloat(s) < 10 ? '0' : '') + s;
            }

            function renderStackedTracks() {
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden) { return; }
                    // エラートラックはキャンバスにエラーメッセージを描画
                    if (result.error) {
                        const canvas = document.getElementById('track-canvas-' + i);
                        if (canvas) {
                            const ctx = canvas.getContext('2d');
                            ctx.clearRect(0, 0, canvas.width, canvas.height);
                            ctx.fillStyle = '#e8637a';
                            ctx.font = '11px sans-serif';
                            ctx.fillText('解析失敗: ' + result.error, 8, canvas.height / 2 + 4);
                        }
                        return;
                    }
                    const canvas = document.getElementById('track-canvas-' + i);
                    if (!canvas) { return; }
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    if (contentType === 'waveform') {
                        drawTrackWaveform(canvas, result, i, trackRuntime[i].offsetSeconds, color);
                    } else {
                        drawSpectrogram(canvas, result, trackRuntime[i].offsetSeconds);
                    }
                });
            }

            function resolveWaveformSource(result, trackIndex, offsetSeconds) {
                const dur = result.durationSeconds || 1;
                const gs = computeGlobalSpan();
                const trackStart = (offsetSeconds - gs.startSec) / gs.spanSec;
                const trackDurRatio = dur / gs.spanSec;
                const fileAtZoomStart = (zoomStart - trackStart) / trackDurRatio;
                const fileAtZoomEnd   = (zoomEnd   - trackStart) / trackDurRatio;
                const c = rangeCache[trackIndex];
                if (c && c.channels && c.channels[0] && c.channels[0].samples &&
                    c.startNorm <= Math.max(0, fileAtZoomStart) &&
                    c.endNorm   >= Math.min(1, fileAtZoomEnd)) {
                    return { waveform: c.channels[0], dataStart: c.startNorm, dataEnd: c.endNorm };
                }
                const ch = result.channels[0];
                return ch && ch.waveform
                    ? { waveform: ch.waveform, dataStart: 0, dataEnd: 1 }
                    : null;
            }

            function drawTrackWaveform(canvas, result, trackIndex, offsetSeconds, color, options) {
                const ctx = canvas.getContext('2d');
                const W = canvas.width, H = canvas.height;
                const shouldClear = !options || options.clear !== false;
                const shouldDrawCursor = !options || options.drawCursor !== false;
                if (shouldClear) {
                    ctx.clearRect(0, 0, W, H);
                }

                // ゼロライン
                ctx.strokeStyle = hexToRgba(color, 0.25);
                ctx.lineWidth = 0.5;
                ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

                const src = resolveWaveformSource(result, trackIndex, offsetSeconds);
                const hasPipeline = !!window.renderWaveformPipeline;
                const hasResultWaveform = !!(result.channels && result.channels[0] && result.channels[0].waveform);
                if (src && hasPipeline) {
                    const dur = result.durationSeconds || 1;
                    const gs = computeGlobalSpan();
                    const trackStart = (offsetSeconds - gs.startSec) / gs.spanSec;
                    const trackDurRatio = dur / gs.spanSec;
                    const originalMoveTo = ctx.moveTo.bind(ctx);
                    const originalLineTo = ctx.lineTo.bind(ctx);
                    let minX = Number.POSITIVE_INFINITY;
                    let maxX = Number.NEGATIVE_INFINITY;
                    ctx.moveTo = function(x, y) {
                        if (Number.isFinite(x)) {
                            minX = Math.min(minX, x);
                            maxX = Math.max(maxX, x);
                        }
                        return originalMoveTo(x, y);
                    };
                    ctx.lineTo = function(x, y) {
                        if (Number.isFinite(x)) {
                            minX = Math.min(minX, x);
                            maxX = Math.max(maxX, x);
                        }
                        return originalLineTo(x, y);
                    };
                    try {
                        window.renderWaveformPipeline(ctx, W, H, src.waveform, {
                            zoomStart,
                            zoomEnd,
                            offsetNorm: trackStart,
                            trackDurRatio,
                            dataStart: src.dataStart,
                            dataEnd: src.dataEnd,
                            color,
                        });
                    } finally {
                        ctx.moveTo = originalMoveTo;
                        ctx.lineTo = originalLineTo;
                    }
                    lastWaveformCoverage[trackIndex] = Number.isFinite(minX) && Number.isFinite(maxX)
                        ? {
                            minX: minX,
                            maxX: maxX,
                            canvasWidth: W,
                            coversLeft: minX <= 1,
                            coversRight: maxX >= W - 1,
                            reason: 'painted',
                        }
                        : { minX: null, maxX: null, canvasWidth: W, coversLeft: false, coversRight: false, reason: 'no-draw-calls' };
                } else {
                    lastWaveformCoverage[trackIndex] = {
                        minX: null,
                        maxX: null,
                        canvasWidth: W,
                        coversLeft: false,
                        coversRight: false,
                        reason: !src ? (hasResultWaveform ? 'src-null-but-result-has-waveform' : 'src-null-no-waveform') : 'pipeline-missing',
                    };
                }

                if (shouldDrawCursor) {
                    drawLoopRegionOnCanvas(ctx, W, H);
                    drawCursorOnCanvas(ctx, W, H);
                    drawHoverLineOnCanvas(ctx, W, H);
                }
            }

            function drawSpectrogram(canvas, result, offsetSeconds) {
                const ctx = canvas.getContext('2d');
                const W = canvas.width;
                const H = canvas.height;
                ctx.clearRect(0, 0, W, H);

                const ch = result.channels[0];
                if (!ch || !ch.spectrogram) { return; }
                const spec = ch.spectrogram;
                const tBins = spec.timeBins;
                const fBins = spec.frequencyBins;
                const dur = result.durationSeconds || 1;
                const gs = computeGlobalSpan();
                const trackStart = (offsetSeconds - gs.startSec) / gs.spanSec;
                const trackDurRatio = dur / gs.spanSec;

                const imageData = ctx.createImageData(W, H);
                const data = imageData.data;

                for (let px = 0; px < W; px++) {
                    const tNorm = zoomStart + (px / W) * (zoomEnd - zoomStart);
                    const tAdj = (tNorm - trackStart) / trackDurRatio;
                    const tIdx = Math.floor(tAdj * tBins);
                    if (tIdx < 0 || tIdx >= tBins) { continue; }

                    for (let py = 0; py < H; py++) {
                        const fIdx = Math.floor((1 - py / H) * fBins);
                        if (fIdx < 0 || fIdx >= fBins) { continue; }
                        const val = (spec.values[tIdx] && spec.values[tIdx][fIdx] !== undefined)
                            ? spec.values[tIdx][fIdx] : spec.minDb;
                        const range = spec.maxDb - spec.minDb;
                        const norm = range !== 0
                            ? Math.max(0, Math.min(1, (val - spec.minDb) / range))
                            : 0;
                        const off = (py * W + px) * 4;
                        const rgb = dbToRgb(norm);
                        data[off] = rgb[0]; data[off + 1] = rgb[1]; data[off + 2] = rgb[2]; data[off + 3] = 255;
                    }
                }
                ctx.putImageData(imageData, 0, 0);
                drawLoopRegionOnCanvas(ctx, W, H);
                drawCursorOnCanvas(ctx, W, H);
                drawHoverLineOnCanvas(ctx, W, H);
            }

            function dbToRgb(norm) {
                if (norm < 0.25) { const t = norm / 0.25; return [Math.floor(68 + t * (59 - 68)), Math.floor(1 + t * (82 - 1)), Math.floor(84 + t * (139 - 84))]; }
                if (norm < 0.5)  { const t = (norm - 0.25) / 0.25; return [Math.floor(59 + t * (33 - 59)), Math.floor(82 + t * (145 - 82)), Math.floor(139 + t * (140 - 139))]; }
                if (norm < 0.75) { const t = (norm - 0.5) / 0.25; return [Math.floor(33 + t * (94 - 33)), Math.floor(145 + t * (201 - 145)), Math.floor(140 + t * (98 - 140))]; }
                const t = (norm - 0.75) / 0.25; return [Math.floor(94 + t * (253 - 94)), Math.floor(201 + t * (231 - 201)), Math.floor(98 + t * (37 - 98))];
            }

            function drawCursorOnCanvas(ctx, W, H) {
                const x = (cursorNorm - zoomStart) / (zoomEnd - zoomStart) * W;
                if (x < 0 || x > W) { return; }
                ctx.save();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.globalAlpha = 0.7;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, H);
                ctx.stroke();
                ctx.restore();
            }

            function drawHoverLineOnCanvas(ctx, W, H) {
                if (hoverNorm === null) { return; }
                const x = (hoverNorm - zoomStart) / (zoomEnd - zoomStart) * W;
                if (x < 0 || x > W) { return; }
                ctx.save();
                ctx.strokeStyle = '#aaaaaa';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.globalAlpha = 0.4;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, H);
                ctx.stroke();
                ctx.restore();
            }

            function drawLoopRegionOnCanvas(ctx, W, H) {
                if (!loopRegion) { return; }
                if (typeof window.paintLoopRegion === 'function') {
                    window.paintLoopRegion(ctx, W, H, loopRegion.start, loopRegion.end, zoomStart, zoomEnd);
                }
            }


            function updateVisibility() {
                // まず各行の display を更新する
                document.querySelectorAll('.track-row').forEach(function(row) {
                    const idx = parseInt(row.getAttribute('data-track-index'), 10);
                    if (!isNaN(idx) && trackRuntime[idx]) {
                        row.style.display = trackRuntime[idx].hidden ? 'none' : 'flex';
                    }
                });
                // 次に空状態を判定する（削除済み or 全非表示）
                const emptyState = document.getElementById('empty-state');
                if (emptyState) {
                    const visibleRows = Array.from(document.querySelectorAll('.track-row')).filter(function(row) {
                        return row.style.display !== 'none';
                    });
                    emptyState.classList.toggle('is-visible', visibleRows.length === 0);
                }
            }

            function updateOffsetDisplays() {
                state.results.forEach(function(_, i) {
                    const el = document.getElementById('offset-val-' + i);
                    if (!el) { return; }
                    const off = trackRuntime[i].offsetSeconds;
                    el.textContent = (off >= 0 ? '+' : '') + off.toFixed(3) + 's';
                });
            }

            function getTrackAudio(idx) {
                return document.getElementById('track-audio-' + idx);
            }

            function getTrackTimeMapping(idx) {
                const result = state.results[idx];
                if (!result) { return null; }
                const durationSeconds = result.durationSeconds || 0;
                if (durationSeconds <= 0) { return null; }
                const gs = computeGlobalSpan();
                const trackStart = (trackRuntime[idx].offsetSeconds - gs.startSec) / gs.spanSec;
                const trackDurRatio = durationSeconds / gs.spanSec;
                return { durationSeconds, trackStart, trackDurRatio };
            }

            function globalNormFromTrackTime(idx, timeSeconds) {
                const mapping = getTrackTimeMapping(idx);
                if (!mapping) { return null; }
                return mapping.trackStart + (timeSeconds / mapping.durationSeconds) * mapping.trackDurRatio;
            }

            function trackTimeFromGlobalNorm(idx, norm) {
                const mapping = getTrackTimeMapping(idx);
                if (!mapping) { return null; }
                const fileNorm = (norm - mapping.trackStart) / mapping.trackDurRatio;
                const clampedNorm = Math.max(0, Math.min(1, fileNorm));
                return clampedNorm * mapping.durationSeconds;
            }

            function trackStartNorm(idx) {
                const mapping = getTrackTimeMapping(idx);
                return mapping ? mapping.trackStart : 0;
            }

            function updatePlaybackButtons() {
                state.results.forEach(function(_, i) {
                    const playBtn = document.querySelector('[data-action="toggle-playback"][data-track-index="' + i + '"]');
                    const stopBtn = document.querySelector('[data-action="stop-playback"][data-track-index="' + i + '"]');
                    const isActive = playbackTrackIndex === i && playbackEl;
                    const isPlaying = isActive && !playbackEl.paused;
                    if (playBtn) {
                        playBtn.textContent = isPlaying ? '⏸' : '▶';
                        playBtn.classList.toggle('is-playing', !!isPlaying);
                    }
                    if (stopBtn) {
                        stopBtn.disabled = !isActive;
                    }
                });
            }

            function updateLoopBadge() {
                const badge = document.getElementById('loop-badge');
                if (!badge) { return; }
                badge.style.display = (loopRegion && playbackEl && !playbackEl.paused) ? 'inline' : 'none';
            }

            function clearPlaybackState() {
                playbackEl = null;
                playbackTrackIndex = null;
                stopPlaybackLoop();
                updatePlaybackButtons();
                updateLoopBadge();
            }

            function startPlaybackLoop() {
                if (playbackRafId !== null) { return; }
                function tick() {
                    if (playbackEl && playbackTrackIndex !== null && !playbackEl.paused) {
                        if (loopRegion) {
                            const currentGlobalNorm = globalNormFromTrackTime(playbackTrackIndex, playbackEl.currentTime);
                            if (currentGlobalNorm !== null && currentGlobalNorm >= loopRegion.end) {
                                const loopStartTime = trackTimeFromGlobalNorm(playbackTrackIndex, loopRegion.start);
                                if (loopStartTime !== null) {
                                    try { playbackEl.currentTime = loopStartTime; } catch (_err) { }
                                }
                            }
                        }
                        const nextCursor = globalNormFromTrackTime(playbackTrackIndex, playbackEl.currentTime);
                        if (nextCursor !== null) {
                            cursorNorm = nextCursor;
                            updateCursorDisplay(nextCursor);
                            scheduleRender();
                        }
                    }
                    updateLoopBadge();
                    playbackRafId = requestAnimationFrame(tick);
                }
                playbackRafId = requestAnimationFrame(tick);
            }

            function stopPlaybackLoop() {
                if (playbackRafId !== null) { cancelAnimationFrame(playbackRafId); playbackRafId = null; }
            }

            function stopPlayback(idx, options) {
                const audio = idx === null || idx === undefined ? playbackEl : getTrackAudio(idx);
                if (audio) {
                    audio.pause();
                    try { audio.currentTime = 0; } catch (_err) { }
                }
                if (idx === playbackTrackIndex) {
                    if (!options || options.keepCursor !== true) {
                        cursorNorm = playbackStartNorm;
                        updateCursorDisplay(cursorNorm);
                    }
                    clearPlaybackState();
                    scheduleRender();
                    return;
                }
                updatePlaybackButtons();
            }

            function togglePlayback(idx) {
                const audio = getTrackAudio(idx);
                if (!audio) { return; }

                if (playbackTrackIndex === idx && playbackEl === audio && !audio.paused) {
                    audio.pause();
                    updatePlaybackButtons();
                    stopPlaybackLoop();
                    return;
                }

                if (playbackTrackIndex !== null && playbackTrackIndex !== idx) {
                    // 再生開始位置にカーソルを戻してからトラックを切り替え
                    cursorNorm = playbackStartNorm;
                    updateCursorDisplay(cursorNorm);
                    stopPlayback(playbackTrackIndex, { keepCursor: true });
                }

                playbackTrackIndex = idx;
                playbackEl = audio;

                const durationSeconds = audio.duration || state.results[idx].durationSeconds || 0;
                const startNorm = loopRegion ? loopRegion.start : cursorNorm;
                let startTime = trackTimeFromGlobalNorm(idx, startNorm);
                if (startTime === null) { startTime = 0; }
                if (durationSeconds > 0 && startTime >= Math.max(0, durationSeconds - 0.05)) {
                    startTime = 0;
                }
                try { audio.currentTime = startTime; } catch (_err) { }
                playbackStartNorm = loopRegion ? loopRegion.start : cursorNorm;

                const playPromise = audio.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(function() {
                        clearPlaybackState();
                    });
                }

                const nextCursor = globalNormFromTrackTime(idx, audio.currentTime);
                if (nextCursor !== null) {
                    cursorNorm = nextCursor;
                    updateCursorDisplay(nextCursor);
                }
                updatePlaybackButtons();
                startPlaybackLoop();
                scheduleRender();
            }

            function attachAudioEvents() {
                state.results.forEach(function(_, i) {
                    const audio = getTrackAudio(i);
                    if (!audio) { return; }
                    audio.addEventListener('play', function() {
                        playbackEl = audio;
                        playbackTrackIndex = i;
                        updatePlaybackButtons();
                        startPlaybackLoop();
                    });
                    audio.addEventListener('pause', function() {
                        if (playbackTrackIndex === i) {
                            updatePlaybackButtons();
                            if (audio.ended) {
                                stopPlayback(i, { keepCursor: true });
                            }
                        }
                    });
                    audio.addEventListener('ended', function() {
                        if (playbackTrackIndex === i) {
                            const endNorm = globalNormFromTrackTime(i, state.results[i].durationSeconds || 0);
                            if (endNorm !== null) {
                                cursorNorm = endNorm;
                                updateCursorDisplay(endNorm);
                            }
                            clearPlaybackState();
                            scheduleRender();
                        }
                    });
                    audio.addEventListener('error', function() {
                        if (playbackTrackIndex === i) {
                            clearPlaybackState();
                        }
                    });
                });
            }

            // ── Events ──
            function attachEvents() {
                if (isSelectionMode) {
                    attachDirectorySelectionEvents();
                }

                document.getElementById('toolbar').addEventListener('click', function(e) {
                    const action = e.target.getAttribute('data-action');
                    if (!action) { return; }
                    handleToolbarAction(action);
                });

                document.getElementById('tracks-wrapper').addEventListener('click', function(e) {
                    const action = e.target.getAttribute('data-action');
                    const idx = parseInt(e.target.getAttribute('data-track-index'), 10);
                    if (action === 'toggle-mute' && !isNaN(idx)) { toggleMute(idx); }
                    if (action === 'toggle-playback' && !isNaN(idx)) { togglePlayback(idx); }
                    if (action === 'stop-playback' && !isNaN(idx)) { stopPlayback(idx); }
                    if (action === 'remove-track' && !isNaN(idx)) { removeTrack(idx); }
                    if (action === 'offset-up' && !isNaN(idx)) { adjustOffset(idx, 0.01); }
                    if (action === 'offset-down' && !isNaN(idx)) { adjustOffset(idx, -0.01); }
                });

                document.getElementById('tracks-wrapper').addEventListener('dblclick', function(e) {
                    if (e.target.classList.contains('track-offset-val')) {
                        const idx = parseInt(e.target.getAttribute('data-track-index'), 10);
                        if (!isNaN(idx)) { trackRuntime[idx].offsetSeconds = 0; updateOffsetDisplays(); scheduleRender(); }
                    }
                });

                document.getElementById('tracks-wrapper').addEventListener('mousemove', function(e) {
                    handleCanvasMouseMove(e);
                });
                document.getElementById('tracks-wrapper').addEventListener('mouseleave', clearHover);
                document.getElementById('tracks-wrapper').addEventListener('mousedown', function(e) {
                    handleCanvasMouseDown(e);
                });
                document.addEventListener('mousemove', function(e) { handleDocMouseMove(e); });
                document.addEventListener('mouseup', function(e) { handleDocMouseUp(e); });

                document.getElementById('tracks-wrapper').addEventListener('wheel', function(e) {
                    e.preventDefault();
                    if (e.ctrlKey) { handleZoomWheel(e); }
                    else if (e.shiftKey) { handlePanWheel(e); }
                }, { passive: false });

                window.addEventListener('resize', function() { scheduleRender(); });
                attachAudioEvents();
                updatePlaybackButtons();

                state.results.forEach(function(_, i) {
                    const canvas = document.getElementById('track-canvas-' + i);
                    if (!canvas) { return; }
                    canvas.addEventListener('focus', function() {
                        const el = document.getElementById('canvas-tooltip');
                        if (el) {
                            const rect = canvas.getBoundingClientRect();
                            el.textContent = '← →: カーソル移動　Shift+←→: 100ms移動　Space: 再生/停止';
                            el.style.display = 'block';
                            el.style.left = (rect.left + 8) + 'px';
                            el.style.top = (rect.bottom - 36) + 'px';
                        }
                        canvas.style.outline = '1px solid rgba(100, 160, 255, 0.4)';
                    });
                    canvas.addEventListener('blur', function() {
                        hideTooltip();
                        canvas.style.outline = 'none';
                    });
                });

                document.addEventListener('keydown', function(e) {
                    const active = document.activeElement;
                    if (!active || !active.classList.contains('track-canvas')) { return; }

                    if (e.code === 'Space') {
                        e.preventDefault();
                        const idx = parseInt(active.getAttribute('data-track-index'), 10);
                        if (!isNaN(idx)) { togglePlayback(idx); }
                        return;
                    }

                    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                        e.preventDefault();
                        const W = active.width || 800;
                        let delta;
                        if (e.shiftKey) {
                            const gs = computeGlobalSpan();
                            delta = gs.spanSec > 0 ? (0.1 / gs.spanSec) : 0.001;
                        } else {
                            delta = (zoomEnd - zoomStart) / W;
                        }
                        if (e.code === 'ArrowLeft') { delta = -delta; }
                        cursorNorm = Math.max(0, Math.min(1, cursorNorm + delta));
                        updateCursorDisplay(cursorNorm);
                        scheduleRender();
                    }
                });
            }

            function attachDirectorySelectionEvents() {
                const layout = document.getElementById('directory-selection-layout');
                if (!layout) { return; }

                layout.addEventListener('click', function(e) {
                    const target = e.target;
                    if (!target || typeof target.getAttribute !== 'function') { return; }
                    const action = target.getAttribute('data-action');
                    if (!action) { return; }

                    if (handleSelectionAction(action)) {
                        return;
                    }
                });

                layout.addEventListener('change', function(e) {
                    const target = e.target;
                    if (!target || !target.classList || !target.classList.contains('selection-file-checkbox')) { return; }
                    const filePath = target.getAttribute('data-file-path');
                    if (!filePath) { return; }
                    if (target.checked) {
                        selectedFilePaths.add(filePath);
                    } else {
                        selectedFilePaths.delete(filePath);
                    }
                    syncSelectionSummary();
                    postSelectedFiles();
                });

                syncSelectionSummary();
            }

            function handleSelectionAction(action) {
                if (action === 'open-file' || action === 'open-folder') {
                    handleToolbarAction(action);
                    return true;
                }
                if (action === 'selection-select-all') {
                    selectedFilePaths.clear();
                    allSelectableFilePaths.forEach(function(filePath) { selectedFilePaths.add(filePath); });
                    syncSelectionCheckboxes();
                    syncSelectionSummary();
                    postSelectedFiles();
                    return true;
                }
                if (action === 'selection-clear-all') {
                    selectedFilePaths.clear();
                    syncSelectionCheckboxes();
                    syncSelectionSummary();
                    postSelectedFiles();
                    return true;
                }
                if (action === 'selection-submit') {
                    postSelectedFiles();
                    return true;
                }
                return false;
            }

            function syncSelectionCheckboxes() {
                document.querySelectorAll('.selection-file-checkbox').forEach(function(input) {
                    const filePath = input.getAttribute('data-file-path');
                    input.checked = !!filePath && selectedFilePaths.has(filePath);
                });
            }

            function syncSelectionSummary() {
                const countEl = document.getElementById('selection-count');
                const count = selectedFilePaths.size;
                if (countEl) {
                    countEl.textContent = count + ' / ' + allSelectableFilePaths.length + ' 件を選択中';
                }
            }

            function postSelectedFiles() {
                const orderedSelection = allSelectableFilePaths.filter(function(filePath) {
                    return selectedFilePaths.has(filePath);
                });
                selectionMessageSeq += 1;
                vscode.postMessage({
                    type: 'analyze-selected-files',
                    requestId: 'selection-' + selectionMessageSeq,
                    filePaths: orderedSelection,
                });
            }

            function handleToolbarAction(action) {
                if (action === 'open-file') {
                    vscode.postMessage({ type: 'select-target', targetKind: 'file' });
                } else if (action === 'open-folder') {
                    vscode.postMessage({ type: 'select-target', targetKind: 'directory' });
                } else if (action === 'content-waveform') {
                    contentType = 'waveform';
                    document.querySelector('[data-action="content-waveform"]').classList.add('is-active');
                    document.querySelector('[data-action="content-spectrogram"]').classList.remove('is-active');
                    scheduleRender();
                } else if (action === 'content-spectrogram') {
                    contentType = 'spectrogram';
                    document.querySelector('[data-action="content-waveform"]').classList.remove('is-active');
                    document.querySelector('[data-action="content-spectrogram"]').classList.add('is-active');
                    scheduleRender();
                } else if (action === 'zoom-in') {
                    zoomIn();
                } else if (action === 'zoom-out') {
                    zoomOut();
                }
            }

            function zoomIn() {
                const center = (zoomStart + zoomEnd) / 2;
                const half = (zoomEnd - zoomStart) / 2 * 0.7;
                zoomStart = Math.max(0, center - half);
                zoomEnd = Math.min(1, center + half);
                scheduleRender();
            }

            function zoomOut() {
                const center = (zoomStart + zoomEnd) / 2;
                const half = (zoomEnd - zoomStart) / 2 * (1 / 0.7);
                zoomStart = Math.max(0, center - half);
                zoomEnd = Math.min(1, center + half);
                scheduleRender();
            }

            function handleZoomWheel(e) {
                const scaleFactor = e.deltaY > 0 ? 1.15 : 0.85;
                const span = (zoomEnd - zoomStart) * scaleFactor;

                // Compute normalized time under cursor, keeping it pinned
                const wrapper = document.getElementById('tracks-wrapper');
                let pivotNorm = (zoomStart + zoomEnd) / 2; // fallback: current center
                if (wrapper) {
                    const rect = wrapper.getBoundingClientRect();
                    const plotLeft = rect.left + 130; // 130px track header
                    const plotWidth = rect.width - 130;
                    const mouseX = e.clientX - plotLeft;
                    if (plotWidth > 0 && mouseX >= 0 && mouseX <= plotWidth) {
                        pivotNorm = zoomStart + (mouseX / plotWidth) * (zoomEnd - zoomStart);
                    }
                }

                // Ratio of pivot within current span → keep same ratio after zoom
                const pivotRatio = (zoomEnd - zoomStart) > 0
                    ? (pivotNorm - zoomStart) / (zoomEnd - zoomStart)
                    : 0.5;
                let newStart = pivotNorm - pivotRatio * span;
                let newEnd = newStart + span;
                if (newEnd > 1) { newEnd = 1; newStart = Math.max(0, 1 - span); }
                if (newStart < 0) { newStart = 0; newEnd = Math.min(1, span); }
                zoomStart = newStart;
                zoomEnd = newEnd;
                scheduleRender();
            }

            function handlePanWheel(e) {
                const shift = (zoomEnd - zoomStart) * 0.1 * (e.deltaY > 0 ? 1 : -1);
                if (zoomStart + shift < 0) { zoomEnd -= zoomStart; zoomStart = 0; }
                else if (zoomEnd + shift > 1) { zoomStart += 1 - zoomEnd; zoomEnd = 1; }
                else { zoomStart += shift; zoomEnd += shift; }
                scheduleRender();
            }

            function handleCanvasMouseMove(e) {
                if (dragState && dragState.isDrag) {
                    hideTooltip();
                    return;
                }
                const canvas = e.target;
                if (!canvas.classList.contains('track-canvas')) { return; }
                if (dragState) { return; }
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);

                const gripType = getGripType(norm);
                if (gripType) {
                    showTooltip(e, 'ドラッグでループ区間をリサイズ');
                } else if (loopRegion && norm >= loopRegion.start && norm <= loopRegion.end) {
                    showTooltip(e, 'クリックでループ解除');
                } else {
                    showTooltip(e, 'ドラッグ: ループ区間を設定\\nShift+ドラッグ: トラックの時間をずらす');
                }

                renderWithHoverAt(norm);
            }

            function getGripType(norm) {
                if (!loopRegion) { return null; }
                const GRIP_THRESH = (zoomEnd - zoomStart) * 0.015;
                if (Math.abs(norm - loopRegion.start) < GRIP_THRESH) { return 'gripStart'; }
                if (Math.abs(norm - loopRegion.end) < GRIP_THRESH) { return 'gripEnd'; }
                return null;
            }

            function handleCanvasMouseDown(e) {
                const canvas = e.target;
                if (!canvas.classList.contains('track-canvas')) { return; }
                const idx = parseInt(canvas.getAttribute('data-track-index'), 10);
                if (isNaN(idx)) { return; }
                if (e.button === 0) {
                    const rect = canvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                    const gripType = getGripType(norm);
                    dragState = {
                        trackIndex: idx,
                        startClientX: e.clientX,
                        startOffset: trackRuntime[idx].offsetSeconds,
                        canvasWidth: canvas.width,
                        isDrag: false,
                        isShift: e.shiftKey,
                        startNorm: norm,
                        dragType: gripType || (e.shiftKey ? 'offset' : 'loop'),
                    };
                    canvas.focus();
                }
            }

            function handleDocMouseMove(e) {
                if (!dragState) { return; }
                const dx = e.clientX - dragState.startClientX;
                if (Math.abs(dx) > 3) { dragState.isDrag = true; }
                if (!dragState.isDrag) { return; }
                hideTooltip();

                if (dragState.dragType === 'offset') {
                    const gs = computeGlobalSpan();
                    const secsPerPx = (zoomEnd - zoomStart) * gs.spanSec / dragState.canvasWidth;
                    trackRuntime[dragState.trackIndex].offsetSeconds = dragState.startOffset + dx * secsPerPx;
                    updateOffsetDisplays();
                } else if (dragState.dragType === 'loop') {
                    const canvasEl = document.getElementById('track-canvas-' + dragState.trackIndex);
                    if (!canvasEl) { scheduleRender(); return; }
                    const rect = canvasEl.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const norm = Math.max(0, Math.min(1, zoomStart + (x / dragState.canvasWidth) * (zoomEnd - zoomStart)));
                    const s = Math.min(dragState.startNorm, norm);
                    const end = Math.max(dragState.startNorm, norm);
                    if (end > s) { loopRegion = { start: s, end: end }; }
                } else if (dragState.dragType === 'gripStart') {
                    const canvasEl = document.getElementById('track-canvas-' + dragState.trackIndex);
                    if (!canvasEl || !loopRegion) { scheduleRender(); return; }
                    const rect = canvasEl.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const norm = Math.max(0, Math.min(loopRegion.end - 0.001, zoomStart + (x / dragState.canvasWidth) * (zoomEnd - zoomStart)));
                    loopRegion = { start: norm, end: loopRegion.end };
                } else if (dragState.dragType === 'gripEnd') {
                    const canvasEl = document.getElementById('track-canvas-' + dragState.trackIndex);
                    if (!canvasEl || !loopRegion) { scheduleRender(); return; }
                    const rect = canvasEl.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const norm = Math.max(loopRegion.start + 0.001, Math.min(1, zoomStart + (x / dragState.canvasWidth) * (zoomEnd - zoomStart)));
                    loopRegion = { start: loopRegion.start, end: norm };
                }
                scheduleRender();
            }

            function handleDocMouseUp(e) {
                if (dragState && !dragState.isDrag) {
                    // クリック（ドラッグなし）: カーソル移動 + ループ区間解除
                    const canvasId = 'track-canvas-' + dragState.trackIndex;
                    const canvas = document.getElementById(canvasId);
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                        cursorNorm = Math.max(0, Math.min(1, norm));
                        loopRegion = null;
                        updateCursorDisplay(cursorNorm);
                        scheduleRender();
                    }
                }
                dragState = null;
            }

            function renderWithHoverAt(norm) {
                hoverNorm = norm;
                scheduleRender();
                updateCursorDisplay(norm);
            }

            function clearHover() {
                if (hoverNorm === null) { return; }
                hoverNorm = null;
                hideTooltip();
                scheduleRender();
                updateCursorDisplay(cursorNorm);
            }

            function updateCursorDisplay(norm) {
                const gs = computeGlobalSpan();
                const t = gs.startSec + norm * gs.spanSec;
                const el = document.getElementById('cursor-display');
                if (el) { el.textContent = formatTime(t); }
            }


            function toggleMute(idx) {
                if (idx === playbackTrackIndex) { stopPlayback(idx); }
                trackRuntime[idx].hidden = !trackRuntime[idx].hidden;
                const btn = document.querySelector('[data-action="toggle-mute"][data-track-index="' + idx + '"]');
                if (btn) { btn.classList.toggle('is-muted', trackRuntime[idx].hidden); }
                updateVisibility();
                scheduleRender();
            }

            function removeTrack(idx) {
                if (idx === playbackTrackIndex) { stopPlayback(idx); }
                const row = document.getElementById('track-row-' + idx);
                if (row) { row.remove(); }
                const audio = getTrackAudio(idx);
                if (audio) { audio.remove(); }
                trackRuntime[idx].hidden = true;
                updateVisibility();
                scheduleRender();
            }

            function adjustOffset(idx, deltaSeconds) {
                trackRuntime[idx].offsetSeconds += deltaSeconds;
                updateOffsetDisplays();
                scheduleRender();
            }
        })();
        `;
    }
}
