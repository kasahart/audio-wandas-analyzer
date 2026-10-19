import assert from 'node:assert/strict';
import test from 'node:test';
import { RecipeFlow, type RecipeFlowPorts } from '../shared/recipe/recipeFlow';
import { bindSelection, isRecipeDocument, type RecipeDocument } from '../shared/recipe/recipeSelection';

function recipeOf(...names: string[]): RecipeDocument {
    return {
        schema: 'wandas.recipe', version: 2,
        inputs: names.map((name, index) => ({ id: `input-${index}`, name, kind: 'frame' })),
        nodes: [], output: 'input-0',
    };
}

function ports(overrides: Partial<RecipeFlowPorts> = {}) {
    const log: string[] = [];
    const recipe = recipeOf('reference', 'response');
    const executed: Array<{ recipe: RecipeDocument; inputs: Record<string, string> }> = [];
    const flow: RecipeFlowPorts = {
        listRecipes: async () => [
            { name: 'octave.json', location: '/recipes/octave.json' },
            { name: 'coherence.recipe.json', location: '/recipes/coherence.recipe.json' },
        ],
        pickRecipe: async (items) => { log.push(`pick:${items.map(item => item.description).join('|')}`); return '/recipes/octave.json'; },
        readRecipe: async () => recipe,
        pickInputFiles: async () => { log.push('pickInputs'); return ['/picked.wav']; },
        runWithProgress: async (title, task) => { log.push(`progress:${title}`); return task(); },
        execute: async (document, inputs) => { executed.push({ recipe: document, inputs }); return { charts: [{ kind: 'scalar', title: 'Peak', rows: [] }] }; },
        showCharts: (title, charts) => { log.push(`charts:${title}:${charts.length}`); },
        showError: (message) => { log.push(`error:${message}`); },
        ...overrides,
    };
    return { flow: new RecipeFlow(flow), log, executed };
}

test('recipe flow assigns the panel selection to the Recipe inputs in order and shows charts', async () => {
    const { flow, log, executed } = ports();
    await flow.run(['/a.wav', '/b.wav', '/c.wav']);
    assert.deepEqual(executed[0].inputs, { reference: '/a.wav', response: '/b.wav' });
    assert.equal(executed[0].recipe.schema, 'wandas.recipe');
    assert.deepEqual(log, [
        'pick:/recipes/octave.json|/recipes/coherence.recipe.json',
        'progress:Running recipe octave.json…',
        'charts:octave.json:1',
    ]);
});

test('recipe flow asks for inputs only without a selection and reports too few files as an execution failure', async () => {
    const { flow, log, executed } = ports({ readRecipe: async () => recipeOf('a', 'b') });
    await flow.run([]);
    assert.equal(executed.length, 0);
    assert.ok(log.includes('pickInputs'));
    assert.match(log.at(-1)!, /^error:Recipe execution failed: Recipe expects 2 file\(s\).*but 1 are checked/);
});

test('recipe flow stops on cancel, catalog failure and missing inputs', async () => {
    const cancelled = ports({ pickRecipe: async () => undefined });
    await cancelled.flow.run(['/a.wav']);
    assert.equal(cancelled.executed.length, 0);
    const unreadable = ports({ listRecipes: async () => { throw new Error('ENOENT'); } });
    await unreadable.flow.run(['/a.wav']);
    assert.deepEqual(unreadable.log, ['error:Could not read recipes: ENOENT']);
    const noInputs = ports({ pickInputFiles: async () => undefined });
    await noInputs.flow.run();
    assert.equal(noInputs.executed.length, 0);
});

test('recipe flow suppresses results and errors after its session becomes stale', async () => {
    for (const fail of [false, true]) {
        let current = true;
        const app = ports({ execute: async () => {
            current = false;
            if (fail) throw new Error('Analysis cancelled');
            return { charts: [] };
        } });
        await app.flow.run(['/a.wav', '/b.wav'], () => current);
        assert.equal(app.log.some(entry => entry.startsWith('charts:') || entry.startsWith('error:')), false);
    }
});

test('recipe flow stops before prompting or executing when an awaited input becomes stale', async () => {
    let current = true;
    const catalog = ports({ listRecipes: async () => { current = false; return []; } });
    await catalog.flow.run(['/a.wav'], () => current);
    assert.deepEqual(catalog.log, []);
    current = true;
    const document = ports({ readRecipe: async () => { current = false; return recipeOf(); } });
    await document.flow.run(['/a.wav'], () => current);
    assert.deepEqual(document.executed, []);
    assert.equal(document.log.some(entry => entry.startsWith('error:')), false);
});

test('recipe documents must be wandas Recipes and inputs must be frames', () => {
    assert.equal(isRecipeDocument(recipeOf('a')), true);
    assert.equal(isRecipeDocument({ inputs: [{ name: 'a', file: 'x' }], steps: [] }), false);
    assert.equal(isRecipeDocument({ schema: 'wandas.recipe', inputs: [{ id: 'input-0', name: 1, kind: 'frame' }] }), false);
    assert.equal(isRecipeDocument([]), false);
    const withArray: RecipeDocument = { ...recipeOf('a'), inputs: [{ id: 'input-0', name: 'offset', kind: 'array' }] };
    assert.throws(() => bindSelection(withArray, ['/a.wav']), /offset needs an array/);
});
