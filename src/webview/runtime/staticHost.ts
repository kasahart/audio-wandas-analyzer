import { createIdbStore } from './idbStore';
import { SessionRequests, SourceResults } from '../../shared/analysis/analysisSession';
import { runAnalysisBatch } from '../../shared/analysis/analysisCoordinator';
import { AnalysisClient, type AnalysisCancellationSignal, type AnalysisContextPolicy } from '../../shared/analysis/analysisClient';
import { userErrorText, type ScanResult, type BackendCommand, type BackendPayload, type BackendResult } from '../../shared/protocol/backendProtocol';
import type { BrowserLimits, StageDetail } from '../../shared/protocol/generated/backendProtocolSchema';
import { createWorkerConnection } from './staticWorker';
import type { PanelMessage } from '../../shared/protocol/panelMessages';
import { hasPlayableAudio, isSupportedAudioFile } from '../../shared/utils/audioTarget';
import { getStrings, pickLocale } from '../../shared/i18n/strings';
import { loadSpectrogramSettings, saveSpectrogramSettings } from '../../shared/analysis/savedSpectrogramSettings';
import { ComparisonSessionController, type ComparisonSessionPorts, type SessionScope } from '../../shared/session/comparisonSessionController';
import { RecipeFlow, recipeBaseName, type RecipeCatalogEntry } from '../../shared/recipe/recipeFlow';
import { describeInputs, isRecipeDocument, type RecipeDocument } from '../../shared/recipe/recipeSelection';
import { createRecipeMenus } from './recipePicker';
import { createStaticDownloads } from './staticDownloads';
import type { HostInboundMessage } from './hostMessaging';
import type { ComparisonWindow } from './browserAdapter';
import type { ComparisonTrackState, WebviewHostApi } from './types';
import { sanitizePersistedState } from './stateStore';
import type { AnalysisResult, AnalysisResultWithError } from '../../shared/analysis/analysisTypes';
import type { ScanReference } from '../../shared/analysis/entryScan';
import { choose, showRecipeCharts } from './staticDialogs';
import { createStaticFooter } from './staticFooter';
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

function missingBootstrap(): never {
    throw new Error('Comparison Webview bootstrap data is unavailable');
}

/** Builds the browser host on top of the given globals and installs it as `window.__AWA_HOST__`. */
export function createStaticHost(deps: StaticHostDeps): WebviewHostApi {
    // Shadow the globals so every browser access goes through deps.
    const { window, document, Worker, fetch, URL, setTimeout } = deps;
    const browserWindow = window as unknown as ComparisonWindow;
    const strings = getStrings(window.navigator?.language ?? 'en');
    /** A Worker's or the browser's own error text inside a sentence in the UI's language. */
    const failedWith = (sentence: string, error: unknown): string => sentence.replace('{error}', () => userErrorText(error, strings));
    browserWindow.__APP_STRINGS__ = strings;
    const locale = pickLocale(window.navigator?.language ?? 'en');
    browserWindow.__APP_LOCALE__ = locale;
    if (document.documentElement) document.documentElement.lang = locale;
    document.title = strings.panelTitle;
    const VIEW_STATE_KEY = 'audioWandasAnalyzer.viewState';
    function readSaved(key: string): unknown {
        try { return JSON.parse(window.localStorage.getItem(key) ?? 'null'); } catch { return undefined; }
    }
    function save(key: string, value: unknown): void {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be denied or full; keep working in memory. */ }
    }
    const folderStore = createIdbStore(window.indexedDB, { read: readSaved, write: save });
    const settingsContext = { workspaceState: {
        get: readSaved,
        update: async (key: string, value: unknown): Promise<void> => { save(key, value); },
    } };
    // The attribute CSV is kept under its own key: a CSV too big for the storage then loses only itself.
    const CSV_STATE_KEY = `${VIEW_STATE_KEY}.csv`;
    let persisted = sanitizePersistedState({ ...(readSaved(VIEW_STATE_KEY) as object | null), entryCsv: readSaved(CSV_STATE_KEY) });
    let savedCsv = persisted.entryCsv;
    // The page script sets the state before this bundle runs; the runtime reads and updates the same object.
    const appState = browserWindow.__APP_STATE__ ?? missingBootstrap();
    appState.spectrogramSettings = loadSpectrogramSettings(settingsContext);
    const sourceGeneration = new SessionRequests();
    const reanalysisGeneration = new SessionRequests();
    const sources = new SourceResults<Source>(new Map(), source => URL.revokeObjectURL(source.url));
    const inboundListeners = new Set<(message: unknown) => void>();
    let loading = false;
    const audioWorker = createWorkerConnection({
        Worker, setTimeout, sources, sourceGeneration, exclusive,
        showState: (state, quiet) => showPythonState(state, quiet),
        reportLacks: lacks => { browserWindow.__AWA_RUNTIME_LACKS__ = lacks; },
        cancelReanalysis: () => { reanalysisGeneration.advance(); },
        crashed: () => {
            dispose(); snapshot();
            announce(strings.browserWorkerFailed);
            emit({ type: 'reanalyze-end' });
        },
        bootFailedReason: strings.browserPythonFailed,
    });
    // Session limits come from browser_service.py through the Worker so pre-checks, the backend and the README agree.
    let browserLimits: BrowserLimits | undefined;
    /** Caches the Worker's limits only when every field is a positive safe integer, so a skewed Worker cannot disable the pre-checks. */
    async function limits(): Promise<BrowserLimits> {
        return browserLimits ??= await audioWorker.request({ cmd: 'limits' });
    }
    const { bar, pick, folderPick, announce, showPythonState, reportUnavailable } = createStaticFooter(document, window, strings);
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
    let entryRecipe: Promise<RecipeDocument> | undefined;
    function loadEntryRecipe(): Promise<RecipeDocument> {
        const location = './recipes/entry-scan.recipe.json';
        return entryRecipe ??= fetchJson(location).then(recipe => {
            if (!isRecipeDocument(recipe)) throw new Error(`${location} is not a recipe document`);
            return recipe;
        });
    }
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
        const recipe = override ?? await loadEntryRecipe();
        return exclusive(async () => {
            // A file that is not a selected track is loaded into the Worker for this scan only (the reference too).
            const loaded: string[] = [];
            const workerPath = async (listed: string, bytes: File): Promise<string> => {
                if (sources.get(listed)) return listed;
                const into = (await audioWorker.request({ cmd: 'load', sourceId: listed.slice('/sources/'.length) }, await bytes.arrayBuffer())).filePath;
                loaded.push(into);
                return into;
            };
            try {
                const paired = reference && pairedFile ? { ...reference, filePath: await workerPath(reference.filePath, pairedFile) } : undefined;
                const over = { ...(region ? { region } : {}), ...(stage ? { stage } : {}), ...(detail ? { detail } : {}), ...(paired ? { reference: paired } : {}) };
                return await analysisClient.scan({ filePath: await workerPath(path, file), recipe, ...over });
            } finally {
                for (const into of loaded) await audioWorker.request({ cmd: 'unload', filePath: into }).catch(() => undefined);
            }
        });
    }

    /** Drops every source; an idle Worker only releases them, so Pyodide boots once per page. */
    function dispose(): void {
        sourceGeneration.advance();
        audioWorker.clear();
        loading = false; pick.disabled = false; pick.value = ""; folderPick.value = "";
        pendingTreePaths.clear();
        sources.clear();
    }
    function stft() {
        return appState.spectrogramSettings.auto ? {} : { stftOptions: appState.spectrogramSettings.stft };
    }
    const analysisClient = new class extends AnalysisClient {
        constructor(policy: AnalysisContextPolicy) {
            super(policy);
            if (deps.recipeTimeoutMs !== undefined) this.recipeTimeoutMs = deps.recipeTimeoutMs;
        }
        protected override cancelRequest(requestId: string, reason: Error): void {
            if (!audioWorker.isWaiting(requestId)) return;
            audioWorker.reset(new RecipeWorkerResetError(reason.message));
            emit({ type: 'reanalyze-end' });
            announce(failedWith(strings.browserAnalysisStopped, reason));
        }
        protected async request<K extends BackendCommand>(command: K, payload: BackendPayload<K>, requestId?: string, cancellation?: AnalysisCancellationSignal): Promise<BackendResult<K>> {
            return audioWorker.request({ ...payload, cmd: command }, undefined, requestId, cancellation);
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
        try { await audioWorker.request({ cmd: 'unload', filePath: path }); }
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
        strings,
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
            appState.spectrogramSettings = settings;
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
            if (audioWorker.running && sources.get(filePath)) return analysisClient.releaseTrackDetail(filePath);
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
                    prepare: async commands => { await audioWorker.request({ cmd: 'export-plan', commands }); },
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
                    try { await audioWorker.request({ cmd: 'unload', filePath: path }); }
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
                await loadBatch(added.flatMap(path => {
                    const file = tree.get(path);
                    return file ? [{ file, sourceId: path.slice('/sources/'.length) }] : [];
                }), isLatest);
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
            recipe: loadEntryRecipe,
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
            afterScan: scanned => { if (scanned >= (deps.restartAfterScans ?? 20) && audioWorker.running && !audioWorker.recovering) audioWorker.replaceBehind(); },
        },
    };
    const controller = new ComparisonSessionController(ports);
    const host: WebviewHostApi = {
        downloadFile: (content, name, mimeType): void => { downloads.text(content, name, mimeType); },
        releaseSource: (path): void => { void releaseSource(path); },
        onMessage: (listener): (() => void) => { inboundListeners.add(listener); return () => { inboundListeners.delete(listener); }; },
        postMessage: (message: unknown): void => { void controller.dispatch(message); },
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
                    const loaded = await audioWorker.request({ cmd: 'load', sourceId }, bytes);
                    if (!sourceGeneration.isCurrent(myGeneration)) throw new Error('Analysis cancelled');
                    loadedPath = loaded.filePath;
                    const result = await analysisClient.analyze(loadedPath, stft());
                    return { path: loadedPath, sourceId, result };
                } catch (error) {
                    if (!(error instanceof RecipeWorkerResetError) && sourceGeneration.isCurrent(myGeneration) && loadedPath) {
                        try { await audioWorker.request({ cmd: 'unload', filePath: loadedPath }); }
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
    const carriedFiles = (event: DragEvent): DataTransfer | undefined => (
        Array.from(event.dataTransfer?.types ?? []).includes('Files') ? event.dataTransfer ?? undefined : undefined);
    const showDropTarget = (active: boolean): void => { dropTarget.style.display = active ? 'block' : 'none'; };
    /** Drag events inside the recipe chart frame do not reach the top window, so the frame gets the same listeners. */
    function acceptDrops(target: Window): void {
        target.addEventListener('dragover', event => {
            const transfer = carriedFiles(event);
            if (!transfer) return;
            event.preventDefault();
            transfer.dropEffect = loading ? 'none' : 'copy';
            showDropTarget(!loading);
        });
        target.addEventListener('dragleave', event => { if (!event.relatedTarget) showDropTarget(false); });
        target.addEventListener('drop', event => {
            const transfer = carriedFiles(event);
            if (!transfer) return;
            event.preventDefault();
            showDropTarget(false);
            // The transfer is emptied once the handler returns, so folder entries and files are taken out first.
            const folders = Array.from(transfer.items ?? []).map(item => item.webkitGetAsEntry?.())
                .filter((entry): entry is FileSystemDirectoryEntry => !!entry?.isDirectory);
            const files = Array.from(transfer.files).filter(file => !folders.some(entry => entry.name === file.name));
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
        const showDirectoryPicker = 'showDirectoryPicker' in window ? window.showDirectoryPicker as ShowDirectoryPicker : undefined;
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
    audioWorker.start();
    // Leaving the page always stops Python, so a back-forward cached page does not keep the runtime resident.
    window.addEventListener('pagehide', () => { audioWorker.reset(new Error('Analysis cancelled')); dispose(); });
    return host;
}
