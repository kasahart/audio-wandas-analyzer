import { SessionRequests, SourceResults } from '../../shared/analysis/analysisSession';
import { runAnalysisBatch } from '../../shared/analysis/analysisCoordinator';
import { AnalysisClient, type AnalysisCancellationSignal, type AnalysisContextPolicy } from '../../shared/analysis/analysisClient';
import { BackendProtocolError, parseBackendResult, PendingBackendRequests, rejectPendingRequests, settleBackendRequest, type BackendCommand, type BackendPayload, type BackendResult } from '../../shared/protocol/backendProtocol';
import type { BrowserLimits } from '../../shared/protocol/generated/backendProtocolSchema';
import { schemaViolation, withoutResponseEnvelope } from '../../shared/protocol/schemaValidation';
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
import type { PersistedWebviewState, ComparisonTrackState, WebviewHostApi } from './types';
import type { AnalysisResult, AnalysisResultWithError } from '../../shared/analysis/analysisTypes';

interface Source {
    path: string;
    /** The Worker's identity for this source, relative to `/sources`; recovery reloads under the same one. */
    sourceId: string;
    name: string;
    url: string;
    inputBytes: number;
    file: File;
    result: AnalysisResultWithError;
}

class RecipeWorkerResetError extends Error {}

/** The parts of a File System Access handle the folder picker walks. */
interface FolderEntryHandle {
    kind: 'file' | 'directory';
    name: string;
    getFile?(): Promise<File>;
    values?(): AsyncIterable<FolderEntryHandle>;
}
type ShowDirectoryPicker = (options: { mode: 'read' }) => Promise<FolderEntryHandle>;

async function collectWavFiles(directory: FolderEntryHandle, prefix: string, found: Array<{ path: string; file: File }>): Promise<void> {
    for await (const entry of directory.values!()) {
        const path = `${prefix}/${entry.name}`;
        if (entry.kind === 'directory') await collectWavFiles(entry, path, found);
        else if (/\.wav$/i.test(entry.name)) found.push({ path, file: await entry.getFile!() });
    }
}

/** Browser globals the static host reaches; tests pass fakes instead of running the bundle in a vm. */
export interface StaticHostDeps {
    window: Window;
    document: Document;
    Worker: typeof Worker;
    fetch: typeof fetch;
    URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
    setTimeout: typeof setTimeout;
    /** Overrides AnalysisClient's Recipe timeout; tests shorten it. */
    recipeTimeoutMs?: number;
}

/** Builds the browser host on top of the given globals and installs it as `window.__AWA_HOST__`. */
export function createStaticHost(deps: StaticHostDeps): WebviewHostApi {
    // Shadow the globals so every browser access goes through deps.
    const { window, document, Worker, fetch, URL, setTimeout } = deps;
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
    let bootFailed = false;
    let nextSource = 0;
    const sourceGeneration = new SessionRequests();
    const reanalysisGeneration = new SessionRequests();
    const sources = new SourceResults<Source>(new Map(), source => URL.revokeObjectURL(source.url));
    const inboundListeners = new Set<(message: unknown) => void>();
    let loading = false;
    const pending = new PendingBackendRequests<Record<string, unknown>>('browser-');
    // Session limits come from browser_service.py through the Worker so pre-checks, the backend and the README agree.
    let browserLimits: BrowserLimits | undefined;
    /** Caches the Worker's limits only when every field is a positive safe integer, so a skewed Worker cannot disable the pre-checks. */
    async function limits(): Promise<BrowserLimits> {
        if (browserLimits) return browserLimits;
        const reply = await request({ cmd: 'limits' });
        if (schemaViolation('BrowserLimits', reply) !== null) {
            throw new BackendProtocolError('Invalid limits response from the audio Worker');
        }
        return browserLimits = reply as unknown as BrowserLimits;
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
    const folderPick = document.createElement('input');
    folderPick.type = 'file'; folderPick.multiple = true; folderPick.setAttribute('webkitdirectory', '');
    folderPick.style.cssText = 'display:none';
    const openFolder = document.createElement('button');
    openFolder.setAttribute('data-action', 'browser-open-folder');
    openFolder.textContent = strings.btnOpenFolder;
    const pythonState = document.createElement('span');
    pythonState.setAttribute('data-python-state', '');
    pythonState.setAttribute('aria-live', 'polite');
    pythonState.style.cssText = 'white-space:nowrap';
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.textContent = strings.browserWavHint;
    bar.append(pick, openFolder, folderPick, cancel, pythonState, status);
    document.body.prepend(bar);
    // The toolbar text alone was easy to miss, so the boot also shows a centred card; it ignores pointer events because commands already wait for the boot.
    const pythonLoading = document.createElement('div');
    pythonLoading.setAttribute('data-python-loading', '');
    pythonLoading.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:70;pointer-events:none;'
        + 'display:flex;align-items:center;gap:12px;padding:16px 24px;background:var(--panel);color:var(--text);border:1px solid var(--line);'
        + 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.35);font-family:var(--font-ui);font-size:14px';
    const pythonSpinner = document.createElement('span');
    pythonSpinner.style.cssText = 'width:18px;height:18px;border:3px solid var(--muted);border-top-color:var(--accent);border-radius:50%;animation:python-loading-spin 0.8s linear infinite';
    const pythonLoadingText = document.createElement('span');
    pythonLoadingText.textContent = strings.browserPythonStarting;
    const pythonSpinnerKeyframes = document.createElement('style');
    pythonSpinnerKeyframes.textContent = '@keyframes python-loading-spin { to { transform: rotate(360deg); } }';
    pythonLoading.append(pythonSpinner, pythonLoadingText, pythonSpinnerKeyframes);
    document.body.prepend(pythonLoading);
    function showPythonState(text: string, booting = false): void {
        pythonState.textContent = text;
        pythonLoading.style.display = booting ? 'flex' : 'none';
    }
    const announce = (value: string): void => { status.textContent = value; };
    const emit = (message: HostInboundMessage): void => { inboundListeners.forEach(listener => listener(message)); };
    /** The opened folder's WAV files keyed by the `/sources/<relative path>` each one loads under. */
    let folder: Map<string, File> | undefined;
    /** Checked tree files that are still loading, so their checkboxes stay checked until they load or fail. */
    const pendingTreePaths = new Set<string>();
    let selectionRequests = 0;
    const snapshot = (): void => {
        const results = sources.snapshot(source => source.result);
        emit(folder
            ? { type: 'analysis-update', results, selectedFilePaths: Array.from(folder.keys()).filter(path => sources.get(path) || pendingTreePaths.has(path)) }
            : { type: 'analysis-update', results });
    };
    let batches: Promise<void> | undefined;
    /** Runs source loads one batch at a time so picker and tree batches never interleave their pre-checks; an idle queue starts the batch now. */
    function enqueueBatch(task: () => Promise<void>): void {
        const settled: Promise<void> = (batches ? batches.then(task) : task())
            .catch(() => {})
            .finally(() => { if (batches === settled) batches = undefined; });
        batches = settled;
    }

    function resetWorker(reason: Error): void {
        reanalysisGeneration.advance();
        worker?.terminate(); worker = undefined;
        showPythonState(strings.browserPythonStopped);
        recovery = undefined;
        rejectPendingRequests(pending, reason);
    }
    /** Drops every source; an idle Worker only releases them, so Pyodide boots once per page. */
    function dispose(): void {
        sourceGeneration.advance();
        // Python cannot interrupt a running command, so work still in flight is cancelled by restarting the Worker;
        // a failed boot is also restarted, so the next WAV retries it.
        if (pending.size || recovery || bootFailed) resetWorker(new Error('Analysis cancelled'));
        else { reanalysisGeneration.advance(); worker?.postMessage({ cmd: 'clear', requestId: pending.nextId() }); }
        loading = false; pick.disabled = false; pick.value = ""; folderPick.value = "";
        pendingTreePaths.clear();
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
                    await sendRequest({ cmd: 'load', sourceId: source.sourceId }, bytes);
                }
            })();
            recovery = restoring;
            void restoring.finally(() => { if (recovery === restoring) recovery = undefined; }).catch(() => {});
        }
        if (recovery) await recovery;
        if (cancellation?.isCancellationRequested) throw new Error('Recipe execution cancelled');
        return sendRequest(command, bytes, forcedRequestId);
    }
    function startWorker(): Worker {
        const activeWorker = new Worker('./audio.worker.js', { type: 'module' });
        bootFailed = false;
        showPythonState(strings.browserPythonStarting, true);
        activeWorker.onmessage = (event: MessageEvent<{ requestId: string; result?: Record<string, unknown>; error?: unknown; ready?: boolean }>): void => {
            if (worker !== activeWorker) return;
            if (event.data.ready !== undefined) {
                bootFailed = !event.data.ready;
                showPythonState(event.data.ready ? strings.browserPythonReady : strings.browserPythonFailed);
                return;
            }
            // A Worker reply is `{requestId, result}` or `{requestId, error}`; `result` holds no envelope keys.
            const { requestId, result, error } = event.data;
            const envelope: Record<string, unknown> = withoutResponseEnvelope(event.data);
            const wellFormed = Object.keys(envelope).every(key => key === 'result' || envelope[key] === undefined);
            if (error === undefined && !wellFormed) {
                // Rejected here because browser-only commands (load, unload, export-plan) settle without a result schema.
                const request = pending.get(requestId);
                if (!request) return;
                pending.delete(requestId);
                request.reject(new BackendProtocolError(`Invalid ${request.command} response envelope`));
                return;
            }
            settleBackendRequest(pending, requestId, error === undefined ? result! : envelope, error);
        };
        activeWorker.onerror = (): void => {
            if (worker !== activeWorker) return;
            resetWorker(new Error('Analysis cancelled'));
            dispose(); snapshot();
            announce(strings.browserWorkerFailed);
            emit({ type: 'reanalyze-end' });
        };
        return activeWorker;
    }
    function sendRequest(command: Record<string, unknown>, bytes?: ArrayBuffer, forcedRequestId?: string): Promise<Record<string, unknown>> {
        if (!worker) {
            if (command.cmd !== 'load' && command.cmd !== 'limits') throw new Error('No selected source; choose the WAV again.');
            worker = startWorker();
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
        constructor(policy: AnalysisContextPolicy) {
            super(policy);
            if (deps.recipeTimeoutMs !== undefined) this.recipeTimeoutMs = deps.recipeTimeoutMs;
        }
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
    function resultWithSource(result: AnalysisResult, sourceId: string, name: string, url: string): ComparisonTrackState {
        // A folder file is reported by its unique path inside the picked folder's parent, so the notebook can read it from there.
        const alias = sourceId.includes('/') ? sourceId
            : sourceId.replace(/\.wav$/, '') + '-' + name.replace(/[\\/\u0000-\u001f]/g, '_');
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
        if (folder?.has(path)) snapshot();
        if (!sources.size && !loading) {
            dispose(); emit({ type: 'reanalyze-end' });
            announce(strings.browserRemoved); return;
        }
        const myGeneration = sourceGeneration.current;
        try { await request({ cmd: 'unload', filePath: path }); }
        catch (error) { if (!(error instanceof RecipeWorkerResetError) && sourceGeneration.isCurrent(myGeneration)) { dispose(); snapshot(); emit({ type: 'reanalyze-end' }); announce(error instanceof Error ? error.message : String(error)); } }
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
    // Recipe charts render in a same-origin frame: the bundled ChartSpec renderer arrives as ./chartSpecRuntime.js under the page CSP,
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
        acceptDrops(frame.contentWindow!);
        const script = target.createElement('script'); script.src = './chartSpecRuntime.js';
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
                commit: (source, result) => { source.result = resultWithSource(result, source.sourceId, source.name, source.url); },
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
            if (targetKind === 'directory') pickFolder();
            else pick.click();
        },
        async selection(message): Promise<void> {
            const tree = folder;
            if (!tree) return;
            const myGeneration = sourceGeneration.current;
            const myRequest = ++selectionRequests;
            const isLatest = (): boolean => myRequest === selectionRequests;
            enqueueBatch(async () => {
                if (!sourceGeneration.isCurrent(myGeneration) || !isLatest()) return;
                const wanted = new Set(message.filePaths.filter(path => tree.has(path)));
                for (const path of tree.keys()) {
                    if (wanted.has(path) || !sources.get(path)) continue;
                    sources.delete(path);
                    try { await request({ cmd: 'unload', filePath: path }); }
                    catch (error) {
                        if (!sourceGeneration.isCurrent(myGeneration)) return;
                        if (error instanceof RecipeWorkerResetError) { snapshot(); return; }
                        dispose(); snapshot(); announce(error instanceof Error ? error.message : String(error));
                        return;
                    }
                }
                if (!sourceGeneration.isCurrent(myGeneration)) return;
                const added = Array.from(wanted).filter(path => !sources.get(path));
                pendingTreePaths.clear();
                added.forEach(path => pendingTreePaths.add(path));
                if (!added.length) {
                    loading = false; pick.disabled = false;
                    snapshot(); return;
                }
                loading = true; pick.disabled = true;
                announce(strings.browserPreparing);
                await loadBatch(added.map(path => ({ file: tree.get(path)!, sourceId: path.slice('/sources/'.length) })), isLatest);
            });
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
    const host: WebviewHostApi = {
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
    browserWindow.__AWA_HOST__ = host;
    const superseded = new Error('Superseded by a newer tree selection');
    /**
     * Loads and analyzes files as new tracks, keeping the tracks already loaded when one file fails.
     * A newer tree selection stops the batch before its next file and settles the shared loading state itself.
     */
    async function loadBatch(files: Array<{ file: File; sourceId?: string }>, isLatest: () => boolean = () => true): Promise<void> {
        const myGeneration = sourceGeneration.current;
        const failures: string[] = [];
        await runAnalysisBatch(files, {
            isCurrent: () => sourceGeneration.isCurrent(myGeneration),
            analyze: async ({ file, sourceId = `selected-${++nextSource}.wav` }) => {
                if (!isLatest()) throw superseded;
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
                    const loaded = await request({ cmd: 'load', sourceId }, bytes);
                    if (!sourceGeneration.isCurrent(myGeneration)) throw new Error('Analysis cancelled');
                    loadedPath = String(loaded.filePath);
                    const result = await analysisClient.analyze(loadedPath, stft());
                    return { path: loadedPath, sourceId, result };
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
            commit: ({ file }, loaded) => {
                pendingTreePaths.delete(loaded.path);
                const url = URL.createObjectURL(file);
                sources.set(loaded.path, { path: loaded.path, sourceId: loaded.sourceId, name: file.name, url, inputBytes: file.size, file,
                    result: resultWithSource(loaded.result, loaded.sourceId, file.name, url) });
                snapshot();
            },
            failed: ({ file, sourceId }, error) => {
                if (error === superseded) return false;
                if (sourceId) pendingTreePaths.delete(`/sources/${sourceId}`);
                failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
                return true;
            },
        });
        if (!sourceGeneration.isCurrent(myGeneration) || !isLatest()) return;
        pendingTreePaths.clear();
        loading = false; pick.disabled = false; pick.value = '';
        if (!sources.size) dispose();
        if (folder) snapshot();
        announce(failures.length ? failures.join(' | ') : `${files.at(-1)!.file.name}: ${strings.browserReady.replace('{count}', String(sources.size))}`);
    }
    function openFiles(files: File[]): void {
        if (!files.length || loading) return;
        if (folder) {
            folder = undefined; selectionRequests++;
            emit({ type: 'directory-selection', rootPath: '', filePaths: [] });
        }
        loading = true; pick.disabled = true;
        announce(strings.browserPreparing);
        enqueueBatch(() => loadBatch(files.map(file => ({ file }))));
    }
    pick.onchange = (): void => { openFiles(Array.from(pick.files || [])); };
    const dropTarget = document.createElement('div');
    dropTarget.setAttribute('data-drop-target', '');
    dropTarget.style.cssText = 'display:none;position:fixed;inset:0;border:3px dashed #3b82f6;pointer-events:none;z-index:2147483647';
    bar.append(dropTarget);
    // Track reordering also drags inside the page, so only drags that carry OS files open sources.
    const carriesFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const showDropTarget = (active: boolean): void => { dropTarget.style.display = active ? 'block' : 'none'; };
    /** Drag events inside the recipe chart frame do not reach the top window, so the frame gets the same listeners. */
    function acceptDrops(target: Window): void {
        target.addEventListener('dragover', event => {
            if (!carriesFiles(event)) return;
            event.preventDefault();
            event.dataTransfer!.dropEffect = loading ? 'none' : 'copy';
            showDropTarget(!loading);
        });
        target.addEventListener('dragleave', event => { if (!event.relatedTarget) showDropTarget(false); });
        target.addEventListener('drop', event => {
            if (!carriesFiles(event)) return;
            event.preventDefault();
            showDropTarget(false);
            const files = Array.from(event.dataTransfer!.files).filter(file => /\.wav$/i.test(file.name));
            if (!files.length) { announce(strings.browserDropNoWav); return; }
            openFiles(files);
        });
    }
    acceptDrops(window);
    function openFolderFiles(rootName: string, files: Array<{ path: string; file: File }>): void {
        if (!files.length) { announce(strings.selectionNoSupported); return; }
        if (sources.size || loading) dispose();
        selectionRequests++;
        folder = new Map(files.map(({ path, file }) => [`/sources/${path}`, file]));
        emit({ type: 'directory-selection', rootPath: `/sources/${rootName}`, filePaths: Array.from(folder.keys()) });
        snapshot(); emit({ type: 'reanalyze-end' });
        announce(strings.browserFolderOpened.replace('{count}', String(files.length)));
    }
    /**
     * Chromium's folder input asks to "upload" the files although they never leave the page, so the
     * File System Access picker, which asks to view them instead, is preferred where it exists.
     */
    function pickFolder(): void {
        const showDirectoryPicker = (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker;
        if (!showDirectoryPicker) { folderPick.click(); return; }
        void (async () => {
            const files: Array<{ path: string; file: File }> = [];
            try {
                const root = await showDirectoryPicker.call(window, { mode: 'read' });
                await collectWavFiles(root, root.name, files);
                openFolderFiles(root.name, files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
            } catch (error) {
                if ((error as { name?: unknown } | null)?.name !== 'AbortError') announce(error instanceof Error ? error.message : String(error));
            }
        })();
    }
    openFolder.onclick = pickFolder;
    folderPick.onchange = (): void => {
        const files = Array.from(folderPick.files || []).filter(file => /\.wav$/i.test(file.name) && file.webkitRelativePath);
        folderPick.value = '';
        openFolderFiles(files[0]?.webkitRelativePath.split('/')[0] ?? '', files.map(file => ({ path: file.webkitRelativePath, file })));
    };
    cancel.onclick = (): void => {
        dispose(); pick.value = ''; snapshot(); emit({ type: 'reanalyze-end' }); announce(strings.browserCleared);
    };
    // Pyodide boots when its Worker starts, so starting it with the page keeps that wait off the first WAV load.
    worker = startWorker();
    window.addEventListener('pagehide', dispose);
    return host;
}
