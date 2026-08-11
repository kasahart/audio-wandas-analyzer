import { buildSelectionTree as buildSelectionTreeFromPaths } from './directorySelection';
import { eventTarget } from './domAdapter';
import { HostMessenger } from './hostMessaging';
import {
    createTrackTimeMapping,
    globalNormFromTrackTime as mapGlobalNormFromTrackTime,
    trackTimeFromGlobalNorm as mapTrackTimeFromGlobalNorm,
} from './playback';
import { parseBoundedInteger, positionPopover } from './settingsPopover';
import { SHORTCUT_ROWS } from './shortcuts';
import {
    hoverNormForFrequency as mapHoverNormForFrequency,
    spectrumBinAtFrequency as findSpectrumBinAtFrequency,
    zoomSpectrumRange,
} from './spectrumRuntime';
import { normalizeRuntimeState, PersistedStateStore } from './stateStore';
import { ComparisonTestBridge } from './testBridge';
import { TrackStore } from './trackStore';
import {
    amplitudeNormToCanvasY as mapAmplitudeNormToCanvasY,
    canvasYToAmplitudeNorm as mapCanvasYToAmplitudeNorm,
    zoomNormalizedRange,
} from './waveformInteraction';
import type { ChannelSummary, SpectrogramDisplaySettings, SpectrogramData, WaveformEnvelope, } from '../../shared/analysis/analysisTypes';
import type { CanvasSyncOptions, ComparisonBootstrap, ComparisonTrackState, DragPoint, LoopRegion, PersistedWebviewState, RectZoomSelection, RuntimeElement, SelectionTreeNode, SpectrumSeries, SpectrumSlice, SpectrumSnap, TestAction, TrackFileView, TrackId, TrackRuntimeState, WaveformCoverage, WaveformDragState, WaveformDrawOptions, WaveformRangeCache, } from './types';
export function startComparisonRuntime(bootstrap: ComparisonBootstrap): void {
    const { host: vscode, state: injectedState, strings: STR, window, document } = bootstrap;
    const state = normalizeRuntimeState(injectedState);
    const messaging = new HostMessenger(vscode, window);
    const testBridge = new ComparisonTestBridge(window, messaging);
    const requestAnimationFrame = window.requestAnimationFrame.bind(window);
    const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const setTimeout = (handler: TimerHandler, timeout?: number) => window.setTimeout(handler, timeout);
    const clearTimeout = (timeoutId: number) => window.clearTimeout(timeoutId);
    const performance = window.performance;
    const navigator = window.navigator;
    const ResizeObserver = window.ResizeObserver;
    const getComputedStyle = window.getComputedStyle.bind(window);
    const isSelectionMode = state.mode === 'directory-selection';
    const selectedFilePaths: string[] = [];
    const selectedFilePathSet = new Set<string>();
    if (Array.isArray(state.selectedFilePaths)) {
        state.selectedFilePaths.forEach(function (filePath: string) {
            if (typeof filePath === 'string') {
                addSelectedFilePath(filePath);
            }
        });
    }
    const allSelectableFilePaths = Array.isArray(state.allFilePaths) ? state.allFilePaths.slice() : [];
    const persistedStore = new PersistedStateStore(vscode);
    var persistedWebviewState = persistedStore.snapshot;
    function persistWebviewState(patch: Partial<PersistedWebviewState>): void {
        persistedStore.update(patch);
        persistedWebviewState = persistedStore.snapshot;
    }
    var currentTreeFilterRootPath = state.rootPath || '';
    // ディレクトリ折りたたみ状態を保持 (current rootPath 内の relativePath → expanded: boolean)
    // webview.html 再代入後も vscode.getState() で復元する
    var directoryCollapseState = persistedWebviewState.directoryCollapseRootPath === currentTreeFilterRootPath
        ? (persistedWebviewState.directoryCollapseState || {})
        : {};
    var treeFilterQuery = persistedWebviewState.treeFilterRootPath === currentTreeFilterRootPath
        && typeof persistedWebviewState.treeFilterQuery === 'string'
        ? persistedWebviewState.treeFilterQuery
        : '';
    // ─── ファイルパス一覧からディレクトリツリーを webview 側で組み立てる (#91) ───
    // __selectionDirMap: relativePath → ディレクトリノード（レイジーレンダリング用）
    const selectionTree = buildSelectionTreeFromPaths(state.rootPath, allSelectableFilePaths);
    var __selectionDirMap = selectionTree.directories;
    var __directoryTree = isSelectionMode ? selectionTree.roots : [];
    let selectionMessageSeq = 0;
    let pythonEnvironmentState = state.pythonEnvironmentState || {
        pythonCommand: 'python3',
        status: 'normal',
        tooltip: 'Click to select Python environment',
    };
    const AXIS_W = 64;
    const SPECTROGRAM_COLORBAR_WIDTH = 50;
    const TRACK_HEIGHT_DEFAULT = 80;
    const TRACK_HEIGHT_MIN = TRACK_HEIGHT_DEFAULT;
    const TRACK_HEIGHT_MAX = 220;
    const TRACK_HEIGHT_STEP = 16;
    const SPECTRUM_HEIGHT_DEFAULT = 140;
    const SPECTRUM_HEIGHT_MIN = 80;
    const SPECTRUM_HEIGHT_MAX = 320;
    const SPECTRUM_HEIGHT_STEP = 20;
    const TRACK_COLORS = ['#4ec994', '#ff8c4a', '#4a9eff', '#e8637a', '#c084fc',
        '#f0c040', '#40b0d0', '#d09060', '#80c080', '#a0a0ff'];
    function announce(msg: string): void {
        var el = document.getElementById('a11y-announce');
        if (!el) {
            return;
        }
        el.textContent = '';
        if (testBridge.state !== undefined) {
            // test environment: set synchronously so Playwright can observe it
            el.textContent = msg;
        }
        else {
            requestAnimationFrame(function () { el.textContent = msg; });
        }
    }
    function hexToRgba(hex: string, alpha: number) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
    // ── Runtime state ──
    let rafPending = false;
    const canvasWidthCache: Record<string, string> = {};
    let playbackEl: RuntimeElement | null = null;
    let playbackRafId: number | null = null;
    let playbackTrackId: TrackId | null = null;
    let followCursor = false;
    const SPECTRUM_PLAYBACK_FRAME_MS = 1000 / 15;
    let spectrumRafPending = false;
    let spectrumTimerId: number | null = null;
    let lastSpectrumPaintAt = 0;
    let spectrumAllowsSliceRequests = true;
    let spectrumCursorNorm = 0;
    let attachRebuiltTrackEvents: () => void = () => undefined;
    function scheduleRender() {
        if (rafPending) {
            return;
        }
        rafPending = true;
        requestAnimationFrame(function () { rafPending = false; renderAll(); });
    }
    function syncHeightInputs() {
        const trackInput = document.querySelector('[data-action="track-height-input"]');
        if (trackInput) {
            trackInput.value = String(trackHeight);
        }
        const spectrumInput = document.querySelector('[data-action="spectrum-height-input"]');
        if (spectrumInput) {
            spectrumInput.value = String(spectrumOverlayHeight);
        }
    }
    function updateUiSmokeSpectrumState() {
        const uiSmokeState = testBridge.state;
        if (!uiSmokeState) {
            return false;
        }
        uiSmokeState.spectrumZoom = {
            specFreqStart: specFreqStart,
            specFreqEnd: specFreqEnd,
            trackHeight: trackHeight,
            spectrumOverlayHeight: spectrumOverlayHeight,
            specDbMin: specDbMin,
            specDbMax: specDbMax,
        };
        return true;
    }
    function updateUiSmokeWaveformState() {
        const uiSmokeState = testBridge.state;
        if (!uiSmokeState) {
            return;
        }
        uiSmokeState.zoomStart = zoomStart;
        uiSmokeState.zoomEnd = zoomEnd;
        uiSmokeState.amplitudeZoomMinNorm = amplitudeZoomMinNorm;
        uiSmokeState.amplitudeZoomMaxNorm = amplitudeZoomMaxNorm;
        uiSmokeState.rectZoomSelection = rectZoomSelection ? Object.assign({}, rectZoomSelection) : null;
    }
    function spectrumNow() {
        return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
    function runSpectrumRefresh(allowSliceRequests: boolean, advanceCursor: boolean) {
        updateUiSmokeSpectrumState();
        if (advanceCursor !== false) {
            spectrumCursorNorm = cursorNorm;
        }
        spectrumRafPending = false;
        if (spectrumTimerId !== null) {
            clearTimeout(spectrumTimerId);
            spectrumTimerId = null;
        }
        const prevAllows = spectrumAllowsSliceRequests;
        spectrumAllowsSliceRequests = allowSliceRequests !== false;
        try {
            refreshSpectrumViews();
            lastSpectrumPaintAt = spectrumNow();
        }
        finally {
            spectrumAllowsSliceRequests = prevAllows;
        }
    }
    function scheduleSpectrumFrame(allowSliceRequests: boolean, advanceCursor: boolean) {
        if (spectrumRafPending) {
            return;
        }
        spectrumRafPending = true;
        requestAnimationFrame(function () { runSpectrumRefresh(allowSliceRequests, advanceCursor); });
    }
    function flushSpectrumRefresh() {
        runSpectrumRefresh(true, true);
    }
    function scheduleSpectrumRefresh(mode: string) {
        updateUiSmokeSpectrumState();
        const kind = mode || 'interactive';
        if (kind === 'immediate') {
            flushSpectrumRefresh();
            return;
        }
        if (kind === 'playback') {
            const elapsed = spectrumNow() - lastSpectrumPaintAt;
            if (elapsed >= SPECTRUM_PLAYBACK_FRAME_MS) {
                if (spectrumTimerId !== null) {
                    clearTimeout(spectrumTimerId);
                    spectrumTimerId = null;
                }
                scheduleSpectrumFrame(true, true);
                return;
            }
            if (spectrumTimerId !== null) {
                return;
            }
            spectrumTimerId = setTimeout(function () {
                spectrumTimerId = null;
                scheduleSpectrumFrame(true, true);
            }, Math.max(0, SPECTRUM_PLAYBACK_FRAME_MS - elapsed));
            return;
        }
        if (spectrumTimerId !== null) {
            clearTimeout(spectrumTimerId);
            spectrumTimerId = null;
        }
        scheduleSpectrumFrame(kind !== 'hover', true);
    }
    let contentType: 'waveform' | 'spectrogram' = persistedWebviewState.contentType === 'spectrogram' ? 'spectrogram' : 'waveform';
    let zoomStart = 0;
    let zoomEnd = 1;
    let cursorNorm = 0; // グローバルカーソル（常に number）
    let hoverNorm: number | null = null; // ホバープレビュー位置（null = 非表示）
    let spectrumHoverNorm: number | null = null; // スペクトルカーソル（正規化周波数 0..1、null = 非表示）
    let spectrumHoverYFrac: number | null = null; // スペクトルカーソルy（canvas高さに対する比率 0..1）
    let spectrumHoverTrackId: TrackId | 'overlay' | null = null;
    let spectrumHoverChannelIndex: number | null = null; // number = per-track channel, null = overlay/none
    let spectrumHasMouse = false; // マウスがスペクトルキャンバス上にある間 true
    let trackHeight = TRACK_HEIGHT_DEFAULT;
    let spectrumOverlayHeight = SPECTRUM_HEIGHT_DEFAULT;
    // ── スペクトルズーム ───────────────────────────────────
    let specFreqStart = 0; // 0..1 正規化周波数（0=0Hz, 1=maxFreq）
    let specFreqEnd = 1;
    let specDbMin: number | null = null; // null = データ自動, number = dB 上書き
    let specDbMax: number | null = null;
    let _lastVisDbMin: number | null = null; // 前回レンダリング時の visDbMin キャッシュ
    let _lastVisDbMax: number | null = null;
    let _lastSpectrumMaxF = 0; // overlay の最大周波数(Hz) キャッシュ（freq popover 用）
    let specDragAnchor: DragPoint | null = null;
    let specDragCurrent: DragPoint | null = null;
    // ── 波形モード ────────────────────────────────────────
    let waveformMode: 'loop' | 'rect-zoom' = 'loop';
    let amplitudeZoomMinNorm = -1;
    let amplitudeZoomMaxNorm = 1;
    let rectZoomSelection: RectZoomSelection | null = null;
    let playbackStartNorm = 0; // 再生開始位置の記憶
    let dragState: WaveformDragState | null = null;
    let loopRegion: LoopRegion | null = null;
    let nextDefaultTrackColorIndex = 0;
    function createTrackRuntime(): TrackRuntimeState {
        const defaultColor = TRACK_COLORS[nextDefaultTrackColorIndex % TRACK_COLORS.length];
        nextDefaultTrackColorIndex += 1;
        return { offsetSeconds: 0, hidden: false, color: null, defaultColor: defaultColor };
    }
    const trackStore = new TrackStore(state.results, createTrackRuntime);
    window.__AWA_ACTIVE_TRACKS__ = function () {
        return trackStore.activeIds().map(function (trackId) {
            const record = trackStore.require(trackId);
            return { trackIndex: record.protocolIndex, result: record.result };
        });
    };
    const runtimeSessionId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    let analysisGeneration = 0;
    function createAnalysisId(): string {
        analysisGeneration += 1;
        return 'analysis-' + runtimeSessionId + '-' + analysisGeneration.toString(36);
    }
    let analysisId = createAnalysisId();
    function trackIdAtIndex(index: number): TrackId | null {
        return trackStore.idAtProtocolIndex(index);
    }
    function trackIdAtProtocolBoundary(index: number, messageType: string): TrackId | null {
        const trackId = trackIdAtIndex(index);
        if (!trackId) {
            console.warn('Rejected ' + messageType + ' with invalid trackIndex ' + index);
        }
        return trackId;
    }
    function trackRecordAtIndex(index: number) {
        const trackId = trackIdAtIndex(index);
        return trackId ? trackStore.get(trackId) : undefined;
    }
    function trackRuntimeAt(index: number): TrackRuntimeState {
        const record = trackRecordAtIndex(index);
        if (!record) {
            throw new Error('Invalid track protocol index: ' + index);
        }
        return record.runtime;
    }
    function trackIndexForId(trackId: TrackId): number {
        const index = trackStore.protocolIndexForId(trackId);
        if (index === null) {
            throw new Error('Inactive TrackId: ' + trackId);
        }
        return index;
    }
    function trackIdFromElement(element: RuntimeElement): TrackId | null {
        const rawId = element.getAttribute('data-track-id');
        if (!rawId) {
            return null;
        }
        const trackId = rawId as TrackId;
        return trackStore.protocolIndexForId(trackId) === null ? null : trackId;
    }
    function trackIndexFromElement(element: RuntimeElement): number | null {
        const trackId = trackIdFromElement(element);
        return trackId ? trackStore.protocolIndexForId(trackId) : null;
    }
    let overlaySpectrumPainted = false;
    let lazyRequestCounter = 0;
    function nextLazyRequestId(prefix: string, i: number | string): string {
        lazyRequestCounter += 1;
        return prefix + '-' + i + '-' + Date.now() + '-' + lazyRequestCounter.toString(36);
    }
    function currentSettingsSignature() {
        return currentSpectrumDataSignature();
    }
    function currentSpectrumDataSignature() {
        try {
            const settings = __spectrogramSettings;
            return JSON.stringify({ auto: settings.auto, stft: settings.stft });
        }
        catch (e) {
            return 'spectrum-data-settings';
        }
    }
    function channelsForResult(result: ComparisonTrackState) {
        return result && Array.isArray(result.channels) ? result.channels : [];
    }
    function channelLabel(result: ComparisonTrackState, channelIndex: number) {
        const channels = channelsForResult(result);
        const count = Number.isFinite(result && result.channelCount) ? result.channelCount : channels.length;
        const channelNumber = channelIndex + 1;
        const base = 'Channel ' + channelNumber + (count > 1 ? ' / ' + count : '');
        const ch = channels[channelIndex];
        return ch && ch.label && ch.label !== ('Channel ' + channelNumber) ? base + ' (' + ch.label + ')' : base;
    }
    function spectrumReadoutTrackLabel(result: ComparisonTrackState, channelIndex: number) {
        const channels = channelsForResult(result);
        const name = result && result.fileName ? result.fileName : '';
        return channels.length > 1 ? name + ' ' + channelLabel(result, channelIndex) : name;
    }
    function spectrumCursorReadoutText(label: string, freqHz: number, dbVal: number, unit: string) {
        return label + ' ' + formatReadoutHz(freqHz) + (dbVal !== undefined ? '  ' + dbVal.toFixed(1) + ' ' + unit : '');
    }
    function displayedChannelIndex(result: ComparisonTrackState, trackIndex: number) {
        return channelsForResult(result).length > 0 ? 0 : -1;
    }
    function displayedChannel(result: ComparisonTrackState, trackIndex: number) {
        const channels = channelsForResult(result);
        return channels.length > 0 ? channels[0] : null;
    }
    function displayedChannelLabel(result: ComparisonTrackState, trackIndex: number) {
        return channelLabel(result, 0);
    }
    function channelCanvasSuffix(channelIndex: number) {
        return channelIndex === 0 ? '' : '-' + channelIndex;
    }
    function trackCanvasId(trackIndex: number, channelIndex: number) {
        return 'track-canvas-' + trackIndex + channelCanvasSuffix(channelIndex);
    }
    function trackAxisCanvasId(trackIndex: number, channelIndex: number) {
        return 'track-axis-canvas-' + trackIndex + channelCanvasSuffix(channelIndex);
    }
    function trackSpectrumCanvasId(trackIndex: number, channelIndex: number) {
        return 'track-spectrum-' + trackIndex + channelCanvasSuffix(channelIndex);
    }
    function channelDb(value: number): string {
        return (20 * Math.log10(Math.max(value, 1e-9))).toFixed(1) + ' dB';
    }
    function channelDominantFrequencyLabel(channel: ChannelSummary) {
        return channel && channel.dominantFrequencies && channel.dominantFrequencies[0]
            ? Math.round(channel.dominantFrequencies[0].frequencyHz) + ' Hz'
            : '—';
    }
    function trackLocalCursorNorm(i: number, cursorNormValue: number) {
        const result = state.results[i];
        if (!result || result.error) {
            return null;
        }
        const dur = result.durationSeconds || 0;
        if (dur <= 0) {
            return null;
        }
        const gs = computeGlobalSpan();
        const cursorSec = gs.startSec + cursorNormValue * gs.spanSec;
        const local = (cursorSec - trackRuntimeAt(i).offsetSeconds) / dur;
        if (local < 0 || local > 1) {
            return null;
        }
        return local;
    }
    function requestTrackDetail(i: number) {
        const result = state.results[i];
        const record = trackRecordAtIndex(i);
        if (!record || !result || result.error || record.runtime.hidden) {
            return;
        }
        const channels = channelsForResult(result);
        if (channels.length > 0 && channels.every(function (ch: ChannelSummary) { return ch && ch.spectrogram; })) {
            return;
        }
        const settingsSignature = currentSettingsSignature();
        const pending = record.detailRequest;
        if (pending && pending.settingsSignature === settingsSignature) {
            return;
        }
        const requestId = nextLazyRequestId('detail', i);
        record.detailRequest = { trackId: record.id, requestId: requestId, analysisId: analysisId, settingsSignature: settingsSignature };
        messaging.post({
            type: 'request-track-detail',
            requestId: requestId,
            analysisId: analysisId,
            settingsSignature: settingsSignature,
            trackIndex: i,
            filePath: result.filePath,
        });
    }
    function releaseTrackDetail(i: number) {
        const result = state.results[i];
        const record = trackRecordAtIndex(i);
        if (!result || !record) {
            return;
        }
        const hadPendingDetail = !!record.detailRequest;
        let hadSpectrogram = false;
        if (result.channels) {
            result.channels.forEach(function (channel: ChannelSummary) {
                if (channel && channel.spectrogram) {
                    hadSpectrogram = true;
                    channel.spectrogram = null;
                }
            });
        }
        record.detailRequest = null;
        record.spectrumSliceRequests.clear();
        record.spectrumSliceCache.clear();
        record.spectrumPainted.clear();
        overlaySpectrumPainted = false;
        if (hadSpectrogram || hadPendingDetail) {
            messaging.post({
                type: 'release-track-detail',
                analysisId: analysisId,
                settingsSignature: currentSettingsSignature(),
                trackIndex: i,
                filePath: result.filePath,
            });
        }
    }
    function spectrumCursorTolerance(result: ComparisonTrackState) {
        const dur = result && result.durationSeconds ? result.durationSeconds : 0;
        if (dur <= 0) {
            return 0.002;
        }
        return Math.min(0.002, 0.02 / dur);
    }
    function isSpectrumSliceRequestPendingForCursor(i: number, cursorNormValue: number, channelIndex: number) {
        const record = trackRecordAtIndex(i);
        const pending = record?.spectrumSliceRequests.get(channelIndex);
        if (!pending) {
            return false;
        }
        const result = state.results[i];
        const localNorm = trackLocalCursorNorm(i, cursorNormValue);
        if (localNorm === null) {
            return false;
        }
        return pending.settingsSignature === currentSpectrumDataSignature()
            && pending.channelIndex === channelIndex
            && Math.abs((pending.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result);
    }
    function requestSpectrumSlice(i: number, cursorNormValue: number, channelIndex: number) {
        if (!spectrumAllowsSliceRequests) {
            return;
        }
        const result = state.results[i];
        const record = trackRecordAtIndex(i);
        if (!record || !result || result.error || record.runtime.hidden) {
            return;
        }
        const localNorm = trackLocalCursorNorm(i, cursorNormValue);
        if (localNorm === null) {
            return;
        }
        const channels = channelsForResult(result);
        const ch = channels[channelIndex];
        if (!ch || ch.spectrogram) {
            return;
        }
        const settingsSignature = currentSpectrumDataSignature();
        const cached = record.spectrumSliceCache.get(channelIndex);
        if (cached && cached.settingsSignature === settingsSignature && cached.channelIndex === channelIndex && Math.abs((cached.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result)) {
            return;
        }
        const pending = record.spectrumSliceRequests.get(channelIndex);
        if (pending && pending.settingsSignature === settingsSignature && pending.channelIndex === channelIndex && Math.abs((pending.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result)) {
            return;
        }
        const requestId = nextLazyRequestId('slice', i + '-' + channelIndex);
        record.spectrumSliceRequests.set(channelIndex, { trackId: record.id, requestId: requestId, analysisId: analysisId, settingsSignature: settingsSignature, cursorNorm: localNorm, channelIndex: channelIndex });
        messaging.post({
            type: 'request-spectrum-slice',
            requestId: requestId,
            analysisId: analysisId,
            settingsSignature: settingsSignature,
            trackIndex: i,
            filePath: result.filePath,
            cursorNorm: localNorm,
            channelIndex: channelIndex,
        });
    }
    function applySpectrumDisplaySettings(slice: SpectrumSlice) {
        const displaySettings = __spectrogramSettings.display;
        const minDb = displaySettings.dbMin != null ? displaySettings.dbMin : slice.minDb;
        const maxDb = displaySettings.dbMax != null ? displaySettings.dbMax : slice.maxDb;
        const requestedMaxFreq = displaySettings.maxFrequencyHz;
        let maxFrequencyHz = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
        if (requestedMaxFreq != null && Number.isFinite(requestedMaxFreq) && requestedMaxFreq > 0) {
            maxFrequencyHz = Math.min(requestedMaxFreq, maxFrequencyHz);
        }
        return Object.assign({}, slice, {
            originalMaxFrequencyHz: slice.originalMaxFrequencyHz || slice.maxFrequencyHz,
            maxFrequencyHz: maxFrequencyHz,
            minDb: minDb,
            maxDb: maxDb,
        });
    }
    function trackColor(i: number) {
        const runtime = trackRuntimeAt(i);
        return (runtime && runtime.color) || (runtime && runtime.defaultColor) || TRACK_COLORS[i % TRACK_COLORS.length];
    }
    function showTooltip(e: MouseEvent, text: string): void {
        const el = document.getElementById('canvas-tooltip');
        if (!el) {
            return;
        }
        el.textContent = text;
        el.style.display = 'block';
        el.style.left = (e.clientX + 14) + 'px';
        el.style.top = (e.clientY + 14) + 'px';
    }
    function hideTooltip() {
        const el = document.getElementById('canvas-tooltip');
        if (el) {
            el.style.display = 'none';
        }
    }
    function computeGlobalSpan() {
        let startSec = Infinity, endSec = -Infinity;
        trackStore.activeIds().forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            if (record.runtime.hidden || result.error) {
                return;
            }
            const off = record.runtime.offsetSeconds;
            const dur = result.durationSeconds || 0;
            if (off < startSec) {
                startSec = off;
            }
            if (off + dur > endSec) {
                endSec = off + dur;
            }
        });
        if (!isFinite(startSec)) {
            startSec = 0;
        }
        if (!isFinite(endSec) || endSec <= startSec) {
            endSec = startSec + 1;
        }
        return { startSec, endSec, spanSec: endSec - startSec };
    }
    // ── On-demand range cache ──
    const OVERVIEW_PTS = 1200;
    let rangeRequestTimer: number | null = null;
    // Receive high-res range data from Extension Host
    messaging.onMessage(function (msg) {
        if (!msg || msg.type !== 'waveform-range-result') {
            return;
        }
        const i = msg.trackIndex;
        const trackId = trackIdAtProtocolBoundary(i, msg.type);
        const record = trackId ? trackStore.get(trackId) : undefined;
        if (!trackId || !record) {
            return;
        }
        if (record.pendingRangeRequest !== msg.requestId) {
            return;
        } // stale
        record.pendingRangeRequest = null;
        record.rangeCache = { startNorm: msg.startNorm, endNorm: msg.endNorm, channels: msg.channels };
        renderAll();
    });
    messaging.onMessage(function (msg) {
        if (!msg || (msg.type !== 'track-detail-result' && msg.type !== 'track-detail-error')) {
            return;
        }
        const i = msg.trackIndex;
        const trackId = trackIdAtProtocolBoundary(i, msg.type);
        const record = trackId ? trackStore.get(trackId) : undefined;
        if (!trackId || !record) {
            return;
        }
        const pending = record.detailRequest;
        if (!pending || pending.trackId !== trackId || pending.requestId !== msg.requestId || pending.analysisId !== msg.analysisId || pending.settingsSignature !== msg.settingsSignature || pending.channelIndex !== msg.channelIndex) {
            return;
        }
        record.detailRequest = null;
        if (msg.type === 'track-detail-error') {
            return;
        }
        if (state.results[i] && state.results[i].filePath === msg.filePath && Array.isArray(msg.channels)) {
            msg.channels.forEach(function (channel: ChannelSummary, channelIndex: number) {
                if (!state.results[i].channels[channelIndex]) {
                    return;
                }
                if (channel && channel.spectrogram) {
                    state.results[i].channels[channelIndex].spectrogram = channel.spectrogram;
                }
            });
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
            requestAnimationFrame(function () { publishTestSnapshot(); });
        }
    });
    messaging.onMessage(function (msg) {
        if (!msg || (msg.type !== 'spectrum-slice-result' && msg.type !== 'spectrum-slice-error')) {
            return;
        }
        const i = msg.trackIndex;
        const trackId = trackIdAtProtocolBoundary(i, msg.type);
        const record = trackId ? trackStore.get(trackId) : undefined;
        if (!trackId || !record) {
            return;
        }
        const channelIndex = Number.isInteger(msg.channelIndex) ? msg.channelIndex : 0;
        const pending = record.spectrumSliceRequests.get(channelIndex);
        if (!pending || pending.trackId !== trackId || pending.requestId !== msg.requestId || pending.analysisId !== msg.analysisId || pending.settingsSignature !== msg.settingsSignature || pending.channelIndex !== channelIndex) {
            return;
        }
        record.spectrumSliceRequests.delete(channelIndex);
        if (msg.type === 'spectrum-slice-error') {
            runSpectrumRefresh(false, false);
            requestAnimationFrame(function () { publishTestSnapshot(); });
            return;
        }
        record.spectrumSliceCache.set(channelIndex, {
            settingsSignature: msg.settingsSignature,
            cursorNorm: pending.cursorNorm,
            channelIndex: pending.channelIndex,
            values: msg.values,
            frequencyBins: msg.frequencyBins,
            originalMaxFrequencyHz: msg.maxFrequencyHz,
            maxFrequencyHz: msg.maxFrequencyHz,
            minDb: msg.minDb,
            maxDb: msg.maxDb,
            unit: msg.unit,
            axisLabel: msg.axisLabel,
        });
        runSpectrumRefresh(false, false);
        requestAnimationFrame(function () { publishTestSnapshot(); });
    });
    messaging.onMessage(function (msg) {
        if (!msg || msg.type !== 'python-environment-state') {
            return;
        }
        pythonEnvironmentState = {
            pythonCommand: typeof msg.pythonCommand === 'string' ? msg.pythonCommand : 'python3',
            status: msg.status === 'warning' ? 'warning' : 'normal',
            tooltip: typeof msg.tooltip === 'string' ? msg.tooltip : 'Click to select Python environment',
        };
        syncPythonEnvironmentButton();
    });
    testBridge.onActions(function (msg) {
        if (msg.inputValues && typeof msg.inputValues === 'object') {
            const inputValues = msg.inputValues;
            Object.keys(inputValues).forEach(function (action: string) {
                applyHeightInput(action, inputValues[action]);
            });
        }
        try {
            if (Array.isArray(msg.actions)) {
                msg.actions.forEach(function (entry) {
                    handleTestAction(entry);
                });
            }
        }
        finally {
            publishTestSnapshotSafe(msg.actionId);
            requestAnimationFrame(function () {
                publishTestSnapshotSafe(msg.actionId);
            });
        }
    });
    function handleTestAction(entry: string | TestAction): void {
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
        const requestedTrackId = typeof entry.trackId === 'string' ? entry.trackId as TrackId : null;
        const indexedTrackId = typeof entry.trackIndex === 'number' ? trackIdAtIndex(entry.trackIndex) : null;
        const actionTrackId = requestedTrackId && trackStore.protocolIndexForId(requestedTrackId) !== null
            ? requestedTrackId
            : indexedTrackId;
        const idx = actionTrackId ? trackIndexForId(actionTrackId) : -1;
        if (entry.action === 'offset-up' && idx >= 0) {
            adjustOffset(idx, 0.01);
        }
        if (entry.action === 'offset-down' && idx >= 0) {
            adjustOffset(idx, -0.01);
        }
        if (entry.action === 'remove-track' && idx >= 0) {
            if (actionTrackId) {
                removeTrack(actionTrackId);
            }
        }
        if (entry.action === 'resize-height-drag' && entry.payload) {
            const kind = entry.payload.kind === 'spectrum' ? 'spectrum' : 'track';
            const startY = Number(entry.payload.startY || 0);
            const endY = Number(entry.payload.endY || startY);
            beginHeightResize(kind, startY);
            updateHeightResize(endY);
            endHeightResize();
        }
        if (entry.action === 'open-spectrogram-settings') {
            const gear = document.querySelector('[data-action="spectrogram-settings"]');
            if (gear) {
                gear.click();
            }
        }
        if (entry.action === 'apply-spectrogram-settings' && entry.payload) {
            const p = entry.payload;
            if (__specPopover && __specPopover.hidden) {
                __openSpecPopover();
            }
            document.getElementById('spec-auto').checked = !!p.auto;
            if (p.nFft != null) {
                document.getElementById('spec-nfft').value = String(p.nFft);
            }
            if (p.hopSize != null) {
                document.getElementById('spec-hop').value = String(p.hopSize);
            }
            if (p.window != null) {
                document.getElementById('spec-window').value = String(p.window);
            }
            __applySpecAutoState();
            document.getElementById('spec-apply').click();
        }
        if (entry.action === 'set-cursor' && entry.payload) {
            cursorNorm = Math.max(0, Math.min(1, Number(entry.payload.cursorNorm)));
            updateCursorDisplay(cursorNorm);
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
        }
        if (entry.action === 'set-track-offset' && idx >= 0 && entry.payload) {
            const offsetSeconds = Number(entry.payload.offsetSeconds ?? 0);
            if (!Number.isFinite(offsetSeconds)) {
                return;
            }
            trackRuntimeAt(idx).offsetSeconds = offsetSeconds;
            updateOffsetDisplays();
            updateLoopTimeDisplay();
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
        }
        if (entry.action === 'set-loop-region' && entry.payload) {
            const start = Math.max(0, Math.min(1, Number(entry.payload.start)));
            const end = Math.max(0, Math.min(1, Number(entry.payload.end)));
            if (end > start) {
                loopRegion = { start: start, end: end };
                updateLoopTimeDisplay();
                updateZoomToSelectionBtn();
                scheduleRender();
            }
        }
        if (entry.action === 'set-spectrogram-display' && entry.payload) {
            const p = entry.payload;
            if (__specPopover && __specPopover.hidden) {
                __openSpecPopover();
            }
            function __setN(id: string, v: unknown): void {
                const el = document.getElementById(id);
                el.value = (v == null) ? '' : String(v);
            }
            __setN('spec-dbmin', p.dbMin);
            __setN('spec-dbmax', p.dbMax);
            __setN('spec-maxfreq', p.maxFrequencyHz);
            __setSpectrogramDisplay({
                dbMin: typeof p.dbMin === 'number' ? p.dbMin : null,
                dbMax: typeof p.dbMax === 'number' ? p.dbMax : null,
                maxFrequencyHz: typeof p.maxFrequencyHz === 'number' ? p.maxFrequencyHz : null,
            });
        }
    }
    function scheduleRangeRequests() {
        if (rangeRequestTimer) {
            clearTimeout(rangeRequestTimer);
        }
        rangeRequestTimer = setTimeout(function () { checkAndRequestRanges(); }, 80);
    }
    function waveformPointCount(waveform: WaveformEnvelope | null | undefined): number {
        if (!waveform) {
            return 0;
        }
        return (waveform.min && waveform.min.length) || (waveform.samples && waveform.samples.length) || 0;
    }
    function computeTrackFileView(result: ComparisonTrackState, trackIndex: number, offsetSeconds?: number): TrackFileView {
        const dur = result.durationSeconds || 1;
        const gs = computeGlobalSpan();
        const offsetSec = offsetSeconds === undefined ? trackRuntimeAt(trackIndex).offsetSeconds : offsetSeconds;
        const trackStart = (offsetSec - gs.startSec) / gs.spanSec;
        const trackDurRatio = dur / gs.spanSec;
        const fileAtZoomStart = (zoomStart - trackStart) / trackDurRatio;
        const fileAtZoomEnd = (zoomEnd - trackStart) / trackDurRatio;
        return {
            trackStart: trackStart,
            trackDurRatio: trackDurRatio,
            fileAtZoomStart: fileAtZoomStart,
            fileAtZoomEnd: fileAtZoomEnd,
        };
    }
    function isRangeCacheDrawable(cache: WaveformRangeCache | null, channelIndex: number): boolean {
        const ch = cache && cache.channels ? cache.channels[channelIndex] : null;
        return waveformPointCount(ch) > 0;
    }
    function visibleFileFraction(fileAtZoomStart: number, fileAtZoomEnd: number) {
        const viewStart = Math.max(0, Math.min(fileAtZoomStart, fileAtZoomEnd));
        const viewEnd = Math.min(1, Math.max(fileAtZoomStart, fileAtZoomEnd));
        return Math.max(0, viewEnd - viewStart);
    }
    function overviewIsSufficient(result: ComparisonTrackState, W: number, fileView: TrackFileView): boolean {
        const visibleFraction = visibleFileFraction(fileView.fileAtZoomStart, fileView.fileAtZoomEnd);
        if (visibleFraction <= 0) {
            return true;
        }
        return channelsForResult(result).every(function (ch: ChannelSummary) {
            const fullWaveform = ch && ch.waveform ? ch.waveform : null;
            const pointCount = Math.max(waveformPointCount(fullWaveform), OVERVIEW_PTS);
            return pointCount * visibleFraction >= W * 1.0;
        });
    }
    function checkAndRequestRanges() {
        state.results.forEach(function (result: ComparisonTrackState, i: number) {
            const record = trackRecordAtIndex(i);
            if (!record || record.runtime.hidden || result.error) {
                return;
            }
            const canvas = document.getElementById(trackCanvasId(i, 0));
            const W = (canvas ? canvas.width : 0) || 800;
            const fileView = computeTrackFileView(result, i);
            if (overviewIsSufficient(result, W, fileView)) {
                return;
            }
            const fileSpan = fileView.fileAtZoomEnd - fileView.fileAtZoomStart;
            const reqStart = Math.max(0, fileView.fileAtZoomStart - 0.05 * fileSpan);
            const reqEnd = Math.min(1, fileView.fileAtZoomEnd + 0.05 * fileSpan);
            const pts = Math.min(W * 2, 8000);
            // Skip if cached range covers current view with sufficient density
            const c = record.rangeCache;
            if (c && c.startNorm <= reqStart && c.endNorm >= reqEnd && c.channels) {
                const cacheDataRange = Math.max(c.endNorm - c.startNorm, 1e-9);
                const cacheSufficient = channelsForResult(result).every(function (_, channelIndex: number) {
                    const ch = c.channels[channelIndex];
                    const nPts = waveformPointCount(ch);
                    const ptsVisible = nPts * ((fileView.fileAtZoomEnd - fileView.fileAtZoomStart) / cacheDataRange);
                    return nPts >= pts * 0.8 && ptsVisible >= W * 0.5;
                });
                if (cacheSufficient) {
                    return;
                }
            }
            const requestId = record.id + '-' + Date.now();
            record.pendingRangeRequest = requestId;
            messaging.post({
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
    syncWaveformModeButton();
    __updateSpecGearVisibility();
    attachEvents();
    // Defer first render so the browser has time to calculate flex layout
    requestAnimationFrame(function () {
        renderAll();
        scheduleSpectrumRefresh('immediate');
        publishTestSnapshot();
    });
    function isReanalyzeBusy() {
        const overlay = document.getElementById('reanalyze-overlay');
        return !!overlay && overlay.style.display !== 'none';
    }
    function formatAmplitudeValue(value: number): string {
        const absValue = Math.abs(value);
        if (absValue >= 100) {
            return absValue.toFixed(0);
        }
        if (absValue >= 1) {
            return absValue.toFixed(1);
        }
        if (absValue >= 0.01) {
            return absValue.toFixed(2);
        }
        return absValue.toPrecision(2);
    }
    function formatWaveformAxisLabels(absolutePeak: number | null | undefined, unit: string | null | undefined) {
        const rawPeak = typeof absolutePeak === 'number' ? absolutePeak : NaN;
        const peak = Number.isFinite(rawPeak) && rawPeak > 0 ? rawPeak : 1;
        const value = formatAmplitudeValue(peak);
        const unitText = typeof unit === 'string' && unit.trim() ? unit.trim() : null;
        return ['+' + value, '0', '-' + value, unitText ? 'Amp (' + unitText + ')' : 'Amp'];
    }
    function waveformAxisLabelsForChannel(result: ComparisonTrackState, channelIndex: number) {
        const ch = channelsForResult(result)[channelIndex];
        const waveform = ch && ch.waveform;
        const rawPeak = waveform && typeof waveform.absolutePeak === 'number' ? waveform.absolutePeak : NaN;
        const peak = Number.isFinite(rawPeak) && rawPeak > 0 ? rawPeak : 1;
        const unitText = ch && typeof ch.unit === 'string' && ch.unit.trim() ? ch.unit.trim() : null;
        if (isAmplitudeZoomActive()) {
            const top = formatSignedAmplitudeValue(amplitudeZoomMaxNorm * peak);
            const middle = formatSignedAmplitudeValue(((amplitudeZoomMinNorm + amplitudeZoomMaxNorm) / 2) * peak);
            const bottom = formatSignedAmplitudeValue(amplitudeZoomMinNorm * peak);
            return [top, middle, bottom, unitText ? 'Amp (' + unitText + ')' : 'Amp'];
        }
        return formatWaveformAxisLabels(waveform && waveform.absolutePeak, ch && ch.unit);
    }
    function waveformAxisLabelsForResult(result: ComparisonTrackState, trackIndex: number) {
        return waveformAxisLabelsForChannel(result, 0);
    }
    function formatSignedAmplitudeValue(value: number): string {
        const prefix = value > 0 ? '+' : value < 0 ? '-' : '';
        return prefix + formatAmplitudeValue(value);
    }
    function publishTestSnapshot(actionId?: string) {
        const toolbar = document.getElementById('toolbar');
        const overlayCanvas = document.getElementById('spectrum-overlay-canvas');
        let visibleSpectrumTrackCount = 0;
        const spectrogramPerTrack: string[][] = [];
        const spectrumPerTrack: string[][] = [];
        const waveformPerTrack: string[][] = [];
        let overlayMinDb = Infinity, overlayMaxDb = -Infinity, overlayMaxF = 0;
        let overlayDbSource: SpectrumSlice | SpectrogramData | null = null;
        const trackInfo = trackStore.activeIds().map(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            const trackIndex = record.protocolIndex;
            const dur = result.durationSeconds || 1;
            const gs = computeGlobalSpan();
            const trackStart = (trackRuntimeAt(trackIndex).offsetSeconds - gs.startSec) / gs.spanSec;
            const trackDurRatio = dur / gs.spanSec;
            const visibleFileStartNorm = Math.max(0, (zoomStart - trackStart) / trackDurRatio);
            const visibleFileEndNorm = Math.min(1, (zoomEnd - trackStart) / trackDurRatio);
            const coverage = record.waveformCoverage;
            const spectrumCanvas = document.getElementById('track-spectrum-' + trackIndex);
            const slice = trackRuntimeAt(trackIndex).hidden
                ? null
                : extractSpectrumAtCursor(result, trackIndex, trackRuntimeAt(trackIndex).offsetSeconds, spectrumCursorNorm);
            if (slice) {
                visibleSpectrumTrackCount++;
                if (slice.minDb < overlayMinDb) {
                    overlayMinDb = slice.minDb;
                }
                if (slice.maxDb > overlayMaxDb) {
                    overlayMaxDb = slice.maxDb;
                }
                if (slice.maxFrequencyHz > overlayMaxF) {
                    overlayMaxF = slice.maxFrequencyHz;
                }
                if (!overlayDbSource) {
                    overlayDbSource = slice;
                }
            }
            waveformPerTrack.push(waveformAxisLabelsForResult(result, trackIndex));
            const ch = displayedChannel(result, trackIndex);
            const spec = ch && ch.spectrogram;
            const dispCfg2 = __spectrogramSettings.display;
            const fallbackMaxF = result.sampleRateHz ? result.sampleRateHz / 2 : 0;
            const specDbLo = spec
                ? ((dispCfg2.dbMin != null) ? dispCfg2.dbMin : spec.minDb)
                : ((dispCfg2.dbMin != null) ? dispCfg2.dbMin : -120);
            const specDbHi = spec
                ? ((dispCfg2.dbMax != null) ? dispCfg2.dbMax : spec.maxDb)
                : ((dispCfg2.dbMax != null) ? dispCfg2.dbMax : 0);
            const originalSpecMaxF = spec ? spec.maxFrequencyHz : fallbackMaxF;
            const specMaxF = dispCfg2.maxFrequencyHz != null
                ? Math.min(dispCfg2.maxFrequencyHz, originalSpecMaxF)
                : originalSpecMaxF;
            spectrogramPerTrack.push(specMaxF > 0
                ? ['0 Hz', formatHz(specMaxF / 2), formatHz(specMaxF),
                    formatDbLevel(specDbLo, spec), formatDbLevel(specDbHi, spec), 'Freq']
                : []);
            if (slice) {
                const visSliceDbMin = (specDbMin != null) ? specDbMin : slice.minDb;
                const visSliceDbMax = (specDbMax != null) ? specDbMax : slice.maxDb;
                const visSliceFreqMin = specFreqStart * slice.maxFrequencyHz;
                const visSliceFreqMax = specFreqEnd * slice.maxFrequencyHz;
                spectrumPerTrack.push([
                    formatDbLevel(visSliceDbMax, slice),
                    formatDbLevel((visSliceDbMax + visSliceDbMin) / 2, slice),
                    formatDbLevel(visSliceDbMin, slice),
                    formatHz(visSliceFreqMin), formatHz((visSliceFreqMin + visSliceFreqMax) / 2), formatHz(visSliceFreqMax),
                ]);
            }
            else {
                spectrumPerTrack.push([]);
            }
            return {
                trackId: trackId,
                trackIndex: trackIndex,
                filePath: result.filePath,
                offsetSeconds: trackRuntimeAt(trackIndex).offsetSeconds,
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
            const firstChannel = state.results[0] ? displayedChannel(state.results[0], 0) : undefined;
            const firstSpec = firstChannel?.spectrogram;
            const settingsForSnapshot = (typeof __spectrogramSettings !== 'undefined' && __spectrogramSettings)
                ? __spectrogramSettings
                : null;
            if (firstSpec || settingsForSnapshot) {
                const disp = settingsForSnapshot && settingsForSnapshot.display
                    ? settingsForSnapshot.display
                    : { dbMin: null, dbMax: null, maxFrequencyHz: null };
                const stft = settingsForSnapshot && settingsForSnapshot.stft
                    ? settingsForSnapshot.stft
                    : null;
                latestSpectrogram = {
                    windowSize: stft ? Number(stft.nFft) : (firstSpec ? firstSpec.windowSize : null),
                    hopSize: stft ? Number(stft.hopSize) : (firstSpec ? firstSpec.hopSize : null),
                    dbMinApplied: disp.dbMin == null ? null : Number(disp.dbMin),
                    dbMaxApplied: disp.dbMax == null ? null : Number(disp.dbMax),
                    maxFrequencyHzApplied: disp.maxFrequencyHz == null ? null : Number(disp.maxFrequencyHz),
                };
            }
        }
        catch (e) { /* ignore */ }
        testBridge.publish({
                hasToolbar: !!toolbar,
                toolbarActions: Array.from(document.querySelectorAll('#toolbar [data-action]')).map(function (el: RuntimeElement) {
                    return el.getAttribute('data-action');
                }).filter((action: string | null): action is string => !!action),
                trackRowCount: document.querySelectorAll('.track-row').length,
                audioElementCount: document.querySelectorAll('#audio-host audio').length,
                hasRulerCanvas: !!document.getElementById('ruler-canvas'),
                zoomStart: zoomStart,
                zoomEnd: zoomEnd,
                amplitudeZoomMinNorm: amplitudeZoomMinNorm,
                amplitudeZoomMaxNorm: amplitudeZoomMaxNorm,
                rectZoomSelection: rectZoomSelection ? Object.assign({}, rectZoomSelection) : null,
                cursorNorm: cursorNorm,
                spectrumOverlayPresent: !!overlayCanvas,
                spectrumTrackCanvasCount: document.querySelectorAll('.track-spectrum-canvas').length,
                visibleSpectrumTrackCount: visibleSpectrumTrackCount,
                contentType: contentType,
                reanalyzeBusy: isReanalyzeBusy(),
                latestSpectrogram: latestSpectrogram,
                axisLabels: {
                    spectrumOverlay: visibleSpectrumTrackCount > 0 && isFinite(overlayMinDb)
                        ? (function () {
                            const visOvDbMin = (specDbMin != null) ? specDbMin : overlayMinDb;
                            const visOvDbMax = (specDbMax != null) ? specDbMax : overlayMaxDb;
                            const visOvFMin = specFreqStart * overlayMaxF;
                            const visOvFMax = specFreqEnd * overlayMaxF;
                            return [
                                formatDbLevel(visOvDbMax, overlayDbSource),
                                formatDbLevel((visOvDbMax + visOvDbMin) / 2, overlayDbSource),
                                formatDbLevel(visOvDbMin, overlayDbSource),
                                formatHz(visOvFMin), formatHz((visOvFMin + visOvFMax) / 2), formatHz(visOvFMax),
                            ];
                        })()
                        : [],
                    spectrogramPerTrack: spectrogramPerTrack,
                    spectrumPerTrack: spectrumPerTrack,
                    waveformPerTrack: waveformPerTrack,
                },
                displayOrder: trackStore.displayOrder.slice(),
                specFreqStart: specFreqStart,
                specFreqEnd: specFreqEnd,
                trackHeight: trackHeight,
                spectrumOverlayHeight: spectrumOverlayHeight,
                waveformMode: waveformMode,
                lastAnnounce: (function () {
                    var el = document.getElementById('a11y-announce');
                    return el ? (el.textContent || '') : '';
                })(),
                tracks: trackInfo,
            }, actionId);
    }
    function publishTestSnapshotSafe(actionId?: string) {
        try {
            publishTestSnapshot(actionId);
        }
        catch (e) {
            const toolbar = document.getElementById('toolbar');
            testBridge.publish({
                    hasToolbar: !!toolbar,
                    toolbarActions: Array.from(document.querySelectorAll('#toolbar [data-action]')).map(function (el: RuntimeElement) {
                        return el.getAttribute('data-action');
                    }).filter((action: string | null): action is string => !!action),
                    trackRowCount: document.querySelectorAll('.track-row').length,
                    audioElementCount: document.querySelectorAll('#audio-host audio').length,
                    hasRulerCanvas: !!document.getElementById('ruler-canvas'),
                    zoomStart: zoomStart,
                    zoomEnd: zoomEnd,
                    cursorNorm: cursorNorm,
                    spectrumOverlayPresent: !!document.getElementById('spectrum-overlay-canvas'),
                    spectrumTrackCanvasCount: document.querySelectorAll('.track-spectrum-canvas').length,
                    visibleSpectrumTrackCount: 0,
                    contentType: contentType,
                    reanalyzeBusy: isReanalyzeBusy(),
                    axisLabels: { spectrumOverlay: [], spectrogramPerTrack: [], spectrumPerTrack: [], waveformPerTrack: [] },
                    displayOrder: trackStore.displayOrder.slice(),
                    specFreqStart: specFreqStart,
                    specFreqEnd: specFreqEnd,
                    trackHeight: trackHeight,
                    spectrumOverlayHeight: spectrumOverlayHeight,
                    waveformMode: waveformMode,
                    lastAnnounce: e instanceof Error ? e.message : String(e),
                    tracks: [],
                }, actionId);
        }
    }
    function buildLayout() {
        if (isSelectionMode) {
            return buildDirectorySelectionLayout();
        }
        return buildResultsPane(STR.emptyAllExcluded);
    }
    function buildDirectorySelectionLayout() {
        const pythonButtonText = buildPythonButtonText(pythonEnvironmentState.pythonCommand, pythonEnvironmentState.status === 'warning');
        const pythonButtonTooltip = buildPythonTooltip(pythonEnvironmentState.pythonCommand, pythonEnvironmentState.tooltip);
        const pythonButtonClass = 'tb-btn' + (pythonEnvironmentState.status === 'warning' ? ' is-warning' : '');
        return '<div id="directory-selection-layout">'
            + '  <div id="selection-toolbar">'
            + '    <span style="font-weight:700;font-size:12px;color:var(--accent)">' + escHtml(STR.selectionHeader) + '</span>'
            + '    <div class="tb-sep"></div>'
            + '    <button class="tb-btn" data-action="open-file">' + escHtml(STR.btnOpenFile) + '</button>'
            + '    <button class="tb-btn" data-action="open-folder">' + escHtml(STR.btnOpenAnotherFolder) + '</button>'
            + '    <button class="' + pythonButtonClass + '" id="selection-python-environment" data-action="select-python-environment" title="' + escHtml(pythonButtonTooltip) + '">' + escHtml(pythonButtonText) + '</button>'
            + '  </div>'
            + '  <div id="selection-body">'
            + '    <div id="selection-sidebar">'
            + '      <div id="selection-summary">'
            + '        <div class="selection-count" id="selection-count"></div>'
            + '        <div class="selection-path">' + escHtml(state.rootPath || '') + '</div>'
            + '      </div>'
            + '      <div id="tree-filter-wrap">'
            + '        <input id="tree-filter-input" type="text" value="' + escHtml(treeFilterQuery) + '" placeholder="' + escHtml(STR.treeFilterPlaceholder || 'Filter files...') + '" autocomplete="off" spellcheck="false">'
            + '      </div>'
            + '      <div id="selection-actions">'
            + '        <button class="tb-btn" data-action="selection-select-all">' + escHtml(STR.btnSelectAll) + '</button>'
            + '        <button class="tb-btn" data-action="selection-clear-all">' + escHtml(STR.btnClear) + '</button>'
            + '      </div>'
            + '      <div id="selection-tree" role="group" aria-label="' + escHtml(STR.ariaSelectionTree) + '">' + buildSelectionTree(__directoryTree, true, 0) + '</div>'
            + '    </div>'
            + '    <div class="tree-resizer" id="tree-resizer" role="separator" aria-orientation="vertical"></div>'
            + '    <div id="selection-results-pane">'
            + buildResultsPane(STR.emptyNoTracks)
            + '    </div>'
            + '  </div>'
            + '</div>';
    }
    function buildTrackRowsHtml() {
        return trackStore.displayOrder.map(function (trackId) {
            const record = trackStore.require(trackId);
            return buildTrackRow(record.result, record.protocolIndex);
        }).join('');
    }
    function rebuildResultsPane() {
        const stacked = document.getElementById('stacked-wrap');
        if (stacked) {
            stacked.innerHTML = buildTrackRowsHtml();
            attachRebuiltTrackEvents();
        }
        updateVisibility();
        updateOffsetDisplays();
        syncHeightInputs();
        updatePlaybackButtons();
        Object.keys(canvasWidthCache).forEach(function (key) { delete canvasWidthCache[key]; });
    }
    function buildResultsPane(emptyMessage: string) {
        const tracks = buildTrackRowsHtml();
        return '<div id="toolbar" role="toolbar" aria-label="' + escHtml(STR.ariaToolbar) + '">' + buildToolbar() + '</div>'
            + '<div id="tracks-wrapper">'
            + '  <div id="ruler-row"><div id="ruler-spacer"></div><div id="ruler-axis-spacer" style="width:' + AXIS_W + 'px;flex:none"></div><canvas id="ruler-canvas"></canvas></div>'
            + '  <div id="stacked-wrap">' + tracks + '</div>'
            + '  <div id="empty-state"><p>' + escHtml(emptyMessage) + '</p></div>'
            + '</div>'
            + '<div id="spectrum-section">'
            + '  <div id="spectrum-section-header"><span>' + escHtml(STR.spectrumSectionTitle) + '</span><span id="spectrum-cursor-time" style="font-family:var(--font-mono);"></span><span id="spectrum-freq-readout" style="font-family:var(--font-mono);margin-left:14px;"></span></div>'
            + '  <div id="spectrum-zoom-toolbar" style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:11px;">'
            + '    <span class="tb-label">' + escHtml(STR.spectrumZoomLabel) + '</span>'
            + '    <button class="tb-btn" data-action="spec-zoom-out" aria-label="' + escHtml(STR.ariaSpecZoomOut) + '">－</button>'
            + '    <button class="tb-btn" data-action="spec-zoom-in" aria-label="' + escHtml(STR.ariaSpecZoomIn) + '">＋</button>'
            + '    <button class="tb-btn" data-action="spec-zoom-reset" aria-label="' + escHtml(STR.ariaSpecZoomReset) + '">' + escHtml(STR.btnSpecZoomReset) + '</button>'
            + '  </div>'
            + '  <div id="spectrum-overlay-wrap"><div class="height-resizer spectrum-height-resizer" data-action="spectrum-height-drag" role="separator" aria-orientation="horizontal" aria-label="' + escHtml(STR.heightSpectrumLabel + ' resize') + '"></div><canvas id="spectrum-overlay-canvas" tabindex="0" aria-label="' + escHtml(STR.spectrumSectionTitle) + '"></canvas></div>'
            + '</div>'
            + '<div id="audio-host">' + buildAudioElements() + '</div>';
    }
    function buildSelectionTreeItems(nodes: SelectionTreeNode[], depth: number): string {
        return nodes.map(function (node: SelectionTreeNode) {
            if (node.type === 'directory') {
                // 保存済み状態があればそれを使う、なければ depth === 0 のみ展開
                var savedExpanded = directoryCollapseState[node.relativePath];
                var isExpanded = (savedExpanded !== undefined) ? savedExpanded : (depth === 0);
                // 折りたたみ時は子要素をレンダリングしない（#90 レイジーレンダリング）
                var childrenHtml: string = isExpanded ? buildSelectionTreeItems(node.children || [], depth + 1) : '';
                var lazyAttr = isExpanded ? '' : ' data-lazy="true"';
                return '<li>'
                    + '<div class="selection-tree-directory" data-action="toggle-directory"'
                    + ' data-relative-path="' + escHtml(node.relativePath) + '"'
                    + ' data-depth="' + depth + '"'
                    + ' role="button" tabindex="0"'
                    + ' aria-expanded="' + (isExpanded ? 'true' : 'false') + '"'
                    + ' aria-label="' + escHtml(STR.ariaSelectionTreeDir) + ': ' + escHtml(node.name) + '">'
                    + '<span class="dir-toggle" aria-hidden="true">' + (isExpanded ? '▼' : '▶') + '</span>'
                    + '<span class="dir-name">' + escHtml(node.name) + '</span>'
                    + '</div>'
                    + '<ul class="selection-tree-list"' + lazyAttr + ' style="' + (isExpanded ? '' : 'display:none') + '">'
                    + childrenHtml
                    + '</ul>'
                    + '</li>';
            }
            const filePath = node.filePath || '';
            const checked = hasSelectedFilePath(filePath) ? ' checked' : '';
            return '<li>'
                + '<label class="selection-file-row">'
                + '  <input class="selection-file-checkbox" type="checkbox" data-file-path="' + escHtml(filePath) + '"' + checked + '>'
                + '  <span class="selection-file-label">'
                + '    <span class="selection-file-name">' + escHtml(node.name) + '</span>'
                + '    <span class="selection-file-path">' + escHtml(node.relativePath) + '</span>'
                + '  </span>'
                + '</label>'
                + '</li>';
        }).join('');
    }
    function buildSelectionTree(nodes: SelectionTreeNode[], isRoot: boolean, depth: number): string {
        depth = depth || 0;
        if (!Array.isArray(nodes) || nodes.length === 0) {
            return '<div class="selection-path">' + escHtml(STR.selectionNoSupported) + '</div>';
        }
        return '<ul class="selection-tree-list' + (isRoot ? ' is-root' : '') + '">'
            + buildSelectionTreeItems(nodes, depth)
            + '</ul>';
    }
    function buildAudioElements() {
        return trackStore.activeIds().map(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            if (!result.audioSource) {
                return '';
            }
            return '<audio id="track-audio-' + record.protocolIndex + '" data-track-id="' + trackId + '" preload="metadata" src="' + escHtml(result.audioSource) + '"></audio>';
        }).join('');
    }
    function buildToolbar() {
        function toolbarMenu(label: string, content: string) {
            return '<details class="tb-menu"><summary class="tb-btn">' + escHtml(label) + '</summary><div class="tb-menu-popover">' + content + '</div></details>';
        }
        const adjustMenu = '<div class="tb-menu-row"><span class="tb-label">' + escHtml(STR.toolbarHeightLabel) + '</span></div>'
            + '<div class="tb-menu-row"><span class="tb-label">' + escHtml(STR.heightTrackLabel) + '</span>'
            + '<input class="tb-number" type="number" min="' + TRACK_HEIGHT_MIN + '" max="' + TRACK_HEIGHT_MAX + '" step="1" value="' + trackHeight + '" data-action="track-height-input" aria-label="' + escHtml(STR.heightTrackLabel + ' px') + '">'
            + '<button class="tb-btn" data-action="track-height-reset" aria-label="' + escHtml(STR.ariaTrackHeightReset) + '">' + escHtml(STR.heightTrackLabel + ' ' + STR.btnHeightReset) + '</button></div>'
            + '<div class="tb-menu-row"><span class="tb-label">' + escHtml(STR.heightSpectrumLabel) + '</span>'
            + '<input class="tb-number" type="number" min="' + SPECTRUM_HEIGHT_MIN + '" max="' + SPECTRUM_HEIGHT_MAX + '" step="1" value="' + spectrumOverlayHeight + '" data-action="spectrum-height-input" aria-label="' + escHtml(STR.heightSpectrumLabel + ' px') + '">'
            + '<button class="tb-btn" data-action="spectrum-height-reset" aria-label="' + escHtml(STR.ariaSpectrumHeightReset) + '">' + escHtml(STR.heightSpectrumLabel + ' ' + STR.btnHeightReset) + '</button></div>';
        const workflowMenu = '<button class="tb-btn" data-action="run-recipe">' + escHtml(STR.btnRunRecipe) + '</button>'
            + '<button class="tb-btn" data-action="copy-spec">' + escHtml(STR.btnCopySpec) + '</button>';
        const exportMenu = '<button class="tb-btn" data-action="export-png" title="' + escHtml(STR.btnExportPngTitle) + '">' + escHtml(STR.btnExportPng) + '</button>'
            + '<button class="tb-btn" data-action="export-csv" title="' + escHtml(STR.btnExportCsvTitle) + '">' + escHtml(STR.btnExportCsv) + '</button>'
            + '<button class="tb-btn" data-action="export-wav" title="' + escHtml(STR.btnExportWavTitle) + '">' + escHtml(STR.btnExportWav) + '</button>'
            + '<button class="tb-btn" data-action="export-report" title="' + escHtml(STR.btnExportReportTitle) + '">' + escHtml(STR.btnExportReport) + '</button>';
        return '<span class="tb-label">' + escHtml(STR.toolbarTrackLabel) + '</span>'
            + '<button class="tb-btn' + (contentType === 'waveform' ? ' is-active' : '') + '" data-action="content-waveform">' + escHtml(STR.btnWaveform) + '</button>'
            + '<button class="tb-btn' + (contentType === 'spectrogram' ? ' is-active' : '') + '" data-action="content-spectrogram">' + escHtml(STR.btnSpectrogram) + '</button>'
            + '<button class="tb-btn" data-action="spectrogram-settings" title="' + escHtml(STR.btnSpectrogramSettingsTitle) + '" aria-label="' + escHtml(STR.btnSpectrogramSettingsTitle) + '" style="display:none">⚙</button>'
            + '<div class="tb-sep"></div>'
            + '<span class="tb-label">' + escHtml(STR.toolbarZoomLabel) + '</span>'
            + '<button class="tb-btn" data-action="zoom-out" aria-label="' + escHtml(STR.ariaZoomOut) + '">－</button>'
            + '<button class="tb-btn" data-action="zoom-in" aria-label="' + escHtml(STR.ariaZoomIn) + '">＋</button>'
            + '<button class="tb-btn" data-action="zoom-reset" aria-label="' + escHtml(STR.ariaZoomReset) + '">' + escHtml(STR.btnZoomReset) + '</button>'
            + '<button class="tb-btn" id="btn-wave-mode-rect-zoom" data-action="wave-mode-rect-zoom" aria-pressed="false">' + escHtml(STR.waveModeLabelRectZoom) + '</button>'
            + '<button class="tb-btn" id="btn-zoom-to-selection" data-action="zoom-to-selection" title="' + escHtml(STR.btnZoomToSelectionTitle) + '" disabled>' + escHtml(STR.btnZoomToSelection) + '</button>'
            + '<button class="tb-btn" data-action="toggle-follow-cursor" title="' + escHtml(STR.btnFollowCursorTitle) + '">' + escHtml(STR.btnFollowCursor) + '</button>'
            + '<div class="tb-sep"></div>'
            + toolbarMenu(STR.toolbarAdjustLabel, adjustMenu)
            + toolbarMenu(STR.toolbarWorkflowLabel, workflowMenu)
            + toolbarMenu(STR.toolbarExportLabel, exportMenu)
            + '<div class="tb-sep"></div>'
            + '<span id="cursor-display" title="' + escHtml(STR.cursorDisplayHint) + '">—</span>'
            + '<span id="playback-display" title="' + escHtml(STR.playbackDisplayTitle) + '"></span>'
            + '<span id="loop-badge" style="display:none; color:#64a0ff; font-size:0.85em; margin-left:8px;">' + escHtml(STR.loopBadge) + '</span>'
            + '<span id="loop-time-display" title="' + escHtml(STR.loopTimeDisplayTitle) + '" style="display:none;"></span>';
    }
    function channelMetricSummaryHtml(ch: ChannelSummary) {
        const rmsDb = ch ? channelDb(ch.rms) : '—';
        const peakDb = ch ? channelDb(ch.peakAbsolute) : '—';
        const domHz = channelDominantFrequencyLabel(ch);
        return '<span>RMS ' + escHtml(rmsDb) + '</span> <span>Peak ' + escHtml(peakDb) + '</span> <span>' + escHtml(domHz) + '</span>';
    }
    function buildChannelLane(result: ComparisonTrackState, trackIndex: number, channelIndex: number) {
        const trackId = trackIdAtIndex(trackIndex);
        if (!trackId) {
            return '';
        }
        const channels = channelsForResult(result);
        const ch = channels[channelIndex];
        const label = channelLabel(result, channelIndex);
        const suffix = channelCanvasSuffix(channelIndex);
        const header = channels.length > 1
            ? '  <div class="track-channel-lane-header"><span class="track-channel-lane-label">' + escHtml(label) + '</span>' + channelMetricSummaryHtml(ch) + '</div>'
            : '';
        return '<div class="track-channel-lane" data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '">'
            + header
            + '  <div class="track-channel-lane-body">'
            + '    <div class="track-canvas-wrap" id="track-canvas-wrap-' + trackIndex + suffix + '">'
            + '      <canvas class="track-axis-canvas" id="' + trackAxisCanvasId(trackIndex, channelIndex) + '" style="width:' + AXIS_W + 'px" data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '"></canvas>'
            + '      <canvas class="track-canvas" id="' + trackCanvasId(trackIndex, channelIndex) + '" data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '" tabindex="0" style="outline:none;flex:1"></canvas>'
            + '    </div>'
            + '    <div class="track-spectrum-wrap" id="track-spectrum-wrap-' + trackIndex + suffix + '" title="' + escHtml(STR.trackSpectrumTitle) + '">'
            + '      <canvas class="track-spectrum-canvas" id="' + trackSpectrumCanvasId(trackIndex, channelIndex) + '" data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '" tabindex="0" aria-label="' + escHtml(result.fileName + ' ' + label + ' ' + STR.trackSpectrumTitle) + '"></canvas>'
            + '    </div>'
            + '  </div>'
            + '</div>';
    }
    function buildChannelLanes(result: ComparisonTrackState, i: number) {
        return channelsForResult(result).map(function (_, channelIndex: number) {
            return buildChannelLane(result, i, channelIndex);
        }).join('');
    }
    function isChannelClipped(channel: ChannelSummary): boolean {
        if (channel.clipped !== undefined) {
            return channel.clipped;
        }
        if (Number.isFinite(channel.rawPeakFullScale)) {
            return Number(channel.rawPeakFullScale) >= 0.99;
        }
        return (!channel.measurement || channel.measurement.calibrationStatus === 'uncalibrated')
            && channel.peakAbsolute >= 0.99;
    }
    function buildTrackRow(result: ComparisonTrackState, i: number) {
        const trackId = trackIdAtIndex(i);
        if (!trackId) {
            return '';
        }
        const channels = channelsForResult(result);
        const monoSummary = channels.length === 1
            ? ' &nbsp; ' + channelMetricSummaryHtml(channels[0])
            : '';
        return '<div class="track-row" id="track-row-' + i + '" data-track-id="' + trackId + '">'
            + '<div class="track-header">'
            + '  <div class="track-title-row">'
            + '    <div class="track-drag-handle" draggable="true" data-track-id="' + trackId + '" aria-label="' + escHtml(STR.ariaDragHandle) + '" title="' + escHtml(STR.ariaDragHandle) + '">≡</div>'
            + '    <div class="track-color-swatch" data-action="pick-color" data-track-id="' + trackId + '" style="background:' + trackColor(i) + '" role="button" tabindex="0" aria-label="' + escHtml(STR.ariaPickColor) + '" title="' + escHtml(STR.trackPickColor) + '"></div>'
            + '    <div class="track-name" title="' + escHtml(result.filePath) + '">' + escHtml(result.fileName) + '</div>'
            + (channels.some(isChannelClipped) ? '    <span class="clip-badge" title="' + escHtml(STR.clipBadgeTitle) + '">CLIP</span>' : '')
            + '  </div>'
            + '  <div class="track-meta">Total: ' + result.channelCount + ' ch &nbsp;' + (result.sampleRateHz / 1000).toFixed(1) + 'kHz' + monoSummary + '</div>'
            + '  <div class="track-btns">'
            + '    <button class="track-btn" data-action="toggle-playback" data-track-id="' + trackId + '" title="' + escHtml(STR.trackPlayTitle) + '" aria-label="' + escHtml(STR.ariaTrackPlay) + '"' + (result.audioSource ? '' : ' disabled') + '>▶</button>'
            + '    <button class="track-btn" data-action="stop-playback" data-track-id="' + trackId + '" title="' + escHtml(STR.trackStopTitle) + '" aria-label="' + escHtml(STR.ariaTrackStop) + '"' + (result.audioSource ? '' : ' disabled') + '>■</button>'
            + '    <button class="track-btn" data-action="remove-track" data-track-id="' + trackId + '" aria-label="' + escHtml(STR.ariaRemoveTrack) + '">✕</button>'
            + '  </div>'
            + '  <div class="track-offset">'
            + '    <span class="track-offset-val" id="offset-val-' + i + '" data-track-id="' + trackId + '" title="' + escHtml(STR.trackOffsetResetHint) + '" aria-label="' + escHtml(STR.ariaOffsetValue) + '">+0.000s</span>'
            + '    <button class="track-offset-step" data-action="offset-up" data-track-id="' + trackId + '" aria-label="' + escHtml(STR.ariaOffsetUp) + '">▲</button>'
            + '    <button class="track-offset-step" data-action="offset-down" data-track-id="' + trackId + '" aria-label="' + escHtml(STR.ariaOffsetDown) + '">▼</button>'
            + '  </div>'
            + '</div>'
            + '<div class="track-channel-lanes">' + buildChannelLanes(result, i) + '</div>'
            + '<div class="height-resizer track-height-resizer" data-action="track-height-drag" role="separator" aria-orientation="horizontal" aria-label="' + escHtml(STR.heightTrackLabel + ' resize') + '"></div>'
            + '</div>';
    }
    function escHtml(str: string) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    /** フルパスから basename だけを返す（パス区切り文字なしならそのまま返す） */
    function shortPythonName(cmd: string) {
        var s = String(cmd);
        var last = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
        return last >= 0 ? (s.slice(last + 1) || s) : s;
    }
    /** Python ボタンのラベル文字列を生成する（短い表示名のみ） */
    function buildPythonButtonText(cmd: string, isWarning: boolean) {
        return 'Python: ' + shortPythonName(cmd || 'python3') + (isWarning ? ' ⚠' : '');
    }
    /** Python ボタンのツールチップ文字列を生成する（フルパス＋説明） */
    function buildPythonTooltip(cmd: string, tooltip: string) {
        var full = cmd || 'python3';
        return tooltip ? full + ' — ' + tooltip : full;
    }
    // ── Rendering ──
    function renderAll() {
        updateUiSmokeSpectrumState();
        resizeAllCanvases();
        renderRuler();
        renderStackedTracks();
        updateVisibility();
        updateOffsetDisplays();
        updateUiSmokeWaveformState();
        if (contentType === 'waveform') {
            scheduleRangeRequests();
        }
    }
    function syncCanvasSize(canvas: RuntimeElement, width: number, height: number, options: CanvasSyncOptions = {}): void {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        const syncStyle = !options || options.syncStyle !== false;
        if (syncStyle && canvas.style.width !== w + 'px') {
            canvas.style.width = w + 'px';
        }
        if (syncStyle && canvas.style.height !== h + 'px') {
            canvas.style.height = h + 'px';
        }
        if (canvas.width !== w) {
            canvas.width = w;
        }
        if (canvas.height !== h) {
            canvas.height = h;
        }
    }
    function contentBoxWidth(el: RuntimeElement, fallback: number) {
        if (!el) {
            return fallback;
        }
        const style = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
            ? window.getComputedStyle(el)
            : null;
        if (!el.clientWidth) {
            return fallback;
        }
        const padL = style ? parseFloat(style.paddingLeft || '0') || 0 : 0;
        const padR = style ? parseFloat(style.paddingRight || '0') || 0 : 0;
        return Math.max(1, el.clientWidth - padL - padR);
    }
    function resizeAllCanvases() {
        state.results.forEach(function (result: ComparisonTrackState, i: number) {
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const canvas = document.getElementById(trackCanvasId(i, channelIndex));
                if (!canvas) {
                    return;
                }
                const wrap = document.getElementById('track-canvas-wrap-' + i + channelCanvasSuffix(channelIndex));
                if (!wrap) {
                    return;
                }
                const newW = wrap.clientWidth || 800;
                const cacheKey = newW + 'x' + trackHeight + 'x' + channelIndex;
                const cacheIdx = i + ':' + channelIndex;
                if (canvasWidthCache[cacheIdx] === cacheKey) {
                    return;
                }
                canvasWidthCache[cacheIdx] = cacheKey;
                syncCanvasSize(canvas, newW - AXIS_W, trackHeight);
                const axisCanvas = document.getElementById(trackAxisCanvasId(i, channelIndex));
                if (axisCanvas) {
                    syncCanvasSize(axisCanvas, AXIS_W, trackHeight);
                }
            });
        });
        const rulerCanvas = document.getElementById('ruler-canvas');
        if (rulerCanvas) {
            const row = document.getElementById('ruler-row');
            if (row) {
                syncCanvasSize(rulerCanvas, row.clientWidth - 130 - AXIS_W, 20);
            }
        }
    }
    function renderRuler() {
        const canvas = document.getElementById('ruler-canvas');
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const timeW = contentType === 'spectrogram' ? spectrogramPlotWidth(W) : W;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const gs = computeGlobalSpan();
        const visStart = gs.startSec + zoomStart * gs.spanSec;
        const visEnd = gs.startSec + zoomEnd * gs.spanSec;
        const visDur = visEnd - visStart;
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        const step = niceTimeStep(visDur);
        let t = Math.ceil(visStart / step) * step;
        while (t <= visEnd) {
            const x = (t - visStart) / visDur * timeW;
            ctx.fillText(formatTime(t), x + 2, H - 4);
            t += step;
        }
    }
    function niceTimeStep(dur: number) {
        const steps = [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30];
        for (let i = 0; i < steps.length; i++) {
            if (dur / steps[i] <= 8) {
                return steps[i];
            }
        }
        return 60;
    }
    function formatTime(seconds: number) {
        const m = Math.floor(seconds / 60);
        const s = (seconds % 60).toFixed(2);
        return m + ':' + (parseFloat(s) < 10 ? '0' : '') + s;
    }
    function isPythonEnvError(msg: string): boolean {
        if (!msg) {
            return false;
        }
        return /Failed to start Python process|No module named|ModuleNotFoundError|ENOENT|spawn.*python|command not found/i.test(msg);
    }
    function renderStackedTracks() {
        trackStore.displayOrder.forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const i = record.protocolIndex;
            const result = record.result;
            if (record.runtime.hidden) {
                return;
            }
            const existingOverlay = document.getElementById('track-error-overlay-' + i);
            if (existingOverlay) {
                existingOverlay.remove();
            }
            if (result.error) {
                channelsForResult(result).forEach(function (_, channelIndex: number) {
                    const canvas = document.getElementById(trackCanvasId(i, channelIndex));
                    if (canvas) {
                        const ctx = canvas.getContext('2d');
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                    }
                });
                const row = document.getElementById('track-row-' + i);
                if (row) {
                    const overlay = document.createElement('div');
                    overlay.id = 'track-error-overlay-' + i;
                    overlay.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px;background:var(--track-bg);z-index:2';
                    const msg = document.createElement('span');
                    msg.style.cssText = 'color:#e8637a;font-size:11px;text-align:center;white-space:pre-wrap;word-break:break-all;max-height:3em;overflow:hidden';
                    msg.textContent = STR.analysisFailed + result.error;
                    overlay.appendChild(msg);
                    if (isPythonEnvError(result.error)) {
                        const btn = document.createElement('button');
                        btn.className = 'track-btn';
                        btn.style.cssText = 'font-size:11px;padding:2px 8px';
                        btn.textContent = STR.configurePython || 'Configure Python environment';
                        btn.addEventListener('click', function () {
                            messaging.post({ type: 'select-python-environment' });
                        });
                        overlay.appendChild(btn);
                    }
                    row.appendChild(overlay);
                }
                return;
            }
            const color = trackColor(i);
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const canvas = document.getElementById(trackCanvasId(i, channelIndex));
                if (!canvas) {
                    return;
                }
                if (contentType === 'waveform') {
                    const axisC = document.getElementById(trackAxisCanvasId(i, channelIndex));
                    if (axisC) {
                        const ac = axisC.getContext('2d');
                        if (ac) {
                            ac.clearRect(0, 0, axisC.width, axisC.height);
                        }
                    }
                    drawTrackWaveform(canvas, result, i, channelIndex, trackRuntimeAt(i).offsetSeconds, color);
                }
                else {
                    drawSpectrogram(canvas, result, i, channelIndex, trackRuntimeAt(i).offsetSeconds);
                }
            });
        });
    }
    function resolveWaveformSource(result: ComparisonTrackState, trackIndex: number, channelIndex: number, offsetSeconds: number) {
        const fileView = computeTrackFileView(result, trackIndex, offsetSeconds);
        const ch = channelsForResult(result)[channelIndex];
        const fullWaveform = ch && ch.waveform ? ch.waveform : null;
        const amplitudeScale = fullWaveform ? fullWaveform.absolutePeak : undefined;
        const c = trackRecordAtIndex(trackIndex)?.rangeCache ?? null;
        const cachedChannel = c && c.channels ? c.channels[channelIndex] : null;
        const canvas = document.getElementById(trackCanvasId(trackIndex, channelIndex));
        const W = (canvas ? canvas.width : 0) || 800;
        if (c && cachedChannel && !overviewIsSufficient(result, W, fileView) &&
            isRangeCacheDrawable(c, channelIndex) &&
            c.startNorm <= Math.max(0, fileView.fileAtZoomStart) &&
            c.endNorm >= Math.min(1, fileView.fileAtZoomEnd)) {
            return { waveform: cachedChannel, dataStart: c.startNorm, dataEnd: c.endNorm, amplitudeScale: amplitudeScale };
        }
        return fullWaveform
            ? { waveform: fullWaveform, dataStart: 0, dataEnd: 1, amplitudeScale: amplitudeScale }
            : null;
    }
    function drawTrackWaveform(canvas: RuntimeElement, result: ComparisonTrackState, trackIndex: number, channelIndex: number, offsetSeconds: number, color: string, options: WaveformDrawOptions = {}): void {
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
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();
        const src = resolveWaveformSource(result, trackIndex, channelIndex, offsetSeconds);
        if (src && window.renderWaveformPipeline) {
            const dur = result.durationSeconds || 1;
            const gs = computeGlobalSpan();
            const trackStart = (offsetSeconds - gs.startSec) / gs.spanSec;
            const trackDurRatio = dur / gs.spanSec;
            const originalMoveTo = ctx.moveTo.bind(ctx);
            const originalLineTo = ctx.lineTo.bind(ctx);
            let minX = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY;
            ctx.moveTo = function (x: number, y: number) {
                if (Number.isFinite(x)) {
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                }
                return originalMoveTo(x, y);
            };
            ctx.lineTo = function (x: number, y: number) {
                if (Number.isFinite(x)) {
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                }
                return originalLineTo(x, y);
            };
            ctx.save();
            try {
                window.renderWaveformPipeline(ctx, W, H, src.waveform, {
                    zoomStart,
                    zoomEnd,
                    offsetNorm: trackStart,
                    trackDurRatio,
                    dataStart: src.dataStart,
                    dataEnd: src.dataEnd,
                    color,
                    amplitudeScale: src.amplitudeScale,
                    amplitudeMinNorm: isAmplitudeZoomActive() ? amplitudeZoomMinNorm : undefined,
                    amplitudeMaxNorm: isAmplitudeZoomActive() ? amplitudeZoomMaxNorm : undefined,
                });
            }
            finally {
                ctx.restore();
                ctx.moveTo = originalMoveTo;
                ctx.lineTo = originalLineTo;
            }
            const record = trackRecordAtIndex(trackIndex);
            if (record) {
                record.waveformCoverage = Number.isFinite(minX) && Number.isFinite(maxX)
                ? {
                    minX: minX,
                    maxX: maxX,
                    canvasWidth: W,
                    coversLeft: minX <= 1,
                    coversRight: maxX >= W - 1,
                }
                    : null;
            }
        }
        else {
            const record = trackRecordAtIndex(trackIndex);
            if (record) {
                record.waveformCoverage = null;
            }
        }
        if (shouldDrawCursor) {
            drawLoopRegionOnCanvas(ctx, W, H);
            drawCursorOnCanvas(ctx, W, H);
            drawHoverLineOnCanvas(ctx, W, H);
            drawRectZoomSelectionOnCanvas(ctx, W, H, trackIndex);
        }
        const axisCanvas = document.getElementById(trackAxisCanvasId(trackIndex, channelIndex));
        if (axisCanvas) {
            const axisCtx = axisCanvas.getContext('2d');
            if (axisCtx) {
                drawWaveformAmplitudeAxis(axisCtx, AXIS_W, H, waveformAxisLabelsForChannel(result, channelIndex));
            }
        }
    }
    function drawWaveformAmplitudeAxis(ctx: CanvasRenderingContext2D, W: number, H: number, labels: string[]): void {
        const mutedColor = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
        const bgColor = getComputedStyle(document.body).getPropertyValue('--track-bg').trim() || 'rgba(0,0,0,0.55)';
        const axisLabels = labels || formatWaveformAxisLabels(null, null);
        const labelW = Math.max(30, Math.min(W, 64));
        ctx.save();
        ctx.fillStyle = bgColor;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(0, 0, labelW, H);
        ctx.globalAlpha = 1;
        ctx.fillStyle = mutedColor;
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(axisLabels[0], labelW - 2, 1);
        ctx.textBaseline = 'middle';
        ctx.fillText(axisLabels[1], labelW - 2, H / 2);
        ctx.textBaseline = 'bottom';
        ctx.fillText(axisLabels[2], labelW - 2, H - 1);
        ctx.save();
        ctx.translate(8, H / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(axisLabels[3], 0, 0);
        ctx.restore();
        ctx.restore();
    }
    function drawSpectrogram(canvas: RuntimeElement, result: ComparisonTrackState, trackIndex: number, channelIndex: number, offsetSeconds: number) {
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const axisCanvas = document.getElementById(trackAxisCanvasId(trackIndex, channelIndex));
        const axisCtx = axisCanvas ? axisCanvas.getContext('2d') : null;
        if (axisCtx) {
            axisCtx.clearRect(0, 0, axisCanvas.width, axisCanvas.height);
        }
        const ch = channelsForResult(result)[channelIndex];
        if (!ch || !ch.spectrogram) {
            requestTrackDetail(trackIndex);
            ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(STR.spectrogramLoading, W / 2, H / 2);
            return;
        }
        const spec = ch.spectrogram;
        const tBins = spec.timeBins;
        const fBins = spec.frequencyBins;
        const dur = result.durationSeconds || 1;
        const gs = computeGlobalSpan();
        const trackStart = (offsetSeconds - gs.startSec) / gs.spanSec;
        const trackDurRatio = dur / gs.spanSec;
        const dispCfg = __spectrogramSettings.display;
        const dbLo = (dispCfg.dbMin != null) ? dispCfg.dbMin : spec.minDb;
        const dbHi = (dispCfg.dbMax != null) ? dispCfg.dbMax : spec.maxDb;
        const maxFreq = (dispCfg.maxFrequencyHz != null) ? Math.min(dispCfg.maxFrequencyHz, spec.maxFrequencyHz) : spec.maxFrequencyHz;
        const freqPerBin = spec.maxFrequencyHz / Math.max(fBins, 1);
        const plotW = spectrogramPlotWidth(W);
        const imageData = ctx.createImageData(plotW, H);
        const data = imageData.data;
        for (let px = 0; px < plotW; px++) {
            const tNorm = zoomStart + (px / plotW) * (zoomEnd - zoomStart);
            const tAdj = (tNorm - trackStart) / trackDurRatio;
            const tIdx = Math.floor(tAdj * tBins);
            if (tIdx < 0 || tIdx >= tBins) {
                continue;
            }
            for (let py = 0; py < H; py++) {
                const fIdx = Math.floor((1 - py / H) * fBins);
                if (fIdx < 0 || fIdx >= fBins) {
                    continue;
                }
                const fHz = fIdx * freqPerBin;
                if (fHz > maxFreq) {
                    continue;
                }
                const val = (spec.values[tIdx] && spec.values[tIdx][fIdx] !== undefined)
                    ? spec.values[tIdx][fIdx] : dbLo;
                const range = dbHi - dbLo;
                const norm = range !== 0
                    ? Math.max(0, Math.min(1, (val - dbLo) / range))
                    : 0;
                const off = (py * plotW + px) * 4;
                const rgb = dbToRgb(norm);
                data[off] = rgb[0];
                data[off + 1] = rgb[1];
                data[off + 2] = rgb[2];
                data[off + 3] = 255;
            }
        }
        ctx.putImageData(imageData, 0, 0);
        if (axisCtx) {
            drawSpectrogramFrequencyAxis(axisCtx, axisCanvas.width, axisCanvas.height, spec, { maxFreq: maxFreq });
        }
        drawSpectrogramColorbar(ctx, W, H, spec, { dbLo: dbLo, dbHi: dbHi });
        drawLoopRegionOnCanvas(ctx, plotW, H);
        drawCursorOnCanvas(ctx, plotW, H);
        drawHoverLineOnCanvas(ctx, plotW, H);
    }
    function drawSpectrogramFrequencyAxis(ctx: CanvasRenderingContext2D, W: number, H: number, spec: SpectrogramData, opts: { maxFreq?: number } = {}): void {
        const mutedColor = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
        const bgColor = getComputedStyle(document.body).getPropertyValue('--track-bg').trim() || 'rgba(0,0,0,0.55)';
        const o = opts || {};
        const maxHz = (o.maxFreq != null) ? o.maxFreq : spec.maxFrequencyHz;
        ctx.save();
        ctx.fillStyle = bgColor;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.fillStyle = mutedColor;
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(formatHz(maxHz), W - 2, 1);
        ctx.textBaseline = 'middle';
        ctx.fillText(formatHz(maxHz / 2), W - 2, H / 2);
        ctx.textBaseline = 'bottom';
        ctx.fillText('0 Hz', W - 2, H - 1);
        ctx.save();
        ctx.translate(9, H / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Freq', 0, 0);
        ctx.restore();
        ctx.restore();
    }
    function drawSpectrogramColorbar(ctx: CanvasRenderingContext2D, W: number, H: number, spec: SpectrogramData, opts: { dbLo?: number; dbHi?: number } = {}): void {
        const mutedColor = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
        const bgColor = getComputedStyle(document.body).getPropertyValue('--track-bg').trim() || 'rgba(0,0,0,0.55)';
        const cbStripW = SPECTROGRAM_COLORBAR_WIDTH;
        const o = opts || {};
        const dbLo = (o.dbLo != null) ? o.dbLo : spec.minDb;
        const dbHi = (o.dbHi != null) ? o.dbHi : spec.maxDb;
        ctx.save();
        ctx.fillStyle = bgColor;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(W - cbStripW, 0, cbStripW, H);
        ctx.globalAlpha = 1;
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
                grad.data[off] = rgb[0];
                grad.data[off + 1] = rgb[1];
                grad.data[off + 2] = rgb[2];
                grad.data[off + 3] = 255;
            }
        }
        ctx.putImageData(grad, cbX, cbY);
        ctx.fillStyle = mutedColor;
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const unit = dbLevelUnitFor(spec);
        ctx.fillText(dbHi.toFixed(0) + ' ' + unit, cbX + cbW + 2, cbY);
        ctx.textBaseline = 'bottom';
        ctx.fillText(dbLo.toFixed(0) + ' ' + unit, cbX + cbW + 2, cbY + cbH);
        ctx.restore();
    }
    function spectrogramPlotWidth(canvasWidth: number) {
        return Math.max(1, canvasWidth - SPECTROGRAM_COLORBAR_WIDTH);
    }
    function trackCanvasTimeHit(canvas: RuntimeElement, clientX: number) {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const timeWidth = contentType === 'spectrogram'
            ? spectrogramPlotWidth(canvas.width)
            : canvas.width;
        if (x < 0 || x > timeWidth) {
            return null;
        }
        return {
            x: x,
            timeWidth: timeWidth,
            norm: zoomStart + (x / timeWidth) * (zoomEnd - zoomStart),
        };
    }
    function clampedTrackCanvasNorm(canvas: RuntimeElement, clientX: number, timeWidth: number) {
        const rect = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(timeWidth, clientX - rect.left));
        return Math.max(0, Math.min(1, zoomStart + (x / timeWidth) * (zoomEnd - zoomStart)));
    }
    function dbLevelUnitFor(value: { unit?: string } | null): string {
        return value && value.unit ? value.unit : 'dB';
    }
    function dbLevelAxisLabelFor(value: { axisLabel?: string }): string {
        return value && value.axisLabel ? value.axisLabel : 'Spectrum level [dB]';
    }
    function formatDbLevel(value: number, source: { unit?: string } | null): string {
        return value.toFixed(0) + ' ' + dbLevelUnitFor(source);
    }
    function spectrumLevelAxisLabel(result: ComparisonTrackState) {
        return result && result.units && result.units.spectrumLevel && result.units.spectrumLevel.axisLabel
            ? result.units.spectrumLevel.axisLabel
            : 'Spectrum level [dB]';
    }
    function formatHz(hz: number) {
        if (hz >= 1000) {
            return (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + ' kHz';
        }
        return Math.round(hz) + ' Hz';
    }
    function formatReadoutHz(hz: number) {
        const rounded = Math.round(hz);
        const value = Math.abs(hz - rounded) < 0.05 ? String(rounded) : hz.toFixed(1);
        return value + ' Hz';
    }
    function dbToRgb(norm: number) {
        if (norm < 0.25) {
            const t = norm / 0.25;
            return [Math.floor(68 + t * (59 - 68)), Math.floor(1 + t * (82 - 1)), Math.floor(84 + t * (139 - 84))];
        }
        if (norm < 0.5) {
            const t = (norm - 0.25) / 0.25;
            return [Math.floor(59 + t * (33 - 59)), Math.floor(82 + t * (145 - 82)), Math.floor(139 + t * (140 - 139))];
        }
        if (norm < 0.75) {
            const t = (norm - 0.5) / 0.25;
            return [Math.floor(33 + t * (94 - 33)), Math.floor(145 + t * (201 - 145)), Math.floor(140 + t * (98 - 140))];
        }
        const t = (norm - 0.75) / 0.25;
        return [Math.floor(94 + t * (253 - 94)), Math.floor(201 + t * (231 - 201)), Math.floor(98 + t * (37 - 98))];
    }
    function drawCursorOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        const x = (cursorNorm - zoomStart) / (zoomEnd - zoomStart) * W;
        if (x < 0 || x > W) {
            return;
        }
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
    function drawHoverLineOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        if (hoverNorm === null) {
            return;
        }
        const x = (hoverNorm - zoomStart) / (zoomEnd - zoomStart) * W;
        if (x < 0 || x > W) {
            return;
        }
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
    function drawLoopRegionOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        if (!loopRegion) {
            return;
        }
        if (typeof window.paintLoopRegion === 'function') {
            window.paintLoopRegion(ctx, W, H, loopRegion.start, loopRegion.end, zoomStart, zoomEnd);
        }
    }
    function drawRectZoomSelectionOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number, trackIndex: number) {
        if (!rectZoomSelection || rectZoomSelection.trackId !== trackIdAtIndex(trackIndex)) {
            return;
        }
        const span = zoomEnd - zoomStart;
        if (span <= 0) {
            return;
        }
        const x0 = (rectZoomSelection.startNorm - zoomStart) / span * W;
        const x1 = (rectZoomSelection.endNorm - zoomStart) / span * W;
        const y0 = amplitudeNormToCanvasY(rectZoomSelection.startAmpNorm, H);
        const y1 = amplitudeNormToCanvasY(rectZoomSelection.endAmpNorm, H);
        const left = Math.max(0, Math.min(x0, x1));
        const right = Math.min(W, Math.max(x0, x1));
        const top = Math.max(0, Math.min(y0, y1));
        const bottom = Math.min(H, Math.max(y0, y1));
        if (right <= left || bottom <= top) {
            return;
        }
        ctx.save();
        ctx.fillStyle = 'rgba(100, 160, 255, 0.16)';
        ctx.strokeStyle = 'rgba(100, 160, 255, 0.95)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.strokeRect(left, top, right - left, bottom - top);
        ctx.restore();
    }
    function updateVisibility() {
        // まず各行の display を更新する
        document.querySelectorAll('.track-row').forEach(function (row) {
            const trackId = trackIdFromElement(row);
            if (trackId) {
                var isMuted = trackStore.require(trackId).runtime.hidden;
                row.style.display = isMuted ? 'none' : 'flex';
            }
        });
        // 次に空状態を判定する（削除済み or 全非表示）
        const emptyState = document.getElementById('empty-state');
        if (emptyState) {
            const visibleRows = Array.from(document.querySelectorAll('.track-row')).filter(function (row) {
                return row.style.display !== 'none';
            });
            emptyState.classList.toggle('is-visible', visibleRows.length === 0);
        }
    }
    function updateOffsetDisplays() {
        state.results.forEach(function (_, i: number) {
            const el = document.getElementById('offset-val-' + i);
            if (!el) {
                return;
            }
            const off = trackRuntimeAt(i).offsetSeconds;
            el.textContent = (off >= 0 ? '+' : '') + off.toFixed(3) + 's';
        });
    }
    function getTrackAudio(idx: number) {
        return document.getElementById('track-audio-' + idx);
    }
    function getTrackTimeMapping(idx: number) {
        const result = state.results[idx];
        if (!result) {
            return null;
        }
        const durationSeconds = result.durationSeconds || 0;
        const gs = computeGlobalSpan();
        return createTrackTimeMapping(durationSeconds, trackRuntimeAt(idx).offsetSeconds, {
            startSeconds: gs.startSec,
            spanSeconds: gs.spanSec,
        });
    }
    function globalNormFromTrackTime(idx: number, timeSeconds: number) {
        const mapping = getTrackTimeMapping(idx);
        if (!mapping) {
            return null;
        }
        return mapGlobalNormFromTrackTime(mapping, timeSeconds);
    }
    function trackTimeFromGlobalNorm(idx: number, norm: number) {
        const mapping = getTrackTimeMapping(idx);
        if (!mapping) {
            return null;
        }
        return mapTrackTimeFromGlobalNorm(mapping, norm);
    }
    function trackStartNorm(idx: number) {
        const mapping = getTrackTimeMapping(idx);
        return mapping ? mapping.trackStart : 0;
    }
    function updatePlaybackButtons() {
        state.results.forEach(function (_, i: number) {
            const trackId = trackIdAtIndex(i);
            if (!trackId) {
                return;
            }
            const playBtn = document.querySelector('[data-action="toggle-playback"][data-track-id="' + trackId + '"]');
            const stopBtn = document.querySelector('[data-action="stop-playback"][data-track-id="' + trackId + '"]');
            const isActive = playbackTrackId === trackId && playbackEl !== null;
            const isPlaying = isActive && playbackEl !== null && !playbackEl.paused;
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
        if (!badge) {
            return;
        }
        badge.style.display = (loopRegion && playbackEl && !playbackEl.paused) ? 'inline' : 'none';
        updateLoopTimeDisplay();
    }
    function updateLoopTimeDisplay() {
        const el = document.getElementById('loop-time-display');
        if (!el) {
            return;
        }
        if (!loopRegion) {
            el.style.display = 'none';
            return;
        }
        const gs = computeGlobalSpan();
        const startSec = gs.startSec + loopRegion.start * gs.spanSec;
        const endSec = gs.startSec + loopRegion.end * gs.spanSec;
        el.textContent = formatTime(startSec) + ' – ' + formatTime(endSec);
        el.style.display = 'inline';
    }
    function clearPlaybackState() {
        if (playbackEl && !playbackEl.paused) {
            playbackEl.pause();
        }
        playbackEl = null;
        playbackTrackId = null;
        stopPlaybackLoop();
        updatePlaybackButtons();
        updateLoopBadge();
        updatePlaybackDisplay(null);
    }
    function startPlaybackLoop() {
        if (playbackRafId !== null) {
            return;
        }
        function tick() {
            const playbackTrackIndex = playbackTrackId ? trackStore.protocolIndexForId(playbackTrackId) : null;
            if (playbackEl && playbackTrackIndex !== null && !playbackEl.paused) {
                if (loopRegion) {
                    const currentGlobalNorm = globalNormFromTrackTime(playbackTrackIndex, playbackEl.currentTime);
                    if (currentGlobalNorm !== null && currentGlobalNorm >= loopRegion.end) {
                        const loopStartTime = trackTimeFromGlobalNorm(playbackTrackIndex, loopRegion.start);
                        if (loopStartTime !== null) {
                            try {
                                playbackEl.currentTime = loopStartTime;
                            }
                            catch (_err) { }
                        }
                    }
                }
                const nextCursor = globalNormFromTrackTime(playbackTrackIndex, playbackEl.currentTime);
                if (nextCursor !== null) {
                    cursorNorm = nextCursor;
                    if (followCursor) {
                        const span = zoomEnd - zoomStart;
                        zoomStart = Math.max(0, nextCursor - span / 2);
                        zoomEnd = zoomStart + span;
                        if (zoomEnd > 1) {
                            zoomEnd = 1;
                            zoomStart = Math.max(0, 1 - span);
                        }
                    }
                    updateCursorDisplay(nextCursor);
                    scheduleRender();
                    scheduleSpectrumRefresh('playback');
                }
                updatePlaybackDisplay(playbackEl.currentTime);
            }
            else {
                updatePlaybackDisplay(null);
            }
            updateLoopBadge();
            playbackRafId = requestAnimationFrame(tick);
        }
        playbackRafId = requestAnimationFrame(tick);
    }
    function stopPlaybackLoop() {
        if (playbackRafId !== null) {
            cancelAnimationFrame(playbackRafId);
            playbackRafId = null;
        }
    }
    function stopPlayback(trackId: TrackId | null, options: { keepCursor?: boolean } = {}): void {
        const trackIndex = trackId ? trackStore.protocolIndexForId(trackId) : null;
        const audio = trackIndex === null ? playbackEl : getTrackAudio(trackIndex);
        if (audio) {
            audio.pause();
            try {
                audio.currentTime = 0;
            }
            catch (_err) { }
        }
        if (trackId === playbackTrackId) {
            if (!options || options.keepCursor !== true) {
                cursorNorm = playbackStartNorm;
                updateCursorDisplay(cursorNorm);
            }
            clearPlaybackState();
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
            return;
        }
        updatePlaybackButtons();
    }
    function togglePlayback(trackId: TrackId) {
        const idx = trackIndexForId(trackId);
        const audio = getTrackAudio(idx);
        if (!audio) {
            return;
        }
        if (playbackTrackId === trackId && playbackEl === audio && !audio.paused) {
            audio.pause();
            updatePlaybackButtons();
            stopPlaybackLoop();
            scheduleSpectrumRefresh('immediate');
            return;
        }
        if (playbackTrackId !== null && playbackTrackId !== trackId) {
            // 再生開始位置にカーソルを戻してからトラックを切り替え
            cursorNorm = playbackStartNorm;
            updateCursorDisplay(cursorNorm);
            stopPlayback(playbackTrackId, { keepCursor: true });
        }
        playbackTrackId = trackId;
        playbackEl = audio;
        const durationSeconds = audio.duration || state.results[idx].durationSeconds || 0;
        const startNorm = loopRegion ? loopRegion.start : cursorNorm;
        let startTime = trackTimeFromGlobalNorm(idx, startNorm);
        if (startTime === null) {
            startTime = 0;
        }
        if (durationSeconds > 0 && startTime >= Math.max(0, durationSeconds - 0.05)) {
            startTime = 0;
        }
        try {
            audio.currentTime = startTime;
        }
        catch (_err) { }
        playbackStartNorm = loopRegion ? loopRegion.start : cursorNorm;
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(function () {
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
        scheduleSpectrumRefresh('immediate');
    }
    function attachAudioEvents() {
        state.results.forEach(function (_, i: number) {
            const trackId = trackIdAtIndex(i);
            if (!trackId) {
                return;
            }
            const audio = getTrackAudio(i);
            if (!audio) {
                return;
            }
            audio.addEventListener('play', function () {
                playbackEl = audio;
                playbackTrackId = trackId;
                updatePlaybackButtons();
                startPlaybackLoop();
            });
            audio.addEventListener('pause', function () {
                if (playbackTrackId === trackId) {
                    updatePlaybackButtons();
                    if (audio.ended) {
                        stopPlayback(trackId, { keepCursor: true });
                    }
                }
            });
            audio.addEventListener('ended', function () {
                if (playbackTrackId === trackId) {
                    const endNorm = globalNormFromTrackTime(i, state.results[i].durationSeconds || 0);
                    if (endNorm !== null) {
                        cursorNorm = endNorm;
                        updateCursorDisplay(endNorm);
                    }
                    clearPlaybackState();
                    scheduleRender();
                    scheduleSpectrumRefresh('immediate');
                }
            });
            audio.addEventListener('error', function () {
                if (playbackTrackId === trackId) {
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
        function attachToolbarActions(containerId: string) {
            const container = document.getElementById(containerId);
            if (!container) {
                return;
            }
            container.addEventListener('click', function (e) {
                const target = eventTarget(e) && eventTarget(e).closest ? eventTarget(e).closest('[data-action]') : eventTarget(e);
                const action = target && target.getAttribute ? target.getAttribute('data-action') : null;
                if (!action || action === 'track-height-input' || action === 'spectrum-height-input') {
                    return;
                }
                handleToolbarAction(action);
            });
            container.addEventListener('input', function (e) {
                const target = eventTarget(e);
                const action = target && target.getAttribute ? target.getAttribute('data-action') : null;
                applyHeightInput(action, target ? target.value : null);
            });
            container.addEventListener('change', function (e) {
                const target = eventTarget(e);
                const action = target && target.getAttribute ? target.getAttribute('data-action') : null;
                applyHeightInput(action, target ? target.value : null);
            });
        }
        attachToolbarActions('toolbar');
        attachToolbarActions('spectrum-zoom-toolbar');
        const toolbarForMenus = document.getElementById('toolbar');
        if (toolbarForMenus) {
            toolbarForMenus.querySelectorAll('details.tb-menu').forEach(function (menu: RuntimeElement) {
                menu.addEventListener('toggle', function () {
                    if (!menu.open) {
                        return;
                    }
                    toolbarForMenus.querySelectorAll('details.tb-menu[open]').forEach(function (otherMenu: RuntimeElement) {
                        if (otherMenu !== menu) {
                            otherMenu.open = false;
                        }
                    });
                });
            });
        }
        function handleHeightResizeStart(e: MouseEvent): void {
            const target = eventTarget(e) && eventTarget(e).closest
                ? eventTarget(e).closest('[data-action="track-height-drag"], [data-action="spectrum-height-drag"]')
                : null;
            if (!target) {
                return;
            }
            const action = target.getAttribute('data-action');
            beginHeightResize(action === 'track-height-drag' ? 'track' : 'spectrum', e.clientY || 0);
            e.preventDefault();
        }
        const tracksWrapperForHeight = document.getElementById('tracks-wrapper');
        if (tracksWrapperForHeight) {
            tracksWrapperForHeight.addEventListener('mousedown', handleHeightResizeStart);
        }
        const spectrumSectionForHeight = document.getElementById('spectrum-section');
        if (spectrumSectionForHeight) {
            spectrumSectionForHeight.addEventListener('mousedown', handleHeightResizeStart);
        }
        document.addEventListener('mousedown', handleHeightResizeStart);
        window.addEventListener('mousedown', handleHeightResizeStart, true);
        function handleHeightResizeMove(e: MouseEvent): void {
            updateHeightResize(e.clientY || 0);
            if (heightResizeDrag) {
                e.preventDefault();
            }
        }
        function handleHeightResizeEnd() {
            endHeightResize();
        }
        document.addEventListener('mousemove', handleHeightResizeMove);
        window.addEventListener('mousemove', handleHeightResizeMove, true);
        document.addEventListener('mouseup', handleHeightResizeEnd);
        window.addEventListener('mouseup', handleHeightResizeEnd, true);
        const loopTimeDisplayEl = document.getElementById('loop-time-display');
        if (loopTimeDisplayEl) {
            loopTimeDisplayEl.addEventListener('click', function () {
                if (!loopRegion) {
                    return;
                }
                if (!navigator.clipboard || !navigator.clipboard.writeText) {
                    return;
                }
                const gs = computeGlobalSpan();
                const startSec = gs.startSec + loopRegion.start * gs.spanSec;
                const endSec = gs.startSec + loopRegion.end * gs.spanSec;
                navigator.clipboard.writeText(formatTime(startSec) + ' – ' + formatTime(endSec)).catch(function () { });
            });
        }
        document.getElementById('tracks-wrapper').addEventListener('click', function (e) {
            const tgt = eventTarget(e);
            const action = tgt.getAttribute ? tgt.getAttribute('data-action') : null;
            const trackId = trackIdFromElement(tgt);
            const idx = trackId ? trackStore.protocolIndexForId(trackId) : null;
            if (action === 'toggle-playback' && trackId) {
                togglePlayback(trackId);
            }
            if (action === 'stop-playback' && trackId) {
                stopPlayback(trackId);
            }
            if (action === 'remove-track' && trackId) {
                removeTrack(trackId);
            }
            if (action === 'offset-up' && idx !== null) {
                adjustOffset(idx, 0.01);
            }
            if (action === 'offset-down' && idx !== null) {
                adjustOffset(idx, -0.01);
            }
            if (action === 'pick-color' && trackId) {
                var anchor = tgt.closest ? tgt.closest('[data-action="pick-color"]') : tgt;
                openColorPicker(trackId, anchor);
            }
        });
        document.getElementById('tracks-wrapper').addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') {
                return;
            }
            var tgt2 = eventTarget(e);
            var action2 = tgt2.getAttribute ? tgt2.getAttribute('data-action') : null;
            const trackId2 = trackIdFromElement(tgt2);
            if (action2 === 'pick-color' && trackId2) {
                e.preventDefault();
                var anchor2 = tgt2.closest ? tgt2.closest('[data-action="pick-color"]') : tgt2;
                openColorPicker(trackId2, anchor2);
            }
        });
        let _offsetEditTimer: number | null = null;
        document.getElementById('tracks-wrapper').addEventListener('dblclick', function (e) {
            if (eventTarget(e).classList.contains('track-offset-val')) {
                if (_offsetEditTimer !== null) {
                    clearTimeout(_offsetEditTimer);
                }
                _offsetEditTimer = null;
                const idx = trackIndexFromElement(eventTarget(e));
                if (idx !== null) {
                    trackRuntimeAt(idx).offsetSeconds = 0;
                    updateOffsetDisplays();
                    scheduleRender();
                    scheduleSpectrumRefresh('immediate');
                }
            }
        });
        // 波形キャンバス・軸キャンバスのダブルクリック → ズームリセット
        document.getElementById('tracks-wrapper').addEventListener('dblclick', function (e) {
            const targetCanvas = eventTarget(e).closest
                ? (eventTarget(e).closest('.track-canvas') || eventTarget(e).closest('.track-axis-canvas'))
                : null;
            if (!targetCanvas) {
                return;
            }
            resetZoom();
        });
        document.getElementById('tracks-wrapper').addEventListener('click', function (e) {
            if (!eventTarget(e).classList.contains('track-offset-val')) {
                return;
            }
            const span = eventTarget(e);
            const idx = trackIndexFromElement(span);
            if (idx === null) {
                return;
            }
            // Don't open if already editing
            if (span.style.display === 'none') {
                return;
            }
            // Delay to allow dblclick (reset) to cancel before opening editor
            if (_offsetEditTimer !== null) {
                clearTimeout(_offsetEditTimer);
            }
            _offsetEditTimer = setTimeout(function () {
                _offsetEditTimer = null;
                if (span.style.display === 'none') {
                    return;
                }
                const currentMs = Math.round(trackRuntimeAt(idx).offsetSeconds * 1000);
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'track-offset-input';
                input.value = String(currentMs);
                input.placeholder = STR.offsetEditPlaceholder;
                input.setAttribute('aria-label', STR.offsetEditAriaLabel);
                span.style.display = 'none';
                span.parentNode.insertBefore(input, span);
                input.focus();
                input.select();
                let settled = false;
                function commitEdit() {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    const val = parseFloat(input.value);
                    if (!isNaN(val)) {
                        trackRuntimeAt(idx!).offsetSeconds = val / 1000;
                    }
                    if (input.parentNode) {
                        input.parentNode.removeChild(input);
                    }
                    span.style.display = '';
                    updateOffsetDisplays();
                    scheduleRender();
                    scheduleSpectrumRefresh('immediate');
                }
                function cancelEdit() {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    if (input.parentNode) {
                        input.parentNode.removeChild(input);
                    }
                    span.style.display = '';
                }
                input.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        commitEdit();
                    }
                    else if (ev.key === 'Escape') {
                        ev.preventDefault();
                        cancelEdit();
                    }
                });
                input.addEventListener('blur', function () { commitEdit(); });
            }, 200); // end setTimeout
        });
        document.getElementById('tracks-wrapper').addEventListener('mousemove', function (e) {
            handleCanvasMouseMove(e);
        });
        document.getElementById('tracks-wrapper').addEventListener('mouseleave', clearHover);
        document.getElementById('tracks-wrapper').addEventListener('mousedown', function (e) {
            handleCanvasMouseDown(e);
        });
        document.addEventListener('mousemove', function (e) { handleDocMouseMove(e); });
        document.addEventListener('mouseup', function (e) { handleDocMouseUp(e); });
        document.getElementById('tracks-wrapper').addEventListener('wheel', function (e) {
            if (e.ctrlKey) {
                e.preventDefault();
                handleZoomWheel(e);
            }
            else if (e.shiftKey) {
                e.preventDefault();
                handlePanWheel(e);
            }
        }, { passive: false });
        var stackedWrap = document.getElementById('stacked-wrap');
        if (stackedWrap) {
            stackedWrap.addEventListener('dragstart', function (e) {
                var handle = eventTarget(e).closest ? eventTarget(e).closest('.track-drag-handle') : null;
                if (!handle) {
                    e.preventDefault();
                    return;
                }
                reorderDragFrom = trackIdFromElement(handle);
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                }
                const dragIndex = reorderDragFrom ? trackStore.protocolIndexForId(reorderDragFrom) : null;
                var row = dragIndex === null ? null : document.getElementById('track-row-' + dragIndex);
                if (row) {
                    row.style.opacity = '0.4';
                }
            });
            stackedWrap.addEventListener('dragover', function (e) {
                if (reorderDragFrom === null) {
                    return;
                }
                e.preventDefault();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'move';
                }
                var row = eventTarget(e).closest ? eventTarget(e).closest('.track-row') : null;
                document.querySelectorAll('.track-row').forEach(function (r) { r.classList.remove('drag-over'); });
                if (row) {
                    var toId = trackIdFromElement(row);
                    if (toId && toId !== reorderDragFrom) {
                        row.classList.add('drag-over');
                    }
                }
            });
            stackedWrap.addEventListener('drop', function (e) {
                if (reorderDragFrom === null) {
                    return;
                }
                e.preventDefault();
                var row = eventTarget(e).closest ? eventTarget(e).closest('.track-row') : null;
                if (row) {
                    var toId = trackIdFromElement(row);
                    if (toId && toId !== reorderDragFrom) {
                        reorderTracks(reorderDragFrom, toId);
                    }
                }
                cleanupReorderDrag();
            });
            stackedWrap.addEventListener('dragend', function () {
                cleanupReorderDrag();
            });
        }
        function handleLayoutResize() {
            scheduleRender();
            scheduleSpectrumRefresh('interactive');
        }
        window.addEventListener('resize', handleLayoutResize);
        if (typeof ResizeObserver === 'function') {
            const layoutObserver = new ResizeObserver(function () { handleLayoutResize(); });
            ['tracks-wrapper', 'ruler-row', 'spectrum-overlay-wrap'].forEach(function (id: string) {
                const el = document.getElementById(id);
                if (el) {
                    layoutObserver.observe(el);
                }
            });
            state.results.forEach(function (result: ComparisonTrackState, i: number) {
                channelsForResult(result).forEach(function (_, channelIndex: number) {
                    const waveWrap = document.getElementById('track-canvas-wrap-' + i + channelCanvasSuffix(channelIndex));
                    if (waveWrap) {
                        layoutObserver.observe(waveWrap);
                    }
                    const spectrumWrap = document.getElementById('track-spectrum-wrap-' + i + channelCanvasSuffix(channelIndex));
                    if (spectrumWrap) {
                        layoutObserver.observe(spectrumWrap);
                    }
                });
            });
        }
        attachAudioEvents();
        updatePlaybackButtons();
        function attachTrackCanvasFocusEvents() {
            document.querySelectorAll('.track-canvas').forEach(function (canvas: RuntimeElement) {
                canvas.addEventListener('focus', function () {
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
                canvas.addEventListener('blur', function () {
                    hideTooltip();
                    canvas.style.outline = 'none';
                });
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.ctrlKey || e.metaKey || e.altKey) {
                return;
            }
            const active = document.activeElement;
            const spectrumCanvasFocused = active && (active.id === 'spectrum-overlay-canvas'
                || (active.classList && active.classList.contains('track-spectrum-canvas')));
            // ── スペクトルカーソル操作（マウス hover またはスペクトル canvas フォーカス時）──
            if ((spectrumHasMouse || spectrumCanvasFocused) && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
                e.preventDefault();
                moveSpectrumHoverByBin(e.code === 'ArrowLeft' ? -1 : 1);
                scheduleSpectrumRefresh('hover');
                return;
            }
            // ── 時刻カーソル操作（波形キャンバスフォーカス時）──
            // ── Help overlay が開いている間はショートカットを無効化 ──
            const helpEl = document.getElementById('help-overlay');
            if (helpEl && !helpEl.hidden) {
                return;
            }
            // ── グローバルショートカット (入力要素以外で有効) ──
            const activeTag2 = (active && active.tagName) ? active.tagName.toUpperCase() : '';
            const isInputFocused = activeTag2 === 'INPUT' || activeTag2 === 'TEXTAREA' || activeTag2 === 'SELECT';
            if (!isInputFocused) {
                // +/= → zoom in、- → zoom out、0 → zoom reset
                if (e.key === '+' || e.key === '=') {
                    e.preventDefault();
                    zoomIn();
                    return;
                }
                if (e.key === '-' || e.key === '_') {
                    e.preventDefault();
                    zoomOut();
                    return;
                }
                if (e.key === '0') {
                    e.preventDefault();
                    resetZoom();
                    return;
                }
                // F → follow-cursor トグル
                if (e.key === 'f' || e.key === 'F') {
                    e.preventDefault();
                    followCursor = !followCursor;
                    const fcBtn = document.querySelector('[data-action="toggle-follow-cursor"]');
                    if (fcBtn) {
                        fcBtn.classList.toggle('is-active', followCursor);
                    }
                    scheduleRender();
                    return;
                }
                // L → zoom-to-selection (ループ選択範囲にズーム)
                if (e.key === 'l' || e.key === 'L') {
                    e.preventDefault();
                    zoomToSelection();
                    return;
                }
            }
            // ── Space: グローバル再生/停止トグル (入力要素以外で有効) ──
            if (e.code === 'Space') {
                const tag = (active && active.tagName) ? active.tagName.toUpperCase() : '';
                if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
                    e.preventDefault();
                    if (active && active.classList.contains('track-canvas')) {
                        const trackId = trackIdFromElement(active);
                        if (trackId) {
                            togglePlayback(trackId);
                        }
                    }
                    else {
                        const trackId = playbackTrackId ?? trackStore.activeIds()[0];
                        if (trackId) {
                            togglePlayback(trackId);
                        }
                    }
                    return;
                }
            }
            // ── 以下は track-canvas フォーカス時のみ ──
            if (!active || !active.classList.contains('track-canvas')) {
                return;
            }
            if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                e.preventDefault();
                const W = active.width || 800;
                let delta;
                if (e.shiftKey) {
                    const gs = computeGlobalSpan();
                    delta = gs.spanSec > 0 ? (0.1 / gs.spanSec) : 0.001;
                }
                else {
                    delta = (zoomEnd - zoomStart) / W;
                }
                if (e.code === 'ArrowLeft') {
                    delta = -delta;
                }
                cursorNorm = Math.max(0, Math.min(1, cursorNorm + delta));
                updateCursorDisplay(cursorNorm);
                scheduleRender();
            }
        });
        document.addEventListener('keyup', function (e) {
            if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                scheduleSpectrumRefresh('immediate');
            }
        });
        // スペクトルカーソルイベント（オーバーレイ＋各トラック）
        (function attachSpectrumCursorEvents() {
            function spectrumFocusTargetFromElement(el: RuntimeElement): { trackIndex: number; channelIndex: number | null } | null {
                if (!el) {
                    return null;
                }
                if (el.id === 'spectrum-overlay-canvas') {
                    return { trackIndex: -1, channelIndex: null };
                }
                if (el.classList && el.classList.contains('track-spectrum-canvas')) {
                    const idx = trackIndexFromElement(el);
                    const channelIndex = parseInt(el.getAttribute('data-channel-index'), 10);
                    return idx === null ? null : { trackIndex: idx, channelIndex: isNaN(channelIndex) ? null : channelIndex };
                }
                return null;
            }
            function setSpectrumFocusTarget(trackIndex: number, channelIndex: number | null) {
                if (spectrumHoverNorm === null) {
                    spectrumHoverNorm = 0;
                }
                if (spectrumHoverYFrac === null) {
                    spectrumHoverYFrac = 0.5;
                }
                spectrumHoverTrackId = trackIndex < 0 ? 'overlay' : trackIdAtIndex(trackIndex);
                spectrumHoverChannelIndex = Number.isInteger(channelIndex) ? channelIndex : null;
                spectrumHasMouse = false;
                scheduleSpectrumRefresh('hover');
            }
            function clearSpectrumFocusTarget() {
                spectrumHoverNorm = null;
                spectrumHoverYFrac = null;
                spectrumHoverTrackId = null;
                spectrumHoverChannelIndex = null;
                scheduleSpectrumRefresh('hover');
            }
            function onSpectrumMove(padL: number, padR: number, canvasEl: RuntimeElement, e: MouseEvent, trackIndex: number | null, channelIndex: number | null) {
                const rect = canvasEl.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const plotW = canvasEl.width - padL - padR;
                const canvasH = canvasEl.height || 140;
                if (plotW <= 0) {
                    spectrumHasMouse = false;
                    clearSpectrumFocusTarget();
                    return;
                }
                spectrumHoverNorm = Math.max(0, Math.min(1, (x - padL) / plotW));
                spectrumHoverYFrac = Math.max(0, Math.min(1, y / canvasH));
                spectrumHoverTrackId = trackIndex === null || trackIndex < 0 ? 'overlay' : trackIdAtIndex(trackIndex);
                spectrumHoverChannelIndex = Number.isInteger(channelIndex) ? channelIndex : null;
                spectrumHasMouse = true;
                scheduleSpectrumRefresh('hover');
            }
            function onSpectrumLeave() {
                spectrumHasMouse = false;
                const focused = spectrumFocusTargetFromElement(document.activeElement);
                if (focused) {
                    setSpectrumFocusTarget(focused.trackIndex, focused.channelIndex);
                    return;
                }
                clearSpectrumFocusTarget();
            }
            function onSpectrumFocus(trackIndex: number | null, channelIndex: number | null) {
                if (trackIndex === null) {
                    clearSpectrumFocusTarget();
                    return;
                }
                setSpectrumFocusTarget(trackIndex, channelIndex);
            }
            function onSpectrumBlur() {
                if (spectrumHasMouse) {
                    return;
                }
                clearSpectrumFocusTarget();
            }
            const overlayCanvas = document.getElementById('spectrum-overlay-canvas');
            if (overlayCanvas) {
                overlayCanvas.addEventListener('mousemove', function (e) {
                    if (specDragAnchor !== null) {
                        return;
                    } // ドラッグ中はホバー不要
                    onSpectrumMove(36, 8, overlayCanvas, e, -1, null);
                });
                overlayCanvas.addEventListener('mouseleave', onSpectrumLeave);
                overlayCanvas.addEventListener('focus', function () { onSpectrumFocus(-1, null); });
                overlayCanvas.addEventListener('blur', onSpectrumBlur);
                overlayCanvas.addEventListener('mousedown', function (e) {
                    if (e.button !== 0) {
                        return;
                    }
                    const rect = overlayCanvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const padL = 36, padR = 8, padT = 8, padB = 18;
                    const plotW = overlayCanvas.width - padL - padR;
                    const plotH = overlayCanvas.height - padT - padB;
                    if (plotW <= 0 || plotH <= 0) {
                        return;
                    }
                    const freqNorm = Math.max(0, Math.min(1, (x - padL) / plotW));
                    const dbNorm = Math.max(0, Math.min(1, 1 - (y - padT) / plotH));
                    specDragAnchor = { freqNorm: freqNorm, dbNorm: dbNorm };
                    specDragCurrent = { freqNorm: freqNorm, dbNorm: dbNorm };
                    e.preventDefault();
                });
                document.addEventListener('mousemove', function (e) {
                    if (specDragAnchor === null) {
                        return;
                    }
                    const rect = overlayCanvas.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const padL = 36, padR = 8, padT = 8, padB = 18;
                    const plotW = overlayCanvas.width - padL - padR;
                    const plotH = overlayCanvas.height - padT - padB;
                    if (plotW <= 0 || plotH <= 0) {
                        return;
                    }
                    const freqNorm = Math.max(0, Math.min(1, (x - padL) / plotW));
                    const dbNorm = Math.max(0, Math.min(1, 1 - (y - padT) / plotH));
                    specDragCurrent = { freqNorm: freqNorm, dbNorm: dbNorm };
                    scheduleSpectrumRefresh('hover');
                });
                document.addEventListener('mouseup', function (e) {
                    if (specDragAnchor === null) {
                        return;
                    }
                    const anchor = specDragAnchor;
                    const current = specDragCurrent;
                    specDragAnchor = null;
                    specDragCurrent = null;
                    if (!anchor || !current) {
                        scheduleSpectrumRefresh('immediate');
                        return;
                    }
                    const pxDx = Math.abs((anchor.freqNorm - current.freqNorm) * (overlayCanvas.width - 36 - 8));
                    const pxDy = Math.abs((anchor.dbNorm - current.dbNorm) * (overlayCanvas.height - 8 - 18));
                    if (pxDx < 5 || pxDy < 5) {
                        scheduleSpectrumRefresh('immediate');
                        return;
                    }
                    // ズームを適用: freqNorm は現在の visFreqStart..visFreqEnd 内の相対値
                    const f0 = Math.min(anchor.freqNorm, current.freqNorm);
                    const f1 = Math.max(anchor.freqNorm, current.freqNorm);
                    const d0 = Math.min(anchor.dbNorm, current.dbNorm);
                    const d1 = Math.max(anchor.dbNorm, current.dbNorm);
                    const prevFreqStart = specFreqStart;
                    const prevFreqEnd = specFreqEnd;
                    specFreqStart = prevFreqStart + f0 * (prevFreqEnd - prevFreqStart);
                    specFreqEnd = prevFreqStart + f1 * (prevFreqEnd - prevFreqStart);
                    if (_lastVisDbMin !== null && _lastVisDbMax !== null) {
                        const visDbRange = _lastVisDbMax - _lastVisDbMin;
                        specDbMin = _lastVisDbMin + d0 * visDbRange;
                        specDbMax = _lastVisDbMin + d1 * visDbRange;
                    }
                    scheduleSpectrumRefresh('immediate');
                });
                overlayCanvas.addEventListener('dblclick', function (e) {
                    const rect = overlayCanvas.getBoundingClientRect();
                    const scaleX = overlayCanvas.width / (rect.width || overlayCanvas.width);
                    const scaleY = overlayCanvas.height / (rect.height || overlayCanvas.height);
                    const cx = (e.clientX - rect.left) * scaleX;
                    const cy = (e.clientY - rect.top) * scaleY;
                    const padL = 36, padR = 8, padT = 8, padB = 18;
                    const W = overlayCanvas.width, H = overlayCanvas.height;
                    if (_lastSpectrumMaxF <= 0) {
                        return;
                    } // データ無し
                    if (cx < padL) {
                        openSpectrumRangePopup('db', e.clientX, e.clientY);
                    }
                    else if (cx >= padL && cx <= W - padR && cy > H - padB) {
                        openSpectrumRangePopup('freq', e.clientX, e.clientY);
                    }
                    else if (cx >= padL && cx <= W - padR && cy >= padT && cy <= H - padB) {
                        specZoomReset();
                    }
                });
            }
            function attachTrackSpectrumCursorEvents() {
                document.querySelectorAll('.track-spectrum-canvas').forEach(function (c) {
                    c.addEventListener('mousemove', function (e) {
                        const idx = trackIndexFromElement(c);
                        const channelIndex = parseInt(c.getAttribute('data-channel-index'), 10);
                        onSpectrumMove(32, 6, c, e, idx, isNaN(channelIndex) ? null : channelIndex);
                    });
                    c.addEventListener('mouseleave', onSpectrumLeave);
                    c.addEventListener('focus', function () {
                        const idx = trackIndexFromElement(c);
                        const channelIndex = parseInt(c.getAttribute('data-channel-index'), 10);
                        onSpectrumFocus(idx, isNaN(channelIndex) ? null : channelIndex);
                    });
                    c.addEventListener('blur', onSpectrumBlur);
                });
            }
            attachRebuiltTrackEvents = function () {
                attachTrackCanvasFocusEvents();
                attachTrackSpectrumCursorEvents();
            };
            attachRebuiltTrackEvents();
        })();
    }
    function attachDirectorySelectionEvents() {
        const layout = document.getElementById('directory-selection-layout');
        if (!layout) {
            return;
        }
        function toggleDirectoryHeader(dirHeader: RuntimeElement) {
            const list = dirHeader.nextElementSibling;
            const toggle = dirHeader.querySelector('.dir-toggle');
            if (list && list.classList && list.classList.contains('selection-tree-list')) {
                const listElement = list as RuntimeElement;
                const isCollapsed = listElement.style.display === 'none';
                // 展開時: data-lazy な子要素を初めてレンダリングする (#90)
                if (isCollapsed && list.getAttribute('data-lazy') === 'true') {
                    const relPath = dirHeader.getAttribute('data-relative-path');
                    const depth = parseInt(dirHeader.getAttribute('data-depth') || '0', 10);
                    const node = __selectionDirMap[relPath];
                    if (node && node.children) {
                        listElement.innerHTML = buildSelectionTreeItems(node.children, depth + 1);
                        listElement.removeAttribute('data-lazy');
                    }
                }
                listElement.style.display = isCollapsed ? '' : 'none';
                if (toggle) {
                    toggle.textContent = isCollapsed ? '▼' : '▶';
                }
                dirHeader.setAttribute('aria-expanded', isCollapsed ? 'true' : 'false');
                // 折りたたみ状態を保存し vscode.setState() で永続化する
                // (isCollapsed=true → 展開に戻った → expanded=true)
                const relativePath = dirHeader.getAttribute('data-relative-path');
                if (relativePath) {
                    directoryCollapseState[relativePath] = isCollapsed;
                    persistWebviewState({
                        directoryCollapseState: directoryCollapseState,
                        directoryCollapseRootPath: currentTreeFilterRootPath,
                    });
                }
            }
        }
        layout.addEventListener('click', function (e) {
            const target = eventTarget(e);
            if (!target || typeof target.getAttribute !== 'function') {
                return;
            }
            const dirHeader = target.closest('.selection-tree-directory');
            if (dirHeader) {
                toggleDirectoryHeader(dirHeader);
                return;
            }
            const action = target.getAttribute('data-action');
            if (!action) {
                return;
            }
            if (handleSelectionAction(action)) {
                return;
            }
        });
        layout.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') {
                return;
            }
            const target = eventTarget(e);
            if (!target || typeof target.closest !== 'function') {
                return;
            }
            const dirHeader = target.closest('.selection-tree-directory');
            if (!dirHeader) {
                return;
            }
            e.preventDefault();
            toggleDirectoryHeader(dirHeader);
        });
        layout.addEventListener('change', function (e) {
            const target = eventTarget(e);
            if (!target || !target.classList || !target.classList.contains('selection-file-checkbox')) {
                return;
            }
            const filePath = target.getAttribute('data-file-path');
            if (!filePath) {
                return;
            }
            if (target.checked) {
                addSelectedFilePath(filePath);
            }
            else {
                removeSelectedFilePath(filePath);
            }
            syncSelectionSummary();
            postSelectedFiles();
        });
        syncSelectionSummary();
        // ── Tree filter ──
        var treeFilterInput = document.getElementById('tree-filter-input');
        if (treeFilterInput) {
            function applyTreeFilter(query: string) {
                if (!query) {
                    // フィルタ解除: 全ファイル <li> を表示し、折りたたみ状態を復元する
                    document.querySelectorAll('#selection-tree li').forEach(function (li) {
                        li.style.display = '';
                    });
                    document.querySelectorAll('.selection-tree-directory').forEach(function (dirHeader: RuntimeElement) {
                        var relativePath = dirHeader.getAttribute('data-relative-path');
                        var list = dirHeader.nextElementSibling;
                        if (!list || !list.classList.contains('selection-tree-list')) {
                            return;
                        }
                        var savedExpanded = relativePath ? directoryCollapseState[relativePath] : undefined;
                        // 保存済み状態があればそれを、なければ depth=0 かどうかで判断（ルート直下要素は expanded）
                        // data-depth が付いていない場合はデフォルト展開
                        var expanded = (savedExpanded !== undefined) ? savedExpanded : true;
                        (list as RuntimeElement).style.display = expanded ? '' : 'none';
                        var toggle = dirHeader.querySelector('.dir-toggle');
                        if (toggle) {
                            toggle.textContent = expanded ? '▼' : '▶';
                        }
                        dirHeader.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                    });
                    syncSelectionSummary();
                    return;
                }
                // フィルタ適用前: レイジー未展開の子要素を全てレンダリングする (#90 との連携)
                // 1 回のループでは新たに挿入された子ノードに data-lazy が残るため、
                // lazy ノードがなくなるか進捗がなくなるまで繰り返す
                var prevLazyCount = -1;
                while (true) {
                    var lazyLists = document.querySelectorAll('#selection-tree [data-lazy="true"]');
                    if (!lazyLists.length || lazyLists.length === prevLazyCount) {
                        break;
                    }
                    prevLazyCount = lazyLists.length;
                    lazyLists.forEach(function (lazyList) {
                        var dh = lazyList.previousElementSibling;
                        if (!dh || !dh.classList.contains('selection-tree-directory')) {
                            return;
                        }
                        var relPath = dh.getAttribute('data-relative-path');
                        var depth = parseInt(dh.getAttribute('data-depth') || '0', 10);
                        var node = relPath ? __selectionDirMap[relPath] : undefined;
                        if (node && node.children) {
                            lazyList.innerHTML = buildSelectionTreeItems(node.children, depth + 1);
                            lazyList.removeAttribute('data-lazy');
                        }
                    });
                }
                // フィルタ適用: ファイル名・パスで一致する <li> のみ表示
                var allLis = document.querySelectorAll('#selection-tree li');
                for (var i = 0; i < allLis.length; i++) {
                    var li = allLis[i];
                    var fileRow = li.querySelector('.selection-file-row');
                    if (!fileRow) {
                        continue;
                    }
                    var checkbox = li.querySelector('.selection-file-checkbox');
                    var fp = checkbox ? (checkbox.getAttribute('data-file-path') || '') : '';
                    var nameEl = li.querySelector('.selection-file-name');
                    var nm = nameEl ? (nameEl.textContent || '') : '';
                    var match = fp.toLowerCase().indexOf(query) >= 0 || nm.toLowerCase().indexOf(query) >= 0;
                    li.style.display = match ? '' : 'none';
                    // 一致したファイルの祖先ディレクトリを全て展開する
                    if (match) {
                        var ancestor = li.parentElement;
                        while (ancestor && ancestor.id !== 'selection-tree') {
                            if (ancestor.classList && ancestor.classList.contains('selection-tree-list')) {
                                var dh = ancestor.previousElementSibling;
                                var rel = dh && dh.classList && dh.classList.contains('selection-tree-directory')
                                    ? dh.getAttribute('data-relative-path')
                                    : null;
                                var savedExpanded = rel ? directoryCollapseState[rel] : undefined;
                                var shouldExpandForFilter = savedExpanded !== false;
                                ancestor.style.display = shouldExpandForFilter ? '' : 'none';
                                if (dh && dh.classList.contains('selection-tree-directory')) {
                                    dh.setAttribute('aria-expanded', shouldExpandForFilter ? 'true' : 'false');
                                    var tog = dh.querySelector('.dir-toggle');
                                    if (tog) {
                                        tog.textContent = shouldExpandForFilter ? '▼' : '▶';
                                    }
                                }
                            }
                            ancestor = ancestor.parentElement;
                        }
                    }
                }
                // 一致ファイルを持たないディレクトリ <li> を非表示にする（葉から順に評価）
                var dirLis = document.querySelectorAll('#selection-tree li');
                for (var j = dirLis.length - 1; j >= 0; j--) {
                    var dirLi = dirLis[j];
                    var subList = dirLi.querySelector('.selection-tree-list');
                    if (!subList) {
                        continue;
                    }
                    var visCount = 0;
                    var children = subList.querySelectorAll('li');
                    for (var k = 0; k < children.length; k++) {
                        if (children[k].style.display !== 'none') {
                            visCount++;
                        }
                    }
                    dirLi.style.display = visCount > 0 ? '' : 'none';
                }
                syncSelectionSummary();
            }
            // debounce: 150ms (#92)
            var treeFilterTimer: number | null = null;
            treeFilterInput.addEventListener('input', function () {
                if (treeFilterTimer !== null) {
                    clearTimeout(treeFilterTimer);
                }
                treeFilterQuery = treeFilterInput.value;
                persistWebviewState({
                    treeFilterQuery: treeFilterQuery,
                    treeFilterRootPath: currentTreeFilterRootPath,
                });
                treeFilterTimer = setTimeout(function () {
                    applyTreeFilter(treeFilterInput.value.toLowerCase());
                }, 150);
            });
            // テスト環境からデバウンスを即時フラッシュできるようにする
            testBridge.setTreeFilterFlush(function () {
                if (treeFilterTimer !== null) {
                    clearTimeout(treeFilterTimer);
                }
                treeFilterTimer = null;
                applyTreeFilter(treeFilterInput.value.toLowerCase());
            });
            if (treeFilterQuery) {
                applyTreeFilter(treeFilterQuery.toLowerCase());
            }
        }
        // ── Tree resizer ──
        var resizerEl = document.getElementById('tree-resizer');
        var sidebarEl = document.getElementById('selection-sidebar');
        if (resizerEl && sidebarEl) {
            var dragStartX = 0;
            var dragStartW = 0;
            var isDragging = false;
            function onResizerMouseMove(e: MouseEvent): void {
                if (!isDragging) {
                    return;
                }
                var delta = e.clientX - dragStartX;
                var newW = Math.max(160, Math.min(600, dragStartW + delta));
                sidebarEl.style.width = newW + 'px';
            }
            function onResizerMouseUp() {
                isDragging = false;
                resizerEl.classList.remove('is-dragging');
                document.removeEventListener('mousemove', onResizerMouseMove);
                document.removeEventListener('mouseup', onResizerMouseUp);
            }
            resizerEl.addEventListener('mousedown', function (e) {
                isDragging = true;
                dragStartX = e.clientX;
                dragStartW = sidebarEl.getBoundingClientRect().width;
                resizerEl.classList.add('is-dragging');
                document.addEventListener('mousemove', onResizerMouseMove);
                document.addEventListener('mouseup', onResizerMouseUp);
                e.preventDefault();
            });
        }
    }
    function handleSelectionAction(action: string) {
        if (action === 'open-file' || action === 'open-folder' || action === 'select-python-environment') {
            handleToolbarAction(action);
            return true;
        }
        if (action === 'toggle-directory') {
            return true;
        }
        if (action === 'selection-select-all') {
            clearSelectedFilePaths();
            // 可視状態のチェックボックスのみを対象にする
            document.querySelectorAll('.selection-file-checkbox').forEach(function (input) {
                if (isVisibleInTree(input)) {
                    const filePath = input.getAttribute('data-file-path');
                    if (filePath) {
                        addSelectedFilePath(filePath);
                    }
                }
            });
            syncSelectionCheckboxes();
            syncSelectionSummary();
            postSelectedFiles();
            return true;
        }
        if (action === 'selection-clear-all') {
            clearSelectedFilePaths();
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
        document.querySelectorAll('.selection-file-checkbox').forEach(function (input) {
            const filePath = input.getAttribute('data-file-path');
            input.checked = !!filePath && hasSelectedFilePath(filePath);
        });
    }
    function hasSelectedFilePath(filePath: string) {
        return selectedFilePathSet.has(filePath);
    }
    function addSelectedFilePath(filePath: string) {
        if (hasSelectedFilePath(filePath)) {
            return;
        }
        selectedFilePaths.push(filePath);
        selectedFilePathSet.add(filePath);
    }
    function removeSelectedFilePath(filePath: string) {
        const idx = selectedFilePaths.indexOf(filePath);
        if (idx !== -1) {
            selectedFilePaths.splice(idx, 1);
        }
        selectedFilePathSet.delete(filePath);
    }
    function clearSelectedFilePaths() {
        selectedFilePaths.length = 0;
        selectedFilePathSet.clear();
    }
    function isVisibleInTree(el: RuntimeElement) {
        // el から #selection-tree までの祖先を辿り、display:none が設定された要素があれば非表示と判定する
        var node: RuntimeElement | null = el;
        while (node && node.id !== 'selection-tree') {
            if (node.style && node.style.display === 'none') {
                return false;
            }
            node = node.parentElement as RuntimeElement | null;
        }
        return true;
    }
    function syncSelectionSummary() {
        const countEl = document.getElementById('selection-count');
        const count = selectedFilePaths.length;
        // 可視チェックボックスの数を分母にする
        const visibleCount = Array.from(document.querySelectorAll('.selection-file-checkbox')).filter(function (el: RuntimeElement) {
            return isVisibleInTree(el);
        }).length;
        if (countEl) {
            countEl.textContent = count + ' / ' + visibleCount + ' ' + STR.selectionCountLabel;
        }
    }
    function syncPythonEnvironmentButton() {
        const selectionButton = document.getElementById('selection-python-environment');
        const toolbarButton = document.getElementById('toolbar-python-environment');
        const pythonCommand = pythonEnvironmentState && typeof pythonEnvironmentState.pythonCommand === 'string'
            ? pythonEnvironmentState.pythonCommand
            : 'python3';
        const isWarning = pythonEnvironmentState && pythonEnvironmentState.status === 'warning';
        const buttonText = buildPythonButtonText(pythonCommand, isWarning);
        const rawTooltip = pythonEnvironmentState && typeof pythonEnvironmentState.tooltip === 'string'
            ? pythonEnvironmentState.tooltip
            : 'Click to select Python environment';
        const tooltip = buildPythonTooltip(pythonCommand, rawTooltip);
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
        const orderedSelection = allSelectableFilePaths.slice(0, 0);
        selectedFilePaths.forEach(function (filePath: string) {
            orderedSelection.push(filePath);
        });
        selectionMessageSeq += 1;
        messaging.post({
            type: 'analyze-selected-files',
            requestId: 'selection-' + runtimeSessionId + '-' + selectionMessageSeq,
            filePaths: orderedSelection,
        });
    }
    function handleToolbarAction(action: string) {
        if (action === 'open-file') {
            messaging.post({ type: 'select-target', targetKind: 'file' });
        }
        else if (action === 'open-folder') {
            messaging.post({ type: 'select-target', targetKind: 'directory' });
        }
        else if (action === 'select-python-environment') {
            messaging.post({ type: 'select-python-environment' });
        }
        else if (action === 'content-waveform') {
            contentType = 'waveform';
            state.results.forEach(function (_result, index) { releaseTrackDetail(index); });
            persistWebviewState({ contentType: contentType });
            document.querySelector('[data-action="content-waveform"]').classList.add('is-active');
            document.querySelector('[data-action="content-spectrogram"]').classList.remove('is-active');
            __updateSpecGearVisibility();
            scheduleRender();
        }
        else if (action === 'content-spectrogram') {
            contentType = 'spectrogram';
            persistWebviewState({ contentType: contentType });
            document.querySelector('[data-action="content-waveform"]').classList.remove('is-active');
            document.querySelector('[data-action="content-spectrogram"]').classList.add('is-active');
            __updateSpecGearVisibility();
            scheduleRender();
        }
        else if (action === 'zoom-in') {
            zoomIn();
        }
        else if (action === 'zoom-out') {
            zoomOut();
        }
        else if (action === 'zoom-reset') {
            resetZoom();
        }
        else if (action === 'spec-zoom-in') {
            specZoomIn();
        }
        else if (action === 'spec-zoom-out') {
            specZoomOut();
        }
        else if (action === 'spec-zoom-reset') {
            specZoomReset();
        }
        else if (action === 'track-height-reset') {
            setTrackHeight(TRACK_HEIGHT_DEFAULT);
        }
        else if (action === 'spectrum-height-reset') {
            setSpectrumHeight(SPECTRUM_HEIGHT_DEFAULT);
        }
        else if (action === 'wave-mode-rect-zoom') {
            waveformMode = waveformMode === 'rect-zoom' ? 'loop' : 'rect-zoom';
            syncWaveformModeButton();
        }
        else if (action === 'toggle-follow-cursor') {
            followCursor = !followCursor;
            const btn = document.querySelector('[data-action="toggle-follow-cursor"]');
            if (btn) {
                btn.classList.toggle('is-active', followCursor);
            }
            scheduleRender();
        }
        else if (action === 'zoom-to-selection') {
            zoomToSelection();
        }
        else if (action === 'run-recipe') {
            messaging.post({ type: 'run-recipe' });
        }
        else if (action === 'copy-spec') {
            copySpecToClipboard();
        }
        else if (action === 'export-png') {
            exportPng();
        }
        else if (action === 'export-csv') {
            exportCsv();
        }
        else if (action === 'export-wav') {
            exportWavLoop();
        }
        else if (action === 'export-report') {
            exportReport();
        }
    }
    function clampHeight(value: number, minValue: number, maxValue: number): number {
        return Math.max(minValue, Math.min(maxValue, value));
    }
    function parseHeightValue(value: string | number): number | null {
        return parseBoundedInteger(value, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    }
    function applyHeightInput(action: string | null, value: string | number | null): void {
        if (value === null) {
            return;
        }
        const next = parseHeightValue(value);
        if (next === null) {
            return;
        }
        if (action === 'track-height-input') {
            setTrackHeight(next);
        }
        else if (action === 'spectrum-height-input') {
            setSpectrumHeight(next);
        }
    }
    function setTrackHeight(value: number): void {
        const next = clampHeight(value, TRACK_HEIGHT_MIN, TRACK_HEIGHT_MAX);
        if (trackHeight === next) {
            syncHeightInputs();
            return;
        }
        trackHeight = next;
        syncHeightInputs();
        updateUiSmokeSpectrumState();
        updatePlaybackButtons();
        Object.keys(canvasWidthCache).forEach(function (key) { delete canvasWidthCache[key]; });
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
    }
    function syncSpectrumCanvasCssHeight() {
        const canvas = document.getElementById('spectrum-overlay-canvas');
        if (canvas && canvas.style.height !== spectrumOverlayHeight + 'px') {
            canvas.style.height = spectrumOverlayHeight + 'px';
        }
    }
    function setSpectrumHeight(value: number): void {
        const next = clampHeight(value, SPECTRUM_HEIGHT_MIN, SPECTRUM_HEIGHT_MAX);
        if (spectrumOverlayHeight === next) {
            syncHeightInputs();
            syncSpectrumCanvasCssHeight();
            return;
        }
        spectrumOverlayHeight = next;
        syncHeightInputs();
        updateUiSmokeSpectrumState();
        syncSpectrumCanvasCssHeight();
        scheduleSpectrumRefresh('immediate');
    }
    let heightResizeDrag: { kind: 'track' | 'spectrum'; startY: number; startHeight: number } | null = null;
    function beginHeightResize(kind: 'track' | 'spectrum', clientY: number): void {
        heightResizeDrag = {
            kind: kind,
            startY: clientY,
            startHeight: kind === 'track' ? trackHeight : spectrumOverlayHeight,
        };
        document.body.classList.add('is-height-resizing');
    }
    function updateHeightResize(clientY: number) {
        if (!heightResizeDrag) {
            return;
        }
        const delta = clientY - heightResizeDrag.startY;
        if (heightResizeDrag.kind === 'track') {
            setTrackHeight(heightResizeDrag.startHeight + delta);
        }
        else {
            setSpectrumHeight(heightResizeDrag.startHeight - delta);
        }
    }
    function endHeightResize() {
        if (!heightResizeDrag) {
            return;
        }
        heightResizeDrag = null;
        document.body.classList.remove('is-height-resizing');
    }
    function disableFollowCursor() {
        if (!followCursor) {
            return;
        }
        followCursor = false;
        const btn = document.querySelector('[data-action="toggle-follow-cursor"]');
        if (btn) {
            btn.classList.remove('is-active');
        }
    }
    function zoomToSelection() {
        if (loopRegion) {
            const pad = (loopRegion.end - loopRegion.start) * 0.05;
            disableFollowCursor();
            zoomStart = Math.max(0, loopRegion.start - pad);
            zoomEnd = Math.min(1, loopRegion.end + pad);
            scheduleRender();
        }
    }
    function updateZoomToSelectionBtn() {
        var btn = document.getElementById('btn-zoom-to-selection');
        if (btn) {
            btn.disabled = !loopRegion;
        }
    }
    function syncWaveformModeButton() {
        const btn = document.getElementById('btn-wave-mode-rect-zoom');
        if (!btn) {
            return;
        }
        const active = waveformMode === 'rect-zoom';
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.classList.toggle('is-active', active);
    }
    function exportPng() {
        const wrapper = document.getElementById('tracks-wrapper');
        const canvases: RuntimeElement[] = wrapper
            ? Array.from(wrapper.querySelectorAll('canvas:not(.track-axis-canvas)')).filter(function (c) { return c.offsetParent !== null; })
            : [];
        if (canvases.length === 0) {
            messaging.post({ type: 'show-info', message: STR.announceExportPngFailed || 'PNG export failed: no visible canvases' });
            return;
        }
        announce(STR.announceExportPngStarted || 'PNG export started');
        setTimeout(function () {
            const waveW = canvases.reduce(function (m, c) { return Math.max(m, c.width); }, 0);
            const totalWidth = AXIS_W + waveW;
            const totalHeight = canvases.reduce(function (sum, c) { return sum + c.height; }, 0);
            const offscreen = document.createElement('canvas');
            offscreen.width = totalWidth;
            offscreen.height = totalHeight;
            const ctx = offscreen.getContext('2d');
            if (!ctx) {
                messaging.post({ type: 'show-info', message: STR.announceExportPngFailed || 'PNG export failed: no visible canvases' });
                return;
            }
            ctx.fillStyle = '#1e1e1e';
            ctx.fillRect(0, 0, totalWidth, totalHeight);
            let y = 0;
            canvases.forEach(function (c) {
                var axisId = c.id ? c.id.replace(/^track-canvas-/, 'track-axis-canvas-') : '';
                if (axisId && axisId !== c.id) {
                    var axisCanvas = wrapper ? wrapper.querySelector('#' + axisId) : null;
                    if (axisCanvas) {
                        ctx.drawImage(axisCanvas as unknown as HTMLCanvasElement, 0, y);
                    }
                }
                ctx.drawImage(c as unknown as HTMLCanvasElement, AXIS_W, y);
                y += c.height;
            });
            const dataURL = offscreen.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = dataURL;
            a.download = 'waveform-export.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }, 0);
    }
    function exportCsv() {
        if (typeof state === 'undefined' || !state.results || state.results.length === 0) {
            messaging.post({ type: 'show-info', message: STR.announceExportCsvFailed || 'CSV export failed: no spectrum data at cursor' });
            return;
        }
        const tracks: Array<{ name: string; slice: SpectrumSlice }> = [];
        trackStore.activeIds().forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            const i = record.protocolIndex;
            if (record.runtime.hidden) {
                return;
            }
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const slice = extractSpectrumAtCursor(result, i, trackRuntimeAt(i).offsetSeconds, cursorNorm, channelIndex);
                if (!slice || !slice.values || slice.values.length === 0) {
                    return;
                }
                tracks.push({ name: (result.fileName || ('track' + (i + 1))) + ' ' + channelLabel(result, channelIndex), slice: slice });
            });
        });
        if (tracks.length === 0) {
            messaging.post({ type: 'show-info', message: STR.announceExportCsvFailed || 'CSV export failed: no spectrum data at cursor' });
            return;
        }
        announce(STR.announceExportCsvStarted || 'CSV export started');
        function csvCell(s: string) { return /[,"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
        const headers: string[] = [];
        tracks.forEach(function (t) {
            headers.push(csvCell(t.name + ' frequency (Hz)'));
            headers.push(csvCell(t.name + ' ' + dbLevelAxisLabelFor(t.slice)));
        });
        const rows = [headers.join(',')];
        const maxBins = tracks.reduce(function (max, t) {
            return Math.max(max, t.slice.frequencyBins || 0, t.slice.values ? t.slice.values.length : 0);
        }, 0);
        for (let bin = 0; bin < maxBins; bin++) {
            const cols: string[] = [];
            tracks.forEach(function (t) {
                const fBins = t.slice.frequencyBins || 0;
                const maxHz = t.slice.originalMaxFrequencyHz || t.slice.maxFrequencyHz || 0;
                cols.push(bin < fBins ? ((bin / Math.max(fBins - 1, 1)) * maxHz).toFixed(4) : '');
                const v = t.slice.values[bin];
                cols.push(v !== undefined && v !== null ? v.toFixed(6) : '');
            });
            rows.push(cols.join(','));
        }
        const csv = rows.join('\n');
        const a = document.createElement('a');
        a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
        a.download = 'spectrum-export.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
    function exportWavLoop() {
        if (!loopRegion) {
            messaging.post({ type: 'show-info', message: STR.exportWavNoLoop });
            return;
        }
        if (typeof state === 'undefined' || !state.results || state.results.length === 0) {
            return;
        }
        var visiblePaths: string[] = [];
        trackStore.activeIds().forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            if (record.runtime.hidden) {
                return;
            }
            visiblePaths.push(result.filePath);
        });
        if (visiblePaths.length === 0) {
            return;
        }
        messaging.post({
            type: 'export-wav-loop',
            filePaths: visiblePaths,
            startNorm: loopRegion.start,
            endNorm: loopRegion.end,
        });
    }
    // --- Report export helpers ---
    function _fmtSec(secs: number) {
        var m = Math.floor(secs / 60);
        var s = (secs - m * 60).toFixed(3);
        return (m > 0 ? m + 'm ' : '') + s + 's';
    }
    function _dbLevel(rms: number) {
        return (20 * Math.log10(Math.max(rms, 1e-9))).toFixed(1) + ' dB';
    }
    function _markdownInline(value: unknown): string {
        return String(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function _markdownTableCell(value: unknown): string {
        return _markdownInline(value).split('|').join('\\|');
    }
    function buildMarkdownReport() {
        var now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        const reportRecords = trackStore.activeIds().map(function (trackId) {
            return trackStore.require(trackId);
        });
        var lines = [
            '# Audio Analysis Report',
            '',
            '**Generated:** ' + now,
            '',
            '## Tracks',
            '',
            '| File | Channel | Sample Rate | Duration | Channels | RMS | Peak |',
            '|------|---------|-------------|----------|----------|-----|------|',
        ];
        reportRecords.forEach(function (record) {
            const r = record.result;
            var dur = r.durationSeconds ? _fmtSec(r.durationSeconds) : '-';
            channelsForResult(r).forEach(function (ch: ChannelSummary, channelIndex: number) {
                var rms = ch ? _dbLevel(ch.rms) : '-';
                var peak = ch ? _dbLevel(ch.peakAbsolute) : '-';
                lines.push('| ' + _markdownTableCell(r.fileName) + ' | ' + _markdownTableCell(channelLabel(r, channelIndex)) + ' | ' + r.sampleRateHz + ' Hz | ' + dur + ' | ' + r.channelCount + ' | ' + rms + ' | ' + peak + ' |');
            });
        });
        lines.push('');
        // Loop region
        if (loopRegion && reportRecords.length > 0) {
            var gs = computeGlobalSpan();
            var globalStartSec = gs.startSec + loopRegion.start * gs.spanSec;
            var globalEndSec = gs.startSec + loopRegion.end * gs.spanSec;
            var globalDurationSec = Math.max(0, globalEndSec - globalStartSec);
            lines.push('## Loop Region');
            lines.push('');
            lines.push('- Time basis: global comparison timeline (offset-adjusted)');
            lines.push('- Global Start: ' + globalStartSec.toFixed(3) + ' s');
            lines.push('- Global End: ' + globalEndSec.toFixed(3) + ' s');
            lines.push('- Global Duration: ' + globalDurationSec.toFixed(3) + ' s');
            lines.push('');
            lines.push('| Track | Offset | Local Start | Local End | Local Duration | Status |');
            lines.push('|-------|--------|-------------|-----------|----------------|--------|');
            reportRecords.forEach(function (record) {
                const r = record.result;
                var dur = r.durationSeconds || 0;
                var offset = record.runtime.offsetSeconds;
                var localStart = globalStartSec - offset;
                var localEnd = globalEndSec - offset;
                var coveredStart = Math.max(0, localStart);
                var coveredEnd = Math.min(dur, localEnd);
                var inRange = dur > 0 && coveredEnd > coveredStart;
                var status = inRange
                    ? ((localStart < 0 || localEnd > dur) ? 'Partial' : 'In range')
                    : 'Out of range';
                var localStartText = inRange ? coveredStart.toFixed(3) + ' s' : '-';
                var localEndText = inRange ? coveredEnd.toFixed(3) + ' s' : '-';
                var localDurationText = inRange ? (coveredEnd - coveredStart).toFixed(3) + ' s' : '-';
                lines.push('| ' + _markdownTableCell(r.fileName) + ' | ' + offset.toFixed(3) + ' s | ' + localStartText + ' | ' + localEndText + ' | ' + localDurationText + ' | ' + status + ' |');
            });
            lines.push('');
        }
        // Spectrum peaks
        if (reportRecords.length > 0) {
            var firstResult = reportRecords[0].result;
            channelsForResult(firstResult).forEach(function (firstChannel: ChannelSummary, channelIndex: number) {
                var peaks = firstChannel ? firstChannel.peaks : undefined;
                if (peaks && peaks.length > 0) {
                    lines.push('## Spectral Peaks (first track, ' + _markdownTableCell(channelLabel(firstResult, channelIndex)) + ')');
                    lines.push('');
                    lines.push('| Frequency (Hz) | ' + _markdownTableCell(spectrumLevelAxisLabel(firstResult)) + ' |');
                    lines.push('|---------------|------------|');
                    peaks.forEach(function (p) {
                        lines.push('| ' + p.freqHz.toFixed(1) + ' | ' + p.amplitudeDb.toFixed(1) + ' |');
                    });
                    lines.push('');
                }
            });
        }
        return lines.join('\n');
    }
    function buildNotebook() {
        var filePaths = (state.results || []).map(function (r) { return r.filePath; });
        var loadCode = filePaths.map(function (p) {
            var safePath = p.split('\\').join('\\\\').split('"').join('\\"');
            return 'sig = wd.read("' + safePath + '")\n' +
                'sig.describe()';
        }).join('\n\n');
        var nb = {
            nbformat: 4,
            nbformat_minor: 5,
            metadata: {
                kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
                language_info: { name: 'python', version: '3.11' }
            },
            cells: [
                {
                    cell_type: 'markdown',
                    id: 'title',
                    metadata: {},
                    source: ['# Audio Analysis Report\n', '\nGenerated by Audio Wandas Analyzer\n']
                },
                {
                    cell_type: 'code',
                    id: 'imports',
                    metadata: {},
                    outputs: [],
                    source: ['import wandas as wd\n']
                },
                {
                    cell_type: 'markdown',
                    id: 'files-header',
                    metadata: {},
                    source: ['## Files\n']
                },
                {
                    cell_type: 'code',
                    id: 'load-files',
                    metadata: {},
                    outputs: [],
                    source: [loadCode]
                }
            ]
        };
        return JSON.stringify(nb, null, 2);
    }
    function exportReport() {
        if (typeof state === 'undefined' || !state.results || state.results.length === 0) {
            messaging.post({ type: 'show-info', message: STR.exportReportNoData });
            return;
        }
        var mdContent = buildMarkdownReport();
        var nbContent = buildNotebook();
        var defaultName = (state.results[0].fileName || 'analysis').replace(/.[^.]+$/, '');
        messaging.post({
            type: 'export-report-options',
            defaultName: defaultName,
            markdownContent: mdContent,
            notebookContent: nbContent,
        });
    }
    function isAmplitudeZoomActive() {
        return amplitudeZoomMinNorm > -0.999999 || amplitudeZoomMaxNorm < 0.999999;
    }
    function amplitudeNormToCanvasY(norm: number, height: number) {
        return mapAmplitudeNormToCanvasY(norm, height, amplitudeZoomMinNorm, amplitudeZoomMaxNorm);
    }
    function canvasYToAmplitudeNorm(y: number, height: number) {
        return mapCanvasYToAmplitudeNorm(y, height, amplitudeZoomMinNorm, amplitudeZoomMaxNorm);
    }
    function zoomIn() {
        disableFollowCursor();
        const range = zoomNormalizedRange({ start: zoomStart, end: zoomEnd }, 0.7);
        zoomStart = range.start;
        zoomEnd = range.end;
        scheduleRender();
    }
    function zoomOut() {
        disableFollowCursor();
        const range = zoomNormalizedRange({ start: zoomStart, end: zoomEnd }, 1 / 0.7);
        zoomStart = range.start;
        zoomEnd = range.end;
        scheduleRender();
    }
    function resetZoom() {
        disableFollowCursor();
        zoomStart = 0;
        zoomEnd = 1;
        amplitudeZoomMinNorm = -1;
        amplitudeZoomMaxNorm = 1;
        rectZoomSelection = null;
        scheduleRender();
    }
    function specZoomIn() {
        const range = zoomSpectrumRange({ start: specFreqStart, end: specFreqEnd }, 0.7);
        specFreqStart = range.start;
        specFreqEnd = range.end;
        if (_lastVisDbMin !== null && _lastVisDbMax !== null) {
            const dc = (_lastVisDbMin + _lastVisDbMax) / 2;
            const dh = (_lastVisDbMax - _lastVisDbMin) / 2 * 0.7;
            specDbMin = dc - dh;
            specDbMax = dc + dh;
        }
        scheduleSpectrumRefresh('immediate');
    }
    function specZoomOut() {
        const range = zoomSpectrumRange({ start: specFreqStart, end: specFreqEnd }, 1 / 0.7);
        specFreqStart = range.start;
        specFreqEnd = range.end;
        // 完全ズームアウト時は dB も自動に戻す（dB ブロックはスキップ）
        if (specFreqStart <= 0 && specFreqEnd >= 1) {
            specDbMin = null;
            specDbMax = null;
        }
        else if (_lastVisDbMin !== null && _lastVisDbMax !== null) {
            const dc = (_lastVisDbMin + _lastVisDbMax) / 2;
            const dh = (_lastVisDbMax - _lastVisDbMin) / 2 * (1 / 0.7);
            specDbMin = dc - dh;
            specDbMax = dc + dh;
        }
        scheduleSpectrumRefresh('immediate');
    }
    function specZoomReset() {
        specFreqStart = 0;
        specFreqEnd = 1;
        specDbMin = null;
        specDbMax = null;
        scheduleSpectrumRefresh('immediate');
    }
    // ── スペクトル overlay レンジ popover ──
    let _specRangeAxis = 'freq'; // 'freq' | 'db'
    (function buildSpectrumRangePopover() {
        if (document.getElementById('spectrum-range-popover')) {
            return;
        }
        const pop = document.createElement('div');
        pop.id = 'spectrum-range-popover';
        pop.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:10px 12px;font-size:12px;color:var(--text);box-shadow:0 4px 12px rgba(0,0,0,.4);min-width:180px;';
        const inputStyle = 'width:90px;background:var(--vscode-input-background,#3c3c3c);color:inherit;border:1px solid var(--vscode-input-border,#555);border-radius:2px;padding:2px 4px;font-size:12px;';
        const labelStyle = 'width:42px;font-size:11px;color:var(--muted);';
        pop.innerHTML =
            '<div style="margin-bottom:8px;font-weight:600;font-size:11px;color:var(--muted);">'
                + escHtml(STR.specRangeTitle)
                + ' <span id="spec-range-axis-badge" style="padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;color:#fff;background:#0e639c;"></span>'
                + '</div>'
                + '<div id="spec-range-inputs" style="display:flex;flex-direction:column;gap:4px;align-items:center;">'
                + '<label id="spec-range-min-label" style="display:flex;align-items:center;gap:6px;"><span style="' + labelStyle + '">' + escHtml(STR.specRangeMin) + '</span><input id="spec-range-min" type="number" step="any" placeholder="auto" style="' + inputStyle + '"></label>'
                + '<label id="spec-range-max-label" style="display:flex;align-items:center;gap:6px;"><span style="' + labelStyle + '">' + escHtml(STR.specRangeMax) + '</span><input id="spec-range-max" type="number" step="any" placeholder="auto" style="' + inputStyle + '"></label>'
                + '</div>'
                + '<div style="display:flex;gap:6px;margin-top:8px;">'
                + '<button class="tb-btn" id="spec-range-apply" style="flex:1;">' + escHtml(STR.specRangeApply) + '</button>'
                + '<button class="tb-btn" id="spec-range-auto" style="flex:1;">' + escHtml(STR.specRangeAuto) + '</button>'
                + '<button class="tb-btn" id="spec-range-close" aria-label="Close">×</button>'
                + '</div>'
                + '<div id="spec-range-error" style="color:#f48771;font-size:11px;margin-top:4px;min-height:14px;"></div>';
        document.body.appendChild(pop);
    })();
    function closeSpectrumRangePopover() {
        const pop = document.getElementById('spectrum-range-popover');
        if (pop) {
            pop.style.display = 'none';
        }
        const err = document.getElementById('spec-range-error');
        if (err) {
            err.textContent = '';
        }
    }
    function openSpectrumRangePopup(axis: string, clientX: number, clientY: number) {
        _specRangeAxis = axis;
        const pop = document.getElementById('spectrum-range-popover');
        if (!pop) {
            return;
        }
        const badge = document.getElementById('spec-range-axis-badge');
        const minInput = document.getElementById('spec-range-min');
        const maxInput = document.getElementById('spec-range-max');
        const err = document.getElementById('spec-range-error');
        if (err) {
            err.textContent = '';
        }
        if (axis === 'db') {
            if (badge) {
                badge.textContent = STR.specRangeAxisDb;
            }
            minInput.value = (specDbMin != null) ? String(specDbMin)
                : (_lastVisDbMin != null ? String(Math.round(_lastVisDbMin)) : '');
            maxInput.value = (specDbMax != null) ? String(specDbMax)
                : (_lastVisDbMax != null ? String(Math.round(_lastVisDbMax)) : '');
        }
        else {
            if (badge) {
                badge.textContent = STR.specRangeAxisFreq;
            }
            minInput.value = String(Math.round(specFreqStart * _lastSpectrumMaxF));
            maxInput.value = String(Math.round(specFreqEnd * _lastSpectrumMaxF));
        }
        // レイアウト: Y(dB) 軸は縦並びで Max 上 / Min 下、
        // X(周波数) 軸は横並びで Min 左 / Max 右。
        var inputsBox = document.getElementById('spec-range-inputs');
        var minLabel = document.getElementById('spec-range-min-label');
        var maxLabel = document.getElementById('spec-range-max-label');
        if (inputsBox && minLabel && maxLabel) {
            if (axis === 'db') {
                inputsBox.style.flexDirection = 'column';
                maxLabel.style.order = '0'; // Max 上
                minLabel.style.order = '1'; // Min 下
            }
            else {
                inputsBox.style.flexDirection = 'row';
                minLabel.style.order = '0'; // Min 左
                maxLabel.style.order = '1'; // Max 右
            }
        }
        pop.style.display = 'block';
        // ビューポート外（特に X 軸 dblclick はパネル下端なので下に隠れる）に
        // はみ出す場合はカーソルの反対側へ寄せて収める。
        var _vw = window.innerWidth || 0;
        var _vh = window.innerHeight || 0;
        var _r = pop.getBoundingClientRect();
        const position = positionPopover(clientX, clientY, _r.width, _r.height, _vw, _vh);
        pop.style.left = position.left + 'px';
        pop.style.top = position.top + 'px';
        if (maxInput) {
            maxInput.focus();
        }
    }
    function applySpectrumRange() {
        const minInput = document.getElementById('spec-range-min');
        const maxInput = document.getElementById('spec-range-max');
        const err = document.getElementById('spec-range-error');
        if (!minInput || !maxInput) {
            return;
        }
        const minVal = minInput.value.trim();
        const maxVal = maxInput.value.trim();
        const min = minVal === '' ? null : Number(minVal);
        const max = maxVal === '' ? null : Number(maxVal);
        if (err) {
            err.textContent = '';
        }
        if (min !== null && !isFinite(min)) {
            if (err) {
                err.textContent = STR.specRangeErrorMinMax;
            }
            return;
        }
        if (max !== null && !isFinite(max)) {
            if (err) {
                err.textContent = STR.specRangeErrorMinMax;
            }
            return;
        }
        if (min !== null && max !== null && min >= max) {
            if (err) {
                err.textContent = STR.specRangeErrorMinMax;
            }
            return;
        }
        if (_specRangeAxis === 'db') {
            specDbMin = min;
            specDbMax = max;
        }
        else {
            const mf = _lastSpectrumMaxF || 1;
            const nextFreqStart = (min === null) ? 0 : Math.max(0, Math.min(1, min / mf));
            const nextFreqEnd = (max === null) ? 1 : Math.max(0, Math.min(1, max / mf));
            if (nextFreqStart >= nextFreqEnd) {
                if (err) {
                    err.textContent = STR.specRangeErrorMinMax;
                }
                return;
            }
            specFreqStart = nextFreqStart;
            specFreqEnd = nextFreqEnd;
        }
        scheduleSpectrumRefresh('immediate');
        closeSpectrumRangePopover();
    }
    function autoSpectrumRange() {
        if (_specRangeAxis === 'db') {
            specDbMin = null;
            specDbMax = null;
        }
        else {
            specFreqStart = 0;
            specFreqEnd = 1;
        }
        scheduleSpectrumRefresh('immediate');
        closeSpectrumRangePopover();
    }
    (function wireSpectrumRangeHandlers() {
        const applyBtn = document.getElementById('spec-range-apply');
        const autoBtn = document.getElementById('spec-range-auto');
        const closeBtn = document.getElementById('spec-range-close');
        if (applyBtn) {
            applyBtn.addEventListener('click', applySpectrumRange);
        }
        if (autoBtn) {
            autoBtn.addEventListener('click', autoSpectrumRange);
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', closeSpectrumRangePopover);
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeSpectrumRangePopover();
            }
        });
        document.addEventListener('mousedown', function (e) {
            const pop = document.getElementById('spectrum-range-popover');
            if (pop && pop.style.display !== 'none' && !pop.contains(eventTarget(e))) {
                closeSpectrumRangePopover();
            }
        });
    })();
    function copySpecToClipboard() {
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            messaging.post({ type: 'show-info', message: STR.announceSpecCopyFailed || 'Copy failed: clipboard not available' });
            return;
        }
        const lines = ['=== Audio Analyzer Spec ==='];
        const results = state.results || [];
        results.forEach(function (r, i: number) {
            const srKhz = ((r.sampleRateHz || 0) / 1000).toFixed(1) + ' kHz';
            const dur = ((r.durationSeconds || 0).toFixed(2)) + ' s';
            const ch = (r.channelCount || 0) + ' ch';
            lines.push('[Track ' + (i + 1) + '] ' + (r.fileName || '') + '  ' + srKhz + '  ' + dur + '  ' + ch);
        });
        lines.push('--- STFT ---');
        const _settings = __spectrogramSettings;
        const stft = _settings.stft || {};
        lines.push('nFft: ' + (stft.nFft || '') + '  hopSize: ' + (stft.hopSize || '') + '  window: ' + (stft.window || ''));
        navigator.clipboard.writeText(lines.join('\n'))
            .then(function () { announce(STR.announceSpecCopied || 'Spec copied to clipboard'); })
            .catch(function () {
            messaging.post({ type: 'show-info', message: STR.announceSpecCopyFailed || 'Copy failed: clipboard not available' });
        });
    }
    function handleZoomWheel(e: WheelEvent): void {
        disableFollowCursor();
        const scaleFactor = e.deltaY > 0 ? 1.15 : 0.85;
        const span = (zoomEnd - zoomStart) * scaleFactor;
        // Compute normalized time under cursor, keeping it pinned
        const wrapper = document.getElementById('tracks-wrapper');
        let pivotNorm = (zoomStart + zoomEnd) / 2; // fallback: current center
        const target = eventTarget(e);
        const wheelCanvas = target && typeof target.closest === 'function'
            ? target.closest('.track-canvas')
            : null;
        if (contentType === 'spectrogram' && wheelCanvas) {
            const hit = trackCanvasTimeHit(wheelCanvas, e.clientX);
            if (!hit) {
                return;
            }
            pivotNorm = hit.norm;
        }
        else if (wrapper) {
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
        if (newEnd > 1) {
            newEnd = 1;
            newStart = Math.max(0, 1 - span);
        }
        if (newStart < 0) {
            newStart = 0;
            newEnd = Math.min(1, span);
        }
        zoomStart = newStart;
        zoomEnd = newEnd;
        scheduleRender();
    }
    function handlePanWheel(e: WheelEvent): void {
        disableFollowCursor();
        const shift = (zoomEnd - zoomStart) * 0.1 * (e.deltaY > 0 ? 1 : -1);
        if (zoomStart + shift < 0) {
            zoomEnd -= zoomStart;
            zoomStart = 0;
        }
        else if (zoomEnd + shift > 1) {
            zoomStart += 1 - zoomEnd;
            zoomEnd = 1;
        }
        else {
            zoomStart += shift;
            zoomEnd += shift;
        }
        scheduleRender();
    }
    function handleCanvasMouseMove(e: MouseEvent): void {
        if (dragState && dragState.isDrag) {
            hideTooltip();
            return;
        }
        const canvas = eventTarget(e);
        if (!canvas.classList.contains('track-canvas')) {
            return;
        }
        if (dragState) {
            return;
        }
        const hit = trackCanvasTimeHit(canvas, e.clientX);
        if (!hit) {
            clearHover();
            hideTooltip();
            return;
        }
        const norm = hit.norm;
        const gripType = getGripType(norm);
        if (gripType) {
            showTooltip(e, STR.tooltipLoopResize);
        }
        else if (loopRegion && norm >= loopRegion.start && norm <= loopRegion.end) {
            showTooltip(e, STR.tooltipLoopClear);
        }
        else {
            showTooltip(e, STR.tooltipLoopOrShift);
        }
        renderWithHoverAt(norm);
    }
    function getGripType(norm: number) {
        if (!loopRegion) {
            return null;
        }
        const GRIP_THRESH = (zoomEnd - zoomStart) * 0.015;
        if (Math.abs(norm - loopRegion.start) < GRIP_THRESH) {
            return 'gripStart';
        }
        if (Math.abs(norm - loopRegion.end) < GRIP_THRESH) {
            return 'gripEnd';
        }
        return null;
    }
    function handleCanvasMouseDown(e: MouseEvent): void {
        const canvas = eventTarget(e);
        if (!canvas.classList.contains('track-canvas')) {
            return;
        }
        const idx = trackIndexFromElement(canvas);
        if (idx === null) {
            return;
        }
        const trackId = trackIdAtIndex(idx);
        if (!trackId) {
            return;
        }
        if (e.button === 0) {
            const rect = canvas.getBoundingClientRect();
            const hit = trackCanvasTimeHit(canvas, e.clientX);
            if (!hit) {
                return;
            }
            const y = e.clientY - rect.top;
            const norm = hit.norm;
            const ampNorm = canvasYToAmplitudeNorm(y, canvas.height);
            const gripType = waveformMode === 'rect-zoom' ? null : getGripType(norm);
            dragState = {
                trackId: trackId,
                startClientX: e.clientX,
                startClientY: e.clientY,
                startOffset: trackRuntimeAt(idx).offsetSeconds,
                canvasWidth: hit.timeWidth,
                canvasHeight: canvas.height,
                isDrag: false,
                isShift: e.shiftKey,
                startNorm: norm,
                startAmpNorm: ampNorm,
                dragType: gripType || (e.shiftKey ? 'offset' : (waveformMode === 'rect-zoom' ? 'rectZoom' : 'loop')),
            };
            if (dragState.dragType === 'rectZoom') {
                loopRegion = null;
                updateLoopTimeDisplay();
                updateZoomToSelectionBtn();
            }
            canvas.focus();
        }
    }
    function handleDocMouseMove(e: MouseEvent): void {
        if (!dragState) {
            return;
        }
        const dragTrackIndex = trackStore.protocolIndexForId(dragState.trackId);
        if (dragTrackIndex === null) {
            dragState = null;
            return;
        }
        const dx = e.clientX - dragState.startClientX;
        const dy = e.clientY - dragState.startClientY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            dragState.isDrag = true;
        }
        if (!dragState.isDrag) {
            return;
        }
        disableFollowCursor();
        hideTooltip();
        if (dragState.dragType === 'offset') {
            const gs = computeGlobalSpan();
            const secsPerPx = (zoomEnd - zoomStart) * gs.spanSec / dragState.canvasWidth;
            trackRuntimeAt(dragTrackIndex).offsetSeconds = dragState.startOffset + dx * secsPerPx;
            updateOffsetDisplays();
        }
        else if (dragState.dragType === 'loop') {
            const canvasEl = document.getElementById('track-canvas-' + dragTrackIndex);
            if (!canvasEl) {
                scheduleRender();
                return;
            }
            const norm = clampedTrackCanvasNorm(canvasEl, e.clientX, dragState.canvasWidth);
            const s = Math.min(dragState.startNorm, norm);
            const end = Math.max(dragState.startNorm, norm);
            if (end > s) {
                loopRegion = { start: s, end: end };
                updateLoopTimeDisplay();
                updateZoomToSelectionBtn();
            }
        }
        else if (dragState.dragType === 'rectZoom') {
            const canvasEl = document.getElementById('track-canvas-' + dragTrackIndex);
            if (!canvasEl) {
                scheduleRender();
                return;
            }
            const rect = canvasEl.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const norm = clampedTrackCanvasNorm(canvasEl, e.clientX, dragState.canvasWidth);
            const ampNorm = canvasYToAmplitudeNorm(y, dragState.canvasHeight);
            rectZoomSelection = {
                trackId: dragState.trackId,
                startNorm: dragState.startNorm,
                endNorm: norm,
                startAmpNorm: dragState.startAmpNorm,
                endAmpNorm: ampNorm,
            };
            updateUiSmokeWaveformState();
        }
        else if (dragState.dragType === 'gripStart') {
            const canvasEl = document.getElementById('track-canvas-' + dragTrackIndex);
            if (!canvasEl || !loopRegion) {
                scheduleRender();
                return;
            }
            const hitNorm = clampedTrackCanvasNorm(canvasEl, e.clientX, dragState.canvasWidth);
            const norm = Math.max(0, Math.min(loopRegion.end - 0.001, hitNorm));
            loopRegion = { start: norm, end: loopRegion.end };
            updateLoopTimeDisplay();
            updateZoomToSelectionBtn();
        }
        else if (dragState.dragType === 'gripEnd') {
            const canvasEl = document.getElementById('track-canvas-' + dragTrackIndex);
            if (!canvasEl || !loopRegion) {
                scheduleRender();
                return;
            }
            const hitNorm = clampedTrackCanvasNorm(canvasEl, e.clientX, dragState.canvasWidth);
            const norm = Math.max(loopRegion.start + 0.001, Math.min(1, hitNorm));
            loopRegion = { start: loopRegion.start, end: norm };
            updateLoopTimeDisplay();
            updateZoomToSelectionBtn();
        }
        scheduleRender();
    }
    function handleDocMouseUp(e: MouseEvent): void {
        const hadDrag = !!dragState;
        const wasRectZoom = dragState !== null && dragState.isDrag && dragState.dragType === 'rectZoom' && waveformMode === 'rect-zoom';
        if (dragState && !dragState.isDrag) {
            // クリック（ドラッグなし）: カーソル移動 + ループ区間解除
            const dragTrackIndex = trackStore.protocolIndexForId(dragState.trackId);
            const canvasId = dragTrackIndex === null ? '' : 'track-canvas-' + dragTrackIndex;
            const canvas = document.getElementById(canvasId);
            if (canvas) {
                const hit = trackCanvasTimeHit(canvas, e.clientX);
                if (hit) {
                    cursorNorm = Math.max(0, Math.min(1, hit.norm));
                    loopRegion = null;
                    updateLoopTimeDisplay();
                    updateZoomToSelectionBtn();
                    updateCursorDisplay(cursorNorm);
                    scheduleRender();
                }
            }
        }
        const completedRectZoom = wasRectZoom && rectZoomSelection ? Object.assign({}, rectZoomSelection) : null;
        dragState = null;
        if (completedRectZoom) {
            const start = Math.min(completedRectZoom.startNorm, completedRectZoom.endNorm);
            const end = Math.max(completedRectZoom.startNorm, completedRectZoom.endNorm);
            const ampMin = Math.min(completedRectZoom.startAmpNorm, completedRectZoom.endAmpNorm);
            const ampMax = Math.max(completedRectZoom.startAmpNorm, completedRectZoom.endAmpNorm);
            rectZoomSelection = null;
            if (end - start > 0.001 && ampMax - ampMin > 0.001) {
                disableFollowCursor();
                zoomStart = Math.max(0, start);
                zoomEnd = Math.min(1, end);
                amplitudeZoomMinNorm = ampMin;
                amplitudeZoomMaxNorm = ampMax;
            }
            loopRegion = null;
            updateZoomToSelectionBtn();
            updateLoopTimeDisplay();
            updateUiSmokeWaveformState();
            scheduleRender();
            return;
        }
        if (hadDrag) {
            scheduleSpectrumRefresh('immediate');
        }
    }
    function renderWithHoverAt(norm: number) {
        hoverNorm = norm;
        scheduleRender();
        updateCursorDisplay(norm);
    }
    function clearHover() {
        if (hoverNorm === null) {
            return;
        }
        hoverNorm = null;
        hideTooltip();
        scheduleRender();
        updateCursorDisplay(cursorNorm);
    }
    function updateCursorDisplay(norm: number) {
        const gs = computeGlobalSpan();
        const t = gs.startSec + norm * gs.spanSec;
        const el = document.getElementById('cursor-display');
        if (el) {
            el.textContent = formatTime(t);
        }
    }
    let _playbackDisplayVisible = false;
    let _playbackDisplayText = '';
    function updatePlaybackDisplay(timeSec: number | null): void {
        const el = document.getElementById('playback-display');
        if (!el) {
            return;
        }
        if (timeSec === null) {
            if (_playbackDisplayVisible) {
                el.style.display = 'none';
                el.textContent = '';
                _playbackDisplayVisible = false;
                _playbackDisplayText = '';
            }
        }
        else {
            const text = (STR.playbackTimePrefix || '▶') + ' ' + formatTime(timeSec);
            if (!_playbackDisplayVisible) {
                el.style.display = 'inline';
                _playbackDisplayVisible = true;
            }
            if (text !== _playbackDisplayText) {
                el.textContent = text;
                _playbackDisplayText = text;
            }
        }
    }
    function makeSilentSpectrumSlice(
        result: ComparisonTrackState,
        spec: SpectrogramData | null,
        cached: SpectrumSlice | null,
    ): SpectrumSlice {
        const fallbackBins = spec && spec.frequencyBins ? spec.frequencyBins : (cached && cached.frequencyBins ? cached.frequencyBins : 192);
        const fallbackMaxF = spec && spec.maxFrequencyHz ? spec.maxFrequencyHz : (cached && (cached.originalMaxFrequencyHz || cached.maxFrequencyHz) ? (cached.originalMaxFrequencyHz || cached.maxFrequencyHz) : ((result.sampleRateHz || 0) / 2));
        const floorDb = spec && Number.isFinite(spec.minDb) ? spec.minDb : (cached && Number.isFinite(cached.minDb) ? cached.minDb : -120);
        const topDb = spec && Number.isFinite(spec.maxDb) ? spec.maxDb : (cached && Number.isFinite(cached.maxDb) ? cached.maxDb : 0);
        return applySpectrumDisplaySettings({
            values: Array(Math.max(1, fallbackBins)).fill(floorDb),
            frequencyBins: Math.max(1, fallbackBins),
            originalMaxFrequencyHz: fallbackMaxF,
            maxFrequencyHz: fallbackMaxF,
            minDb: floorDb,
            maxDb: Math.max(topDb, floorDb + 1),
            unit: (spec && spec.unit) || (cached && cached.unit) || undefined,
            axisLabel: (spec && spec.axisLabel) || (cached && cached.axisLabel) || undefined,
        });
    }
    function extractSpectrumAtCursor(
        result: ComparisonTrackState,
        trackIndex: number,
        offsetSeconds: number,
        cursorNormValue: number,
        channelIndex = 0,
    ): SpectrumSlice | null {
        if (!result || result.error) {
            return null;
        }
        const dur = result.durationSeconds || 0;
        if (dur <= 0) {
            return null;
        }
        const idx = trackIndex;
        const chIdx = Number.isInteger(channelIndex) ? channelIndex : 0;
        const gs = computeGlobalSpan();
        const cursorSec = gs.startSec + cursorNormValue * gs.spanSec;
        const trackLocalSec = cursorSec - offsetSeconds;
        if (trackLocalSec < 0) {
            return null;
        }
        const ch = channelsForResult(result)[chIdx];
        const spec = ch && ch.spectrogram;
        const cached = idx >= 0 ? trackRecordAtIndex(idx)?.spectrumSliceCache.get(chIdx) ?? null : null;
        if (trackLocalSec >= dur) {
            return makeSilentSpectrumSlice(result, spec, cached);
        }
        if (!spec || !spec.values || spec.timeBins <= 0 || spec.frequencyBins <= 0) {
            if (idx >= 0) {
                const localNorm = trackLocalSec / dur;
                requestSpectrumSlice(idx, cursorNormValue, chIdx);
                if (cached && cached.settingsSignature === currentSpectrumDataSignature() && Math.abs((cached.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result)) {
                    return applySpectrumDisplaySettings(cached);
                }
            }
            return null;
        }
        let tIdx = Math.floor((trackLocalSec / dur) * spec.timeBins);
        if (tIdx < 0) {
            tIdx = 0;
        }
        if (tIdx >= spec.timeBins) {
            tIdx = spec.timeBins - 1;
        }
        const slice = spec.values[tIdx];
        if (!slice || slice.length === 0) {
            return null;
        }
        return applySpectrumDisplaySettings({
            values: slice,
            frequencyBins: spec.frequencyBins,
            originalMaxFrequencyHz: spec.maxFrequencyHz,
            maxFrequencyHz: spec.maxFrequencyHz,
            minDb: spec.minDb,
            maxDb: spec.maxDb,
            unit: spec.unit,
            axisLabel: spec.axisLabel,
        });
    }
    function spectrumBinAtFrequency(slice: SpectrumSlice, targetFreqHz: number, padL: number, plotW: number, padT: number, plotH: number, visFreqMin: number, visFreqMax: number, visDbMin: number, visDbMax: number) {
        return findSpectrumBinAtFrequency(slice, targetFreqHz, padL, plotW, padT, plotH, visFreqMin, visFreqMax, visDbMin, visDbMax);
    }
    function spectrumBinAtHover(slice: SpectrumSlice, hoverNormValue: number, padL: number, plotW: number, padT: number, plotH: number, visFreqMin: number, visFreqMax: number, visDbMin: number, visDbMax: number) {
        const targetFreqHz = visFreqMin + hoverNormValue * (visFreqMax - visFreqMin);
        return spectrumBinAtFrequency(slice, targetFreqHz, padL, plotW, padT, plotH, visFreqMin, visFreqMax, visDbMin, visDbMax);
    }
    function hoverNormForFrequency(freqHz: number, visFreqMin: number, visFreqMax: number) {
        return mapHoverNormForFrequency(freqHz, visFreqMin, visFreqMax);
    }
    function spectrumSeriesLabel(result: ComparisonTrackState, channelIndex: number) {
        return result.fileName + ' / ' + channelLabel(result, channelIndex);
    }
    function spectrumReadoutText(series: SpectrumSeries, snap: SpectrumSnap, dbVal: number): string {
        return series.label
            + ' / '
            + formatReadoutHz(snap.freqHz)
            + ' / '
            + dbVal.toFixed(1)
            + ' '
            + dbLevelUnitFor(series.slice);
    }
    function visibleSpectrumSlices(): SpectrumSeries[] {
        const slices: SpectrumSeries[] = [];
        trackStore.displayOrder.forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const i = record.protocolIndex;
            const result = record.result;
            if (record.runtime.hidden) {
                return;
            }
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const slice = extractSpectrumAtCursor(result, i, trackRuntimeAt(i).offsetSeconds, cursorNorm, channelIndex);
                if (slice) {
                    slices.push({
                        slice: slice,
                        color: trackColor(i),
                        index: i,
                        channelIndex: channelIndex,
                        label: spectrumSeriesLabel(result, channelIndex),
                    });
                }
            });
        });
        return slices;
    }
    function chooseOverlaySpectrumSnap(slices: SpectrumSeries[], hoverNormValue: number, mouseY: number | null, padL: number, plotW: number, padT: number, plotH: number, visFreqMin: number, visFreqMax: number, visDbMin: number, visDbMax: number) {
        let nearest: { s: SpectrumSeries; snap: SpectrumSnap; dbVal: number; snapY: number } | null = null;
        let minDist = Infinity;
        for (const s of slices) {
            const snap = spectrumBinAtHover(s.slice, hoverNormValue, padL, plotW, padT, plotH, visFreqMin, visFreqMax, visDbMin, visDbMax);
            if (!snap || snap.dbVal === undefined || snap.y === null) {
                continue;
            }
            const item = { s: s, snap: snap, dbVal: snap.dbVal, snapY: snap.y };
            if (mouseY === null) {
                if (!nearest) {
                    nearest = item;
                }
                continue;
            }
            const dist = Math.abs(snap.y - mouseY);
            if (dist < minDist) {
                minDist = dist;
                nearest = item;
            }
        }
        return nearest;
    }
    function moveSpectrumHoverByBin(deltaIdx: number) {
        if (spectrumHoverNorm === null) {
            spectrumHoverNorm = 0.5;
        }
        if (spectrumHoverTrackId !== null && spectrumHoverTrackId !== 'overlay') {
            const record = trackStore.get(spectrumHoverTrackId);
            if (!record?.active) {
                return;
            }
            const trackIndex = record.protocolIndex;
            const result = record.result;
            const channelIndex = typeof spectrumHoverChannelIndex === 'number' ? spectrumHoverChannelIndex : 0;
            const slice = extractSpectrumAtCursor(result, trackIndex, record.runtime.offsetSeconds, cursorNorm, channelIndex);
            if (!slice) {
                return;
            }
            const visFreqMin = specFreqStart * slice.maxFrequencyHz;
            const visFreqMax = specFreqEnd * slice.maxFrequencyHz;
            const snap = spectrumBinAtHover(slice, spectrumHoverNorm, 0, 1, 0, 1, visFreqMin, visFreqMax, slice.minDb, slice.maxDb);
            if (!snap) {
                return;
            }
            const nextIdx = Math.max(0, Math.min(slice.frequencyBins - 1, snap.binIdx + deltaIdx));
            const originalMaxFreq = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
            const freqHz = (nextIdx / Math.max(slice.frequencyBins - 1, 1)) * originalMaxFreq;
            spectrumHoverNorm = hoverNormForFrequency(freqHz, visFreqMin, visFreqMax);
            return;
        }
        const slices = visibleSpectrumSlices();
        if (slices.length === 0) {
            return;
        }
        let maxF = 0, minDb = Infinity, maxDb = -Infinity;
        slices.forEach(function (s: SpectrumSeries) {
            if (s.slice.maxFrequencyHz > maxF) {
                maxF = s.slice.maxFrequencyHz;
            }
            if (s.slice.minDb < minDb) {
                minDb = s.slice.minDb;
            }
            if (s.slice.maxDb > maxDb) {
                maxDb = s.slice.maxDb;
            }
        });
        const visFreqMin = specFreqStart * maxF;
        const visFreqMax = specFreqEnd * maxF;
        const visDbMin = (specDbMin != null) ? specDbMin : minDb;
        const visDbMax = (specDbMax != null) ? specDbMax : maxDb;
        const overlayC = document.getElementById('spectrum-overlay-canvas');
        const mouseY = spectrumHoverYFrac !== null && overlayC ? spectrumHoverYFrac * overlayC.height : null;
        const nearest = chooseOverlaySpectrumSnap(slices, spectrumHoverNorm, mouseY, 0, 1, 0, 1, visFreqMin, visFreqMax, visDbMin, visDbMax);
        const chosen = nearest ? nearest.s : slices[0];
        const snap = nearest ? nearest.snap : spectrumBinAtHover(chosen.slice, spectrumHoverNorm, 0, 1, 0, 1, visFreqMin, visFreqMax, visDbMin, visDbMax);
        if (!snap) {
            return;
        }
        const nextIdx = Math.max(0, Math.min(chosen.slice.frequencyBins - 1, snap.binIdx + deltaIdx));
        const originalMaxFreq = chosen.slice.originalMaxFrequencyHz || chosen.slice.maxFrequencyHz;
        const freqHz = (nextIdx / Math.max(chosen.slice.frequencyBins - 1, 1)) * originalMaxFreq;
        spectrumHoverNorm = hoverNormForFrequency(freqHz, visFreqMin, visFreqMax);
        spectrumHoverTrackId = 'overlay';
        spectrumHoverChannelIndex = null;
    }
    function drawSpectrumLine(ctx: CanvasRenderingContext2D, W: number, H: number, slice: SpectrumSlice, color: string, opts: { padL?: number; padR?: number; padT?: number; padB?: number; lineWidth?: number } = {}, visFreqMin?: number | null, visFreqMax?: number | null, visDbMin?: number | null, visDbMax?: number | null): void {
        const fBins = slice.frequencyBins;
        const _visFreqMin = (visFreqMin != null) ? visFreqMin : 0;
        const _visFreqMax = (visFreqMax != null) ? visFreqMax : slice.maxFrequencyHz;
        const _visDbMin = (visDbMin != null) ? visDbMin : slice.minDb;
        const _visDbMax = (visDbMax != null) ? visDbMax : slice.maxDb;
        const range = _visDbMax - _visDbMin;
        if (range <= 0) {
            return;
        }
        const padL = (opts && opts.padL) || 0;
        const padR = (opts && opts.padR) || 0;
        const padT = (opts && opts.padT) || 0;
        const padB = (opts && opts.padB) || 0;
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        ctx.save();
        ctx.beginPath();
        ctx.rect(padL, padT, plotW, plotH);
        ctx.clip();
        ctx.strokeStyle = color;
        ctx.lineWidth = (opts && opts.lineWidth) || 1.2;
        ctx.beginPath();
        const originalMaxFreq = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
        const visFreqRange = _visFreqMax - _visFreqMin;
        if (visFreqRange <= 0) {
            ctx.restore();
            return;
        }
        for (let i = 0; i < fBins; i++) {
            const fHz = (i / Math.max(fBins - 1, 1)) * originalMaxFreq;
            if (fHz > slice.maxFrequencyHz) {
                break;
            }
            const x = padL + ((fHz - _visFreqMin) / visFreqRange) * plotW;
            const v = slice.values[i];
            const norm = (v - _visDbMin) / range;
            const y = padT + (1 - norm) * plotH;
            if (i === 0) {
                ctx.moveTo(x, y);
            }
            else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.restore();
    }
    function drawSpectrumAxes(ctx: CanvasRenderingContext2D, W: number, H: number, slice: SpectrumSlice, padL: number, padR: number, padT: number, padB: number, visFreqMin: number, visFreqMax: number, visDbMin: number, visDbMax: number) {
        const _visFreqMin = (visFreqMin != null) ? visFreqMin : 0;
        const _visFreqMax = (visFreqMax != null) ? visFreqMax : slice.maxFrequencyHz;
        const _visDbMin = (visDbMin != null) ? visDbMin : slice.minDb;
        const _visDbMax = (visDbMax != null) ? visDbMax : slice.maxDb;
        const mutedColor = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
        const lineColor = getComputedStyle(document.body).getPropertyValue('--line').trim() || '#444';
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, padT);
        ctx.lineTo(padL, H - padB);
        ctx.moveTo(padL, H - padB);
        ctx.lineTo(W - padR, H - padB);
        ctx.stroke();
        ctx.fillStyle = mutedColor;
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(formatDbLevel(_visDbMax, slice), padL - 2, padT);
        ctx.textBaseline = 'middle';
        ctx.fillText(formatDbLevel((_visDbMax + _visDbMin) / 2, slice), padL - 2, padT + plotH / 2);
        ctx.textBaseline = 'bottom';
        ctx.fillText(formatDbLevel(_visDbMin, slice), padL - 2, H - padB);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(formatHz(_visFreqMin), padL, H - 1);
        ctx.fillText(formatHz((_visFreqMin + _visFreqMax) / 2), padL + plotW / 2, H - 1);
        ctx.fillText(formatHz(_visFreqMax), W - padR, H - 1);
    }
    function renderTrackSpectra() {
        trackStore.activeIds().forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            const i = record.protocolIndex;
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const canvas = document.getElementById(trackSpectrumCanvasId(i, channelIndex));
                if (!canvas) {
                    return;
                }
                const wrap = document.getElementById('track-spectrum-wrap-' + i + channelCanvasSuffix(channelIndex));
                if (!wrap) {
                    return;
                }
                const wrapStyle = (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function')
                    ? window.getComputedStyle(wrap)
                    : null;
                if (wrapStyle && wrapStyle.display === 'none') {
                    return;
                }
                const w = wrap.clientWidth || 180;
                const prevW = canvas.width;
                const prevH = canvas.height;
                syncCanvasSize(canvas, w, trackHeight);
                const paintedByChannel = trackStore.require(trackIdAtIndex(i)!).spectrumPainted;
                if (canvas.width !== prevW || canvas.height !== prevH) {
                    paintedByChannel.set(channelIndex, false);
                }
                const ctx = canvas.getContext('2d');
                const W = canvas.width, H = canvas.height;
                if (trackRuntimeAt(i).hidden) {
                    ctx.clearRect(0, 0, W, H);
                    paintedByChannel.set(channelIndex, false);
                    return;
                }
                const slice = extractSpectrumAtCursor(result, i, trackRuntimeAt(i).offsetSeconds, spectrumCursorNorm, channelIndex);
                if (!slice) {
                    if (paintedByChannel.get(channelIndex) && isSpectrumSliceRequestPendingForCursor(i, spectrumCursorNorm, channelIndex)) {
                        return;
                    }
                    ctx.clearRect(0, 0, W, H);
                    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
                    ctx.font = '9px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(STR.canvasOutOfRange, W / 2, H / 2);
                    paintedByChannel.set(channelIndex, false);
                    return;
                }
                ctx.clearRect(0, 0, W, H);
                const color = trackColor(i);
                const visFreqMinT = specFreqStart * slice.maxFrequencyHz;
                const visFreqMaxT = specFreqEnd * slice.maxFrequencyHz;
                const visDbMinT = (specDbMin != null) ? specDbMin : slice.minDb;
                const visDbMaxT = (specDbMax != null) ? specDbMax : slice.maxDb;
                drawSpectrumAxes(ctx, W, H, slice, 32, 6, 4, 14, visFreqMinT, visFreqMaxT, visDbMinT, visDbMaxT);
                drawSpectrumLine(ctx, W, H, slice, color, { padL: 32, padR: 6, padT: 4, padB: 14 }, visFreqMinT, visFreqMaxT, visDbMinT, visDbMaxT);
                paintedByChannel.set(channelIndex, true);
                if (spectrumHoverNorm !== null && spectrumHoverTrackId === trackId && spectrumHoverChannelIndex === channelIndex) {
                    const padL2 = 32, padR2 = 6, padT2 = 4, padB2 = 14;
                    const plotW2 = W - padL2 - padR2;
                    const plotH2 = H - padT2 - padB2;
                    const snap = spectrumBinAtHover(slice, spectrumHoverNorm, padL2, plotW2, padT2, plotH2, visFreqMinT, visFreqMaxT, visDbMinT, visDbMaxT);
                    if (!snap) {
                        return;
                    }
                    ctx.save();
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
                    ctx.beginPath();
                    ctx.moveTo(snap.x, padT2);
                    ctx.lineTo(snap.x, H - padB2);
                    ctx.stroke();
                    if (snap.dbVal !== undefined && snap.y !== null) {
                        ctx.strokeStyle = color;
                        ctx.beginPath();
                        ctx.moveTo(padL2, snap.y);
                        ctx.lineTo(W - padR2, snap.y);
                        ctx.stroke();
                    }
                    ctx.setLineDash([]);
                    ctx.restore();
                    const readoutEl = document.getElementById('spectrum-freq-readout');
                    if (readoutEl && snap.dbVal !== undefined) {
                        readoutEl.style.color = color;
                        readoutEl.textContent = spectrumCursorReadoutText(spectrumReadoutTrackLabel(result, channelIndex), snap.freqHz, snap.dbVal, dbLevelUnitFor(slice));
                    }
                }
            });
        });
    }
    function renderOverlaySpectrum() {
        const canvas = document.getElementById('spectrum-overlay-canvas');
        if (!canvas) {
            return;
        }
        const wrap = document.getElementById('spectrum-overlay-wrap');
        const w = contentBoxWidth(wrap, 800);
        const prevW = canvas.width;
        const prevH = canvas.height;
        syncCanvasSize(canvas, w, spectrumOverlayHeight);
        if (canvas.width !== prevW || canvas.height !== prevH) {
            overlaySpectrumPainted = false;
        }
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const slices: SpectrumSeries[] = [];
        let pendingVisibleSlice = false;
        trackStore.displayOrder.forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const i = record.protocolIndex;
            const result = record.result;
            if (record.runtime.hidden) {
                return;
            }
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const slice = extractSpectrumAtCursor(result, i, trackRuntimeAt(i).offsetSeconds, spectrumCursorNorm, channelIndex);
                if (slice) {
                    slices.push({
                        slice: slice,
                        color: trackColor(i),
                        index: i,
                        channelIndex: channelIndex,
                        label: spectrumSeriesLabel(result, channelIndex),
                    });
                }
                else if (isSpectrumSliceRequestPendingForCursor(i, spectrumCursorNorm, channelIndex)) {
                    pendingVisibleSlice = true;
                }
            });
        });
        if (overlaySpectrumPainted && pendingVisibleSlice) {
            return;
        }
        if (slices.length === 0) {
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(STR.spectrumNoData, W / 2, H / 2);
            overlaySpectrumPainted = false;
            return;
        }
        ctx.clearRect(0, 0, W, H);
        let minDb = Infinity, maxDb = -Infinity, maxF = 0;
        slices.forEach(function (s: SpectrumSeries) {
            if (s.slice.minDb < minDb) {
                minDb = s.slice.minDb;
            }
            if (s.slice.maxDb > maxDb) {
                maxDb = s.slice.maxDb;
            }
            if (s.slice.maxFrequencyHz > maxF) {
                maxF = s.slice.maxFrequencyHz;
            }
        });
        const padL = 36, padR = 8, padT = 8, padB = 18;
        const visFreqMinO = specFreqStart * maxF;
        const visFreqMaxO = specFreqEnd * maxF;
        const visDbMinO = (specDbMin != null) ? specDbMin : minDb;
        const visDbMaxO = (specDbMax != null) ? specDbMax : maxDb;
        _lastSpectrumMaxF = maxF;
        _lastVisDbMin = visDbMinO;
        _lastVisDbMax = visDbMaxO;
        const sharedAxis = { values: [], frequencyBins: 1, maxFrequencyHz: maxF, minDb: visDbMinO, maxDb: visDbMaxO };
        drawSpectrumAxes(ctx, W, H, sharedAxis, padL, padR, padT, padB, visFreqMinO, visFreqMaxO, visDbMinO, visDbMaxO);
        const plotW = W - padL - padR;
        const plotH = H - padT - padB;
        const range = visDbMaxO - visDbMinO;
        const visFreqRangeO = visFreqMaxO - visFreqMinO;
        if (visFreqRangeO <= 0) {
            return;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(padL, padT, plotW, plotH);
        ctx.clip();
        slices.forEach(function (s: SpectrumSeries) {
            if (range <= 0) {
                return;
            }
            ctx.strokeStyle = s.color;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            const fBins = s.slice.frequencyBins;
            const originalMaxFreq = s.slice.originalMaxFrequencyHz || s.slice.maxFrequencyHz;
            for (let i = 0; i < fBins; i++) {
                const fHz = (i / Math.max(fBins - 1, 1)) * originalMaxFreq;
                if (fHz > maxF) {
                    break;
                }
                const x = padL + ((fHz - visFreqMinO) / visFreqRangeO) * plotW;
                const v = s.slice.values[i];
                const norm = (v - visDbMinO) / range;
                const y = padT + (1 - norm) * plotH;
                if (i === 0) {
                    ctx.moveTo(x, y);
                }
                else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        });
        ctx.restore();
        if (spectrumHoverNorm !== null && spectrumHoverTrackId === 'overlay') {
            const mouseY = spectrumHoverYFrac !== null ? spectrumHoverYFrac * H : null;
            const nearest = chooseOverlaySpectrumSnap(slices, spectrumHoverNorm, mouseY, padL, plotW, padT, plotH, visFreqMinO, visFreqMaxO, visDbMinO, visDbMaxO);
            if (nearest) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(padL, padT, plotW, plotH);
                ctx.clip();
                ctx.strokeStyle = nearest.s.color;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                const fBinsH = nearest.s.slice.frequencyBins;
                const origMaxFH = nearest.s.slice.originalMaxFrequencyHz || nearest.s.slice.maxFrequencyHz;
                for (let i = 0; i < fBinsH; i++) {
                    const f = (i / Math.max(fBinsH - 1, 1)) * origMaxFH;
                    if (f > maxF) {
                        break;
                    }
                    const x = padL + ((f - visFreqMinO) / visFreqRangeO) * plotW;
                    const v = nearest.s.slice.values[i];
                    const n = (v - visDbMinO) / range;
                    const y = padT + (1 - n) * plotH;
                    if (i === 0) {
                        ctx.moveTo(x, y);
                    }
                    else {
                        ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();
                ctx.restore();
            }
            ctx.save();
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            const curX = nearest ? nearest.snap.x : padL + spectrumHoverNorm * plotW;
            ctx.beginPath();
            ctx.moveTo(curX, padT);
            ctx.lineTo(curX, H - padB);
            ctx.stroke();
            if (nearest) {
                ctx.strokeStyle = nearest.s.color;
                ctx.beginPath();
                ctx.moveTo(padL, nearest.snapY);
                ctx.lineTo(W - padR, nearest.snapY);
                ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.restore();
            const readoutEl = document.getElementById('spectrum-freq-readout');
            if (readoutEl) {
                if (nearest) {
                    readoutEl.textContent = spectrumReadoutText(nearest.s, nearest.snap, nearest.dbVal);
                    readoutEl.style.color = nearest.s.color;
                }
                else {
                    readoutEl.textContent = '';
                    readoutEl.style.color = '';
                }
            }
        }
        else if (spectrumHoverNorm === null) {
            const readoutEl = document.getElementById('spectrum-freq-readout');
            if (readoutEl) {
                readoutEl.textContent = '';
                readoutEl.style.color = '';
            }
        }
        // ── スペクトルドラッグ選択ゴムバンド ─────────────────────
        if (specDragAnchor !== null && specDragCurrent !== null) {
            const ax = padL + specDragAnchor.freqNorm * plotW;
            const ay = padT + (1 - specDragAnchor.dbNorm) * plotH;
            const bx = padL + specDragCurrent.freqNorm * plotW;
            const by = padT + (1 - specDragCurrent.dbNorm) * plotH;
            ctx.save();
            ctx.strokeStyle = 'rgba(100,180,255,0.9)';
            ctx.fillStyle = 'rgba(100,180,255,0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            const rx = Math.min(ax, bx), ry = Math.min(ay, by);
            const rw = Math.abs(bx - ax), rh = Math.abs(by - ay);
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);
            ctx.restore();
        }
        overlaySpectrumPainted = true;
    }
    function refreshSpectrumViews() {
        renderTrackSpectra();
        renderOverlaySpectrum();
        updateUiSmokeSpectrumState();
        const el = document.getElementById('spectrum-cursor-time');
        if (el) {
            const gs = computeGlobalSpan();
            el.textContent = '@ ' + formatTime(gs.startSec + spectrumCursorNorm * gs.spanSec);
        }
    }
    /** フォーカス中キャンバス → 最後に再生したトラック → 先頭 の順でインデックスを解決 */
    function resolveActiveTrackIndex(activeEl: RuntimeElement) {
        if (activeEl && activeEl.classList && activeEl.classList.contains('track-canvas')) {
            const n = trackIndexFromElement(activeEl);
            if (n !== null) {
                return n;
            }
        }
        if (playbackTrackId !== null) {
            return trackStore.protocolIndexForId(playbackTrackId);
        }
        const firstTrackId = trackStore.activeIds()[0];
        return firstTrackId ? trackStore.protocolIndexForId(firstTrackId) : null;
    }
    function removeTrack(trackId: TrackId) {
        const record = trackStore.get(trackId);
        if (!record?.active) {
            return;
        }
        const idx = record.protocolIndex;
        if (trackId === playbackTrackId) {
            stopPlayback(trackId);
        }
        const row = document.getElementById('track-row-' + idx);
        if (row) {
            row.remove();
        }
        const audio = getTrackAudio(idx);
        if (audio) {
            audio.remove();
        }
        releaseTrackDetail(idx);
        trackRuntimeAt(idx).hidden = true;
        var pos = trackStore.displayOrder.indexOf(trackId);
        var n = pos !== -1 ? pos + 1 : idx + 1;
        trackStore.remove(trackId);
        announce((STR.announceTrackRemoved || 'Track {n} removed').replace('{n}', String(n)));
        if (__colorPickTarget === trackId) {
            closeColorPicker();
        }
        updateVisibility();
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
    }
    function adjustOffset(idx: number, deltaSeconds: number) {
        trackRuntimeAt(idx).offsetSeconds += deltaSeconds;
        updateOffsetDisplays();
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
    }
    // ── Spectrogram settings popover ──
    let __spectrogramSettings = state.spectrogramSettings || {
        auto: true,
        stft: { nFft: 1024, hopSize: 256, window: 'hann' },
        display: { dbMin: null, dbMax: null, maxFrequencyHz: null }
    };
    window.__AWA_SPECTROGRAM_SETTINGS__ = __spectrogramSettings;
    function __updateSpecGearVisibility() {
        const gear = document.querySelector('[data-action="spectrogram-settings"]');
        if (gear) {
            gear.style.display = (contentType === 'spectrogram') ? '' : 'none';
        }
    }
    (function __buildSpecPopover() {
        const nfftOptions = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]
            .map(function (v) { return '<option value="' + v + '">' + v + '</option>'; })
            .join('');
        const html = ''
            + '<div id="spec-settings-popover" hidden style="position:absolute;z-index:50;background:var(--panel);border:1px solid var(--line);padding:12px;border-radius:6px;min-width:260px;color:var(--text);font-family:var(--font-ui);">'
            + '<label style="display:block;margin-bottom:6px"><input type="checkbox" id="spec-auto"> ' + escHtml(STR.specSettingsAuto) + '</label>'
            + '<fieldset id="spec-stft-fields" style="border:1px solid var(--line);padding:6px;margin-bottom:8px">'
            + '<legend>' + escHtml(STR.specSettingsStftLegend) + '</legend>'
            + '<label>' + escHtml(STR.specSettingsNFft) + ' <select id="spec-nfft">' + nfftOptions + '</select></label><br>'
            + '<label>' + escHtml(STR.specSettingsHopSize) + ' <input type="number" id="spec-hop" min="1" step="1"></label><br>'
            + '<label>' + escHtml(STR.specSettingsWindow) + ' <select id="spec-window">'
            + '<option value="hann">hann</option><option value="hamming">hamming</option>'
            + '<option value="blackman">blackman</option><option value="boxcar">boxcar</option>'
            + '</select></label>'
            + '<div style="font-size:11px;color:var(--muted)">' + escHtml(STR.settingsApplyHint) + '</div>'
            + '</fieldset>'
            + '<fieldset style="border:1px solid var(--line);padding:6px;margin-bottom:8px">'
            + '<legend>' + escHtml(STR.specSettingsDisplayLegend) + '</legend>'
            + '<label>' + escHtml(STR.specSettingsDbMin) + ' <input type="number" id="spec-dbmin" step="1" placeholder="' + escHtml(STR.specSettingsPlaceholderAuto) + '"></label><br>'
            + '<label>' + escHtml(STR.specSettingsDbMax) + ' <input type="number" id="spec-dbmax" step="1" placeholder="' + escHtml(STR.specSettingsPlaceholderAuto) + '"></label><br>'
            + '<label>' + escHtml(STR.specSettingsMaxFreqHz) + ' <input type="number" id="spec-maxfreq" min="1" step="1" placeholder="' + escHtml(STR.specSettingsPlaceholderNyquist) + '"></label>'
            + '</fieldset>'
            + '<div style="display:flex;gap:6px;justify-content:flex-end">'
            + '<button class="tb-btn" id="spec-reset">' + escHtml(STR.specSettingsReset) + '</button>'
            + '<button class="tb-btn" id="spec-apply">' + escHtml(STR.specSettingsApply) + '</button>'
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
        document.getElementById('spec-dbmin').value = __spectrogramSettings.display.dbMin == null ? '' : String(__spectrogramSettings.display.dbMin);
        document.getElementById('spec-dbmax').value = __spectrogramSettings.display.dbMax == null ? '' : String(__spectrogramSettings.display.dbMax);
        document.getElementById('spec-maxfreq').value = __spectrogramSettings.display.maxFrequencyHz == null ? '' : String(__spectrogramSettings.display.maxFrequencyHz);
        __applySpecAutoState();
    }
    function __applySpecAutoState() {
        const auto = document.getElementById('spec-auto').checked;
        document.getElementById('spec-stft-fields').disabled = auto;
    }
    function __readDisplayFromForm() {
        function n(id: string) {
            const v = document.getElementById(id).value;
            return v === '' ? null : Number(v);
        }
        return { dbMin: n('spec-dbmin'), dbMax: n('spec-dbmax'), maxFrequencyHz: n('spec-maxfreq') };
    }
    function __setSpectrogramDisplay(display: SpectrogramDisplaySettings): void {
        function n(v: number | null): number | null { return v == null ? null : Number(v); }
        __spectrogramSettings.display = {
            dbMin: n(display.dbMin),
            dbMax: n(display.dbMax),
            maxFrequencyHz: n(display.maxFrequencyHz),
        };
        messaging.post({ type: 'update-spectrogram-settings', settings: __spectrogramSettings });
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
        requestAnimationFrame(function () { publishTestSnapshot(); });
    }
    function __openSpecPopover() {
        const btn = document.querySelector('[data-action="spectrogram-settings"]');
        if (!btn || !__specPopover) {
            return;
        }
        const rect = btn.getBoundingClientRect();
        __specPopover.style.top = (rect.bottom + 6) + 'px';
        __specPopover.style.left = Math.max(8, rect.right - 280) + 'px';
        __specPopover.hidden = false;
        __syncSpecFormFromState();
    }
    function __closeSpecPopover() {
        if (__specPopover) {
            __specPopover.hidden = true;
        }
    }
    document.getElementById('spec-auto').addEventListener('change', __applySpecAutoState);
    ['spec-dbmin', 'spec-dbmax', 'spec-maxfreq'].forEach(function (id: string) {
        document.getElementById(id).addEventListener('change', function () {
            __setSpectrogramDisplay(__readDisplayFromForm());
        });
    });
    document.getElementById('spec-reset').addEventListener('click', function () {
        __spectrogramSettings = { auto: true, stft: { nFft: 1024, hopSize: 256, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } };
        window.__AWA_SPECTROGRAM_SETTINGS__ = __spectrogramSettings;
        __syncSpecFormFromState();
        messaging.post({ type: 'update-spectrogram-settings', settings: __spectrogramSettings });
        scheduleRender();
    });
    document.getElementById('spec-apply').addEventListener('click', function () {
        const selectedWindow = document.getElementById('spec-window').value;
        const stftWindow = selectedWindow === 'hamming' || selectedWindow === 'blackman' || selectedWindow === 'boxcar'
            ? selectedWindow
            : 'hann';
        __spectrogramSettings = {
            auto: document.getElementById('spec-auto').checked,
            stft: {
                nFft: Number(document.getElementById('spec-nfft').value),
                hopSize: Number(document.getElementById('spec-hop').value),
                window: stftWindow,
            },
            display: __readDisplayFromForm()
        };
        window.__AWA_SPECTROGRAM_SETTINGS__ = __spectrogramSettings;
        __setReanalyzeBusy(true, STR.reanalyzingStft);
        messaging.post({ type: 'request-reanalyze', settings: __spectrogramSettings });
        __closeSpecPopover();
    });
    // 再解析中のオーバーレイ
    (function __buildReanalyzeOverlay() {
        document.body.insertAdjacentHTML('beforeend', '<div id="reanalyze-overlay" style="position:fixed;top:0;left:0;right:0;z-index:60;background:var(--panel);color:var(--text);'
            + 'padding:8px 14px;border-bottom:1px solid var(--line);font-family:var(--font-ui);font-size:12px;'
            + 'display:none;align-items:center;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,0.3)">'
            + '<span class="spinner" style="width:12px;height:12px;border:2px solid var(--muted);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></span>'
            + '<span id="reanalyze-overlay-msg">' + escHtml(STR.reanalyzingDefault) + '</span>'
            + '</div>'
            + '<style>@keyframes spin { to { transform: rotate(360deg); } }</style>');
    })();
    function __setReanalyzeBusy(busy: boolean, msg?: string): void {
        const overlay = document.getElementById('reanalyze-overlay');
        if (!overlay) {
            return;
        }
        if (busy) {
            document.getElementById('reanalyze-overlay-msg').textContent = msg || STR.reanalyzingDefault;
            overlay.style.display = 'flex';
            announce((STR.announceAnalyzing || 'Analyzing: {msg}').replace('{msg}', msg || STR.reanalyzingDefault || ''));
        }
        else {
            overlay.style.display = 'none';
        }
        const applyBtn = document.getElementById('spec-apply');
        if (applyBtn) {
            applyBtn.disabled = !!busy;
        }
    }
    document.addEventListener('click', function (ev) {
        const target = eventTarget(ev);
        const btn = target && target.closest ? target.closest('[data-action="spectrogram-settings"]') : null;
        if (btn) {
            ev.stopPropagation();
            if (__specPopover.hidden) {
                __openSpecPopover();
            }
            else {
                __closeSpecPopover();
            }
            return;
        }
        if (__specPopover && !__specPopover.hidden && !__specPopover.contains(target)) {
            __closeSpecPopover();
        }
    });
    document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
            __closeSpecPopover();
        }
    });
    // ── ヘルプオーバーレイ ──
    (function __buildHelpOverlay() {
        const tableRows = SHORTCUT_ROWS.map(function (row) {
            return '<tr><td style="padding:3px 12px 3px 0;font-family:var(--font-mono);white-space:nowrap;color:var(--accent)">' + escHtml(row.shortcut)
                + '</td><td style="padding:3px 0;color:var(--text)">' + escHtml(STR[row.labelKey as keyof typeof STR]) + '</td></tr>';
        }).join('');
        document.body.insertAdjacentHTML('beforeend', '<div id="help-overlay" hidden role="dialog" aria-modal="true" aria-label="' + escHtml(STR.helpTitle) + '" '
            + 'style="position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.45)">'
            + '<div style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:20px 24px;min-width:320px;box-shadow:0 4px 24px rgba(0,0,0,0.4)">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'
            + '<span style="font-weight:700;font-size:13px;color:var(--text)">' + escHtml(STR.helpTitle) + '</span>'
            + '<button id="help-close-btn" class="tb-btn" style="font-size:11px;padding:2px 8px">' + escHtml(STR.helpClose) + '</button>'
            + '</div>'
            + '<table style="border-collapse:collapse;font-size:12px;width:100%">' + tableRows + '</table>'
            + '</div></div>');
        function openHelp() {
            var el = document.getElementById('help-overlay');
            if (el) {
                el.hidden = false;
                el.style.display = 'flex';
                var btn = document.getElementById('help-close-btn');
                if (btn) {
                    btn.focus();
                }
            }
        }
        function closeHelp() {
            var el = document.getElementById('help-overlay');
            if (el) {
                el.style.display = 'none';
                el.hidden = true;
            }
        }
        function isHelpOpen() { var el = document.getElementById('help-overlay'); return el && !el.hidden; }
        var closeBtn = document.getElementById('help-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeHelp);
        }
        document.getElementById('help-overlay').addEventListener('click', function (e) {
            if (eventTarget(e) === document.getElementById('help-overlay')) {
                closeHelp();
            }
        });
        // フォーカストラップ: aria-modal="true" の期待に応えるため、Tab キーをダイアログ内に閉じ込める
        document.getElementById('help-overlay').addEventListener('keydown', function (ev) {
            if (ev.key !== 'Tab') {
                return;
            }
            var overlay = document.getElementById('help-overlay');
            var focusable = Array.from(overlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
            if (focusable.length === 0) {
                ev.preventDefault();
                return;
            }
            var first = focusable[0];
            var last = focusable[focusable.length - 1];
            if (ev.shiftKey) {
                if (document.activeElement === first) {
                    last.focus();
                    ev.preventDefault();
                }
            }
            else {
                if (document.activeElement === last) {
                    first.focus();
                    ev.preventDefault();
                }
            }
        });
        document.addEventListener('keydown', function (ev) {
            var tag = document.activeElement && document.activeElement.tagName ? document.activeElement.tagName.toUpperCase() : '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                return;
            }
            if (ev.key === '?') {
                if (isHelpOpen()) {
                    closeHelp();
                }
                else {
                    openHelp();
                }
                ev.preventDefault();
                return;
            }
            if (ev.key === 'Escape' && isHelpOpen()) {
                closeHelp();
                ev.stopPropagation();
            }
        });
    })();
    messaging.onMessage(function (msg) {
        if (!msg) {
            return;
        }
        if (msg.type === 'reanalyze-start') {
            const cnt = typeof msg.count === 'number' ? msg.count : 0;
            __setReanalyzeBusy(true, STR.reanalyzingFiles.replace('{count}', String(cnt)));
            return;
        }
        if (msg.type === 'reanalyze-end') {
            __setReanalyzeBusy(false);
            return;
        }
        if (msg.type === 'analysis-file-progress') {
            var progMsg = '(' + msg.current + '/' + msg.total + ') ' + (msg.fileName || '');
            __setReanalyzeBusy(true, progMsg);
            return;
        }
        if (msg.type === 'analysis-update' && Array.isArray(msg.results)) {
            __setReanalyzeBusy(false);
            const reconciliation = trackStore.reconcile(msg.results, function (nextResult, previousResult) {
                return Object.assign({}, nextResult, { audioSource: previousResult?.audioSource || nextResult.audioSource || '' });
            });
            analysisId = createAnalysisId();
            state.results = trackStore.activeIds().map(function (trackId) {
                return trackStore.require(trackId).result;
            });
            if (playbackTrackId && !trackStore.get(playbackTrackId)?.active) {
                clearPlaybackState();
            }
            rebuildResultsPane();
            if (reconciliation.protocolOrderChanged) {
                clearPlaybackState();
                const audioHost = document.getElementById('audio-host');
                if (audioHost) {
                    audioHost.innerHTML = buildAudioElements();
                    attachAudioEvents();
                }
            }
            overlaySpectrumPainted = false;
            announce((STR.announceAnalysisDone || 'Analysis complete: {count} tracks').replace('{count}', String(state.results.length)));
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
            requestAnimationFrame(function () { publishTestSnapshot(); });
            return;
        }
    });
    // ── Track drag reorder ──
    var reorderDragFrom: TrackId | null = null;
    function reorderTracks(fromTrackId: TrackId, toTrackId: TrackId) {
        if (!trackStore.reorder(fromTrackId, toTrackId)) {
            return;
        }
        var wrap = document.getElementById('stacked-wrap');
        if (wrap) {
            trackStore.displayOrder.forEach(function (trackId) {
                var row = document.getElementById('track-row-' + trackIndexForId(trackId));
                if (row) {
                    wrap.appendChild(row);
                }
            });
        }
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
    }
    function cleanupReorderDrag() {
        if (reorderDragFrom !== null) {
            const dragIndex = trackStore.protocolIndexForId(reorderDragFrom);
            var row = dragIndex === null ? null : document.getElementById('track-row-' + dragIndex);
            if (row) {
                row.style.opacity = '';
            }
        }
        document.querySelectorAll('.track-row').forEach(function (r) {
            r.classList.remove('drag-over');
        });
        reorderDragFrom = null;
    }
    // ── Color picker popover ──
    var __colorPickTarget: TrackId | null = null;
    var __colorPickAnchor: RuntimeElement | null = null;
    function openColorPicker(trackId: TrackId, anchorEl: RuntimeElement) {
        __colorPickTarget = trackId;
        __colorPickAnchor = anchorEl || null;
        var pop = document.getElementById('color-picker-popover');
        if (!pop) {
            return;
        }
        var rect = anchorEl.getBoundingClientRect();
        pop.style.top = (rect.bottom + 4) + 'px';
        pop.style.left = rect.left + 'px';
        pop.removeAttribute('hidden');
        pop.focus();
    }
    function closeColorPicker() {
        var pop = document.getElementById('color-picker-popover');
        if (pop) {
            pop.setAttribute('hidden', '');
        }
        if (__colorPickAnchor && typeof __colorPickAnchor.focus === 'function') {
            __colorPickAnchor.focus();
        }
        __colorPickTarget = null;
        __colorPickAnchor = null;
    }
    (function __buildColorPopover() {
        var swatches = TRACK_COLORS.map(function (hex: string) {
            return '<div class="color-palette-swatch" data-color="' + hex + '"'
                + ' style="background:' + hex + '" role="button" tabindex="0"'
                + ' aria-label="' + hex + '"></div>';
        }).join('');
        var html = '<div id="color-picker-popover" hidden tabindex="-1"'
            + ' style="position:fixed;z-index:9999;background:var(--panel);'
            + 'border:1px solid var(--line);padding:8px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.4);">'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;width:148px">' + swatches + '</div>'
            + '<button id="color-reset-btn" style="margin-top:6px;width:100%;font-size:11px;'
            + 'background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:2px;cursor:pointer;padding:2px 0">'
            + escHtml(STR.trackColorReset) + '</button>'
            + '</div>';
        var container = document.createElement('div');
        container.innerHTML = html;
        const popoverNode = container.firstChild;
        if (popoverNode) {
            document.body.appendChild(popoverNode);
        }
        var pop = document.getElementById('color-picker-popover');
        pop.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeColorPicker();
                return;
            }
            if (e.key !== 'Enter' && e.key !== ' ') {
                return;
            }
            var sw = eventTarget(e).closest ? eventTarget(e).closest('.color-palette-swatch') : null;
            if (sw) {
                e.preventDefault();
                sw.click();
            }
        });
        pop.addEventListener('click', function (e) {
            var sw = eventTarget(e).closest ? eventTarget(e).closest('.color-palette-swatch') : null;
            if (sw && __colorPickTarget !== null) {
                var hex = sw.getAttribute('data-color');
                trackStore.require(__colorPickTarget).runtime.color = hex;
                var hs = document.querySelector('[data-action="pick-color"][data-track-id="' + __colorPickTarget + '"]');
                if (hs) {
                    hs.style.background = hex;
                }
                scheduleRender();
                scheduleSpectrumRefresh('immediate');
                closeColorPicker();
                return;
            }
            if (eventTarget(e).id === 'color-reset-btn' && __colorPickTarget !== null) {
                trackStore.require(__colorPickTarget).runtime.color = null;
                var def = trackColor(trackIndexForId(__colorPickTarget));
                var hs2 = document.querySelector('[data-action="pick-color"][data-track-id="' + __colorPickTarget + '"]');
                if (hs2) {
                    hs2.style.background = def;
                }
                scheduleRender();
                scheduleSpectrumRefresh('immediate');
                closeColorPicker();
            }
        });
        document.addEventListener('click', function (e) {
            var pop2 = document.getElementById('color-picker-popover');
            if (!pop2 || pop2.hasAttribute('hidden')) {
                return;
            }
            var clickedSwatch = eventTarget(e).closest ? eventTarget(e).closest('[data-action="pick-color"]') : null;
            if (pop2.contains(eventTarget(e)) || clickedSwatch) {
                return;
            }
            closeColorPicker();
        }, true);
    })();
    __updateSpecGearVisibility();
}
