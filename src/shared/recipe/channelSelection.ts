/**
 * One channel of a recording, as wandas says it: a `get_channel` step at the head of the chain. A slot that
 * holds a channel row (file#ch2) is compared as that channel: its pictures are scanned with this Recipe, the
 * Recipe exported with the report has the step, and its numbers are that channel's of the per-channel results.
 */
import type { RecipeDocument } from './recipeSelection';
import type { ScanResult } from '../protocol/backendProtocol';
import { CROSS_CHANNEL } from './recipeSteps';

export const GET_CHANNEL = 'wandas.frame.get_channel';
export const CHANNEL_NODE = 'node-channel';

interface Node { id: string; operation: string; version?: number; inputs: string[]; params?: unknown }

/** The Recipe with `get_channel(ch − 1)` on its frame input; `ch` counts from 1. Another selection there is replaced. */
export function withChannel(recipe: RecipeDocument, ch: number): RecipeDocument {
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument & { inputs: Array<{ id: string; kind?: string }>; nodes: Node[]; output: string };
    // A chain that compares two channels of the recording names its own (select_pair): one channel alone has no pair.
    if (copy.nodes.some(node => CROSS_CHANNEL.has(node.operation))) return recipe;
    const input = copy.inputs.find(item => item.kind === 'frame')?.id ?? copy.inputs[0]?.id;
    if (!input) return recipe;
    copy.nodes = copy.nodes.filter(node => node.id !== CHANNEL_NODE);
    copy.nodes.forEach(node => { node.inputs = node.inputs.map(item => (item === CHANNEL_NODE ? input : item)); });
    copy.nodes.forEach(node => { node.inputs = node.inputs.map(item => (item === input ? CHANNEL_NODE : item)); });
    copy.nodes.unshift({ id: CHANNEL_NODE, operation: GET_CHANNEL, version: 1, inputs: [input], params: { $type: 'map', entries: [['channel_idx', ch - 1]] } });
    if (copy.output === input) copy.output = CHANNEL_NODE;
    return copy;
}

/** The channel a Recipe selects at its head (from 1), or null. */
export function channelOfRecipe(recipe: RecipeDocument): number | null {
    const node = (recipe as unknown as { nodes: Node[] }).nodes.find(item => item.id === CHANNEL_NODE && item.operation === GET_CHANNEL);
    const entries = (node?.params as { entries?: Array<[string, unknown]> } | undefined)?.entries ?? [];
    const index = entries.find(([key]) => key === 'channel_idx')?.[1];
    return typeof index === 'number' ? index + 1 : null;
}

const PER_CHANNEL = ['leqDbA', 'peakHz', 'spectrumDb', 'thirdOctDb', 'crest'] as const;

/** One channel's numbers of a result scanned over every channel; a result without that channel is not ok. */
export function channelResult(result: ScanResult | undefined, ch: number): ScanResult | undefined {
    if (!result?.ok) return result;
    const index = ch - 1;
    const count = (result.leqDbA ?? []).length;
    if (index >= count) return { ok: false, reason: `no channel ${ch} (${count} ch)` } as ScanResult;
    const picked: Record<string, unknown> = { ...result };
    for (const key of PER_CHANNEL) {
        const values = (result as unknown as Record<string, unknown[] | undefined>)[key];
        if (Array.isArray(values)) picked[key] = [values[index]];
    }
    if (result.input) picked.input = { ...result.input, channels: [result.input.channels[index] ?? index] };
    return picked as unknown as ScanResult;
}
