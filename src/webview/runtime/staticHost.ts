import { getStrings, pickLocale } from '../../shared/i18n/strings';
import { SPECTROGRAM_SETTINGS_KEY, savedSpectrogramSettings } from '../../shared/analysis/savedSpectrogramSettings';
import { wavLoopName, reportArtifact } from '../../shared/utils/exportArtifact';
import { zipStore } from './zipStore';
import type { HostOutboundMessage, HostInboundMessage } from './hostMessaging';
import type { ComparisonWindow } from './browserAdapter';
import type { PersistedWebviewState, ComparisonTrackState } from './types';
import type { AnalysisResultWithError } from '../../shared/analysis/analysisTypes';

interface Source {
    path: string;
    name: string;
    url: string;
    inputBytes: number;
    result: AnalysisResultWithError;
}
const browserWindow = window as unknown as ComparisonWindow;
const strings = getStrings(window.navigator?.language ?? 'en');
browserWindow.__APP_STRINGS__ = strings;
const locale = pickLocale(window.navigator?.language ?? 'en');
(browserWindow as unknown as { __APP_LOCALE__: string }).__APP_LOCALE__ = locale;
if (document.documentElement) document.documentElement.lang = locale;
document.title = strings.panelTitle;
const VIEW_STATE_KEY = 'audioWandasAnalyzer.viewState';
function readSaved(key: string): unknown {
    try { return JSON.parse(window.localStorage.getItem(key) ?? 'null'); } catch { return undefined; }
}
function save(key: string, value: unknown): void {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be denied or full; keep working in memory. */ }
}
const restoredView = readSaved(VIEW_STATE_KEY) as PersistedWebviewState | undefined;
let persisted: PersistedWebviewState = restoredView?.contentType === 'spectrogram' ? { contentType: 'spectrogram' } : {};
browserWindow.__APP_STATE__!.spectrogramSettings = savedSpectrogramSettings(readSaved(SPECTROGRAM_SETTINGS_KEY));
let worker: Worker | undefined;
let nextId = 0;
let nextSource = 0;
let generation = 0;
let reanalysisRevision = 0;
const sources = new Map<string, Source>();
const inboundListeners = new Set<(message: unknown) => void>();
let loading = false;
const pending = new Map<string, { resolve(value: Record<string, unknown>): void; reject(error: Error): void }>();
const bar = document.createElement('div');
bar.style.cssText = 'padding:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
const pick = document.createElement('input');
pick.setAttribute('data-action', 'browser-open-wav');
pick.type = 'file'; pick.multiple = true; pick.accept = '.wav,audio/wav'; pick.setAttribute('aria-label', strings.btnOpenFile);
const cancel = document.createElement('button');
cancel.setAttribute('data-action', 'browser-clear');
cancel.textContent = strings.btnClear;
const status = document.createElement('span');
status.setAttribute('role', 'status');
status.textContent = strings.browserWavHint;
bar.append(pick, cancel, status);
document.body.prepend(bar);
const announce = (value: string): void => { status.textContent = value; };
const emit = (message: HostInboundMessage): void => { inboundListeners.forEach(listener => listener(message)); };
const snapshot = (): void => { emit({ type: 'analysis-update', results: Array.from(sources.values(), source => source.result) }); };

function dispose(): void {
    generation++;
    reanalysisRevision++;
    worker?.terminate(); worker = undefined;
    for (const request of pending.values()) request.reject(new Error('Analysis cancelled'));
    pending.clear();
    for (const source of sources.values()) URL.revokeObjectURL(source.url);
    sources.clear();
    loading = false; pick.disabled = false; pick.value = "";
}
function request(command: Record<string, unknown>, bytes?: ArrayBuffer): Promise<Record<string, unknown>> {
    if (!worker) {
        if (command.cmd !== 'load') throw new Error('No selected source; choose the WAV again.');
        const activeWorker = new Worker('./audio.worker.js', { type: 'module' });
        worker = activeWorker;
        worker.onmessage = (event: MessageEvent<{ requestId: string; result?: Record<string, unknown>; error?: string }>): void => {
            if (worker !== activeWorker) return;
            const item = pending.get(event.data.requestId);
            if (!item) return;
            pending.delete(event.data.requestId);
            if (event.data.error) item.reject(new Error(event.data.error));
            else item.resolve(event.data.result!);
        };
        worker.onerror = (): void => {
            if (worker !== activeWorker) return;
            dispose(); snapshot();
            announce(strings.browserWorkerFailed);
            emit({ type: 'reanalyze-end' });
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
function resultWithSource(result: Record<string, unknown>, name: string, url: string): ComparisonTrackState {
    const alias = String(result.filePath).split('/').pop()!.replace(/\.wav$/, '') + '-' + name.replace(/[\\/\u0000-\u001f]/g, '_');
    return { ...result, fileName: name, audioSource: url, reportSourcePath: alias } as unknown as ComparisonTrackState;
}
function download(bytes: Uint8Array, name: string, type: string): void {
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function releaseSource(path: string): Promise<void> {
    const source = sources.get(path);
    if (!source) return;
    sources.delete(path); URL.revokeObjectURL(source.url);
    if (!sources.size && !loading) {
        dispose(); emit({ type: 'reanalyze-end' });
        announce(strings.browserRemoved); return;
    }
    const myGeneration = generation;
    try { await request({ cmd: 'unload', filePath: path }); }
    catch (error) { if (generation === myGeneration) { dispose(); snapshot(); emit({ type: 'reanalyze-end' }); announce(String(error)); } }
}
async function post(message: HostOutboundMessage): Promise<void> {
    const myGeneration = generation;
    const myReanalysis = message.type === 'request-reanalyze' ? ++reanalysisRevision : reanalysisRevision;
    const owner = 'filePath' in message ? sources.get(message.filePath) : undefined;
    try {
        switch (message.type) {
            case 'comparison-panel-ready': case 'comparison-panel-test-snapshot': return;
            case 'update-spectrogram-settings':
                browserWindow.__APP_STATE__!.spectrogramSettings = message.settings; save(SPECTROGRAM_SETTINGS_KEY, message.settings); return;
            case 'request-reanalyze': {
                save(SPECTROGRAM_SETTINGS_KEY, message.settings);
                browserWindow.__APP_STATE__!.spectrogramSettings = message.settings;
                if (!sources.size) return;
                emit({ type: 'reanalyze-start', count: sources.size });
                for (const source of Array.from(sources.values())) {
                    if (generation !== myGeneration || reanalysisRevision !== myReanalysis) return;
                    if (sources.get(source.path) !== source) continue;
                    const result = await request({ cmd: 'analyze', filePath: source.path, ...stft() });
                    if (generation === myGeneration && reanalysisRevision === myReanalysis && sources.get(source.path) === source) {
                        source.result = resultWithSource(result, source.name, source.url);
                    }
                }
                if (generation === myGeneration && reanalysisRevision === myReanalysis) snapshot();
                return;
            }
            case 'request-track-detail': case 'request-spectrum-slice': case 'request-waveform-range': {
                if (!worker || !owner) throw new Error('Source is no longer selected; choose the WAV again.');
                const cmd = message.type === 'request-track-detail' ? 'track-detail' : message.type === 'request-spectrum-slice' ? 'spectrum-slice' : 'range';
                const result = await request({ ...message, cmd, ...stft() });
                if (generation === myGeneration && sources.get(owner.path) === owner) {
                    emit({ ...message, ...result, type: message.type.replace('request-', '') + '-result' } as HostInboundMessage);
                }
                return;
            }
            case 'release-track-detail':
                if (owner && worker) await request({ cmd: 'release-track-detail', filePath: owner.path }); return;
            case 'export-wav-loop': {
                const selected = message.filePaths.map(path => sources.get(path)).filter((source): source is Source => !!source);
                if (!selected.length) return;
                const commands = selected.map(source => {
                    const region = message.fileRegions?.find(region => region.filePath === source.path) ?? message;
                    return { cmd: 'export-wav-loop', filePath: source.path, startNorm: region.startNorm, endNorm: region.endNorm };
                });
                await request({ cmd: 'export-plan', commands });
                const entries: Array<{ name: string; bytes: Uint8Array }> = [];
                const usedNames = new Set<string>();
                for (const [index, source] of selected.entries()) {
                    if (myGeneration !== generation) return;
                    if (sources.get(source.path) !== source) continue;
                    const result = await request(commands[index]);
                    if (myGeneration !== generation) return;
                    if (sources.get(source.path) !== source) continue;
                    const bytes = Uint8Array.from(atob(String(result.wavBase64)), c => c.charCodeAt(0));
                    entries.push({ name: wavLoopName(source.name, usedNames), bytes });
                }
                if (!entries.length) return;
                if (entries.length === 1) download(entries[0].bytes, entries[0].name, 'audio/wav');
                else download(zipStore(entries), 'selected-regions.zip', 'application/zip');
                announce(strings.browserExported); return;
            }
            case 'export-report-options': {
                const choice = window.prompt(`${strings.reportFormatPlaceholder}\n1: ${strings.reportFormatMarkdown}\n2: ${strings.reportFormatNotebook}`, '1');
                if (choice === null) return;
                if (choice !== '1' && choice !== '2') { announce(strings.reportFormatPlaceholder); return; }
                const artifact = reportArtifact(message, choice === '1' ? 'markdown' : 'notebook');
                download(new TextEncoder().encode(artifact.content), artifact.name, artifact.type);
                announce(strings.reportExportedPrefix + artifact.name); return;
            }
            case 'select-target':
                if (message.targetKind === 'directory') { announce(strings.browserDirectoryUnavailable); return; }
                pick.click(); return;
            case 'show-info': announce(message.message); return;
            default: announce(strings.browserUnavailable);
        }
    } catch (error) {
        if (generation !== myGeneration || (owner && sources.get(owner.path) !== owner)
            || (message.type === 'request-reanalyze' && reanalysisRevision !== myReanalysis)) return;
        const reason = error instanceof Error ? error.message : String(error);
        announce(reason);
        if (message.type === 'request-track-detail' || message.type === 'request-spectrum-slice') {
            emit({ ...message, type: message.type.replace('request-', '') + '-error', error: reason } as HostInboundMessage);
        }
    } finally {
        if (message.type === 'request-reanalyze' && generation === myGeneration && reanalysisRevision === myReanalysis) {
            emit({ type: 'reanalyze-end' });
        }
    }
}
browserWindow.__AWA_HOST__ = {
    releaseSource: (path): void => { void releaseSource(path); },
    onMessage: (listener): (() => void) => { inboundListeners.add(listener); return () => { inboundListeners.delete(listener); }; },
    postMessage: (message: unknown): void => { void post(message as HostOutboundMessage); },
    getState: () => persisted,
    setState: (state): void => { persisted = state; save(VIEW_STATE_KEY, { contentType: state.contentType }); },
};
pick.onchange = (): void => {
    const files = Array.from(pick.files || []);
    if (!files.length || loading) return;
    const myGeneration = generation;
    loading = true; pick.disabled = true;
    announce(strings.browserPreparing);
    void (async () => {
        const failures: string[] = [];
        for (const file of files) {
            let loadedPath: string | undefined;
            try {
                if (generation !== myGeneration) return;
                if (file.size > 16 * 1024 * 1024) throw new Error('WAV must be 16 MiB or smaller.');
                if (sources.size >= 8 || Array.from(sources.values()).reduce((sum, source) => sum + source.inputBytes, file.size) > 64 * 1024 * 1024) {
                    throw new Error('Browser session limit: up to 8 WAV files / 64 MiB total input. Remove a track first.');
                }
                const bytes = await file.arrayBuffer();
                if (generation !== myGeneration) return;
                const loaded = await request({ cmd: 'load', sourceId: `selected-${++nextSource}.wav` }, bytes);
                if (generation !== myGeneration) return;
                loadedPath = String(loaded.filePath);
                const result = await request({ cmd: 'analyze', filePath: loadedPath, ...stft() });
                if (generation !== myGeneration) return;
                const url = URL.createObjectURL(file);
                sources.set(loadedPath, { path: loadedPath, name: file.name, url, inputBytes: file.size, result: resultWithSource(result, file.name, url) });
                snapshot();
            } catch (error) {
                if (generation !== myGeneration) return;
                if (loadedPath) {
                    try { await request({ cmd: 'unload', filePath: loadedPath }); }
                    catch (releaseError) {
                        if (generation === myGeneration) { dispose(); snapshot(); announce(String(releaseError)); }
                        return;
                    }
                }
                failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (generation !== myGeneration) return;
        loading = false; pick.disabled = false; pick.value = '';
        if (!sources.size) dispose();
        announce(failures.length ? failures.join(' | ') : `${files.at(-1)!.name}: ${strings.browserReady.replace('{count}', String(sources.size))}`);
    })();
};
cancel.onclick = (): void => {
    dispose(); pick.value = ''; snapshot(); emit({ type: 'reanalyze-end' }); announce(strings.browserCleared);
};
window.addEventListener('pagehide', dispose);
