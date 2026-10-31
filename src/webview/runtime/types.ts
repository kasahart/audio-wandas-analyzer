import type { UiStrings } from '../../shared/i18n/strings';
import type {
    AnalysisResultWithError,
    ChannelSummary,
    SpectrogramData,
    SpectrogramSettings,
    WaveformEnvelope,
} from '../../shared/analysis/analysisTypes';

declare const trackIdBrand: unique symbol;
export type TrackId = string & { readonly [trackIdBrand]: true };

export interface ComparisonTrackState extends AnalysisResultWithError {
    reportSourcePath?: string;
    trackId?: TrackId;
    audioSource?: string;
}

export interface ComparisonResultsState {
    mode: 'results';
    results: ComparisonTrackState[];
    spectrogramSettings: SpectrogramSettings;
}

export interface DirectorySelectionState {
    mode: 'directory-selection';
    results: ComparisonTrackState[];
    rootPath: string;
    allFilePaths: string[];
    selectedFilePaths: string[];
    pythonEnvironmentState: PythonEnvironmentState;
    spectrogramSettings: SpectrogramSettings;
    /** Opens the entry table on `allFilePaths` before the lane view. */
    entry?: boolean;
}

export interface PythonEnvironmentState {
    pythonCommand: string;
    status: 'normal' | 'warning';
    tooltip: string;
}

export type ComparisonState = ComparisonResultsState | DirectorySelectionState;

export interface PersistedWebviewState {
    /** The waveform's share of a lane's height; the spectrogram under it takes the rest. */
    waveShare?: number;
    spectrumBandsPerOctave?: 0 | 1 | 3;
    /** The track lanes share one amplitude scale, colour scale and frequency range. */
    linkScales?: boolean;
    sidebarCollapsed?: boolean;
    spectrumCollapsed?: boolean;
    /** Entry table slots 0–3 by file path. */
    entrySlots?: (string | null)[];
    /** Differences fixed while comparing (D), shown as derived rows of the entry table. */
    entryDerived?: import('./entryTable').DerivedRow[];
    /** The scan Recipe as edited in the step bar; read back with a warning if it no longer parses. */
    entryRecipe?: unknown;
    /** The attribute CSV picked on the entry table (name and text), when small enough to keep. */
    entryCsv?: { name: string; text: string };
}

export interface WebviewHostApi {
    downloadFile?(content: string, name: string, mimeType: string): void;
    releaseSource?(filePath: string): void;
    onMessage?(listener: (message: unknown) => void): () => void;
    postMessage(message: unknown): void;
    getState(): PersistedWebviewState | undefined;
    setState(state: PersistedWebviewState): void;
    /** Replaces the results pane's empty-state text while the selection panel lists nothing. */
    emptyMessage?: string;
    /** Shows the selection panel from the start; the host fills it with `directory-selection` messages. */
    selectionPanel?: boolean;
}

export interface ComparisonBootstrap {
    state: ComparisonState;
    strings: UiStrings;
    host: WebviewHostApi;
    window: RuntimeWindow;
    document: Document;
}

export interface UiSmokeState {
    [key: string]: unknown;
}

export interface RuntimeWindow extends Omit<Window, 'addEventListener' | 'removeEventListener'> {
    ResizeObserver: typeof ResizeObserver;
    __uiSmokeState?: UiSmokeState;
    /** Set by a page the tests open: the runtime then publishes its rendered UI (`comparison-panel-test-snapshot`). */
    __AWA_TEST_HOOKS__?: boolean;
    renderWaveformPipeline?: (
        context: CanvasRenderingContext2D,
        width: number,
        height: number,
        waveform: WaveformEnvelope,
        options: Record<string, unknown>,
    ) => void;
    paintLoopRegion?: (
        context: CanvasRenderingContext2D,
        width: number,
        height: number,
        startNorm: number,
        endNorm: number,
        zoomStart: number,
        zoomEnd: number,
    ) => void;
    addEventListener<K extends keyof WindowEventMap>(
        type: K,
        listener: (event: WindowEventMap[K]) => void,
        options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener<K extends keyof WindowEventMap>(type: K, listener: (event: WindowEventMap[K]) => void): void;
}

export interface TrackRuntimeState {
    muted?: boolean;
    offsetSeconds: number;
    hidden: boolean;
    defaultColor: string;
}

export interface SpectrumSlice {
    values: number[];
    frequencyBins: number;
    maxFrequencyHz: number;
    minDb: number;
    maxDb: number;
    unit?: string;
    axisLabel?: string;
    cursorNorm?: number;
    channelIndex?: number;
    settingsSignature?: string;
    originalMaxFrequencyHz?: number;
    /** Octave-band slices only: one value per band centre, drawn on a log axis from minFrequencyHz. */
    bandsPerOctave?: number;
    bandCentersHz?: number[];
    minFrequencyHz?: number;
    /** Track-normalized span of the samples the backend actually transformed; may extend past 0..1 where frames are padded. */
    windowStartNorm?: number;
    windowEndNorm?: number;
    window?: string;
}

export interface WaveformRangeCache {
    startNorm: number;
    endNorm: number;
    channels: RangeWaveform[];
}

export interface RangeWaveform extends WaveformEnvelope {
    minT?: number[];
    maxT?: number[];
}

export interface LazyRequestState {
    trackId: TrackId;
    requestId: string;
    analysisId: string;
    settingsSignature: string;
    channelIndex?: number;
    cursorNorm?: number;
}

export interface DragPoint {
    freqNorm: number;
    dbNorm: number;
}

export interface LoopRegion {
    start: number;
    end: number;
}

export interface RectZoomSelection {
    trackId: TrackId;
    startNorm: number;
    endNorm: number;
    startAmpNorm: number;
    endAmpNorm: number;
}

export interface WaveformDragState {
    trackId: TrackId;
    /** The pressed canvas: the lane's waveform or its spectrogram, whose time spans differ in width. */
    canvasId: string;
    startClientX: number;
    startClientY: number;
    startOffset: number;
    canvasWidth: number;
    canvasHeight: number;
    isDrag: boolean;
    isShift: boolean;
    startNorm: number;
    startAmpNorm: number;
    dragType: 'offset' | 'rectZoom' | 'loop' | 'gripStart' | 'gripEnd';
}

export interface WaveformCoverage {
    minX: number;
    maxX: number;
    canvasWidth: number;
    coversLeft: boolean;
    coversRight: boolean;
}

export interface TimelineSpan {
    startSec: number;
    endSec: number;
    spanSec: number;
}

export interface TrackFileView {
    trackStart: number;
    trackDurRatio: number;
    fileAtZoomStart: number;
    fileAtZoomEnd: number;
}

export interface SpectrumSeries {
    slice: SpectrumSlice;
    color: string;
    index: number;
    channelIndex: number;
    label: string;
}

export interface SpectrumSnap {
    binIdx: number;
    freqHz: number;
    x: number;
    dbVal: number | undefined;
    y: number | null;
}

export interface WaveformDrawOptions {
    clear?: boolean;
    drawCursor?: boolean;
}

export interface CanvasSyncOptions {
    syncStyle?: boolean;
}

export interface TestAction {
    action: string;
    trackId?: string;
    trackIndex?: number;
    payload?: Record<string, unknown>;
}

export interface RuntimeAnalysisChannel extends ChannelSummary {
    waveform: WaveformEnvelope;
    spectrogram: SpectrogramData | null;
}
