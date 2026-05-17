import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

function loadPythonEnvironmentModule(options: {
    showQuickPickResult?: unknown;
    showOpenDialogResult?: Array<{ fsPath: string }>;
    workspaceFolders?: Array<unknown>;
    spawnImpl?: (...args: unknown[]) => EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
    };
}) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = NodeModule._load;
    const updates: Array<{ key: string; value: string; target: unknown }> = [];
    const warningMessages: string[] = [];
    const themeColors: string[] = [];

    const vscodeStub = {
        window: {
            showQuickPick: async () => options.showQuickPickResult,
            showOpenDialog: async () => options.showOpenDialogResult,
            showWarningMessage: async (message: string) => {
                warningMessages.push(message);
                return 'Dismiss';
            },
            showInformationMessage: async () => undefined,
            showErrorMessage: async () => undefined,
            withProgress: async (_opts: unknown, task: () => Promise<void>) => task(),
        },
        workspace: {
            workspaceFolders: options.workspaceFolders,
            getConfiguration: () => ({
                update: async (key: string, value: string, target: unknown) => {
                    updates.push({ key, value, target });
                },
            }),
        },
        ThemeColor: class {
            id: string;

            constructor(id: string) {
                this.id = id;
                themeColors.push(id);
            }
        },
        ConfigurationTarget: {
            Global: 'global',
            Workspace: 'workspace',
        },
        QuickPickItemKind: {
            Separator: -1,
        },
        ProgressLocation: {
            Notification: 15,
        },
    };

    NodeModule._load = function patchedLoad(request: string, parent: unknown, isMain: boolean): unknown {
        if (request === 'vscode') {
            return vscodeStub;
        }

        if (request === 'child_process') {
            return {
                spawn: options.spawnImpl ?? (() => {
                    throw new Error('spawn should not be called in this test');
                }),
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pythonEnvironment = require('../extension/pythonEnvironment') as typeof import('../extension/pythonEnvironment');

    return {
        pythonEnvironment,
        updates,
        warningMessages,
        themeColors,
        restore: () => {
            NodeModule._load = originalLoad;
            delete require.cache[require.resolve('../extension/pythonEnvironment')];
        },
    };
}

test('setStatusBarNormal clears warning state and shows the item', () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({});
    const item = {
        text: '',
        tooltip: '',
        backgroundColor: 'warning',
        showCalls: 0,
        show() {
            this.showCalls += 1;
        },
    };

    try {
        pythonEnvironment.setStatusBarNormal(item as never, '.venv/bin/python');
        assert.equal(item.text, 'Python: .venv/bin/python');
        assert.equal(item.tooltip, 'Click to select Python interpreter');
        assert.equal(item.backgroundColor, undefined);
        assert.equal(item.showCalls, 1);
    } finally {
        restore();
    }
});

test('setStatusBarWarning applies warning styling and icon', () => {
    const { pythonEnvironment, themeColors, restore } = loadPythonEnvironmentModule({});
    const item = {
        text: '',
        tooltip: '',
        backgroundColor: undefined as unknown,
        showCalls: 0,
        show() {
            this.showCalls += 1;
        },
    };

    try {
        pythonEnvironment.setStatusBarWarning(item as never, 'python3');
        assert.equal(item.text, 'Python: python3 $(warning)');
        assert.equal(item.tooltip, 'Python dependencies are missing. Click to select or install.');
        assert.deepEqual(themeColors, ['statusBarItem.warningBackground']);
        assert.equal(item.showCalls, 1);
        assert.ok(item.backgroundColor);
    } finally {
        restore();
    }
});

test('selectPythonEnvironment updates workspace pythonCommand from quick pick selection', async () => {
    const { pythonEnvironment, updates, restore } = loadPythonEnvironmentModule({
        showQuickPickResult: { label: 'python3', pythonCommand: 'python3' },
        workspaceFolders: [{}],
        spawnImpl: () => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                proc.stdout.emit('data', Buffer.from('Name: numpy\nName: wandas\n'));
                proc.emit('close', 0);
            });
            return proc;
        },
    });

    try {
        await pythonEnvironment.selectPythonEnvironment({
            text: '',
            tooltip: '',
            backgroundColor: undefined,
            show() {},
        } as never);
        assert.deepEqual(updates, [{ key: 'pythonCommand', value: 'python3', target: 'workspace' }]);
    } finally {
        restore();
    }
});

test('selectPythonEnvironment falls back to global config for browsed interpreter without workspace', async () => {
    const { pythonEnvironment, updates, restore } = loadPythonEnvironmentModule({
        showQuickPickResult: { label: '$(folder) Browse...' },
        showOpenDialogResult: [{ fsPath: '/tmp/custom-python' }],
        spawnImpl: () => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                proc.stdout.emit('data', Buffer.from('Name: numpy\nName: wandas\n'));
                proc.emit('close', 0);
            });
            return proc;
        },
    });

    try {
        await pythonEnvironment.selectPythonEnvironment({
            text: '',
            tooltip: '',
            backgroundColor: undefined,
            show() {},
        } as never);
        assert.deepEqual(updates, [{ key: 'pythonCommand', value: '/tmp/custom-python', target: 'global' }]);
    } finally {
        restore();
    }
});

test('checkMissingDependencies reports packages not present in pip show output', async () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                proc.stdout.emit('data', Buffer.from('Name: numpy\nVersion: 1.0\n'));
                proc.emit('close', 1);
            });
            return proc;
        },
    });

    try {
        const result = await pythonEnvironment.checkMissingDependencies('python3');
        assert.deepEqual(result, { missingPackages: ['wandas'] });
    } finally {
        restore();
    }
});

test('checkAndPromptInstallDependencies warns when interpreter is missing', async () => {
    const { pythonEnvironment, warningMessages, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                const error = new Error('spawn ENOENT') as NodeJS.ErrnoException;
                error.code = 'ENOENT';
                proc.emit('error', error);
            });
            return proc;
        },
    });
    const item = {
        text: '',
        tooltip: '',
        backgroundColor: undefined as unknown,
        show() {},
    };

    try {
        await pythonEnvironment.checkAndPromptInstallDependencies('missing-python', item as never);
        assert.equal(item.text, 'Python: missing-python $(warning)');
        assert.equal(warningMessages.length, 1);
        assert.match(warningMessages[0], /Python interpreter not found: missing-python/u);
    } finally {
        restore();
    }
});
