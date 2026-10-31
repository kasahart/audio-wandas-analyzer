import { createIdbStore } from './idbStore';
import { SessionRequests, SourceResults } from '../../shared/analysis/analysisSession';
import { runAnalysisBatch } from '../../shared/analysis/analysisCoordinator';
import { AnalysisClient, type AnalysisCancellationSignal, type AnalysisContextPolicy } from '../../shared/analysis/analysisClient';
import { BackendProtocolError, type ScanResult, PendingBackendRequests, rejectPendingRequests, settleBackendRequest, type BackendCommand, type BackendPayload, type BackendResult } from '../../shared/protocol/backendProtocol';
import type { BrowserLimits, StageDetail } from '../../shared/protocol/generated/backendProtocolSchema';
import { parseWorkerMessage, parseWorkerResult, type WorkerCommand, type WorkerMessage, type WorkerRequest, type WorkerResult } from './workerProtocol';
import type { PanelMessage } from '../../shared/protocol/panelMessages';
import { hasPlayableAudio, isConfigureCalibrationMessage, isSupportedAudioFile, SUPPORTED_AUDIO_FILE_EXTENSIONS } from '../../shared/utils/audioTarget';
import { getStrings, pickLocale } from '../../shared/i18n/strings';
import { loadSpectrogramSettings, saveSpectrogramSettings } from '../../shared/analysis/savedSpectrogramSettings';
import { ComparisonSessionController, type ComparisonSessionPorts, type SessionScope } from '../../shared/session/comparisonSessionController';
import { RecipeFlow, recipeBaseName, type RecipeCatalogEntry } from '../../shared/recipe/recipeFlow';
import { describeInputs, isRecipeDocument, type RecipeDocument } from '../../shared/recipe/recipeSelection';
import { setHint } from './hintFooter';
import { createRecipeMenus } from './recipePicker';
import { createStaticDownloads } from './staticDownloads';
import type { HostInboundMessage } from './hostMessaging';
import type { ComparisonWindow } from './browserAdapter';
import type { ComparisonTrackState, WebviewHostApi } from './types';
import { sanitizePersistedState } from './stateStore';
import type { AnalysisResult, AnalysisResultWithError } from '../../shared/analysis/analysisTypes';
import type { ScanReference } from '../../shared/analysis/entryScan';
import { keyRouterFor } from './keyRouter';
import { choose, showRecipeCharts } from './staticDialogs';
import {
    byPath, collectDroppedSourceFiles, collectSourceFiles, createFolderKeys, inputTooLarge, listingRoot, listOpenedFiles, listOpenedFolder,
    LoadFailures, sessionFull, type FoundFile, type ShowDirectoryPicker, type SourceToLoad,
} from './staticSources';

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
    /** Files a scan must load before the Worker is replaced afterwards (20); tests lower it. */
    restartAfterScans?: number;
}

const UNAVAILABLE_ACTIONS = '[data-action="configure-calibration"]';

/** Builds the browser host on top of the given globals and installs it as `window.__AWA_HOST__`. */
export function createStaticHost(deps: StaticHostDeps): WebviewHostApi {
    // Shadow the globals so every browser access goes through deps.
    const { window, document, Worker, fetch, URL, setTimeout } = deps;
    const browserWindow = window as unknown as ComparisonWindow;
    const strings = getStrings(window.navigator?.language ?? 'en');
    /** A Worker's or the browser's own error text inside a sentence in the UI's language. */
    const failedWith = (sentence: string, error: unknown): string => sentence.replace('{error}', error instanceof Error ? error.message : String(error));
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
    const folderStore = createIdbStore((window as unknown as { indexedDB?: IDBFactory }).indexedDB, { read: readSaved, write: save });
    const settingsContext = { workspaceState: {
        get: readSaved,
        update: async (key: string, value: unknown): Promise<void> => { save(key, value); },
    } };
    // The attribute CSV is kept under its own key: a CSV too big for the storage then loses only itself.
    const CSV_STATE_KEY = `${VIEW_STATE_KEY}.csv`;
    let persisted = sanitizePersistedState({ ...(readSaved(VIEW_STATE_KEY) as object | null), entryCsv: readSaved(CSV_STATE_KEY) });
    let savedCsv = persisted.entryCsv;
    browserWindow.__APP_STATE__!.spectrogramSettings = loadSpectrogramSettings(settingsContext);
    let worker: Worker | undefined;
    let recovery: Promise<void> | undefined;
    let bootFailed = false;
    /** A Worker booting behind the current one after a folder scan (replaceWorkerBehind). */
    let spare: Worker | undefined;
    const sourceGeneration = new SessionRequests();
    const reanalysisGeneration = new SessionRequests();
    const sources = new SourceResults<Source>(new Map(), source => URL.revokeObjectURL(source.url));
    const inboundListeners = new Set<(message: unknown) => void>();
    let loading = false;
    const pending = new PendingBackendRequests<unknown, WorkerCommand>('browser-');
    // Session limits come from browser_service.py through the Worker so pre-checks, the backend and the README agree.
    let browserLimits: BrowserLimits | undefined;
    /** Caches the Worker's limits only when every field is a positive safe integer, so a skewed Worker cannot disable the pre-checks. */
    async function limits(): Promise<BrowserLimits> {
        return browserLimits ??= await request({ cmd: 'limits' });
    }
    // The status line, About and the Python dot share the footer row with the hint text, so the page has no header row.
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;align-items:center;min-width:0;max-width:60%;padding-right:8px';
    const pick = document.createElement('input');
    pick.setAttribute('data-action', 'browser-open-wav');
    pick.type = 'file'; pick.multiple = true; pick.accept = Array.from(SUPPORTED_AUDIO_FILE_EXTENSIONS).join(','); pick.setAttribute('aria-label', strings.btnOpenFile);
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
    // The lane view's status line ("3 tracks; add more") means nothing while the entry table covers the window;
    // docked beside the lanes, the lanes are on screen and their status stays.
    webStyles.textContent = 'body:has(#entry-screen.is-max:not([hidden])) #app-footer [role="status"] { visibility: hidden; }'
        + ` ${UNAVAILABLE_ACTIONS} { opacity: 0.4; cursor: not-allowed; }`
        + ' @keyframes python-dot-pulse { 50% { opacity: 0.3; } }';
    bar.append(pick, folderPick, status, about, webStyles);
    // The footer row keeps the version at its right end, after the Web controls.
    const appVersion = document.getElementById('app-version');
    if (appVersion) appVersion.before(bar, pythonIndicator);
    else (document.getElementById('app-footer') ?? document.body).append(bar, pythonIndicator);
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
        // Yellow and green are the compare and Δ roles on the new screens: the status dot stays neutral (the boot pulses).
        starting: { text: strings.browserPythonStarting, color: 'var(--muted)' },
        ready: { text: strings.browserPythonReady, color: 'var(--text)' },
        failed: { text: strings.browserPythonFailed, color: '#e5534b' },
        stopped: { text: strings.browserPythonStopped, color: 'var(--muted)' },
    };
    /** `quiet`: a restart the user did not ask for (after a folder scan) keeps to the footer dot, without the centred card. */
    function showPythonState(state: keyof typeof pythonStates, quiet = false): void {
        const { text, color } = pythonStates[state];
        const booting = state === 'starting';
        pythonState.textContent = text;
        setHint(pythonIndicator, text);
        pythonDot.style.background = color;
        pythonDot.style.animation = booting ? 'python-dot-pulse 1.2s ease-in-out infinite' : 'none';
        pythonLoading.style.display = booting && !quiet ? 'flex' : 'none';
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
    /** The listed source files keyed by the `/sources/<relative path>` each one loads under. */
    const folder = new Map<string, File>();
    const folderKeys = createFolderKeys(folder);
    /** Checked tree files that are still loading, so their checkboxes stay checked until they load or fail. */
    const pendingTreePaths = new Set<string>();
    let selectionRequests = 0;
    /** Advanced by Clear, so a folder walk that started before it does not list its files afterwards. */
    let listGeneration = 0;
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

    /** Runs `task` in the source batch queue and settles with its outcome. */
    function exclusive<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => { enqueueBatch(() => task().then(resolve, reject)); });
    }
    let entryRecipe: Promise<Record<string, unknown>> | undefined;
    /**
     * One entry-table file: loaded into the Worker only for its scan unless it is already a selected
     * track, so a folder of any size never holds more than one extra file in Pyodide.
     */
    async function scanEntryFile(path: string, region?: { start: number; end: number }, override?: Record<string, unknown>, stage?: string, detail?: StageDetail, reference?: ScanReference): Promise<ScanResult> {
        const file = folder.get(path);
        if (!file) return { ok: false, reason: strings.entrySourceGone };
        const limit = browserLimits ?? await limits();
        const tooLarge = inputTooLarge(file.size, limit, strings);
        if (tooLarge) return { ok: false, reason: tooLarge };
        const pairedFile = reference ? folder.get(reference.filePath) : undefined;
        if (reference && !pairedFile) return { ok: false, reason: strings.entrySourceGone };
        entryRecipe ??= fetchJson('./recipes/entry-scan.recipe.json') as Promise<Record<string, unknown>>;
        const recipe = override ?? await entryRecipe;
        return exclusive(async () => {
            // A file that is not a selected track is loaded into the Worker for this scan only (the reference too).
            const loaded: string[] = [];
            const workerPath = async (listed: string, bytes: File): Promise<string> => {
                if (sources.get(listed)) return listed;
                const into = (await request({ cmd: 'load', sourceId: listed.slice('/sources/'.length) }, await bytes.arrayBuffer())).filePath;
                loaded.push(into);
                return into;
            };
            try {
                const paired = reference && pairedFile ? { ...reference, filePath: await workerPath(reference.filePath, pairedFile) } : undefined;
                const over = { ...(region ? { region } : {}), ...(stage ? { stage } : {}), ...(detail ? { detail } : {}), ...(paired ? { reference: paired } : {}) };
                return await analysisClient.scan({ filePath: await workerPath(path, file), recipe, ...over });
            } finally {
                for (const into of loaded) await request({ cmd: 'unload', filePath: into }).catch(() => undefined);
            }
        });
    }

    function resetWorker(reason: Error): void {
        reanalysisGeneration.advance();
        worker?.terminate(); worker = undefined;
        spare?.terminate(); spare = undefined;
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
    async function request<K extends WorkerCommand>(
        command: WorkerRequest<K>, bytes?: ArrayBuffer, forcedRequestId?: string, cancellation?: AnalysisCancellationSignal,
    ): Promise<WorkerResult<K>> {
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
    function startWorker(quiet = false): Worker {
        const activeWorker = new Worker('./audio.worker.js', { type: 'module' });
        bootFailed = false;
        showPythonState('starting', quiet);
        attachWorker(activeWorker);
        return activeWorker;
    }
    /** Routes a Worker's replies to the pending requests while it is the current one. */
    function attachWorker(activeWorker: Worker): void {
        activeWorker.onmessage = (event: MessageEvent<unknown>): void => {
            if (worker !== activeWorker) return;
            const message = parseWorkerMessage(event.data);
            if (!message) return;
            if (message.kind === 'ready') {
                bootFailed = !message.ready;
                // The optional packages the runtime cannot import: the step bar greys out what needs them.
                if (message.lacks) browserWindow.__AWA_RUNTIME_LACKS__ = message.lacks;
                showPythonState(message.ready ? 'ready' : 'failed');
                return;
            }
            // A Worker reply is `{requestId, result}` or `{requestId, error}`; `result` holds no envelope keys.
            const { requestId, result, error, envelope, wellFormed } = message;
            if (error === undefined && !wellFormed) {
                // Rejected here because browser-only commands (load, unload, export-plan) settle without a result schema.
                const request = pending.get(requestId);
                if (!request) return;
                pending.delete(requestId);
                request.reject(new BackendProtocolError(`Invalid ${request.command} response envelope`));
                return;
            }
            settleBackendRequest(pending, requestId, error === undefined ? result : envelope, error);
        };
        activeWorker.onerror = (): void => {
            if (worker !== activeWorker) return;
            resetWorker(new Error('Analysis cancelled'));
            dispose(); snapshot();
            announce(strings.browserWorkerFailed);
            emit({ type: 'reanalyze-end' });
        };
    }
    /**
     * After a folder scan Pyodide's heap stays as large as the scan made it, so a fresh Worker takes over.
     * It boots and loads the selected tracks behind the current one, which keeps answering meanwhile; it is
     * swapped in at a moment no request is waiting, and the old one is then dropped. Nothing waits for the
     * boot. A spare that fails, or whose tracks no longer match, is dropped and the current one stays.
     */
    function replaceWorkerBehind(): void {
        if (spare || !worker) return;
        const generation = sourceGeneration.current;
        const next = new Worker('./audio.worker.js', { type: 'module' });
        spare = next;
        const replies = new Map<string, (reply: Extract<WorkerMessage, { kind: 'reply' }>) => void>();
        let calls = 0;
        const abandon = (): void => { if (spare === next) spare = undefined; next.terminate(); };
        next.onmessage = (event: MessageEvent<unknown>): void => {
            const message = parseWorkerMessage(event.data);
            if (message?.kind === 'ready') { if (!message.ready) abandon(); return; }
            if (message) replies.get(message.requestId)?.(message);
        };
        next.onerror = (): void => abandon();
        const call = (command: WorkerRequest<'limits' | 'load'>, bytes?: ArrayBuffer): Promise<void> => new Promise((resolve, reject) => {
            const requestId = `spare-${++calls}`;
            replies.set(requestId, reply => {
                replies.delete(requestId);
                try {
                    if (reply.error !== undefined || !reply.wellFormed) throw new Error('refused');
                    parseWorkerResult(command.cmd, reply.result);
                    resolve();
                } catch { reject(new Error('spare Worker refused a command')); }
            });
            next.postMessage({ ...command, requestId, bytes }, bytes ? [bytes] : []);
        });
        const loaded = new Set<string>();
        const loadMissing = async (): Promise<void> => {
            for (const source of sources.values()) {
                if (loaded.has(source.sourceId)) continue;
                await call({ cmd: 'load', sourceId: source.sourceId }, await source.file.arrayBuffer());
                loaded.add(source.sourceId);
            }
        };
        void (async () => {
            try {
                // Answered once Pyodide has booted.
                await call({ cmd: 'limits' });
                await loadMissing();
                await exclusive(async () => {
                    while (pending.size) await new Promise(resolve => setTimeout(resolve, 20));
                    // A track picked meanwhile is loaded too; one released meanwhile, or a Clear, drops the spare.
                    const current = new Set(Array.from(sources.values(), source => source.sourceId));
                    if (spare !== next || !worker || recovery || !sourceGeneration.isCurrent(generation) || [...loaded].some(id => !current.has(id))) { abandon(); return; }
                    await loadMissing();
                    const old = worker;
                    attachWorker(next);
                    worker = next;
                    spare = undefined;
                    old.terminate();
                });
            } catch { abandon(); }
        })();
    }
    /** Every success reply is checked before it settles: the shared commands by the native validator, the Worker's own by theirs. */
    function sendRequest<K extends WorkerCommand>(command: WorkerRequest<K>, bytes?: ArrayBuffer, forcedRequestId?: string): Promise<WorkerResult<K>> {
        if (!worker) {
            if (command.cmd !== 'load' && command.cmd !== 'limits') throw new Error('No selected source; choose the file again.');
            worker = startWorker();
        }
        const target = worker;
        const requestId = forcedRequestId ?? pending.nextId();
        return pending.dispatch(command.cmd, requestId, response => parseWorkerResult(command.cmd, response), () => {
            target.postMessage({ ...command, requestId, bytes }, bytes ? [bytes] : []);
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
            announce(failedWith(strings.browserAnalysisStopped, reason));
        }
        protected async request<K extends BackendCommand>(command: K, payload: BackendPayload<K>, requestId?: string, cancellation?: AnalysisCancellationSignal): Promise<BackendResult<K>> {
            return request({ ...payload, cmd: command }, undefined, requestId, cancellation);
        }
    }({ current: filePath => {
        const result = sources.get(filePath)?.result;
        return result && !('error' in result)
            ? { calibrationProfile: result.calibrationProfile, analysisRevision: result.analysisRevision } : {};
    } });
    function resultWithSource(result: AnalysisResult, sourceId: string, name: string, url: string): ComparisonTrackState {
        // A source is reported by its unique path under /sources, so the notebook can read it from there.
        return { ...result, fileName: name, audioSource: hasPlayableAudio(name) ? url : '', reportSourcePath: sourceId };
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
        catch (error) { if (!(error instanceof RecipeWorkerResetError) && sourceGeneration.isCurrent(myGeneration)) { dispose(); snapshot(); emit({ type: 'reanalyze-end' }); announce(failedWith(strings.browserRemoveFailed, error)); } }
    }
    async function fetchJson(url: string): Promise<unknown> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return response.json();
    }
    const recipeMenus = createRecipeMenus(document, window, strings);
    const downloads = createStaticDownloads({ document, URL, setTimeout });
    /** Track names, or their paths under `/sources` where two of the given tracks share a name, as the file list shows them. */
    function trackLabels(paths: string[]): (path: string) => string {
        const nameOf = (path: string): string => sources.get(path)?.name ?? recipeBaseName(path);
        const distinct = Array.from(new Set(paths));
        return path => distinct.some(other => other !== path && nameOf(other) === nameOf(path)) ? path.slice('/sources/'.length) : nameOf(path);
    }
    // A recipe opened from disk is run by its file name, so the backend titles its charts after the file.
    const localRecipes = new Map<string, File>();
    const recipeFlow = new RecipeFlow({
        listRecipes: async (): Promise<RecipeCatalogEntry[]> => {
            const manifest = await fetchJson('./recipes/manifest.json');
            if (!Array.isArray(manifest)) throw new Error('Invalid recipe manifest');
            return manifest as RecipeCatalogEntry[];
        },
        pickRecipe: async (_items, entries) => {
            const pick = await recipeMenus.pickRecipe(entries);
            localRecipes.clear();
            if (!pick || 'location' in pick) return pick?.location;
            localRecipes.set(pick.file.name, pick.file);
            return pick.file.name;
        },
        readRecipe: async location => {
            const local = localRecipes.get(location);
            const recipe: unknown = local ? JSON.parse(await local.text()) : await fetchJson(location);
            if (!isRecipeDocument(recipe)) throw new Error(`${location} is not a recipe document`);
            return recipe;
        },
        pickInputFiles: async () => { announce(strings.browserRecipeNoSources); return undefined; },
        assignInputs: (names, files, proposed) => {
            const label = trackLabels(files);
            return recipeMenus.assignInputs(names, files.map(path => ({ path, name: label(path) })), proposed);
        },
        runWithProgress: async (title, task) => { announce(title); return task(); },
        execute: async (recipe, inputs, location) => {
            if (!sources.size) throw new Error(strings.browserRecipeNoSources);
            return analysisClient.runRecipe(recipe, inputs, { recipePath: location });
        },
        showCharts: (title, charts, inputs) => {
            showRecipeCharts(document, strings, title, charts, describeInputs(inputs, trackLabels(sources.snapshot(source => source.path))), acceptDrops);
            announce(strings.browserRecipeDone + title);
        },
        showError: announce,
    }, strings);
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
            if (!sources.get(filePath)) throw new Error('Source is no longer selected; choose the file again.');
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
            const limit = browserLimits ?? await limits();
            const regions = downloads.wavRegions({ maxEntries: limit.maxSources, maxBytes: limit.maxExportBytes });
            return {
                sources: selected.map(source => ({ filePath: source.path, fileName: source.name })),
                sink: {
                    isCurrent: () => scope.isCurrent(),
                    isSelected: item => sources.get(item.filePath) === selected.find(source => source.path === item.filePath),
                    prepare: async commands => { await request({ cmd: 'export-plan', commands }); },
                    exportWavLoop: (filePath, start, end) => analysisClient.exportWavLoop(filePath, start, end),
                    write: async (_source, name, result) => { regions.add(name, result.wavBase64); },
                },
                complete(): void {
                    if (regions.complete()) announce(strings.browserExported);
                },
            };
        },
        pickReportFormat() {
            return choose<'markdown' | 'notebook'>(document, window, strings.reportFormatPlaceholder, [['markdown', strings.reportFormatMarkdown], ['notebook', strings.reportFormatNotebook]]);
        },
        async saveReport(artifact) {
            downloads.text(artifact.content, artifact.name, artifact.type);
            announce(strings.reportExportedPrefix + artifact.name);
        },
        async saveRecipe(file) {
            downloads.text(file.content, file.name, file.type);
            announce(strings.recipeSavedPrefix + file.name);
        },
        selectTarget(targetKind): void {
            if (targetKind === 'directory') pickFolder();
            // A disabled input ignores click(), so say why nothing opens.
            else if (pick.disabled) announce(strings.browserPreparing);
            else pick.click();
        },
        async selection(message): Promise<void> {
            const tree = folder;
            // Clearing every check cancels in-flight loads and frees the Worker's audio memory at once; the panel's Clear also empties the list.
            if (!message.filePaths.length) {
                selectionRequests++;
                dispose();
                if (message.clearAll) { listGeneration++; folder.clear(); emitListing(); }
                snapshot(); emit({ type: 'reanalyze-end' }); announce(strings.browserCleared);
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
                        dispose(); snapshot(); announce(failedWith(strings.browserRemoveFailed, error));
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
        // A browser cannot write a folder, so the report folder arrives as one zip named after it.
        async saveReportFolder(folder, files) {
            downloads.folder(folder, files);
            announce(strings.reportSaved + folder + '.zip');
        },
        entry: {
            identity: async path => folderKeys.identity(path),
            scan: (path, region, recipe, stage, detail, reference) => scanEntryFile(path, region, recipe, stage, detail, reference),
            recipe: async () => {
                entryRecipe ??= fetchJson('./recipes/entry-scan.recipe.json') as Promise<Record<string, unknown>>;
                return await entryRecipe as unknown as RecipeDocument;
            },
            // The picked folder's CSV/TSV files are listed beside its recordings; the browser cannot reach the folder above.
            readFile: async path => {
                const file = folder.get(path);
                if (!file) throw new Error(strings.entrySourceGone);
                return new Uint8Array(await file.arrayBuffer());
            },
            // Only the header: a slice of the file, so a folder of long recordings is read in a moment.
            readHead: async (path, length) => {
                const file = folder.get(path) ?? sources.get(path)?.file;
                if (!file) throw new Error(strings.entrySourceGone);
                return new Uint8Array(await file.slice(0, length).arrayBuffer());
            },
            // A folder's index, session and CSV in IndexedDB (they outgrow localStorage); the rest as before.
            read: async key => (folderKeys.isFolderKey(key) ? folderStore.read(await folderKeys.tagged(key)) : readSaved(key)),
            write: async (key, value) => (folderKeys.isFolderKey(key) ? folderStore.write(await folderKeys.tagged(key), value) : save(key, value)),
            // Pyodide's heap never shrinks, so after a folder scan the Worker is replaced and the selected tracks reload into it.
            // A few files (a comparison region over a base group) leave Pyodide's heap as it was; a folder's worth does not.
            afterScan: scanned => { if (scanned >= (deps.restartAfterScans ?? 20) && worker && !recovery) replaceWorkerBehind(); },
        },
    };
    const controller = new ComparisonSessionController(ports);
    const host: WebviewHostApi = {
        downloadFile: (content, name, mimeType): void => { downloads.text(content, name, mimeType); },
        releaseSource: (path): void => { void releaseSource(path); },
        onMessage: (listener): (() => void) => { inboundListeners.add(listener); return () => { inboundListeners.delete(listener); }; },
        postMessage: (message: unknown): void => {
            if (isConfigureCalibrationMessage(message)) { reportUnavailable(); return; }
            void controller.dispatch(message);
        },
        getState: () => persisted,
        setState: (state): void => {
            // Only the fields the runtime keeps are written: a key of an older page (a folder path) is not.
            persisted = sanitizePersistedState(state);
            const { entryCsv, ...view } = persisted;
            save(VIEW_STATE_KEY, view);
            if (entryCsv?.name !== savedCsv?.name || entryCsv?.text !== savedCsv?.text) { savedCsv = entryCsv; save(CSV_STATE_KEY, entryCsv ?? null); }
        },
        emptyMessage: strings.browserEmptyPrompt,
        selectionPanel: true,
    };
    browserWindow.__AWA_HOST__ = host;
    const superseded = new Error('Superseded by a newer tree selection');
    /**
     * Loads and analyzes files as new tracks, keeping the tracks already loaded when one file fails.
     * A newer tree selection stops the batch before its next file and settles the shared loading state itself.
     */
    async function loadBatch(files: SourceToLoad[], isLatest: () => boolean): Promise<void> {
        const myGeneration = sourceGeneration.current;
        const failures = new LoadFailures();
        await runAnalysisBatch(files, {
            isCurrent: () => sourceGeneration.isCurrent(myGeneration),
            analyze: async ({ file, sourceId }) => {
                if (!isLatest()) throw superseded;
                let loadedPath: string | undefined;
                try {
                    const limit = browserLimits ?? await limits();
                    const refused = inputTooLarge(file.size, limit, strings) ?? sessionFull(file.size, sources.snapshot(source => source.inputBytes), limit, strings);
                    if (refused) throw new Error(refused);
                    const bytes = await file.arrayBuffer();
                    if (!sourceGeneration.isCurrent(myGeneration)) throw new Error('Analysis cancelled');
                    const loaded = await request({ cmd: 'load', sourceId }, bytes);
                    if (!sourceGeneration.isCurrent(myGeneration)) throw new Error('Analysis cancelled');
                    loadedPath = loaded.filePath;
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
                failures.add(file.name, error);
                return true;
            },
        });
        if (!sourceGeneration.isCurrent(myGeneration) || !isLatest()) return;
        pendingTreePaths.clear();
        loading = false; pick.disabled = false; pick.value = '';
        if (!sources.size) dispose();
        snapshot();
        announce(failures.announcement(strings, files.at(-1)?.file.name ?? '', sources.size));
    }
    /** Adds individually opened files to the list beside what is already listed and loads them as checked tracks. */
    function openFiles(files: File[]): void {
        if (loading) return;
        const readable = files.filter(file => isSupportedAudioFile(file.name));
        if (!readable.length) { announce(strings.browserDropNoWav); return; }
        // Picking an unchecked top-level file again checks its entry; a file from an opened folder, or one already loaded, gets its own top-level entry.
        const added = listOpenedFiles(folder, readable, path => !sources.get(path) && !pendingTreePaths.has(path));
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
            const myList = listGeneration;
            void (async () => {
                try {
                    for (const entry of folders) {
                        const found: FoundFile[] = [];
                        await collectDroppedSourceFiles(entry, entry.name, found);
                        if (myList !== listGeneration) return;
                        openFolderFiles(entry.name, found.sort(byPath));
                    }
                    if (files.length) openFiles(files);
                } catch (error) { announce(failedWith(strings.browserFolderReadFailed, error)); }
            })();
        });
    }
    acceptDrops(window);
    function emitListing(entry = false): void {
        const paths = Array.from(folder.keys());
        emit({ type: 'directory-selection', ...listingRoot(paths), filePaths: paths, ...(entry ? { entry } : {}) });
    }
    /** Adds an opened folder to the list beside what is already listed; its files stay unchecked until picked in the tree. */
    function openFolderFiles(rootName: string, files: FoundFile[]): void {
        if (!files.length) { announce(strings.selectionNoSupported); return; }
        // Opening a listed folder again keeps its entries; a different folder with a taken name gets a suffix.
        if (!listOpenedFolder(folder, rootName, files)) { announce(strings.browserFolderOpened.replace('{count}', String(files.length))); return; }
        // An opened folder starts on the entry table.
        emitListing(true);
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
            const files: FoundFile[] = [];
            try {
                const root = await showDirectoryPicker.call(window, { mode: 'read' });
                const myList = listGeneration;
                await collectSourceFiles(root, root.name, files);
                if (myList !== listGeneration) return;
                openFolderFiles(root.name, files.sort(byPath));
            } catch (error) {
                if ((error as { name?: unknown } | null)?.name !== 'AbortError') announce(failedWith(strings.browserFolderReadFailed, error));
            }
        })();
    }
    folderPick.onchange = (): void => {
        const files = Array.from(folderPick.files || []).filter(file => isSupportedAudioFile(file.name) && file.webkitRelativePath);
        folderPick.value = '';
        openFolderFiles(files[0]?.webkitRelativePath.split('/')[0] ?? '', files.map(file => ({ path: file.webkitRelativePath, file })));
    };
    // Pyodide boots when its Worker starts, so starting it with the page keeps that wait off the first file load.
    worker = startWorker();
    window.addEventListener('pointerdown', event => { if (about.open && !about.contains(event.target as Node)) about.open = false; });
    window.addEventListener('resize', clampAbout);
    keyRouterFor(window).add({
        layer: 'popover',
        keydown(event) {
            if (!about.open || event.key !== 'Escape') return false;
            about.open = false;
            aboutToggle.focus();
            return true;
        },
    });
    // Leaving the page always stops Python, so a back-forward cached page does not keep the runtime resident.
    window.addEventListener('pagehide', () => { resetWorker(new Error('Analysis cancelled')); dispose(); });
    return host;
}
