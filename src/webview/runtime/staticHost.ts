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
import { setHint } from './hintFooter';
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

const readEntryBatch = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => new Promise((resolve, reject) => reader.readEntries(resolve, reject));

/** A dropped folder arrives as an entry whose reader returns its children in batches until an empty one. */
async function collectDroppedWavFiles(directory: FileSystemDirectoryEntry, prefix: string, found: Array<{ path: string; file: File }>): Promise<void> {
    const reader = directory.createReader();
    for (let batch = await readEntryBatch(reader); batch.length; batch = await readEntryBatch(reader)) {
        for (const entry of batch) {
            const path = `${prefix}/${entry.name}`;
            if (entry.isDirectory) await collectDroppedWavFiles(entry as FileSystemDirectoryEntry, path, found);
            else if (/\.wav$/i.test(entry.name)) found.push({ path, file: await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)) });
        }
    }
}

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

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

const UNAVAILABLE_ACTIONS = '[data-action="configure-calibration"]';

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
    // The status line, About and the Python dot share the footer row with the hint text, so the page has no header row.
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;align-items:center;min-width:0;max-width:60%;padding-right:8px';
    const pick = document.createElement('input');
    pick.setAttribute('data-action', 'browser-open-wav');
    pick.type = 'file'; pick.multiple = true; pick.accept = '.wav,audio/wav'; pick.setAttribute('aria-label', strings.btnOpenFile);
    // The native file input labels itself in the browser's UI language, so a page-language button opens it instead.
    pick.style.cssText = 'display:none';
    const folderPick = document.createElement('input');
    folderPick.type = 'file'; folderPick.multiple = true; folderPick.setAttribute('webkitdirectory', '');
    folderPick.style.cssText = 'display:none';
    // Python's state is a coloured dot at the footer's right end; its text stays for screen readers and the hover hint.
    const pythonIndicator = document.createElement('span');
    pythonIndicator.setAttribute('data-python-indicator', '');
    pythonIndicator.style.cssText = 'display:flex;align-items:center;flex-shrink:0;padding-right:10px';
    const pythonDot = document.createElement('span');
    pythonDot.style.cssText = 'width:8px;height:8px;border-radius:50%';
    const pythonState = document.createElement('span');
    pythonState.setAttribute('data-python-state', '');
    pythonState.setAttribute('aria-live', 'polite');
    pythonState.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    pythonIndicator.append(pythonDot, pythonState);
    // Limits and unavailable features matter only to some visitors, so they sit behind a disclosure instead of a permanent paragraph.
    const about = document.createElement('details');
    about.setAttribute('data-browser-about', '');
    about.style.cssText = 'position:relative';
    const aboutToggle = document.createElement('summary');
    aboutToggle.setAttribute('data-action', 'browser-about');
    aboutToggle.textContent = strings.browserAbout;
    aboutToggle.style.cssText = 'cursor:pointer;list-style:none;color:var(--muted);white-space:nowrap';
    setHint(aboutToggle, strings.hintBrowserAbout);
    const aboutPanel = document.createElement('ul');
    aboutPanel.style.cssText = 'position:absolute;bottom:calc(100% + 6px);right:0;z-index:60;width:max-content;max-width:min(480px,calc(100vw - 16px));margin:0;'
        + 'padding:10px 14px 10px 28px;display:grid;gap:4px;background:var(--panel);color:var(--text);border:1px solid var(--line);'
        + 'border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.35);font-size:13px;line-height:1.5';
    for (const text of [strings.browserAboutPrivacy, strings.browserAboutFileLimits, strings.browserAboutSessionLimits, strings.browserAboutRecipes, strings.browserAboutUnsupported]) {
        const item = document.createElement('li');
        item.textContent = text;
        aboutPanel.append(item);
    }
    about.append(aboutToggle, aboutPanel);
    // The disclosure sits at the footer's right end, so the panel opens leftwards and shifts back inside a window narrower than it.
    const clampAbout = (): void => {
        if (!about.open) return;
        aboutPanel.style.right = '0px';
        const overflow = 8 - aboutPanel.getBoundingClientRect().left;
        if (overflow > 0) aboutPanel.style.right = `${-overflow}px`;
    };
    about.ontoggle = clampAbout;
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    status.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    // Web-only rules: room for the Python dot in the footer, and greyed-out actions the browser version cannot run.
    const webStyles = document.createElement('style');
    webStyles.textContent = '#web-footer { display: flex; align-items: center; flex-shrink: 0; height: 22px; font-size: 11px; color: var(--muted);'
        + ' background: var(--panel); border-top: 1px solid var(--line); }'
        + ' #web-footer > #hint-footer { flex: 1; min-width: 0; border-top: 0; }'
        + ` ${UNAVAILABLE_ACTIONS} { opacity: 0.4; cursor: not-allowed; }`
        + ' @keyframes python-dot-pulse { 50% { opacity: 0.3; } }';
    bar.append(pick, folderPick, status, about, webStyles);
    const footerRow = document.createElement('div');
    footerRow.id = 'web-footer';
    const hintFooter = document.getElementById('hint-footer');
    if (hintFooter?.parentElement) { hintFooter.before(footerRow); footerRow.append(hintFooter); }
    else document.body.append(footerRow);
    footerRow.append(bar, pythonIndicator);
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
    const pythonStates = {
        starting: { text: strings.browserPythonStarting, color: '#d29922' },
        ready: { text: strings.browserPythonReady, color: '#3fb950' },
        failed: { text: strings.browserPythonFailed, color: '#e5534b' },
        stopped: { text: strings.browserPythonStopped, color: 'var(--muted)' },
    };
    function showPythonState(state: keyof typeof pythonStates): void {
        const { text, color } = pythonStates[state];
        const booting = state === 'starting';
        pythonState.textContent = text;
        setHint(pythonIndicator, text);
        pythonDot.style.background = color;
        pythonDot.style.animation = booting ? 'python-dot-pulse 1.2s ease-in-out infinite' : 'none';
        pythonLoading.style.display = booting ? 'flex' : 'none';
    }
    const announce = (value: string): void => { status.textContent = value; };
    const showInFooter = (value: string): void => { const footer = document.getElementById('hint-footer'); if (footer) footer.textContent = value; };
    // Window listeners run around the runtime's document ones: the capture-phase click stops the action first,
    // and the bubble-phase mouseover replaces the hint the runtime has just shown.
    const unavailableTarget = (event: Event): Element | null | undefined => (event.target as Element | null)?.closest?.(UNAVAILABLE_ACTIONS);
    // The footer is aria-hidden, so a visually hidden live region carries the same message to screen readers.
    const unavailableAnnouncer = document.createElement('span');
    unavailableAnnouncer.setAttribute('aria-live', 'polite');
    unavailableAnnouncer.style.cssText = pythonState.style.cssText;
    bar.append(unavailableAnnouncer);
    const reportUnavailable = (): void => {
        showInFooter(strings.browserUnavailable);
        unavailableAnnouncer.textContent = strings.browserUnavailable;
    };
    window.addEventListener('click', event => {
        if (!unavailableTarget(event)) return;
        event.stopPropagation(); event.preventDefault();
        reportUnavailable();
    }, true);
    window.addEventListener('mouseover', event => { if (unavailableTarget(event)) showInFooter(strings.browserUnavailable); });
    // The runtime builds these buttons, so they are marked unavailable for assistive technology when they gain focus.
    window.addEventListener('focusin', event => {
        const target = unavailableTarget(event);
        if (!target) return;
        target.setAttribute('aria-disabled', 'true');
        target.setAttribute('aria-description', strings.browserUnavailable);
    });
    const emit = (message: HostInboundMessage): void => { inboundListeners.forEach(listener => listener(message)); };
    /** The listed WAV files keyed by the `/sources/<relative path>` each one loads under. */
    const folder = new Map<string, File>();
    /** Checked tree files that are still loading, so their checkboxes stay checked until they load or fail. */
    const pendingTreePaths = new Set<string>();
    let selectionRequests = 0;
    const snapshot = (): void => {
        const results = sources.snapshot(source => source.result);
        emit({ type: 'analysis-update', results, selectedFilePaths: Array.from(folder.keys()).filter(path => sources.get(path) || pendingTreePaths.has(path)) });
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
        showPythonState('stopped');
        recovery = undefined;
        rejectPendingRequests(pending, reason);
    }
    /** Drops every source; an idle Worker only releases them, so Pyodide boots once per page. */
    function dispose(): void {
        sourceGeneration.advance();
        // Python cannot interrupt a running command, so work still in flight is cancelled by restarting the Worker.
        if (pending.size || recovery) resetWorker(new Error('Analysis cancelled'));
        else if (worker) {
            reanalysisGeneration.advance();
            const kept = worker;
            // A Worker that cannot clear (a failed boot, or an older cached script) is replaced so no source outlives Clear.
            sendRequest({ cmd: 'clear' }).catch(() => { if (worker === kept) resetWorker(new Error('Analysis cancelled')); });
        }
        loading = false; pick.disabled = false; pick.value = ""; folderPick.value = "";
        pendingTreePaths.clear();
        sources.clear();
    }
    async function request(
        command: Record<string, unknown>, bytes?: ArrayBuffer, forcedRequestId?: string, cancellation?: AnalysisCancellationSignal,
    ): Promise<Record<string, unknown>> {
        // A Worker whose boot failed is replaced first, so retained sources are replayed into its successor.
        if (bootFailed) resetWorker(new Error(strings.browserPythonFailed));
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
        showPythonState('starting');
        activeWorker.onmessage = (event: MessageEvent<{ requestId: string; result?: Record<string, unknown>; error?: unknown; ready?: boolean }>): void => {
            if (worker !== activeWorker) return;
            if (event.data.ready !== undefined) {
                bootFailed = !event.data.ready;
                showPythonState(event.data.ready ? 'ready' : 'failed');
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
        // A source is reported by its unique path under /sources, so the notebook can read it from there.
        return { ...result, fileName: name, audioSource: url, reportSourcePath: sourceId } as unknown as ComparisonTrackState;
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
        if (folder.has(path)) snapshot();
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
        document.body.prepend(panel);
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
            // A disabled input ignores click(), so say why nothing opens.
            else if (pick.disabled) announce(strings.browserPreparing);
            else pick.click();
        },
        async selection(message): Promise<void> {
            const tree = folder;
            // Clearing every check is the Web's Clear: it cancels in-flight loads and frees the Worker's audio memory at once.
            if (!message.filePaths.length) {
                selectionRequests++;
                dispose(); snapshot(); emit({ type: 'reanalyze-end' }); announce(strings.browserCleared);
                return;
            }
            if (!tree.size) return;
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
        unsupported: reportUnavailable,
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
            if (isConfigureCalibrationMessage(message)) { reportUnavailable(); return; }
            void controller.dispatch(message);
        },
        getState: () => persisted,
        setState: (state): void => { persisted = state; save(VIEW_STATE_KEY, { contentType: state.contentType }); },
        emptyMessage: strings.browserEmptyPrompt,
        selectionPanel: true,
    };
    browserWindow.__AWA_HOST__ = host;
    const superseded = new Error('Superseded by a newer tree selection');
    /**
     * Loads and analyzes files as new tracks, keeping the tracks already loaded when one file fails.
     * A newer tree selection stops the batch before its next file and settles the shared loading state itself.
     */
    async function loadBatch(files: Array<{ file: File; sourceId: string }>, isLatest: () => boolean): Promise<void> {
        const myGeneration = sourceGeneration.current;
        const failures: string[] = [];
        await runAnalysisBatch(files, {
            isCurrent: () => sourceGeneration.isCurrent(myGeneration),
            analyze: async ({ file, sourceId }) => {
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
                pendingTreePaths.delete(`/sources/${sourceId}`);
                failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
                return true;
            },
        });
        if (!sourceGeneration.isCurrent(myGeneration) || !isLatest()) return;
        pendingTreePaths.clear();
        loading = false; pick.disabled = false; pick.value = '';
        if (!sources.size) dispose();
        snapshot();
        announce(failures.length ? failures.join(' | ') : `${files.at(-1)!.file.name}: ${strings.browserReady.replace('{count}', String(sources.size))}`);
    }
    /** Adds individually opened files to the list beside what is already listed and loads them as checked tracks. */
    function openFiles(files: File[]): void {
        if (loading) return;
        const wavs = files.filter(file => /\.wav$/i.test(file.name));
        if (!wavs.length) { announce(strings.browserDropNoWav); return; }
        const listed = Array.from(folder);
        const added = wavs.map(file => {
            // Picking an unchecked top-level file again checks its entry; a file from an opened folder, or one already loaded, gets its own top-level entry.
            const same = listed.find(([path, entry]) => path.split('/').length === 3 && !sources.get(path) && !pendingTreePaths.has(path)
                && entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified);
            if (same) { pendingTreePaths.add(same[0]); return { file, sourceId: same[0].slice('/sources/'.length) }; }
            const stem = file.name.replace(/\.wav$/i, '').replace(/[\\/\u0000-\u001f]/g, '_');
            let sourceId = `${stem}.wav`;
            for (let n = 2; folder.has(`/sources/${sourceId}`); n++) sourceId = `${stem} (${n}).wav`;
            folder.set(`/sources/${sourceId}`, file);
            return { file, sourceId };
        });
        const myRequest = ++selectionRequests;
        emitListing();
        added.forEach(({ sourceId }) => pendingTreePaths.add(`/sources/${sourceId}`));
        snapshot();
        loading = true; pick.disabled = true;
        announce(strings.browserPreparing);
        enqueueBatch(() => loadBatch(added, () => myRequest === selectionRequests));
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
            // The transfer is emptied once the handler returns, so folder entries and files are taken out first.
            const folders = Array.from(event.dataTransfer!.items ?? []).map(item => item.webkitGetAsEntry?.())
                .filter((entry): entry is FileSystemDirectoryEntry => !!entry?.isDirectory);
            const files = Array.from(event.dataTransfer!.files).filter(file => !folders.some(entry => entry.name === file.name));
            if (!folders.length) { openFiles(files); return; }
            void (async () => {
                try {
                    for (const entry of folders) {
                        const found: Array<{ path: string; file: File }> = [];
                        await collectDroppedWavFiles(entry, entry.name, found);
                        openFolderFiles(entry.name, found.sort(byPath));
                    }
                    if (files.length) openFiles(files);
                } catch (error) { announce(error instanceof Error ? error.message : String(error)); }
            })();
        });
    }
    acceptDrops(window);
    /** A list that holds one folder and nothing else is shown under that folder's name; any other list is shown from /sources. */
    function emitListing(): void {
        const paths = Array.from(folder.keys());
        const roots = new Set(paths.map(path => path.split('/')[2]));
        const only = roots.size === 1 && paths.every(path => path.split('/').length > 3) ? Array.from(roots)[0] : '';
        emit({ type: 'directory-selection', rootPath: only ? `/sources/${only}` : '/sources', rootLabel: only, filePaths: paths });
    }
    /** Adds an opened folder to the list beside what is already listed; its files stay unchecked until picked in the tree. */
    function openFolderFiles(rootName: string, files: Array<{ path: string; file: File }>): void {
        if (!files.length) { announce(strings.selectionNoSupported); return; }
        const inFolder = files.map(({ path, file }) => ({ rest: path.slice(rootName.length), file }));
        const listedUnder = (name: string): string[] => Array.from(folder.keys()).filter(path => path === `/sources/${name}` || path.startsWith(`/sources/${name}/`));
        // Opening a listed folder again keeps its entries; a different folder with a taken name gets a suffix.
        let name = rootName;
        for (let n = 2; listedUnder(name).length; n++) {
            const same = listedUnder(name).length === inFolder.length && inFolder.every(({ rest, file }) => {
                const entry = folder.get(`/sources/${name}${rest}`);
                return entry && entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified;
            });
            if (same) { announce(strings.browserFolderOpened.replace('{count}', String(files.length))); return; }
            name = `${rootName} (${n})`;
        }
        inFolder.forEach(({ rest, file }) => folder.set(`/sources/${name}${rest}`, file));
        emitListing();
        snapshot();
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
                openFolderFiles(root.name, files.sort(byPath));
            } catch (error) {
                if ((error as { name?: unknown } | null)?.name !== 'AbortError') announce(error instanceof Error ? error.message : String(error));
            }
        })();
    }
    folderPick.onchange = (): void => {
        const files = Array.from(folderPick.files || []).filter(file => /\.wav$/i.test(file.name) && file.webkitRelativePath);
        folderPick.value = '';
        openFolderFiles(files[0]?.webkitRelativePath.split('/')[0] ?? '', files.map(file => ({ path: file.webkitRelativePath, file })));
    };
    // Pyodide boots when its Worker starts, so starting it with the page keeps that wait off the first WAV load.
    worker = startWorker();
    window.addEventListener('pointerdown', event => { if (about.open && !about.contains(event.target as Node)) about.open = false; });
    window.addEventListener('resize', clampAbout);
    window.addEventListener('keydown', event => { if (about.open && event.key === 'Escape') { about.open = false; aboutToggle.focus(); } });
    // Leaving the page always stops Python, so a back-forward cached page does not keep the runtime resident.
    window.addEventListener('pagehide', () => { resetWorker(new Error('Analysis cancelled')); dispose(); });
    return host;
}
