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

test('a one-input chain opens as it is', () => {
    for (const name of ['entry-scan.recipe.json', 'octave.recipe.json', 'filter-welch.recipe.json', 'loudness.recipe.json']) {
        const recipe = bundled(name);
        assert.equal(opened(recipe), recipe, name);
    }
});

for (const [name, operation] of [['transfer-function.recipe.json', 'wandas.audio.transfer_function'], ['coherence.recipe.json', 'wandas.audio.coherence']] as const) {
    test(`${name}: the reference and response inputs open as one chain whose ${operation.split('.').pop()} pairs with the base slot`, () => {
        const recipe = opened(bundled(name));
        assert.deepEqual(recipe.inputs.map(input => input.id), ['input-0']);
        const chain = recipeChain(recipe);
        assert.deepEqual(chain.map(node => node.operation), ['wandas.frame.get_channel', operation]);
        assert.deepEqual(chain[0].inputs, ['input-0']);
        assert.equal(recipe.output, chain[1].id);
        assert.deepEqual(slotReferenced(recipe), [chain[1].id]);
        assert.equal(recipeNodes(recipe).length, 2);
    });
}

test('what cannot be one chain on each recording says why', () => {
    assert.deepEqual(openedRecipe({ hello: 1 }), { reason: 'not-recipe' });
    const three = bundled('coherence.recipe.json');
    assert.deepEqual(openedRecipe({ ...three, inputs: [...three.inputs, { id: 'input-2', name: 'more', kind: 'frame' }] }), { reason: 'inputs' });
    // Two inputs that are not paired for a cross-channel step (here: joined, then a spectrum).
    const joined = bundled('coherence.recipe.json');
    const nodes = recipeNodes(joined).slice(0, 3).concat([{ id: 'node-3', operation: 'wandas.audio.welch', version: 1, inputs: ['node-2'], params: { $type: 'map', entries: [] } }]);
    assert.deepEqual(openedRecipe({ ...joined, nodes, output: 'node-3' }), { reason: 'inputs' });
    // One input, but a node off the chain.
    const entry = bundled('entry-scan.recipe.json');
    const extra = { id: 'node-x', operation: 'wandas.audio.welch', version: 1, inputs: ['input-0'], params: { $type: 'map', entries: [] } };
    assert.deepEqual(openedRecipe({ ...entry, nodes: [...recipeNodes(entry), extra] }), { reason: 'not-chain' });
});
