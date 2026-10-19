export interface RecipeInput {
    id: string;
    name: string;
    kind: string;
}

/** A wandas Recipe as written by `RecipePlan.save()`; the backend's wandas validates the graph. */
export interface RecipeDocument {
    schema: 'wandas.recipe';
    inputs: RecipeInput[];
    [key: string]: unknown;
}

export function isRecipeDocument(value: unknown): value is RecipeDocument {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const recipe = value as Record<string, unknown>;
    const inputs = recipe['inputs'];
    return recipe['schema'] === 'wandas.recipe'
        && Array.isArray(inputs)
        && inputs.every(input => !!input && typeof input === 'object'
            && (['id', 'name', 'kind'] as const).every(key => typeof (input as RecipeInput)[key] === 'string'));
}

/** Assign the checked files to the Recipe's inputs in the order the Recipe lists them. */
export function bindSelection(recipe: RecipeDocument, selectionFilePaths: string[]): Record<string, string> {
    const arrayInput = recipe.inputs.find(input => input.kind !== 'frame');
    if (arrayInput) throw new Error(`Recipe input ${arrayInput.name} needs an array, which the analyzer cannot supply.`);
    if (selectionFilePaths.length < recipe.inputs.length) {
        const checked = selectionFilePaths.length === 1 ? '1 is checked' : `${selectionFilePaths.length} are checked`;
        throw new Error(`Recipe expects ${recipe.inputs.length} file(s) from the panel selection but ${checked}.`);
    }
    return Object.fromEntries(recipe.inputs.map((input, index) => [input.name, selectionFilePaths[index]]));
}

/** A single input fed by the only checked file needs no confirmation; any other case could be assigned differently. */
export function needsAssignment(recipe: RecipeDocument, selectionFilePaths: string[]): boolean {
    return recipe.inputs.length > 1 || selectionFilePaths.length > recipe.inputs.length;
}

/** One line naming the file behind each Recipe input, e.g. `reference: a.wav · response: b.wav`. */
export function describeInputs(inputs: Record<string, string>, fileName: (filePath: string) => string): string {
    return Object.entries(inputs).map(([name, filePath]) => `${name}: ${fileName(filePath)}`).join(' · ');
}
