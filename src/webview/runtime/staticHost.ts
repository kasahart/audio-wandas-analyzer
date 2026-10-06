import { SessionRequests, SourceResults } from '../../shared/analysis/analysisSession';
import { runAnalysisBatch } from '../../shared/analysis/analysisCoordinator';
import { AnalysisClient, executeLazyAnalysis, lazyAnalysisError } from '../../shared/analysis/analysisClient';
import { parseBackendResult, rejectPendingRequests, settleBackendRequest, type PendingBackendRequest, type BackendCommand, type BackendPayload, type BackendResult } from '../../shared/protocol/backendProtocol';
import { parsePanelMessage } from '../../shared/protocol/panelMessages';
import { getStrings, pickLocale } from '../../shared/i18n/strings';
import { loadSpectrogramSettings, saveSpectrogramSettings } from '../../shared/analysis/savedSpectrogramSettings';
import { reportArtifact, exportWavRegions } from '../../shared/utils/exportArtifact';
import { zipStore } from './zipStore';
import type { HostOutboundMessage, HostInboundMessage } from './hostMessaging';
import type { ComparisonWindow } from './browserAdapter';
import type { PersistedWebviewState, ComparisonTrackState } from './types';
import type { AnalysisResult, AnalysisResultWithError } from '../../shared/analysis/analysisTypes';

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
const settingsContext = { workspaceState: {
    get: readSaved,
    update: async (key: string, value: unknown): Promise<void> => { save(key, value); },
} };
const restoredView = readSaved(VIEW_STATE_KEY) as PersistedWebviewState | undefined;
let persisted: PersistedWebviewState = restoredView?.contentType === 'spectrogram' ? { contentType: 'spectrogram' } : {};
browserWindow.__APP_STATE__!.spectrogramSettings = loadSpectrogramSettings(settingsContext);
let worker: Worker | undefined;
let nextId = 0;
let nextSource = 0;
const sourceGeneration = new SessionRequests();
const reanalysisGeneration = new SessionRequests();
const sources = new SourceResults<Source>(new Map(), source => URL.revokeObjectURL(source.url));
const inboundListeners = new Set<(message: unknown) => void>();
let loading = false;
const pending = new Map<string, PendingBackendRequest<Record<string, unknown>>>();
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
const snapshot = (): void => { emit({ type: 'analysis-update', results: sources.snapshot(source => source.result) }); };

function dispose(): void {
    sourceGeneration.advance();
    reanalysisGeneration.advance();
    worker?.terminate(); worker = undefined;
    rejectPendingRequests(pending, new Error('Analysis cancelled'));
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
            settleBackendRequest(pending, event.data.requestId, event.data.result!, event.data.error);
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
        pending.set(requestId, { command: String(command.cmd), complete: resolve, reject });
        worker!.postMessage({ ...command, requestId, bytes }, bytes ? [bytes] : []);
    });
}
function stft() {
    const state = browserWindow.__APP_STATE__!;
    return state.spectrogramSettings.auto ? {} : { stftOptions: state.spectrogramSettings.stft };
}
const analysisClient = new class extends AnalysisClient {
    protected async request<K extends BackendCommand>(command: K, payload: BackendPayload<K>): Promise<BackendResult<K>> {
        const result = await request({ ...payload, cmd: command });
        return parseBackendResult(command, result);
    }
}();
function resultWithSource(result: AnalysisResult, name: string, url: string): ComparisonTrackState {
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
    sources.delete(path);
    if (!sources.size && !loading) {
        dispose(); emit({ type: 'reanalyze-end' });
        announce(strings.browserRemoved); return;
    }
    const myGeneration = sourceGeneration.current;
    try { await request({ cmd: 'unload', filePath: path }); }
    catch (error) { if (sourceGeneration.isCurrent(myGeneration)) { dispose(); snapshot(); emit({ type: 'reanalyze-end' }); announce(String(error)); } }
}
async function post(message: HostOutboundMessage): Promise<void> {
    const myGeneration = sourceGeneration.current;
    const myReanalysis = message.type === 'request-reanalyze' ? reanalysisGeneration.advance() : undefined;
    const owner = 'filePath' in message ? sources.get(message.filePath) : undefined;
    try {
        switch (message.type) {
            case 'comparison-panel-ready': case 'comparison-panel-test-snapshot': return;
            case 'update-spectrogram-settings':
                browserWindow.__APP_STATE__!.spectrogramSettings = message.settings; void saveSpectrogramSettings(settingsContext, message.settings); return;
            case 'request-reanalyze': {
                void saveSpectrogramSettings(settingsContext, message.settings);
                browserWindow.__APP_STATE__!.spectrogramSettings = message.settings;
                if (!sources.size) return;
                emit({ type: 'reanalyze-start', count: sources.size });
                await runAnalysisBatch(Array.from(sources.values()), {
                    isCurrent: () => sourceGeneration.isCurrent(myGeneration) && reanalysisGeneration.isCurrent(myReanalysis!),
                    isSelected: source => sources.owns(source.path, source),
                    analyze: source => analysisClient.analyze(source.path, stft()),
                    commit: (source, result) => { source.result = resultWithSource(result, source.name, source.url); },
                });
                if (sourceGeneration.isCurrent(myGeneration) && reanalysisGeneration.isCurrent(myReanalysis!)) snapshot();
                return;
            }
            case 'request-track-detail': case 'request-spectrum-slice': case 'request-waveform-range': {
                if (!worker || !owner) throw new Error('Source is no longer selected; choose the WAV again.');
                const { analysisRevision: _revision, ...result } = await executeLazyAnalysis(analysisClient, message, stft());
                if (sourceGeneration.isCurrent(myGeneration) && sources.owns(owner.path, owner)) {
                    emit(result);
                }
                return;
            }
            case 'release-track-detail':
                if (owner && worker) await analysisClient.releaseTrackDetail(owner.path); return;
            case 'export-wav-loop': {
                const selected = message.filePaths.map(path => sources.get(path)).filter((source): source is Source => !!source);
                if (!selected.length) return;
                const entries: Array<{ name: string; bytes: Uint8Array }> = [];
                await exportWavRegions(message, selected.map(source => ({ filePath: source.path, fileName: source.name })), {
                    isCurrent: () => sourceGeneration.isCurrent(myGeneration),
                    isSelected: item => sources.get(item.filePath) === selected.find(source => source.path === item.filePath),
                    prepare: async commands => { await request({ cmd: 'export-plan', commands }); },
                    exportWavLoop: (filePath, start, end) => analysisClient.exportWavLoop(filePath, start, end),
                    write: async (_source, name, result) => {
                        const bytes = Uint8Array.from(atob(result.wavBase64), c => c.charCodeAt(0));
                        entries.push({ name, bytes });
                    },
                });
                if (!sourceGeneration.isCurrent(myGeneration)) return;
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
        if (!sourceGeneration.isCurrent(myGeneration) || (owner && !sources.owns(owner.path, owner))
            || (message.type === 'request-reanalyze' && !reanalysisGeneration.isCurrent(myReanalysis!))) return;
        const reason = error instanceof Error ? error.message : String(error);
        announce(reason);
        if (message.type === 'request-track-detail' || message.type === 'request-spectrum-slice') {
            emit(lazyAnalysisError(message, error));
        }
    } finally {
        if (message.type === 'request-reanalyze' && sourceGeneration.isCurrent(myGeneration) && reanalysisGeneration.isCurrent(myReanalysis!)) {
            emit({ type: 'reanalyze-end' });
        }
    }
}
browserWindow.__AWA_HOST__ = {
    downloadFile: (content, name, mimeType): void => { download(new TextEncoder().encode(content), name, mimeType); },
    releaseSource: (path): void => { void releaseSource(path); },
    onMessage: (listener): (() => void) => { inboundListeners.add(listener); return () => { inboundListeners.delete(listener); }; },
    postMessage: (message: unknown): void => {
        const parsed = parsePanelMessage(message);
        if (parsed) void post(parsed);
    },
    getState: () => persisted,
    setState: (state): void => { persisted = state; save(VIEW_STATE_KEY, { contentType: state.contentType }); },
};
pick.onchange = (): void => {
    const files = Array.from(pick.files || []);
    if (!files.length || loading) return;
    const myGeneration = sourceGeneration.current;
    loading = true; pick.disabled = true;
    announce(strings.browserPreparing);
    void (async () => {
        const failures: string[] = [];
        await runAnalysisBatch(files, {
            isCurrent: () => sourceGeneration.isCurrent(myGeneration),
            analyze: async file => {
                let loadedPath: string | undefined;
                try {
                    if (file.size > 16 * 1024 * 1024) throw new Error(strings.browserInputTooLarge);
                    if (sources.size >= 8 || Array.from(sources.values()).reduce((sum, source) => sum + source.inputBytes, file.size) > 64 * 1024 * 1024) {
                        throw new Error(strings.browserAggregateLimit);
                    }
                    const bytes = await file.arrayBuffer();
                    if (!sourceGeneration.isCurrent(myGeneration)) throw new Error('Analysis cancelled');
                    const loaded = await request({ cmd: 'load', sourceId: `selected-${++nextSource}.wav` }, bytes);
                    if (!sourceGeneration.isCurrent(myGeneration)) throw new Error('Analysis cancelled');
                    loadedPath = String(loaded.filePath);
                    const result = await analysisClient.analyze(loadedPath, stft());
                    return { path: loadedPath, result };
                } catch (error) {
                    if (sourceGeneration.isCurrent(myGeneration) && loadedPath) {
                        try { await request({ cmd: 'unload', filePath: loadedPath }); }
                        catch (releaseError) {
                            if (sourceGeneration.isCurrent(myGeneration)) { dispose(); snapshot(); announce(String(releaseError)); }
                            throw releaseError;
                        }
                    }
                    throw error;
                }
            },
            commit: (file, loaded) => {
                const url = URL.createObjectURL(file);
                sources.set(loaded.path, { path: loaded.path, name: file.name, url, inputBytes: file.size,
                    result: resultWithSource(loaded.result, file.name, url) });
                snapshot();
            },
            failed: (file, error) => {
                failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
                return true;
            },
        });
        if (!sourceGeneration.isCurrent(myGeneration)) return;
        loading = false; pick.disabled = false; pick.value = '';
        if (!sources.size) dispose();
        announce(failures.length ? failures.join(' | ') : `${files.at(-1)!.name}: ${strings.browserReady.replace('{count}', String(sources.size))}`);
    })();
};
cancel.onclick = (): void => {
    dispose(); pick.value = ''; snapshot(); emit({ type: 'reanalyze-end' }); announce(strings.browserCleared);
};
window.addEventListener('pagehide', dispose);
