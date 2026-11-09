import { channelLabel, channelsForResult, formatClockTime } from '../../shared/utils/format';
import { linkedSpectrogramBounds, spectrogramDisplayBounds, spectrogramFailureText } from './spectrogramRaster';
import { laneWaveformOverlay, onColourBar, paintTrackSpectrogram, type SpectrogramRasterCacheEntry } from './trackCanvasPainter';
import { laneReadoutText, spectrogramReadoutText } from './trackLaneHover';
import { createLaneReads, type LaneTrack } from './laneReads';
import type { FullSource } from './fullRead';
import { stageHover, stageStep, type StageRead } from './stagePanes';
import { stageBasis } from './stageSource';
import { hidePlotReadout, paintHoverMarks, PLOT_READOUT_ID, showPlotReadout } from './plotHover';
import { secondsText, withMinus } from '../plot/plotText';
import { trackTimelinePlacement, waveformCoverageFromExtent } from './waveformCoverage';
import { envelopePeak } from '../waveform/envelopePeak';
import { fileOfKey } from '../../shared/dataset/datasetTable';
import { attachOffsetEditing } from './offsetInlineEditor';
import { dispatchTestMouseEvent, fillSpectrogramDisplayForm, fillSpectrogramSettingsForm, heightDragFromPayload, loopRegionFromPayload, setTestInputValue, testActionTrackId } from './testActionForms';
import { nextRequestId } from './hostRequests';
import { DEFAULT_PYTHON_ENVIRONMENT_STATE, isResponseToLazyRequest, mergeDetailSpectrograms, pythonEnvironmentStateFromMessage } from './lazyResponses';
import type { DrawTheme } from '../draw/canvasDrawers';
import { isCacheSufficient, isOverviewSufficient, isRangeCacheDrawable, parseRangeRequestKey, planLaneRange, rangeCacheCoversView, rangeHasDetail } from '../waveform/rangeRequestPolicy';
import { extractSpectrumAtCursor as extractCursorSpectrum, sliceIsAtCursor } from '../spectrum/cursorSpectrum';
import { spectrogramBandServes, spectrogramWindowServes, spectrogramZoomBand, spectrogramZoomWindow, type SpectrogramBand, type SpectrogramBandSource, type SpectrogramWindow, type SpectrogramZoomSource } from '../spectrum/spectrogramZoom';
import { buildSpectrumCsv, wavLoopRegions, type CsvSpectrumTrack } from './runtimeExports';
import { audioById, buttonById, buttonMatching, canvasById, canvasesMatching, eventTarget, requiredElementById } from './domAdapter';
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
import { installRangePopover, linearAxis, openAxisPart } from '../rangePopover';
import { buildMarkdownReport, buildNotebook, type ReportLoopRegion, type ReportTrack } from '../../shared/report/analysisReport';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { installHelpOverlay } from './helpOverlay';
import { arrowCursorStep, isTextEntryTag, type GlobalShortcutAction } from './shortcuts';
import { domSnapshotBase, latestSpectrogramSnapshot, shellSnapshot } from './testSnapshot';
import { buildTrackSnapshot } from './comparisonSnapshot';
import { contentBoxWidth, readThenWrite, syncCanvasSize } from './canvasSizing';
import { trackAxisCanvasId, trackCanvasId, trackCanvasWrapId, trackSpecAxisCanvasId, trackSpecCanvasId, trackSpectrogramOverlayCanvasId, trackWaveformOverlayCanvasId } from './trackCanvasIds';
import { channelLaneHtml, trackRowHtml } from './trackLaneHtml';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotHit, type PlotPoint, type PlotPointer, type PlotWindow } from './plotInteraction';
import { createPlotHoverLayer, notePlotRead, type PlotPlace } from './plotHoverLayer';
import { attachCanvasFocusHint, attachHoverHints, createHintFooter, createTaskStatus, setHint } from './hintFooter';
import { attachTrackLaneActions } from './trackLaneActions';
import { attachGlobalKeyboardListeners } from './globalKeyboardEvents';
import { keyRouterFor } from './keyRouter';
import { attachSeparatorKeys } from './separatorKeys';
import { buildPythonButtonText, buildPythonTooltip, isPythonEnvError } from './pythonEnvironmentLabels';
import { laneAmplitudeTicks, laneTimeTicks, markLanePlot } from './laneAxes';
import { createPlaybackDisplay } from './playbackDisplay';
import { installLayoutResizeHandling } from './layoutResize';
import { syncPanelToggle, syncSpectrumMaximize } from './panelCollapse';
import { SpectrumView } from './spectrumView';
import { WaveformView } from './waveformView';
import { OVERLAY_LEVEL_AXES, paintOverlaySpectrum, renderSpectrumAxisLegend } from './overlaySpectrumPainter';
import { amplitudeAxisTitle, clearSideAxis, paintOverlay, paintTimeAxis, type StagePlot } from './stagePanes';
import { referenceButtonHtml } from './pairSpectrum';
import { PAIR_SPLIT_MAX, PAIR_SPLIT_MIN, PairSpectrumPanel } from './pairSpectrumPanel';
import { collectSpectrumSeries, type CollectedSpectrumSeries, type SpectrumSeriesSource } from './spectrumSeriesCollector';
import { toolbarHtml } from './toolbarHtml';
import { attachExclusiveMenus, attachHeightResizeListeners, attachToolbarActions } from './toolbarEvents';
import { resultsPaneHtml, trackAudioHtml, type SpectrumBandsSetting } from './resultsPaneHtml';
import { selectionFolderButton, selectionLayoutHtml } from './selectionLayoutHtml';
import { ShownSpectrumCursor, SpectrumCommitHold } from './spectrumCommitHold';
import { createFailureHold, createLatestAnswers, createRequestClock, FAILED_RETRY_MS } from './answerStore';
import { type AnalysisWindowBand, canvasTimeHit, clampedCanvasNorm, clientToCanvasPixels, CURSOR_LINE_STYLE, drawAnalysisWindowBand, drawDashedTimeLine, drawRectZoomSelection, HOVER_LINE_STYLE, waveformCursorLineStyle } from './canvasOverlays';
import { applyOverlayCompatibility, calibrationRequest, channelMetricSummaryHtml, ensureCalibrationStyles, hasIncompatibleLevelReferences } from './calibrationDecorations';
import {
    channelIndexAttribute,
    overlayLevelAxes,
    overlayPlotPoint,
    overlaySpectrumRegionAt,
    spectrumZoomFromWindow,
    spectrumSlicesFromResult,
    withCalibrationWords,
} from './spectrumRuntime';
import { emptyFigure, frequencyTitle, laneAmplitudeRange, levelKeyOfReading, levelTitle as figureLevelTitle, paneNames, plainNames, plainRange, shownLevelOf, titleOf, uncalibratedWord, type FigureTitle } from './figureModel';
import { normalizeRuntimeState, PersistedStateStore } from './stateStore';
import { ComparisonTestBridge } from './testBridge';
import { RuntimeEventFeed } from './runtimeEvents';
import { TrackStore, type TrackRecord } from './trackStore';
import { replaceTrackAudio, retireAudio } from './trackAudioHost';
import { installTrackReorderDrag } from './trackReorderDrag';
import { installSpectrogramSettingsPopover } from './spectrogramSettingsPopover';
import { installReanalyzeOverlay } from './reanalyzeOverlay';
import { SpectrogramSettingsStore } from './spectrogramSettingsStore';
import { createEntryScreen } from './entryRuntime';
import { diffHeadline, trackLevelInput, withBins } from './comparePanes';
import { baseName } from '../../shared/analysis/entryMetadata';
import { channelResult } from '../../shared/recipe/channelSelection';
import { baseUsed, reportFiles } from './compareReport';
import { regionLabel } from './entryTable';
import { activeSlotReferenced, recipeKey } from '../../shared/recipe/recipeSteps';
import { openedRecipe } from '../../shared/recipe/recipeOpen';
import { isRecipeDocument } from '../../shared/recipe/recipeSelection';
import { LIGHT_THEME_BODY_SELECTORS, ROLE_COLORS, ownColor, useLightRoleColors } from '../../shared/gui/roleColors';
import { createTrackStageMode, type StageTrack, type TrackStageMode } from './trackStageMode';
import { attachRoleChips, roleChipHtml, roleChipText, type RoleChipRole } from './roleChip';
import { triggerAnchorDownload as downloadEntryCsv } from './exportDownloads';
import {
    loopGripAt,
    loopRegionClockText,
    loopRegionForDrag,
    rectZoomTarget,
    ZOOM_IN_FACTOR,
} from './waveformInteraction';
import type { ChannelSummary, SpectrogramData, SpectrogramDisplaySettings, } from '../../shared/analysis/analysisTypes';
import type { ComparisonBootstrap, ComparisonTrackState, LazyRequestState, LoopRegion, PersistedWebviewState, RectZoomSelection, SpectrumSeries, SpectrumSlice, TestAction, TrackFileView, TrackId, TrackRuntimeState, WaveformDragState, WaveformDrawOptions, } from './types';
export function startComparisonRuntime(bootstrap: ComparisonBootstrap): void {
    const { host: vscode, state: injectedState, strings: STR, window, document } = bootstrap;
    const state = normalizeRuntimeState(injectedState);
    const messaging = new HostMessenger(vscode, window);
    const testBridge = new ComparisonTestBridge(window, messaging);
    const runtimeEvents = new RuntimeEventFeed();
    testBridge.observe(runtimeEvents);
    testBridge.provide({ build: buildTestSnapshot, fallback: fallbackTestSnapshot });
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
    // A failed spectrogram (the whole file's, a zoom window's) is not asked again until the answer store's pause has
    // passed, so a lane that keeps failing does not loop and a passing failure does not stay.
    const detailFailures = createFailureHold();
    const zoomFailures = createFailureHold();
    const AXIS_W = 64;
    const SIDEBAR_WIDTH_MIN = 160;
    /** The window keeps this much beside a widened side panel. */
    const SIDEBAR_WIDTH_SPARE = 80;
    /** Widened past this share of the window (by a drag or by the keys), the side panel's table is maximized instead. */
    const SIDEBAR_MAXIMIZE_SHARE = 0.6;
    const sidebarMaximizes = (width: number): boolean => width > window.innerWidth * SIDEBAR_MAXIMIZE_SHARE;
    const LANE_PLOT_MIN = 40;
    // A tall spectrum still leaves the tracks this much room so the cursor stays reachable.
    const TRACKS_MIN_VISIBLE = 120;
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
    /** What the next frame draws: everything, or only the cursor (a playback frame where nothing else moved). */
    let pendingRender: 'all' | 'cursor' | null = null;
    function requestRenderFrame(kind: 'all' | 'cursor') {
        const queued = pendingRender !== null;
        if (pendingRender !== 'all') pendingRender = kind;
        if (queued) {
            return;
        }
        requestAnimationFrame(function () {
            const next = pendingRender;
            pendingRender = null;
            if (next === 'cursor') renderCursorLayers();
            else renderAll();
        });
    }
    function scheduleRender() {
        requestRenderFrame('all');
    }
    /**
     * Only the cursor lines are drawn again: the waveform canvases (the cursor is drawn into them) and the
     * spectrograms' overlays. Repainting every axis, the ruler and the rest each playback frame kept the main thread busy.
     */
    function scheduleCursorRender() {
        requestRenderFrame('cursor');
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
        fullResolution: boolean;
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
                ...(request.fullResolution ? { fullResolution: true as const } : {}),
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
    /** Left the comparison, which does not draw the spectra it hides: they are drawn on the next frame. */
    let spectraHidden = false;
    // Linked, every displayed lane shares one absolute amplitude scale, colour scale and frequency range; lanes in
    // another unit (Pa beside full scale, dB SPL beside dBFS) share theirs only with lanes in the same unit.
    let scalesLinked = persistedWebviewState.linkScales === true;
    type LinkedScale = { peaks: Map<string, number>; levels: Map<string, { minDb: number; maxDb: number }>; maxFrequencyHz: number };
    let linkedScaleMemo: LinkedScale | null = null;
    const amplitudeUnitKey = (ch: ChannelSummary | undefined) => (ch && typeof ch.unit === 'string' ? ch.unit.trim() : '');
    // Spectrograms share a colour scale only by level identity (figureModel, R1).
    const levelUnitKey = levelKeyOfReading;
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
    let spectrumBandsPerOctave: SpectrumBandsSetting = persistedWebviewState.spectrumBandsPerOctave === 1 || persistedWebviewState.spectrumBandsPerOctave === 3
        ? persistedWebviewState.spectrumBandsPerOctave : 0;
    const waveformView = new WaveformView();
    const viewState = new LaneViewState({
        scheduleRender,
        scheduleCursorRender,
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
        viewState.setCursor(norm, playing ? 'cursor' : 'all');
    }
    /** The cursor spectrum's pointer marks and readout, as every plot's (plotHoverLayer.ts, R7). */
    const spectrumMarks = createPlotHoverLayer(document, 'spectrum-cursor');
    /** The lanes' and the cursor spectrum's full data, which their numbers are read from (R7): never what they draw. */
    const laneReads = createLaneReads(message => messaging.post(message));
    /** Where the pointer (or an arrow key's step) is over the cursor spectrum, while it is. */
    let spectrumPointer: PlotPlace | null = null;
    /** The pair plot's frequency the cursor spectrum's line follows while the pointer is on a pair plot. */
    let spectrumFollowHz: number | null = null;
    /** Where the cursor spectrum last drew its lines. */
    let spectrumDrawn: StagePlot | null = null;
    /** The cursor spectrum's (left) level axis name as last drawn: its range popover names the axis the same way. */
    let spectrumLevelAxisTitle = '';
    /** The frequency the power spectrum's cursor last read under the pointer (R7). */
    let overlayReadHz: number | null = null;
    // ── スペクトルズーム ───────────────────────────────────
    const spectrumView = new SpectrumView();
    const heightResize = createHeightResize({
        currentHeight: kind => kind === 'track' ? layout.trackHeight : layout.spectrumOverlayHeight,
        canBegin: kind => kind === 'track' || (!layout.spectrumCollapsed && !layout.spectrumMaximized),
        setHeight,
        onActiveChange: active => document.body.classList.toggle('is-height-resizing', active),
    });
    // ── Lane gestures: a drag zooms into its box on every lane, as on every plot (R13); Alt+drag sets the loop ──
    /**
     * The spectrogram lanes' frequency zoom, in Hz (null: the band the display settings show). Held in Hz, not as a
     * fraction of a lane's band, so lanes of different sample rates (different Nyquist tops) show the same frequencies.
     */
    let spectrogramFrequencyView: { lowHz: number; highHz: number } | null = null;
    let rectZoomSelection: RectZoomSelection | null = null;
    let lanePress: WaveformDragState | null = null;
    function setLoopRegion(region: LoopRegion | null): void {
        viewState.setLoop(region);
    }
    function createTrackRuntime(): TrackRuntimeState {
        return { offsetSeconds: 0, hidden: false };
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
        frequencyAxisHz: () => spectrumView.linearFrequencyAxis(),
        setFrequencyWindowHz(range) {
            // The pair view shares the power spectrum's frequency axis (R8): a zoom on either moves both.
            if (!range) specZoomReset();
            else if (spectrumView.setFrequencyRangeHz(range.min, range.max)) scheduleSpectrumRefresh('immediate');
        },
        openFrequencyRange: (clientX, clientY) => openSpectrumRangePopup('freq', clientX, clientY),
        openLevelRange(request) {
            openAxisPart(spectrumRangePopover, {
                mapping: linearAxis(request.min, request.max, request.label), horizontal: false, current: request.current,
                clientX: request.clientX, clientY: request.clientY, invalid: STR.specRangeErrorMinMax,
                set: part => request.set(part.start <= 0 && part.end >= 1 ? null : part),
            });
        },
        plotHeight: effectiveSpectrumHeight,
        hoverFrequencyHz() {
            const visible = spectrumView.visibleFrequencyHz();
            const canvas = canvasById(document, 'spectrum-overlay-canvas');
            if (!spectrumPointer || !visible || !canvas || !spectrumDrawn) {
                return null;
            }
            // The pair plot follows the point the power spectrum's cursor reads (R7), not the pointer beside it.
            if (overlayReadHz !== null) {
                return overlayReadHz;
            }
            const { frame } = spectrumDrawn;
            const across = Math.max(0, Math.min(1, (spectrumPointer.clientX - canvas.getBoundingClientRect().left - frame.left) / Math.max(1, frame.width)));
            return visible.frequencyMin + across * (visible.frequencyMax - visible.frequencyMin);
        },
        onHoverFrequency(frequencyHz) {
            // The pointer is on the pair plot: the power spectrum's line follows its frequency, with no point read of its own.
            spectrumFollowHz = frequencyHz;
            if (frequencyHz !== null) spectrumPointer = null;
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
    /** The cursor the cursor spectrum's picture is of, which its header names. */
    const shownSpectrumCursor = new ShownSpectrumCursor();
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
        if (failure && failure.settingsSignature === settingsSignature && detailFailures.holds(record.id, settingsSignature)) {
            return;
        }
        const pending = record.requests.pending('detail')?.meta;
        if (pending && pending.settingsSignature === settingsSignature) {
            return;
        }
        // Asked again after a failure's pause: the lane says it is loading, not the failure it may no longer have.
        record.detailError = null;
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
    /**
     * What a lane's zoom is measured against: the whole file's spectrogram columns, and the frames a window can bring.
     * With set STFT settings those are the file's frames at their hop. With the automatic ones the host gives a window
     * a hop of its own, chosen for its length, so a window can bring a frame per sample.
     */
    function spectrogramZoomSource(result: ComparisonTrackState): SpectrogramZoomSource | null {
        const spec = channelsForResult(result)[0]?.spectrogram;
        if (!spec || !(spec.hopSize > 0) || !(result.durationSeconds > 0) || !(result.sampleRateHz > 0)) {
            return null;
        }
        const samples = result.durationSeconds * result.sampleRateHz;
        return { columns: spec.timeBins, frames: spectrogramSettings.settings.auto ? samples : samples / spec.hopSize };
    }
    /** What a lane's frequency zoom is measured against: the whole file's rows and its FFT's bins up to Nyquist. */
    function spectrogramBandSourceOf(result: ComparisonTrackState): SpectrogramBandSource | null {
        const spec = channelsForResult(result)[0]?.spectrogram;
        return spec && spec.windowSize > 1 && spec.maxFrequencyHz > 0 ? { rows: spec.frequencyBins, bins: Math.floor(spec.windowSize / 2) + 1, nyquistHz: spec.maxFrequencyHz } : null;
    }
    /** The band a spectrogram lane shows (Hz), as its frequency axis does. */
    function shownSpectrogramBand(whole: SpectrogramData): SpectrogramBand {
        const bounds = shownSpectrogramBounds(whole);
        return { lowHz: bounds.minFrequencyHz, highHz: bounds.maxFrequencyHz };
    }
    function laneFileWindow(result: ComparisonTrackState, trackIndex: number): SpectrogramWindow {
        const fileView = computeTrackFileView(result, trackIndex);
        return { startNorm: fileView.fileAtZoomStart, endNorm: fileView.fileAtZoomEnd };
    }
    /**
     * A lane zoomed past the whole file's spectrogram columns asks for the window it shows (R3): the host sends that
     * window's frames at full resolution, so the lane is drawn again from them instead of the averaged columns stretched.
     */
    function requestSpectrogramZoom(i: number, result: ComparisonTrackState, record: TrackRecord) {
        const canvas = canvasById(document, trackSpecCanvasId(i, 0));
        const source = canvas ? spectrogramZoomSource(result) : null;
        if (!canvas || !source) {
            return;
        }
        const view = laneFileWindow(result, i);
        const width = canvas.width || 800;
        const height = canvas.height || 120;
        // Up the frequency axis too: the band shown, against the whole file's rows (R3).
        const bandSource = spectrogramBandSourceOf(result);
        const whole = channelsForResult(result)[0]?.spectrogram;
        const viewBand = whole ? shownSpectrogramBand(whole) : null;
        const settingsSignature = currentSettingsSignature();
        const zoom = record.spectrogramZoom;
        const serves = (window: SpectrogramWindow | null, band: SpectrogramBand | null): boolean =>
            (window ? spectrogramWindowServes(source, window, view, width) : !spectrogramZoomWindow(source, view, width))
            && (!bandSource || !viewBand || spectrogramBandServes(bandSource, band, viewBand, height));
        if (zoom && zoom.analysisId === analysisId && zoom.settingsSignature === settingsSignature && serves(zoom.startNorm === 0 && zoom.endNorm === 1 && zoom.band ? null : zoom, zoom.band)) {
            return;
        }
        const timeWindow = spectrogramZoomWindow(source, view, width);
        const band = bandSource && viewBand ? spectrogramZoomBand(bandSource, viewBand, height) : null;
        if ((!timeWindow && !band) || zoomFailures.holds(record.id)) {
            return;
        }
        const pending = record.requests.pending('specZoom');
        if (pending && pending.meta && pending.meta.settingsSignature === settingsSignature && pending.meta.analysisId === analysisId) {
            const asked = spectrogramZoomKey(pending.key);
            if (serves(asked.timed ? asked : null, asked.band)) {
                return; // the window on its way already serves it
            }
        }
        const requestId = nextRequestId('specZoom', i);
        record.requests.ask('specZoom', requestId, [timeWindow ? `${timeWindow.startNorm}|${timeWindow.endNorm}` : '0|1', band ? `${band.lowHz}|${band.highHz}` : ''].join('|'),
            { trackId: record.id, requestId: requestId, analysisId: analysisId, settingsSignature: settingsSignature });
        messaging.post({
            type: 'request-track-detail',
            requestId: requestId,
            analysisId: analysisId,
            settingsSignature: settingsSignature,
            trackIndex: i,
            filePath: result.filePath,
            // The whole file's frames along time when only the band needs its own rows.
            ...(timeWindow ? { startNorm: timeWindow.startNorm, endNorm: timeWindow.endNorm } : {}),
            ...(band ? { lowHz: band.lowHz, highHz: band.highHz } : {}),
        });
    }
    /** The spectrogram a lane draws and reads: its zoom window's while that covers the view, else the whole file's. */
    function shownSpectrogram(result: ComparisonTrackState, trackIndex: number, channelIndex: number): { spec: SpectrogramData; window: SpectrogramWindow | null } | null {
        const whole = channelsForResult(result)[channelIndex]?.spectrogram;
        if (!whole) {
            return null;
        }
        const zoom = trackRecordAtIndex(trackIndex)?.spectrogramZoom;
        const zoomed = zoom && zoom.analysisId === analysisId && zoom.settingsSignature === currentSettingsSignature() ? zoom.spectrograms[channelIndex] : null;
        if (!zoom || !zoomed) {
            return { spec: whole, window: null };
        }
        const view = laneFileWindow(result, trackIndex);
        const covers = zoom.startNorm <= Math.max(0, view.startNorm) + 1e-9 && zoom.endNorm >= Math.min(1, view.endNorm) - 1e-9;
        // A band's rows serve only while the band shown stays inside it.
        const band = shownSpectrogramBand(whole);
        const coversBand = !zoom.band || (zoom.band.lowHz <= Math.max(0, band.lowHz) + 1e-6 && zoom.band.highHz >= Math.min(whole.maxFrequencyHz, band.highHz) - 1e-6);
        return covers && coversBand ? { spec: zoomed, window: { startNorm: zoom.startNorm, endNorm: zoom.endNorm } } : { spec: whole, window: null };
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
        record.requests.drop('specZoom');
        record.spectrogramZoom = null;
        spectrumRequests.drop(spectrumSliceRequestKey(record.id));
        record.requests.drop('slice');
        record.spectrumSliceCache.clear();
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
    /** Whether a cached slice is this cursor's: the current settings, transformed at this cursor (cursorSpectrum.ts). */
    function sliceIsCurrentAt(i: number, slice: SpectrumSlice | null | undefined, cursorNormValue: number): slice is SpectrumSlice {
        const result = state.results[i];
        const localNorm = trackLocalCursorNorm(i, cursorNormValue);
        return !!slice && !!result && localNorm !== null && slice.settingsSignature === currentSpectrumDataSignature()
            && sliceIsAtCursor(slice, localNorm, spectrumCursorTolerance(result));
    }
    /** The slice wanted or in flight for a track, unless a cursor move since has made its answer stale (it would be dropped). */
    function currentSpectrumSliceRequest(record: NonNullable<ReturnType<typeof trackRecordAtIndex>>) {
        const inFlight = record.requests.pending('slice')?.meta;
        const pending = spectrumRequests.desiredFor(spectrumSliceRequestKey(record.id))
            || (inFlight && 'generation' in inFlight ? inFlight as DesiredSpectrumSliceRequest : undefined);
        return pending && pending.generation === spectrumRequests.generation ? pending : undefined;
    }
    function isSpectrumSliceRequestPendingForCursor(i: number, cursorNormValue: number) {
        const record = trackRecordAtIndex(i);
        const pending = record ? currentSpectrumSliceRequest(record) : undefined;
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
    /** While a CSV export waits, the cursor spectra asked for hold every FFT bin rather than the row cut for display. */
    let spectrumCsvExportOpen = false;
    function requestSpectrumSlice(i: number, cursorNormValue: number) {
        // With the cursor-spectrum panel folded, only the analysis window band on lanes near the view needs a slice.
        // Nor while the comparison hides every spectrum (playing there would ask for slices nobody sees).
        if (!spectrumRequests.allowsSliceRequests || contentType === 'stage' || (layout.spectrumCollapsed && !laneInView(i))) {
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
        // Every bin, for the CSV or while the spectrum is zoomed in (R3: the zoomed range drawn again from full
        // resolution, not the whole spectrum's thinned line stretched); thinned again only to be drawn.
        const fullResolution = spectrumCsvExportOpen || spectrumView.frequencyZoomed();
        const cached = record.spectrumSliceCache.get(0);
        if (sliceIsCurrentAt(i, cached, cursorNormValue) && !(fullResolution && cached.frequenciesHz)) {
            return;
        }
        const key = spectrumSliceRequestKey(record.id);
        const pending = currentSpectrumSliceRequest(record);
        if (pending && pending.settingsSignature === settingsSignature && Math.abs((pending.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result)
            && (pending.fullResolution || !fullResolution)) {
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
            fullResolution,
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
        // Typed ends stay as typed; auto ends are the slice's extremes, rounded with every other line's (spectrumLevelRange: R9's dB rule).
        const minDb = displaySettings.dbMin != null ? displaySettings.dbMin : slice.minDb;
        const maxDb = displaySettings.dbMax != null ? displaySettings.dbMax : slice.maxDb;
        const typedDb = { ...(displaySettings.dbMin != null ? { min: displaySettings.dbMin } : {}), ...(displaySettings.dbMax != null ? { max: displaySettings.dbMax } : {}) };
        const requestedMaxFreq = displaySettings.maxFrequencyHz;
        let maxFrequencyHz = slice.originalMaxFrequencyHz || slice.maxFrequencyHz;
        if (requestedMaxFreq != null && Number.isFinite(requestedMaxFreq) && requestedMaxFreq > 0) {
            maxFrequencyHz = Math.min(requestedMaxFreq, maxFrequencyHz);
        }
        // A second level reference is read over its own range (a typed range is in the first reference's dB).
        return Object.assign({}, slice, {
            originalMaxFrequencyHz: slice.originalMaxFrequencyHz || slice.maxFrequencyHz,
            maxFrequencyHz: maxFrequencyHz,
            minDb: minDb,
            maxDb: maxDb,
            autoMinDb: slice.autoMinDb ?? slice.minDb,
            autoMaxDb: slice.autoMaxDb ?? slice.maxDb,
            typedDb,
        });
    }
    function trackColor(i: number) {
        // Its role from the entry table's slots (base blue, slots 1–3); a recording without one has its own colour, as in Compare.
        const filePath = state.results[i]?.filePath;
        const role = filePath && stageMode ? stageMode.role(filePath) : undefined;
        return (role !== undefined ? ROLE_COLORS[role] : undefined) || trackOwnColor(i);
    }
    /** The track's own colour, which it has without a role: given when the track comes in, kept as tracks come and go. */
    function trackOwnColor(i: number): string {
        return ownColor(trackRuntimeAt(i).ownColorIndex ?? i);
    }
    /** The role chips on the track headers follow the slots (set here, on the entry table or on the comparison's legend). */
    function syncRoleChips() {
        let roleChanged = false;
        document.querySelectorAll<HTMLDetailsElement>('.track-header details.role-chip').forEach(function (chip) {
            const filePath = chip.dataset.filePath ?? '';
            const role = trackRole(filePath);
            const face = chip.querySelector<HTMLElement>('.role-chip-face');
            if (chip.open || !face || (face.dataset.role === String(role?.slot ?? '') && face.textContent === roleChipText(role))) return;
            if (face.dataset.role !== String(role?.slot ?? '')) roleChanged = true;
            // The chip's own track (a file opened twice is two tracks, each its own colour).
            const trackId = chip.closest<HTMLElement>('.track-row')?.dataset.trackId as TrackId | undefined;
            const index = trackId ? trackStore.protocolIndexForId(trackId) : null;
            chip.outerHTML = roleChipHtml(filePath, role, index !== null ? trackOwnColor(index) : ownColor(0), STR);
        });
        // The cursor spectra are drawn in each track's role colour: repaint them (without asking for slices) when a role changes.
        if (roleChanged && !spectraHidden) spectrumRequests.scheduleFrame(false, false);
    }
    const hintFooter = createHintFooter(document);
    const taskStatus = createTaskStatus(document, window, announce);
    attachHoverHints(document, hintFooter);
    const updatePlaybackDisplay = createPlaybackDisplay(document, STR.playbackTimePrefix || '▶');
    // ── On-demand range cache ──
    let rangeRequestTimer: number | null = null;
    /** When each lane's range request on its way was sent; a failed one is never answered, so it is asked again after the store's UNANSWERED_RETRY_MS. */
    const rangeClock = createRequestClock(() => performance.now());
    /** When the range each lane draws was asked for, so an older answer arriving late does not replace a newer one. */
    const rangeLandedAskedAt = createLatestAnswers<number>();
    // The full data the lanes' readouts read (R7): each read's answer, on its own requests.
    messaging.onMessage(function (msg) {
        if (msg && laneReads.handle(msg)) testBridge.publishAfterFrame();
    });
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
        const askedAt = rangeClock.landed(msg.requestId);
        record.requests.settle(msg.requestId);
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
        // A zoom window's answer is known by its request, not by what it echoes: the window is the one asked for.
        const zoomRequest = record.requests.answering('specZoom', msg.requestId);
        if (zoomRequest) {
            const asked = zoomRequest.meta;
            if (!isResponseToLazyRequest(asked, trackId, msg)) {
                return;
            }
            const { startNorm, endNorm, band } = spectrogramZoomKey(zoomRequest.key);
            record.requests.settle(msg.requestId);
            if (msg.type === 'track-detail-error') {
                // The lane keeps the whole file's picture; the window is asked again after the pause.
                zoomFailures.fail(trackId);
                setTimeout(scheduleRangeRequests, FAILED_RETRY_MS);
                return;
            }
            zoomFailures.clear(trackId);
            if (state.results[i] && state.results[i].filePath === msg.filePath && Array.isArray(msg.channels)) {
                record.spectrogramZoom = { startNorm, endNorm, band, analysisId: asked.analysisId,
                    settingsSignature: asked.settingsSignature, spectrograms: msg.channels.map(channel => channel?.spectrogram ?? null) };
                scheduleRender();
                testBridge.publishAfterFrame();
            }
            return;
        }
        const pending = record.requests.answering('detail', msg.requestId)?.meta;
        if (!isResponseToLazyRequest(pending, trackId, msg) || pending.channelIndex !== msg.channelIndex) {
            return;
        }
        record.requests.settle(msg.requestId);
        if (msg.type === 'track-detail-error') {
            record.detailError = { settingsSignature: pending.settingsSignature, message: msg.error };
            detailFailures.fail(trackId, pending.settingsSignature);
            scheduleRender();
            // The cause may pass (a restarted backend, memory freed): the lane asks again after the pause.
            setTimeout(scheduleRender, FAILED_RETRY_MS);
            return;
        }
        record.detailError = null;
        detailFailures.clear(trackId);
        if (state.results[i] && state.results[i].filePath === msg.filePath && Array.isArray(msg.channels)) {
            mergeDetailSpectrograms(state.results[i].channels, msg.channels);
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
            testBridge.publishAfterFrame();
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
        // A slice moves the lanes' analysis window band, drawn on the waveform; while playing none is drawn and the
        // answers keep coming, so they need no more than a playback frame's redraw.
        if (playback.isRunning()) scheduleCursorRender();
        else scheduleRender();
        testBridge.publishAfterFrame();
        spectrumRequests.pump();
    });
    messaging.onMessage(function (msg) {
        if (msg && pairPanel.handleMessage(msg)) {
            testBridge.publishAfterFrame();
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
            testBridge.publishFor(msg.actionId);
            requestAnimationFrame(function () {
                testBridge.publishFor(msg.actionId);
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
            requestSpectrogramZoom(i, result, record);
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
            const inFlight = pending && rangeClock.waiting(pending.requestId);
            const asked = pending && inFlight ? parseRangeRequestKey(pending.key) : null;
            if (asked && asked.startNorm <= keepStart && asked.endNorm >= keepEnd &&
                rangeHasDetail(asked.points, asked.startNorm, asked.endNorm, pts, W, fileView.fileAtZoomStart, fileView.fileAtZoomEnd)) {
                return; // the range on its way already covers it
            }
            const requestId = nextRequestId('range', record.id);
            // Superseded requests keep their time until answered (an answer may still land); the host cancels most, so
            // the oldest are dropped once many are kept.
            rangeClock.sent(requestId);
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
    syncSpecGearVisibility();
    attachEvents();
    // The help lists the keys of the view on show first: the entry table, the comparison (the track view's steps mode), or the lanes.
    installHelpOverlay(document, window, STR, () => {
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
        recordingColor(filePath) {
            // As its track is drawn: its role's colour, else its own (undefined for a file not shown as a track).
            const trackId = trackStore.activeIds().find(id => trackStore.require(id).result.filePath === filePath);
            const index = trackId ? trackStore.protocolIndexForId(trackId) : null;
            return index !== null ? trackColor(index) : undefined;
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
        ...(typeof ResizeObserver === 'function' ? { ResizeObserver } : {}),
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
            // The legend's label names the channel already: the chip says the role alone (a named chip has no colour of its own).
            const role = trackRole(path);
            return roleChipHtml(path, role && { slot: role.slot, ch: null }, '', STR, true);
        },
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
                // The step's picture is one per recording: it is drawn on the first lane; the steps view hides the others.
                channelsForResult(result).forEach(function (_, channelIndex: number) {
                    if (channelIndex === 0) return;
                    const canvas = canvasById(document, trackCanvasId(i, channelIndex));
                    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
                });
                // The file's unit and reference as the entry table scanned it (else as the track was analysed: the channel
                // the step reads), so the level axis names its reference (C1), never a bare dB for channels calibrated apart.
                const channels = channelsForResult(result);
                const read = entryScreen.stageChannel(result.filePath, result.filePath);
                const input = trackLevelInput(read !== null && read !== undefined && channels[read] ? [channels[read]] : channels, entryResults.get(result.filePath)?.input);
                tracks.push({ filePath: result.filePath, color: trackColor(i), canvas: canvasById(document, trackCanvasId(i, 0)), axis: canvasById(document, trackAxisCanvasId(i, 0)), input });
            });
            return tracks;
        },
        sampleRate: () => state.results.find(result => !result.error)?.sampleRateHz,
        // A file's pictures are of its version (the table's scan) and calibration (the track's analysis): a change asks them again.
        basis: stageBasis(path => entryScreen.compareData().results.get(path), path => state.results.find(result => result.filePath === path && !result.error)),
        // What a trigger sees: the compared slots' channels (a channel row, its own) of the shown tracks, over the region.
        peak: region => {
            const shown = trackStore.displayOrder.map(trackId => trackStore.require(trackId)).filter(record => !record.runtime.hidden && !record.result.error);
            const compared = entryScreen.compareData().slots.filter((slot): slot is string => !!slot);
            let peak = 0;
            for (const record of shown) {
                const result = record.result;
                const slots = compared.filter(slot => fileOfKey(slot) === result.filePath);
                if (compared.length && !slots.length) continue;
                const picked = slots.map(slot => /#ch(\d+)$/.exec(slot)?.[1]).filter((ch): ch is string => ch !== undefined).map(ch => Number(ch) - 1);
                channelsForResult(result).forEach((channel, index) => {
                    if (picked.length && !picked.includes(index)) return;
                    peak = Math.max(peak, envelopePeak(channel.waveform ?? undefined, result.durationSeconds, region));
                });
            }
            return peak > 0 ? peak : undefined;
        },
        stepFailed: (step, reason) => entryScreen.stepFailed(step, reason),
        channels: () => comparedChannels(),
        rerender: () => scheduleRender(),
        hint: text => hintFooter.show(text),
        notify: text => taskStatus(text, 'done'),
        busy: text => taskStatus(text, 'busy'),
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
            // The definition counts the recordings this Δ was measured from (over a region, the region's scans).
            const used = baseUsed(comparison, results);
            const definition = { ...entryScreen.baseDefinition(comparePath, groupBase), count: used.n };
            const baseLabel = definition.kind === 'file' ? definition.file ?? baseName(data.slots[0] ?? '') : entryScreen.baseTitle(comparePath, groupBase);
            entryScreen.addDerived({
                parentPath: comparePath, ...(channel ? { ch: channel } : {}), region: regionLabel(region), result, recipeKey: recipeKey(data.runRecipe),
                base: { leq: comparison.base.leq, bands: comparison.base.bands, label: baseLabel, paths: used.paths, definition },
            });
            return null;
        },
        report(showDiff, region, measured, binned) {
            const data = entryScreen.compareData();
            // Every bin of the files' spectra, for the figures' median and Δ: over a region, the region's metrics carry
            // them; without one, the whole files' scans give them to the table's results of the same spectrum.
            const results = region ? new Map([...data.results, ...measured]) : withBins(data.results, binned);
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
            taskStatus(STR.reportSaved + folder, 'done');
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
        testBridge.publish();
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

    /** A spectrogram lane's colour bar name, as the comparison's heatmaps name their colour: the level, with the channel's reference. */
    function spectrogramLevelTitle(ch: ChannelSummary | null | undefined): FigureTitle {
        return titleOf(paneNames(STR, trackLevelInput([ch], undefined)).level);
    }
    /** A waveform lane's amplitude axis: what it shows from bottom to top (as the waveform is drawn), its ticks and its title. */
    function laneAmplitudeAxis(result: ComparisonTrackState, channelIndex: number) {
        const ch = channelsForResult(result)[channelIndex];
        const range = laneAmplitudeRange(amplitudeScaleFor(ch), waveformView.isAmplitudeZoomed() ? { minNorm: waveformView.amplitudeMin, maxNorm: waveformView.amplitudeMax } : undefined);
        const unit = ch && typeof ch.unit === 'string' && ch.unit.trim() ? ch.unit.trim() : undefined;
        return { range, ticks: laneAmplitudeTicks(range), title: amplitudeAxisTitle(STR, unit, trackLevelInput([ch], undefined)) };
    }
    /** The lanes' visible time span in seconds (the ruler's and every lane's time axis). */
    function laneVisibleSeconds() {
        const gs = trackStore.globalSpan();
        return { start: gs.startSec + waveformView.start * gs.spanSec, end: gs.startSec + waveformView.end * gs.spanSec };
    }
    function waveformAxisLabelsForResult(result: ComparisonTrackState, _trackIndex: number) {
        const axis = laneAmplitudeAxis(result, 0);
        return [...axis.ticks.map(tick => tick.text), axis.title];
    }
    function buildTestSnapshot(): Record<string, unknown> {
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
                };
            }),
            globalSpan: trackStore.globalSpan(),
            zoomStart: waveformView.start,
            zoomEnd: waveformView.end,
            spectrumView: spectrumView.state(),
            spectrogramDisplay: spectrogramSettings.display,
            peekSlice: track => peekSpectrumAtCursor(track.result, track.trackIndex, track.offsetSeconds, spectrumCursorNorm),
            waveformAxisLabels: track => waveformAxisLabelsForResult(track.result, track.trackIndex),
            spectrumTexts: () => [...(spectrumDrawn?.drawnTexts ?? [])],
            spectrogramTexts: track => {
                const canvas = document.getElementById(trackSpecCanvasId(track.trackIndex, 0));
                const plot = canvas instanceof HTMLCanvasElement ? spectrogramPlots.get(canvas) : undefined;
                return [...(plot?.drawnTexts ?? [])];
            },
        });
        let latestSpectrogram;
        try {
            const firstChannel = state.results[0] ? displayedChannel(state.results[0]) : undefined;
            latestSpectrogram = latestSpectrogramSnapshot(firstChannel?.spectrogram, spectrogramSettings.settings);
        }
        catch { /* ignore */ }
        return {
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
            spectrogramFrequencyView: spectrogramFrequencyView ? { ...spectrogramFrequencyView } : null,
            lastAnnounce: (function () {
                const el = document.getElementById('a11y-announce');
                return el ? (el.textContent || '') : '';
            })(),
            tracks: trackSnapshot.tracks,
            entry: entryScreen.snapshot(),
            comparison: stageMode?.snapshot() ?? null,
            ...shellSnapshot(document, audioFader.contextState()),
            lastPlayRejection: playback.lastPlayRejection,
        };
    }
    function fallbackTestSnapshot(e: unknown): Record<string, unknown> {
        return {
            ...domSnapshotBase(document),
            zoomStart: waveformView.start,
            zoomEnd: waveformView.end,
            cursorNorm: viewState.cursor,
            visibleSpectrumTrackCount: 0,
            contentType: contentType,
            reanalyzeBusy: isReanalyzeBusy(),
            axisLabels: { spectrumOverlay: [], spectrogramPerTrack: [], waveformPerTrack: [] },
            displayOrder: trackStore.displayOrder.slice(),
            specFreqStart: spectrumView.freqStart,
            specFreqEnd: spectrumView.freqEnd,
            trackHeight: layout.trackHeight,
            spectrumOverlayHeight: layout.spectrumOverlayHeight,
            lastAnnounce: e instanceof Error ? e.message : String(e),
            tracks: [],
        };
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
            samples: typeof vscode.openSamples === 'function',
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
            return trackAudioHtml(trackId, record.protocolIndex, result.audioSource);
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
            axisWidth: AXIS_W,
            waveformLabel: STR.ariaWaveformCanvas.replace('{file}', result.fileName).replace('{channel}', channelLabel(result, channelIndex)),
            spectrogramLabel: STR.ariaSpectrogramCanvas.replace('{file}', result.fileName).replace('{channel}', channelLabel(result, channelIndex)),
            axisHint: trackAxisHint(),
            spectrogramAxisHint: STR.hintSpectrogramFrequencyAxis + ' / ' + STR.hintWheelGestures,
            splitHint: STR.hintTrackSplit,
            splitLabel: STR.trackSplitLabel,
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
            roleChipHtml: roleChipHtml(result.filePath, trackRole(result.filePath), trackOwnColor(i), STR),
            playable: !!result.audioSource,
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
        // The comparison hides the ruler (and the spectra, below): what is not on screen is not drawn.
        if (contentType !== 'stage') renderRuler();
        renderStackedTracks();
        // Back from the comparison: the spectra are drawn from what is held, and the cursor's slices asked for if missing.
        if (spectraHidden && contentType !== 'stage') { spectraHidden = false; refreshSpectrumViews(); scheduleSpectrumRefresh('interactive'); }
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
            // The waveform and the spectrogram span the same width: one time axis for every lane.
            const waveW = newW - AXIS_W;
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
        // The ticks follow the lanes' time span: the waveform's width.
        const lane = canvasesMatching(document, '.track-canvas:not(.track-spec-canvas)').find(function (c) { return c.width > 1 && c.offsetParent !== null; });
        const timeW = lane ? Math.min(W, lane.width) : W;
        const seconds = laneVisibleSeconds();
        const style = getComputedStyle(document.body);
        // The lanes' time axis, drawn by the plot component as every plot's (R13): its ticks, their numbers and its name.
        paintTimeAxis(canvas, laneTimeTicks(seconds.start, seconds.end, timeW), STR.axisTime, timeW, {
            muted: style.getPropertyValue('--muted').trim() || '#888',
            line: style.getPropertyValue('--line').trim() || '#444',
            text: style.getPropertyValue('--text').trim() || '#ddd',
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
                    msg.title = result.error;
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
                // Not drawn until scrolled to: its axes beside it are left empty by the plot component meanwhile.
                channelsForResult(result).forEach(function (_, channelIndex: number) {
                    for (const id of [trackAxisCanvasId(i, channelIndex), trackSpecAxisCanvasId(i, channelIndex)]) {
                        const axis = canvasById(document, id);
                        if (axis && !axis.hasAttribute('data-plot-axis-canvas')) clearSideAxis(axis);
                    }
                });
                return;
            }
            const color = trackColor(i);
            channelsForResult(result).forEach(function (_, channelIndex: number) {
                const canvas = canvasById(document, trackCanvasId(i, channelIndex));
                if (!canvas) {
                    return;
                }
                const axisC = canvasById(document, trackAxisCanvasId(i, channelIndex));
                if (axisC) clearSideAxis(axisC);
                drawTrackWaveform(canvas, result, i, channelIndex, trackRuntimeAt(i).offsetSeconds, color);
                const specCanvas = canvasById(document, trackSpecCanvasId(i, channelIndex));
                if (specCanvas) {
                    drawSpectrogram(specCanvas, result, i, channelIndex, trackRuntimeAt(i).offsetSeconds);
                }
            });
        });
    }
    /** scheduleCursorRender's pass: the lanes renderStackedTracks would draw, with only their cursor-following layers. */
    function renderCursorLayers() {
        // The steps view draws its own plots; a pass that also has to show the spectra again is a full one.
        if (contentType === 'stage' || spectraHidden) {
            renderAll();
            return;
        }
        trackStore.displayOrder.forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const i = record.protocolIndex;
            const result = record.result;
            if (record.runtime.hidden || result.error || !laneInView(i)) {
                return;
            }
            const color = trackColor(i);
            channelsForResult(result).forEach(function (ch, channelIndex: number) {
                const canvas = canvasById(document, trackCanvasId(i, channelIndex));
                if (!canvas) {
                    return;
                }
                redrawWaveformCursor(canvas, result, i, channelIndex, color);
                // Without a spectrogram yet the overlay stays cleared, as drawSpectrogram leaves it.
                const overlayCanvas = ch && ch.spectrogram ? canvasById(document, trackSpectrogramOverlayCanvasId(i, channelIndex)) : null;
                const overlayCtx = overlayCanvas ? overlayCanvas.getContext('2d') : null;
                if (overlayCanvas && overlayCtx) {
                    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                    drawSpectrogramOverlayLines(overlayCtx, overlayCanvas.width, overlayCanvas.height, i);
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
    /** A track as its lanes' reads name it (R7): its index on the protocol, its file and the analysis drawn. */
    function laneTrack(trackIndex: number): LaneTrack | null {
        const result = state.results[trackIndex];
        return result ? { trackIndex, filePath: result.filePath, analysisId, settingsSignature: currentSettingsSignature() } : null;
    }
    function laneTrackFull(trackIndex: number, read: (track: LaneTrack) => FullSource): FullSource | undefined {
        const track = laneTrack(trackIndex);
        return track ? read(track) : undefined;
    }
    /** What each lane's plot component drew last (CSS pixels), which the pointer reads through (R7). */
    const lanePlots = new WeakMap<HTMLCanvasElement, StagePlot>();
    const spectrogramPlots = new WeakMap<HTMLCanvasElement, StagePlot>();
    function drawTrackWaveform(canvas: HTMLCanvasElement, result: ComparisonTrackState, trackIndex: number, channelIndex: number, offsetSeconds: number, color: string, options: WaveformDrawOptions = {}): void {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const src = resolveWaveformSource(result, trackIndex, channelIndex, offsetSeconds);
        const record = trackRecordAtIndex(trackIndex);
        const placement = trackTimelinePlacement(offsetSeconds, result.durationSeconds, trackStore.globalSpan());
        const amplitudeZoomed = waveformView.isAmplitudeZoomed();
        const axis = laneAmplitudeAxis(result, channelIndex);
        const unit = channelsForResult(result)[channelIndex]?.unit?.trim() ?? '';
        // Drawn by the plot component (R13), as every plot of lines: its gridlines, the signal by the shared waveform
        // layer, and its value axis on the canvas beside it.
        const lane = laneWaveformOverlay(src, { ...trackStore.globalSpan(), ...placement }, color, unit, laneTrackFull(trackIndex, track => laneReads.waveform(track, channelIndex)));
        const ratio = W / (canvas.clientWidth || W);
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const lanePlot = paintOverlay(canvas, lane.overlay, axis.range, plainNames(STR.axisTime, axis.title), {
            axisCanvas: options.drawAxis === false ? null : canvasById(document, trackAxisCanvasId(trackIndex, channelIndex)),
            axisView: lane.axisView,
            window: { x: { start: waveformView.start, end: waveformView.end } },
            onSignalPoint: (x, y, _value, _time, seen) => {
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                if (seen) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
            },
        });
        if (lanePlot) lanePlots.set(canvas, lanePlot); else lanePlots.delete(canvas);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        markLanePlot(canvas, { x: STR.axisTime, y: axis.title }, trackAxisCanvasId(trackIndex, channelIndex), {
            x: { start: waveformView.start, end: waveformView.end },
            y: amplitudeZoomed ? waveformView.amplitudeWindow() : { start: 0, end: 1 },
        });
        const coverage = minX <= maxX ? waveformCoverageFromExtent({ minX: minX * ratio, maxX: maxX * ratio }, W) : null;
        // What the lane drew from, and how tall its line is on screen (CSS px): the whole file's overview, a fetched
        // range, or that range over the overview around it.
        canvas.dataset.waveformSource = !src ? 'none' : src.detail ? 'layered' : src.dataStart === 0 && src.dataEnd === 1 ? 'overview' : 'range';
        canvas.dataset.waveformHeight = minY <= maxY ? String(Math.round(maxY - minY)) : '0';
        if (record) {
            record.waveformCoverage = coverage;
        }
        drawWaveformMarks(canvas, result, trackIndex, channelIndex, color, !!laneHover && laneHover.canvas === canvas);
    }
    /**
     * What follows the cursor, the loop and the pointer over a waveform lane, on the layer laid over it (R13: the lane's
     * plot holds only what paintOverlay drew), so a playback frame redraws these lines alone and never the waveform.
     * `hovered`: the lane under the pointer reads its full data there (R7); the other lanes follow its time.
     */
    function drawWaveformMarks(canvas: HTMLCanvasElement, result: ComparisonTrackState, trackIndex: number, channelIndex: number, color: string, hovered: boolean): void {
        const layer = canvasById(document, trackWaveformOverlayCanvasId(trackIndex, channelIndex));
        const ctx = layer?.getContext('2d');
        if (!layer || !ctx) return;
        // The layer is the lane's size, so the lines are drawn in the lane's own pixels.
        if (layer.width !== canvas.width) layer.width = canvas.width;
        if (layer.height !== canvas.height) layer.height = canvas.height;
        const W = layer.width, H = layer.height;
        ctx.clearRect(0, 0, W, H);
        drawWaveformCursorLayers(ctx, W, H, trackIndex, channelIndex);
        if (hovered) drawLaneHover(ctx, W, H, result, channelIndex, color);
        else drawHoverLineOnCanvas(ctx, W, H);
        drawRectZoomSelectionOnCanvas(ctx, W, H, trackIndex);
    }
    /** What a waveform lane draws over its plot that moves with the cursor or the loop (not the hover's readout). */
    function drawWaveformCursorLayers(ctx: CanvasRenderingContext2D, W: number, H: number, trackIndex: number, channelIndex: number) {
        drawLoopRegionOnCanvas(ctx, W, H);
        drawAnalysisWindowOnCanvas(ctx, W, H, trackIndex, channelIndex);
        drawCursorOnCanvas(ctx, W, H, waveformCursorLineStyle(getComputedStyle(document.body).getPropertyValue('--text').trim()));
    }
    /** A cursor-only frame on one waveform lane: only the layer over it is drawn again, the waveform stays as painted. */
    function redrawWaveformCursor(canvas: HTMLCanvasElement, result: ComparisonTrackState, trackIndex: number, channelIndex: number, color: string) {
        const hovered = !!laneHover && laneHover.canvas === canvas;
        // The lane under the pointer reads through the plot it last drew; without one it is drawn again.
        if (hovered && !lanePlots.has(canvas)) {
            drawTrackWaveform(canvas, result, trackIndex, channelIndex, trackRuntimeAt(trackIndex).offsetSeconds, color, { drawAxis: false });
            return;
        }
        drawWaveformMarks(canvas, result, trackIndex, channelIndex, color, hovered);
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
        if (axisCanvas) clearSideAxis(axisCanvas);
        const ch = channelsForResult(result)[channelIndex];
        if (!ch || !ch.spectrogram) {
            requestTrackDetail(trackIndex);
            const failure = trackRecordAtIndex(trackIndex)?.detailError;
            const message = failure && failure.settingsSignature === currentSettingsSignature()
                ? spectrogramFailureText(STR, failure.message)
                : STR.spectrogramLoading;
            // An empty plot with its message, drawn by the plot component as an empty pane is: no axes named yet.
            paintOverlay(canvas, { layers: [] }, plainRange(0, 1), plainNames(STR.axisTime, STR.axisFrequency), { axisCanvas: null, empty: message });
            delete canvas.dataset.plotAxis;
            delete canvas.dataset.plotWindow;
            return;
        }
        // The colours and frequency range follow the whole file's, so a zoom window drawn in its place keeps them.
        const whole = ch.spectrogram;
        const shown = shownSpectrogram(result, trackIndex, channelIndex);
        const spec = shown ? shown.spec : whole;
        const { offsetNorm: trackStart, trackDurRatio } = trackTimelinePlacement(offsetSeconds, result.durationSeconds, trackStore.globalSpan());
        const { dbLo, dbHi, maxFrequencyHz: maxFreq, minFrequencyHz: minFreq } = shownSpectrogramBounds(whole);
        const record = trackRecordAtIndex(trackIndex);
        if (!record) {
            return;
        }
        const cacheId = record.id + ':' + channelIndex;
        const theme = drawTheme(), text = getComputedStyle(document.body).getPropertyValue('--text').trim() || '#ddd';
        const title = spectrogramLevelTitle(ch);
        const painted = paintTrackSpectrogram(canvas, axisCanvas, spec, { ...trackStore.globalSpan(), offsetNorm: trackStart, trackDurRatio }, {
            window: { start: waveformView.start, end: waveformView.end }, dbLo, dbHi, maxFrequencyHz: maxFreq, minFrequencyHz: minFreq,
            durationSec: result.durationSeconds,
        }, spectrogramRasterCache.get(cacheId), { colour: title, frequency: STR.axisFrequency, time: STR.axisTime }, [text, theme.bgColor, theme.lineColor].join(':'),
        laneTrackFull(trackIndex, track => laneReads.spectrogram(track, channelIndex, shown?.window ?? null)));
        spectrogramRasterCache.set(cacheId, painted);
        if (painted.plot) spectrogramPlots.set(canvas, painted.plot); else spectrogramPlots.delete(canvas);
        // paintOverlay leaves its scale on the context: the lines over the lane are drawn in the canvas's own pixels.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        // The band shown as fractions of the whole axis (0 Hz to Nyquist), whichever rows are drawn: a zoomed band's
        // rows do not change what the mark says is on screen (R13).
        const specTop = spec.maxFrequencyHz || maxFreq || 1;
        markLanePlot(canvas, { x: STR.axisTime, y: STR.axisFrequency }, trackSpecAxisCanvasId(trackIndex, channelIndex), {
            x: { start: waveformView.start, end: waveformView.end },
            y: { start: Math.max(0, minFreq) / specTop, end: Math.min(1, maxFreq / specTop) },
        });
        // Which band the rows were drawn from: every frequency, or the band asked again (R3).
        canvas.dataset.spectrogramBand = spec.bandLowHz !== undefined && spec.bandHighHz !== undefined ? `${spec.bandLowHz} ${spec.bandHighHz}` : '';
        // Which time window the picture was drawn from: the whole file, or the zoom window asked again (R3).
        canvas.dataset.spectrogramWindow = shown && shown.window ? `${shown.window.startNorm} ${shown.window.endNorm}` : '0 1';
        canvas.dataset.colourBar = [painted.colourBar.x, painted.colourBar.y, painted.colourBar.width, painted.colourBar.height].map(value => Math.round(value)).join(' ');
        if (spectrogramHover && spectrogramHover.canvas === canvas) showSpectrogramReadout(canvas, spectrogramHover.clientX, spectrogramHover.clientY);
        if (overlayCtx) {
            drawSpectrogramOverlayLines(overlayCtx, W, H, trackIndex);
        }
    }
    /** The loop region, cursor and hover over a spectrogram: on their own canvas, so the raster under them stays as painted. */
    function drawSpectrogramOverlayLines(ctx: CanvasRenderingContext2D, plotW: number, H: number, trackIndex: number) {
        drawLoopRegionOnCanvas(ctx, plotW, H);
        drawCursorOnCanvas(ctx, plotW, H);
        drawHoverLineOnCanvas(ctx, plotW, H);
        // The box being dragged on this track's spectrogram, its frequencies up the band shown.
        if (rectZoomSelection?.frequency && rectZoomSelection.trackId === trackIdAtIndex(trackIndex)) {
            drawRectZoomSelection(ctx, rectZoomSelection, waveformView.timeRange(), { start: 0, end: 1, explicit: true }, plotW, H);
        }
    }

    type CanvasHitTarget = Pick<Element, 'getBoundingClientRect'> & { width: number; classList?: DOMTokenList };
    /** A lane's canvas is its time span; a spectrogram's colour bar in its corner is not a time (null there). */
    function trackCanvasTimeHit(canvas: CanvasHitTarget, clientX: number, clientY?: number) {
        if (clientY !== undefined && onSpectrogramColourBar(canvas, clientX, clientY)) return null;
        return canvasTimeHit(canvas.getBoundingClientRect().left, clientX, canvas.width, waveformView.timeRange());
    }
    /** Whether the pointer is on a spectrogram lane's colour bar, as last painted there. */
    function onSpectrogramColourBar(canvas: CanvasHitTarget, clientX: number, clientY: number): boolean {
        if (!canvas.classList?.contains('track-spec-canvas')) return false;
        const box = (canvas as HTMLCanvasElement).dataset?.colourBar?.split(' ').map(Number);
        if (!box || box.length !== 4) return false;
        const rect = canvas.getBoundingClientRect();
        const [x, y, width, height] = box;
        const sx = canvas.width / Math.max(rect.width, 1), sy = (canvas as HTMLCanvasElement).height / Math.max(rect.height, 1);
        return onColourBar({ colourBar: { x, y, width, height } }, (clientX - rect.left) * sx, (clientY - rect.top) * sy);
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
        // A slice from another cursor (one still on its way after playback or a move) would put the band elsewhere.
        if (!sliceIsCurrentAt(trackIndex, slice, spectrumCursorNorm)
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
    /** The bands last drawn, kept while one action's cursor spectra are still arriving so every track's band moves together. */
    const shownWindowBands = createLatestAnswers<AnalysisWindowBand | null>();
    const spectrumCommitHold = new SpectrumCommitHold({
        now: spectrumNow,
        setTimeout: (handler, ms) => window.setTimeout(handler, ms),
        clearTimeout: (id) => window.clearTimeout(id),
        onExpired() {
            scheduleRender();
            spectrumRequests.scheduleFrame(false, false);
        },
    });
    /** Whether a shown track's spectrum at the cursor is still on its way (and the hold has not run out); one answer per drawing pass. */
    let holdingThisPass: boolean | null = null;
    function holdingSpectrumCommit() {
        if (holdingThisPass !== null) {
            return holdingThisPass;
        }
        const pending = trackStore.displayOrder.some(function (trackId) {
            const record = trackStore.require(trackId);
            return !record.runtime.hidden && isSpectrumSliceRequestPendingForCursor(record.protocolIndex, spectrumCursorNorm);
        });
        holdingThisPass = spectrumCommitHold.holds(pending, spectrumRequests.generation);
        // Every lane drawn in this pass sees the same answer, so the cap never splits a frame.
        queueMicrotask(function () { holdingThisPass = null; });
        return holdingThisPass;
    }
    function displayedWindowBand(trackIndex: number, channelIndex: number, holding: boolean): AnalysisWindowBand | null {
        const record = trackRecordAtIndex(trackIndex);
        if (!record) {
            return null;
        }
        const key = record.id + ':' + channelIndex;
        // A hidden track keeps no band to show again when it comes back.
        if (record.runtime.hidden) {
            shownWindowBands.delete(key);
            return null;
        }
        // While playing no band is drawn: the header's caption reads the live one and nothing is kept for after.
        if (playback.isRunning()) {
            return analysisWindowBand(trackIndex, channelIndex);
        }
        if (holding) {
            // A track with nothing shown yet (after playback, or just shown again) waits for the others too.
            return shownWindowBands.get(key) ?? null;
        }
        const band = analysisWindowBand(trackIndex, channelIndex);
        shownWindowBands.set(key, band);
        return band;
    }
    function drawAnalysisWindowOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number, trackIndex: number, channelIndex: number) {
        if (playback.isRunning()) {
            // The bands from before playback are not shown again when it stops.
            shownWindowBands.clear();
            return;
        }
        const band = displayedWindowBand(trackIndex, channelIndex, holdingSpectrumCommit());
        if (band) {
            drawAnalysisWindowBand(ctx, band, waveformView.timeRange(), W, H, isLightTheme());
        }
    }
    function drawCursorOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number, style = CURSOR_LINE_STYLE) {
        drawDashedTimeLine(ctx, viewState.cursor, waveformView.timeRange(), W, H, style);
    }
    /** The pointer over a waveform lane (client pixels), whose lane reads the point nearest it (R7). */
    let laneHover: { canvas: HTMLCanvasElement; clientX: number; clientY: number } | null = null;
    /** The pointer over a spectrogram lane (client pixels), whose lane reads the cell under it on every paint (R7). */
    let spectrogramHover: { canvas: HTMLCanvasElement; clientX: number; clientY: number } | null = null;
    // A scroll under a still pointer moves the lane from under it: the point read goes with it.
    document.addEventListener('scroll', () => { if (laneHover || spectrogramHover) { hideLaneHover(); scheduleRender(); } }, true);
    /** The point a lane's readout last read and the plot it read it on, for an arrow key to step from (R7). */
    let laneRead: { canvas: HTMLCanvasElement; plot: StagePlot; read: StageRead } | null = null;
    /**
     * The point an arrow key stepped to on a lane, with the pointer place it was shown at: the lane reads that point
     * there, not whichever point shares its pixel, until the pointer moves (R7).
     */
    let laneStepped: { canvas: HTMLCanvasElement; clientX: number; clientY: number; read: StageRead } | null = null;
    /** The stepped point on the lane's plot as now drawn (a repaint may have moved it), if the pointer is still there. */
    function steppedRead(canvas: HTMLCanvasElement, plot: StagePlot, clientX: number, clientY: number): StageRead | null {
        const step = laneStepped;
        if (!step || step.canvas !== canvas || step.clientX !== clientX || step.clientY !== clientY) return null;
        const { read } = step;
        if (read.at === undefined) return read;
        if (read.image) return plot.image && read.row !== undefined ? { ...read, x: plot.image.placeOf(read.at, read.row).x } : read;
        return read.value === undefined ? read : { ...read, x: plot.xAt(read.at), y: plot.yAt(read.value) };
    }
    function hideLaneHover(): void {
        laneRead = null;
        laneStepped = null;
        laneHover = null;
        spectrogramHover = null;
        hidePlotReadout(document.getElementById(PLOT_READOUT_ID));
    }
    function drawLaneHover(ctx: CanvasRenderingContext2D, W: number, H: number, result: ComparisonTrackState, channelIndex: number, color: string): void {
        if (!laneHover) return;
        const { canvas, clientX, clientY } = laneHover;
        const rect = canvas.getBoundingClientRect();
        const ratioX = rect.width > 0 ? W / rect.width : 1, ratioY = rect.height > 0 ? H / rect.height : 1;
        const plot = lanePlots.get(canvas);
        const slot = document.getElementById(PLOT_READOUT_ID);
        const x = clientX - rect.left, y = clientY - rect.top;
        // Read from the lane's samples (R7); while those around the pointer are fetched, the lane paints again once in.
        const read = plot ? steppedRead(canvas, plot, clientX, clientY) ?? stageHover(plot, x, y, scheduleRender) : null;
        notePlotRead(canvas, read);
        laneRead = plot && read ? { canvas, plot, read } : null;
        if (!read || read.pending || read.at === undefined || read.value === undefined) {
            if (read?.pending) {
                // No number until the samples are in: the cursor at the pointer, the readout empty.
                ctx.save();
                ctx.scale(ratioX, ratioY);
                paintHoverMarks(ctx, { left: 0, top: 0, width: W / ratioX, height: H / ratioY }, x, null, '');
                ctx.restore();
            } else drawHoverLineOnCanvas(ctx, W, H);
            hidePlotReadout(slot);
            return;
        }
        ctx.save();
        ctx.scale(ratioX, ratioY);
        paintHoverMarks(ctx, { left: 0, top: 0, width: W / ratioX, height: H / ratioY }, read.x, read.y, color);
        ctx.restore();
        const range = waveformView.timeRange();
        const span = trackStore.globalSpan();
        const secondsPerPixel = rect.width > 0 ? (range.end - range.start) * span.spanSec / rect.width : 0.01;
        // On the lanes' time axis, as the ruler and the cursor show it (a shifted track's offset included).
        const readNorm = span.spanSec > 0 ? (read.at - span.startSec) / span.spanSec : 0;
        // The other lanes and the time shown follow the point read, not the pointer beside it (as the spectra do).
        if (viewState.hover === null || Math.abs(viewState.hover - readNorm) > 1e-9) viewState.setHover(readNorm);
        const unit = channelsForResult(result)[channelIndex]?.unit?.trim() || null;
        showPlotReadout(slot, spectrumReadoutTrackLabel(result, channelIndex), laneReadoutText('', read.at, secondsPerPixel, read.value, unit, read.step), color);
    }
    /**
     * The pointer over a spectrogram lane reads the real STFT cell under it in the toolbar (R7): one frame and one bin
     * of the full data the picture was drawn from, never a cell averaged for the screen. Read again on every paint of
     * the lane, so a view panned or a range changed under a still pointer reads what is under it now.
     */
    function showSpectrogramReadout(canvas: HTMLCanvasElement, clientX: number, clientY: number): void {
        spectrogramHover = { canvas, clientX, clientY };
        const slot = document.getElementById(PLOT_READOUT_ID);
        const trackIndex = trackIndexFromElement(canvas);
        const result = trackIndex === null ? undefined : state.results[trackIndex];
        const channelIndex = channelIndexAttribute(canvas) ?? 0;
        const spec = result && trackIndex !== null ? shownSpectrogram(result, trackIndex, channelIndex)?.spec : undefined;
        const plot = spectrogramPlots.get(canvas);
        const rect = canvas.getBoundingClientRect();
        if (trackIndex === null || !result || !spec || !plot || rect.height <= 0 || rect.width <= 0) { laneRead = null; notePlotRead(canvas, null); hidePlotReadout(slot); return; }
        const view = waveformView.timeRange();
        const span = trackStore.globalSpan();
        const again = (): void => { if (spectrogramHover?.canvas === canvas) showSpectrogramReadout(canvas, spectrogramHover.clientX, spectrogramHover.clientY); };
        const read = steppedRead(canvas, plot, clientX, clientY) ?? stageHover(plot, clientX - rect.left, clientY - rect.top, again);
        notePlotRead(canvas, read);
        laneRead = read ? { canvas, plot, read } : null;
        // The other lanes' time line follows the pointer's time, as before the cell under it is read.
        const norm = view.start + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (view.end - view.start);
        if (viewState.hover === null || Math.abs(viewState.hover - norm) > 1e-9) viewState.setHover(norm);
        if (!read || read.pending) { hidePlotReadout(slot); return; }
        const label = spectrumReadoutTrackLabel(result, channelIndex);
        // A number only of the full data (R7): until its cell is read there, the readout stays empty, never the drawn picture's.
        if (!read.full || read.at === undefined || read.row === undefined || read.value === undefined) { hidePlotReadout(slot); return; }
        const secondsPerPixel = (view.end - view.start) * span.spanSec / rect.width;
        // The level in the reference its colour bar names (dB re 1 V, dB SPL re 20 µPa, dBFS), never bare dB (R7).
        const levelUnit = trackLevelInput([channelsForResult(result)[channelIndex]], undefined).levelReferenceLabel;
        showPlotReadout(slot, label, spectrogramReadoutText('', read.at, secondsPerPixel, { frequencyHz: read.row, level: read.value, ...(read.rowStep !== undefined ? { stepHz: read.rowStep } : {}) }, levelUnit, read.step), trackColor(trackIndex));
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
        if (rectZoomSelection && !rectZoomSelection.frequency && rectZoomSelection.trackId === trackIdAtIndex(trackIndex)) {
            drawRectZoomSelection(ctx, rectZoomSelection, waveformView.timeRange(), waveformView.amplitudeViewport(), W, H);
        }
    }
    function updateVisibility() {
        // まず各行の display を更新する
        document.querySelectorAll<HTMLElement>('.track-row').forEach(function (row) {
            const trackId = trackIdFromElement(row);
            if (trackId) {
                const isHidden = trackStore.require(trackId).runtime.hidden;
                row.style.display = isHidden ? 'none' : 'flex';
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
        // The lanes answer the shared plot gestures on their one time window: zooming one lane zooms them all. In the
        // steps mode they answer the mode's (trackStageGestures.ts) instead.
        attachPlotInteraction(tracksWrapper, document, '.track-canvas', {
            locate: laneHit,
            pointOn(plot, clientX, clientY) {
                const canvas = plot.isConnected ? plot : canvasById(document, plot.id);
                return lanePoint((canvas ?? plot) as HTMLCanvasElement, clientX, clientY);
            },
            window: laneWindow,
            setWindow: (_plot, next) => setLaneWindow(next),
            wheelAt: laneWheelAt,
            hover: hoverLane,
            clearHover() { if (contentType !== 'stage') clearHover(); },
            stepFrom: stepLaneFrom,
            pressed: pressLane,
            showBox: showLaneBox,
            hideBox() { rectZoomSelection = null; },
            zoomToBox: zoomLanesToBox,
            tap: (_plot, e) => endLaneDrag(e, false),
            altDrag: {
                start() { if (lanePress) lanePress.dragType = loopGripAt(viewState.loop, lanePress.startNorm, waveformView.span()) ?? 'loop'; },
                move: moveLaneDrag,
                end: endLaneDrag,
            },
            shiftDrag: {
                start() { if (lanePress) lanePress.dragType = 'offset'; },
                move: moveLaneDrag,
                end: endLaneDrag,
            },
            openAxisRange: (_hit, clientX, clientY, element) => openTrackAxisRange(element, clientX, clientY),
            axes: {
                selector: '.track-axis-canvas, #ruler-canvas',
                locate(axis, clientX, clientY) {
                    if (contentType === 'stage') return null;
                    // The lanes' time axis: the first lane shown, at the time under the pointer.
                    if (axis.id === 'ruler-canvas') {
                        const first = canvasesMatching(document, '.track-canvas:not(.track-spec-canvas)').find(function (c) { return c.width > 1 && c.offsetParent !== null; });
                        return first ? { plot: first, point: lanePoint(first, clientX, first.getBoundingClientRect().top + 1), axis: 'x' } : null;
                    }
                    const lane = laneOfAxis(axis);
                    return { plot: lane ?? axis, point: lane ? lanePoint(lane, clientX, clientY) : { fx: 0, fy: 0.5 }, axis: 'y' };
                },
            },
            focusKeepsArrows: true,
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
                layoutElementIds.push(trackCanvasWrapId(i, channelIndex));
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
        // カーソル時刻のパワースペクトルのホバーとキーボード
        (function attachSpectrumCursorEvents() {
            const overlayCanvas = canvasById(document, 'spectrum-overlay-canvas');
            if (overlayCanvas) {
                // The plot component's gestures (plotInteraction.ts, R7, R9, R13): the pointer's marks and readout, ← / → to
                // step it, a box dragged zooms both axes, Ctrl+wheel zooms and Shift+wheel or a swipe pans the frequency axis,
                // a double-click resets, or on an axis opens its range. Across: the frequency axis as a whole; up: the
                // levels on screen (the dB axis follows the data).
                const canvasPoint = (clientX: number, clientY: number): { x: number; y: number } =>
                    clientToCanvasPixels(clientX, clientY, overlayCanvas.getBoundingClientRect(), overlayCanvas.width, overlayCanvas.height);
                const pointOn = (clientX: number, clientY: number): PlotPoint => {
                    const at = canvasPoint(clientX, clientY);
                    const point = overlayPlotPoint(at.x, at.y, overlayCanvas.width, overlayCanvas.height);
                    return { fx: point?.freqNorm ?? 0, fy: point?.dbNorm ?? 0 };
                };
                const zoomBox = document.createElement('div');
                zoomBox.className = 'compare-zoom-box';
                zoomBox.hidden = true;
                document.body.append(zoomBox);
                // The level axis's part on screen, as a part of the levels shown before a box zoomed it (R13): known
                // while the dB range is the one the box set; another (typed, a key's zoom) is a new whole.
                let boxedDb: { min: number; max: number; y: { start: number; end: number } } | null = null;
                const spectrumWindow = (): PlotWindow => ({
                    x: { start: spectrumView.freqStart, end: spectrumView.freqEnd },
                    y: boxedDb && spectrumView.dbMin === boxedDb.min && spectrumView.dbMax === boxedDb.max ? boxedDb.y : FULL_PLOT_WINDOW.y,
                });
                attachPlotInteraction(overlayCanvas.parentElement ?? overlayCanvas, document, '#spectrum-overlay-canvas', {
                    locate(target, clientX, clientY) {
                        if (target !== overlayCanvas || !spectrumView.hasData()) return null;
                        const at = canvasPoint(clientX, clientY);
                        const region = overlaySpectrumRegionAt(at.x, at.y, overlayCanvas.width, overlayCanvas.height);
                        if (!region) return null;
                        return { plot: overlayCanvas, point: pointOn(clientX, clientY), axis: region === 'db-axis' || region === 'db-axis-right' ? 'y' : region === 'freq-axis' ? 'x' : null };
                    },
                    pointOn: (_plot, clientX, clientY) => pointOn(clientX, clientY),
                    window: spectrumWindow,
                    setWindow(_plot, next) {
                        if (!next) { boxedDb = null; specZoomReset(); return; }
                        // The box is a part of the window shown; its dB, a part of the levels painted now.
                        const shown = spectrumWindow().y, span = shown.end - shown.start || 1;
                        const y = { start: (next.y.start - shown.start) / span, end: (next.y.end - shown.start) / span };
                        spectrumView.applyBoxZoom(spectrumZoomFromWindow({ x: next.x, y }, spectrumView.paintedDb()));
                        if (spectrumView.dbMin !== null && spectrumView.dbMax !== null && (y.start !== 0 || y.end !== 1)) boxedDb = { min: spectrumView.dbMin, max: spectrumView.dbMax, y: next.y };
                        scheduleSpectrumRefresh('immediate');
                    },
                    hover(event, hit) {
                        if (hit) hintFooter.show(hit.axis === 'y' ? STR.hintSpectrumDbAxis : hit.axis === 'x' ? STR.hintSpectrumFreqAxis : STR.hintSpectrumPlot);
                        else hintFooter.clear();
                        spectrumPointer = hit && !hit.axis ? { clientX: event.clientX, clientY: event.clientY } : null;
                        if (spectrumPointer) spectrumFollowHz = null;
                        showSpectrumMarks();
                        scheduleSpectrumRefresh('hover');
                    },
                    clearHover() {
                        spectrumPointer = null;
                        showSpectrumMarks();
                        scheduleSpectrumRefresh('hover');
                    },
                    stepFrom: (_plot, delta, arrived) => (spectrumShown() ? spectrumMarks.stepFrom(overlayCanvas, spectrumDrawn, delta, arrived) : null),
                    showBox(_plot, from, to) {
                        const frame = spectrumDrawn?.frame;
                        if (!frame) return;
                        const rect = overlayCanvas.getBoundingClientRect();
                        const [x0, x1] = [Math.min(from.fx, to.fx), Math.max(from.fx, to.fx)], [y0, y1] = [Math.min(from.fy, to.fy), Math.max(from.fy, to.fy)];
                        Object.assign(zoomBox.style, { left: `${rect.left + frame.left + x0 * frame.width}px`, top: `${rect.top + frame.top + (1 - y1) * frame.height}px`, width: `${(x1 - x0) * frame.width}px`, height: `${(y1 - y0) * frame.height}px` });
                        zoomBox.hidden = false;
                    },
                    hideBox() { zoomBox.hidden = true; },
                    openAxisRange(hit, clientX, clientY) { openSpectrumRangePopup(hit.axis === 'y' ? 'db' : 'freq', clientX, clientY); return true; },
                });
                attachCanvasFocusHint(overlayCanvas, hintFooter, STR.hintSpectrumPlot);
            }
            pairPanel.attach();
            attachRebuiltTrackEvents = attachTrackCanvasFocusEvents;
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
        if (action === 'open-samples') {
            vscode.openSamples?.();
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
        // Not drawn while the comparison showed: the spectra are drawn again, from what is held, with the next frame.
        if (contentType === 'stage' && next !== 'stage') spectraHidden = true;
        contentType = next;
        hideLaneHover();
        stageMode?.setActive(next === 'stage');
        document.body.classList.toggle('is-stage-view', next === 'stage');
        // The track lanes, on one time axis, share the toolbar's readout above them (R7); the steps view reads in its own row.
        document.getElementById('tracks-wrapper')?.toggleAttribute('data-plot-stack', next !== 'stage');
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
                // Opened with no role at all (no slot holds a file, shown as a track or not), the comparison would draw
                // every line grey: the first two recordings shown start as the base and compare 1, so it opens on
                // something compared. With the rows grouped, the group's median is the base already: only compare 1 is set.
                // The legend's chips change them.
                const shownFiles = [...new Set(trackStore.displayOrder.map(id => trackStore.require(id)).filter(record => !record.runtime.hidden && !record.result.error).map(record => record.result.filePath))];
                const grouped = entryScreen.grouped();
                if (contentType !== 'stage' && shownFiles.length >= (grouped ? 1 : 2) && entryScreen.slots().every(path => !path)) {
                    if (grouped) entryScreen.setTrackRole(shownFiles[0], 1);
                    else {
                        entryScreen.setTrackRole(shownFiles[0], 0);
                        entryScreen.setTrackRole(shownFiles[1], 1);
                    }
                }
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
            'toggle-follow-cursor': toggleFollowCursor,
            'link-scales': toggleLinkedScales,
            'zoom-to-selection': zoomToSelection,
            'open-recipe': openRecipe,
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
    function renderEveryLane() {
        drawEveryLane = true;
        try { renderStackedTracks(); checkAndRequestRanges(); } finally { drawEveryLane = false; }
        // The analysis window band drawn on each lane comes from its cursor spectrum: lanes out of view ask for theirs too.
        if (contentType !== 'stage') requestEveryCursorSpectrum(spectrumCursorNorm);
    }
    /** The open spectrogram, zoom-detail and cursor-spectrum requests. */
    function openDetailRequestIds(): Set<string> {
        const ids = new Set<string>();
        state.results.forEach(function (_: ComparisonTrackState, i: number) {
            const requests = trackRecordAtIndex(i)?.requests;
            ['detail', 'specZoom', 'slice'].forEach(function (slot) {
                const pending = requests?.pending(slot);
                if (pending) ids.add(pending.requestId);
            });
            // A redraw asks again for zoom detail only past the range on its way or after UNANSWERED_RETRY_MS: the same span is the same wait.
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
        spectrumCsvExportOpen = true;
        requestEveryCursorSpectrum();
        announce(STR.announceExportCsvStarted || 'CSV export started');
        taskStatus(STR.exportCsvBusy, 'busy');
        writeCsvWhenDetailed(openDetailRequestIds(), Date.now() + 30000, viewState.cursor);
    }
    /** Asks for the cursor spectrum of every shown track, whether or not its lane is on screen. */
    function requestEveryCursorSpectrum(cursorNorm = viewState.cursor) {
        drawEveryLane = true;
        try {
            trackStore.activeIds().forEach(function (trackId) {
                const record = trackStore.require(trackId);
                if (record.runtime.hidden) return;
                channelsForResult(record.result).forEach(function (_, channelIndex: number) {
                    extractSpectrumAtCursor(record.result, record.protocolIndex, record.runtime.offsetSeconds, cursorNorm, channelIndex);
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
        const tracks: CsvSpectrumTrack[] = [];
        const omitted: string[] = [];
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
                // Only this cursor's slice is written: one from an earlier cursor (its successor failed or still on its
                // way) is left out, never written as this cursor's row.
                const current = sliceIsCurrentAt(i, cached, viewState.cursor);
                const stale = current && isSpectrumSliceRequestPendingForCursor(i, viewState.cursor);
                // Inside the track only the backend's every-bin row is written: never the row cut for display, nor
                // the spectrogram column drawn while that row is on its way.
                const inside = trackLocalCursorNorm(i, viewState.cursor) !== null;
                const waiting = stale || (inside && (!current || !!cached.frequenciesHz));
                const name = (result.fileName || ('track' + (i + 1))) + ' ' + channelLabel(result, channelIndex);
                if (waiting || !slice || !slice.values || slice.values.length === 0) {
                    missing = missing || waiting || inside;
                    if (waiting || inside) omitted.push(name);
                    return;
                }
                tracks.push({ name, slice, levelTitle: spectrogramLevelTitle(channelsForResult(result)[channelIndex]) });
            });
        });
        // A spectrum still on its way: write once the requests the export asked for are answered (or after a while).
        if (missing && anyStillOpen(waitFor) && Date.now() < deadline) {
            setTimeout(function () { writeCsvWhenDetailed(waitFor, deadline, exportCursorNorm); }, 100);
            return;
        }
        spectrumCsvExportOpen = false;
        if (tracks.length === 0) {
            messaging.post({ type: 'show-info', message: STR.announceExportCsvFailed || 'CSV export failed: no spectrum data at cursor' });
            taskStatus(STR.announceExportCsvFailed, 'failed');
            return;
        }
        const csv = buildSpectrumCsv(tracks, frequencyTitle(STR));
        // A spectrum the backend failed (or never answered) is left out rather than written from the row cut for display.
        const left = omitted.length > 0 ? STR.exportCsvOmitted.replace('{count}', String(omitted.length)).replace('{names}', omitted.join(', ')) : '';
        if (left) messaging.post({ type: 'show-info', message: left });
        taskStatus(STR.exportCsvDone.replace('{name}', 'spectrum-export.csv') + (left ? ' — ' + left : ''), 'done');
        if (messaging.downloadFile(csv, 'spectrum-export.csv', 'text/csv;charset=utf-8')) return;
        triggerAnchorDownload(document, 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), 'spectrum-export.csv');
    }
    /**
     * A .recipe.json read here, in the page, into the step bar: the comparison runs its chain on the recordings
     * compared and opens on its last step (recipeOpen.ts says which Recipes can be one chain on each recording).
     */
    function openRecipe() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', () => { void (async () => {
            const file = input.files?.[0];
            if (!file) return;
            let parsed: unknown;
            try { parsed = JSON.parse(await file.text()); } catch { parsed = undefined; }
            const opened = openedRecipe(parsed);
            if ('reason' in opened) {
                const count = isRecipeDocument(parsed) ? parsed.inputs.length : 0;
                const text = opened.reason === 'inputs' ? STR.recipeOpenInputs.replace('{count}', String(count))
                    : opened.reason === 'pair' ? STR.recipeOpenPair
                    : opened.reason === 'not-chain' ? STR.recipeOpenNotChain : STR.recipeOpenNotRecipe;
                taskStatus(text.replace('{name}', file.name), 'failed');
                return;
            }
            if (contentType !== 'stage') handleToolbarAction('content-stage');
            const said = STR.recipeOpened.replace('{name}', file.name);
            // One edit of the step bar: ↶ brings back the chain that was there.
            if (stageMode) stageMode.openRecipe(opened.recipe, said);
            else entryScreen.setRecipe(opened.recipe);
            taskStatus(said, 'done');
        })(); });
        input.click();
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
        spectrogramFrequencyView = null;
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
                // The popover names the axis as the plot does (R4): its level axis' own name, never a bracketless "(dB)".
                axisLabel: spectrumLevelAxisTitle || figureLevelTitle(STR, 'dBFS', false),
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
            axisLabel: STR.axisFrequency,
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
            return onSpectrogramColourBar(element as HTMLCanvasElement, clientX, clientY) && openSpectrogramRangePopup(element, 'level', clientX, clientY);
        }
        if (element.id === 'ruler-canvas') return openTimeRangePopup(clientX, clientY);
        return element.classList.contains('track-axis-canvas') && openWaveformRangePopup(element, clientX, clientY);
    }
    // The lanes' time axis: the part of the tracks' time they show, typed in seconds (blank: that end of it).
    function openTimeRangePopup(clientX: number, clientY: number): boolean {
        const gs = trackStore.globalSpan();
        if (!(gs.spanSec > 0)) return false;
        openAxisPart(waveformRangePopover, {
            mapping: linearAxis(gs.startSec, gs.startSec + gs.spanSec, STR.axisTime), horizontal: true,
            current: waveformView.timeRange(), clientX, clientY, invalid: STR.specRangeErrorMinMax,
            set: part => setLaneWindow(part.start <= 0 && part.end >= 1 ? null : { x: part, y: FULL_PLOT_WINDOW.y }),
        });
        return true;
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
        // What the lane shows (a box zoom's band included), so the popover starts from what is on screen.
        const bounds = shownSpectrogramBounds(spec);
        const zoomed = spectrogramFrequencyView !== null;
        const field = (value: number) => String(Number(value.toPrecision(4)));
        // An edge left as shown keeps its setting (auto, or a top clamped to this lane's Nyquist), so the clicked lane's
        // own range is not set on every lane.
        const typed = (value: number | null, shown: number, setting: number | null | undefined) =>
            value !== null && field(value) === field(shown) ? setting ?? null : value;
        if (axis === 'level') {
            waveformRangePopover.open({
                axisLabel: spectrogramLevelTitle(channelsForResult(result as ComparisonTrackState)[channelIndexAttribute(element) ?? 0]),
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
            axisLabel: STR.axisFrequency,
            horizontal: false,
            min: field(bounds.minFrequencyHz),
            max: field(bounds.maxFrequencyHz),
            clientX, clientY,
            apply(min, max) {
                const bottom = min !== null && min > 0 ? min : null;
                if (max !== null && max <= (bottom ?? 0)) {
                    return STR.specRangeErrorMinMax;
                }
                spectrogramFrequencyView = null;
                setSpectrogramDisplay({ ...display, minFrequencyHz: bottom, maxFrequencyHz: zoomed ? max : typed(max, bounds.maxFrequencyHz, display.maxFrequencyHz) });
            },
            auto() {
                spectrogramFrequencyView = null;
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
        const painted = waveformView.paintedAmplitudeRange();
        const field = (norm: number) => String(Number((norm * peak).toPrecision(4)));
        waveformRangePopover.open({
            axisLabel: laneAmplitudeAxis(result as ComparisonTrackState, channelIndexAttribute(axis) ?? 0).title,
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
    // ── The lanes outside the steps mode answer the shared plot gestures (plotInteraction.ts) on their one time window ──
    /** A lane's point: across its time (0–1 of the view) and up it, a waveform in its bitmap's rows (as its amplitudes are mapped), a spectrogram on screen. */
    function lanePoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): PlotPoint {
        const rect = canvas.getBoundingClientRect();
        const height = canvas.classList.contains('track-spec-canvas') ? rect.height : canvas.height;
        return {
            fx: Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, canvas.width))),
            fy: Math.max(0, Math.min(1, 1 - (clientY - rect.top) / Math.max(1, height))),
        };
    }
    function laneNorm(point: PlotPoint): number {
        const view = waveformView.timeRange();
        return view.start + point.fx * (view.end - view.start);
    }
    /** Up a lane: a waveform's amplitude, or a spectrogram's place up the band shown (0 at its bottom, 1 at its top). */
    function laneUp(canvas: HTMLCanvasElement, point: PlotPoint): number {
        return canvas.classList.contains('track-spec-canvas') ? point.fy : waveformView.canvasYToAmplitude((1 - point.fy) * canvas.height, canvas.height);
    }
    /** The frequency band a spectrogram lane shows: its display settings' band, or the box zoom's band (the same Hz on every lane). */
    function shownSpectrogramBounds(whole: SpectrogramData) {
        const bounds = spectrogramDisplayBounds(whole, spectrogramSettings.display, spectrogramAutoBounds(whole));
        return spectrogramFrequencyView ? { ...bounds, minFrequencyHz: spectrogramFrequencyView.lowHz, maxFrequencyHz: spectrogramFrequencyView.highHz } : bounds;
    }
    /** The lane under the pointer, while the lanes are not the steps mode's; a spectrogram's colour bar is its level axis. */
    function laneHit(target: EventTarget | null, clientX: number, clientY: number): PlotHit | null {
        const element = target as HTMLElement | null;
        const canvas = contentType !== 'stage' && element && typeof element.closest === 'function' ? element.closest<HTMLCanvasElement>('.track-canvas') : null;
        const trackIndex = canvas ? trackIndexFromElement(canvas) : null;
        if (!canvas || trackIndex === null || !trackIdAtIndex(trackIndex)) return null;
        return { plot: canvas, point: lanePoint(canvas, clientX, clientY), axis: onSpectrogramColourBar(canvas, clientX, clientY) ? 'y' : null };
    }
    /** The lane an axis canvas beside it belongs to: its waveform's amplitude axis, or its spectrogram's frequency axis. */
    function laneOfAxis(axis: HTMLElement): HTMLCanvasElement | null {
        const trackIndex = trackIndexFromElement(axis);
        if (trackIndex === null) return null;
        const channelIndex = channelIndexAttribute(axis) ?? 0;
        return canvasById(document, axis.classList.contains('track-spec-axis') ? trackSpecCanvasId(trackIndex, channelIndex) : trackCanvasId(trackIndex, channelIndex));
    }
    /** The lanes' one window: their shared time across, and up each lane what it last drew. */
    function laneWindow(canvas: HTMLElement): PlotWindow {
        const [, , start, end] = (canvas.dataset.plotWindow ?? '').split(' ').map(Number);
        return { x: waveformView.timeRange(), y: Number.isFinite(start) && Number.isFinite(end) ? { start, end } : FULL_PLOT_WINDOW.y };
    }
    function setLaneWindow(next: PlotWindow | null): void {
        if (!next) {
            resetZoom();
            return;
        }
        disableFollowCursor();
        waveformView.setTimeRange(next.x);
        scheduleRender();
    }
    /**
     * Where a wheel zooms or pans the lanes' time: the lane under it, or beside the lanes (their headers) the time at
     * the pointer's place across them, the middle off it. Over an axis (a lane's axis canvas, the time ruler, a
     * spectrogram's colour bar) the hit says so, and a zoom is about the middle, as on every plot.
     */
    function laneWheelAt(target: EventTarget | null, clientX: number, clientY: number, _gesture: 'zoom' | 'pan'): PlotHit | null {
        if (contentType === 'stage') return null;
        const hit = laneHit(target, clientX, clientY);
        if (hit) return hit;
        const wrapper = document.getElementById('tracks-wrapper');
        const lane = wrapper?.querySelector<HTMLElement>('.track-canvas');
        if (!wrapper || !lane) return null;
        const element = target as Partial<Element> | null;
        const axis = typeof element?.closest !== 'function' ? null : element.closest('#ruler-canvas') ? 'x' : element.closest('.track-axis-canvas') ? 'y' : null;
        const rect = wrapper.getBoundingClientRect();
        const plotX = clientX - rect.left - TRACK_HEADER_W, width = rect.width - TRACK_HEADER_W;
        return { plot: lane, point: { fx: width > 0 && plotX >= 0 && plotX <= width ? plotX / width : 0.5, fy: 0.5 }, axis };
    }
    function hoverLane(e: PlotPointer & Partial<Pick<MouseEvent, 'altKey' | 'shiftKey'>>): void {
        if (contentType === 'stage') return;
        const target = e.target as HTMLElement | null;
        const canvas = target && target.classList && target.classList.contains('track-canvas') ? target as HTMLCanvasElement : null;
        if (!canvas) {
            // Off the lanes but still among the tracks (an axis, a header, the split): the lane's readout goes.
            if (laneHover || spectrogramHover) { hideLaneHover(); scheduleRender(); }
            return;
        }
        if (lanePress) {
            return;
        }
        const hit = trackCanvasTimeHit(canvas, e.clientX, e.clientY);
        const onColorbar = onSpectrogramColourBar(canvas, e.clientX, e.clientY);
        canvas.style.cursor = onColorbar ? 'pointer' : '';
        if (!hit) {
            clearHover();
            if (onColorbar) hintFooter.show(STR.hintSpectrogramColorbar);
            else hintFooter.clear();
            return;
        }
        const norm = hit.norm;
        if (canvas.classList.contains('track-spec-canvas')) { hideLaneHover(); showSpectrogramReadout(canvas, e.clientX, e.clientY); }
        else laneHover = { canvas, clientX: e.clientX, clientY: e.clientY };
        // The hint names the drag that will run: Alt on a loop's edge moves it, Alt sets the loop, Shift shifts the track.
        const gripType = e.altKey ? loopGripAt(viewState.loop, norm, waveformView.span()) : null;
        const action = gripType ? STR.tooltipLoopResize
            : e.shiftKey || e.altKey ? STR.tooltipLoopOrShift
            : viewState.loop && norm >= viewState.loop.start && norm <= viewState.loop.end ? STR.tooltipLoopClear + ' / ' + STR.hintRectZoomDrag
            : STR.hintRectZoomDrag;
        hintFooter.show(action + ' / ' + STR.hintDoubleClickResetZoom + ' / ' + STR.hintWheelGestures);
        renderWithHoverAt(norm);
    }
    /** Where a press on a lane started, for the drag it becomes (or the click it stays). */
    function pressLane(hit: PlotHit, e: MouseEvent): void {
        const canvas = hit.plot as HTMLCanvasElement;
        const trackIndex = trackIndexFromElement(canvas);
        const trackId = trackIndex === null ? null : trackIdAtIndex(trackIndex);
        if (trackIndex === null || !trackId) return;
        lanePress = {
            trackId,
            canvasId: canvas.id,
            startClientX: e.clientX,
            startOffset: trackRuntimeAt(trackIndex).offsetSeconds,
            canvasWidth: canvas.width,
            startNorm: laneNorm(hit.point),
            dragType: null,
        };
        canvas.focus();
    }
    /** A drag under way on the lanes: the time no longer follows playback, and the pointer's readout and hint go. */
    function laneDragging(): void {
        disableFollowCursor();
        hintFooter.clear();
        if (laneHover || spectrogramHover) hideLaneHover();
    }
    /** The pressed lane's track, or null (the drag ends) when it has been removed meanwhile. */
    function pressedTrackIndex(): number | null {
        const index = lanePress ? trackStore.protocolIndexForId(lanePress.trackId) : null;
        if (index === null) lanePress = null;
        return index;
    }
    function laneBox(press: WaveformDragState, canvas: HTMLCanvasElement, from: PlotPoint, to: PlotPoint): RectZoomSelection {
        const frequency = canvas.classList.contains('track-spec-canvas');
        return {
            trackId: press.trackId,
            startNorm: press.startNorm,
            endNorm: laneNorm(to),
            startAmpNorm: laneUp(canvas, from),
            endAmpNorm: laneUp(canvas, to),
            ...(frequency ? { frequency: true } : {}),
        };
    }
    function showLaneBox(plot: HTMLElement, from: PlotPoint, to: PlotPoint): void {
        const press = lanePress;
        if (!press || pressedTrackIndex() === null) return;
        laneDragging();
        rectZoomSelection = laneBox(press, plot as HTMLCanvasElement, from, to);
        emitWaveformZoom();
        updateCursorDisplay(rectZoomSelection.endNorm);
        scheduleRender();
    }
    function zoomLanesToBox(plot: HTMLElement, from: PlotPoint, to: PlotPoint, e: MouseEvent): void {
        const press = lanePress;
        lanePress = null;
        if (!press || trackStore.protocolIndexForId(press.trackId) === null) return;
        const selection = laneBox(press, plot as HTMLCanvasElement, from, to);
        const target = rectZoomTarget(selection);
        if (target && selection.frequency) {
            // The spectrogram's box: its time, and its frequencies in Hz on the lane it was drawn on (the lanes share both).
            disableFollowCursor();
            waveformView.setTimeRange({ start: target.zoomStart, end: target.zoomEnd });
            const pressed = state.results[trackIndexForId(selection.trackId)];
            const whole = pressed ? channelsForResult(pressed)[0]?.spectrogram : undefined;
            if (whole) {
                const shown = shownSpectrogramBounds(whole), span = shown.maxFrequencyHz - shown.minFrequencyHz;
                spectrogramFrequencyView = { lowHz: shown.minFrequencyHz + target.amplitudeMin * span, highHz: shown.minFrequencyHz + target.amplitudeMax * span };
            }
        }
        else if (target) {
            disableFollowCursor();
            waveformView.applyRectZoom(target);
        }
        // The loop stays: zooming into it is how a loop is looked at closely.
        emitWaveformZoom();
        followPointerAfterDrag(e);
        scheduleRender();
    }
    /** Alt+drag sets the loop, or on its edge moves that edge; Shift+drag shifts the pressed track's time. */
    function moveLaneDrag(e: MouseEvent): void {
        const press = lanePress;
        const trackIndex = pressedTrackIndex();
        if (!press?.dragType || trackIndex === null) return;
        laneDragging();
        if (press.dragType === 'offset') {
            const gs = trackStore.globalSpan();
            const secsPerPx = waveformView.span() * gs.spanSec / press.canvasWidth;
            // The spectra follow once the drag ends (endLaneDrag).
            setTrackOffset(trackIndex, press.startOffset + (e.clientX - press.startClientX) * secsPerPx, false);
        }
        else {
            const canvas = canvasById(document, press.canvasId);
            if (canvas) {
                const norm = clampedTrackCanvasNorm(canvas, e.clientX, press.canvasWidth);
                const region = loopRegionForDrag(press.dragType, press.startNorm, viewState.loop, norm);
                if (region) setLoopRegion(region);
                updateCursorDisplay(norm);
            }
        }
        scheduleRender();
    }
    /** A press let go after its drag, or where it was (a click: the cursor goes there and the loop is cleared). */
    function endLaneDrag(e: MouseEvent, dragged: boolean): void {
        const press = lanePress;
        lanePress = null;
        if (!press) return;
        if (!dragged) {
            const canvas = trackStore.protocolIndexForId(press.trackId) === null ? null : canvasById(document, press.canvasId);
            const hit = canvas ? trackCanvasTimeHit(canvas, e.clientX, e.clientY) : null;
            if (hit) {
                moveCursor(hit.norm);
                setLoopRegion(null);
            }
        }
        scheduleSpectrumRefresh('immediate');
        followPointerAfterDrag(e);
    }
    /**
     * ← / → over a lane (R7): the next full-resolution point of the lane's data (a waveform's next sample, a
     * spectrogram's next STFT frame at the same bin), however many share a pixel, at the place the lane shows it; the
     * other lanes' time line follows. Null with nothing read.
     */
    function stepLaneFrom(plot: HTMLElement, delta: -1 | 0 | 1, arrived?: (at: PlotPlace) => void): PlotPlace | null {
        const hovered = contentType === 'stage' ? null : laneHover?.canvas === plot ? laneHover : spectrogramHover?.canvas === plot ? spectrogramHover : null;
        if (!hovered) return null;
        const here = { clientX: hovered.clientX, clientY: hovered.clientY };
        if (delta === 0) return here;
        const from = laneRead;
        if (!from || from.canvas !== plot || from.read.pending) return null;
        const spectrogram = spectrogramHover?.canvas === plot;
        const placeOf = (next: StageRead): PlotPlace => {
            const rect = from.canvas.getBoundingClientRect();
            const clientX = rect.left + next.x;
            const clientY = spectrogram && spectrogramHover ? spectrogramHover.clientY : rect.top + next.y;
            laneStepped = { canvas: from.canvas, clientX, clientY, read: next };
            return { clientX, clientY };
        };
        // The next points were not in: the step is taken once they are, if the lane still reads the point it did (a
        // repaint reads that point anew).
        const still = (): boolean => !!laneRead && laneRead.canvas === from.canvas && laneRead.read.layer === from.read.layer
            && laneRead.read.at === from.read.at && laneRead.read.row === from.read.row && laneRead.read.index === from.read.index;
        const ready = (): void => {
            if (!still()) return;
            const next = stageStep(from.plot, from.read, delta, ready);
            if (next && arrived) arrived(placeOf(next));
        };
        const next = stageStep(from.plot, from.read, delta, ready);
        if (next === undefined) return here;
        return next ? placeOf(next) : null;
    }
    /** The readout follows the pointer again from where the drag ended, in the view it leaves (a box zoom's zoomed one), or shows the cursor off the lanes. */
    function followPointerAfterDrag(e: MouseEvent): void {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const canvas = under instanceof HTMLCanvasElement && under.classList.contains('track-canvas') ? under : null;
        const hit = canvas ? trackCanvasTimeHit(canvas, e.clientX, e.clientY) : null;
        if (hit) renderWithHoverAt(hit.norm);
        else { clearHover(); updateCursorDisplay(viewState.cursor); }
    }
    function renderWithHoverAt(norm: number) {
        viewState.setHover(norm);
    }
    function clearHover() {
        if (laneHover || spectrogramHover) { hideLaneHover(); scheduleRender(); }
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
            cursorTolerance: spectrumCursorTolerance(result),
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
    /** Whether the cursor spectrum is on screen to be read: drawn, and not hidden for levels it cannot overlay. */
    function spectrumShown(): boolean {
        const canvas = canvasById(document, 'spectrum-overlay-canvas');
        return !!canvas && !!spectrumDrawn && contentType !== 'stage' && canvas.getAttribute('data-calibration-hidden') !== 'true';
    }
    /**
     * The cursor spectrum's marks and readout (R7): at the pointer (or an arrow key's step), read as every plot reads
     * its point; else a line at the pair plot's frequency; else none. Shown again on every paint under a still pointer.
     */
    function showSpectrumMarks(): void {
        const canvas = canvasById(document, 'spectrum-overlay-canvas');
        const slot = document.getElementById('spectrum-freq-readout');
        overlayReadHz = null;
        if (!canvas || !spectrumShown()) { spectrumMarks.hide(); return; }
        if (spectrumPointer) {
            spectrumMarks.show(canvas, spectrumDrawn, spectrumPointer.clientX, spectrumPointer.clientY, slot);
            const read = spectrumMarks.reading();
            overlayReadHz = read?.full && read.at !== undefined ? read.at
                : read && read.index !== undefined && read.index >= 0 ? read.layer.view.xs?.[read.index] ?? null : null;
            return;
        }
        const x = spectrumFollowHz !== null && spectrumDrawn ? spectrumDrawn.xAt(spectrumFollowHz) : null;
        if (x !== null && spectrumDrawn && x >= spectrumDrawn.frame.left && x <= spectrumDrawn.frame.left + spectrumDrawn.frame.width) {
            spectrumMarks.line(canvas, spectrumDrawn, canvas.getBoundingClientRect().left + x);
            hidePlotReadout(slot);
        }
        else spectrumMarks.hide();
    }

    function renderOverlaySpectrum() {
        const canvas = canvasById(document, 'spectrum-overlay-canvas');
        if (!canvas) {
            return;
        }
        const visibleResults = trackStore.displayOrder.map(function (trackId) { return trackStore.require(trackId); })
            .filter(function (record) { return !record.runtime.hidden; })
            .map(function (record) { return record.result; });
        applyOverlayCompatibility(document, hasIncompatibleLevelReferences(visibleResults, OVERLAY_LEVEL_AXES), STR.calibrationOverlayIncompatible);
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
        const { series: collected, pending: pendingVisibleSlice } = spectrumSeriesAt(spectrumCursorNorm);
        // Each line carries its recording's level identity: lines share a level axis only by it (figureModel, R1).
        // A slice that names no reference of its own is in its channel's, as wandas named it (never a bare dB, R4, A50).
        const slices = collected.map(series => {
            const channel = channelsForResult(state.results[series.index])[series.channelIndex];
            const measurement = channel?.measurement;
            const level = measurement ? { unit: measurement.referenceUnit, ref: measurement.referenceValue, levelReferenceLabel: measurement.levelReferenceLabel }
                : channel?.sourceLevelReferenceLabel ? { levelReferenceLabel: channel.sourceLevelReferenceLabel } : undefined;
            if (!level) return series;
            const slice = shownLevelOf(series.slice) ? series.slice : { ...series.slice, unit: level.levelReferenceLabel };
            return { ...series, slice, level };
        });
        if (holdingSpectrumCommit() && overlaySpectrumPainted && pendingVisibleSlice) {
            // The last picture stays: its header keeps that picture's time (ShownSpectrumCursor).
            shownSpectrumCursor.keep();
            return;
        }
        shownSpectrumCursor.drawn(spectrumCursorNorm);
        if (slices.length === 0) {
            // Empty, the plot component says why in its middle, as every plot does (R13).
            const none = emptyFigure();
            paintOverlay(canvas, { layers: [] }, none.range, none.names, { size: { width: W, height: H }, empty: STR.spectrumNoData });
            spectrumDrawn = null;
            showSpectrumMarks();
            // No line is drawn: none is named.
            renderSpectrumAxisLegend(document.getElementById('spectrum-axis-legend'), []);
            overlaySpectrumPainted = false;
            return;
        }
        spectrumView.followLevelReference(overlayLevelAxes(slices, spectrumView.state())[0].reference);
        // A level axis says uncalibrated only when every line read on it is (R4, as the comparison's overlay); on one
        // that mixes them, each uncalibrated line says so in its legend and readout (withCalibrationWords, A49).
        const calibratedSeries = (s: SpectrumSeries): boolean => channelsForResult(state.results[s.index])[s.channelIndex]?.measurement?.calibrationStatus === 'calibrated';
        const levelTitle = (reference: string, series: readonly SpectrumSeries[]) => figureLevelTitle(STR, reference, series.some(calibratedSeries));
        // A slice cut for display is read at every bin (R7): the same slice asked for again at full resolution.
        const read = withCalibrationWords(slices, calibratedSeries, uncalibratedWord(STR)).map(series => {
            const track = series.slice.frequenciesHz && !series.slice.bandCentersHz && series.slice.cursorNorm !== undefined ? laneTrack(series.index) : null;
            return track && series.slice.cursorNorm !== undefined ? { ...series, full: laneReads.slice(track, series.slice.cursorNorm, series.channelIndex) } : series;
        });
        const paint = paintOverlaySpectrum(canvas, W, H, read, spectrumView.state(), STR.axisFrequency, levelTitle);
        spectrumDrawn = paint.plot;
        spectrumLevelAxisTitle = paint.levelAxes[0]?.title ?? '';
        spectrumView.recordPaint(paint);
        renderSpectrumAxisLegend(document.getElementById('spectrum-axis-legend'), paint.levelAxes);
        showSpectrumMarks();
        if (!paint.painted) {
            return;
        }
        overlaySpectrumPainted = true;
    }
    function refreshSpectrumViews() {
        // The comparison hides the spectrum panel; it is drawn again on leaving it.
        if (contentType !== 'stage') {
            renderOverlaySpectrum();
        }
        else spectrumMarks.hide();
        pairPanel.render();
        emitSpectrumZoom();
        const el = document.getElementById('spectrum-cursor-time');
        if (el) {
            const gs = trackStore.globalSpan();
            // While the last picture is kept, its time: the lines, readouts and window caption are of that picture.
            const shownNorm = contentType !== 'stage' ? shownSpectrumCursor.at(spectrumCursorNorm) : spectrumCursorNorm;
            el.textContent = '@ ' + formatClockTime(gs.startSec + shownNorm * gs.spanSec) + analysisWindowCaption();
        }
    }
    function analysisWindowCaption() {
        const gs = trackStore.globalSpan();
        const captions = new Set<string>();
        const holding = holdingSpectrumCommit();
        for (const trackId of trackStore.displayOrder) {
            const band = displayedWindowBand(trackStore.require(trackId).protocolIndex, 0, holding);
            if (band) {
                const ms = (band.endNorm - band.startNorm) * gs.spanSec * 1000;
                // Written by the plots' own number text (a true minus): "−0.012–0.010 s (21.33 ms)".
                captions.add(STR.spectrumAnalysisWindow + (band.window ? ' ' + band.window : '') + ' '
                    + withMinus((gs.startSec + band.startNorm * gs.spanSec).toFixed(3)) + '–' + secondsText(gs.startSec + band.endNorm * gs.spanSec, 3)
                    + ' (' + withMinus(ms.toFixed(ms < 10 ? 2 : 1)) + ' ms)');
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
        const before = spectrogramSettings.display;
        // A frequency range set (here, the axis' popover or ⚙) replaces the box zoom's band; a level range keeps it.
        if (display.minFrequencyHz !== before.minFrequencyHz || display.maxFrequencyHz !== before.maxFrequencyHz) spectrogramFrequencyView = null;
        spectrogramSettings.setDisplay(display);
        messaging.post({ type: 'update-spectrogram-settings', settings: spectrogramSettings.settings });
        // Touching the settings is the user's way to try a failed spectrogram again.
        trackStore.clearDetailErrors();
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
        testBridge.publishAfterFrame();
    }
    /**
     * The STFT the spectra are made of changed (⚙ Apply, or Reset back from another): every track is analysed again
     * with it, and spectra and reads asked for under the old one are stale, so lanes, readouts and the cursor spectrum
     * stay of one STFT. The only way the settings' data signature changes.
     */
    function reanalyzeSpectrogram(): void {
        invalidateDesiredSpectrumSliceRequests();
        laneReads.clear();
        setReanalyzeBusy(true, STR.reanalyzingStft);
        messaging.post({ type: 'request-reanalyze', settings: spectrogramSettings.settings });
    }
    const specSettingsPopover = installSpectrogramSettingsPopover(document, {
        strings: STR,
        getSettings: () => spectrogramSettings.settings,
        onDisplayChange: setSpectrogramDisplay,
        onReset() {
            const before = spectrogramSettings.display;
            if (spectrogramSettings.reset()) { spectrogramFrequencyView = null; reanalyzeSpectrogram(); return; }
            // The STFT is as it was: only the display range goes back (the box zoom's band with a frequency range).
            if (before.minFrequencyHz !== spectrogramSettings.display.minFrequencyHz || before.maxFrequencyHz !== spectrogramSettings.display.maxFrequencyHz) spectrogramFrequencyView = null;
            messaging.post({ type: 'update-spectrogram-settings', settings: spectrogramSettings.settings });
            scheduleRender();
            scheduleSpectrumRefresh('immediate');
        },
        onApply(settings) {
            spectrogramSettings.applyStft(settings);
            reanalyzeSpectrogram();
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
        laneReads.clear();
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
        testBridge.publishAfterFrame();
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

/** A spectrogram zoom request's key: its time window (0|1: the whole file's frames) and its band ('' for every frequency). */
function spectrogramZoomKey(key: string): { startNorm: number; endNorm: number; timed: boolean; band: SpectrogramBand | null } {
    const [start, end, low, high] = key.split('|');
    const startNorm = Number(start), endNorm = Number(end);
    return { startNorm, endNorm, timed: !(startNorm === 0 && endNorm === 1), band: low !== undefined && low !== '' && high !== undefined ? { lowHz: Number(low), highHz: Number(high) } : null };
}
