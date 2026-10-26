import type { PanelMessage } from '../../shared/protocol/panelMessages';
import type {
    AnalysisUpdateMessage,
    ChannelSummary,
} from '../../shared/analysis/analysisTypes';
import type { PairSpectrumPublication } from '../../shared/session/comparisonSessionController';
import { isEntryConditionTable, type ComparePublication, type EntryPublication } from '../../shared/analysis/entryScan';
import { parseBackendResult } from '../../shared/protocol/backendProtocol';
import type { RangeWaveform, RuntimeWindow, WebviewHostApi } from './types';

export type HostOutboundMessage = PanelMessage
    | { type: 'comparison-panel-test-snapshot'; actionId?: string; renderedUi: Record<string, unknown> };

export interface LazyResponseIdentity {
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
        channels: Array<{
            channelIndex: number;
            values: number[];
            minDb: number;
            maxDb: number;
            unit?: string;
            axisLabel?: string;
        }>;
        frequencyBins: number;
        maxFrequencyHz: number;
        bandsPerOctave?: number;
        bandCentersHz?: number[];
        minFrequencyHz?: number;
        windowStartNorm?: number;
        windowEndNorm?: number;
        window?: string;
        computeMs?: number;
    })
    | (LazyResponseIdentity & { type: 'spectrum-slice-error'; error: string })
    | PairSpectrumPublication
    | { type: 'python-environment-state'; pythonCommand: string; status: string; tooltip: string }
    | {
        type: 'comparison-panel-test-action';
        actionId?: string;
        actions?: Array<string | { action: string; trackId?: string; trackIndex?: number; payload?: Record<string, unknown> }>;
        inputValues?: Record<string, string | number>;
    }
    | { type: 'reanalyze-start'; count: number }
    | { type: 'reanalyze-end' }
    | { type: 'analysis-file-progress'; current: number; total: number; fileName: string }
    /** Lists a newly picked folder in the selection tree; no files leaves the tree for the plain results layout. `entry` opens the entry table on it. */
    | { type: 'directory-selection'; rootPath: string; rootLabel?: string; filePaths: string[]; entry?: boolean }
    | EntryPublication
    | ComparePublication
    | AnalysisUpdateMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

function hasString(value: Record<string, unknown>, key: string): boolean {
    return typeof value[key] === 'string';
}

function hasNumber(value: Record<string, unknown>, key: string): boolean {
    return typeof value[key] === 'number' && Number.isFinite(value[key]);
}

function hasIndex(value: Record<string, unknown>, key: string): boolean {
    return Number.isInteger(value[key]) && (value[key] as number) >= 0;
}

function isNullableNumberArray(value: unknown, length: number): boolean {
    return Array.isArray(value) && value.length === length
        && value.every(item => item === null || (typeof item === 'number' && Number.isFinite(item)));
}

function isPairResponse(value: unknown, frequencyBins: number): boolean {
    if (!isRecord(value)) {
        return false;
    }
    const length = value.status === 'ok' ? frequencyBins : 0;
    return hasString(value, 'filePath') && hasIndex(value, 'channelIndex')
        && (value.status === 'ok' || value.status === 'no-overlap' || value.status === 'too-short')
        && hasNumber(value, 'startSeconds') && hasNumber(value, 'endSeconds') && hasIndex(value, 'averages')
        && typeof value.resampled === 'boolean' && hasString(value, 'unit') && hasString(value, 'axisLabel')
        && isNullableNumberArray(value.gainDb, length) && isNullableNumberArray(value.phaseRad, length)
        && isNullableNumberArray(value.coherence, length);
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
                && hasString(value, 'filePath') && hasString(value, 'error');
        case 'spectrum-slice-result':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasNumber(value, 'trackIndex')
                && hasString(value, 'filePath') && Array.isArray(value.channels)
                && value.channels.every((channel) => isRecord(channel)
                    && hasNumber(channel, 'channelIndex') && Array.isArray(channel.values)
                    && channel.values.length === value.frequencyBins
                    && channel.values.every((item) => typeof item === 'number' && Number.isFinite(item))
                    && hasNumber(channel, 'minDb') && hasNumber(channel, 'maxDb'))
                && hasNumber(value, 'frequencyBins') && hasNumber(value, 'maxFrequencyHz')
                && (value.bandCentersHz === undefined || ((value.bandsPerOctave === 1 || value.bandsPerOctave === 3)
                    && hasNumber(value, 'minFrequencyHz') && (value.minFrequencyHz as number) > 0
                    && Array.isArray(value.bandCentersHz) && value.bandCentersHz.length === value.frequencyBins
                    && value.bandCentersHz.every((item) => typeof item === 'number' && item > 0)))
                && (value.windowStartNorm === undefined || hasNumber(value, 'windowStartNorm'))
                && (value.windowEndNorm === undefined || hasNumber(value, 'windowEndNorm'))
                && (value.window === undefined || hasString(value, 'window'))
                && (value.computeMs === undefined || hasNumber(value, 'computeMs'));
        case 'pair-spectrum-error':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasString(value, 'error');
        case 'pair-spectrum-result':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasString(value, 'filePath')
                && hasIndex(value, 'channelIndex') && hasIndex(value, 'frequencyBins') && hasNumber(value, 'maxFrequencyHz')
                && hasIndex(value, 'nFft') && hasIndex(value, 'hopLength')
                && Array.isArray(value.responses) && value.responses.every(response => isPairResponse(response, value.frequencyBins as number));
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
        case 'directory-selection':
            return hasString(value, 'rootPath') && (value.rootLabel === undefined || typeof value.rootLabel === 'string')
                && Array.isArray(value.filePaths)
                && value.filePaths.every(path => typeof path === 'string')
                && (value.entry === undefined || typeof value.entry === 'boolean');
        case 'entry-conditions':
            return hasString(value, 'requestId') && (value.table === null || isEntryConditionTable(value.table));
        case 'entry-scan-result':
            if (!hasString(value, 'requestId') || !hasString(value, 'filePath')) return false;
            try { parseBackendResult('scan', value.result); return true; } catch { return false; }
        case 'entry-scan-done':
        case 'compare-scan-done':
            return hasString(value, 'requestId');
        case 'compare-scan-result':
            if (!hasString(value, 'requestId') || !hasString(value, 'filePath')) return false;
            try { parseBackendResult('scan', value.result); return true; } catch { return false; }
        case 'analysis-update':
            return Array.isArray(value.results) && (value.selectedFilePaths === undefined
                || Array.isArray(value.selectedFilePaths) && value.selectedFilePaths.every(path => typeof path === 'string'));
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

    downloadFile(content: string, name: string, mimeType: string): boolean {
        if (!this.host.downloadFile) return false;
        this.host.downloadFile(content, name, mimeType);
        return true;
    }

    releaseSource(filePath: string): void {
        this.host.releaseSource?.(filePath);
    }

    onMessage(listener: (message: HostInboundMessage) => void): () => void {
        const receive = (value: unknown): void => {
            if (isHostInboundMessage(value)) { listener(value); }
        };
        if (this.host.onMessage) { return this.host.onMessage(receive); }
        const handler = (event: MessageEvent<unknown>): void => { receive(event.data); };
        this.browserWindow.addEventListener('message', handler);
        return () => { this.browserWindow.removeEventListener('message', handler); };
    }
}
