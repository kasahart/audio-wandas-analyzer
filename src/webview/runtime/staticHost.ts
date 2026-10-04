import type { HostOutboundMessage, HostInboundMessage } from './hostMessaging';
import type { ComparisonWindow } from './browserAdapter';
import type { PersistedWebviewState } from './types';
import type { AnalysisResultWithError } from '../../shared/analysis/analysisTypes';

const browserWindow = window as unknown as ComparisonWindow;
let persisted: PersistedWebviewState | undefined;
let worker: Worker | undefined;
let nextId = 0;
let generation = 0;
let sourceUrl: string | undefined;
let sourcePath: string | undefined;
let sourceName = '';
let loading = false;
const pending = new Map<string, { resolve(value: Record<string, unknown>): void; reject(error: Error): void }>();
const bar = document.createElement('div');
bar.style.cssText = 'padding:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
const pick = document.createElement('input');
pick.setAttribute('data-action', 'browser-open-wav');
pick.type = 'file'; pick.accept = '.wav,audio/wav'; pick.setAttribute('aria-label', 'Open short WAV');
const cancel = document.createElement('button');
cancel.setAttribute('data-action', 'browser-clear');
cancel.textContent = 'Cancel / clear';
const status = document.createElement('span');
status.setAttribute('role', 'status');
status.textContent = 'Static prototype: WAV ≤16 MiB / 30s / 2ch. Recipes, WDF, psychoacoustics, directory scan and vscode.dev are unavailable. Audio stays in this browser.';
bar.append(pick, cancel, status);
document.body.prepend(bar);
const announce = (value: string): void => { status.textContent = value; };
const emit = (message: HostInboundMessage): void => { window.dispatchEvent(new MessageEvent('message', { data: message })); };

function dispose(): void {
    generation++;
    worker?.terminate(); worker = undefined;
    for (const request of pending.values()) request.reject(new Error('Analysis cancelled'));
    pending.clear();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = undefined; sourcePath = undefined;
    loading = false; pick.disabled = false;
}
function request(command: Record<string, unknown>, bytes?: ArrayBuffer): Promise<Record<string, unknown>> {
    if (!worker) {
        worker = new Worker('./audio.worker.js', { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ requestId: string; result?: Record<string, unknown>; error?: string }>): void => {
            const item = pending.get(event.data.requestId);
            if (!item) return;
            pending.delete(event.data.requestId);
            if (event.data.error) item.reject(new Error(event.data.error));
            else item.resolve(event.data.result!);
        };
        worker.onerror = (): void => {
            dispose(); announce('Audio Worker failed; select the WAV again.'); emit({ type: 'reanalyze-end' });
        };
    }
    const requestId = `browser-${++nextId}`;
    return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        worker!.postMessage({ ...command, requestId, bytes }, bytes ? [bytes] : []);
    });
}
function stft(): Record<string, unknown> {
    const state = browserWindow.__APP_STATE__!;
    return state.spectrogramSettings.auto ? {} : { stftOptions: state.spectrogramSettings.stft };
}
function resultWithSource(result: Record<string, unknown>): AnalysisResultWithError {
    return { ...result, fileName: sourceName, audioSource: sourceUrl } as unknown as AnalysisResultWithError;
}
async function post(message: HostOutboundMessage): Promise<void> {
    const myGeneration = generation;
    try {
        switch (message.type) {
            case 'comparison-panel-ready': case 'comparison-panel-test-snapshot': return;
            case 'update-spectrogram-settings':
                browserWindow.__APP_STATE__!.spectrogramSettings = message.settings; return;
            case 'request-reanalyze': {
                browserWindow.__APP_STATE__!.spectrogramSettings = message.settings;
                if (!sourcePath) return;
                emit({ type: 'reanalyze-start', count: 1 });
                const result = await request({ cmd: 'analyze', filePath: sourcePath, ...stft() });
                if (generation === myGeneration) emit({ type: 'analysis-update', results: [resultWithSource(result)] });
                emit({ type: 'reanalyze-end' }); return;
            }
            case 'request-track-detail': case 'request-spectrum-slice': case 'request-waveform-range': {
                const cmd = message.type === 'request-track-detail' ? 'track-detail' : message.type === 'request-spectrum-slice' ? 'spectrum-slice' : 'range';
                const result = await request({ ...message, cmd, ...stft() });
                if (generation === myGeneration) emit({ ...message, ...result, type: message.type.replace('request-', '') + '-result' } as HostInboundMessage);
                return;
            }
            case 'release-track-detail':
                if (sourcePath) await request({ cmd: 'release-track-detail', filePath: sourcePath }); return;
            case 'export-wav-loop': {
                if (!sourcePath || !message.filePaths.includes(sourcePath)) return;
                const result = await request({ cmd: 'export-wav-loop', filePath: sourcePath, startNorm: message.startNorm, endNorm: message.endNorm });
                if (myGeneration !== generation) return;
                const bytes = Uint8Array.from(atob(String(result.wavBase64)), c => c.charCodeAt(0));
                const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
                const link = document.createElement('a'); link.href = url; link.download = 'selected-region.wav'; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000); announce('Selected region exported as PCM16 WAV.'); return;
            }
            case 'select-target': pick.click(); return;
            case 'show-info': announce(message.message); return;
            default: announce('This action is unavailable in the static WAV prototype.');
        }
    } catch (error) {
        if (generation !== myGeneration) return;
        const reason = error instanceof Error ? error.message : String(error);
        announce(reason);
        if (message.type === 'request-track-detail' || message.type === 'request-spectrum-slice') {
            emit({ ...message, type: message.type.replace('request-', '') + '-error', error: reason } as HostInboundMessage);
        }
        emit({ type: 'reanalyze-end' });
    }
}
browserWindow.__AWA_HOST__ = {
    postMessage: (message: unknown): void => { void post(message as HostOutboundMessage); },
    getState: () => persisted,
    setState: (state): void => { persisted = state; },
};
pick.onchange = (): void => {
    const file = pick.files?.[0];
    if (!file || loading) return;
    dispose();
    emit({ type: 'analysis-update', results: [] });
    const myGeneration = generation;
    if (file.size > 16 * 1024 * 1024) { announce('WAV must be 16 MiB or smaller.'); return; }
    loading = true; pick.disabled = true;
    sourceName = file.name;
    announce('Preparing local Python Worker / analyzing WAV…');
    void (async () => {
        try {
            const bytes = await file.arrayBuffer();
            if (generation !== myGeneration) return;
            sourceUrl = URL.createObjectURL(file);
            const loaded = await request({ cmd: 'load', sourceId: 'selected.wav' }, bytes);
            if (generation !== myGeneration) return;
            sourcePath = String(loaded.filePath);
            const result = await request({ cmd: 'analyze', filePath: sourcePath, ...stft() });
            if (generation !== myGeneration) return;
            emit({ type: 'analysis-update', results: [resultWithSource(result)] });
            announce(`${file.name}: waveform ready. Switch to spectrogram for STFT. No automatic playback.`);
        } catch (error) {
            if (generation === myGeneration) { dispose(); announce(String(error)); }
        } finally {
            if (generation === myGeneration) { loading = false; pick.disabled = false; }
            pick.value = '';
        }
    })();
};
cancel.onclick = (): void => {
    dispose(); pick.value = ''; emit({ type: 'analysis-update', results: [] }); emit({ type: 'reanalyze-end' }); announce('Worker cleared; audio memory released. Select another short WAV.');
};
window.addEventListener('pagehide', dispose);
