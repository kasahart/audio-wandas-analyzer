import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';

type Listener<T = unknown> = (event: T) => void;

function loadActivation() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = NodeModule._load;
    const originalConsoleError = console.error;
    const state = {
        registeredCommandIds: [] as string[],
        commandHandlers: new Map<string, (...args: unknown[]) => unknown>(),
        createdTreeViewIds: [] as string[],
        dependencyChecks: [] as string[],
        backendWarmupCalls: 0,
        backendDisposeCalls: 0,
        statusShown: false,
        statusShowCalls: 0,
        pythonCommand: 'python3',
        environmentStatus: 'normal' as 'normal' | 'warning',
        openTabs: [] as unknown[],
    };
    const listeners: {
        configuration?: Listener<{ affectsConfiguration(section: string): boolean }>;
        tabs?: Listener;
        environment?: Listener;
        reselected?: Listener<string>;
        welcomeVisibility?: Listener<{ visible: boolean }>;
    } = {};
    let treeViewOptions: { treeDataProvider?: { getChildren(): unknown[] } } | undefined;

    class TabInputWebview {
        constructor(readonly viewType: string) {}
    }
    const vscodeStub = {
        env: { language: 'en' },
        commands: {
            registerCommand: (commandId: string, handler: (...args: unknown[]) => unknown) => {
                state.registeredCommandIds.push(commandId);
                state.commandHandlers.set(commandId, handler);
                return { dispose() {} };
            },
            executeCommand: () => Promise.resolve(),
        },
        window: {
            createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
            createStatusBarItem: () => ({
                command: undefined as string | undefined,
                show() { state.statusShown = true; state.statusShowCalls += 1; },
                hide() { state.statusShown = false; },
                dispose() {},
            }),
            createTreeView: (viewId: string, options?: typeof treeViewOptions) => {
                state.createdTreeViewIds.push(viewId);
                treeViewOptions = options;
                return {
                    visible: false,
                    onDidChangeVisibility: (listener: Listener<{ visible: boolean }>) => {
                        listeners.welcomeVisibility = listener;
                        return { dispose() {} };
                    },
                    dispose() {},
                };
            },
            showQuickPick: async () => undefined,
            showErrorMessage: async () => undefined,
            showOpenDialog: async () => undefined,
            tabGroups: {
                get all() { return [{ tabs: state.openTabs }]; },
                onDidChangeTabs: (listener: Listener) => {
                    listeners.tabs = listener;
                    return { dispose() {} };
                },
            },
        },
        workspace: {
            getConfiguration: () => ({
                get: <T>(key: string, defaultValue: T) => (key === 'pythonCommand' ? state.pythonCommand as T : defaultValue),
            }),
            onDidChangeConfiguration: (listener: typeof listeners.configuration) => {
                listeners.configuration = listener;
                return { dispose() {} };
            },
            workspaceFolders: undefined,
        },
        StatusBarAlignment: { Left: 1 },
        Uri: { parse: (value: string) => ({ fsPath: value }), file: (value: string) => ({ fsPath: value }) },
        FileType: { Directory: 2 },
        TabInputWebview,
        TreeItem: class {
            description?: string;
            command?: { command: string; title: string };
            iconPath?: unknown;
            constructor(readonly label: string) {}
        },
        ThemeIcon: class {
            constructor(readonly id: string) {}
        },
    };

    NodeModule._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
        if (request === 'vscode') { return vscodeStub; }
        if (request === '../testing/workspaceTests') {
            return { registerWorkspaceTests: () => { throw new Error('workspace tests unavailable'); } };
        }
        if (request === '../shared/utils/startupDebug') {
            return {
                getDebugStartupBehavior: () => ({
                    closePanelOnStartup: false,
                    autoOpenDebugTarget: false,
                    autoSelectAllDirectoryFiles: false,
                }),
            };
        }
        if (request === '../webview/panels/ComparisonPanel') { return { ComparisonPanel: {} }; }
        if (request === './pythonBackendServer') {
            return {
                PythonBackendServer: class {
                    constructor(_extensionPath: string, _onPerfLine: unknown, private readonly onReady: () => void) {}
                    async warmup(): Promise<void> {
                        state.backendWarmupCalls += 1;
                        this.onReady();
                    }
                    dispose(): void { state.backendDisposeCalls += 1; }
                },
            };
        }
        if (request === './pythonEnvironment') {
            return {
                selectPythonEnvironment: async () => undefined,
                checkAndPromptInstallDependencies: async (pythonCommand: string) => {
                    state.dependencyChecks.push(pythonCommand);
                    return true;
                },
                disposePythonSetupLog: () => {},
                getPythonCommand: () => state.pythonCommand,
                refreshDefaultInterpreter: async () => false,
                getCurrentPythonEnvironmentState: () => ({
                    pythonCommand: state.pythonCommand,
                    status: state.environmentStatus,
                    tooltip: '',
                }),
                onDidChangePythonEnvironmentState: (listener: Listener) => {
                    listeners.environment = listener;
                    return { dispose() {} };
                },
                onDidReselectPythonCommand: (listener: Listener<string>) => {
                    listeners.reselected = listener;
                    return { dispose() {} };
                },
                onDidChangeDefaultInterpreter: () => ({ dispose() {} }),
                setStatusBarImporting: () => {},
                setStatusBarNormal: () => { listeners.environment?.({}); },
                setStatusBarWarning: () => {},
            };
        }
        if (request === '../shared/utils/audioTarget' || request === '../shared/utils/directorySelection') {
            return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    console.error = () => {};
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const extensionModule = require('../extension/index') as {
        activate(context: { extensionPath: string; extensionUri: { fsPath: string }; subscriptions: Array<{ dispose(): void }> }): void;
    };
    return {
        state,
        listeners,
        TabInputWebview,
        welcomeItems: () => treeViewOptions?.treeDataProvider?.getChildren() as Array<{
            label: string;
            description?: string;
            command?: { command: string; title: string };
            iconPath?: { id: string };
        }>,
        activate: () => extensionModule.activate({
            extensionPath: '/tmp/audio-wandas-analyzer',
            extensionUri: { fsPath: '/tmp/audio-wandas-analyzer' },
            subscriptions: [],
        }),
        changeConfiguration: (section: string) => listeners.configuration?.({
            affectsConfiguration: (candidate) => candidate === section,
        }),
        restore: () => {
            console.error = originalConsoleError;
            NodeModule._load = originalLoad;
            // Every extension module captured this harness's vscode stub, so the next harness reloads them all.
            const extensionDirectory = path.join(__dirname, '..', 'extension') + path.sep;
            for (const cached of Object.keys(require.cache)) {
                if (cached.startsWith(extensionDirectory)) { delete require.cache[cached]; }
            }
        },
    };
}

async function settle(): Promise<void> {
    for (let index = 0; index < 5; index++) { await new Promise(resolve => setImmediate(resolve)); }
}

test('activation registers the commands and welcome view without starting Python or showing the status bar', async () => {
    const harness = loadActivation();
    try {
        assert.doesNotThrow(() => harness.activate());
        await settle();

        assert.deepEqual(harness.state.registeredCommandIds, [
            'audioWandasAnalyzer.analyzeFile',
            'audioWandasAnalyzer.analyzeDebugFile',
            'audioWandasAnalyzer.analyzeThisTarget',
            'audioWandasAnalyzer.selectPythonEnvironment',
            'audioWandasAnalyzer.runRecipe',
        ]);
        assert.deepEqual(harness.state.createdTreeViewIds, ['audioWandasAnalyzer.welcomeView']);
        assert.deepEqual(harness.state.dependencyChecks, []);
        assert.equal(harness.state.backendWarmupCalls, 0);
        assert.equal(harness.state.statusShown, false);

        harness.changeConfiguration('audioWandasAnalyzer.pythonCommand');
        harness.changeConfiguration('audioWandasAnalyzer.cacheMemoryMb');
        await settle();
        assert.deepEqual(harness.state.dependencyChecks, [], 'a settings change in an idle window must not start Python either');
        assert.equal(harness.state.backendWarmupCalls, 0);

        const welcomeItems = harness.welcomeItems();
        assert.equal(welcomeItems.length, 1);
        assert.equal(welcomeItems[0].label, 'Drop audio files or folders here');
        assert.equal(welcomeItems[0].description, 'Click to choose a file or folder');
        assert.deepEqual(welcomeItems[0].command, { command: 'audioWandasAnalyzer.analyzeFile', title: 'Analyze File or Folder' });
        assert.equal(welcomeItems[0].iconPath?.id, 'new-file');
    } finally {
        harness.restore();
    }
});

test('the first command checks the environment and warms the backend once; later ones reuse it', async () => {
    const harness = loadActivation();
    try {
        harness.activate();
        await harness.state.commandHandlers.get('audioWandasAnalyzer.analyzeFile')?.();
        await settle();
        assert.deepEqual(harness.state.dependencyChecks, ['python3']);
        assert.equal(harness.state.backendWarmupCalls, 1);

        await harness.state.commandHandlers.get('audioWandasAnalyzer.runRecipe')?.([]);
        await settle();
        assert.deepEqual(harness.state.dependencyChecks, ['python3']);
    } finally {
        harness.restore();
    }
});

test('opening the welcome view prepares Python', async () => {
    const harness = loadActivation();
    try {
        harness.activate();
        harness.listeners.welcomeVisibility?.({ visible: true });
        await settle();
        assert.deepEqual(harness.state.dependencyChecks, ['python3']);
        assert.equal(harness.state.backendWarmupCalls, 1);
    } finally {
        harness.restore();
    }
});

test('pythonCommand, cacheMemoryMb and a reselection restart a backend that was in use', async () => {
    const harness = loadActivation();
    try {
        harness.activate();
        await harness.state.commandHandlers.get('audioWandasAnalyzer.analyzeFile')?.();
        await settle();

        harness.state.pythonCommand = '.venv';
        harness.changeConfiguration('audioWandasAnalyzer.pythonCommand');
        await settle();
        assert.equal(harness.state.backendDisposeCalls, 1);
        assert.deepEqual(harness.state.dependencyChecks, ['python3', '.venv']);
        assert.equal(harness.state.backendWarmupCalls, 2);

        harness.changeConfiguration('audioWandasAnalyzer.cacheMemoryMb');
        await settle();
        assert.equal(harness.state.backendDisposeCalls, 2);
        assert.equal(harness.state.backendWarmupCalls, 3);
        assert.deepEqual(harness.state.dependencyChecks, ['python3', '.venv'], 'the cache budget does not change the environment');

        harness.listeners.reselected?.('.venv');
        await settle();
        assert.equal(harness.state.backendDisposeCalls, 3);
        assert.deepEqual(harness.state.dependencyChecks, ['python3', '.venv', '.venv']);
        assert.equal(harness.state.backendWarmupCalls, 4);
    } finally {
        harness.restore();
    }
});

test('the Python status bar item shows while an analyzer panel is open or after a failure', async () => {
    const harness = loadActivation();
    try {
        harness.activate();
        assert.equal(harness.state.statusShown, false);

        harness.state.openTabs.push({ input: new harness.TabInputWebview('mainThreadWebview-audioWandasAnalyzer.comparison') });
        harness.listeners.tabs?.({});
        assert.equal(harness.state.statusShown, true);

        harness.state.openTabs.length = 0;
        harness.state.openTabs.push({ input: new harness.TabInputWebview('mainThreadWebview-markdown.preview') });
        harness.listeners.tabs?.({});
        assert.equal(harness.state.statusShown, false);

        harness.state.environmentStatus = 'warning';
        harness.listeners.environment?.({});
        assert.equal(harness.state.statusShown, true);
    } finally {
        harness.restore();
    }
});
