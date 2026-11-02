/**
 * The Compare step bar's preset recipes (generated/recipePresets.ts, wandas RecipePlans): chains to start
 * from, chosen by what the user wants to look at. Choosing one replaces the chain; after that it is edited
 * like any other. Which preset a chain is (if any) is told by its steps and their settings, not by where
 * it came from: the region's bounds and node ids do not count.
 */
import { RECIPE_PRESETS, type RecipePreset } from './generated/recipePresets';
import type { RecipeDocument } from './recipeSelection';
import { BYPASS_KEY, decodeParam, recipeChain, REFERENCE_KEY, TIME_SLICE } from './recipeSteps';

export { RECIPE_PRESETS, type RecipePreset };

/** The chain's steps and settings, in order: equal for two chains that compute the same thing on a region. */
function signature(recipe: RecipeDocument): string {
    return JSON.stringify(recipeChain(recipe).map(node => [
        node.operation,
        node.version,
        node.operation === TIME_SLICE ? [] : [...node.params.entries]
            .map(([name, value]) => [name, typeof value === 'boolean' ? value : decodeParam(value)] as const)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ]));
}

const listed = (recipe: RecipeDocument, key: string): boolean => Array.isArray(recipe[key]) && (recipe[key] as unknown[]).length > 0;

/** The preset this chain is, unchanged; undefined once a step is added, removed, set, bypassed or referenced. */
export function presetOf(recipe: RecipeDocument | null | undefined, presets: readonly RecipePreset[] = RECIPE_PRESETS): RecipePreset | undefined {
    if (!recipe || listed(recipe, BYPASS_KEY) || listed(recipe, REFERENCE_KEY)) return undefined;
    const key = signature(recipe);
    return presets.find(preset => signature(preset.recipe) === key);
}

/** A copy of the preset's Recipe to put in the bar (the generated one stays as it is). */
export function presetRecipe(preset: RecipePreset): RecipeDocument {
    return JSON.parse(JSON.stringify(preset.recipe)) as RecipeDocument;
}
