/**
 * Events left out of a trigger's: picked on the comparison, per recording (and the channel it is compared as), kept
 * beside the Recipe's nodes like the bypass so ↶ ↷ take them back. wandas does not know the key: the steps after the
 * trigger run with `wandas.segments.drop` of them, as wandas' own chain would hold it.
 */
import type { RecipeDocument } from './recipeSelection';
import { bypassedSteps, EXCLUDED_KEY, recipeChain, withoutBypassed, TIME_SLICE, TRIGGER, type RecipeNode } from './recipeSteps';

export { EXCLUDED_KEY };
export const SEGMENTS_DROP = 'wandas.segments.drop';
export const DROP_NODE = 'node-excluded';

/** What the events of a recording are kept by: their trigger, its path, and the channel it is compared as (`*`: all). */
export function eventsKey(trigger: string, path: string, ch: number | null): string {
    return `${trigger}|${path}#${ch ?? '*'}`;
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
    // A later trigger runs on what this one's events give: its events are others now, so its exclusions go.
    const triggers = runningTriggers(recipe).map(node => node.id);
    const later = new Set(triggers.slice(triggers.indexOf(key.split('|')[0]) + 1));
    if (triggers.includes(key.split('|')[0])) for (const other of Object.keys(all)) if (later.has(other.split('|')[0])) delete all[other];
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

/** The triggers that run (not bypassed), in the chain's order. */
export function runningTriggers(recipe: RecipeDocument | null | undefined): RecipeNode[] {
    return recipe ? recipeChain(withoutBypassed(recipe)).filter(node => node.operation === TRIGGER) : [];
}

/**
 * What the events are found by: the steps that run up to the last trigger and their settings, and the region where
 * the chain slices one (none while the region chip is bypassed: the whole file). Another condition finds other
 * events, so the ones left out no longer name the same.
 */
export function eventCondition(recipe: RecipeDocument | null | undefined, region: unknown): string {
    const last = runningTriggers(recipe).at(-1);
    if (!recipe || !last) return '';
    const chain = recipeChain(withoutBypassed(recipe));
    const upto = chain.slice(0, chain.findIndex(node => node.id === last.id) + 1);
    const slice = upto.find(node => node.operation === TIME_SLICE);
    const sliced = !!slice && !bypassedSteps(recipe).includes(slice.id);
    return JSON.stringify([upto.map(node => [node.id, node.operation, node.version, node.params]), sliced ? region ?? null : null]);
}

/** Whether an edit from `before` to `after` changes what finds the events while some are left out. */
export function exclusionsLapse(before: RecipeDocument | null | undefined, beforeRegion: unknown, after: RecipeDocument, afterRegion: unknown): boolean {
    return Object.keys(excludedEvents(after)).length > 0 && eventCondition(before, beforeRegion) !== eventCondition(after, afterRegion);
}

/** The id of the drop after trigger `trigger`. */
export const dropNode = (trigger: string): string => `${DROP_NODE}-${trigger}`;

/** Events of one trigger to drop. */
export interface EventDrop { trigger: string; ids: readonly number[] }

/**
 * The run Recipe with each drop's IDs dropped right after its trigger (wandas.segments.drop), for the steps after it
 * that take the events together (a mean, a transfer function). A drop of no IDs is left out, unless `keepEmpty`
 * (a recording paired with another at a later step: both Recipes have the same steps). The Recipe as it is without one.
 */
export function withDroppedEvents(recipe: RecipeDocument, drops: readonly EventDrop[], keepEmpty = false): RecipeDocument {
    const chain = recipeChain(recipe);
    const wanted = drops.filter(drop => (keepEmpty || drop.ids.length > 0) && chain.some(node => node.id === drop.trigger && node.operation === TRIGGER));
    if (!wanted.length) return recipe;
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument & { nodes: RecipeNode[]; output: string };
    for (const { trigger, ids } of wanted) {
        const id = dropNode(trigger);
        copy.nodes = copy.nodes.filter(node => node.id !== id);
        copy.nodes.forEach(node => { node.inputs = node.inputs.map(item => (item === trigger ? id : item)); });
        const at = copy.nodes.findIndex(node => node.id === trigger);
        copy.nodes.splice(at + 1, 0, { id, operation: SEGMENTS_DROP, version: 1, inputs: [trigger], params: { $type: 'map', entries: [['event_ids', { $type: 'list', items: [...ids] }]] } } as RecipeNode);
        if (copy.output === trigger) copy.output = id;
    }
    return copy;
}
