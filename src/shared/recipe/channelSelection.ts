/**
 * One channel of a recording, as wandas says it: a `get_channel` step at the head of the chain. A slot that
 * holds a channel row (file#ch2) is compared as that channel: its pictures are scanned with this Recipe, the
 * Recipe exported with the report has the step, and its numbers are that channel's of the per-channel results.
 */
import type { RecipeDocument } from './recipeSelection';
import type { ScanResult } from '../protocol/backendProtocol';
import { CROSS_CHANNEL, PAIRED_ON_ADD } from './recipeSteps';

export const GET_CHANNEL = 'wandas.frame.get_channel';
export const CHANNEL_NODE = 'node-channel';

interface Node { id: string; operation: string; version?: number; inputs: string[]; params?: unknown }

/**
 * The Recipe with `get_channel(ch − 1)` on its frame input; `ch` counts from 1. Another selection there is replaced.
 * `paired`: its cross-channel steps compare the recording with another (the base slot's), so one channel goes on.
 */
export function withChannel(recipe: RecipeDocument, ch: number, paired = false): RecipeDocument {
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument & { inputs: Array<{ id: string; kind?: string }>; nodes: Node[]; output: string };
    // A chain that compares two channels of the recording names its own (select_pair): one channel alone has no pair.
    if (!paired && copy.nodes.some(node => CROSS_CHANNEL.has(node.operation))) return recipe;
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

export const BASE_INPUT = 'input-base';

interface Doc { inputs: Array<{ id: string; name?: string; kind?: string }>; nodes: Node[]; output: string }

/**
 * The Recipe with its cross-channel step `stepId` measured against a second recording, as wandas runs it: a
 * `base` input goes through the same steps up to it, one channel of each is taken, `concat_frame` makes the
 * pair (the base first), and `select_pair(1, 0)` keeps the recording over the base (not after a CSD, whose
 * auto-spectra the cross-spectral steps after it need). As the scans do (scan_service.py's `reference`), so the
 * report's Recipe replays its pictures. `baseChannel` (from 1) is the base slot's row: the channel the base side
 * selects where the Recipe selects one (withChannel's); none, the base recording's first.
 */
export function withBaseInput(recipe: RecipeDocument, stepId: string, baseChannel?: number | null): RecipeDocument {
    const copy = JSON.parse(JSON.stringify(recipe)) as RecipeDocument & Doc;
    const step = copy.nodes.find(node => node.id === stepId);
    const input = copy.inputs.find(item => item.kind === 'frame')?.id ?? copy.inputs[0]?.id;
    if (!step || !input || copy.inputs.some(item => item.id === BASE_INPUT)) return recipe;
    // The steps before it, from the input: run again on the base.
    const before: Node[] = [];
    for (let id = step.inputs[0]; id !== input;) {
        const node = copy.nodes.find(item => item.id === id);
        if (!node) return recipe;
        before.unshift(node);
        id = node.inputs[0];
    }
    // The compared row's channel selection is the base row's on the base side.
    const own = before.find(node => node.id === CHANNEL_NODE);
    const renamed = (id: string): string => (id === input ? BASE_INPUT : id === CHANNEL_NODE && own && !baseChannel ? renamed(own.inputs[0]) : `${id}-base`);
    const cloned = before.filter(node => node !== own || baseChannel).map(node => ({ ...JSON.parse(JSON.stringify(node)) as Node, id: renamed(node.id), inputs: node.inputs.map(renamed) }));
    const base = cloned.find(node => node.id === `${CHANNEL_NODE}-base`);
    if (base && baseChannel) base.params = { $type: 'map', entries: [['channel_idx', baseChannel - 1]] };
    const pick = (id: string, from: string): Node => ({ id, operation: GET_CHANNEL, version: 1, inputs: [from], params: { $type: 'map', entries: [['channel_idx', 0]] } });
    const added: Node[] = [
        ...cloned,
        pick(`${stepId}-base-channel`, renamed(step.inputs[0])),
        pick(`${stepId}-channel`, step.inputs[0]),
        { id: `${stepId}-concat`, operation: 'wandas.channel.concat_frame', version: 1, inputs: [`${stepId}-base-channel`, `${stepId}-channel`],
            params: { $type: 'map', entries: [['align', 'truncate'], ['label_prefix', 'compare'], ['suffix_on_dup', '_compare']] } },
    ];
    const pair: Node | null = PAIRED_ON_ADD.has(step.operation) ? { id: `${stepId}-pair`, operation: 'wandas.frame.select_pair', version: 1, inputs: [stepId], params: { $type: 'map', entries: [['input', 0], ['output', 1]] } } : null;
    if (pair) copy.nodes.forEach(node => { node.inputs = node.inputs.map(item => (item === stepId ? pair.id : item)); });
    step.inputs = [`${stepId}-concat`, ...step.inputs.slice(1)];
    const at = copy.nodes.indexOf(step);
    copy.nodes.splice(at, 1, ...added, step, ...(pair ? [pair] : []));
    if (pair && copy.output === stepId) copy.output = pair.id;
    copy.inputs.push({ id: BASE_INPUT, name: 'base', kind: 'frame' });
    return copy;
}
