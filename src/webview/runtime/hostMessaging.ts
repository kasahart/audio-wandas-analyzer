import type { PanelMessage } from '../../shared/protocol/panelMessages';
import type {
    AnalysisUpdateMessage,
} from '../../shared/analysis/analysisTypes';
import type { PairSpectrumPublication, RegionPeakPublication } from '../../shared/session/comparisonSessionController';
import { isEntryConditionTable, type ComparePublication, type EntryProbePublication, type EntryPublication } from '../../shared/analysis/entryScan';
import { parseBackendResult } from '../../shared/protocol/backendProtocol';
import { isFigureCommand, type FigureResultMessage } from '../../shared/protocol/figureMessages';
import type { RuntimeWindow, WebviewHostApi } from './types';

export type HostOutboundMessage = PanelMessage
    | { type: 'comparison-panel-test-snapshot'; actionId?: string; renderedUi: Record<string, unknown> };

export interface LazyResponseIdentity {
    requestId: string;
    analysisId: string;
    settingsSignature: string;
    trackIndex: number;
    filePath: string;
    /** The version of the file the answer is of (the backend's sourceVersion): drawn only over a track of the same. */
    sourceVersion?: string;
    /** A failure because the file changed on disk since the track was analysed: asking again cannot mend it. */
    staleSource?: true;
    /** The STFT the answer was taken with (the backend's, not the settingsSignature it echoes): drawn only over an analysis of it. */
    stftSignature?: string;
}

export type HostInboundMessage =
    | (LazyResponseIdentity & { type: 'track-detail-error'; error: string })
    | (LazyResponseIdentity & { type: 'spectrum-slice-error'; error: string })
    | (LazyResponseIdentity & {
        /**
         * A Tracks row's answers of one track, kept by key for the figure service (asked by a `request-track-detail`
         * with `answers`): each channel's kept samples (`signal`) and kept STFT levels (`image`), what its levels are
         * in, and the STFT they are of. No value of a lane is carried; a failure is a `track-detail-error`.
         */
        type: 'track-answers-result';
        scale: 'log' | 'linear';
        /** The time window asked for (absent: the whole file). */
        startNorm?: number;
        endNorm?: number;
        /** `signalExtent`, `imageExtent`: the keys of the channel's extents, which the other rows' lanes share their scale with. */
        channels: Array<{ channelIndex: number; level: { unit: string; ref: number; label: string }; unit: string; signal?: string; image?: string; signalExtent?: string; imageExtent?: string }>;
        sampleRateHz: number;
        durationSeconds: number;
        windowSize: number;
        hopSize: number;
        /** The levels are of the time window's own STFT (the automatic settings, R3). */
        windowed: boolean;
        /** Why no channel names levels though they were asked for: the recording is shorter than half the STFT's window. */
        noLevels?: 'too-short';
    })
    | (LazyResponseIdentity & {
        /**
         * The cursor spectrum's answers of one track, kept by key for the figure service (asked by a
         * `request-spectrum-slice`): each channel's kept line, what its levels are in, and the window
         * the answers are of. No value of a line is carried; a failure is a `spectrum-slice-error`.
         */
        type: 'cursor-answers-result';
        cursorNorm: number;
        scale: 'log' | 'linear';
        channels: Array<{ channelIndex: number; level: { unit: string; ref: number; label: string }; key?: string }>;
        windowStartNorm: number;
        windowEndNorm: number;
        window: string;
        bandsPerOctave?: number;
    })
    | PairSpectrumPublication
    | RegionPeakPublication
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
    | EntryProbePublication
    | ComparePublication
    | FigureResultMessage
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

/** One response of a `pair-answers-result`: its three kept lines' keys when it has lines (status "ok" and the store kept them). */
function isPairAnswer(value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    const keys = value.keys;
    return hasString(value, 'filePath') && hasIndex(value, 'channelIndex')
        && (value.status === 'ok' || value.status === 'no-overlap' || value.status === 'too-short')
        && hasNumber(value, 'startSeconds') && hasNumber(value, 'endSeconds') && hasIndex(value, 'averages')
        && typeof value.resampled === 'boolean'
        && (keys === undefined || (isRecord(keys) && hasString(keys, 'gain') && hasString(keys, 'phase') && hasString(keys, 'coherence')));
}

export function isHostInboundMessage(value: unknown): value is HostInboundMessage {
    if (!isRecord(value) || typeof value.type !== 'string') {
        return false;
    }
    if (value.sourceVersion !== undefined && typeof value.sourceVersion !== 'string') return false;
    if (value.staleSource !== undefined && value.staleSource !== true) return false;
    if (value.stftSignature !== undefined && typeof value.stftSignature !== 'string') return false;
    switch (value.type) {
        case 'track-detail-error':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasNumber(value, 'trackIndex')
                && hasString(value, 'filePath') && hasString(value, 'error');
        case 'spectrum-slice-error':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasNumber(value, 'trackIndex')
                && hasString(value, 'filePath') && hasString(value, 'error');
        case 'track-answers-result':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasNumber(value, 'trackIndex')
                && hasString(value, 'filePath') && (value.scale === 'log' || value.scale === 'linear')
                && hasNumber(value, 'sampleRateHz') && hasNumber(value, 'durationSeconds')
                && hasNumber(value, 'windowSize') && hasNumber(value, 'hopSize') && typeof value.windowed === 'boolean'
                && (value.startNorm === undefined && value.endNorm === undefined || hasNumber(value, 'startNorm') && hasNumber(value, 'endNorm'))
                && Array.isArray(value.channels)
                && value.channels.every((channel) => isRecord(channel) && hasNumber(channel, 'channelIndex') && typeof channel.unit === 'string'
                    && isRecord(channel.level) && hasString(channel.level, 'unit') && hasNumber(channel.level, 'ref') && hasString(channel.level, 'label')
                    && (channel.signal === undefined || typeof channel.signal === 'string')
                    && (channel.image === undefined || typeof channel.image === 'string'));
        case 'cursor-answers-result':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasNumber(value, 'trackIndex')
                && hasString(value, 'filePath') && hasNumber(value, 'cursorNorm')
                && (value.scale === 'log' || value.scale === 'linear')
                && hasNumber(value, 'windowStartNorm') && hasNumber(value, 'windowEndNorm') && hasString(value, 'window')
                && Array.isArray(value.channels)
                && value.channels.every((channel) => isRecord(channel) && hasNumber(channel, 'channelIndex')
                    && isRecord(channel.level) && hasString(channel.level, 'unit') && hasNumber(channel.level, 'ref') && hasString(channel.level, 'label')
                    && (channel.key === undefined || typeof channel.key === 'string'));
        case 'region-peak-result':
            return hasString(value, 'requestId') && hasNumber(value, 'peak');
        case 'region-peak-error':
            return hasString(value, 'requestId') && hasString(value, 'error');
        case 'pair-spectrum-error':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasString(value, 'error');
        case 'pair-answers-result':
            return hasString(value, 'requestId') && hasString(value, 'analysisId')
                && hasString(value, 'settingsSignature') && hasString(value, 'filePath')
                && hasIndex(value, 'channelIndex') && hasIndex(value, 'nFft') && hasIndex(value, 'hopLength')
                && Array.isArray(value.responses) && value.responses.every(isPairAnswer);
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
            return hasString(value, 'requestId') && (value.table === null || isEntryConditionTable(value.table))
                && (value.session === undefined || (!!value.session && typeof value.session === 'object' && !Array.isArray(value.session)))
                && (value.csv === undefined || (!!value.csv && typeof value.csv === 'object' && typeof (value.csv as Record<string, unknown>).name === 'string' && typeof (value.csv as Record<string, unknown>).text === 'string'));
        case 'entry-probe-result':
            return hasString(value, 'requestId') && hasString(value, 'filePath')
                && (value.channels === undefined || (typeof value.channels === 'number' && Number.isInteger(value.channels) && value.channels > 0))
                && (value.durationS === undefined || (typeof value.durationS === 'number' && Number.isFinite(value.durationS) && value.durationS >= 0))
                && (value.sampleRate === undefined || (typeof value.sampleRate === 'number' && Number.isFinite(value.sampleRate) && value.sampleRate > 0))
                && (value.calibrated === undefined || typeof value.calibrated === 'boolean')
                && (value.error === undefined || typeof value.error === 'string');
        case 'entry-calibration-changed':
            return hasString(value, 'filePath') && (value.calibrated === undefined || typeof value.calibrated === 'boolean');
        case 'entry-source-changed':
            return hasString(value, 'filePath');
        case 'entry-probe-done':
        case 'compare-scan-done':
            return hasString(value, 'requestId');
        case 'compare-scan-result':
            if (!hasString(value, 'requestId') || !hasString(value, 'filePath')) return false;
            try { parseBackendResult('scan', value.result); return true; } catch { return false; }
        case 'figure-result': {
            // The figure service's answer, checked against the protocol before answers/ sees it; a failure says why.
            if (!hasString(value, 'requestId') || !isFigureCommand(value.command)) return false;
            if (typeof value.failed === 'string') return value.result === undefined;
            try { parseBackendResult(value.command, value.result); return true; } catch { return false; }
        }
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
        /** Told of every message posted to the host (spec 4's long computations begin there: answers/longComputations.ts). */
        private readonly posted?: (message: HostOutboundMessage) => void,
    ) {}

    post(message: HostOutboundMessage): void {
        this.posted?.(message);
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
