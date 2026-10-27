import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { channelOfRecipe, channelResult, withBaseInput, withChannel, BASE_INPUT, CHANNEL_NODE, GET_CHANNEL } from '../shared/recipe/channelSelection';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import type { ScanResult } from '../shared/protocol/backendProtocol';

const recipe = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;

test('a channel is a get_channel step at the head of the chain, as wandas writes it; choosing again replaces it', () => {
    const ch2 = withChannel(recipe, 2) as unknown as { nodes: Array<{ id: string; operation: string; inputs: string[]; params: unknown }> };
    assert.deepEqual(ch2.nodes[0], { id: CHANNEL_NODE, operation: GET_CHANNEL, version: 1, inputs: ['input-0'], params: { $type: 'map', entries: [['channel_idx', 1]] } });
    assert.deepEqual(ch2.nodes[1].inputs, [CHANNEL_NODE]);
    assert.equal(channelOfRecipe(ch2 as unknown as RecipeDocument), 2);
    const ch1 = withChannel(ch2 as unknown as RecipeDocument, 1) as unknown as { nodes: Array<{ id: string; inputs: string[] }> };
    assert.equal(ch1.nodes.filter(node => node.id === CHANNEL_NODE).length, 1);
    assert.equal(channelOfRecipe(ch1 as unknown as RecipeDocument), 1);
    assert.equal(channelOfRecipe(recipe), null);
    // The original is untouched.
    assert.equal((recipe as unknown as { nodes: Array<{ id: string }> }).nodes[0].id, 'node-0');
});

test('one channel of a result scanned over every channel; a recording with fewer channels has none', () => {
    const result = { ok: true, input: { id: 'x', fs: 16000, channels: [0, 1], durationS: 2, unit: 'FS', ref: 1 }, leqDbA: [-30, -40], peakHz: [100, 3150], crest: [3, 4], thirdOctDb: [[1], [2]], spectrumDb: [[5], [6]], specVersion: 5 } as unknown as ScanResult;
    const ch2 = channelResult(result, 2) as unknown as Record<string, unknown>;
    assert.deepEqual([ch2.leqDbA, ch2.peakHz, ch2.crest, ch2.thirdOctDb, ch2.spectrumDb], [[-40], [3150], [4], [[2]], [[6]]]);
    assert.deepEqual((ch2.input as { channels: number[] }).channels, [1]);
    assert.equal(channelResult(result, 3)?.ok, false);
});

test('a chain that compares two channels of the recording keeps them: a channel row adds no get_channel', () => {
    const nodes = (recipe as unknown as { nodes: Array<Record<string, unknown>> }).nodes;
    const cross = { ...recipe, nodes: [...nodes, { id: 'node-9', operation: 'wandas.audio.coherence', version: 2, inputs: [String(nodes.at(-1)!.id)], params: { $type: 'map', entries: [] } }], output: 'node-9' } as unknown as RecipeDocument;
    assert.equal(withChannel(cross, 2), cross);
    assert.equal(channelOfRecipe(withChannel(cross, 2)), null);
});

test('a step measured against the base slot is written with a base input: its steps up to it again, one channel of each, concat_frame, then the recording over the base', () => {
    // entry-scan's welch as coherence: highpass → time_slice → coherence.
    const coherence = JSON.parse(JSON.stringify(recipe)) as { nodes: Array<{ id: string; operation: string; version: number; inputs: string[]; params: unknown }> };
    Object.assign(coherence.nodes[2], { operation: 'wandas.audio.coherence', version: 2, params: { $type: 'map', entries: [] } });
    const paired = withBaseInput(coherence as unknown as RecipeDocument, 'node-2') as unknown as { inputs: Array<{ id: string }>; nodes: Array<{ id: string; operation: string; inputs: string[] }>; output: string };
    assert.deepEqual(paired.inputs.map(input => input.id), ['input-0', BASE_INPUT]);
    assert.deepEqual(paired.nodes.map(node => [node.id, node.operation.split('.').pop(), node.inputs.join('+')]), [
        ['node-0', 'highpass_filter', 'input-0'],
        ['node-1', 'time_slice', 'node-0'],
        ['node-0-base', 'highpass_filter', BASE_INPUT],
        ['node-1-base', 'time_slice', 'node-0-base'],
        ['node-2-base-channel', 'get_channel', 'node-1-base'],
        ['node-2-channel', 'get_channel', 'node-1'],
        ['node-2-concat', 'concat_frame', 'node-2-base-channel+node-2-channel'],
        ['node-2', 'coherence', 'node-2-concat'],
        ['node-2-pair', 'select_pair', 'node-2'],
    ]);
    assert.equal(paired.output, 'node-2-pair');
    // Once is enough: a Recipe with a base input is left as it is.
    assert.equal(withBaseInput(paired as unknown as RecipeDocument, 'node-2'), paired);
    // A compared ch2 row against a base ch1 row: each side selects its own channel; a base with no row, its first.
    const rows = (doc: RecipeDocument): Array<[string, unknown]> => (doc as unknown as { nodes: Array<{ id: string; inputs: string[]; params?: { entries: Array<[string, unknown]> } }> }).nodes
        .filter(node => node.id.startsWith(CHANNEL_NODE)).map(node => [node.id, node.params?.entries[0]?.[1]]);
    const ch2 = withChannel(coherence as unknown as RecipeDocument, 2, true);
    assert.deepEqual(rows(withBaseInput(ch2, 'node-2', { channel: 1 })), [[CHANNEL_NODE, 1], [`${CHANNEL_NODE}-base`, 0]]);
    const noRow = withBaseInput(ch2, 'node-2') as unknown as { nodes: Array<{ id: string; inputs: string[] }> };
    assert.deepEqual(rows(noRow as unknown as RecipeDocument), [[CHANNEL_NODE, 1]]);
    assert.deepEqual(noRow.nodes.find(node => node.id === 'node-0-base')!.inputs, [BASE_INPUT]);
    // A one-channel compared recording (no channel selection) against a base ch2 row: the base still gives its ch2.
    const monoVsCh2 = withBaseInput(coherence as unknown as RecipeDocument, 'node-2', { channel: 2 }) as unknown as { nodes: Array<{ id: string; inputs: string[] }> };
    assert.deepEqual(rows(monoVsCh2 as unknown as RecipeDocument), [[`${CHANNEL_NODE}-base`, 1]]);
    assert.deepEqual(monoVsCh2.nodes.find(node => node.id === `${CHANNEL_NODE}-base`)!.inputs, [BASE_INPUT]);
    assert.deepEqual(monoVsCh2.nodes.find(node => node.id === 'node-0-base')!.inputs, [`${CHANNEL_NODE}-base`]);
    // A base shorter than the compared file: its slice ends within its own length.
    const slices = (doc: RecipeDocument): unknown[] => (doc as unknown as { nodes: Array<{ id: string; params?: { entries: Array<[string, unknown]> } }> }).nodes
        .filter(node => node.id.startsWith('node-1')).map(node => node.params?.entries.find(([name]) => name === 'end')?.[1]);
    const sliced = JSON.parse(JSON.stringify(coherence)) as { nodes: Array<{ id: string; params: { entries: Array<[string, unknown]> } }> };
    sliced.nodes.find(node => node.id === 'node-1')!.params.entries = [['end', 3.85], ['start', 0.15]];
    const shortBase = withBaseInput(sliced as unknown as RecipeDocument, 'node-2', { endS: 1.85 });
    assert.deepEqual(slices(shortBase), [3.85, 1.85]);
    // …with its keys in wandas' canonical (sorted) order.
    const baseSlice = (shortBase as unknown as { nodes: Array<{ id: string; params: { entries: Array<[string, unknown]> } }> }).nodes.find(node => node.id === 'node-1-base')!;
    assert.deepEqual(baseSlice.params.entries.map(([name]) => name), ['end', 'start']);
    assert.deepEqual(slices(withBaseInput(sliced as unknown as RecipeDocument, 'node-2', { endS: 9 })), [3.85, 3.85]);
    // A CSD keeps its auto-spectra (the cross-spectral steps after it need them): no pair after it.
    Object.assign(coherence.nodes[2], { operation: 'wandas.audio.csd' });
    const csd = withBaseInput(coherence as unknown as RecipeDocument, 'node-2') as unknown as { nodes: Array<{ operation: string }>; output: string };
    assert.equal(csd.nodes.some(node => node.operation.endsWith('select_pair')), false);
    assert.equal(csd.output, 'node-2');
});
