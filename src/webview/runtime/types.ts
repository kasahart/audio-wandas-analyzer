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
}

export interface PythonEnvironmentState {
    pythonCommand: string;
    status: 'normal' | 'warning';
    tooltip: string;
}

export type ComparisonState = ComparisonResultsState | DirectorySelectionState;

export interface PersistedWebviewState {
    contentType?: 'waveform' | 'spectrogram';
    directoryCollapseRootPath?: string;
    directoryCollapseState?: Record<string, boolean>;
    treeFilterRootPath?: string;
    treeFilterQuery?: string;
}

export interface WebviewHostApi {
    postMessage(message: unknown): void;
    getState(): PersistedWebviewState | undefined;
    setState(state: PersistedWebviewState): void;
}

export interface ComparisonBootstrap {
    state: ComparisonState;
    strings: UiStrings;
    host: WebviewHostApi;
    window: RuntimeWindow;
    document: RuntimeDocument;
}

export interface RuntimeElement extends HTMLElement {
    checked: boolean;
    currentTime: number;
    disabled: boolean;
    download: string;
    duration: number;
    ended: boolean;
    height: number;
    href: string;
    max: string;
    min: string;
    muted: boolean;
    paused: boolean;
    parentNode: RuntimeElement;
    placeholder: string;
    playbackRate: number;
    step: string;
    type: string;
    value: string;
    width: number;
    getContext(contextId: '2d'): CanvasRenderingContext2D;
    getAttribute(qualifiedName: string): string;
    pause(): void;
    play(): Promise<void>;
    select(): void;
    toDataURL(type?: string): string;
    closest(selectors: string): RuntimeElement;
    querySelector(selectors: string): RuntimeElement;
    querySelectorAll(selectors: string): NodeListOf<RuntimeElement>;
    open: boolean;
}

export interface RuntimeDocument extends Omit<Document,
    'activeElement' | 'addEventListener' | 'body' | 'createElement' | 'getElementById' | 'querySelector' | 'querySelectorAll'> {
    activeElement: RuntimeElement;
    body: RuntimeElement;
    createElement(tagName: string): RuntimeElement;
    getElementById(elementId: string): RuntimeElement;
    querySelector(selectors: string): RuntimeElement;
    querySelectorAll(selectors: string): NodeListOf<RuntimeElement>;
    addEventListener<K extends keyof DocumentEventMap>(
        type: K,
        listener: (event: RuntimeEvent<DocumentEventMap[K]>) => void,
        options?: boolean | AddEventListenerOptions,
    ): void;
}

export type RuntimeEvent<T extends Event = Event> = T & { readonly target: RuntimeElement };

export interface UiSmokeState {
    [key: string]: unknown;
}

export interface RuntimeWindow extends Omit<Window, 'addEventListener' | 'removeEventListener'> {
    ResizeObserver: typeof ResizeObserver;
    __AWA_ACTIVE_TRACKS__?: () => Array<{ trackIndex: number; result: ComparisonTrackState }>;
    __AWA_SPECTROGRAM_SETTINGS__?: SpectrogramSettings;
    __uiSmokeState?: UiSmokeState;
    __treeFilterFlush?: () => void;
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
    drawWaveformAmplitudeAxis?: (
        context: CanvasRenderingContext2D,
        width: number,
        height: number,
        labels: Record<string, unknown>,
        theme?: Record<string, string>,
    ) => void;
    drawSpectrogramAxes?: (...args: unknown[]) => void;
    drawSpectrumLine?: (...args: unknown[]) => void;
    drawSpectrumAxes?: (...args: unknown[]) => void;
    addEventListener<K extends keyof WindowEventMap>(
        type: K,
        listener: (event: WindowEventMap[K]) => void,
        options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener<K extends keyof WindowEventMap>(type: K, listener: (event: WindowEventMap[K]) => void): void;
}

export interface SelectionTreeNode {
    type: 'directory' | 'file';
    name: string;
    relativePath: string;
    filePath?: string;
    children?: SelectionTreeNode[];
}

export interface TrackRuntimeState {
    offsetSeconds: number;
    hidden: boolean;
    color: string | null;
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
