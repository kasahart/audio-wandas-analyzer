import assert from 'node:assert/strict';
import test from 'node:test';
import { RecipeFlow, type RecipeFlowPorts } from '../shared/recipe/recipeFlow';
import { isRecipeDocument, substituteSelection, type RecipeDocument } from '../shared/recipe/recipeSelection';

function ports(overrides: Partial<RecipeFlowPorts> = {}) {
    const log: string[] = [];
    const recipe: RecipeDocument = {
        inputs: [{ name: 'sig', file: '{{selection}}' }, { name: 'ref', file: 'ref.wav' }],
        steps: [{ as: 'w', expr: 'sig.welch()' }],
        display: ['w'],
    };
    const executed: RecipeDocument[] = [];
    const flow: RecipeFlowPorts = {
        listRecipes: async () => [
            { name: 'octave.json', location: '/recipes/octave.json' },
            { name: 'loudness.json', location: '/recipes/loudness.json', missing: ['mosqito'] },
        ],
        pickRecipe: async (items) => { log.push(`pick:${items.map(item => item.description).join('|')}`); return '/recipes/octave.json'; },
        readRecipe: async () => recipe,
        pickInputFiles: async () => { log.push('pickInputs'); return ['/picked.wav']; },
        resolveRelative: (file, location) => `${location.replace(/[^/]+$/, '')}${file}`,
        runWithProgress: async (title, task) => { log.push(`progress:${title}`); return task(); },
        execute: async (resolved) => { executed.push(resolved); return { charts: [{ kind: 'scalar', title: 'Peak', rows: [] }] }; },
        showCharts: (title, charts) => { log.push(`charts:${title}:${charts.length}`); },
        showError: (message) => { log.push(`error:${message}`); },
        ...overrides,
    };
    return { flow: new RecipeFlow(flow), log, executed };
}

test('recipe flow fills the panel selection, resolves relative inputs against the recipe and shows charts', async () => {
    const { flow, log, executed } = ports();
    await flow.run(['/a.wav']);
    assert.deepEqual(executed[0].inputs, [{ name: 'sig', file: '/a.wav' }, { name: 'ref', file: '/recipes/ref.wav' }]);
    assert.deepEqual(log, [
        'pick:/recipes/octave.json|/recipes/loudness.json (needs mosqito)',
        'progress:Running recipe octave.json…',
        'charts:octave.json:1',
    ]);
});

test('recipe flow asks for inputs only without a selection and reports too few files as an execution failure', async () => {
    const { flow, log, executed } = ports({ readRecipe: async () => ({ inputs: [{ name: 'a', file: '{{selection}}' }, { name: 'b', file: '{{selection}}' }] }) });
    await flow.run([]);
    assert.equal(executed.length, 0);
    assert.ok(log.includes('pickInputs'));
    assert.match(log.at(-1)!, /^error:Recipe execution failed: Recipe expects 2 file\(s\).*but 1 are checked/);
});

test('recipe flow stops on cancel, catalog failure and recipes the runtime cannot run', async () => {
    const cancelled = ports({ pickRecipe: async () => undefined });
    await cancelled.flow.run(['/a.wav']);
    assert.equal(cancelled.executed.length, 0);
    const unreadable = ports({ listRecipes: async () => { throw new Error('ENOENT'); } });
    await unreadable.flow.run(['/a.wav']);
    assert.deepEqual(unreadable.log, ['error:Could not read recipes: ENOENT']);
    const missing = ports({ pickRecipe: async () => '/recipes/loudness.json' });
    await missing.flow.run(['/a.wav']);
    assert.equal(missing.executed.length, 0);
    assert.match(missing.log.at(-1)!, /^error:Recipe loudness.json needs mosqito/);
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
        await app.flow.run(['/a.wav'], () => current);
        assert.equal(app.log.some(entry => entry.startsWith('charts:') || entry.startsWith('error:')), false);
    }
});

test('recipe flow stops before prompting or executing when an awaited input becomes stale', async () => {
    let current = true;
    const catalog = ports({ listRecipes: async () => { current = false; return []; } });
    await catalog.flow.run(['/a.wav'], () => current);
    assert.deepEqual(catalog.log, []);
    current = true;
    const document = ports({ readRecipe: async () => { current = false; return { inputs: [] }; } });
    await document.flow.run(['/a.wav'], () => current);
    assert.deepEqual(document.executed, []);
    assert.equal(document.log.some(entry => entry.startsWith('error:')), false);
});

test('recipe documents keep unknown keys, reject malformed inputs and leave absolute files alone', () => {
    assert.equal(isRecipeDocument({ inputs: [{ name: 'a', file: 'x' }], requires: ['mosqito'], steps: [] }), true);
    assert.equal(isRecipeDocument({ inputs: [{ name: 1, file: 'x' }] }), false);
    assert.equal(isRecipeDocument({ requires: 'mosqito' }), false);
    assert.equal(isRecipeDocument([]), false);
    const resolved = substituteSelection(
        { inputs: [{ name: 'a', file: '/abs.wav' }, { name: 'b', file: 'C:\\win.wav' }, { name: 'c', file: 'rel.wav' }], extra: true },
        [], file => `/base/${file}`,
    );
    assert.deepEqual(resolved, { inputs: [{ name: 'a', file: '/abs.wav' }, { name: 'b', file: 'C:\\win.wav' }, { name: 'c', file: '/base/rel.wav' }], extra: true });
});
