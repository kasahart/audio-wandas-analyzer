import assert from 'node:assert/strict';
import test from 'node:test';

test('activate keeps analyze commands available when workspace test registration fails', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = NodeModule._load;
    const originalConsoleError = console.error;
    const registeredCommandIds: string[] = [];
    const createdTreeViewIds: string[] = [];
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
                get: <T>(_key: string, defaultValue: T) => defaultValue,
            }),
            onDidChangeConfiguration: () => ({ dispose() {} }),
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

        if (request === './waveformServer') {
            return {
                WaveformServer: class {
                    dispose(): void {}
                },
            };
        }

        if (request === './pythonEnvironment') {
            return {
                selectPythonEnvironment: async () => {},
                checkAndPromptInstallDependencies: async () => {},
                getCurrentPythonEnvironmentState: () => ({
                    pythonCommand: 'python3',
                    status: 'normal',
                    tooltip: 'Click to select Python interpreter',
                }),
                onDidChangePythonEnvironmentState: () => ({ dispose() {} }),
                setStatusBarNormal: () => {},
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

        assert.deepEqual(registeredCommandIds, [
            'audioWandasAnalyzer.analyzeFile',
            'audioWandasAnalyzer.analyzeDebugFile',
            'audioWandasAnalyzer.analyzeThisTarget',
            'audioWandasAnalyzer.selectPythonEnvironment',
            'audioWandasAnalyzer.runRecipe',
        ]);
        assert.deepEqual(createdTreeViewIds, ['audioWandasAnalyzer.welcomeView']);
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
