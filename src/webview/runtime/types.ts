import type { FullSource } from './fullRead';
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
    /** Loads short synthetic recordings to try the app with; offered on the empty view while nothing is listed. */
    openSamples?(): void;
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
    offsetSeconds: number;
    hidden: boolean;
    /** Which own colour (roleColors.ownColor) the recording has without a role: given by the TrackStore, kept while the track stays. */
    ownColorIndex?: number;
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
    /** FFT slices cut for display only: each point's frequency. Absent when values holds every FFT bin. */
    frequenciesHz?: number[];
    /** Track-normalized span of the samples the backend actually transformed; may extend past 0..1 where frames are padded. */
    windowStartNorm?: number;
    windowEndNorm?: number;
    window?: string;
    /** The slice's own range (the backend's extremes), kept when a typed spectrogram dB range replaced minDb/maxDb. */
    autoMinDb?: number;
    autoMaxDb?: number;
    /** The ends of minDb/maxDb typed in the spectrogram settings: kept exactly; the other ends follow the dB line rule (spectrumLevelRange). */
    typedDb?: { min?: number; max?: number };
    /** Drawn in place of a slice the backend has not given (cursorSpectrum.ts): no number is read of it (R7). */
    standIn?: SpectrumStandIn;
}

/**
 * What a cursor spectrum draws when it has no slice of the backend's: 'pending', the lane's display spectrogram's
 * column (cells power-averaged to draw) while the slice is on its way; 'silence', the floor past the track's end.
 */
export type SpectrumStandIn = 'pending' | 'silence';

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
    /** Cursor-spectrum requests: every FFT bin was asked for, not the row cut for display. */
    fullResolution?: boolean;
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
    /** A box on a spectrogram lane: its ends up the axis are fractions of the frequency band shown, not amplitudes. */
    frequency?: boolean;
}

/** A press on a lane: where it started, and the drag of its own it became under Alt or Shift (null: none, a box zoom or a click). */
export interface WaveformDragState {
    trackId: TrackId;
    /** The pressed canvas: the lane's waveform or its spectrogram, whose time spans differ in width. */
    canvasId: string;
    startClientX: number;
    startOffset: number;
    canvasWidth: number;
    startNorm: number;
    dragType: 'offset' | 'loop' | 'gripStart' | 'gripEnd' | null;
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
    /** A slice cut for display: where its every bin is read (R7, laneReads.slice). */
    full?: FullSource;
    /** Its recording's level identity, where known: lines share a level axis only by it and their slices' own reference (levelGrouping). */
    level?: { unit?: string; ref?: number; levelReferenceLabel?: string };
}

export interface WaveformDrawOptions {
    /** false: the amplitude axis beside the lane is left as drawn (it does not follow the cursor). */
    drawAxis?: boolean;
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
