/**
 * Events left out of a trigger's: picked on the comparison, per recording (and the channel it is compared as), kept
 * beside the Recipe's nodes like the bypass so ↶ ↷ take them back. wandas does not know the key: the steps after the
 * trigger run with `wandas.segments.drop` of them, as wandas' own chain would hold it.
 */
import type { RecipeDocument } from './recipeSelection';
import { EXCLUDED_KEY, recipeChain, recipeNodes, withoutBypassed, TIME_SLICE, TRIGGER, type RecipeNode } from './recipeSteps';

export { EXCLUDED_KEY };
export const SEGMENTS_DROP = 'wandas.segments.drop';
export const DROP_NODE = 'node-excluded';

/** What the events of a recording are kept by: its path, and the channel it is compared as (`*`: all). */
export function eventsKey(path: string, ch: number | null): string {
    return `${path}#${ch ?? '*'}`;
}

/** The event IDs left out per recording. */
export function excludedEvents(recipe: RecipeDocument | null | undefined): Readonly<Record<string, readonly number[]>> {
    const value = recipe?.[EXCLUDED_KEY];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, number[]> = {};
    for (const [key, ids] of Object.entries(value as Record<string, unknown>)) {
        const list = Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id)) : [];
        if (list.length) out[key] = list;
    }
    return out;
}

/** The IDs left out of one recording's events, sorted. */
export function excludedOf(recipe: RecipeDocument | null | undefined, key: string): number[] {
    return [...(excludedEvents(recipe)[key] ?? [])].sort((a, b) => a - b);
}

/** The Recipe with event `id` of the recording `key` left out (or back in). */
export function withEventExcluded(recipe: RecipeDocument, key: string, id: number, out: boolean): RecipeDocument {
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument;
    const all: Record<string, number[]> = { ...excludedEvents(recipe) } as Record<string, number[]>;
    const ids = (all[key] ?? []).filter(item => item !== id).concat(out ? [id] : []).sort((a, b) => a - b);
    if (ids.length) all[key] = ids; else delete all[key];
    if (Object.keys(all).length) copy[EXCLUDED_KEY] = all; else delete copy[EXCLUDED_KEY];
    return copy;
}

/** The Recipe with no event left out. */
export function withoutExclusions(recipe: RecipeDocument): RecipeDocument {
    if (!(EXCLUDED_KEY in recipe)) return recipe;
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument;
    delete copy[EXCLUDED_KEY];
    return copy;
}

/** The trigger that runs (the first, not bypassed). */
export function runningTrigger(recipe: RecipeDocument | null | undefined): RecipeNode | undefined {
    return recipe ? recipeChain(withoutBypassed(recipe)).find(node => node.operation === TRIGGER) : undefined;
}

/**
 * What the events are found by: the steps that run up to the trigger and its settings, and the region where the
 * chain slices one. Another condition finds other events, so the ones left out no longer name the same.
 */
export function eventCondition(recipe: RecipeDocument | null | undefined, region: unknown): string {
    const trigger = runningTrigger(recipe);
    if (!recipe || !trigger) return '';
    const chain = recipeChain(withoutBypassed(recipe));
    const upto = chain.slice(0, chain.findIndex(node => node.id === trigger.id) + 1);
    const sliced = upto.some(node => node.operation === TIME_SLICE);
    return JSON.stringify([upto.map(node => [node.operation, node.version, node.params]), sliced ? region ?? null : null]);
}

/** Whether an edit from `before` to `after` changes what finds the events while some are left out. */
export function exclusionsLapse(before: RecipeDocument | null | undefined, beforeRegion: unknown, after: RecipeDocument, afterRegion: unknown): boolean {
    return Object.keys(excludedEvents(after)).length > 0 && eventCondition(before, beforeRegion) !== eventCondition(after, afterRegion);
}

/**
 * The run Recipe with `ids` dropped right after its trigger (wandas.segments.drop), for the steps after it that
 * take the events together (a mean, a transfer function). No IDs, or no trigger: the Recipe as it is.
 */
export function withDroppedEvents(recipe: RecipeDocument, ids: readonly number[]): RecipeDocument {
    const trigger = recipeNodes(recipe).find(node => node.operation === TRIGGER);
    if (!trigger || !ids.length) return recipe;
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument & { nodes: RecipeNode[]; output: string };
    copy.nodes = copy.nodes.filter(node => node.id !== DROP_NODE);
    copy.nodes.forEach(node => { node.inputs = node.inputs.map(item => (item === trigger.id ? DROP_NODE : item)); });
    const at = copy.nodes.findIndex(node => node.id === trigger.id);
    copy.nodes.splice(at + 1, 0, { id: DROP_NODE, operation: SEGMENTS_DROP, version: 1, inputs: [trigger.id], params: { $type: 'map', entries: [['event_ids', { $type: 'list', items: [...ids] }]] } } as RecipeNode);
    if (copy.output === trigger.id) copy.output = DROP_NODE;
    return copy;
}
