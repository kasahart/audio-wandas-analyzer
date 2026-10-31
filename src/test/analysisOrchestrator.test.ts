import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';
import type { AnalysisHost } from '../extension/analysisOrchestrator';
import { AnalysisRequestError } from '../extension/analysisRequestError';

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
    const revisionedError = new AnalysisRequestError('stale failure', 4);
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
    const revisions = new Map([
        ['/tmp/one.wav', 2],
        ['/tmp/two.wav', 5],
        ['/tmp/three.wav', 8],
    ]);
    const startupError = new AnalysisRequestError('startup timed out', 2, true);
    const orchestrator = new AnalysisOrchestrator({
        warmup: async () => undefined,
        analysisRevisionFor: (filePath) => revisions.get(filePath) ?? 0,
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
        { fileName: 'two.wav', error: 'startup timed out', analysisRevision: 5 },
        { fileName: 'three.wav', error: 'startup timed out', analysisRevision: 8 },
    ]);
});

test('AnalysisOrchestrator progress title counts files in the display language and the bar advances past 100 files', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AnalysisOrchestrator } = require('../extension/analysisOrchestrator') as typeof import('../extension/analysisOrchestrator');
    let language = 'en';
    const titles: string[] = [];
    const increments: number[] = [];
    const host: AnalysisHost = {
        language: () => language,
        withProgress: async <T>(
            options: vscode.ProgressOptions,
            task: (
                progress: vscode.Progress<{ message?: string; increment?: number }>,
                token: vscode.CancellationToken,
            ) => Thenable<T>,
        ): Promise<T> => {
            titles.push(options.title ?? '');
            return task(
                { report: (value) => { if (value.increment !== undefined) increments.push(value.increment); } },
                { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) },
            );
        },
    };
    const backend = {
        warmup: async () => undefined,
        analyze: async (filePath: string) => ({
            filePath, fileName: 'a.wav', sampleRateHz: 48_000, durationSeconds: 1, channelCount: 0, sampleCount: 48_000, channels: [],
        }),
    };
    const orchestrator = new AnalysisOrchestrator(backend, () => undefined, host);

    await orchestrator.analyzeFiles(['/tmp/a.wav']);
    const many = Array.from({ length: 150 }, (_, index) => `/tmp/${index}.wav`);
    await orchestrator.analyzeFiles(many);
    language = 'ja';
    await orchestrator.analyzeFiles(['/tmp/a.wav', '/tmp/b.wav']);

    assert.deepEqual(titles, ['Analyzing 1 file with wandas', 'Analyzing 150 files with wandas', 'wandas で 2 ファイル を解析しています']);
    const manyIncrements = increments.slice(1, 151);
    assert.ok(manyIncrements.every(increment => increment > 0));
    assert.ok(Math.abs(manyIncrements.reduce((sum, increment) => sum + increment, 0) - 100) < 1e-9);
});
