/**
 * ComparisonPanel の webview に注入される IIFE JavaScript を返す。
 *
 * NOTE: 文字列を組み立てるだけのファサード。実体は backtick テンプレート内の
 * inline JS で、`__APP_STATE__` をグローバル経由で受け取る。
 * 純粋描画関数は src/webview/draw/canvasDrawers.ts に切り出され、ここでは
 * window.draw* 経由で呼ぶ薄い alias と DOM テーマ橋渡しを行う。
 */
export function getComparisonRenderScript(): string {
        return `
        (function() {
            const vscode = acquireVsCodeApi();
            const state = __APP_STATE__;
            const STR = (typeof __APP_STRINGS__ !== 'undefined' && __APP_STRINGS__) ? __APP_STRINGS__ : {};
            const isSelectionMode = state.mode === 'directory-selection';
            const selectedFilePaths = new Set(Array.isArray(state.selectedFilePaths) ? state.selectedFilePaths : []);
            const allSelectableFilePaths = Array.isArray(state.allFilePaths) ? state.allFilePaths.slice() : [];
            let selectionMessageSeq = 0;
            let pythonEnvironmentState = state.pythonEnvironmentState || {
                pythonCommand: 'python3',
                status: 'normal',
                tooltip: 'Click to select Python interpreter',
            };

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
            let spectrumHoverNorm = null;  // スペクトルカーソル（正規化周波数 0..1、null = 非表示）
            let spectrumHoverYFrac = null; // スペクトルカーソルy（canvas高さに対する比率 0..1）
            let spectrumHasMouse = false;  // マウスがスペクトルキャンバス上にある間 true
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
                if (!msg || msg.type !== 'python-environment-state') { return; }
                pythonEnvironmentState = {
                    pythonCommand: typeof msg.pythonCommand === 'string' ? msg.pythonCommand : 'python3',
                    status: msg.status === 'warning' ? 'warning' : 'normal',
                    tooltip: typeof msg.tooltip === 'string' ? msg.tooltip : 'Click to select Python interpreter',
                };
                syncPythonEnvironmentButton();
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
                if (entry.action === 'open-spectrogram-settings') {
                    const gear = document.querySelector('[data-action="spectrogram-settings"]');
                    if (gear) { gear.click(); }
                }
                if (entry.action === 'apply-spectrogram-settings' && entry.payload) {
                    const p = entry.payload;
                    if (__specPopover && __specPopover.hidden) { __openSpecPopover(); }
                    document.getElementById('spec-auto').checked = !!p.auto;
                    if (p.nFft != null) { document.getElementById('spec-nfft').value = String(p.nFft); }
                    if (p.hopSize != null) { document.getElementById('spec-hop').value = String(p.hopSize); }
                    if (p.window != null) { document.getElementById('spec-window').value = String(p.window); }
                    __applySpecAutoState();
                    document.getElementById('spec-apply').click();
                }
                if (entry.action === 'set-spectrogram-display' && entry.payload) {
                    const p = entry.payload;
                    if (__specPopover && __specPopover.hidden) { __openSpecPopover(); }
                    function __setN(id, v) {
                        const el = document.getElementById(id);
                        el.value = (v == null) ? '' : String(v);
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    __setN('spec-dbmin', p.dbMin);
                    __setN('spec-dbmax', p.dbMax);
                    __setN('spec-maxfreq', p.maxFrequencyHz);
                }
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
            syncPythonEnvironmentButton();
            attachEvents();
            // Defer first render so the browser has time to calculate flex layout
            requestAnimationFrame(function() {
                renderAll();
                refreshSpectrumViews();
                publishTestSnapshot();
            });

            function publishTestSnapshot(actionId) {
                const toolbar = document.getElementById('toolbar');
                const overlayCanvas = document.getElementById('spectrum-overlay-canvas');
                let visibleSpectrumTrackCount = 0;
                const spectrogramPerTrack = [];
                const spectrumPerTrack = [];
                const waveformPerTrack = [];
                let overlayMinDb = Infinity, overlayMaxDb = -Infinity, overlayMaxF = 0;
                const trackInfo = state.results.map(function(result, trackIndex) {
                    const dur = result.durationSeconds || 1;
                    const gs = computeGlobalSpan();
                    const trackStart = (trackRuntime[trackIndex].offsetSeconds - gs.startSec) / gs.spanSec;
                    const trackDurRatio = dur / gs.spanSec;
                    const visibleFileStartNorm = Math.max(0, (zoomStart - trackStart) / trackDurRatio);
                    const visibleFileEndNorm = Math.min(1, (zoomEnd - trackStart) / trackDurRatio);
                    const coverage = lastWaveformCoverage[trackIndex];
                    const spectrumCanvas = document.getElementById('track-spectrum-' + trackIndex);
                    const slice = trackRuntime[trackIndex].hidden
                        ? null
                        : extractSpectrumAtCursor(result, trackRuntime[trackIndex].offsetSeconds, cursorNorm);
                    if (slice) {
                        visibleSpectrumTrackCount++;
                        if (slice.minDb < overlayMinDb) { overlayMinDb = slice.minDb; }
                        if (slice.maxDb > overlayMaxDb) { overlayMaxDb = slice.maxDb; }
                        if (slice.maxFrequencyHz > overlayMaxF) { overlayMaxF = slice.maxFrequencyHz; }
                    }
                    waveformPerTrack.push(['+1.0', '0', '-1.0', 'Amp (FS)']);
                    const ch0 = result.channels && result.channels[0];
                    const spec = ch0 && ch0.spectrogram;
                    const dispCfg2 = (typeof __spectrogramSettings !== 'undefined' && __spectrogramSettings && __spectrogramSettings.display) || {};
                    const specDbLo = spec ? ((dispCfg2.dbMin != null) ? dispCfg2.dbMin : spec.minDb) : 0;
                    const specDbHi = spec ? ((dispCfg2.dbMax != null) ? dispCfg2.dbMax : spec.maxDb) : 0;
                    const specMaxF = spec ? ((dispCfg2.maxFrequencyHz != null) ? Math.min(dispCfg2.maxFrequencyHz, spec.maxFrequencyHz) : spec.maxFrequencyHz) : 0;
                    spectrogramPerTrack.push(spec
                        ? ['0 Hz', formatHz(specMaxF / 2), formatHz(specMaxF),
                           specDbLo.toFixed(0) + ' dB', specDbHi.toFixed(0) + ' dB', 'Freq']
                        : []);
                    spectrumPerTrack.push(slice
                        ? [slice.maxDb.toFixed(0) + ' dB',
                           ((slice.maxDb + slice.minDb) / 2).toFixed(0) + ' dB',
                           slice.minDb.toFixed(0) + ' dB',
                           '0 Hz', formatHz(slice.maxFrequencyHz / 2), formatHz(slice.maxFrequencyHz)]
                        : []);
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
                        resultError: result.error || null,
                        spectrumCanvasPresent: !!spectrumCanvas,
                        spectrumSlicePresent: !!slice,
                    };
                });
                let latestSpectrogram;
                try {
                    const firstSpec = state.results
                        && state.results[0]
                        && state.results[0].channels
                        && state.results[0].channels[0]
                        && state.results[0].channels[0].spectrogram;
                    if (firstSpec) {
                        const disp = (typeof __spectrogramSettings !== 'undefined' && __spectrogramSettings && __spectrogramSettings.display)
                            ? __spectrogramSettings.display
                            : { dbMin: null, dbMax: null, maxFrequencyHz: null };
                        latestSpectrogram = {
                            windowSize: firstSpec.windowSize,
                            hopSize: firstSpec.hopSize,
                            dbMinApplied: disp.dbMin == null ? null : Number(disp.dbMin),
                            dbMaxApplied: disp.dbMax == null ? null : Number(disp.dbMax),
                            maxFrequencyHzApplied: disp.maxFrequencyHz == null ? null : Number(disp.maxFrequencyHz),
                        };
                    }
                } catch (e) { /* ignore */ }
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
                        cursorNorm: cursorNorm,
                        spectrumOverlayPresent: !!overlayCanvas,
                        spectrumTrackCanvasCount: document.querySelectorAll('.track-spectrum-canvas').length,
                        visibleSpectrumTrackCount: visibleSpectrumTrackCount,
                        latestSpectrogram: latestSpectrogram,
                        axisLabels: {
                            spectrumOverlay: visibleSpectrumTrackCount > 0 && isFinite(overlayMinDb)
                                ? [overlayMaxDb.toFixed(0) + ' dB',
                                   ((overlayMaxDb + overlayMinDb) / 2).toFixed(0) + ' dB',
                                   overlayMinDb.toFixed(0) + ' dB',
                                   '0 Hz', formatHz(overlayMaxF / 2), formatHz(overlayMaxF)]
                                : [],
                            spectrogramPerTrack: spectrogramPerTrack,
                            spectrumPerTrack: spectrumPerTrack,
                            waveformPerTrack: waveformPerTrack,
                        },
                        tracks: trackInfo,
                    },
                });
            }

            function buildLayout() {
                if (isSelectionMode) {
                    return buildDirectorySelectionLayout();
                }
                return buildResultsPane(STR.emptyAllExcluded);
            }

            function buildDirectorySelectionLayout() {
                const pythonButtonText = 'Python: ' + (pythonEnvironmentState.pythonCommand || 'python3') + (pythonEnvironmentState.status === 'warning' ? ' ⚠' : '');
                const pythonButtonClass = 'tb-btn' + (pythonEnvironmentState.status === 'warning' ? ' is-warning' : '');
                return '<div id="directory-selection-layout">'
                    + '  <div id="selection-toolbar">'
                    + '    <span style="font-weight:700;font-size:12px;color:var(--accent)">' + escHtml(STR.selectionHeader) + '</span>'
                    + '    <div class="tb-sep"></div>'
                    + '    <button class="tb-btn" data-action="open-file">' + escHtml(STR.btnOpenFile) + '</button>'
                    + '    <button class="tb-btn" data-action="open-folder">' + escHtml(STR.btnOpenAnotherFolder) + '</button>'
                    + '    <button class="' + pythonButtonClass + '" id="selection-python-environment" data-action="select-python-environment" title="' + escHtml(pythonEnvironmentState.tooltip || '') + '">' + escHtml(pythonButtonText) + '</button>'
                    + '  </div>'
                    + '  <div id="selection-body">'
                    + '    <div id="selection-sidebar">'
                    + '      <div id="selection-summary">'
                    + '        <div class="selection-count" id="selection-count"></div>'
                    + '        <div class="selection-path">' + escHtml(state.rootPath || '') + '</div>'
                    + '      </div>'
                    + '      <div id="selection-tree">' + buildSelectionTree(state.directoryTree || [], true) + '</div>'
                    + '      <div id="selection-actions">'
                    + '        <button class="tb-btn" data-action="selection-select-all">' + escHtml(STR.btnSelectAll) + '</button>'
                    + '        <button class="tb-btn" data-action="selection-clear-all">' + escHtml(STR.btnClear) + '</button>'
                    + '      </div>'
                    + '    </div>'
                    + '    <div id="selection-results-pane">'
                    + buildResultsPane(STR.emptyNoTracks)
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
                    + '<div id="spectrum-section">'
                    + '  <div id="spectrum-section-header"><span>' + escHtml(STR.spectrumSectionTitle) + '</span><span id="spectrum-cursor-time" style="font-family:var(--font-mono);"></span><span id="spectrum-freq-readout" style="font-family:var(--font-mono);margin-left:14px;"></span></div>'
                    + '  <div id="spectrum-overlay-wrap"><canvas id="spectrum-overlay-canvas"></canvas></div>'
                    + '</div>'
                    + '<div id="audio-host">' + buildAudioElements() + '</div>'
                    + '<div id="metrics-bar">' + metrics + '</div>';
            }

            function buildSelectionTree(nodes, isRoot) {
                if (!Array.isArray(nodes) || nodes.length === 0) {
                    return '<div class="selection-path">' + escHtml(STR.selectionNoSupported) + '</div>';
                }
                return '<ul class="selection-tree-list' + (isRoot ? ' is-root' : '') + '">'
                    + nodes.map(function(node) {
                        if (node.type === 'directory') {
                            return '<li>'
                                + '<div class="selection-tree-directory" data-action="toggle-directory" role="button" tabindex="0" aria-expanded="true">'
                                + '<span class="dir-toggle" aria-hidden="true">▼</span>'
                                + '<span class="dir-name">' + escHtml(node.name) + '</span>'
                                + '</div>'
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
                const pythonButtonText = 'Python: ' + (pythonEnvironmentState.pythonCommand || 'python3') + (pythonEnvironmentState.status === 'warning' ? ' ⚠' : '');
                const pythonButtonClass = 'tb-btn' + (pythonEnvironmentState.status === 'warning' ? ' is-warning' : '');
                return '<span style="font-weight:700;font-size:12px;color:var(--accent)">' + escHtml(STR.toolbarMain) + '</span>'
                    + '<div class="tb-sep"></div>'
                    + '<button class="tb-btn" data-action="open-file">' + escHtml(STR.btnOpenFile) + '</button>'
                    + '<button class="tb-btn" data-action="open-folder">' + escHtml(STR.btnOpenFolder) + '</button>'
                    + '<button class="' + pythonButtonClass + '" id="toolbar-python-environment" data-action="select-python-environment" title="' + escHtml(pythonEnvironmentState.tooltip || '') + '">' + escHtml(pythonButtonText) + '</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">' + escHtml(STR.toolbarTrackLabel) + '</span>'
                    + '<button class="tb-btn is-active" data-action="content-waveform">' + escHtml(STR.btnWaveform) + '</button>'
                    + '<button class="tb-btn" data-action="content-spectrogram">' + escHtml(STR.btnSpectrogram) + '</button>'
                    + '<button class="tb-btn" data-action="spectrogram-settings" title="' + escHtml(STR.btnSpectrogramSettingsTitle) + '" style="display:none">⚙</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span class="tb-label">' + escHtml(STR.toolbarZoomLabel) + '</span>'
                    + '<button class="tb-btn" data-action="zoom-out">－</button>'
                    + '<button class="tb-btn" data-action="zoom-in">＋</button>'
                    + '<button class="tb-btn" data-action="zoom-reset">' + escHtml(STR.btnZoomReset) + '</button>'
                    + '<div class="tb-sep"></div>'
                    + '<button class="tb-btn" data-action="run-recipe">' + escHtml(STR.btnRunRecipe) + '</button>'
                    + '<div class="tb-sep"></div>'
                    + '<span id="cursor-display" title="' + escHtml(STR.cursorDisplayHint) + '">—</span>'
                    + '<span id="loop-badge" style="display:none; color:#64a0ff; font-size:0.85em; margin-left:8px;">' + escHtml(STR.loopBadge) + '</span>';
            }

            function buildTrackRow(result, i) {
                return '<div class="track-row" id="track-row-' + i + '" data-track-index="' + i + '">'
                    + '<div class="track-header">'
                    + '  <div class="track-name" title="' + escHtml(result.filePath) + '">' + escHtml(result.fileName) + '</div>'
                    + '  <div class="track-meta">Ch: ' + result.channelCount + ' &nbsp;' + (result.sampleRateHz / 1000).toFixed(1) + 'kHz</div>'
                    + '  <div class="track-meta">RMS: ' + (result.channels[0] ? (20 * Math.log10(Math.max(result.channels[0].rms, 1e-9))).toFixed(1) + ' dBFS' : '—') + '</div>'
                    + '  <div class="track-btns">'
                    + '    <button class="track-btn" data-action="toggle-mute" data-track-index="' + i + '">M</button>'
                    + '    <button class="track-btn" data-action="toggle-playback" data-track-index="' + i + '" title="' + escHtml(STR.trackPlayTitle) + '"' + (result.audioSource ? '' : ' disabled') + '>▶</button>'
                    + '    <button class="track-btn" data-action="stop-playback" data-track-index="' + i + '" title="' + escHtml(STR.trackStopTitle) + '"' + (result.audioSource ? '' : ' disabled') + '>■</button>'
                    + '    <button class="track-btn" data-action="remove-track" data-track-index="' + i + '">✕</button>'
                    + '  </div>'
                    + '  <div class="track-offset">'
                    + '    <span class="track-offset-val" id="offset-val-' + i + '" data-track-index="' + i + '" title="' + escHtml(STR.trackOffsetResetHint) + '">+0.000s</span>'
                    + '    <button class="track-offset-step" data-action="offset-up" data-track-index="' + i + '">▲</button>'
                    + '    <button class="track-offset-step" data-action="offset-down" data-track-index="' + i + '">▼</button>'
                    + '  </div>'
                    + '</div>'
                    + '<div class="track-canvas-wrap" id="track-canvas-wrap-' + i + '">'
                    + '  <canvas class="track-canvas" id="track-canvas-' + i + '" data-track-index="' + i + '" tabindex="0" style="outline:none"></canvas>'
                    + '</div>'
                    + '<div class="track-spectrum-wrap" id="track-spectrum-wrap-' + i + '" title="' + escHtml(STR.trackSpectrumTitle) + '">'
                    + '  <canvas class="track-spectrum-canvas" id="track-spectrum-' + i + '" data-track-index="' + i + '"></canvas>'
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
                    if (result.error) {
                        const canvas = document.getElementById('track-canvas-' + i);
                        if (canvas) {
                            const ctx = canvas.getContext('2d');
                            ctx.clearRect(0, 0, canvas.width, canvas.height);
                            ctx.fillStyle = '#e8637a';
                            ctx.font = '11px sans-serif';
                            ctx.fillText(STR.analysisFailed + result.error, 8, canvas.height / 2 + 4);
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
                if (src && window.renderWaveformPipeline) {
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
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(32, 0, W - 32, H);
                    ctx.clip();
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
                        ctx.restore();
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
                        }
                        : null;
                } else {
                    lastWaveformCoverage[trackIndex] = null;
                }

                if (shouldDrawCursor) {
                    drawLoopRegionOnCanvas(ctx, W, H);
                    drawCursorOnCanvas(ctx, W, H);
                    drawHoverLineOnCanvas(ctx, W, H);
                }

                drawWaveformAmplitudeAxis(ctx, W, H);
            }

            function drawWaveformAmplitudeAxis(ctx, W, H) {
                const mutedColor = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
                const bgColor = getComputedStyle(document.body).getPropertyValue('--track-bg').trim() || 'rgba(0,0,0,0.55)';
                const labelW = 30;
                ctx.save();
                ctx.fillStyle = bgColor;
                ctx.globalAlpha = 0.7;
                ctx.fillRect(0, 0, labelW, H);
                ctx.globalAlpha = 1;
                ctx.fillStyle = mutedColor;
                ctx.font = '9px monospace';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'top';
                ctx.fillText('+1.0', labelW - 2, 1);
                ctx.textBaseline = 'middle';
                ctx.fillText('0', labelW - 2, H / 2);
                ctx.textBaseline = 'bottom';
                ctx.fillText('-1.0', labelW - 2, H - 1);
                ctx.save();
                ctx.translate(8, H / 2);
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('Amp (FS)', 0, 0);
                ctx.restore();
                ctx.restore();
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

                const dispCfg = (typeof __spectrogramSettings !== 'undefined' && __spectrogramSettings && __spectrogramSettings.display) || {};
                const dbLo = (dispCfg.dbMin != null) ? dispCfg.dbMin : spec.minDb;
                const dbHi = (dispCfg.dbMax != null) ? dispCfg.dbMax : spec.maxDb;
                const maxFreq = (dispCfg.maxFrequencyHz != null) ? Math.min(dispCfg.maxFrequencyHz, spec.maxFrequencyHz) : spec.maxFrequencyHz;
                const freqPerBin = spec.maxFrequencyHz / Math.max(fBins, 1);

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
                        const fHz = fIdx * freqPerBin;
                        if (fHz > maxFreq) { continue; }
                        const val = (spec.values[tIdx] && spec.values[tIdx][fIdx] !== undefined)
                            ? spec.values[tIdx][fIdx] : dbLo;
                        const range = dbHi - dbLo;
                        const norm = range !== 0
                            ? Math.max(0, Math.min(1, (val - dbLo) / range))
                            : 0;
                        const off = (py * W + px) * 4;
                        const rgb = dbToRgb(norm);
                        data[off] = rgb[0]; data[off + 1] = rgb[1]; data[off + 2] = rgb[2]; data[off + 3] = 255;
                    }
                }
                ctx.putImageData(imageData, 0, 0);
                drawSpectrogramAxes(ctx, W, H, spec, { dbLo: dbLo, dbHi: dbHi, maxFreq: maxFreq });
                drawLoopRegionOnCanvas(ctx, W, H);
                drawCursorOnCanvas(ctx, W, H);
                drawHoverLineOnCanvas(ctx, W, H);
            }

            // 軸とカラーバーは半透明オーバーレイとして全幅キャンバスの上に描画する。
            // これによりカーソル/ループ/ホバー線とマウス入力は従来通り canvas.width 基準のままで済む。
            function drawSpectrogramAxes(ctx, W, H, spec, opts) {
                const mutedColor = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
                const bgColor = getComputedStyle(document.body).getPropertyValue('--track-bg').trim() || 'rgba(0,0,0,0.55)';
                const labelW = 36;
                const cbStripW = 50;
                const o = opts || {};
                const maxHz = (o.maxFreq != null) ? o.maxFreq : spec.maxFrequencyHz;
                const dbLo = (o.dbLo != null) ? o.dbLo : spec.minDb;
                const dbHi = (o.dbHi != null) ? o.dbHi : spec.maxDb;

                ctx.save();
                ctx.fillStyle = bgColor;
                ctx.globalAlpha = 0.7;
                ctx.fillRect(0, 0, labelW, H);
                ctx.fillRect(W - cbStripW, 0, cbStripW, H);
                ctx.globalAlpha = 1;
                ctx.fillStyle = mutedColor;
                ctx.font = '9px monospace';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'top';
                ctx.fillText(formatHz(maxHz), labelW - 2, 1);
                ctx.textBaseline = 'middle';
                ctx.fillText(formatHz(maxHz / 2), labelW - 2, H / 2);
                ctx.textBaseline = 'bottom';
                ctx.fillText('0 Hz', labelW - 2, H - 1);
                ctx.save();
                ctx.translate(9, H / 2);
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('Freq', 0, 0);
                ctx.restore();

                const cbW = 10;
                const cbX = W - cbStripW + 6;
                const cbY = 2;
                const cbH = Math.max(1, H - 4);
                const grad = ctx.createImageData(cbW, cbH);
                for (let y = 0; y < cbH; y++) {
                    const norm = 1 - y / Math.max(cbH - 1, 1);
                    const rgb = dbToRgb(norm);
                    for (let x = 0; x < cbW; x++) {
                        const off = (y * cbW + x) * 4;
                        grad.data[off] = rgb[0]; grad.data[off + 1] = rgb[1]; grad.data[off + 2] = rgb[2]; grad.data[off + 3] = 255;
                    }
                }
                ctx.putImageData(grad, cbX, cbY);
                ctx.fillStyle = mutedColor;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(dbHi.toFixed(0) + ' dB', cbX + cbW + 2, cbY);
                ctx.textBaseline = 'bottom';
                ctx.fillText(dbLo.toFixed(0) + ' dB', cbX + cbW + 2, cbY + cbH);
                ctx.restore();
            }

            function formatHz(hz) {
                if (hz >= 1000) { return (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + ' kHz'; }
                return Math.round(hz) + ' Hz';
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
                            refreshSpectrumViews();
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
                            el.textContent = STR.cursorHelpKeys;
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
                    // ── スペクトルカーソル操作（マウスがスペクトル上にある間）──
                    if (spectrumHasMouse && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
                        e.preventDefault();
                        const overlayC = document.getElementById('spectrum-overlay-canvas');
                        const plotW = overlayC ? Math.max(1, overlayC.width - 36 - 8) : 800;
                        const step = e.shiftKey ? (10 / plotW) : (1 / plotW);
                        const delta = e.code === 'ArrowLeft' ? -step : step;
                        if (spectrumHoverNorm === null) { spectrumHoverNorm = 0.5; }
                        spectrumHoverNorm = Math.max(0, Math.min(1, spectrumHoverNorm + delta));
                        refreshSpectrumViews();
                        return;
                    }

                    // ── 時刻カーソル操作（波形キャンバスフォーカス時）──
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

                document.addEventListener('keyup', function(e) {
                    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                        refreshSpectrumViews();
                    }
                });

                // スペクトルカーソルイベント（オーバーレイ＋各トラック）
                (function attachSpectrumCursorEvents() {
                    function onSpectrumMove(padL, padR, canvasEl, e) {
                        const rect = canvasEl.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        const plotW = canvasEl.width - padL - padR;
                        const canvasH = canvasEl.height || 140;
                        if (plotW > 0) {
                            spectrumHoverNorm = Math.max(0, Math.min(1, (x - padL) / plotW));
                            spectrumHoverYFrac = Math.max(0, Math.min(1, y / canvasH));
                        }
                        spectrumHasMouse = true;
                        refreshSpectrumViews();
                    }
                    function onSpectrumLeave() {
                        spectrumHasMouse = false;
                        spectrumHoverNorm = null;
                        spectrumHoverYFrac = null;
                        refreshSpectrumViews();
                    }
                    const overlayCanvas = document.getElementById('spectrum-overlay-canvas');
                    if (overlayCanvas) {
                        overlayCanvas.addEventListener('mousemove', function(e) { onSpectrumMove(36, 8, overlayCanvas, e); });
                        overlayCanvas.addEventListener('mouseleave', onSpectrumLeave);
                    }
                    document.querySelectorAll('.track-spectrum-canvas').forEach(function(c) {
                        c.addEventListener('mousemove', function(e) { onSpectrumMove(32, 6, c, e); });
                        c.addEventListener('mouseleave', onSpectrumLeave);
                    });
                })();
            }

            function attachDirectorySelectionEvents() {
                const layout = document.getElementById('directory-selection-layout');
                if (!layout) { return; }

                function toggleDirectoryHeader(dirHeader) {
                    const list = dirHeader.nextElementSibling;
                    const toggle = dirHeader.querySelector('.dir-toggle');
                    if (list && list.classList && list.classList.contains('selection-tree-list')) {
                        const isCollapsed = list.style.display === 'none';
                        list.style.display = isCollapsed ? '' : 'none';
                        if (toggle) {
                            toggle.textContent = isCollapsed ? '▼' : '▶';
                        }
                        dirHeader.setAttribute('aria-expanded', isCollapsed ? 'true' : 'false');
                    }
                }

                layout.addEventListener('click', function(e) {
                    const target = e.target;
                    if (!target || typeof target.getAttribute !== 'function') { return; }

                    const dirHeader = target.closest('.selection-tree-directory');
                    if (dirHeader) {
                        toggleDirectoryHeader(dirHeader);
                        return;
                    }

                    const action = target.getAttribute('data-action');
                    if (!action) { return; }

                    if (handleSelectionAction(action)) {
                        return;
                    }
                });

                layout.addEventListener('keydown', function(e) {
                    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') { return; }
                    const target = e.target;
                    if (!target || typeof target.closest !== 'function') { return; }
                    const dirHeader = target.closest('.selection-tree-directory');
                    if (!dirHeader) { return; }
                    e.preventDefault();
                    toggleDirectoryHeader(dirHeader);
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
                if (action === 'open-file' || action === 'open-folder' || action === 'select-python-environment') {
                    handleToolbarAction(action);
                    return true;
                }
                if (action === 'toggle-directory') {
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
                    countEl.textContent = count + ' / ' + allSelectableFilePaths.length + ' ' + STR.selectionCountLabel;
                }
            }

            function syncPythonEnvironmentButton() {
                const selectionButton = document.getElementById('selection-python-environment');
                const toolbarButton = document.getElementById('toolbar-python-environment');
                const pythonCommand = pythonEnvironmentState && typeof pythonEnvironmentState.pythonCommand === 'string'
                    ? pythonEnvironmentState.pythonCommand
                    : 'python3';
                const isWarning = pythonEnvironmentState && pythonEnvironmentState.status === 'warning';
                const buttonText = 'Python: ' + pythonCommand + (isWarning ? ' ⚠' : '');
                const tooltip = pythonEnvironmentState && typeof pythonEnvironmentState.tooltip === 'string'
                    ? pythonEnvironmentState.tooltip
                    : 'Click to select Python interpreter';

                if (selectionButton) {
                    selectionButton.textContent = buttonText;
                    selectionButton.title = tooltip;
                    selectionButton.classList.toggle('is-warning', !!isWarning);
                }
                if (toolbarButton) {
                    toolbarButton.textContent = buttonText;
                    toolbarButton.title = tooltip;
                    toolbarButton.classList.toggle('is-warning', !!isWarning);
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
                } else if (action === 'select-python-environment') {
                    vscode.postMessage({ type: 'select-python-environment' });
                } else if (action === 'content-waveform') {
                    contentType = 'waveform';
                    document.querySelector('[data-action="content-waveform"]').classList.add('is-active');
                    document.querySelector('[data-action="content-spectrogram"]').classList.remove('is-active');
                    __updateSpecGearVisibility();
                    scheduleRender();
                } else if (action === 'content-spectrogram') {
                    contentType = 'spectrogram';
                    document.querySelector('[data-action="content-waveform"]').classList.remove('is-active');
                    document.querySelector('[data-action="content-spectrogram"]').classList.add('is-active');
                    __updateSpecGearVisibility();
                    scheduleRender();
                } else if (action === 'zoom-in') {
                    zoomIn();
                } else if (action === 'zoom-out') {
                    zoomOut();
                } else if (action === 'zoom-reset') {
                    zoomStart = 0;
                    zoomEnd = 1;
                    scheduleRender();
                } else if (action === 'run-recipe') {
                    vscode.postMessage({ type: 'run-recipe' });
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
                    showTooltip(e, STR.tooltipLoopResize);
                } else if (loopRegion && norm >= loopRegion.start && norm <= loopRegion.end) {
                    showTooltip(e, STR.tooltipLoopClear);
                } else {
                    showTooltip(e, STR.tooltipLoopOrShift);
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
                const hadDrag = !!dragState;
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
                if (hadDrag) { refreshSpectrumViews(); }
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

            function extractSpectrumAtCursor(result, offsetSeconds, cursorNormValue) {
                if (!result || result.error) { return null; }
                const ch = result.channels && result.channels[0];
                const spec = ch && ch.spectrogram;
                if (!spec || !spec.values || spec.timeBins <= 0 || spec.frequencyBins <= 0) { return null; }
                const dur = result.durationSeconds || 0;
                if (dur <= 0) { return null; }
                const gs = computeGlobalSpan();
                const cursorSec = gs.startSec + cursorNormValue * gs.spanSec;
                const trackLocalSec = cursorSec - offsetSeconds;
                if (trackLocalSec < 0 || trackLocalSec > dur) { return null; }
                let tIdx = Math.floor((trackLocalSec / dur) * spec.timeBins);
                if (tIdx < 0) { tIdx = 0; }
                if (tIdx >= spec.timeBins) { tIdx = spec.timeBins - 1; }
                const slice = spec.values[tIdx];
                if (!slice || slice.length === 0) { return null; }

                const displaySettings = (typeof __spectrogramSettings !== 'undefined' && __spectrogramSettings && __spectrogramSettings.display) || {};
                const minDb = displaySettings.dbMin != null ? displaySettings.dbMin : spec.minDb;
                const maxDb = displaySettings.dbMax != null ? displaySettings.dbMax : spec.maxDb;
                const requestedMaxFreq = displaySettings.maxFrequencyHz;
                let maxFrequencyHz = spec.maxFrequencyHz;
                if (requestedMaxFreq != null && Number.isFinite(requestedMaxFreq) && requestedMaxFreq > 0) {
                    maxFrequencyHz = Math.min(requestedMaxFreq, spec.maxFrequencyHz);
                }

                return {
                    values: slice,
                    frequencyBins: spec.frequencyBins,
                    originalMaxFrequencyHz: spec.maxFrequencyHz,
                    maxFrequencyHz: maxFrequencyHz,
                    minDb: minDb,
                    maxDb: maxDb,
                };
            }

            function drawSpectrumLine(ctx, W, H, slice, color, opts) {
                const fBins = slice.frequencyBins;
                const range = slice.maxDb - slice.minDb;
                if (range <= 0) { return; }
                const padL = (opts && opts.padL) || 0;
                const padR = (opts && opts.padR) || 0;
                const padT = (opts && opts.padT) || 0;
                const padB = (opts && opts.padB) || 0;
                const plotW = W - padL - padR;
                const plotH = H - padT - padB;
                ctx.strokeStyle = color;
                ctx.lineWidth = (opts && opts.lineWidth) || 1.2;
                ctx.beginPath();
                const originalMaxFreq = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
                for (let i = 0; i < fBins; i++) {
                    const fHz = (i / Math.max(fBins - 1, 1)) * originalMaxFreq;
                    if (fHz > slice.maxFrequencyHz) { break; }
                    const x = padL + (fHz / slice.maxFrequencyHz) * plotW;
                    const v = slice.values[i];
                    const norm = Math.max(0, Math.min(1, (v - slice.minDb) / range));
                    const y = padT + (1 - norm) * plotH;
                    if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
                }
                ctx.stroke();
            }

            function drawSpectrumAxes(ctx, W, H, slice, padL, padR, padT, padB) {
                const mutedColor = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
                const lineColor = getComputedStyle(document.body).getPropertyValue('--line').trim() || '#444';
                const plotW = W - padL - padR;
                const plotH = H - padT - padB;
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB);
                ctx.moveTo(padL, H - padB); ctx.lineTo(W - padR, H - padB);
                ctx.stroke();
                ctx.fillStyle = mutedColor;
                ctx.font = '9px monospace';
                ctx.textAlign = 'right';
                ctx.textBaseline = 'top';
                ctx.fillText(slice.maxDb.toFixed(0) + ' dB', padL - 2, padT);
                ctx.textBaseline = 'middle';
                ctx.fillText(((slice.maxDb + slice.minDb) / 2).toFixed(0) + ' dB', padL - 2, padT + plotH / 2);
                ctx.textBaseline = 'bottom';
                ctx.fillText(slice.minDb.toFixed(0) + ' dB', padL - 2, H - padB);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText('0 Hz', padL, H - 1);
                ctx.fillText(formatHz(slice.maxFrequencyHz / 2), padL + plotW / 2, H - 1);
                ctx.fillText(formatHz(slice.maxFrequencyHz), W - padR, H - 1);
            }

            function renderTrackSpectra() {
                state.results.forEach(function(result, i) {
                    const canvas = document.getElementById('track-spectrum-' + i);
                    if (!canvas) { return; }
                    const wrap = document.getElementById('track-spectrum-wrap-' + i);
                    if (!wrap) { return; }
                    const wrapStyle = (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function')
                        ? window.getComputedStyle(wrap)
                        : null;
                    if (wrapStyle && wrapStyle.display === 'none') { return; }
                    const w = wrap.clientWidth || 180;
                    if (canvas.width !== w) { canvas.width = w; canvas.height = 80; }
                    const ctx = canvas.getContext('2d');
                    const W = canvas.width, H = canvas.height;
                    ctx.clearRect(0, 0, W, H);
                    if (trackRuntime[i].hidden) { return; }
                    const slice = extractSpectrumAtCursor(result, trackRuntime[i].offsetSeconds, cursorNorm);
                    if (!slice) {
                        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
                        ctx.font = '9px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText(STR.canvasOutOfRange, W / 2, H / 2);
                        return;
                    }
                    const color = TRACK_COLORS[i % TRACK_COLORS.length];
                    drawSpectrumAxes(ctx, W, H, slice, 32, 6, 4, 14);
                    drawSpectrumLine(ctx, W, H, slice, color, { padL: 32, padR: 6, padT: 4, padB: 14 });
                    // スペクトル十字カーソル（縦線＋スペクトルにスナップした横線）
                    if (spectrumHoverNorm !== null) {
                        const padL2 = 32, padR2 = 6, padT2 = 4, padB2 = 14;
                        const plotW2 = W - padL2 - padR2;
                        const plotH2 = H - padT2 - padB2;
                        const curX = padL2 + spectrumHoverNorm * plotW2;
                        const origMaxF2 = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
                        const fHz2 = spectrumHoverNorm * slice.maxFrequencyHz;
                        const binF2 = (fHz2 / Math.max(origMaxF2, 1)) * Math.max(slice.frequencyBins - 1, 1);
                        const binIdx2 = Math.max(0, Math.min(slice.frequencyBins - 1, Math.round(binF2)));
                        const dbVal2 = slice.values[binIdx2];
                        const range2 = slice.maxDb - slice.minDb;
                        ctx.save();
                        ctx.lineWidth = 1;
                        ctx.setLineDash([3, 3]);
                        // 縦線
                        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
                        ctx.beginPath();
                        ctx.moveTo(curX, padT2); ctx.lineTo(curX, H - padB2);
                        ctx.stroke();
                        // 横線（スペクトル値にスナップ）
                        if (dbVal2 !== undefined && range2 > 0) {
                            const norm2 = Math.max(0, Math.min(1, (dbVal2 - slice.minDb) / range2));
                            const snapY = padT2 + (1 - norm2) * plotH2;
                            ctx.strokeStyle = color;
                            ctx.beginPath();
                            ctx.moveTo(padL2, snapY); ctx.lineTo(W - padR2, snapY);
                            ctx.stroke();
                        }
                        ctx.setLineDash([]);
                        ctx.restore();
                    }
                });
            }

            function renderOverlaySpectrum() {
                const canvas = document.getElementById('spectrum-overlay-canvas');
                if (!canvas) { return; }
                const wrap = document.getElementById('spectrum-overlay-wrap');
                const w = (wrap && wrap.clientWidth) || 800;
                if (canvas.width !== w) { canvas.width = w; canvas.height = 140; }
                const ctx = canvas.getContext('2d');
                const W = canvas.width, H = canvas.height;
                ctx.clearRect(0, 0, W, H);

                const slices = [];
                state.results.forEach(function(result, i) {
                    if (trackRuntime[i].hidden) { return; }
                    const slice = extractSpectrumAtCursor(result, trackRuntime[i].offsetSeconds, cursorNorm);
                    if (slice) { slices.push({ slice: slice, color: TRACK_COLORS[i % TRACK_COLORS.length], index: i, name: result.fileName }); }
                });

                if (slices.length === 0) {
                    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
                    ctx.font = '11px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(STR.spectrumNoData, W / 2, H / 2);
                    return;
                }

                let minDb = Infinity, maxDb = -Infinity, maxF = 0;
                slices.forEach(function(s) {
                    if (s.slice.minDb < minDb) { minDb = s.slice.minDb; }
                    if (s.slice.maxDb > maxDb) { maxDb = s.slice.maxDb; }
                    if (s.slice.maxFrequencyHz > maxF) { maxF = s.slice.maxFrequencyHz; }
                });
                const padL = 36, padR = 8, padT = 8, padB = 18;
                const sharedAxis = { values: [], frequencyBins: 1, maxFrequencyHz: maxF, minDb: minDb, maxDb: maxDb };
                drawSpectrumAxes(ctx, W, H, sharedAxis, padL, padR, padT, padB);

                const plotW = W - padL - padR;
                const plotH = H - padT - padB;
                const range = maxDb - minDb;
                slices.forEach(function(s) {
                    if (range <= 0) { return; }
                    ctx.strokeStyle = s.color;
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    const fBins = s.slice.frequencyBins;
                    const originalMaxFreq = s.slice.originalMaxFrequencyHz || s.slice.maxFrequencyHz;
                    for (let i = 0; i < fBins; i++) {
                        const fHz = (i / Math.max(fBins - 1, 1)) * originalMaxFreq;
                        if (fHz > maxF) { break; }
                        const x = padL + (fHz / maxF) * plotW;
                        const v = s.slice.values[i];
                        const norm = Math.max(0, Math.min(1, (v - minDb) / range));
                        const y = padT + (1 - norm) * plotH;
                        if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
                    }
                    ctx.stroke();
                });

                // 十字カーソル描画（最近傍スペクトルにスナップ）
                if (spectrumHoverNorm !== null) {
                    const curX = padL + spectrumHoverNorm * plotW;
                    const fHz = spectrumHoverNorm * maxF;

                    // 各スライスのカーソル周波数でのy座標とdB値を計算
                    const sliceSnaps = [];
                    slices.forEach(function(s) {
                        if (range <= 0) { return; }
                        const origMaxF = s.slice.originalMaxFrequencyHz || s.slice.maxFrequencyHz;
                        const binF = (fHz / Math.max(origMaxF, 1)) * Math.max(s.slice.frequencyBins - 1, 1);
                        const binIdx = Math.max(0, Math.min(s.slice.frequencyBins - 1, Math.round(binF)));
                        const dbVal = s.slice.values[binIdx];
                        if (dbVal === undefined) { return; }
                        const norm = Math.max(0, Math.min(1, (dbVal - minDb) / range));
                        const snapY = padT + (1 - norm) * plotH;
                        sliceSnaps.push({ s: s, dbVal: dbVal, snapY: snapY });
                    });

                    // マウスy位置に最も近いスライスを選択
                    const mouseY = spectrumHoverYFrac !== null ? spectrumHoverYFrac * H : null;
                    let nearest = null;
                    if (mouseY !== null && sliceSnaps.length > 0) {
                        let minDist = Infinity;
                        sliceSnaps.forEach(function(item) {
                            const dist = Math.abs(item.snapY - mouseY);
                            if (dist < minDist) { minDist = dist; nearest = item; }
                        });
                    } else if (sliceSnaps.length > 0) {
                        nearest = sliceSnaps[0];
                    }

                    // 最近傍スライスを太い線で再描画（ハイライト）
                    if (nearest) {
                        ctx.save();
                        ctx.strokeStyle = nearest.s.color;
                        ctx.lineWidth = 2.5;
                        ctx.beginPath();
                        const fBinsH = nearest.s.slice.frequencyBins;
                        const origMaxFH = nearest.s.slice.originalMaxFrequencyHz || nearest.s.slice.maxFrequencyHz;
                        for (let i = 0; i < fBinsH; i++) {
                            const f = (i / Math.max(fBinsH - 1, 1)) * origMaxFH;
                            if (f > maxF) { break; }
                            const x = padL + (f / maxF) * plotW;
                            const v = nearest.s.slice.values[i];
                            const n = Math.max(0, Math.min(1, (v - minDb) / range));
                            const y = padT + (1 - n) * plotH;
                            if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
                        }
                        ctx.stroke();
                        ctx.restore();
                    }

                    // 十字カーソル
                    ctx.save();
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    // 縦線（周波数軸）
                    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
                    ctx.beginPath();
                    ctx.moveTo(curX, padT); ctx.lineTo(curX, H - padB);
                    ctx.stroke();
                    // 横線（最近傍スペクトルのdB値にスナップ）
                    if (nearest) {
                        ctx.strokeStyle = nearest.s.color;
                        ctx.beginPath();
                        ctx.moveTo(padL, nearest.snapY); ctx.lineTo(W - padR, nearest.snapY);
                        ctx.stroke();
                    }
                    ctx.setLineDash([]);
                    ctx.restore();

                    // 周波数・dB 読み取り値をヘッダースパンに表示（canvas 上には描かない）
                    const readoutEl = document.getElementById('spectrum-freq-readout');
                    if (readoutEl) {
                        let txt = formatHz(fHz);
                        if (nearest) {
                            txt += '  ' + nearest.dbVal.toFixed(1) + ' dB';
                            readoutEl.style.color = nearest.s.color;
                        } else {
                            readoutEl.style.color = '';
                        }
                        readoutEl.textContent = txt;
                    }
                } else {
                    const readoutEl = document.getElementById('spectrum-freq-readout');
                    if (readoutEl) { readoutEl.textContent = ''; readoutEl.style.color = ''; }
                }
            }

            function refreshSpectrumViews() {
                renderTrackSpectra();
                renderOverlaySpectrum();
                const el = document.getElementById('spectrum-cursor-time');
                if (el) {
                    const gs = computeGlobalSpan();
                    el.textContent = '@ ' + formatTime(gs.startSec + cursorNorm * gs.spanSec);
                }
            }


            function toggleMute(idx) {
                if (idx === playbackTrackIndex) { stopPlayback(idx); }
                trackRuntime[idx].hidden = !trackRuntime[idx].hidden;
                const btn = document.querySelector('[data-action="toggle-mute"][data-track-index="' + idx + '"]');
                if (btn) { btn.classList.toggle('is-muted', trackRuntime[idx].hidden); }
                updateVisibility();
                scheduleRender();
                refreshSpectrumViews();
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
                refreshSpectrumViews();
            }

            function adjustOffset(idx, deltaSeconds) {
                trackRuntime[idx].offsetSeconds += deltaSeconds;
                updateOffsetDisplays();
                scheduleRender();
                refreshSpectrumViews();
            }

            // ── Spectrogram settings popover ──
            let __spectrogramSettings = state.spectrogramSettings || {
                auto: true,
                stft: { nFft: 1024, hopSize: 256, window: 'hann' },
                display: { dbMin: null, dbMax: null, maxFrequencyHz: null }
            };

            function __updateSpecGearVisibility() {
                const gear = document.querySelector('[data-action="spectrogram-settings"]');
                if (gear) { gear.style.display = (contentType === 'spectrogram') ? '' : 'none'; }
            }

            (function __buildSpecPopover() {
                const nfftOptions = [64,128,256,512,1024,2048,4096,8192,16384]
                    .map(function(v) { return '<option value="' + v + '">' + v + '</option>'; })
                    .join('');
                const html = ''
                    + '<div id="spec-settings-popover" hidden style="position:absolute;z-index:50;background:var(--panel);border:1px solid var(--line);padding:12px;border-radius:6px;min-width:260px;color:var(--text);font-family:var(--font-ui);">'
                    + '<label style="display:block;margin-bottom:6px"><input type="checkbox" id="spec-auto"> Auto (defaults)</label>'
                    + '<fieldset id="spec-stft-fields" style="border:1px solid var(--line);padding:6px;margin-bottom:8px">'
                    + '<legend>STFT</legend>'
                    + '<label>n_fft <select id="spec-nfft">' + nfftOptions + '</select></label><br>'
                    + '<label>hop_size <input type="number" id="spec-hop" min="1" step="1"></label><br>'
                    + '<label>window <select id="spec-window">'
                    + '<option value="hann">hann</option><option value="hamming">hamming</option>'
                    + '<option value="blackman">blackman</option><option value="boxcar">boxcar</option>'
                    + '</select></label>'
                    + '<div style="font-size:11px;color:var(--muted)">' + escHtml(STR.settingsApplyHint) + '</div>'
                    + '</fieldset>'
                    + '<fieldset style="border:1px solid var(--line);padding:6px;margin-bottom:8px">'
                    + '<legend>Display</legend>'
                    + '<label>dB min <input type="number" id="spec-dbmin" step="1" placeholder="auto"></label><br>'
                    + '<label>dB max <input type="number" id="spec-dbmax" step="1" placeholder="auto"></label><br>'
                    + '<label>max freq Hz <input type="number" id="spec-maxfreq" min="1" step="1" placeholder="Nyquist"></label>'
                    + '</fieldset>'
                    + '<div style="display:flex;gap:6px;justify-content:flex-end">'
                    + '<button class="tb-btn" id="spec-reset">Reset</button>'
                    + '<button class="tb-btn" id="spec-apply">Apply</button>'
                    + '</div>'
                    + '</div>';
                document.body.insertAdjacentHTML('beforeend', html);
            })();

            const __specPopover = document.getElementById('spec-settings-popover');

            function __syncSpecFormFromState() {
                document.getElementById('spec-auto').checked = !!__spectrogramSettings.auto;
                document.getElementById('spec-nfft').value = String(__spectrogramSettings.stft.nFft);
                document.getElementById('spec-hop').value = String(__spectrogramSettings.stft.hopSize);
                document.getElementById('spec-window').value = __spectrogramSettings.stft.window;
                document.getElementById('spec-dbmin').value = __spectrogramSettings.display.dbMin == null ? '' : __spectrogramSettings.display.dbMin;
                document.getElementById('spec-dbmax').value = __spectrogramSettings.display.dbMax == null ? '' : __spectrogramSettings.display.dbMax;
                document.getElementById('spec-maxfreq').value = __spectrogramSettings.display.maxFrequencyHz == null ? '' : __spectrogramSettings.display.maxFrequencyHz;
                __applySpecAutoState();
            }

            function __applySpecAutoState() {
                const auto = document.getElementById('spec-auto').checked;
                document.getElementById('spec-stft-fields').disabled = auto;
            }

            function __readDisplayFromForm() {
                function n(id) {
                    const v = document.getElementById(id).value;
                    return v === '' ? null : Number(v);
                }
                return { dbMin: n('spec-dbmin'), dbMax: n('spec-dbmax'), maxFrequencyHz: n('spec-maxfreq') };
            }

            function __openSpecPopover() {
                const btn = document.querySelector('[data-action="spectrogram-settings"]');
                if (!btn || !__specPopover) { return; }
                const rect = btn.getBoundingClientRect();
                __specPopover.style.top = (rect.bottom + 6) + 'px';
                __specPopover.style.left = Math.max(8, rect.right - 280) + 'px';
                __specPopover.hidden = false;
                __syncSpecFormFromState();
            }

            function __closeSpecPopover() { if (__specPopover) { __specPopover.hidden = true; } }

            document.getElementById('spec-auto').addEventListener('change', __applySpecAutoState);

            ['spec-dbmin','spec-dbmax','spec-maxfreq'].forEach(function(id) {
                document.getElementById(id).addEventListener('change', function() {
                    __spectrogramSettings.display = __readDisplayFromForm();
                    vscode.postMessage({ type: 'update-spectrogram-settings', settings: __spectrogramSettings });
                    scheduleRender();
                    requestAnimationFrame(function() { publishTestSnapshot(); });
                });
            });

            document.getElementById('spec-reset').addEventListener('click', function() {
                __spectrogramSettings = { auto: true, stft: { nFft: 1024, hopSize: 256, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } };
                __syncSpecFormFromState();
                vscode.postMessage({ type: 'update-spectrogram-settings', settings: __spectrogramSettings });
                scheduleRender();
            });

            document.getElementById('spec-apply').addEventListener('click', function() {
                __spectrogramSettings = {
                    auto: document.getElementById('spec-auto').checked,
                    stft: {
                        nFft: Number(document.getElementById('spec-nfft').value),
                        hopSize: Number(document.getElementById('spec-hop').value),
                        window: document.getElementById('spec-window').value
                    },
                    display: __readDisplayFromForm()
                };
                __setReanalyzeBusy(true, STR.reanalyzingStft);
                vscode.postMessage({ type: 'request-reanalyze', settings: __spectrogramSettings });
                __closeSpecPopover();
            });

            // 再解析中のオーバーレイ
            (function __buildReanalyzeOverlay() {
                document.body.insertAdjacentHTML('beforeend',
                    '<div id="reanalyze-overlay" hidden style="position:fixed;top:0;left:0;right:0;z-index:60;background:var(--panel);color:var(--text);'
                    + 'padding:8px 14px;border-bottom:1px solid var(--line);font-family:var(--font-ui);font-size:12px;'
                    + 'display:flex;align-items:center;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,0.3)">'
                    + '<span class="spinner" style="width:12px;height:12px;border:2px solid var(--muted);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></span>'
                    + '<span id="reanalyze-overlay-msg">' + escHtml(STR.reanalyzingDefault) + '</span>'
                    + '</div>'
                    + '<style>@keyframes spin { to { transform: rotate(360deg); } }</style>');
            })();

            function __setReanalyzeBusy(busy, msg) {
                const overlay = document.getElementById('reanalyze-overlay');
                if (!overlay) { return; }
                if (busy) {
                    document.getElementById('reanalyze-overlay-msg').textContent = msg || STR.reanalyzingDefault;
                    overlay.hidden = false;
                } else {
                    overlay.hidden = true;
                }
                const applyBtn = document.getElementById('spec-apply');
                if (applyBtn) { applyBtn.disabled = !!busy; }
            }

            document.addEventListener('click', function(ev) {
                const target = ev.target;
                const btn = target && target.closest ? target.closest('[data-action="spectrogram-settings"]') : null;
                if (btn) {
                    ev.stopPropagation();
                    if (__specPopover.hidden) { __openSpecPopover(); } else { __closeSpecPopover(); }
                    return;
                }
                if (__specPopover && !__specPopover.hidden && !__specPopover.contains(target)) { __closeSpecPopover(); }
            });

            document.addEventListener('keydown', function(ev) { if (ev.key === 'Escape') { __closeSpecPopover(); } });

            window.addEventListener('message', function(event) {
                const msg = event.data;
                if (!msg) { return; }
                if (msg.type === 'reanalyze-start') {
                    const cnt = typeof msg.count === 'number' ? msg.count : 0;
                    __setReanalyzeBusy(true, STR.reanalyzingFiles.replace('{count}', cnt));
                    return;
                }
                if (msg.type === 'reanalyze-end') {
                    __setReanalyzeBusy(false);
                    return;
                }
                if (msg.type === 'analysis-update' && Array.isArray(msg.results)) {
                    __setReanalyzeBusy(false);
                    state.results = msg.results.map(function(r, i) {
                        const old = state.results[i];
                        return Object.assign({}, r, { audioSource: old ? old.audioSource : '' });
                    });
                    scheduleRender();
                    refreshSpectrumViews();
                    requestAnimationFrame(function() { publishTestSnapshot(); });
                    return;
                }
            });

            __updateSpecGearVisibility();
        })();
        `;
}
