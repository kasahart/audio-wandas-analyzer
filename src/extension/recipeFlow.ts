import * as path from 'path';
import * as vscode from 'vscode';
import type { RecipeRunnerResult } from '../shared/chartSpec';
import { RecipeFlow as SharedRecipeFlow, type RecipeCatalogEntry, type RecipeFlowPorts, type RecipePickItem } from '../shared/recipe/recipeFlow';
import { isRecipeDocument, type RecipeDocument } from '../shared/recipe/recipeSelection';
import { ChartSpecPanel } from '../webview/panels/ChartSpecPanel';
import { runRecipe } from './recipeRunner';

export interface RecipeFlowHost {
    readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
    readFile(uri: vscode.Uri): Thenable<Uint8Array>;
    pickRecipe(items: RecipePickItem[]): Promise<string | undefined>;
    pickInputFiles(): Promise<string[] | undefined>;
    runWithProgress<T>(title: string, task: () => Thenable<T>): Thenable<T>;
    showCharts(extensionUri: vscode.Uri, title: string, result: RecipeRunnerResult): void;
    showError(message: string): void;
}

const BROWSE_RECIPE_LABEL = '$(folder-opened) Browse...';

const defaultHost: RecipeFlowHost = {
    readDirectory: (uri) => vscode.workspace.fs.readDirectory(uri),
    readFile: (uri) => vscode.workspace.fs.readFile(uri),
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

/** VS Code recipe ports: bundled recipes directory, QuickPick/open dialogs, Python child process and ChartSpec panel. */
export class RecipeFlow {
    private readonly flow: SharedRecipeFlow;

    constructor(
        private readonly extensionPath: string,
        private readonly extensionUri: vscode.Uri,
        private readonly host: RecipeFlowHost = defaultHost,
        private readonly executeRecipe = runRecipe,
    ) {
        this.flow = new SharedRecipeFlow(this.ports());
    }

    run(filePathsFromCaller?: string[]): Promise<void> {
        return this.flow.run(filePathsFromCaller);
    }

    private ports(): RecipeFlowPorts {
        const recipesDirectory = path.join(this.extensionPath, 'python-backend', 'recipes');
        return {
            listRecipes: async (): Promise<RecipeCatalogEntry[]> => {
                let entries: [string, vscode.FileType][];
                try {
                    entries = await this.host.readDirectory(vscode.Uri.file(recipesDirectory));
                } catch (error) {
                    throw new Error(`recipe directory ${recipesDirectory}: ${error instanceof Error ? error.message : String(error)}`);
                }
                return entries
                    .filter(([name, type]) => (type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith('.json'))
                    .map(([name]) => name)
                    .sort()
                    .map(name => ({ name, location: path.join(recipesDirectory, name) }));
            },
            pickRecipe: (items) => this.host.pickRecipe([
                ...items, { label: BROWSE_RECIPE_LABEL, description: 'Pick a recipe JSON from disk' },
            ]),
            readRecipe: async (location): Promise<RecipeDocument> => {
                const parsed: unknown = JSON.parse(Buffer.from(await this.host.readFile(vscode.Uri.file(location))).toString('utf-8'));
                if (!isRecipeDocument(parsed)) { throw new Error(`${location} is not a recipe document`); }
                return parsed;
            },
            pickInputFiles: () => this.host.pickInputFiles(),
            resolveRelative: (file, location) => path.resolve(path.dirname(location), file),
            runWithProgress: (title, task) => Promise.resolve(this.host.runWithProgress(title, task)),
            execute: (recipe) => this.executeRecipe({ recipe, extensionPath: this.extensionPath }),
            showCharts: (title, charts) => this.host.showCharts(this.extensionUri, title, { charts }),
            showError: (message) => this.host.showError(message),
        };
    }
}
