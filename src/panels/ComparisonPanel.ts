import * as vscode from 'vscode';
import { serializeForScript } from '../utils/webviewEscaping';
import type { AnalysisResult } from './AnalysisPanel';

interface AnalysisResultWithError extends AnalysisResult {
    error?: string;
}

interface ComparisonState {
    results: AnalysisResultWithError[];
    referenceIndex: number;
}

export class ComparisonPanel {
    public static show(
        extensionUri: vscode.Uri,
        results: AnalysisResultWithError[],
        existingPanel?: vscode.WebviewPanel,
    ): vscode.WebviewPanel {
        const title = `比較: ${results.map((r) => r.fileName).join(', ')}`;

        const panel = existingPanel ?? vscode.window.createWebviewPanel(
            'audioWandasAnalyzer.comparison',
            title,
            vscode.ViewColumn.Beside,
            { enableScripts: true },
        );

        panel.title = title;
        panel.webview.options = { enableScripts: true };
        panel.reveal(vscode.ViewColumn.Beside, true);

        const state: ComparisonState = { results, referenceIndex: 0 };
        panel.webview.html = ComparisonPanel.renderHtml(panel.webview, state);
        return panel;
    }

    private static renderHtml(webview: vscode.Webview, state: ComparisonState): string {
        const nonce = Date.now().toString();
        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>比較パネル</title>
    <style>${ComparisonPanel.renderStyles()}</style>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}">
        const __APP_STATE__ = ${serializeForScript(state)};
        ${ComparisonPanel.renderScript()}
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
            --surface: #fbfbf8;
            --panel: #ffffff;
            --line: #d4d1c7;
            --text: #161616;
            --muted: #5e5a53;
            --accent: #0f7b6c;
        }
        body.vscode-dark, body[data-theme-kind="dark"] {
            --surface: #1e1e1e;
            --panel: #252526;
            --line: #3c3c3c;
            --text: #cccccc;
            --muted: #888888;
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

        /* ── Track layout ── */
        #tracks-wrapper { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; }
        #ruler-row { display: flex; border-bottom: 1px solid var(--line); flex-shrink: 0; }
        #ruler-spacer { width: 130px; flex-shrink: 0; border-right: 1px solid var(--line); }
        #ruler-canvas { flex: 1; height: 20px; display: block; }

        .track-row { display: flex; border-bottom: 1px solid var(--line); flex-shrink: 0; }
        .track-header {
            width: 130px; flex-shrink: 0; border-right: 1px solid var(--line);
            padding: 5px 6px; display: flex; flex-direction: column; gap: 2px; font-size: 9px;
        }
        .track-role { color: var(--muted); }
        .track-name { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 600; }
        .track-meta { color: var(--muted); }
        .track-btns { display: flex; gap: 3px; margin-top: 2px; align-items: center; }
        .track-btn {
            font-size: 9px; padding: 1px 4px; border-radius: 2px;
            border: 1px solid var(--line); background: var(--surface);
            color: var(--muted); cursor: pointer;
        }
        .track-btn.is-muted { background: #555; color: #fff; }
        .track-ref-badge {
            font-size: 8px; padding: 1px 4px; border-radius: 2px;
            margin-left: auto;
        }
        .track-offset { display: flex; align-items: center; gap: 2px; margin-top: 3px; }
        .track-offset-val {
            font-size: 9px; font-family: var(--font-mono);
            background: var(--surface); border: 1px solid var(--line);
            border-radius: 2px; padding: 1px 3px; width: 56px; text-align: right;
            cursor: text;
        }
        .track-offset-step { font-size: 9px; padding: 1px 3px; border-radius: 2px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); cursor: pointer; }
        .track-canvas-wrap { flex: 1; position: relative; overflow: hidden; }
        .track-canvas { display: block; width: 100%; height: 80px; cursor: crosshair; }

        /* ── Overlay mode ── */
        #overlay-wrap { flex: 1; display: none; flex-direction: column; }
        #overlay-wrap.is-visible { display: flex; }
        #overlay-legend { display: flex; gap: 12px; padding: 4px 10px; font-size: 10px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
        .overlay-legend-item { display: flex; align-items: center; gap: 4px; }
        .overlay-swatch { width: 12px; height: 2px; border-radius: 1px; }
        #overlay-canvas-wrap { flex: 1; position: relative; overflow: hidden; }
        #overlay-canvas { display: block; width: 100%; cursor: crosshair; }

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
        `;
    }

    private static renderScript(): string {
        return `
        (function() {
            const vscode = acquireVsCodeApi();
            const state = __APP_STATE__;

            const TRACK_COLORS = ['#4ec994','#ff8c4a','#4a9eff','#e8637a','#c084fc'];

            function hexToRgba(hex, alpha) {
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
            }

            // ── Runtime state ──
            let viewMode = 'stacked';     // 'stacked' | 'overlay'
            let contentType = 'waveform'; // 'waveform' | 'spectrogram'
            let zoomStart = 0;
            let zoomEnd = 1;
            let cursorNorm = null;        // null = free, number = fixed
            let referenceIndex = state.referenceIndex;
            let dragState = null;         // { trackIndex, startClientX, startOffset, canvasWidth, isDrag }
            let hoverTrackIndex = -1;     // overlay hit-test highlight

            const trackRuntime = state.results.map(function() {
                return { offsetSeconds: 0, hidden: false };
            });

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

            function scheduleRangeRequests() {
                if (rangeRequestTimer) { clearTimeout(rangeRequestTimer); }
                rangeRequestTimer = setTimeout(function() { checkAndRequestRanges(); }, 300);
            }

            function checkAndRequestRanges() {
                const OVERVIEW_PTS = 1200;
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden || result.error) { return; }
                    const canvas = document.getElementById('track-canvas-' + i);
                    const W = (canvas ? canvas.width : 0) || 800;
                    const visibleOverview = OVERVIEW_PTS * (zoomEnd - zoomStart);
                    // Request when overview resolution is insufficient: < 0.5 pts per pixel
                    if (visibleOverview >= W * 0.5) { return; }

                    const dur = result.durationSeconds || 1;
                    const offset = trackRuntime[i].offsetSeconds / dur;
                    const reqStart = Math.max(0, zoomStart + offset - 0.05 * (zoomEnd - zoomStart));
                    const reqEnd   = Math.min(1, zoomEnd   + offset + 0.05 * (zoomEnd - zoomStart));
                    const pts = Math.min(W * 2, 8000);

                    // Skip if cached range already covers current view
                    const c = rangeCache[i];
                    if (c && c.startNorm <= reqStart && c.endNorm >= reqEnd &&
                        c.channels && c.channels[0] && c.channels[0].samples &&
                        c.channels[0].samples.length >= pts * 0.8) { return; }

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
            requestAnimationFrame(function() { renderAll(); });

            function buildLayout() {
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
                    + '  <div id="overlay-wrap">'
                    + '    <div id="overlay-legend"></div>'
                    + '    <div id="overlay-canvas-wrap"><canvas id="overlay-canvas"></canvas></div>'
                    + '  </div>'
                    + '  <div id="empty-state"><p>すべてのトラックが除外されています</p></div>'
                    + '</div>'
                    + '<div id="metrics-bar">' + metrics + '</div>';
            }

            function buildToolbar() {
                return '<span style="font-weight:700;font-size:12px;color:var(--accent)">⚡ 比較</span>'
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">表示:</span>'
                    + '<button class="tb-btn is-active" data-action="view-stacked">縦積み</button>'
                    + '<button class="tb-btn" data-action="view-overlay">オーバーレイ</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">トラック:</span>'
                    + '<button class="tb-btn is-active" data-action="content-waveform">波形</button>'
                    + '<button class="tb-btn" data-action="content-spectrogram">スペクトログラム</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">ズーム:</span>'
                    + '<button class="tb-btn" data-action="zoom-out">－</button>'
                    + '<button class="tb-btn" data-action="zoom-in">＋</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span id="cursor-display">—</span>';
            }

            function buildTrackRow(result, i) {
                const color = TRACK_COLORS[i % TRACK_COLORS.length];
                const isRef = i === referenceIndex;
                const refBadge = isRef
                    ? '<span class="track-ref-badge" style="background:' + color + ';color:#000">基準</span>'
                    : '<button class="track-btn" data-action="set-ref" data-track-index="' + i + '" title="基準にする">基準に</button>';
                return '<div class="track-row" id="track-row-' + i + '" data-track-index="' + i + '">'
                    + '<div class="track-header">'
                    + '  <div class="track-role">' + (isRef ? '📌 基準' : '比較') + '</div>'
                    + '  <div class="track-name" title="' + escHtml(result.filePath) + '">' + escHtml(result.fileName) + '</div>'
                    + '  <div class="track-meta">Ch: ' + result.channelCount + ' &nbsp;' + (result.sampleRateHz / 1000).toFixed(1) + 'kHz</div>'
                    + '  <div class="track-meta">RMS: ' + (result.channels[0] ? (20 * Math.log10(Math.max(result.channels[0].rms, 1e-9))).toFixed(1) + ' dBFS' : '—') + '</div>'
                    + '  <div class="track-btns">'
                    + '    <button class="track-btn" data-action="toggle-mute" data-track-index="' + i + '">M</button>'
                    + '    <button class="track-btn" style="opacity:0.3" disabled title="将来対応">S</button>'
                    + '    <button class="track-btn" data-action="remove-track" data-track-index="' + i + '">✕</button>'
                    + '    ' + refBadge
                    + '  </div>'
                    + '  <div class="track-offset">'
                    + '    <span class="track-offset-val" id="offset-val-' + i + '" data-track-index="' + i + '" title="ダブルクリックでリセット">+0.000s</span>'
                    + '    <button class="track-offset-step" data-action="offset-up" data-track-index="' + i + '">▲</button>'
                    + '    <button class="track-offset-step" data-action="offset-down" data-track-index="' + i + '">▼</button>'
                    + '  </div>'
                    + '</div>'
                    + '<div class="track-canvas-wrap" id="track-canvas-wrap-' + i + '">'
                    + '  <canvas class="track-canvas" id="track-canvas-' + i + '" data-track-index="' + i + '"></canvas>'
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
                if (viewMode === 'stacked') {
                    renderStackedTracks();
                } else {
                    renderOverlay();
                }
                updateVisibility();
                updateOffsetDisplays();
                if (contentType === 'waveform') { scheduleRangeRequests(); }
            }

            function resizeAllCanvases() {
                state.results.forEach(function(_, i) {
                    const canvas = document.getElementById('track-canvas-' + i);
                    if (!canvas) { return; }
                    const wrap = document.getElementById('track-canvas-wrap-' + i);
                    if (wrap) {
                        canvas.width = wrap.clientWidth || 800;
                        canvas.height = 80;
                    }
                });
                const overlayCanvas = document.getElementById('overlay-canvas');
                if (overlayCanvas) {
                    const wrap = document.getElementById('overlay-canvas-wrap');
                    if (wrap) {
                        overlayCanvas.width = wrap.clientWidth || 800;
                        overlayCanvas.height = 160;
                    }
                }
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
                const maxDur = Math.max.apply(null, state.results.map(function(r) { return r.durationSeconds || 0; }));
                if (maxDur <= 0) { return; }
                const visStart = zoomStart * maxDur;
                const visEnd = zoomEnd * maxDur;
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
                        drawWaveform(canvas, result, i, trackRuntime[i].offsetSeconds, color, false);
                    } else {
                        drawSpectrogram(canvas, result, trackRuntime[i].offsetSeconds);
                    }
                });
            }

            function resolveWaveformSource(result, trackIndex, offsetSeconds) {
                const dur = result.durationSeconds || 1;
                const offset = offsetSeconds / dur;
                const c = rangeCache[trackIndex];
                if (c && c.channels && c.channels[0] && c.channels[0].samples &&
                    c.startNorm <= zoomStart + offset &&
                    c.endNorm   >= zoomEnd   + offset) {
                    return { waveform: c.channels[0], dataStart: c.startNorm, dataEnd: c.endNorm };
                }
                const ch = result.channels[0];
                return ch && ch.waveform
                    ? { waveform: ch.waveform, dataStart: 0, dataEnd: 1 }
                    : null;
            }

            // Shared waveform rendering: min/max bars when zoomed out, polyline when zoomed in.
            // Single rendering mode: decimated_index method.
            // Computes div = visible_data_points / (W * 2).
            // For each bucket of div points: picks argmin + argmax index in time order.
            // When div=1 (zoomed in) → all points → accurate polyline.
            // When div>1 (zoomed out) → min+max per bucket → vertical sweep that preserves peaks.
            // Single rendering mode: decimated min/max polyline.
            //
            // For each bucket of div data points, add (xOf(minIdx), lo(minIdx)) and
            // (xOf(maxIdx), hi(maxIdx)) in chronological order.
            // When minIdx===maxIdx (div=1 case), both points share the same X → vertical
            // stroke that shows the full amplitude range at that position.
            // This one path handles all zoom levels without mode switching.
            function renderWaveformData(ctx, W, H, env, dataStart, dataEnd, offsetSeconds, dur, color, isHighlighted) {
                const peak = env.absolutePeak || 1;
                const samples = env.samples || [];
                const minArr = env.min || [];
                const maxArr = env.max || [];
                const n = samples.length;
                if (n === 0) { return; }

                const dataRange = dataEnd - dataStart;

                const visStartNorm = (zoomStart - offsetSeconds / dur - dataStart) / dataRange;
                const visEndNorm   = (zoomEnd   - offsetSeconds / dur - dataStart) / dataRange;
                const i0 = Math.max(0, Math.floor(visStartNorm * n) - 1);
                const i1 = Math.min(n - 1, Math.ceil(visEndNorm * n) + 1);
                if (i1 <= i0) { return; }

                const visibleCount = i1 - i0 + 1;
                const div = Math.max(1, Math.floor(visibleCount / (W * 2)));

                function lo(i) { return minArr.length > i ? minArr[i] : samples[i]; }
                function hi(i) { return maxArr.length > i ? maxArr[i] : samples[i]; }
                function xOf(idx) {
                    const tNorm = dataStart + (idx / n) * dataRange + offsetSeconds / dur;
                    return ((tNorm - zoomStart) / (zoomEnd - zoomStart)) * W;
                }

                ctx.lineWidth = isHighlighted ? 2 : 1.5;
                ctx.strokeStyle = color;
                ctx.beginPath();
                let started = false;
                function pt(x, y) {
                    if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
                }

                for (let b = i0; b <= i1; b += div) {
                    const bEnd = Math.min(i1 + 1, b + div);
                    let minIdx = b, maxIdx = b;
                    let minVal = lo(b), maxVal = hi(b);
                    for (let i = b + 1; i < bEnd; i++) {
                        const l = lo(i), h = hi(i);
                        if (l < minVal) { minVal = l; minIdx = i; }
                        if (h > maxVal) { maxVal = h; maxIdx = i; }
                    }
                    // Always emit both trough and peak in chronological order.
                    // When minIdx===maxIdx (div=1), same X yields a vertical stroke.
                    if (minIdx <= maxIdx) {
                        pt(xOf(minIdx), H / 2 - (minVal / peak) * (H * 0.44));
                        pt(xOf(maxIdx), H / 2 - (maxVal / peak) * (H * 0.44));
                    } else {
                        pt(xOf(maxIdx), H / 2 - (maxVal / peak) * (H * 0.44));
                        pt(xOf(minIdx), H / 2 - (minVal / peak) * (H * 0.44));
                    }
                }
                ctx.stroke();
            }

            function drawWaveform(canvas, result, trackIndex, offsetSeconds, color, isHighlighted) {
                const ctx = canvas.getContext('2d');
                const W = canvas.width;
                const H = canvas.height;
                ctx.clearRect(0, 0, W, H);

                const src = resolveWaveformSource(result, trackIndex, offsetSeconds);
                if (!src) { drawCursorOnCanvas(ctx, W, H); return; }

                const { waveform: env, dataStart, dataEnd } = src;
                const dur = result.durationSeconds || 1;

                // Zero line
                ctx.strokeStyle = hexToRgba(color, 0.25);
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(0, H / 2);
                ctx.lineTo(W, H / 2);
                ctx.stroke();

                renderWaveformData(ctx, W, H, env, dataStart, dataEnd, offsetSeconds, dur, color, isHighlighted);
                drawCursorOnCanvas(ctx, W, H);
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

                const imageData = ctx.createImageData(W, H);
                const data = imageData.data;

                for (let px = 0; px < W; px++) {
                    const tNorm = zoomStart + (px / W) * (zoomEnd - zoomStart);
                    const tAdj = tNorm - offsetSeconds / dur;
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
                drawCursorOnCanvas(ctx, W, H);
            }

            function dbToRgb(norm) {
                if (norm < 0.25) { const t = norm / 0.25; return [Math.floor(68 + t * (59 - 68)), Math.floor(1 + t * (82 - 1)), Math.floor(84 + t * (139 - 84))]; }
                if (norm < 0.5)  { const t = (norm - 0.25) / 0.25; return [Math.floor(59 + t * (33 - 59)), Math.floor(82 + t * (145 - 82)), Math.floor(139 + t * (140 - 139))]; }
                if (norm < 0.75) { const t = (norm - 0.5) / 0.25; return [Math.floor(33 + t * (94 - 33)), Math.floor(145 + t * (201 - 145)), Math.floor(140 + t * (98 - 140))]; }
                const t = (norm - 0.75) / 0.25; return [Math.floor(94 + t * (253 - 94)), Math.floor(201 + t * (231 - 201)), Math.floor(98 + t * (37 - 98))];
            }

            function drawCursorOnCanvas(ctx, W, H) {
                if (cursorNorm === null) { return; }
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

            function renderOverlay() {
                const canvas = document.getElementById('overlay-canvas');
                if (!canvas) { return; }
                const ctx = canvas.getContext('2d');
                const W = canvas.width;
                const H = canvas.height;
                ctx.clearRect(0, 0, W, H);

                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden || result.error) { return; }
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    const isHl = (i === hoverTrackIndex);
                    ctx.save();
                    ctx.globalAlpha = isHl ? 1.0 : (i === referenceIndex ? 0.9 : 0.7);
                    drawWaveformOnCtx(ctx, W, H, result, i, trackRuntime[i].offsetSeconds, color, isHl);
                    ctx.restore();
                });

                if (cursorNorm !== null) {
                    const x = (cursorNorm - zoomStart) / (zoomEnd - zoomStart) * W;
                    ctx.save();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.globalAlpha = 0.7;
                    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
                    ctx.restore();
                }

                updateOverlayLegend();
            }

            function drawWaveformOnCtx(ctx, W, H, result, trackIndex, offsetSeconds, color, isHighlighted) {
                const src = resolveWaveformSource(result, trackIndex, offsetSeconds);
                if (!src) { return; }
                const { waveform: env, dataStart, dataEnd } = src;
                const dur = result.durationSeconds || 1;
                renderWaveformData(ctx, W, H, env, dataStart, dataEnd, offsetSeconds, dur, color, isHighlighted);
            }

            function updateOverlayLegend() {
                const legend = document.getElementById('overlay-legend');
                if (!legend) { return; }
                legend.innerHTML = state.results.map(function(result, i) {
                    if (trackRuntime[i].hidden) { return ''; }
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    return '<div class="overlay-legend-item"><div class="overlay-swatch" style="background:' + color + '"></div>'
                        + '<span>' + escHtml(result.fileName) + (i === referenceIndex ? ' 📌' : '') + '</span></div>';
                }).join('');
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

            // ── Events ──
            function attachEvents() {
                document.getElementById('toolbar').addEventListener('click', function(e) {
                    const action = e.target.getAttribute('data-action');
                    if (!action) { return; }
                    handleToolbarAction(action);
                });

                document.getElementById('tracks-wrapper').addEventListener('click', function(e) {
                    const action = e.target.getAttribute('data-action');
                    const idx = parseInt(e.target.getAttribute('data-track-index'), 10);
                    if (action === 'toggle-mute' && !isNaN(idx)) { toggleMute(idx); }
                    if (action === 'remove-track' && !isNaN(idx)) { removeTrack(idx); }
                    if (action === 'set-ref' && !isNaN(idx)) { setReference(idx); }
                    if (action === 'offset-up' && !isNaN(idx)) { adjustOffset(idx, 0.01); }
                    if (action === 'offset-down' && !isNaN(idx)) { adjustOffset(idx, -0.01); }
                });

                document.getElementById('tracks-wrapper').addEventListener('dblclick', function(e) {
                    if (e.target.classList.contains('track-offset-val')) {
                        const idx = parseInt(e.target.getAttribute('data-track-index'), 10);
                        if (!isNaN(idx)) { trackRuntime[idx].offsetSeconds = 0; updateOffsetDisplays(); renderAll(); }
                    }
                });

                document.getElementById('tracks-wrapper').addEventListener('mousemove', function(e) {
                    handleCanvasMouseMove(e);
                });
                document.getElementById('tracks-wrapper').addEventListener('mousedown', function(e) {
                    handleCanvasMouseDown(e);
                });
                document.addEventListener('mousemove', function(e) { handleDocMouseMove(e); });
                document.addEventListener('mouseup', function(e) { handleDocMouseUp(e); });

                const overlayCanvas = document.getElementById('overlay-canvas');
                if (overlayCanvas) {
                    overlayCanvas.addEventListener('mousemove', function(e) { handleOverlayMouseMove(e); });
                    overlayCanvas.addEventListener('mousedown', function(e) { handleOverlayMouseDown(e); });
                    overlayCanvas.addEventListener('click', function(e) { handleOverlayClick(e); });
                }

                document.getElementById('tracks-wrapper').addEventListener('wheel', function(e) {
                    e.preventDefault();
                    if (e.ctrlKey) { handleZoomWheel(e); }
                    else if (e.shiftKey) { handlePanWheel(e); }
                }, { passive: false });

                window.addEventListener('resize', function() {
                    // Defer until after browser reflow so clientWidth is up-to-date
                    requestAnimationFrame(function() { renderAll(); });
                });
            }

            function handleToolbarAction(action) {
                if (action === 'view-stacked') {
                    viewMode = 'stacked';
                    document.querySelector('[data-action="view-stacked"]').classList.add('is-active');
                    document.querySelector('[data-action="view-overlay"]').classList.remove('is-active');
                    document.getElementById('stacked-wrap').style.display = '';
                    document.getElementById('overlay-wrap').classList.remove('is-visible');
                    renderAll();
                } else if (action === 'view-overlay') {
                    viewMode = 'overlay';
                    document.querySelector('[data-action="view-stacked"]').classList.remove('is-active');
                    document.querySelector('[data-action="view-overlay"]').classList.add('is-active');
                    document.getElementById('stacked-wrap').style.display = 'none';
                    document.getElementById('overlay-wrap').classList.add('is-visible');
                    renderAll();
                } else if (action === 'content-waveform') {
                    contentType = 'waveform';
                    document.querySelector('[data-action="content-waveform"]').classList.add('is-active');
                    document.querySelector('[data-action="content-spectrogram"]').classList.remove('is-active');
                    renderAll();
                } else if (action === 'content-spectrogram') {
                    contentType = 'spectrogram';
                    document.querySelector('[data-action="content-waveform"]').classList.remove('is-active');
                    document.querySelector('[data-action="content-spectrogram"]').classList.add('is-active');
                    // スペクトログラムはオーバーレイ非対応のため縦積みに切替
                    if (viewMode === 'overlay') {
                        viewMode = 'stacked';
                        document.querySelector('[data-action="view-stacked"]').classList.add('is-active');
                        document.querySelector('[data-action="view-overlay"]').classList.remove('is-active');
                        document.getElementById('stacked-wrap').style.display = '';
                        document.getElementById('overlay-wrap').classList.remove('is-visible');
                    }
                    renderAll();
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
                renderAll();
            }

            function zoomOut() {
                const center = (zoomStart + zoomEnd) / 2;
                const half = (zoomEnd - zoomStart) / 2 * (1 / 0.7);
                zoomStart = Math.max(0, center - half);
                zoomEnd = Math.min(1, center + half);
                renderAll();
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
                renderAll();
            }

            function handlePanWheel(e) {
                const shift = (zoomEnd - zoomStart) * 0.1 * (e.deltaY > 0 ? 1 : -1);
                if (zoomStart + shift < 0) { zoomEnd -= zoomStart; zoomStart = 0; }
                else if (zoomEnd + shift > 1) { zoomStart += 1 - zoomEnd; zoomEnd = 1; }
                else { zoomStart += shift; zoomEnd += shift; }
                renderAll();
            }

            function handleCanvasMouseMove(e) {
                const canvas = e.target;
                if (!canvas.classList.contains('track-canvas')) { return; }
                if (dragState) { return; }
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                if (cursorNorm === null) {
                    renderWithCursorAt(norm);
                }
            }

            function handleCanvasMouseDown(e) {
                const canvas = e.target;
                if (!canvas.classList.contains('track-canvas')) { return; }
                const idx = parseInt(canvas.getAttribute('data-track-index'), 10);
                if (isNaN(idx)) { return; }
                if (e.button === 0) {
                    dragState = {
                        trackIndex: idx,
                        startClientX: e.clientX,
                        startOffset: trackRuntime[idx].offsetSeconds,
                        canvasWidth: canvas.width,
                        isDrag: false,
                    };
                }
            }

            function handleDocMouseMove(e) {
                if (!dragState) { return; }
                const dx = e.clientX - dragState.startClientX;
                if (Math.abs(dx) > 3) { dragState.isDrag = true; }
                if (!dragState.isDrag) { return; }
                const maxDur = Math.max.apply(null, state.results.map(function(r) { return r.durationSeconds || 1; }));
                const secsPerPx = (zoomEnd - zoomStart) * maxDur / dragState.canvasWidth;
                trackRuntime[dragState.trackIndex].offsetSeconds = dragState.startOffset + dx * secsPerPx;
                updateOffsetDisplays();
                renderAll();
            }

            function handleDocMouseUp(e) {
                if (dragState && !dragState.isDrag) {
                    const canvasId = viewMode === 'overlay' ? 'overlay-canvas' : 'track-canvas-' + dragState.trackIndex;
                    const canvas = document.getElementById(canvasId);
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                        cursorNorm = (cursorNorm !== null) ? null : norm;
                        renderAll();
                    }
                }
                dragState = null;
            }

            function renderWithCursorAt(norm) {
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden || result.error) { return; }
                    const canvas = document.getElementById('track-canvas-' + i);
                    if (!canvas) { return; }
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    if (contentType === 'waveform') {
                        const savedCursor = cursorNorm;
                        cursorNorm = norm;
                        drawWaveform(canvas, result, i, trackRuntime[i].offsetSeconds, color, false);
                        cursorNorm = savedCursor;
                    }
                });
                updateCursorDisplay(norm);
            }

            function updateCursorDisplay(norm) {
                const maxDur = Math.max.apply(null, state.results.map(function(r) { return r.durationSeconds || 0; }));
                const t = norm * maxDur;
                const el = document.getElementById('cursor-display');
                if (el) { el.textContent = formatTime(t); }
            }

            function hitTestOverlay(canvas, clientX, clientY) {
                const rect = canvas.getBoundingClientRect();
                const mouseX = clientX - rect.left;
                const mouseY = clientY - rect.top;
                const W = canvas.width;
                const H = canvas.height;
                let minDist = Infinity;
                let nearest = -1;
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden || result.error) { return; }
                    const offsetSeconds = trackRuntime[i].offsetSeconds;
                    const src = resolveWaveformSource(result, i, offsetSeconds);
                    if (!src) { return; }
                    const { waveform: env, dataStart, dataEnd } = src;
                    const peak = env.absolutePeak || 1;
                    const samples = env.samples || [];
                    const n = samples.length;
                    const dur = result.durationSeconds || 1;
                    const tNorm = zoomStart + (mouseX / W) * (zoomEnd - zoomStart);
                    const tAdj = tNorm - offsetSeconds / dur;
                    const tInData = (tAdj - dataStart) / (dataEnd - dataStart);
                    const idx = Math.floor(tInData * n);
                    if (idx < 0 || idx >= n) { return; }
                    const waveY = H / 2 - (samples[idx] / peak) * (H * 0.44);
                    const dist = Math.abs(mouseY - waveY);
                    if (dist < minDist) { minDist = dist; nearest = i; }
                });
                return minDist <= 20 ? nearest : -1;
            }

            function handleOverlayMouseMove(e) {
                const canvas = document.getElementById('overlay-canvas');
                if (!canvas || dragState) { return; }
                const newHover = hitTestOverlay(canvas, e.clientX, e.clientY);
                if (newHover !== hoverTrackIndex) {
                    hoverTrackIndex = newHover;
                    canvas.style.cursor = newHover >= 0 ? 'ew-resize' : 'crosshair';
                    renderOverlay();
                }
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                updateCursorDisplay(norm);
            }

            function handleOverlayMouseDown(e) {
                const canvas = document.getElementById('overlay-canvas');
                if (!canvas) { return; }
                const idx = hitTestOverlay(canvas, e.clientX, e.clientY);
                if (idx >= 0) {
                    dragState = {
                        trackIndex: idx,
                        startClientX: e.clientX,
                        startOffset: trackRuntime[idx].offsetSeconds,
                        canvasWidth: canvas.width,
                        isDrag: false,
                    };
                }
            }

            function handleOverlayClick(e) {
                if (dragState && !dragState.isDrag) {
                    const canvas = document.getElementById('overlay-canvas');
                    if (canvas) {
                        const rect = canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const norm = zoomStart + (x / canvas.width) * (zoomEnd - zoomStart);
                        cursorNorm = (cursorNorm !== null) ? null : norm;
                        renderAll();
                    }
                }
            }

            function toggleMute(idx) {
                trackRuntime[idx].hidden = !trackRuntime[idx].hidden;
                const btn = document.querySelector('[data-action="toggle-mute"][data-track-index="' + idx + '"]');
                if (btn) { btn.classList.toggle('is-muted', trackRuntime[idx].hidden); }
                updateVisibility();
                renderAll();
            }

            function removeTrack(idx) {
                const row = document.getElementById('track-row-' + idx);
                if (row) { row.remove(); }
                trackRuntime[idx].hidden = true;
                if (referenceIndex === idx) {
                    const remaining = Array.from(document.querySelectorAll('.track-row'))
                        .map(function(r) { return parseInt(r.getAttribute('data-track-index'), 10); })
                        .filter(function(i) { return !isNaN(i); });
                    if (remaining.length > 0) { setReference(remaining[0]); }
                }
                updateVisibility();
                renderAll();
            }

            function setReference(idx) {
                referenceIndex = idx;
                document.querySelectorAll('.track-row').forEach(function(row) {
                    const i = parseInt(row.getAttribute('data-track-index'), 10);
                    const roleEl = row.querySelector('.track-role');
                    if (roleEl) { roleEl.textContent = i === idx ? '📌 基準' : '比較'; }
                    const badge = row.querySelector('.track-ref-badge');
                    const setRefBtn = row.querySelector('[data-action="set-ref"]');
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    if (i === idx) {
                        if (setRefBtn) {
                            setRefBtn.outerHTML = '<span class="track-ref-badge" style="background:' + color + ';color:#000">基準</span>';
                        }
                    } else {
                        if (badge) {
                            badge.outerHTML = '<button class="track-btn" data-action="set-ref" data-track-index="' + i + '" title="基準にする">基準に</button>';
                        }
                    }
                });
                renderAll();
            }

            function adjustOffset(idx, deltaSeconds) {
                trackRuntime[idx].offsetSeconds += deltaSeconds;
                updateOffsetDisplays();
                renderAll();
            }
        })();
        `;
    }
}
