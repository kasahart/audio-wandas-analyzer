export interface RecipeInput {
    name: string;
    file: string;
}

/** A wandas recipe document as stored in python-backend/recipes/*.json. */
export interface RecipeDocument {
    inputs?: RecipeInput[];
    steps?: unknown;
    display?: unknown;
    /** Python distributions the steps need beyond the base runtime, e.g. ["mosqito"]. */
    requires?: string[];
    [key: string]: unknown;
}

export const SELECTION_PLACEHOLDER = '{{selection}}';

export function isRecipeDocument(value: unknown): value is RecipeDocument {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const recipe = value as Record<string, unknown>;
    const inputs = recipe['inputs'];
    if (inputs !== undefined && !(Array.isArray(inputs) && inputs.every(input => !!input && typeof input === 'object'
        && typeof (input as RecipeInput).name === 'string' && typeof (input as RecipeInput).file === 'string'))) return false;
    const requires = recipe['requires'];
    return requires === undefined || (Array.isArray(requires) && requires.every(item => typeof item === 'string'));
}

export function selectionSlotCount(recipe: RecipeDocument): number {
    return (recipe.inputs ?? []).filter(input => input.file === SELECTION_PLACEHOLDER).length;
}

/**
 * Fill `{{selection}}` inputs with the panel selection in order and resolve the
 * remaining relative files through the host (recipe directory on disk; the Web
 * host has no recipe directory and rejects them).
 */
export function substituteSelection(
    recipe: RecipeDocument,
    selectionFilePaths: string[],
    resolveRelative: (file: string) => string,
): RecipeDocument {
    const inputs = recipe.inputs ?? [];
    let cursor = 0;
    const resolved = inputs.map(input => {
        if (input.file === SELECTION_PLACEHOLDER) {
            const filePath = selectionFilePaths[cursor++];
            if (!filePath) {
                throw new Error(
                    `Recipe expects ${selectionSlotCount(recipe)} file(s) from the panel selection but ${selectionFilePaths.length} are checked.`,
                );
            }
            return { ...input, file: filePath };
        }
        return isAbsolutePath(input.file) ? input : { ...input, file: resolveRelative(input.file) };
    });
    return { ...recipe, inputs: resolved };
}

function isAbsolutePath(file: string): boolean {
    return file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file) || file.startsWith('\\\\');
}
