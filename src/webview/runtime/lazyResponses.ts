import type { ChannelSummary } from '../../shared/analysis/analysisTypes';
import type { LazyResponseIdentity } from './hostMessaging';
import type { LazyRequestState, PythonEnvironmentState, TrackId } from './types';

export const DEFAULT_PYTHON_ENVIRONMENT_STATE: PythonEnvironmentState = {
    pythonCommand: 'python3',
    status: 'normal',
    tooltip: 'Click to select Python environment',
};

export function pythonEnvironmentStateFromMessage(msg: { pythonCommand?: unknown; status?: unknown; tooltip?: unknown }): PythonEnvironmentState {
    return {
        pythonCommand: typeof msg.pythonCommand === 'string' ? msg.pythonCommand : DEFAULT_PYTHON_ENVIRONMENT_STATE.pythonCommand,
        status: msg.status === 'warning' ? 'warning' : 'normal',
        tooltip: typeof msg.tooltip === 'string' ? msg.tooltip : DEFAULT_PYTHON_ENVIRONMENT_STATE.tooltip,
    };
}

// A response is only applied when it answers the exact outstanding request:
// a newer request, a re-analysis or a settings change all make it stale.
export function isResponseToLazyRequest(
    pending: LazyRequestState | null | undefined,
    trackId: TrackId,
    response: Pick<LazyResponseIdentity, 'requestId' | 'analysisId' | 'settingsSignature'>,
): pending is LazyRequestState {
    return !!pending
        && pending.trackId === trackId
        && pending.requestId === response.requestId
        && pending.analysisId === response.analysisId
        && pending.settingsSignature === response.settingsSignature;
}

/**
 * Whether a lane's lazy answer (range, detail, zoom window, slice, read, or their failure) is of the analysis its
 * track shows: of the same file version (the request named the track's sourceVersion and the backend answers only of
 * it) and, for a spectral answer, of the same STFT (stftSignature: the backend names the STFT it computed with, never
 * the settingsSignature the request carried, which it only echoes). So an answer of another version, or one computed
 * with the new settings while the old analysis is still drawn, is never drawn or read over it. A track with no
 * version (a host that gives none) takes any version.
 */
export function isOfShownVersion(shown: { sourceVersion?: string; stftSignature?: string }, answer: { sourceVersion?: string; stftSignature?: string }): boolean {
    return (shown.sourceVersion === undefined || answer.sourceVersion === shown.sourceVersion)
        && (shown.stftSignature === undefined || answer.stftSignature === undefined || answer.stftSignature === shown.stftSignature);
}

export function mergeDetailSpectrograms(target: ChannelSummary[], incoming: ChannelSummary[]): void {
    incoming.forEach(function (channel, channelIndex) {
        if (!target[channelIndex]) {
            return;
        }
        if (channel && channel.spectrogram) {
            target[channelIndex].spectrogram = channel.spectrogram;
        }
    });
}
