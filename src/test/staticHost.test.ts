import { DEFAULT_SPECTROGRAM_SETTINGS } from '../shared/analysis/analysisTypes';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStaticHost, type StaticHostDeps } from '../webview/runtime/staticHost';
import { withoutResponseEnvelope } from '../shared/protocol/schemaValidation';
import type { WebviewHostApi } from '../webview/runtime/types';
import type { UiStrings } from '../shared/i18n/strings';

class MockElement {
    style = {};
    value = '';
    disabled = false;
    multiple = false;
    accept = '';
    textContent = '';
    id = '';
    src = '';
    attributes: Record<string, string> = {};
    children: MockElement[] = [];
    removed = false;
    className = '';
    type = '';
    hidden = false;
    files?: Array<{ size: number; name: string; webkitRelativePath?: string; lastModified?: number; arrayBuffer?(): Promise<ArrayBuffer>; text?(): Promise<string> }>;
    onchange?: () => void;
    onclick?: () => void;
    contentDocument?: MockDocument;
    contentWindow?: Record<string, unknown>;
    constructor(readonly tag: string) {
        if (tag === 'iframe') { this.contentDocument = new MockDocument(); this.contentWindow = { addEventListener: () => undefined }; }
    }
    setAttribute(name: string, value: string): void { this.attributes[name] = value; }
    append(...nodes: MockElement[]): void { this.children.push(...nodes); }
    insertAdjacentElement(_where: string, node: MockElement): void { this.children.push(node); }
    remove(): void { this.removed = true; }
    click(): void {}
    focus(): void {}
    contains(node: unknown): boolean { return node === this || this.children.some(child => child.contains(node)); }
    querySelector(tag: string): MockElement | null { return this.children.find(child => child.tag === tag) ?? null; }
}
class MockDocument {
    head = new MockElement('head');
    body = new MockElement('body');
    createElement(tag: string): MockElement { return new MockElement(tag); }
}

function harness(storage = new Map<string, string>(), language = 'en', denied = false, recipeTimeout = 120_000) {
    const elements: MockElement[] = [];
    const footer = new MockElement('div');
    const fetched: string[] = [];
    const prompts: string[] = [];
    let promptAnswer: string | null = '1';
    // How the recipe menu is answered once it opens: an entry index, a local file, or Escape.
    let recipeAnswer: number | { name: string; text: string } | 'escape' = 0;
    const recipeMenus: string[][] = [];
    const assignMenus: string[][] = [];
    let assignAnswer: ((menu: MockElement) => void) | undefined;
    const documentListeners = new Map<string, (event: unknown) => void>();
    function answerRecipeMenu(menu: MockElement): void {
        const run = menu.children.find(child => child.attributes['data-action'] === 'browser-recipe-run');
        if (run) {
            // The input assignment keeps the proposed files unless a test changes the selects first.
            assignMenus.push(menu.children.filter(child => child.tag === 'label').map(row => `${row.children[0].textContent}=${row.children[1].value}`));
            queueMicrotask(() => { assignAnswer?.(menu); run.onclick!(); });
            return;
        }
        const entries = menu.children.filter(child => child.attributes['data-action'] === 'browser-recipe-pick');
        recipeMenus.push(menu.children.filter(child => child.tag === 'button').map(child => child.textContent));
        queueMicrotask(() => {
            if (recipeAnswer === 'escape') documentListeners.get('keydown')!({ key: 'Escape', preventDefault: () => undefined, stopPropagation: () => undefined });
            else if (typeof recipeAnswer === 'number') entries[recipeAnswer].onclick!();
            else {
                const { name, text } = recipeAnswer;
                const input = menu.children.find(child => child.tag === 'input')!;
                input.files = [{ size: text.length, name, text: async () => text }];
                input.onchange!();
            }
        });
    }
    const served: Record<string, unknown> = {
        './recipes/manifest.json': [
            { name: 'octave.json', location: './recipes/octave.json' },
            { name: 'coherence.recipe.json', location: './recipes/coherence.recipe.json' },
        ],
        './recipes/coherence.recipe.json': { schema: 'wandas.recipe', version: 2, inputs: [{ id: 'input-0', name: 'reference', kind: 'frame' }, { id: 'input-1', name: 'response', kind: 'frame' }], nodes: [], output: 'input-0' },
        './recipes/octave.json': { schema: 'wandas.recipe', version: 2, inputs: [{ id: 'input-0', name: 'signal', kind: 'frame' }], nodes: [], output: 'input-0' },
    };
    const workers: ControlledWorker[] = [];
    const windowListeners = new Map<string, () => void>();
    const blockedWorkerCommands = new Set<string>();
    /** Workers after the first do not answer limits: a spare Worker that has not booted yet. */
    let spareBooting = false;
    let limitsReply: Record<string, unknown> = { maxInputBytes: 16 * 1024 * 1024, maxSources: 8, maxTotalInputBytes: 64 * 1024 * 1024, maxExportBytes: 32 * 1024 * 1024 };
    const received: Record<string, unknown>[] = [];
    const firstAnalysis = new Set<string>();
    const revoked: string[] = [];
    let blobId = 0;
    class ControlledWorker {
        commands: Record<string, unknown>[] = [];
        blockedCommands = new Set<string>();
        loadedSources = new Set<string>();
        terminated = false;
        onmessage!: (event: { data: Record<string, unknown> }) => void;
        onerror!: () => void;
        constructor() { workers.push(this); }
        terminate(): void { this.terminated = true; }
        postMessage(command: Record<string, unknown>): void {
            this.commands.push(command);
            if (command.cmd === 'load') {
                firstAnalysis.add(`/sources/${command.sourceId}`);
                this.loadedSources.add(`/sources/${command.sourceId}`);
            }
            if (command.cmd === 'limits') {
                if (spareBooting && workers.indexOf(this) > 0) return;
                queueMicrotask(() => this.reply(command, limitsReply));
                return;
            }
            if (this.blockedCommands.has(String(command.cmd)) || blockedWorkerCommands.has(String(command.cmd))) return;
            if (command.cmd === 'clear') {
                this.loadedSources.clear();
                queueMicrotask(() => this.reply(command));
                return;
            }
            if (command.cmd === 'unload' && !this.loadedSources.delete(String(command.filePath))) {
                queueMicrotask(() => this.reply(command, {}, 'Source is not loaded'));
                return;
            }
            if (['load','unload','export-plan'].includes(String(command.cmd)) || (command.cmd === 'analyze' && firstAnalysis.has(String(command.filePath)))) {
                if (command.cmd === 'analyze') firstAnalysis.delete(String(command.filePath));
                queueMicrotask(() => this.reply(command, command.cmd === 'load' ? { filePath: `/sources/${command.sourceId}` } : {}));
            }
        }
        reply(command: Record<string, unknown>, result: Record<string, unknown> = {}, error?: string): void {
            const fixtures = JSON.parse(readFileSync(join(process.cwd(), 'src/test/fixtures/backendProtocol.json'), 'utf8')).validResponses as Array<{ command: string; response: Record<string, unknown> }>;
            const base = withoutResponseEnvelope(fixtures.find(fixture => fixture.command === command.cmd)?.response ?? {});
            // Only results that carry a filePath echo the request's; the schema rejects it elsewhere.
            const echoed = 'filePath' in base ? { filePath: command.filePath } : {};
            this.onmessage({ data: error === undefined
                ? { requestId: command.requestId, result: { ...base, ...echoed, ...result } }
                : { requestId: command.requestId, error: { code: 'input-error', message: error } } });
        }
    }
    const browser = {
        navigator: { language },
        localStorage: {
            getItem: (key: string) => { if (denied) throw new Error('denied'); return storage.get(key) ?? null; },
            setItem: (key: string, value: string) => { if (denied) throw new Error('denied'); storage.set(key, value); },
        },
        __APP_STRINGS__: undefined as unknown as UiStrings,
        __APP_STATE__: { spectrogramSettings: { auto: true } },
        __AWA_HOST__: undefined as WebviewHostApi | undefined,
        prompt: (text: string) => { prompts.push(text); return promptAnswer; },
        addEventListener: (type: string, listener: () => void) => { windowListeners.set(type, listener); },
        dispatchEvent: () => { throw new Error('Static host must not use the window message channel'); },
    };
    createStaticHost({
        window: browser,
        document: {
            createElement: (tag: string) => { const element = new MockElement(tag); elements.push(element); return element; },
            body: { prepend: () => undefined, append: (node: MockElement) => { if ('data-recipe-picker' in node.attributes) answerRecipeMenu(node); } },
            getElementById: (id: string) => id === 'hint-footer' ? footer : null,
            querySelector: (selector: string) => selector === '[data-recipe-result]' ? elements.find(element => element.tag === 'section' && !element.removed) ?? null : null,
            addEventListener: (type: string, listener: (event: unknown) => void) => { documentListeners.set(type, listener); },
            removeEventListener: (type: string, listener: (event: unknown) => void) => { if (documentListeners.get(type) === listener) documentListeners.delete(type); },
        },
        fetch: async (url: string) => { fetched.push(url); const body = served[url]; return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body }; },
        Worker: ControlledWorker,
        URL: { createObjectURL: () => `blob:fixture-${++blobId}`, revokeObjectURL: (url: string) => { revoked.push(url); } },
        setTimeout,
        recipeTimeoutMs: recipeTimeout,
        restartAfterScans: 1,
    } as unknown as StaticHostDeps);
    const host = browser.__AWA_HOST__!;
    host.onMessage!(message => received.push(message as Record<string, unknown>));
    const picker = elements.find(element => element.tag === 'input')!;
    let picks = 0;
    async function load(): Promise<void> {
        // Each call stands for a different file that happens to share the name.
        picker.files = [{ size: 100, name: 'selected.wav', lastModified: ++picks, arrayBuffer: async () => new ArrayBuffer(100) }];
        picker.onchange!();
        await flush();
    }
    // Unchecking every file posts an empty selection; the panel's Clear also marks it clearAll.
    const clear = (clearAll = false): void => { host.postMessage({ type: 'analyze-selected-files', requestId: 'clear', filePaths: [], ...(clearAll ? { clearAll: true } : {}) }); };
    return { host, browser, storage, workers, clear, windowListeners, blockedWorkerCommands, setLimitsReply: (reply: Record<string, unknown>): void => { limitsReply = reply; }, holdSpareBoot: (): void => { spareBooting = true; }, received, load, picker, elements, revoked, fetched, prompts, served, recipeMenus, assignMenus, documentListeners,
        setAssignAnswer(value: typeof assignAnswer) { assignAnswer = value; },
        setPromptAnswer(value: string | null) { promptAnswer = value; },
        setRecipeAnswer(value: typeof recipeAnswer) { recipeAnswer = value; },
        get status() { return elements.find(element => element.attributes.role === 'status')!.textContent; },
        get footer() { return footer.textContent; },
        get sourcePath() { return `/sources/${workers.at(-1)!.commands.filter(command => command.cmd === 'load').at(-1)!.sourceId}`; } };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const identity = { filePath: '/sources/selected.wav', requestId: 'ui', analysisId: 'a', settingsSignature: 's', trackIndex: 0 };

test('browser preferences restore safely across reloads and use shared Japanese strings', () => {
    const storage = new Map<string, string>();
    const app = harness(storage, 'ja-JP');
    assert.equal(app.browser.__APP_STRINGS__.btnOpenFile, '＋ファイルを追加');
    const settings = { auto: false, stft: { nFft: 256, overlapPercent: 75, window: 'hann' }, display: { dbMin: -80, dbMax: 0, maxFrequencyHz: 4000 } };
    app.host.postMessage({ type: 'update-spectrogram-settings', settings });
    // A key the page no longer keeps (the old file tree's) is not saved.
    app.host.setState({ contentType: 'spectrogram', ...({ directoryCollapseRootPath: '/private/path' } as object), sidebarCollapsed: true, spectrumCollapsed: true });
    const restored = harness(storage);
    assert.equal(restored.host.getState()?.sidebarCollapsed, true);
    assert.equal(restored.host.getState()?.spectrumCollapsed, true);
    assert.equal(JSON.stringify(restored.browser.__APP_STATE__.spectrogramSettings), JSON.stringify(settings));
    assert.equal(restored.host.getState()?.contentType, 'spectrogram');
    assert.ok(!storage.get('audioWandasAnalyzer.viewState')!.includes('/private/path'));
    storage.set('audioWandasAnalyzer.spectrogramSettings', '{broken');
    assert.equal(harness(storage).browser.__APP_STATE__.spectrogramSettings.auto, true);
    assert.equal(harness(storage, 'en', true).browser.__APP_STATE__.spectrogramSettings.auto, true);
});

test('the spectrum bands, an opened spectrum and the attribute CSV come back after a reload', () => {
    const storage = new Map<string, string>();
    const csv = { name: 'meta.csv', text: 'file,group\na.wav,A\n' };
    harness(storage).host.setState({ spectrumBandsPerOctave: 3, spectrumCollapsed: false, entryCsv: csv });
    const state = harness(storage).host.getState();
    assert.equal(state?.spectrumBandsPerOctave, 3);
    assert.equal(state?.spectrumCollapsed, false);
    assert.deepEqual(state?.entryCsv, csv);
    // The CSV has a key of its own, so one too big for the storage does not take the view's settings with it.
    assert.ok(!storage.get('audioWandasAnalyzer.viewState')!.includes('meta.csv'));
});

test('the audio Worker starts with the page and serves the first WAV', async () => {
    const app = harness();
    assert.equal(app.workers.length, 1);
    assert.equal(app.workers[0].commands.length, 0);
    await app.load();
    assert.equal(app.workers.length, 1);
    assert.ok(app.workers[0].commands.some(command => command.cmd === 'load'));
});

test('the Python indicator and the centred boot card follow the Worker boot, a kept Worker on clear, a failed boot and a reset', async () => {
    const app = harness();
    const indicator = app.elements.find(element => 'data-python-state' in element.attributes)!;
    const loading = app.elements.find(element => 'data-python-loading' in element.attributes)!;
    const shown = (): boolean => (loading.style as { display?: string }).display === 'flex';
    assert.equal(indicator.textContent, 'Python: starting…');
    assert.ok(shown());
    app.workers[0].onmessage({ data: { ready: true, lacks: ['librosa'] } });
    assert.equal(indicator.textContent, 'Python: ready');
    // What the runtime cannot import is kept for the step bar, which greys out what needs it.
    assert.deepEqual((app.browser as unknown as { __AWA_RUNTIME_LACKS__: string[] }).__AWA_RUNTIME_LACKS__, ['librosa']);
    assert.ok(!shown());
    await app.load();
    app.clear();
    assert.equal(indicator.textContent, 'Python: ready');
    assert.ok(!shown());
    await app.load();
    assert.equal(app.workers.length, 1, 'clearing keeps the booted Worker');
    assert.equal(app.workers[0].terminated, false);
    assert.deepEqual(app.workers[0].commands.map(command => command.cmd).filter(cmd => cmd === 'clear' || cmd === 'load'), ['load', 'clear', 'load']);
    app.workers[0].onerror();
    assert.equal(indicator.textContent, 'Python: stopped (restarts when needed)');
    assert.ok(!shown());
    await app.load();
    assert.equal(indicator.textContent, 'Python: starting…');
    assert.ok(shown());
    app.workers[1].onmessage({ data: { ready: false } });
    assert.equal(indicator.textContent, 'Python: failed to start');
    assert.ok(!shown());
    app.workers[0].onmessage({ data: { ready: true } });
    assert.equal(indicator.textContent, 'Python: failed to start');
    await app.load();
    assert.equal(app.workers[1].terminated, true, 'a failed boot is replaced, so the next WAV retries it');
    assert.equal(app.workers.length, 3);
    assert.equal(indicator.textContent, 'Python: starting…');
});

test('unrelated detail/export errors do not end a pending reanalysis', async () => {
    const app = harness();
    await app.load();
    app.host.postMessage({ type: 'request-reanalyze', settings: DEFAULT_SPECTROGRAM_SETTINGS });
    app.host.postMessage({ ...identity, filePath: app.sourcePath, type: 'request-track-detail' });
    app.host.postMessage({ type: 'export-wav-loop', filePaths: [app.sourcePath], startNorm: 0.2, endNorm: 0.5 });
    await flush();
    const worker = app.workers[0];
    worker.reply(worker.commands.find(command => command.cmd === 'track-detail')!, {}, 'detail failed');
    worker.reply(worker.commands.find(command => command.cmd === 'export-wav-loop')!, {}, 'export failed');
    await flush();
    assert.ok(app.received.some(message => message.type === 'track-detail-error'));
    assert.equal(app.received.filter(message => message.type === 'reanalyze-end').length, 0);
    worker.reply(worker.commands.filter(command => command.cmd === 'analyze').at(-1)!, {});
    await flush();
    assert.equal(app.received.filter(message => message.type === 'reanalyze-end').length, 1);
});

test('only the newest reanalysis can update results and end busy state', async () => {
    const app = harness();
    await app.load();
    app.host.postMessage({ type: 'request-reanalyze', settings: DEFAULT_SPECTROGRAM_SETTINGS });
    app.host.postMessage({ type: 'request-reanalyze', settings: DEFAULT_SPECTROGRAM_SETTINGS });
    const requests = app.workers[0].commands.filter(command => command.cmd === 'analyze').slice(1);
    const before = app.received.filter(message => message.type === 'analysis-update').length;
    app.workers[0].reply(requests[0], {});
    await flush();
    assert.equal(app.received.filter(message => message.type === 'analysis-update').length, before);
    assert.equal(app.received.filter(message => message.type === 'reanalyze-end').length, 0);
    app.workers[0].reply(requests[1], {}, 'reanalyze failed');
    await flush();
    assert.equal(app.received.filter(message => message.type === 'reanalyze-end').length, 1);
});

test('worker errors clear results and stale requests cannot resurrect an unloaded worker', async () => {
    const app = harness();
    await app.load();
    const oldWorker = app.workers[0];
    oldWorker.onerror();
    await flush();
    assert.equal(oldWorker.terminated, true);
    const cleared = app.received.filter(message => message.type === 'analysis-update').at(-1)!;
    assert.equal((cleared.results as unknown[]).length, 0);
    app.host.postMessage({ ...identity, filePath: app.sourcePath, type: 'request-spectrum-slice', cursorNorm: 0.5 });
    await flush();
    assert.equal(app.workers.length, 1);
    assert.equal(app.received.at(-1)?.type, 'spectrum-slice-error');
    await app.load();
    assert.equal(app.workers.length, 2);
    oldWorker.onerror();
    assert.equal(app.workers[1].terminated, false);
    app.host.postMessage({ ...identity, filePath: '/sources/previous.wav', type: 'request-track-detail' });
    await flush();
    assert.equal(app.received.at(-1)?.type, 'track-detail-error');
    assert.equal(app.workers[1].commands.length, 2);
});

test('a failed release announces the backend message without the error class name', async () => {
    const app = harness();
    await app.load();
    const firstPath = app.sourcePath;
    await app.load();
    app.workers[0].loadedSources.delete(firstPath);
    app.host.releaseSource!(firstPath);
    await flush();
    assert.equal(app.status, 'Source is not loaded');
});

test('a boot that fails after an idle clear is retried by the next WAV', async () => {
    const app = harness();
    app.clear();
    assert.equal(app.workers[0].terminated, false);
    app.workers[0].onmessage({ data: { ready: false } });
    await app.load();
    assert.equal(app.workers[0].terminated, true);
    assert.equal(app.workers.length, 2);
    assert.ok(app.workers[1].commands.some(command => command.cmd === 'load'));
});

test('leaving the page stops an idle Worker and a Worker that cannot clear is replaced', async () => {
    const app = harness();
    await app.load();
    app.workers[0].blockedCommands.add('clear');
    app.clear();
    const clear = app.workers[0].commands.at(-1)!;
    assert.equal(clear.cmd, 'clear');
    app.workers[0].reply(clear, {}, 'Unknown command');
    await flush();
    assert.equal(app.workers[0].terminated, true);
    await app.load();
    assert.equal(app.workers.length, 2);
    app.windowListeners.get('pagehide')!();
    assert.equal(app.workers[1].terminated, true);
});

test('a failed boot while restoring sources after a Recipe timeout replays them into the next Worker', async () => {
    const app = harness(new Map(), 'en', false, 20);
    await app.load(); await app.load();
    const retainedIds = app.workers[0].commands.filter(command => command.cmd === 'load').map(command => command.sourceId);
    app.host.postMessage({ type: 'run-recipe' });
    await flush(); await flush();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(app.workers[0].terminated, true);
    app.blockedWorkerCommands.add('load');
    app.host.postMessage({ ...identity, filePath: `/sources/${retainedIds[0]}`, type: 'request-track-detail' });
    await flush(); await flush();
    const failed = app.workers[1];
    failed.onmessage({ data: { ready: false } });
    failed.reply(failed.commands.find(command => command.cmd === 'load')!, {}, 'Python failed to start');
    await flush(); await flush();
    app.blockedWorkerCommands.delete('load');
    app.host.postMessage({ ...identity, filePath: `/sources/${retainedIds[0]}`, type: 'request-track-detail' });
    await flush(); await flush(); await flush();
    assert.equal(failed.terminated, true);
    assert.equal(app.workers.length, 3);
    assert.deepEqual(app.workers[2].commands.filter(command => command.cmd === 'load').map(command => command.sourceId), retainedIds);
});

test('clearing during an analysis restarts the busy Worker instead of queueing behind it', async () => {
    const app = harness();
    await app.load();
    app.host.postMessage({ type: 'request-reanalyze', settings: DEFAULT_SPECTROGRAM_SETTINGS });
    await flush();
    app.clear();
    assert.equal(app.workers[0].terminated, true);
    assert.ok(!app.workers[0].commands.some(command => command.cmd === 'clear'));
    await app.load();
    assert.equal(app.workers.length, 2);
});

test('file picker appends multiple sources and per-track release preserves the other source', async () => {
    const app = harness();
    assert.equal(app.picker.multiple, true);
    await app.load();
    const firstPath = app.sourcePath;
    await app.load();
    const secondPath = app.sourcePath;
    assert.notEqual(firstPath, secondPath);
    assert.equal(app.workers.length, 1);
    const results = app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as unknown[];
    assert.equal(results.length, 2);
    app.host.releaseSource!(firstPath);
    await flush();
    assert.deepEqual(app.revoked, ['blob:fixture-1']);
    assert.equal(app.workers[0].terminated, false);
    app.host.postMessage({ type: 'request-reanalyze', settings: DEFAULT_SPECTROGRAM_SETTINGS });
    const last = app.workers[0].commands.at(-1)!;
    assert.equal(last.filePath, secondPath);
    app.workers[0].reply(last, {});
    await flush();
    assert.equal((app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as unknown[]).length, 1);
    app.host.releaseSource!(secondPath);
    assert.equal(app.workers[0].terminated, false);
    assert.equal(app.workers[0].commands.at(-1)!.cmd, 'clear');
    assert.deepEqual(app.revoked, ['blob:fixture-1', 'blob:fixture-2']);
});

test('invalid additions preserve existing tracks, batch continues and count cap avoids reading rejected files', async () => {
    const app = harness();
    await app.load();
    app.picker.files = [
        { name: 'bad.wav', size: 100, arrayBuffer: async () => { throw new Error('Unreadable WAV'); } },
        { name: 'good.wav', size: 100, arrayBuffer: async () => new ArrayBuffer(100) },
    ];
    app.picker.onchange!(); await flush();
    assert.equal((app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as unknown[]).length, 2);
    for (let i = 0; i < 6; i++) await app.load();
    let reads = 0;
    app.picker.files = [{ name: 'ninth.wav', size: 100, arrayBuffer: async () => { reads++; return new ArrayBuffer(100); } }];
    app.picker.onchange!(); await flush();
    assert.equal(reads, 0);
    assert.match(app.status, /up to 8 files \/ 64 MiB total input/);
    assert.equal((app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as unknown[]).length, 8);
    assert.equal(app.revoked.length, 0);
});

test('file pre-checks use the session limits published by the Worker once', async () => {
    const app = harness();
    app.picker.files = [{ name: 'huge.wav', size: 16 * 1024 * 1024 + 1, arrayBuffer: async () => { throw new Error('must not read'); } }];
    app.picker.onchange!(); await flush();
    assert.match(app.status, /huge\.wav: Each file must be 16 MiB or smaller\./);
    await app.load(); await app.load();
    assert.deepEqual(app.workers.flatMap(worker => worker.commands).filter(command => command.cmd === 'limits').length, 1);
});

test('malformed Worker limits are rejected and not cached', async () => {
    const app = harness();
    app.setLimitsReply({ maxInputBytes: 16 * 1024 * 1024, maxSources: '8', maxTotalInputBytes: 64 * 1024 * 1024 });
    app.picker.files = [{ name: 'skewed.wav', size: 100, arrayBuffer: async () => { throw new Error('must not read'); } }];
    app.picker.onchange!(); await flush();
    assert.match(app.status, /Invalid limits response/);
    app.setLimitsReply({ maxInputBytes: 16 * 1024 * 1024, maxSources: 8, maxTotalInputBytes: 64 * 1024 * 1024, maxExportBytes: 32 * 1024 * 1024 });
    await app.load();
    assert.equal(app.workers.flatMap(worker => worker.commands).filter(command => command.cmd === 'limits').length, 2);
});

test('cancel during a file read clears all sources and ignores late completion', async () => {
    const app = harness(); await app.load();
    let finish!: (bytes: ArrayBuffer) => void;
    app.picker.files = [{ name: 'late.wav', size: 100, arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }];
    app.picker.onchange!();
    app.clear();
    finish(new ArrayBuffer(100)); await flush();
    assert.equal(app.workers.length, 1);
    assert.equal(app.workers[0].terminated, false);
    assert.equal(app.workers[0].commands.at(-1)!.cmd, 'clear', 'the late file is not loaded after the clear');
    assert.equal((app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as unknown[]).length, 0);
    assert.equal(app.picker.disabled, false);
});

test('Web uses the common backend validator and rejects malformed detail replies', async () => {
    const app = harness(); await app.load();
    app.host.postMessage({ ...identity, filePath: app.sourcePath, type: 'request-track-detail' });
    const worker = app.workers[0];
    const command = worker.commands.find(command => command.cmd === 'track-detail')!;
    worker.reply(command, { channels: [{ label: 'invalid-channel' }] });
    await flush();
    const response = app.received.at(-1)!;
    assert.equal(response.type, 'track-detail-error');
    assert.match(String(response.error), /Invalid track-detail success response/);
});

test('Worker error envelopes use the native correlation contract and empty errors reject', async () => {
    const app = harness(); await app.load();
    app.host.postMessage({ ...identity, filePath: app.sourcePath, type: 'request-track-detail' });
    const worker = app.workers[0];
    const malformed = worker.commands.at(-1)!;
    worker.onmessage({ data: { requestId: malformed.requestId, error: 0 } });
    await flush();
    assert.equal(app.received.at(-1)?.type, 'track-detail-error');
    assert.equal(app.received.at(-1)?.error, 'Invalid error response for track-detail');
    const count = app.received.length;
    worker.reply(malformed, {});
    await flush();
    assert.equal(app.received.length, count);
    app.host.postMessage({ ...identity, filePath: app.sourcePath, type: 'request-track-detail' });
    worker.reply(worker.commands.at(-1)!, {}, '');
    await flush();
    assert.equal(app.received.at(-1)?.type, 'track-detail-error');
    assert.equal(app.received.at(-1)?.error, '');
    app.host.postMessage({ ...identity, filePath: app.sourcePath, type: 'request-track-detail' });
    const mixed = worker.commands.at(-1)!;
    worker.onmessage({ data: { requestId: mixed.requestId, result: {}, error: { code: 'input-error', message: 'm' } } });
    await flush();
    assert.equal(app.received.at(-1)?.error, 'Invalid error response for track-detail', 'a reply with result and error is malformed');
});

test('Worker success envelopes with extra outer keys are protocol errors', async () => {
    const app = harness(); await app.load();
    app.host.postMessage({ ...identity, filePath: app.sourcePath, type: 'request-track-detail' });
    const worker = app.workers[0];
    const command = worker.commands.at(-1)!;
    worker.onmessage({ data: { requestId: command.requestId, result: {}, debug: 1 } });
    await flush();
    assert.equal(app.received.at(-1)?.type, 'track-detail-error');
    assert.match(String(app.received.at(-1)?.error), /Invalid track-detail response envelope/);
});

test('browser-only Worker commands reject success envelopes with extra outer keys', async () => {
    const app = harness();
    app.blockedWorkerCommands.add('load');
    await app.load();
    const worker = app.workers[0];
    const load = worker.commands.find(command => command.cmd === 'load')!;
    worker.onmessage({ data: { requestId: load.requestId, result: { filePath: `/sources/${load.sourceId}` }, debug: 1 } });
    await flush(); await flush();
    assert.equal(worker.commands.some(command => command.cmd === 'analyze'), false, 'a malformed load reply must not start analysis');
    assert.match(app.status, /Invalid load response envelope/);
});

test('browser recipes run on loaded tracks through the Worker and render charts in a fresh frame', async () => {
    const app = harness();
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    assert.equal(app.fetched.length, 0, 'recipes need a loaded track first');
    assert.equal(app.status, app.browser.__APP_STRINGS__.browserRecipeNoSources);
    await app.load();
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    assert.deepEqual(app.fetched, ['./recipes/manifest.json', './recipes/octave.json']);
    assert.deepEqual(app.recipeMenus[0], ['octave', 'coherence', 'From file…']);
    assert.equal(app.documentListeners.size, 0, 'choosing a recipe closes its menu');
    const worker = app.workers[0];
    const command = worker.commands.at(-1)!;
    assert.equal(command.cmd, 'run-recipe');
    assert.equal(command.requestId, 'recipe-1');
    assert.equal(command.recipePath, './recipes/octave.json');
    assert.equal(JSON.stringify(command.inputContexts), JSON.stringify({ signal: { analysisRevision: 0 } }));
    assert.deepEqual(command.inputs, { signal: app.sourcePath });
    worker.reply(command, { charts: [{ kind: 'scalar', title: 'Peak', rows: [] }] });
    await flush();
    const frame = app.elements.find(element => element.tag === 'iframe')!;
    assert.equal(JSON.stringify((frame.contentWindow as { __CHART_SPECS__: unknown }).__CHART_SPECS__), JSON.stringify([{ kind: 'scalar', title: 'Peak', rows: [] }]));
    assert.equal(frame.contentDocument!.body.children.at(-1)!.src, './chartSpecRuntime.js');
    assert.equal(frame.contentDocument!.body.children[0].id, 'charts');
    assert.equal(app.status, app.browser.__APP_STRINGS__.browserRecipeDone + 'octave');
    assert.ok(app.elements.some(element => element.tag === 'span' && element.textContent === 'signal: selected.wav'), 'the result names the file behind each input');
    const close = app.elements.find(element => element.attributes['data-action'] === 'browser-recipe-close')!;
    close.onclick!();
    assert.equal(app.elements.find(element => element.tag === 'section')!.removed, true);
    app.setRecipeAnswer(1);
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    assert.match(app.status, /Recipe expects 2 file\(s\) from the panel selection but 1 is checked/);
    assert.equal(worker.commands.filter(entry => entry.cmd === 'run-recipe').length, 1);
    app.setRecipeAnswer('escape');
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    assert.equal(worker.commands.filter(entry => entry.cmd === 'run-recipe').length, 1, 'Escape cancels the run');
    assert.equal(app.documentListeners.size, 0);
    app.setRecipeAnswer(0);
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    worker.reply(worker.commands.at(-1)!, {}, 'recipe error: Unknown name');
    await flush();
    assert.equal(app.status, 'Recipe execution failed: recipe error: Unknown name');
});

test('Save as recipe builds the Recipe in the Worker and downloads it as a .recipe.json', async () => {
    const app = harness();
    await app.load();
    app.host.postMessage({ type: 'save-recipe', filePath: app.sourcePath, bandsPerOctave: 3 });
    await flush();
    const worker = app.workers[0];
    const command = worker.commands.at(-1)!;
    assert.equal(command.cmd, 'build-recipe');
    assert.equal(command.filePath, app.sourcePath);
    assert.equal(command.bandsPerOctave, 3);
    const recipe = { schema: 'wandas.recipe', version: 2, inputs: [], nodes: [], output: 'input-0' };
    worker.reply(command, { name: 'octave-3', recipe });
    await flush();
    const link = app.elements.find(element => element.tag === 'a' && (element as { download?: string }).download === 'octave-3.recipe.json');
    assert.ok(link, 'the Recipe is offered as a download');
    assert.equal(app.status, app.browser.__APP_STRINGS__.recipeSavedPrefix + 'octave-3.recipe.json');
});

test('a two-input browser recipe lets the user swap which track fills each input before it runs', async () => {
    const app = harness();
    await app.load();
    await app.load();
    const worker = app.workers[0];
    const [first, second] = worker.commands.filter(command => command.cmd === 'load').map(command => `/sources/${command.sourceId}`);
    app.setRecipeAnswer(1);
    app.setAssignAnswer(menu => {
        const [reference, response] = menu.children.filter(child => child.tag === 'label').map(row => row.children[1]);
        [reference.value, response.value] = [response.value, reference.value];
    });
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    assert.deepEqual(app.assignMenus[0], [`reference=${first}`, `response=${second}`], 'the menu proposes the selection order');
    const options = app.elements.filter(element => element.tag === 'option').map(element => element.textContent);
    assert.deepEqual(options.slice(0, 2), [first, second].map(path => path.slice('/sources/'.length)), 'tracks sharing a name are told apart by their paths');
    assert.notEqual(options[0], options[1]);
    const command = worker.commands.at(-1)!;
    assert.equal(command.cmd, 'run-recipe');
    assert.deepEqual(command.inputs, { reference: second, response: first });
    worker.reply(command, { charts: [] });
    await flush();
    assert.ok(app.elements.some(element => element.tag === 'span' && element.textContent === `reference: ${second.slice('/sources/'.length)} · response: ${first.slice('/sources/'.length)}`));
});

test('a browser recipe opened from disk runs under its file name and reports unreadable files', async () => {
    const app = harness();
    await app.load();
    const recipe = { schema: 'wandas.recipe', version: 2, inputs: [{ id: 'input-0', name: 'signal', kind: 'frame' }], nodes: [], output: 'input-0' };
    app.setRecipeAnswer({ name: 'mine.recipe.json', text: JSON.stringify(recipe) });
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    assert.deepEqual(app.fetched, ['./recipes/manifest.json'], 'a local recipe is not fetched');
    const worker = app.workers[0];
    const command = worker.commands.at(-1)!;
    assert.equal(command.cmd, 'run-recipe');
    assert.equal(command.recipePath, 'mine.recipe.json');
    assert.deepEqual(command.recipe, recipe);
    worker.reply(command, { charts: [] });
    await flush();
    assert.equal(app.status, app.browser.__APP_STRINGS__.browserRecipeDone + 'mine');
    app.setRecipeAnswer({ name: 'broken.json', text: '{"schema": "other"}' });
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    assert.equal(app.status, 'Recipe execution failed: broken.json is not a recipe document');
    assert.equal(worker.commands.filter(entry => entry.cmd === 'run-recipe').length, 1);
});

test('clearing sources during a recipe preserves the new status and ignores late charts', async () => {
    const app = harness();
    await app.load();
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    const worker = app.workers[0];
    const command = worker.commands.at(-1)!;
    assert.equal(command.cmd, 'run-recipe');
    app.clear();
    await flush();
    assert.equal(app.status, app.browser.__APP_STRINGS__.browserCleared);
    worker.reply(command, { charts: [{ kind: 'scalar', title: 'Late', rows: [] }] });
    await flush();
    assert.equal(app.status, app.browser.__APP_STRINGS__.browserCleared);
    assert.equal(app.elements.some(element => element.tag === 'iframe'), false);
});

test('static calibration requests explain the unavailable operation and reject malformed messages', async () => {
    const app = harness();
    await app.load();
    const message = { type: 'configure-calibration', trackIndex: 0, filePath: app.sourcePath,
        channels: [{ channelIndex: 0, label: 'Channel 1' }] };
    app.host.postMessage({ ...message, channels: [] });
    assert.equal(app.footer, '');
    app.host.postMessage(message);
    assert.equal(app.footer, app.browser.__APP_STRINGS__.browserUnavailable);
});

test('the browser lets the spectrum kind buttons through to the runtime', () => {
    const app = harness();
    const click = app.windowListeners.get('click') as unknown as (event: unknown) => void;
    for (const action of ['spectrum-octave-1', 'spectrum-octave-3', 'spectrum-fft']) {
        const calls: string[] = [];
        const target = { closest: (selector: string) => selector.includes('[data-action="' + action + '"]') ? target : null };
        click({ target, stopPropagation: () => calls.push('stop'), preventDefault: () => calls.push('prevent') });
        assert.deepEqual(calls, [], action);
    }
    assert.equal(app.footer, '');
});

test('removing one recipe input suppresses stale charts and errors while other sources remain', async () => {
    for (const fail of [false, true]) {
        const app = harness();
        await app.load();
        const removedPath = app.sourcePath;
        await app.load();
        const worker = app.workers[0];
        app.host.postMessage({ type: 'run-recipe' });
        await flush();
        const command = worker.commands.at(-1)!;
        assert.equal(command.cmd, 'run-recipe');
        app.host.releaseSource!(removedPath);
        await flush();
        assert.equal(worker.terminated, false);
        const currentStatus = app.status;
        worker.reply(command, { charts: [{ kind: 'scalar', title: 'Removed input', rows: [] }] }, fail ? 'Input removed' : undefined);
        await flush();
        assert.equal(app.status, currentStatus);
        assert.equal(app.elements.some(element => element.tag === 'iframe'), false);
    }
});


test('Recipe timeout preserves tracks and URLs and reloads the Worker for the next request', async () => {
    const app = harness(new Map(), 'en', false, 20);
    await app.load(); await app.load();
    const before = app.received.filter(message => message.type === 'analysis-update').at(-1)!;
    const originalWorker = app.workers[0];
    app.host.postMessage({ type: 'run-recipe' });
    await flush(); await flush();
    const recipe = originalWorker.commands.at(-1)!;
    assert.equal(recipe.cmd, 'run-recipe');
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(originalWorker.terminated, true);
    assert.deepEqual(app.revoked, []);
    assert.equal(app.received.filter(message => message.type === 'analysis-update').at(-1), before);
    assert.match(app.status, /timed out/);
    originalWorker.reply(recipe, { charts: [] });
    await flush();
    assert.equal(app.elements.filter(element => element.tag === 'iframe').length, 0);
    app.host.postMessage({ type: 'request-reanalyze', settings: DEFAULT_SPECTROGRAM_SETTINGS });
    await flush(); await flush();
    assert.equal(app.workers.length, 2);
    const restored = app.workers[1];
    assert.deepEqual(restored.commands.filter(command => command.cmd === 'load').map(command => command.sourceId),
        originalWorker.commands.filter(command => command.cmd === 'load').map(command => command.sourceId));
    assert.equal(restored.commands.filter(command => command.cmd === 'analyze').length, 2);
    assert.deepEqual(app.revoked, []);
    const results = app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as Array<{ audioSource: string }>;
    const originalResults = before.results as Array<{ audioSource: string }>;
    assert.equal(results.length, 2);
    assert.deepEqual(results.map(result => result.audioSource), originalResults.map(result => result.audioSource));
    app.clear();
    assert.equal(app.revoked.length, 2);
});


test('adding a WAV after Recipe timeout restores retained sources before the new load', async () => {
    const app = harness(new Map(), 'en', false, 20);
    await app.load(); await app.load();
    const originalWorker = app.workers[0];
    const retainedIds = originalWorker.commands.filter(command => command.cmd === 'load').map(command => command.sourceId);
    app.host.postMessage({ type: 'run-recipe' });
    await flush(); await flush();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(originalWorker.terminated, true);
    await app.load(); await flush();
    const restored = app.workers[1];
    const loadedIds = restored.commands.filter(command => command.cmd === 'load').map(command => command.sourceId);
    assert.deepEqual(loadedIds.slice(0, 2), retainedIds);
    assert.equal(loadedIds.length, 3);
    assert.ok(!retainedIds.includes(loadedIds[2]));
    assert.deepEqual(app.revoked, []);
    const results = app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as Array<{ filePath: string }>;
    assert.equal(results.length, 3);
    app.host.postMessage({ ...identity, filePath: results[0].filePath, type: 'request-track-detail' });
    await flush();
    assert.equal(restored.commands.at(-1)!.cmd, 'track-detail');
    assert.equal(restored.commands.at(-1)!.filePath, results[0].filePath);
});


test('Recipe can run again immediately after timeout by restoring retained tracks', async () => {
    const app = harness(new Map(), 'en', false, 20);
    await app.load(); await app.load();
    const originalWorker = app.workers[0];
    const retainedIds = originalWorker.commands.filter(command => command.cmd === 'load').map(command => command.sourceId);
    app.host.postMessage({ type: 'run-recipe' });
    await flush(); await flush();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(originalWorker.terminated, true);
    app.host.postMessage({ type: 'run-recipe' });
    await flush(); await flush();
    const restored = app.workers[1];
    assert.ok(restored);
    assert.deepEqual(restored.commands.filter(command => command.cmd === 'load').map(command => command.sourceId), retainedIds);
    const recipe = restored.commands.find(command => command.cmd === 'run-recipe')!;
    assert.ok(recipe);
    restored.reply(recipe, { charts: [] });
    await flush();
    assert.equal(app.elements.filter(element => element.tag === 'iframe').length, 1);
    assert.deepEqual(app.revoked, []);
    assert.match(app.status, /octave/);
});


test('Recipe timeout delivers terminal lazy errors so detail and spectrum can retry after recovery', async () => {
    const app = harness(new Map(), 'en', false, 20);
    await app.load();
    const filePath = app.sourcePath;
    app.host.postMessage({ type: 'run-recipe' });
    await flush(); await flush();
    app.host.postMessage({ ...identity, filePath, requestId: 'waiting-detail', type: 'request-track-detail' });
    app.host.postMessage({ ...identity, filePath, requestId: 'waiting-slice', cursorNorm: 0.5, type: 'request-spectrum-slice' });
    await flush();
    const old = app.workers[0];
    assert.ok(old.commands.some(command => command.cmd === 'track-detail'));
    assert.ok(old.commands.some(command => command.cmd === 'spectrum-slice'));
    await new Promise(resolve => setTimeout(resolve, 40));
    const errors = app.received.filter(message => ['track-detail-error', 'spectrum-slice-error'].includes(String(message.type)));
    assert.deepEqual(errors.map(message => [message.type, message.requestId]), [
        ['track-detail-error', 'waiting-detail'], ['spectrum-slice-error', 'waiting-slice'],
    ]);
    for (const error of errors) { assert.equal(error.filePath, filePath); assert.match(String(error.error), /timed out/); }
    app.host.postMessage({ ...identity, filePath, requestId: 'retry-detail', type: 'request-track-detail' });
    app.host.postMessage({ ...identity, filePath, requestId: 'retry-slice', cursorNorm: 0.6, type: 'request-spectrum-slice' });
    await flush(); await flush();
    const restored = app.workers[1];
    assert.ok(restored);
    for (const command of restored.commands.filter(command => ['track-detail', 'spectrum-slice'].includes(String(command.cmd)))) {
        restored.reply(command, {});
    }
    await flush();
    assert.ok(app.received.some(message => message.type === 'track-detail-result' && message.requestId === 'retry-detail'));
    assert.ok(app.received.some(message => message.type === 'spectrum-slice-result' && message.requestId === 'retry-slice'));
    assert.deepEqual(app.revoked, []);
});


for (const operation of ['remove', 'add'] as const) {
    test(`Recipe timeout during ${operation} preserves remaining tracks and audio URLs`, async () => {
        const app = harness(new Map(), 'en', false, 20);
        await app.load();
        const firstPath = app.sourcePath;
        await app.load();
        const remainingPath = app.sourcePath;
        const before = Array.from(app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as Array<{ filePath: string; audioSource: string }>);
        const original = app.workers[0];
        app.host.postMessage({ type: 'run-recipe' });
        await flush(); await flush();
        assert.equal(original.commands.at(-1)!.cmd, 'run-recipe');
        if (operation === 'remove') {
            original.blockedCommands.add('unload');
            app.host.releaseSource!(firstPath);
            await flush();
            assert.equal(original.commands.at(-1)!.cmd, 'unload');
        } else {
            original.blockedCommands.add('analyze');
            await app.load();
            assert.equal(original.commands.at(-1)!.cmd, 'analyze');
        }
        await new Promise(resolve => setTimeout(resolve, 40));
        assert.equal(original.terminated, true);
        assert.deepEqual(app.revoked, operation === 'remove' ? [before[0].audioSource] : []);
        assert.equal(app.workers.length, 1);
        assert.equal(app.picker.disabled, false);
        app.host.postMessage({ type: 'request-reanalyze', settings: DEFAULT_SPECTROGRAM_SETTINGS });
        await flush(); await flush();
        const restored = app.workers[1];
        const expected = operation === 'remove' ? before.filter(source => source.filePath === remainingPath) : before;
        assert.deepEqual(restored.commands.filter(command => command.cmd === 'load').map(command => `/sources/${command.sourceId}`), expected.map(source => source.filePath));
        assert.equal(restored.commands.some(command => command.cmd === 'unload'), false);
        const after = app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as Array<{ filePath: string; audioSource: string }>;
        assert.deepEqual(Array.from(after, source => [source.filePath, source.audioSource]), expected.map(source => [source.filePath, source.audioSource]));
        assert.deepEqual(app.revoked, operation === 'remove' ? [before[0].audioSource] : []);
    });
}


test('Recipe timeout stops a hanging recovery load and later requests can recover again', async () => {
    const app = harness(new Map(), 'en', false, 20);
    await app.load();
    const filePath = app.sourcePath;
    app.host.postMessage({ type: 'run-recipe' });
    await flush(); await flush();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(app.workers[0].terminated, true);
    app.blockedWorkerCommands.add('load');
    app.host.postMessage({ type: 'run-recipe' });
    await flush(); await flush();
    const recovering = app.workers[1];
    assert.equal(recovering.commands.at(-1)!.cmd, 'load');
    assert.equal(recovering.commands.some(command => command.cmd === 'run-recipe'), false);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(recovering.terminated, true);
    assert.match(app.status, /timed out/);
    assert.deepEqual(app.revoked, []);
    app.blockedWorkerCommands.delete('load');
    app.host.postMessage({ type: 'request-reanalyze', settings: DEFAULT_SPECTROGRAM_SETTINGS });
    await flush(); await flush();
    assert.equal(app.workers.length, 3);
    assert.ok(app.workers[2].commands.some(command => command.cmd === 'analyze' && command.filePath === filePath));
    assert.deepEqual(app.revoked, []);
    assert.equal((app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as unknown[]).length, 1);
});


test('Recipe timeout during a multi-file load keeps the picker disabled until the batch finishes', async () => {
    const app = harness(new Map(), 'en', false, 20);
    await app.load();
    const original = app.workers[0];
    app.host.postMessage({ type: 'run-recipe' });
    await flush(); await flush();
    original.blockedCommands.add('analyze');
    app.picker.files = ['a.wav', 'b.wav'].map(name => ({ size: 100, name, arrayBuffer: async () => new ArrayBuffer(100) }));
    app.picker.onchange!();
    await flush();
    assert.equal(app.picker.disabled, true);
    app.host.postMessage({ type: 'select-target', targetKind: 'file' });
    assert.equal(app.status, 'Preparing local Python Worker / adding files…', 'Open File explains why no chooser opens');
    app.blockedWorkerCommands.add('load');
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(original.terminated, true);
    assert.equal(app.workers.length, 2, 'the second file restores sources in a new Worker');
    assert.equal(app.picker.disabled, true);
});

test('an opened folder lists its WAV files and checked files load as tracks under their tree paths', async () => {
    const app = harness();
    const folderPicker = app.elements.find(element => element.tag === 'input' && 'webkitdirectory' in element.attributes)!;
    const file = (path: string) => ({ size: 100, name: path.split('/').pop()!, webkitRelativePath: path, arrayBuffer: async () => new ArrayBuffer(100) });
    folderPicker.files = [file('rec/a.wav'), file('rec/sub/b.WAV'), file('rec/notes.txt')];
    folderPicker.onchange!();
    assert.deepEqual(app.received.find(message => message.type === 'directory-selection'),
        { type: 'directory-selection', rootPath: '/sources/rec', rootLabel: 'rec', filePaths: ['/sources/rec/a.wav', '/sources/rec/sub/b.WAV'], entry: true });
    const lastUpdate = () => app.received.filter(message => message.type === 'analysis-update').at(-1)!;
    const loadedPaths = () => (lastUpdate().results as Array<{ filePath: string }>).map(result => result.filePath);

    app.host.postMessage({ type: 'analyze-selected-files', requestId: 'r1', filePaths: ['/sources/rec/sub/b.WAV', '/sources/elsewhere.wav'] });
    await flush(); await flush();
    assert.deepEqual(app.workers[0].commands.filter(command => command.cmd === 'load').map(command => command.sourceId), ['rec/sub/b.WAV']);
    assert.deepEqual(loadedPaths(), ['/sources/rec/sub/b.WAV']);
    assert.deepEqual(lastUpdate().selectedFilePaths, ['/sources/rec/sub/b.WAV']);

    app.host.postMessage({ type: 'analyze-selected-files', requestId: 'r2', filePaths: ['/sources/rec/a.wav'] });
    // Clearing every check while that change is still in flight cancels it by restarting the busy Worker.
    app.host.postMessage({ type: 'analyze-selected-files', requestId: 'r3', filePaths: [] });
    await flush(); await flush();
    assert.ok(!app.workers[0].commands.some(command => command.cmd === 'load' && command.sourceId === 'rec/a.wav'));
    assert.deepEqual(loadedPaths(), []);
    assert.deepEqual(lastUpdate().selectedFilePaths, []);
    assert.equal(app.picker.disabled, false);
    assert.equal(app.workers[0].terminated, true);
    assert.equal(app.status, app.browser.__APP_STRINGS__.browserCleared);
});

test('a load failure unchecks that tree file and keeps the others', async () => {
    const app = harness();
    const folderPicker = app.elements.find(element => element.tag === 'input' && 'webkitdirectory' in element.attributes)!;
    folderPicker.files = [
        { size: 100, name: 'a.wav', webkitRelativePath: 'rec/a.wav', arrayBuffer: async () => new ArrayBuffer(100) },
        { size: 64 * 1024 * 1024, name: 'big.wav', webkitRelativePath: 'rec/big.wav', arrayBuffer: async () => new ArrayBuffer(100) },
    ] as typeof folderPicker.files;
    folderPicker.onchange!();
    app.host.postMessage({ type: 'analyze-selected-files', requestId: 'r1', filePaths: ['/sources/rec/a.wav', '/sources/rec/big.wav'] });
    await flush(); await flush();
    const update = app.received.filter(message => message.type === 'analysis-update').at(-1)!;
    assert.deepEqual(update.selectedFilePaths, ['/sources/rec/a.wav']);
    assert.match(app.status, /^big\.wav: /);
});

test('folder tracks keep their folder path in reports, release unchecks them and a file pick joins the list', async () => {
    const app = harness();
    const folderPicker = app.elements.find(element => element.tag === 'input' && 'webkitdirectory' in element.attributes)!;
    const file = (path: string) => ({ size: 100, name: path.split('/').pop()!, webkitRelativePath: path, arrayBuffer: async () => new ArrayBuffer(100) });
    folderPicker.files = [file('rec/a_b/c.wav'), file('rec/a/b/c.wav')];
    folderPicker.onchange!();
    app.host.postMessage({ type: 'analyze-selected-files', requestId: 'r1', filePaths: ['/sources/rec/a_b/c.wav', '/sources/rec/a/b/c.wav'] });
    await flush(); await flush();
    const lastUpdate = () => app.received.filter(message => message.type === 'analysis-update').at(-1)!;
    assert.deepEqual((lastUpdate().results as Array<{ reportSourcePath: string }>).map(result => result.reportSourcePath), ['rec/a_b/c.wav', 'rec/a/b/c.wav']);

    app.host.releaseSource!('/sources/rec/a_b/c.wav');
    assert.deepEqual(lastUpdate().selectedFilePaths, ['/sources/rec/a/b/c.wav']);

    await app.load();
    assert.deepEqual(app.received.filter(message => message.type === 'directory-selection').at(-1),
        { type: 'directory-selection', rootPath: '/sources', rootLabel: '', filePaths: ['/sources/rec/a_b/c.wav', '/sources/rec/a/b/c.wav', '/sources/selected.wav'] });
    assert.deepEqual(lastUpdate().selectedFilePaths, ['/sources/rec/a/b/c.wav', '/sources/selected.wav']);
    assert.deepEqual((lastUpdate().results as Array<{ reportSourcePath: string }>).map(result => result.reportSourcePath), ['rec/a/b/c.wav', 'selected.wav']);
});

test('folders join the list, a reopened folder keeps its entries and a different folder with a taken name gets a suffix', async () => {
    const app = harness();
    const folderPicker = app.elements.find(element => element.tag === 'input' && 'webkitdirectory' in element.attributes)!;
    const file = (path: string) => ({ size: 100, name: path.split('/').pop()!, webkitRelativePath: path, lastModified: 1, arrayBuffer: async () => new ArrayBuffer(100) });
    const listings = () => app.received.filter(message => message.type === 'directory-selection');
    folderPicker.files = [file('rec/a.wav')];
    folderPicker.onchange!();
    app.host.postMessage({ type: 'analyze-selected-files', requestId: 'r1', filePaths: ['/sources/rec/a.wav'] });
    await flush(); await flush();
    folderPicker.files = [file('rec/a.wav')];
    folderPicker.onchange!();
    assert.equal(listings().length, 1);
    folderPicker.files = [file('rec/b.wav')];
    folderPicker.onchange!();
    assert.deepEqual(listings().at(-1), { type: 'directory-selection', rootPath: '/sources', rootLabel: '', filePaths: ['/sources/rec/a.wav', '/sources/rec (2)/b.wav'], entry: true });
    assert.deepEqual(app.received.filter(message => message.type === 'analysis-update').at(-1)!.selectedFilePaths, ['/sources/rec/a.wav']);
    assert.ok(!app.workers[0].commands.some(command => command.cmd === 'clear'), 'opening a folder keeps the loaded tracks');
});

test('a dropped folder is walked through its entries and listed beside dropped files', async () => {
    const app = harness();
    const wav = (name: string) => ({ size: 100, name, lastModified: 1, arrayBuffer: async () => new ArrayBuffer(100) });
    const entry = (name: string) => ({ isDirectory: false, name, file: (done: (file: unknown) => void) => done(wav(name)) });
    const dir = (name: string, entries: unknown[]) => ({ isDirectory: true, name, createReader: () => {
        let read = false;
        return { readEntries: (done: (batch: unknown[]) => void) => { done(read ? [] : entries); read = true; } };
    } });
    const drop = app.windowListeners.get('drop') as unknown as (event: unknown) => void;
    drop({ preventDefault: () => undefined, dataTransfer: {
        types: ['Files'],
        items: [{ webkitGetAsEntry: () => dir('take', [entry('c.wav'), entry('notes.txt'), dir('sub', [entry('d.WAV')])]) }, { webkitGetAsEntry: () => entry('loose.wav') }],
        files: [{ name: 'take' }, wav('loose.wav')],
    } });
    await flush(); await flush(); await flush();
    assert.deepEqual(app.received.filter(message => message.type === 'directory-selection').at(-1)!.filePaths,
        ['/sources/take/c.wav', '/sources/take/sub/d.WAV', '/sources/loose.wav']);
    assert.deepEqual(app.received.filter(message => message.type === 'analysis-update').at(-1)!.selectedFilePaths, ['/sources/loose.wav']);
});

test('Open Folder walks the File System Access picker and ignores a cancelled pick', async () => {
    const app = harness();
    const openFolder = { onclick: () => app.host.postMessage({ type: 'select-target', targetKind: 'directory' }) };
    const file = (name: string) => ({ kind: 'file', name, getFile: async () => ({ size: 100, name, arrayBuffer: async () => new ArrayBuffer(100) }) });
    const dir = (name: string, entries: unknown[]) => ({ kind: 'directory', name, values: async function* () { yield* entries; } });
    const status = app.status;
    (app.browser as unknown as Record<string, unknown>).showDirectoryPicker = async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); };
    openFolder.onclick!();
    await flush();
    assert.equal(app.status, status);
    assert.equal(app.received.some(message => message.type === 'directory-selection'), false);

    const folderBlob = { size: 100, name: 'b.wav', arrayBuffer: async () => new ArrayBuffer(100) };
    const folderFile = { kind: 'file', name: 'b.wav', getFile: async () => folderBlob };
    (app.browser as unknown as Record<string, unknown>).showDirectoryPicker = async () => dir('rec', [folderFile, file('notes.txt'), dir('day2', [file('a.WAV')])]);
    openFolder.onclick!();
    await flush(); await flush();
    assert.deepEqual(app.received.find(message => message.type === 'directory-selection'),
        { type: 'directory-selection', rootPath: '/sources/rec', rootLabel: 'rec', filePaths: ['/sources/rec/b.wav', '/sources/rec/day2/a.WAV'], entry: true });

    // Picking a file of the opened folder adds it as its own top-level entry and leaves the folder's entry unchecked.
    app.picker.files = [folderBlob];
    app.picker.onchange!();
    await flush(); await flush();
    assert.deepEqual(app.received.filter(message => message.type === 'directory-selection').at(-1),
        { type: 'directory-selection', rootPath: '/sources', rootLabel: '', filePaths: ['/sources/rec/b.wav', '/sources/rec/day2/a.WAV', '/sources/b.wav'] });
    assert.deepEqual(app.received.filter(message => message.type === 'analysis-update').at(-1)!.selectedFilePaths, ['/sources/b.wav']);

    // A folder still being walked when Clear empties the list is not listed afterwards.
    let release!: () => void;
    const walking = new Promise<void>(resolve => { release = resolve; });
    (app.browser as unknown as Record<string, unknown>).showDirectoryPicker = async () => ({ kind: 'directory', name: 'slow', values: async function* () { await walking; yield file('c.wav'); } });
    openFolder.onclick!();
    await flush();
    app.clear(true);
    await flush();
    release();
    await flush(); await flush();
    assert.deepEqual(app.received.filter(message => message.type === 'directory-selection').at(-1)!.filePaths, []);
});

test('every format wandas reads is offered and keeps its extension when listed', async () => {
    const app = harness();
    const file = (name: string) => ({ size: 100, name, lastModified: 1, arrayBuffer: async () => new ArrayBuffer(100) });
    assert.equal(app.picker.accept, '.wav,.flac,.ogg,.oga,.opus,.mp3,.aiff,.aif,.au,.snd,.caf,.rf64,.w64,.csv');
    app.picker.files = [file('take.FLAC'), file('accel.csv'), file('take.flac'), file('clip.m4a')];
    app.picker.onchange!();
    await flush(); await flush();
    assert.deepEqual(app.received.filter(message => message.type === 'directory-selection').at(-1)!.filePaths,
        ['/sources/take.FLAC', '/sources/accel.csv', '/sources/take.flac']);
});

test('picked files are listed in the tree under their own names and load checked; a name taken twice gets a suffix', async () => {
    const app = harness();
    const wav = (name: string, lastModified = 1) => ({ size: 100, name, lastModified, arrayBuffer: async () => new ArrayBuffer(100) });
    app.picker.files = [wav('a.wav'), wav('notes.txt')];
    app.picker.onchange!();
    await flush(); await flush();
    app.picker.files = [wav('a.wav', 2)];
    app.picker.onchange!();
    await flush(); await flush();
    assert.deepEqual(app.received.filter(message => message.type === 'directory-selection').at(-1),
        { type: 'directory-selection', rootPath: '/sources', rootLabel: '', filePaths: ['/sources/a.wav', '/sources/a (2).wav'] });
    const lastUpdate = app.received.filter(message => message.type === 'analysis-update').at(-1)!;
    assert.deepEqual(lastUpdate.selectedFilePaths, ['/sources/a.wav', '/sources/a (2).wav']);
    assert.deepEqual((lastUpdate.results as Array<{ fileName: string }>).map(result => result.fileName), ['a.wav', 'a.wav']);

    app.picker.files = [wav('notes.txt')];
    app.picker.onchange!();
    assert.equal(app.status, app.browser.__APP_STRINGS__.browserDropNoWav);

    // After unchecking every file, picking the same file again checks its existing entry instead of listing a copy.
    app.clear();
    await flush(); await flush();
    app.picker.files = [wav('a.wav')];
    app.picker.onchange!();
    await flush(); await flush();
    assert.deepEqual(app.received.filter(message => message.type === 'directory-selection').at(-1)!.filePaths, ['/sources/a.wav', '/sources/a (2).wav']);
    assert.deepEqual(app.received.filter(message => message.type === 'analysis-update').at(-1)!.selectedFilePaths, ['/sources/a.wav']);

    // A file that is already loaded gets a second entry, so it can be compared with itself.
    app.picker.files = [wav('a.wav')];
    app.picker.onchange!();
    await flush(); await flush();
    assert.deepEqual(app.received.filter(message => message.type === 'analysis-update').at(-1)!.selectedFilePaths, ['/sources/a.wav', '/sources/a (3).wav']);

    // The panel's Clear empties the list, so the next pick starts it again without a suffix.
    app.clear(true);
    await flush(); await flush();
    assert.deepEqual(app.received.filter(message => message.type === 'directory-selection').at(-1),
        { type: 'directory-selection', rootPath: '/sources', rootLabel: '', filePaths: [] });
    assert.equal(app.status, app.browser.__APP_STRINGS__.browserCleared);
    app.picker.files = [wav('a.wav', 2)];
    app.picker.onchange!();
    await flush(); await flush();
    assert.deepEqual(app.received.filter(message => message.type === 'directory-selection').at(-1)!.filePaths, ['/sources/a.wav']);
});

test('an entry scan loads each listed file only for its scan, reuses unchanged files and then restarts the Worker', async () => {
    const app = harness();
    app.served['./recipes/entry-scan.recipe.json'] = { schema: 'wandas.recipe', version: 2, inputs: [{ id: 'input-0', name: 'signal', kind: 'frame' }], nodes: [], output: 'input-0' };
    (app.browser as unknown as { crypto: Crypto }).crypto = globalThis.crypto;
    const folderPicker = app.elements.find(element => element.tag === 'input' && 'webkitdirectory' in element.attributes)!;
    const file = (path: string, byte: number) => ({ size: 4, name: path.split('/').pop()!, webkitRelativePath: path, arrayBuffer: async () => new Uint8Array([byte, 1, 2, 3]).buffer });
    folderPicker.files = [file('rec/a.wav', 1), file('rec/b.wav', 2)];
    folderPicker.onchange!();
    assert.equal(app.received.find(message => message.type === 'directory-selection')!.entry, true);
    const filePaths = ['/sources/rec/a.wav', '/sources/rec/b.wav'];
    const answered = new Set<Record<string, unknown>>();
    async function scanFolder(requestId: string): Promise<Record<string, unknown>[]> {
        const results = (): Record<string, unknown>[] => app.received.filter(message => message.type === 'entry-scan-result' && message.requestId === requestId);
        app.host.postMessage({ type: 'entry-scan', requestId, filePaths });
        // Hashing runs on the platform's crypto threads, so this waits on time rather than on a number of turns.
        for (const until = Date.now() + 5000; Date.now() < until && !app.received.some(message => message.type === 'entry-scan-done' && message.requestId === requestId);) {
            await new Promise(resolve => setTimeout(resolve, 2));
            for (const worker of app.workers) {
                for (const command of worker.commands) {
                    if (command.cmd === 'scan' && !answered.has(command)) { answered.add(command); worker.reply(command); }
                }
            }
        }
        return results();
    }

    const first = await scanFolder('e1');
    assert.deepEqual(first.map(message => [message.filePath, (message.result as { ok: boolean }).ok]), filePaths.map(path => [path, true]));
    const scanWorker = app.workers[0];
    assert.deepEqual(scanWorker.commands.map(command => command.cmd).filter(cmd => cmd !== 'limits'), ['load', 'scan', 'unload', 'load', 'scan', 'unload']);
    assert.deepEqual(scanWorker.commands.filter(command => command.cmd === 'scan').map(command => command.filePath), filePaths);
    for (const until = Date.now() + 5000; Date.now() < until && app.workers.length < 2;) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(scanWorker.terminated, true, 'the scan Worker is replaced so Pyodide gives its heap back');
    assert.equal(app.workers.length, 2);
    assert.deepEqual(Object.keys(JSON.parse(app.storage.get('awa.scanIndex.v1')!)), filePaths);

    const again = await scanFolder('e2');
    assert.equal(again.length, 2);
    assert.ok(!app.workers.slice(1).some(worker => worker.commands.some(command => command.cmd === 'scan')), 'unchanged files are not scanned again');
    assert.equal(app.workers.length, 2, 'a scan that scanned nothing keeps the Worker');

    app.host.postMessage({ type: 'entry-save-conditions', table: { columns: ['line'], checked: [0], rows: { a: ['L1'] } } });
    await flush();
    assert.deepEqual(JSON.parse(app.storage.get('awa.conditions.v1')!), { columns: ['line'], checked: [0], rows: { a: ['L1'] } });
    app.host.setState({ entrySlots: [null, '/sources/rec/a.wav', null, null] });
    assert.deepEqual(harness(app.storage).host.getState()?.entrySlots, [null, '/sources/rec/a.wav', null, null]);
});

test('after a folder scan the next Worker boots behind the current one, which keeps answering until the swap', async () => {
    const app = harness();
    app.served['./recipes/entry-scan.recipe.json'] = { schema: 'wandas.recipe', version: 2, inputs: [{ id: 'input-0', name: 'signal', kind: 'frame' }], nodes: [], output: 'input-0' };
    (app.browser as unknown as { crypto: Crypto }).crypto = globalThis.crypto;
    const folderPicker = app.elements.find(element => element.tag === 'input' && 'webkitdirectory' in element.attributes)!;
    const file = (path: string, byte: number) => ({ size: 4, name: path.split('/').pop()!, webkitRelativePath: path, arrayBuffer: async () => new Uint8Array([byte, 1, 2, 3]).buffer });
    folderPicker.files = [file('rec/a.wav', 1), file('rec/b.wav', 2)];
    folderPicker.onchange!();
    const filePaths = ['/sources/rec/a.wav', '/sources/rec/b.wav'];
    const answer = async (until: () => boolean): Promise<void> => {
        const answered = new Set<Record<string, unknown>>();
        for (const stop = Date.now() + 5000; Date.now() < stop && !until();) {
            await new Promise(resolve => setTimeout(resolve, 2));
            for (const worker of app.workers) for (const command of worker.commands) {
                if (command.cmd === 'scan' && !answered.has(command)) { answered.add(command); worker.reply(command); }
            }
        }
    };
    // The spare Worker has not booted: it does not answer yet.
    app.holdSpareBoot();
    app.host.postMessage({ type: 'entry-scan', requestId: 'e1', filePaths });
    await answer(() => app.received.some(message => message.type === 'entry-scan-done'));
    for (const stop = Date.now() + 5000; Date.now() < stop && app.workers.length < 2;) await new Promise(resolve => setTimeout(resolve, 2));
    const [current, spare] = app.workers;
    assert.ok(spare, 'a spare Worker boots after the folder scan');
    assert.equal(current.terminated, false, 'the current Worker is kept while the spare boots');
    // The comparison is answered meanwhile, by the current Worker: nothing waits for the boot.
    app.host.postMessage({ type: 'compare-scan', requestId: 'b1', filePaths: [filePaths[0]], stage: 'node-0' });
    await answer(() => app.received.some(message => message.type === 'compare-scan-done'));
    assert.ok(app.received.some(message => message.type === 'compare-scan-done' && message.requestId === 'b1'));
    assert.ok(current.commands.filter(command => command.cmd === 'scan').length >= 3);
    assert.ok(!spare.commands.some(command => command.cmd === 'scan'));
    // Two sources at once (the comparison and the side panel's table): neither stops the other.
    app.host.postMessage({ type: 'compare-scan', requestId: 'track-stage-1', filePaths, stage: 'node-0' });
    app.host.postMessage({ type: 'compare-scan', requestId: 'row-1', filePaths: [filePaths[1]] });
    const done = (requestId: string) => app.received.some(message => message.type === 'compare-scan-done' && message.requestId === requestId);
    await answer(() => done('track-stage-1') && done('row-1'));
    const results = (requestId: string) => app.received.filter(message => message.type === 'compare-scan-result' && message.requestId === requestId).length;
    assert.equal(results('track-stage-1'), 2, 'the comparison gets every file although the table asked meanwhile');
    assert.equal(results('row-1'), 1);
});

test('a CSV in an opened folder is neither read as conditions nor scanned (the user picks one on the table)', async () => {
    const app = harness();
    app.served['./recipes/entry-scan.recipe.json'] = { schema: 'wandas.recipe', version: 2, inputs: [{ id: 'input-0', name: 'signal', kind: 'frame' }], nodes: [], output: 'input-0' };
    const folderPicker = app.elements.find(element => element.tag === 'input' && 'webkitdirectory' in element.attributes)!;
    const file = (path: string, text = '') => ({ size: 4, name: path.split('/').pop()!, webkitRelativePath: path, arrayBuffer: async () => new TextEncoder().encode(text || 'RIFF').buffer });
    folderPicker.files = [file('rec/a.wav'), file('rec/b.wav'), file('rec/motor.csv', '﻿sample_id,audio_file,line\nS1,a.wav,L1\nS2,b.wav,L2\n')];
    folderPicker.onchange!();
    app.host.postMessage({ type: 'entry-scan', requestId: 'm1', rootPath: '/sources/rec', filePaths: ['/sources/rec/a.wav', '/sources/rec/b.wav', '/sources/rec/motor.csv'] });
    const answered = new Set<Record<string, unknown>>();
    for (const until = Date.now() + 5000; Date.now() < until && !app.received.some(message => message.type === 'entry-scan-done');) {
        await new Promise(resolve => setTimeout(resolve, 2));
        for (const worker of app.workers) for (const command of worker.commands) {
            if (command.cmd === 'scan' && !answered.has(command)) { answered.add(command); worker.reply(command); }
        }
    }
    const conditions = app.received.find(message => message.type === 'entry-conditions')!;
    assert.equal(conditions.metadataPath, undefined);
    assert.equal(conditions.table, null);
    assert.deepEqual(app.received.filter(message => message.type === 'entry-scan-result').map(message => message.filePath), ['/sources/rec/a.wav', '/sources/rec/b.wav']);
});

test('a report folder downloads as one zip named after the folder', async () => {
    const app = harness();
    const downloads: string[] = [];
    const anchors = app.elements.length;
    app.host.postMessage({ type: 'save-report-folder', folder: 'entry-scan_20261022-070509', files: [{ name: 'report.csv', text: 'a,b\r\n' }, { name: 'base.png', base64: 'iVBORw0KGgo=' }] });
    await flush();
    for (const element of app.elements.slice(anchors)) if (element.tag === 'a') downloads.push((element as unknown as { download: string }).download);
    assert.deepEqual(downloads, ['entry-scan_20261022-070509.zip']);
});
