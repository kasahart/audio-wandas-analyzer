import type {
    AnalysisResult,
    AnalysisUnits,
    ChannelMeasurementContext,
    ChannelSummary,
    DbScaleMetadata,
    SpectrogramData,
    StftOptions,
    WaveformEnvelope,
} from '../protocol/generated/backendProtocolSchema';

export type {
    AnalysisResult,
    AnalysisUnits,
    ChannelMeasurementContext,
    ChannelSummary,
    DbScaleMetadata,
    SpectrogramData,
    StftOptions,
    WaveformEnvelope,
};

export type CalibrationStatus = 'uncalibrated' | 'calibrated';
export type CalibrationSource = 'default' | 'manual' | 'derived' | 'embedded';

// Profile scalars must remain finite through persistence and IPC. The backend also
// constrains factor against each source channel before applying calibration.
export const MIN_SAFE_CALIBRATION_VALUE = 1e-150;
export const MAX_SAFE_CALIBRATION_VALUE = 1e150;
// Keeps a 16384-point STFT below the float32 range used by the spectrogram cache.
export const MAX_SAFE_CALIBRATED_SAMPLE = 1e34;

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

export type StftWindow = StftOptions['window'];

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

export const STFT_OVERLAP_PERCENT_OPTIONS: readonly number[] = [50, 67, 75];

export const DEFAULT_SPECTROGRAM_SETTINGS: SpectrogramSettings = {
    auto: true,
    stft: { nFft: 1024, overlapPercent: 75, window: 'hann' },
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
    selectedFilePaths?: string[];
}
