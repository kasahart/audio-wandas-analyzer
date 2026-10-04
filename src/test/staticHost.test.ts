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
    let firstAnalysis = true;
    class ControlledWorker {
        commands: Record<string, unknown>[] = [];
        terminated = false;
        onmessage!: (event: { data: Record<string, unknown> }) => void;
        onerror!: () => void;
        constructor() { workers.push(this); }
        terminate(): void { this.terminated = true; }
        postMessage(command: Record<string, unknown>): void {
            this.commands.push(command);
            if (command.cmd === 'load' || (command.cmd === 'analyze' && firstAnalysis)) {
                if (command.cmd === 'analyze') firstAnalysis = false;
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
        URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: () => undefined },
        setTimeout, Uint8Array,
    });
    const host = browser.__AWA_HOST__!;
    host.onMessage!(message => received.push(message as Record<string, unknown>));
    const picker = elements.find(element => element.tag === 'input')!;
    async function load(): Promise<void> {
        picker.files = [{ size: 100, name: 'selected.wav', arrayBuffer: async () => new ArrayBuffer(100) }];
        firstAnalysis = true;
        picker.onchange!();
        await flush();
    }
    return { host, workers, received, load, get sourcePath() { return `/sources/${workers.at(-1)!.commands[0].sourceId}`; } };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const identity = { filePath: '/sources/selected.wav', requestId: 'ui', analysisId: 'a', settingsSignature: 's', trackIndex: 0 };

test('unrelated detail/export errors do not end a pending reanalysis', async () => {
    const app = harness();
    await app.load();
    app.host.postMessage({ type: 'request-reanalyze', settings: { auto: true } });
    app.host.postMessage({ ...identity, filePath: app.sourcePath, type: 'request-track-detail' });
    app.host.postMessage({ type: 'export-wav-loop', filePaths: [app.sourcePath], startNorm: 0.2, endNorm: 0.5 });
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
