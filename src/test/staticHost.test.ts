import { DEFAULT_SPECTROGRAM_SETTINGS } from '../shared/analysis/analysisTypes';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { WebviewHostApi } from '../webview/runtime/types';
import type { UiStrings } from '../shared/i18n/strings';

class MockElement {
    style = {};
    value = '';
    disabled = false;
    multiple = false;
    textContent = '';
    id = '';
    src = '';
    attributes: Record<string, string> = {};
    children: MockElement[] = [];
    removed = false;
    files?: Array<{ size: number; name: string; arrayBuffer(): Promise<ArrayBuffer> }>;
    onchange?: () => void;
    onclick?: () => void;
    contentDocument?: MockDocument;
    contentWindow?: Record<string, unknown>;
    constructor(readonly tag: string) {
        if (tag === 'iframe') { this.contentDocument = new MockDocument(); this.contentWindow = {}; }
    }
    setAttribute(name: string, value: string): void { this.attributes[name] = value; }
    append(...nodes: MockElement[]): void { this.children.push(...nodes); }
    insertAdjacentElement(_where: string, node: MockElement): void { this.children.push(node); }
    remove(): void { this.removed = true; }
    click(): void {}
}
class MockDocument {
    head = new MockElement('head');
    body = new MockElement('body');
    createElement(tag: string): MockElement { return new MockElement(tag); }
}

function harness(storage = new Map<string, string>(), language = 'en', denied = false, recipeTimeout = 120_000) {
    const elements: MockElement[] = [];
    const fetched: string[] = [];
    const prompts: string[] = [];
    let promptAnswer: string | null = '1';
    const served: Record<string, unknown> = {
        './recipes/manifest.json': [
            { name: 'octave.json', location: './recipes/octave.json' },
            { name: 'loudness.json', location: './recipes/loudness.json', missing: ['mosqito'] },
        ],
        './recipes/octave.json': { inputs: [{ name: 'sig', file: '{{selection}}' }], steps: [{ as: 'o', expr: 'sig.noct_spectrum()' }], display: ['o'] },
    };
    const workers: ControlledWorker[] = [];
    const received: Record<string, unknown>[] = [];
    const firstAnalysis = new Set<string>();
    const revoked: string[] = [];
    let blobId = 0;
    class ControlledWorker {
        commands: Record<string, unknown>[] = [];
        terminated = false;
        onmessage!: (event: { data: Record<string, unknown> }) => void;
        onerror!: () => void;
        constructor() { workers.push(this); }
        terminate(): void { this.terminated = true; }
        postMessage(command: Record<string, unknown>): void {
            this.commands.push(command);
            if (command.cmd === 'load') firstAnalysis.add(`/sources/${command.sourceId}`);
            if (['load','unload','export-plan'].includes(String(command.cmd)) || (command.cmd === 'analyze' && firstAnalysis.has(String(command.filePath)))) {
                if (command.cmd === 'analyze') firstAnalysis.delete(String(command.filePath));
                queueMicrotask(() => this.reply(command, command.cmd === 'load' ? { filePath: `/sources/${command.sourceId}` } : {}));
            }
        }
        reply(command: Record<string, unknown>, result: Record<string, unknown> = {}, error?: string): void {
            const fixtures = JSON.parse(readFileSync(join(process.cwd(), 'src/test/fixtures/backendProtocol.json'), 'utf8')).validResponses as Array<{ command: string; response: Record<string, unknown> }>;
            const base = fixtures.find(fixture => fixture.command === command.cmd)?.response ?? {};
            this.onmessage({ data: { requestId: command.requestId, result: { ...base, filePath: command.filePath, ...result }, error } });
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
        addEventListener: () => undefined,
        dispatchEvent: () => { throw new Error('Static host must not use the window message channel'); },
    };
    runInNewContext(readFileSync(join(__dirname, '../webview/staticHost.js'), 'utf8'), {
        window: browser,
        document: {
            createElement: (tag: string) => { const element = new MockElement(tag); elements.push(element); return element; },
            body: { prepend: () => undefined },
            querySelector: () => elements.find(element => element.tag === 'section' && !element.removed) ?? null,
        },
        fetch: async (url: string) => { fetched.push(url); const body = served[url]; return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body }; },
        Object,
        Worker: ControlledWorker,
        URL: { createObjectURL: () => `blob:fixture-${++blobId}`, revokeObjectURL: (url: string) => { revoked.push(url); } },
        setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay === 120_000 ? recipeTimeout : delay),
        clearTimeout, Uint8Array,
    });
    const host = browser.__AWA_HOST__!;
    host.onMessage!(message => received.push(message as Record<string, unknown>));
    const picker = elements.find(element => element.tag === 'input')!;
    async function load(): Promise<void> {
        picker.files = [{ size: 100, name: 'selected.wav', arrayBuffer: async () => new ArrayBuffer(100) }];
        picker.onchange!();
        await flush();
    }
    return { host, browser, storage, workers, received, load, picker, elements, revoked, fetched, prompts, served,
        setPromptAnswer(value: string | null) { promptAnswer = value; },
        get status() { return elements.find(element => element.tag === 'span')!.textContent; },
        get sourcePath() { return `/sources/${workers.at(-1)!.commands.filter(command => command.cmd === 'load').at(-1)!.sourceId}`; } };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const identity = { filePath: '/sources/selected.wav', requestId: 'ui', analysisId: 'a', settingsSignature: 's', trackIndex: 0 };

test('browser preferences restore safely across reloads and use shared Japanese strings', () => {
    const storage = new Map<string, string>();
    const app = harness(storage, 'ja-JP');
    assert.equal(app.browser.__APP_STRINGS__.btnOpenFile, 'ファイルを開く');
    const settings = { auto: false, stft: { nFft: 256, hopSize: 64, window: 'hann' }, display: { dbMin: -80, dbMax: 0, maxFrequencyHz: 4000 } };
    app.host.postMessage({ type: 'update-spectrogram-settings', settings });
    app.host.setState({ contentType: 'spectrogram', directoryCollapseRootPath: '/private/path' });
    const restored = harness(storage);
    assert.equal(JSON.stringify(restored.browser.__APP_STATE__.spectrogramSettings), JSON.stringify(settings));
    assert.equal(restored.host.getState()?.contentType, 'spectrogram');
    assert.ok(!storage.get('audioWandasAnalyzer.viewState')!.includes('/private/path'));
    storage.set('audioWandasAnalyzer.spectrogramSettings', '{broken');
    assert.equal(harness(storage).browser.__APP_STATE__.spectrogramSettings.auto, true);
    assert.equal(harness(storage, 'en', true).browser.__APP_STATE__.spectrogramSettings.auto, true);
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
    assert.equal(app.workers[0].terminated, true);
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
    assert.equal((app.received.filter(message => message.type === 'analysis-update').at(-1)!.results as unknown[]).length, 8);
    assert.equal(app.revoked.length, 0);
});

test('cancel during a file read clears all sources and ignores late completion', async () => {
    const app = harness(); await app.load();
    let finish!: (bytes: ArrayBuffer) => void;
    app.picker.files = [{ name: 'late.wav', size: 100, arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }];
    app.picker.onchange!();
    app.elements.find(element => element.tag === 'button')!.onclick!();
    finish(new ArrayBuffer(100)); await flush();
    assert.equal(app.workers.length, 1);
    assert.equal(app.workers[0].terminated, true);
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
    assert.match(app.prompts[0], /1: octave.json\n2: loudness.json/);
    const worker = app.workers[0];
    const command = worker.commands.at(-1)!;
    assert.equal(command.cmd, 'run-recipe');
    assert.equal(command.requestId, 'recipe-1');
    assert.equal(command.recipePath, './recipes/octave.json');
    assert.equal(JSON.stringify(command.inputContexts), JSON.stringify({ sig: { analysisRevision: 0 } }));
    assert.equal(JSON.stringify((command.recipe as { inputs: unknown }).inputs), JSON.stringify([{ name: 'sig', file: app.sourcePath }]));
    worker.reply(command, { charts: [{ kind: 'scalar', title: 'Peak', rows: [] }] });
    await flush();
    const frame = app.elements.find(element => element.tag === 'iframe')!;
    assert.equal(JSON.stringify((frame.contentWindow as { __CHART_SPECS__: unknown }).__CHART_SPECS__), JSON.stringify([{ kind: 'scalar', title: 'Peak', rows: [] }]));
    assert.equal(frame.contentDocument!.body.children.at(-1)!.src, './chartSpec.js');
    assert.equal(frame.contentDocument!.body.children[0].id, 'charts');
    assert.equal(app.status, app.browser.__APP_STRINGS__.browserRecipeDone + 'octave.json');
    const close = app.elements.find(element => element.attributes['data-action'] === 'browser-recipe-close')!;
    close.onclick!();
    assert.equal(app.elements.find(element => element.tag === 'section')!.removed, true);
    app.setPromptAnswer('2');
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    assert.match(app.status, /loudness.json needs mosqito/);
    assert.equal(worker.commands.filter(entry => entry.cmd === 'run-recipe').length, 1);
    app.setPromptAnswer('1');
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    worker.reply(worker.commands.at(-1)!, {}, 'recipe error: Unknown name');
    await flush();
    assert.equal(app.status, 'Recipe execution failed: recipe error: Unknown name');
});

test('clearing sources during a recipe preserves the new status and ignores late charts', async () => {
    const app = harness();
    await app.load();
    app.host.postMessage({ type: 'run-recipe' });
    await flush();
    const worker = app.workers[0];
    const command = worker.commands.at(-1)!;
    assert.equal(command.cmd, 'run-recipe');
    app.elements.find(element => element.attributes['data-action'] === 'browser-clear')!.onclick!();
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
    const ready = app.status;
    app.host.postMessage({ ...message, channels: [] });
    assert.equal(app.status, ready);
    app.host.postMessage(message);
    assert.equal(app.status, app.browser.__APP_STRINGS__.browserUnavailable);
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
    app.elements.find(element => element.attributes['data-action'] === 'browser-clear')!.onclick!();
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
