import { SessionRequests, SourceResults } from '../../shared/analysis/analysisSession';
import { runAnalysisBatch } from '../../shared/analysis/analysisCoordinator';
import { AnalysisClient, type AnalysisCancellationSignal } from '../../shared/analysis/analysisClient';
import { BackendProtocolError, parseBackendResult, PendingBackendRequests, rejectPendingRequests, settleBackendRequest, type BackendCommand, type BackendPayload, type BackendResult } from '../../shared/protocol/backendProtocol';
import type { PanelMessage } from '../../shared/protocol/panelMessages';
import { isConfigureCalibrationMessage } from '../../shared/utils/audioTarget';
import { getStrings, pickLocale } from '../../shared/i18n/strings';
import { loadSpectrogramSettings, saveSpectrogramSettings } from '../../shared/analysis/savedSpectrogramSettings';
import { ComparisonSessionController, type ComparisonSessionPorts, type SessionScope } from '../../shared/session/comparisonSessionController';
import { RecipeFlow, type RecipeCatalogEntry } from '../../shared/recipe/recipeFlow';
import { isRecipeDocument } from '../../shared/recipe/recipeSelection';
import type { ChartSpec } from '../../shared/chartSpec';
import { chartSpecGlobals, renderChartSpecStyles } from '../panels/chartSpecDocument';
import { zipStore } from './zipStore';
import type { HostInboundMessage } from './hostMessaging';
import type { ComparisonWindow } from './browserAdapter';
import type { PersistedWebviewState, ComparisonTrackState } from './types';
import type { AnalysisResult, AnalysisResultWithError } from '../../shared/analysis/analysisTypes';

interface Source {
    path: string;
    name: string;
    url: string;
    inputBytes: number;
    file: File;
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
let recovery: Promise<void> | undefined;
let nextSource = 0;
const sourceGeneration = new SessionRequests();
const reanalysisGeneration = new SessionRequests();
const sources = new SourceResults<Source>(new Map(), source => URL.revokeObjectURL(source.url));
const inboundListeners = new Set<(message: unknown) => void>();
let loading = false;
const pending = new PendingBackendRequests<Record<string, unknown>>('browser-');
// Session limits come from browser_service.py through the Worker so pre-checks, the backend and the README agree.
const BROWSER_LIMIT_KEYS = ['maxInputBytes', 'maxSources', 'maxTotalInputBytes', 'maxExportBytes'] as const;
type BrowserLimits = Record<typeof BROWSER_LIMIT_KEYS[number], number>;
let browserLimits: BrowserLimits | undefined;
/** Caches the Worker's limits only when every field is a positive integer, so a skewed Worker cannot disable the pre-checks. */
async function limits(): Promise<BrowserLimits> {
    if (browserLimits) return browserLimits;
    const reply = await request({ cmd: 'limits' });
    if (!BROWSER_LIMIT_KEYS.every(key => Number.isSafeInteger(reply[key]) && Number(reply[key]) > 0)) {
        throw new BackendProtocolError('Invalid limits response from the audio Worker');
    }
    return browserLimits = Object.fromEntries(BROWSER_LIMIT_KEYS.map(key => [key, Number(reply[key])])) as BrowserLimits;
}
const mib = (bytes: number): string => String(bytes / (1024 * 1024));
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

class RecipeWorkerResetError extends Error {}

function resetWorker(reason: Error): void {
    reanalysisGeneration.advance();
    worker?.terminate(); worker = undefined;
    recovery = undefined;
    rejectPendingRequests(pending, reason);
    loading = false; pick.disabled = false; pick.value = "";
}
function dispose(): void {
    sourceGeneration.advance();
    resetWorker(new Error('Analysis cancelled'));
    sources.clear();
}
async function request(
    command: Record<string, unknown>, bytes?: ArrayBuffer, forcedRequestId?: string, cancellation?: AnalysisCancellationSignal,
): Promise<Record<string, unknown>> {
    if (!worker && !recovery && sources.size) {
        const generation = sourceGeneration.current;
        const restoring = (async () => {
            for (const source of sources.values()) {
                const bytes = await source.file.arrayBuffer();
                if (!sourceGeneration.isCurrent(generation) || !sources.owns(source.path, source)) {
                    throw new Error('Analysis cancelled');
                }
                await sendRequest({ cmd: 'load', sourceId: source.path.split('/').pop()! }, bytes);
            }
        })();
        recovery = restoring;
        void restoring.finally(() => { if (recovery === restoring) recovery = undefined; }).catch(() => {});
    }
    if (recovery) await recovery;
    if (cancellation?.isCancellationRequested) throw new Error('Recipe execution cancelled');
    return sendRequest(command, bytes, forcedRequestId);
}
function sendRequest(command: Record<string, unknown>, bytes?: ArrayBuffer, forcedRequestId?: string): Promise<Record<string, unknown>> {
    if (!worker) {
        if (command.cmd !== 'load' && command.cmd !== 'limits') throw new Error('No selected source; choose the WAV again.');
        const activeWorker = new Worker('./audio.worker.js', { type: 'module' });
        worker = activeWorker;
        worker.onmessage = (event: MessageEvent<{ requestId: string; result?: Record<string, unknown>; error?: unknown }>): void => {
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
    const requestId = forcedRequestId ?? pending.nextId();
    return pending.dispatch(String(command.cmd), requestId, response => response, () => {
        worker!.postMessage({ ...command, requestId, bytes }, bytes ? [bytes] : []);
    });
}
function stft() {
    const state = browserWindow.__APP_STATE__!;
    return state.spectrogramSettings.auto ? {} : { stftOptions: state.spectrogramSettings.stft };
}
const analysisClient = new class extends AnalysisClient {
    protected override cancelRequest(requestId: string, reason: Error): void {
        if (!pending.has(requestId) && !recovery) return;
        resetWorker(new RecipeWorkerResetError(reason.message));
        emit({ type: 'reanalyze-end' });
        announce(reason.message);
    }
    protected async request<K extends BackendCommand>(command: K, payload: BackendPayload<K>, requestId?: string, cancellation?: AnalysisCancellationSignal): Promise<BackendResult<K>> {
        const result = await request({ ...payload, cmd: command }, undefined, requestId, cancellation);
        return parseBackendResult(command, result);
    }
}({ current: filePath => {
    const result = sources.get(filePath)?.result;
    return result && !('error' in result)
        ? { calibrationProfile: result.calibrationProfile, analysisRevision: result.analysisRevision } : {};
} });
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
    catch (error) { if (!(error instanceof RecipeWorkerResetError) && sourceGeneration.isCurrent(myGeneration)) { dispose(); snapshot(); emit({ type: 'reanalyze-end' }); announce(String(error)); } }
}
async function fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
}
function promptIndex(title: string, labels: string[]): number | undefined {
    const choice = window.prompt(`${title}\n${labels.map((label, index) => `${index + 1}: ${label}`).join('\n')}`, '1');
    if (choice === null) return undefined;
    const index = Number(choice) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= labels.length) { announce(title); return undefined; }
    return index;
}
// Recipe charts render in a same-origin frame: the ChartSpec script arrives as ./chartSpec.js under the page CSP,
// and a fresh document per run keeps the renderer's one-shot range popup and listeners isolated.
function showRecipeCharts(title: string, charts: ChartSpec[]): void {
    document.querySelector('[data-recipe-result]')?.remove();
    const panel = document.createElement('section');
    panel.setAttribute('data-recipe-result', title);
    panel.style.cssText = 'margin:8px;border:1px solid #444;border-radius:4px;background:#1e1e1e;color:#ddd';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid #444';
    const heading = document.createElement('strong'); heading.textContent = title;
    const close = document.createElement('button');
    close.setAttribute('data-action', 'browser-recipe-close');
    close.textContent = strings.btnCloseRecipeResult;
    close.onclick = (): void => { panel.remove(); };
    header.append(heading, close);
    const frame = document.createElement('iframe');
    frame.setAttribute('title', title);
    frame.style.cssText = 'display:block;width:100%;height:60vh;border:0;background:#1e1e1e';
    panel.append(header, frame);
    bar.insertAdjacentElement('afterend', panel);
    const target = frame.contentDocument!;
    const style = target.createElement('style'); style.textContent = renderChartSpecStyles();
    const chartsHost = target.createElement('div'); chartsHost.id = 'charts';
    target.head.append(style); target.body.append(chartsHost);
    Object.assign(frame.contentWindow as unknown as Record<string, unknown>, chartSpecGlobals(charts, strings));
    const script = target.createElement('script'); script.src = './chartSpec.js';
    target.body.append(script);
}
const recipeFlow = new RecipeFlow({
    listRecipes: async (): Promise<RecipeCatalogEntry[]> => {
        const manifest = await fetchJson('./recipes/manifest.json');
        if (!Array.isArray(manifest)) throw new Error('Invalid recipe manifest');
        return manifest as RecipeCatalogEntry[];
    },
    pickRecipe: async (items, entries) => {
        const index = promptIndex(strings.browserRecipePick, items.map(item => item.label));
        return index === undefined ? undefined : entries[index].location;
    },
    readRecipe: async location => {
        const recipe = await fetchJson(location);
        if (!isRecipeDocument(recipe)) throw new Error(`${location} is not a recipe document`);
        return recipe;
    },
    pickInputFiles: async () => { announce(strings.browserRecipeNoSources); return undefined; },
    resolveRelative: (file) => { throw new Error(`Recipe input ${file} must be a loaded track in the browser`); },
    runWithProgress: async (title, task) => { announce(title); return task(); },
    execute: async (recipe, location) => {
        if (!sources.size) throw new Error(strings.browserRecipeNoSources);
        return analysisClient.runRecipe(recipe, { recipePath: location });
    },
    showCharts: (title, charts) => { showRecipeCharts(title, charts); announce(strings.browserRecipeDone + title); },
    showError: announce,
});
// Browser host: owned sources, Worker transport, localStorage and downloads behind the shared session contract.
const ports: ComparisonSessionPorts = {
    scope(message: PanelMessage): SessionScope {
        const myGeneration = sourceGeneration.current;
        const myReanalysis = message.type === 'request-reanalyze' ? reanalysisGeneration.advance() : undefined;
        const owner = 'filePath' in message ? sources.get(message.filePath) : undefined;
        const recipeOwners = message.type === 'run-recipe' ? Array.from(sources.values()) : [];
        const isCurrent = (): boolean => sourceGeneration.isCurrent(myGeneration)
            && (owner === undefined || sources.owns(owner.path, owner))
            && recipeOwners.every(source => sources.owns(source.path, source))
            && (myReanalysis === undefined || reanalysisGeneration.isCurrent(myReanalysis));
        return { isCurrent, canPublish: isCurrent };
    },
    publish: emit,
    saveSettings(settings): void {
        browserWindow.__APP_STATE__!.spectrogramSettings = settings;
        void saveSpectrogramSettings(settingsContext, settings);
    },
    stftOptions: () => stft().stftOptions,
    client: analysisClient,
    lazyContext(filePath) {
        if (!sources.get(filePath)) throw new Error('Source is no longer selected; choose the WAV again.');
        return {};
    },
    lazyFailed: (_request, reason) => announce(reason),
    releaseTrackDetail(filePath): PromiseLike<unknown> | void {
        if (worker && sources.get(filePath)) return analysisClient.releaseTrackDetail(filePath);
    },
    activeFilePaths: () => sources.snapshot(source => source.path),
    async reanalyze(stftOptions, scope) {
        await runAnalysisBatch(Array.from(sources.values()), {
            isCurrent: () => scope.isCurrent(),
            isSelected: source => sources.owns(source.path, source),
            analyze: source => analysisClient.analyze(source.path, stftOptions ? { stftOptions } : {}),
            commit: (source, result) => { source.result = resultWithSource(result, source.name, source.url); },
        });
        return sources.snapshot(source => source.result);
    },
    async wavExport(message, scope) {
        const selected = message.filePaths.map(path => sources.get(path)).filter((source): source is Source => !!source);
        if (!selected.length) return undefined;
        const entries: Array<{ name: string; bytes: Uint8Array }> = [];
        return {
            sources: selected.map(source => ({ filePath: source.path, fileName: source.name })),
            sink: {
                isCurrent: () => scope.isCurrent(),
                isSelected: item => sources.get(item.filePath) === selected.find(source => source.path === item.filePath),
                prepare: async commands => { await request({ cmd: 'export-plan', commands }); },
                exportWavLoop: (filePath, start, end) => analysisClient.exportWavLoop(filePath, start, end),
                write: async (_source, name, result) => {
                    const bytes = Uint8Array.from(atob(result.wavBase64), c => c.charCodeAt(0));
                    entries.push({ name, bytes });
                },
            },
            complete(): void {
                if (!entries.length) return;
                if (entries.length === 1) download(entries[0].bytes, entries[0].name, 'audio/wav');
                else download(zipStore(entries, { maxEntries: browserLimits!.maxSources, maxBytes: browserLimits!.maxExportBytes }), 'selected-regions.zip', 'application/zip');
                announce(strings.browserExported);
            },
        };
    },
    async pickReportFormat() {
        const choice = window.prompt(`${strings.reportFormatPlaceholder}\n1: ${strings.reportFormatMarkdown}\n2: ${strings.reportFormatNotebook}`, '1');
        if (choice === null) return undefined;
        if (choice !== '1' && choice !== '2') { announce(strings.reportFormatPlaceholder); return undefined; }
        return choice === '1' ? 'markdown' : 'notebook';
    },
    async saveReport(artifact) {
        download(new TextEncoder().encode(artifact.content), artifact.name, artifact.type);
        announce(strings.reportExportedPrefix + artifact.name);
    },
    selectTarget(targetKind): void {
        if (targetKind === 'directory') { announce(strings.browserDirectoryUnavailable); return; }
        pick.click();
    },
    showInformation: announce,
    showError: announce,
    unsupported: () => announce(strings.browserUnavailable),
    runRecipe: async (scope): Promise<void> => {
        if (!sources.size) { announce(strings.browserRecipeNoSources); return; }
        await recipeFlow.run(sources.snapshot(source => source.path), () => scope.isCurrent());
    },
};
const controller = new ComparisonSessionController(ports);
browserWindow.__AWA_HOST__ = {
    downloadFile: (content, name, mimeType): void => { download(new TextEncoder().encode(content), name, mimeType); },
    releaseSource: (path): void => { void releaseSource(path); },
    onMessage: (listener): (() => void) => { inboundListeners.add(listener); return () => { inboundListeners.delete(listener); }; },
    postMessage: (message: unknown): void => {
        if (isConfigureCalibrationMessage(message)) { announce(strings.browserUnavailable); return; }
        void controller.dispatch(message);
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
                    const limit = browserLimits ?? await limits();
                    if (file.size > limit.maxInputBytes) throw new Error(strings.browserInputTooLarge.replace('{mib}', mib(limit.maxInputBytes)));
                    if (sources.size >= limit.maxSources || Array.from(sources.values()).reduce((sum, source) => sum + source.inputBytes, file.size) > limit.maxTotalInputBytes) {
                        throw new Error(strings.browserAggregateLimit
                            .replace('{count}', String(limit.maxSources)).replace('{mib}', mib(limit.maxTotalInputBytes)));
                    }
                    const bytes = await file.arrayBuffer();
                    if (!sourceGeneration.isCurrent(myGeneration)) throw new Error('Analysis cancelled');
                    const loaded = await request({ cmd: 'load', sourceId: `selected-${++nextSource}.wav` }, bytes);
                    if (!sourceGeneration.isCurrent(myGeneration)) throw new Error('Analysis cancelled');
                    loadedPath = String(loaded.filePath);
                    const result = await analysisClient.analyze(loadedPath, stft());
                    return { path: loadedPath, result };
                } catch (error) {
                    if (!(error instanceof RecipeWorkerResetError) && sourceGeneration.isCurrent(myGeneration) && loadedPath) {
                        try { await request({ cmd: 'unload', filePath: loadedPath }); }
                        catch (releaseError) {
                            if (!(releaseError instanceof RecipeWorkerResetError) && sourceGeneration.isCurrent(myGeneration)) { dispose(); snapshot(); announce(String(releaseError)); }
                            throw releaseError;
                        }
                    }
                    throw error;
                }
            },
            commit: (file, loaded) => {
                const url = URL.createObjectURL(file);
                sources.set(loaded.path, { path: loaded.path, name: file.name, url, inputBytes: file.size, file,
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
