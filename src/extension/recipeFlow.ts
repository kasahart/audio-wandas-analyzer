import * as path from 'path';
import * as vscode from 'vscode';
import type { RecipeRunnerResult } from '../shared/chartSpec';
import { ChartSpecPanel } from '../webview/panels/ChartSpecPanel';
import { runRecipe } from './recipeRunner';

export interface RecipeFlowHost {
    readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
    pickRecipe(items: Array<{ label: string; description: string }>): Promise<string | undefined>;
    pickInputFiles(): Promise<string[] | undefined>;
    runWithProgress<T>(title: string, task: () => Thenable<T>): Thenable<T>;
    showCharts(extensionUri: vscode.Uri, title: string, result: RecipeRunnerResult): void;
    showError(message: string): void;
}

const BROWSE_RECIPE_LABEL = '$(folder-opened) Browse...';

const defaultHost: RecipeFlowHost = {
    readDirectory: (uri) => vscode.workspace.fs.readDirectory(uri),
    async pickRecipe(items) {
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a wandas recipe' });
        if (!picked) { return undefined; }
        if (picked.label !== BROWSE_RECIPE_LABEL) { return picked.description; }
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'Recipe JSON': ['json'] },
            openLabel: 'Use recipe',
        });
        return uris?.[0]?.fsPath;
    },
    async pickInputFiles() {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            filters: { Audio: ['wav', 'flac', 'ogg', 'aiff', 'aif', 'snd'] },
            openLabel: 'Use as recipe input',
        });
        return uris?.map((uri) => uri.fsPath);
    },
    runWithProgress: (title, task) => vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title },
        task,
    ),
    showCharts: (extensionUri, title, result) => {
        ChartSpecPanel.show(extensionUri, title, result.charts);
    },
    showError: (message) => { void vscode.window.showErrorMessage(message); },
};

export class RecipeFlow {
    constructor(
        private readonly extensionPath: string,
        private readonly extensionUri: vscode.Uri,
        private readonly host: RecipeFlowHost = defaultHost,
        private readonly executeRecipe = runRecipe,
    ) {}

    async run(filePathsFromCaller?: string[]): Promise<void> {
        const recipesDirectory = path.join(this.extensionPath, 'python-backend', 'recipes');
        let recipeFiles: string[];
        try {
            const entries = await this.host.readDirectory(vscode.Uri.file(recipesDirectory));
            recipeFiles = entries
                .filter(([name, type]) => (type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith('.json'))
                .map(([name]) => name)
                .sort();
        } catch (error) {
            this.host.showError(
                `Could not read recipe directory ${recipesDirectory}: ${error instanceof Error ? error.message : String(error)}`,
            );
            return;
        }

        const items = recipeFiles.map((name) => ({ label: name, description: path.join(recipesDirectory, name) }));
        items.push({ label: BROWSE_RECIPE_LABEL, description: 'Pick a recipe JSON from disk' });
        const recipePath = await this.host.pickRecipe(items);
        if (!recipePath) { return; }
        const selectedFilePaths = filePathsFromCaller && filePathsFromCaller.length > 0
            ? filePathsFromCaller
            : await this.host.pickInputFiles();
        if (!selectedFilePaths || selectedFilePaths.length === 0) { return; }

        await this.host.runWithProgress(`Running recipe ${path.basename(recipePath)}…`, async () => {
            try {
                const result = await this.executeRecipe({
                    recipePath,
                    selectionFilePaths: selectedFilePaths,
                    extensionPath: this.extensionPath,
                });
                this.host.showCharts(this.extensionUri, path.basename(recipePath), result);
            } catch (error) {
                this.host.showError(`Recipe execution failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
}
