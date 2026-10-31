import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionRequests } from '../shared/analysis/analysisSession';
import { createWorkerConnection, type PythonState, type WorkerSource } from '../webview/runtime/staticWorker';

const LIMITS = { maxInputBytes: 16, maxSources: 8, maxTotalInputBytes: 64, maxExportBytes: 32 };
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

/** A Worker that records what it is sent; `answer` decides each reply (undefined: no reply yet). */
class FakeWorker {
    static all: FakeWorker[] = [];
    static answer: (command: Record<string, unknown>, worker: FakeWorker) => unknown = command => (
        command.cmd === 'load' ? { result: { filePath: `/sources/${String(command.sourceId)}` } }
            : command.cmd === 'limits' ? { result: LIMITS } : { result: {} });
    commands: Record<string, unknown>[] = [];
    terminated = false;
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    constructor(readonly url: string, readonly options: unknown) { FakeWorker.all.push(this); }
    terminate(): void { this.terminated = true; }
    postMessage(command: Record<string, unknown>): void {
        this.commands.push(command);
        const reply = FakeWorker.answer(command, this);
        if (reply !== undefined) queueMicrotask(() => this.onmessage?.({ data: { requestId: command.requestId, ...(reply as object) } }));
    }
    send(data: unknown): void { this.onmessage?.({ data }); }
}

function connection(selected: WorkerSource[] = []) {
    FakeWorker.all = [];
    const states: Array<[PythonState, boolean | undefined]> = [];
    const events: string[] = [];
    const sources = new Map(selected.map(source => [source.path, source]));
    const sourceGeneration = new SessionRequests();
    let queue: Promise<unknown> = Promise.resolve();
    const audio = createWorkerConnection({
        Worker: FakeWorker as unknown as typeof Worker,
        setTimeout,
        sources: { get size() { return sources.size; }, values: () => sources.values(), owns: (path, source) => sources.get(path) === source },
        sourceGeneration,
        exclusive: task => { const run = queue.then(task); queue = run.catch(() => undefined); return run; },
        showState: (state, quiet) => { states.push([state, quiet]); },
        reportLacks: lacks => { events.push(`lacks:${lacks.join(',')}`); },
        cancelReanalysis: () => { events.push('cancel-reanalysis'); },
        crashed: () => { events.push('crashed'); },
        bootFailedReason: 'Python failed to start',
    });
    return { audio, states, events, sources, sourceGeneration };
}
const source = (sourceId: string): WorkerSource => ({ path: `/sources/${sourceId}`, sourceId, file: { arrayBuffer: async () => new ArrayBuffer(4) } });
const defaultAnswer = FakeWorker.answer;

test('the first Worker boots with the page and its boot report drives the Python state', () => {
    FakeWorker.answer = defaultAnswer;
    const { audio, states, events } = connection();
    assert.equal(audio.running, false);
    audio.start();
    assert.equal(audio.running, true);
    assert.equal(FakeWorker.all[0].url, './audio.worker.js');
    assert.deepEqual(FakeWorker.all[0].options, { type: 'module' });
    FakeWorker.all[0].send({ ready: true, lacks: ['librosa'] });
    FakeWorker.all[0].send({ ready: 'later' });
    assert.deepEqual(states, [['starting', false], ['ready', undefined]]);
    assert.deepEqual(events, ['lacks:librosa']);
});

test('replies settle through the result validators, and a reply with extra outer keys names its envelope', async () => {
    FakeWorker.answer = defaultAnswer;
    const { audio } = connection();
    audio.start();
    assert.deepEqual(await audio.request({ cmd: 'load', sourceId: 'a.wav' }), { filePath: '/sources/a.wav' });
    FakeWorker.answer = () => ({ result: {} });
    await assert.rejects(audio.request({ cmd: 'load', sourceId: 'a.wav' }), /Invalid load success response/);
    FakeWorker.answer = () => ({ result: { filePath: '/sources/a.wav' }, debug: 1 });
    await assert.rejects(audio.request({ cmd: 'load', sourceId: 'a.wav' }), /Invalid load response envelope/);
    FakeWorker.answer = () => ({ error: { code: 'input-error', kind: 'invalid-input', message: 'Unable to read audio' } });
    await assert.rejects(audio.request({ cmd: 'load', sourceId: 'a.wav' }), /Unable to read audio/);
    FakeWorker.answer = defaultAnswer;
});

test('without a Worker only load and limits start one', async () => {
    FakeWorker.answer = defaultAnswer;
    const { audio } = connection();
    await assert.rejects(audio.request({ cmd: 'analyze', filePath: '/sources/a.wav' }), /No selected source/);
    assert.equal(FakeWorker.all.length, 0);
    assert.deepEqual(await audio.request({ cmd: 'limits' }), LIMITS);
    assert.equal(FakeWorker.all.length, 1);
});

test('a failed boot is replaced by the next request, which first loads the selected tracks again', async () => {
    FakeWorker.answer = defaultAnswer;
    const { audio, states } = connection([source('a.wav'), source('b.wav')]);
    audio.start();
    FakeWorker.all[0].send({ ready: false });
    assert.deepEqual(await audio.request({ cmd: 'unload', filePath: '/sources/a.wav' }), {});
    assert.equal(FakeWorker.all[0].terminated, true);
    assert.deepEqual(FakeWorker.all[1].commands.map(command => `${String(command.cmd)}:${String(command.sourceId ?? command.filePath)}`),
        ['load:a.wav', 'load:b.wav', 'unload:/sources/a.wav']);
    assert.deepEqual(states.map(([state]) => state), ['starting', 'failed', 'stopped', 'starting']);
});

test('a restore that a Clear overtakes is cancelled, and a cancelled Recipe does not send', async () => {
    FakeWorker.answer = defaultAnswer;
    const { audio, sourceGeneration } = connection([source('a.wav')]);
    const restoring = audio.request({ cmd: 'unload', filePath: '/sources/a.wav' });
    assert.equal(audio.recovering, true);
    assert.equal(audio.isWaiting('anything'), true, 'a Recipe timeout while sources reload still resets');
    sourceGeneration.advance();
    await assert.rejects(restoring, /Analysis cancelled/);
    assert.equal(audio.recovering, false);
    const cancelled = { isCancellationRequested: true, onCancellationRequested: () => ({ dispose: () => undefined }) };
    await assert.rejects(audio.request({ cmd: 'limits' }, undefined, undefined, cancelled), /Recipe execution cancelled/);
});

test('Clear releases sources in an idle Worker, restarts a busy one, and replaces one that cannot clear', async () => {
    FakeWorker.answer = defaultAnswer;
    const { audio, events } = connection();
    audio.start();
    audio.clear();
    await flush();
    assert.deepEqual(FakeWorker.all[0].commands.map(command => command.cmd), ['clear']);
    assert.equal(FakeWorker.all[0].terminated, false);
    assert.deepEqual(events, ['cancel-reanalysis']);

    FakeWorker.answer = () => undefined;
    const waiting = audio.request({ cmd: 'limits' });
    audio.clear();
    await assert.rejects(waiting, /Analysis cancelled/);
    assert.equal(FakeWorker.all[0].terminated, true);
    assert.equal(audio.running, false);

    FakeWorker.answer = command => (command.cmd === 'clear' ? { error: { code: 'input-error', kind: 'invalid-input', message: 'Unknown command' } } : { result: LIMITS });
    await audio.request({ cmd: 'limits' });
    audio.clear();
    await flush();
    assert.equal(FakeWorker.all[1].terminated, true);
    FakeWorker.answer = defaultAnswer;
});

test('a crashed Worker is reset, its requests reject and the host is told; an old Worker is ignored', async () => {
    FakeWorker.answer = () => undefined;
    const { audio, events } = connection();
    audio.start();
    const waiting = audio.request({ cmd: 'limits' });
    const crashed = FakeWorker.all[0];
    crashed.onerror?.();
    await assert.rejects(waiting, /Analysis cancelled/);
    assert.deepEqual(events, ['cancel-reanalysis', 'crashed']);
    assert.equal(crashed.terminated, true);
    crashed.onerror?.();
    crashed.send({ ready: true });
    assert.deepEqual(events, ['cancel-reanalysis', 'crashed']);
    FakeWorker.answer = defaultAnswer;
});

test('a spare Worker boots and loads the tracks behind the current one, then takes over once nothing waits', async () => {
    FakeWorker.answer = defaultAnswer;
    const { audio, states } = connection([source('a.wav')]);
    audio.start();
    const first = FakeWorker.all[0];
    audio.replaceBehind();
    audio.replaceBehind();
    assert.equal(FakeWorker.all.length, 2, 'one spare at a time');
    const spare = FakeWorker.all[1];
    for (let i = 0; i < 5; i++) await flush();
    assert.deepEqual(spare.commands.map(command => command.cmd), ['limits', 'load']);
    assert.equal(first.terminated, true);
    assert.deepEqual(states.map(([state]) => state), ['starting'], 'the swap shows no boot');
    assert.deepEqual(await audio.request({ cmd: 'unload', filePath: '/sources/a.wav' }), {});
    assert.equal(spare.commands.at(-1)?.cmd, 'unload');
});

test('a spare whose boot fails, or whose tracks were released meanwhile, is dropped and the current Worker stays', async () => {
    FakeWorker.answer = (command, worker) => (worker === FakeWorker.all[1] && command.cmd === 'limits' ? undefined : defaultAnswer(command, worker));
    const failing = connection([source('a.wav')]);
    failing.audio.start();
    failing.audio.replaceBehind();
    FakeWorker.all[1].send({ ready: false });
    await flush();
    assert.equal(FakeWorker.all[1].terminated, true);
    assert.equal(FakeWorker.all[0].terminated, false);

    // The spare's load is answered only after the track is released.
    let answerLoad = (): void => undefined;
    FakeWorker.answer = (command, worker) => {
        if (worker !== FakeWorker.all[1] || command.cmd !== 'load') return defaultAnswer(command, worker);
        answerLoad = () => worker.send({ requestId: command.requestId, result: { filePath: '/sources/a.wav' } });
        return undefined;
    };
    const released = connection([source('a.wav')]);
    released.audio.start();
    released.audio.replaceBehind();
    for (let i = 0; i < 5; i++) await flush();
    assert.equal(FakeWorker.all[1].commands.at(-1)?.cmd, 'load');
    released.sources.clear();
    answerLoad();
    for (let i = 0; i < 5; i++) await flush();
    assert.equal(FakeWorker.all[1].terminated, true);
    assert.equal(FakeWorker.all[0].terminated, false);
    FakeWorker.answer = defaultAnswer;
});
