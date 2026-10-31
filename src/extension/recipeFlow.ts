import * as path from 'path';
import * as vscode from 'vscode';
import type { RecipeRunnerResult } from '../shared/chartSpec';
import { fillTemplate, getStrings } from '../shared/i18n/strings';
import { RecipeFlow as SharedRecipeFlow, type RecipeCatalogEntry, type RecipeFlowPorts, type RecipePickItem } from '../shared/recipe/recipeFlow';
import { describeInputs, isRecipeDocument, type RecipeDocument } from '../shared/recipe/recipeSelection';
import { SUPPORTED_AUDIO_DIALOG_EXTENSIONS } from '../shared/utils/audioTarget';
import { ChartSpecPanel } from '../webview/panels/ChartSpecPanel';
import type { AnalysisClient, AnalysisCancellationSignal } from '../shared/analysis/analysisClient';

export interface RecipeFlowHost {
    readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]>;
    readFile(uri: vscode.Uri): Thenable<Uint8Array>;
    pickRecipe(items: RecipePickItem[]): Promise<string | undefined>;
    pickInputFiles(): Promise<string[] | undefined>;
    assignInputs(names: string[], files: string[], proposed: Record<string, string>): Promise<Record<string, string> | undefined>;
    runWithProgress<T>(title: string, task: (cancellation: AnalysisCancellationSignal) => Thenable<T>): Thenable<T>;
    showCharts(extensionUri: vscode.Uri, title: string, result: RecipeRunnerResult, caption: string): void;
    showError(message: string): void;
}

const strings = () => getStrings(vscode.env.language);

const defaultHost: RecipeFlowHost = {
    readDirectory: (uri) => vscode.workspace.fs.readDirectory(uri),
    readFile: (uri) => vscode.workspace.fs.readFile(uri),
    async pickRecipe(items) {
        const text = strings();
        const picked = await vscode.window.showQuickPick(items, { placeHolder: text.recipePickPlaceholder });
        if (!picked) { return undefined; }
        if (picked.label !== text.recipeBrowseLabel) { return picked.description; }
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { [text.recipeFileFilter]: ['json'] },
            openLabel: text.recipeOpenLabel,
        });
        return uris?.[0]?.fsPath;
    },
    async pickInputFiles() {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            filters: { Audio: SUPPORTED_AUDIO_DIALOG_EXTENSIONS },
            openLabel: strings().recipeInputsOpenLabel,
        });
        return uris?.map((uri) => uri.fsPath);
    },
    async assignInputs(names, files, proposed) {
        // One QuickPick per input, the proposed file first so Enter keeps the selection order.
        const assigned: Array<[string, string]> = [];
        for (const [index, name] of names.entries()) {
            const ordered = [proposed[name], ...files.filter(file => file !== proposed[name])];
            const picked = await vscode.window.showQuickPick(
                ordered.map(file => ({ label: path.basename(file), description: file })),
                { placeHolder: fillTemplate(strings().recipeInputPlaceholder, { name, index: index + 1, total: names.length }) },
            );
            if (!picked) { return undefined; }
            assigned.push([name, picked.description]);
        }
        // fromEntries keeps any input name, even `__proto__`, as data.
        return Object.fromEntries(assigned);
    },
    runWithProgress: (title, task) => vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: true },
        (_progress, cancellation) => task(cancellation),
    ),
    showCharts: (extensionUri, title, result, caption) => {
        ChartSpecPanel.show(extensionUri, title, result.charts, caption);
    },
    showError: (message) => { void vscode.window.showErrorMessage(message); },
};

/** VS Code recipe ports: bundled recipes directory, QuickPick/open dialogs, persistent backend and ChartSpec panel. */
export class RecipeFlow {
    constructor(
        private readonly extensionPath: string,
        private readonly extensionUri: vscode.Uri,
        private readonly backend: Pick<AnalysisClient, 'runRecipe'>,
        private readonly host: RecipeFlowHost = defaultHost,
    ) {}

    run(filePathsFromCaller?: string[]): Promise<void> {
        return new SharedRecipeFlow(this.ports(), strings()).run(filePathsFromCaller);
    }

    private ports(): RecipeFlowPorts {
        let cancellation: AnalysisCancellationSignal | undefined;
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
                ...items, { label: strings().recipeBrowseLabel, description: strings().recipeBrowseDescription },
            ]),
            readRecipe: async (location): Promise<RecipeDocument> => {
                const parsed: unknown = JSON.parse(Buffer.from(await this.host.readFile(vscode.Uri.file(location))).toString('utf-8'));
                if (!isRecipeDocument(parsed)) { throw new Error(fillTemplate(strings().recipeNotDocument, { path: location })); }
                return parsed;
            },
            pickInputFiles: () => this.host.pickInputFiles(),
            assignInputs: (names, files, proposed) => this.host.assignInputs(names, files, proposed),
            runWithProgress: (title, task) => Promise.resolve(this.host.runWithProgress(title, token => {
                cancellation = token;
                return task();
            })),
            execute: (recipe, inputs, location) => this.backend.runRecipe(recipe, inputs, { recipePath: location, ...(cancellation ? { cancellation } : {}) }),
            showCharts: (title, charts, inputs) => {
                if (!cancellation?.isCancellationRequested) this.host.showCharts(this.extensionUri, title, { charts }, describeInputs(inputs, filePath => path.basename(filePath)));
            },
            showError: (message) => {
                if (!cancellation?.isCancellationRequested) this.host.showError(message);
            },
        };
    }
}
