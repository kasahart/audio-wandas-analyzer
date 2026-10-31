import * as path from 'node:path';
import * as vscode from 'vscode';
import { fillTemplate, getStrings } from '../shared/i18n/strings';
import { getDebugStartupBehavior } from '../shared/utils/startupDebug';
import { AnalysisOrchestrator } from './analysisOrchestrator';
import { ExportFlows } from './exportFlows';
import { autoOpenDebugTarget, registerExtensionContributions } from './extensionContributions';
import { PanelController } from './panelController';
import {
    checkAndPromptInstallDependencies,
    disposePythonSetupLog,
    getCurrentPythonEnvironmentState,
    getPythonCommand,
    onDidChangeDefaultInterpreter,
    onDidChangePythonEnvironmentState,
    onDidReselectPythonCommand,
    refreshDefaultInterpreter,
    setStatusBarImporting,
    setStatusBarNormal,
    setStatusBarWarning,
} from './pythonEnvironment';
import { PythonBackendServer } from './pythonBackendServer';
import { RecipeFlow } from './recipeFlow';
import { CalibrationStore } from './calibrationStore';

const ANALYZER_VIEW_TYPE_PREFIX = 'audioWandasAnalyzer.';

/** True while any of the extension's webview panels (comparison or recipe charts) is open. */
function hasAnalyzerPanel(): boolean {
    return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => (
        tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes(ANALYZER_VIEW_TYPE_PREFIX)
    )));
}

/** `calibration` is the activation's one calibration store; bootstrap.ts shares it with the calibration command. */
export function activate(context: vscode.ExtensionContext, calibration = new CalibrationStore(context)): void {
    let deactivated = false;
    const perfChannel = vscode.window.createOutputChannel('Audio Wandas Analyzer (perf)');
    const logPerf = (line: string): void => { perfChannel.appendLine(line); };
    const logChannel = vscode.window.createOutputChannel('Audio Wandas Analyzer', { log: true });
    const pythonStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    pythonStatusBarItem.command = 'audioWandasAnalyzer.selectPythonEnvironment';
    const updateStatusBarVisibility = (): void => {
        if (hasAnalyzerPanel() || getCurrentPythonEnvironmentState().status === 'warning') {
            pythonStatusBarItem.show();
        } else {
            pythonStatusBarItem.hide();
        }
    };
    const backend = new PythonBackendServer(context.extensionPath, (line) => {
        if (line.startsWith('[ts]')) {
            logPerf(line);
            return;
        }
        logPerf(`[py] ${line.startsWith('[perf]') ? line.slice(7) : line}`);
    }, () => {
        if (deactivated) { return; }
        const pythonCommand = getPythonCommand();
        setStatusBarNormal(pythonStatusBarItem, pythonCommand);
    }, {
        current: filePath => ({ calibrationProfile: calibration.profile(filePath), analysisRevision: calibration.analysisRevision(filePath) }),
        discardStale: async (filePath, error, attempted) => attempted.calibrationProfile !== undefined
            && calibration.discardStale(filePath, error, attempted.calibrationProfile),
    }, {
        log: line => { logChannel.warn(line); },
        crashed: error => {
            logChannel.error(error.message);
            if (deactivated) { return; }
            setStatusBarWarning(pythonStatusBarItem, getPythonCommand(), fillTemplate(getStrings(vscode.env.language).pyTooltipBackendStopped, { message: error.message }));
        },
    });
    const analysis = new AnalysisOrchestrator(backend, logPerf);
    const exports = new ExportFlows(backend);
    const recipeFlow = new RecipeFlow(context.extensionPath, context.extensionUri, backend);

    // Nothing touches Python until the user does something that needs it, so opening a window stays free.
    type PythonPreparation = 'idle' | 'checking' | 'ready' | 'failed';
    let preparation: PythonPreparation = 'idle';
    let preparedCommand: string | undefined;
    let defaultInterpreterLookup: Promise<unknown> | undefined;
    // The check→install→warmup run for `preparedCommand`; resolves to whether its dependencies are importable.
    let preparationTask: Promise<boolean> = Promise.resolve(true);
    let preparationGeneration = 0;

    const runPythonPreparation = async (pythonCommand: string, generation: number): Promise<boolean> => {
        const isCurrent = (): boolean => generation === preparationGeneration;
        const dependenciesReady = await checkAndPromptInstallDependencies(pythonCommand, pythonStatusBarItem);
        if (deactivated) { return dependenciesReady; }
        // The prompt switched interpreters or started a newer check (Create .venv and Install, Select Environment,
        // even of the same interpreter): what a waiting analysis needs is that preparation, not this one's answer.
        if (!isCurrent() || getPythonCommand() !== pythonCommand) { return preparePython(false); }
        if (!dependenciesReady) {
            preparation = 'failed';
            return false;
        }
        setStatusBarImporting(pythonStatusBarItem, pythonCommand);
        try {
            await backend.warmup();
            if (deactivated) { return true; }
            if (isCurrent()) {
                preparation = 'ready';
                setStatusBarNormal(pythonStatusBarItem, pythonCommand);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logPerf(`[ts] backend warmup failed error=${message}`);
            if (isCurrent()) {
                preparation = 'failed';
                setStatusBarWarning(
                    pythonStatusBarItem,
                    pythonCommand,
                    fillTemplate(getStrings(vscode.env.language).pyTooltipBackendFailed, { message }),
                );
            }
        }
        // The packages are there; a failed warmup is reported by the analysis that respawns the backend.
        return true;
    };
    const warmPythonBackend = (pythonCommand: string): Promise<boolean> => {
        preparation = 'checking';
        preparedCommand = pythonCommand;
        preparationGeneration += 1;
        preparationTask = runPythonPreparation(pythonCommand, preparationGeneration);
        return preparationTask;
    };

    /**
     * Checks the environment and starts the backend once per interpreter. `retryFailed` is set for explicit user
     * commands, so a fixed environment (e.g. packages installed in a terminal) is picked up without a restart.
     */
    const preparePython = async (retryFailed: boolean): Promise<boolean> => {
        defaultInterpreterLookup ??= refreshDefaultInterpreter();
        await defaultInterpreterLookup;
        if (deactivated) { return false; }
        const pythonCommand = getPythonCommand();
        if (preparedCommand === pythonCommand) {
            if (preparation === 'ready') { analysis.warmup(); }
            if (preparation !== 'failed' || !retryFailed) { return preparationTask; }
        }
        return warmPythonBackend(pythonCommand);
    };
    const restartPython = (): void => {
        backend.dispose();
        const pythonCommand = getPythonCommand();
        setStatusBarNormal(pythonStatusBarItem, pythonCommand);
        if (preparation === 'idle') { return; }
        void warmPythonBackend(pythonCommand);
    };

    const panelController = new PanelController(context, backend, {
        analyzeFiles: async (...args) => {
            // Wait for the check (and any install the user accepts) so the backend never spawns without wandas.
            // When the environment is not usable, the check has already shown its Install/Select prompt; each
            // file becomes an error track saying so, as a backend that failed to start would. The track carries the
            // file's current revision, or the panel would take it as stale and ask again without end.
            if (!await preparePython(false)) {
                const message = getStrings(vscode.env.language).analysisPythonNotReady;
                return args[0].map(filePath => ({
                    filePath, fileName: path.basename(filePath), sampleRateHz: 0, durationSeconds: 0, channelCount: 0,
                    sampleCount: 0, channels: [], analysisRevision: calibration.analysisRevision(filePath), error: message,
                }));
            }
            return analysis.analyzeFiles(...args);
        },
        warmup: () => { void preparePython(false); },
    }, exports, calibration);

    context.subscriptions.push(
        pythonStatusBarItem,
        panelController,
        { dispose: () => {
            deactivated = true;
            backend.dispose();
        } },
        perfChannel,
        logChannel,
        { dispose: disposePythonSetupLog },
        vscode.window.tabGroups.onDidChangeTabs(updateStatusBarVisibility),
        onDidChangePythonEnvironmentState(updateStatusBarVisibility),
        onDidReselectPythonCommand(() => {
            backend.dispose();
            void warmPythonBackend(getPythonCommand());
        }),
        onDidChangeDefaultInterpreter(() => {
            if (preparedCommand !== getPythonCommand()) { restartPython(); }
        }),
        // Trust makes the workspace's pythonCommand value and its interpreters usable, so look again.
        vscode.workspace.onDidGrantWorkspaceTrust(() => {
            defaultInterpreterLookup = refreshDefaultInterpreter();
            void defaultInterpreterLookup.then(() => {
                if (!deactivated) { restartPython(); }
            });
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('audioWandasAnalyzer.pythonCommand')) {
                restartPython();
            } else if (event.affectsConfiguration('audioWandasAnalyzer.cacheMemoryMb')) {
                // The cache budget is read when the backend spawns, so only a restart applies it.
                backend.dispose();
                if (preparation === 'ready') { analysis.warmup(); }
            }
        }),
    );
    registerExtensionContributions(
        context,
        pythonStatusBarItem,
        panelController,
        recipeFlow,
        (reason) => preparePython(reason === 'command'),
    );

    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { registerWorkspaceTests } = require('../testing/workspaceTests') as typeof import('../testing/workspaceTests');
        registerWorkspaceTests(context);
    } catch {
        // The compiler-backed workspace test provider is development-only and is not packaged in the VSIX.
    }

    const startupBehavior = getDebugStartupBehavior(process.env);
    if (startupBehavior.closePanelOnStartup) {
        void vscode.commands.executeCommand('workbench.action.closePanel');
    }
    if (startupBehavior.autoOpenDebugTarget) {
        void autoOpenDebugTarget(
            context,
            panelController,
            startupBehavior.autoSelectAllDirectoryFiles,
        );
    }

    setStatusBarNormal(pythonStatusBarItem, getPythonCommand());
    updateStatusBarVisibility();
}

export function deactivate(): void {}
