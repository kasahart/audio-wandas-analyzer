import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';
import type { AnalysisResultWithError } from '../shared/analysis/analysisTypes';
import type { AnalysisOrchestrator } from '../extension/analysisOrchestrator';
import type {
    PanelBackend,
    PanelControllerHost,
    PanelFactory,
    PanelHandle,
} from '../extension/panelController';
import type { ExportFlows } from '../extension/exportFlows';
import type { SpectrogramSettingsContext } from '../extension/spectrogramSettings';

function result(filePath: string, revision: number, peakAbsolute: number): AnalysisResultWithError {
    return {
        filePath,
        fileName: filePath.split('/').at(-1) ?? filePath,
        sampleRateHz: 48_000,
        durationSeconds: 1,
        channelCount: 0,
        sampleCount: 48_000,
        analysisRevision: revision,
        channels: [],
        calibrationSignature: `revision-${revision}-${peakAbsolute}`,
    };
}

test('calibration refresh reanalyzes one file without persisting panel settings', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = NodeModule._load;
    NodeModule._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
        if (request === 'vscode') {
            return {
                commands: { executeCommand: async () => undefined },
                EventEmitter: class EventEmitter {
                    readonly event = () => ({ dispose: () => undefined });
                    fire(): void {}
                    dispose(): void {}
                },
                FileType: { Directory: 2 },
                Uri: { file: (fsPath: string) => ({ fsPath }) },
                ViewColumn: { One: 1 },
                window: {
                    showErrorMessage: async () => undefined,
                    showInformationMessage: async () => undefined,
                    showOpenDialog: async () => undefined,
                },
                workspace: { fs: {} },
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let PanelController: typeof import('../extension/panelController').PanelController;
    let ComparisonPanel: typeof import('../webview/panels/ComparisonPanel').ComparisonPanel;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        PanelController = require('../extension/panelController').PanelController;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ComparisonPanel = require('../webview/panels/ComparisonPanel').ComparisonPanel;
    } finally {
        NodeModule._load = originalLoad;
    }

    const calibratedPath = '/tmp/calibrated.wav';
    const retainedPath = '/tmp/retained.wav';
    const initialResults = [result(calibratedPath, 0, 0.1), result(retainedPath, 0, 0.2)];
    const refreshed = result(calibratedPath, 0, 0.8);
    const calls: Array<{
        filePaths: string[];
        cancellable: boolean | undefined;
    }> = [];
    const analyzeFiles: AnalysisOrchestrator['analyzeFiles'] = async (
        filePaths,
        _stftOptions,
        _titleOverride,
        _progressSink,
        cancellable,
    ) => {
        calls.push({ filePaths: [...filePaths], cancellable });
        return filePaths.length === 1 ? [refreshed] : initialResults;
    };

    let receiveMessage: ((message: unknown) => unknown) | undefined;
    let resolveAnalysisUpdate: (message: { results: AnalysisResultWithError[] }) => void = () => undefined;
    const analysisUpdate = new Promise<{ results: AnalysisResultWithError[] }>((resolve) => {
        resolveAnalysisUpdate = resolve;
    });
    const panel: PanelHandle = {
        webview: {
            onDidReceiveMessage: (listener) => {
                receiveMessage = listener;
                return { dispose: () => undefined };
            },
            postMessage: async (message) => {
                if (message && typeof message === 'object'
                    && (message as { type?: unknown }).type === 'analysis-update') {
                    resolveAnalysisUpdate(message as { results: AnalysisResultWithError[] });
                }
                return true;
            },
        },
        onDidDispose: () => ({ dispose: () => undefined }),
    };
    const panelFactory: PanelFactory = {
        showResults: (_extensionUri, results) => {
            ComparisonPanel.updateResults(panel, results);
            return panel;
        },
        showDirectory: () => panel,
    };
    let workspaceUpdates = 0;
    const context = {
        extensionUri: { fsPath: '/extension' } as vscode.Uri,
        workspaceState: {
            get: <T>(_key: string, fallback: T): T => fallback,
            update: async (): Promise<void> => { workspaceUpdates++; },
        },
    } as unknown as SpectrogramSettingsContext & { extensionUri: vscode.Uri };
    const host: PanelControllerHost = {
        fileSystem: {} as PanelControllerHost['fileSystem'],
        showOpenDialog: async () => undefined,
        executeCommand: async () => undefined,
        showInformation: () => undefined,
        showError: (message) => { throw new Error(message); },
        getPythonEnvironment: () => ({ pythonCommand: 'python3', status: 'normal', tooltip: 'python3' }),
        onPythonEnvironmentChange: () => ({ dispose: () => undefined }),
    };
    const controller = new PanelController(
        context,
        {} as PanelBackend,
        { analyzeFiles, warmup: () => undefined },
        {} as ExportFlows,
        panelFactory,
        host,
    );

    await controller.analyzeFiles([calibratedPath, retainedPath]);
    assert.ok(receiveMessage);
    receiveMessage({
        type: 'request-calibration-refresh',
        filePath: calibratedPath,
        analysisRevision: 0,
    });
    const update = await analysisUpdate;

    assert.deepEqual(calls, [
        { filePaths: [calibratedPath, retainedPath], cancellable: undefined },
        { filePaths: [calibratedPath], cancellable: false },
    ]);
    assert.equal(workspaceUpdates, 0);
    assert.deepEqual(update.results, [refreshed, initialResults[1]]);
    assert.deepEqual(ComparisonPanel.getResults(panel), [refreshed, initialResults[1]]);
});
