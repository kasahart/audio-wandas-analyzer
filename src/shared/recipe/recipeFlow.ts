import type { ChartSpec } from '../chartSpec';
import { substituteSelection, type RecipeDocument } from './recipeSelection';

export interface RecipeCatalogEntry {
    /** File name shown to the user, e.g. `octave.json`. */
    name: string;
    /** Host location: an absolute path on disk, or a URL relative to the static site. */
    location: string;
    /** Distributions the recipe needs that this host's runtime lacks; non-empty means it cannot run here. */
    missing?: string[];
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
    /** Resolve a relative recipe input against the recipe location. */
    resolveRelative(file: string, location: string): string;
    runWithProgress<T>(title: string, task: () => Promise<T>): Promise<T>;
    execute(recipe: RecipeDocument, location: string): Promise<{ charts: ChartSpec[] }>;
    showCharts(title: string, charts: ChartSpec[]): void;
    showError(message: string): void;
}

export function recipeBaseName(location: string): string {
    return location.split(/[\\/]/).pop() || location;
}

/**
 * Lists recipes, lets the user choose one and the inputs, fills the panel
 * selection into `{{selection}}` slots and shows the resulting charts.
 */
export class RecipeFlow {
    constructor(private readonly ports: RecipeFlowPorts) {}

    async run(selectionFilePaths?: string[]): Promise<void> {
        let entries: RecipeCatalogEntry[];
        try {
            entries = await this.ports.listRecipes();
        } catch (error) {
            this.ports.showError(`Could not read recipes: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        const items = entries.map(entry => ({
            label: entry.name,
            description: entry.missing?.length ? `${entry.location} (needs ${entry.missing.join(', ')})` : entry.location,
        }));
        const location = await this.ports.pickRecipe(items, entries);
        if (!location) return;
        const chosen = entries.find(entry => entry.location === location);
        if (chosen?.missing?.length) {
            this.ports.showError(`Recipe ${chosen.name} needs ${chosen.missing.join(', ')}, which this runtime does not bundle.`);
            return;
        }
        const selected = selectionFilePaths && selectionFilePaths.length > 0
            ? selectionFilePaths
            : await this.ports.pickInputFiles();
        if (!selected || selected.length === 0) return;

        const title = recipeBaseName(location);
        await this.ports.runWithProgress(`Running recipe ${title}…`, async () => {
            try {
                const recipe = substituteSelection(
                    await this.ports.readRecipe(location), selected, file => this.ports.resolveRelative(file, location),
                );
                const result = await this.ports.execute(recipe, location);
                this.ports.showCharts(title, result.charts);
            } catch (error) {
                this.ports.showError(`Recipe execution failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
}
