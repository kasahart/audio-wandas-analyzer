import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisClient, executeLazyAnalysis, lazyAnalysisError } from '../shared/analysis/analysisClient';
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
