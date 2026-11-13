import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import type * as vscode from 'vscode';
import type { AnalysisResultWithError, AnalysisUpdateMessage } from '../shared/analysis/analysisTypes';
import type { AnalysisOrchestrator } from '../extension/analysisOrchestrator';
import type {
    PanelBackend,
    PanelControllerHost,
    PanelFactory,
    PanelHandle,
} from '../extension/panelController';
import type { ExportFlows } from '../extension/exportFlows';
import type { SpectrogramSettingsContext } from '../shared/analysis/savedSpectrogramSettings';
import { BackendRequestError } from '../shared/protocol/backendProtocol';

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

/**
 * A promise settled by the first value `matches` accepts. A test awaits exactly what it asserts on, with no wall
 * clock: node:test's own timeout (AWAIT_LIMIT_MS) is the only limit, so a slow runner waits longer instead of failing.
 */
// node:test's own limit for a test that awaits what it asserts on (its default is none: a lost answer would hang).
const AWAIT_LIMIT_MS = 60_000;

function whenSeen<T>(matches: (value: T) => boolean): { see: (value: T) => void; seen: Promise<void> } {
    let resolve!: () => void;
    const seen = new Promise<void>((done) => { resolve = done; });
    return { see: (value) => { if (matches(value)) resolve(); }, seen };
}

function loadModules(): {
    PanelController: typeof import('../extension/panelController').PanelController;
    storedScanIdentity: typeof import('../extension/panelController').storedScanIdentity;
    analysedUnder: typeof import('../extension/panelController').analysedUnder;
    CalibrationStore: typeof import('../extension/calibrationStore').CalibrationStore;
    calibrationFileKey: typeof import('../extension/calibrationStore').calibrationFileKey;
} {
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
    let storedScanIdentity: typeof import('../extension/panelController').storedScanIdentity;
    let analysedUnder: typeof import('../extension/panelController').analysedUnder;
    let CalibrationStore: typeof import('../extension/calibrationStore').CalibrationStore;
    let calibrationFileKey: typeof import('../extension/calibrationStore').calibrationFileKey;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ({ PanelController, storedScanIdentity, analysedUnder } = require('../extension/panelController') as typeof import('../extension/panelController'));
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ({ CalibrationStore, calibrationFileKey } = require('../extension/calibrationStore') as typeof import('../extension/calibrationStore'));
    } finally {
        NodeModule._load = originalLoad;
    }
    return { PanelController, storedScanIdentity, analysedUnder, CalibrationStore, calibrationFileKey };
}

test('calibration refresh reanalyzes one file without persisting panel settings', async () => {
    const { PanelController, CalibrationStore, calibrationFileKey } = loadModules();
    const calibratedPath = '/tmp/controller-calibrated.wav';
    const retainedPath = '/tmp/controller-retained.wav';
    const racingPath = '/tmp/controller-racing.wav';
    const calibrationProfile = {
        schemaVersion: 1 as const,
        channels: [{
            channelIndex: 0,
            expectedLabel: 'input',
            status: 'calibrated' as const,
            source: 'manual' as const,
            factor: 2,
            unit: 'Pa',
            referenceValue: 2e-5,
        }],
    };
    const initialResults = [result(calibratedPath, 0, 0.1), result(retainedPath, 0, 0.2)];
    initialResults[0].calibrationProfile = calibrationProfile;
    const refreshed = result(calibratedPath, 1, 0.8);
    const calls: Array<{
        filePaths: string[];
        cancellable: boolean | undefined;
    }> = [];
    let multiResults = initialResults;
    let raceAttempt = 0;
    let resolveRacingAnalysis: (() => void) | undefined;
    let markRacingStarted: (() => void) | undefined;
    const racingStarted = new Promise<void>((resolve) => { markRacingStarted = resolve; });
    const racingGate = new Promise<void>((resolve) => { resolveRacingAnalysis = resolve; });
    let holdCalibrationRefresh = false;
    let releaseCalibrationRefresh: (() => void) | undefined;
    const calibrationRefreshGate = new Promise<void>((resolve) => { releaseCalibrationRefresh = resolve; });
    const analyzeFiles: AnalysisOrchestrator['analyzeFiles'] = async (
        filePaths,
        _stftOptions,
        _titleOverride,
        _progressSink,
        cancellable,
    ) => {
        calls.push({ filePaths: [...filePaths], cancellable });
        if (filePaths.length === 1 && filePaths[0] === racingPath) {
            raceAttempt += 1;
            if (raceAttempt === 1) {
                markRacingStarted?.();
                await racingGate;
                return [result(racingPath, 0, 0.3)];
            }
            return [result(racingPath, calibration.analysisRevision(racingPath), 0.7)];
        }
        if (filePaths.length === 1) {
            if (holdCalibrationRefresh) { await calibrationRefreshGate; }
            return [refreshed];
        }
        return multiResults;
    };

    let receiveMessage: ((message: unknown) => unknown) | undefined;
    let resolveAnalysisUpdate: ((message: { results: AnalysisResultWithError[] }) => void) | undefined;
    let resolveWaveformResult: ((message: unknown) => void) | undefined;
    const nextAnalysisUpdate = (): Promise<{ results: AnalysisResultWithError[] }> => new Promise((resolve) => {
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
                    resolveAnalysisUpdate?.(message as { results: AnalysisResultWithError[] });
                    resolveAnalysisUpdate = undefined;
                }
                if (message && typeof message === 'object'
                    && (message as { type?: unknown }).type === 'waveform-range-result') {
                    resolveWaveformResult?.(message);
                    resolveWaveformResult = undefined;
                }
                return true;
            },
        },
        onDidDispose: () => ({ dispose: () => undefined }),
    };
    // A store of the test's own proves PanelController reads displayed results through the injected factory.
    let displayed: AnalysisResultWithError[] = [];
    const panelFactory: PanelFactory = {
        getResults: () => [...displayed],
        updateResults: (_target, results) => { displayed = [...results]; },
        replaceResult: (_target, result) => {
            if (!displayed.some((entry) => entry.filePath === result.filePath)) { return undefined; }
            displayed = displayed.map((entry) => (entry.filePath === result.filePath ? result : entry));
            return [...displayed];
        },
        updateDirectoryResults: async () => true,
        showResults: (_extensionUri, results) => {
            displayed = [...results];
            return panel;
        },
        showDirectory: () => panel,
    };
    const calibrationProfilesKey = 'audioWandasAnalyzer.calibrationProfiles.v1';
    const workspaceValues: Record<string, unknown> = {
        // The store keys profiles canonically ('/tmp/x.wav' resolves to 'D:\\tmp\\x.wav' on Windows), as it writes them.
        [calibrationProfilesKey]: {
            [calibrationFileKey(calibratedPath)]: calibrationProfile,
            [calibrationFileKey(racingPath)]: {
                schemaVersion: 1,
                channels: [{
                    channelIndex: 0,
                    expectedLabel: 'input',
                    status: 'calibrated',
                    source: 'manual',
                    factor: 2,
                    unit: 'Pa',
                    referenceValue: 2e-5,
                }],
            },
        },
    };
    const workspaceUpdateKeys: string[] = [];
    const context = {
        extensionUri: { fsPath: '/extension' } as vscode.Uri,
        workspaceState: {
            get: <T>(key: string, fallback: T): T => (workspaceValues[key] as T | undefined) ?? fallback,
            update: async (key: string, value: unknown): Promise<void> => {
                workspaceValues[key] = value;
                workspaceUpdateKeys.push(key);
            },
            keys: (): readonly string[] => Object.keys(workspaceValues),
        },
    } as unknown as SpectrogramSettingsContext & { extensionUri: vscode.Uri };
    const calibration = new CalibrationStore(context as unknown as vscode.ExtensionContext);
    const host: PanelControllerHost = {
        fileSystem: {} as PanelControllerHost['fileSystem'],
        showOpenDialog: async () => undefined,
        executeCommand: async () => undefined,
        showInformation: () => undefined,
        showError: (message) => { throw new Error(message); },
        language: () => 'en',
        withProgress: (_options, task) => task({ report() {} }, { isCancellationRequested: false } as vscode.CancellationToken),
    };
    let lazyCalibration: import('../shared/protocol/backendProtocol').CalibrationRequestContext | undefined;
    const backend = {
        requestRange: async (
            _filePath: string,
            startNorm: number,
            endNorm: number,
            _points: number,
            _requestId?: string,
            calibration?: import('../shared/protocol/backendProtocol').CalibrationRequestContext,
        ) => {
            lazyCalibration = calibration;
            return {
                startNorm,
                endNorm,
                channels: [],
                analysisRevision: calibration?.analysisRevision,
            };
        },
    } as unknown as PanelBackend;
    const controller = new PanelController(
        context,
        backend,
        { analyzeFiles, warmup: () => undefined },
        {} as ExportFlows,
        calibration,
        {
            getCurrentPythonEnvironmentState: () => ({ pythonCommand: 'python3', status: 'normal', tooltip: 'python3' }),
            onDidChangePythonEnvironmentState: () => ({ dispose: () => undefined }),
        },
        panelFactory,
        host,
    );

    await controller.analyzeFiles([calibratedPath, retainedPath]);
    assert.ok(receiveMessage);
    holdCalibrationRefresh = true;
    const refreshUpdate = nextAnalysisUpdate();
    const failedCalibratedProfile = calibration.profile(calibratedPath);
    assert.ok(failedCalibratedProfile);
    await calibration.discardStale(
        calibratedPath,
        new BackendRequestError('stale-calibration', 'invalid-input', 'Calibration channel label mismatch'),
        failedCalibratedProfile,
    );
    const waveformResult = new Promise<unknown>((resolve) => { resolveWaveformResult = resolve; });
    receiveMessage({
        type: 'request-waveform-range',
        requestId: 'range-old-revision',
        trackIndex: 0,
        filePath: calibratedPath,
        startNorm: 0,
        endNorm: 1,
        points: 100,
    });
    await waveformResult;
    assert.equal(lazyCalibration?.analysisRevision, 0);
    assert.deepEqual(lazyCalibration?.calibrationProfile, calibrationProfile);
    releaseCalibrationRefresh?.();
    const update = await refreshUpdate;

    assert.deepEqual(calls, [
        { filePaths: [calibratedPath, retainedPath], cancellable: undefined },
        { filePaths: [calibratedPath], cancellable: false },
    ]);
    assert.deepEqual(workspaceUpdateKeys, [calibrationProfilesKey]);
    assert.deepEqual(update.results, [refreshed, initialResults[1]]);
    assert.deepEqual(displayed, [refreshed, initialResults[1]]);

    multiResults = [{ ...initialResults[0], error: 'obsolete failure' }, initialResults[1]];
    const staleFailureUpdate = nextAnalysisUpdate();
    receiveMessage({
        type: 'request-reanalyze',
        settings: {
            auto: true,
            stft: { nFft: 1024, overlapPercent: 75, window: 'hann' },
            display: { dbMin: null, dbMax: null, maxFrequencyHz: null },
        },
    });
    assert.deepEqual((await staleFailureUpdate).results, [refreshed, initialResults[1]]);

    displayed = [...initialResults];
    const recoveryUpdate = nextAnalysisUpdate();
    receiveMessage({
        type: 'comparison-panel-ready',
        calibrationRevisions: initialResults.map((entry) => ({
            filePath: entry.filePath,
            analysisRevision: entry.analysisRevision ?? 0,
        })),
    });
    assert.deepEqual((await recoveryUpdate).results, [refreshed, initialResults[1]]);

    const racingAnalysis = controller.analyzeFiles([racingPath]);
    await racingStarted;
    const failedRacingProfile = calibration.profile(racingPath);
    assert.ok(failedRacingProfile);
    await calibration.discardStale(
        racingPath,
        new BackendRequestError('stale-calibration', 'invalid-input', 'Calibration channel label mismatch'),
        failedRacingProfile,
    );
    resolveRacingAnalysis?.();
    await racingAnalysis;
    assert.equal(displayed[0]?.analysisRevision, 1);
    assert.equal(raceAttempt, 2);
    controller.dispose();
});

test('a calibration change refreshes every lane that shows the file, under each of its paths', { timeout: AWAIT_LIMIT_MS }, async (testContext) => {
    if (process.platform === 'win32') {
        testContext.skip('Symlink creation requires elevated privileges on Windows.');
        return;
    }
    const { PanelController, calibrationFileKey } = loadModules();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-symlink-'));
    try {
        const targetPath = path.join(directory, 'target.wav');
        const linkPath = path.join(directory, 'link.wav');
        fs.writeFileSync(targetPath, '');
        fs.symlinkSync(targetPath, linkPath);

        let revision = 0;
        let calibrationListener: ((event: { filePath: string; analysisRevision: number }) => void) | undefined;
        const refreshCalls: string[][] = [];
        let displayed: AnalysisResultWithError[] = [];
        // Done when the panel is told both lanes are of the new calibration (each path's refresh posts once).
        const refreshed = whenSeen<AnalysisUpdateMessage>((update) => update.results.length === 2
            && update.results.every((entry) => entry.analysisRevision === 1));
        const notices: string[] = [];
        const panel: PanelHandle = {
            webview: {
                onDidReceiveMessage: () => ({ dispose: () => undefined }),
                postMessage: async (message) => {
                    if ((message as { type?: unknown }).type === 'analysis-update') { refreshed.see(message as AnalysisUpdateMessage); }
                    if ((message as { type?: unknown }).type === 'entry-calibration-changed') { notices.push((message as { filePath: string }).filePath); }
                    return true;
                },
            },
            onDidDispose: () => ({ dispose: () => undefined }),
        };
        const panelFactory: PanelFactory = {
            getResults: () => [...displayed],
            updateResults: (_target, results) => { displayed = [...results]; },
            replaceResult: (_target, replacement) => {
                displayed = displayed.map((entry) => (entry.filePath === replacement.filePath ? replacement : entry));
                return [...displayed];
            },
            updateDirectoryResults: async () => true,
            showResults: (_extensionUri, results) => {
                displayed = [...results];
                return panel;
            },
            showDirectory: () => panel,
        };
        const host: PanelControllerHost = {
            fileSystem: {} as PanelControllerHost['fileSystem'],
            showOpenDialog: async () => undefined,
            executeCommand: async () => undefined,
            showInformation: () => undefined,
            showError: (message) => { throw new Error(message); },
            language: () => 'en',
            withProgress: (_options, task) => task({ report() {} }, { isCancellationRequested: false } as vscode.CancellationToken),
        };
        const context = {
            extensionUri: { fsPath: '/extension' } as vscode.Uri,
            workspaceState: {
                get: <T>(_key: string, fallback: T): T => fallback,
                update: async (): Promise<void> => undefined,
                keys: (): readonly string[] => [],
            },
        } as unknown as SpectrogramSettingsContext & { extensionUri: vscode.Uri };
        const controller = new PanelController(
            context,
            {} as PanelBackend,
            {
                analyzeFiles: async (filePaths) => {
                    if (revision > 0) { refreshCalls.push([...filePaths]); }
                    return filePaths.map((filePath) => result(filePath, revision, revision));
                },
                warmup: () => undefined,
            },
            {} as ExportFlows,
            {
                analysisRevision: () => revision,
                onDidChange: (listener) => {
                    calibrationListener = listener;
                    return { dispose: () => undefined };
                },
                configureTrack: async () => undefined,
            },
            {
                getCurrentPythonEnvironmentState: () => ({ pythonCommand: 'python3', status: 'normal', tooltip: 'python3' }),
                onDidChangePythonEnvironmentState: () => ({ dispose: () => undefined }),
            },
            panelFactory,
            host,
        );

        await controller.analyzeFiles([linkPath, targetPath]);
        revision = 1;
        calibrationListener?.({ filePath: calibrationFileKey(targetPath), analysisRevision: 1 });
        // The refresh reads each file's version on disk first (analysedUnder): wait for its update, not a number of turns.
        await refreshed.seen;

        assert.deepEqual(refreshCalls, [[linkPath], [targetPath]]);
        // The entry table hears of it too, track or not, under each path the panel names the file by (never the
        // canonical key, which the webview cannot compare its paths with).
        assert.deepEqual(notices, [linkPath, targetPath]);
        assert.deepEqual(displayed.map((entry) => [entry.filePath, entry.analysisRevision]), [[linkPath, 1], [targetPath, 1]]);
        controller.dispose();
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('a file written over on disk is told to the webview under each path it is open by, and its folder is watched until the panel goes (V1)', async () => {
    const { PanelController } = loadModules();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-watch-'));
    try {
        const first = path.join(directory, 'a.wav');
        const second = path.join(directory, 'b.wav');
        fs.writeFileSync(first, '');
        fs.writeFileSync(second, '');
        const notices: string[] = [];
        const watched = new Map<string, (filePath: string) => void>();
        const disposed: string[] = [];
        let displayed: AnalysisResultWithError[] = [];
        const panel: PanelHandle = {
            webview: {
                onDidReceiveMessage: () => ({ dispose: () => undefined }),
                postMessage: async (message) => {
                    if ((message as { type?: unknown }).type === 'entry-source-changed') { notices.push((message as { filePath: string }).filePath); }
                    return true;
                },
            },
            onDidDispose: () => ({ dispose: () => undefined }),
        };
        const panelFactory: PanelFactory = {
            getResults: () => [...displayed],
            updateResults: (_target, results) => { displayed = [...results]; },
            replaceResult: (_target, replacement) => [...displayed.map((entry) => (entry.filePath === replacement.filePath ? replacement : entry))],
            updateDirectoryResults: async () => true,
            showResults: (_extensionUri, results) => { displayed = [...results]; return panel; },
            showDirectory: () => panel,
        };
        const host: PanelControllerHost = {
            fileSystem: {} as PanelControllerHost['fileSystem'],
            showOpenDialog: async () => undefined,
            executeCommand: async () => undefined,
            showInformation: () => undefined,
            showError: (message) => { throw new Error(message); },
            language: () => 'en',
            withProgress: (_options, task) => task({ report() {} }, { isCancellationRequested: false } as vscode.CancellationToken),
            watchFolder: (folder, changed) => {
                watched.set(folder, changed);
                return { dispose: () => { disposed.push(folder); } };
            },
        };
        const context = {
            extensionUri: { fsPath: '/extension' } as vscode.Uri,
            workspaceState: { get: <T>(_key: string, fallback: T): T => fallback, update: async (): Promise<void> => undefined, keys: (): readonly string[] => [] },
        } as unknown as SpectrogramSettingsContext & { extensionUri: vscode.Uri };
        const controller = new PanelController(
            context,
            {} as PanelBackend,
            { analyzeFiles: async (filePaths) => filePaths.map((filePath) => result(filePath, 0, 0)), warmup: () => undefined },
            {} as ExportFlows,
            { analysisRevision: () => 0, onDidChange: () => ({ dispose: () => undefined }), configureTrack: async () => undefined },
            {
                getCurrentPythonEnvironmentState: () => ({ pythonCommand: 'python3', status: 'normal', tooltip: 'python3' }),
                onDidChangePythonEnvironmentState: () => ({ dispose: () => undefined }),
            },
            panelFactory,
            host,
        );
        await controller.analyzeFiles([first]);
        assert.deepEqual([...watched.keys()], [directory], 'the folder of the file open');
        watched.get(directory)?.(first);
        watched.get(directory)?.(second);
        for (let attempt = 0; attempt < 10; attempt++) await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(notices, [first], 'only a file the panel has open');
        controller.dispose();
        assert.deepEqual(disposed, [directory], 'the watcher goes with the panel');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('a stored scan is kept under the file version the backend knows: a recording copied over with its size and times kept is another (V1)', async () => {
    const { storedScanIdentity } = loadModules();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-identity-'));
    try {
        const file = path.join(directory, 'a.wav');
        const other = path.join(directory, 'new.wav');
        fs.writeFileSync(file, Buffer.from([1, 2, 3, 4]));
        fs.writeFileSync(other, Buffer.from([4, 3, 2, 1]));
        const old = new Date('2026-01-01T00:00:00Z');
        fs.utimesSync(file, old, old);
        const before = await storedScanIdentity(file);
        assert.equal(await storedScanIdentity(file), before, 'unchanged: the same');
        // `cp -p new.wav a.wav`: the same size, the old times put back; the change time (and with a rename, the inode) is not.
        await new Promise(resolve => setTimeout(resolve, 20));
        fs.copyFileSync(other, file);
        fs.utimesSync(file, old, old);
        assert.equal(fs.statSync(file).size, 4);
        assert.notEqual(await storedScanIdentity(file), before);
        assert.equal(await storedScanIdentity(path.join(directory, 'gone.wav')), undefined);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('a track analysed again for a new calibration is analysed with the STFT saved, as every other analysis of the panel (V4)', { timeout: AWAIT_LIMIT_MS }, async () => {
    const { PanelController, calibrationFileKey } = loadModules();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-stft-'));
    try {
        const file = path.join(directory, 'a.wav');
        fs.writeFileSync(file, '');
        let revision = 0;
        let calibrationListener: ((event: { filePath: string; analysisRevision: number }) => void) | undefined;
        const asked: Array<{ revision: number; stft: unknown }> = [];
        let displayed: AnalysisResultWithError[] = [];
        // What the test asserts on, awaited as such: the analysis the calibration asks, and the update it posts.
        const reasked = whenSeen<number>((calls) => calls === 2);
        const updated = whenSeen<AnalysisUpdateMessage>((update) => update.results.some((entry) => entry.analysisRevision === 1));
        const panel: PanelHandle = {
            webview: {
                onDidReceiveMessage: () => ({ dispose: () => undefined }),
                postMessage: async (message) => { if ((message as { type?: unknown }).type === 'analysis-update') updated.see(message as AnalysisUpdateMessage); return true; },
            },
            onDidDispose: () => ({ dispose: () => undefined }),
        };
        const panelFactory: PanelFactory = {
            getResults: () => [...displayed],
            updateResults: (_target, results) => { displayed = [...results]; },
            replaceResult: (_target, replacement) => { displayed = displayed.map((entry) => (entry.filePath === replacement.filePath ? replacement : entry)); return [...displayed]; },
            updateDirectoryResults: async () => true,
            showResults: (_extensionUri, results) => { displayed = [...results]; return panel; },
            showDirectory: () => panel,
        };
        const host: PanelControllerHost = {
            fileSystem: {} as PanelControllerHost['fileSystem'],
            showOpenDialog: async () => undefined,
            executeCommand: async () => undefined,
            showInformation: () => undefined,
            showError: (message) => { throw new Error(message); },
            language: () => 'en',
            withProgress: (_options, task) => task({ report() {} }, { isCancellationRequested: false } as vscode.CancellationToken),
        };
        // A manual STFT saved with ⚙.
        const saved = { auto: false, stft: { nFft: 8192, overlapPercent: 75, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } };
        const context = {
            extensionUri: { fsPath: '/extension' } as vscode.Uri,
            workspaceState: { get: <T>(key: string, fallback: T): T => (key === 'audioWandasAnalyzer.spectrogramSettings' ? saved as T : fallback), update: async (): Promise<void> => undefined, keys: (): readonly string[] => [] },
        } as unknown as SpectrogramSettingsContext & { extensionUri: vscode.Uri };
        const controller = new PanelController(
            context,
            {} as PanelBackend,
            {
                analyzeFiles: async (filePaths, stftOptions) => { asked.push({ revision, stft: stftOptions }); reasked.see(asked.length); return filePaths.map((filePath) => result(filePath, revision, revision)); },
                warmup: () => undefined,
            },
            {} as ExportFlows,
            { analysisRevision: () => revision, onDidChange: (listener) => { calibrationListener = listener; return { dispose: () => undefined }; }, configureTrack: async () => undefined },
            {
                getCurrentPythonEnvironmentState: () => ({ pythonCommand: 'python3', status: 'normal', tooltip: 'python3' }),
                onDidChangePythonEnvironmentState: () => ({ dispose: () => undefined }),
            },
            panelFactory,
            host,
        );
        await controller.analyzeFiles([file]);
        revision = 1;
        // The store names the file by its canonical key (calibrationFileKey), never the path as the panel spelled it:
        // they differ where the temporary folder is reached through a symlink (macOS: /var -> /private/var).
        calibrationListener?.({ filePath: calibrationFileKey(file), analysisRevision: 1 });
        await Promise.all([reasked.seen, updated.seen]);
        assert.deepEqual(asked.map((item) => item.revision), [0, 1]);
        assert.deepEqual(asked[1].stft, saved.stft, 'the calibration\'s analysis takes the STFT saved, never the automatic one');
        controller.dispose();
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('a track\'s cached analysis is kept under the STFT asked and the file\'s version on disk (V3)', async () => {
    const { analysedUnder } = loadModules();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'analysed-under-'));
    try {
        const file = path.join(directory, 'b.wav');
        fs.writeFileSync(file, Buffer.from([1, 2, 3, 4]));
        const manual = { nFft: 1024, overlapPercent: 75, window: 'hann' as const };
        const first = (await analysedUnder([file], manual)).get(file);
        assert.equal((await analysedUnder([file], manual)).get(file), first, 'the same: the cache stands');
        assert.notEqual((await analysedUnder([file], { ...manual, nFft: 8192 })).get(file), first, 'another STFT applied');
        assert.notEqual((await analysedUnder([file], undefined)).get(file), first, 'the automatic STFT');
        await new Promise(resolve => setTimeout(resolve, 20));
        const old = fs.statSync(file).mtime;
        fs.writeFileSync(file, Buffer.from([4, 3, 2, 1]));
        fs.utimesSync(file, old, old);
        assert.notEqual((await analysedUnder([file], manual)).get(file), first, 'the file written since');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
