import { channelLabel, channelsForResult, formatClockTime } from '../../shared/utils/format';
import { spectrogramFailureText } from './spectrogramRaster';
import { createRegionPeaks, type PeakOf, type PeakTrack } from './regionPeak';
import { stageBasis } from './stageSource';
import { PLOT_READOUT_ID } from './plotHover';
import { secondsText, withMinus } from '../shell/numberText';
import { trackTimelinePlacement } from './waveformCoverage';
import { fileOfKey } from '../../shared/dataset/datasetTable';
import { attachOffsetEditing } from './offsetInlineEditor';
import { dispatchTestMouseEvent, fillSpectrogramDisplayForm, fillSpectrogramSettingsForm, heightDragFromPayload, loopRegionFromPayload, setTestInputValue, testActionTrackId } from './testActionForms';
import { nextRequestId } from './hostRequests';
import { DEFAULT_PYTHON_ENVIRONMENT_STATE, isOfShownVersion, isResponseToLazyRequest, pythonEnvironmentStateFromMessage } from './lazyResponses';
import { cursorLineId, cursorLineOf, cursorSpectrum, type CursorSpectrumLine } from '../charts/cursorSpectrum';
import { createTrackRowsScreen, type ScreenRow } from '../screens/trackRowsScreen';
import type { TrackRowsReply, TrackRowsTrack } from '../screens/trackRows';
import { TRACK_WAVE_LANE } from '../charts/trackRow';
import { createTracksFigureScreen, type SettingsRange, type TracksFigureDeps, type TracksFigurePaint, type TracksFigureScreen } from '../screens/tracksFigure';
import { csvFile } from '../../shared/utils/csv';
import { spectrogramWindowServes, spectrogramZoomWindow, type SpectrogramWindow, type SpectrogramZoomSource } from '../spectrum/spectrogramZoom';
import { wavLoopRegions } from './runtimeExports';
import { audioById, buttonById, buttonMatching, canvasById, eventTarget, requiredElementById } from './domAdapter';
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
import { composeTrackCanvases, rowSays, rowSaysPlaced, triggerAnchorDownload, visibleExportCanvases } from './exportDownloads';
import { excludedList } from '../../shared/recipe/eventExclusion';
import { clampHeight, createHeightResize, type HeightKind } from './heightResize';
import { LayoutSettings, SPECTRUM_HEIGHT_MAX, SPECTRUM_HEIGHT_MIN, TRACK_HEIGHT_MAX, TRACK_HEIGHT_MIN, WAVE_SHARE_MAX, WAVE_SHARE_MIN, type LayoutChange } from './layoutSettings';
import { installRangePopover, linearAxis, openAxisPart } from '../shell/rangePopover';
import { buildMarkdownReport, buildNotebook, type ReportLoopRegion, type ReportTrack } from '../../shared/report/analysisReport';
import { rangePopoverStrings } from '../../shared/i18n/strings';
import { installHelpOverlay } from './helpOverlay';
import { arrowCursorStep, isTextEntryTag, type GlobalShortcutAction } from './shortcuts';
import { domSnapshotBase, latestSpectrogramSnapshot, shellSnapshot } from './testSnapshot';
import { buildTrackSnapshot } from './comparisonSnapshot';
import { syncCanvasSize } from './canvasSizing';
import { trackRowFigureId } from './trackCanvasIds';
import { channelLaneHtml, trackRowHtml } from './trackLaneHtml';
import { attachPlotInteraction, FULL_PLOT_WINDOW, type PlotHit, type PlotWindow } from './plotInteraction';
import { plotUnderPointer } from './trackPointerEvents';
import { attachHoverHints, createHintFooter, createTaskStatus, setHint, attachFocusHint } from './hintFooter';
import { attachTrackLaneActions } from './trackLaneActions';
import { attachGlobalKeyboardListeners } from './globalKeyboardEvents';
import { keyRouterFor } from '../shell/keyRouter';
import { attachSeparatorKeys } from './separatorKeys';
import { buildPythonButtonText, buildPythonTooltip, isPythonEnvError } from './pythonEnvironmentLabels';
import { createPlaybackDisplay } from './playbackDisplay';
import { installLayoutResizeHandling } from './layoutResize';
import { syncPanelToggle, syncSpectrumMaximize } from './panelCollapse';
import { WaveformView } from './waveformView';
import { linearWindowEnds, paintTimeRuler, timeRulerTicks } from './timeRuler';
import { referenceButtonHtml } from './pairSpectrum';
import { PAIR_SPLIT_MAX, PAIR_SPLIT_MIN, PairSpectrumPanel } from './pairSpectrumPanel';
import { toolbarHtml } from './toolbarHtml';
import { attachExclusiveMenus, attachHeightResizeListeners, attachToolbarActions } from './toolbarEvents';
import { resultsPaneHtml, trackAudioHtml, type SpectrumBandsSetting } from './resultsPaneHtml';
import { selectionFolderButton, selectionLayoutHtml } from './selectionLayoutHtml';
import { ShownSpectrumCursor, SpectrumCommitHold } from './spectrumCommitHold';
import { createFailureHold, createLatestAnswers, UNANSWERED_RETRY_MS } from './answerStore';
import { type AnalysisWindowBand, CURSOR_LINE_STYLE, drawAnalysisWindowBand, drawDashedTimeLine, paintLoopRegion, paintOverPlots, waveformCursorLineStyle } from './canvasOverlays';
import { calibrationRequest, channelMetricSummaryHtml, ensureCalibrationStyles } from './calibrationDecorations';
import { laneAmplitudeRange, levelKeyOf } from './figureModel';
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
import { trackLevelInput } from './comparePanes';
import { reportFiles } from './compareReport';
import { activeSlotReferenced } from '../../shared/recipe/recipeSteps';
import { openedRecipe } from '../../shared/recipe/recipeOpen';
import { isRecipeDocument } from '../../shared/recipe/recipeSelection';
import { LIGHT_THEME_BODY_SELECTORS, ROLE_COLORS, ownColor, useLightRoleColors } from '../../shared/gui/roleColors';
import { createTrackStageMode, LARGE_BASE, type StageTrack, type TrackStageMode } from './trackStageMode';
import { attachRoleChips, roleChipHtml, roleChipText, type RoleChipRole } from './roleChip';
import { createFigureAnswers } from '../answers/figureRequests';
import { watchLongComputations } from '../answers/longComputations';
import { triggerAnchorDownload as downloadEntryCsv } from './exportDownloads';
import { loopRegionClockText, ZOOM_IN_FACTOR } from './waveformInteraction';
import type { ChannelSummary, SpectrogramDisplaySettings,  } from '../../shared/analysis/analysisTypes';
import type { ComparisonBootstrap, ComparisonTrackState, CursorAnswers, LazyRequestState, LoopRegion, PersistedWebviewState, TestAction, TrackFileView, TrackId, TrackRuntimeState } from './types';
export function startComparisonRuntime(bootstrap: ComparisonBootstrap): void {
    const { host: vscode, state: injectedState, strings: STR, window, document } = bootstrap;
    const state = normalizeRuntimeState(injectedState);
    // The figure service's requests (answers/): the Figures on this page send them through the host. The browser build's
    // Worker cannot cancel a running request, and holds reads during a long computation (spec 4); VS Code does neither.
    const browserHost = !!(window as { __AWA_HOST__?: unknown }).__AWA_HOST__;
    const figures = createFigureAnswers({ post: message => messaging.post(message), cancels: !browserHost, holdsReadsWhileComputing: browserHost });
    const longComputations = watchLongComputations(figures.computations);
    const messaging = new HostMessenger(vscode, window, message => longComputations.posted(message));
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
    const TRACK_HEADER_W = 130;
    // A failed spectrogram (the whole file's, a zoom window's) is not asked again until the answer store's pause has
    // passed, so a lane that keeps failing does not loop and a passing failure does not stay.
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
        // Playback's (a pause, a seek, the loop's wrap) move the cursor: a cursor action, whose answers are held together.
        invalidateSpectrumRequests: () => invalidateDesiredSpectrumSliceRequests(true),
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
                ...spectrumZoomParts(),
                trackHeight: layout.trackHeight,
                spectrumOverlayHeight: layout.spectrumOverlayHeight,
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
                && !record.runtime.hidden && !record.result.error && !record.sourceChanged;
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
                sourceVersion: trackStore.require(request.trackId).result.sourceVersion,
                cursorNorm: request.cursorNorm,
                ...(request.bandsPerOctave ? { bandsPerOctave: request.bandsPerOctave } : {}),
                // The answers are kept by key for the figure service (charts/cursorSpectrum.ts): the reply names them.
                answers: CURSOR_AXIS,
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
    // Linked, the rows of every recording displayed share their scales: the figure service decides them (tracks_answers.py).
    // What is kept here is the peak a zoom up the waveform is in parts of: the largest among the rows of one unit.
    let scalesLinked = persistedWebviewState.linkScales === true;
    let linkedPeaksMemo: Map<string, number> | null = null;
    /** The unit of the row a colour range was typed on (null: none typed on a row; the display's range is every row's). */
    let colourGivenLevel: string | null = null;
    /** What a channel's levels are of (unit, reference, the reference's name): channels of another are on another scale (R4). */
    const levelOf = (ch: ChannelSummary | undefined): string => levelKeyOf(trackLevelInput([ch], undefined));
    const amplitudeUnitKey = (ch: ChannelSummary | undefined) => (ch && typeof ch.unit === 'string' ? ch.unit.trim() : '');
    /** The largest peak of each unit among the rows displayed, while linked; worked out once per render. */
    function linkedPeaks(): Map<string, number> | null {
        if (!scalesLinked) {
            return null;
        }
        if (!linkedPeaksMemo) {
            const peaks = new Map<string, number>();
            trackStore.displayOrder.forEach(function (trackId) {
                const record = trackStore.require(trackId);
                if (record.runtime.hidden || record.result.error) return;
                channelsForResult(record.result).forEach(function (ch) {
                    const peak = ch.peakAbsolute;
                    const unit = amplitudeUnitKey(ch);
                    if (Number.isFinite(peak) && peak > (peaks.get(unit) ?? 0)) peaks.set(unit, peak);
                });
            });
            linkedPeaksMemo = peaks;
        }
        return linkedPeaksMemo;
    }
    /** The value drawn at ±1 of the amplitude view: the lane's own peak, or the largest one in its unit while linked. */
    function amplitudeScaleFor(ch: ChannelSummary | undefined): number {
        const linked = linkedPeaks()?.get(amplitudeUnitKey(ch));
        if (linked) {
            return linked;
        }
        const rawPeak = ch ? ch.peakAbsolute : NaN;
        return typeof rawPeak === 'number' && Number.isFinite(rawPeak) && rawPeak > 0 ? rawPeak : 1;
    }
    function toggleLinkedScales(): void {
        scalesLinked = !scalesLinked;
        linkedPeaksMemo = null;
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
        if (!playing) invalidateDesiredSpectrumSliceRequests(true);
        viewState.setCursor(norm, playing ? 'cursor' : 'all');
        // Where the cursor is on the lanes' time axis (s), for the test that a lane's click moves it to the time read (R7, R13).
        const lanes = document.getElementById('tracks-wrapper');
        const span = trackStore.globalSpan();
        if (lanes) lanes.dataset.cursorAt = String(span.startSec + norm * span.spanSec);
    }
    /** The steps view's full data, which the peak of what it compares is read from (R7): never what is drawn. */
    const regionPeaks = createRegionPeaks(message => messaging.post(message));
    /**
     * How a spectrum's frequency axis is drawn, which its kept answers are of: linear from 0 Hz (1/N-octave bands are
     * on a log axis whatever is asked: tracks_answers.py).
     */
    const CURSOR_AXIS = 'linear' as const;
    /** What every Figure of the bottom panel is made with: the page's answers and words. */
    const tracksFigure = (deps: Pick<TracksFigureDeps, 'host' | 'readout' | 'empty' | 'ranged' | 'read' | 'drawn' | 'letGo'>, label: string, hints: { plot: string; axis: string }): TracksFigureScreen =>
        createTracksFigureScreen({
            ...deps, document, answers: figures, words: { ...STR, range: rangePopoverStrings(STR) }, label,
            ...(typeof ResizeObserver === 'function' ? { ResizeObserver } : {}),
            hint: where => { if (where) hintFooter.show(where === 'plot' ? hints.plot : hints.axis); else hintFooter.clear(); },
        });
    /**
     * The rows: each channel's waveform and spectrogram are one Figure
     * (screens/trackRows.ts), joined to this screen's state by screens/trackRowsScreen.ts.
     */
    /** The room between a row's two lanes: the split's height (comparisonDocument.ts `.track-split`). */
    const ROW_SPLIT_PX = 5;
    function screenRows(): ScreenRow[] {
        if (contentType === 'stage') return [];
        const rows: ScreenRow[] = [];
        trackStore.displayOrder.forEach(function (trackId) {
            const record = trackStore.require(trackId), i = record.protocolIndex, result = record.result;
            const seconds = result.durationSeconds;
            if (record.runtime.hidden || result.error || !(seconds > 0) || !laneInView(i)) return;
            const view = computeTrackFileView(result, i);
            rows.push({
                id: record.id, index: i, filePath: result.filePath, sourceVersion: result.sourceVersion, channels: channelsForResult(result).length,
                // (One name: the readout's row cuts a long name and keeps the values after its first " / " whole.)
                colour: trackColor(i), name: channel => spectrumSeriesLabel(result, channel).replace(/ \/ /gu, ' · '),
                calibrated: channel => channelsForResult(result)[channel]?.measurement?.calibrationStatus === 'calibrated',
                label: channel => STR.ariaRowCanvas.replace('{file}', result.fileName).replace('{channel}', channelLabel(result, channel)),
                window: [view.fileAtZoomStart * seconds, view.fileAtZoomEnd * seconds], durationSeconds: seconds,
                start: view.trackStart, length: view.trackDurRatio, changed: !!record.sourceChanged,
            });
        });
        return rows;
    }
    /**
     * What a row's zoom is measured against (spectrogramZoomSource, for the Figure path): the whole file's STFT frames
     * as its reply says them, and the frames a window can bring (its own STFT with the automatic settings, R3).
     */
    function rowZoomSource(whole: TrackRowsReply): SpectrogramZoomSource | null {
        const samples = whole.durationSeconds * whole.sampleRateHz;
        return whole.hopSize > 0 && samples > 0 ? { columns: Math.ceil(samples / whole.hopSize), frames: spectrogramSettings.settings.auto ? samples : samples / whole.hopSize } : null;
    }
    const rowFileWindow = (track: TrackRowsTrack): SpectrogramWindow => ({ startNorm: track.window[0] / track.durationSeconds, endNorm: track.window[1] / track.durationSeconds });
    /** A row's layer: the lines that follow the cursor and the loop, over each lane the Figure drew, in the layer's own pixels. */
    function paintRowLayer(row: ScreenRow, channel: number, lanes: ReadonlyArray<{ id: string; frame: { left: number; top: number; width: number; height: number } }>): void {
        const host = document.getElementById(trackRowFigureId(row.index, channel));
        const layer = host?.querySelector<HTMLCanvasElement>('canvas.track-row-layer');
        if (!host || !layer) return;
        paintOverPlots(layer, { width: host.clientWidth, height: host.clientHeight }, window.devicePixelRatio || 1, lanes, (ctx, width, height, lane) => {
            if (lane === TRACK_WAVE_LANE) drawWaveformCursorLayers(ctx, width, height, row.index, channel);
            else { drawLoopRegionOnCanvas(ctx, width, height); drawCursorOnCanvas(ctx, width, height); }
        });
    }
    /** A row's failed asking is asked again by the store's rule: the rows are shown again once its pause is over. */
    const rowFailures = createFailureHold(() => Date.now(), () => scheduleRender());
    const rowsScreen = createTrackRowsScreen({
        // A row's Figure says a failure in the rows' shared readout, in a row's words (the Figure's own are the comparison's).
        document, answers: figures, words: { ...STR, stageTooLarge: STR.rowTooLarge, stageCombineFailed: STR.rowDrawFailed, range: rangePopoverStrings(STR) },
        ...(typeof ResizeObserver === 'function' ? { ResizeObserver } : {}),
        axisWidth: AXIS_W, laneGap: ROW_SPLIT_PX,
        // The ruler's ticks (timeRuler.ts), down every row.
        grid: () => { const seconds = laneVisibleSeconds(); return timeRulerTicks(seconds.start, seconds.end, 1).map(tick => tick.x); },
        // A box with no layout (its row hidden, the rows not on screen) holds no Figure: one drawn there would be drawn at no size.
        host: (trackIndex, channel) => { const box = document.getElementById(trackRowFigureId(trackIndex, channel)); return box && box.clientWidth > 0 && box.clientHeight > 0 ? box : null; },
        readout: () => document.getElementById(PLOT_READOUT_ID),
        rows: screenRows,
        heights: laneHeights,
        analysisId: () => analysisId,
        settingsSignature: currentSettingsSignature,
        requestId: row => nextRequestId('detail', row.index),
        post: request => messaging.post(request),
        // With set STFT settings the whole file's frames are all there are: no window is asked.
        zoomWindow: (track, whole, width) => {
            const source = spectrogramSettings.settings.auto ? rowZoomSource(whole) : null;
            return source ? spectrogramZoomWindow(source, rowFileWindow(track), width) : null;
        },
        serves: (track, whole, asked, width) => {
            const source = rowZoomSource(whole);
            if (!source) return true;
            return asked ? spectrogramWindowServes(source, asked, rowFileWindow(track), width) : !spectrogramZoomWindow(source, rowFileWindow(track), width);
        },
        time: () => waveformView.timeRange(),
        // Up the waveform: the automatic range is the figure service's, the one shared while linked too; a zoom is this screen's.
        amplitude: (row, channel) => {
            const result = state.results[row.index];
            if (!result || !waveformView.isAmplitudeZoomed()) return [null, null];
            // A range given on a row is every row's of that unit, as given (the numbers typed, never a ratio of each
            // row's own peak); a row of another unit keeps its automatic range.
            const given = waveformView.amplitudeGiven();
            if (given) return amplitudeUnitKey(channelsForResult(result)[channel]) === given.unit ? [given.min, given.max] : [null, null];
            const range = zoomedAmplitude(result, channel);
            return [range.min, range.max];
        },
        frequency: () => spectrogramFrequencyView
            ? [spectrogramFrequencyView.lowHz, spectrogramFrequencyView.highHz]
            : [spectrogramSettings.display.minFrequencyHz ?? null, spectrogramSettings.display.maxFrequencyHz ?? null],
        // A colour range typed on a row's bar is the rows' of that row's unit and reference (a level of another unit or
        // reference is another scale); one set in the settings is every row's.
        colour: (row, channel) => {
            const result = state.results[row.index];
            if (colourGivenLevel !== null && result && levelOf(channelsForResult(result)[channel]) !== colourGivenLevel) return [null, null];
            return [spectrogramSettings.display.dbMin ?? null, spectrogramSettings.display.dbMax ?? null];
        },
        // Linked, the rows of every recording displayed (in view or not) share their scales: the figure service decides them.
        linked: () => (scalesLinked
            ? trackStore.displayOrder.map(trackId => trackStore.require(trackId)).filter(record => !record.runtime.hidden && !record.result.error && record.result.durationSeconds > 0)
                .map(record => ({ id: record.id, index: record.protocolIndex, filePath: record.result.filePath, sourceVersion: record.result.sourceVersion }))
            : null),
        setTime: range => { disableFollowCursor(); waveformView.setTimeRange(range); emitWaveformZoom(); scheduleRender(); },
        setAmplitude: (row, channel, ends) => {
            const result = state.results[row.index];
            if (!ends || !result) waveformView.resetAmplitude();
            else {
                // Kept as given, with the row's unit (the rows of that unit show these numbers). The window in parts of
                // the lane's peak is kept too, for the state the panel reports.
                const of = channelsForResult(result)[channel];
                const peak = amplitudeScaleFor(of);
                waveformView.setAmplitudeRange(ends[0] === null ? null : ends[0] / peak, ends[1] === null ? null : ends[1] / peak);
                waveformView.setAmplitudeGiven(amplitudeUnitKey(of), ends[0], ends[1]);
            }
            emitWaveformZoom();
            scheduleRender();
        },
        setFrequency: (row, ends, typed) => {
            // A band typed on the axis is the display's setting (every row's, kept by a new analysis); Auto takes it off.
            if (typed) {
                spectrogramFrequencyView = null;
                const low = ends?.[0] ?? null;
                setSpectrogramDisplay({ ...spectrogramSettings.display, minFrequencyHz: low !== null && low > 0 ? low : null, maxFrequencyHz: ends?.[1] ?? null });
                return;
            }
            // A band zoomed into. Blank ends are the band's own: from 0 Hz, up to the recording's Nyquist.
            spectrogramFrequencyView = ends ? { lowHz: ends[0] ?? 0, highHz: ends[1] ?? (state.results[row.index]?.sampleRateHz ?? 0) / 2 } : null;
            scheduleRender();
        },
        setColour: (row, channel, ends) => {
            const result = state.results[row.index];
            colourGivenLevel = ends && result ? levelOf(channelsForResult(result)[channel]) : null;
            setSpectrogramDisplay({ ...spectrogramSettings.display, dbMin: ends ? ends[0] : null, dbMax: ends ? ends[1] : null });
        },
        resetZoom,
        seek: norm => {
            const cursorBefore = viewState.cursor, loopBefore = viewState.loop;
            moveCursor(norm); setLoopRegion(null); scheduleSpectrumRefresh('immediate');
            return () => { moveCursor(cursorBefore); setLoopRegion(loopBefore); scheduleSpectrumRefresh('immediate'); };
        },
        loop: (start, end) => {
            const before = viewState.loop;
            disableFollowCursor();
            setLoopRegion({ start, end });
            return () => setLoopRegion(before);
        },
        loopNow: () => viewState.loop,
        viewSpan: () => waveformView.span(),
        offset: row => trackRuntimeAt(row.index).offsetSeconds,
        setOffset: (row, seconds, done) => { disableFollowCursor(); setTrackOffset(row.index, seconds, done); },
        reads: norm => updateCursorDisplay(norm ?? viewState.cursor),
        layer: paintRowLayer,
        says: (said, reason, row) => row.changed ? STR.sourceChangedLane
            : said === 'failed' ? spectrogramFailureText(STR, reason ?? '') : said === 'too-large' ? STR.rowTooLarge : said === 'too-short' ? STR.rowTooShort : STR.spectrogramLoading,
        hint: where => { if (where) hintFooter.show(where === 'colour' ? STR.hintSpectrogramColorbar : where === 'axis' ? STR.compareHintAxis : STR.hintRectZoomDrag + ' / ' + STR.hintDoubleClickResetZoom + ' / ' + STR.hintWheelGestures); else hintFooter.clear(); },
        drawn: () => testBridge.publishAfterFrame(),
        widthChanged: () => { if (contentType !== 'stage') renderRuler(); },
        failures: rowFailures,
    });
    /** Shows the rows' Figures on the lanes' heights (the split lies over the room between a row's two lanes). */
    function showRowFigures(): void {
        const heights = laneHeights();
        const wrapper = document.getElementById('tracks-wrapper');
        wrapper?.style.setProperty('--row-wave', heights.wave + 'px');
        wrapper?.style.setProperty('--row-spec', heights.spec + 'px');
        rowsScreen.show();
        // A row not drawn now (scrolled out of view, failed) keeps no line on its layer, which stays the box's size.
        wrapper?.querySelectorAll<HTMLElement>('.track-row-figure').forEach(function (host) {
            const layer = host.querySelector<HTMLCanvasElement>('canvas.track-row-layer');
            if (layer && host.clientWidth > 0 && !host.querySelector('canvas[data-figure]')) paintOverPlots(layer, { width: host.clientWidth, height: host.clientHeight }, window.devicePixelRatio || 1, [], () => undefined);
        });
    }
    messaging.onMessage(function (msg) {
        if (!msg || (msg.type !== 'track-answers-result' && msg.type !== 'track-detail-error')) return;
        // An answer of another version of the file is of nothing shown (and marks the track as changed on disk).
        if (!trackIdAtProtocolBoundary(msg.trackIndex, msg)) return;
        if (rowsScreen.handle(msg)) testBridge.publishAfterFrame();
    });
    /**
     * The backend let these kept cursor lines go (its store made room): the tracks' replies naming them are of
     * nothing, so they are forgotten and asked again at the cursor.
     */
    function forgetCursorAnswers(keys: readonly string[]): void {
        const gone = new Set(keys);
        let any = false;
        trackStore.activeIds().forEach(function (trackId) {
            const record = trackStore.get(trackId);
            if (record?.cursorAnswers.get()?.channels.some(channel => channel.key !== undefined && gone.has(channel.key))) {
                record.cursorAnswers.clear();
                any = true;
            }
        });
        if (any) spectrumRequests.scheduleFrame(true, false);
    }
    /** The cursor spectrum's Figure, in the element it was made for (the results pane may be built again). */
    let cursorFigure: { host: HTMLElement; screen: TracksFigureScreen } | null = null;
    function cursorFigureScreen(): TracksFigureScreen | null {
        const host = document.getElementById('spectrum-overlay-plot');
        if (!host) {
            cursorFigure?.screen.hide();
            cursorFigure = null;
            return null;
        }
        if (cursorFigure?.host !== host) {
            cursorFigure?.screen.hide();
            const empty = document.getElementById('spectrum-overlay-empty');
            const readout = document.getElementById('spectrum-freq-readout');
            cursorFigure = {
                host,
                screen: tracksFigure({
                    host,
                    ...(readout ? { readout } : {}),
                    empty: none => { if (empty) empty.hidden = !none; },
                    // The pair figure shares the frequency axis (R8) and marks the frequency read here (R7).
                    ranged: x => { pairPanel.across(x); emitSpectrumZoom(); },
                    read: hz => pairPanel.follow(hz),
                    drawn: () => { spectrumPictureArrived(); emitSpectrumZoom(); testBridge.publishAfterFrame(); },
                    letGo: forgetCursorAnswers,
                }, STR.spectrumSectionTitle, { plot: STR.hintSpectrumPlot, axis: STR.compareHintAxis }),
            };
        }
        return cursorFigure.screen;
    }
    /** The part of each axis of the cursor spectrum on screen, as the host and the tests are told it. */
    function spectrumZoomParts(): { specFreqStart: number; specFreqEnd: number; specDbMin: number | null; specDbMax: number | null } {
        const lane = cursorFigure?.screen.inspect()?.lanes[0];
        const x = lane?.part?.x, y = lane?.part?.y;
        const up = lane?.range && y && (y.start > 0 || y.end < 1) ? lane.range.y : null;
        return { specFreqStart: x?.start ?? 0, specFreqEnd: x?.end ?? 1, specDbMin: up ? up[0] : null, specDbMax: up ? up[1] : null };
    }
    const heightResize = createHeightResize({
        currentHeight: kind => kind === 'track' ? layout.trackHeight : layout.spectrumOverlayHeight,
        canBegin: kind => kind === 'track' || (!layout.spectrumCollapsed && !layout.spectrumMaximized),
        setHeight,
        onActiveChange: active => document.body.classList.toggle('is-height-resizing', active),
    });
    /**
     * The spectrogram lanes' frequency zoom, in Hz (null: the band the display settings show). Held in Hz, not as a
     * fraction of a lane's band, so lanes of different sample rates (different Nyquist tops) show the same frequencies.
     */
    let spectrogramFrequencyView: { lowHz: number; highHz: number } | null = null;
    function setLoopRegion(region: LoopRegion | null): void {
        viewState.setLoop(region);
    }
    function createTrackRuntime(): TrackRuntimeState {
        return { offsetSeconds: 0, hidden: false };
    }
    // A lane's failed answer is asked again once its pause is over: drawn again then, its requests made anew.
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
    /** The track a lane's lazy answer is of: none for an index no track has, or an answer of another file version. */
    function trackIdAtProtocolBoundary(index: number, answer: { type: string; sourceVersion?: string; stftSignature?: string; staleSource?: true }): TrackId | null {
        const trackId = trackIdAtIndex(index);
        if (!trackId) {
            console.warn('Rejected ' + answer.type + ' with invalid trackIndex ' + index);
            return null;
        }
        const record = trackStore.get(trackId);
        if (!record || !isOfShownVersion(record.result, answer)) return null;
        if (answer.staleSource) {
            // The file changed on disk since: no lane of the track asks again; it says so and offers to analyse again.
            record.sourceChanged = true;
            scheduleRender();
            testBridge.publishAfterFrame();
            return null;
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
                        sourceVersion: record.result.sourceVersion,
                        calibrationSignature: record.result.calibrationSignature,
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
        figure: deps => tracksFigure(deps, STR.pairSectionTitle, { plot: STR.hintPairPlot, axis: STR.compareHintAxis }),
        // The top frequency of the display settings is the power spectrum's too; a typed dB range is the power spectrum's own.
        settingsRange: () => { const { across } = spectrumSettingsRange(); return across ? { across } : {}; },
        // The pair figure shares the power spectrum's frequency axis (R8): a zoom on either moves both.
        onRanged(x) { cursorFigureScreen()?.across(x); emitSpectrumZoom(); },
        // The pointer is on the pair figure: the power spectrum marks its frequency, with no point read of its own.
        onRead(frequencyHz) { cursorFigureScreen()?.follow(frequencyHz); },
        onDrawn() { testBridge.publishAfterFrame(); },
        plotHeight: effectiveSpectrumHeight,
        onReferenceChange(reference) {
            if (reference && spectrumBandsPerOctave !== 0) {
                setSpectrumBands(0);
            }
            syncSpectrumBandsAvailability(reference !== null);
            scheduleSpectrumRefresh('immediate');
        },
        onLayoutChange() {
            scheduleSpectrumRefresh('immediate');
        },
    }, STR);
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
    /**
     * The generation whose spectra may not hold the last picture: one started by a change of what the spectra are
     * (the STFT, the bands, an offset, a new analysis), not by a cursor action. Holding there would keep a picture of
     * the old conditions on screen (SpectrumCommitHold is for one cursor action's answers arriving together).
     */
    let unheldSpectrumGeneration: number | null = null;
    function invalidateDesiredSpectrumSliceRequests(cursorAction = false) {
        spectrumRequests.invalidate();
        unheldSpectrumGeneration = cursorAction ? null : spectrumRequests.generation;
    }
    function spectrumReadoutTrackLabel(result: ComparisonTrackState, channelIndex: number) {
        const channels = channelsForResult(result);
        const name = result && result.fileName ? result.fileName : '';
        return channels.length > 1 ? name + ' ' + channelLabel(result, channelIndex) : name;
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
    /** A track taken off the screen: its cursor answers are forgotten and the backend lets go of what it kept of the file. */
    function releaseTrackDetail(i: number) {
        const result = state.results[i];
        const record = trackRecordAtIndex(i);
        if (!result || !record) {
            return;
        }
        spectrumRequests.drop(spectrumSliceRequestKey(record.id));
        record.requests.drop('slice');
        record.cursorAnswers.clear();
        messaging.post({ type: 'release-track-detail', analysisId: analysisId, settingsSignature: currentSettingsSignature(), trackIndex: i, filePath: result.filePath });
    }
    function spectrumCursorTolerance(result: ComparisonTrackState) {
        const dur = result && result.durationSeconds ? result.durationSeconds : 0;
        if (dur <= 0) {
            return 0.002;
        }
        return Math.min(0.002, 0.01 / dur);
    }
    /** The track's kept answers when they are this cursor's: of the current settings, transformed at this cursor. */
    function cursorAnswersAt(i: number, cursorNormValue: number): CursorAnswers | null {
        const result = state.results[i];
        const held = trackRecordAtIndex(i)?.cursorAnswers.get() ?? null;
        const localNorm = trackLocalCursorNorm(i, cursorNormValue);
        return held && result && localNorm !== null && held.settingsSignature === currentSpectrumDataSignature()
            && Math.abs(held.cursorNorm - localNorm) < spectrumCursorTolerance(result) ? held : null;
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
    /**
     * A recording's cursor answers that failed, at that cursor under those settings: not asked again while the
     * store's pause stands, then asked by themselves (stopped: the spectra are drawn again, which asks; playing, the
     * next time asked at is another cursor anyway).
     */
    const failedCursorAnswers = createFailureHold(spectrumNow, () => { if (!playback.isRunning()) scheduleSpectrumRefresh('interactive'); });
    const cursorAnswersAsked = (settingsSignature: string, localNorm: number): string => settingsSignature + '@' + localNorm;
    /** Asks for track i's kept answers at the cursor, unless they are held, already on their way or failed a moment ago. */
    function requestSpectrumSlice(i: number, cursorNormValue: number): void {
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
        // At the track's very end there is no window to transform (the cursor is past its last sample).
        if (localNorm === null || localNorm >= 1 || cursorAnswersAt(i, cursorNormValue)) {
            return;
        }
        const settingsSignature = currentSpectrumDataSignature();
        const pending = currentSpectrumSliceRequest(record);
        if (pending && pending.settingsSignature === settingsSignature && Math.abs((pending.cursorNorm ?? -1) - localNorm) < spectrumCursorTolerance(result)) {
            return;
        }
        if (failedCursorAnswers.holds(record.id, cursorAnswersAsked(settingsSignature, localNorm))) {
            return;
        }
        spectrumRequests.want(spectrumSliceRequestKey(record.id), {
            trackId: record.id,
            requestId: nextRequestId('slice', i),
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
    /**
     * While playing, the one time every recording's answers are asked at. The answers are asked one recording after
     * another while the cursor runs on: asked each at the cursor of its turn, the lines of one picture would be of as
     * many times as there are recordings. So a time is taken, every recording is asked at it, and the next time is
     * taken only once none of them is on its way (or, one never answered, after UNANSWERED_RETRY_MS).
     */
    let playbackSpectrumRound: { norm: number; startedAt: number } | null = null;
    function queuePlaybackSpectrumRequests(cursorNormValue: number) {
        const indices = trackStore.activeIds().map(trackId => trackStore.protocolIndexForId(trackId)).filter((index): index is number => index !== null);
        const round = playbackSpectrumRound;
        const underWay = round !== null && spectrumNow() - round.startedAt < UNANSWERED_RETRY_MS
            && indices.some(index => isSpectrumSliceRequestPendingForCursor(index, round.norm));
        const at = underWay ? round.norm : cursorNormValue;
        if (!underWay) playbackSpectrumRound = { norm: at, startedAt: spectrumNow() };
        indices.forEach(index => requestSpectrumSlice(index, at));
    }
    /** The range the spectrogram's display settings give the spectra too: a typed dB range (the first level's), a top frequency. */
    function spectrumSettingsRange(): SettingsRange {
        const display = spectrogramSettings.display;
        const top = display.maxFrequencyHz;
        return {
            ...(top != null && Number.isFinite(top) && top > 0 ? { across: [null, top] as const } : {}),
            ...(display.dbMin != null || display.dbMax != null ? { up: [display.dbMin ?? null, display.dbMax ?? null] as const } : {}),
        };
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
    // The full data the steps view reads (R7): each read's answer, on its own requests.
    messaging.onMessage(function (msg) {
        // A read of a file changed since its track was analysed stops the track's lanes as any lane answer does.
        if (msg && 'trackIndex' in msg && 'staleSource' in msg && msg.staleSource) trackIdAtProtocolBoundary(msg.trackIndex, msg);
        if (msg && regionPeaks.handle(msg)) testBridge.publishAfterFrame();
    });
    messaging.onMessage(function (msg) {
        if (!msg || (msg.type !== 'cursor-answers-result' && msg.type !== 'spectrum-slice-error')) {
            return;
        }
        const active = spectrumRequests.settle(msg.requestId);
        if (!active) {
            return;
        }
        const i = msg.trackIndex;
        const trackId = trackIdAtProtocolBoundary(i, msg);
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
        if (msg.type === 'cursor-answers-result' && isCurrent) {
            record.cursorAnswers.set({
                settingsSignature: msg.settingsSignature, cursorNorm: pending.cursorNorm ?? msg.cursorNorm, channels: msg.channels,
                windowStartNorm: msg.windowStartNorm, windowEndNorm: msg.windowEndNorm, window: msg.window,
            });
            spectrumCursorNorm = active.globalCursorNorm;
            runtimeEvents.emit(() => ({
                type: 'spectrum-slice-timing',
                timing: {
                    requestId: msg.requestId,
                    cursorNorm: active.cursorNorm,
                    // The answers are kept, not sent: the backend's time is not in their reply.
                    backendComputeMs: undefined,
                    cursorToResponseMs: Math.max(0, spectrumNow() - active.requestedAt),
                    responseAt: spectrumNow(),
                    inFlight: 0,
                    desiredCount: spectrumRequests.desiredCount,
                },
            }));
        }
        if (msg.type === 'spectrum-slice-error' && isCurrent) {
            failedCursorAnswers.fail(trackId, cursorAnswersAsked(pending.settingsSignature, active.cursorNorm));
        }
        spectrumRequests.scheduleFrame(false, false);
        // A slice moves the lanes' analysis window band, drawn on the waveform; while playing none is drawn and the
        // answers keep coming, so they need no more than a playback frame's redraw.
        if (playback.isRunning()) scheduleCursorRender();
        else scheduleRender();
        testBridge.publishAfterFrame();
        spectrumRequests.pump();
    });
    // A track's file was written on disk (the host's watcher): its lanes are of the old version, so they stop and
    // offer to analyse again, as when a lazy answer comes back stale-source.
    messaging.onMessage(function (msg) {
        if (!msg || msg.type !== 'entry-source-changed') return;
        trackStore.displayOrder.map(trackId => trackStore.require(trackId)).filter(record => record.result.filePath === msg.filePath)
            .forEach(record => { record.sourceChanged = true; });
        scheduleRender();
        testBridge.publishAfterFrame();
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
            // The spectrum overlay's PNG or CSV from the figure service: no menu offers it yet.
            'export-figure': p => stageMode?.exportFigure(p.kind === 'csv' ? 'csv' : 'png'),
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
        figures,
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
        loadCsv: () => persistedWebviewState.entryCsv,
        saveCsv: csv => persistWebviewState({ entryCsv: csv }),
        loadRecipe: () => persistedWebviewState.entryRecipe,
        saveRecipe: recipe => persistWebviewState({ entryRecipe: recipe }),
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
        figures,
        // The steps the comparison runs are bounded by the tracks it compares, not every file of the table.
        recipe: () => entryScreen.recipes(comparedChannels()),
        slots: () => entryScreen.slots(),
        basePaths: (comparePath, group) => entryScreen.basePaths(comparePath, group),
        baseHeading: (comparePath, group, set, each) => entryScreen.baseHeading(comparePath, group, set, each),
        baseLeft: (comparePath, group) => entryScreen.baseLeft(comparePath, group),
        channelCount: path => entryScreen.channelCount(path),
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
            trackStore.displayOrder.forEach(function (trackId) {
                const record = trackStore.require(trackId);
                const result = record.result;
                if (record.runtime.hidden || result.error || !result.filePath) return;
                const i = record.protocolIndex;
                // The file's unit and reference as the track was analysed (the channel the step reads), so the level axis
                // names its reference (C1), never a bare dB for channels calibrated apart.
                const channels = channelsForResult(result);
                const read = entryScreen.stageChannel(result.filePath, result.filePath);
                const input = trackLevelInput(read && channels[read - 1] ? [channels[read - 1]] : channels, undefined, read);
                tracks.push({ filePath: result.filePath, color: trackColor(i), input });
            });
            return tracks;
        },
        sampleRate: () => state.results.find(result => !result.error)?.sampleRateHz,
        // A file's pictures are of its version and calibration (the track's analysis; the host's word of a change): a change asks them again.
        basis: stageBasis(() => undefined, path => state.results.find(result => result.filePath === path && !result.error), path => entryScreen.compareData().fileEpoch?.(path) ?? ''),
        // What a trigger sees: the compared slots' channels (a channel row, its own) of the shown tracks, over the region.
        // From every sample of each (the lanes' full data, as their readouts read it), never from the envelopes drawn.
        peak: region => {
            const shown = trackStore.displayOrder.map(trackId => trackStore.require(trackId)).filter(record => !record.runtime.hidden && !record.result.error);
            const compared = entryScreen.compareData().slots.filter((slot): slot is string => !!slot);
            const of: PeakOf[] = [];
            for (const record of shown) {
                const result = record.result;
                const slots = compared.filter(slot => fileOfKey(slot) === result.filePath);
                if (compared.length && !slots.length) continue;
                const picked = slots.map(slot => /#ch(\d+)$/.exec(slot)?.[1]).filter((ch): ch is string => ch !== undefined).map(ch => Number(ch) - 1);
                // A lane's samples are read on its file's 0..1: the region's seconds over the file's length.
                const length = result.durationSeconds;
                const [x0, x1] = region && length > 0 ? [region.start / length, region.end / length] : [0, 1];
                const channels = channelsForResult(result).map((_channel, index) => index).filter(index => !picked.length || picked.includes(index));
                if (!channels.length) continue;
                // A file changed since it was analysed has no full data to read (peakTrack): its peak is unknown.
                of.push({ filePath: result.filePath, track: peakTrack(record.protocolIndex), channels, startNorm: x0, endNorm: x1 });
            }
            // Nothing on screen waits for the answer: the bar reads it again when a trigger is added, so no redraw is asked.
            // More recordings than LARGE_BASE (no slots chosen, many tracks shown) are not read unasked.
            return regionPeaks.peak(of, LARGE_BASE);
        },
        stepFailed: (step, reason) => entryScreen.stepFailed(step, reason),
        channels: () => comparedChannels(),
        rerender: () => scheduleRender(),
        hint: text => hintFooter.show(text),
        notify: text => taskStatus(text, 'done'),
        busy: text => taskStatus(text, 'busy'),
        failed: text => taskStatus(text, 'failed'),
        saveFile(file) {
            if (file.kind === 'png') { triggerAnchorDownload(document, file.dataUrl, file.name); return; }
            if (messaging.downloadFile(file.text, file.name, 'text/csv;charset=utf-8')) return;
            downloadEntryCsv(document, 'data:text/csv;charset=utf-8,' + encodeURIComponent(file.text), file.name);
        },
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
        report(region, shown) {
            const data = entryScreen.compareData();
            // What the comparison is of (its recordings, bases, region, chain, memos), taken now, at the click: every
            // row read here, none when the figure's exports come (the slots or the chain may be others by then).
            const slots = [...data.slots];
            // (Words of the table, a few: the recording's name, memo, channel and base.)
            const rows = slots.filter((path): path is string => !!path).map(path => ({ path, row: entryScreen.reportRow(path, shown.groupBase, shown.compared) }));
            const words = {
                slots, region, recipe: entryScreen.recipes(comparedChannels())?.runRecipe ?? data.recipe ?? null, recipeName: STR.stepRecipeName, now: new Date(),
                columns: [...entryScreen.conditionColumns()], row: (path: string) => rows.find(item => item.path === path)?.row ?? entryScreen.reportRow(path, shown.groupBase, shown.compared), selection: entryScreen.selection(),
                slotReference: activeSlotReferenced(data.recipe), stage: shown.stage, excluded: excludedList(data.recipe),
            };
            // The figure on show as the figure service wrote it. No number is made here.
            return figure => {
                const { folder, files } = reportFiles({ ...words, figure }, STR);
                messaging.post({ type: 'save-report-folder', folder, files });
                // Handed to the host, which asks where to put it and says when it is written (or that it was not).
                hintFooter.show(STR.reportReady + folder);
                taskStatus(STR.reportReady + folder, 'done');
            };
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

    /** A row's waveform amplitude as zoomed into: what it shows from bottom to top, at the range field's numbers (R9). */
    function zoomedAmplitude(result: ComparisonTrackState, channelIndex: number) {
        return laneAmplitudeRange(amplitudeScaleFor(channelsForResult(result)[channelIndex]), { minNorm: waveformView.amplitudeMin, maxNorm: waveformView.amplitudeMax });
    }
    /**
     * The lanes' visible time span in seconds (the ruler's and every lane's time axis): the ends each lane is painted
     * with (the range field's numbers, R9), which the time range popover writes.
     */
    function laneVisibleSeconds() {
        const gs = trackStore.globalSpan();
        const ends = linearWindowEnds(gs.startSec, gs.startSec + gs.spanSec, waveformView.timeRange());
        return { start: ends.min, end: ends.max };
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
                };
            }),
            globalSpan: trackStore.globalSpan(),
            zoomStart: waveformView.start,
            zoomEnd: waveformView.end,
            spectrogramDisplay: spectrogramSettings.display,
            spectrumLine: track => !!cursorFigure?.screen.inspect()?.lanes.some(lane => lane.lines.some(line => cursorLineOf(line.id)?.track === track.trackId)),
            waveformAxisLabels: track => {
                const lane = rowsScreen.inspect(track.trackId, 0)?.lanes.find(found => found.id === TRACK_WAVE_LANE);
                return lane ? [...lane.yTicks.map(tick => tick.text), lane.axisNames.y] : [];
            },
            waveformLane: track => {
                const lane = rowsScreen.inspect(track.trackId, 0)?.lanes.find(found => found.id === TRACK_WAVE_LANE);
                return lane?.range ? { frame: lane.frame, range: [lane.range.y[0], lane.range.y[1]] } : null;
            },
            waveformDrawn: track => {
                const lane = rowsScreen.inspect(track.trackId, 0)?.lanes.find(found => found.id === TRACK_WAVE_LANE);
                const xs = (lane?.lines ?? []).flatMap(line => line.points.flatMap(point => (point ? [point[0]] : [])));
                return lane && xs.length ? { minX: Math.min(...xs), maxX: Math.max(...xs), left: lane.frame.left, width: lane.frame.width } : null;
            },
            spectrumTexts: () => (cursorFigure?.screen.inspect()?.lanes ?? []).flatMap(lane => [...lane.xTicks.map(tick => tick.text), lane.axisNames.x, ...lane.yTicks.map(tick => tick.text), lane.axisNames.y]),
            spectrogramTexts: track => {
                const lane = rowsScreen.inspect(track.trackId, 0)?.lanes.find(found => found.image);
                return lane?.image ? [...lane.yTicks.map(tick => tick.text), lane.axisNames.y, ...lane.image.colourTicks.map(tick => tick.text), lane.image.colourName] : [];
            },
        });
        let latestSpectrogram;
        try {
            const first = trackIdAtIndex(0);
            latestSpectrogram = latestSpectrogramSnapshot(first ? rowsScreen.held(first)?.whole : null, spectrogramSettings.settings);
        }
        catch { /* ignore */ }
        return {
            ...domSnapshotBase(document),
            zoomStart: waveformView.start,
            zoomEnd: waveformView.end,
            amplitudeZoomMinNorm: waveformView.amplitudeMin,
            amplitudeZoomMaxNorm: waveformView.amplitudeMax,
            cursorNorm: viewState.cursor,
            visibleSpectrumTrackCount: trackSnapshot.visibleSpectrumTrackCount,
            contentType: contentType,
            spectrumBandsPerOctave: spectrumBandsPerOctave,
            reanalyzeBusy: isReanalyzeBusy(),
            latestSpectrogram: latestSpectrogram,
            axisLabels: trackSnapshot.axisLabels,
            displayOrder: trackStore.displayOrder.slice(),
            specFreqStart: spectrumZoomParts().specFreqStart,
            specFreqEnd: spectrumZoomParts().specFreqEnd,
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
            specFreqStart: 0,
            specFreqEnd: 1,
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
            stacked.innerHTML = buildTrackRowsHtml();
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
            splitHint: STR.hintTrackSplit,
            splitLabel: STR.trackSplitLabel,
            referenceButtonHtml: channels.length > 1 ? referenceButtonHtml(trackId, channelIndex, STR) : undefined,
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
            roleChipHtml: roleChipHtml(result.filePath, trackRole(result.filePath), trackOwnColor(i), STR),
            playable: !!result.audioSource,
            lanesHtml: buildChannelLanes(result, i),
            referenceButtonHtml: channelsForResult(result).length === 1 ? referenceButtonHtml(trackId, 0, STR) : undefined,
        }, STR);
    }
    // ── Rendering ──
    /** Each track whose file changed after it was analysed shows its "analyse again" button; the others hide it. */
    function syncSourceChanged(): void {
        trackStore.displayOrder.forEach(trackId => {
            const button = buttonMatching(document, '[data-action="reanalyze-changed"][data-track-id="' + trackId + '"]');
            if (button) button.hidden = !trackStore.require(trackId).sourceChanged;
        });
    }
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
        syncSourceChanged();
        updateVisibility();
        updateOffsetDisplays();
        emitWaveformZoom();
    }
    /** The ruler's canvas at its row's width (the rows' Figures size themselves). */
    function resizeAllCanvases() {
        const rulerCanvas = canvasById(document, 'ruler-canvas');
        const rulerRow = rulerCanvas ? document.getElementById('ruler-row') : null;
        if (!rulerCanvas || !rulerRow) return;
        // Shown at the row's width in CSS pixels; its bitmap at the device's pixels, as the rows' Figures are (a
        // bitmap of CSS pixels is blurred on a screen of two device pixels a point, and half the rows' size in the PNG).
        const width = Math.max(1, rulerRow.clientWidth - TRACK_HEADER_W - AXIS_W), ratio = window.devicePixelRatio || 1;
        if (rulerCanvas.style.width !== width + 'px') rulerCanvas.style.width = width + 'px';
        if (rulerCanvas.style.height !== '20px') rulerCanvas.style.height = '20px';
        syncCanvasSize(rulerCanvas, width * ratio, 20 * ratio, { syncStyle: false });
    }
    function renderRuler() {
        const canvas = canvasById(document, 'ruler-canvas');
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) {
            return;
        }
        const ratio = window.devicePixelRatio || 1;
        const W = canvas.width / ratio;
        // The ticks follow the rows' time span: the width the rows' Figures drew their plots at, in the ruler's own pixels.
        const rowsW = rowsScreen.plotWidth();
        const timeW = rowsW === null ? W : Math.min(W, Math.round(rowsW * (W / (canvas.clientWidth || W))));
        const seconds = laneVisibleSeconds();
        const style = getComputedStyle(document.body);
        // The rows' time axis: its ticks, their numbers and its name (timeRuler.ts).
        paintTimeRuler(canvas, timeRulerTicks(seconds.start, seconds.end, timeW), STR.axisTime, timeW, {
            muted: style.getPropertyValue('--muted').trim() || '#888',
            line: style.getPropertyValue('--line').trim() || '#444',
            text: style.getPropertyValue('--text').trim() || '#ddd',
        }, ratio);
    }
    function renderStackedTracks() {
        linkedPeaksMemo = null;
        const tracksWrapperEl = document.getElementById('tracks-wrapper');
        if (tracksWrapperEl && stageMode && !tracksWrapperEl.contains(stageMode.root)) tracksWrapperEl.prepend(stageMode.root);
        const ruler = document.getElementById('ruler-row');
        if (ruler) ruler.style.display = contentType === 'stage' ? 'none' : '';
        if (contentType === 'stage') {
            // The lanes draw the chosen step's Frames; their spectrograms are hidden (CSS).
            stageMode?.paint();
            showRowFigures();
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
        });
        showRowFigures();
    }
    /** scheduleCursorRender's pass: the lanes renderStackedTracks would draw, with only their cursor-following layers. */
    function renderCursorLayers() {
        // The steps view draws its own plots; a pass that also has to show the spectra again is a full one.
        if (contentType === 'stage' || spectraHidden) {
            renderAll();
            return;
        }
        rowsScreen.marks();
    }
    /** A track as a peak's read names it: its file, and the version and calibration it was analysed under. */
    function peakTrack(trackIndex: number): PeakTrack | null {
        const result = state.results[trackIndex];
        // A file changed since it was analysed is read no more (its answer would be of another version).
        return result && !trackRecordAtIndex(trackIndex)?.sourceChanged ? { filePath: result.filePath, sourceVersion: result.sourceVersion, calibrationSignature: result.calibrationSignature } : null;
    }
    /** What a waveform lane draws over its plot that moves with the cursor or the loop (not the hover's readout). */
    function drawWaveformCursorLayers(ctx: CanvasRenderingContext2D, W: number, H: number, trackIndex: number, channelIndex: number) {
        drawLoopRegionOnCanvas(ctx, W, H);
        drawAnalysisWindowOnCanvas(ctx, W, H, trackIndex, channelIndex);
        drawCursorOnCanvas(ctx, W, H, waveformCursorLineStyle(getComputedStyle(document.body).getPropertyValue('--text').trim()));
    }
    /** The span behind the spectrum currently shown for this track, in global timeline norms; null when that spectrum is not a backend slice. */
    function analysisWindowBand(trackIndex: number): AnalysisWindowBand | null {
        const result = state.results[trackIndex];
        const record = trackRecordAtIndex(trackIndex);
        const localNorm = trackLocalCursorNorm(trackIndex, spectrumCursorNorm);
        // At the exact track end there is no window to transform.
        if (!result || !record || record.runtime.hidden || localNorm === null || localNorm >= 1) {
            return null;
        }
        // Answers of another cursor (this one's still on their way after playback or a move) would put the band elsewhere.
        const slice = cursorAnswersAt(trackIndex, spectrumCursorNorm);
        if (!slice) {
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
        holdingThisPass = spectrumCommitHold.holds(pending && spectrumRequests.generation !== unheldSpectrumGeneration, spectrumRequests.generation);
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
            return analysisWindowBand(trackIndex);
        }
        if (holding) {
            // A track with nothing shown yet (after playback, or just shown again) waits for the others too.
            return shownWindowBands.get(key) ?? null;
        }
        const band = analysisWindowBand(trackIndex);
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
    function drawLoopRegionOnCanvas(ctx: CanvasRenderingContext2D, W: number, H: number) {
        if (!viewState.loop) {
            return;
        }
        paintLoopRegion(ctx, W, H, viewState.loop.start, viewState.loop.end, waveformView.start, waveformView.end);
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
        // The comparison's lanes, spectrum and keys live as long as the page, which is never torn down while it is
        // shown: their disposers (the clean-up promise of attachPlotInteraction and keyRouter) are held here.
        let releasePage = (): void => undefined;
        const holdForPage = (dispose: () => void): void => { const before = releasePage; releasePage = () => { before(); dispose(); }; };
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
        holdForPage(keyRouterFor(window).add({
            layer: 'lanes',
            keydown(e) {
                // A text field (the offset editor) uses Esc to cancel its own edit.
                if (e.key !== 'Escape' || !layout.spectrumMaximized || hasOpenOverlay() || isTextEntryTag(eventTarget(e)?.tagName)) return false;
                setSpectrumMaximized(false);
                return true;
            },
        }));
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
            // The file changed on disk after it was analysed: every track is analysed again (unchanged ones keep their version).
            'reanalyze-changed': () => reanalyzeSpectrogram(STR.reanalyzingChanged),
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
        // The rows are Figures and answer their own gestures (screens/trackRows.ts). What is left to the shared plot
        // gestures here is the rows' one time axis: the ruler's range (a double-click on it; where it has none, the zoom
        // is reset) and the wheel on the ruler and beside the rows (their headers). In the steps mode the time axis is
        // out of sight and answers nothing.
        holdForPage(attachPlotInteraction(tracksWrapper, document, '#ruler-canvas', {
            locate: () => null,
            pointOn: () => ({ fx: 0.5, fy: 0.5 }),
            window: () => ({ x: waveformView.timeRange(), y: FULL_PLOT_WINDOW.y }),
            setWindow: (_plot, next) => setTimeWindow(next),
            wheelAt: timeWheelAt,
            hover: () => undefined,
            clearHover: () => undefined,
            stepFrom: () => null,
            showBox: () => undefined,
            hideBox: () => undefined,
            openAxisRange: (_hit, clientX, clientY) => openTimeRangePopup(clientX, clientY),
            axes: {
                selector: '#ruler-canvas',
                locate: axis => (contentType === 'stage' ? null : { plot: axis, point: { fx: 0.5, fy: 0.5 }, axis: 'x' }),
            },
        }));
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
        // A focused row's canvas says the keys that move its time cursor.
        attachFocusHint(tracksWrapper, '.track-row-figure canvas', hintFooter, STR.cursorHelpKeys);
        holdForPage(attachGlobalKeyboardListeners(keyRouterFor(window), document, {
            helpOverlay: () => document.getElementById('help-overlay'),
            runShortcut: handleToolbarAction,
            togglePlayback(target, active) {
                // The focused canvas is a row's Figure: its recording is named on the row that holds it.
                const trackId = target === 'focused-track'
                    ? active && trackIdFromElement(active.closest?.('[data-track-id]') ?? active)
                    : playback.trackId ?? trackStore.activeIds()[0];
                if (trackId) {
                    playback.toggle(trackId);
                }
            },
            stepCursor(direction, shiftKey, active) {
                if (!active) {
                    return;
                }
                // The pointer on another plot (one showing nothing yet too): the key is that plot's, never the
                // focused lane's time (R7).
                const under = plotUnderPointer(document);
                if (under && under !== active) {
                    return;
                }
                const step = arrowCursorStep(shiftKey, trackStore.globalSpan().spanSec, waveformView.start, waveformView.end, (active as HTMLCanvasElement).width || 800);
                moveCursor(viewState.cursor + direction * step);
            },
            arrowReleased: () => scheduleSpectrumRefresh('immediate'),
        }));
        // カーソル時刻のパワースペクトルのホバーとキーボード
        (function attachSpectrumCursorEvents() {
            // The cursor spectrum's gestures, marks and readout are its Figure's (screens/tracksFigure.ts).
            pairPanel.attach();
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
        stageMode?.setActive(next === 'stage');
        document.body.classList.toggle('is-stage-view', next === 'stage');
        // The track lanes, on one time axis, share the toolbar's readout above them (R7); the steps view reads in its own row.
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
        cursorFigureScreen()?.whole();
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
        const canvas = document.getElementById('spectrum-overlay-plot');
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
        const canvas = document.getElementById('spectrum-overlay-plot');
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
        try { renderStackedTracks(); } finally { drawEveryLane = false; }
        // The analysis window band drawn on each lane comes from its cursor spectrum: lanes out of view ask for theirs too.
        if (contentType !== 'stage') requestEveryCursorSpectrum(spectrumCursorNorm);
    }
    /** The open cursor-spectrum requests. */
    function openDetailRequestIds(): Set<string> {
        const ids = new Set<string>();
        state.results.forEach(function (_: ComparisonTrackState, i: number) {
            const pending = trackRecordAtIndex(i)?.requests.pending('slice');
            if (pending) ids.add(pending.requestId);
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
        // The image holds every shown row, also those scrolled out of view: drawing them asks for the answers and cursor
        // spectra they lack, and the image is composed once those have arrived (or after a while, as far as they got).
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
        // (The rows' Figures out of view are drawn for the image: their answers and pictures are waited for too.)
        if ((anyStillOpen(waitFor) || rowsScreen.busy()) && Date.now() < deadline) {
            setTimeout(function () { composePngWhenDetailed(waitFor, deadline, failed); }, 100);
            return;
        }
        renderEveryLane();
        // Drawn again for the image (a row out of view lets its Figure go while the others are waited for): a Figure
        // made just now is waited for too, never copied while its picture is on its way.
        if (rowsScreen.busy() && Date.now() < deadline) {
            setTimeout(function () { composePngWhenDetailed(waitFor, deadline, failed); }, 100);
            return;
        }
        const wrapper = document.getElementById('tracks-wrapper');
        const pieces = visibleExportCanvases(wrapper);
        // Still waiting at the deadline (the image is of the rows as far as they got), or a recording that could not
        // be analysed at all (it has no row: its error is said in its place on the page): the image is not whole.
        const late = rowsScreen.busy() || !!wrapper?.querySelector('[id^="track-error-overlay-"]');
        setTimeout(function () {
            // Each row's recording and channel, as its headers say them (they are beside the canvas, not in it); and
            // the words of a row that could not be drawn (failed, still waiting at the deadline, too short), as on the page.
            const composed = composeTrackCanvases(document, pieces, function (piece) {
                if (!piece.closest('.track-row-figure')) return '';
                const file = piece.closest('.track-row')?.querySelector('.track-name')?.textContent?.trim() ?? '';
                const channel = piece.closest('.track-channel-lane')?.querySelector('.track-channel-lane-label')?.textContent?.trim() ?? '';
                return [file, channel].filter(Boolean).join(' · ');
            }, rowSaysPlaced);
            // (A canvas larger than the browser can hold gives no PNG: "data:,".)
            const url = composed ? composed.toDataURL('image/png') : '';
            if (!url.startsWith('data:image/png')) {
                messaging.post({ type: 'show-info', message: failed });
                taskStatus(failed, 'failed');
                return;
            }
            triggerAnchorDownload(document, url, 'waveform-export.png');
            // Written, and said so as it is: with rows that are not drawn, the notice says the image is not whole.
            const whole = !late && !pieces.some(piece => rowSays(piece) !== '');
            taskStatus((whole ? STR.exportPngDone : STR.exportPngPartial).replace('{name}', 'waveform-export.png'), 'done');
        }, 0);
    }
    function exportCsv() {
        const failed = (): void => {
            messaging.post({ type: 'show-info', message: STR.announceExportCsvFailed || 'CSV export failed: no spectrum data at cursor' });
            taskStatus(STR.announceExportCsvFailed, 'failed');
        };
        if (state.results.length === 0 || !cursorFigureScreen()) {
            failed();
            return;
        }
        announce(STR.announceExportCsvStarted || 'CSV export started');
        taskStatus(STR.exportCsvBusy, 'busy');
        writeCsvWhenAnswered(Date.now() + 30000, failed, null);
    }
    /**
     * Writes the cursor spectrum's CSV once every shown track's answers at the cursor are in and drawn. Like the PNG,
     * lanes out of view (and every lane under a folded panel) are asked first; a cursor moved while waiting asks every
     * track again there, so the file holds one cursor. `shownAt`: the cursor the Figure was last shown at for this file.
     */
    function writeCsvWhenAnswered(deadline: number, failed: () => void, shownAt: number | null) {
        const again = (at: number | null): void => { window.setTimeout(() => writeCsvWhenAnswered(deadline, failed, at), 50); };
        if (shownAt === null || viewState.cursor !== shownAt) {
            spectrumCursorNorm = viewState.cursor;
            requestEveryCursorSpectrum(spectrumCursorNorm);
            const waiting = trackStore.activeIds().some(function (trackId) {
                const record = trackStore.require(trackId);
                const i = record.protocolIndex;
                return !record.runtime.hidden && !cursorAnswersAt(i, spectrumCursorNorm) && isSpectrumSliceRequestPendingForCursor(i, spectrumCursorNorm);
            });
            if (waiting && Date.now() < deadline) {
                again(null);
                return;
            }
            renderOverlaySpectrum();
            shownAt = viewState.cursor;
        }
        const screen = cursorFigureScreen();
        const seen = screen?.inspect();
        if (seen && (seen.waiting || seen.pictureId === null) && Date.now() < deadline) {
            again(shownAt);
            return;
        }
        if (!screen?.shown()) {
            failed();
            return;
        }
        // Every answer of the lines shown, written by the figure service from the answers the picture is of (第 6 節).
        void screen.exportCsv().then(function (table) {
            if (table.status !== 'rows') {
                failed();
                return;
            }
            const csv = csvFile(table.header, table.rows);
            // Named by the id of the answers it holds (as the comparison's CSV is): another cursor, recording or
            // setting is another id, so two files of two moments are told apart.
            // With the cursor's time as the page shows it ("0:01.234" as 0-01.234), for a reader of the file's name.
            const span = trackStore.globalSpan();
            const at = formatClockTime(span.startSec + (shownAt ?? viewState.cursor) * span.spanSec).replace(/[^0-9.]+/g, '-');
            const name = `spectrum-export_${at}_${table.dataId}.csv`;
            taskStatus(STR.exportCsvDone.replace('{name}', name), 'done');
            if (messaging.downloadFile(csv, name, 'text/csv;charset=utf-8')) return;
            triggerAnchorDownload(document, 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), name);
        }, failed);
    }
    /** Asks for the cursor spectrum of every shown track, whether or not its lane is on screen. */
    function requestEveryCursorSpectrum(cursorNorm = viewState.cursor) {
        drawEveryLane = true;
        try {
            trackStore.activeIds().forEach(function (trackId) {
                const record = trackStore.require(trackId);
                if (!record.runtime.hidden) requestSpectrumSlice(record.protocolIndex, cursorNorm);
            });
        } finally { drawEveryLane = false; }
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
        scheduleRender();
    }
    function specZoomIn() {
        cursorFigureScreen()?.zoomKey('in');
    }
    function specZoomOut() {
        cursorFigureScreen()?.zoomKey('out');
    }
    function specZoomReset() {
        cursorFigureScreen()?.zoomKey('reset');
    }
    const waveformRangePopover = installRangePopover(document, {
        rootId: 'waveform-range-popover',
        badgeId: 'wave-range-axis-badge',
        idPrefix: 'wave-range',
        strings: rangePopoverStrings(STR),
        position: positionPopover,
    });
    // The lanes' time axis: the part of the tracks' time they show, typed in seconds (blank: that end of it).
    function openTimeRangePopup(clientX: number, clientY: number): boolean {
        const gs = trackStore.globalSpan();
        if (!(gs.spanSec > 0)) return false;
        const seconds = laneVisibleSeconds();
        openAxisPart(waveformRangePopover, {
            mapping: linearAxis(gs.startSec, gs.startSec + gs.spanSec, STR.axisTime), horizontal: true,
            current: waveformView.timeRange(), shown: { min: seconds.start, max: seconds.end }, clientX, clientY, invalid: STR.specRangeErrorMinMax,
            set: part => setTimeWindow(part.start <= 0 && part.end >= 1 ? null : { x: part, y: FULL_PLOT_WINDOW.y }),
        });
        return true;
    }
    function setTimeWindow(next: PlotWindow | null): void {
        if (!next) {
            resetZoom();
            return;
        }
        disableFollowCursor();
        waveformView.setTimeRange(next.x);
        scheduleRender();
    }
    /**
     * Where a wheel zooms or pans the rows' time outside their Figures (which take the wheel on them themselves): on the
     * ruler about the middle, as on every axis; beside the rows (their headers) at the pointer's place across them, the
     * middle off it.
     */
    function timeWheelAt(target: EventTarget | null, clientX: number): PlotHit | null {
        const element = target as Partial<Element> | null;
        const wrapper = document.getElementById('tracks-wrapper'), ruler = canvasById(document, 'ruler-canvas');
        if (contentType === 'stage' || !wrapper || !ruler || typeof element?.closest !== 'function' || element.closest('.track-row-figure')) return null;
        if (element.closest('#ruler-canvas')) return { plot: ruler, point: { fx: 0.5, fy: 0.5 }, axis: 'x' };
        const rect = wrapper.getBoundingClientRect();
        const plotX = clientX - rect.left - TRACK_HEADER_W, width = rect.width - TRACK_HEADER_W;
        return { plot: ruler, point: { fx: width > 0 && plotX >= 0 && plotX <= width ? plotX / width : 0.5, fy: 0.5 }, axis: null };
    }
    function updateCursorDisplay(norm: number) {
        const gs = trackStore.globalSpan();
        const t = gs.startSec + norm * gs.spanSec;
        const el = document.getElementById('cursor-display');
        if (el) {
            el.textContent = formatClockTime(t);
        }
    }
    function spectrumSeriesLabel(result: ComparisonTrackState, channelIndex: number) {
        return result.fileName + ' / ' + channelLabel(result, channelIndex);
    }
    /** A cursor spectrum line's recording, by its id in the spec (charts/cursorSpectrum.ts). */
    function spectrumLineRecord(line: string) {
        const of = cursorLineOf(line);
        const record = of ? trackStore.get(of.track as TrackId) : undefined;
        return of && record ? { record, channel: of.channel } : null;
    }
    const spectrumPaint: TracksFigurePaint = {
        name(line) { const of = spectrumLineRecord(line); return of ? spectrumSeriesLabel(of.record.result, of.channel) : line; },
        colour(line) { const of = spectrumLineRecord(line); return of ? trackColor(of.record.protocolIndex) : '#7f7f7f'; },
    };
    /**
     * The panel's legend: each line's colour and name, so overlaid lines are named without a hover. (The level's name
     * is on each lane's axis.) Rebuilt only when what it says changes: the figure is shown again on every cursor move.
     */
    function writeSpectrumLegend(lines: readonly CursorSpectrumLine[]): void {
        const el = document.getElementById('spectrum-axis-legend');
        if (!el) return;
        const named = lines.map(line => ({ colour: spectrumPaint.colour(line.id), label: spectrumPaint.name(line.id) }));
        const key = JSON.stringify(named);
        if (el.getAttribute('data-legend-key') === key) return;
        el.setAttribute('data-legend-key', key);
        el.replaceChildren();
        el.hidden = named.length === 0;
        const text = (className: string, value: string): HTMLElement => { const made = document.createElement('span'); made.className = className; made.textContent = value; return made; };
        const item = document.createElement('span');
        item.className = 'spectrum-axis-legend-item';
        for (const line of named) {
            const swatch = document.createElement('span');
            swatch.className = 'spectrum-axis-legend-swatch';
            swatch.style.background = line.colour;
            item.appendChild(swatch);
            // A long file name is cut, not the channel after it: two channels of one recording stay apart.
            const cut = line.label.indexOf(' / ');
            const label = text('spectrum-axis-legend-label', cut < 0 ? line.label : '');
            if (cut >= 0) {
                label.appendChild(text('spectrum-axis-legend-file', line.label.slice(0, cut)));
                label.appendChild(text('spectrum-axis-legend-channel', line.label.slice(cut)));
            }
            item.appendChild(label);
        }
        el.appendChild(item);
    }
    /**
     * Shows the cursor spectrum: the lines of every shown track's channels at the cursor, in the rows' order
     * (charts/cursorSpectrum.ts), handed to the Figure. A track the cursor is outside of has no line.
     *
     * While a shown track's answers are on their way the last picture stays (the real lines of a moment before), so
     * the lines of a picture are always of one time, the header's. Stopped, that is until every track's arrive or the
     * hold runs out (SpectrumCommitHold); playing, until every track's of the time asked at arrive
     * (playbackSpectrumRound).
     */
    function renderOverlaySpectrum() {
        const screen = cursorFigureScreen();
        if (!screen) {
            return;
        }
        syncSpectrumCanvasCssHeight();
        const playing = playback.isRunning();
        const lines: CursorSpectrumLine[] = [];
        let pending = false;
        trackStore.displayOrder.forEach(function (trackId) {
            const record = trackStore.require(trackId);
            const i = record.protocolIndex;
            const localNorm = trackLocalCursorNorm(i, spectrumCursorNorm);
            if (record.runtime.hidden || record.result.error || localNorm === null || localNorm >= 1) {
                return;
            }
            requestSpectrumSlice(i, spectrumCursorNorm);
            const held = cursorAnswersAt(i, spectrumCursorNorm);
            if (!held) {
                pending = pending || isSpectrumSliceRequestPendingForCursor(i, spectrumCursorNorm);
                return;
            }
            const channels = channelsForResult(record.result);
            held.channels.forEach(function (channel) {
                if (channel.key === undefined) return;
                lines.push({ id: cursorLineId(trackId, channel.channelIndex), key: channel.key, level: channel.level,
                    calibrated: channels[channel.channelIndex]?.measurement?.calibrationStatus === 'calibrated' });
            });
        });
        if (pending && screen.shown() && (playing || holdingSpectrumCommit())) {
            // The last picture stays: its header keeps that picture's time (ShownSpectrumCursor).
            shownSpectrumCursor.keep();
            return;
        }
        screen.show(cursorSpectrum(lines), spectrumPaint, spectrumSettingsRange());
        if (screen.inspect()?.mapped) {
            // The picture of these lines is on its way and the one before stays on show: the header's time and the
            // legend stay that picture's until this one arrives (spectrumPictureArrived).
            shownSpectrumCursor.keep();
            spectrumToShow = { norm: spectrumCursorNorm, lines };
            return;
        }
        spectrumToShow = null;
        shownSpectrumCursor.drawn(spectrumCursorNorm);
        writeSpectrumLegend(lines);
    }
    /** The cursor and the lines of the picture on its way, said beside the figure once it is on show. */
    let spectrumToShow: { norm: number; lines: CursorSpectrumLine[] } | null = null;
    function spectrumPictureArrived() {
        if (!spectrumToShow) return;
        const next = spectrumToShow;
        spectrumToShow = null;
        shownSpectrumCursor.drawn(next.norm);
        // The cursor went on meanwhile: this picture is a kept one already.
        if (next.norm !== spectrumCursorNorm) shownSpectrumCursor.keep();
        writeSpectrumLegend(next.lines);
        writeSpectrumCursorTime();
    }
    function refreshSpectrumViews() {
        // The comparison hides the spectrum panel; it is drawn again on leaving it.
        if (contentType !== 'stage') {
            renderOverlaySpectrum();
        }
        pairPanel.render();
        emitSpectrumZoom();
        writeSpectrumCursorTime();
    }
    function writeSpectrumCursorTime() {
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
        // A track taken off frees what the host holds for it, which may be why another row failed: those are asked again now.
        rowFailures.clear();
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
    function setSpectrogramDisplay(given: SpectrogramDisplaySettings): void {
        const before = spectrogramSettings.display;
        // The typed dB ends are every row's: no level identity is kept with them (a saved one is let go).
        const display: SpectrogramDisplaySettings = { ...given, dbLevelKey: null };
        // A frequency range set (here, the axis' popover or ⚙) replaces the box zoom's band; a level range keeps it.
        if (display.minFrequencyHz !== before.minFrequencyHz || display.maxFrequencyHz !== before.maxFrequencyHz) spectrogramFrequencyView = null;
        spectrogramSettings.setDisplay(display);
        messaging.post({ type: 'update-spectrogram-settings', settings: spectrogramSettings.settings });
        // Touching the settings is the user's way to try a failed row again.
        rowFailures.clear();
        scheduleRender();
        scheduleSpectrumRefresh('immediate');
        testBridge.publishAfterFrame();
    }
    /**
     * The STFT the spectra are made of changed (⚙ Apply, or Reset back from another): every track is analysed again
     * with it, and spectra and reads asked for under the old one are stale, so lanes, readouts and the cursor spectrum
     * stay of one STFT. The only way the settings' data signature changes. A file changed on disk after it was
     * analysed is analysed again the same way (its "analyse again" button).
     */
    function reanalyzeSpectrogram(busy: string = STR.reanalyzingStft): void {
        invalidateDesiredSpectrumSliceRequests();
        regionPeaks.clear();
        setReanalyzeBusy(true, busy);
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
        longComputations.received(msg);
        if (figures.handle(msg)) return;
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
        regionPeaks.clear();
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

