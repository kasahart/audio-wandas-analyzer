import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';
import type { AnalysisHost } from '../extension/analysisOrchestrator';

test('AnalysisOrchestrator exposes non-cancellable progress for calibration reanalysis', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = NodeModule._load;
    NodeModule._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
        if (request === 'vscode') {
            return {
                ProgressLocation: { Notification: 15 },
                CancellationError: class CancellationError extends Error {},
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let AnalysisOrchestrator: typeof import('../extension/analysisOrchestrator').AnalysisOrchestrator;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        AnalysisOrchestrator = require('../extension/analysisOrchestrator').AnalysisOrchestrator;
    } finally {
        NodeModule._load = originalLoad;
    }

    const cancellable: Array<boolean | undefined> = [];
    const host: AnalysisHost = {
        withProgress: async <T>(
            options: vscode.ProgressOptions,
            task: (
                progress: vscode.Progress<{ message?: string; increment?: number }>,
                token: vscode.CancellationToken,
            ) => Thenable<T>,
        ): Promise<T> => {
            cancellable.push(options.cancellable);
            return task(
                { report: () => undefined },
                { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) },
            );
        },
    };
    const backend = {
        warmup: async () => undefined,
        analyze: async (filePath: string) => ({
            filePath,
            fileName: 'audio.wav',
            sampleRateHz: 48_000,
            durationSeconds: 1,
            channelCount: 0,
            sampleCount: 48_000,
            channels: [],
        }),
    };
    const orchestrator = new AnalysisOrchestrator(backend, () => undefined, host);

    await orchestrator.analyzeFiles(['/tmp/audio.wav']);
    await orchestrator.analyzeFiles(['/tmp/audio.wav'], undefined, undefined, undefined, false);

    assert.deepEqual(cancellable, [true, false]);
});

test('AnalysisOrchestrator preserves the requested calibration revision on errors', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnalysisOrchestrator } = require('../extension/analysisOrchestrator') as typeof import('../extension/analysisOrchestrator');
    const host: AnalysisHost = {
        withProgress: async <T>(
            _options: vscode.ProgressOptions,
            task: (
                progress: vscode.Progress<{ message?: string; increment?: number }>,
                token: vscode.CancellationToken,
            ) => Thenable<T>,
        ): Promise<T> => task(
            { report: () => undefined },
            { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) },
        ),
    };
    const revisionedError = Object.assign(new Error('stale failure'), { analysisRevision: 4 });
    const orchestrator = new AnalysisOrchestrator({
        warmup: async () => undefined,
        analyze: async () => { throw revisionedError; },
    }, () => undefined, host);

    const [result] = await orchestrator.analyzeFiles(['/tmp/audio.wav']);

    assert.equal(result.error, 'stale failure');
    assert.equal(result.analysisRevision, 4);
});

test('AnalysisOrchestrator catches fire-and-forget warmup failures', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnalysisOrchestrator } = require('../extension/analysisOrchestrator') as typeof import('../extension/analysisOrchestrator');
    const logLines: string[] = [];
    const orchestrator = new AnalysisOrchestrator({
        warmup: async () => { throw new Error('startup failed'); },
        analyze: async () => { throw new Error('not used'); },
    }, (line) => { logLines.push(line); });

    orchestrator.warmup();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(logLines, ['[ts] backend warmup failed error=startup failed']);
});

test('AnalysisOrchestrator does not retry a shared backend startup failure for every file', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnalysisOrchestrator } = require('../extension/analysisOrchestrator') as typeof import('../extension/analysisOrchestrator');
    const host: AnalysisHost = {
        withProgress: async <T>(
            _options: vscode.ProgressOptions,
            task: (
                progress: vscode.Progress<{ message?: string; increment?: number }>,
                token: vscode.CancellationToken,
            ) => Thenable<T>,
        ): Promise<T> => task(
            { report: () => undefined },
            { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) },
        ),
    };
    let analyzeCalls = 0;
    const startupError = Object.assign(new Error('startup timed out'), {
        analysisRevision: 2,
        backendStartupFailure: true,
    });
    const orchestrator = new AnalysisOrchestrator({
        warmup: async () => undefined,
        analyze: async () => {
            analyzeCalls += 1;
            throw startupError;
        },
    }, () => undefined, host);

    const results = await orchestrator.analyzeFiles(['/tmp/one.wav', '/tmp/two.wav', '/tmp/three.wav']);

    assert.equal(analyzeCalls, 1);
    assert.deepEqual(results.map((result) => ({
        fileName: result.fileName,
        error: result.error,
        analysisRevision: result.analysisRevision,
    })), [
        { fileName: 'one.wav', error: 'startup timed out', analysisRevision: 2 },
        { fileName: 'two.wav', error: 'startup timed out', analysisRevision: 2 },
        { fileName: 'three.wav', error: 'startup timed out', analysisRevision: 2 },
    ]);
});
