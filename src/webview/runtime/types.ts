import type { UiStrings } from '../../shared/i18n/strings';
import type { AnalysisResultWithError, SpectrogramSettings } from '../../shared/analysis/analysisTypes';

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

/**
 * A track's cursor spectrum as the backend keeps it for the figure service (the reply to a slice request with
 * `answers`): each channel's kept line, what its levels are in, and the window the lines are of. No value of a line.
 */
export interface CursorAnswers {
    settingsSignature: string;
    /** Track-normalized cursor the backend transformed at. */
    cursorNorm: number;
    channels: ReadonlyArray<{ channelIndex: number; level: { unit: string; ref: number; label: string }; key?: string }>;
    /** Track-normalized span of the samples transformed; may extend past 0..1 where frames are padded. */
    windowStartNorm: number;
    windowEndNorm: number;
    window: string;
}

export interface LazyRequestState {
    trackId: TrackId;
    requestId: string;
    analysisId: string;
    settingsSignature: string;
    channelIndex?: number;
    cursorNorm?: number;
}

export interface LoopRegion {
    start: number;
    end: number;
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

export interface CanvasSyncOptions {
    syncStyle?: boolean;
}

export interface TestAction {
    action: string;
    trackId?: string;
    trackIndex?: number;
    payload?: Record<string, unknown>;
}

