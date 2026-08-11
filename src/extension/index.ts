import * as vscode from 'vscode';
import { getDebugStartupBehavior } from '../shared/utils/startupDebug';
import { AnalysisOrchestrator } from './analysisOrchestrator';
import { ExportFlows } from './exportFlows';
import { autoOpenDebugTarget, registerExtensionContributions } from './extensionContributions';
import { PanelController } from './panelController';
import {
    checkAndPromptInstallDependencies,
    setStatusBarNormal,
} from './pythonEnvironment';
import { PythonBackendServer } from './pythonBackendServer';
import { RecipeFlow } from './recipeFlow';

export function activate(context: vscode.ExtensionContext): void {
    const perfChannel = vscode.window.createOutputChannel('Audio Wandas Analyzer (perf)');
    const logPerf = (line: string): void => { perfChannel.appendLine(line); };
    const backend = new PythonBackendServer(context.extensionPath, (line) => {
        logPerf(`[py] ${line.startsWith('[perf]') ? line.slice(7) : line}`);
    });
    const analysis = new AnalysisOrchestrator(backend, logPerf);
    const exports = new ExportFlows(backend);
    const recipeFlow = new RecipeFlow(context.extensionPath, context.extensionUri);
    const panelController = new PanelController(context, backend, analysis, exports);

    const pythonStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    pythonStatusBarItem.command = 'audioWandasAnalyzer.selectPythonEnvironment';

    context.subscriptions.push(
        pythonStatusBarItem,
        panelController,
        { dispose: () => backend.dispose() },
        perfChannel,
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
    void checkAndPromptInstallDependencies(pythonCommand, pythonStatusBarItem);
}

export function deactivate(): void {}
