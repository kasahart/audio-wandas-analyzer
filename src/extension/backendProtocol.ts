import type {
    AnalysisResult,
    AnalysisUnits,
    ChannelSummary,
    DbScaleMetadata,
    SpectrogramData,
    StftOptions,
    WaveformEnvelope,
} from '../shared/analysis/analysisTypes';

export interface AnalyzePayload {
    filePath: string;
    peakCount: number;
    stftOptions?: StftOptions;
}

export interface RangePayload {
    filePath: string;
    startNorm: number;
    endNorm: number;
    points: number;
}

export interface TrackDetailPayload {
    filePath: string;
    trackIndex: number;
    analysisId: string;
    settingsSignature: string;
    stftOptions?: StftOptions;
}

export interface SpectrumSlicePayload extends TrackDetailPayload {
    cursorNorm: number;
    channelIndex: number;
}

export interface ReleaseTrackDetailPayload {
    filePath: string;
}

export interface ExportWavLoopPayload {
    filePath: string;
    startNorm: number;
    endNorm: number;
}

export interface RangeResult {
    startNorm: number;
    endNorm: number;
    channels: WaveformEnvelope[];
}

export interface TrackDetailResult {
    trackIndex: number;
    analysisId: string;
    settingsSignature: string;
    filePath: string;
    channels: ChannelSummary[];
}

export interface SpectrumSliceResult {
    trackIndex: number;
    channelIndex: number;
    analysisId: string;
    settingsSignature: string;
    filePath: string;
    values: number[];
    frequencyBins: number;
    maxFrequencyHz: number;
    minDb: number;
    maxDb: number;
    unit?: string;
    axisLabel?: string;
}

export interface ExportWavLoopResult {
    wavBase64: string;
    sampleRate: number;
}

export type ReleaseTrackDetailResult = Record<never, never>;

export interface BackendCommandMap {
    analyze: { payload: AnalyzePayload; result: AnalysisResult };
    range: { payload: RangePayload; result: RangeResult };
    'track-detail': { payload: TrackDetailPayload; result: TrackDetailResult };
    'release-track-detail': { payload: ReleaseTrackDetailPayload; result: ReleaseTrackDetailResult };
    'spectrum-slice': { payload: SpectrumSlicePayload; result: SpectrumSliceResult };
    'export-wav-loop': { payload: ExportWavLoopPayload; result: ExportWavLoopResult };
}

export const BACKEND_COMMANDS = [
    'analyze',
    'range',
    'track-detail',
    'release-track-detail',
    'spectrum-slice',
    'export-wav-loop',
] as const satisfies ReadonlyArray<keyof BackendCommandMap>;

export type BackendCommand = typeof BACKEND_COMMANDS[number];
export type BackendPayload<K extends BackendCommand> = BackendCommandMap[K]['payload'];
export type BackendResult<K extends BackendCommand> = BackendCommandMap[K]['result'];
export type BackendRequest<K extends BackendCommand> = { cmd: K; requestId: string } & BackendPayload<K>;
export type BackendSuccessEnvelope<K extends BackendCommand> = { requestId: string } & BackendResult<K>;

export interface BackendErrorEnvelope {
    requestId: string;
    error: string;
}

export interface BackendReadyNotification {
    type: 'ready';
}

export interface BackendHeartbeatNotification {
    type: 'heartbeat';
    ts: number;
}

export type BackendNotification = BackendReadyNotification | BackendHeartbeatNotification;
export type BackendResponseEnvelope<K extends BackendCommand> = BackendSuccessEnvelope<K> | BackendErrorEnvelope;
export type BackendEnvelope<K extends BackendCommand> = BackendNotification | BackendResponseEnvelope<K>;

export class BackendProtocolError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BackendProtocolError';
    }
}

export function isBackendCommand(value: unknown): value is BackendCommand {
    return typeof value === 'string' && BACKEND_COMMANDS.some((command) => command === value);
}

export function isJsonObject(value: unknown): value is { [key: string]: unknown } {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
    return isFiniteNumber(value) && Number.isInteger(value);
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

function isFiniteNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every(isFiniteNumber);
}

function isDbScaleMetadata(value: unknown): value is DbScaleMetadata {
    return isJsonObject(value)
        && typeof value['unit'] === 'string'
        && typeof value['axisLabel'] === 'string';
}

function isAnalysisUnits(value: unknown): value is AnalysisUnits {
    return isJsonObject(value)
        && isDbScaleMetadata(value['amplitudeLevel'])
        && isDbScaleMetadata(value['spectrumLevel'])
        && isDbScaleMetadata(value['spectrogramLevel']);
}

function isWaveformEnvelope(value: unknown): value is WaveformEnvelope {
    if (!isJsonObject(value)) { return false; }
    if (!isFiniteNumberArray(value['min'])
        || !isFiniteNumberArray(value['max'])
        || !isFiniteNumberArray(value['samples'])
        || !isFiniteNumber(value['absolutePeak'])) {
        return false;
    }
    const pointCount = value['min'].length;
    return value['max'].length === pointCount
        && value['samples'].length === pointCount
        && (value['minT'] === undefined
            || (isFiniteNumberArray(value['minT']) && value['minT'].length === pointCount))
        && (value['maxT'] === undefined
            || (isFiniteNumberArray(value['maxT']) && value['maxT'].length === pointCount));
}

function isSpectrogramData(value: unknown): value is SpectrogramData {
    if (!isJsonObject(value)
        || !Array.isArray(value['values'])
        || !value['values'].every(isFiniteNumberArray)) {
        return false;
    }
    return isInteger(value['timeBins'])
        && isInteger(value['frequencyBins'])
        && isInteger(value['windowSize'])
        && isInteger(value['hopSize'])
        && isFiniteNumber(value['maxFrequencyHz'])
        && isFiniteNumber(value['minDb'])
        && isFiniteNumber(value['maxDb'])
        && isOptionalString(value['unit'])
        && isOptionalString(value['axisLabel'])
        && value['values'].length === value['timeBins']
        && value['values'].every((row) => row.length === value['frequencyBins']);
}

function isFrequencyPeak(value: unknown): boolean {
    return isJsonObject(value)
        && isFiniteNumber(value['frequencyHz'])
        && isFiniteNumber(value['magnitude']);
}

function isSpectrumPeak(value: unknown): boolean {
    return isJsonObject(value)
        && isFiniteNumber(value['freqHz'])
        && isFiniteNumber(value['amplitudeDb']);
}

function isChannelSummary(value: unknown): value is ChannelSummary {
    if (!isJsonObject(value)
        || typeof value['label'] !== 'string'
        || !(value['unit'] === undefined || value['unit'] === null || typeof value['unit'] === 'string')
        || !isFiniteNumber(value['rms'])
        || !isFiniteNumber(value['peakAbsolute'])
        || !Array.isArray(value['dominantFrequencies'])
        || !value['dominantFrequencies'].every(isFrequencyPeak)
        || !isWaveformEnvelope(value['waveform'])) {
        return false;
    }
    if (value['peaks'] !== undefined
        && (!Array.isArray(value['peaks']) || !value['peaks'].every(isSpectrumPeak))) {
        return false;
    }
    return value['spectrogram'] === null || isSpectrogramData(value['spectrogram']);
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
    if (!isJsonObject(value)
        || typeof value['filePath'] !== 'string'
        || typeof value['fileName'] !== 'string'
        || !isFiniteNumber(value['sampleRateHz'])
        || !isFiniteNumber(value['durationSeconds'])
        || !isInteger(value['channelCount'])
        || !isInteger(value['sampleCount'])
        || !Array.isArray(value['channels'])
        || !value['channels'].every(isChannelSummary)) {
        return false;
    }
    return value['channels'].length === value['channelCount']
        && (value['units'] === undefined || isAnalysisUnits(value['units']));
}

function isRangeResult(value: unknown): value is RangeResult {
    return isJsonObject(value)
        && isFiniteNumber(value['startNorm'])
        && isFiniteNumber(value['endNorm'])
        && Array.isArray(value['channels'])
        && value['channels'].every(isWaveformEnvelope);
}

function isTrackDetailResult(value: unknown): value is TrackDetailResult {
    return isJsonObject(value)
        && isInteger(value['trackIndex'])
        && typeof value['analysisId'] === 'string'
        && typeof value['settingsSignature'] === 'string'
        && typeof value['filePath'] === 'string'
        && Array.isArray(value['channels'])
        && value['channels'].every(isChannelSummary);
}

function isSpectrumSliceResult(value: unknown): value is SpectrumSliceResult {
    return isJsonObject(value)
        && isInteger(value['trackIndex'])
        && isInteger(value['channelIndex'])
        && typeof value['analysisId'] === 'string'
        && typeof value['settingsSignature'] === 'string'
        && typeof value['filePath'] === 'string'
        && isFiniteNumberArray(value['values'])
        && isInteger(value['frequencyBins'])
        && isFiniteNumber(value['maxFrequencyHz'])
        && isFiniteNumber(value['minDb'])
        && isFiniteNumber(value['maxDb'])
        && isOptionalString(value['unit'])
        && isOptionalString(value['axisLabel'])
        && value['values'].length === value['frequencyBins'];
}

function isExportWavLoopResult(value: unknown): value is ExportWavLoopResult {
    return isJsonObject(value)
        && typeof value['wavBase64'] === 'string'
        && isInteger(value['sampleRate']);
}

type ResultValidator<K extends BackendCommand> = (value: unknown) => value is BackendResult<K>;

const RESULT_VALIDATORS: { [K in BackendCommand]: ResultValidator<K> } = {
    analyze: isAnalysisResult,
    range: isRangeResult,
    'track-detail': isTrackDetailResult,
    'release-track-detail': isJsonObject,
    'spectrum-slice': isSpectrumSliceResult,
    'export-wav-loop': isExportWavLoopResult,
};

export function parseBackendResult<K extends BackendCommand>(command: K, value: unknown): BackendResult<K> {
    const validator: ResultValidator<K> = RESULT_VALIDATORS[command];
    if (!validator(value)) {
        throw new BackendProtocolError(`Invalid ${command} success response`);
    }
    return value;
}

export function parseBackendNotification(value: unknown): BackendNotification | null {
    if (!isJsonObject(value)) { return null; }
    if (value['type'] === 'ready') { return { type: 'ready' }; }
    if (value['type'] === 'heartbeat' && isFiniteNumber(value['ts'])) {
        return { type: 'heartbeat', ts: value['ts'] };
    }
    return null;
}
