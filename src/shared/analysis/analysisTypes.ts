export interface FrequencyPeak {
    frequencyHz: number;
    magnitude: number;
}

export interface SpectrumPeak {
    freqHz: number;
    /** @deprecated Use levelDb. */
    amplitudeDb: number;
    magnitude?: number;
    levelDb?: number;
}

export interface DbScaleMetadata {
    unit: string;
    axisLabel: string;
    referenceValue?: number;
    referenceUnit?: string;
    levelReferenceLabel?: string;
}

export interface AnalysisUnits {
    amplitudeLevel: DbScaleMetadata;
    spectrumLevel: DbScaleMetadata;
    spectrogramLevel: DbScaleMetadata;
}

export type CalibrationStatus = 'uncalibrated' | 'calibrated';
export type CalibrationSource = 'default' | 'manual' | 'derived' | 'embedded';

// Leaves headroom for RMS squaring and factor/reference ratios in IEEE-754 calculations.
export const MIN_SAFE_CALIBRATION_VALUE = 1e-150;
export const MAX_SAFE_CALIBRATION_VALUE = 1e150;

export function isSafeCalibrationValue(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && value >= MIN_SAFE_CALIBRATION_VALUE
        && value <= MAX_SAFE_CALIBRATION_VALUE;
}

export interface ChannelCalibrationDefinition {
    channelIndex: number;
    expectedLabel: string;
    status: CalibrationStatus;
    source: CalibrationSource;
    factor: number;
    unit: string;
    referenceValue: number;
}

export interface CalibrationProfile {
    schemaVersion: 1;
    channels: ChannelCalibrationDefinition[];
}

export interface ChannelMeasurementContext {
    calibrationStatus: CalibrationStatus;
    calibrationSource: CalibrationSource;
    factor: number;
    linearUnit: string;
    referenceValue: number;
    referenceUnit: string;
    levelUnit: string;
    levelReferenceLabel: string;
}

export interface WaveformEnvelope {
    min: number[];
    max: number[];
    minT?: number[];
    maxT?: number[];
    samples: number[];
    absolutePeak: number;
}

export interface SpectrogramData {
    values: number[][];
    timeBins: number;
    frequencyBins: number;
    windowSize: number;
    hopSize: number;
    maxFrequencyHz: number;
    minDb: number;
    maxDb: number;
    unit?: string;
    axisLabel?: string;
    referenceValue?: number;
    referenceUnit?: string;
    levelReferenceLabel?: string;
}

export interface ChannelSummary {
    label: string;
    unit?: string | null;
    rms: number;
    peakAbsolute: number;
    measurement?: ChannelMeasurementContext;
    rmsLevelDb?: number;
    peakLevelDb?: number;
    rawPeakFullScale?: number;
    clipped?: boolean;
    dominantFrequencies: FrequencyPeak[];
    peaks?: SpectrumPeak[];
    waveform: WaveformEnvelope;
    spectrogram: SpectrogramData | null;
}

export interface AnalysisResult {
    schemaVersion?: 2;
    filePath: string;
    fileName: string;
    sampleRateHz: number;
    durationSeconds: number;
    channelCount: number;
    sampleCount: number;
    calibrationSignature?: string;
    calibrationProfile?: CalibrationProfile;
    analysisRevision?: number;
    /** Compatibility metadata for results whose channels share one reference. */
    units?: AnalysisUnits;
    channels: ChannelSummary[];
}

export interface AnalysisResultWithError extends AnalysisResult {
    error?: string;
}

export interface DirectoryTreeNode {
    type: 'directory' | 'file';
    name: string;
    relativePath: string;
    filePath?: string;
    children?: DirectoryTreeNode[];
}

export type StftWindow = 'hann' | 'hamming' | 'blackman' | 'boxcar';

export interface StftOptions {
    nFft: number;
    hopSize: number;
    window: StftWindow;
}

export interface SpectrogramDisplaySettings {
    dbMin: number | null;
    dbMax: number | null;
    maxFrequencyHz: number | null;
}

export interface SpectrogramSettings {
    auto: boolean;
    stft: StftOptions;
    display: SpectrogramDisplaySettings;
}

export const DEFAULT_SPECTROGRAM_SETTINGS: SpectrogramSettings = {
    auto: true,
    stft: { nFft: 1024, hopSize: 256, window: 'hann' },
    display: { dbMin: null, dbMax: null, maxFrequencyHz: null },
};

export interface RequestReanalyzeMessage {
    type: 'request-reanalyze';
    settings: SpectrogramSettings;
}

export interface ComparisonPanelReadyMessage {
    type: 'comparison-panel-ready';
    calibrationRevisions: Array<{
        filePath: string;
        analysisRevision: number;
    }>;
}

export interface UpdateSpectrogramSettingsMessage {
    type: 'update-spectrogram-settings';
    settings: SpectrogramSettings;
}

export interface AnalysisUpdateMessage {
    type: 'analysis-update';
    results: AnalysisResultWithError[];
}
