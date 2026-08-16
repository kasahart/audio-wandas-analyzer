import assert from 'node:assert/strict';
import test from 'node:test';

test('activate keeps analyze commands available and warms Python when workspace test registration fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = NodeModule._load;
    const originalConsoleError = console.error;
    const registeredCommandIds: string[] = [];
    const createdTreeViewIds: string[] = [];
    let backendWarmupCalls = 0;
    let backendDisposeCalls = 0;
    let importingStatusCalls = 0;
    let currentPythonCommand = 'python3';
    let configurationListener: ((event: { affectsConfiguration(section: string): boolean }) => void) | undefined;
    let createdTreeViewOptions: {
        treeDataProvider?: { getChildren(): unknown[]; getTreeItem(element: unknown): unknown };
        dragAndDropController?: unknown;
    } | undefined;

    const vscodeStub = {
        commands: {
            registerCommand: (commandId: string) => {
                registeredCommandIds.push(commandId);
                return { dispose() {} };
            },
            executeCommand: () => Promise.resolve(),
        },
        window: {
            createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
            createStatusBarItem: () => ({
                command: undefined as string | undefined,
                text: '',
                tooltip: undefined as string | undefined,
                backgroundColor: undefined,
                show() {},
                hide() {},
                dispose() {},
            }),
            createTreeView: (viewId: string, options?: typeof createdTreeViewOptions) => {
                createdTreeViewIds.push(viewId);
                createdTreeViewOptions = options;
                return { dispose() {} };
            },
        },
        workspace: {
            getConfiguration: () => ({
                get: <T>(key: string, defaultValue: T) => (
                    key === 'pythonCommand' ? currentPythonCommand as T : defaultValue
                ),
            }),
            onDidChangeConfiguration: (
                listener: (event: { affectsConfiguration(section: string): boolean }) => void,
            ) => {
                configurationListener = listener;
                return { dispose() {} };
            },
        },
        StatusBarAlignment: {
            Left: 1,
        },
        Uri: {
            parse: (value: string) => ({ fsPath: value }),
        },
        FileType: {
            Directory: 2,
        },
        TreeItem: class {
            label: string;
            description?: string;
            command?: { command: string; title: string };
            iconPath?: unknown;

            constructor(label: string) {
                this.label = label;
            }
        },
        ThemeIcon: class {
            id: string;

            constructor(id: string) {
                this.id = id;
            }
        },
    };

    NodeModule._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
        if (request === 'vscode') {
            return vscodeStub;
        }

        if (request === '../testing/workspaceTests') {
            return {
                registerWorkspaceTests: () => {
                    throw new Error('workspace tests unavailable');
                },
            };
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

        if (request === '../webview/panels/ComparisonPanel') {
            return {
                ComparisonPanel: {},
            };
        }

        if (request === './pythonBackendServer') {
            return {
                PythonBackendServer: class {
                    async warmup(): Promise<void> {
                        backendWarmupCalls += 1;
                    }
                    dispose(): void { backendDisposeCalls += 1; }
                },
            };
        }

        if (request === './pythonEnvironment') {
            return {
                selectPythonEnvironment: async () => {},
                checkAndPromptInstallDependencies: async () => true,
                getCurrentPythonEnvironmentState: () => ({
                    pythonCommand: 'python3',
                    status: 'normal',
                    tooltip: 'Click to select Python environment',
                }),
                onDidChangePythonEnvironmentState: () => ({ dispose() {} }),
                setStatusBarImporting: () => { importingStatusCalls += 1; },
                setStatusBarNormal: () => {},
                setStatusBarWarning: () => {},
            };
        }

        if (request === '../shared/utils/audioTarget' || request === '../shared/utils/directorySelection') {
            return {};
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        console.error = () => {};
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const extensionModule = require('../extension/index') as {
            activate(context: {
                extensionPath: string;
                extensionUri: { fsPath: string };
                subscriptions: Array<{ dispose(): void }>;
            }): void;
        };

        assert.doesNotThrow(() => {
            extensionModule.activate({
                extensionPath: '/tmp/audio-wandas-analyzer',
                extensionUri: { fsPath: '/tmp/audio-wandas-analyzer' },
                subscriptions: [],
            });
        });
        await Promise.resolve();
        await Promise.resolve();

        assert.deepEqual(registeredCommandIds, [
            'audioWandasAnalyzer.analyzeFile',
            'audioWandasAnalyzer.analyzeDebugFile',
            'audioWandasAnalyzer.analyzeThisTarget',
            'audioWandasAnalyzer.selectPythonEnvironment',
            'audioWandasAnalyzer.runRecipe',
        ]);
        assert.deepEqual(createdTreeViewIds, ['audioWandasAnalyzer.welcomeView']);
        assert.equal(importingStatusCalls, 1);
        assert.equal(backendWarmupCalls, 1);

        currentPythonCommand = '.venv';
        configurationListener?.({
            affectsConfiguration: (section) => section === 'audioWandasAnalyzer.pythonCommand',
        });
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(backendDisposeCalls, 1);
        assert.equal(importingStatusCalls, 2);
        assert.equal(backendWarmupCalls, 2);
        const welcomeItems = createdTreeViewOptions?.treeDataProvider?.getChildren() as Array<{
            label: string;
            description?: string;
            command?: { command: string; title: string };
            iconPath?: { id: string };
        }>;
        assert.equal(welcomeItems.length, 1);
        assert.equal(welcomeItems[0].label, 'Drop audio files or folders here');
        assert.equal(welcomeItems[0].description, 'Click to choose a file or folder');
        assert.deepEqual(welcomeItems[0].command, {
            command: 'audioWandasAnalyzer.analyzeFile',
            title: 'Analyze File or Folder',
        });
        assert.equal(welcomeItems[0].iconPath?.id, 'new-file');
    } finally {
        console.error = originalConsoleError;
        NodeModule._load = originalLoad;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        delete require.cache[require.resolve('../extension/index')];
    }
});
