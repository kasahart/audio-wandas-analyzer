import assert from 'node:assert/strict';
import test from 'node:test';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { AnalysisResultWithError, AnalysisUpdateMessage } from '../shared/analysis/analysisTypes';
import type { PanelBackend, PanelControllerHost, PanelFactory, PanelHandle } from '../extension/panelController';
import type { ExportFlows } from '../extension/exportFlows';
import type { SpectrogramSettingsContext } from '../extension/spectrogramSettings';

test('directory selection uses live result updates with resource URIs, cache reuse and stale-request protection', async () => {
    const uri = (fsPath: string) => ({ fsPath, toString: () => `file:${fsPath}` });
    const NodeModule = require('node:module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
    const originalLoad = NodeModule._load;
    NodeModule._load = function(request, parent, isMain) {
        if (request === 'vscode') return {
            Uri: { file: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
            FileType: { File: 1, Directory: 2 }, ViewColumn: { One: 1 },
            EventEmitter: class { readonly event = () => ({ dispose() {} }); fire() {} dispose() {} },
            commands: { executeCommand: async () => undefined }, workspace: { fs: {} },
            window: { showErrorMessage() {}, showInformationMessage() {}, showOpenDialog() {} },
        };
        return originalLoad.call(this, request, parent, isMain);
    };
    let PanelController: typeof import('../extension/panelController').PanelController;
    let ComparisonPanel: typeof import('../webview/panels/ComparisonPanel').ComparisonPanel;
    try {
        PanelController = require('../extension/panelController').PanelController;
        ComparisonPanel = require('../webview/panels/ComparisonPanel').ComparisonPanel;
    } finally { NodeModule._load = originalLoad; }

    const messages: AnalysisUpdateMessage[] = [];
    let receive: ((message: unknown) => unknown) | undefined;
    let htmlWrites = 0;
    const webview = {
        options: { localResourceRoots: [uri('/retention') as vscode.Uri] } as vscode.WebviewOptions,
        set html(_value: string) { htmlWrites++; },
        asWebviewUri: (source: { fsPath: string }) => ({ toString: () => `vscode-resource:${source.fsPath}` }),
        onDidReceiveMessage: (listener: (message: unknown) => unknown) => { receive = listener; return { dispose() {} }; },
        postMessage: async (message: unknown) => {
            if ((message as { type: string }).type === 'analysis-update') messages.push(message as AnalysisUpdateMessage);
            return true;
        },
    };
    const panel: PanelHandle = { webview, onDidDispose: () => ({ dispose() {} }) };
    const factory: PanelFactory = {
        showResults: () => panel,
        showDirectory: () => { webview.html = 'initial shell'; return panel; },
        updateDirectoryResults: (results, target, selectedFilePaths) => ComparisonPanel.updateDirectoryResults(
            results, target as vscode.WebviewPanel, selectedFilePaths,
        ),
    };
    const writes: string[] = [], errors: string[] = [], analyzed: string[][] = [];
    const context = {
        extensionUri: uri('/extension'),
        workspaceState: { get: <T>(_key: string, fallback: T) => fallback, update: async (key: string) => { writes.push(key); } },
    } as unknown as SpectrogramSettingsContext & { extensionUri: vscode.Uri };
    const host: PanelControllerHost = {
        fileSystem: {
            stat: async () => ({ type: 2, ctime: 0, mtime: 0, size: 0 }),
            readDirectory: async (source) => source.fsPath.endsWith('/sub') ? [['b.wav', 1]] : [['a.wav', 1], ['c.wav', 1], ['sub', 2]],
        },
        showOpenDialog: async () => undefined, executeCommand: async () => undefined,
        showInformation() {}, showError: message => { errors.push(message); },
        getPythonEnvironment: () => ({ pythonCommand: 'python3', status: 'normal', tooltip: 'python3' }),
        onPythonEnvironmentChange: () => ({ dispose() {} }),
    };
    let analysisGate: Promise<void> | undefined;
    const controller = new PanelController(context, {} as PanelBackend, {
        warmup() {},
        analyzeFiles: async (filePaths) => {
            analyzed.push([...filePaths]);
            await analysisGate;
            return filePaths.map(filePath => ({ filePath, fileName: path.basename(filePath), sampleRateHz: 16000,
                durationSeconds: 1, channelCount: 0, sampleCount: 16000, channels: [], analysisRevision: 0,
            } satisfies AnalysisResultWithError));
        },
    }, {} as ExportFlows, factory, host);
    const tick = () => new Promise<void>(resolve => setImmediate(resolve));
    let sequence = 0;
    const select = async (filePaths: string[]) => {
        receive!({ type: 'analyze-selected-files', requestId: `selection-${++sequence}`, filePaths });
        await tick();
    };
    try {
        await controller.analyzeTarget(uri('/retention') as vscode.Uri);
        await select(['/retention/a.wav', '/retention/c.wav']);
        await select(['/retention/c.wav']);
        await select(['/retention/c.wav', '/retention/sub/b.wav', '/retention/a.wav']);
        assert.equal(htmlWrites, 1, 'checkbox updates must not replace the Webview document');
        assert.deepEqual(analyzed, [['/retention/a.wav', '/retention/c.wav'], ['/retention/sub/b.wav']]);
        assert.equal(messages.length, 3);
        assert.deepEqual(messages.at(-1)!.results.map(r => r.filePath), controller.getActiveFilePaths(panel));
        assert.equal((messages.at(-1)!.results[1] as AnalysisResultWithError & { audioSource: string }).audioSource,
            'vscode-resource:/retention/sub/b.wav');
        assert.deepEqual(webview.options.localResourceRoots!.map(root => root.fsPath), ['/retention'],
            'selection updates must leave Webview options unchanged');
        receive!({ type: 'comparison-panel-ready', calibrationRevisions: [] });
        await tick();
        assert.deepEqual(messages.at(-1)!.selectedFilePaths, controller.getActiveFilePaths(panel));
        assert.ok(messages.at(-1)!.results.every(result => (result as { audioSource?: string }).audioSource?.startsWith('vscode-resource:')));
        await select([]);
        assert.deepEqual(messages.at(-1)!.results, []);
        assert.deepEqual(ComparisonPanel.getResults(panel), []);
        assert.equal(htmlWrites, 1);

        await controller.analyzeTarget(uri('/retention') as vscode.Uri, panel);
        let release!: () => void;
        analysisGate = new Promise<void>(resolve => { release = resolve; });
        await select(['/retention/a.wav']);
        await select([]);
        const updateCount = messages.length;
        release(); await tick();
        assert.equal(messages.length, updateCount, 'stale analysis must not restore cleared selection');
        assert.deepEqual(controller.getActiveFilePaths(panel), []);
        assert.deepEqual(ComparisonPanel.getResults(panel), []);
        assert.equal(htmlWrites, 2, 'opening a directory explicitly may initialize a new shell');
        assert.deepEqual(writes, [], 'selection updates must not add persistent settings');
        assert.deepEqual(errors, []);
    } finally { controller.dispose(); }
});
