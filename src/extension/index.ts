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
import { getCalibrationProfile, getAnalysisRevision, discardStaleCalibrationProfile } from './calibrationStore';

const ANALYZER_VIEW_TYPE_PREFIX = 'audioWandasAnalyzer.';

/** True while any of the extension's webview panels (comparison or recipe charts) is open. */
function hasAnalyzerPanel(): boolean {
    return vscode.window.tabGroups.all.some(group => group.tabs.some(tab => (
        tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes(ANALYZER_VIEW_TYPE_PREFIX)
    )));
}

export function activate(context: vscode.ExtensionContext): void {
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
        current: filePath => ({ calibrationProfile: getCalibrationProfile(context, filePath), analysisRevision: getAnalysisRevision(filePath) }),
        discardStale: (filePath, error, attempted) => discardStaleCalibrationProfile(context, filePath, error, attempted.calibrationProfile!),
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

    const warmPythonBackend = (pythonCommand: string): void => {
        preparation = 'checking';
        preparedCommand = pythonCommand;
        void checkAndPromptInstallDependencies(pythonCommand, pythonStatusBarItem).then(async (dependenciesReady) => {
            const currentPythonCommand = getPythonCommand();
            if (deactivated || currentPythonCommand !== pythonCommand) { return; }
            if (!dependenciesReady) {
                preparation = 'failed';
                return;
            }
            setStatusBarImporting(pythonStatusBarItem, pythonCommand);
            try {
                await backend.warmup();
                if (deactivated) { return; }
                if (getPythonCommand() === pythonCommand) {
                    preparation = 'ready';
                    setStatusBarNormal(pythonStatusBarItem, pythonCommand);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logPerf(`[ts] backend warmup failed error=${message}`);
                if (getPythonCommand() === pythonCommand) {
                    preparation = 'failed';
                    setStatusBarWarning(
                        pythonStatusBarItem,
                        pythonCommand,
                        fillTemplate(getStrings(vscode.env.language).pyTooltipBackendFailed, { message }),
                    );
                }
            }
        });
    };

    /**
     * Checks the environment and starts the backend once per interpreter. `retryFailed` is set for explicit user
     * commands, so a fixed environment (e.g. packages installed in a terminal) is picked up without a restart.
     */
    const preparePython = async (retryFailed: boolean): Promise<void> => {
        defaultInterpreterLookup ??= refreshDefaultInterpreter();
        await defaultInterpreterLookup;
        if (deactivated) { return; }
        const pythonCommand = getPythonCommand();
        if (preparedCommand === pythonCommand) {
            if (preparation === 'ready') { analysis.warmup(); }
            if (preparation !== 'failed' || !retryFailed) { return; }
        }
        warmPythonBackend(pythonCommand);
    };
    const restartPython = (): void => {
        backend.dispose();
        const pythonCommand = getPythonCommand();
        setStatusBarNormal(pythonStatusBarItem, pythonCommand);
        if (preparation === 'idle') { return; }
        warmPythonBackend(pythonCommand);
    };

    const panelController = new PanelController(context, backend, {
        analyzeFiles: async (...args) => {
            await preparePython(false);
            return analysis.analyzeFiles(...args);
        },
        warmup: () => { void preparePython(false); },
    }, exports);

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
            warmPythonBackend(getPythonCommand());
        }),
        onDidChangeDefaultInterpreter(() => {
            if (preparedCommand !== getPythonCommand()) { restartPython(); }
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
