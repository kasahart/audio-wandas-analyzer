/**
 * A Recipe file opened into the Compare step bar. The step bar runs one chain on each compared recording; a Recipe
 * that pairs two inputs for a cross-channel step (the reference's channel and the response's, joined, then the
 * step) opens as that chain with the step referenced to the base slot, which is how the comparison pairs two
 * recordings. Anything else with more than one input, or that is not one chain, cannot open and says why.
 */
import { isRecipeDocument, type RecipeDocument } from './recipeSelection';
import { isRecipeChain, recipeChain, recipeNodes, SLOT_REFERABLE, withSlotReference, type RecipeNode } from './recipeSteps';

const GET_CHANNEL = 'wandas.frame.get_channel';
const CONCAT = 'wandas.channel.concat_frame';

export type OpenedRecipe = { recipe: RecipeDocument } | { reason: 'not-recipe' | 'not-chain' | 'inputs' };

export function openedRecipe(value: unknown): OpenedRecipe {
    if (!isRecipeDocument(value) || !isRecipeChain(value)) return { reason: 'not-recipe' };
    const recipe = value.inputs.length === 2 ? pairedAsSlot(value) : value.inputs.length === 1 ? value : undefined;
    if (!recipe) return { reason: 'inputs' };
    const chain = recipeChain(recipe);
    // One chain from the input to the output, every node on it.
    const one = chain.length === recipeNodes(recipe).length && chain.length > 0
        && chain[0].inputs.length === 1 && chain[0].inputs[0] === recipe.inputs[0].id
        && chain.every((node, index) => index === 0 || (node.inputs.length === 1 && node.inputs[0] === chain[index - 1].id));
    return one ? { recipe } : { reason: 'not-chain' };
}

/**
 * input-0 → [get_channel] ┐
 * input-1 → [get_channel] ┴ concat_frame → cross-channel step → …   becomes   input-0 → [get_channel] → step (base slot) → …
 * The base slot plays the first input (the reference), each compared recording the second (the response).
 */
function pairedAsSlot(recipe: RecipeDocument): RecipeDocument | undefined {
    const [first, second] = recipe.inputs.map(input => input.id);
    const nodes = recipeNodes(recipe);
    const byId = new Map(nodes.map(node => [node.id, node]));
    const concat = nodes.find(node => node.operation === CONCAT && node.inputs.length === 2);
    if (!concat) return undefined;
    // Each side is the input itself or one get_channel of it.
    const side = (id: string, input: string): RecipeNode | null | undefined => {
        if (id === input) return null;
        const node = byId.get(id);
        return node && node.operation === GET_CHANNEL && node.inputs.length === 1 && node.inputs[0] === input ? node : undefined;
    };
    const left = side(concat.inputs[0], first), right = side(concat.inputs[1], second);
    if (left === undefined || right === undefined) return undefined;
    const step = nodes.find(node => node.inputs.length === 1 && node.inputs[0] === concat.id);
    if (!step || !SLOT_REFERABLE.has(step.operation) || nodes.filter(node => node.inputs.includes(concat.id)).length !== 1) return undefined;
    const dropped = new Set([concat.id, ...(right ? [right.id] : [])]);
    const kept = nodes.filter(node => !dropped.has(node.id))
        .map(node => node.id === step.id ? { ...node, inputs: [left ? left.id : first] } : node);
    if (kept.some(node => node.inputs.some(input => dropped.has(input) || input === second))) return undefined;
    const single: RecipeDocument = { ...recipe, inputs: [recipe.inputs[0]], nodes: kept };
    return withSlotReference(single, step.id, true);
}
