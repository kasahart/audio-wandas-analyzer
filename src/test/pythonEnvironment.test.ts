import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as os from 'node:os';
import test from 'node:test';

function loadPythonEnvironmentModule(options: {
    showQuickPickResult?: unknown;
    showOpenDialogResult?: Array<{ fsPath: string }>;
    showWarningMessageResult?: unknown;
    workspaceFolders?: Array<unknown>;
    workspaceFolderRoot?: string;
    currentPythonCommand?: string;
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
    const errorMessages: string[] = [];
    const themeColors: string[] = [];
    const quickPickCalls: Array<{ items: unknown[]; options: unknown }> = [];
    const openDialogCalls: unknown[] = [];
    class EventEmitter<T> {
        private listeners: Array<(event: T) => void> = [];

        event = (listener: (event: T) => void) => {
            this.listeners.push(listener);
            return {
                dispose: () => {
                    this.listeners = this.listeners.filter((entry) => entry !== listener);
                },
            };
        };

        fire(data: T) {
            this.listeners.forEach((listener) => {
                listener(data);
            });
        }
    }

    const vscodeStub = {
        window: {
            showQuickPick: async (items: unknown[], quickPickOptions: unknown) => {
                quickPickCalls.push({ items, options: quickPickOptions });
                return options.showQuickPickResult;
            },
            showOpenDialog: async (openDialogOptions: unknown) => {
                openDialogCalls.push(openDialogOptions);
                return options.showOpenDialogResult;
            },
            showWarningMessage: async (message: string) => {
                warningMessages.push(message);
                return options.showWarningMessageResult ?? 'Dismiss';
            },
            showInformationMessage: async () => undefined,
            showErrorMessage: async (message: string) => {
                errorMessages.push(message);
                return undefined;
            },
            withProgress: async (_opts: unknown, task: () => Promise<void>) => task(),
        },
        workspace: {
            workspaceFolders: options.workspaceFolderRoot
                ? [{ uri: { fsPath: options.workspaceFolderRoot } }]
                : options.workspaceFolders,
            getConfiguration: () => ({
                get: <T>(_key: string, defaultValue: T) => {
                    return (options.currentPythonCommand as T | undefined) ?? defaultValue;
                },
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
        EventEmitter,
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
        errorMessages,
        themeColors,
        quickPickCalls,
        openDialogCalls,
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
        assert.equal(item.tooltip, 'Click to select Python environment');
        assert.equal(item.backgroundColor, undefined);
        assert.equal(item.showCalls, 1);
    } finally {
        restore();
    }
});

test('setStatusBarImporting shows background module import progress', () => {
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
        pythonEnvironment.setStatusBarImporting(item as never, '.venv/bin/python');
        assert.equal(item.text, '$(sync~spin) Python: importing modules');
        assert.equal(item.tooltip, 'Importing Python analysis modules in the background.\n.venv/bin/python');
        assert.equal(item.backgroundColor, undefined);
        assert.equal(item.showCalls, 1);
    } finally {
        restore();
    }
});

test('setStatusBarNormal updates the shared Python environment state', () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({});
    const emittedStates: Array<{ pythonCommand: string; status: string; tooltip: string }> = [];
    const disposable = pythonEnvironment.onDidChangePythonEnvironmentState((state) => {
        emittedStates.push(state);
    });

    try {
        pythonEnvironment.setStatusBarNormal({
            text: '',
            tooltip: '',
            backgroundColor: 'warning',
            show() {},
        } as never, '.venv/bin/python');
        assert.deepEqual(pythonEnvironment.getCurrentPythonEnvironmentState(), {
            pythonCommand: '.venv/bin/python',
            status: 'normal',
            tooltip: 'Click to select Python environment',
        });
        assert.deepEqual(emittedStates, [{
            pythonCommand: '.venv/bin/python',
            status: 'normal',
            tooltip: 'Click to select Python environment',
        }]);
    } finally {
        disposable.dispose();
        restore();
    }
});

test('setStatusBarWarning applies warning styling, icon, and tooltip', () => {
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
        pythonEnvironment.setStatusBarWarning(item as never, 'python3', 'Interpreter missing');
        assert.equal(item.text, 'Python: python3 $(warning)');
        assert.equal(item.tooltip, 'Interpreter missing');
        assert.deepEqual(themeColors, ['statusBarItem.warningBackground']);
        assert.equal(item.showCalls, 1);
        assert.ok(item.backgroundColor);
    } finally {
        restore();
    }
});

test('setStatusBarWarning updates the shared Python environment state', () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({});
    const emittedStates: Array<{ pythonCommand: string; status: string; tooltip: string }> = [];
    const disposable = pythonEnvironment.onDidChangePythonEnvironmentState((state) => {
        emittedStates.push(state);
    });

    try {
        pythonEnvironment.setStatusBarWarning({
            text: '',
            tooltip: '',
            backgroundColor: undefined,
            show() {},
        } as never, 'python3', 'Interpreter missing');
        assert.deepEqual(pythonEnvironment.getCurrentPythonEnvironmentState(), {
            pythonCommand: 'python3',
            status: 'warning',
            tooltip: 'Interpreter missing',
        });
        assert.deepEqual(emittedStates, [{
            pythonCommand: 'python3',
            status: 'warning',
            tooltip: 'Interpreter missing',
        }]);
    } finally {
        disposable.dispose();
        restore();
    }
});

test('resolvePythonCommand maps virtual environment folders and keeps existing interpreter values', () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({});

    try {
        assert.equal(pythonEnvironment.resolvePythonCommand('.venv', 'linux'), '.venv/bin/python');
        assert.equal(pythonEnvironment.resolvePythonCommand('venv', 'linux'), 'venv/bin/python');
        assert.equal(pythonEnvironment.resolvePythonCommand('.venv', 'linux', '/workspace/project'), '/workspace/project/.venv/bin/python');
        assert.equal(pythonEnvironment.resolvePythonCommand('C:\\work\\.venv', 'win32'), 'C:\\work\\.venv\\Scripts\\python.exe');
        assert.equal(pythonEnvironment.resolvePythonCommand('.venv/bin/python', 'linux'), '.venv/bin/python');
        assert.equal(pythonEnvironment.resolvePythonCommand('.venv/bin/python', 'linux', '/workspace/project'), '/workspace/project/.venv/bin/python');
        assert.equal(pythonEnvironment.resolvePythonCommand('python3', 'linux'), 'python3');
    } finally {
        restore();
    }
});

test('selectPythonEnvironment shows virtual environment folder choices only', async () => {
    const { pythonEnvironment, quickPickCalls, restore } = loadPythonEnvironmentModule({});

    try {
        await pythonEnvironment.selectPythonEnvironment({
            text: '',
            tooltip: '',
            backgroundColor: undefined,
            show() {},
        } as never);
        assert.deepEqual(quickPickCalls, [{
            items: [
                { label: '.venv', pythonCommand: '.venv' },
                { label: 'venv', pythonCommand: 'venv' },
                { label: 'Custom', kind: -1 },
                { label: '$(folder) Browse...' },
            ],
            options: { placeHolder: 'Select Python environment folder' },
        }]);
    } finally {
        restore();
    }
});

test('selectPythonEnvironment updates workspace pythonCommand from quick pick environment folder', async () => {
    const { pythonEnvironment, updates, restore } = loadPythonEnvironmentModule({
        showQuickPickResult: { label: '.venv', pythonCommand: '.venv' },
        workspaceFolders: [{}],
        currentPythonCommand: 'python3',
    });

    try {
        await pythonEnvironment.selectPythonEnvironment({
            text: '',
            tooltip: '',
            backgroundColor: undefined,
            show() {},
        } as never);
        assert.deepEqual(updates, [{ key: 'pythonCommand', value: '.venv', target: 'workspace' }]);
    } finally {
        restore();
    }
});

test('selectPythonEnvironment reports the selected environment when it is already configured', async () => {
    const { pythonEnvironment, updates, restore } = loadPythonEnvironmentModule({
        showQuickPickResult: { label: '.venv', pythonCommand: '.venv' },
        currentPythonCommand: '.venv',
    });

    try {
        const reselected = await pythonEnvironment.selectPythonEnvironment({
            text: '',
            tooltip: '',
            backgroundColor: undefined,
            show() {},
        } as never);
        assert.equal(reselected, '.venv');
        assert.deepEqual(updates, []);
    } finally {
        restore();
    }
});

test('selectPythonEnvironment falls back to global config for browsed environment folder without workspace', async () => {
    const { pythonEnvironment, updates, openDialogCalls, restore } = loadPythonEnvironmentModule({
        showQuickPickResult: { label: '$(folder) Browse...' },
        showOpenDialogResult: [{ fsPath: '/tmp/custom-python' }],
        currentPythonCommand: 'python3',
    });

    try {
        await pythonEnvironment.selectPythonEnvironment({
            text: '',
            tooltip: '',
            backgroundColor: undefined,
            show() {},
        } as never);
        assert.deepEqual(updates, [{ key: 'pythonCommand', value: '/tmp/custom-python', target: 'global' }]);
        assert.deepEqual(openDialogCalls, [{
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: 'Select Python environment',
        }]);
    } finally {
        restore();
    }
});

test('checkMissingDependencies reports missing or incompatible requirements from probe output', async () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                proc.stdout.emit('data', Buffer.from('["wandas[psychoacoustic]>=0.7.2,<0.8.0"]\n'));
                proc.emit('close', 0);
            });
            return proc;
        },
    });

    try {
        const result = await pythonEnvironment.checkMissingDependencies('python3');
        assert.deepEqual(result, { missingPackages: ['wandas[psychoacoustic]>=0.7.2,<0.8.0'] });
    } finally {
        restore();
    }
});

test('checkMissingDependencies uses import and version checks instead of pip', async () => {
    let spawnedArgs: unknown[] = [];
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({
        spawnImpl: (...spawnArgs: unknown[]) => {
            spawnedArgs = Array.isArray(spawnArgs[1]) ? spawnArgs[1] : [];
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                proc.stdout.emit('data', Buffer.from('[]\n'));
                proc.emit('close', 0);
            });
            return proc;
        },
    });

    try {
        const result = await pythonEnvironment.checkMissingDependencies('python3');
        assert.deepEqual(result, { missingPackages: [] });
        assert.equal(spawnedArgs[0], '-c');
        assert.match(String(spawnedArgs[1]), /numpy>=2\.0\.2/u);
        assert.match(String(spawnedArgs[1]), /scipy>=1\.13/u);
        assert.match(String(spawnedArgs[1]), /wandas\[psychoacoustic\]>=0\.7\.2,<0\.8\.0/u);
        assert.match(String(spawnedArgs[1]), /"minimum":\[0,7,2\]/u);
        assert.match(String(spawnedArgs[1]), /mosqito/u);
        assert.match(String(spawnedArgs[1]), /packaging\.version/u);
        assert.match(String(spawnedArgs[1]), /current\.is_prerelease/u);
    } finally {
        restore();
    }
});

test('checkMissingDependencies runs import probe outside the workspace root', async () => {
    let spawnOptions: { cwd?: string } | undefined;
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({
        workspaceFolderRoot: '/workspace/project',
        spawnImpl: (...spawnArgs: unknown[]) => {
            spawnOptions = spawnArgs[2] as { cwd?: string } | undefined;
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                proc.stdout.emit('data', Buffer.from('[]\n'));
                proc.emit('close', 0);
            });
            return proc;
        },
    });

    try {
        await pythonEnvironment.checkMissingDependencies('python3');
        assert.equal(spawnOptions?.cwd, os.tmpdir());
        assert.notEqual(spawnOptions?.cwd, '/workspace/project');
    } finally {
        restore();
    }
});

test('checkMissingDependencies rejects unexpected import check stderr on non-zero exit', async () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                proc.stderr.emit('data', Buffer.from('ERROR: network down\n'));
                proc.emit('close', 2);
            });
            return proc;
        },
    });

    try {
        await assert.rejects(
            () => pythonEnvironment.checkMissingDependencies('python3'),
            /ERROR: network down/u,
        );
    } finally {
        restore();
    }
});

test('checkMissingDependencies rejects when dependency check is terminated by signal', async () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                proc.emit('close', null, 'SIGTERM');
            });
            return proc;
        },
    });

    try {
        await assert.rejects(
            () => pythonEnvironment.checkMissingDependencies('python3'),
            /dependency check was terminated by signal SIGTERM/u,
        );
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
        assert.equal(item.tooltip, 'Python interpreter was not found. Click to select another environment.');
        assert.equal(warningMessages.length, 1);
        assert.match(warningMessages[0], /Python interpreter not found: missing-python\/bin\/python/u);
    } finally {
        restore();
    }
});

test('checkAndPromptInstallDependencies treats invalid dependency output as a check failure', async () => {
    const { pythonEnvironment, errorMessages, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                proc.stdout.emit('data', Buffer.from('not json'));
                proc.emit('close', 0);
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
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
        await assert.doesNotReject(() => pythonEnvironment.checkAndPromptInstallDependencies('python3', item as never));
        assert.equal(item.tooltip, 'Python environment check failed. Click to select another environment.');
        assert.equal(errorMessages.length, 1);
        assert.match(errorMessages[0], /Failed to check Python dependencies: Failed to parse dependency check output/u);
    } finally {
        console.error = originalConsoleError;
        restore();
    }
});

test('install prompt still reports pip-specific failure when pip is unavailable', async () => {
    const { pythonEnvironment, warningMessages, restore } = loadPythonEnvironmentModule({
        showWarningMessageResult: 'Install',
        spawnImpl: (...spawnArgs: unknown[]) => {
            const args = Array.isArray(spawnArgs[1]) ? spawnArgs[1] : [];
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                if (args?.[1] === 'pip') {
                    proc.stderr.emit('data', Buffer.from('No module named pip'));
                    proc.emit('close', 1);
                    return;
                }
                proc.stdout.emit('data', Buffer.from('["wandas[psychoacoustic]>=0.7.2,<0.8.0"]\n'));
                proc.emit('close', 0);
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
        await pythonEnvironment.checkAndPromptInstallDependencies('python3', item as never);
        assert.equal(item.tooltip, 'pip is not available in this environment. Click to select another environment.');
        assert.deepEqual(warningMessages, [
            'Audio Wandas Analyzer requires compatible Python packages: wandas[psychoacoustic]>=0.7.2,<0.8.0. Install or upgrade them now?',
            'pip is not available in python3',
        ]);
    } finally {
        restore();
    }
});

test('checkAndPromptInstallDependencies treats unexpected dependency check exit as check failure', async () => {
    const { pythonEnvironment, errorMessages, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                proc.stderr.emit('data', Buffer.from('ERROR: internal dependency failure\n'));
                proc.emit('close', 2);
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
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
        await assert.doesNotReject(() => pythonEnvironment.checkAndPromptInstallDependencies('python3', item as never));
        assert.equal(item.tooltip, 'Python environment check failed. Click to select another environment.');
        assert.deepEqual(errorMessages, ['Failed to check Python dependencies: ERROR: internal dependency failure']);
    } finally {
        console.error = originalConsoleError;
        restore();
    }
});

test('checkAndPromptInstallDependencies ignores stale results from older requests', async () => {
    let oldProc: (EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) | undefined;
    let newProc: (EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) | undefined;
    const { pythonEnvironment, warningMessages, restore } = loadPythonEnvironmentModule({
        spawnImpl: (pythonCommand?: unknown) => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();

            if (pythonCommand === 'old-env/bin/python') {
                oldProc = proc;
            } else if (pythonCommand === 'new-env/bin/python') {
                newProc = proc;
            }

            return proc;
        },
    });
    const item = {
        text: '',
        tooltip: '',
        backgroundColor: undefined as unknown,
        show() {},
    };
    const emittedStates: Array<{ pythonCommand: string; status: string; tooltip: string }> = [];
    const disposable = pythonEnvironment.onDidChangePythonEnvironmentState((state) => {
        emittedStates.push(state);
    });

    try {
        const oldCheck = pythonEnvironment.checkAndPromptInstallDependencies('old-env', item as never);
        const newCheck = pythonEnvironment.checkAndPromptInstallDependencies('new-env', item as never);

        assert.ok(oldProc);
        assert.ok(newProc);

        newProc.stdout.emit('data', Buffer.from('[]\n'));
        newProc.emit('close', 0);

        oldProc.stdout.emit('data', Buffer.from('["wandas"]\n'));
        oldProc.emit('close', 0);

        await Promise.all([oldCheck, newCheck]);

        assert.equal(item.text, 'Python: new-env');
        assert.equal(item.tooltip, 'Click to select Python environment');
        assert.equal(warningMessages.length, 0);
        assert.deepEqual(emittedStates, [{
            pythonCommand: 'new-env',
            status: 'normal',
            tooltip: 'Click to select Python environment',
        }]);
    } finally {
        disposable.dispose();
        restore();
    }
});

test('checkAndPromptInstallDependencies swallows unexpected errors and shows an error message', async () => {
    const { pythonEnvironment, errorMessages, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => {
            const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            process.nextTick(() => {
                const error = new Error('boom');
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
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
        await assert.doesNotReject(() => pythonEnvironment.checkAndPromptInstallDependencies('python3', item as never));
        assert.equal(item.tooltip, 'Python environment check failed. Click to select another environment.');
        assert.deepEqual(errorMessages, ['Failed to check Python dependencies: boom']);
    } finally {
        console.error = originalConsoleError;
        restore();
    }
});
