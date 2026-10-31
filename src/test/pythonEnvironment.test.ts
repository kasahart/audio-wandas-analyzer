import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

type FakeProcess = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; killed: boolean; kill(): void };

function fakeProcess(script?: (proc: FakeProcess) => void): FakeProcess {
    const proc = new EventEmitter() as FakeProcess;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    proc.kill = () => {
        proc.killed = true;
        process.nextTick(() => proc.emit('close', null, 'SIGTERM'));
    };
    if (script) { process.nextTick(() => script(proc)); }
    return proc;
}

function checkOutput(missing: string[], externallyManaged = false): string {
    return `${JSON.stringify({ missing, externallyManaged })}\n`;
}

function statusItem() {
    return {
        text: '',
        tooltip: '',
        backgroundColor: undefined as unknown,
        showCalls: 0,
        show() { this.showCalls += 1; },
    };
}

/** A venv's interpreter in the host layout: bin/python on POSIX, Scripts\\python.exe on Windows. */
function venvInterpreter(venvPath: string): string {
    return process.platform === 'win32' ? path.join(venvPath, 'Scripts', 'python.exe') : path.join(venvPath, 'bin', 'python');
}

function makeVenv(venvPath: string): void {
    mkdirSync(path.dirname(venvInterpreter(venvPath)), { recursive: true });
    writeFileSync(venvInterpreter(venvPath), '');
}

function makeWorkspace(venvs: string[] = []): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'awa-python-env-'));
    for (const venv of venvs) makeVenv(path.join(root, venv));
    return root;
}

function loadPythonEnvironmentModule(options: {
    showQuickPickResult?: unknown;
    showOpenDialogResult?: Array<{ fsPath: string }>;
    /** Answers to successive warning notifications; undefined dismisses. */
    warningAnswers?: Array<string | undefined>;
    errorAnswers?: Array<string | undefined>;
    workspaceFolderRoot?: string;
    currentPythonCommand?: string;
    pythonExtensionPath?: string;
    cancelProgress?: boolean;
    /** Runs after a warning's buttons are chosen and before it is answered. */
    onWarning?: () => void;
    spawnImpl?: (...args: unknown[]) => FakeProcess;
}) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NodeModule = require('node:module') as {
        _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    };
    const originalLoad = NodeModule._load;
    const updates: Array<{ key: string; value: string; target: unknown }> = [];
    const warningMessages: string[] = [];
    const warningButtons: string[][] = [];
    const errorMessages: string[] = [];
    const errorButtons: string[][] = [];
    const infoMessages: string[] = [];
    const executedCommands: string[] = [];
    const logText: string[] = [];
    const progressTitles: string[] = [];
    const themeColors: string[] = [];
    const quickPickCalls: Array<{ items: unknown[]; options: unknown }> = [];
    const openDialogCalls: unknown[] = [];
    const warningAnswers = [...(options.warningAnswers ?? [])];
    const errorAnswers = [...(options.errorAnswers ?? [])];
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
        env: { language: 'en' },
        window: {
            showQuickPick: async (items: unknown[], quickPickOptions: unknown) => {
                quickPickCalls.push({ items, options: quickPickOptions });
                return options.showQuickPickResult;
            },
            showOpenDialog: async (openDialogOptions: unknown) => {
                openDialogCalls.push(openDialogOptions);
                return options.showOpenDialogResult;
            },
            showWarningMessage: async (message: string, ...buttons: string[]) => {
                warningMessages.push(message);
                warningButtons.push(buttons);
                options.onWarning?.();
                return warningAnswers.shift();
            },
            showInformationMessage: async (message: string) => {
                infoMessages.push(message);
                return undefined;
            },
            showErrorMessage: async (message: string, ...buttons: string[]) => {
                errorMessages.push(message);
                errorButtons.push(buttons);
                return errorAnswers.shift();
            },
            createOutputChannel: () => ({
                append: (value: string) => { logText.push(value); },
                appendLine: (value: string) => { logText.push(`${value}\n`); },
                show() {},
                dispose() {},
            }),
            withProgress: async (
                progressOptions: { title: string },
                task: (progress: unknown, token: unknown) => Promise<unknown>,
            ) => {
                progressTitles.push(progressOptions.title);
                const listeners: Array<() => void> = [];
                const token = {
                    isCancellationRequested: false,
                    onCancellationRequested: (listener: () => void) => {
                        listeners.push(listener);
                        return { dispose() {} };
                    },
                };
                const running = task({ report() {} }, token);
                if (options.cancelProgress) {
                    setImmediate(() => {
                        token.isCancellationRequested = true;
                        listeners.forEach(listener => listener());
                    });
                }
                return running;
            },
        },
        commands: {
            executeCommand: async (command: string) => {
                executedCommands.push(command);
                return undefined;
            },
        },
        extensions: {
            getExtension: (id: string) => (id === 'ms-python.python' && options.pythonExtensionPath
                ? {
                    isActive: true,
                    exports: {
                        environments: {
                            getActiveEnvironmentPath: () => ({ id: 'selected', path: options.pythonExtensionPath }),
                            onDidChangeActiveEnvironmentPath: () => ({ dispose() {} }),
                        },
                    },
                }
                : undefined),
        },
        workspace: {
            workspaceFolders: options.workspaceFolderRoot
                ? [{ uri: { fsPath: options.workspaceFolderRoot } }]
                : undefined,
            getConfiguration: () => ({
                get: <T>(_key: string, defaultValue: T) => {
                    return (options.currentPythonCommand as T | undefined) ?? defaultValue;
                },
                inspect: () => ({ globalValue: options.currentPythonCommand }),
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
        warningButtons,
        errorMessages,
        errorButtons,
        infoMessages,
        executedCommands,
        log: () => logText.join(''),
        progressTitles,
        themeColors,
        quickPickCalls,
        openDialogCalls,
        restore: () => {
            NodeModule._load = originalLoad;
            delete require.cache[require.resolve('../extension/pythonEnvironment')];
        },
    };
}

/** Lets the fire-and-forget notification handlers (button actions) settle. */
async function settle(): Promise<void> {
    for (let index = 0; index < 5; index++) { await new Promise(resolve => setImmediate(resolve)); }
}

test('setStatusBarNormal clears warning state without forcing the item visible', () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({});
    const item = { ...statusItem(), backgroundColor: 'warning' as unknown };

    try {
        pythonEnvironment.setStatusBarNormal(item as never, '.venv/bin/python');
        assert.equal(item.text, 'Python: .venv/bin/python');
        assert.equal(item.tooltip, 'Click to select the Python environment');
        assert.equal(item.backgroundColor, undefined);
        assert.equal(item.showCalls, 0);
    } finally {
        restore();
    }
});

test('setStatusBarImporting shows background module import progress', () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({});
    const item = { ...statusItem(), backgroundColor: 'warning' as unknown };

    try {
        pythonEnvironment.setStatusBarImporting(item as never, '.venv/bin/python');
        assert.equal(item.text, '$(sync~spin) Python: importing modules');
        assert.equal(item.tooltip, 'Importing the Python analysis modules in the background.\n.venv/bin/python');
        assert.equal(item.backgroundColor, undefined);
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
        pythonEnvironment.setStatusBarNormal(statusItem() as never, '.venv/bin/python');
        const expected = {
            pythonCommand: '.venv/bin/python',
            status: 'normal',
            tooltip: 'Click to select the Python environment',
        };
        assert.deepEqual(pythonEnvironment.getCurrentPythonEnvironmentState(), expected);
        assert.deepEqual(emittedStates, [expected]);
    } finally {
        disposable.dispose();
        restore();
    }
});

test('setStatusBarWarning applies warning styling, icon, and tooltip and shows the item', () => {
    const { pythonEnvironment, themeColors, restore } = loadPythonEnvironmentModule({});
    const item = statusItem();

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
        pythonEnvironment.setStatusBarWarning(statusItem() as never, 'python3', 'Interpreter missing');
        const expected = { pythonCommand: 'python3', status: 'warning', tooltip: 'Interpreter missing' };
        assert.deepEqual(pythonEnvironment.getCurrentPythonEnvironmentState(), expected);
        assert.deepEqual(emittedStates, [expected]);
    } finally {
        disposable.dispose();
        restore();
    }
});

test('status bar texts follow the VS Code display language', () => {
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({});
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscode = require('vscode') as { env: { language: string } };
    const item = statusItem();

    try {
        vscode.env.language = 'ja';
        pythonEnvironment.setStatusBarNormal(item as never, 'python3');
        assert.equal(item.tooltip, 'クリックして Python 環境を選択');
    } finally {
        vscode.env.language = 'en';
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

test('getPythonCommand prefers the explicit setting, then the Python extension, then VIRTUAL_ENV', async () => {
    const root = makeWorkspace(['active-env']);
    const originalVirtualEnv = process.env['VIRTUAL_ENV'];
    process.env['VIRTUAL_ENV'] = path.join(root, 'active-env');
    try {
        const explicit = loadPythonEnvironmentModule({ currentPythonCommand: '.venv', pythonExtensionPath: '/opt/py/bin/python' });
        try {
            await explicit.pythonEnvironment.refreshDefaultInterpreter();
            assert.equal(explicit.pythonEnvironment.getPythonCommand(), '.venv');
        } finally {
            explicit.restore();
        }

        const fromExtension = loadPythonEnvironmentModule({ pythonExtensionPath: '/opt/py/bin/python' });
        try {
            assert.equal(await fromExtension.pythonEnvironment.refreshDefaultInterpreter(), true);
            assert.equal(fromExtension.pythonEnvironment.getPythonCommand(), '/opt/py/bin/python');
        } finally {
            fromExtension.restore();
        }

        const fromVirtualEnv = loadPythonEnvironmentModule({});
        try {
            assert.equal(fromVirtualEnv.pythonEnvironment.getPythonCommand(), path.join(root, 'active-env'));
        } finally {
            fromVirtualEnv.restore();
        }

        process.env['VIRTUAL_ENV'] = path.join(root, 'deleted-env');
        const staleVirtualEnv = loadPythonEnvironmentModule({});
        try {
            assert.equal(staleVirtualEnv.pythonEnvironment.getPythonCommand(), 'python3');
        } finally {
            staleVirtualEnv.restore();
        }
    } finally {
        if (originalVirtualEnv === undefined) { delete process.env['VIRTUAL_ENV']; } else { process.env['VIRTUAL_ENV'] = originalVirtualEnv; }
        rmSync(root, { recursive: true, force: true });
    }
});

test('selectPythonEnvironment lists only environments that exist, plus create and browse', async () => {
    const root = makeWorkspace(['venv']);
    const { pythonEnvironment, quickPickCalls, restore } = loadPythonEnvironmentModule({
        workspaceFolderRoot: root,
        pythonExtensionPath: '/opt/py/bin/python',
    });

    try {
        await pythonEnvironment.selectPythonEnvironment(statusItem() as never);
        assert.deepEqual(quickPickCalls, [{
            items: [
                { label: '/opt/py/bin/python', description: 'Selected in the Python extension', pythonCommand: '/opt/py/bin/python' },
                { label: 'venv', description: 'Virtual environment in this workspace', pythonCommand: 'venv' },
                { label: 'Other', kind: -1 },
                {
                    label: '$(add) Create .venv and install packages',
                    detail: 'Runs python -m venv .venv in the workspace and installs the required packages',
                    action: 'create-venv',
                },
                { label: '$(folder) Browse...', action: 'browse' },
            ],
            options: { placeHolder: 'Select the Python environment for Audio Wandas Analyzer' },
        }]);
    } finally {
        restore();
        rmSync(root, { recursive: true, force: true });
    }
});

test('selectPythonEnvironment updates workspace pythonCommand from quick pick environment folder', async () => {
    const { pythonEnvironment, updates, restore } = loadPythonEnvironmentModule({
        showQuickPickResult: { label: '.venv', pythonCommand: '.venv' },
        workspaceFolderRoot: '/workspace/project',
        currentPythonCommand: 'python3',
    });

    try {
        await pythonEnvironment.selectPythonEnvironment(statusItem() as never);
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
    const reselected: string[] = [];
    const subscription = pythonEnvironment.onDidReselectPythonCommand(command => { reselected.push(command); });

    try {
        await pythonEnvironment.selectPythonEnvironment(statusItem() as never);
        assert.deepEqual(reselected, ['.venv']);
        assert.deepEqual(updates, []);
    } finally {
        subscription.dispose();
        restore();
    }
});

test('selectPythonEnvironment falls back to global config for browsed environment folder without workspace', async () => {
    const { pythonEnvironment, updates, openDialogCalls, restore } = loadPythonEnvironmentModule({
        showQuickPickResult: { label: '$(folder) Browse...', action: 'browse' },
        showOpenDialogResult: [{ fsPath: '/tmp/custom-python' }],
        currentPythonCommand: 'python3',
    });

    try {
        await pythonEnvironment.selectPythonEnvironment(statusItem() as never);
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
        spawnImpl: () => fakeProcess((proc) => {
            proc.stdout.emit('data', Buffer.from(checkOutput(['wandas[psychoacoustic,effects]>=0.12.0,<0.13.0'], true)));
            proc.emit('close', 0);
        }),
    });

    try {
        const result = await pythonEnvironment.checkMissingDependencies('python3');
        assert.deepEqual(result, {
            missingPackages: ['wandas[psychoacoustic,effects]>=0.12.0,<0.13.0'],
            externallyManaged: true,
        });
    } finally {
        restore();
    }
});

test('checkMissingDependencies uses import and version checks instead of pip', async () => {
    let spawnedArgs: unknown[] = [];
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({
        spawnImpl: (...spawnArgs: unknown[]) => {
            spawnedArgs = Array.isArray(spawnArgs[1]) ? spawnArgs[1] : [];
            return fakeProcess((proc) => {
                proc.stdout.emit('data', Buffer.from(checkOutput([])));
                proc.emit('close', 0);
            });
        },
    });

    try {
        const result = await pythonEnvironment.checkMissingDependencies('python3');
        assert.deepEqual(result, { missingPackages: [], externallyManaged: false });
        assert.equal(spawnedArgs[0], '-c');
        assert.match(String(spawnedArgs[1]), /numpy>=2\.0\.2/u);
        assert.match(String(spawnedArgs[1]), /soundfile>=0\.12/u);
        assert.match(String(spawnedArgs[1]), /scipy>=1\.13/u);
        assert.match(String(spawnedArgs[1]), /wandas\[psychoacoustic,effects\]>=0\.12\.0,<0\.13\.0/u);
        assert.match(String(spawnedArgs[1]), /"minimum":\[0,12,0\]/u);
        assert.match(String(spawnedArgs[1]), /mosqito/u);
        assert.match(String(spawnedArgs[1]), /packaging\.version/u);
        assert.match(String(spawnedArgs[1]), /current\.is_prerelease/u);
        assert.match(String(spawnedArgs[1]), /EXTERNALLY-MANAGED/u);
    } finally {
        restore();
    }
});

test('the dependency check script runs in a real interpreter and reports PEP 668 state', async () => {
    let script = '';
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({
        spawnImpl: (...spawnArgs: unknown[]) => {
            script = String((spawnArgs[1] as unknown[])[1]);
            return fakeProcess((proc) => {
                proc.stdout.emit('data', Buffer.from(checkOutput([])));
                proc.emit('close', 0);
            });
        },
    });
    try {
        await pythonEnvironment.checkMissingDependencies('python3');
    } finally {
        restore();
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
    const run = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
    if (run.error) { return; }
    assert.equal(run.status, 0, run.stderr);
    const parsed = JSON.parse(run.stdout) as { missing: unknown; externallyManaged: unknown };
    assert.ok(Array.isArray(parsed.missing));
    assert.equal(typeof parsed.externallyManaged, 'boolean');
});

test('checkMissingDependencies runs import probe outside the workspace root', async () => {
    let spawnOptions: { cwd?: string } | undefined;
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({
        workspaceFolderRoot: '/workspace/project',
        spawnImpl: (...spawnArgs: unknown[]) => {
            spawnOptions = spawnArgs[2] as { cwd?: string } | undefined;
            return fakeProcess((proc) => {
                proc.stdout.emit('data', Buffer.from(checkOutput([])));
                proc.emit('close', 0);
            });
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
        spawnImpl: () => fakeProcess((proc) => {
            proc.stderr.emit('data', Buffer.from('ERROR: network down\n'));
            proc.emit('close', 2);
        }),
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
        spawnImpl: () => fakeProcess((proc) => {
            proc.emit('close', null, 'SIGTERM');
        }),
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

test('checkAndPromptInstallDependencies warns when interpreter is missing and offers to select another', async () => {
    const { pythonEnvironment, warningMessages, warningButtons, executedCommands, restore } = loadPythonEnvironmentModule({
        warningAnswers: ['Select Environment'],
        spawnImpl: () => fakeProcess((proc) => {
            const error = new Error('spawn ENOENT') as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            proc.emit('error', error);
        }),
    });
    const item = statusItem();

    try {
        await pythonEnvironment.checkAndPromptInstallDependencies('missing-python', item as never);
        await settle();
        assert.equal(item.text, 'Python: missing-python $(warning)');
        assert.equal(item.tooltip, 'The Python interpreter was not found. Click to select another environment.');
        // The interpreter path follows the host venv layout (bin/python on POSIX, Scripts\\python.exe on Windows).
        const expectedInterpreter = pythonEnvironment.resolvePythonCommand('missing-python');
        assert.deepEqual(warningMessages, [`Python interpreter not found: ${expectedInterpreter}`]);
        assert.deepEqual(warningButtons, [['Select Environment', 'Show Log']]);
        assert.deepEqual(executedCommands, ['audioWandasAnalyzer.selectPythonEnvironment']);
    } finally {
        restore();
    }
});

test('checkAndPromptInstallDependencies treats invalid dependency output as a check failure', async () => {
    const { pythonEnvironment, errorMessages, errorButtons, log, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => fakeProcess((proc) => {
            proc.stdout.emit('data', Buffer.from('not json'));
            proc.emit('close', 0);
        }),
    });
    const item = statusItem();

    try {
        await assert.doesNotReject(() => pythonEnvironment.checkAndPromptInstallDependencies('python3', item as never));
        assert.equal(item.tooltip, 'The Python environment check failed. Click to select another environment.');
        assert.deepEqual(errorMessages, ['Could not check the Python packages in python3. See the log for details.']);
        assert.deepEqual(errorButtons, [['Show Log', 'Select Environment']]);
        assert.match(log(), /Failed to parse dependency check output/u);
    } finally {
        restore();
    }
});

test('install prompt still reports pip-specific failure when pip is unavailable', async () => {
    const { pythonEnvironment, warningMessages, item, restore } = (() => {
        const loaded = loadPythonEnvironmentModule({
            warningAnswers: ['Install'],
            spawnImpl: (...spawnArgs: unknown[]) => {
                const args = Array.isArray(spawnArgs[1]) ? spawnArgs[1] : [];
                return fakeProcess((proc) => {
                    if (args?.[1] === 'pip') {
                        proc.stderr.emit('data', Buffer.from('No module named pip'));
                        proc.emit('close', 1);
                        return;
                    }
                    proc.stdout.emit('data', Buffer.from(checkOutput(['wandas[psychoacoustic,effects]>=0.12.0,<0.13.0'])));
                    proc.emit('close', 0);
                });
            },
        });
        return { ...loaded, item: statusItem() };
    })();

    try {
        await pythonEnvironment.checkAndPromptInstallDependencies('python3', item as never);
        assert.equal(item.tooltip, 'pip is not available in this environment. Click to select another environment.');
        assert.deepEqual(warningMessages, [
            'Audio Wandas Analyzer needs compatible Python packages in python3: wandas[psychoacoustic,effects]>=0.12.0,<0.13.0',
            'pip is not available in python3. Select another environment or create a .venv.',
        ]);
    } finally {
        restore();
    }
});

test('an externally managed interpreter (PEP 668) is not offered a pip install, only a .venv or another environment', async () => {
    const root = makeWorkspace();
    const { pythonEnvironment, warningMessages, warningButtons, restore } = loadPythonEnvironmentModule({
        workspaceFolderRoot: root,
        spawnImpl: () => fakeProcess((proc) => {
            proc.stdout.emit('data', Buffer.from(checkOutput(['numpy>=2.0.2'], true)));
            proc.emit('close', 0);
        }),
    });

    try {
        assert.equal(await pythonEnvironment.checkAndPromptInstallDependencies('python3', statusItem() as never), false);
        assert.deepEqual(warningMessages, [
            'python3 is managed by the operating system (PEP 668), so packages cannot be installed into it. Create a .venv or select another environment.',
        ]);
        assert.deepEqual(warningButtons, [['Create .venv and Install', 'Select Environment']]);
    } finally {
        restore();
        rmSync(root, { recursive: true, force: true });
    }
});

test('a pip externally-managed-environment refusal steers to .venv instead of showing raw pip output', async () => {
    const root = makeWorkspace();
    const { pythonEnvironment, warningMessages, warningButtons, errorMessages, log, restore } = loadPythonEnvironmentModule({
        workspaceFolderRoot: root,
        warningAnswers: ['Install'],
        spawnImpl: (...spawnArgs: unknown[]) => {
            const args = spawnArgs[1] as string[];
            return fakeProcess((proc) => {
                if (args[1] === 'pip') {
                    proc.stderr.emit('data', Buffer.from('error: externally-managed-environment\n\n× This environment is externally managed\n'));
                    proc.emit('close', 1);
                    return;
                }
                proc.stdout.emit('data', Buffer.from(checkOutput(['numpy>=2.0.2'])));
                proc.emit('close', 0);
            });
        },
    });

    try {
        await pythonEnvironment.checkAndPromptInstallDependencies('python3', statusItem() as never);
        await settle();
        assert.equal(warningMessages[1], 'python3 is managed by the operating system (PEP 668), so packages cannot be installed into it. Create a .venv or select another environment.');
        assert.deepEqual(warningButtons[1], ['Create .venv and Install', 'Select Environment', 'Show Log']);
        assert.deepEqual(errorMessages, []);
        assert.match(log(), /externally-managed-environment/u);
    } finally {
        restore();
        rmSync(root, { recursive: true, force: true });
    }
});

test('a failed pip install shows a short message with Show Log; pip output goes to the setup log', async () => {
    const { pythonEnvironment, errorMessages, errorButtons, log, restore } = loadPythonEnvironmentModule({
        warningAnswers: ['Install'],
        spawnImpl: (...spawnArgs: unknown[]) => {
            const args = spawnArgs[1] as string[];
            return fakeProcess((proc) => {
                if (args[1] === 'pip') {
                    proc.stdout.emit('data', Buffer.from('Collecting numpy\n'));
                    proc.stderr.emit('data', Buffer.from('ERROR: Could not find a version that satisfies the requirement\n'));
                    proc.emit('close', 1);
                    return;
                }
                proc.stdout.emit('data', Buffer.from(checkOutput(['numpy>=2.0.2'])));
                proc.emit('close', 0);
            });
        },
    });

    try {
        assert.equal(await pythonEnvironment.checkAndPromptInstallDependencies('python3', statusItem() as never), false);
        assert.deepEqual(errorMessages, ['Installing the Python packages failed. See the log for details.']);
        assert.deepEqual(errorButtons, [['Show Log', 'Select Environment']]);
        assert.match(log(), /\$ python3 -m pip install numpy>=2\.0\.2/u);
        assert.match(log(), /Collecting numpy/u);
        assert.match(log(), /Could not find a version/u);
    } finally {
        restore();
    }
});

test('cancelling the install progress stops pip', async () => {
    let pipProcess: FakeProcess | undefined;
    const { pythonEnvironment, infoMessages, errorMessages, restore } = loadPythonEnvironmentModule({
        warningAnswers: ['Install'],
        cancelProgress: true,
        spawnImpl: (...spawnArgs: unknown[]) => {
            const args = spawnArgs[1] as string[];
            if (args[1] === 'pip') {
                pipProcess = fakeProcess();
                return pipProcess;
            }
            return fakeProcess((proc) => {
                proc.stdout.emit('data', Buffer.from(checkOutput(['numpy>=2.0.2'])));
                proc.emit('close', 0);
            });
        },
    });

    try {
        assert.equal(await pythonEnvironment.checkAndPromptInstallDependencies('python3', statusItem() as never), false);
        assert.equal(pipProcess?.killed, true);
        assert.deepEqual(infoMessages, ['Installing the Python packages was cancelled.']);
        assert.deepEqual(errorMessages, []);
    } finally {
        restore();
    }
});

test('Create .venv and Install makes a workspace venv, installs the README package line into it and selects it', async () => {
    const root = makeWorkspace();
    const spawned: Array<{ command: string; args: string[] }> = [];
    const { pythonEnvironment, updates, progressTitles, infoMessages, restore } = loadPythonEnvironmentModule({
        workspaceFolderRoot: root,
        warningAnswers: ['Create .venv and Install'],
        spawnImpl: (...spawnArgs: unknown[]) => {
            const command = spawnArgs[0] as string;
            const args = spawnArgs[1] as string[];
            spawned.push({ command, args });
            return fakeProcess((proc) => {
                if (args[0] === '-c') {
                    proc.stdout.emit('data', Buffer.from(checkOutput(['numpy>=2.0.2'], true)));
                }
                proc.emit('close', 0);
            });
        },
    });
    const readmeLine = readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf8')
        .split('\n').find(line => line.startsWith('pip install "'))!;
    const readmePackages = [...readmeLine.matchAll(/"([^"]+)"/g)].map(match => match[1]).sort();

    try {
        assert.equal(await pythonEnvironment.checkAndPromptInstallDependencies('python3', statusItem() as never), false);
        const venvPath = path.join(root, '.venv');
        assert.deepEqual(spawned.slice(1, 2), [{ command: 'python3', args: ['-m', 'venv', venvPath] }]);
        assert.equal(spawned[2].command, venvInterpreter(venvPath));
        assert.deepEqual(spawned[2].args.slice(0, 3), ['-m', 'pip', 'install']);
        assert.deepEqual(spawned[2].args.slice(3).sort(), readmePackages);
        assert.deepEqual(progressTitles, [`Creating ${venvPath}`, `Installing Python packages into ${venvPath}`]);
        assert.deepEqual(updates, [{ key: 'pythonCommand', value: '.venv', target: 'workspace' }]);
        assert.deepEqual(infoMessages, ['Python packages installed.']);
    } finally {
        restore();
        rmSync(root, { recursive: true, force: true });
    }
});

test('a venv creation failure for a missing venv module names the package to install', async () => {
    const root = makeWorkspace();
    const { pythonEnvironment, errorMessages, updates, restore } = loadPythonEnvironmentModule({
        workspaceFolderRoot: root,
        warningAnswers: ['Create .venv and Install'],
        spawnImpl: (...spawnArgs: unknown[]) => {
            const args = spawnArgs[1] as string[];
            return fakeProcess((proc) => {
                if (args[0] === '-c') {
                    proc.stdout.emit('data', Buffer.from(checkOutput(['numpy>=2.0.2'], true)));
                    proc.emit('close', 0);
                    return;
                }
                proc.stdout.emit('data', Buffer.from('The virtual environment was not created successfully because ensurepip is not available.\n'));
                proc.emit('close', 1);
            });
        },
    });

    try {
        await pythonEnvironment.checkAndPromptInstallDependencies('python3', statusItem() as never);
        assert.deepEqual(errorMessages, [
            `Creating ${path.join(root, '.venv')} failed because the venv module is unavailable (on Debian or Ubuntu, install python3-venv).`,
        ]);
        assert.deepEqual(updates, []);
    } finally {
        restore();
        rmSync(root, { recursive: true, force: true });
    }
});

/** A `python -m venv` stand-in that leaves a half-made venv (an interpreter, no pip) and then ends as `finish` says. */
function partialVenvSpawn(finish: 'fail' | 'hang') {
    return (...spawnArgs: unknown[]) => {
        const args = spawnArgs[1] as string[];
        return fakeProcess((proc) => {
            if (args[0] === '-c') {
                proc.stdout.emit('data', Buffer.from(checkOutput(['numpy>=2.0.2'], true)));
                proc.emit('close', 0);
                return;
            }
            if (args[1] === 'venv') {
                makeVenv(args[2]);
            }
            if (finish === 'fail') { proc.emit('close', 1); }
        });
    };
}

for (const [label, finish] of [['fails', 'fail'], ['is cancelled', 'hang']] as const) {
    test(`a .venv this call created is removed when creating it ${label}`, async () => {
        const root = makeWorkspace();
        const { pythonEnvironment, updates, restore } = loadPythonEnvironmentModule({
            workspaceFolderRoot: root,
            warningAnswers: ['Create .venv and Install'],
            cancelProgress: finish === 'hang',
            spawnImpl: partialVenvSpawn(finish),
        });

        try {
            await pythonEnvironment.checkAndPromptInstallDependencies('python3', statusItem() as never);
            assert.equal(existsSync(path.join(root, '.venv')), false, 'a half-made .venv would hide "Create .venv" for good');
            assert.deepEqual(updates, []);
        } finally {
            restore();
            rmSync(root, { recursive: true, force: true });
        }
    });
}

test('a .venv that existed before the create call is never removed', async () => {
    const root = makeWorkspace();
    const marker = path.join(root, '.venv', 'keep.txt');
    const { pythonEnvironment, restore } = loadPythonEnvironmentModule({
        workspaceFolderRoot: root,
        warningAnswers: ['Create .venv and Install'],
        // The user's own .venv appears after "Create .venv" was offered but before it runs.
        onWarning: () => {
            mkdirSync(path.dirname(marker), { recursive: true });
            writeFileSync(marker, 'mine');
        },
        spawnImpl: partialVenvSpawn('fail'),
    });

    try {
        await pythonEnvironment.checkAndPromptInstallDependencies('python3', statusItem() as never);
        assert.equal(readFileSync(marker, 'utf8'), 'mine');
    } finally {
        restore();
        rmSync(root, { recursive: true, force: true });
    }
});

test('checkAndPromptInstallDependencies treats unexpected dependency check exit as check failure', async () => {
    const { pythonEnvironment, errorMessages, log, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => fakeProcess((proc) => {
            proc.stderr.emit('data', Buffer.from('ERROR: internal dependency failure\n'));
            proc.emit('close', 2);
        }),
    });
    const item = statusItem();

    try {
        await assert.doesNotReject(() => pythonEnvironment.checkAndPromptInstallDependencies('python3', item as never));
        assert.equal(item.tooltip, 'The Python environment check failed. Click to select another environment.');
        assert.deepEqual(errorMessages, ['Could not check the Python packages in python3. See the log for details.']);
        assert.match(log(), /ERROR: internal dependency failure/u);
    } finally {
        restore();
    }
});

test('checkAndPromptInstallDependencies ignores stale results from older requests', async () => {
    let oldProc: FakeProcess | undefined;
    let newProc: FakeProcess | undefined;
    const { pythonEnvironment, warningMessages, restore } = loadPythonEnvironmentModule({
        spawnImpl: (pythonCommand?: unknown) => {
            const proc = fakeProcess();
            if (pythonCommand === pythonEnvironment.resolvePythonCommand('old-env')) {
                oldProc = proc;
            } else if (pythonCommand === pythonEnvironment.resolvePythonCommand('new-env')) {
                newProc = proc;
            }
            return proc;
        },
    });
    const item = statusItem();
    const emittedStates: Array<{ pythonCommand: string; status: string; tooltip: string }> = [];
    const disposable = pythonEnvironment.onDidChangePythonEnvironmentState((state) => {
        emittedStates.push(state);
    });

    try {
        const oldCheck = pythonEnvironment.checkAndPromptInstallDependencies('old-env', item as never);
        const newCheck = pythonEnvironment.checkAndPromptInstallDependencies('new-env', item as never);

        assert.ok(oldProc);
        assert.ok(newProc);

        newProc.stdout.emit('data', Buffer.from(checkOutput([])));
        newProc.emit('close', 0);

        oldProc.stdout.emit('data', Buffer.from(checkOutput(['wandas'])));
        oldProc.emit('close', 0);

        await Promise.all([oldCheck, newCheck]);

        assert.equal(item.text, 'Python: new-env');
        assert.equal(item.tooltip, 'Click to select the Python environment');
        assert.equal(warningMessages.length, 0);
        assert.deepEqual(emittedStates, [{
            pythonCommand: 'new-env',
            status: 'normal',
            tooltip: 'Click to select the Python environment',
        }]);
    } finally {
        disposable.dispose();
        restore();
    }
});

test('checkAndPromptInstallDependencies swallows unexpected errors and shows an error message', async () => {
    const { pythonEnvironment, errorMessages, log, restore } = loadPythonEnvironmentModule({
        spawnImpl: () => fakeProcess((proc) => {
            proc.emit('error', new Error('boom'));
        }),
    });
    const item = statusItem();

    try {
        await assert.doesNotReject(() => pythonEnvironment.checkAndPromptInstallDependencies('python3', item as never));
        assert.equal(item.tooltip, 'The Python environment check failed. Click to select another environment.');
        assert.deepEqual(errorMessages, ['Could not check the Python packages in python3. See the log for details.']);
        assert.match(log(), /boom/u);
    } finally {
        restore();
    }
});
