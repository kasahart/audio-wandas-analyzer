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
        getDefaultPeakCount: () => 5,
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
        warmup: () => undefined,
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
