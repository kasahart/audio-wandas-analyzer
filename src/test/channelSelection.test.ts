import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { channelOfRecipe, channelResult, withChannel, CHANNEL_NODE, GET_CHANNEL } from '../shared/recipe/channelSelection';
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
