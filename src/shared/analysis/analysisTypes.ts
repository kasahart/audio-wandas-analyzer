export interface FrequencyPeak {
    frequencyHz: number;
    magnitude: number;
}

export interface SpectrumPeak {
    freq_hz: number;
    amplitude_db: number;
}

export interface WaveformEnvelope {
    min: number[];
    max: number[];
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
}

export interface ChannelSummary {
    label: string;
    rms: number;
    peakAbsolute: number;
    dominantFrequencies: FrequencyPeak[];
    peaks?: SpectrumPeak[];
    waveform: WaveformEnvelope;
    spectrogram: SpectrogramData;
}

export interface AnalysisResult {
    filePath: string;
    fileName: string;
    sampleRateHz: number;
    durationSeconds: number;
    channelCount: number;
    sampleCount: number;
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

export interface UpdateSpectrogramSettingsMessage {
    type: 'update-spectrogram-settings';
    settings: SpectrogramSettings;
}

export interface AnalysisUpdateMessage {
    type: 'analysis-update';
    results: AnalysisResultWithError[];
}