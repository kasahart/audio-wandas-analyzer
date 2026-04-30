import * as path from 'path';
import * as vscode from 'vscode';

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

export class AnalysisPanel {
    public static show(extensionUri: vscode.Uri, audioFileUri: vscode.Uri, result: AnalysisResult): void {
        const audioDirectoryUri = vscode.Uri.file(path.dirname(audioFileUri.fsPath));
        const panel = vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.analysis',
            `Audio Analysis: ${result.fileName}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), audioDirectoryUri],
            },
        );

        panel.webview.html = this.getHtml(panel.webview, audioFileUri, result);
    }

    private static getHtml(webview: vscode.Webview, audioFileUri: vscode.Uri, result: AnalysisResult): string {
        const nonce = Date.now().toString();
        const serializedResult = this.serializeForScript(result);
        const audioSource = webview.asWebviewUri(audioFileUri).toString();
        const channelSections = result.channels.map((channel, index) => this.renderChannelSection(channel, index, result)).join('');

        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Audio Analysis</title>
    <style nonce="${nonce}">
        :root {
            color-scheme: light;
            --app-bg: #edf0f4;
            --panel-bg: #ffffff;
            --panel-line: #cfd6de;
            --text: #20262d;
            --muted: #5f6772;
            --accent: #2b7bbb;
            --accent-soft: rgba(43, 123, 187, 0.12);
            --plot-bg: #ffffff;
            --plot-line: #b3b8bf;
                --spectrogram-height: 520px;
        }

        * { box-sizing: border-box; }

        body {
            margin: 0;
            font-family: 'Segoe UI', sans-serif;
            color: var(--text);
            background: var(--app-bg);
            padding: 24px 24px 120px;
        }

        main {
            max-width: 1480px;
            margin: 0 auto;
        }

        .hero,
        .figure-card {
            background: var(--panel-bg);
            border: 1px solid var(--panel-line);
            border-radius: 18px;
            box-shadow: 0 12px 28px rgba(18, 25, 38, 0.07);
        }

        .hero { padding: 20px 24px; }

        .hero-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(320px, 520px);
            gap: 18px;
            align-items: start;
        }

        .eyebrow {
            display: inline-block;
            padding: 6px 10px;
            border-radius: 999px;
            background: var(--accent-soft);
            color: var(--accent);
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        h1 {
            margin: 14px 0 8px;
            font-size: 30px;
            line-height: 1.15;
        }

        h2,
        h3,
        p,
        td,
        th,
        span {
            margin: 0;
        }

        p,
        td,
        th,
        span {
            color: var(--muted);
        }

        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 12px;
            margin-top: 18px;
        }

        .tile {
            padding: 16px;
            background: #f7f9fb;
            border: 1px solid var(--panel-line);
            border-radius: 14px;
        }

        .tile strong {
            display: block;
            color: var(--text);
            font-size: 22px;
            margin-top: 6px;
        }

        .player-card {
            padding: 18px;
            background: #f8fafc;
            border: 1px solid var(--panel-line);
            border-radius: 16px;
        }

        .player-toolbar {
            display: grid;
            gap: 12px;
        }

        .player-toolbar audio {
            width: 100%;
        }

        .player-actions,
        .player-settings,
        .button-row,
        .channel-stats {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            align-items: center;
        }

        .player-note,
        .gesture-hint {
            font-size: 12px;
            color: var(--muted);
        }

        .time-chip,
        .toggle-chip {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            border-radius: 999px;
            border: 1px solid var(--panel-line);
            background: #ffffff;
            color: var(--text);
            font-size: 13px;
        }

        .toggle-chip input,
        .control input {
            accent-color: var(--accent);
        }

        .grid {
            display: grid;
            gap: 18px;
            margin-top: 18px;
        }

        .figure-card {
            padding: 18px;
        }

        .figure-title-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 16px;
            margin-bottom: 12px;
        }

        .controls {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
        }

        .controls-compact {
            margin-bottom: 10px;
        }

        .control {
            display: grid;
            gap: 6px;
            font-size: 12px;
            color: var(--muted);
        }

        .control-inline {
            grid-template-columns: auto 1fr;
            align-items: center;
        }

        .control input {
            width: 100%;
        }

        .select-control {
            width: 100%;
            min-width: 110px;
            border: 1px solid var(--panel-line);
            border-radius: 10px;
            padding: 8px 10px;
            background: #ffffff;
            color: var(--text);
        }

        .action-button {
            appearance: none;
            border: 1px solid rgba(43, 123, 187, 0.24);
            background: rgba(43, 123, 187, 0.12);
            color: var(--accent);
            border-radius: 999px;
            padding: 9px 14px;
            cursor: pointer;
            font-size: 12px;
        }

        .action-button-secondary {
            border-color: rgba(148, 163, 184, 0.32);
            background: rgba(148, 163, 184, 0.08);
            color: var(--text);
        }

        .plot-sheet {
            background: #fafbfd;
            border: 1px solid var(--panel-line);
            border-radius: 14px;
            padding: 18px;
        }

        .plot-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 180px 32px;
            grid-template-areas:
                'waveform waveform-spacer waveform-colorbar-spacer'
                'spectrogram profile colorbar';
            gap: 14px 18px;
            align-items: start;
        }

        .plot-panel {
            display: flex;
            gap: 12px;
        }

        .waveform-panel { grid-area: waveform; }
        .waveform-spacer { grid-area: waveform-spacer; }
        .waveform-colorbar-spacer { grid-area: waveform-colorbar-spacer; }
        .spectrogram-panel { grid-area: spectrogram; }
        .profile-panel { grid-area: profile; }
        .colorbar-panel { grid-area: colorbar; }

        .waveform-spacer,
        .waveform-colorbar-spacer {
            min-height: 1px;
        }

        .plot-stack,
        .profile-stack {
            min-width: 0;
            flex: 1;
            display: flex;
            flex-direction: column;
        }

        .plot-frame {
            display: flex;
            align-items: stretch;
            gap: 0;
            min-width: 0;
            position: relative;
        }

        .plot-stack-spectrogram {
            display: flex;
            flex-direction: column;
        }

        .plot-canvas,
        .profile-canvas,
        .colorbar-canvas {
            display: block;
            width: 100%;
            background: var(--plot-bg);
            border: 1px solid var(--plot-line);
            cursor: crosshair;
            touch-action: none;
        }

        .waveform-canvas { aspect-ratio: 1220 / 210; }
        .spectrogram-canvas { aspect-ratio: 1220 / 520; }
        .profile-canvas { aspect-ratio: 180 / 520; }
        .colorbar-canvas { aspect-ratio: 32 / 520; }
        .spectrogram-canvas,
        .profile-canvas,
        .colorbar-canvas {
            height: var(--spectrogram-height);
        }

        .axis-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin-top: 8px;
            font-size: 12px;
        }

        .axis-column {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            flex: 0 0 58px;
            min-width: 58px;
            padding: 2px 0;
            font-size: 12px;
            text-align: right;
        }

        .spectrogram-panel .axis-column {
            position: absolute;
            top: 0;
            left: 0;
            height: var(--spectrogram-height);
            transform: translateX(calc(-100% - 10px));
            pointer-events: none;
        }

        .axis-row span,
        .axis-column span,
        .axis-caption,
        .colorbar-labels span {
            color: var(--text);
        }

        .axis-caption {
            font-size: 12px;
            writing-mode: vertical-rl;
            transform: rotate(180deg);
            align-self: center;
            min-width: 20px;
        }

        .axis-caption-x {
            writing-mode: horizontal-tb;
            transform: none;
            min-width: auto;
            margin-top: 6px;
            text-align: center;
        }

        .colorbar-panel {
            align-items: stretch;
            position: relative;
            width: 32px;
        }

        .colorbar-labels {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            height: var(--spectrogram-height);
            padding: 2px 0;
            font-size: 12px;
            position: absolute;
            top: 0;
            left: calc(100% + 8px);
            width: 56px;
            pointer-events: none;
        }

        .readout-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 10px;
            margin-top: 12px;
        }

        .readout {
            min-height: 22px;
            color: var(--text);
            font-size: 12px;
            letter-spacing: 0.02em;
            padding: 10px 12px;
            border-radius: 10px;
            background: #f7f9fb;
            border: 1px solid var(--panel-line);
        }

        .peaks-block {
            margin-top: 14px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th,
        td {
            text-align: left;
            padding: 10px 0;
            border-bottom: 1px solid var(--panel-line);
        }

        th {
            color: var(--text);
            font-weight: 600;
        }

        @media (max-width: 1100px) {
            :root {
                --spectrogram-height: 360px;
            }

            .hero-grid {
                grid-template-columns: 1fr;
            }

            .plot-grid {
                grid-template-columns: 1fr;
                grid-template-areas:
                    'waveform'
                    'waveform-spacer'
                    'waveform-colorbar-spacer'
                    'spectrogram'
                    'profile'
                    'colorbar';
            }

            .waveform-spacer,
            .waveform-colorbar-spacer {
                display: none;
            }

            .colorbar-panel {
                flex-direction: row;
                width: auto;
            }

            .colorbar-labels {
                position: static;
                margin-left: 10px;
                flex-direction: row;
                height: auto;
                width: auto;
                gap: 12px;
                align-items: center;
            }
        }

        @media (max-width: 640px) {
            :root {
                --spectrogram-height: 280px;
            }

            body {
                padding: 14px;
            }

            h1 {
                font-size: 24px;
            }

            .player-actions,
            .player-settings {
                flex-direction: column;
                align-items: stretch;
            }
        }
    </style>
</head>
<body>
    <main>
        <section class="hero">
            <div class="hero-grid">
                <div>
                    <span class="eyebrow">Audio Plot</span>
                    <h1>${this.escapeHtml(result.fileName)}</h1>
                    <p>${this.escapeHtml(result.filePath)}</p>
                    <div class="summary">
                        <div class="tile">
                            <span>Sample rate</span>
                            <strong>${result.sampleRateHz} Hz</strong>
                        </div>
                        <div class="tile">
                            <span>Duration</span>
                            <strong>${result.durationSeconds.toFixed(3)} s</strong>
                        </div>
                        <div class="tile">
                            <span>Channels</span>
                            <strong>${result.channelCount}</strong>
                        </div>
                        <div class="tile">
                            <span>Samples</span>
                            <strong>${result.sampleCount}</strong>
                        </div>
                    </div>
                </div>
                <aside class="player-card">
                    <div class="player-toolbar">
                        <div>
                            <h2>Playback</h2>
                            <p class="player-note">The vertical cursor follows playback. Clicking a plot seeks the player.</p>
                        </div>
                        <audio id="audio-player" controls preload="metadata" src="${audioSource}"></audio>
                        <div class="player-actions">
                            <button id="skip-backward" type="button" class="action-button action-button-secondary">-5 s</button>
                            <button id="play-toggle" type="button" class="action-button">Play / Pause</button>
                            <button id="skip-forward" type="button" class="action-button action-button-secondary">+5 s</button>
                            <span id="player-time" class="time-chip">0.00 s / ${result.durationSeconds.toFixed(2)} s</span>
                        </div>
                        <div class="player-settings">
                            <label class="toggle-chip">
                                <input id="auto-follow-toggle" type="checkbox" checked>
                                <span>Auto Follow</span>
                            </label>
                            <label class="control control-inline">
                                <span>Speed</span>
                                <select id="playback-rate" class="select-control">
                                    <option value="0.5">0.50x</option>
                                    <option value="0.75">0.75x</option>
                                    <option value="1" selected>1.00x</option>
                                    <option value="1.25">1.25x</option>
                                    <option value="1.5">1.50x</option>
                                    <option value="2">2.00x</option>
                                </select>
                            </label>
                        </div>
                    </div>
                </aside>
            </div>
        </section>
        <section class="grid">
            ${channelSections}
        </section>
    </main>
    <script nonce="${nonce}">
        const analysis = ${serializedResult};
        const audio = document.getElementById('audio-player');
        const playerTime = document.getElementById('player-time');
        const autoFollowToggle = document.getElementById('auto-follow-toggle');
        const playbackRateSelect = document.getElementById('playback-rate');
        const channelStates = analysis.channels.map(() => ({
            zoom: 1,
            offset: 0,
            spectrogramFloor: 0,
            frequencyRange: 1,
            frequencyScale: 'linear',
        }));
        const interactionState = {
            cursorTime: null,
            cursorLocked: false,
            syncFromAudio: false,
        };
        const playbackSyncState = {
            animationFrameId: null,
        };

        function clamp(value, min, max) {
            return Math.min(max, Math.max(min, value));
        }

        function formatSeconds(value) {
            return value.toFixed(2) + ' s';
        }

        function formatFrequency(value) {
            return Math.round(value) + ' Hz';
        }

        function colorForIntensity(value) {
            const clamped = Math.max(0, Math.min(1, value));
            if (clamped < 0.2) {
                return [8 + Math.round(clamped * 20), 0, 30 + Math.round(clamped * 50)];
            }
            if (clamped < 0.45) {
                const ratio = (clamped - 0.2) / 0.25;
                return [72 + Math.round(ratio * 60), 0, 108 + Math.round(ratio * 60)];
            }
            if (clamped < 0.7) {
                const ratio = (clamped - 0.45) / 0.25;
                return [156 + Math.round(ratio * 68), 40 + Math.round(ratio * 20), 126 - Math.round(ratio * 40)];
            }

            const ratio = (clamped - 0.7) / 0.3;
            return [255, 91 + Math.round(ratio * 164), 78 + Math.round(ratio * 160)];
        }

        function mapSpectrogramValue(value, floor) {
            const normalized = (value - floor) / Math.max(0.00001, 1 - floor);
            return clamp(normalized, 0, 1);
        }

        function updatePlayerTime() {
            const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
            playerTime.textContent = formatSeconds(currentTime) + ' / ' + formatSeconds(analysis.durationSeconds);
        }

        function getSpectrogramFrameDuration(spectrogram) {
            return spectrogram.hopSize / analysis.sampleRateHz;
        }

        function getSpectrogramStartTime(spectrogram) {
            return (spectrogram.windowSize / 2) / analysis.sampleRateHz;
        }

        function getSpectrogramEndTime(spectrogram) {
            if (spectrogram.timeBins <= 0) {
                return analysis.durationSeconds;
            }
            return Math.min(
                analysis.durationSeconds,
                getSpectrogramStartTime(spectrogram) + getSpectrogramFrameDuration(spectrogram) * Math.max(0, spectrogram.timeBins - 1),
            );
        }

        function getVisibleWindow(totalCount, zoom, offset) {
            const safeZoom = Math.max(1, zoom || 1);
            const visibleCount = Math.max(8, Math.min(totalCount, Math.round(totalCount / safeZoom)));
            const maxStart = Math.max(0, totalCount - visibleCount);
            const start = Math.round(clamp(offset, 0, 1) * maxStart);
            return { start, end: start + visibleCount, visibleCount };
        }

        function getOffsetFromStart(totalCount, visibleCount, start) {
            const maxStart = Math.max(0, totalCount - visibleCount);
            if (maxStart === 0) {
                return 0;
            }
            return clamp(start / maxStart, 0, 1);
        }

        function updateAxisLabels(container, startValue, endValue, formatter) {
            if (!container) {
                return;
            }
            const labels = container.querySelectorAll('span');
            if (labels.length < 3) {
                return;
            }
            const middleValue = startValue + (endValue - startValue) / 2;
            labels[0].textContent = formatter(startValue);
            labels[1].textContent = formatter(middleValue);
            labels[2].textContent = formatter(endValue);
        }

        function updateVerticalAxisLabels(container, startValue, endValue, formatter) {
            if (!container) {
                return;
            }
            const labels = container.querySelectorAll('span');
            if (labels.length < 3) {
                return;
            }
            const middleValue = startValue + (endValue - startValue) / 2;
            labels[0].textContent = formatter(endValue);
            labels[1].textContent = formatter(middleValue);
            labels[2].textContent = formatter(startValue);
        }

        function drawCursorLine(context, width, height, startSeconds, endSeconds) {
            if (interactionState.cursorTime === null) {
                return;
            }
            if (interactionState.cursorTime < startSeconds || interactionState.cursorTime > endSeconds) {
                return;
            }
            const x = ((interactionState.cursorTime - startSeconds) / Math.max(0.00001, endSeconds - startSeconds)) * width;
            context.save();
            context.strokeStyle = interactionState.cursorLocked ? '#f28c28' : 'rgba(242, 140, 40, 0.85)';
            context.lineWidth = interactionState.cursorLocked ? 2 : 1.25;
            context.setLineDash(interactionState.cursorLocked ? [] : [6, 4]);
            context.beginPath();
            context.moveTo(x, 0);
            context.lineTo(x, height);
            context.stroke();
            context.restore();
        }

        function drawGrid(context, width, height, verticalCount, horizontalCount) {
            context.strokeStyle = '#b3b8bf';
            context.lineWidth = 1;
            for (let index = 0; index <= horizontalCount; index += 1) {
                const y = (height / horizontalCount) * index;
                context.beginPath();
                context.moveTo(0, y);
                context.lineTo(width, y);
                context.stroke();
            }
            for (let index = 0; index <= verticalCount; index += 1) {
                const x = (width / verticalCount) * index;
                context.beginPath();
                context.moveTo(x, 0);
                context.lineTo(x, height);
                context.stroke();
            }
        }

        function getDisplayedFrequencyBinCount(spectrogram, state) {
            const fullCount = spectrogram.values[0].length;
            return Math.max(8, Math.min(fullCount, Math.round(fullCount * state.frequencyRange)));
        }

        function getMaxSourceFrequencyIndex(spectrogram, state) {
            const sourceBins = spectrogram.values[0].length;
            return Math.max(1, Math.min(sourceBins - 1, Math.round((sourceBins - 1) * state.frequencyRange)));
        }

        function getSourceFrequencyIndex(state, displayedIndex, displayedBins, sourceBins) {
            const maxSourceIndex = Math.max(1, Math.min(sourceBins - 1, Math.round((sourceBins - 1) * state.frequencyRange)));
            const denominator = Math.max(1, displayedBins - 1);
            const ratio = displayedIndex / denominator;
            if (state.frequencyScale === 'log') {
                const minSourceIndex = 1;
                const logMin = Math.log10(minSourceIndex);
                const logMax = Math.log10(maxSourceIndex);
                return Math.min(maxSourceIndex, Math.max(minSourceIndex, Math.round(Math.pow(10, logMin + ratio * (logMax - logMin)))));
            }
            return Math.min(maxSourceIndex, Math.max(0, Math.round(ratio * maxSourceIndex)));
        }

        function getDisplayedMaxFrequency(spectrogram, state) {
            const maxSourceIndex = getMaxSourceFrequencyIndex(spectrogram, state);
            return (maxSourceIndex / Math.max(1, spectrogram.values[0].length - 1)) * spectrogram.maxFrequencyHz;
        }

        function getTimeForSpectrogramFrame(spectrogram, frameIndex) {
            return getSpectrogramStartTime(spectrogram) + frameIndex * getSpectrogramFrameDuration(spectrogram);
        }

        function getFrameIndexForTime(spectrogram, timeSeconds) {
            const frameDuration = getSpectrogramFrameDuration(spectrogram);
            const frameIndex = Math.round((timeSeconds - getSpectrogramStartTime(spectrogram)) / Math.max(frameDuration, Number.EPSILON));
            return clamp(frameIndex, 0, spectrogram.timeBins - 1);
        }

        function alignOffsetToTime(index, timeSeconds, totalCount) {
            const state = channelStates[index];
            const windowInfo = getVisibleWindow(totalCount, state.zoom, state.offset);
            const startSeconds = (windowInfo.start / totalCount) * analysis.durationSeconds;
            const endSeconds = (windowInfo.end / totalCount) * analysis.durationSeconds;
            if (startSeconds <= timeSeconds && timeSeconds <= endSeconds) {
                return;
            }
            const anchorIndex = (timeSeconds / analysis.durationSeconds) * totalCount;
            const nextStart = clamp(
                Math.round(anchorIndex - windowInfo.visibleCount / 2),
                0,
                Math.max(0, totalCount - windowInfo.visibleCount),
            );
            state.offset = getOffsetFromStart(totalCount, windowInfo.visibleCount, nextStart);
        }

        function followPlaybackWindow(timeSeconds) {
            if (!autoFollowToggle.checked) {
                return;
            }
            analysis.channels.forEach((channel, index) => {
                alignOffsetToTime(index, timeSeconds, channel.waveform.min.length);
                syncControls(index);
            });
        }

        function updateColorbarLabels(index, spectrogram, floor) {
            const labels = document.getElementById('colorbar-labels-' + index).querySelectorAll('span');
            const floorDb = spectrogram.minDb + (spectrogram.maxDb - spectrogram.minDb) * floor;
            labels[0].textContent = spectrogram.maxDb.toFixed(0) + ' dB';
            labels[1].textContent = ((spectrogram.maxDb + floorDb) / 2).toFixed(0) + ' dB';
            labels[2].textContent = floorDb.toFixed(0) + ' dB';
        }

        function drawWaveform(canvas, waveform, state, durationSeconds) {
            if (!canvas || waveform.min.length === 0 || waveform.max.length === 0) {
                return;
            }
            const context = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const middle = height / 2;
            const amplitude = waveform.absolutePeak || 1;
            const totalCount = Math.min(waveform.min.length, waveform.max.length);
            const windowInfo = getVisibleWindow(totalCount, state.zoom, state.offset);

            context.clearRect(0, 0, width, height);
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            drawGrid(context, width, height, 5, 4);

            context.fillStyle = '#2d7dbc';
            for (let index = windowInfo.start; index < windowInfo.end; index += 1) {
                const x = Math.round(((index - windowInfo.start) / Math.max(1, windowInfo.visibleCount - 1)) * (width - 1));
                const minValue = waveform.min[index];
                const maxValue = waveform.max[index];
                const yTop = middle - (maxValue / amplitude) * (height * 0.46);
                const yBottom = middle - (minValue / amplitude) * (height * 0.46);
                const rectTop = Math.max(0, Math.min(yTop, yBottom));
                const rectHeight = Math.max(1, Math.abs(yBottom - yTop));
                context.fillRect(x, rectTop, 1, rectHeight);
            }

            const startSeconds = (windowInfo.start / totalCount) * durationSeconds;
            const endSeconds = (windowInfo.end / totalCount) * durationSeconds;
            updateAxisLabels(document.getElementById('waveform-axis-' + canvas.dataset.channelIndex), startSeconds, endSeconds, formatSeconds);
            drawCursorLine(context, width, height, startSeconds, endSeconds);
            canvas._windowInfo = windowInfo;
        }

        function drawSpectrogram(canvas, spectrogram, state, durationSeconds) {
            if (!canvas || spectrogram.values.length === 0 || spectrogram.values[0].length === 0) {
                return;
            }
            const context = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const totalTimeBins = spectrogram.values.length;
            const sourceFrequencyBins = spectrogram.values[0].length;
            const frequencyBins = getDisplayedFrequencyBinCount(spectrogram, state);
            const windowInfo = getVisibleWindow(totalTimeBins, state.zoom, state.offset);
            const timeBins = windowInfo.visibleCount;
            const image = context.createImageData(timeBins, frequencyBins);

            for (let timeIndex = 0; timeIndex < timeBins; timeIndex += 1) {
                for (let frequencyIndex = 0; frequencyIndex < frequencyBins; frequencyIndex += 1) {
                    const sourceTimeIndex = windowInfo.start + timeIndex;
                    const sourceFrequencyIndex = getSourceFrequencyIndex(state, frequencyIndex, frequencyBins, sourceFrequencyBins);
                    const mapped = mapSpectrogramValue(spectrogram.values[sourceTimeIndex][sourceFrequencyIndex], state.spectrogramFloor);
                    const color = colorForIntensity(mapped);
                    const imageY = frequencyBins - 1 - frequencyIndex;
                    const offset = (imageY * timeBins + timeIndex) * 4;
                    image.data[offset] = color[0];
                    image.data[offset + 1] = color[1];
                    image.data[offset + 2] = color[2];
                    image.data[offset + 3] = 255;
                }
            }

            const buffer = document.createElement('canvas');
            buffer.width = timeBins;
            buffer.height = frequencyBins;
            buffer.getContext('2d').putImageData(image, 0, 0);

            context.clearRect(0, 0, width, height);
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            context.drawImage(buffer, 0, 0, width, height);
            drawGrid(context, width, height, 5, 4);

            const startSeconds = getTimeForSpectrogramFrame(spectrogram, windowInfo.start);
            const endSeconds = getTimeForSpectrogramFrame(spectrogram, Math.max(windowInfo.start, windowInfo.end - 1));
            updateAxisLabels(document.getElementById('spectrogram-time-axis-' + canvas.dataset.channelIndex), startSeconds, endSeconds, formatSeconds);
            updateVerticalAxisLabels(
                document.getElementById('spectrogram-frequency-axis-' + canvas.dataset.channelIndex),
                0,
                getDisplayedMaxFrequency(spectrogram, state),
                formatFrequency,
            );
            drawCursorLine(context, width, height, startSeconds, endSeconds);
            canvas._windowInfo = windowInfo;
        }

        function drawProfile(canvas, spectrogram, state) {
            if (!canvas || spectrogram.values.length === 0 || spectrogram.values[0].length === 0) {
                return;
            }
            const context = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const sourceFrequencyBins = spectrogram.values[0].length;
            const frequencyBins = getDisplayedFrequencyBinCount(spectrogram, state);
            const profile = new Array(frequencyBins).fill(0);
            const targetFrameIndex = interactionState.cursorTime === null
                ? null
                : getFrameIndexForTime(spectrogram, interactionState.cursorTime);

            for (let frequencyIndex = 0; frequencyIndex < frequencyBins; frequencyIndex += 1) {
                const sourceFrequencyIndex = getSourceFrequencyIndex(state, frequencyIndex, frequencyBins, sourceFrequencyBins);
                if (targetFrameIndex === null) {
                    for (let timeIndex = 0; timeIndex < spectrogram.values.length; timeIndex += 1) {
                        profile[frequencyIndex] += mapSpectrogramValue(spectrogram.values[timeIndex][sourceFrequencyIndex], state.spectrogramFloor);
                    }
                    profile[frequencyIndex] /= Math.max(1, spectrogram.values.length);
                } else {
                    profile[frequencyIndex] = mapSpectrogramValue(spectrogram.values[targetFrameIndex][sourceFrequencyIndex], state.spectrogramFloor);
                }
            }

            context.clearRect(0, 0, width, height);
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            drawGrid(context, width, height, 4, 4);

            context.strokeStyle = '#2d7dbc';
            context.lineWidth = 2;
            context.beginPath();
            for (let frequencyIndex = 0; frequencyIndex < frequencyBins; frequencyIndex += 1) {
                const value = profile[frequencyIndex];
                const x = value * (width - 6) + 3;
                const y = height - (frequencyIndex / Math.max(1, frequencyBins - 1)) * height;
                if (frequencyIndex === 0) {
                    context.moveTo(x, y);
                } else {
                    context.lineTo(x, y);
                }
            }
            context.stroke();

            updateAxisLabels(document.getElementById('profile-axis-' + canvas.dataset.channelIndex), 0, 1, (value) => value.toFixed(1));
        }

        function drawColorbar(canvas) {
            if (!canvas) {
                return;
            }
            const context = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            const gradient = context.createLinearGradient(0, height, 0, 0);
            for (let step = 0; step <= 100; step += 1) {
                const value = step / 100;
                const color = colorForIntensity(value);
                gradient.addColorStop(value, 'rgb(' + color[0] + ', ' + color[1] + ', ' + color[2] + ')');
            }
            context.clearRect(0, 0, width, height);
            context.fillStyle = gradient;
            context.fillRect(0, 0, width, height);
            context.strokeStyle = '#b3b8bf';
            context.strokeRect(0.5, 0.5, width - 1, height - 1);
        }

        function syncControls(index) {
            const state = channelStates[index];
            document.getElementById('zoom-' + index).value = String(state.zoom);
            document.getElementById('offset-' + index).value = String(state.offset);
            document.getElementById('spectrogram-floor-' + index).value = String(state.spectrogramFloor);
            document.getElementById('frequency-range-' + index).value = String(state.frequencyRange);
            document.getElementById('frequency-scale-' + index).value = state.frequencyScale;
        }

        function renderChannel(index) {
            const channel = analysis.channels[index];
            const state = channelStates[index];
            const waveformCanvas = document.getElementById('waveform-' + index);
            const spectrogramCanvas = document.getElementById('spectrogram-' + index);
            const profileCanvas = document.getElementById('profile-' + index);
            const colorbarCanvas = document.getElementById('colorbar-' + index);
            waveformCanvas.dataset.channelIndex = String(index);
            spectrogramCanvas.dataset.channelIndex = String(index);
            profileCanvas.dataset.channelIndex = String(index);
            drawWaveform(waveformCanvas, channel.waveform, state, analysis.durationSeconds);
            drawSpectrogram(spectrogramCanvas, channel.spectrogram, state, analysis.durationSeconds);
            drawProfile(profileCanvas, channel.spectrogram, state);
            drawColorbar(colorbarCanvas);
            updateColorbarLabels(index, channel.spectrogram, state.spectrogramFloor);
        }

        function renderAllChannels() {
            analysis.channels.forEach((_, index) => {
                renderChannel(index);
            });
        }

        function setCursorTime(timeSeconds, options = {}) {
            interactionState.cursorTime = clamp(timeSeconds, 0, analysis.durationSeconds);
            if (Object.prototype.hasOwnProperty.call(options, 'locked')) {
                interactionState.cursorLocked = Boolean(options.locked);
            }
            if (options.seekAudio) {
                audio.currentTime = interactionState.cursorTime;
                updatePlayerTime();
            }
            renderAllChannels();
        }

        function clearCursor() {
            interactionState.cursorTime = null;
            interactionState.cursorLocked = false;
            renderAllChannels();
        }

        function cancelPlaybackSync() {
            if (playbackSyncState.animationFrameId !== null) {
                cancelAnimationFrame(playbackSyncState.animationFrameId);
                playbackSyncState.animationFrameId = null;
            }
        }

        function syncPlaybackCursor() {
            interactionState.syncFromAudio = true;
            updatePlayerTime();
            followPlaybackWindow(audio.currentTime);
            setCursorTime(audio.currentTime, { locked: !audio.paused });
            interactionState.syncFromAudio = false;
        }

        function startPlaybackSync() {
            if (playbackSyncState.animationFrameId !== null) {
                return;
            }

            const tick = () => {
                playbackSyncState.animationFrameId = null;
                if (audio.paused || audio.ended) {
                    syncPlaybackCursor();
                    return;
                }
                syncPlaybackCursor();
                playbackSyncState.animationFrameId = requestAnimationFrame(tick);
            };

            playbackSyncState.animationFrameId = requestAnimationFrame(tick);
        }

        function getTimeFromCanvasX(canvas, totalCount, clientX) {
            const rect = canvas.getBoundingClientRect();
            const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
            const windowInfo = canvas._windowInfo || getVisibleWindow(totalCount, 1, 0);
            const absoluteIndex = windowInfo.start + ratio * Math.max(1, windowInfo.visibleCount - 1);
            return (absoluteIndex / totalCount) * analysis.durationSeconds;
        }

        function zoomAtPosition(index, totalCount, pointerRatio, nextZoom) {
            const state = channelStates[index];
            const previousWindow = getVisibleWindow(totalCount, state.zoom, state.offset);
            const anchorIndex = previousWindow.start + pointerRatio * Math.max(1, previousWindow.visibleCount - 1);
            const safeZoom = clamp(nextZoom, 1, 12);
            const nextWindow = getVisibleWindow(totalCount, safeZoom, state.offset);
            const nextVisibleCount = nextWindow.visibleCount;
            const nextStart = clamp(
                Math.round(anchorIndex - pointerRatio * Math.max(1, nextVisibleCount - 1)),
                0,
                Math.max(0, totalCount - nextVisibleCount),
            );
            state.zoom = safeZoom;
            state.offset = getOffsetFromStart(totalCount, nextVisibleCount, nextStart);
            syncControls(index);
            renderChannel(index);
        }

        function panChannel(index, totalCount, deltaRatio) {
            const state = channelStates[index];
            const windowInfo = getVisibleWindow(totalCount, state.zoom, state.offset);
            const nextStart = clamp(
                Math.round(windowInfo.start - deltaRatio * Math.max(1, windowInfo.visibleCount - 1)),
                0,
                Math.max(0, totalCount - windowInfo.visibleCount),
            );
            state.offset = getOffsetFromStart(totalCount, windowInfo.visibleCount, nextStart);
            syncControls(index);
            renderChannel(index);
        }

        function getWheelDeltaPixels(event, fallbackSize) {
            if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
                return event.deltaY * 16;
            }
            if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
                return event.deltaY * fallbackSize;
            }
            return event.deltaY;
        }

        function installWaveformHover(index) {
            const canvas = document.getElementById('waveform-' + index);
            const readout = document.getElementById('waveform-readout-' + index);
            const channel = analysis.channels[index];
            canvas.addEventListener('mousemove', (event) => {
                const rect = canvas.getBoundingClientRect();
                const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                const windowInfo = canvas._windowInfo || getVisibleWindow(channel.waveform.min.length, 1, 0);
                const sampleIndex = Math.min(channel.waveform.min.length - 1, windowInfo.start + Math.round(ratio * Math.max(0, windowInfo.visibleCount - 1)));
                const timeSeconds = (sampleIndex / channel.waveform.min.length) * analysis.durationSeconds;
                const minValue = channel.waveform.min[sampleIndex];
                const maxValue = channel.waveform.max[sampleIndex];
                readout.textContent = 't=' + timeSeconds.toFixed(3) + ' s, min=' + minValue.toFixed(3) + ', max=' + maxValue.toFixed(3);
                if (!interactionState.cursorLocked && !interactionState.syncFromAudio) {
                    setCursorTime(timeSeconds, { locked: false });
                }
            });
            canvas.addEventListener('mouseleave', () => {
                readout.textContent = interactionState.cursorLocked
                    ? 'Cursor pinned. Click another position to move it, or Clear Cursor to release.'
                    : 'Hover waveform to inspect time and amplitude.';
                if (!interactionState.cursorLocked && !interactionState.syncFromAudio) {
                    clearCursor();
                }
            });
            canvas.addEventListener('click', (event) => {
                const timeSeconds = getTimeFromCanvasX(canvas, channel.waveform.min.length, event.clientX);
                setCursorTime(timeSeconds, { locked: true, seekAudio: true });
                readout.textContent = 'Pinned cursor at t=' + timeSeconds.toFixed(3) + ' s';
            });
        }

        function installSpectrogramHover(index) {
            const canvas = document.getElementById('spectrogram-' + index);
            const readout = document.getElementById('spectrogram-readout-' + index);
            const channel = analysis.channels[index];
            canvas.addEventListener('mousemove', (event) => {
                const rect = canvas.getBoundingClientRect();
                const xRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                const yRatio = clamp((event.clientY - rect.top) / rect.height, 0, 1);
                const windowInfo = canvas._windowInfo || getVisibleWindow(channel.spectrogram.values.length, 1, 0);
                const timeIndex = Math.min(channel.spectrogram.values.length - 1, windowInfo.start + Math.round(xRatio * Math.max(0, windowInfo.visibleCount - 1)));
                const displayedFrequencyBins = getDisplayedFrequencyBinCount(channel.spectrogram, channelStates[index]);
                const frequencyIndex = Math.min(displayedFrequencyBins - 1, Math.max(0, Math.round((1 - yRatio) * (displayedFrequencyBins - 1))));
                const frequencyHz = (frequencyIndex / Math.max(1, displayedFrequencyBins - 1)) * getDisplayedMaxFrequency(channel.spectrogram, channelStates[index]);
                const sourceFrequencyIndex = getSourceFrequencyIndex(channelStates[index], frequencyIndex, displayedFrequencyBins, channel.spectrogram.values[0].length);
                const intensity = mapSpectrogramValue(channel.spectrogram.values[timeIndex][sourceFrequencyIndex], channelStates[index].spectrogramFloor);
                const timeSeconds = getTimeForSpectrogramFrame(channel.spectrogram, timeIndex);
                readout.textContent = 't=' + timeSeconds.toFixed(3) + ' s, f=' + Math.round(frequencyHz) + ' Hz, level=' + intensity.toFixed(3);
                if (!interactionState.cursorLocked && !interactionState.syncFromAudio) {
                    setCursorTime(timeSeconds, { locked: false });
                }
            });
            canvas.addEventListener('mouseleave', () => {
                readout.textContent = interactionState.cursorLocked
                    ? 'Cursor pinned. Click another position to move it, or Clear Cursor to release.'
                    : 'Hover spectrogram to inspect time, frequency, and intensity.';
                if (!interactionState.cursorLocked && !interactionState.syncFromAudio) {
                    clearCursor();
                }
            });
            canvas.addEventListener('click', (event) => {
                const timeSeconds = getTimeFromCanvasX(canvas, channel.spectrogram.values.length, event.clientX);
                setCursorTime(timeSeconds, { locked: true, seekAudio: true });
                readout.textContent = 'Pinned cursor at t=' + timeSeconds.toFixed(3) + ' s';
            });
        }

        function installControls(index) {
            const state = channelStates[index];
            const zoomInput = document.getElementById('zoom-' + index);
            const offsetInput = document.getElementById('offset-' + index);
            const floorInput = document.getElementById('spectrogram-floor-' + index);
            const rangeInput = document.getElementById('frequency-range-' + index);
            const scaleSelect = document.getElementById('frequency-scale-' + index);
            const resetButton = document.getElementById('reset-' + index);
            const clearCursorButton = document.getElementById('clear-cursor-' + index);

            zoomInput.addEventListener('input', () => {
                state.zoom = Number(zoomInput.value);
                renderChannel(index);
            });
            offsetInput.addEventListener('input', () => {
                state.offset = Number(offsetInput.value);
                renderChannel(index);
            });
            floorInput.addEventListener('input', () => {
                state.spectrogramFloor = Number(floorInput.value);
                renderChannel(index);
            });
            rangeInput.addEventListener('input', () => {
                state.frequencyRange = Number(rangeInput.value);
                renderChannel(index);
            });
            scaleSelect.addEventListener('change', () => {
                state.frequencyScale = scaleSelect.value;
                renderChannel(index);
            });
            resetButton.addEventListener('click', () => {
                state.zoom = 1;
                state.offset = 0;
                state.spectrogramFloor = 0;
                state.frequencyRange = 1;
                state.frequencyScale = 'linear';
                syncControls(index);
                renderChannel(index);
            });
            clearCursorButton.addEventListener('click', () => {
                clearCursor();
            });
            syncControls(index);
        }

        function installCanvasGestures(index, canvasId, totalCount) {
            const canvas = document.getElementById(canvasId + '-' + index);
            let dragState = null;
            canvas.addEventListener('wheel', (event) => {
                const rect = canvas.getBoundingClientRect();
                if (event.ctrlKey) {
                    event.preventDefault();
                    const pointerRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                    const direction = event.deltaY > 0 ? -0.5 : 0.5;
                    zoomAtPosition(index, totalCount, pointerRatio, channelStates[index].zoom + direction);
                    return;
                }
                if (event.shiftKey) {
                    event.preventDefault();
                    const deltaPixels = getWheelDeltaPixels(event, rect.width);
                    panChannel(index, totalCount, -deltaPixels / Math.max(rect.width, 1));
                }
            }, { passive: false });
            canvas.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) {
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                dragState = { startX: event.clientX, width: rect.width };
                canvas.setPointerCapture(event.pointerId);
                canvas.style.cursor = 'grabbing';
            });
            canvas.addEventListener('pointermove', (event) => {
                if (!dragState) {
                    return;
                }
                const deltaRatio = (event.clientX - dragState.startX) / dragState.width;
                dragState.startX = event.clientX;
                panChannel(index, totalCount, deltaRatio);
            });
            function endDrag(event) {
                if (!dragState) {
                    return;
                }
                dragState = null;
                canvas.style.cursor = 'crosshair';
                if (event) {
                    canvas.releasePointerCapture(event.pointerId);
                }
            }
            canvas.addEventListener('pointerup', endDrag);
            canvas.addEventListener('pointercancel', endDrag);
        }

        document.getElementById('play-toggle').addEventListener('click', () => {
            if (audio.paused) {
                void audio.play();
            } else {
                audio.pause();
            }
        });

        document.getElementById('skip-backward').addEventListener('click', () => {
            audio.currentTime = clamp(audio.currentTime - 5, 0, analysis.durationSeconds);
            updatePlayerTime();
            followPlaybackWindow(audio.currentTime);
            renderAllChannels();
        });

        document.getElementById('skip-forward').addEventListener('click', () => {
            audio.currentTime = clamp(audio.currentTime + 5, 0, analysis.durationSeconds);
            updatePlayerTime();
            followPlaybackWindow(audio.currentTime);
            renderAllChannels();
        });

        playbackRateSelect.addEventListener('change', () => {
            audio.playbackRate = Number(playbackRateSelect.value);
        });

        audio.addEventListener('timeupdate', () => {
            syncPlaybackCursor();
        });

        audio.addEventListener('play', () => {
            startPlaybackSync();
        });

        audio.addEventListener('pause', () => {
            cancelPlaybackSync();
            syncPlaybackCursor();
        });

        audio.addEventListener('seeked', () => {
            syncPlaybackCursor();
            updatePlayerTime();
            followPlaybackWindow(audio.currentTime);
            setCursorTime(audio.currentTime, { locked: true });
        });

        audio.addEventListener('ended', () => {
            cancelPlaybackSync();
            interactionState.cursorLocked = true;
            updatePlayerTime();
            renderAllChannels();
        });

        audio.addEventListener('loadedmetadata', () => {
            audio.playbackRate = Number(playbackRateSelect.value);
            updatePlayerTime();
            renderAllChannels();
        });

        analysis.channels.forEach((channel, index) => {
            renderChannel(index);
            installControls(index);
            installWaveformHover(index);
            installSpectrogramHover(index);
            installCanvasGestures(index, 'waveform', channel.waveform.min.length);
            installCanvasGestures(index, 'spectrogram', channel.spectrogram.values.length);
        });

        updatePlayerTime();
    </script>
</body>
</html>`;
    }

    private static renderChannelSection(channel: ChannelSummary, index: number, result: AnalysisResult): string {
        const peaks = channel.dominantFrequencies
            .map(
                (peak) => `
                    <tr>
                        <td>${peak.frequencyHz.toFixed(1)} Hz</td>
                        <td>${peak.magnitude.toFixed(4)}</td>
                    </tr>`,
            )
            .join('');

        return `
            <section class="figure-card">
                <div class="figure-title-row">
                    <h2>Channel ${index + 1}</h2>
                    <div class="channel-stats">
                        <span>${this.escapeHtml(channel.label)}</span>
                        <span>RMS ${channel.rms.toFixed(3)}</span>
                        <span>Peak ${channel.peakAbsolute.toFixed(3)}</span>
                        <span>FFT ${channel.spectrogram.windowSize}</span>
                        <span>${channel.spectrogram.frequencyBins} bins</span>
                    </div>
                </div>
                <div class="controls controls-compact" data-channel-index="${index}">
                    <label class="control">
                        <span>Zoom</span>
                        <input id="zoom-${index}" type="range" min="1" max="12" step="0.5" value="1">
                    </label>
                    <label class="control">
                        <span>Offset</span>
                        <input id="offset-${index}" type="range" min="0" max="1" step="0.001" value="0">
                    </label>
                    <div class="button-row">
                        <button id="reset-${index}" type="button" class="action-button">Reset View</button>
                        <button id="clear-cursor-${index}" type="button" class="action-button action-button-secondary">Clear Cursor</button>
                    </div>
                </div>
                <div class="controls controls-compact" data-channel-index="${index}">
                    <label class="control">
                        <span>Color Floor</span>
                        <input id="spectrogram-floor-${index}" type="range" min="0" max="0.85" step="0.01" value="0">
                    </label>
                    <label class="control">
                        <span>Frequency Range</span>
                        <input id="frequency-range-${index}" type="range" min="0.2" max="1" step="0.01" value="1">
                    </label>
                    <label class="control control-inline">
                        <span>Frequency Scale</span>
                        <select id="frequency-scale-${index}" class="select-control">
                            <option value="linear" selected>Linear</option>
                            <option value="log">Log</option>
                        </select>
                    </label>
                </div>
                <div class="gesture-hint">Ctrl + wheel: zoom, Shift + wheel: pan, drag: pan, click: seek and pin cursor, player follows cursor.</div>
                <div class="plot-sheet">
                    <div class="plot-grid">
                        <div class="waveform-panel plot-panel">
                            <div class="axis-caption">Amplitude</div>
                            <div class="plot-stack">
                                <canvas id="waveform-${index}" class="plot-canvas waveform-canvas" width="1220" height="210"></canvas>
                                <div class="axis-row" id="waveform-axis-${index}">
                                    <span>0.00 s</span>
                                    <span>${(result.durationSeconds / 2).toFixed(2)} s</span>
                                    <span>${result.durationSeconds.toFixed(2)} s</span>
                                </div>
                            </div>
                        </div>
                        <div class="waveform-spacer" aria-hidden="true"></div>
                        <div class="waveform-colorbar-spacer" aria-hidden="true"></div>
                        <div class="spectrogram-panel plot-panel">
                            <div class="axis-caption">Frequency [Hz]</div>
                            <div class="plot-frame">
                                <div class="axis-column" id="spectrogram-frequency-axis-${index}">
                                    <span>${Math.round(channel.spectrogram.maxFrequencyHz)} Hz</span>
                                    <span>${Math.round(channel.spectrogram.maxFrequencyHz / 2)} Hz</span>
                                    <span>0 Hz</span>
                                </div>
                                <div class="plot-stack plot-stack-spectrogram">
                                    <canvas id="spectrogram-${index}" class="plot-canvas spectrogram-canvas" width="1220" height="520"></canvas>
                                    <div class="axis-row" id="spectrogram-time-axis-${index}">
                                        <span>0.00 s</span>
                                        <span>${(result.durationSeconds / 2).toFixed(2)} s</span>
                                        <span>${result.durationSeconds.toFixed(2)} s</span>
                                    </div>
                                    <div class="axis-caption axis-caption-x">Time [s]</div>
                                </div>
                            </div>
                        </div>
                        <div class="profile-panel plot-panel">
                            <div class="profile-stack">
                                <canvas id="profile-${index}" class="profile-canvas" width="180" height="520"></canvas>
                                <div class="axis-row" id="profile-axis-${index}">
                                    <span>0</span>
                                    <span>0.5</span>
                                    <span>1.0</span>
                                </div>
                                <div class="axis-caption axis-caption-x">Spectrum level</div>
                            </div>
                        </div>
                        <div class="colorbar-panel plot-panel">
                            <canvas id="colorbar-${index}" class="colorbar-canvas" width="32" height="520"></canvas>
                            <div class="colorbar-labels" id="colorbar-labels-${index}">
                                <span>${channel.spectrogram.maxDb.toFixed(0)} dB</span>
                                <span>${((channel.spectrogram.maxDb + channel.spectrogram.minDb) / 2).toFixed(0)} dB</span>
                                <span>${channel.spectrogram.minDb.toFixed(0)} dB</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="readout-row">
                    <div id="waveform-readout-${index}" class="readout">Hover waveform to inspect time and amplitude.</div>
                    <div id="spectrogram-readout-${index}" class="readout">Hover spectrogram to inspect time, frequency, and intensity.</div>
                </div>
                <div class="peaks-block">
                    <table>
                        <thead>
                            <tr>
                                <th>Dominant frequency</th>
                                <th>Magnitude</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${peaks}
                        </tbody>
                    </table>
                </div>
            </section>`;
    }

    private static serializeForScript(value: unknown): string {
        return JSON.stringify(value)
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/&/g, '\\u0026')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
    }

    private static escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
