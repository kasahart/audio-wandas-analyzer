import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { WebviewHostApi } from '../webview/runtime/types';

class MockElement {
    style = {};
    value = '';
    disabled = false;
    multiple = false;
    textContent = '';
    files?: Array<{ size: number; name: string; arrayBuffer(): Promise<ArrayBuffer> }>;
    onchange?: () => void;
    onclick?: () => void;
    constructor(readonly tag: string) {}
    setAttribute(): void {}
    append(): void {}
    click(): void {}
}

function harness() {
    const elements: MockElement[] = [];
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
            this.onmessage({ data: { requestId: command.requestId, result, error } });
        }
    }
    const browser = {
        __APP_STATE__: { spectrogramSettings: { auto: true } },
        __AWA_HOST__: undefined as WebviewHostApi | undefined,
        addEventListener: () => undefined,
        dispatchEvent: () => { throw new Error('Static host must not use the window message channel'); },
    };
    runInNewContext(readFileSync(join(__dirname, '../webview/staticHost.js'), 'utf8'), {
        window: browser,
        document: {
            createElement: (tag: string) => { const element = new MockElement(tag); elements.push(element); return element; },
            body: { prepend: () => undefined },
        },
        Worker: ControlledWorker,
        URL: { createObjectURL: () => `blob:fixture-${++blobId}`, revokeObjectURL: (url: string) => { revoked.push(url); } },
        setTimeout, Uint8Array,
    });
    const host = browser.__AWA_HOST__!;
    host.onMessage!(message => received.push(message as Record<string, unknown>));
    const picker = elements.find(element => element.tag === 'input')!;
    async function load(): Promise<void> {
        picker.files = [{ size: 100, name: 'selected.wav', arrayBuffer: async () => new ArrayBuffer(100) }];
        picker.onchange!();
        await flush();
    }
    return { host, workers, received, load, picker, elements, revoked, get sourcePath() { return `/sources/${workers.at(-1)!.commands.filter(command => command.cmd === 'load').at(-1)!.sourceId}`; } };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const identity = { filePath: '/sources/selected.wav', requestId: 'ui', analysisId: 'a', settingsSignature: 's', trackIndex: 0 };

test('unrelated detail/export errors do not end a pending reanalysis', async () => {
    const app = harness();
    await app.load();
    app.host.postMessage({ type: 'request-reanalyze', settings: { auto: true } });
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
    app.host.postMessage({ type: 'request-reanalyze', settings: { auto: true } });
    app.host.postMessage({ type: 'request-reanalyze', settings: { auto: true } });
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
    app.host.postMessage({ type: 'request-reanalyze', settings: { auto: true } });
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
