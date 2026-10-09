import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisClient, executeLazyAnalysis, lazyAnalysisError, type AnalysisCancellationSignal } from '../shared/analysis/analysisClient';
import { RequestGeneration, runAnalysisBatch } from '../shared/analysis/analysisCoordinator';
import type { BackendCommand, BackendPayload, BackendResult } from '../shared/protocol/backendProtocol';
import { exportWavRegions } from '../shared/utils/exportArtifact';
import { identityCalibrationProfile } from '../shared/analysis/calibrationModel';

class RecordingClient extends AnalysisClient {
    calls: Array<{ command: BackendCommand; payload: unknown; requestId?: string }> = [];
    protected async request<K extends BackendCommand>(command: K, payload: BackendPayload<K>, requestId?: string): Promise<BackendResult<K>> {
        this.calls.push({ command, payload, requestId });
        return { channels: [], analysisRevision: 7, ...(command === 'spectrum-slice' ? { frequencyBins: 0, maxFrequencyHz: 8000 } : {}) } as unknown as BackendResult<K>;
    }
}

test('all analysis paths carry the same settings/calibration context; range carries calibration only', async () => {
    const client = new RecordingClient();
    const context = { stftOptions: { nFft: 256, hopSize: 64, window: 'hann' as const },
        calibrationProfile: identityCalibrationProfile([{ channelIndex: 0, label: 'left' }]), analysisRevision: 7 };
    const identity = { filePath: 'source', trackIndex: 3, requestId: 'ui', analysisId: 'analysis', settingsSignature: 'settings' };
    await client.analyze('source', context);
    const detail = await executeLazyAnalysis(client, { ...identity, type: 'request-track-detail' }, context);
    assert.equal(detail.type, 'track-detail-result');
    assert.equal(detail.requestId, 'ui');
    assert.equal(detail.filePath, 'source');
    await executeLazyAnalysis(client, { ...identity, type: 'request-waveform-range', startNorm: 0.2, endNorm: 0.7, points: 128 }, context);
    const slice = await executeLazyAnalysis(client, { ...identity, type: 'request-spectrum-slice', cursorNorm: 0.5 }, context);
    assert.equal(slice.type, 'spectrum-slice-result');
    assert.equal('cursorNorm' in slice && slice.cursorNorm, 0.5);
    for (const call of client.calls) {
        const payload = call.payload as Record<string, unknown>;
        assert.deepEqual(payload.calibrationProfile, context.calibrationProfile);
        assert.equal(payload.analysisRevision, 7);
        assert.equal(payload.filePath, 'source');
        assert.deepEqual(payload.stftOptions, call.command === 'range' ? undefined : context.stftOptions);
    }
    assert.equal(lazyAnalysisError({ ...identity, type: 'request-spectrum-slice', cursorNorm: 0.5 }, new Error('failed')).type, 'spectrum-slice-error');
});

test('batch ignores removed sources and late results after a newer request', async () => {
    const generation = new RequestGeneration();
    const ticket = generation.advance();
    const selected = new Set(['a', 'b']);
    const committed: string[] = [];
    let complete!: (value: string) => void;
    const running = runAnalysisBatch(['a', 'b'], {
        isCurrent: () => generation.isCurrent(ticket), isSelected: source => selected.has(source),
        analyze: source => new Promise<string>(resolve => { complete = resolve; }),
        commit: (_source, result) => { committed.push(result); },
    });
    selected.delete('a'); generation.advance(); complete('late'); await running;
    assert.deepEqual(committed, []);
});

test('export has one offset-region plan and preserves continue-versus-abort sink policy', async () => {
    const message = { type: 'export-wav-loop' as const, filePaths: ['a', 'b'], startNorm: 0, endNorm: 1,
        fileRegions: [{ filePath: 'b', startNorm: 0.25, endNorm: 0.5 }] };
    const sources = message.filePaths.map(filePath => ({ filePath, fileName: 'same.wav' }));
    const calls: unknown[] = [], names: string[] = [];
    await exportWavRegions(message, sources, {
        isCurrent: () => true,
        exportWavLoop: async (...args) => { calls.push(args); return { wavBase64: '', sampleRate: 8000 }; },
        write: async (_source, name) => { names.push(name); if (names.length === 1) throw new Error('write failed'); },
        failed: () => true,
    });
    assert.deepEqual(calls, [['a', 0, 1], ['b', 0.25, 0.5]]);
    assert.deepEqual(names, ['same_loop.wav', 'same_loop_2.wav']);
    let exports = 0;
    await assert.rejects(exportWavRegions(message, sources, {
        isCurrent: () => true,
        exportWavLoop: async () => { exports++; throw new Error('abort'); }, write: async () => undefined,
    }), /abort/);
    assert.equal(exports, 1);
});

test('injected context resolves defaults but preserves explicit displayed revision, including zero', async () => {
    const profile = identityCalibrationProfile([{ channelIndex: 0, label: 'left' }]);
    const client = new class extends RecordingClient {
        constructor() { super({ current: () => ({ calibrationProfile: profile, analysisRevision: 9 }) }); }
    }();
    assert.equal(client.analysisRevisionFor('source'), 9);
    await client.requestRange('source', 0, 1, 10);
    await client.requestRange('source', 0, 1, 10, 'displayed', { analysisRevision: 0 });
    await client.requestTrackDetail('source', { trackIndex: 0, analysisId: 'a', settingsSignature: 's' }, 'detail');
    await client.requestSpectrumSlice('source', { trackIndex: 0, analysisId: 'a', settingsSignature: 's', cursorNorm: 0.5, analysisRevision: 3 }, 'slice');
    const payloads = client.calls.map(call => call.payload as { calibrationProfile?: unknown; analysisRevision: number });
    assert.deepEqual(payloads.map(payload => payload.analysisRevision), [9, 0, 9, 3]);
    assert.deepEqual(payloads.map(payload => payload.calibrationProfile), [profile, undefined, profile, undefined]);
});

test('stale context retries once after matching discard and reads the new revision', async () => {
    const profile = identityCalibrationProfile([{ channelIndex: 0, label: 'left' }]);
    const calls: Array<{ profile?: unknown; revision?: number }> = [];
    let revision = 2, discarded = 0;
    const client = new class extends AnalysisClient {
        constructor() {
            super({
                current: () => ({ calibrationProfile: profile, analysisRevision: revision }),
                discardStale: async (_path, error, attempted) => {
                    assert.equal((error as Error).message, 'stale');
                    assert.equal(attempted.calibrationProfile, profile);
                    discarded++; revision = 3; return true;
                },
            });
        }
        protected async request<K extends BackendCommand>(_command: K, payload: BackendPayload<K>): Promise<BackendResult<K>> {
            const context = payload as { calibrationProfile?: unknown; analysisRevision?: number };
            calls.push({ profile: context.calibrationProfile, revision: context.analysisRevision });
            if (calls.length === 1) throw new Error('stale');
            return {} as BackendResult<K>;
        }
    }();
    await client.analyze('source', { analysisRevision: 0 });
    assert.deepEqual(calls, [{ profile, revision: 2 }, { profile: undefined, revision: 3 }]);
    assert.equal(discarded, 1);
});

test('changed profiles and cancelled analyses do not retry when the host declines discard', async () => {
    for (const reason of ['cancelled', 'profile replaced']) {
        let attempts = 0;
        const failure = new Error(reason);
        const client = new class extends AnalysisClient {
            constructor() { super({ current: () => ({ calibrationProfile: identityCalibrationProfile([]), analysisRevision: 4 }), discardStale: async () => false }); }
            protected async request<K extends BackendCommand>(_command: K, _payload: BackendPayload<K>): Promise<BackendResult<K>> {
                attempts++; throw failure;
            }
        }();
        await assert.rejects(client.analyze('source', {}), error => error === failure);
        assert.equal(attempts, 1);
    }
});

test('unconfigured browser client preserves input context without invoking host calibration storage', async () => {
    const client = new RecordingClient();
    const context = { calibrationProfile: identityCalibrationProfile([]), analysisRevision: 6 };
    await client.analyze('source', context);
    assert.deepEqual(client.calls[0].payload, { filePath: 'source', ...context });
});

test('host current context replaces analyze options; absence of a stored profile clears an older explicit profile', async () => {
    const client = new class extends RecordingClient {
        constructor() { super({ current: () => ({ analysisRevision: 8 }) }); }
    }();
    await client.analyze('source', { calibrationProfile: identityCalibrationProfile([]), analysisRevision: 1 });
    assert.deepEqual(client.calls[0].payload, { filePath: 'source', analysisRevision: 8 });
});


test('recipes send each input calibration context and their source location', async () => {
    const profile = identityCalibrationProfile([{ channelIndex: 0, label: 'left' }]);
    const client = new RecordingClient({ current: file => ({
        calibrationProfile: profile, analysisRevision: file === '/first.wav' ? 2 : 5,
    }) });
    const recipe = { inputs: [{ name: 'left', file: '/first.wav' }, { name: 'right', file: '/second.wav' }] };
    await client.runRecipe(recipe, { recipePath: '/recipes/custom.json' });
    assert.deepEqual(client.calls[0], { command: 'run-recipe', requestId: 'recipe-1', payload: {
        recipe, recipePath: '/recipes/custom.json', inputContexts: {
            left: { calibrationProfile: profile, analysisRevision: 2 },
            right: { calibrationProfile: profile, analysisRevision: 5 },
        },
    } });
});


for (const kind of ['cancel', 'timeout'] as const) {
    test(`Recipe ${kind} rejects and aborts its transport request`, async () => {
        let cancel: (() => void) | undefined;
        let disposed = 0;
        class WaitingClient extends AnalysisClient {
            protected override recipeTimeoutMs = 10;
            aborted: string[] = [];
            protected async request<K extends BackendCommand>(): Promise<BackendResult<K>> {
                return new Promise(() => {});
            }
            protected override cancelRequest(requestId: string): void { this.aborted.push(requestId); }
        }
        const client = new WaitingClient();
        const waiting = client.runRecipe({ inputs: [] }, { cancellation: {
            isCancellationRequested: false,
            onCancellationRequested: listener => { cancel = listener; return { dispose: () => { disposed++; } }; },
        } });
        if (kind === 'cancel') cancel?.();
        await assert.rejects(waiting, kind === 'cancel' ? /cancelled/ : /timed out/);
        assert.deepEqual(client.aborted, ['recipe-1']);
        assert.equal(disposed, 1);
    });
}

test('already cancelled Recipe does not dispatch a backend request', async () => {
    const client = new RecordingClient();
    await assert.rejects(client.runRecipe({ inputs: [] }, { cancellation: {
        isCancellationRequested: true,
        onCancellationRequested: () => { throw new Error('must not subscribe'); },
    } }), /cancelled/);
    assert.equal(client.calls.length, 0);
});

test('cancelling Recipe while its transport starts prevents a late dispatch', async () => {
    let finishStartup!: () => void;
    const startup = new Promise<void>(resolve => { finishStartup = resolve; });
    let cancel!: () => void;
    let transportFinished!: () => void;
    const finished = new Promise<void>(resolve => { transportFinished = resolve; });
    const client = new class extends AnalysisClient {
        sent = false;
        protected async request<K extends BackendCommand>(
            _command: K, _payload: BackendPayload<K>, _requestId?: string, cancellation?: AnalysisCancellationSignal,
        ): Promise<BackendResult<K>> {
            await startup;
            transportFinished();
            if (cancellation?.isCancellationRequested) throw new Error('Startup cancelled');
            this.sent = true;
            return { charts: [] } as unknown as BackendResult<K>;
        }
    }();
    const waiting = client.runRecipe({ inputs: [] }, { cancellation: {
        isCancellationRequested: false,
        onCancellationRequested: listener => { cancel = listener; return { dispose() {} }; },
    } });
    cancel();
    await assert.rejects(waiting, /Recipe execution cancelled/);
    finishStartup();
    await finished;
    assert.equal(client.sent, false);
});
