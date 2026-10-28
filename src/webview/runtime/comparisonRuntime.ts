import { OrderedSelection } from '../../shared/utils/directorySelection';
import { channelLabel, channelsForResult, formatClockTime } from '../../shared/utils/format';
import { linkedSpectrogramBounds, spectrogramDisplayBounds } from './spectrogramRaster';
import { paintTrackSpectrogram, paintTrackWaveform, spectrogramPlotWidth, type SpectrogramRasterCacheEntry } from './trackCanvasPainter';
import { trackTimelinePlacement } from './waveformCoverage';
import { attachOffsetEditing } from './offsetInlineEditor';
import { dispatchTestMouseEvent, fillSpectrogramDisplayForm, fillSpectrogramSettingsForm, heightDragFromPayload, loopRegionFromPayload, setTestInputValue, testActionTrackId } from './testActionForms';
import { nextRequestId } from './hostRequests';
import { DEFAULT_PYTHON_ENVIRONMENT_STATE, isResponseToLazyRequest, mergeDetailSpectrograms, pythonEnvironmentStateFromMessage } from './lazyResponses';
import { formatAmplitudeValue, formatWaveformAxisLabels, drawWaveformAmplitudeAxis, drawSpectrogramFrequencyAxis, drawCanvasMessage, type DrawTheme } from '../draw/canvasDrawers';
import { isCacheSufficient, computeReqBounds, isOverviewSufficient, rangeCacheCoversView, rangeRequestPointCount } from '../waveform/rangeRequestPolicy';
import { extractSpectrumAtCursor as extractCursorSpectrum } from '../spectrum/cursorSpectrum';
import { buildSpectrumCsv, wavLoopRegions } from './runtimeExports';
import { audioById, buttonById, buttonMatching, canvasById, canvasesMatching, canvasTarget, eventTarget, inputMatching, requiredElementById } from './domAdapter';
import { HostMessenger } from './hostMessaging';
import {
    createTrackTimeMapping,
    globalNormFromTrackTime as mapGlobalNormFromTrackTime,
    loopRestartTime,
    passFadeSeconds,
    playbackEndFade,
    playbackStartTime,
} from './playback';
import { createAudioFader, FADE_SECONDS } from './audioFade';
import { positionPopover } from './settingsPopover';
import { composeTrackCanvases, triggerAnchorDownload, visibleExportCanvases } from './exportDownloads';
import { clampHeight, createHeightResize, type HeightKind } from './heightResize';
import { installRangePopover } from '../rangePopover';
import { buildMarkdownReport, buildNotebook, type ReportLoopRegion, type ReportTrack } from '../../shared/report/analysisReport';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { installHelpOverlay } from './helpOverlay';
import { arrowCursorStep, isTextEntryTag, type GlobalShortcutAction } from './shortcuts';
import { domSnapshotBase, latestSpectrogramSnapshot, shellSnapshot, overlaySpectrumAxisLabels, sliceSpectrumAxisLabels, spectrogramAxisLabelTexts, visibleFileRange, waveformCoverageSnapshot } from './testSnapshot';
import { contentBoxWidth, syncCanvasSize } from './canvasSizing';
import { trackAxisCanvasId, trackCanvasId, trackCanvasWrapId, trackSpecAxisCanvasId, trackSpecCanvasId, trackSpectrogramOverlayCanvasId, trackSpectrumCanvasId, trackSpectrumWrapId } from './trackCanvasIds';
import { channelLaneHtml, trackRowHtml } from './trackLaneHtml';
import { attachSpectrumBoxDrag, SpectrumBoxDrag } from './spectrumBoxDrag';
import { attachCanvasFocusHint, attachHoverHints, createHintFooter, setHint } from './hintFooter';
import { attachSpectrumCursorListeners, createSpectrumCursorHandlers } from './spectrumCursorHandlers';
import { attachTrackLaneActions } from './trackLaneActions';
import { attachTrackAudioListeners } from './trackAudioEvents';
import { attachOverlaySpectrumDoubleClick, attachOverlaySpectrumHints } from './overlaySpectrumEvents';
import { attachGlobalKeyboardListeners } from './globalKeyboardEvents';
import { attachTrackPointerListeners } from './trackPointerEvents';
import { buildPythonButtonText, buildPythonTooltip, isPythonEnvError } from './pythonEnvironmentLabels';
import { rulerTicks } from './timeRuler';
import { createPlaybackDisplay } from './playbackDisplay';
import { installLayoutResizeHandling } from './layoutResize';
import { syncPanelToggle, syncSpectrumMaximize } from './panelCollapse';
import { SpectrumHover } from './spectrumHover';
import { SpectrumView } from './spectrumView';
import { WaveformView } from './waveformView';
import { paintOverlaySpectrum } from './overlaySpectrumPainter';
import { referenceButtonHtml } from './pairSpectrum';
import { PairSpectrumPanel } from './pairSpectrumPanel';
import { paintTrackSpectrum } from './trackSpectrumPainter';
import { collectSpectrumSeries, type CollectedSpectrumSeries, type SpectrumSeriesSource } from './spectrumSeriesCollector';
import { toolbarHtml } from './toolbarHtml';
import { attachExclusiveMenus, attachHeightResizeListeners, attachToolbarActions } from './toolbarEvents';
import { resultsPaneHtml, trackAudioHtml, type SpectrumBandsSetting } from './resultsPaneHtml';
import { selectionFolderButton, selectionLayoutHtml } from './selectionLayoutHtml';
import { type AnalysisWindowBand, canvasTimeHit, clampedCanvasNorm, CURSOR_LINE_STYLE, drawAnalysisWindowBand, drawDashedTimeLine, drawRectZoomSelection, HOVER_LINE_STYLE } from './canvasOverlays';
import { applyOverlayCompatibility, calibrationRequest, channelMetricSummaryHtml, ensureCalibrationStyles, hasIncompatibleLevelReferences } from './calibrationDecorations';
import {
    channelIndexAttribute,
    hoverNormForFrequency,
    OVERLAY_SPECTRUM_PAD,
    spectrumBoxZoom,
    spectrumSeriesRange,
    spectrumVisibleWindow,
    steppedOverlaySpectrumHoverNorm,
    steppedTrackSpectrumHoverNorm,
    TRACK_SPECTRUM_PAD,
    setSpectrumReadout,
    spectrumSlicesFromResult,
} from './spectrumRuntime';
import { normalizeRuntimeState, PersistedStateStore } from './stateStore';
import { ComparisonTestBridge } from './testBridge';
import { TrackStore } from './trackStore';
import { installTrackReorderDrag } from './trackReorderDrag';
import { installSpectrogramSettingsPopover } from './spectrogramSettingsPopover';
import { installReanalyzeOverlay } from './reanalyzeOverlay';
import { createEntryScreen, type EntryScreenDeps } from './entryRuntime';
import { diffHeadline } from './comparePanes';
import { baseName } from '../../shared/analysis/entryMetadata';
import { channelResult } from '../../shared/recipe/channelSelection';
import { reportFiles } from './compareReport';
import { regionLabel } from './entryTable';
import { activeSlotReferenced, recipeKey } from '../../shared/recipe/recipeSteps';
import { ROLE_COLORS } from '../../shared/gui/roleColors';
import { createTrackStageMode, type StageTrack, type TrackStageDeps, type TrackStageMode } from './trackStageMode';
import { installScreenHelp } from './screenHelp';
import { triggerAnchorDownload as downloadEntryCsv } from './exportDownloads';
import {
    exceedsDragThreshold,
    loopGripAt,
    loopRegionClockText,
    loopRegionForDrag,
    normAtPlotX,
    rectZoomTarget,
    wheelZoomFactor,
    ZOOM_IN_FACTOR,
} from './waveformInteraction';
import type { ChannelSummary, SpectrogramData, SpectrogramDisplaySettings, } from '../../shared/analysis/analysisTypes';
import type { ComparisonBootstrap, ComparisonTrackState, LazyRequestState, LoopRegion, PersistedWebviewState, RectZoomSelection, SpectrumSlice, TestAction, TrackFileView, TrackId, TrackRuntimeState, WaveformDragState, WaveformDrawOptions, } from './types';
export function startComparisonRuntime(bootstrap: ComparisonBootstrap): void {
    const { host: vscode, state: injectedState, strings: STR, appVersion, window, document } = bootstrap;
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
    const isSelectionMode = state.mode === 'directory-selection' || vscode.selectionPanel === true;
    // Only a host that opened the page with a directory offers a Python environment picker; the Web host lists its sources without one.
    const hasPythonEnvironmentPicker = state.mode === 'directory-selection';
    let rootLabel = state.mode === 'directory-selection' ? state.rootPath : '';
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
    /** How many files the host lists (a folder's, or files opened on their own): the entry table's rows. */
    let listedCount = isSelectionMode ? allSelectableFilePaths.length : 0;
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
    const TRACK_HEADER_W = 130;
    const AXIS_W = 64;
    // A lane's plot height: the waveform and the spectrogram under it share it (TRACK_SPLIT_H apart).
    const TRACK_HEIGHT_DEFAULT = 160;
    const TRACK_HEIGHT_MIN = 100;
    const TRACK_HEIGHT_MAX = 440;
    const TRACK_SPLIT_H = 5;
    const WAVE_SHARE_DEFAULT = 0.4;
    const WAVE_SHARE_MIN = 0.15;
    const WAVE_SHARE_MAX = 0.85;
    const LANE_PLOT_MIN = 40;
    const SPECTRUM_HEIGHT_DEFAULT = 140;
    const SPECTRUM_HEIGHT_MIN = 80;
    const SPECTRUM_HEIGHT_MAX = 1200;
    // A tall spectrum still leaves the tracks this much room so the cursor stays reachable.
    const TRACKS_MIN_VISIBLE = 120;
    // A track's own colour never looks like a role's: no blue (base), yellow / purple / magenta (slots 1–3),
    // green (Δ) or orange (outliers); those belong to the roles (ROLE_COLORS) and the entry table.
    const TRACK_COLORS = ['#2bb3a3', '#7fd0e8', '#b08968', '#9aa4b2', '#8a9a5b', '#d8dee9', '#6c7a89', '#c8b79c'];
    function announce(msg: string): void {
        const el = document.getElementById('a11y-announce');
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
    // ── Runtime state ──
    let rafPending = false;
    const canvasWidthCache: Record<string, string> = {};
    let playbackEl: HTMLAudioElement | null = null;
    let playbackRafId: number | null = null;
    const audioFader = createAudioFader();
    let endFadeTarget: number | null = null;
    let lastPlayRejection: string | null = null;
    let passFade = FADE_SECONDS;
    // Queuing the end fade further ahead would let a media stall silence the track before it reaches the end.
    const END_FADE_LOOKAHEAD_SECONDS = 0.25;
    let playbackTrackId: TrackId | null = null;
    /** The file the entry table last drew as playing (its row's ■). */
    let entryPlaying: string | null = null;
    let followCursor = false;
    const SPECTRUM_PLAYBACK_TARGET_FRAME_MS = 1000 / 32;
    let spectrumRafPending = false;
    let spectrumTimerId: number | null = null;
    let spectrumRequestTimerId: number | null = null;
    let lastSpectrumRequestAt = -Infinity;
    let spectrumAllowsSliceRequests = true;
    let spectrumCursorNorm = 0;
    const spectrogramRasterCache = new Map<string, SpectrogramRasterCacheEntry>();
    let attachRebuiltTrackEvents: () => void = () => undefined;
    function scheduleRender() {
        if (rafPending) {
            return;
        }
        rafPending = true;
        requestAnimationFrame(function () { rafPending = false; renderAll(); });
    }
    function updateUiSmokeSpectrumState() {
        const uiSmokeState = testBridge.state;
        if (!uiSmokeState) {
            return false;
        }
        uiSmokeState.spectrumZoom = {
            specFreqStart: spectrumView.freqStart,
            specFreqEnd: spectrumView.freqEnd,
            trackHeight: trackHeight,
            spectrumOverlayHeight: spectrumOverlayHeight,
            specDbMin: spectrumView.dbMin,
            specDbMax: spectrumView.dbMax,
        };
        return true;
    }
    function updateUiSmokeWaveformState() {
        const uiSmokeState = testBridge.state;
        if (!uiSmokeState) {
            return;
        }
        uiSmokeState.zoomStart = waveformView.start;
        uiSmokeState.zoomEnd = waveformView.end;
        uiSmokeState.amplitudeZoomMinNorm = waveformView.amplitudeMin;
        uiSmokeState.amplitudeZoomMaxNorm = waveformView.amplitudeMax;
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
    // 'stage': every lane draws one step of the scan Recipe (trackStageMode.ts); it is not kept across sessions.
    /** The steps mode (created once the entry table it reads its Recipe from exists). */
    let stageMode: TrackStageMode | null = null;
    // 'waveform': the lanes show each channel's waveform with its spectrogram under it.
    let contentType: 'waveform' | 'stage' = 'waveform';
    // Linked, every displayed lane shares one absolute amplitude scale, colour scale and frequency range; lanes in
    // another unit (Pa beside full scale, dB SPL beside dBFS) share theirs only with lanes in the same unit.
    let scalesLinked = persistedWebviewState.linkScales === true;
    type LinkedScale = { peaks: Map<string, number>; levels: Map<string, { minDb: number; maxDb: number }>; maxFrequencyHz: number };
    let linkedScaleMemo: LinkedScale | null = null;
    const amplitudeUnitKey = (ch: ChannelSummary | undefined) => (ch && typeof ch.unit === 'string' ? ch.unit.trim() : '');
    const levelUnitKey = (level: { unit?: string; axisLabel?: string; referenceValue?: number; referenceUnit?: string }) =>
        [level.unit ?? '', level.axisLabel ?? '', level.referenceValue ?? '', level.referenceUnit ?? ''].join('|');
    function displayedLanes(): { record: ReturnType<typeof trackStore.require>; channelIndex: number; ch: ChannelSummary }[] {
        const lanes: { record: ReturnType<typeof trackStore.require>; channelIndex: number; ch: ChannelSummary }[] = [];
        trackStore.displayOrder.forEach(function (trackId) {
            const record = trackStore.require(trackId);
            if (!record.runtime.hidden && !record.result.error) {
                channelsForResult(record.result).forEach(function (ch, channelIndex: number) { lanes.push({ record, channelIndex, ch }); });
            }
        });
        return lanes;
    }
    /** The shared scales of the displayed lanes while linked; worked out once per render. */
    function linkedScale(): LinkedScale | null {
        if (!scalesLinked) {
            return null;
        }
        if (!linkedScaleMemo) {
            const peaks = new Map<string, number>();
            const specsByLevel = new Map<string, SpectrogramData[]>();
            displayedLanes().forEach(function ({ ch }) {
                const lanePeak = ch.waveform ? ch.waveform.absolutePeak : NaN;
                const unit = amplitudeUnitKey(ch);
                if (Number.isFinite(lanePeak) && lanePeak > (peaks.get(unit) ?? 0)) peaks.set(unit, lanePeak);
                if (ch.spectrogram) {
                    const key = levelUnitKey(ch.spectrogram);
                    specsByLevel.set(key, [...(specsByLevel.get(key) ?? []), ch.spectrogram]);
                }
            });
            const levels = new Map<string, { minDb: number; maxDb: number }>();
            let maxFrequencyHz = 0;
            specsByLevel.forEach(function (specs, key) {
                const bounds = linkedSpectrogramBounds(specs);
                if (bounds) {
                    levels.set(key, bounds);
                    maxFrequencyHz = Math.max(maxFrequencyHz, bounds.maxFrequencyHz);
                }
            });
            linkedScaleMemo = { peaks, levels, maxFrequencyHz };
        }
        return linkedScaleMemo;
    }
    /** The value drawn at ±1 of the amplitude view: the lane's own peak, or the largest one in its unit while linked. */
    function amplitudeScaleFor(ch: ChannelSummary | undefined): number {
        const linked = linkedScale()?.peaks.get(amplitudeUnitKey(ch));
        if (linked) {
            return linked;
        }
        const rawPeak = ch && ch.waveform ? ch.waveform.absolutePeak : NaN;
        return typeof rawPeak === 'number' && Number.isFinite(rawPeak) && rawPeak > 0 ? rawPeak : 1;
    }
    /** The auto colour and frequency range of a lane's spectrogram: its own, or the one shared while linked. */
    function spectrogramAutoBounds(spec: SpectrogramData): Pick<SpectrogramData, 'minDb' | 'maxDb' | 'maxFrequencyHz'> {
        const linked = linkedScale();
        const level = linked?.levels.get(levelUnitKey(spec));
        return linked && level ? { ...level, maxFrequencyHz: linked.maxFrequencyHz } : spec;
    }
    function toggleLinkedScales(): void {
        scalesLinked = !scalesLinked;
        linkedScaleMemo = null;
        persistWebviewState({ linkScales: scalesLinked });
        syncLinkScalesButton();
        scheduleRender();
    }
    function syncLinkScalesButton(): void {
        const button = buttonMatching(document, '[data-action="link-scales"]');
        if (button) {
            button.classList.toggle('is-active', scalesLinked);
            button.setAttribute('aria-pressed', String(scalesLinked));
        }
    }
    let waveShare = typeof persistedWebviewState.waveShare === 'number'
        ? Math.min(WAVE_SHARE_MAX, Math.max(WAVE_SHARE_MIN, persistedWebviewState.waveShare)) : WAVE_SHARE_DEFAULT;
    /** The waveform's and the spectrogram's heights; the steps view gives the whole lane to its plot. */
    function laneHeights(): { wave: number; spec: number } {
        if (contentType === 'stage') return { wave: trackHeight, spec: 0 };
        // Each plot keeps room for its axis ticks and unit, however the share and the lane height are set.
        const wave = Math.min(trackHeight - LANE_PLOT_MIN, Math.max(LANE_PLOT_MIN, Math.round(trackHeight * waveShare)));
        return { wave, spec: trackHeight - wave };
    }
    function laneOuterHeight(): number {
        return contentType === 'stage' ? trackHeight : trackHeight + TRACK_SPLIT_H;
    }
    let spectrumBandsPerOctave: SpectrumBandsSetting = persistedWebviewState.spectrumBandsPerOctave === 1 || persistedWebviewState.spectrumBandsPerOctave === 3
        ? persistedWebviewState.spectrumBandsPerOctave : 0;
    let sidebarCollapsed = persistedWebviewState.sidebarCollapsed === true;
    // The cursor spectrum starts folded: the tracks get the room until it is opened (and then it stays as left).
    let spectrumCollapsed = persistedWebviewState.spectrumCollapsed !== false;
    let spectrumMaximized = false;
    const waveformView = new WaveformView();
    let cursorNorm = 0; // グローバルカーソル（常に number）
    /**
     * The cursor moved to `norm` (clamped to the tracks): its readouts follow, and spectra asked for at the old
     * place are stale, except while playing, whose own requests keep up with it.
     */
    function moveCursor(norm: number, playing = false): void {
        if (!playing) invalidateDesiredSpectrumSliceRequests();
        cursorNorm = Math.max(0, Math.min(1, norm));
        updateCursorDisplay(cursorNorm);
    }
    let hoverNorm: number | null = null; // ホバープレビュー位置（null = 非表示）
    const spectrumHover = new SpectrumHover();
    let trackHeight = TRACK_HEIGHT_DEFAULT;
    let spectrumOverlayHeight = SPECTRUM_HEIGHT_DEFAULT;
    // ── スペクトルズーム ───────────────────────────────────
    const spectrumView = new SpectrumView();
    const specBoxDrag = new SpectrumBoxDrag();
    const heightResize = createHeightResize({
        currentHeight: kind => kind === 'track' ? trackHeight : spectrumOverlayHeight,
        canBegin: kind => kind === 'track' || (!spectrumCollapsed && !spectrumMaximized),
        setHeight,
        onActiveChange: active => document.body.classList.toggle('is-height-resizing', active),
    });
    // ── 波形モード ────────────────────────────────────────
    let waveformMode: 'loop' | 'rect-zoom' = 'loop';
    let rectZoomSelection: RectZoomSelection | null = null;
    let playbackStartNorm = 0; // 再生開始位置の記憶
    let dragState: WaveformDragState | null = null;
    let loopRegion: LoopRegion | null = null;
    /** The loop region set or cleared: its time readout and the zoom-to-selection button follow. */
    function setLoopRegion(region: LoopRegion | null): void {
        loopRegion = region;
        updateLoopTimeDisplay();
        updateZoomToSelectionBtn();
    }
    let nextDefaultTrackColorIndex = 0;
    function createTrackRuntime(): TrackRuntimeState {
        const defaultColor = TRACK_COLORS[nextDefaultTrackColorIndex % TRACK_COLORS.length];
        nextDefaultTrackColorIndex += 1;
        return { offsetSeconds: 0, hidden: false, defaultColor: defaultColor };
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
    const pairPanel = new PairSpectrumPanel(document, {
        channels() {
            return trackStore.displayOrder.flatMap(function (trackId) {
                const record = trackStore.require(trackId);
                if (record.runtime.hidden || record.result.error) {
                    return [];
                }
                return channelsForResult(record.result).map(function (_, channelIndex: number) {
                    return {
                        trackId,
                        filePath: record.result.filePath,
                        channelIndex,
                        offsetSeconds: record.runtime.offsetSeconds,
                        label: spectrumReadoutTrackLabel(record.result, channelIndex),
                        color: trackColor(record.protocolIndex),
                    };
                });
            });
        },
        range() {
            if (!loopRegion) {
                return null;
            }
            const span = trackStore.globalSpan();
            return { startSeconds: span.startSec + loopRegion.start * span.spanSec, endSeconds: span.startSec + loopRegion.end * span.spanSec };
        },
        analysisId: () => analysisId,
        settingsSignature: currentSettingsSignature,
        nextRequestId: () => nextRequestId('pair', 0),
        post: request => messaging.post(request),
        visibleFrequencyHz: () => spectrumView.visibleFrequencyHz(),
        plotHeight: effectiveSpectrumHeight,
        hoverFrequencyHz() {
            const visible = spectrumView.visibleFrequencyHz();
            if (spectrumHover.target !== 'overlay' || spectrumHover.norm === null || !visible) {
                return null;
            }
            return visible.frequencyMin + spectrumHover.norm * (visible.frequencyMax - visible.frequencyMin);
        },
        onHoverFrequency(frequencyHz) {
            const visible = spectrumView.visibleFrequencyHz();
            if (frequencyHz === null || !visible) {
                if (spectrumHover.target === 'overlay') {
                    spectrumHover.clear();
                }
            }
            else {
                // The pointer is on the pair plot, so the power spectrum's line follows its frequency with no pointer height of its own.
                spectrumHover.norm = hoverNormForFrequency(frequencyHz, visible.frequencyMin, visible.frequencyMax);
                spectrumHover.yFrac = null;
                spectrumHover.target = 'overlay';
                spectrumHover.channelIndex = null;
                spectrumHover.hasMouse = false;
            }
            scheduleSpectrumRefresh('hover');
        },
        theme: drawTheme,
        onReferenceChange(reference) {
            if (reference && spectrumBandsPerOctave !== 0) {
                setSpectrumBands(0);
            }
            syncSpectrumBandsAvailability(reference !== null);
            overlaySpectrumPainted = false;
            scheduleSpectrumRefresh('immediate');
        },
        onLayoutChange() {
            overlaySpectrumPainted = false;
            scheduleSpectrumRefresh('immediate');
        },
    }, STR);
    let overlaySpectrumPainted = false;
    interface DesiredSpectrumSliceRequest extends LazyRequestState {
        trackIndex: number;
        bandsPerOctave: SpectrumBandsSetting;
        filePath: string;
        generation: number;
        cursorNorm: number;
        globalCursorNorm: number;
        requestedAt: number;
    }
    let spectrumRequestGeneration = 0;
    let activeSpectrumSliceRequest: DesiredSpectrumSliceRequest | null = null;
    const desiredSpectrumSliceRequests = new Map<string, DesiredSpectrumSliceRequest>();
    function currentSettingsSignature() {
        try {
            const settings = __spectrogramSettings;
            return JSON.stringify({ auto: settings.auto, stft: settings.stft });
        }
        catch (e) {
            return 'spectrum-data-settings';
        }
    }
    function currentSpectrumDataSignature() {
        const signature = currentSettingsSignature();
        return spectrumBandsPerOctave ? signature + '|bands=' + spectrumBandsPerOctave : signature;
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
        const pending = record.requests.pending('detail')?.meta;
        if (pending && pending.settingsSignature === settingsSignature) {
            return;
        }
        const requestId = nextRequestId('detail', i);
        record.requests.ask('detail', requestId, settingsSignature, { trackId: record.id, requestId: requestId, analysisId: analysisId, settingsSignature: settingsSignature });
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
        const hadPendingDetail = !!record.requests.pending('detail');
        let hadSpectrogram = false;
        if (result.channels) {
            result.channels.forEach(function (channel: ChannelSummary) {
                if (channel && channel.spectrogram) {
                    hadSpectrogram = true;
                    channel.spectrogram = null;
                }
            });
        }
        record.requests.drop('detail');
        desiredSpectrumSliceRequests.delete(spectrumSliceRequestKey(record.id));
        record.requests.drop('slice');
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
                || record.requests.pending('slice')?.meta
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
        const pending = desiredSpectrumSliceRequests.get(key) || record.requests.pending('slice')?.meta;
        if (pending && pending.settingsSignature === settingsSignature && Math.abs((pending.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result)) {
            return;
        }
        const requestId = nextRequestId('slice', i);
        desiredSpectrumSliceRequests.set(key, {
            trackId: record.id,
            requestId: requestId,
            analysisId: analysisId,
            settingsSignature: settingsSignature,
            cursorNorm: localNorm,
            globalCursorNorm: cursorNormValue,
            trackIndex: i,
            bandsPerOctave: spectrumBandsPerOctave,
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
            record.requests.ask('slice', request.requestId, String(request.cursorNorm), request);
            messaging.post({
                type: 'request-spectrum-slice',
                requestId: request.requestId,
                analysisId: request.analysisId,
                settingsSignature: request.settingsSignature,
                trackIndex: request.trackIndex,
                filePath: request.filePath,
                cursorNorm: request.cursorNorm,
                ...(request.bandsPerOctave ? { bandsPerOctave: request.bandsPerOctave } : {}),
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
        // Its role from the entry table's slots (base blue, slots 1–3); otherwise its own colour, never a role's.
        const filePath = state.results[i]?.filePath;
        const role = filePath && stageMode ? stageMode.role(filePath) : undefined;
        return (role !== undefined ? ROLE_COLORS[role] : undefined) || (runtime && runtime.defaultColor) || TRACK_COLORS[i % TRACK_COLORS.length];
    }
    const hintFooter = createHintFooter(document);
    attachHoverHints(document, hintFooter);
    const updatePlaybackDisplay = createPlaybackDisplay(document, STR.playbackTimePrefix || '▶');
    // ── On-demand range cache ──
    let rangeRequestTimer: number | null = null;
    // Receive high-res range data from Extension Host
    /** The files the host last reported selected: a file it newly selects is shown again even if its track was taken off. */
    let hostSelection = new Set<string>();
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
        if (!record.requests.answering('range', msg.requestId)) {
            return;
        } // stale
        record.requests.settle(msg.requestId);
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
        const pending = record.requests.answering('detail', msg.requestId)?.meta;
        if (!isResponseToLazyRequest(pending, trackId, msg) || pending.channelIndex !== msg.channelIndex) {
            return;
        }
        record.requests.settle(msg.requestId);
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
        const pending = record.requests.answering('slice', msg.requestId)?.meta;
        if (!isResponseToLazyRequest(pending, trackId, msg)) {
            pumpSpectrumSliceRequests();
            return;
        }
        record.requests.settle(msg.requestId);
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
        scheduleRender();
        requestAnimationFrame(function () { publishTestSnapshot(); });
        pumpSpectrumSliceRequests();
    });
    messaging.onMessage(function (msg) {
        if (msg && pairPanel.handleMessage(msg)) {
            requestAnimationFrame(function () { publishTestSnapshot(); });
        }
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
            // Tests set the heights the drag handles would: track-height-input / spectrum-height-input.
            Object.keys(inputValues).forEach(function (action: string) {
                const height = Number(inputValues[action]);
                const kind = action === 'track-height-input' ? 'track' : action === 'spectrum-height-input' ? 'spectrum' : null;
                if (kind && Number.isInteger(height)) setHeight(kind, height);
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
                setTrackOffset(trackIndex, offsetSeconds);
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
                requiredElementById(document, 'spec-apply').click();
            },
            'set-cursor': p => {
                moveCursor(Number(p.cursorNorm));
                scheduleRender();
                scheduleSpectrumRefresh('immediate');
            },
            // A listed file shown as a track or taken off, as the entry table's slots and ＋ do.
            'set-file-selected': p => setFilesShown([String(p.filePath)], !!p.selected),
            // Every listed file at once, shown or taken off (the e2e's folder-wide steps).
            'set-all-files-selected': p => {
                if (p.selected) { selectTracks(allSelectableFilePaths, true); return; }
                clearSelectedFilePaths();
                syncSelectionSummary();
                postSelectedFiles(true);
            },
            // A key pressed and released, as the entry table and the comparison read them (on the window).
            'press-key': p => {
                for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: String(p.key), bubbles: true, cancelable: true }));
            },
            'mouse-event': p => dispatchTestMouseEvent(document, p),
            'set-input-value': p => setTestInputValue(document, p),
            'set-loop-region': p => {
                const region = loopRegionFromPayload(p);
                if (region) {
                    setLoopRegion(region);
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
            const gear = buttonMatching(document, '[data-action="spectrogram-settings"]');
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
        const fileAtZoomStart = (waveformView.start - trackStart) / trackDurRatio;
        const fileAtZoomEnd = (waveformView.end - trackStart) / trackDurRatio;
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
    /** Lanes are drawn (and fetch their spectrogram and zoom detail) only within about a screen of the track area's view. */
    let drawEveryLane = false;
    function laneInView(trackIndex: number): boolean {
        if (drawEveryLane) return true;
        const wrapper = document.getElementById('tracks-wrapper');
        const row = document.getElementById('track-row-' + trackIndex);
        if (!wrapper || !row) return true;
        const view = wrapper.getBoundingClientRect();
        if (view.height <= 0) return true;
        const lane = row.getBoundingClientRect();
        return lane.bottom >= view.top - view.height && lane.top <= view.bottom + view.height;
    }
    function checkAndRequestRanges() {
        state.results.forEach(function (result: ComparisonTrackState, i: number) {
            const record = trackRecordAtIndex(i);
            if (!record || record.runtime.hidden || result.error || !laneInView(i)) {
                return;
            }
            const canvas = canvasById(document, trackCanvasId(i, 0));
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
            const requestId = nextRequestId('range', record.id);
            record.requests.ask('range', requestId, `${reqStart}|${reqEnd}|${pts}`, null);
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
    const app = requiredElementById(document, 'app');
    app.innerHTML = buildLayout();
    syncPythonEnvironmentButton();
    syncWaveformModeButton();
    __updateSpecGearVisibility();
    attachEvents();
    // Installed before the screens, so its key listener runs before theirs and owns ? and F1. The comparison's
    // keys are listed while the track view compares (its steps mode, the entry table not over it).
    const screenHelp = installScreenHelp(document, window, STR, () => {
        if (entryScreen.isOpen() || entryScreen.hasFocus()) return 'entry';
        return stageMode?.active() ? 'compare' : null;
    });
    /** Tracks are analysed (waveform, spectrogram) for the files compared from the entry table, or the old screen's. */
    function selectTracks(filePaths: readonly string[], replace = false) {
        if (replace) clearSelectedFilePaths();
        const wanted = filePaths.filter(filePath => replace || !selectedFilePaths.includes(filePath));
        if (!wanted.length && !replace) return;
        wanted.forEach(function (filePath) {
            trackStore.allowExplicitSelection(filePath);
            addSelectedFilePath(filePath);
        });
        syncSelectionSummary();
        postSelectedFiles();
    }
    /** Shows files as tracks (each analysed if it is not yet), or takes them off the track view: one request for all of them. */
    function setFilesShown(filePaths: readonly string[], shown: boolean) {
        if (shown) {
            // A hidden track asked for again is shown again.
            const unhidden = filePaths.map(trackRecordForPath).filter(record => record?.runtime.hidden);
            unhidden.forEach(record => { record!.runtime.hidden = false; });
            if (unhidden.length) {
                updateVisibility();
                scheduleRender();
            }
            selectTracks(filePaths);
        } else {
            const leaving = filePaths.filter(hasSelectedFilePath);
            if (leaving.length) {
                leaving.forEach(removeSelectedFilePath);
                syncSelectionSummary();
                postSelectedFiles();
            }
        }
        entryScreen.tracksChanged();
    }
    /** The active track of a file (the first, for a file listed twice). */
    function trackRecordForPath(filePath: string) {
        const trackId = trackStore.activeIds().find(id => trackStore.require(id).result.filePath === filePath);
        return trackId ? trackStore.require(trackId) : undefined;
    }
    const trackReady = (filePath: string): boolean => trackStore.activeIds().some(id => trackStore.require(id).result.filePath === filePath);
    /** A ▶ pressed before its file was analysed: it plays once the track is there. */
    let pendingPlay: string | null = null;
    function playWhenReady() {
        if (!pendingPlay || !trackReady(pendingPlay)) return;
        const filePath = pendingPlay;
        pendingPlay = null;
        const trackId = trackStore.activeIds().find(id => trackStore.require(id).result.filePath === filePath);
        if (trackId) togglePlayback(trackId);
    }
    const entryScreen = createEntryScreen({
        document,
        window: window as unknown as EntryScreenDeps['window'],
        strings: STR,
        dock: document.getElementById('entry-dock'),
        maximizedChanged: () => scheduleRender(),
        stepsChanged: () => scheduleRender(),
        shownTracks() {
            const shown = new Map<string, boolean>();
            selectedFilePaths.forEach(function (filePath: string) {
                const record = trackRecordForPath(filePath);
                shown.set(filePath, !!record && record.runtime.hidden);
            });
            return shown;
        },
        setShown: (filePath, shown) => setFilesShown([filePath], shown),
        setShownMany: (filePaths, shown) => setFilesShown(filePaths, shown),
        play(filePath) {
            const record = trackRecordForPath(filePath);
            if (record && !record.runtime.hidden) { togglePlayback(record.id); return; }
            // Not a track yet (or hidden): shown as one, it plays once analysed.
            pendingPlay = filePath;
            setFilesShown([filePath], true);
            playWhenReady();
        },
        playing() {
            return playingPath();
        },
        setHidden(filePath, hidden) {
            const record = trackRecordForPath(filePath);
            if (!record) return;
            record.runtime.hidden = hidden;
            if (hidden && record.id === playbackTrackId) stopPlayback(record.id);
            updateVisibility();
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
            entryScreen.tracksChanged();
        },
        post: message => messaging.post(message),
        loadSlots: () => persistedWebviewState.entrySlots,
        saveSlots: slots => persistWebviewState({ entrySlots: slots }),
        loadDerived: () => persistedWebviewState.entryDerived,
        loadCsv: () => persistedWebviewState.entryCsv,
        saveCsv: csv => persistWebviewState({ entryCsv: csv }),
        loadRecipe: () => persistedWebviewState.entryRecipe,
        saveRecipe: recipe => persistWebviewState({ entryRecipe: recipe }),
        saveDerived: rows => persistWebviewState({ entryDerived: rows }),
        // New results or conditions: the compared tracks' pictures follow.
        compareChanged() { scheduleRender(); },
        help: () => screenHelp.open('entry'),
        openFiles(filePaths, comparison) {
            // The slotted files are compared in the track view, beside the tracks already shown, as a step of the Recipe.
            selectTracks(filePaths);
            stageMode?.open(comparison.stage);
            setContentType('stage');
        },
        announce(text) {
            announce(text);
            hintFooter.show(text);
        },
        saveFolder: (folder, files) => messaging.post({ type: 'save-report-folder', folder, files }),
        download(csv, fileName) {
            if (messaging.downloadFile(csv, fileName, 'text/csv;charset=utf-8')) return;
            downloadEntryCsv(document as unknown as Document, 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), fileName);
        },
    });
    if (state.entry && allSelectableFilePaths.length) {
        entryScreen.open(allSelectableFilePaths, state.rootPath);
    }
    /** The fewest channels of the tracks compared (a hidden track is not). */
    const comparedChannels = (): number | undefined => trackStore.displayOrder.map(trackId => trackStore.require(trackId)).filter(record => !record.runtime.hidden && !record.result.error)
        .reduce<number | undefined>((fewest, record) => Math.min(fewest ?? Infinity, record.result.channelCount), undefined);
    stageMode = createTrackStageMode({
        document,
        window: window as unknown as TrackStageDeps['window'],
        strings: STR,
        post: message => messaging.post(message),
        // The steps the comparison runs are bounded by the tracks it compares, not every file of the table.
        recipe: () => entryScreen.recipes(comparedChannels()),
        slots: () => entryScreen.slots(),
        basePaths: (comparePath, group) => entryScreen.basePaths(comparePath, group),
        baseTitle: (comparePath, group) => entryScreen.baseTitle(comparePath, group),
        stageChannel: (path, comparePath, group) => entryScreen.stageChannel(path, comparePath, group),
        rowInfo: path => entryScreen.rowInfo(path),
        tableBaseBands: (comparePath, group) => entryScreen.tableBaseBands(comparePath, group),
        cost: paths => entryScreen.cost(paths),
        showCompared: () => entryScreen.showCompared(),
        batch: () => entryScreen.openBatch(),
        showLanes(visible) {
            const stacked = document.getElementById('stacked-wrap');
            if (stacked) stacked.style.display = visible ? '' : 'none';
        },
        recipeChanged: recipe => entryScreen.setRecipe(recipe),
        tracks() {
            const tracks: StageTrack[] = [];
            const entryResults = entryScreen.compareData().results;
            trackStore.displayOrder.forEach(function (trackId) {
                const record = trackStore.require(trackId);
                const result = record.result;
                if (record.runtime.hidden || result.error || !result.filePath) return;
                const i = record.protocolIndex;
                // The step's picture is of all channels together: it is drawn on the first lane, the others left clear.
                channelsForResult(result).forEach(function (_, channelIndex: number) {
                    if (channelIndex === 0) return;
                    const canvas = canvasById(document, trackCanvasId(i, channelIndex));
                    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
                });
                // The file's unit and reference as the entry table scanned it, so the level axis names its reference.
                const input = entryResults.get(result.filePath)?.input;
                tracks.push({ filePath: result.filePath, color: trackColor(i), canvas: canvasById(document, trackCanvasId(i, 0)), axis: canvasById(document, trackAxisCanvasId(i, 0)), ...(input ? { input: { unit: input.unit, ref: input.ref } } : {}) });
            });
            return tracks;
        },
        sampleRate: () => state.results.find(result => !result.error)?.sampleRateHz,
        channels: () => comparedChannels(),
        rerender: () => scheduleRender(),
        hint: text => hintFooter.show(text),
        inFront: () => !entryScreen.isOpen(),
        back() {
            const slots = entryScreen.slots();
            entryScreen.show(slots);
        },
        fix(comparePath, groupBase, region, measured) {
            const data = entryScreen.compareData();
            // Over a region, the files' results over it take the entry table's place.
            const results = region ? new Map([...data.results, ...measured]) : data.results;
            // The compared file as the channel it is compared as, against its base as the table defines it.
            const channel = entryScreen.stageChannel(comparePath, comparePath, groupBase);
            const result = channel ? channelResult(results.get(comparePath), channel) : results.get(comparePath);
            const comparison = entryScreen.comparison(comparePath, groupBase, results);
            if (!result?.ok || !comparison.base || comparison.blocked) return STR.compareRefuseFix.replace('{why}', diffHeadline(comparison, STR));
            const definition = entryScreen.baseDefinition(comparePath, groupBase);
            const baseLabel = definition.kind === 'file' ? definition.file ?? baseName(data.slots[0] ?? '') : entryScreen.baseTitle(comparePath, groupBase);
            entryScreen.addDerived({
                parentPath: comparePath, ...(channel ? { ch: channel } : {}), region: regionLabel(region), result, recipeKey: recipeKey(data.runRecipe),
                base: { leq: comparison.base.leq, bands: comparison.base.bands, label: baseLabel, paths: comparison.base.filePaths, definition },
            });
            return null;
        },
        report(showDiff, region, measured) {
            const data = entryScreen.compareData();
            const results = region ? new Map([...data.results, ...measured]) : data.results;
            const { folder, files } = reportFiles(document, {
                model: data.model, results, slots: data.slots, region, recipe: entryScreen.recipes(comparedChannels())?.runRecipe ?? data.recipe ?? null, recipeName: STR.stepRecipeName, now: new Date(), showDiff,
                // The comparisons as the table defines their bases (grouping, filters, channel), and what it was narrowed to.
                compare: path => entryScreen.comparison(path, false, results),
                rowInfo: path => ({ ...entryScreen.rowInfo(path), channel: entryScreen.stageChannel(path, path), base: entryScreen.baseDefinition(path) }),
                selection: entryScreen.selection(),
                derived: entryScreen.derivedRows(),
                slotReference: activeSlotReferenced(data.recipe),
            }, STR);
            messaging.post({ type: 'save-report-folder', folder, files });
            hintFooter.show(STR.reportSaved + folder);
        },
    });
    // The lanes' surface takes the shared plot gestures too; they act only in the steps mode.
    const stageSurface = document.getElementById('tracks-wrapper');
    if (stageSurface) stageMode.attach(stageSurface);
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
        const peak = amplitudeScaleFor(ch);
        const unitText = ch && typeof ch.unit === 'string' && ch.unit.trim() ? ch.unit.trim() : null;
        if (waveformView.isAmplitudeZoomed()) {
            const top = formatSignedAmplitudeValue(waveformView.amplitudeMax * peak);
            const middle = formatSignedAmplitudeValue(((waveformView.amplitudeMin + waveformView.amplitudeMax) / 2) * peak);
            const bottom = formatSignedAmplitudeValue(waveformView.amplitudeMin * peak);
            return [top, middle, bottom, unitText ? STR.waveformAmplitudeLabel + ' (' + unitText + ')' : STR.waveformAmplitudeLabel];
        }
        return formatWaveformAxisLabels(peak, ch && ch.unit, STR.waveformAmplitudeLabel);
    }
    function waveformAxisLabelsForResult(result: ComparisonTrackState, trackIndex: number) {
        return waveformAxisLabelsForChannel(result, 0);
    }
    function formatSignedAmplitudeValue(value: number): string {
        if (value === 0) {
            return '0';
        }
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
            const visibleFile = visibleFileRange(waveformView.start, waveformView.end, placement);
            const spectrumCanvas = canvasById(document, trackSpectrumCanvasId(trackIndex, 0));
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
            spectrumPerTrack.push(sliceSpectrumAxisLabels(slice, spectrumView.state()));
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
                zoomStart: waveformView.start,
                zoomEnd: waveformView.end,
                amplitudeZoomMinNorm: waveformView.amplitudeMin,
                amplitudeZoomMaxNorm: waveformView.amplitudeMax,
                rectZoomSelection: rectZoomSelection ? Object.assign({}, rectZoomSelection) : null,
                cursorNorm: cursorNorm,
                visibleSpectrumTrackCount: visibleSpectrumTrackCount,
                contentType: contentType,
                spectrumBandsPerOctave: spectrumBandsPerOctave,
                reanalyzeBusy: isReanalyzeBusy(),
                latestSpectrogram: latestSpectrogram,
                axisLabels: {
                    spectrumOverlay: overlaySpectrumAxisLabels(visibleSlices, spectrumView.state()),
                    spectrogramPerTrack: spectrogramPerTrack,
                    spectrumPerTrack: spectrumPerTrack,
                    waveformPerTrack: waveformPerTrack,
                },
                displayOrder: trackStore.displayOrder.slice(),
                specFreqStart: spectrumView.freqStart,
                specFreqEnd: spectrumView.freqEnd,
                trackHeight: trackHeight,
                spectrumOverlayHeight: spectrumOverlayHeight,
                waveformMode: waveformMode,
                lastAnnounce: (function () {
                    var el = document.getElementById('a11y-announce');
                    return el ? (el.textContent || '') : '';
                })(),
                tracks: trackInfo,
                entry: entryScreen.snapshot(),
                comparison: stageMode?.snapshot() ?? null,
                ...shellSnapshot(document, audioFader.contextState()),
                lastPlayRejection,
            }, actionId);
    }
    function publishTestSnapshotSafe(actionId?: string) {
        try {
            publishTestSnapshot(actionId);
        }
        catch (e) {
            testBridge.publish({
                    ...domSnapshotBase(document),
                    zoomStart: waveformView.start,
                    zoomEnd: waveformView.end,
                    cursorNorm: cursorNorm,
                    visibleSpectrumTrackCount: 0,
                    contentType: contentType,
                    reanalyzeBusy: isReanalyzeBusy(),
                    axisLabels: { spectrumOverlay: [], spectrogramPerTrack: [], spectrumPerTrack: [], waveformPerTrack: [] },
                    displayOrder: trackStore.displayOrder.slice(),
                    specFreqStart: spectrumView.freqStart,
                    specFreqEnd: spectrumView.freqEnd,
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
    // A host with nothing listed yet shows its own start prompt where the tracks will appear.
    function selectionEmptyText() {
        return listedCount || !vscode.emptyMessage ? STR.emptyNoTracks : vscode.emptyMessage;
    }
    function buildDirectorySelectionLayout(resultsPaneHtml = buildResultsPane(selectionEmptyText())) {
        const warning = pythonEnvironmentState.status === 'warning';
        return selectionLayoutHtml({
            rootPath: rootLabel,
            isEmpty: !listedCount,
            sidebarCollapsed,
            resultsPaneHtml,
            python: hasPythonEnvironmentPicker ? {
                text: buildPythonButtonText(pythonEnvironmentState.pythonCommand, warning),
                tooltip: buildPythonTooltip(pythonEnvironmentState.pythonCommand, pythonEnvironmentState.tooltip),
                warning,
            } : undefined,
        }, STR);
    }
    /**
     * The host's sources: the entry table in the side panel lists them; the tracks shown are chosen there. A folder
     * opened starts with no tracks; files listed beside the current ones (added, dropped) keep the tracks shown.
     */
    function showDirectorySelection(rootPath: string, filePaths: string[], label = rootPath, newFolder = true) {
        state.rootPath = rootPath;
        rootLabel = label;
        if (newFolder) clearSelectedFilePaths();
        listedCount = filePaths.length;
        const emptyMessage = function (text: string) {
            const el = document.querySelector('#empty-state p');
            if (el) {
                el.textContent = text;
            }
        };
        const folderButton = requiredElementById(document, 'selection-toolbar').querySelector<HTMLElement>('[data-action="open-folder"]')!;
        const folder = selectionFolderButton(Boolean(rootLabel) || listedCount > 0, STR);
        folderButton.textContent = folder.text;
        setHint(folderButton, folder.hint);
        requiredElementById(document, 'directory-selection-layout').classList.toggle('is-empty', !listedCount);
        emptyMessage(selectionEmptyText());
        syncSelectionSummary();
        scheduleRender();
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
            spectrumBandsPerOctave,
            spectrumCollapsed,
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
            appVersion,
            linkScales: scalesLinked,
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
            metricSummaryHtml: channelMetricSummaryHtml(channels[channelIndex], STR.peakLabel),
            fileName: result.fileName,
            axisWidth: AXIS_W,
            spectrumTitle: STR.trackSpectrumTitle,
            axisHint: trackAxisHint(),
            spectrogramAxisHint: STR.hintSpectrogramFrequencyAxis + ' / ' + STR.hintWheelGestures,
            splitHint: STR.hintTrackSplit,
            splitLabel: STR.trackSplitLabel,
            spectrumHint: STR.trackSpectrumTitle + ' / ' + STR.hintSpectrumKeys,
            referenceButtonHtml: channels.length > 1 ? referenceButtonHtml(trackId, channelIndex, STR) : undefined,
        });
    }
    function trackAxisHint(): string {
        return STR.hintWaveformAmplitudeAxis + ' / ' + STR.hintWheelGestures;
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
            referenceButtonHtml: channelsForResult(result).length === 1 ? referenceButtonHtml(trackId, 0, STR) : undefined,
        }, STR);
    }
    // ── Rendering ──
    function renderAll() {
        playWhenReady();
        pairPanel.sync();
        updateUiSmokeSpectrumState();
        resizeAllCanvases();
        renderRuler();
        renderStackedTracks();
        updateVisibility();
        updateOffsetDisplays();
        updateUiSmokeWaveformState();
        if (contentType !== 'stage') {
            scheduleRangeRequests();
        }
    }
    function resizeAllCanvases() {
        state.results.forEach(function (result: ComparisonTrackState, i: number) {
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const canvas = canvasById(document, trackCanvasId(i, channelIndex));
                if (!canvas) {
                    return;
                }
                const wrap = document.getElementById(trackCanvasWrapId(i, channelIndex));
                if (!wrap) {
                    return;
                }
                const newW = wrap.clientWidth || 800;
                const heights = laneHeights();
                const cacheKey = newW + 'x' + heights.wave + 'x' + heights.spec + 'x' + channelIndex;
                const cacheIdx = i + ':' + channelIndex;
                if (canvasWidthCache[cacheIdx] === cacheKey) {
                    return;
                }
                canvasWidthCache[cacheIdx] = cacheKey;
                // Outside the steps view the waveform stops where the spectrogram's colour bar starts.
                const waveW = contentType === 'stage' ? newW - AXIS_W : spectrogramPlotWidth(newW - AXIS_W);
                syncCanvasSize(canvas, waveW, heights.wave);
                const axisCanvas = canvasById(document, trackAxisCanvasId(i, channelIndex));
                if (axisCanvas) {
                    syncCanvasSize(axisCanvas, AXIS_W, heights.wave);
                }
                if (heights.spec > 0) {
                    [trackSpecCanvasId(i, channelIndex), trackSpectrogramOverlayCanvasId(i, channelIndex)].forEach(function (id) {
                        const c = canvasById(document, id);
                        if (c) syncCanvasSize(c, newW - AXIS_W, heights.spec);
                    });
                    const specAxis = canvasById(document, trackSpecAxisCanvasId(i, channelIndex));
                    if (specAxis) syncCanvasSize(specAxis, AXIS_W, heights.spec);
                    // A resize clears the bitmap; a lane out of view is not repainted now, so its raster must not
                    // look current when it is drawn again at the same size.
                    const record = trackRecordAtIndex(i);
                    if (record) spectrogramRasterCache.delete(record.id + ':' + channelIndex);
                }
            });
        });
        const rulerCanvas = canvasById(document, 'ruler-canvas');
        if (rulerCanvas) {
            const row = document.getElementById('ruler-row');
            if (row) {
                syncCanvasSize(rulerCanvas, row.clientWidth - TRACK_HEADER_W - AXIS_W, 20);
            }
        }
    }
    function renderRuler() {
        const canvas = canvasById(document, 'ruler-canvas');
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) {
            return;
        }
        const W = canvas.width;
        // The ticks follow the lanes' time span: the waveform's width, which ends at the spectrogram's colour bar.
        const lane = canvasesMatching(document, '.track-canvas:not(.track-spec-canvas)').find(function (c) { return c.width > 1 && c.offsetParent !== null; });
        const timeW = lane ? Math.min(W, lane.width) : spectrogramPlotWidth(W);
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const gs = trackStore.globalSpan();
        const visStart = gs.startSec + waveformView.start * gs.spanSec;
        const visEnd = gs.startSec + waveformView.end * gs.spanSec;
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#888';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        rulerTicks(visStart, visEnd, timeW).forEach(function (tick) {
            ctx.fillText(tick.label, tick.x + 2, H - 4);
        });
    }
    function renderStackedTracks() {
        linkedScaleMemo = null;
        const tracksWrapperEl = document.getElementById('tracks-wrapper');
        if (tracksWrapperEl && stageMode && !tracksWrapperEl.contains(stageMode.root)) tracksWrapperEl.prepend(stageMode.root);
        const ruler = document.getElementById('ruler-row');
        if (ruler) ruler.style.display = contentType === 'stage' ? 'none' : '';
        if (contentType === 'stage') {
            // The lanes draw the chosen step's Frames; their spectrograms are hidden (CSS).
            stageMode?.paint();
            return;
        }
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
                channelsForResult(result).forEach(function (_, channelIndex: number) {                    [trackCanvasId(i, channelIndex), trackSpecCanvasId(i, channelIndex)].forEach(function (id) {
                        const canvas = canvasById(document, id);
                        canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
                    });
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
            if (!laneInView(i)) {
                return;
            }
            const color = trackColor(i);
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const canvas = canvasById(document, trackCanvasId(i, channelIndex));
                if (!canvas) {
                    return;
                }
                const axisC = canvasById(document, trackAxisCanvasId(i, channelIndex));
                axisC?.getContext('2d')?.clearRect(0, 0, axisC.width, axisC.height);
                drawTrackWaveform(canvas, result, i, channelIndex, trackRuntimeAt(i).offsetSeconds, color);
                const specCanvas = canvasById(document, trackSpecCanvasId(i, channelIndex));
                if (specCanvas) {
                    drawSpectrogram(specCanvas, result, i, channelIndex, trackRuntimeAt(i).offsetSeconds);
                }
            });
        });
    }
    function resolveWaveformSource(result: ComparisonTrackState, trackIndex: number, channelIndex: number, offsetSeconds: number) {
        const fileView = computeTrackFileView(result, trackIndex, offsetSeconds);
        const ch = channelsForResult(result)[channelIndex];
        const fullWaveform = ch && ch.waveform ? ch.waveform : null;
        const amplitudeScale = fullWaveform ? amplitudeScaleFor(ch) : undefined;
        const c = trackRecordAtIndex(trackIndex)?.rangeCache ?? null;
        const cachedChannel = c && c.channels ? c.channels[channelIndex] : null;
        const canvas = canvasById(document, trackCanvasId(trackIndex, channelIndex));
        const W = (canvas ? canvas.width : 0) || 800;
        if (c && cachedChannel && !overviewIsSufficient(result, W, fileView) &&
            rangeCacheCoversView(c, channelIndex, fileView.fileAtZoomStart, fileView.fileAtZoomEnd)) {
            return { waveform: cachedChannel, dataStart: c.startNorm, dataEnd: c.endNorm, amplitudeScale: amplitudeScale };
        }
        return fullWaveform
            ? { waveform: fullWaveform, dataStart: 0, dataEnd: 1, amplitudeScale: amplitudeScale }
            : null;
    }
    function drawTrackWaveform(canvas: HTMLCanvasElement, result: ComparisonTrackState, trackIndex: number, channelIndex: number, offsetSeconds: number, color: string, options: WaveformDrawOptions = {}): void {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        const W = canvas.width, H = canvas.height;
        const shouldClear = !options || options.clear !== false;
        const shouldDrawCursor = !options || options.drawCursor !== false;
        if (shouldClear) {
            ctx.clearRect(0, 0, W, H);
        }
        const src = resolveWaveformSource(result, trackIndex, channelIndex, offsetSeconds);
        const record = trackRecordAtIndex(trackIndex);
        const placement = trackTimelinePlacement(offsetSeconds, result.durationSeconds, trackStore.globalSpan());
        const amplitudeZoomed = waveformView.isAmplitudeZoomed();
        const coverage = paintTrackWaveform(ctx, W, H, color, src, {
            zoomStart: waveformView.start,
            zoomEnd: waveformView.end,
            offsetNorm: placement.offsetNorm,
            trackDurRatio: placement.trackDurRatio,
            amplitudeMinNorm: amplitudeZoomed ? waveformView.amplitudeMin : undefined,
            amplitudeMaxNorm: amplitudeZoomed ? waveformView.amplitudeMax : undefined,
        }, window.renderWaveformPipeline);
        if (record) {
            record.waveformCoverage = coverage;
        }
        if (shouldDrawCursor) {
            drawLoopRegionOnCanvas(ctx, W, H);
            drawAnalysisWindowOnCanvas(ctx, W, H, trackIndex, channelIndex);
            drawCursorOnCanvas(ctx, W, H);
            drawHoverLineOnCanvas(ctx, W, H);
            drawRectZoomSelectionOnCanvas(ctx, W, H, trackIndex);
        }
        const axisCanvas = canvasById(document, trackAxisCanvasId(trackIndex, channelIndex));
        if (axisCanvas) {
            const axisCtx = axisCanvas.getContext('2d');
            if (axisCtx) {
                drawWaveformAmplitudeAxis(axisCtx, AXIS_W, H, waveformAxisLabelsForChannel(result, channelIndex), drawTheme());
            }
        }
    }
    function drawSpectrogram(canvas: HTMLCanvasElement, result: ComparisonTrackState, trackIndex: number, channelIndex: number, offsetSeconds: number) {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        const W = canvas.width;
        const H = canvas.height;
        const overlayCanvas = canvasById(document, trackSpectrogramOverlayCanvasId(trackIndex, channelIndex));
        const overlayCtx = overlayCanvas ? overlayCanvas.getContext('2d') : null;
        if (overlayCtx && overlayCanvas) {
            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
        const axisCanvas = canvasById(document, trackSpecAxisCanvasId(trackIndex, channelIndex));
        const axisCtx = axisCanvas ? axisCanvas.getContext('2d') : null;
        if (axisCanvas && axisCtx) {
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
        const { dbLo, dbHi, maxFrequencyHz: maxFreq, minFrequencyHz: minFreq } = spectrogramDisplayBounds(spec, __spectrogramSettings.display, spectrogramAutoBounds(spec));
        const plotW = spectrogramPlotWidth(W);
        const cacheId = trackRecordAtIndex(trackIndex)!.id + ':' + channelIndex;
        spectrogramRasterCache.set(cacheId, paintTrackSpectrogram(ctx, W, H, spec, {
            zoomStart: waveformView.start, zoomEnd: waveformView.end, trackStart, trackDurRatio, dbLo, dbHi, maxFrequencyHz: maxFreq, minFrequencyHz: minFreq,
            durationSec: result.durationSeconds,
        }, spectrogramRasterCache.get(cacheId), drawTheme()));
        if (axisCanvas && axisCtx) {
            drawSpectrogramFrequencyAxis(axisCtx, axisCanvas.width, axisCanvas.height, spec, { maxFreq: maxFreq, minFreq: minFreq, label: STR.axisFrequency }, drawTheme());
        }
        if (overlayCtx) {
            drawLoopRegionOnCanvas(overlayCtx, plotW, H);
            drawCursorOnCanvas(overlayCtx, plotW, H);
            drawHoverLineOnCanvas(overlayCtx, plotW, H);
        }
    }

    type CanvasHitTarget = Pick<Element, 'getBoundingClientRect'> & { width: number; classList?: DOMTokenList };
    /** The spectrogram canvas ends in its colour bar; the waveform's own width is already its time span. */
    function trackCanvasTimeHit(canvas: CanvasHitTarget, clientX: number) {
        const timeWidth = canvas.classList?.contains('track-spec-canvas') ? spectrogramPlotWidth(canvas.width) : canvas.width;
        return canvasTimeHit(canvas.getBoundingClientRect().left, clientX, timeWidth, waveformView.timeRange());
    }
    function clampedTrackCanvasNorm(canvas: Pick<Element, 'getBoundingClientRect'>, clientX: number, timeWidth: number) {
        return clampedCanvasNorm(canvas.getBoundingClientRect().left, clientX, timeWidth, waveformView.timeRange());
    }
    /** The span behind the spectrum currently shown for this track, in global timeline norms; null when that spectrum is not a backend slice. */
    function analysisWindowBand(trackIndex: number, channelIndex: number): AnalysisWindowBand | null {
        const result = state.results[trackIndex];
        const record = trackRecordAtIndex(trackIndex);
        const localNorm = trackLocalCursorNorm(trackIndex, spectrumCursorNorm);
        // At the exact track end the spectrum is a synthetic silent slice, not a backend transform.
        if (!result || !record || record.runtime.hidden || localNorm === null || localNorm >= 1) {
            return null;
        }
        const slice = record.spectrumSliceCache.get(channelIndex) ?? record.spectrumSliceCache.get(0);
        if (!slice || slice.settingsSignature !== currentSpectrumDataSignature()
            || slice.windowStartNorm === undefined || slice.windowEndNorm === undefined) {
            return null;
        }
        const placement = trackTimelinePlacement(trackRuntimeAt(trackIndex).offsetSeconds, result.durationSeconds, trackStore.globalSpan());
        return {
            startNorm: placement.offsetNorm + slice.windowStartNorm * placement.trackDurRatio,
            endNorm: placement.offsetNorm + slice.windowEndNorm * placement.trackDurRatio,
            window: slice.window,
        };
    }
    function drawAnalysisWindowOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number, trackIndex: number, channelIndex: number) {
        if (isPlaybackRunning()) {
            return;
        }
        const band = analysisWindowBand(trackIndex, channelIndex);
        if (band) {
            drawAnalysisWindowBand(ctx, band, waveformView.timeRange(), W, H);
        }
    }
    function drawCursorOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        drawDashedTimeLine(ctx, cursorNorm, waveformView.timeRange(), W, H, CURSOR_LINE_STYLE);
    }
    function drawHoverLineOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        if (hoverNorm !== null) {
            drawDashedTimeLine(ctx, hoverNorm, waveformView.timeRange(), W, H, HOVER_LINE_STYLE);
        }
    }
    function drawLoopRegionOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        if (!loopRegion) {
            return;
        }
        if (typeof window.paintLoopRegion === 'function') {
            window.paintLoopRegion(ctx, W, H, loopRegion.start, loopRegion.end, waveformView.start, waveformView.end);
        }
    }
    function drawRectZoomSelectionOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number, trackIndex: number) {
        if (rectZoomSelection && rectZoomSelection.trackId === trackIdAtIndex(trackIndex)) {
            drawRectZoomSelection(ctx, rectZoomSelection, waveformView.timeRange(), waveformView.amplitudeViewport(), W, H);
        }
    }
    function updateVisibility() {
        // まず各行の display を更新する
        document.querySelectorAll<HTMLElement>('.track-row').forEach(function (row) {
            const trackId = trackIdFromElement(row);
            if (trackId) {
                var isMuted = trackStore.require(trackId).runtime.hidden;
                row.style.display = isMuted ? 'none' : 'flex';
            }
        });
        // 次に空状態を判定する（削除済み or 全非表示）
        const emptyState = document.getElementById('empty-state');
        if (emptyState) {
            const rows = Array.from(document.querySelectorAll<HTMLElement>('.track-row'));
            const visibleRows = rows.filter(function (row) {
                return row.style.display !== 'none';
            });
            emptyState.classList.toggle('is-visible', visibleRows.length === 0);
            const message = emptyState.querySelector('p');
            if (message && !isSelectionMode && message.textContent !== STR.emptyAllExcluded) {
                message.textContent = STR.emptyAllExcluded;
            }
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
            // A shifted track keeps its offset in sight; at 0 the row is out of the way.
            el.closest('.track-row')?.classList.toggle('is-shifted', off !== 0);
        });
    }
    function getTrackAudio(idx: number) {
        return audioById(document, 'track-audio-' + idx);
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
    function updatePlaybackButtons() {
        state.results.forEach(function (_, i: number) {
            const trackId = trackIdAtIndex(i);
            if (!trackId) {
                return;
            }
            const playBtn = buttonMatching(document, '[data-action="toggle-playback"][data-track-id="' + trackId + '"]');
            const stopBtn = buttonMatching(document, '[data-action="stop-playback"][data-track-id="' + trackId + '"]');
            const isActive = playbackTrackId === trackId && playbackEl !== null;
            const isPlaying = isActive && isPlaybackRunning();
            if (playBtn) {
                playBtn.textContent = isPlaying ? '⏸' : '▶';
                playBtn.classList.toggle('is-playing', !!isPlaying);
            }
            if (stopBtn) {
                stopBtn.disabled = !isActive;
            }
        });
        // The entry table's row ▶ turns to ■ on the file playing.
        const playing = playingPath();
        if (playing !== entryPlaying) {
            entryPlaying = playing;
            entryScreen.tracksChanged();
        }
    }
    function playingPath(): string | null {
        if (playbackTrackId === null || !playbackEl || !isPlaybackRunning()) return null;
        return trackStore.require(playbackTrackId).result.filePath ?? null;
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
        el.textContent = loopRegionClockText(loopRegion, trackStore.globalSpan());
        el.style.display = 'inline';
    }
    function isPlaybackRunning(): boolean {
        return playbackEl !== null && !playbackEl.paused && !audioFader.isPausing(playbackEl);
    }
    function clearPlaybackState() {
        if (playbackEl) {
            pauseSmoothly(playbackEl);
        }
        playbackEl = null;
        playbackTrackId = null;
        stopPlaybackLoop();
        updatePlaybackButtons();
        updateLoopBadge();
        updatePlaybackDisplay(null);
        scheduleRender();
    }
    function startPlaybackLoop() {
        if (playbackRafId !== null) {
            return;
        }
        function tick() {
            const playbackTrackIndex = playbackTrackId ? trackStore.protocolIndexForId(playbackTrackId) : null;
            if (playbackEl && playbackTrackIndex !== null && !playbackEl.paused && !audioFader.isPausing(playbackEl)) {
                const mapping = getTrackTimeMapping(playbackTrackIndex);
                const loopStartTime = loopRestartTime(mapping, playbackEl.currentTime, loopRegion);
                if (loopStartTime !== null) {
                    const fadeInSeconds = passFadeSeconds(mapping, loopStartTime, loopRegion, playbackDuration(playbackTrackIndex));
                    passFade = fadeInSeconds;
                    endFadeTarget = null;
                    try {
                        playbackEl.currentTime = loopStartTime;
                        fadeInOnceSeeked(playbackEl, fadeInSeconds);
                        invalidateDesiredSpectrumSliceRequests();
                    }
                    catch (_err) {
                        audioFader.fadeTo(playbackEl, 1, fadeInSeconds);
                    }
                }
                else {
                    fadeBeforePlaybackEnd(playbackEl, playbackTrackIndex);
                }
                const nextCursor = globalNormFromTrackTime(playbackTrackIndex, playbackEl.currentTime);
                if (nextCursor !== null) {
                    if (followCursor) {
                        waveformView.centerOn(nextCursor);
                    }
                    moveCursor(nextCursor, true);
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
    function playbackDuration(idx: number): number {
        return (playbackEl && playbackEl.duration) || state.results[idx]?.durationSeconds || 0;
    }
    function pauseSmoothly(audio: HTMLAudioElement, after?: () => void): void {
        const idx = audio === playbackEl && playbackTrackId ? trackStore.protocolIndexForId(playbackTrackId) : null;
        const fade = idx === null ? null : playbackEndFade(getTrackTimeMapping(idx), audio.currentTime, loopRegion, playbackDuration(idx));
        // Never fade past the point where the track ends or the loop jumps back.
        audioFader.pauseSmoothly(audio, after, fade ? Math.max(0, Math.min(FADE_SECONDS, fade.remaining)) : FADE_SECONDS);
    }
    function fadeInOnceSeeked(audio: HTMLAudioElement, seconds: number): void {
        // The seek takes effect asynchronously; fading in before it lands would let the old position through.
        audio.addEventListener('seeked', function () {
            if (playbackEl === audio && !audioFader.isPausing(audio)) {
                audioFader.fadeTo(audio, 1, seconds);
                endFadeTarget = null;
            }
        }, { once: true });
    }
    function fadeBeforePlaybackEnd(audio: HTMLAudioElement, idx: number): void {
        const fade = playbackEndFade(getTrackTimeMapping(idx), audio.currentTime, loopRegion, playbackDuration(idx));
        if (!fade) {
            return;
        }
        const endTime = audio.currentTime + fade.remaining;
        if (endFadeTarget !== null && Math.abs(endFadeTarget - endTime) <= 1e-3) {
            return;
        }
        const fadeSeconds = Math.min(fade.fadeSeconds, passFade);
        if (endFadeTarget !== null && fade.remaining > fadeSeconds) {
            audioFader.fadeTo(audio, 1, fadeSeconds);
            endFadeTarget = null;
        }
        if (fade.remaining > fadeSeconds + END_FADE_LOOKAHEAD_SECONDS) {
            return;
        }
        // Queued on the audio clock so a late animation frame cannot skip the fade.
        audioFader.fadeTo(audio, 0, Math.max(0, Math.min(fadeSeconds, fade.remaining)), Math.max(0, fade.remaining - fadeSeconds));
        endFadeTarget = endTime;
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
            pauseSmoothly(audio, function () {
                try {
                    audio.currentTime = 0;
                }
                catch (_err) { }
            });
        }
        if (trackId === playbackTrackId) {
            if (!options || options.keepCursor !== true) moveCursor(playbackStartNorm);
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
        if (playbackTrackId === trackId && playbackEl === audio && !audio.paused && !audioFader.isPausing(audio)) {
            pauseSmoothly(audio, function () {
                // Playback runs on through the fade-out, so resume from where it actually stopped.
                const pausedCursor = playbackEl === audio && audio.paused ? globalNormFromTrackTime(idx, audio.currentTime) : null;
                if (pausedCursor !== null) {
                    moveCursor(pausedCursor);
                    scheduleRender();
                }
            });
            invalidateDesiredSpectrumSliceRequests();
            updatePlaybackButtons();
            stopPlaybackLoop();
            scheduleSpectrumRefresh('immediate');
            return;
        }
        if (playbackTrackId !== null && playbackTrackId !== trackId) {
            // 再生開始位置にカーソルを戻してからトラックを切り替え
            moveCursor(playbackStartNorm);
            stopPlayback(playbackTrackId, { keepCursor: true });
        }
        if (playbackTrackId === trackId && playbackEl === audio && audioFader.isPausing(audio)) {
            // Still playing through the pause fade-out: turn the fade around instead of seeking or zeroing the gain.
            endFadeTarget = null;
            audioFader.fadeTo(audio, 1, passFadeSeconds(getTrackTimeMapping(idx), audio.currentTime, loopRegion, playbackDuration(idx)));
            invalidateDesiredSpectrumSliceRequests();
            updatePlaybackButtons();
            startPlaybackLoop();
            scheduleSpectrumRefresh('immediate');
            return;
        }
        playbackTrackId = trackId;
        playbackEl = audio;
        invalidateDesiredSpectrumSliceRequests();
        const durationSeconds = audio.duration || state.results[idx].durationSeconds || 0;
        const startNorm = loopRegion ? loopRegion.start : cursorNorm;
        const startTime = playbackStartTime(getTrackTimeMapping(idx), startNorm, durationSeconds);
        try {
            audio.currentTime = startTime;
        }
        catch (_err) { }
        playbackStartNorm = startNorm;
        audioFader.prepare(audio);
        audioFader.fadeTo(audio, 0, 0);
        endFadeTarget = null;
        const fadeInSeconds = passFadeSeconds(getTrackTimeMapping(idx), startTime, loopRegion, durationSeconds);
        passFade = fadeInSeconds;
        const fadeIn = function () {
            if (playbackEl === audio && !audioFader.isPausing(audio)) {
                audioFader.fadeTo(audio, 1, fadeInSeconds);
                endFadeTarget = null;
            }
        };
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
            playPromise.then(fadeIn, function (err: unknown) {
                lastPlayRejection = err instanceof Error ? err.name + ': ' + err.message : String(err);
                clearPlaybackState();
            });
        }
        else {
            fadeIn();
        }
        const nextCursor = globalNormFromTrackTime(idx, audio.currentTime);
        if (nextCursor !== null) moveCursor(nextCursor);
        updatePlaybackButtons();
        startPlaybackLoop();
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
    }
    function finishPlaybackAtEnd(trackIndex: number, trackId: TrackId): void {
        const endNorm = globalNormFromTrackTime(trackIndex, state.results[trackIndex].durationSeconds || 0);
        if (endNorm !== null) moveCursor(endNorm);
        stopPlayback(trackId, { keepCursor: true });
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
            audio.addEventListener('playing', function () {
                // A stall lets the queued end fade run ahead of the media; restore the gain and queue it again.
                if (playbackEl === audio && endFadeTarget !== null && !audioFader.isPausing(audio)) {
                    audioFader.fadeTo(audio, 1, passFade);
                    endFadeTarget = null;
                }
            });
            attachTrackAudioListeners(audio, trackId, {
                isCurrent: (id) => playbackTrackId === id,
                onPlay(el, id) {
                    playbackEl = el;
                    playbackTrackId = id;
                    updatePlaybackButtons();
                    startPlaybackLoop();
                },
                onPause(id, ended) {
                    invalidateDesiredSpectrumSliceRequests();
                    updatePlaybackButtons();
                    if (ended) {
                        // 'pause' fires before 'ended' and this clears the current track, so onEnded never runs after it.
                        finishPlaybackAtEnd(i, id);
                    }
                },
                onEnded(id) {
                    finishPlaybackAtEnd(i, id);
                },
                onError() {
                    invalidateDesiredSpectrumSliceRequests();
                    clearPlaybackState();
                },
            });
        });
    }
    // ── Events ──
    function attachEvents() {
        if (isSelectionMode) {
            attachDirectorySelectionEvents();
        }
        const tracksWrapper = requiredElementById(document, 'tracks-wrapper');
        // Lanes scrolled into view are drawn then.
        tracksWrapper.addEventListener('scroll', function () { scheduleRender(); }, { passive: true });
        const toolbarHandlers = { onAction: handleToolbarAction };
        attachToolbarActions(document.getElementById('toolbar'), toolbarHandlers);
        attachToolbarActions(document.getElementById('spectrum-zoom-toolbar'), toolbarHandlers);
        attachToolbarActions(document.getElementById('spectrum-section-header'), toolbarHandlers);
        document.getElementById('spectrum-section-header')?.addEventListener('click', function (e) {
            const target = eventTarget(e);
            if (spectrumCollapsed && !(target && typeof target.closest === 'function' && target.closest('[data-action]'))) {
                setSpectrumCollapsed(false);
            }
        });
        syncSpectrumHeaderHint();
        document.addEventListener('keydown', function (e) {
            // A text field (the offset editor) uses Esc to cancel its own edit.
            if (e.key === 'Escape' && spectrumMaximized && !hasOpenOverlay() && !isTextEntryTag(eventTarget(e)?.tagName)) {
                setSpectrumMaximized(false);
            }
        }, true);
        // Double-clicking a panel's resize edge folds it, the shortcut for its toggle button.
        document.addEventListener('dblclick', function (e) {
            const target = eventTarget(e);
            if (!target || typeof target.closest !== 'function') {
                return;
            }
            if (target.closest('[data-action="spectrum-height-drag"]')) {
                setSpectrumCollapsed(!spectrumCollapsed);
            }
            else if (target.closest('#tree-resizer')) {
                setSidebarCollapsed(true);
            }
        });
        attachExclusiveMenus(document.getElementById('toolbar'));
        attachHeightResizeListeners(
            heightResize,
            [tracksWrapper, document.getElementById('spectrum-section')],
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
                navigator.clipboard.writeText(loopRegionClockText(loopRegion, trackStore.globalSpan())).catch(function () { });
            });
        }
        attachTrackLaneActions(tracksWrapper, {
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
                if (audio) audioFader.setMuted(audio, runtime.muted);
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
            // "Type a value": the offset's field opens in place, shown even at 0.
            'offset-edit': ({ trackIndex }) => {
                const value = trackIndex === null ? null : document.getElementById('offset-val-' + trackIndex);
                if (!value) return;
                value.closest('.track-row')?.classList.add('is-shifted');
                value.click();
            },
            'offset-reset': ({ trackIndex }) => {
                if (trackIndex !== null) setTrackOffset(trackIndex, 0);
            },
            'set-pair-reference': ({ trackId, target }) => {
                const channelIndex = Number(target.getAttribute('data-channel-index'));
                if (Number.isInteger(channelIndex)) {
                    pairPanel.toggleReference(trackId, channelIndex);
                    // Its result (transfer function, phase, γ²) is drawn in the dock: a folded dock opens.
                    if (spectrumCollapsed) setSpectrumCollapsed(false);
                }
            },
        });
        attachOffsetEditing(tracksWrapper, document, { placeholder: STR.offsetEditPlaceholder, ariaLabel: STR.offsetEditAriaLabel }, {
            trackIndexFromElement,
            currentOffsetMs: (idx) => Math.round(trackRuntimeAt(idx).offsetSeconds * 1000),
            onReset: idx => setTrackOffset(idx, 0),
            onEdited(idx, offsetMs) {
                setTrackOffset(idx, offsetMs === null ? trackRuntimeAt(idx).offsetSeconds : offsetMs / 1000);
            },
        });
        // In the steps mode the lanes answer the shared plot gestures (trackStageMode.ts), not the time axis's.
        const timeAxis = <A extends unknown[]>(handler: (...args: A) => void) => (...args: A): void => { if (contentType !== 'stage') handler(...args); };
        attachTrackPointerListeners(tracksWrapper, document, {
            resetZoom: timeAxis(resetZoom),
            openAxisRange: (axis, clientX, clientY) => contentType !== 'stage' && openTrackAxisRange(axis, clientX, clientY),
            hover: timeAxis(handleCanvasMouseMove),
            clearHover: timeAxis(clearHover),
            press: timeAxis(handleCanvasMouseDown),
            drag: timeAxis(handleDocMouseMove),
            release: timeAxis(handleDocMouseUp),
            zoomWheel: timeAxis(handleZoomWheel),
            panWheel: timeAxis(handlePanWheel),
        });
        // The split between a lane's waveform and spectrogram: one share for every lane, kept across sessions.
        let splitDrag: { startY: number; startShare: number } | null = null;
        tracksWrapper.addEventListener('mousedown', function (e) {
            const target = eventTarget(e);
            if (e.button !== 0 || !target || typeof target.closest !== 'function' || !target.closest('.track-split')) return;
            splitDrag = { startY: e.clientY, startShare: waveShare };
            document.body.classList.add('is-split-resizing');
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
            if (!splitDrag) return;
            const next = Math.min(WAVE_SHARE_MAX, Math.max(WAVE_SHARE_MIN, splitDrag.startShare + (e.clientY - splitDrag.startY) / trackHeight));
            if (next === waveShare) return;
            waveShare = next;
            Object.keys(canvasWidthCache).forEach(function (key) { delete canvasWidthCache[key]; });
            scheduleRender();
        });
        document.addEventListener('mouseup', function () {
            if (!splitDrag) return;
            splitDrag = null;
            document.body.classList.remove('is-split-resizing');
            persistWebviewState({ waveShare });
        });
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
        const layoutElementIds = ['tracks-wrapper', 'ruler-row', 'spectrum-overlay-wrap', 'pair-spectrum-plot'];
        state.results.forEach(function (result: ComparisonTrackState, i: number) {
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                layoutElementIds.push(trackCanvasWrapId(i, channelIndex), trackSpectrumWrapId(i, channelIndex));
            });
        });
        installLayoutResizeHandling(window, document, layoutElementIds, function () {
            // A shrinking window takes its height from the tracks first, so give them back their strip.
            if (!spectrumCollapsed && !spectrumMaximized && spectrumOverlayHeight > spectrumHeightLimit()) {
                setSpectrumHeight(spectrumOverlayHeight);
            }
            scheduleRender();
            scheduleSpectrumRefresh('interactive');
        }, typeof ResizeObserver === 'function' ? ResizeObserver : undefined);
        attachAudioEvents();
        updatePlaybackButtons();
        function attachTrackCanvasFocusEvents() {
            document.querySelectorAll<HTMLElement>('.track-canvas').forEach(function (canvas) {
                attachCanvasFocusHint(canvas, hintFooter, STR.cursorHelpKeys);
            });
        }
        attachGlobalKeyboardListeners(document, {
            helpOverlay: () => document.getElementById('help-overlay'),
            spectrumHasMouse: () => spectrumHover.hasMouse,
            stepSpectrum(delta) {
                moveSpectrumHoverByBin(delta);
                scheduleSpectrumRefresh('hover');
            },
            runShortcut: handleToolbarAction,
            togglePlayback(target, active) {
                const trackId = target === 'focused-track'
                    ? active && trackIdFromElement(active)
                    : playbackTrackId ?? trackStore.activeIds()[0];
                if (trackId) {
                    togglePlayback(trackId);
                }
            },
            stepCursor(direction, shiftKey, active) {
                if (!active) {
                    return;
                }
                const step = arrowCursorStep(shiftKey, trackStore.globalSpan().spanSec, waveformView.start, waveformView.end, (active as HTMLCanvasElement).width || 800);
                moveCursor(cursorNorm + direction * step);
                scheduleRender();
            },
            arrowReleased: () => scheduleSpectrumRefresh('immediate'),
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
            const overlayCanvas = canvasById(document, 'spectrum-overlay-canvas');
            if (overlayCanvas) {
                // ドラッグ中はホバー不要
                attachSpectrumCursorListeners(overlayCanvas, spectrumCursor, OVERLAY_SPECTRUM_PAD, () => ({ trackIndex: -1, channelIndex: null }), () => specBoxDrag.active);
                attachSpectrumBoxDrag(overlayCanvas, document, specBoxDrag, {
                    onUpdate: () => scheduleSpectrumRefresh('hover'),
                    onFinish(drag) {
                        const zoom = spectrumBoxZoom(
                            drag.anchor,
                            drag.current,
                            overlayCanvas.width,
                            overlayCanvas.height,
                            { freqStart: spectrumView.freqStart, freqEnd: spectrumView.freqEnd },
                            spectrumView.paintedDb(),
                        );
                        if (zoom) {
                            spectrumView.applyBoxZoom(zoom);
                        }
                        scheduleSpectrumRefresh('immediate');
                    },
                });
                attachOverlaySpectrumDoubleClick(overlayCanvas, {
                    hasData: () => spectrumView.hasData(),
                    openRangePopup: openSpectrumRangePopup,
                    resetZoom: specZoomReset,
                });
                attachOverlaySpectrumHints(overlayCanvas, hintFooter, {
                    'db-axis': STR.hintSpectrumDbAxis,
                    'freq-axis': STR.hintSpectrumFreqAxis,
                    plot: STR.hintSpectrumPlot,
                });
                attachCanvasFocusHint(overlayCanvas, hintFooter, STR.hintSpectrumPlot);
            }
            pairPanel.attach();
            function attachTrackSpectrumCursorEvents() {
                canvasesMatching(document, '.track-spectrum-canvas').forEach(function (c) {
                    attachSpectrumCursorListeners(c, spectrumCursor, TRACK_SPECTRUM_PAD, () => ({
                        trackIndex: trackIndexFromElement(c),
                        channelIndex: channelIndexAttribute(c),
                    }));
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
        syncSelectionSummary();
        layout.addEventListener('click', function (event) {
            const action = eventTarget(event)?.getAttribute?.('data-action');
            if (action) {
                handleSelectionAction(action);
            }
        });
        // The side panel's edge widens the entry table in it; let go past 60 % of the window, the table is maximized
        // and the panel keeps the width it had.
        const resizer = document.getElementById('tree-resizer');
        const sidebar = document.getElementById('selection-sidebar');
        if (!resizer || !sidebar) {
            return;
        }
        let startX = 0, startWidth = 0, dragging = false;
        const move = function (event: MouseEvent) {
            if (dragging) sidebar.style.width = Math.max(160, Math.min(window.innerWidth - 80, startWidth + event.clientX - startX)) + 'px';
        };
        const up = function () {
            dragging = false;
            resizer.classList.remove('is-dragging');
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            if (sidebar.getBoundingClientRect().width > window.innerWidth * 0.6) {
                sidebar.style.width = startWidth + 'px';
                entryScreen.setMaximized(true);
            }
        };
        resizer.addEventListener('mousedown', function (event) {
            dragging = true;
            startX = event.clientX;
            startWidth = sidebar.getBoundingClientRect().width;
            resizer.classList.add('is-dragging');
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
            event.preventDefault();
        });
    }
    function handleSelectionAction(action: string) {
        if (action === 'open-file' || action === 'open-folder' || action === 'select-python-environment') {
            handleToolbarAction(action);
            return true;
        }
        if (action === 'toggle-selection-sidebar') {
            setSidebarCollapsed(!sidebarCollapsed);
            return true;
        }
        return false;
    }
    function hasSelectedFilePath(filePath: string) { return selection.has(filePath); }
    function addSelectedFilePath(filePath: string) { selection.add(filePath); }
    function removeSelectedFilePath(filePath: string) { selection.remove(filePath); }
    function clearSelectedFilePaths() { selection.clear(); }
    /** The folded side panel's rail counts the tracks shown out of the files listed. */
    function syncSelectionSummary() {
        const railCountEl = document.getElementById('selection-rail-count');
        if (railCountEl) {
            railCountEl.textContent = selectedFilePaths.length + '/' + listedCount;
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
            setHint(selectionButton, tooltip);
            selectionButton.classList.toggle('is-warning', !!isWarning);
        }
        if (toolbarButton) {
            toolbarButton.textContent = buttonText;
            setHint(toolbarButton, tooltip);
            toolbarButton.classList.toggle('is-warning', !!isWarning);
        }
    }
    function postSelectedFiles(clearAll = false) {
        const orderedSelection = allSelectableFilePaths.slice(0, 0);
        selectedFilePaths.forEach(function (filePath: string) {
            orderedSelection.push(filePath);
        });
        selectionMessageSeq += 1;
        messaging.post({
            type: 'analyze-selected-files',
            requestId: 'selection-' + runtimeSessionId + '-' + selectionMessageSeq,
            filePaths: orderedSelection,
            ...(clearAll ? { clearAll: true as const } : {}),
        });
    }
    /** The cursor spectrum's state before the steps view folded it (it belongs to the waveform view): restored on leaving. */
    let spectrumBeforeStage: boolean | null = null;
    function setContentType(next: 'waveform' | 'stage') {
        // The steps view takes the height for its plots, so both their axes stay in sight.
        if (next === 'stage' && contentType !== 'stage') {
            spectrumBeforeStage = spectrumCollapsed;
            if (!spectrumCollapsed) setSpectrumCollapsed(true);
        } else if (next !== 'stage' && contentType === 'stage' && spectrumBeforeStage !== null) {
            if (spectrumCollapsed !== spectrumBeforeStage) setSpectrumCollapsed(spectrumBeforeStage);
            spectrumBeforeStage = null;
        }
        contentType = next;
        stageMode?.setActive(next === 'stage');
        document.body.classList.toggle('is-stage-view', next === 'stage');
        Object.keys(canvasWidthCache).forEach(function (key) { delete canvasWidthCache[key]; });
        buttonMatching(document, '[data-action="content-waveform"]')?.classList.toggle('is-active', next === 'waveform');
        buttonMatching(document, '[data-action="content-stage"]')?.classList.toggle('is-active', next === 'stage');
        __updateSpecGearVisibility();
        scheduleRender();
    }
    /** The pair view only has an FFT axis, so the octave bands are off while it shows. */
    function syncSpectrumBandsAvailability(pairActive: boolean) {
        ([['spectrum-octave-1', STR.hintSpectrumOctave1], ['spectrum-octave-3', STR.hintSpectrumOctave3]] as const).forEach(function ([action, hint]) {
            const button = buttonMatching(document, '[data-action="' + action + '"]');
            if (button) {
                button.disabled = pairActive;
                setHint(button, pairActive ? STR.hintOctaveDisabledByPair : hint);
            }
        });
    }
    function setSpectrumBands(next: SpectrumBandsSetting) {
        if (next !== 0 && pairPanel.reference) {
            return;
        }
        if (next === spectrumBandsPerOctave) {
            return;
        }
        spectrumBandsPerOctave = next;
        persistWebviewState({ spectrumBandsPerOctave: next });
        ([['spectrum-fft', 0], ['spectrum-octave-1', 1], ['spectrum-octave-3', 3]] as const).forEach(function ([action, bands]) {
            const button = buttonMatching(document, '[data-action="' + action + '"]');
            button?.classList.toggle('is-active', bands === next);
            button?.setAttribute('aria-pressed', String(bands === next));
        });
        // A zoom on the linear FFT axis means a different range on the log band axis, so start from the whole range.
        spectrumView.reset();
        invalidateDesiredSpectrumSliceRequests();
        scheduleSpectrumRefresh('immediate');
    }
    function setSidebarCollapsed(next: boolean) {
        sidebarCollapsed = next;
        persistWebviewState({ sidebarCollapsed: next });
        const layout = document.getElementById('directory-selection-layout');
        layout?.classList.toggle('sidebar-collapsed', next);
        const button = layout?.querySelector<HTMLElement>('#selection-sidebar [data-action="toggle-selection-sidebar"]');
        if (button) {
            syncPanelToggle(button, 'sidebar', next, STR);
        }
    }
    function setSpectrumCollapsed(next: boolean) {
        if (next && spectrumMaximized) {
            setSpectrumMaximized(false);
        }
        spectrumCollapsed = next;
        persistWebviewState({ spectrumCollapsed: next });
        const section = document.getElementById('spectrum-section');
        section?.classList.toggle('is-collapsed', next);
        const button = section?.querySelector<HTMLElement>('[data-action="toggle-spectrum-panel"]');
        if (button) {
            syncPanelToggle(button, 'spectrum', next, STR);
        }
        syncSpectrumHeaderHint();
        if (!next) {
            scheduleSpectrumRefresh('immediate');
        }
    }
    function setSpectrumMaximized(next: boolean) {
        if (next && spectrumCollapsed) {
            setSpectrumCollapsed(false);
        }
        spectrumMaximized = next;
        const section = document.getElementById('spectrum-section');
        section?.classList.toggle('is-maximized', next);
        section?.parentElement?.classList.toggle('spectrum-maximized', next);
        const button = section?.querySelector<HTMLElement>('[data-action="toggle-spectrum-maximize"]');
        if (button) {
            syncSpectrumMaximize(button, next, STR);
        }
        // Leaving maximize puts back the height the user set before.
        syncSpectrumCanvasCssHeight();
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
    }
    // Esc restores a maximized spectrum unless it is closing a popover or the help first.
    function hasOpenOverlay() {
        return Array.from(document.querySelectorAll<HTMLElement>('#help-overlay, #spec-settings-popover, [id$="range-popover"]'))
            .some(function (el) { return !el.hidden && el.getClientRects().length > 0; });
    }
    // A folded spectrum is only its header, so the whole header is the way back.
    function syncSpectrumHeaderHint() {
        const header = document.getElementById('spectrum-section-header');
        if (!header) {
            return;
        }
        if (spectrumCollapsed) {
            setHint(header, STR.hintExpandSpectrum);
        }
        else {
            header.removeAttribute('data-hint');
            header.removeAttribute('aria-description');
        }
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
            'content-stage': () => setContentType('stage'),
            'zoom-in': zoomIn,
            'zoom-out': zoomOut,
            'zoom-reset': resetZoom,
            'spec-zoom-in': specZoomIn,
            'spec-zoom-out': specZoomOut,
            'spec-zoom-reset': specZoomReset,
            'spectrum-fft': () => setSpectrumBands(0),
            'spectrum-octave-1': () => setSpectrumBands(1),
            'spectrum-octave-3': () => setSpectrumBands(3),
            'toggle-spectrum-panel': () => setSpectrumCollapsed(!spectrumCollapsed),
            'toggle-spectrum-maximize': () => setSpectrumMaximized(!spectrumMaximized),
            'wave-mode-rect-zoom': () => {
                waveformMode = waveformMode === 'rect-zoom' ? 'loop' : 'rect-zoom';
                syncWaveformModeButton();
            },
            'toggle-follow-cursor': toggleFollowCursor,
            'link-scales': toggleLinkedScales,
            'zoom-to-selection': zoomToSelection,
            'run-recipe': () => messaging.post({ type: 'run-recipe' }),
            'save-recipe': saveRecipe,
            'export-png': exportPng,
            'export-csv': exportCsv,
            'export-wav': exportWavLoop,
            'export-report': exportReport,
            'stage-report': () => stageMode?.report(),
            'entry-batch': () => entryScreen.openBatch(),
            'entry-export-csv': () => entryScreen.exportTable(),
            'entry-export-notes': () => entryScreen.exportNotes(),
        } satisfies Record<GlobalShortcutAction, () => void> & Record<string, () => void>;
        if (Object.prototype.hasOwnProperty.call(toolbarActions, action)) {
            toolbarActions[action]();
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
            return;
        }
        trackHeight = next;
        updateUiSmokeSpectrumState();
        updatePlaybackButtons();
        Object.keys(canvasWidthCache).forEach(function (key) { delete canvasWidthCache[key]; });
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
    }
    /** Maximized, the plot fills whatever its wrap gets from the flex layout; otherwise it keeps the height the user set. */
    function effectiveSpectrumHeight(): number {
        const wrap = spectrumMaximized ? document.getElementById('spectrum-overlay-wrap') : null;
        if (!wrap || !wrap.clientHeight) {
            return spectrumOverlayHeight;
        }
        const style = window.getComputedStyle(wrap);
        const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
        const header = document.getElementById('spectrum-overlay-header')?.offsetHeight ?? 0;
        return Math.max(SPECTRUM_HEIGHT_MIN, wrap.clientHeight - padding - header);
    }
    /** The pane's height less everything but the tracks and the plot itself, so it holds even when the tracks were squeezed to nothing. */
    function spectrumHeightLimit(): number {
        const section = document.getElementById('spectrum-section');
        const pane = section?.parentElement;
        const canvas = canvasById(document, 'spectrum-overlay-canvas');
        if (!section || !pane || !pane.clientHeight || !canvas) {
            return SPECTRUM_HEIGHT_MAX;
        }
        let others = section.offsetHeight - canvas.offsetHeight;
        Array.from(pane.children).forEach(function (child) {
            if (child !== section && child.id !== 'tracks-wrapper') {
                others += (child as HTMLElement).offsetHeight;
            }
        });
        return clampHeight(pane.clientHeight - others - TRACKS_MIN_VISIBLE, SPECTRUM_HEIGHT_MIN, SPECTRUM_HEIGHT_MAX);
    }
    function syncSpectrumCanvasCssHeight() {
        const canvas = canvasById(document, 'spectrum-overlay-canvas');
        const height = effectiveSpectrumHeight() + 'px';
        if (canvas && canvas.style.height !== height) {
            canvas.style.height = height;
        }
    }
    function setSpectrumHeight(value: number): void {
        const next = clampHeight(value, SPECTRUM_HEIGHT_MIN, spectrumHeightLimit());
        if (spectrumOverlayHeight === next) {
            syncSpectrumCanvasCssHeight();
            return;
        }
        spectrumOverlayHeight = next;
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
            disableFollowCursor();
            waveformView.showRegion(loopRegion, 0.05);
            scheduleRender();
        }
    }
    function updateZoomToSelectionBtn() {
        var btn = buttonById(document, 'btn-zoom-to-selection');
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
    function renderEveryLane() {
        drawEveryLane = true;
        try { renderStackedTracks(); checkAndRequestRanges(); } finally { drawEveryLane = false; }
    }
    function detailPending(): boolean {
        return state.results.some(function (_: ComparisonTrackState, i: number) {
            const requests = trackRecordAtIndex(i)?.requests;
            return Boolean(requests?.pending('detail') || requests?.pending('range'));
        });
    }
    function exportPng() {
        // The image holds every shown lane, also those scrolled out of view: drawing them asks for the spectrograms and
        // zoom detail they lack, and the image is composed once those have arrived (or after a while, as far as they got).
        renderEveryLane();
        const failed = STR.announceExportPngFailed || 'PNG export failed: no visible canvases';
        if (visibleExportCanvases(document.getElementById('tracks-wrapper') as unknown as Element | null).length === 0) {
            messaging.post({ type: 'show-info', message: failed });
            return;
        }
        announce(STR.announceExportPngStarted || 'PNG export started');
        composePngWhenDetailed(Date.now() + 30000, failed);
    }
    function composePngWhenDetailed(deadline: number, failed: string) {
        if (detailPending() && Date.now() < deadline) {
            setTimeout(function () { composePngWhenDetailed(deadline, failed); }, 100);
            return;
        }
        renderEveryLane();
        const wrapper = document.getElementById('tracks-wrapper');
        const canvases = visibleExportCanvases(wrapper as unknown as Element | null);
        setTimeout(function () {
            const composed = composeTrackCanvases(document as unknown as Document, canvases, function (canvas) {
                const axisId = canvas.id ? canvas.id.replace(/^track-canvas-/, 'track-axis-canvas-').replace(/^track-spec-canvas-/, 'track-spec-axis-canvas-') : '';
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
    function saveRecipe() {
        // The bottom panel's analysis: the transfer functions while a reference is set, else the spectrum.
        const pair = pairPanel.sources();
        if (pair && pair.responses.length > 0) {
            messaging.post({
                type: 'save-recipe',
                filePath: pair.reference.filePath,
                referenceChannel: pair.reference.channelIndex,
                responses: pair.responses.map(source => ({ filePath: source.filePath, channelIndex: source.channelIndex })),
            });
            return;
        }
        // The lowest sample rate shown bounds the octave bands, so the saved Recipe runs on every shown track.
        const record = trackStore.activeIds().map(trackId => trackStore.require(trackId))
            .filter(item => !item.runtime.hidden && !item.result.error)
            .sort((a, b) => a.result.sampleRateHz - b.result.sampleRateHz)[0];
        if (!record) {
            messaging.post({ type: 'show-info', message: STR.recipeSaveNoData });
            return;
        }
        messaging.post({ type: 'save-recipe', filePath: record.result.filePath, ...(spectrumBandsPerOctave ? { bandsPerOctave: spectrumBandsPerOctave } : {}) });
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
    function zoomIn() {
        disableFollowCursor();
        waveformView.zoomBy(ZOOM_IN_FACTOR);
        scheduleRender();
    }
    function zoomOut() {
        disableFollowCursor();
        waveformView.zoomBy(1 / ZOOM_IN_FACTOR);
        scheduleRender();
    }
    function resetZoom() {
        disableFollowCursor();
        waveformView.reset();
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
        spectrumView.zoomBy(factor);
        scheduleSpectrumRefresh('immediate');
    }
    function specZoomReset() {
        spectrumView.reset();
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
                ...spectrumView.dbRangeFields(),
                clientX, clientY,
                apply(min, max) {
                    spectrumView.setDbRange(min, max);
                    scheduleSpectrumRefresh('immediate');
                },
                auto() {
                    spectrumView.setDbRange(null, null);
                    scheduleSpectrumRefresh('immediate');
                },
            });
            return;
        }
        spectrumRangePopover.open({
            axisLabel: STR.specRangeAxisFreq,
            horizontal: true,
            ...spectrumView.frequencyRangeFieldsHz(),
            clientX, clientY,
            apply(min, max) {
                if (!spectrumView.setFrequencyRangeHz(min, max)) {
                    return STR.specRangeErrorMinMax;
                }
                scheduleSpectrumRefresh('immediate');
            },
            auto() {
                spectrumView.resetFrequency();
                scheduleSpectrumRefresh('immediate');
            },
        });
    }
    const waveformRangePopover = installRangePopover(document, {
        rootId: 'waveform-range-popover',
        badgeId: 'wave-range-axis-badge',
        idPrefix: 'wave-range',
        strings: rangePopoverStrings(STR),
        position: positionPopover,
    });
    // The popover takes values of the clicked channel; other lanes follow by the same ratio to their own peak
    // (or, linked, to the largest peak, so every lane shows the same values).
    /** A double-click on a lane's axis: the waveform's amplitude, the spectrogram's frequency or its colour bar. */
    function openTrackAxisRange(element: Element, clientX: number, clientY: number): boolean {
        if (contentType !== 'waveform') {
            return false;
        }
        if (element.classList.contains('track-spec-axis')) {
            return openSpectrogramRangePopup(element, 'frequency', clientX, clientY);
        }
        if (element.classList.contains('track-spec-canvas')) {
            const canvas = element as HTMLCanvasElement;
            const rect = canvas.getBoundingClientRect();
            const x = (clientX - rect.left) * (canvas.width / Math.max(rect.width, 1));
            return x >= spectrogramPlotWidth(canvas.width) && openSpectrogramRangePopup(element, 'level', clientX, clientY);
        }
        return element.classList.contains('track-axis-canvas') && openWaveformRangePopup(element, clientX, clientY);
    }
    // The spectrogram's ranges are display settings shared by every lane, like the ⚙ popover's.
    function openSpectrogramRangePopup(element: Element, axis: 'frequency' | 'level', clientX: number, clientY: number): boolean {
        const trackIndex = trackIndexFromElement(element);
        const result = trackIndex === null ? undefined : state.results[trackIndex];
        const spec = result ? channelsForResult(result)[channelIndexAttribute(element) ?? 0]?.spectrogram : undefined;
        if (!spec) {
            return false;
        }
        const display = __spectrogramSettings.display;
        const bounds = spectrogramDisplayBounds(spec, display, spectrogramAutoBounds(spec));
        const field = (value: number) => String(Number(value.toPrecision(4)));
        // An edge left as shown stays as it was: auto stays auto, so the clicked lane's own range is not set on every lane.
        const typed = (value: number | null, shown: number, setting: number | null | undefined) =>
            setting == null && value !== null && field(value) === field(shown) ? null : value;
        if (axis === 'level') {
            waveformRangePopover.open({
                axisLabel: STR.specRangeAxisDb,
                horizontal: false,
                min: field(bounds.dbLo),
                max: field(bounds.dbHi),
                clientX, clientY,
                apply(min, max) {
                    __setSpectrogramDisplay({ ...display, dbMin: typed(min, bounds.dbLo, display.dbMin), dbMax: typed(max, bounds.dbHi, display.dbMax) });
                },
                auto() {
                    __setSpectrogramDisplay({ ...display, dbMin: null, dbMax: null });
                },
            });
            return true;
        }
        waveformRangePopover.open({
            axisLabel: STR.specRangeAxisFreq,
            horizontal: false,
            min: field(bounds.minFrequencyHz),
            max: field(bounds.maxFrequencyHz),
            clientX, clientY,
            apply(min, max) {
                const bottom = min !== null && min > 0 ? min : null;
                if (max !== null && max <= (bottom ?? 0)) {
                    return STR.specRangeErrorMinMax;
                }
                __setSpectrogramDisplay({ ...display, minFrequencyHz: bottom, maxFrequencyHz: typed(max, bounds.maxFrequencyHz, display.maxFrequencyHz) });
            },
            auto() {
                __setSpectrogramDisplay({ ...display, minFrequencyHz: null, maxFrequencyHz: null });
            },
        });
        return true;
    }
    function openWaveformRangePopup(axis: Element, clientX: number, clientY: number): boolean {
        if (contentType !== 'waveform' || axis.classList.contains('track-spec-axis')) {
            return false;
        }
        const trackIndex = trackIndexFromElement(axis);
        const result = trackIndex === null ? undefined : state.results[trackIndex];
        const channel = result ? channelsForResult(result)[channelIndexAttribute(axis) ?? 0] : undefined;
        if (!channel) {
            return false;
        }
        const peak = amplitudeScaleFor(channel);
        const unit = typeof channel.unit === 'string' ? channel.unit.trim() : '';
        const painted = waveformView.paintedAmplitudeRange();
        const field = (norm: number) => String(Number((norm * peak).toPrecision(4)));
        waveformRangePopover.open({
            axisLabel: unit ? STR.waveRangeAxisAmplitude + ' (' + unit + ')' : STR.waveRangeAxisAmplitude,
            horizontal: false,
            min: field(painted.min),
            max: field(painted.max),
            clientX, clientY,
            apply(min, max) {
                const error = waveformView.setAmplitudeRange(min === null ? null : min / peak, max === null ? null : max / peak);
                if (error) {
                    return error === 'narrow' ? STR.waveRangeErrorTooNarrow : STR.specRangeErrorMinMax;
                }
                scheduleRender();
            },
            auto() {
                waveformView.resetAmplitude();
                scheduleRender();
            },
        });
        return true;
    }
    function handleZoomWheel(e: WheelEvent): void {
        disableFollowCursor();
        const scaleFactor = wheelZoomFactor(e.deltaY);
        const view = waveformView.timeRange();
        const wrapper = document.getElementById('tracks-wrapper');
        let pivotNorm = (view.start + view.end) / 2; // fallback: current center
        const target = eventTarget(e);
        const wheelCanvas = target && typeof target.closest === 'function'
            ? target.closest<HTMLCanvasElement>('.track-canvas')
            : null;
        if (wheelCanvas) {
            const hit = trackCanvasTimeHit(wheelCanvas, e.clientX);
            if (!hit) {
                return;
            }
            pivotNorm = hit.norm;
        }
        else if (wrapper) {
            const rect = wrapper.getBoundingClientRect();
            pivotNorm = normAtPlotX(view, e.clientX - rect.left - TRACK_HEADER_W, rect.width - TRACK_HEADER_W) ?? pivotNorm;
        }
        waveformView.zoomAround(pivotNorm, scaleFactor);
        scheduleRender();
    }
    function handlePanWheel(e: WheelEvent): void {
        disableFollowCursor();
        waveformView.pan(e.deltaY > 0 ? 1 : -1);
        scheduleRender();
    }
    function handleCanvasMouseMove(e: MouseEvent): void {
        if (dragState && dragState.isDrag) {
            hintFooter.clear();
            return;
        }
        const canvas = canvasTarget(e, 'track-canvas');
        if (!canvas) {
            return;
        }
        if (dragState) {
            return;
        }
        const hit = trackCanvasTimeHit(canvas, e.clientX);
        const onColorbar = !hit && contentType === 'waveform' && canvas.classList.contains('track-spec-canvas');
        canvas.style.cursor = onColorbar ? 'pointer' : '';
        if (!hit) {
            clearHover();
            if (onColorbar) hintFooter.show(STR.hintSpectrogramColorbar);
            else hintFooter.clear();
            return;
        }
        const norm = hit.norm;
        // Same precedence as handleCanvasMouseDown so the hint names the drag that will run.
        const rectZoom = rectZoomOn(canvas);
        const gripType = rectZoom ? null : loopGripAt(loopRegion, norm, waveformView.span());
        const action = gripType ? STR.tooltipLoopResize
            : e.shiftKey ? STR.tooltipLoopOrShift
            : rectZoom ? STR.hintRectZoomDrag
            : loopRegion && norm >= loopRegion.start && norm <= loopRegion.end ? STR.tooltipLoopClear
            : STR.tooltipLoopOrShift;
        hintFooter.show(action + ' / ' + STR.hintDoubleClickResetZoom + ' / ' + STR.hintWheelGestures);
        renderWithHoverAt(norm);
    }
    /** Box zoom picks an amplitude range, which only the waveform has: on the spectrogram a drag stays a loop. */
    function rectZoomOn(canvas: HTMLCanvasElement): boolean {
        return waveformMode === 'rect-zoom' && !canvas.classList.contains('track-spec-canvas');
    }
    function handleCanvasMouseDown(e: MouseEvent): void {
        const canvas = canvasTarget(e, 'track-canvas');
        if (!canvas) {
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
            const ampNorm = waveformView.canvasYToAmplitude(y, canvas.height);
            const rectZoom = rectZoomOn(canvas);
            const gripType = rectZoom ? null : loopGripAt(loopRegion, norm, waveformView.span());
            dragState = {
                trackId: trackId,
                canvasId: canvas.id,
                startClientX: e.clientX,
                startClientY: e.clientY,
                startOffset: trackRuntimeAt(idx).offsetSeconds,
                canvasWidth: hit.timeWidth,
                canvasHeight: canvas.height,
                isDrag: false,
                isShift: e.shiftKey,
                startNorm: norm,
                startAmpNorm: ampNorm,
                dragType: gripType || (e.shiftKey ? 'offset' : (rectZoom ? 'rectZoom' : 'loop')),
            };
            if (dragState.dragType === 'rectZoom') setLoopRegion(null);
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
        hintFooter.clear();
        if (dragState.dragType === 'offset') {
            const gs = trackStore.globalSpan();
            const secsPerPx = waveformView.span() * gs.spanSec / dragState.canvasWidth;
            // The spectra follow once the drag ends (handleDocMouseUp).
            setTrackOffset(dragTrackIndex, dragState.startOffset + dx * secsPerPx, false);
        }
        else {
            const canvasEl = canvasById(document, dragState.canvasId);
            if (canvasEl) {
                const norm = clampedTrackCanvasNorm(canvasEl, e.clientX, dragState.canvasWidth);
                if (dragState.dragType === 'rectZoom') {
                    const y = e.clientY - canvasEl.getBoundingClientRect().top;
                    rectZoomSelection = {
                        trackId: dragState.trackId,
                        startNorm: dragState.startNorm,
                        endNorm: norm,
                        startAmpNorm: dragState.startAmpNorm,
                        endAmpNorm: waveformView.canvasYToAmplitude(y, dragState.canvasHeight),
                    };
                    updateUiSmokeWaveformState();
                }
                else {
                    const region = loopRegionForDrag(dragState.dragType, dragState.startNorm, loopRegion, norm);
                    if (region) setLoopRegion(region);
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
            const canvas = trackStore.protocolIndexForId(dragState.trackId) === null ? null : canvasById(document, dragState.canvasId);
            if (canvas) {
                const hit = trackCanvasTimeHit(canvas, e.clientX);
                if (hit) {
                    moveCursor(hit.norm);
                    setLoopRegion(null);
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
                waveformView.applyRectZoom(target);
            }
            setLoopRegion(null);
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
        hintFooter.clear();
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
    function extractSpectrumAtCursor(result: ComparisonTrackState, trackIndex: number, offsetSeconds: number, cursorNormValue: number, channelIndex = 0): SpectrumSlice | null {
        const chIdx = Number.isInteger(channelIndex) ? channelIndex : 0;
        return extractCursorSpectrum(result, offsetSeconds, cursorNormValue, trackStore.globalSpan(), {
            trackIndex,
            channelIndex: chIdx,
            cached: trackIndex >= 0 ? trackRecordAtIndex(trackIndex)?.spectrumSliceCache.get(chIdx) ?? null : null,
            settingsSignature: currentSpectrumDataSignature(),
            bands: spectrumBandsPerOctave !== 0,
            requestSlice: requestSpectrumSlice,
            applyDisplaySettings: applySpectrumDisplaySettings,
        });
    }
    function spectrumSeriesLabel(result: ComparisonTrackState, channelIndex: number) {
        return result.fileName + ' / ' + channelLabel(result, channelIndex);
    }
    const spectrumSeriesSource: SpectrumSeriesSource<ComparisonTrackState> = {
        channelCount: function (result) { return channelsForResult(result).length; },
        slice: extractSpectrumAtCursor,
        isPending: isSpectrumSliceRequestPendingForCursor,
        color: trackColor,
        label: spectrumSeriesLabel,
    };
    function spectrumSeriesAt(norm: number): CollectedSpectrumSeries {
        const tracks = trackStore.displayOrder.map(function (trackId) {
            const record = trackStore.require(trackId);
            return { index: record.protocolIndex, result: record.result, hidden: record.runtime.hidden, offsetSeconds: record.runtime.offsetSeconds };
        });
        return collectSpectrumSeries(tracks, norm, spectrumSeriesSource);
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
            const nextNorm = slice ? steppedTrackSpectrumHoverNorm(slice, spectrumHover.norm, spectrumView.freqStart, spectrumView.freqEnd, deltaIdx) : null;
            if (nextNorm !== null) {
                spectrumHover.norm = nextNorm;
            }
            return;
        }
        const slices = spectrumSeriesAt(cursorNorm).series;
        if (slices.length === 0) {
            return;
        }
        const range = spectrumSeriesRange(slices);
        const vis = spectrumVisibleWindow(range.maxFrequencyHz, range.minDb, range.maxDb, spectrumView.state(), range.logMinFrequencyHz);
        const overlayC = canvasById(document, 'spectrum-overlay-canvas');
        const nextNorm = steppedOverlaySpectrumHoverNorm(slices, spectrumHover.norm, spectrumHover.yFrac, overlayC, vis, deltaIdx);
        if (nextNorm === null) {
            return;
        }
        spectrumHover.norm = nextNorm;
        spectrumHover.target = 'overlay';
        spectrumHover.channelIndex = null;
    }

    /** Linked, the lanes' cursor spectra in one unit share the dB axis of all their slices. */
    function linkedTrackSpectrumDb(): Map<string, { minDb: number; maxDb: number }> | null {
        if (!scalesLinked) {
            return null;
        }
        const ranges = new Map<string, { minDb: number; maxDb: number }>();
        displayedLanes().forEach(function ({ record, channelIndex }) {
            const slice = extractSpectrumAtCursor(record.result, record.protocolIndex, record.runtime.offsetSeconds, spectrumCursorNorm, channelIndex);
            if (slice && Number.isFinite(slice.minDb) && Number.isFinite(slice.maxDb)) {
                const key = levelUnitKey(slice);
                const range = ranges.get(key);
                ranges.set(key, range ? { minDb: Math.min(range.minDb, slice.minDb), maxDb: Math.max(range.maxDb, slice.maxDb) } : { minDb: slice.minDb, maxDb: slice.maxDb });
            }
        });
        return ranges;
    }
    function renderTrackSpectra() {
        const linkedDb = linkedTrackSpectrumDb();
        trackStore.activeIds().forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            const i = record.protocolIndex;
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const canvas = canvasById(document, trackSpectrumCanvasId(i, channelIndex));
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
                syncCanvasSize(canvas, w, laneOuterHeight());
                const paintedByChannel = trackStore.require(trackIdAtIndex(i)!).spectrumPainted;
                if (canvas.width !== prevW || canvas.height !== prevH) {
                    paintedByChannel.set(channelIndex, false);
                }
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return;
                }
                const W = canvas.width, H = canvas.height;
                if (trackRuntimeAt(i).hidden) {
                    ctx.clearRect(0, 0, W, H);
                    paintedByChannel.set(channelIndex, false);
                    return;
                }
                const ownSlice = extractSpectrumAtCursor(result, i, trackRuntimeAt(i).offsetSeconds, spectrumCursorNorm, channelIndex);
                const shared = ownSlice && linkedDb ? linkedDb.get(levelUnitKey(ownSlice)) : undefined;
                const slice = ownSlice && shared ? { ...ownSlice, ...shared } : ownSlice;
                if (!slice) {
                    if (paintedByChannel.get(channelIndex) && isSpectrumSliceRequestPendingForCursor(i, spectrumCursorNorm)) {
                        return;
                    }
                    drawCanvasMessage(ctx, W, H, STR.canvasOutOfRange, '9px sans-serif', drawTheme().mutedColor);
                    paintedByChannel.set(channelIndex, false);
                    return;
                }
                const hovered = spectrumHover.target === trackId && spectrumHover.channelIndex === channelIndex ? spectrumHover.norm : null;
                const readout = paintTrackSpectrum(ctx, W, H, { slice, color: trackColor(i), label: spectrumReadoutTrackLabel(result, channelIndex) }, spectrumView.state(), hovered, drawTheme());
                paintedByChannel.set(channelIndex, true);
                if (readout) {
                    setSpectrumReadout(document.getElementById('spectrum-freq-readout'), readout.text, readout.color);
                }
            });
        });
    }
    function renderOverlaySpectrum() {
        const canvas = canvasById(document, 'spectrum-overlay-canvas');
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
        syncCanvasSize(canvas, w, effectiveSpectrumHeight());
        if (canvas.width !== prevW || canvas.height !== prevH) {
            overlaySpectrumPainted = false;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        const W = canvas.width, H = canvas.height;
        const { series: slices, pending: pendingVisibleSlice } = spectrumSeriesAt(spectrumCursorNorm);
        if (overlaySpectrumPainted && pendingVisibleSlice) {
            return;
        }
        if (slices.length === 0) {
            drawCanvasMessage(ctx, W, H, STR.spectrumNoData, '11px sans-serif', drawTheme().mutedColor);
            overlaySpectrumPainted = false;
            return;
        }
        const paint = paintOverlaySpectrum(ctx, W, H, slices, spectrumView.state(), spectrumHover, specBoxDrag.box, drawTheme());
        spectrumView.recordPaint(paint);
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
        pairPanel.render();
        updateUiSmokeSpectrumState();
        const el = document.getElementById('spectrum-cursor-time');
        if (el) {
            const gs = trackStore.globalSpan();
            el.textContent = '@ ' + formatClockTime(gs.startSec + spectrumCursorNorm * gs.spanSec) + analysisWindowCaption();
        }
    }
    function analysisWindowCaption() {
        const gs = trackStore.globalSpan();
        const captions = new Set<string>();
        for (const trackId of trackStore.displayOrder) {
            const band = analysisWindowBand(trackStore.require(trackId).protocolIndex, 0);
            if (band) {
                const ms = (band.endNorm - band.startNorm) * gs.spanSec * 1000;
                captions.add(STR.spectrumAnalysisWindow + (band.window ? ' ' + band.window : '') + ' '
                    + (gs.startSec + band.startNorm * gs.spanSec).toFixed(3) + '–' + (gs.startSec + band.endNorm * gs.spanSec).toFixed(3)
                    + ' s (' + ms.toFixed(ms < 10 ? 2 : 1) + ' ms)');
            }
        }
        if (captions.size === 0) {
            return '';
        }
        return '  ' + (captions.size === 1 ? captions.values().next().value : STR.spectrumAnalysisWindowPerTrack);
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
            audio.removeAttribute('id');
            audioFader.pauseSmoothly(audio, function () {
                audio.remove();
                audioFader.release(audio);
            });
        }
        releaseTrackDetail(idx);
        channelsForResult(record.result).forEach((_, channelIndex) => spectrogramRasterCache.delete(trackId + ':' + channelIndex));
        trackRuntimeAt(idx).hidden = true;
        var pos = trackStore.displayOrder.indexOf(trackId);
        var n = pos !== -1 ? pos + 1 : idx + 1;
        trackStore.remove(trackId);
        messaging.releaseSource(record.result.filePath);
        // Off the track view is off the entry table's tracks and slots too.
        removeSelectedFilePath(record.result.filePath);
        syncSelectionSummary();
        entryScreen.trackRemoved(record.result.filePath);
        announce((STR.announceTrackRemoved || 'Track {n} removed').replace('{n}', String(n)));
        updateVisibility();
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
    }
    function adjustOffset(idx: number, deltaSeconds: number) {
        setTrackOffset(idx, trackRuntimeAt(idx).offsetSeconds + deltaSeconds);
    }
    /** A track's offset changed: spectra asked for at the old offset are stale, and every view of the offset follows. */
    function setTrackOffset(idx: number, seconds: number, refreshSpectrum = true): void {
        trackRuntimeAt(idx).offsetSeconds = seconds;
        invalidateDesiredSpectrumSliceRequests();
        updateOffsetDisplays();
        updateLoopTimeDisplay();
        scheduleRender();
        if (refreshSpectrum) scheduleSpectrumRefresh('immediate');
    }
    // ── Spectrogram settings popover ──
    let __spectrogramSettings = state.spectrogramSettings || {
        auto: true,
        stft: { nFft: 1024, overlapPercent: 75, window: 'hann' },
        display: { dbMin: null, dbMax: null, maxFrequencyHz: null }
    };
    function __updateSpecGearVisibility() {
        const gear = buttonMatching(document, '[data-action="spectrogram-settings"]');
        if (gear) {
            gear.style.display = contentType === 'stage' ? 'none' : '';
        }
    }
    function __setSpectrogramDisplay(display: SpectrogramDisplaySettings): void {
        function n(v: number | null): number | null { return v == null ? null : Number(v); }
        __spectrogramSettings.display = {
            dbMin: n(display.dbMin),
            dbMax: n(display.dbMax),
            maxFrequencyHz: n(display.maxFrequencyHz),
            // The ⚙ popover has no field for it, so it keeps the one set on the axis.
            minFrequencyHz: display.minFrequencyHz !== undefined ? n(display.minFrequencyHz) : n(__spectrogramSettings.display.minFrequencyHz ?? null),
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
            __spectrogramSettings = { auto: true, stft: { nFft: 1024, overlapPercent: 75, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } };
            messaging.post({ type: 'update-spectrogram-settings', settings: __spectrogramSettings });
            scheduleRender();
        },
        onApply(settings) {
            // The ⚙ popover has no lower frequency: the one set on the axis survives a new STFT.
            __spectrogramSettings = { ...settings, display: { ...settings.display, minFrequencyHz: __spectrogramSettings.display.minFrequencyHz ?? null } };
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
        const applyBtn = buttonById(document, 'spec-apply');
        if (applyBtn) {
            applyBtn.disabled = !!busy;
        }
    }
    installHelpOverlay(document, STR);
    messaging.onMessage(function (msg) {
        if (!msg) {
            return;
        }
        if (msg.type === 'directory-selection') {
            showDirectorySelection(msg.rootPath, msg.filePaths, msg.rootLabel, !!msg.entry);
            // A folder opens on the entry table; files listed beside it (added, dropped) join its "added files" group.
            if (msg.entry && msg.filePaths.length) entryScreen.open(msg.filePaths, msg.rootPath);
            else entryScreen.addFiles(msg.filePaths);
            return;
        }
        // A comparison scan the entry table asked for (re-measuring a fixed Δ) goes to the entry table.
        if (stageMode?.handle(msg) || entryScreen.handle(msg)) {
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
                // A file the host newly selects (opened again with the picker after its track was taken off) is shown
                // again; one it still reports from before (an update that crossed the removal) stays off.
                for (const path of msg.selectedFilePaths) if (!hostSelection.has(path)) trackStore.allowExplicitSelection(path);
                hostSelection = new Set(msg.selectedFilePaths);
                clearSelectedFilePaths();
                msg.selectedFilePaths.forEach(addSelectedFilePath);
                syncSelectionSummary();
            }
            __setReanalyzeBusy(false);
            invalidateDesiredSpectrumSliceRequests();
            // A host drops a request whose source was cleared, so waiting for its answer would block every later cursor spectrum.
            activeSpectrumSliceRequest = null;
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
                    audioHost.querySelectorAll('audio').forEach(function (audio) {
                        // Moving it within the document keeps it playing until its fade-out ends; detaching would cut it off.
                        audio.removeAttribute('id');
                        document.body.appendChild(audio);
                        audioFader.pauseSmoothly(audio, function () {
                            audio.remove();
                            audioFader.release(audio);
                        });
                    });
                    audioHost.innerHTML = buildAudioElements();
                    attachAudioEvents();
                }
            }
            updateCursorDisplay(hoverNorm ?? cursorNorm);
            updateLoopTimeDisplay();
            overlaySpectrumPainted = false;
            announce((STR.announceAnalysisDone || 'Analysis complete: {count} tracks').replace('{count}', String(state.results.length)));
            entryScreen.tracksChanged();
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
        const wrap = document.getElementById('stacked-wrap');
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
    __updateSpecGearVisibility();
    ensureCalibrationStyles(document as unknown as Document);
}
