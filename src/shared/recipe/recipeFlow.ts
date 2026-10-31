import type { ChartSpec } from '../chartSpec';
import { fillTemplate, getStrings, type UiStrings } from '../i18n/strings';
import { userErrorText, type ErrorSummaryStrings } from '../protocol/backendProtocol';
import { bindSelection, needsAssignment, type RecipeDocument } from './recipeSelection';

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
 * Webview panel; the static Web host binds them to the built manifest, an
 * in-page menu, the Pyodide Worker and an in-page frame.
 */
export interface RecipeFlowPorts {
    listRecipes(): Promise<RecipeCatalogEntry[]>;
    /** Returns the chosen entry's location, or undefined when cancelled. */
    pickRecipe(items: RecipePickItem[], entries: RecipeCatalogEntry[]): Promise<string | undefined>;
    readRecipe(location: string): Promise<RecipeDocument>;
    /** Asked only when the caller supplied no selection; undefined cancels. */
    pickInputFiles(): Promise<string[] | undefined>;
    /**
     * Lets the user check or change which file fills each Recipe input before it runs; `proposed` follows the
     * selection order. Asked only when that order alone is a guess (see `needsAssignment`); undefined cancels.
     */
    assignInputs(names: string[], files: string[], proposed: Record<string, string>): Promise<Record<string, string> | undefined>;
    runWithProgress<T>(title: string, task: () => Promise<T>): Promise<T>;
    /** `inputs` maps each Recipe input name to a checked file. */
    execute(recipe: RecipeDocument, inputs: Record<string, string>, location: string): Promise<{ charts: ChartSpec[] }>;
    /** `inputs` is the same mapping `execute` received, so the result can say which file filled which input. */
    showCharts(title: string, charts: ChartSpec[], inputs: Record<string, string>): void;
    showError(message: string): void;
}

export function recipeBaseName(location: string): string {
    return location.split(/[\\/]/).pop() || location;
}

/** Recipe name without its `.recipe.json` / `.json` suffix, matching the backend's chart titles. */
export function recipeTitle(location: string): string {
    const name = recipeBaseName(location);
    const suffix = ['.recipe.json', '.json'].find(candidate => name.toLowerCase().endsWith(candidate));
    return suffix ? name.slice(0, -suffix.length) : name;
}

/**
 * Lists recipes, lets the user choose one and the inputs, assigns the panel
 * selection to the Recipe inputs and shows the resulting charts.
 */
export class RecipeFlow {
    constructor(
        private readonly ports: RecipeFlowPorts,
        private readonly strings: Pick<UiStrings, 'recipeReadFailed' | 'recipeRunFailed' | 'recipeRunning'> & ErrorSummaryStrings = getStrings('en'),
    ) {}

    async run(selectionFilePaths?: string[], isCurrent: () => boolean = () => true): Promise<void> {
        if (!isCurrent()) return;
        let entries: RecipeCatalogEntry[];
        try {
            entries = await this.ports.listRecipes();
        } catch (error) {
            if (isCurrent()) this.ports.showError(fillTemplate(this.strings.recipeReadFailed, { message: error instanceof Error ? error.message : String(error) }));
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

        const title = recipeTitle(location);
        const failed = (error: unknown): void => {
            if (isCurrent()) this.ports.showError(fillTemplate(this.strings.recipeRunFailed, { message: userErrorText(error, this.strings) }));
        };
        let document: RecipeDocument;
        let inputs: Record<string, string> | undefined;
        try {
            document = await this.ports.readRecipe(location);
            if (!isCurrent()) return;
            inputs = bindSelection(document, selected);
            if (needsAssignment(document, selected)) {
                inputs = await this.ports.assignInputs(document.inputs.map(input => input.name), selected, inputs);
            }
        } catch (error) {
            failed(error);
            return;
        }
        if (!isCurrent() || !inputs) return;
        const chosen = inputs;
        await this.ports.runWithProgress(fillTemplate(this.strings.recipeRunning, { title }), async () => {
            if (!isCurrent()) return;
            try {
                const result = await this.ports.execute(document, chosen, location);
                if (isCurrent()) this.ports.showCharts(title, result.charts, chosen);
            } catch (error) {
                failed(error);
            }
        });
    }
}
