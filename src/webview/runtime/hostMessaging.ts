import type {
    AnalysisResultWithError,
    ChannelSummary,
    SpectrogramSettings,
} from '../../shared/analysis/analysisTypes';
import type {
    AnalyzeSelectedFilesMessage,
    ExportReportOptionsMessage,
    ExportWavLoopMessage,
    SpectrumSliceRequest,
    TrackDetailReleaseMessage,
    TrackDetailRequest,
    WaveformRangeRequest,
} from '../../shared/utils/audioTarget';
import type { RangeWaveform, RuntimeWindow, WebviewHostApi } from './types';

export type HostOutboundMessage =
    | AnalyzeSelectedFilesMessage
    | ExportReportOptionsMessage
    | ExportWavLoopMessage
    | SpectrumSliceRequest
    | TrackDetailReleaseMessage
    | TrackDetailRequest
    | WaveformRangeRequest
    | { type: 'comparison-panel-test-snapshot'; actionId?: string; renderedUi: Record<string, unknown> }
    | { type: 'request-reanalyze'; settings: SpectrogramSettings }
    | { type: 'run-recipe' }
    | { type: 'select-python-environment' }
    | { type: 'select-target'; targetKind: 'file' | 'directory' }
    | { type: 'show-info'; message: string }
    | { type: 'update-spectrogram-settings'; settings: SpectrogramSettings };

interface LazyResponseIdentity {
    requestId: string;
    analysisId: string;
    settingsSignature: string;
    trackIndex: number;
    filePath: string;
}

export type HostInboundMessage =
    | {
        type: 'waveform-range-result';
        requestId: string;
        trackIndex: number;
        startNorm: number;
        endNorm: number;
        channels: RangeWaveform[];
    }
    | (LazyResponseIdentity & { type: 'track-detail-result'; channels: ChannelSummary[]; channelIndex?: number })
    | (LazyResponseIdentity & { type: 'track-detail-error'; error: string; channelIndex?: number })
    | (LazyResponseIdentity & {
        type: 'spectrum-slice-result';
        channelIndex: number;
        values: number[];
        frequencyBins: number;
        maxFrequencyHz: number;
        minDb: number;
        maxDb: number;
        unit?: string;
        axisLabel?: string;
    })
    | (LazyResponseIdentity & { type: 'spectrum-slice-error'; channelIndex: number; error: string })
    | { type: 'python-environment-state'; pythonCommand: string; status: string; tooltip: string }
    | {
        type: 'comparison-panel-test-action';
        actionId?: string;
        actions?: Array<string | { action: string; trackIndex?: number; payload?: Record<string, unknown> }>;
        inputValues?: Record<string, string | number>;
    }
    | { type: 'reanalyze-start'; count: number }
    | { type: 'reanalyze-end' }
    | { type: 'analysis-file-progress'; current: number; total: number; fileName: string }
    | { type: 'analysis-update'; results: AnalysisResultWithError[] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

function hasString(value: Record<string, unknown>, key: string): boolean {
    return typeof value[key] === 'string';
}

function hasNumber(value: Record<string, unknown>, key: string): boolean {
    return typeof value[key] === 'number' && Number.isFinite(value[key]);
}

export function isHostInboundMessage(value: unknown): value is HostInboundMessage {
    if (!isRecord(value) || typeof value.type !== 'string') {
        return false;
    }
    switch (value.type) {
        case 'waveform-range-result':
            return hasString(value, 'requestId') && hasNumber(value, 'trackIndex')
                && hasNumber(value, 'startNorm') && hasNumber(value, 'endNorm') && Array.isArray(value.channels);
        case 'track-detail-result':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasNumber(value, 'trackIndex')
                && hasString(value, 'filePath') && Array.isArray(value.channels);
        case 'track-detail-error':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasNumber(value, 'trackIndex')
                && hasString(value, 'filePath') && hasString(value, 'error');
        case 'spectrum-slice-error':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasNumber(value, 'trackIndex')
                && hasString(value, 'filePath') && hasNumber(value, 'channelIndex') && hasString(value, 'error');
        case 'spectrum-slice-result':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasNumber(value, 'trackIndex')
                && hasString(value, 'filePath') && hasNumber(value, 'channelIndex')
                && Array.isArray(value.values) && hasNumber(value, 'frequencyBins')
                && hasNumber(value, 'maxFrequencyHz') && hasNumber(value, 'minDb') && hasNumber(value, 'maxDb');
        case 'python-environment-state':
            return hasString(value, 'pythonCommand') && hasString(value, 'status') && hasString(value, 'tooltip');
        case 'comparison-panel-test-action':
            return (value.actions === undefined || Array.isArray(value.actions))
                && (value.inputValues === undefined || isRecord(value.inputValues));
        case 'reanalyze-start':
            return hasNumber(value, 'count');
        case 'reanalyze-end':
            return true;
        case 'analysis-file-progress':
            return hasNumber(value, 'current') && hasNumber(value, 'total') && hasString(value, 'fileName');
        case 'analysis-update':
            return Array.isArray(value.results);
        default:
            return false;
    }
}

export class HostMessenger {
    constructor(
        private readonly host: WebviewHostApi,
        private readonly browserWindow: RuntimeWindow,
    ) {}

    post(message: HostOutboundMessage): void {
        this.host.postMessage(message);
    }

    onMessage(listener: (message: HostInboundMessage) => void): () => void {
        const handler = (event: MessageEvent<unknown>): void => {
            if (isHostInboundMessage(event.data)) { listener(event.data); }
        };
        this.browserWindow.addEventListener('message', handler);
        return () => { this.browserWindow.removeEventListener('message', handler); };
    }
}
