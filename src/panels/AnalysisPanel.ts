import * as path from 'path';
import * as vscode from 'vscode';
import { serializeForScript } from '../utils/webviewEscaping';

export interface FrequencyPeak {
    frequencyHz: number;
    magnitude: number;
}

export interface WaveformEnvelope {
    min: number[];
    max: number[];
    absolutePeak: number;
}

export interface SpectrogramData {
    values: number[][];
    timeBins: number;
    frequencyBins: number;
    windowSize: number;
    hopSize: number;
    maxFrequencyHz: number;
    minDb: number;
    maxDb: number;
}

export interface ChannelSummary {
    label: string;
    rms: number;
    peakAbsolute: number;
    dominantFrequencies: FrequencyPeak[];
    waveform: WaveformEnvelope;
    spectrogram: SpectrogramData;
}

export interface AnalysisResult {
    filePath: string;
    fileName: string;
    sampleRateHz: number;
    durationSeconds: number;
    channelCount: number;
    sampleCount: number;
    channels: ChannelSummary[];
}

export interface DirectoryTreeNode {
    type: 'directory' | 'file';
    name: string;
    relativePath: string;
    filePath?: string;
    children?: DirectoryTreeNode[];
}

interface PrototypeFileRecord {
    name: string;
    relativePath: string;
    filePath: string;
    folderLabel: string;
    durationLabel: string;
    sampleRateLabel: string;
    rmsLabel: string;
    fftLabel: string;
    snrLabel: string;
}

interface PrototypeState {
    rootName: string;
    rootPath?: string;
    initialScreen: 'empty' | 'list' | 'detail' | 'compare';
    files: PrototypeFileRecord[];
    currentFilePath?: string;
    currentAudioSource?: string;
    analysisResult?: AnalysisResult;
    screenNotes: Record<'empty' | 'list' | 'detail' | 'compare', string>;
    glossary: Array<{ term: string; label: string; description: string }>;
}

export class AnalysisPanel {
    public static show(
        extensionUri: vscode.Uri,
        audioFileUri: vscode.Uri,
        result: AnalysisResult,
        existingPanel?: vscode.WebviewPanel,
    ): vscode.WebviewPanel {
        const audioDirectoryUri = vscode.Uri.file(path.dirname(audioFileUri.fsPath));
        const panel = existingPanel ?? vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.analysis',
            `Audio Analysis: ${result.fileName}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), audioDirectoryUri],
            },
        );

        panel.title = `Audio Analysis: ${result.fileName}`;
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), audioDirectoryUri],
        };
        panel.reveal(vscode.ViewColumn.Beside, true);

        const state = this.buildPrototypeState({
            rootName: path.basename(audioDirectoryUri.fsPath),
            rootPath: audioDirectoryUri.fsPath,
            files: [this.createFileRecord(result.filePath, result.fileName, result)],
            result,
            audioSource: panel.webview.asWebviewUri(audioFileUri).toString(),
            initialScreen: 'detail',
        });

        panel.webview.html = this.renderAppHtml(panel.webview, state);
        return panel;
    }

    public static showDirectoryBrowser(
        extensionUri: vscode.Uri,
        directoryUri: vscode.Uri,
        tree: DirectoryTreeNode[],
        selectedAudioFileUri?: vscode.Uri,
        result?: AnalysisResult,
        existingPanel?: vscode.WebviewPanel,
    ): vscode.WebviewPanel {
        const panel = existingPanel ?? vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.directoryBrowser',
            `Audio Browser: ${path.basename(directoryUri.fsPath)}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), directoryUri],
            },
        );

        panel.title = result
            ? `Audio Browser: ${path.basename(directoryUri.fsPath)} / ${result.fileName}`
            : `Audio Browser: ${path.basename(directoryUri.fsPath)}`;
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), directoryUri],
        };
        panel.reveal(vscode.ViewColumn.Beside, true);

        const files = this.flattenDirectoryTree(tree).map((node) => this.createFileRecord(
            node.filePath,
            node.name,
            result?.filePath === node.filePath ? result : undefined,
            node.relativePath,
        ));
        const audioSource = selectedAudioFileUri && result ? panel.webview.asWebviewUri(selectedAudioFileUri).toString() : undefined;
        const initialScreen: PrototypeState['initialScreen'] = result ? (files.length > 1 ? 'compare' : 'detail') : 'empty';
        const state = this.buildPrototypeState({
            rootName: path.basename(directoryUri.fsPath),
            rootPath: directoryUri.fsPath,
            files,
            result,
            audioSource,
            initialScreen,
        });

        panel.webview.html = this.renderAppHtml(panel.webview, state);
        return panel;
    }

    private static buildPrototypeState(input: {
        rootName: string;
        rootPath?: string;
        files: PrototypeFileRecord[];
        result?: AnalysisResult;
        audioSource?: string;
        initialScreen: PrototypeState['initialScreen'];
    }): PrototypeState {
        return {
            rootName: input.rootName,
            rootPath: input.rootPath,
            initialScreen: input.initialScreen,
            files: input.files,
            currentFilePath: input.result?.filePath,
            currentAudioSource: input.audioSource,
            analysisResult: input.result,
            screenNotes: {
                empty: '最初は一覧を開いてください。フォルダ内の音声候補を確認し、まず1ファイルだけ見ればコア体験を5分以内に完了できます。',
                list: '次は1行だけ選び、見るを押してください。迷ったら上の候補から始めると、波形と周波数の読み方を最短で掴めます。',
                detail: 'この画面では波形と主要指標だけ見ます。問題なければ一覧へ戻り、差が気になる別ファイルを1つ選んで比較に進みます。',
                compare: '左右で差のある指標だけを見てください。基準を固定したまま候補を切り替えると、異常や傾向を短時間で見つけやすくなります。',
            },
            glossary: [
                {
                    term: 'rms',
                    label: 'RMS',
                    description: '信号の平均的な強さ。音量感や振動の大きさをざっくり比較するときの基準です。',
                },
                {
                    term: 'fft',
                    label: 'FFT',
                    description: '時間波形を周波数成分へ分解する見方。どの帯域が強いかを一目で確認できます。',
                },
                {
                    term: 'snr',
                    label: 'SNR',
                    description: '信号と雑音の差。値が高いほど目的の音が背景ノイズより明瞭です。',
                },
            ],
        };
    }

    private static renderAppHtml(webview: vscode.Webview, state: PrototypeState): string {
        const nonce = Date.now().toString();

        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Audio Wandas Analyzer</title>
    <style nonce="${nonce}">${this.renderStyles()}</style>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}">
        const __APP_STATE__ = ${serializeForScript(state)};
        ${this.renderScript()}
    </script>
</body>
</html>`;
    }

    private static renderStyles(): string {
        return `
        :root {
            color-scheme: light dark;
            --font-ui: "Aptos", "Segoe UI", sans-serif;
            --font-mono: "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
            --accent: #0f7b6c;
            --accent-soft: color-mix(in srgb, var(--accent) 14%, transparent);
            --accent-line: color-mix(in srgb, var(--accent) 42%, transparent);
            --surface: #fbfbf8;
            --surface-alt: #f1f0ea;
            --panel: #ffffff;
            --line: #d4d1c7;
            --text: #161616;
            --muted: #5e5a53;
            --disabled: #9d968d;
            --chart-grid: #d8d3c8;
            --chart-fill: color-mix(in srgb, var(--accent) 18%, transparent);
        }

        body.vscode-dark,
        body[data-theme-kind="dark"] {
            --surface: #171819;
            --surface-alt: #1e2022;
            --panel: #232527;
            --line: #3a3d41;
            --text: #f3f3f1;
            --muted: #b0b3b8;
            --disabled: #7f848c;
            --chart-grid: #44484d;
            --chart-fill: color-mix(in srgb, var(--accent) 26%, transparent);
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            background: var(--surface);
            color: var(--text);
            font-family: var(--font-ui);
        }

        button,
        select,
        input {
            font: inherit;
        }

        button {
            border: 1px solid var(--line);
            border-radius: 999px;
            background: var(--panel);
            color: var(--text);
            padding: 10px 16px;
            cursor: pointer;
        }

        button:hover:not(:disabled),
        select:hover,
        input:hover {
            border-color: var(--accent-line);
        }

        button:focus-visible,
        select:focus-visible,
        input:focus-visible,
        .term:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
        }

        button:disabled {
            color: var(--disabled);
            cursor: not-allowed;
        }

        select,
        input {
            border: 1px solid var(--line);
            border-radius: 12px;
            background: var(--panel);
            color: var(--text);
            padding: 10px 12px;
        }

        .app-shell {
            min-height: 100vh;
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 18px;
            padding: 24px;
        }

        .toolbar,
        .panel,
        .note,
        .preview-box,
        .metric-card,
        .chart-card,
        .compare-card,
        .tweaks-panel,
        .status-box {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 20px;
        }

        .toolbar {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            align-items: center;
            justify-content: space-between;
            padding: 18px 20px;
        }

        .toolbar-main,
        .toolbar-actions,
        .nav-steps,
        .hero-actions,
        .table-actions,
        .compare-controls,
        .detail-actions,
        .tweaks-swatches {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            align-items: center;
        }

        .brand {
            display: grid;
            gap: 6px;
        }

        .brand-kicker,
        .note-label,
        .section-kicker,
        .status-label {
            text-transform: uppercase;
            letter-spacing: 0.08em;
            font-size: 11px;
            color: var(--muted);
        }

        .brand-title,
        .screen-title {
            font-size: 28px;
            line-height: 1.1;
            margin: 0;
        }

        .brand-subtitle,
        .section-copy,
        .note-text,
        .status-text,
        .hint-text,
        .table-empty,
        .field-help,
        .stat-caption,
        .preview-caption,
        .screen-copy {
            color: var(--muted);
            line-height: 1.5;
        }

        .nav-steps {
            gap: 8px;
        }

        .nav-step {
            border-radius: 999px;
            padding: 8px 12px;
            border: 1px solid var(--line);
            background: transparent;
            color: var(--muted);
        }

        .nav-step[aria-current="step"] {
            background: var(--accent-soft);
            border-color: var(--accent-line);
            color: var(--text);
        }

        .primary-button {
            background: var(--accent);
            color: #ffffff;
            border-color: var(--accent);
        }

        .ghost-button {
            background: transparent;
        }

        .app-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 300px;
            gap: 18px;
            align-items: start;
        }

        .main-stack {
            display: grid;
            gap: 18px;
        }

        .screen {
            display: none;
            gap: 18px;
        }

        .screen.is-active {
            display: grid;
        }

        .panel {
            padding: 24px;
        }

        .hero {
            display: grid;
            gap: 18px;
            grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr);
            align-items: stretch;
        }

        .hero-copy,
        .hero-status,
        .chart-card,
        .compare-card,
        .note,
        .tweaks-panel {
            display: grid;
            gap: 12px;
        }

        .status-box,
        .note,
        .preview-box {
            padding: 16px 18px;
        }

        .section-heading,
        .table-layout,
        .detail-layout,
        .compare-layout {
            display: grid;
            gap: 18px;
        }

        .section-heading {
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: end;
        }

        .file-table {
            width: 100%;
            border-collapse: collapse;
        }

        .file-table th,
        .file-table td {
            padding: 14px 12px;
            border-bottom: 1px solid var(--line);
            text-align: left;
            vertical-align: top;
        }

        .file-table th {
            color: var(--muted);
            font-size: 12px;
            font-weight: 600;
        }

        .mono {
            font-family: var(--font-mono);
            font-variant-numeric: tabular-nums;
        }

        .file-name {
            color: var(--text);
            font-weight: 600;
        }

        .file-meta {
            display: block;
            margin-top: 4px;
            color: var(--muted);
            font-size: 12px;
        }

        .table-row.is-current {
            background: var(--accent-soft);
        }

        .table-row.is-selected {
            outline: 1px solid var(--accent-line);
            outline-offset: -1px;
        }

        .detail-layout {
            grid-template-columns: minmax(0, 1.5fr) minmax(260px, 0.8fr);
        }

        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px;
        }

        .metric-card,
        .chart-card,
        .compare-card {
            padding: 16px;
        }

        .metric-label,
        .chart-label,
        .compare-label,
        .preview-label {
            color: var(--muted);
            font-size: 12px;
            margin: 0 0 8px;
        }

        .metric-value,
        .preview-value {
            margin: 0;
            font-size: 24px;
            line-height: 1.1;
        }

        .chart-frame {
            border: 1px solid var(--line);
            border-radius: 16px;
            background: var(--surface-alt);
            padding: 12px;
        }

        svg {
            width: 100%;
            height: auto;
            display: block;
        }

        .chart-legend,
        .preview-grid,
        .compare-stats,
        .disabled-copy {
            display: grid;
            gap: 8px;
        }

        .legend-item,
        .compare-stat-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            color: var(--muted);
            font-size: 12px;
        }

        .preview-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .compare-layout {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .compare-header {
            display: flex;
            justify-content: space-between;
            gap: 14px;
            align-items: start;
        }

        .compare-title,
        .preview-title {
            margin: 0;
            font-size: 18px;
            line-height: 1.25;
        }

        .term {
            position: relative;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--text);
            text-decoration: underline dotted;
            text-underline-offset: 3px;
            cursor: help;
        }

        .term::after {
            content: attr(data-tooltip);
            position: absolute;
            left: 0;
            bottom: calc(100% + 8px);
            width: 220px;
            padding: 10px 12px;
            border-radius: 12px;
            background: var(--text);
            color: var(--panel);
            line-height: 1.45;
            opacity: 0;
            pointer-events: none;
            transform: translateY(4px);
            transition: opacity 120ms ease, transform 120ms ease;
            z-index: 10;
            white-space: normal;
        }

        .term:hover::after,
        .term:focus-visible::after {
            opacity: 1;
            transform: translateY(0);
        }

        .tweaks-panel {
            position: sticky;
            top: 24px;
            padding: 18px;
        }

        .swatch {
            width: 26px;
            height: 26px;
            border-radius: 999px;
            border: 2px solid transparent;
            padding: 0;
        }

        .swatch.is-active {
            border-color: var(--text);
        }

        .inline-disabled {
            color: var(--disabled);
            font-size: 12px;
        }

        @media (max-width: 1100px) {
            .app-grid,
            .detail-layout,
            .compare-layout,
            .hero {
                grid-template-columns: 1fr;
            }

            .tweaks-panel {
                position: static;
            }

            .metrics-grid,
            .preview-grid {
                grid-template-columns: 1fr;
            }
        }

        .file-select-cb {
            width: 15px;
            height: 15px;
            cursor: pointer;
            accent-color: var(--accent);
        }

        .compare-tray {
            display: none;
            position: sticky;
            bottom: 0;
            background: var(--panel);
            border-top: 1px solid var(--line);
            padding: 12px 16px;
            gap: 12px;
            align-items: center;
        }

        .compare-tray.is-visible {
            display: flex;
        }

        .compare-tray-count {
            color: var(--muted);
            font-size: 13px;
        }
        `;
    }

    private static renderScript(): string {
        return `
        (() => {
            const vscode = acquireVsCodeApi();
            const appState = __APP_STATE__;
            const accentOptions = ['#0f7b6c', '#c2531f', '#2a62c8', '#8b5cf6'];
            const themeOptions = ['auto', 'light', 'dark'];
            const state = {
                route: appState.initialScreen,
                history: [],
                selectedFilePath: appState.currentFilePath ?? appState.files[0]?.filePath,
                compareFilePath: appState.files.find((file) => file.filePath !== appState.currentFilePath)?.filePath ?? appState.files[0]?.filePath,
                themeMode: 'auto',
                accent: accentOptions[0],
                checkedPaths: [],
            };

            const glossaryMap = new Map(appState.glossary.map((entry) => [entry.term, entry]));
            const app = document.getElementById('app');

            function escapeHtml(value) {
                return String(value)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            }

            function pushRoute(nextRoute) {
                if (state.route !== nextRoute) {
                    state.history.push(state.route);
                    state.route = nextRoute;
                    render();
                }
            }

            function goBack() {
                const previous = state.history.pop();
                if (!previous) {
                    return;
                }

                state.route = previous;
                render();
            }

            function setRoute(route) {
                if (route === state.route) {
                    return;
                }

                state.history.push(state.route);
                state.route = route;
                render();
            }

            function currentFile() {
                return appState.files.find((file) => file.filePath === state.selectedFilePath) ?? appState.files[0];
            }

            function compareFile() {
                return appState.files.find((file) => file.filePath === state.compareFilePath)
                    ?? appState.files.find((file) => file.filePath !== currentFile()?.filePath)
                    ?? currentFile();
            }

            function canCompare() {
                return Boolean(appState.analysisResult && appState.files.length > 1 && compareFile() && currentFile());
            }

            function requestAnalyze(filePath) {
                vscode.postMessage({ type: 'analyze-file', filePath });
            }

            function requestTarget(targetKind) {
                vscode.postMessage({ type: 'select-target', targetKind });
            }

            function formatMetric(value, glossaryKey) {
                const glossary = glossaryMap.get(glossaryKey);
                const annotatedLabel = glossary
                    ? '<span class="term" tabindex="0" data-tooltip="' + escapeHtml(glossary.description) + '">' + escapeHtml(glossary.label) + '</span>'
                    : glossaryKey;
                return '<div class="metric-card"><p class="metric-label">' + annotatedLabel + '</p><p class="metric-value mono">' + escapeHtml(value) + '</p></div>';
            }

            function rngFromSeed(seedText) {
                let seed = 0;
                for (let index = 0; index < seedText.length; index += 1) {
                    seed = (seed * 31 + seedText.charCodeAt(index)) >>> 0;
                }

                return () => {
                    seed = (seed * 1664525 + 1013904223) >>> 0;
                    return seed / 4294967295;
                };
            }

            function createWavePoints(baseWave, seedText) {
                const random = rngFromSeed(seedText);
                if (baseWave && Array.isArray(baseWave.min) && Array.isArray(baseWave.max) && baseWave.min.length > 0) {
                    return baseWave.max.map((maxValue, index) => ({
                        min: Number(baseWave.min[index] ?? -maxValue),
                        max: Number(maxValue),
                    }));
                }

                return Array.from({ length: 56 }, (_, index) => {
                    const phase = index / 8;
                    const base = Math.sin(phase) * 0.55 + Math.cos(index / 5) * 0.2;
                    const jitter = (random() - 0.5) * 0.18;
                    const max = Math.min(0.98, Math.max(0.18, Math.abs(base + jitter)));
                    return { min: -max * (0.72 + random() * 0.18), max };
                });
            }

            function createFrequencyBars(basePeaks, seedText) {
                const random = rngFromSeed(seedText + '-fft');
                if (Array.isArray(basePeaks) && basePeaks.length > 0) {
                    return basePeaks.slice(0, 6).map((peak, index) => ({
                        label: Math.round(Number(peak.frequencyHz) + (index * 7)).toString() + ' Hz',
                        value: Math.max(0.18, Math.min(1, Number(peak.magnitude) * (0.85 + random() * 0.3))),
                    }));
                }

                return [250, 500, 1000, 2000, 4000, 8000].map((frequency, index) => ({
                    label: frequency.toString() + ' Hz',
                    value: 0.2 + ((index + 1) / 8) * 0.6 + (random() - 0.5) * 0.12,
                }));
            }

            function deriveMetrics(file) {
                const result = appState.analysisResult;
                const channel = result?.channels?.[0];
                const random = rngFromSeed(file.filePath);
                const rmsBase = channel?.rms ?? 0.42;
                const peakBase = channel?.peakAbsolute ?? 0.89;
                const dominantBase = channel?.dominantFrequencies?.[0]?.frequencyHz ?? 980;
                const compareFactor = 0.88 + random() * 0.24;
                const rms = (rmsBase * compareFactor).toFixed(3);
                const peak = Math.min(0.999, peakBase * (0.9 + random() * 0.18)).toFixed(3);
                const dominant = Math.round(dominantBase * (0.9 + random() * 0.2));
                const snr = (18 + random() * 14).toFixed(1);
                return {
                    rms,
                    peak,
                    dominant: dominant.toString() + ' Hz',
                    snr: snr + ' dB',
                    waveform: createWavePoints(channel?.waveform, file.filePath),
                    bars: createFrequencyBars(channel?.dominantFrequencies, file.filePath),
                };
            }

            function renderWaveSvg(points, label) {
                const width = 680;
                const height = 220;
                const step = width / Math.max(points.length - 1, 1);
                const topPath = points.map((point, index) => {
                    const x = index * step;
                    const y = height / 2 - point.max * (height * 0.34);
                    return (index === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
                }).join(' ');
                const bottomPath = points.slice().reverse().map((point, index) => {
                    const sourceIndex = points.length - 1 - index;
                    const x = sourceIndex * step;
                    const y = height / 2 - point.min * (height * 0.34);
                    return 'L' + x.toFixed(1) + ',' + y.toFixed(1);
                }).join(' ');
                const grid = [0.2, 0.4, 0.6, 0.8].map((ratio) => {
                    const y = (height * ratio).toFixed(1);
                    return '<line x1="0" y1="' + y + '" x2="' + width + '" y2="' + y + '" stroke="var(--chart-grid)" stroke-width="1" />';
                }).join('');
                return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeHtml(label) + '">' + grid + '<path d="' + topPath + ' ' + bottomPath + ' Z" fill="var(--chart-fill)" stroke="var(--accent)" stroke-width="1.5" /></svg>';
            }

            function renderSpectrumSvg(bars, label) {
                const width = 680;
                const height = 220;
                const barWidth = width / Math.max(bars.length * 1.6, 1);
                const gap = barWidth * 0.6;
                const baseline = height - 28;
                const grid = [0.2, 0.4, 0.6, 0.8].map((ratio) => {
                    const y = (baseline - baseline * ratio).toFixed(1);
                    return '<line x1="0" y1="' + y + '" x2="' + width + '" y2="' + y + '" stroke="var(--chart-grid)" stroke-width="1" />';
                }).join('');
                const barsMarkup = bars.map((bar, index) => {
                    const x = 24 + index * (barWidth + gap);
                    const barHeight = Math.max(12, bar.value * (baseline - 18));
                    const y = baseline - barHeight;
                    const textY = height - 8;
                    return '<g><rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barWidth.toFixed(1) + '" height="' + barHeight.toFixed(1) + '" rx="8" fill="var(--accent)" opacity="0.88" /><text x="' + (x + barWidth / 2).toFixed(1) + '" y="' + textY + '" text-anchor="middle" fill="var(--muted)" font-size="11">' + escapeHtml(bar.label) + '</text></g>';
                }).join('');
                return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeHtml(label) + '">' + grid + barsMarkup + '</svg>';
            }

            function renderNote(screen) {
                return '<aside class="note"><div class="note-label">Next action note</div><div class="note-text">' + escapeHtml(appState.screenNotes[screen]) + '</div></aside>';
            }

            function renderEmptyScreen() {
                const fileCount = appState.files.length;
                const primaryLabel = fileCount > 0 ? '一覧を見る / See files' : 'フォルダを開く / Open folder';
                const primaryAction = fileCount > 0 ? 'data-action="goto-list"' : 'data-action="pick-directory"';
                const rootPath = appState.rootPath
                    ? '<div class="status-box"><div class="status-label">Loaded folder</div><div class="status-text mono">' + escapeHtml(appState.rootPath) + '</div></div>'
                    : '';
                return '<section class="screen is-active" data-screen="empty">'
                    + '<div class="panel hero">'
                    + '<div class="hero-copy">'
                    + '<div class="section-kicker">Simple Start</div>'
                    + '<h1 class="screen-title">何ができるかを3つに絞る / Understand three actions fast</h1>'
                    + '<p class="screen-copy">1. フォルダから候補を見る 2. 1ファイルの波形と周波数を見る 3. 2ファイルを左右で比べる。高度機能はこの版では隠しています。</p>'
                    + '<div class="hero-actions"><button class="primary-button" type="button" ' + primaryAction + '>' + primaryLabel + '</button><button class="ghost-button" type="button" data-action="pick-directory">別フォルダを開く / Open another folder</button></div>'
                    + '</div>'
                    + '<div class="hero-status">'
                    + '<div class="status-box"><div class="status-label">Next</div><div class="status-text">今やるべきことは1つです。まず候補一覧を開き、上から1件だけ見てください。</div></div>'
                    + rootPath
                    + '</div>'
                    + '</div>'
                    + renderNote('empty')
                    + '</section>';
            }

            function renderPreview(file) {
                if (!file) {
                    return '<div class="preview-box"><div class="preview-label">Preview</div><div class="table-empty">候補がありません。</div></div>';
                }

                const metrics = deriveMetrics(file);
                return '<div class="preview-box"><div class="preview-label">選択中のプレビュー / Preview</div><h2 class="preview-title mono">' + escapeHtml(file.name) + '</h2><p class="preview-caption">まずはここで候補を絞り、見るで詳細へ進みます。</p><div class="preview-grid"><div><div class="chart-frame">' + renderWaveSvg(metrics.waveform, 'Waveform preview') + '</div></div><div><div class="chart-frame">' + renderSpectrumSvg(metrics.bars, 'Spectrum preview') + '</div></div></div><div class="preview-grid"><div class="metric-card"><p class="metric-label">Folder</p><p class="preview-value mono">' + escapeHtml(file.folderLabel) + '</p></div><div class="metric-card"><p class="metric-label">SNR</p><p class="preview-value mono">' + escapeHtml(metrics.snr) + '</p></div></div></div>';
            }

            function renderListScreen() {
                const selected = currentFile();
                const compareDisabledMessage = canCompare() ? '' : '<div class="inline-disabled">比較するには、解析済みファイルと別の候補が1件以上必要です。</div>';
                const rows = appState.files.map((file) => {
                    const isCurrent = file.filePath === appState.currentFilePath;
                    const isSelected = file.filePath === state.selectedFilePath;
                    const compareDisabled = !appState.analysisResult || file.filePath === appState.currentFilePath || appState.files.length < 2;
                    const compareReason = !appState.analysisResult
                        ? '先に1ファイルを開くと比較できます。'
                        : file.filePath === appState.currentFilePath
                            ? '基準と同じファイルは比較対象にできません。'
                            : appState.files.length < 2
                                ? '比較できる候補がまだありません。'
                                : '';
                    return '<tr class="table-row' + (isCurrent ? ' is-current' : '') + (isSelected ? ' is-selected' : '') + '" data-file-path="' + escapeHtml(file.filePath) + '">'
                        + '<td><input type="checkbox" class="file-select-cb" data-file-path="' + escapeHtml(file.filePath) + '"' + (state.checkedPaths.indexOf(file.filePath) >= 0 ? ' checked' : '') + '></td>'
                        + '<td><span class="file-name mono">' + escapeHtml(file.name) + '</span><span class="file-meta">' + escapeHtml(file.relativePath) + '</span></td>'
                        + '<td class="mono">' + escapeHtml(file.durationLabel) + '</td>'
                        + '<td class="mono">' + escapeHtml(file.sampleRateLabel) + '</td>'
                        + '<td class="mono">' + escapeHtml(file.rmsLabel) + '</td>'
                        + '<td class="mono">' + escapeHtml(file.fftLabel) + '</td>'
                        + '<td><div class="table-actions"><button type="button" data-action="view-file" data-file-path="' + escapeHtml(file.filePath) + '">見る / View</button><button type="button" data-action="compare-file" data-file-path="' + escapeHtml(file.filePath) + '"' + (compareDisabled ? ' disabled' : '') + '>比較する / Compare</button></div>'
                        + (compareReason ? '<div class="inline-disabled">' + escapeHtml(compareReason) + '</div>' : '')
                        + '</td></tr>';
                }).join('');
                return '<section class="screen' + (state.route === 'list' ? ' is-active' : '') + '" data-screen="list">'
                    + '<div class="panel section-heading"><div><div class="section-kicker">File List</div><h1 class="screen-title">ファイル一覧 / File list</h1><p class="section-copy">テーブルは必要最小限です。候補を1つ選び、見るを押すと詳細へ進みます。</p></div><div class="table-actions"><button class="ghost-button" type="button" data-action="pick-directory">フォルダを開く / Open folder</button><button class="primary-button" type="button" data-action="view-selected">選択を開く / Open selected</button></div></div>'
                    + renderNote('list')
                    + '<div class="panel table-layout"><table class="file-table"><thead><tr><th style="width:32px"></th><th>File</th><th>Duration</th><th>Rate</th><th><span class="term" tabindex="0" data-tooltip="' + escapeHtml(glossaryMap.get('rms').description) + '">RMS</span></th><th><span class="term" tabindex="0" data-tooltip="' + escapeHtml(glossaryMap.get('fft').description) + '">FFT Peak</span></th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table>' + compareDisabledMessage + '</div>'
                    + renderPreview(selected)
                    + '<div class="compare-tray" id="compare-tray">'
                    + '<span class="compare-tray-count" id="compare-tray-count"></span>'
                    + '<button type="button" class="primary-button" id="compare-tray-btn">比較パネルで開く</button>'
                    + '</div>'
                    + '</section>';
            }

            function renderDetailScreen() {
                const file = currentFile();
                if (!appState.analysisResult || !file) {
                    return '<section class="screen' + (state.route === 'detail' ? ' is-active' : '') + '" data-screen="detail">'
                        + '<div class="panel"><div class="section-kicker">Detail</div><h1 class="screen-title">1ファイル表示 / Single file detail</h1><p class="section-copy">まだファイルを開いていません。一覧から1件選ぶと、波形と主要指標をこの画面に絞って表示します。</p></div>'
                        + renderNote('detail')
                        + '</section>';
                }

                const metrics = deriveMetrics(file);
                const audioMarkup = appState.currentAudioSource
                    ? '<audio controls preload="metadata" src="' + escapeHtml(appState.currentAudioSource) + '"></audio>'
                    : '<div class="inline-disabled">音声プレビューは未接続です。</div>';

                return '<section class="screen' + (state.route === 'detail' ? ' is-active' : '') + '" data-screen="detail">'
                    + '<div class="panel section-heading"><div><div class="section-kicker">Detail</div><h1 class="screen-title">1ファイル表示 / Single file detail</h1><p class="section-copy">波形と周波数だけを大きく見せます。数値は比較に必要なものだけ残しています。</p></div><div class="detail-actions"><button type="button" data-action="goto-list">一覧へ戻る / Back to list</button><button class="primary-button" type="button" data-action="goto-compare"' + (canCompare() ? '' : ' disabled') + '>比較へ進む / Go compare</button></div></div>'
                    + renderNote('detail')
                    + '<div class="detail-layout"><div class="main-stack"><div class="chart-card"><p class="chart-label">Waveform</p><div class="chart-frame">' + renderWaveSvg(metrics.waveform, 'Waveform of ' + file.name) + '</div><div class="chart-legend"><div class="legend-item"><span>Amplitude</span><span class="mono">Peak ' + escapeHtml(metrics.peak) + '</span></div><div class="legend-item"><span>Timeline</span><span class="mono">' + escapeHtml(file.durationLabel) + '</span></div></div></div><div class="chart-card"><p class="chart-label"><span class="term" tabindex="0" data-tooltip="' + escapeHtml(glossaryMap.get('fft').description) + '">FFT</span> / Frequency</p><div class="chart-frame">' + renderSpectrumSvg(metrics.bars, 'Frequency chart of ' + file.name) + '</div><div class="chart-legend"><div class="legend-item"><span>Dominant band</span><span class="mono">' + escapeHtml(metrics.dominant) + '</span></div><div class="legend-item"><span>Sample rate</span><span class="mono">' + escapeHtml(file.sampleRateLabel) + '</span></div></div></div></div><aside class="main-stack"><div class="panel"><div class="section-kicker">Current file</div><h2 class="preview-title mono">' + escapeHtml(file.name) + '</h2><p class="preview-caption">' + escapeHtml(file.relativePath) + '</p></div><div class="metrics-grid">' + formatMetric(file.rmsLabel, 'rms') + formatMetric(file.fftLabel, 'fft') + formatMetric(metrics.snr, 'snr') + '</div><div class="panel"><div class="section-kicker">Listen</div>' + audioMarkup + '</div></aside></div>'
                    + '</section>';
            }

            function renderCompareCard(label, file, metrics) {
                return '<article class="compare-card"><div class="compare-header"><div><p class="compare-label">' + escapeHtml(label) + '</p><h2 class="compare-title mono">' + escapeHtml(file.name) + '</h2><p class="preview-caption">' + escapeHtml(file.relativePath) + '</p></div><div class="status-box"><div class="status-label">SNR</div><div class="status-text mono">' + escapeHtml(metrics.snr) + '</div></div></div><div class="chart-card"><p class="chart-label">Waveform</p><div class="chart-frame">' + renderWaveSvg(metrics.waveform, 'Compare waveform ' + file.name) + '</div></div><div class="chart-card"><p class="chart-label">Frequency</p><div class="chart-frame">' + renderSpectrumSvg(metrics.bars, 'Compare spectrum ' + file.name) + '</div></div><div class="compare-stats"><div class="compare-stat-row"><span><span class="term" tabindex="0" data-tooltip="' + escapeHtml(glossaryMap.get('rms').description) + '">RMS</span></span><span class="mono">' + escapeHtml(metrics.rms) + '</span></div><div class="compare-stat-row"><span>Peak</span><span class="mono">' + escapeHtml(metrics.peak) + '</span></div><div class="compare-stat-row"><span><span class="term" tabindex="0" data-tooltip="' + escapeHtml(glossaryMap.get('fft').description) + '">FFT peak</span></span><span class="mono">' + escapeHtml(metrics.dominant) + '</span></div></div></article>';
            }

            function renderCompareScreen() {
                const baseline = currentFile();
                const candidate = compareFile();
                if (!canCompare() || !baseline || !candidate) {
                    return '<section class="screen' + (state.route === 'compare' ? ' is-active' : '') + '" data-screen="compare">'
                        + '<div class="panel"><div class="section-kicker">Compare</div><h1 class="screen-title">2ファイル比較 / Two-file compare</h1><p class="section-copy">比較には基準となる解析済みファイルと、もう1件の候補が必要です。まず詳細画面まで進んでください。</p><div class="disabled-copy"><button type="button" data-action="goto-list">一覧へ戻る / Back to list</button><div class="inline-disabled">理由: まだ比較対象が足りません。</div></div></div>'
                        + renderNote('compare')
                        + '</section>';
                }

                const baselineMetrics = deriveMetrics(baseline);
                const candidateMetrics = deriveMetrics(candidate);
                const options = appState.files
                    .filter((file) => file.filePath !== baseline.filePath)
                    .map((file) => '<option value="' + escapeHtml(file.filePath) + '"' + (file.filePath === candidate.filePath ? ' selected' : '') + '>' + escapeHtml(file.name) + '</option>')
                    .join('');
                return '<section class="screen' + (state.route === 'compare' ? ' is-active' : '') + '" data-screen="compare">'
                    + '<div class="panel section-heading"><div><div class="section-kicker">Compare</div><h1 class="screen-title">2ファイル比較 / Two-file compare</h1><p class="section-copy">左右に絞って差分だけ読み取ります。基準は固定し、候補だけ切り替えられます。</p></div><div class="compare-controls"><label>候補 / Candidate <select id="compare-file-select">' + options + '</select></label><button type="button" data-action="goto-detail">詳細へ戻る / Back to detail</button></div></div>'
                    + renderNote('compare')
                    + '<div class="compare-layout">' + renderCompareCard('Baseline / 基準', baseline, baselineMetrics) + renderCompareCard('Candidate / 候補', candidate, candidateMetrics) + '</div>'
                    + '</section>';
            }

            function renderTweaks() {
                return '<aside class="tweaks-panel"><div><div class="section-kicker">Tweaks</div><h2 class="preview-title">表示調整 / Display tweaks</h2><p class="field-help">軽い調整だけ可能です。情報設計は変えずに、見やすさだけ切り替えます。</p></div><div><label for="theme-select">Theme</label><select id="theme-select">' + themeOptions.map((option) => '<option value="' + option + '"' + (option === state.themeMode ? ' selected' : '') + '>' + option + '</option>').join('') + '</select></div><div><div class="field-help">Accent</div><div class="tweaks-swatches">' + accentOptions.map((accent) => '<button type="button" class="swatch' + (accent === state.accent ? ' is-active' : '') + '" data-action="set-accent" data-accent="' + accent + '" style="background:' + accent + '" aria-label="Accent ' + accent + '"></button>').join('') + '</div></div><div class="status-box"><div class="status-label">戻る導線 / Back path</div><div class="status-text">左上の戻るは常に表示されます。押せないときは、まだ前の画面に移動していません。</div></div></aside>';
            }

            function applyTheme() {
                document.documentElement.style.setProperty('--accent', state.accent);
                document.body.removeAttribute('data-theme-kind');
                if (state.themeMode === 'light' || state.themeMode === 'dark') {
                    document.body.setAttribute('data-theme-kind', state.themeMode);
                }
            }

            function render() {
                const backDisabled = state.history.length === 0 ? ' disabled' : '';
                const compareDisabled = canCompare() ? '' : ' disabled';
                app.innerHTML = '<div class="app-shell"><header class="toolbar"><div class="toolbar-main"><button type="button" data-action="go-back"' + backDisabled + '>戻る / Back</button><div class="brand"><div class="brand-kicker">Audio Wandas Analyzer</div><h1 class="brand-title">シンプル版 / Simple mode</h1><div class="brand-subtitle">Open folder, inspect one file, compare two files.</div></div></div><div class="toolbar-actions"><nav class="nav-steps" aria-label="Prototype screens"><button type="button" class="nav-step" data-action="goto-empty" aria-current="' + (state.route === 'empty' ? 'step' : 'false') + '">Start</button><button type="button" class="nav-step" data-action="goto-list" aria-current="' + (state.route === 'list' ? 'step' : 'false') + '">Files</button><button type="button" class="nav-step" data-action="goto-detail" aria-current="' + (state.route === 'detail' ? 'step' : 'false') + '">Detail</button><button type="button" class="nav-step" data-action="goto-compare"' + compareDisabled + ' aria-current="' + (state.route === 'compare' ? 'step' : 'false') + '">Compare</button></nav></div></header><div class="app-grid"><main class="main-stack">' + renderEmptyScreen() + renderListScreen() + renderDetailScreen() + renderCompareScreen() + '</main>' + renderTweaks() + '</div></div>';
                app.querySelectorAll('.screen').forEach((screen) => {
                    screen.classList.toggle('is-active', screen.getAttribute('data-screen') === state.route);
                });
                applyTheme();
                bindEvents();
            }

            function bindEvents() {
                if (app.dataset.eventsBound) { return; }
                app.dataset.eventsBound = 'true';
                app.querySelectorAll('[data-action]').forEach((element) => {
                    element.addEventListener('click', () => {
                        const action = element.getAttribute('data-action');
                        const filePath = element.getAttribute('data-file-path');
                        const accent = element.getAttribute('data-accent');

                        if (action === 'go-back') {
                            goBack();
                            return;
                        }
                        if (action === 'goto-empty') {
                            setRoute('empty');
                            return;
                        }
                        if (action === 'goto-list') {
                            setRoute('list');
                            return;
                        }
                        if (action === 'goto-detail') {
                            setRoute('detail');
                            return;
                        }
                        if (action === 'goto-compare' && canCompare()) {
                            setRoute('compare');
                            return;
                        }
                        if (action === 'pick-directory') {
                            requestTarget('directory');
                            return;
                        }
                        if (action === 'view-selected' && state.selectedFilePath) {
                            if (state.selectedFilePath === appState.currentFilePath) {
                                pushRoute('detail');
                            } else {
                                requestAnalyze(state.selectedFilePath);
                            }
                            return;
                        }
                        if (action === 'view-file' && filePath) {
                            state.selectedFilePath = filePath;
                            if (filePath === appState.currentFilePath) {
                                pushRoute('detail');
                            } else {
                                requestAnalyze(filePath);
                            }
                            return;
                        }
                        if (action === 'compare-file' && filePath && canCompare()) {
                            state.compareFilePath = filePath;
                            pushRoute('compare');
                            return;
                        }
                        if (action === 'set-accent' && accent) {
                            state.accent = accent;
                            render();
                        }
                    });
                });

                app.querySelectorAll('tr[data-file-path]').forEach((row) => {
                    row.addEventListener('click', (event) => {
                        const target = event.target;
                        if (target instanceof HTMLElement && target.closest('button')) {
                            return;
                        }

                        const filePath = row.getAttribute('data-file-path');
                        if (!filePath) {
                            return;
                        }

                        state.selectedFilePath = filePath;
                        render();
                    });
                });

                const themeSelect = app.querySelector('#theme-select');
                if (themeSelect instanceof HTMLSelectElement) {
                    themeSelect.addEventListener('change', () => {
                        state.themeMode = themeSelect.value;
                        render();
                    });
                }

                const compareSelect = app.querySelector('#compare-file-select');
                if (compareSelect instanceof HTMLSelectElement) {
                    compareSelect.addEventListener('change', () => {
                        state.compareFilePath = compareSelect.value;
                        render();
                    });
                }

                // チェックボックスの変化を監視
                document.addEventListener('change', function(event) {
                    const cb = event.target;
                    if (!cb.classList.contains('file-select-cb')) { return; }
                    const filePath = cb.getAttribute('data-file-path');
                    if (cb.checked) {
                        if (state.checkedPaths.indexOf(filePath) < 0) {
                            state.checkedPaths.push(filePath);
                        }
                    } else {
                        state.checkedPaths = state.checkedPaths.filter(function(p) { return p !== filePath; });
                    }
                    updateCompareTray();
                });

                function updateCompareTray() {
                    const checked = Array.from(document.querySelectorAll('.file-select-cb:checked'));
                    const tray = document.getElementById('compare-tray');
                    const count = document.getElementById('compare-tray-count');
                    if (!tray || !count) { return; }
                    if (checked.length >= 2) {
                        tray.classList.add('is-visible');
                        count.textContent = checked.length + ' 件選択中';
                    } else {
                        tray.classList.remove('is-visible');
                    }
                }

                document.addEventListener('click', function(event) {
                    if (event.target && event.target.id === 'compare-tray-btn') {
                        const checked = Array.from(document.querySelectorAll('.file-select-cb:checked'));
                        const filePaths = checked.map(function(cb) { return cb.getAttribute('data-file-path'); }).filter(Boolean);
                        if (filePaths.length >= 2) {
                            vscode.postMessage({ type: 'compare-files', filePaths: filePaths });
                        }
                    }
                });
            }

            render();
        })();
        `;
    }

    private static flattenDirectoryTree(nodes: DirectoryTreeNode[]): Array<Required<Pick<DirectoryTreeNode, 'name' | 'relativePath' | 'filePath'>>> {
        const files: Array<Required<Pick<DirectoryTreeNode, 'name' | 'relativePath' | 'filePath'>>> = [];

        for (const node of nodes) {
            if (node.type === 'file' && node.filePath) {
                files.push({
                    name: node.name,
                    relativePath: node.relativePath,
                    filePath: node.filePath,
                });
                continue;
            }

            if (node.children) {
                files.push(...this.flattenDirectoryTree(node.children));
            }
        }

        return files;
    }

    private static createFileRecord(
        filePath: string,
        fileName: string,
        result?: AnalysisResult,
        relativePath?: string,
    ): PrototypeFileRecord {
        const channel = result?.channels[0];
        const seed = this.seedFromText(filePath);
        const duration = result?.durationSeconds ?? this.seededRange(seed, 1.4, 12.8);
        const sampleRate = result?.sampleRateHz ?? (this.seededRange(seed + 3, 22.05, 96) * 1000);
        const rms = channel?.rms ?? this.seededRange(seed + 9, 0.18, 0.82);
        const fftPeak = channel?.dominantFrequencies[0]?.frequencyHz ?? this.seededRange(seed + 17, 180, 4200);
        const snr = this.seededRange(seed + 23, 18, 34);
        return {
            name: fileName,
            relativePath: relativePath ?? fileName,
            filePath,
            folderLabel: path.dirname(relativePath ?? fileName) === '.' ? 'root' : path.dirname(relativePath ?? fileName),
            durationLabel: `${duration.toFixed(2)} s`,
            sampleRateLabel: `${Math.round(sampleRate).toLocaleString('en-US')} Hz`,
            rmsLabel: rms.toFixed(3),
            fftLabel: `${Math.round(fftPeak).toLocaleString('en-US')} Hz`,
            snrLabel: `${snr.toFixed(1)} dB`,
        };
    }

    private static seedFromText(text: string): number {
        let total = 0;
        for (let index = 0; index < text.length; index += 1) {
            total = (total * 31 + text.charCodeAt(index)) >>> 0;
        }

        return total;
    }

    private static seededRange(seed: number, min: number, max: number): number {
        const ratio = (Math.sin(seed) + 1) / 2;
        return min + (max - min) * ratio;
    }
}
