import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { openedRecipe } from '../shared/recipe/recipeOpen';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { recipeChain, recipeNodes, slotReferenced } from '../shared/recipe/recipeSteps';

const bundled = (name: string) => JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', name), 'utf8')) as RecipeDocument;
const opened = (value: unknown): RecipeDocument => {
    const result = openedRecipe(value);
    assert.ok('recipe' in result, JSON.stringify(result));
    return result.recipe;
};

test('a one-input chain opens as it is, measured on each recording\'s region from its first step when it has no time slice', () => {
    const entry = bundled('entry-scan.recipe.json');
    assert.equal(opened(entry), entry);
    for (const name of ['octave.recipe.json', 'filter-welch.recipe.json', 'loudness.recipe.json']) {
        const recipe = bundled(name);
        const chain = recipeChain(opened(recipe));
        assert.equal(chain[0].operation, 'wandas.frame.time_slice', name);
        assert.deepEqual(chain[0].inputs, ['input-0'], name);
        assert.deepEqual(chain.slice(1).map(node => node.operation), recipeChain(recipe).map(node => node.operation), name);
        assert.equal(opened(recipe).output, recipe.output, name);
    }
});

for (const [name, operation] of [['transfer-function.recipe.json', 'wandas.audio.transfer_function'], ['coherence.recipe.json', 'wandas.audio.coherence']] as const) {
    test(`${name}: the reference and response inputs open as one chain whose ${operation.split('.').pop()} pairs with the base slot`, () => {
        const recipe = opened(bundled(name));
        assert.deepEqual(recipe.inputs.map(input => input.id), ['input-0']);
        const chain = recipeChain(recipe);
        assert.deepEqual(chain.map(node => node.operation), ['wandas.frame.time_slice', 'wandas.frame.get_channel', operation]);
        assert.deepEqual(chain[0].inputs, ['input-0']);
        assert.equal(recipe.output, chain[2].id);
        assert.deepEqual(slotReferenced(recipe), [chain[2].id]);
        assert.equal(recipeNodes(recipe).length, 3);
    });
}

test('a transfer function saved from the app (each channel resampled, its pair picked as a row) opens as one chain on the base slot', () => {
    const saved = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'savedTransfer.recipe.json'), 'utf8')) as RecipeDocument;
    const recipe = opened(saved);
    const chain = recipeChain(recipe);
    assert.deepEqual(chain.map(node => node.operation), ['wandas.frame.time_slice', 'wandas.frame.get_channel', 'wandas.audio.resampling', 'wandas.audio.transfer_function']);
    assert.equal(recipe.output, chain[3].id);
    assert.deepEqual(slotReferenced(recipe), [chain[3].id]);
});

test('what cannot be one chain on each recording says why', () => {
    assert.deepEqual(openedRecipe({ hello: 1 }), { reason: 'not-recipe' });
    const three = bundled('coherence.recipe.json');
    assert.deepEqual(openedRecipe({ ...three, inputs: [...three.inputs, { id: 'input-2', name: 'more', kind: 'frame' }] }), { reason: 'inputs' });
    // Two inputs that are not paired for a cross-channel step (here: joined, then a spectrum).
    const joined = bundled('coherence.recipe.json');
    const nodes = recipeNodes(joined).slice(0, 3).concat([{ id: 'node-3', operation: 'wandas.audio.welch', version: 1, inputs: ['node-2'], params: { $type: 'map', entries: [] } }]);
    assert.deepEqual(openedRecipe({ ...joined, nodes, output: 'node-3' }), { reason: 'pair' });
    // A reference and a response on different channels: each compared recording runs the base side's chain, so it cannot open.
    const transfer = bundled('transfer-function.recipe.json');
    const otherChannel = recipeNodes(transfer).map(node => node.id === 'node-1' ? { ...node, params: { $type: 'map', entries: [['channel_idx', 1]] } } : node);
    assert.deepEqual(openedRecipe({ ...transfer, nodes: otherChannel }), { reason: 'pair' });
    // The reference over the response: the base slot gives the other direction, so it cannot open.
    const reversed = recipeNodes(transfer).map(node => node.operation === 'wandas.frame.select_pair' ? { ...node, params: { $type: 'map', entries: [['input', 1], ['output', 0]] } } : node);
    assert.deepEqual(openedRecipe({ ...transfer, nodes: reversed }), { reason: 'pair' });
    // Two channels on each side: the comparison pairs one channel of each recording, so it cannot open.
    const both = recipeNodes(transfer).map(node => node.operation === 'wandas.frame.get_channel' ? { ...node, params: { $type: 'map', entries: [['channel_idx', { $type: 'list', items: [0, 1] }]] } } : node);
    assert.deepEqual(openedRecipe({ ...transfer, nodes: both }), { reason: 'pair' });
    // An input named as the slice would be: the slice gets another id, so no loop.
    const named = bundled('octave.recipe.json');
    const renamed = JSON.parse(JSON.stringify(named).replaceAll('"input-0"', '"node-region"')) as RecipeDocument;
    const chain = recipeChain(opened(renamed));
    assert.deepEqual(chain[0].inputs, ['node-region']);
    assert.notEqual(chain[0].id, 'node-region');
    // A node that is its own input: not a chain (and opening it must not hang).
    const loop = bundled('entry-scan.recipe.json');
    const looped = recipeNodes(loop).map(node => node.id === 'node-0' ? { ...node, inputs: ['node-0'] } : node);
    assert.deepEqual(openedRecipe({ ...loop, nodes: looped }), { reason: 'not-chain' });
    // One input, but a node off the chain.
    const entry = bundled('entry-scan.recipe.json');
    const extra = { id: 'node-x', operation: 'wandas.audio.welch', version: 1, inputs: ['input-0'], params: { $type: 'map', entries: [] } };
    assert.deepEqual(openedRecipe({ ...entry, nodes: [...recipeNodes(entry), extra] }), { reason: 'not-chain' });
});
