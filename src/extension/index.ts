import * as vscode from 'vscode';
import { getDebugStartupBehavior } from '../shared/utils/startupDebug';
import { AnalysisOrchestrator } from './analysisOrchestrator';
import { ExportFlows } from './exportFlows';
import { autoOpenDebugTarget, registerExtensionContributions } from './extensionContributions';
import { PanelController } from './panelController';
import {
    checkAndPromptInstallDependencies,
    setStatusBarImporting,
    setStatusBarNormal,
    setStatusBarWarning,
} from './pythonEnvironment';
import { PythonBackendServer } from './pythonBackendServer';
import { RecipeFlow } from './recipeFlow';

export function activate(context: vscode.ExtensionContext): void {
    let deactivated = false;
    const perfChannel = vscode.window.createOutputChannel('Audio Wandas Analyzer (perf)');
    const logPerf = (line: string): void => { perfChannel.appendLine(line); };
    const pythonStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    pythonStatusBarItem.command = 'audioWandasAnalyzer.selectPythonEnvironment';
    const backend = new PythonBackendServer(context.extensionPath, (line) => {
        if (line.startsWith('[ts]')) {
            logPerf(line);
            return;
        }
        logPerf(`[py] ${line.startsWith('[perf]') ? line.slice(7) : line}`);
    }, () => {
        if (deactivated) { return; }
        const pythonCommand = vscode.workspace
            .getConfiguration('audioWandasAnalyzer')
            .get<string>('pythonCommand', 'python3');
        setStatusBarNormal(pythonStatusBarItem, pythonCommand);
    });
    const analysis = new AnalysisOrchestrator(backend, logPerf);
    const exports = new ExportFlows(backend);
    const recipeFlow = new RecipeFlow(context.extensionPath, context.extensionUri);
    const panelController = new PanelController(context, backend, analysis, exports);

    const warmPythonBackend = (pythonCommand: string): void => {
        void checkAndPromptInstallDependencies(pythonCommand, pythonStatusBarItem).then(async (dependenciesReady) => {
            const currentPythonCommand = vscode.workspace
                .getConfiguration('audioWandasAnalyzer')
                .get<string>('pythonCommand', 'python3');
            if (!dependenciesReady || deactivated || currentPythonCommand !== pythonCommand) { return; }
            setStatusBarImporting(pythonStatusBarItem, pythonCommand);
            try {
                await backend.warmup();
                if (deactivated) { return; }
                if (vscode.workspace.getConfiguration('audioWandasAnalyzer')
                    .get<string>('pythonCommand', 'python3') === pythonCommand) {
                    setStatusBarNormal(pythonStatusBarItem, pythonCommand);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logPerf(`[ts] backend warmup failed error=${message}`);
                if (vscode.workspace.getConfiguration('audioWandasAnalyzer')
                    .get<string>('pythonCommand', 'python3') === pythonCommand) {
                    setStatusBarWarning(
                        pythonStatusBarItem,
                        pythonCommand,
                        `Python backend failed to start: ${message}`,
                    );
                }
            }
        });
    };

    context.subscriptions.push(
        pythonStatusBarItem,
        panelController,
        { dispose: () => {
            deactivated = true;
            backend.dispose();
        } },
        perfChannel,
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('audioWandasAnalyzer.pythonCommand')) {
                backend.dispose();
                const pythonCommand = vscode.workspace
                    .getConfiguration('audioWandasAnalyzer')
                    .get<string>('pythonCommand', 'python3');
                setStatusBarNormal(pythonStatusBarItem, pythonCommand);
                warmPythonBackend(pythonCommand);
            }
        }),
    );
    registerExtensionContributions(context, pythonStatusBarItem, panelController, recipeFlow);

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

    const pythonCommand = vscode.workspace
        .getConfiguration('audioWandasAnalyzer')
        .get<string>('pythonCommand', 'python3');
    setStatusBarNormal(pythonStatusBarItem, pythonCommand);
    warmPythonBackend(pythonCommand);
}

export function deactivate(): void {}
