import type { ChartSpec } from '../chartSpec';
import { bindSelection, type RecipeDocument } from './recipeSelection';

export interface RecipeCatalogEntry {
    /** File name shown to the user, e.g. `octave.json`. */
    name: string;
    /** Host location: an absolute path on disk, or a URL relative to the static site. */
    location: string;
}

export interface RecipePickItem {
    label: string;
    description: string;
}

/**
 * Host-specific ports behind the recipe workflow. VS Code binds them to the
 * recipes directory, QuickPick/open dialogs, a Python child process and a
 * Webview panel; the static Web host binds them to the built manifest, a
 * prompt, the Pyodide Worker and an in-page frame.
 */
export interface RecipeFlowPorts {
    listRecipes(): Promise<RecipeCatalogEntry[]>;
    /** Returns the chosen entry's location, or undefined when cancelled. */
    pickRecipe(items: RecipePickItem[], entries: RecipeCatalogEntry[]): Promise<string | undefined>;
    readRecipe(location: string): Promise<RecipeDocument>;
    /** Asked only when the caller supplied no selection; undefined cancels. */
    pickInputFiles(): Promise<string[] | undefined>;
    runWithProgress<T>(title: string, task: () => Promise<T>): Promise<T>;
    /** `inputs` maps each Recipe input name to a checked file. */
    execute(recipe: RecipeDocument, inputs: Record<string, string>, location: string): Promise<{ charts: ChartSpec[] }>;
    showCharts(title: string, charts: ChartSpec[]): void;
    showError(message: string): void;
}

export function recipeBaseName(location: string): string {
    return location.split(/[\\/]/).pop() || location;
}

/**
 * Lists recipes, lets the user choose one and the inputs, assigns the panel
 * selection to the Recipe inputs and shows the resulting charts.
 */
export class RecipeFlow {
    constructor(private readonly ports: RecipeFlowPorts) {}

    async run(selectionFilePaths?: string[], isCurrent: () => boolean = () => true): Promise<void> {
        if (!isCurrent()) return;
        let entries: RecipeCatalogEntry[];
        try {
            entries = await this.ports.listRecipes();
        } catch (error) {
            if (isCurrent()) this.ports.showError(`Could not read recipes: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        if (!isCurrent()) return;
        const items = entries.map(entry => ({ label: entry.name, description: entry.location }));
        const location = await this.ports.pickRecipe(items, entries);
        if (!isCurrent() || !location) return;
        const selected = selectionFilePaths && selectionFilePaths.length > 0
            ? selectionFilePaths
            : await this.ports.pickInputFiles();
        if (!isCurrent() || !selected || selected.length === 0) return;

        const title = recipeBaseName(location);
        await this.ports.runWithProgress(`Running recipe ${title}…`, async () => {
            if (!isCurrent()) return;
            try {
                const document = await this.ports.readRecipe(location);
                if (!isCurrent()) return;
                const result = await this.ports.execute(document, bindSelection(document, selected), location);
                if (isCurrent()) this.ports.showCharts(title, result.charts);
            } catch (error) {
                if (isCurrent()) this.ports.showError(`Recipe execution failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
}
