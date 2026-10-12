import { OrderedSelection } from '../../shared/utils/directorySelection';
import { channelLabel, channelsForResult, formatClockTime } from '../../shared/utils/format';
import { paintSpectrogramRaster, spectrogramDisplayBounds } from './spectrogramRaster';
import { traceXExtent, trackTimelinePlacement, waveformCoverageFromExtent } from './waveformCoverage';
import { isOffsetEditorOpen, openOffsetEditor } from './offsetInlineEditor';
import { fillSpectrogramDisplayForm, fillSpectrogramSettingsForm, heightDragFromPayload, loopRegionFromPayload, setSelectionFileChecked, testActionTrackId } from './testActionForms';
import { DEFAULT_PYTHON_ENVIRONMENT_STATE, isResponseToLazyRequest, mergeDetailSpectrograms, pythonEnvironmentStateFromMessage } from './lazyResponses';
import { formatAmplitudeValue, formatWaveformAxisLabels, formatHz, dbLevelUnitFor, formatDbLevel, drawWaveformAmplitudeAxis, drawSpectrogramFrequencyAxis, drawSpectrogramColorbar, drawSpectrumLine, drawSpectrumAxes, drawSpectrumCrosshair, drawCanvasMessage, type DrawTheme } from '../draw/canvasDrawers';
import { isCacheSufficient, computeReqBounds, isOverviewSufficient, rangeCacheCoversView, rangeRequestPointCount } from '../waveform/rangeRequestPolicy';
import { extractSpectrumAtCursor as extractCursorSpectrum } from '../spectrum/cursorSpectrum';
import { buildSelectionTree as buildSelectionTreeFromPaths } from './directorySelection';
import { createSelectionTreeView } from './selectionTreeView';
import { buildSpecSummaryText, buildSpectrumCsv, wavLoopRegions } from './runtimeExports';
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
import { arrowCursorStep, isTextEntryTag, keydownIntent, type GlobalShortcutAction } from './shortcuts';
import { domSnapshotBase, latestSpectrogramSnapshot, overlaySpectrumAxisLabels, sliceSpectrumAxisLabels, spectrogramAxisLabelTexts, visibleFileRange, waveformCoverageSnapshot } from './testSnapshot';
import { contentBoxWidth, syncCanvasSize } from './canvasSizing';
import { trackAxisCanvasId, trackCanvasId, trackCanvasWrapId, trackSpectrogramOverlayCanvasId, trackSpectrumCanvasId, trackSpectrumWrapId } from './trackCanvasIds';
import { channelLaneHtml, trackRowHtml } from './trackLaneHtml';
import { attachSpectrumBoxDrag, SpectrumBoxDrag } from './spectrumBoxDrag';
import { attachCanvasFocusHint, createCanvasTooltip } from './canvasTooltip';
import { createSpectrumCursorHandlers } from './spectrumCursorHandlers';
import { attachTrackLaneActions } from './trackLaneActions';
import { buildPythonButtonText, buildPythonTooltip, isPythonEnvError } from './pythonEnvironmentLabels';
import { SpectrumHover } from './spectrumHover';
import { paintOverlaySpectrum } from './overlaySpectrumPainter';
import { toolbarHtml } from './toolbarHtml';
import { attachExclusiveMenus, attachHeightResizeListeners, attachToolbarActions } from './toolbarEvents';
import { resultsPaneHtml, trackAudioHtml } from './resultsPaneHtml';
import { selectionLayoutHtml } from './selectionLayoutHtml';
import { canvasTimeHit, clampedCanvasNorm, clientToCanvasPixels, CURSOR_LINE_STYLE, drawDashedTimeLine, drawRectZoomSelection, formatReadoutHz, HOVER_LINE_STYLE } from './canvasOverlays';
import { applyOverlayCompatibility, calibrationRequest, channelMetricSummaryHtml, ensureCalibrationStyles, hasIncompatibleLevelReferences } from './calibrationDecorations';
import {
    channelIndexAttribute,
    nearestSpectrumSnap,
    OVERLAY_SPECTRUM_PAD,
    overlaySpectrumRegionAt,
    spectrumBinAtHover,
    spectrumBoxZoom,
    spectrumPlotFrame,
    spectrumSeriesRange,
    spectrumVisibleWindow,
    steppedSpectrumHoverNorm,
    TRACK_SPECTRUM_PAD,
    type SpectrumViewState,
    trackSpectrumReadoutText,
    setSpectrumReadout,
    spectrumSlicesFromResult,
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
    exceedsDragThreshold,
    loopRegionForDrag,
    rectZoomTarget,
    ZOOM_IN_FACTOR,
    zoomNormalizedRange,
} from './waveformInteraction';
import type { ChannelSummary, SpectrogramDisplaySettings, SpectrogramData, WaveformEnvelope, } from '../../shared/analysis/analysisTypes';
import type { ComparisonBootstrap, ComparisonTrackState, LazyRequestState, LoopRegion, PersistedWebviewState, RectZoomSelection, RuntimeElement, SelectionTreeNode, SpectrumSeries, SpectrumSlice, SpectrumSnap, TestAction, TrackFileView, TrackId, TrackRuntimeState, WaveformCoverage, WaveformDragState, WaveformDrawOptions, } from './types';
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
    let pythonEnvironmentState = state.pythonEnvironmentState || DEFAULT_PYTHON_ENVIRONMENT_STATE;
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
    const spectrumHover = new SpectrumHover();
    let trackHeight = TRACK_HEIGHT_DEFAULT;
    let spectrumOverlayHeight = SPECTRUM_HEIGHT_DEFAULT;
    // ── スペクトルズーム ───────────────────────────────────
    let specFreqStart = 0; // 0..1 正規化周波数（0=0Hz, 1=maxFreq）
    let specFreqEnd = 1;
    let specDbMin: number | null = null; // null = データ自動, number = dB 上書き
    let specDbMax: number | null = null;
    function spectrumViewState(): SpectrumViewState {
        return { freqStart: specFreqStart, freqEnd: specFreqEnd, dbMin: specDbMin, dbMax: specDbMax };
    }
    let _lastVisDbMin: number | null = null; // 前回レンダリング時の visDbMin キャッシュ
    let _lastVisDbMax: number | null = null;
    let _lastSpectrumMaxF = 0; // overlay の最大周波数(Hz) キャッシュ（freq popover 用）
    const specBoxDrag = new SpectrumBoxDrag();
    const heightResize = createHeightResize({
        currentHeight: kind => kind === 'track' ? trackHeight : spectrumOverlayHeight,
        setHeight,
        onActiveChange: active => document.body.classList.toggle('is-height-resizing', active),
    });
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
    function trackIdFromElement(element: Pick<Element, 'getAttribute'>): TrackId | null {
        const rawId = element.getAttribute('data-track-id');
        if (!rawId) {
            return null;
        }
        const trackId = rawId as TrackId;
        return trackStore.protocolIndexForId(trackId) === null ? null : trackId;
    }
    function trackIndexFromElement(element: Pick<Element, 'getAttribute'>): number | null {
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
    function displayedChannel(result: ComparisonTrackState) {
        const channels = channelsForResult(result);
        return channels.length > 0 ? channels[0] : null;
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
        const gs = trackStore.globalSpan();
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
    const canvasTooltip = createCanvasTooltip(document);
    function showTooltip(e: MouseEvent, text: string): void {
        canvasTooltip.showAtPointer(e.clientX, e.clientY, text);
    }
    function hideTooltip() {
        canvasTooltip.hide();
    }
    // ── On-demand range cache ──
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
        if (!isResponseToLazyRequest(pending, trackId, msg) || pending.channelIndex !== msg.channelIndex) {
            return;
        }
        record.detailRequest = null;
        if (msg.type === 'track-detail-error') {
            return;
        }
        if (state.results[i] && state.results[i].filePath === msg.filePath && Array.isArray(msg.channels)) {
            mergeDetailSpectrograms(state.results[i].channels, msg.channels);
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
        if (!isResponseToLazyRequest(pending, trackId, msg)) {
            pumpSpectrumSliceRequests();
            return;
        }
        record.spectrumSliceRequests.delete(0);
        const isCurrent = active.generation === spectrumRequestGeneration
            && pending.analysisId === analysisId
            && pending.settingsSignature === currentSpectrumDataSignature();
        if (msg.type === 'spectrum-slice-result' && isCurrent) {
            spectrumSlicesFromResult(msg, pending.cursorNorm).forEach(function (slice) {
                record.spectrumSliceCache.set(slice.channelIndex, slice);
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
        pythonEnvironmentState = pythonEnvironmentStateFromMessage(msg);
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
        const actionTrackId = testActionTrackId(entry, id => trackStore.protocolIndexForId(id) !== null, trackIdAtIndex);
        const idx = actionTrackId ? trackIndexForId(actionTrackId) : -1;
        const payload = entry.payload;
        const trackActions: Record<string, (trackId: TrackId, trackIndex: number) => void> = {
            'offset-up': (_, trackIndex) => adjustOffset(trackIndex, 0.01),
            'offset-down': (_, trackIndex) => adjustOffset(trackIndex, -0.01),
            'remove-track': trackId => removeTrack(trackId),
            'set-track-offset': (_, trackIndex) => {
                const offsetSeconds = Number(payload?.offsetSeconds ?? 0);
                if (!payload || !Number.isFinite(offsetSeconds)) {
                    return;
                }
                trackRuntimeAt(trackIndex).offsetSeconds = offsetSeconds;
                invalidateDesiredSpectrumSliceRequests();
                updateOffsetDisplays();
                updateLoopTimeDisplay();
                scheduleRender();
                scheduleSpectrumRefresh('immediate');
            },
        };
        const payloadActions: Record<string, (p: Record<string, unknown>) => void> = {
            'resize-height-drag': p => {
                const drag = heightDragFromPayload(p);
                heightResize.begin(drag.kind, drag.startY);
                heightResize.update(drag.endY);
                heightResize.end();
            },
            'apply-spectrogram-settings': p => {
                if (!specSettingsPopover.isOpen()) {
                    specSettingsPopover.open();
                }
                fillSpectrogramSettingsForm(document, p);
                specSettingsPopover.applyAutoState();
                document.getElementById('spec-apply').click();
            },
            'set-cursor': p => {
                invalidateDesiredSpectrumSliceRequests();
                cursorNorm = Math.max(0, Math.min(1, Number(p.cursorNorm)));
                updateCursorDisplay(cursorNorm);
                scheduleRender();
                scheduleSpectrumRefresh('immediate');
            },
            'set-file-selected': p => setSelectionFileChecked(document, p.filePath, !!p.selected),
            'set-loop-region': p => {
                const region = loopRegionFromPayload(p);
                if (region) {
                    loopRegion = region;
                    updateLoopTimeDisplay();
                    updateZoomToSelectionBtn();
                    scheduleRender();
                }
            },
            'set-spectrogram-display': p => {
                if (!specSettingsPopover.isOpen()) {
                    specSettingsPopover.open();
                }
                __setSpectrogramDisplay(fillSpectrogramDisplayForm(document, p));
            },
        };
        const trackAction = Object.hasOwn(trackActions, entry.action) ? trackActions[entry.action] : undefined;
        if (trackAction) {
            if (actionTrackId && idx >= 0) {
                trackAction(actionTrackId, idx);
            }
            return;
        }
        const payloadAction = Object.hasOwn(payloadActions, entry.action) ? payloadActions[entry.action] : undefined;
        if (payloadAction) {
            if (payload) {
                payloadAction(payload);
            }
            return;
        }
        if (entry.action === 'open-spectrogram-settings') {
            const gear = document.querySelector('[data-action="spectrogram-settings"]');
            if (gear) {
                gear.click();
            }
        }
    }
    function scheduleRangeRequests() {
        if (rangeRequestTimer) {
            clearTimeout(rangeRequestTimer);
        }
        rangeRequestTimer = setTimeout(function () { checkAndRequestRanges(); }, 80);
    }
    function computeTrackFileView(result: ComparisonTrackState, trackIndex: number, offsetSeconds?: number): TrackFileView {
        const offsetSec = offsetSeconds === undefined ? trackRuntimeAt(trackIndex).offsetSeconds : offsetSeconds;
        const { offsetNorm: trackStart, trackDurRatio } = trackTimelinePlacement(offsetSec, result.durationSeconds, trackStore.globalSpan());
        const fileAtZoomStart = (zoomStart - trackStart) / trackDurRatio;
        const fileAtZoomEnd = (zoomEnd - trackStart) / trackDurRatio;
        return {
            trackStart: trackStart,
            trackDurRatio: trackDurRatio,
            fileAtZoomStart: fileAtZoomStart,
            fileAtZoomEnd: fileAtZoomEnd,
        };
    }
    function overviewIsSufficient(result: ComparisonTrackState, W: number, fileView: TrackFileView): boolean {
        const overviews = channelsForResult(result).map(function (ch: ChannelSummary) { return ch && ch.waveform ? ch.waveform : null; });
        return isOverviewSufficient(overviews, W, fileView.fileAtZoomStart, fileView.fileAtZoomEnd);
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
        const visibleSlices: SpectrumSlice[] = [];
        const spectrogramPerTrack: string[][] = [];
        const spectrumPerTrack: string[][] = [];
        const waveformPerTrack: string[][] = [];
        const trackInfo = trackStore.activeIds().map(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            const trackIndex = record.protocolIndex;
            const placement = trackTimelinePlacement(trackRuntimeAt(trackIndex).offsetSeconds, result.durationSeconds, trackStore.globalSpan());
            const visibleFile = visibleFileRange(zoomStart, zoomEnd, placement);
            const spectrumCanvas = document.getElementById(trackSpectrumCanvasId(trackIndex, 0));
            const slice = trackRuntimeAt(trackIndex).hidden
                ? null
                : extractSpectrumAtCursor(result, trackIndex, trackRuntimeAt(trackIndex).offsetSeconds, spectrumCursorNorm);
            if (slice) {
                visibleSlices.push(slice);
            }
            waveformPerTrack.push(waveformAxisLabelsForResult(result, trackIndex));
            const ch = displayedChannel(result);
            spectrogramPerTrack.push(spectrogramAxisLabelTexts(
                ch && ch.spectrogram,
                __spectrogramSettings.display,
                result.sampleRateHz ? result.sampleRateHz / 2 : 0,
            ));
            spectrumPerTrack.push(sliceSpectrumAxisLabels(slice, spectrumViewState()));
            return {
                trackId: trackId,
                trackIndex: trackIndex,
                filePath: result.filePath,
                offsetSeconds: trackRuntimeAt(trackIndex).offsetSeconds,
                visibleFileStartNorm: visibleFile.startNorm,
                visibleFileEndNorm: visibleFile.endNorm,
                waveformFullyVisible: visibleFile.startNorm <= 0 && visibleFile.endNorm >= 1,
                ...waveformCoverageSnapshot(record.waveformCoverage),
                resultError: result.error || null,
                spectrumCanvasPresent: !!spectrumCanvas,
                spectrumSlicePresent: !!slice,
            };
        });
        const visibleSpectrumTrackCount = visibleSlices.length;
        let latestSpectrogram;
        try {
            const firstChannel = state.results[0] ? displayedChannel(state.results[0]) : undefined;
            latestSpectrogram = latestSpectrogramSnapshot(
                firstChannel?.spectrogram,
                (typeof __spectrogramSettings !== 'undefined' && __spectrogramSettings) ? __spectrogramSettings : null,
            );
        }
        catch (e) { /* ignore */ }
        testBridge.publish({
                ...domSnapshotBase(document),
                zoomStart: zoomStart,
                zoomEnd: zoomEnd,
                amplitudeZoomMinNorm: amplitudeZoomMinNorm,
                amplitudeZoomMaxNorm: amplitudeZoomMaxNorm,
                rectZoomSelection: rectZoomSelection ? Object.assign({}, rectZoomSelection) : null,
                cursorNorm: cursorNorm,
                visibleSpectrumTrackCount: visibleSpectrumTrackCount,
                contentType: contentType,
                reanalyzeBusy: isReanalyzeBusy(),
                latestSpectrogram: latestSpectrogram,
                axisLabels: {
                    spectrumOverlay: overlaySpectrumAxisLabels(visibleSlices, spectrumViewState()),
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
            testBridge.publish({
                    ...domSnapshotBase(document),
                    zoomStart: zoomStart,
                    zoomEnd: zoomEnd,
                    cursorNorm: cursorNorm,
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
        const warning = pythonEnvironmentState.status === 'warning';
        return selectionLayoutHtml({
            rootPath: state.rootPath || '',
            filterQuery: selectionTreeView.filterQuery,
            treeHtml: selectionTreeView.renderTree(__directoryTree, true, 0),
            resultsPaneHtml: buildResultsPane(STR.emptyNoTracks),
            python: {
                text: buildPythonButtonText(pythonEnvironmentState.pythonCommand, warning),
                tooltip: buildPythonTooltip(pythonEnvironmentState.pythonCommand, pythonEnvironmentState.tooltip),
                warning,
            },
        }, STR);
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
        return resultsPaneHtml({
            tracksHtml: buildTrackRowsHtml(),
            toolbarHtml: buildToolbar(),
            audioHtml: buildAudioElements(),
            emptyMessage,
            axisWidth: AXIS_W,
        }, STR);
    }
    function buildAudioElements() {
        return trackStore.activeIds().map(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            if (!result.audioSource) {
                return '';
            }
            return trackAudioHtml(trackId, record.protocolIndex, result.audioSource, !!record.runtime.muted);
        }).join('');
    }
    function buildToolbar() {
        return toolbarHtml({
            contentType,
            trackHeight,
            trackHeightRange: { min: TRACK_HEIGHT_MIN, max: TRACK_HEIGHT_MAX },
            spectrumHeight: spectrumOverlayHeight,
            spectrumHeightRange: { min: SPECTRUM_HEIGHT_MIN, max: SPECTRUM_HEIGHT_MAX },
        }, STR);
    }
    function buildChannelLane(result: ComparisonTrackState, trackIndex: number, channelIndex: number) {
        const trackId = trackIdAtIndex(trackIndex);
        if (!trackId) {
            return '';
        }
        const channels = channelsForResult(result);
        return channelLaneHtml({
            trackId,
            trackIndex,
            channelIndex,
            channelCount: channels.length,
            channelLabel: channelLabel(result, channelIndex),
            metricSummaryHtml: channelMetricSummaryHtml(channels[channelIndex]),
            fileName: result.fileName,
            axisWidth: AXIS_W,
            spectrumTitle: STR.trackSpectrumTitle,
        });
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
        return trackRowHtml({
            trackId,
            trackIndex: i,
            fileName: result.fileName,
            filePath: result.filePath,
            channelCount: result.channelCount,
            sampleRateHz: result.sampleRateHz,
            channels: channelsForResult(result),
            color: trackColor(i),
            playable: !!result.audioSource,
            muted: !!trackStore.require(trackId).runtime.muted,
            lanesHtml: buildChannelLanes(result, i),
        }, STR);
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
    function resizeAllCanvases() {
        state.results.forEach(function (result: ComparisonTrackState, i: number) {
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const canvas = document.getElementById(trackCanvasId(i, channelIndex));
                if (!canvas) {
                    return;
                }
                const wrap = document.getElementById(trackCanvasWrapId(i, channelIndex));
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
        const gs = trackStore.globalSpan();
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
            rangeCacheCoversView(c, channelIndex, fileView.fileAtZoomStart, fileView.fileAtZoomEnd)) {
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
        const record = trackRecordAtIndex(trackIndex);
        let coverage: WaveformCoverage | null = null;
        if (src && window.renderWaveformPipeline) {
            const renderPipeline = window.renderWaveformPipeline;
            const placement = trackTimelinePlacement(offsetSeconds, result.durationSeconds, trackStore.globalSpan());
            const extent = traceXExtent(ctx, function () {
                ctx.save();
                try {
                    renderPipeline(ctx, W, H, src.waveform, {
                        zoomStart,
                        zoomEnd,
                        offsetNorm: placement.offsetNorm,
                        trackDurRatio: placement.trackDurRatio,
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
                }
            });
            coverage = waveformCoverageFromExtent(extent, W);
        }
        if (record) {
            record.waveformCoverage = coverage;
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
            requestTrackDetail(trackIndex);
            drawCanvasMessage(ctx, W, H, STR.spectrogramLoading, '11px sans-serif', drawTheme().mutedColor);
            return;
        }
        const spec = ch.spectrogram;
        const { offsetNorm: trackStart, trackDurRatio } = trackTimelinePlacement(offsetSeconds, result.durationSeconds, trackStore.globalSpan());
        const { dbLo, dbHi, maxFrequencyHz: maxFreq } = spectrogramDisplayBounds(spec, __spectrogramSettings.display);
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
    type CanvasHitTarget = Pick<Element, 'getBoundingClientRect'> & { width: number };
    function trackCanvasTimeHit(canvas: CanvasHitTarget, clientX: number) {
        const timeWidth = contentType === 'spectrogram' ? spectrogramPlotWidth(canvas.width) : canvas.width;
        return canvasTimeHit(canvas.getBoundingClientRect().left, clientX, timeWidth, { start: zoomStart, end: zoomEnd });
    }
    function clampedTrackCanvasNorm(canvas: Pick<Element, 'getBoundingClientRect'>, clientX: number, timeWidth: number) {
        return clampedCanvasNorm(canvas.getBoundingClientRect().left, clientX, timeWidth, { start: zoomStart, end: zoomEnd });
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
        const gs = trackStore.globalSpan();
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
        const gs = trackStore.globalSpan();
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
        const toolbarHandlers = { onAction: handleToolbarAction, onHeightInput: applyHeightInput };
        attachToolbarActions(document.getElementById('toolbar'), toolbarHandlers);
        attachToolbarActions(document.getElementById('spectrum-zoom-toolbar'), toolbarHandlers);
        attachExclusiveMenus(document.getElementById('toolbar'));
        attachHeightResizeListeners(
            heightResize,
            [document.getElementById('tracks-wrapper'), document.getElementById('spectrum-section')],
            document,
            window,
        );
        const loopTimeDisplayEl = document.getElementById('loop-time-display');
        if (loopTimeDisplayEl) {
            loopTimeDisplayEl.addEventListener('click', function () {
                if (!loopRegion) {
                    return;
                }
                if (!navigator.clipboard || !navigator.clipboard.writeText) {
                    return;
                }
                const gs = trackStore.globalSpan();
                const startSec = gs.startSec + loopRegion.start * gs.spanSec;
                const endSec = gs.startSec + loopRegion.end * gs.spanSec;
                navigator.clipboard.writeText(formatClockTime(startSec) + ' – ' + formatClockTime(endSec)).catch(function () { });
            });
        }
        attachTrackLaneActions(document.getElementById('tracks-wrapper'), {
            trackIdFromElement,
            trackIndexForId: (trackId) => trackStore.protocolIndexForId(trackId),
        }, {
            'toggle-playback': ({ trackId }) => togglePlayback(trackId),
            'toggle-mute': ({ trackIndex, target }) => {
                if (trackIndex === null) {
                    return;
                }
                const runtime = trackRuntimeAt(trackIndex);
                runtime.muted = !runtime.muted;
                const audio = getTrackAudio(trackIndex);
                if (audio) audio.muted = runtime.muted;
                target.setAttribute('aria-pressed', String(runtime.muted));
                target.textContent = runtime.muted ? '🔇' : '🔊';
            },
            'stop-playback': ({ trackId }) => stopPlayback(trackId),
            'remove-track': ({ trackId }) => removeTrack(trackId),
            'configure-calibration': ({ trackId, trackIndex, event }) => {
                if (trackIndex === null) {
                    return;
                }
                event.preventDefault();
                vscode.postMessage(calibrationRequest(trackIndex, trackStore.require(trackId).result));
            },
            'offset-up': ({ trackIndex }) => {
                if (trackIndex !== null) {
                    adjustOffset(trackIndex, 0.01);
                }
            },
            'offset-down': ({ trackIndex }) => {
                if (trackIndex !== null) {
                    adjustOffset(trackIndex, -0.01);
                }
            },
            'pick-color': ({ trackId, target }) => {
                openColorPicker(trackId, target.closest ? target.closest('[data-action="pick-color"]') : target);
            },
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
            if (isOffsetEditorOpen(span)) {
                return;
            }
            // Delay to allow dblclick (reset) to cancel before opening editor
            if (_offsetEditTimer !== null) {
                clearTimeout(_offsetEditTimer);
            }
            _offsetEditTimer = setTimeout(function () {
                _offsetEditTimer = null;
                const currentMs = Math.round(trackRuntimeAt(idx).offsetSeconds * 1000);
                openOffsetEditor(document, span, currentMs, { placeholder: STR.offsetEditPlaceholder, ariaLabel: STR.offsetEditAriaLabel }, function (offsetMs) {
                    if (offsetMs !== null) {
                        trackRuntimeAt(idx).offsetSeconds = offsetMs / 1000;
                    }
                    updateOffsetDisplays();
                    scheduleRender();
                    scheduleSpectrumRefresh('immediate');
                });
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
                    const waveWrap = document.getElementById(trackCanvasWrapId(i, channelIndex));
                    if (waveWrap) {
                        layoutObserver.observe(waveWrap);
                    }
                    const spectrumWrap = document.getElementById(trackSpectrumWrapId(i, channelIndex));
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
                attachCanvasFocusHint(canvas, canvasTooltip, STR.cursorHelpKeys);
            });
        }
        document.addEventListener('keydown', function (e) {
            const active = document.activeElement;
            const helpEl = document.getElementById('help-overlay');
            const intent = keydownIntent(e, {
                spectrumActive: spectrumHover.hasMouse || !!(active && (active.id === 'spectrum-overlay-canvas'
                    || (active.classList && active.classList.contains('track-spectrum-canvas')))),
                helpOpen: !!(helpEl && !helpEl.hidden),
                textEntryFocused: isTextEntryTag(active && active.tagName),
                trackCanvasFocused: !!(active && active.classList.contains('track-canvas')),
            });
            if (!intent) {
                return;
            }
            e.preventDefault();
            if (intent.kind === 'spectrum-step') {
                moveSpectrumHoverByBin(intent.delta);
                scheduleSpectrumRefresh('hover');
            }
            else if (intent.kind === 'shortcut') {
                handleToolbarAction(intent.action);
            }
            else if (intent.kind === 'toggle-playback') {
                const trackId = intent.target === 'focused-track'
                    ? trackIdFromElement(active)
                    : playbackTrackId ?? trackStore.activeIds()[0];
                if (trackId) {
                    togglePlayback(trackId);
                }
            }
            else {
                const step = arrowCursorStep(e.shiftKey, trackStore.globalSpan().spanSec, zoomStart, zoomEnd, active.width || 800);
                invalidateDesiredSpectrumSliceRequests();
                cursorNorm = Math.max(0, Math.min(1, cursorNorm + intent.direction * step));
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
            const spectrumCursor = createSpectrumCursorHandlers({
                hover: spectrumHover,
                trackIdAtIndex,
                trackIndexFromElement,
                activeElement: () => document.activeElement,
                refresh: () => scheduleSpectrumRefresh('hover'),
            });
            const overlayCanvas = document.getElementById('spectrum-overlay-canvas');
            if (overlayCanvas) {
                overlayCanvas.addEventListener('mousemove', function (e) {
                    if (specBoxDrag.active) {
                        return;
                    } // ドラッグ中はホバー不要
                    spectrumCursor.move(overlayCanvas, OVERLAY_SPECTRUM_PAD.left, OVERLAY_SPECTRUM_PAD.right, e, -1, null);
                });
                overlayCanvas.addEventListener('mouseleave', spectrumCursor.leave);
                overlayCanvas.addEventListener('focus', function () { spectrumCursor.focus(-1, null); });
                overlayCanvas.addEventListener('blur', spectrumCursor.blur);
                attachSpectrumBoxDrag(overlayCanvas, document, specBoxDrag, {
                    onUpdate: () => scheduleSpectrumRefresh('hover'),
                    onFinish(drag) {
                        const zoom = spectrumBoxZoom(
                            drag.anchor,
                            drag.current,
                            overlayCanvas.width,
                            overlayCanvas.height,
                            { freqStart: specFreqStart, freqEnd: specFreqEnd },
                            _lastVisDbMin !== null && _lastVisDbMax !== null ? { min: _lastVisDbMin, max: _lastVisDbMax } : null,
                        );
                        if (zoom) {
                            specFreqStart = zoom.freqStart;
                            specFreqEnd = zoom.freqEnd;
                            if (zoom.dbMin !== undefined && zoom.dbMax !== undefined) {
                                specDbMin = zoom.dbMin;
                                specDbMax = zoom.dbMax;
                            }
                        }
                        scheduleSpectrumRefresh('immediate');
                    },
                });
                overlayCanvas.addEventListener('dblclick', function (e) {
                    if (_lastSpectrumMaxF <= 0) {
                        return;
                    } // データ無し
                    const px = clientToCanvasPixels(e.clientX, e.clientY, overlayCanvas.getBoundingClientRect(), overlayCanvas.width, overlayCanvas.height);
                    const region = overlaySpectrumRegionAt(px.x, px.y, overlayCanvas.width, overlayCanvas.height);
                    if (region === 'db-axis') {
                        openSpectrumRangePopup('db', e.clientX, e.clientY);
                    }
                    else if (region === 'freq-axis') {
                        openSpectrumRangePopup('freq', e.clientX, e.clientY);
                    }
                    else if (region === 'plot') {
                        specZoomReset();
                    }
                });
            }
            function attachTrackSpectrumCursorEvents() {
                document.querySelectorAll('.track-spectrum-canvas').forEach(function (c) {
                    c.addEventListener('mousemove', function (e) {
                        spectrumCursor.move(c, TRACK_SPECTRUM_PAD.left, TRACK_SPECTRUM_PAD.right, e, trackIndexFromElement(c), channelIndexAttribute(c));
                    });
                    c.addEventListener('mouseleave', spectrumCursor.leave);
                    c.addEventListener('focus', function () {
                        spectrumCursor.focus(trackIndexFromElement(c), channelIndexAttribute(c));
                    });
                    c.addEventListener('blur', spectrumCursor.blur);
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
    function setContentType(next: 'waveform' | 'spectrogram') {
        contentType = next;
        if (next === 'waveform') {
            state.results.forEach(function (_result, index) { releaseTrackDetail(index); });
        }
        persistWebviewState({ contentType: contentType });
        document.querySelector('[data-action="content-waveform"]').classList.toggle('is-active', next === 'waveform');
        document.querySelector('[data-action="content-spectrogram"]').classList.toggle('is-active', next === 'spectrogram');
        __updateSpecGearVisibility();
        scheduleRender();
    }
    function toggleFollowCursor() {
        followCursor = !followCursor;
        const btn = document.querySelector('[data-action="toggle-follow-cursor"]');
        if (btn) {
            btn.classList.toggle('is-active', followCursor);
        }
        scheduleRender();
    }
    function handleToolbarAction(action: string) {
        const toolbarActions: Record<string, () => void> = {
            'open-file': () => messaging.post({ type: 'select-target', targetKind: 'file' }),
            'open-folder': () => messaging.post({ type: 'select-target', targetKind: 'directory' }),
            'select-python-environment': () => messaging.post({ type: 'select-python-environment' }),
            'content-waveform': () => setContentType('waveform'),
            'content-spectrogram': () => setContentType('spectrogram'),
            'zoom-in': zoomIn,
            'zoom-out': zoomOut,
            'zoom-reset': resetZoom,
            'spec-zoom-in': specZoomIn,
            'spec-zoom-out': specZoomOut,
            'spec-zoom-reset': specZoomReset,
            'track-height-reset': () => setTrackHeight(TRACK_HEIGHT_DEFAULT),
            'spectrum-height-reset': () => setSpectrumHeight(SPECTRUM_HEIGHT_DEFAULT),
            'wave-mode-rect-zoom': () => {
                waveformMode = waveformMode === 'rect-zoom' ? 'loop' : 'rect-zoom';
                syncWaveformModeButton();
            },
            'toggle-follow-cursor': toggleFollowCursor,
            'zoom-to-selection': zoomToSelection,
            'run-recipe': () => messaging.post({ type: 'run-recipe' }),
            'copy-spec': copySpecToClipboard,
            'export-png': exportPng,
            'export-csv': exportCsv,
            'export-wav': exportWavLoop,
            'export-report': exportReport,
        } satisfies Record<GlobalShortcutAction, () => void> & Record<string, () => void>;
        if (Object.prototype.hasOwnProperty.call(toolbarActions, action)) {
            toolbarActions[action]();
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
        const span = trackStore.globalSpan();
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
        const gs = trackStore.globalSpan();
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
        navigator.clipboard.writeText(buildSpecSummaryText(state.results || [], __spectrogramSettings.stft))
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
        if (exceedsDragThreshold(dx, dy)) {
            dragState.isDrag = true;
        }
        if (!dragState.isDrag) {
            return;
        }
        disableFollowCursor();
        hideTooltip();
        if (dragState.dragType === 'offset') {
            const gs = trackStore.globalSpan();
            const secsPerPx = (zoomEnd - zoomStart) * gs.spanSec / dragState.canvasWidth;
            trackRuntimeAt(dragTrackIndex).offsetSeconds = dragState.startOffset + dx * secsPerPx;
            updateOffsetDisplays();
        }
        else {
            const canvasEl = document.getElementById(trackCanvasId(dragTrackIndex, 0));
            if (canvasEl) {
                const norm = clampedTrackCanvasNorm(canvasEl, e.clientX, dragState.canvasWidth);
                if (dragState.dragType === 'rectZoom') {
                    const y = e.clientY - canvasEl.getBoundingClientRect().top;
                    rectZoomSelection = {
                        trackId: dragState.trackId,
                        startNorm: dragState.startNorm,
                        endNorm: norm,
                        startAmpNorm: dragState.startAmpNorm,
                        endAmpNorm: canvasYToAmplitudeNorm(y, dragState.canvasHeight),
                    };
                    updateUiSmokeWaveformState();
                }
                else {
                    const region = loopRegionForDrag(dragState.dragType, dragState.startNorm, loopRegion, norm);
                    if (region) {
                        loopRegion = region;
                        updateLoopTimeDisplay();
                        updateZoomToSelectionBtn();
                    }
                }
            }
        }
        scheduleRender();
    }
    function handleDocMouseUp(e: MouseEvent): void {
        const hadDrag = !!dragState;
        const wasRectZoom = dragState !== null && dragState.isDrag && dragState.dragType === 'rectZoom' && waveformMode === 'rect-zoom';
        if (dragState && !dragState.isDrag) {
            // クリック（ドラッグなし）: カーソル移動 + ループ区間解除
            const dragTrackIndex = trackStore.protocolIndexForId(dragState.trackId);
            const canvasId = dragTrackIndex === null ? '' : trackCanvasId(dragTrackIndex, 0);
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
            const target = rectZoomTarget(completedRectZoom);
            rectZoomSelection = null;
            if (target) {
                disableFollowCursor();
                zoomStart = target.zoomStart;
                zoomEnd = target.zoomEnd;
                amplitudeZoomMinNorm = target.amplitudeMin;
                amplitudeZoomMaxNorm = target.amplitudeMax;
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
        const gs = trackStore.globalSpan();
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
        return extractCursorSpectrum(result, offsetSeconds, cursorNormValue, trackStore.globalSpan(), {
            trackIndex,
            channelIndex: chIdx,
            cached: trackIndex >= 0 ? trackRecordAtIndex(trackIndex)?.spectrumSliceCache.get(chIdx) ?? null : null,
            settingsSignature: currentSpectrumDataSignature(),
            requestSlice: requestSpectrumSlice,
            applyDisplaySettings: applySpectrumDisplaySettings,
        });
    }
    function spectrumSeriesLabel(result: ComparisonTrackState, channelIndex: number) {
        return result.fileName + ' / ' + channelLabel(result, channelIndex);
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
    function moveSpectrumHoverByBin(deltaIdx: number) {
        if (spectrumHover.norm === null) {
            spectrumHover.norm = 0.5;
        }
        if (spectrumHover.target !== null && spectrumHover.target !== 'overlay') {
            const record = trackStore.get(spectrumHover.target);
            if (!record?.active) {
                return;
            }
            const trackIndex = record.protocolIndex;
            const result = record.result;
            const channelIndex = typeof spectrumHover.channelIndex === 'number' ? spectrumHover.channelIndex : 0;
            const slice = extractSpectrumAtCursor(result, trackIndex, record.runtime.offsetSeconds, cursorNorm, channelIndex);
            if (!slice) {
                return;
            }
            const visFreqMin = specFreqStart * slice.maxFrequencyHz;
            const visFreqMax = specFreqEnd * slice.maxFrequencyHz;
            const snap = spectrumBinAtHover(slice, spectrumHover.norm, { padLeft: 0, plotWidth: 1, padTop: 0, plotHeight: 1, frequencyMin: visFreqMin, frequencyMax: visFreqMax, dbMin: slice.minDb, dbMax: slice.maxDb });
            if (!snap) {
                return;
            }
            spectrumHover.norm = steppedSpectrumHoverNorm(slice, snap.binIdx, deltaIdx, visFreqMin, visFreqMax);
            return;
        }
        const slices = visibleSpectrumSlices();
        if (slices.length === 0) {
            return;
        }
        const range = spectrumSeriesRange(slices);
        const vis = spectrumVisibleWindow(range.maxFrequencyHz, range.minDb, range.maxDb, spectrumViewState());
        const overlayC = document.getElementById('spectrum-overlay-canvas');
        const mouseY = spectrumHover.yFrac !== null && overlayC ? spectrumHover.yFrac * overlayC.height : null;
        const frame = { padLeft: 0, plotWidth: 1, padTop: 0, plotHeight: 1, ...vis };
        const nearest = nearestSpectrumSnap(slices, spectrumHover.norm, mouseY, frame);
        const chosen = nearest ? nearest.s : slices[0];
        const snap = nearest ? nearest.snap : spectrumBinAtHover(chosen.slice, spectrumHover.norm, frame);
        if (!snap) {
            return;
        }
        spectrumHover.norm = steppedSpectrumHoverNorm(chosen.slice, snap.binIdx, deltaIdx, vis.frequencyMin, vis.frequencyMax);
        spectrumHover.target = 'overlay';
        spectrumHover.channelIndex = null;
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
                const wrap = document.getElementById(trackSpectrumWrapId(i, channelIndex));
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
                    drawCanvasMessage(ctx, W, H, STR.canvasOutOfRange, '9px sans-serif', drawTheme().mutedColor);
                    paintedByChannel.set(channelIndex, false);
                    return;
                }
                ctx.clearRect(0, 0, W, H);
                const color = trackColor(i);
                const pad = TRACK_SPECTRUM_PAD;
                const vis = spectrumVisibleWindow(slice.maxFrequencyHz, slice.minDb, slice.maxDb, spectrumViewState());
                drawSpectrumAxes(ctx, W, H, slice, pad.left, pad.right, pad.top, pad.bottom, vis.frequencyMin, vis.frequencyMax, vis.dbMin, vis.dbMax, drawTheme());
                drawSpectrumLine(ctx, W, H, slice, color, { padL: pad.left, padR: pad.right, padT: pad.top, padB: pad.bottom }, vis.frequencyMin, vis.frequencyMax, vis.dbMin, vis.dbMax);
                paintedByChannel.set(channelIndex, true);
                if (spectrumHover.norm !== null && spectrumHover.target === trackId && spectrumHover.channelIndex === channelIndex) {
                    const frame = spectrumPlotFrame(W, H, pad, vis);
                    const snap = spectrumBinAtHover(slice, spectrumHover.norm, frame);
                    if (!snap) {
                        return;
                    }
                    drawSpectrumCrosshair(ctx, frame, snap.x, snap.dbVal !== undefined ? snap.y : null, 'rgba(255,255,255,0.75)', color);
                    if (snap.dbVal !== undefined) {
                        setSpectrumReadout(document.getElementById('spectrum-freq-readout'), trackSpectrumReadoutText(spectrumReadoutTrackLabel(result, channelIndex), slice, snap.freqHz, snap.dbVal), color);
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
        const wrapStyle = wrap && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
            ? window.getComputedStyle(wrap)
            : null;
        const w = contentBoxWidth(wrap, 800, wrapStyle);
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
            drawCanvasMessage(ctx, W, H, STR.spectrumNoData, '11px sans-serif', drawTheme().mutedColor);
            overlaySpectrumPainted = false;
            return;
        }
        const paint = paintOverlaySpectrum(ctx, W, H, slices, spectrumViewState(), spectrumHover, specBoxDrag.box, drawTheme());
        _lastSpectrumMaxF = paint.maxFrequencyHz;
        _lastVisDbMin = paint.dbMin;
        _lastVisDbMax = paint.dbMax;
        if (paint.readout) {
            setSpectrumReadout(document.getElementById('spectrum-freq-readout'), paint.readout.text, paint.readout.color);
        }
        if (!paint.painted) {
            return;
        }
        overlaySpectrumPainted = true;
    }
    function refreshSpectrumViews() {
        renderTrackSpectra();
        renderOverlaySpectrum();
        updateUiSmokeSpectrumState();
        const el = document.getElementById('spectrum-cursor-time');
        if (el) {
            const gs = trackStore.globalSpan();
            el.textContent = '@ ' + formatClockTime(gs.startSec + spectrumCursorNorm * gs.spanSec);
        }
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
