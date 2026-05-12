export interface FrequencyPeak {
    frequencyHz: number;
    magnitude: number;
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