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
const RESAMPLING = 'wandas.audio.resampling';
const SELECT_PAIR = 'wandas.frame.select_pair';

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
 * input-0 → [get_channel → resampling] ┐
 * input-1 → [get_channel → resampling] ┴ concat_frame → cross-channel step → [its (response, reference) pair] → …
 *   becomes   input-0 → [get_channel → resampling] → step (base slot) → …
 * The base slot plays the first input (the reference), each compared recording the second (the response). Each compared
 * recording runs the reference's side, so both sides must be the same steps with the same parameters; and the base slot
 * always gives the compared recording over the base, so a pair picked after the step must be that one.
 */
function pairedAsSlot(recipe: RecipeDocument): RecipeDocument | undefined {
    const [first, second] = recipe.inputs.map(input => input.id);
    const nodes = recipeNodes(recipe);
    const byId = new Map(nodes.map(node => [node.id, node]));
    const concat = nodes.find(node => node.operation === CONCAT && node.inputs.length === 2);
    if (!concat) return undefined;
    // A side: the steps from its input to the join, each one a channel pick or a resampling.
    const side = (id: string, input: string): RecipeNode[] | undefined => {
        const steps: RecipeNode[] = [];
        for (let at = id; at !== input;) {
            const node = byId.get(at);
            if (!node || !SIDE_STEPS.has(node.operation) || node.inputs.length !== 1 || steps.length >= SIDE_STEPS.size) return undefined;
            steps.unshift(node);
            at = node.inputs[0];
        }
        return steps;
    };
    const left = side(concat.inputs[0], first), right = side(concat.inputs[1], second);
    if (!left || !right) return undefined;
    const signature = (steps: RecipeNode[]) => JSON.stringify(steps.map(node => [node.operation, node.params]));
    if (signature(left) !== signature(right)) return undefined;
    const step = nodes.find(node => node.inputs.length === 1 && node.inputs[0] === concat.id);
    if (!step || !SLOT_REFERABLE.has(step.operation) || nodes.filter(node => node.inputs.includes(concat.id)).length !== 1) return undefined;
    // The pair picked after the step: none, or (response, reference) — as select_pair or as that pair's row.
    const pick = nodes.find(node => node.inputs.length === 1 && node.inputs[0] === step.id && PAIR_PICKS.has(node.operation));
    if (pick && !picksResponseOverReference(pick)) return undefined;
    const dropped = new Set([concat.id, ...right.map(node => node.id), ...(pick?.operation === GET_CHANNEL ? [pick.id] : [])]);
    const kept = nodes.filter(node => !dropped.has(node.id))
        .map(node => node.id === step.id ? { ...node, inputs: [left.at(-1)?.id ?? first] }
            : pick?.operation === GET_CHANNEL && node.inputs.includes(pick.id) ? { ...node, inputs: node.inputs.map(input => input === pick.id ? step.id : input) } : node);
    if (kept.some(node => node.inputs.some(input => dropped.has(input) || input === second))) return undefined;
    const output = pick?.operation === GET_CHANNEL && recipe.output === pick.id ? step.id : recipe.output;
    const single: RecipeDocument = { ...recipe, inputs: [recipe.inputs[0]], nodes: kept, output };
    return withSlotReference(single, step.id, true);
}

const SIDE_STEPS = new Set([GET_CHANNEL, RESAMPLING]);
const PAIR_PICKS = new Set([SELECT_PAIR, GET_CHANNEL]);
/** Row 2 of two channels' four pairs is (1, 0): the response over the reference (wandas' pair_row_index). */
const RESPONSE_OVER_REFERENCE_ROW = 2;

function picksResponseOverReference(node: RecipeNode): boolean {
    const params = new Map(node.params.entries);
    if (node.operation === SELECT_PAIR) return params.get('output') === 1 && params.get('input') === 0;
    const index = params.get('channel_idx');
    const rows = typeof index === 'number' ? [index]
        : index && typeof index === 'object' && Array.isArray((index as { items?: unknown }).items) ? (index as { items: unknown[] }).items : [];
    return rows.length === 1 && rows[0] === RESPONSE_OVER_REFERENCE_ROW;
}
