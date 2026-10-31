import { middleEllipsis } from '../../shared/dataset/datasetTable';
import { channelLabel, channelsForResult, formatClockTime } from '../../shared/utils/format';
import { linkedSpectrogramBounds, spectrogramDisplayBounds } from './spectrogramRaster';
import { paintTrackSpectrogram, paintTrackWaveform, spectrogramPlotWidth, type SpectrogramRasterCacheEntry } from './trackCanvasPainter';
import { trackTimelinePlacement } from './waveformCoverage';
import { attachOffsetEditing } from './offsetInlineEditor';
import { dispatchTestMouseEvent, fillSpectrogramDisplayForm, fillSpectrogramSettingsForm, heightDragFromPayload, loopRegionFromPayload, setTestInputValue, testActionTrackId } from './testActionForms';
import { nextRequestId } from './hostRequests';
import { DEFAULT_PYTHON_ENVIRONMENT_STATE, isResponseToLazyRequest, mergeDetailSpectrograms, pythonEnvironmentStateFromMessage } from './lazyResponses';
import { formatAmplitudeValue, formatWaveformAxisLabels, drawWaveformAmplitudeAxis, drawSpectrogramFrequencyAxis, drawCanvasMessage, type DrawTheme } from '../draw/canvasDrawers';
import { isCacheSufficient, isOverviewSufficient, isRangeCacheDrawable, parseRangeRequestKey, planLaneRange, rangeCacheCoversView, rangeHasDetail } from '../waveform/rangeRequestPolicy';
import { extractSpectrumAtCursor as extractCursorSpectrum } from '../spectrum/cursorSpectrum';
import { buildSpectrumCsv, wavLoopRegions } from './runtimeExports';
import { audioById, buttonById, buttonMatching, canvasById, canvasesMatching, canvasTarget, eventTarget, requiredElementById } from './domAdapter';
import { HostMessenger } from './hostMessaging';
import {
    createTrackTimeMapping,
    globalNormFromTrackTime as mapGlobalNormFromTrackTime,
    trackTimeFromGlobalNorm,
} from './playback';
import { createAudioFader } from './audioFade';
import { PlaybackController } from './playbackController';
import { SpectrumRequestScheduler } from './spectrumRequestScheduler';
import { LaneViewState } from './laneViewState';
import { SelectionSync } from './selectionSync';
import { positionPopover } from './settingsPopover';
import { composeTrackCanvases, triggerAnchorDownload, visibleExportCanvases } from './exportDownloads';
import { clampHeight, createHeightResize, type HeightKind } from './heightResize';
import { LayoutSettings, SPECTRUM_HEIGHT_MAX, SPECTRUM_HEIGHT_MIN, TRACK_HEIGHT_MAX, TRACK_HEIGHT_MIN, WAVE_SHARE_MAX, WAVE_SHARE_MIN, type LayoutChange } from './layoutSettings';
import { installRangePopover } from '../rangePopover';
import { buildMarkdownReport, buildNotebook, type ReportLoopRegion, type ReportTrack } from '../../shared/report/analysisReport';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { installHelpOverlay } from './helpOverlay';
import { arrowCursorStep, isTextEntryTag, type GlobalShortcutAction } from './shortcuts';
import { domSnapshotBase, latestSpectrogramSnapshot, shellSnapshot } from './testSnapshot';
import { buildTrackSnapshot } from './comparisonSnapshot';
import { contentBoxWidth, readThenWrite, syncCanvasSize } from './canvasSizing';
import { trackAxisCanvasId, trackCanvasId, trackCanvasWrapId, trackSpecAxisCanvasId, trackSpecCanvasId, trackSpectrogramOverlayCanvasId, trackSpectrumCanvasId, trackSpectrumWrapId } from './trackCanvasIds';
import { channelLaneHtml, trackRowHtml } from './trackLaneHtml';
import { attachSpectrumBoxDrag, SpectrumBoxDrag } from './spectrumBoxDrag';
import { attachCanvasFocusHint, attachHoverHints, createHintFooter, createTaskStatus, setHint } from './hintFooter';
import { attachSpectrumCursorListeners, createSpectrumCursorHandlers } from './spectrumCursorHandlers';
import { attachTrackLaneActions } from './trackLaneActions';
import { attachOverlaySpectrumDoubleClick, attachOverlaySpectrumHints } from './overlaySpectrumEvents';
import { attachGlobalKeyboardListeners } from './globalKeyboardEvents';
import { keyRouterFor } from './keyRouter';
import { attachSeparatorKeys } from './separatorKeys';
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
import { PAIR_SPLIT_MAX, PAIR_SPLIT_MIN, PairSpectrumPanel } from './pairSpectrumPanel';
import { paintTrackSpectrum } from './trackSpectrumPainter';
import { collectSpectrumSeries, type CollectedSpectrumSeries, type SpectrumSeriesSource } from './spectrumSeriesCollector';
import { toolbarHtml } from './toolbarHtml';
import { attachExclusiveMenus, attachHeightResizeListeners, attachToolbarActions } from './toolbarEvents';
import { resultsPaneHtml, trackAudioHtml, type SpectrumBandsSetting } from './resultsPaneHtml';
import { selectionFolderButton, selectionLayoutHtml } from './selectionLayoutHtml';
import { type AnalysisWindowBand, canvasTimeHit, clampedCanvasNorm, CURSOR_LINE_STYLE, drawAnalysisWindowBand, drawDashedTimeLine, drawRectZoomSelection, HOVER_LINE_STYLE, waveformCursorLineStyle } from './canvasOverlays';
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
import { RuntimeEventFeed } from './runtimeEvents';
import { TrackStore } from './trackStore';
import { replaceTrackAudio, retireAudio } from './trackAudioHost';
import { installTrackReorderDrag } from './trackReorderDrag';
import { installSpectrogramSettingsPopover } from './spectrogramSettingsPopover';
import { installReanalyzeOverlay } from './reanalyzeOverlay';
import { SpectrogramSettingsStore } from './spectrogramSettingsStore';
import { createEntryScreen } from './entryRuntime';
import { diffHeadline } from './comparePanes';
import { baseName } from '../../shared/analysis/entryMetadata';
import { channelResult } from '../../shared/recipe/channelSelection';
import { reportFiles } from './compareReport';
import { regionLabel } from './entryTable';
import { activeSlotReferenced, recipeKey } from '../../shared/recipe/recipeSteps';
import { LIGHT_THEME_BODY_SELECTORS, ROLE_COLORS, useLightRoleColors } from '../../shared/gui/roleColors';
import { createTrackStageMode, type StageTrack, type TrackStageMode } from './trackStageMode';
import { attachRoleChips, roleChipHtml, roleChipText, type RoleChipRole } from './roleChip';
import { triggerAnchorDownload as downloadEntryCsv } from './exportDownloads';
import {
    exceedsDragThreshold,
    loopGripAt,
    loopRegionClockText,
    loopRegionForDrag,
    normAtPlotX,
    rectZoomTarget,
    wheelPanPixels,
    wheelStepDirection,
    wheelZoomFactor,
    ZOOM_IN_FACTOR,
} from './waveformInteraction';
import type { ChannelSummary, SpectrogramData, SpectrogramDisplaySettings, } from '../../shared/analysis/analysisTypes';
import type { ComparisonBootstrap, ComparisonTrackState, LazyRequestState, LoopRegion, PersistedWebviewState, RectZoomSelection, SpectrumSlice, TestAction, TrackFileView, TrackId, TrackRuntimeState, WaveformDragState, WaveformDrawOptions, } from './types';
export function startComparisonRuntime(bootstrap: ComparisonBootstrap): void {
    const { host: vscode, state: injectedState, strings: STR, window, document } = bootstrap;
    const state = normalizeRuntimeState(injectedState);
    const messaging = new HostMessenger(vscode, window);
    const testBridge = new ComparisonTestBridge(window, messaging);
    const runtimeEvents = new RuntimeEventFeed();
    testBridge.observe(runtimeEvents);
    const requestAnimationFrame = window.requestAnimationFrame.bind(window);
    const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const setTimeout = (handler: () => void, timeout?: number) => window.setTimeout(handler, timeout);
    const clearTimeout = (timeoutId: number) => window.clearTimeout(timeoutId);
    const performance = window.performance;
    const navigator = window.navigator;
    const ResizeObserver = window.ResizeObserver;
    const getComputedStyle = window.getComputedStyle.bind(window);
    const isSelectionMode = state.mode === 'directory-selection' || vscode.selectionPanel === true;
    // Only a host that opened the page with a directory offers a Python environment picker; the Web host lists its sources without one.
    const hasPythonEnvironmentPicker = state.mode === 'directory-selection';
    const selection = new SelectionSync({
        rootLabel: state.mode === 'directory-selection' ? state.rootPath : '',
        listedFilePaths: Array.isArray(state.allFilePaths) ? state.allFilePaths : [],
        selectedFilePaths: Array.isArray(state.selectedFilePaths) ? state.selectedFilePaths : [],
        listsFiles: isSelectionMode,
    });
    const allSelectableFilePaths = selection.listedFilePaths;
    const persistedStore = new PersistedStateStore(vscode);
    let persistedWebviewState = persistedStore.snapshot;
    function persistWebviewState(patch: Partial<PersistedWebviewState>): void {
        persistedStore.update(patch);
        persistedWebviewState = persistedStore.snapshot;
    }
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
    // A failed spectrogram is not asked again for this long, so a lane that keeps failing does not loop.
    const DETAIL_RETRY_MS = 10_000;
    const AXIS_W = 64;
    // The waveform and the spectrogram under it are TRACK_SPLIT_H apart.
    const TRACK_SPLIT_H = 5;
    const SIDEBAR_WIDTH_MIN = 160;
    /** The window keeps this much beside a widened side panel. */
    const SIDEBAR_WIDTH_SPARE = 80;
    /** Widened past this share of the window (by a drag or by the keys), the side panel's table is maximized instead. */
    const SIDEBAR_MAXIMIZE_SHARE = 0.6;
    const sidebarMaximizes = (width: number): boolean => width > window.innerWidth * SIDEBAR_MAXIMIZE_SHARE;
    const LANE_PLOT_MIN = 40;
    // A tall spectrum still leaves the tracks this much room so the cursor stays reachable.
    const TRACKS_MIN_VISIBLE = 120;
    // A track's own colour never looks like a role's: no blue (base), yellow / purple / magenta (slots 1–3),
    // green (Δ), orange (outliers) or grey (no role in Compare); those belong to the roles (ROLE_COLORS) and the entry table.
    const TRACK_COLORS = ['#2bb3a3', '#b08968', '#8a9a5b', '#c8b79c'];
    // The same four darkened for a light background (each at least 3:1 against the lanes' background).
    const LIGHT_TRACK_COLORS = ['#1a8a7c', '#94704f', '#6f7d44', '#8f7a55'];
    function isLightTheme(): boolean {
        return document.body.matches(LIGHT_THEME_BODY_SELECTORS.join(', '));
    }
    useLightRoleColors(isLightTheme());
    function announce(msg: string): void {
        const el = document.getElementById('a11y-announce');
        if (!el) {
            return;
        }
        el.textContent = '';
        requestAnimationFrame(function () { el.textContent = msg; });
    }
    // ── Runtime state ──
    let rafPending = false;
    const layout = new LayoutSettings(persistedWebviewState, persistWebviewState);
    const spectrogramSettings = new SpectrogramSettingsStore(state.spectrogramSettings);
    layout.onChange(followLayoutChange);
    const audioFader = createAudioFader();
    const playback = new PlaybackController({
        fader: audioFader,
        audioFor: getTrackAudio,
        indexOf: trackId => trackStore.protocolIndexForId(trackId),
        requireIndex: trackIndexForId,
        timeMapping: getTrackTimeMapping,
        globalNormAt: globalNormFromTrackTime,
        durationSeconds: idx => state.results[idx]?.durationSeconds || 0,
        loopRegion: () => viewState.loop,
        cursorNorm: () => viewState.cursor,
        moveCursor,
        centerOn: norm => waveformView.centerOn(norm),
        invalidateSpectrumRequests: invalidateDesiredSpectrumSliceRequests,
        scheduleRender,
        refreshSpectrum: scheduleSpectrumRefresh,
        showTime: seconds => updatePlaybackDisplay(seconds),
        syncLoopBadge: updateLoopBadge,
        requestAnimationFrame,
        cancelAnimationFrame,
    });
    playback.onChange(function (change) {
        if (change === 'playback') {
            updatePlaybackButtons();
            return;
        }
        buttonMatching(document, '[data-action="toggle-follow-cursor"]')?.classList.toggle('is-active', playback.follow);
    });
    /** The file the entry table last drew as playing (its row's ■). */
    let entryPlaying: string | null = null;
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
    function emitSpectrumZoom() {
        runtimeEvents.emit(() => ({
            type: 'spectrum-zoom',
            snapshot: {
                specFreqStart: spectrumView.freqStart,
                specFreqEnd: spectrumView.freqEnd,
                trackHeight: layout.trackHeight,
                spectrumOverlayHeight: layout.spectrumOverlayHeight,
                specDbMin: spectrumView.dbMin,
                specDbMax: spectrumView.dbMax,
            },
        }));
    }
    function emitWaveformZoom() {
        runtimeEvents.emit(() => ({
            type: 'waveform-zoom',
            snapshot: {
                zoomStart: waveformView.start,
                zoomEnd: waveformView.end,
                amplitudeZoomMinNorm: waveformView.amplitudeMin,
                amplitudeZoomMaxNorm: waveformView.amplitudeMax,
                rectZoomSelection: rectZoomSelection ? Object.assign({}, rectZoomSelection) : null,
            },
        }));
    }
    function spectrumNow() {
        return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
            ? performance.now()
            : Date.now();
    }
    interface DesiredSpectrumSliceRequest extends LazyRequestState {
        trackIndex: number;
        bandsPerOctave: SpectrumBandsSetting;
        filePath: string;
        generation: number;
        cursorNorm: number;
        globalCursorNorm: number;
        requestedAt: number;
    }
    const spectrumRequests = new SpectrumRequestScheduler<DesiredSpectrumSliceRequest>({
        now: spectrumNow,
        setTimeout: (handler, ms) => window.setTimeout(handler, ms),
        clearTimeout,
        requestAnimationFrame,
        refresh(advanceCursor) {
            emitSpectrumZoom();
            if (advanceCursor) {
                spectrumCursorNorm = viewState.cursor;
            }
            refreshSpectrumViews();
        },
        isCurrent(request) {
            const record = trackStore.get(request.trackId);
            const currentTrackIndex = record ? trackStore.protocolIndexForId(record.id) : null;
            return !!record && currentTrackIndex !== null && currentTrackIndex === request.trackIndex
                && request.analysisId === analysisId
                && request.settingsSignature === currentSpectrumDataSignature()
                && !record.runtime.hidden && !record.result.error;
        },
        send(request) {
            trackStore.require(request.trackId).requests.ask('slice', request.requestId, String(request.cursorNorm), request);
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
        },
    });
    function flushSpectrumRefresh() {
        spectrumRequests.runFrame(true, true);
    }
    function scheduleSpectrumRefresh(mode: string) {
        emitSpectrumZoom();
        const kind = mode || 'interactive';
        if (kind === 'immediate') {
            flushSpectrumRefresh();
            return;
        }
        if (kind === 'playback') {
            queuePlaybackSpectrumRequests(viewState.cursor);
            return;
        }
        spectrumRequests.scheduleFrame(kind !== 'hover', true);
    }
    // 'stage': every lane draws one step of the scan Recipe (trackStageMode.ts); it is not kept across sessions.
    /** The steps mode (created once the entry table it reads its Recipe from exists). */
    let stageMode: TrackStageMode | null = null;
    /** The tracks' selection while the comparison's ▶ plays over its own region: put back on leaving the comparison. */
    let selectionBeforeStage: { region: LoopRegion | null } | null = null;
    /** Where the steps view was opened from, where Esc goes back to: the tracks' 比較解析, or the entry table. */
    let stageEntrance: 'tracks' | 'table' = 'tracks';
    /** A track's role from the entry table's slots (set once the table exists; tracks drawn before it have none). */
    let trackRole: (filePath: string) => RoleChipRole | undefined = () => undefined;
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
        scheduleSpectrumRefresh('immediate');
    }
    function syncLinkScalesButton(): void {
        const button = buttonMatching(document, '[data-action="link-scales"]');
        if (button) {
            button.classList.toggle('is-active', scalesLinked);
            button.setAttribute('aria-pressed', String(scalesLinked));
        }
    }
    /** The waveform's and the spectrogram's heights; the steps view gives the whole lane to its plot. */
    function laneHeights(): { wave: number; spec: number } {
        const trackHeight = layout.trackHeight;
        if (contentType === 'stage') return { wave: trackHeight, spec: 0 };
        // Each plot keeps room for its axis ticks and unit, however the share and the lane height are set.
        const wave = Math.min(trackHeight - LANE_PLOT_MIN, Math.max(LANE_PLOT_MIN, Math.round(trackHeight * layout.waveShare)));
        return { wave, spec: trackHeight - wave };
    }
    function laneOuterHeight(): number {
        return contentType === 'stage' ? layout.trackHeight : layout.trackHeight + TRACK_SPLIT_H;
    }
    let spectrumBandsPerOctave: SpectrumBandsSetting = persistedWebviewState.spectrumBandsPerOctave === 1 || persistedWebviewState.spectrumBandsPerOctave === 3
        ? persistedWebviewState.spectrumBandsPerOctave : 0;
    const waveformView = new WaveformView();
    const viewState = new LaneViewState({
        scheduleRender,
        showTime: updateCursorDisplay,
        loopChanged() {
            updateLoopTimeDisplay();
            updateZoomToSelectionBtn();
        },
    });
    /**
     * The cursor moved to `norm` (clamped to the tracks): its readouts follow, and spectra asked for at the old
     * place are stale, except while playing, whose own requests keep up with it.
     */
    function moveCursor(norm: number, playing = false): void {
        if (!playing) invalidateDesiredSpectrumSliceRequests();
        viewState.setCursor(norm);
    }
    const spectrumHover = new SpectrumHover();
    // ── スペクトルズーム ───────────────────────────────────
    const spectrumView = new SpectrumView();
    const specBoxDrag = new SpectrumBoxDrag();
    const heightResize = createHeightResize({
        currentHeight: kind => kind === 'track' ? layout.trackHeight : layout.spectrumOverlayHeight,
        canBegin: kind => kind === 'track' || (!layout.spectrumCollapsed && !layout.spectrumMaximized),
        setHeight,
        onActiveChange: active => document.body.classList.toggle('is-height-resizing', active),
    });
    // ── 波形モード ────────────────────────────────────────
    let waveformMode: 'loop' | 'rect-zoom' = 'loop';
    let rectZoomSelection: RectZoomSelection | null = null;
    let dragState: WaveformDragState | null = null;
    function setLoopRegion(region: LoopRegion | null): void {
        viewState.setLoop(region);
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
            if (!viewState.loop) {
                return null;
            }
            const span = trackStore.globalSpan();
            return { startSeconds: span.startSec + viewState.loop.start * span.spanSec, endSeconds: span.startSec + viewState.loop.end * span.spanSec };
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
    function currentSettingsSignature() {
        return spectrogramSettings.dataSignature;
    }
    function currentSpectrumDataSignature() {
        const signature = currentSettingsSignature();
        return spectrumBandsPerOctave ? signature + '|bands=' + spectrumBandsPerOctave : signature;
    }
    function spectrumSliceRequestKey(trackId: TrackId) {
        return trackId;
    }
    function invalidateDesiredSpectrumSliceRequests() {
        spectrumRequests.invalidate();
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
        const failure = record.detailError;
        if (failure && failure.settingsSignature === settingsSignature && Date.now() - failure.at < DETAIL_RETRY_MS) {
            return;
        }
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
        spectrumRequests.drop(spectrumSliceRequestKey(record.id));
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
            ? spectrumRequests.desiredFor(spectrumSliceRequestKey(record.id))
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
        // The folded cursor-spectrum panel leaves each lane's own small spectrum: only lanes near the view need theirs.
        if (!spectrumRequests.allowsSliceRequests || (layout.spectrumCollapsed && !laneInView(i))) {
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
        const pending = spectrumRequests.desiredFor(key) || record.requests.pending('slice')?.meta;
        if (pending && pending.settingsSignature === settingsSignature && Math.abs((pending.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result)) {
            return;
        }
        const requestId = nextRequestId('slice', i);
        spectrumRequests.want(key, {
            trackId: record.id,
            requestId: requestId,
            analysisId: analysisId,
            settingsSignature: settingsSignature,
            cursorNorm: localNorm,
            globalCursorNorm: cursorNormValue,
            trackIndex: i,
            bandsPerOctave: spectrumBandsPerOctave,
            filePath: result.filePath,
            generation: spectrumRequests.generation,
            requestedAt: spectrumNow(),
        });
    }
    function queuePlaybackSpectrumRequests(cursorNormValue: number) {
        trackStore.activeIds().forEach(function (trackId) {
            const index = trackStore.protocolIndexForId(trackId);
            if (index !== null) {
                requestSpectrumSlice(index, cursorNormValue);
            }
        });
    }
    function applySpectrumDisplaySettings(slice: SpectrumSlice) {
        const displaySettings = spectrogramSettings.display;
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
        trackRuntimeAt(i);
        // Its role from the entry table's slots (base blue, slots 1–3); otherwise its own colour, never a role's.
        const filePath = state.results[i]?.filePath;
        const role = filePath && stageMode ? stageMode.role(filePath) : undefined;
        return (role !== undefined ? ROLE_COLORS[role] : undefined) || ownTrackColor(i);
    }
    /** The track's own colour, which it has without a role. */
    function ownTrackColor(i: number) {
        const runtime = trackRuntimeAt(i);
        const color = (runtime && runtime.defaultColor) || TRACK_COLORS[i % TRACK_COLORS.length];
        return isLightTheme() ? LIGHT_TRACK_COLORS[TRACK_COLORS.indexOf(color)] ?? color : color;
    }
    /** The role chips on the track headers follow the slots (set here, on the entry table or on the comparison's legend). */
    function syncRoleChips() {
        document.querySelectorAll<HTMLDetailsElement>('.track-header details.role-chip').forEach(function (chip) {
            const filePath = chip.dataset.filePath ?? '';
            const role = trackRole(filePath);
            const face = chip.querySelector<HTMLElement>('.role-chip-face');
            if (chip.open || !face || (face.dataset.role === String(role?.slot ?? '') && face.textContent === roleChipText(role))) return;
            const i = state.results.findIndex(function (result) { return result.filePath === filePath; });
            chip.outerHTML = roleChipHtml(filePath, role, i >= 0 ? ownTrackColor(i) : '', STR);
        });
    }
    const hintFooter = createHintFooter(document);
    const taskStatus = createTaskStatus(document, window, announce);
    attachHoverHints(document, hintFooter);
    const updatePlaybackDisplay = createPlaybackDisplay(document, STR.playbackTimePrefix || '▶');
    // ── On-demand range cache ──
    let rangeRequestTimer: number | null = null;
    /** When each lane's range request on its way was sent; a failed one is never answered, so it is asked again after RANGE_RETRY_MS. */
    const rangeAskedAt = new Map<string, number>();
    const RANGE_RETRY_MS = 2000;
    /** When the range each lane draws was asked for, so an older answer arriving late does not replace a newer one. */
    const rangeLandedAskedAt = new Map<TrackId, number>();
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
        // A range superseded during a pan still holds detail near the view: it is drawn until the newer one lands.
        // Requests are forgotten on a new analysis, so an answer for an older analysis is still dropped here.
        if (!record.requests.find(msg.requestId)) {
            return;
        }
        // ...but never over one asked for later that has already landed.
        const askedAt = rangeAskedAt.get(msg.requestId) ?? -Infinity;
        record.requests.settle(msg.requestId);
        rangeAskedAt.delete(msg.requestId);
        if (askedAt < (rangeLandedAskedAt.get(trackId) ?? -Infinity)) {
            return;
        }
        rangeLandedAskedAt.set(trackId, askedAt);
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
            record.detailError = { settingsSignature: pending.settingsSignature, message: msg.error, at: Date.now() };
            scheduleRender();
            // The cause may pass (a restarted backend, memory freed): the lane asks again after the pause.
            setTimeout(scheduleRender, DETAIL_RETRY_MS);
            return;
        }
        record.detailError = null;
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
        const active = spectrumRequests.settle(msg.requestId);
        if (!active) {
            return;
        }
        const i = msg.trackIndex;
        const trackId = trackIdAtProtocolBoundary(i, msg.type);
        const record = trackId ? trackStore.get(trackId) : undefined;
        if (!trackId || !record) {
            spectrumRequests.pump();
            return;
        }
        const pending = record.requests.answering('slice', msg.requestId)?.meta;
        if (!isResponseToLazyRequest(pending, trackId, msg)) {
            spectrumRequests.pump();
            return;
        }
        record.requests.settle(msg.requestId);
        const isCurrent = active.generation === spectrumRequests.generation
            && pending.analysisId === analysisId
            && pending.settingsSignature === currentSpectrumDataSignature();
        if (msg.type === 'spectrum-slice-result' && isCurrent) {
            spectrumSlicesFromResult(msg, pending.cursorNorm).forEach(function (slice) {
                record.spectrumSliceCache.set(slice.channelIndex, slice);
            });
            spectrumCursorNorm = active.globalCursorNorm;
            runtimeEvents.emit(() => ({
                type: 'spectrum-slice-timing',
                timing: {
                    requestId: msg.requestId,
                    cursorNorm: active.cursorNorm,
                    backendComputeMs: msg.computeMs,
                    cursorToResponseMs: Math.max(0, spectrumNow() - active.requestedAt),
                    responseAt: spectrumNow(),
                    inFlight: 0,
                    desiredCount: spectrumRequests.desiredCount,
                },
            }));
        }
        spectrumRequests.scheduleFrame(false, false);
        scheduleRender();
        requestAnimationFrame(function () { publishTestSnapshot(); });
        spectrumRequests.pump();
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
                scheduleSpectrumRefresh('immediate');
            },
            // A listed file shown as a track or taken off, as the entry table's slots and ＋ do.
            'set-file-selected': p => setFilesShown([String(p.filePath)], !!p.selected),
            // Every listed file at once, shown or taken off (the e2e's folder-wide steps).
            'set-all-files-selected': p => {
                if (p.selected) { selectTracks(allSelectableFilePaths, true); return; }
                selection.clear();
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
                }
            },
            'set-spectrogram-display': p => {
                if (!specSettingsPopover.isOpen()) {
                    specSettingsPopover.open();
                }
                setSpectrogramDisplay(fillSpectrogramDisplayForm(document, p));
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
    /** Throttled, not debounced: a long continuous pan keeps asking for the screens ahead instead of waiting for it to stop. */
    function scheduleRangeRequests() {
        if (rangeRequestTimer) {
            return;
        }
        rangeRequestTimer = setTimeout(function () { rangeRequestTimer = null; checkAndRequestRanges(); }, 80);
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
            // Detail is kept for a couple of screens either side, so a pan draws lines already decimated in full.
            const { reqStart, reqEnd, points: pts, keepStart, keepEnd } = planLaneRange(fileView.fileAtZoomStart, fileView.fileAtZoomEnd, W);
            const channelCount = channelsForResult(result).length;
            if (isCacheSufficient(record.rangeCache, keepStart, keepEnd, pts, W, fileView.fileAtZoomStart, fileView.fileAtZoomEnd, channelCount)) {
                return;
            }
            const pending = record.requests.pending('range');
            // The host answers a failed range with nothing, so a range on its way stops counting after a while and is asked again.
            const inFlight = pending && performance.now() - (rangeAskedAt.get(pending.requestId) ?? -Infinity) < RANGE_RETRY_MS;
            const asked = pending && inFlight ? parseRangeRequestKey(pending.key) : null;
            if (asked && asked.startNorm <= keepStart && asked.endNorm >= keepEnd &&
                rangeHasDetail(asked.points, asked.startNorm, asked.endNorm, pts, W, fileView.fileAtZoomStart, fileView.fileAtZoomEnd)) {
                return; // the range on its way already covers it
            }
            const requestId = nextRequestId('range', record.id);
            // Superseded requests keep their time until answered (an answer may still land); the host cancels most, so
            // the oldest are dropped once many are kept.
            rangeAskedAt.set(requestId, performance.now());
            if (rangeAskedAt.size > 256) {
                const oldest = rangeAskedAt.keys().next().value;
                if (oldest !== undefined) rangeAskedAt.delete(oldest);
            }
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
    syncSpecGearVisibility();
    attachEvents();
    // The help lists the keys of the view on show first: the entry table, the comparison (the track view's steps mode), or the lanes.
    const help = installHelpOverlay(document, window, STR, () => {
        if (entryScreen.isOpen() || entryScreen.hasFocus()) return 'entry';
        return stageMode?.active() ? 'compare' : 'lanes';
    });
    /** Tracks are analysed (waveform, spectrogram) for the files compared from the entry table, or the old screen's. */
    function selectTracks(filePaths: readonly string[], replace = false) {
        if (replace) selection.clear();
        const wanted = filePaths.filter(filePath => replace || !selection.has(filePath));
        if (!wanted.length && !replace) return;
        wanted.forEach(function (filePath) {
            trackStore.allowExplicitSelection(filePath);
            selection.add(filePath);
        });
        syncSelectionSummary();
        postSelectedFiles();
    }
    /** Shows files as tracks (each analysed if it is not yet), or takes them off the track view: one request for all of them. */
    function setFilesShown(filePaths: readonly string[], shown: boolean) {
        if (shown) {
            // A hidden track asked for again is shown again.
            const unhidden = filePaths.map(trackRecordForPath).filter((record): record is NonNullable<typeof record> => !!record?.runtime.hidden);
            unhidden.forEach(record => { record.runtime.hidden = false; });
            if (unhidden.length) {
                updateVisibility();
                scheduleRender();
            }
            selectTracks(filePaths);
        } else {
            const leaving = filePaths.filter(filePath => selection.has(filePath));
            if (leaving.length) {
                leaving.forEach(filePath => selection.remove(filePath));
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
    function playWhenReady() {
        const filePath = selection.takeReadyPlay(trackReady);
        if (!filePath) return;
        const trackId = trackStore.activeIds().find(id => trackStore.require(id).result.filePath === filePath);
        if (trackId) playback.toggle(trackId);
    }
    const entryScreen = createEntryScreen({
        document,
        window,
        strings: STR,
        dock: document.getElementById('entry-dock'),
        maximizedChanged(maximized) {
            // Under the maximized table the rest of the layout takes neither Tab nor clicks.
            ['selection-toolbar', 'selection-sidebar-rail', 'tree-resizer', 'selection-results-pane'].forEach(function (id) { document.getElementById(id)?.toggleAttribute('inert', maximized); });
            document.querySelector('#selection-sidebar > .panel-toggle')?.toggleAttribute('inert', maximized);
            scheduleRender();
        },
        stepsChanged: () => scheduleRender(),
        shownTracks() {
            const shown = new Map<string, boolean>();
            selection.paths.forEach(function (filePath: string) {
                const record = trackRecordForPath(filePath);
                shown.set(filePath, !!record && record.runtime.hidden);
            });
            return shown;
        },
        setShown: (filePath, shown) => setFilesShown([filePath], shown),
        setShownMany: (filePaths, shown) => setFilesShown(filePaths, shown),
        play(filePath) {
            const record = trackRecordForPath(filePath);
            if (record && !record.runtime.hidden) { playback.toggle(record.id); return; }
            // Not a track yet (or hidden): shown as one, it plays once analysed.
            selection.queuePlay(filePath);
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
            if (hidden && record.id === playback.trackId) playback.stop(record.id);
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
        help: () => help.open('entry'),
        openFiles(filePaths, comparison) {
            // The slotted files are compared in the track view, beside the tracks already shown, as a step of the Recipe.
            selectTracks(filePaths);
            stageEntrance = 'table';
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
            downloadEntryCsv(document, 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), fileName);
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
        window,
        strings: STR,
        post: message => messaging.post(message),
        // The steps the comparison runs are bounded by the tracks it compares, not every file of the table.
        recipe: () => entryScreen.recipes(comparedChannels()),
        slots: () => entryScreen.slots(),
        basePaths: (comparePath, group) => entryScreen.basePaths(comparePath, group),
        baseTitle: (comparePath, group) => entryScreen.baseTitle(comparePath, group),
        stageChannel: (path, comparePath, group) => entryScreen.stageChannel(path, comparePath, group),
        rowInfo: path => entryScreen.rowInfo(path),
        roleChip(path) {
            const i = state.results.findIndex(function (result) { return result.filePath === path; });
            // The legend's label names the channel already: the chip says the role alone.
            const role = trackRole(path);
            return roleChipHtml(path, role && { slot: role.slot, ch: null }, i >= 0 ? ownTrackColor(i) : '', STR);
        },
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
        // Esc goes back to where the comparison was opened: the entry table, or the tracks (playback, zoom and
        // selection as they were, the compared recording's lane in sight).
        back() {
            if (stageEntrance === 'table') { entryScreen.show(entryScreen.slots()); return; }
            const path = stageMode?.snapshot().comparing;
            setContentType('waveform');
            const record = path ? trackRecordForPath(path) : null;
            if (record) requestAnimationFrame(function () { document.querySelector('.track-row[data-track-id="' + record.id + '"]')?.scrollIntoView({ block: 'nearest' }); });
        },
        play(path, region) {
            const record = trackRecordForPath(path);
            if (!record || record.runtime.hidden) return;
            // Playback keeps to the comparison's region (the whole file without one): the tracks' selection
            // stands aside while comparing and comes back on leaving the comparison.
            if (playingPath() !== path) {
                const i = trackIndexForId(record.id);
                const start = region ? globalNormFromTrackTime(i, region.start) : null;
                const end = region ? globalNormFromTrackTime(i, region.end) : null;
                const next = start !== null && end !== null && end > start ? { start, end } : null;
                if (next?.start !== viewState.loop?.start || next?.end !== viewState.loop?.end) {
                    if (!selectionBeforeStage) selectionBeforeStage = { region: viewState.loop };
                    setLoopRegion(next);
                }
            }
            playback.toggle(record.id);
            scheduleRender();
        },
        playing: () => playingPath(),
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
    trackRole = filePath => entryScreen.trackRole(filePath);
    // A role chip (a track's header, the comparison's legend) sets the entry table's slots; the track stays.
    attachRoleChips(document, {
        setRole(filePath, slot) {
            entryScreen.setTrackRole(filePath, slot);
            scheduleRender();
        },
    }, STR);
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
        return spectrogramSettings.reanalyzeBusy;
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
    function waveformAxisLabelsForResult(result: ComparisonTrackState, _trackIndex: number) {
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
        const trackSnapshot = buildTrackSnapshot({
            tracks: trackStore.activeIds().map(function (trackId) {
                const record = trackStore.require(trackId);
                return {
                    trackId,
                    trackIndex: record.protocolIndex,
                    result: record.result,
                    offsetSeconds: record.runtime.offsetSeconds,
                    hidden: record.runtime.hidden,
                    waveformCoverage: record.waveformCoverage,
                    spectrumCanvasPresent: !!canvasById(document, trackSpectrumCanvasId(record.protocolIndex, 0)),
                };
            }),
            globalSpan: trackStore.globalSpan(),
            zoomStart: waveformView.start,
            zoomEnd: waveformView.end,
            spectrumView: spectrumView.state(),
            spectrogramDisplay: spectrogramSettings.display,
            peekSlice: track => peekSpectrumAtCursor(track.result, track.trackIndex, track.offsetSeconds, spectrumCursorNorm),
            waveformAxisLabels: track => waveformAxisLabelsForResult(track.result, track.trackIndex),
        });
        let latestSpectrogram;
        try {
            const firstChannel = state.results[0] ? displayedChannel(state.results[0]) : undefined;
            latestSpectrogram = latestSpectrogramSnapshot(firstChannel?.spectrogram, spectrogramSettings.settings);
        }
        catch { /* ignore */ }
        testBridge.publish({
                ...domSnapshotBase(document),
                zoomStart: waveformView.start,
                zoomEnd: waveformView.end,
                amplitudeZoomMinNorm: waveformView.amplitudeMin,
                amplitudeZoomMaxNorm: waveformView.amplitudeMax,
                rectZoomSelection: rectZoomSelection ? Object.assign({}, rectZoomSelection) : null,
                cursorNorm: viewState.cursor,
                visibleSpectrumTrackCount: trackSnapshot.visibleSpectrumTrackCount,
                contentType: contentType,
                spectrumBandsPerOctave: spectrumBandsPerOctave,
                reanalyzeBusy: isReanalyzeBusy(),
                latestSpectrogram: latestSpectrogram,
                axisLabels: trackSnapshot.axisLabels,
                displayOrder: trackStore.displayOrder.slice(),
                specFreqStart: spectrumView.freqStart,
                specFreqEnd: spectrumView.freqEnd,
                trackHeight: layout.trackHeight,
                spectrumOverlayHeight: layout.spectrumOverlayHeight,
                waveformMode: waveformMode,
                lastAnnounce: (function () {
                    const el = document.getElementById('a11y-announce');
                    return el ? (el.textContent || '') : '';
                })(),
                tracks: trackSnapshot.tracks,
                entry: entryScreen.snapshot(),
                comparison: stageMode?.snapshot() ?? null,
                ...shellSnapshot(document, audioFader.contextState()),
                lastPlayRejection: playback.lastPlayRejection,
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
                    cursorNorm: viewState.cursor,
                    visibleSpectrumTrackCount: 0,
                    contentType: contentType,
                    reanalyzeBusy: isReanalyzeBusy(),
                    axisLabels: { spectrumOverlay: [], spectrogramPerTrack: [], spectrumPerTrack: [], waveformPerTrack: [] },
                    displayOrder: trackStore.displayOrder.slice(),
                    specFreqStart: spectrumView.freqStart,
                    specFreqEnd: spectrumView.freqEnd,
                    trackHeight: layout.trackHeight,
                    spectrumOverlayHeight: layout.spectrumOverlayHeight,
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
        return selection.listedCount || !vscode.emptyMessage ? STR.emptyNoTracks : vscode.emptyMessage;
    }
    function buildDirectorySelectionLayout(resultsPaneHtml = buildResultsPane(selectionEmptyText())) {
        const warning = pythonEnvironmentState.status === 'warning';
        return selectionLayoutHtml({
            rootPath: selection.rootLabel,
            isEmpty: !selection.listedCount,
            sidebarCollapsed: layout.sidebarCollapsed,
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
        selection.showListing(label, filePaths.length, newFolder);
        const emptyMessage = function (text: string) {
            const el = document.querySelector('#empty-state p');
            if (el) {
                el.textContent = text;
            }
        };
        const folderButton = requiredElementById(document, 'selection-toolbar').querySelector<HTMLElement>('[data-action="open-folder"]');
        if (folderButton) {
            const folder = selectionFolderButton(Boolean(selection.rootLabel) || selection.listedCount > 0, STR);
            folderButton.textContent = folder.text;
            setHint(folderButton, folder.hint);
        }
        requiredElementById(document, 'directory-selection-layout').classList.toggle('is-empty', !selection.listedCount);
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
        layout.invalidateCanvasSizes();
    }
    function buildResultsPane(emptyMessage: string) {
        return resultsPaneHtml({
            tracksHtml: buildTrackRowsHtml(),
            toolbarHtml: buildToolbar(),
            audioHtml: buildAudioElements(),
            emptyMessage,
            axisWidth: AXIS_W,
            spectrumBandsPerOctave,
            spectrumCollapsed: layout.spectrumCollapsed,
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
            waveformLabel: STR.ariaWaveformCanvas.replace('{file}', result.fileName).replace('{channel}', channelLabel(result, channelIndex)),
            spectrogramLabel: STR.ariaSpectrogramCanvas.replace('{file}', result.fileName).replace('{channel}', channelLabel(result, channelIndex)),
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
            roleChipHtml: roleChipHtml(result.filePath, trackRole(result.filePath), ownTrackColor(i), STR),
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
        emitSpectrumZoom();
        resizeAllCanvases();
        renderRuler();
        renderStackedTracks();
        syncRoleChips();
        updateVisibility();
        updateOffsetDisplays();
        emitWaveformZoom();
        if (contentType !== 'stage') {
            scheduleRangeRequests();
        }
    }
    function resizeAllCanvases() {
        const lanes: { i: number; channelIndex: number; canvas: HTMLCanvasElement; wrap: HTMLElement }[] = [];
        state.results.forEach(function (result: ComparisonTrackState, i: number) {
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const canvas = canvasById(document, trackCanvasId(i, channelIndex));
                const wrap = canvas ? document.getElementById(trackCanvasWrapId(i, channelIndex)) : null;
                if (canvas && wrap) {
                    lanes.push({ i, channelIndex, canvas, wrap });
                }
            });
        });
        const rulerCanvas = canvasById(document, 'ruler-canvas');
        const rulerRow = rulerCanvas ? document.getElementById('ruler-row') : null;
        const rulerWidth = rulerRow ? rulerRow.clientWidth : null;
        const heights = laneHeights();
        // Every width is read before any canvas is resized, so the pass forces one layout rather than one per lane.
        readThenWrite(lanes, lane => lane.wrap.clientWidth || 800, function ({ i, channelIndex, canvas }, newW) {
            const cacheKey = newW + 'x' + heights.wave + 'x' + heights.spec + 'x' + channelIndex;
            const cacheIdx = i + ':' + channelIndex;
            if (!layout.canvasSizeChanged(cacheIdx, cacheKey)) {
                return;
            }
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
        if (rulerCanvas && rulerWidth !== null) {
            syncCanvasSize(rulerCanvas, rulerWidth - TRACK_HEADER_W - AXIS_W, 20);
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
        if (!fullWaveform) {
            return null;
        }
        // After a zoom out (or a pan past the fetched range) the part still fetched keeps its detail over the overview
        // until the new range lands, instead of the whole lane dropping to the coarsest lines for a moment.
        const overlapsView = !!c && !!cachedChannel && isRangeCacheDrawable(c, channelIndex) &&
            c.endNorm > Math.max(0, fileView.fileAtZoomStart) && c.startNorm < Math.min(1, fileView.fileAtZoomEnd);
        const detail = c && cachedChannel && overlapsView && !overviewIsSufficient(result, W, fileView)
            ? { waveform: cachedChannel, dataStart: c.startNorm, dataEnd: c.endNorm, amplitudeScale: amplitudeScale }
            : undefined;
        return { waveform: fullWaveform, dataStart: 0, dataEnd: 1, amplitudeScale: amplitudeScale, ...(detail ? { detail } : {}) };
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
            drawCursorOnCanvas(ctx, W, H, waveformCursorLineStyle(getComputedStyle(document.body).getPropertyValue('--text').trim()));
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
            const failure = trackRecordAtIndex(trackIndex)?.detailError;
            const message = failure && failure.settingsSignature === currentSettingsSignature()
                ? STR.spectrogramFailed.replace('{reason}', () => middleEllipsis(failure.message.split('\n')[0], 120))
                : STR.spectrogramLoading;
            drawCanvasMessage(ctx, W, H, message, '11px sans-serif', drawTheme().mutedColor);
            return;
        }
        const spec = ch.spectrogram;
        const { offsetNorm: trackStart, trackDurRatio } = trackTimelinePlacement(offsetSeconds, result.durationSeconds, trackStore.globalSpan());
        const { dbLo, dbHi, maxFrequencyHz: maxFreq, minFrequencyHz: minFreq } = spectrogramDisplayBounds(spec, spectrogramSettings.display, spectrogramAutoBounds(spec));
        const plotW = spectrogramPlotWidth(W);
        const record = trackRecordAtIndex(trackIndex);
        if (!record) {
            return;
        }
        const cacheId = record.id + ':' + channelIndex;
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
        if (playback.isRunning()) {
            return;
        }
        const band = analysisWindowBand(trackIndex, channelIndex);
        if (band) {
            drawAnalysisWindowBand(ctx, band, waveformView.timeRange(), W, H);
        }
    }
    function drawCursorOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number, style = CURSOR_LINE_STYLE) {
        drawDashedTimeLine(ctx, viewState.cursor, waveformView.timeRange(), W, H, style);
    }
    function drawHoverLineOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        if (viewState.hover !== null) {
            drawDashedTimeLine(ctx, viewState.hover, waveformView.timeRange(), W, H, HOVER_LINE_STYLE);
        }
    }
    function drawLoopRegionOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        if (!viewState.loop) {
            return;
        }
        if (typeof window.paintLoopRegion === 'function') {
            window.paintLoopRegion(ctx, W, H, viewState.loop.start, viewState.loop.end, waveformView.start, waveformView.end);
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
                const isMuted = trackStore.require(trackId).runtime.hidden;
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
            const isActive = playback.isActive(trackId);
            const isPlaying = isActive && playback.isRunning();
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
        const trackId = playback.playingTrackId();
        return trackId === null ? null : trackStore.require(trackId).result.filePath ?? null;
    }
    function updateLoopBadge() {
        const badge = document.getElementById('loop-badge');
        if (!badge) {
            return;
        }
        badge.style.display = (viewState.loop && playback.isElementPlaying()) ? 'inline' : 'none';
        updateLoopTimeDisplay();
    }
    function updateLoopTimeDisplay() {
        const el = document.getElementById('loop-time-display');
        if (!el) {
            return;
        }
        if (!viewState.loop) {
            el.style.display = 'none';
            return;
        }
        el.textContent = loopRegionClockText(viewState.loop, trackStore.globalSpan());
        el.style.display = 'inline';
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
            playback.attachAudio(audio, trackId, i);
        });
    }
    // ── Events ──
    function attachEvents() {
        if (isSelectionMode) {
            attachDirectorySelectionEvents();
        }
        const tracksWrapper = requiredElementById(document, 'tracks-wrapper');
        // Lanes scrolled into view are drawn then.
        tracksWrapper.addEventListener('scroll', function () { scheduleRender(); scheduleSpectrumRefresh('scroll'); }, { passive: true });
        const toolbarHandlers = { onAction: handleToolbarAction };
        attachToolbarActions(document.getElementById('toolbar'), toolbarHandlers);
        attachToolbarActions(document.getElementById('spectrum-zoom-toolbar'), toolbarHandlers);
        attachToolbarActions(document.getElementById('spectrum-section-header'), toolbarHandlers);
        document.getElementById('spectrum-section-header')?.addEventListener('click', function (e) {
            const target = eventTarget(e);
            if (layout.spectrumCollapsed && !(target && typeof target.closest === 'function' && target.closest('[data-action]'))) {
                setSpectrumCollapsed(false);
            }
        });
        syncSpectrumHeaderHint();
        keyRouterFor(window).add({
            layer: 'lanes',
            keydown(e) {
                // A text field (the offset editor) uses Esc to cancel its own edit.
                if (e.key !== 'Escape' || !layout.spectrumMaximized || hasOpenOverlay() || isTextEntryTag(eventTarget(e)?.tagName)) return false;
                setSpectrumMaximized(false);
                return true;
            },
        });
        // Double-clicking a panel's resize edge folds it, the shortcut for its toggle button.
        document.addEventListener('dblclick', function (e) {
            const target = eventTarget(e);
            if (!target || typeof target.closest !== 'function') {
                return;
            }
            if (target.closest('[data-action="spectrum-height-drag"]')) {
                setSpectrumCollapsed(!layout.spectrumCollapsed);
            }
            else if (target.closest('#tree-resizer')) {
                layout.setSidebarCollapsed(true);
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
                if (!viewState.loop) {
                    return;
                }
                if (!navigator.clipboard || !navigator.clipboard.writeText) {
                    return;
                }
                navigator.clipboard.writeText(loopRegionClockText(viewState.loop, trackStore.globalSpan())).catch(function () { });
            });
        }
        attachTrackLaneActions(tracksWrapper, {
            trackIdFromElement,
            trackIndexForId: (trackId) => trackStore.protocolIndexForId(trackId),
        }, {
            'toggle-playback': ({ trackId }) => playback.toggle(trackId),
            'toggle-mute': ({ trackIndex, target }) => {
                if (trackIndex === null) {
                    return;
                }
                const runtime = trackRuntimeAt(trackIndex);
                runtime.muted = !runtime.muted;
                playback.setMuted(trackIndex, runtime.muted);
                target.setAttribute('aria-pressed', String(runtime.muted));
                target.textContent = runtime.muted ? '🔇' : '🔊';
            },
            'stop-playback': ({ trackId }) => playback.stop(trackId),
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
                    if (layout.spectrumCollapsed) setSpectrumCollapsed(false);
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
        tracksWrapper.addEventListener('pointerdown', function (e) {
            const target = eventTarget(e);
            if (e.button !== 0 || !target || typeof target.closest !== 'function' || !target.closest('.track-split')) return;
            splitDrag = { startY: e.clientY, startShare: layout.waveShare };
            document.body.classList.add('is-split-resizing');
            e.preventDefault();
        });
        document.addEventListener('pointermove', function (e) {
            if (!splitDrag) return;
            layout.setWaveShare(splitDrag.startShare + (e.clientY - splitDrag.startY) / layout.trackHeight, false);
        });
        const endSplitDrag = function () {
            if (!splitDrag) return;
            splitDrag = null;
            document.body.classList.remove('is-split-resizing');
            layout.persistWaveShare();
            separatorKeys.sync();
        };
        document.addEventListener('pointerup', endSplitDrag);
        document.addEventListener('pointercancel', endSplitDrag);
        // The resize edges from the keyboard: a focused edge moves with the arrows, and says its value.
        const separatorKeys = attachSeparatorKeys(document, {
            range(handle) {
                const action = handle.getAttribute('data-action');
                if (action === 'track-height-drag') return { now: layout.trackHeight, min: TRACK_HEIGHT_MIN, max: TRACK_HEIGHT_MAX, step: 8 };
                if (action === 'spectrum-height-drag') return layout.spectrumCollapsed || layout.spectrumMaximized ? null : { now: layout.spectrumOverlayHeight, min: SPECTRUM_HEIGHT_MIN, max: spectrumHeightLimit(), step: 8 };
                if (action === 'track-split-drag') return { now: layout.waveShare * 100, min: WAVE_SHARE_MIN * 100, max: WAVE_SHARE_MAX * 100, step: 5 };
                if (action === 'pair-divider-drag') return { now: pairPanel.split * 100, min: PAIR_SPLIT_MIN * 100, max: PAIR_SPLIT_MAX * 100, step: 5 };
                const sidebar = handle.id === 'tree-resizer' ? document.getElementById('selection-sidebar') : null;
                return sidebar ? { now: sidebar.getBoundingClientRect().width, min: SIDEBAR_WIDTH_MIN, max: window.innerWidth - SIDEBAR_WIDTH_SPARE, step: 16 } : null;
            },
            set(handle, value) {
                const action = handle.getAttribute('data-action');
                if (action === 'track-height-drag') layout.setTrackHeight(value);
                else if (action === 'spectrum-height-drag') setSpectrumHeight(value);
                else if (action === 'track-split-drag') layout.setWaveShare(value / 100, true);
                else if (action === 'pair-divider-drag') pairPanel.setSplit(value / 100);
                else {
                    // As a drag let go past 60 %: the table is maximized and the panel keeps the width it had.
                    const sidebar = document.getElementById('selection-sidebar');
                    if (sidebar && sidebarMaximizes(value)) entryScreen.setMaximized(true);
                    else if (sidebar) sidebar.style.width = value + 'px';
                }
            },
            growKey(handle) {
                const action = handle.getAttribute('data-action');
                return action === 'spectrum-height-drag' ? 'ArrowUp' : action === 'track-height-drag' || action === 'track-split-drag' ? 'ArrowDown' : 'ArrowRight';
            },
        });
        const stackedWrap = document.getElementById('stacked-wrap');
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
            if (!layout.spectrumCollapsed && !layout.spectrumMaximized && layout.spectrumOverlayHeight > spectrumHeightLimit()) {
                setSpectrumHeight(layout.spectrumOverlayHeight);
            }
            scheduleRender();
            scheduleSpectrumRefresh('interactive');
        }, typeof ResizeObserver === 'function' ? ResizeObserver : undefined);
        // A theme switched while open (VS Code changes the body's class): the canvases repaint in its colours.
        if (typeof MutationObserver === 'function') {
            // The runtime's own body classes (is-height-resizing, is-stage-view, …) change it too: only a change of light/dark repaints.
            let lightTheme = isLightTheme();
            new MutationObserver(function () {
                if (isLightTheme() === lightTheme) return;
                lightTheme = !lightTheme;
                useLightRoleColors(lightTheme);
                document.querySelectorAll('.track-header .role-chip-face').forEach(function (face) { face.removeAttribute('data-role'); });
                syncRoleChips();
                scheduleRender();
                scheduleSpectrumRefresh('interactive');
            }).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme-kind'] });
        }
        attachAudioEvents();
        updatePlaybackButtons();
        function attachTrackCanvasFocusEvents() {
            document.querySelectorAll<HTMLElement>('.track-canvas').forEach(function (canvas) {
                attachCanvasFocusHint(canvas, hintFooter, STR.cursorHelpKeys);
            });
        }
        attachGlobalKeyboardListeners(keyRouterFor(window), document, {
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
                    : playback.trackId ?? trackStore.activeIds()[0];
                if (trackId) {
                    playback.toggle(trackId);
                }
            },
            stepCursor(direction, shiftKey, active) {
                if (!active) {
                    return;
                }
                const step = arrowCursorStep(shiftKey, trackStore.globalSpan().spanSec, waveformView.start, waveformView.end, (active as HTMLCanvasElement).width || 800);
                moveCursor(viewState.cursor + direction * step);
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
        const selectionLayout = document.getElementById('directory-selection-layout');
        if (!selectionLayout) {
            return;
        }
        syncSelectionSummary();
        selectionLayout.addEventListener('click', function (event) {
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
        const move = function (event: PointerEvent) {
            if (dragging) sidebar.style.width = Math.max(SIDEBAR_WIDTH_MIN, Math.min(window.innerWidth - SIDEBAR_WIDTH_SPARE, startWidth + event.clientX - startX)) + 'px';
        };
        const up = function () {
            dragging = false;
            resizer.classList.remove('is-dragging');
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            document.removeEventListener('pointercancel', up);
            if (sidebarMaximizes(sidebar.getBoundingClientRect().width)) {
                sidebar.style.width = startWidth + 'px';
                entryScreen.setMaximized(true);
            }
        };
        resizer.addEventListener('pointerdown', function (event) {
            if (event.button !== 0) return;
            dragging = true;
            startX = event.clientX;
            startWidth = sidebar.getBoundingClientRect().width;
            resizer.classList.add('is-dragging');
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up);
            document.addEventListener('pointercancel', up);
            event.preventDefault();
        });
    }
    function handleSelectionAction(action: string) {
        if (action === 'open-file' || action === 'open-folder' || action === 'select-python-environment') {
            handleToolbarAction(action);
            return true;
        }
        if (action === 'toggle-selection-sidebar') {
            layout.setSidebarCollapsed(!layout.sidebarCollapsed);
            return true;
        }
        return false;
    }
    /** The folded side panel's rail counts the tracks shown out of the files listed. */
    function syncSelectionSummary() {
        const railCountEl = document.getElementById('selection-rail-count');
        if (railCountEl) {
            railCountEl.textContent = selection.paths.length + '/' + selection.listedCount;
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
        messaging.post({ type: 'analyze-selected-files', ...selection.nextRequest(runtimeSessionId, clearAll) });
    }
    /** The cursor spectrum's state before the steps view folded it (it belongs to the waveform view): restored on leaving. */
    let spectrumBeforeStage: boolean | null = null;
    function setContentType(next: 'waveform' | 'stage') {
        // The steps view takes the height for its plots, so both their axes stay in sight.
        if (next === 'stage' && contentType !== 'stage') {
            spectrumBeforeStage = layout.spectrumCollapsed;
            if (!layout.spectrumCollapsed) setSpectrumCollapsed(true);
        } else if (next !== 'stage' && contentType === 'stage' && spectrumBeforeStage !== null) {
            if (layout.spectrumCollapsed !== spectrumBeforeStage) setSpectrumCollapsed(spectrumBeforeStage);
            spectrumBeforeStage = null;
        }
        if (next !== 'stage' && selectionBeforeStage) {
            setLoopRegion(selectionBeforeStage.region);
            selectionBeforeStage = null;
        }
        contentType = next;
        stageMode?.setActive(next === 'stage');
        document.body.classList.toggle('is-stage-view', next === 'stage');
        layout.invalidateCanvasSizes();
        buttonMatching(document, '[data-action="content-waveform"]')?.classList.toggle('is-active', next === 'waveform');
        buttonMatching(document, '[data-action="content-stage"]')?.classList.toggle('is-active', next === 'stage');
        syncSpecGearVisibility();
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
    function setSpectrumCollapsed(next: boolean) {
        layout.setSpectrumCollapsed(next);
    }
    function setSpectrumMaximized(next: boolean) {
        layout.setSpectrumMaximized(next);
    }
    /** The DOM and the views follow each layout change. */
    function followLayoutChange(change: LayoutChange): void {
        switch (change) {
            case 'track-height':
                emitSpectrumZoom();
                updatePlaybackButtons();
                scheduleRender();
                scheduleSpectrumRefresh('immediate');
                return;
            case 'spectrum-height':
                emitSpectrumZoom();
                syncSpectrumCanvasCssHeight();
                scheduleSpectrumRefresh('immediate');
                return;
            case 'wave-share':
                scheduleRender();
                return;
            case 'sidebar-collapsed': {
                const next = layout.sidebarCollapsed;
                const selectionLayout = document.getElementById('directory-selection-layout');
                selectionLayout?.classList.toggle('sidebar-collapsed', next);
                const button = selectionLayout?.querySelector<HTMLElement>('#selection-sidebar [data-action="toggle-selection-sidebar"]');
                if (button) {
                    syncPanelToggle(button, 'sidebar', next, STR);
                }
                return;
            }
            case 'spectrum-collapsed': {
                const next = layout.spectrumCollapsed;
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
                return;
            }
            case 'spectrum-maximized': {
                const next = layout.spectrumMaximized;
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
                return;
            }
        }
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
        if (layout.spectrumCollapsed) {
            setHint(header, STR.hintExpandSpectrum);
        }
        else {
            header.removeAttribute('data-hint');
            header.removeAttribute('aria-description');
        }
    }
    function toggleFollowCursor() {
        playback.setFollow(!playback.follow);
        scheduleRender();
    }
    function handleToolbarAction(action: string) {
        const toolbarActions: Record<string, () => void> = {
            'open-file': () => messaging.post({ type: 'select-target', targetKind: 'file' }),
            'open-folder': () => messaging.post({ type: 'select-target', targetKind: 'directory' }),
            'select-python-environment': () => messaging.post({ type: 'select-python-environment' }),
            'content-waveform': () => setContentType('waveform'),
            'content-stage': () => {
                stageEntrance = 'tracks';
                // A selection on the tracks (found by listening) is what to compare: it becomes the region, in the files' time.
                // In the time of the recording compared (slot 1–3 first), each track having its own offset on the timeline;
                // a recording the selection does not reach gives way to the next one it does.
                const slotted = entryScreen.slots();
                const shown = (path: string | null | undefined) => { const record = path ? trackRecordForPath(path) : null; return record && !record.runtime.hidden ? record : null; };
                const candidates = [
                    ...[1, 2, 3].map(slot => shown(slotted[slot])),
                    ...trackStore.activeIds().map(id => trackStore.require(id)).filter(record => !record.runtime.hidden),
                ].filter(<T,>(record: T | null): record is T => record !== null);
                if (viewState.loop && contentType !== 'stage') {
                    const selection = viewState.loop;
                    const range = candidates.map(record => {
                        const mapping = getTrackTimeMapping(trackIndexForId(record.id));
                        return mapping ? { start: trackTimeFromGlobalNorm(mapping, selection.start), end: trackTimeFromGlobalNorm(mapping, selection.end) } : null;
                    }).find(item => item && item.end > item.start);
                    if (range) stageMode?.importRegion(range);
                }
                setContentType('stage');
            },
            'zoom-in': zoomIn,
            'zoom-out': zoomOut,
            'zoom-reset': resetZoom,
            'spec-zoom-in': specZoomIn,
            'spec-zoom-out': specZoomOut,
            'spec-zoom-reset': specZoomReset,
            'spectrum-fft': () => setSpectrumBands(0),
            'spectrum-octave-1': () => setSpectrumBands(1),
            'spectrum-octave-3': () => setSpectrumBands(3),
            'toggle-spectrum-panel': () => setSpectrumCollapsed(!layout.spectrumCollapsed),
            'toggle-spectrum-maximize': () => setSpectrumMaximized(!layout.spectrumMaximized),
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
            layout.setTrackHeight(value);
        }
        else {
            setSpectrumHeight(value);
        }
    }
    /** Maximized, the plot fills whatever its wrap gets from the flex layout; otherwise it keeps the height the user set. */
    function effectiveSpectrumHeight(): number {
        const wrap = layout.spectrumMaximized ? document.getElementById('spectrum-overlay-wrap') : null;
        if (!wrap || !wrap.clientHeight) {
            return layout.spectrumOverlayHeight;
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
        // An unchanged height still has its canvas follow the maximized pane.
        if (!layout.setSpectrumHeight(value, spectrumHeightLimit())) {
            syncSpectrumCanvasCssHeight();
        }
    }
    function disableFollowCursor() {
        playback.setFollow(false);
    }
    function zoomToSelection() {
        if (viewState.loop) {
            disableFollowCursor();
            waveformView.showRegion(viewState.loop, 0.05);
            scheduleRender();
        }
    }
    function updateZoomToSelectionBtn() {
        const btn = buttonById(document, 'btn-zoom-to-selection');
        if (btn) {
            btn.disabled = !viewState.loop;
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
        try { renderStackedTracks(); checkAndRequestRanges(); renderTrackSpectra(); } finally { drawEveryLane = false; }
    }
    /** The open spectrogram, zoom-detail and cursor-spectrum requests. */
    function openDetailRequestIds(): Set<string> {
        const ids = new Set<string>();
        state.results.forEach(function (_: ComparisonTrackState, i: number) {
            const requests = trackRecordAtIndex(i)?.requests;
            ['detail', 'slice'].forEach(function (slot) {
                const pending = requests?.pending(slot);
                if (pending) ids.add(pending.requestId);
            });
            // A redraw asks again for zoom detail only past the range on its way or after RANGE_RETRY_MS: the same span is the same wait.
            const range = requests?.pending('range');
            if (range) ids.add('range:' + i + ':' + range.key);
        });
        spectrumRequests.openRequestIds().forEach(function (id) { ids.add(id); });
        return ids;
    }
    /** Whether any of the requests an export waits for is still open (one asked again after an error is not waited for). */
    function anyStillOpen(waitFor: Set<string>): boolean {
        for (const id of openDetailRequestIds()) {
            if (waitFor.has(id)) return true;
        }
        return false;
    }
    function exportPng() {
        // The image holds every shown lane, also those scrolled out of view: drawing them asks for the spectrograms, zoom
        // detail and cursor spectra they lack, and the image is composed once those have arrived (or after a while, as far as they got).
        renderEveryLane();
        const failed = STR.announceExportPngFailed || 'PNG export failed: no visible canvases';
        if (visibleExportCanvases(document.getElementById('tracks-wrapper')).length === 0) {
            messaging.post({ type: 'show-info', message: failed });
            taskStatus(failed, 'failed');
            return;
        }
        announce(STR.announceExportPngStarted || 'PNG export started');
        taskStatus(STR.exportPngBusy, 'busy');
        composePngWhenDetailed(openDetailRequestIds(), Date.now() + 30000, failed);
    }
    function composePngWhenDetailed(waitFor: Set<string>, deadline: number, failed: string) {
        if (anyStillOpen(waitFor) && Date.now() < deadline) {
            setTimeout(function () { composePngWhenDetailed(waitFor, deadline, failed); }, 100);
            return;
        }
        renderEveryLane();
        const wrapper = document.getElementById('tracks-wrapper');
        const canvases = visibleExportCanvases(wrapper);
        setTimeout(function () {
            const composed = composeTrackCanvases(document, canvases, function (canvas) {
                const axisId = canvas.id ? canvas.id.replace(/^track-canvas-/, 'track-axis-canvas-').replace(/^track-spec-canvas-/, 'track-spec-axis-canvas-') : '';
                return axisId && axisId !== canvas.id && wrapper ? wrapper.querySelector('#' + axisId) : null;
            }, AXIS_W);
            if (!composed) {
                messaging.post({ type: 'show-info', message: failed });
                taskStatus(failed, 'failed');
                return;
            }
            triggerAnchorDownload(document, composed.toDataURL('image/png'), 'waveform-export.png');
            taskStatus(STR.exportPngDone.replace('{name}', 'waveform-export.png'), 'done');
        }, 0);
    }
    function exportCsv() {
        if (state.results.length === 0) {
            messaging.post({ type: 'show-info', message: STR.announceExportCsvFailed });
            taskStatus(STR.announceExportCsvFailed, 'failed');
            return;
        }
        // Like the PNG: lanes out of view ask for their cursor spectra first, and the file is written once those arrived.
        spectrumCursorNorm = viewState.cursor;
        requestEveryCursorSpectrum();
        announce(STR.announceExportCsvStarted || 'CSV export started');
        taskStatus(STR.exportCsvBusy, 'busy');
        writeCsvWhenDetailed(openDetailRequestIds(), Date.now() + 30000, viewState.cursor);
    }
    /** Asks for the cursor spectrum of every shown track, whether or not its lane or its small spectrum is on screen. */
    function requestEveryCursorSpectrum() {
        drawEveryLane = true;
        try {
            trackStore.activeIds().forEach(function (trackId) {
                const record = trackStore.require(trackId);
                if (record.runtime.hidden) return;
                channelsForResult(record.result).forEach(function (_, channelIndex: number) {
                    extractSpectrumAtCursor(record.result, record.protocolIndex, record.runtime.offsetSeconds, viewState.cursor, channelIndex);
                });
            });
        } finally { drawEveryLane = false; }
    }
    function writeCsvWhenDetailed(waitFor: Set<string>, deadline: number, exportCursorNorm: number) {
        // The cursor moved while waiting: every track is asked again at the new position, so the file holds one cursor.
        if (viewState.cursor !== exportCursorNorm) {
            spectrumCursorNorm = viewState.cursor;
            requestEveryCursorSpectrum();
            writeCsvWhenDetailed(openDetailRequestIds(), deadline, viewState.cursor);
            return;
        }
        let missing = false;
        const tracks: Array<{ name: string; slice: SpectrumSlice }> = [];
        trackStore.activeIds().forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            const i = record.protocolIndex;
            if (record.runtime.hidden) {
                return;
            }
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const slice = extractSpectrumAtCursor(result, i, trackRuntimeAt(i).offsetSeconds, viewState.cursor, channelIndex);
                // A lane out of view may still hold the spectrum of an earlier cursor position while this one is on its way.
                const cached = record.spectrumSliceCache.get(channelIndex);
                const stale = cached?.settingsSignature === currentSpectrumDataSignature() && isSpectrumSliceRequestPendingForCursor(i, viewState.cursor);
                if (stale || !slice || !slice.values || slice.values.length === 0) {
                    missing = missing || stale || trackLocalCursorNorm(i, viewState.cursor) !== null;
                    return;
                }
                tracks.push({ name: (result.fileName || ('track' + (i + 1))) + ' ' + channelLabel(result, channelIndex), slice: slice });
            });
        });
        // A spectrum still on its way: write once the requests the export asked for are answered (or after a while).
        if (missing && anyStillOpen(waitFor) && Date.now() < deadline) {
            setTimeout(function () { writeCsvWhenDetailed(waitFor, deadline, exportCursorNorm); }, 100);
            return;
        }
        if (tracks.length === 0) {
            messaging.post({ type: 'show-info', message: STR.announceExportCsvFailed || 'CSV export failed: no spectrum data at cursor' });
            taskStatus(STR.announceExportCsvFailed, 'failed');
            return;
        }
        const csv = buildSpectrumCsv(tracks);
        taskStatus(STR.exportCsvDone.replace('{name}', 'spectrum-export.csv'), 'done');
        if (messaging.downloadFile(csv, 'spectrum-export.csv', 'text/csv;charset=utf-8')) return;
        triggerAnchorDownload(document, 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), 'spectrum-export.csv');
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
        if (!viewState.loop) {
            messaging.post({ type: 'show-info', message: STR.exportWavNoLoop });
            return;
        }
        if (typeof state === 'undefined' || !state.results || state.results.length === 0) {
            return;
        }
        const span = trackStore.globalSpan();
        const startSec = span.startSec + viewState.loop.start * span.spanSec;
        const endSec = span.startSec + viewState.loop.end * span.spanSec;
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
            startNorm: viewState.loop.start,
            endNorm: viewState.loop.end,
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
        if (!viewState.loop) return undefined;
        const gs = trackStore.globalSpan();
        return { globalStartSec: gs.startSec + viewState.loop.start * gs.spanSec, globalEndSec: gs.startSec + viewState.loop.end * gs.spanSec };
    }
    function exportReport() {
        const reportRecords = _activeReportRecords();
        if (reportRecords.length === 0) {
            messaging.post({ type: 'show-info', message: STR.exportReportNoData });
            return;
        }
        const mdContent = buildMarkdownReport(_reportTracks(), _reportLoopRegion(), new Date());
        const nbContent = buildNotebook(_reportTracks());
        const defaultName = (reportRecords[0].result.fileName || 'analysis').replace(/.[^.]+$/, '');
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
        const display = spectrogramSettings.display;
        const bounds = spectrogramDisplayBounds(spec, display, spectrogramAutoBounds(spec));
        const field = (value: number) => String(Number(value.toPrecision(4)));
        // An edge left as shown keeps its setting (auto, or a top clamped to this lane's Nyquist), so the clicked lane's
        // own range is not set on every lane.
        const typed = (value: number | null, shown: number, setting: number | null | undefined) =>
            value !== null && field(value) === field(shown) ? setting ?? null : value;
        if (axis === 'level') {
            waveformRangePopover.open({
                axisLabel: STR.specRangeAxisDb,
                horizontal: false,
                min: field(bounds.dbLo),
                max: field(bounds.dbHi),
                clientX, clientY,
                apply(min, max) {
                    setSpectrogramDisplay({ ...display, dbMin: typed(min, bounds.dbLo, display.dbMin), dbMax: typed(max, bounds.dbHi, display.dbMax) });
                },
                auto() {
                    setSpectrogramDisplay({ ...display, dbMin: null, dbMax: null });
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
                setSpectrogramDisplay({ ...display, minFrequencyHz: bottom, maxFrequencyHz: typed(max, bounds.maxFrequencyHz, display.maxFrequencyHz) });
            },
            auto() {
                setSpectrogramDisplay({ ...display, minFrequencyHz: null, maxFrequencyHz: null });
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
    function handlePanWheel(e: WheelEvent, swipe: boolean): void {
        disableFollowCursor();
        if (!swipe) {
            const direction = wheelStepDirection(e);
            if (direction !== 0) {
                waveformView.pan(direction);
                scheduleRender();
            }
            return;
        }
        // Over a lane the plot's own width, so the waveform follows the fingers; elsewhere the lanes' width.
        const target = eventTarget(e);
        const canvas = target && typeof target.closest === 'function' ? target.closest<HTMLCanvasElement>('.track-canvas') : null;
        const wrapper = document.getElementById('tracks-wrapper');
        const width = canvas
            ? (canvas.classList.contains('track-spec-canvas') ? spectrogramPlotWidth(canvas.width) : canvas.width)
            : (wrapper ? wrapper.getBoundingClientRect().width - TRACK_HEADER_W : 0);
        if (width <= 0) {
            return;
        }
        waveformView.panBy(wheelPanPixels(e, width) / width);
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
        const gripType = rectZoom ? null : loopGripAt(viewState.loop, norm, waveformView.span());
        const action = gripType ? STR.tooltipLoopResize
            : e.shiftKey ? STR.tooltipLoopOrShift
            : rectZoom ? STR.hintRectZoomDrag
            : viewState.loop && norm >= viewState.loop.start && norm <= viewState.loop.end ? STR.tooltipLoopClear
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
            const gripType = rectZoom ? null : loopGripAt(viewState.loop, norm, waveformView.span());
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
                    emitWaveformZoom();
                }
                else {
                    const region = loopRegionForDrag(dragState.dragType, dragState.startNorm, viewState.loop, norm);
                    if (region) setLoopRegion(region);
                }
                updateCursorDisplay(norm);
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
            emitWaveformZoom();
            followPointerAfterDrag(e);
            scheduleRender();
            return;
        }
        if (hadDrag) {
            scheduleSpectrumRefresh('immediate');
            followPointerAfterDrag(e);
        }
    }
    /** The readout follows the pointer again from where the drag ended, in the view it leaves (a box zoom's zoomed one), or shows the cursor off the lanes. */
    function followPointerAfterDrag(e: MouseEvent): void {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const canvas = under instanceof HTMLCanvasElement && under.classList.contains('track-canvas') ? under : null;
        const hit = canvas ? trackCanvasTimeHit(canvas, e.clientX) : null;
        if (hit) renderWithHoverAt(hit.norm);
        else { clearHover(); updateCursorDisplay(viewState.cursor); }
    }
    function renderWithHoverAt(norm: number) {
        viewState.setHover(norm);
    }
    function clearHover() {
        if (viewState.clearHover()) {
            hintFooter.clear();
        }
    }
    function updateCursorDisplay(norm: number) {
        const gs = trackStore.globalSpan();
        const t = gs.startSec + norm * gs.spanSec;
        const el = document.getElementById('cursor-display');
        if (el) {
            el.textContent = formatClockTime(t);
        }
    }
    /** The cursor spectrum a track draws; when it lacks the current one, it asks the host for it. */
    function extractSpectrumAtCursor(result: ComparisonTrackState, trackIndex: number, offsetSeconds: number, cursorNormValue: number, channelIndex = 0): SpectrumSlice | null {
        return cursorSpectrumFor(result, trackIndex, offsetSeconds, cursorNormValue, channelIndex, requestSpectrumSlice);
    }
    /** The cursor spectrum a track draws, from what it already has: it never asks the host. */
    function peekSpectrumAtCursor(result: ComparisonTrackState, trackIndex: number, offsetSeconds: number, cursorNormValue: number): SpectrumSlice | null {
        return cursorSpectrumFor(result, trackIndex, offsetSeconds, cursorNormValue, 0, () => undefined);
    }
    function cursorSpectrumFor(result: ComparisonTrackState, trackIndex: number, offsetSeconds: number, cursorNormValue: number, channelIndex: number, requestSlice: (trackIndex: number, cursorNorm: number) => void): SpectrumSlice | null {
        const chIdx = Number.isInteger(channelIndex) ? channelIndex : 0;
        return extractCursorSpectrum(result, offsetSeconds, cursorNormValue, trackStore.globalSpan(), {
            trackIndex,
            channelIndex: chIdx,
            cached: trackIndex >= 0 ? trackRecordAtIndex(trackIndex)?.spectrumSliceCache.get(chIdx) ?? null : null,
            settingsSignature: currentSpectrumDataSignature(),
            bands: spectrumBandsPerOctave !== 0,
            requestSlice,
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
            const slice = extractSpectrumAtCursor(result, trackIndex, record.runtime.offsetSeconds, viewState.cursor, channelIndex);
            const nextNorm = slice ? steppedTrackSpectrumHoverNorm(slice, spectrumHover.norm, spectrumView.freqStart, spectrumView.freqEnd, deltaIdx) : null;
            if (nextNorm !== null) {
                spectrumHover.norm = nextNorm;
            }
            return;
        }
        const slices = spectrumSeriesAt(viewState.cursor).series;
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

    /** Linked, the lanes' cursor spectra in one unit (the channel's, whichever source a slice came from) share the dB axis of all their slices. */
    function linkedTrackSpectrumDb(): Map<string, { minDb: number; maxDb: number }> | null {
        if (!scalesLinked) {
            return null;
        }
        const ranges = new Map<string, { minDb: number; maxDb: number }>();
        displayedLanes().forEach(function ({ record, channelIndex, ch }) {
            // A folded panel leaves lanes out of view on the spectrum of an earlier cursor: they do not set the shared axis.
            if (layout.spectrumCollapsed && !laneInView(record.protocolIndex)) {
                return;
            }
            const slice = extractSpectrumAtCursor(record.result, record.protocolIndex, record.runtime.offsetSeconds, spectrumCursorNorm, channelIndex);
            if (slice && Number.isFinite(slice.minDb) && Number.isFinite(slice.maxDb)) {
                const key = amplitudeUnitKey(ch);
                const range = ranges.get(key);
                ranges.set(key, range ? { minDb: Math.min(range.minDb, slice.minDb), maxDb: Math.max(range.maxDb, slice.maxDb) } : { minDb: slice.minDb, maxDb: slice.maxDb });
            }
        });
        return ranges;
    }
    function renderTrackSpectra() {
        const linkedDb = linkedTrackSpectrumDb();
        const lanes: { trackId: TrackId; result: ComparisonTrackState; i: number; channelIndex: number; canvas: HTMLCanvasElement; wrap: HTMLElement }[] = [];
        trackStore.activeIds().forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const result = record.result;
            const i = record.protocolIndex;
            if (!laneInView(i)) {
                return;
            }
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const canvas = canvasById(document, trackSpectrumCanvasId(i, channelIndex));
                if (!canvas) {
                    return;
                }
                const wrap = document.getElementById(trackSpectrumWrapId(i, channelIndex));
                if (!wrap) {
                    return;
                }
                lanes.push({ trackId, result, i, channelIndex, canvas, wrap });
            });
        });
        // Every spectrum's width is read before any canvas is resized, so the pass forces one layout rather than one per lane.
        readThenWrite(lanes, function ({ wrap }) {
            const wrapStyle = (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function')
                ? window.getComputedStyle(wrap)
                : null;
            return wrapStyle && wrapStyle.display === 'none' ? null : wrap.clientWidth || 180;
        }, function ({ trackId, result, i, channelIndex, canvas }, w) {
            if (w === null) {
                return;
            }
            const record = trackStore.require(trackId);
            const prevW = canvas.width;
            const prevH = canvas.height;
            syncCanvasSize(canvas, w, laneOuterHeight());
            const paintedByChannel = record.spectrumPainted;
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
            const shared = ownSlice && linkedDb ? linkedDb.get(amplitudeUnitKey(channelsForResult(result)[channelIndex])) : undefined;
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
    }
    function renderOverlaySpectrum() {
        const canvas = canvasById(document, 'spectrum-overlay-canvas');
        if (!canvas) {
            return;
        }
        const visibleResults = trackStore.displayOrder.map(function (trackId) { return trackStore.require(trackId); })
            .filter(function (record) { return !record.runtime.hidden; })
            .map(function (record) { return record.result; });
        applyOverlayCompatibility(document, hasIncompatibleLevelReferences(visibleResults), STR.calibrationOverlayIncompatible);
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
        emitSpectrumZoom();
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
        if (trackId === playback.trackId) {
            playback.stop(trackId);
        }
        const row = document.getElementById('track-row-' + idx);
        if (row) {
            row.remove();
        }
        const audio = getTrackAudio(idx);
        if (audio) {
            retireAudio(audio, audioFader);
        }
        releaseTrackDetail(idx);
        channelsForResult(record.result).forEach((_, channelIndex) => spectrogramRasterCache.delete(trackId + ':' + channelIndex));
        trackRuntimeAt(idx).hidden = true;
        const pos = trackStore.displayOrder.indexOf(trackId);
        const n = pos !== -1 ? pos + 1 : idx + 1;
        trackStore.remove(trackId);
        messaging.releaseSource(record.result.filePath);
        // Off the track view is off the entry table's tracks and slots too.
        selection.remove(record.result.filePath);
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
    function syncSpecGearVisibility() {
        const gear = buttonMatching(document, '[data-action="spectrogram-settings"]');
        if (gear) {
            gear.style.display = contentType === 'stage' ? 'none' : '';
        }
    }
    function setSpectrogramDisplay(display: SpectrogramDisplaySettings): void {
        spectrogramSettings.setDisplay(display);
        messaging.post({ type: 'update-spectrogram-settings', settings: spectrogramSettings.settings });
        // Touching the settings is the user's way to try a failed spectrogram again.
        trackStore.clearDetailErrors();
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
        requestAnimationFrame(function () { publishTestSnapshot(); });
    }
    const specSettingsPopover = installSpectrogramSettingsPopover(document, {
        strings: STR,
        getSettings: () => spectrogramSettings.settings,
        onDisplayChange: setSpectrogramDisplay,
        onReset() {
            spectrogramSettings.reset();
            messaging.post({ type: 'update-spectrogram-settings', settings: spectrogramSettings.settings });
            scheduleRender();
        },
        onApply(settings) {
            spectrogramSettings.applyStft(settings);
            invalidateDesiredSpectrumSliceRequests();
            setReanalyzeBusy(true, STR.reanalyzingStft);
            messaging.post({ type: 'request-reanalyze', settings: spectrogramSettings.settings });
        },
    });
    const reanalyzeOverlay = installReanalyzeOverlay(document, {
        defaultMessage: STR.reanalyzingDefault,
        onShow(message) {
            announce((STR.announceAnalyzing || 'Analyzing: {msg}').replace('{msg}', message || ''));
        },
    });
    function setReanalyzeBusy(busy: boolean, msg?: string): void {
        spectrogramSettings.setReanalyzeBusy(busy);
        reanalyzeOverlay.setBusy(busy, msg);
        const applyBtn = buttonById(document, 'spec-apply');
        if (applyBtn) {
            applyBtn.disabled = !!busy;
        }
    }
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
            setReanalyzeBusy(true, STR.reanalyzingFiles.replace('{count}', String(cnt)));
            return;
        }
        if (msg.type === 'reanalyze-end') {
            setReanalyzeBusy(false);
            return;
        }
        if (msg.type === 'analysis-file-progress') {
            const progMsg = '(' + msg.current + '/' + msg.total + ') ' + (msg.fileName || '');
            setReanalyzeBusy(true, progMsg);
            return;
        }
        if (msg.type === 'analysis-update' && Array.isArray(msg.results)) {
            applyAnalysisUpdate(msg.results, isSelectionMode ? msg.selectedFilePaths : undefined);
        }
    });
    /** The host's new results: the tracks are rebuilt around them, keeping each track's identity and runtime state. */
    function applyAnalysisUpdate(results: ComparisonTrackState[], hostSelectedFilePaths: string[] | undefined) {
        if (hostSelectedFilePaths) {
            // A file the host newly selects (opened again with the picker after its track was taken off) is shown
            // again; one it still reports from before (an update that crossed the removal) stays off.
            for (const path of selection.adoptHostSelection(hostSelectedFilePaths)) trackStore.allowExplicitSelection(path);
            syncSelectionSummary();
        }
        setReanalyzeBusy(false);
        invalidateDesiredSpectrumSliceRequests();
        // A host drops a request whose source was cleared, so waiting for its answer would block every later cursor spectrum.
        spectrumRequests.abandonActive();
        const update = trackStore.applyAnalysisUpdate(results);
        analysisId = createAnalysisId();
        state.results = update.results;
        if (playback.trackId && !trackStore.get(playback.trackId)?.active) {
            playback.clear();
        }
        rebuildResultsPane();
        if (update.protocolOrderChanged) {
            playback.clear();
            const audioHost = document.getElementById('audio-host');
            if (audioHost) {
                replaceTrackAudio(document, audioHost, buildAudioElements(), audioFader);
                attachAudioEvents();
            }
        }
        updateCursorDisplay(viewState.hover ?? viewState.cursor);
        updateLoopTimeDisplay();
        overlaySpectrumPainted = false;
        announce((STR.announceAnalysisDone || 'Analysis complete: {count} tracks').replace('{count}', String(state.results.length)));
        entryScreen.tracksChanged();
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
        requestAnimationFrame(function () { publishTestSnapshot(); });
    }
    // ── Track drag reorder ──
    function reorderTracks(fromTrackId: TrackId, toTrackId: TrackId) {
        if (!trackStore.reorder(fromTrackId, toTrackId)) {
            return;
        }
        const wrap = document.getElementById('stacked-wrap');
        if (wrap) {
            trackStore.displayOrder.forEach(function (trackId) {
                const row = document.getElementById('track-row-' + trackIndexForId(trackId));
                if (row) {
                    wrap.appendChild(row);
                }
            });
        }
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
    }
    syncSpecGearVisibility();
    ensureCalibrationStyles(document);
}
