import { OrderedSelection } from '../../shared/utils/directorySelection';
import { channelLabel, channelsForResult, formatClockTime } from '../../shared/utils/format';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { paintSpectrogramRaster } from './spectrogramRaster';
import { formatAmplitudeValue, formatWaveformAxisLabels, formatHz, dbLevelUnitFor, formatDbLevel, drawWaveformAmplitudeAxis, drawSpectrogramFrequencyAxis, drawSpectrogramColorbar, drawSpectrumLine, drawSpectrumAxes, type DrawTheme } from '../draw/canvasDrawers';
import { isCacheSufficient, computeReqBounds, rangeRequestPointCount, waveformPointCount } from '../waveform/rangeRequestPolicy';
import { extractSpectrumAtCursor as extractCursorSpectrum } from '../spectrum/cursorSpectrum';
import { buildSelectionTree as buildSelectionTreeFromPaths } from './directorySelection';
import { createSelectionTreeView } from './selectionTreeView';
import { buildSpectrumCsv, wavLoopRegions } from './runtimeExports';
import { eventTarget } from './domAdapter';
import { HostMessenger } from './hostMessaging';
import {
    createTrackTimeMapping,
    globalNormFromTrackTime as mapGlobalNormFromTrackTime,
    trackTimeFromGlobalNorm as mapTrackTimeFromGlobalNorm,
} from './playback';
import { positionPopover } from './settingsPopover';
import { composeTrackCanvases, triggerAnchorDownload, visibleExportCanvases } from './exportDownloads';
import { clampHeight, createHeightResize, heightInputRequest, type HeightKind } from './heightResize';
import { installRangePopover } from '../rangePopover';
import { buildMarkdownReport, buildNotebook, type ReportLoopRegion, type ReportTrack } from '../../shared/report/analysisReport';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { installHelpOverlay } from './helpOverlay';
import { canvasTimeHit, clampedCanvasNorm, CURSOR_LINE_STYLE, drawDashedTimeLine, drawRectZoomSelection, formatReadoutHz, HOVER_LINE_STYLE } from './canvasOverlays';
import { applyOverlayCompatibility, calibrationBadgeHtml, calibrationButtonHtml, calibrationRequest, ensureCalibrationStyles, hasIncompatibleLevelReferences, isClipped, peakText } from './calibrationDecorations';
import {
    hoverNormForFrequency as mapHoverNormForFrequency,
    spectrumBinAtFrequency as findSpectrumBinAtFrequency,
    zoomSpectrumRange,
} from './spectrumRuntime';
import { normalizeRuntimeState, PersistedStateStore } from './stateStore';
import { ComparisonTestBridge } from './testBridge';
import { TrackStore } from './trackStore';
import { installColorPicker } from './colorPicker';
import { installTrackReorderDrag } from './trackReorderDrag';
import { installSpectrogramSettingsPopover } from './spectrogramSettingsPopover';
import { installReanalyzeOverlay } from './reanalyzeOverlay';
import {
    amplitudeNormToCanvasY as mapAmplitudeNormToCanvasY,
    canvasYToAmplitudeNorm as mapCanvasYToAmplitudeNorm,
    ZOOM_IN_FACTOR,
    zoomNormalizedRange,
} from './waveformInteraction';
import type { ChannelSummary, SpectrogramDisplaySettings, SpectrogramData, WaveformEnvelope, } from '../../shared/analysis/analysisTypes';
import type { CanvasSyncOptions, ComparisonBootstrap, ComparisonTrackState, DragPoint, LazyRequestState, LoopRegion, PersistedWebviewState, RectZoomSelection, RuntimeElement, SelectionTreeNode, SpectrumSeries, SpectrumSlice, SpectrumSnap, TestAction, TrackFileView, TrackId, TrackRuntimeState, WaveformCoverage, WaveformDragState, WaveformDrawOptions, WaveformRangeCache, } from './types';
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
    const selection = new OrderedSelection();
    const selectedFilePaths = selection.paths;
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
    const currentTreeFilterRootPath = state.rootPath || '';
    // ─── ファイルパス一覧からディレクトリツリーを webview 側で組み立てる (#91) ───
    const selectionTree = buildSelectionTreeFromPaths(state.rootPath, allSelectableFilePaths);
    var __directoryTree = isSelectionMode ? selectionTree.roots : [];
    // 折りたたみ状態とフィルタ文字列は webview.html 再代入後も vscode.getState() から current rootPath 単位で復元する
    const selectionTreeView = createSelectionTreeView({
        document,
        strings: STR,
        tree: selectionTree,
        rootPath: currentTreeFilterRootPath,
        collapseState: persistedWebviewState.directoryCollapseRootPath === currentTreeFilterRootPath
            ? (persistedWebviewState.directoryCollapseState || {})
            : {},
        filterQuery: persistedWebviewState.treeFilterRootPath === currentTreeFilterRootPath
            && typeof persistedWebviewState.treeFilterQuery === 'string'
            ? persistedWebviewState.treeFilterQuery
            : '',
        isSelected: hasSelectedFilePath,
        persist: persistWebviewState,
        onFileToggled(filePath, checked) {
            if (checked) {
                trackStore.allowExplicitSelection(filePath);
                addSelectedFilePath(filePath);
            }
            else {
                removeSelectedFilePath(filePath);
            }
            syncSelectionSummary();
            postSelectedFiles();
        },
        handleAction: handleSelectionAction,
        syncSummary: syncSelectionSummary,
        setFilterFlush: (handler) => testBridge.setTreeFilterFlush(handler),
        setTimeout: (handler, timeout) => setTimeout(handler, timeout),
        clearTimeout,
    });
    let selectionMessageSeq = 0;
    let pythonEnvironmentState = state.pythonEnvironmentState || {
        pythonCommand: 'python3',
        status: 'normal',
        tooltip: 'Click to select Python environment',
    };
    function drawTheme(): DrawTheme {
        const style = getComputedStyle(document.body);
        return {
            mutedColor: style.getPropertyValue('--muted').trim() || '#888',
            bgColor: style.getPropertyValue('--track-bg').trim() || 'rgba(0,0,0,0.55)',
            lineColor: style.getPropertyValue('--line').trim() || '#444',
        };
    }
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
    const SPECTRUM_PLAYBACK_TARGET_FRAME_MS = 1000 / 32;
    let spectrumRafPending = false;
    let spectrumTimerId: number | null = null;
    let spectrumRequestTimerId: number | null = null;
    let lastSpectrumRequestAt = -Infinity;
    let spectrumAllowsSliceRequests = true;
    let spectrumCursorNorm = 0;
    interface SpectrogramRasterCacheEntry {
        source: SpectrogramData;
        key: string;
    }
    const spectrogramRasterCache = new Map<string, SpectrogramRasterCacheEntry>();
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
            queuePlaybackSpectrumRequests(cursorNorm);
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
    interface DesiredSpectrumSliceRequest extends LazyRequestState {
        trackIndex: number;
        filePath: string;
        generation: number;
        cursorNorm: number;
        globalCursorNorm: number;
        requestedAt: number;
    }
    let spectrumRequestGeneration = 0;
    let activeSpectrumSliceRequest: DesiredSpectrumSliceRequest | null = null;
    const desiredSpectrumSliceRequests = new Map<string, DesiredSpectrumSliceRequest>();
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
    function spectrumSliceRequestKey(trackId: TrackId) {
        return trackId;
    }
    function invalidateDesiredSpectrumSliceRequests() {
        spectrumRequestGeneration += 1;
        desiredSpectrumSliceRequests.clear();
        if (spectrumRequestTimerId !== null) {
            clearTimeout(spectrumRequestTimerId);
            spectrumRequestTimerId = null;
        }
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
    function trackSpectrogramOverlayCanvasId(trackIndex: number, channelIndex: number) {
        return 'track-spectrogram-overlay-' + trackIndex + channelCanvasSuffix(channelIndex);
    }
    function trackSpectrumCanvasId(trackIndex: number, channelIndex: number) {
        return 'track-spectrum-' + trackIndex + channelCanvasSuffix(channelIndex);
    }
    function channelLevel(channel: ChannelSummary, levelDb: number | undefined): string {
        if (!Number.isFinite(levelDb)) { return '—'; }
        return Number(levelDb).toFixed(1) + ' ' + (channel.measurement?.levelUnit ?? 'dB');
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
        desiredSpectrumSliceRequests.delete(spectrumSliceRequestKey(record.id));
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
        return Math.min(0.002, 0.01 / dur);
    }
    function isSpectrumSliceRequestPendingForCursor(i: number, cursorNormValue: number) {
        const record = trackRecordAtIndex(i);
        const pending = record
            ? desiredSpectrumSliceRequests.get(spectrumSliceRequestKey(record.id))
                || record.spectrumSliceRequests.get(0)
            : undefined;
        if (!pending) {
            return false;
        }
        const result = state.results[i];
        const localNorm = trackLocalCursorNorm(i, cursorNormValue);
        if (localNorm === null) {
            return false;
        }
        return pending.settingsSignature === currentSpectrumDataSignature()
            && Math.abs((pending.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result);
    }
    function requestSpectrumSlice(i: number, cursorNormValue: number) {
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
        const settingsSignature = currentSpectrumDataSignature();
        const cached = record.spectrumSliceCache.get(0);
        if (cached && cached.settingsSignature === settingsSignature && Math.abs((cached.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result)) {
            return;
        }
        const key = spectrumSliceRequestKey(record.id);
        const pending = desiredSpectrumSliceRequests.get(key) || record.spectrumSliceRequests.get(0);
        if (pending && pending.settingsSignature === settingsSignature && Math.abs((pending.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result)) {
            return;
        }
        const requestId = nextLazyRequestId('slice', i);
        desiredSpectrumSliceRequests.set(key, {
            trackId: record.id,
            requestId: requestId,
            analysisId: analysisId,
            settingsSignature: settingsSignature,
            cursorNorm: localNorm,
            globalCursorNorm: cursorNormValue,
            trackIndex: i,
            filePath: result.filePath,
            generation: spectrumRequestGeneration,
            requestedAt: spectrumNow(),
        });
        pumpSpectrumSliceRequests();
    }
    function queuePlaybackSpectrumRequests(cursorNormValue: number) {
        trackStore.activeIds().forEach(function (trackId) {
            const index = trackStore.protocolIndexForId(trackId);
            if (index !== null) {
                requestSpectrumSlice(index, cursorNormValue);
            }
        });
    }
    function pumpSpectrumSliceRequests() {
        if (activeSpectrumSliceRequest) {
            return;
        }
        if (desiredSpectrumSliceRequests.size > 0) {
            const remainingMs = SPECTRUM_PLAYBACK_TARGET_FRAME_MS - (spectrumNow() - lastSpectrumRequestAt);
            if (remainingMs > 1) {
                if (spectrumRequestTimerId === null) {
                    spectrumRequestTimerId = window.setTimeout(function () {
                        spectrumRequestTimerId = null;
                        pumpSpectrumSliceRequests();
                    }, remainingMs);
                }
                return;
            }
        }
        while (desiredSpectrumSliceRequests.size > 0) {
            const entry = desiredSpectrumSliceRequests.entries().next().value as [string, DesiredSpectrumSliceRequest] | undefined;
            if (!entry) {
                return;
            }
            const [key, request] = entry;
            desiredSpectrumSliceRequests.delete(key);
            const record = trackStore.get(request.trackId);
            const currentTrackIndex = record ? trackStore.protocolIndexForId(record.id) : null;
            if (!record || currentTrackIndex === null || currentTrackIndex !== request.trackIndex
                || request.generation !== spectrumRequestGeneration
                || request.analysisId !== analysisId
                || request.settingsSignature !== currentSpectrumDataSignature()
                || record.runtime.hidden || record.result.error) {
                continue;
            }
            activeSpectrumSliceRequest = request;
            lastSpectrumRequestAt = spectrumNow();
            record.spectrumSliceRequests.set(0, request);
            messaging.post({
                type: 'request-spectrum-slice',
                requestId: request.requestId,
                analysisId: request.analysisId,
                settingsSignature: request.settingsSignature,
                trackIndex: request.trackIndex,
                filePath: request.filePath,
                cursorNorm: request.cursorNorm,
            });
            return;
        }
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
        const active = activeSpectrumSliceRequest;
        if (!active || active.requestId !== msg.requestId) {
            return;
        }
        activeSpectrumSliceRequest = null;
        const i = msg.trackIndex;
        const trackId = trackIdAtProtocolBoundary(i, msg.type);
        const record = trackId ? trackStore.get(trackId) : undefined;
        if (!trackId || !record) {
            pumpSpectrumSliceRequests();
            return;
        }
        const pending = record.spectrumSliceRequests.get(0);
        if (!pending || pending.trackId !== trackId || pending.requestId !== msg.requestId || pending.analysisId !== msg.analysisId || pending.settingsSignature !== msg.settingsSignature) {
            pumpSpectrumSliceRequests();
            return;
        }
        record.spectrumSliceRequests.delete(0);
        const isCurrent = active.generation === spectrumRequestGeneration
            && pending.analysisId === analysisId
            && pending.settingsSignature === currentSpectrumDataSignature();
        if (msg.type === 'spectrum-slice-result' && isCurrent) {
            msg.channels.forEach(function (channel) {
                record.spectrumSliceCache.set(channel.channelIndex, {
                    settingsSignature: msg.settingsSignature,
                    cursorNorm: pending.cursorNorm,
                    channelIndex: channel.channelIndex,
                    values: channel.values,
                    frequencyBins: msg.frequencyBins,
                    originalMaxFrequencyHz: msg.maxFrequencyHz,
                    maxFrequencyHz: msg.maxFrequencyHz,
                    minDb: channel.minDb,
                    maxDb: channel.maxDb,
                    unit: channel.unit,
                    axisLabel: channel.axisLabel,
                });
            });
            spectrumCursorNorm = active.globalCursorNorm;
            if (testBridge.state) {
                testBridge.state.spectrumPerformance = {
                    requestId: msg.requestId,
                    cursorNorm: active.cursorNorm,
                    backendComputeMs: msg.computeMs,
                    cursorToResponseMs: Math.max(0, spectrumNow() - active.requestedAt),
                    responseAt: spectrumNow(),
                    inFlight: 0,
                    desiredCount: desiredSpectrumSliceRequests.size,
                };
            }
        }
        scheduleSpectrumFrame(false, false);
        requestAnimationFrame(function () { publishTestSnapshot(); });
        pumpSpectrumSliceRequests();
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
            heightResize.begin(kind, startY);
            heightResize.update(endY);
            heightResize.end();
        }
        if (entry.action === 'open-spectrogram-settings') {
            const gear = document.querySelector('[data-action="spectrogram-settings"]');
            if (gear) {
                gear.click();
            }
        }
        if (entry.action === 'apply-spectrogram-settings' && entry.payload) {
            const p = entry.payload;
            if (!specSettingsPopover.isOpen()) {
                specSettingsPopover.open();
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
            specSettingsPopover.applyAutoState();
            document.getElementById('spec-apply').click();
        }
        if (entry.action === 'set-cursor' && entry.payload) {
            invalidateDesiredSpectrumSliceRequests();
            cursorNorm = Math.max(0, Math.min(1, Number(entry.payload.cursorNorm)));
            updateCursorDisplay(cursorNorm);
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
        }
        if (entry.action === 'set-file-selected' && entry.payload) {
            const checkbox = Array.from(document.querySelectorAll('.selection-file-checkbox'))
                .find((input) => input.getAttribute('data-file-path') === entry.payload?.filePath);
            if (!checkbox) { throw new Error('Selection checkbox not found'); }
            checkbox.checked = !!entry.payload.selected;
            const event = document.createEvent('Event');
            event.initEvent('change', true, false);
            checkbox.dispatchEvent(event);
        }
        if (entry.action === 'set-track-offset' && idx >= 0 && entry.payload) {
            const offsetSeconds = Number(entry.payload.offsetSeconds ?? 0);
            if (!Number.isFinite(offsetSeconds)) {
                return;
            }
            trackRuntimeAt(idx).offsetSeconds = offsetSeconds;
            invalidateDesiredSpectrumSliceRequests();
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
            if (!specSettingsPopover.isOpen()) {
                specSettingsPopover.open();
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
            const { reqStart, reqEnd } = computeReqBounds(fileView.fileAtZoomStart, fileView.fileAtZoomEnd);
            const pts = rangeRequestPointCount(W);
            if (isCacheSufficient(record.rangeCache, reqStart, reqEnd, pts, W, fileView.fileAtZoomStart, fileView.fileAtZoomEnd, channelsForResult(result).length)) {
                return;
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
        messaging.post({
            type: 'comparison-panel-ready',
            calibrationRevisions: state.results.map(function(result) {
                return {
                    filePath: result.filePath,
                    analysisRevision: result.analysisRevision || 0,
                };
            }),
        });
    });
    function isReanalyzeBusy() {
        return !!reanalyzeOverlay && reanalyzeOverlay.isBusy();
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
            + '    <span style="font-weight:700;font-size:12px;color:var(--accent)">' + escapeHtml(STR.selectionHeader) + '</span>'
            + '    <div class="tb-sep"></div>'
            + '    <button class="tb-btn" data-action="open-file">' + escapeHtml(STR.btnOpenFile) + '</button>'
            + '    <button class="tb-btn" data-action="open-folder">' + escapeHtml(STR.btnOpenAnotherFolder) + '</button>'
            + '    <button class="' + pythonButtonClass + '" id="selection-python-environment" data-action="select-python-environment" title="' + escapeHtml(pythonButtonTooltip) + '">' + escapeHtml(pythonButtonText) + '</button>'
            + '  </div>'
            + '  <div id="selection-body">'
            + '    <div id="selection-sidebar">'
            + '      <div id="selection-summary">'
            + '        <div class="selection-count" id="selection-count"></div>'
            + '        <div class="selection-path">' + escapeHtml(state.rootPath || '') + '</div>'
            + '      </div>'
            + '      <div id="tree-filter-wrap">'
            + '        <input id="tree-filter-input" type="text" value="' + escapeHtml(selectionTreeView.filterQuery) + '" placeholder="' + escapeHtml(STR.treeFilterPlaceholder || 'Filter files...') + '" autocomplete="off" spellcheck="false">'
            + '      </div>'
            + '      <div id="selection-actions">'
            + '        <button class="tb-btn" data-action="selection-select-all">' + escapeHtml(STR.btnSelectAll) + '</button>'
            + '        <button class="tb-btn" data-action="selection-clear-all">' + escapeHtml(STR.btnClear) + '</button>'
            + '      </div>'
            + '      <div id="selection-tree" role="group" aria-label="' + escapeHtml(STR.ariaSelectionTree) + '">' + selectionTreeView.renderTree(__directoryTree, true, 0) + '</div>'
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
            spectrogramRasterCache.clear();
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
        return '<div id="toolbar" role="toolbar" aria-label="' + escapeHtml(STR.ariaToolbar) + '">' + buildToolbar() + '</div>'
            + '<div id="tracks-wrapper">'
            + '  <div id="ruler-row"><div id="ruler-spacer"></div><div id="ruler-axis-spacer" style="width:' + AXIS_W + 'px;flex:none"></div><canvas id="ruler-canvas"></canvas></div>'
            + '  <div id="stacked-wrap">' + tracks + '</div>'
            + '  <div id="empty-state"><p>' + escapeHtml(emptyMessage) + '</p></div>'
            + '</div>'
            + '<div id="spectrum-section">'
            + '  <div id="spectrum-section-header"><span>' + escapeHtml(STR.spectrumSectionTitle) + '</span><span id="spectrum-cursor-time" style="font-family:var(--font-mono);"></span><span id="spectrum-freq-readout" style="font-family:var(--font-mono);margin-left:14px;"></span></div>'
            + '  <div id="spectrum-zoom-toolbar" style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:11px;">'
            + '    <span class="tb-label">' + escapeHtml(STR.spectrumZoomLabel) + '</span>'
            + '    <button class="tb-btn" data-action="spec-zoom-out" aria-label="' + escapeHtml(STR.ariaSpecZoomOut) + '">－</button>'
            + '    <button class="tb-btn" data-action="spec-zoom-in" aria-label="' + escapeHtml(STR.ariaSpecZoomIn) + '">＋</button>'
            + '    <button class="tb-btn" data-action="spec-zoom-reset" aria-label="' + escapeHtml(STR.ariaSpecZoomReset) + '">' + escapeHtml(STR.btnSpecZoomReset) + '</button>'
            + '  </div>'
            + '  <div id="spectrum-overlay-wrap"><div class="height-resizer spectrum-height-resizer" data-action="spectrum-height-drag" role="separator" aria-orientation="horizontal" aria-label="' + escapeHtml(STR.heightSpectrumLabel + ' resize') + '"></div><canvas id="spectrum-overlay-canvas" tabindex="0" aria-label="' + escapeHtml(STR.spectrumSectionTitle) + '"></canvas></div>'
            + '</div>'
            + '<div id="audio-host">' + buildAudioElements() + '</div>';
    }
    function buildAudioElements() {
        return trackStore.activeIds().map(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            if (!result.audioSource) {
                return '';
            }
            return '<audio id="track-audio-' + record.protocolIndex + '" data-track-id="' + trackId + '" preload="metadata"' + (record.runtime.muted ? ' muted' : '') + ' src="' + escapeHtml(result.audioSource) + '"></audio>';
        }).join('');
    }
    function buildToolbar() {
        function toolbarMenu(label: string, content: string) {
            return '<details class="tb-menu"><summary class="tb-btn">' + escapeHtml(label) + '</summary><div class="tb-menu-popover">' + content + '</div></details>';
        }
        const adjustMenu = '<div class="tb-menu-row"><span class="tb-label">' + escapeHtml(STR.toolbarHeightLabel) + '</span></div>'
            + '<div class="tb-menu-row"><span class="tb-label">' + escapeHtml(STR.heightTrackLabel) + '</span>'
            + '<input class="tb-number" type="number" min="' + TRACK_HEIGHT_MIN + '" max="' + TRACK_HEIGHT_MAX + '" step="1" value="' + trackHeight + '" data-action="track-height-input" aria-label="' + escapeHtml(STR.heightTrackLabel + ' px') + '">'
            + '<button class="tb-btn" data-action="track-height-reset" aria-label="' + escapeHtml(STR.ariaTrackHeightReset) + '">' + escapeHtml(STR.heightTrackLabel + ' ' + STR.btnHeightReset) + '</button></div>'
            + '<div class="tb-menu-row"><span class="tb-label">' + escapeHtml(STR.heightSpectrumLabel) + '</span>'
            + '<input class="tb-number" type="number" min="' + SPECTRUM_HEIGHT_MIN + '" max="' + SPECTRUM_HEIGHT_MAX + '" step="1" value="' + spectrumOverlayHeight + '" data-action="spectrum-height-input" aria-label="' + escapeHtml(STR.heightSpectrumLabel + ' px') + '">'
            + '<button class="tb-btn" data-action="spectrum-height-reset" aria-label="' + escapeHtml(STR.ariaSpectrumHeightReset) + '">' + escapeHtml(STR.heightSpectrumLabel + ' ' + STR.btnHeightReset) + '</button></div>';
        const workflowMenu = '<button class="tb-btn" data-action="run-recipe">' + escapeHtml(STR.btnRunRecipe) + '</button>'
            + '<button class="tb-btn" data-action="copy-spec">' + escapeHtml(STR.btnCopySpec) + '</button>';
        const exportMenu = '<button class="tb-btn" data-action="export-png" title="' + escapeHtml(STR.btnExportPngTitle) + '">' + escapeHtml(STR.btnExportPng) + '</button>'
            + '<button class="tb-btn" data-action="export-csv" title="' + escapeHtml(STR.btnExportCsvTitle) + '">' + escapeHtml(STR.btnExportCsv) + '</button>'
            + '<button class="tb-btn" data-action="export-wav" title="' + escapeHtml(STR.btnExportWavTitle) + '">' + escapeHtml(STR.btnExportWav) + '</button>'
            + '<button class="tb-btn" data-action="export-report" title="' + escapeHtml(STR.btnExportReportTitle) + '">' + escapeHtml(STR.btnExportReport) + '</button>';
        return '<span class="tb-label">' + escapeHtml(STR.toolbarTrackLabel) + '</span>'
            + '<button class="tb-btn' + (contentType === 'waveform' ? ' is-active' : '') + '" data-action="content-waveform">' + escapeHtml(STR.btnWaveform) + '</button>'
            + '<button class="tb-btn' + (contentType === 'spectrogram' ? ' is-active' : '') + '" data-action="content-spectrogram">' + escapeHtml(STR.btnSpectrogram) + '</button>'
            + '<button class="tb-btn" data-action="spectrogram-settings" title="' + escapeHtml(STR.btnSpectrogramSettingsTitle) + '" aria-label="' + escapeHtml(STR.btnSpectrogramSettingsTitle) + '" style="display:none">⚙</button>'
            + '<div class="tb-sep"></div>'
            + '<span class="tb-label">' + escapeHtml(STR.toolbarZoomLabel) + '</span>'
            + '<button class="tb-btn" data-action="zoom-out" aria-label="' + escapeHtml(STR.ariaZoomOut) + '">－</button>'
            + '<button class="tb-btn" data-action="zoom-in" aria-label="' + escapeHtml(STR.ariaZoomIn) + '">＋</button>'
            + '<button class="tb-btn" data-action="zoom-reset" aria-label="' + escapeHtml(STR.ariaZoomReset) + '">' + escapeHtml(STR.btnZoomReset) + '</button>'
            + '<button class="tb-btn" id="btn-wave-mode-rect-zoom" data-action="wave-mode-rect-zoom" aria-pressed="false">' + escapeHtml(STR.waveModeLabelRectZoom) + '</button>'
            + '<button class="tb-btn" id="btn-zoom-to-selection" data-action="zoom-to-selection" title="' + escapeHtml(STR.btnZoomToSelectionTitle) + '" disabled>' + escapeHtml(STR.btnZoomToSelection) + '</button>'
            + '<button class="tb-btn" data-action="toggle-follow-cursor" title="' + escapeHtml(STR.btnFollowCursorTitle) + '">' + escapeHtml(STR.btnFollowCursor) + '</button>'
            + '<div class="tb-sep"></div>'
            + toolbarMenu(STR.toolbarAdjustLabel, adjustMenu)
            + toolbarMenu(STR.toolbarWorkflowLabel, workflowMenu)
            + toolbarMenu(STR.toolbarExportLabel, exportMenu)
            + '<div class="tb-sep"></div>'
            + '<span id="cursor-display" title="' + escapeHtml(STR.cursorDisplayHint) + '">—</span>'
            + '<span id="playback-display" title="' + escapeHtml(STR.playbackDisplayTitle) + '"></span>'
            + '<span id="loop-badge" style="display:none; color:#64a0ff; font-size:0.85em; margin-left:8px;">' + escapeHtml(STR.loopBadge) + '</span>'
            + '<span id="loop-time-display" title="' + escapeHtml(STR.loopTimeDisplayTitle) + '" style="display:none;"></span>';
    }
    function channelMetricSummaryHtml(ch: ChannelSummary) {
        const peakDb = ch ? channelLevel(ch, ch.peakLevelDb) : '—';
        return '<span>' + escapeHtml(peakText(ch) ?? 'Peak ' + peakDb) + '</span>';
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
            ? '  <div class="track-channel-lane-header"><span class="track-channel-lane-label">' + escapeHtml(label) + '</span>' + channelMetricSummaryHtml(ch) + '</div>'
            : '';
        return '<div class="track-channel-lane" data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '">'
            + header
            + '  <div class="track-channel-lane-body">'
            + '    <div class="track-canvas-wrap" id="track-canvas-wrap-' + trackIndex + suffix + '">'
            + '      <canvas class="track-axis-canvas" id="' + trackAxisCanvasId(trackIndex, channelIndex) + '" style="width:' + AXIS_W + 'px" data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '"></canvas>'
            + '      <canvas class="track-canvas" id="' + trackCanvasId(trackIndex, channelIndex) + '" data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '" tabindex="0" style="outline:none;flex:1"></canvas>'
            + '      <canvas class="track-spectrogram-overlay" id="' + trackSpectrogramOverlayCanvasId(trackIndex, channelIndex) + '" data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '" aria-hidden="true" style="display:none;position:absolute;left:' + AXIS_W + 'px;top:0;right:0;bottom:0;pointer-events:none"></canvas>'
            + '    </div>'
            + '    <div class="track-spectrum-wrap" id="track-spectrum-wrap-' + trackIndex + suffix + '" title="' + escapeHtml(STR.trackSpectrumTitle) + '">'
            + '      <canvas class="track-spectrum-canvas" id="' + trackSpectrumCanvasId(trackIndex, channelIndex) + '" data-track-id="' + trackId + '" data-channel-index="' + channelIndex + '" tabindex="0" aria-label="' + escapeHtml(result.fileName + ' ' + label + ' ' + STR.trackSpectrumTitle) + '"></canvas>'
            + '    </div>'
            + '  </div>'
            + '</div>';
    }
    function buildChannelLanes(result: ComparisonTrackState, i: number) {
        return channelsForResult(result).map(function (_, channelIndex: number) {
            return buildChannelLane(result, i, channelIndex);
        }).join('');
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
            + '    <div class="track-drag-handle" draggable="true" data-track-id="' + trackId + '" aria-label="' + escapeHtml(STR.ariaDragHandle) + '" title="' + escapeHtml(STR.ariaDragHandle) + '">≡</div>'
            + '    <div class="track-color-swatch" data-action="pick-color" data-track-id="' + trackId + '" style="background:' + trackColor(i) + '" role="button" tabindex="0" aria-label="' + escapeHtml(STR.ariaPickColor) + '" title="' + escapeHtml(STR.trackPickColor) + '"></div>'
            + '    <div class="track-name" title="' + escapeHtml(result.filePath) + '">' + escapeHtml(result.fileName) + '</div>'
            + (isClipped(channels) ? '    <span class="clip-badge" title="' + escapeHtml(STR.clipBadgeTitle) + '">CLIP</span>' : '')
            + '    ' + calibrationBadgeHtml(channels)
            + '  </div>'
            + '  <div class="track-meta">Total: ' + result.channelCount + ' ch &nbsp;' + (result.sampleRateHz / 1000).toFixed(1) + 'kHz' + monoSummary + '</div>'
            + '  <div class="track-btns">'
            + '    <button class="track-btn" data-action="toggle-playback" data-track-id="' + trackId + '" title="' + escapeHtml(STR.trackPlayTitle) + '" aria-label="' + escapeHtml(STR.ariaTrackPlay) + '"' + (result.audioSource ? '' : ' disabled') + '>▶</button>'
            + '    <button class="track-btn" data-action="stop-playback" data-track-id="' + trackId + '" title="' + escapeHtml(STR.trackStopTitle) + '" aria-label="' + escapeHtml(STR.ariaTrackStop) + '"' + (result.audioSource ? '' : ' disabled') + '>■</button>'
            + '    <button class="track-btn" data-action="toggle-mute" data-track-id="' + trackId + '" aria-label="' + escapeHtml(STR.ariaTrackMute) + '" title="' + escapeHtml(STR.ariaTrackMute) + '" aria-pressed="' + !!trackStore.require(trackId).runtime.muted + '"' + (result.audioSource ? '' : ' disabled') + '>' + (trackStore.require(trackId).runtime.muted ? '🔇' : '🔊') + '</button>'
            + '    <button class="track-btn" data-action="remove-track" data-track-id="' + trackId + '" aria-label="' + escapeHtml(STR.ariaRemoveTrack) + '">✕</button>'
            + '    ' + calibrationButtonHtml(trackId, STR)
            + '  </div>'
            + '  <div class="track-offset">'
            + '    <span class="track-offset-val" id="offset-val-' + i + '" data-track-id="' + trackId + '" title="' + escapeHtml(STR.trackOffsetResetHint) + '" aria-label="' + escapeHtml(STR.ariaOffsetValue) + '">+0.000s</span>'
            + '    <button class="track-offset-step" data-action="offset-up" data-track-id="' + trackId + '" aria-label="' + escapeHtml(STR.ariaOffsetUp) + '">▲</button>'
            + '    <button class="track-offset-step" data-action="offset-down" data-track-id="' + trackId + '" aria-label="' + escapeHtml(STR.ariaOffsetDown) + '">▼</button>'
            + '  </div>'
            + '</div>'
            + '<div class="track-channel-lanes">' + buildChannelLanes(result, i) + '</div>'
            + '<div class="height-resizer track-height-resizer" data-action="track-height-drag" role="separator" aria-orientation="horizontal" aria-label="' + escapeHtml(STR.heightTrackLabel + ' resize') + '"></div>'
            + '</div>';
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
                const spectrogramOverlay = document.getElementById(trackSpectrogramOverlayCanvasId(i, channelIndex));
                if (spectrogramOverlay) {
                    syncCanvasSize(spectrogramOverlay, newW - AXIS_W, trackHeight);
                }
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
            ctx.fillText(formatClockTime(t), x + 2, H - 4);
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
                    spectrogramRasterCache.delete(trackId + ':' + channelIndex);
                    const spectrogramOverlay = document.getElementById(trackSpectrogramOverlayCanvasId(i, channelIndex));
                    if (spectrogramOverlay) {
                        spectrogramOverlay.style.display = 'none';
                    }
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
                drawWaveformAmplitudeAxis(axisCtx, AXIS_W, H, waveformAxisLabelsForChannel(result, channelIndex), drawTheme());
            }
        }
    }
    function drawSpectrogram(canvas: RuntimeElement, result: ComparisonTrackState, trackIndex: number, channelIndex: number, offsetSeconds: number) {
        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        const overlayCanvas = document.getElementById(trackSpectrogramOverlayCanvasId(trackIndex, channelIndex));
        const overlayCtx = overlayCanvas ? overlayCanvas.getContext('2d') : null;
        if (overlayCanvas) {
            overlayCanvas.style.display = '';
        }
        if (overlayCtx && overlayCanvas) {
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
        const axisCanvas = document.getElementById(trackAxisCanvasId(trackIndex, channelIndex));
        const axisCtx = axisCanvas ? axisCanvas.getContext('2d') : null;
        if (axisCtx) {
            axisCtx.clearRect(0, 0, axisCanvas.width, axisCanvas.height);
        }
        const ch = channelsForResult(result)[channelIndex];
        if (!ch || !ch.spectrogram) {
            ctx.clearRect(0, 0, W, H);
            requestTrackDetail(trackIndex);
            ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(STR.spectrogramLoading, W / 2, H / 2);
            return;
        }
        const spec = ch.spectrogram;
        const dur = result.durationSeconds || 1;
        const gs = computeGlobalSpan();
        const trackStart = (offsetSeconds - gs.startSec) / gs.spanSec;
        const trackDurRatio = dur / gs.spanSec;
        const dispCfg = __spectrogramSettings.display;
        const dbLo = (dispCfg.dbMin != null) ? dispCfg.dbMin : spec.minDb;
        const dbHi = (dispCfg.dbMax != null) ? dispCfg.dbMax : spec.maxDb;
        const maxFreq = (dispCfg.maxFrequencyHz != null) ? Math.min(dispCfg.maxFrequencyHz, spec.maxFrequencyHz) : spec.maxFrequencyHz;
        const plotW = spectrogramPlotWidth(W);
        const cacheId = trackRecordAtIndex(trackIndex)!.id + ':' + channelIndex;
        const rasterKey = [plotW, H, zoomStart, zoomEnd, trackStart, trackDurRatio, dbLo, dbHi, maxFreq].join(':');
        let raster = spectrogramRasterCache.get(cacheId);
        if (!raster || raster.source !== spec || raster.key !== rasterKey) {
            ctx.clearRect(0, 0, W, H);
            const imageData = ctx.createImageData(plotW, H);
            paintSpectrogramRaster(spec, plotW, H, {
                zoomStart, zoomEnd, trackStart, trackDurRatio, dbLo, dbHi, maxFrequencyHz: maxFreq,
            }, imageData.data);
            ctx.putImageData(imageData, 0, 0);
            drawSpectrogramColorbar(ctx, W, H, spec, { dbLo: dbLo, dbHi: dbHi }, drawTheme());
            raster = { source: spec, key: rasterKey };
            spectrogramRasterCache.set(cacheId, raster);
        }
        if (axisCtx) {
            drawSpectrogramFrequencyAxis(axisCtx, axisCanvas.width, axisCanvas.height, spec, { maxFreq: maxFreq }, drawTheme());
        }
        if (overlayCtx) {
            drawLoopRegionOnCanvas(overlayCtx, plotW, H);
            drawCursorOnCanvas(overlayCtx, plotW, H);
            drawHoverLineOnCanvas(overlayCtx, plotW, H);
        }
    }

    function spectrogramPlotWidth(canvasWidth: number) {
        return Math.max(1, canvasWidth - SPECTROGRAM_COLORBAR_WIDTH);
    }
    function trackCanvasTimeHit(canvas: RuntimeElement, clientX: number) {
        const timeWidth = contentType === 'spectrogram' ? spectrogramPlotWidth(canvas.width) : canvas.width;
        return canvasTimeHit(canvas.getBoundingClientRect().left, clientX, timeWidth, { start: zoomStart, end: zoomEnd });
    }
    function clampedTrackCanvasNorm(canvas: RuntimeElement, clientX: number, timeWidth: number) {
        return clampedCanvasNorm(canvas.getBoundingClientRect().left, clientX, timeWidth, { start: zoomStart, end: zoomEnd });
    }
    function spectrumLevelAxisLabel(result: ComparisonTrackState, channel?: ChannelSummary) {
        if (channel?.measurement) {
            return 'Spectrum amplitude level [' + channel.measurement.levelReferenceLabel + ']';
        }
        return result && result.units && result.units.spectrumLevel && result.units.spectrumLevel.axisLabel
            ? result.units.spectrumLevel.axisLabel
            : 'Spectrum level [dB]';
    }
    function drawCursorOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        drawDashedTimeLine(ctx, cursorNorm, { start: zoomStart, end: zoomEnd }, W, H, CURSOR_LINE_STYLE);
    }
    function drawHoverLineOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        if (hoverNorm !== null) {
            drawDashedTimeLine(ctx, hoverNorm, { start: zoomStart, end: zoomEnd }, W, H, HOVER_LINE_STYLE);
        }
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
        if (rectZoomSelection && rectZoomSelection.trackId === trackIdAtIndex(trackIndex)) {
            drawRectZoomSelection(ctx, rectZoomSelection, { start: zoomStart, end: zoomEnd }, { start: amplitudeZoomMinNorm, end: amplitudeZoomMaxNorm }, W, H);
        }
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
        el.textContent = formatClockTime(startSec) + ' – ' + formatClockTime(endSec);
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
                                invalidateDesiredSpectrumSliceRequests();
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
            invalidateDesiredSpectrumSliceRequests();
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
            invalidateDesiredSpectrumSliceRequests();
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
        invalidateDesiredSpectrumSliceRequests();
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
                    invalidateDesiredSpectrumSliceRequests();
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
                    invalidateDesiredSpectrumSliceRequests();
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
            heightResize.begin(action === 'track-height-drag' ? 'track' : 'spectrum', e.clientY || 0);
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
            heightResize.update(e.clientY || 0);
            if (heightResize.isActive()) {
                e.preventDefault();
            }
        }
        function handleHeightResizeEnd() {
            heightResize.end();
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
                navigator.clipboard.writeText(formatClockTime(startSec) + ' – ' + formatClockTime(endSec)).catch(function () { });
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
            if (action === 'toggle-mute' && trackId && idx !== null) {
                const runtime = trackRuntimeAt(idx);
                runtime.muted = !runtime.muted;
                const audio = getTrackAudio(idx);
                if (audio) audio.muted = runtime.muted;
                tgt.setAttribute('aria-pressed', String(runtime.muted));
                tgt.textContent = runtime.muted ? '🔇' : '🔊';
            }
            if (action === 'stop-playback' && trackId) {
                stopPlayback(trackId);
            }
            if (action === 'remove-track' && trackId) {
                removeTrack(trackId);
            }
            if (action === 'configure-calibration' && trackId && idx !== null) {
                e.preventDefault();
                vscode.postMessage(calibrationRequest(idx, trackStore.require(trackId).result));
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
            installTrackReorderDrag(document, stackedWrap, {
                trackIdFromElement,
                rowFor(trackId) {
                    const index = trackStore.protocolIndexForId(trackId);
                    return index === null ? null : document.getElementById('track-row-' + index);
                },
                onReorder: reorderTracks,
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
                invalidateDesiredSpectrumSliceRequests();
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
        if (layout) {
            selectionTreeView.attach(layout);
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
                if (selectionTreeView.isVisible(input)) {
                    const filePath = input.getAttribute('data-file-path');
                    if (filePath) {
                        trackStore.allowExplicitSelection(filePath);
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
    function hasSelectedFilePath(filePath: string) { return selection.has(filePath); }
    function addSelectedFilePath(filePath: string) { selection.add(filePath); }
    function removeSelectedFilePath(filePath: string) { selection.remove(filePath); }
    function clearSelectedFilePaths() { selection.clear(); }
    function syncSelectionSummary() {
        const countEl = document.getElementById('selection-count');
        const count = selectedFilePaths.length;
        // 可視チェックボックスの数を分母にする
        const visibleCount = Array.from(document.querySelectorAll('.selection-file-checkbox')).filter(function (el: RuntimeElement) {
            return selectionTreeView.isVisible(el);
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
    function applyHeightInput(action: string | null, value: string | number | null): void {
        const request = heightInputRequest(action, value);
        if (request) {
            setHeight(request.kind, request.height);
        }
    }
    function setHeight(kind: HeightKind, value: number): void {
        if (kind === 'track') {
            setTrackHeight(value);
        }
        else {
            setSpectrumHeight(value);
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
    const heightResize = createHeightResize({
        currentHeight: kind => kind === 'track' ? trackHeight : spectrumOverlayHeight,
        setHeight,
        onActiveChange: active => document.body.classList.toggle('is-height-resizing', active),
    });
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
        const canvases = visibleExportCanvases(wrapper as unknown as Element | null);
        const failed = STR.announceExportPngFailed || 'PNG export failed: no visible canvases';
        if (canvases.length === 0) {
            messaging.post({ type: 'show-info', message: failed });
            return;
        }
        announce(STR.announceExportPngStarted || 'PNG export started');
        setTimeout(function () {
            const composed = composeTrackCanvases(document as unknown as Document, canvases, function (canvas) {
                const axisId = canvas.id ? canvas.id.replace(/^track-canvas-/, 'track-axis-canvas-') : '';
                return axisId && axisId !== canvas.id && wrapper ? wrapper.querySelector('#' + axisId) as unknown as Element | null : null;
            }, AXIS_W);
            if (!composed) {
                messaging.post({ type: 'show-info', message: failed });
                return;
            }
            triggerAnchorDownload(document as unknown as Document, composed.toDataURL('image/png'), 'waveform-export.png');
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
        const csv = buildSpectrumCsv(tracks);
        if (messaging.downloadFile(csv, 'spectrum-export.csv', 'text/csv;charset=utf-8')) return;
        triggerAnchorDownload(document as unknown as Document, 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), 'spectrum-export.csv');
    }
    function exportWavLoop() {
        if (!loopRegion) {
            messaging.post({ type: 'show-info', message: STR.exportWavNoLoop });
            return;
        }
        if (typeof state === 'undefined' || !state.results || state.results.length === 0) {
            return;
        }
        const span = computeGlobalSpan();
        const startSec = span.startSec + loopRegion.start * span.spanSec;
        const endSec = span.startSec + loopRegion.end * span.spanSec;
        const visibleTracks = trackStore.activeIds()
            .map(trackId => trackStore.require(trackId))
            .filter(record => !record.runtime.hidden)
            .map(record => ({ filePath: record.result.filePath, offsetSeconds: record.runtime.offsetSeconds, durationSeconds: record.result.durationSeconds }));
        const fileRegions = wavLoopRegions(visibleTracks, startSec, endSec);
        if (!fileRegions.length) {
            messaging.post({ type: 'show-info', message: STR.exportWavNoOverlap }); return;
        }
        messaging.post({
            type: 'export-wav-loop',
            filePaths: fileRegions.map(region => region.filePath),
            fileRegions,
            startNorm: loopRegion.start,
            endNorm: loopRegion.end,
        });
    }
    // --- Report export (builders live in shared/report/analysisReport) ---
    function _activeReportRecords() {
        return trackStore.activeIds().map(function (trackId) {
            return trackStore.require(trackId);
        });
    }
    function _reportTracks(): ReportTrack[] {
        return _activeReportRecords().map(record => ({ result: record.result, offsetSeconds: record.runtime.offsetSeconds }));
    }
    function _reportLoopRegion(): ReportLoopRegion | undefined {
        if (!loopRegion) return undefined;
        const gs = computeGlobalSpan();
        return { globalStartSec: gs.startSec + loopRegion.start * gs.spanSec, globalEndSec: gs.startSec + loopRegion.end * gs.spanSec };
    }
    function exportReport() {
        const reportRecords = _activeReportRecords();
        if (reportRecords.length === 0) {
            messaging.post({ type: 'show-info', message: STR.exportReportNoData });
            return;
        }
        var mdContent = buildMarkdownReport(_reportTracks(), _reportLoopRegion(), new Date());
        var nbContent = buildNotebook(_reportTracks());
        var defaultName = (reportRecords[0].result.fileName || 'analysis').replace(/.[^.]+$/, '');
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
        const range = zoomNormalizedRange({ start: zoomStart, end: zoomEnd }, ZOOM_IN_FACTOR);
        zoomStart = range.start;
        zoomEnd = range.end;
        scheduleRender();
    }
    function zoomOut() {
        disableFollowCursor();
        const range = zoomNormalizedRange({ start: zoomStart, end: zoomEnd }, 1 / ZOOM_IN_FACTOR);
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
        zoomSpectrumBy(ZOOM_IN_FACTOR);
    }
    function specZoomOut() {
        zoomSpectrumBy(1 / ZOOM_IN_FACTOR);
    }
    function zoomSpectrumBy(factor: number) {
        const range = zoomSpectrumRange({ start: specFreqStart, end: specFreqEnd }, factor);
        specFreqStart = range.start;
        specFreqEnd = range.end;
        // 完全ズームアウト時は dB も自動に戻す（dB ブロックはスキップ）
        if (factor > 1 && specFreqStart <= 0 && specFreqEnd >= 1) {
            specDbMin = null;
            specDbMax = null;
        }
        else if (_lastVisDbMin !== null && _lastVisDbMax !== null) {
            const dc = (_lastVisDbMin + _lastVisDbMax) / 2;
            const dh = (_lastVisDbMax - _lastVisDbMin) / 2 * factor;
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
    const spectrumRangePopover = installRangePopover(document, {
        rootId: 'spectrum-range-popover',
        badgeId: 'spec-range-axis-badge',
        idPrefix: 'spec-range',
        strings: rangePopoverStrings(STR),
        position: positionPopover,
    });
    function openSpectrumRangePopup(axis: string, clientX: number, clientY: number) {
        if (axis === 'db') {
            spectrumRangePopover.open({
                axisLabel: STR.specRangeAxisDb,
                horizontal: false,
                min: specDbMin != null ? String(specDbMin) : (_lastVisDbMin != null ? String(Math.round(_lastVisDbMin)) : ''),
                max: specDbMax != null ? String(specDbMax) : (_lastVisDbMax != null ? String(Math.round(_lastVisDbMax)) : ''),
                clientX, clientY,
                apply(min, max) {
                    specDbMin = min;
                    specDbMax = max;
                    scheduleSpectrumRefresh('immediate');
                },
                auto() {
                    specDbMin = null;
                    specDbMax = null;
                    scheduleSpectrumRefresh('immediate');
                },
            });
            return;
        }
        spectrumRangePopover.open({
            axisLabel: STR.specRangeAxisFreq,
            horizontal: true,
            min: String(Math.round(specFreqStart * _lastSpectrumMaxF)),
            max: String(Math.round(specFreqEnd * _lastSpectrumMaxF)),
            clientX, clientY,
            apply(min, max) {
                const mf = _lastSpectrumMaxF || 1;
                const nextFreqStart = (min === null) ? 0 : Math.max(0, Math.min(1, min / mf));
                const nextFreqEnd = (max === null) ? 1 : Math.max(0, Math.min(1, max / mf));
                if (nextFreqStart >= nextFreqEnd) {
                    return STR.specRangeErrorMinMax;
                }
                specFreqStart = nextFreqStart;
                specFreqEnd = nextFreqEnd;
                scheduleSpectrumRefresh('immediate');
            },
            auto() {
                specFreqStart = 0;
                specFreqEnd = 1;
                scheduleSpectrumRefresh('immediate');
            },
        });
    }
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
                    invalidateDesiredSpectrumSliceRequests();
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
            el.textContent = formatClockTime(t);
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
            const text = (STR.playbackTimePrefix || '▶') + ' ' + formatClockTime(timeSec);
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
    function extractSpectrumAtCursor(result: ComparisonTrackState, trackIndex: number, offsetSeconds: number, cursorNormValue: number, channelIndex = 0): SpectrumSlice | null {
        const chIdx = Number.isInteger(channelIndex) ? channelIndex : 0;
        return extractCursorSpectrum(result, offsetSeconds, cursorNormValue, computeGlobalSpan(), {
            trackIndex,
            channelIndex: chIdx,
            cached: trackIndex >= 0 ? trackRecordAtIndex(trackIndex)?.spectrumSliceCache.get(chIdx) ?? null : null,
            settingsSignature: currentSpectrumDataSignature(),
            requestSlice: requestSpectrumSlice,
            applyDisplaySettings: applySpectrumDisplaySettings,
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
                    if (paintedByChannel.get(channelIndex) && isSpectrumSliceRequestPendingForCursor(i, spectrumCursorNorm)) {
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
                drawSpectrumAxes(ctx, W, H, slice, 32, 6, 4, 14, visFreqMinT, visFreqMaxT, visDbMinT, visDbMaxT, drawTheme());
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
        const visibleResults = trackStore.displayOrder.map(function (trackId) { return trackStore.require(trackId); })
            .filter(function (record) { return !record.runtime.hidden; })
            .map(function (record) { return record.result; });
        applyOverlayCompatibility(document as unknown as Document, hasIncompatibleLevelReferences(visibleResults), STR.calibrationOverlayIncompatible);
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
                else if (isSpectrumSliceRequestPendingForCursor(i, spectrumCursorNorm)) {
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
        const commonSlice = slices[0].slice;
        const sharedAxis = {
            values: [],
            frequencyBins: 1,
            maxFrequencyHz: maxF,
            minDb: visDbMinO,
            maxDb: visDbMaxO,
            unit: commonSlice.unit,
            axisLabel: commonSlice.axisLabel,
        };
        drawSpectrumAxes(ctx, W, H, sharedAxis, padL, padR, padT, padB, visFreqMinO, visFreqMaxO, visDbMinO, visDbMaxO, drawTheme());
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
            el.textContent = '@ ' + formatClockTime(gs.startSec + spectrumCursorNorm * gs.spanSec);
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
        channelsForResult(record.result).forEach((_, channelIndex) => spectrogramRasterCache.delete(trackId + ':' + channelIndex));
        trackRuntimeAt(idx).hidden = true;
        var pos = trackStore.displayOrder.indexOf(trackId);
        var n = pos !== -1 ? pos + 1 : idx + 1;
        trackStore.remove(trackId);
        messaging.releaseSource(record.result.filePath);
        announce((STR.announceTrackRemoved || 'Track {n} removed').replace('{n}', String(n)));
        if (colorPicker.target() === trackId) {
            colorPicker.close();
        }
        updateVisibility();
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
    }
    function adjustOffset(idx: number, deltaSeconds: number) {
        trackRuntimeAt(idx).offsetSeconds += deltaSeconds;
        invalidateDesiredSpectrumSliceRequests();
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
    function __updateSpecGearVisibility() {
        const gear = document.querySelector('[data-action="spectrogram-settings"]');
        if (gear) {
            gear.style.display = (contentType === 'spectrogram') ? '' : 'none';
        }
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
    var specSettingsPopover = installSpectrogramSettingsPopover(document, {
        strings: STR,
        getSettings: () => __spectrogramSettings,
        onDisplayChange: __setSpectrogramDisplay,
        onReset() {
            __spectrogramSettings = { auto: true, stft: { nFft: 1024, hopSize: 256, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } };
            messaging.post({ type: 'update-spectrogram-settings', settings: __spectrogramSettings });
            scheduleRender();
        },
        onApply(settings) {
            __spectrogramSettings = settings;
            invalidateDesiredSpectrumSliceRequests();
            __setReanalyzeBusy(true, STR.reanalyzingStft);
            messaging.post({ type: 'request-reanalyze', settings: __spectrogramSettings });
        },
    });
    var reanalyzeOverlay = installReanalyzeOverlay(document, {
        defaultMessage: STR.reanalyzingDefault,
        onShow(message) {
            announce((STR.announceAnalyzing || 'Analyzing: {msg}').replace('{msg}', message || ''));
        },
    });
    function __setReanalyzeBusy(busy: boolean, msg?: string): void {
        reanalyzeOverlay.setBusy(busy, msg);
        const applyBtn = document.getElementById('spec-apply');
        if (applyBtn) {
            applyBtn.disabled = !!busy;
        }
    }
    installHelpOverlay(document, STR);
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
            if (isSelectionMode && msg.selectedFilePaths) {
                clearSelectedFilePaths();
                msg.selectedFilePaths.forEach(addSelectedFilePath);
                syncSelectionCheckboxes();
                syncSelectionSummary();
            }
            __setReanalyzeBusy(false);
            invalidateDesiredSpectrumSliceRequests();
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
            updateCursorDisplay(hoverNorm ?? cursorNorm);
            updateLoopTimeDisplay();
            overlaySpectrumPainted = false;
            announce((STR.announceAnalysisDone || 'Analysis complete: {count} tracks').replace('{count}', String(state.results.length)));
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
            requestAnimationFrame(function () { publishTestSnapshot(); });
            return;
        }
    });
    // ── Track drag reorder ──
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
    var colorPicker = installColorPicker(document, {
        colors: TRACK_COLORS,
        resetLabel: STR.trackColorReset,
        onPick(trackId, color) {
            trackStore.require(trackId).runtime.color = color;
            var trigger = document.querySelector('[data-action="pick-color"][data-track-id="' + trackId + '"]');
            if (trigger) {
                trigger.style.background = color === null ? trackColor(trackIndexForId(trackId)) : color;
            }
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
        },
    });
    function openColorPicker(trackId: TrackId, anchorEl: RuntimeElement) {
        colorPicker.open(trackId, anchorEl);
    }
    __updateSpecGearVisibility();
    ensureCalibrationStyles(document as unknown as Document);
}
