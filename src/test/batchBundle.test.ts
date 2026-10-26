import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { batchBundle, batchCount, batchTargets } from '../shared/batch/batchBundle';
import { RUN_RECIPE_PY } from '../shared/batch/runRecipeScript';
import { datasetRows } from '../shared/dataset/datasetTable';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';

const repoRoot = path.resolve(__dirname, '..', '..');
const recipe = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;

test('the bundle\'s run_recipe.py is python-backend/batch/run_recipe.py (node scripts/generate-run-recipe-script.mjs copies it)', () => {
    assert.equal(RUN_RECIPE_PY, readFileSync(path.join(repoRoot, 'python-backend', 'batch', 'run_recipe.py'), 'utf8'));
});

test('a recording whose channels are all targets runs whole; one with only some runs per channel, with that channel\'s Recipe', () => {
    const attributes = new Map([['/d/L1/a.wav', { sample_id: 'S1' }], ['/d/L2/b.wav', { sample_id: 'S2' }], ['/d/m.wav', { sample_id: 'S3' }]]);
    const all = datasetRows(['/d/L1/a.wav', '/d/L2/b.wav', '/d/m.wav'], '/d', attributes, new Map(), new Map([['/d/L1/a.wav', 2], ['/d/L2/b.wav', 2], ['/d/m.wav', 1]]));
    // Filtered: a.wav both channels, b.wav ch 2 only, m.wav (mono).
    const rows = all.filter(row => row.filePath !== '/d/L2/b.wav' || row.ch === 2);
    assert.deepEqual(batchCount(rows), { recordings: 3, channels: 4 });
    assert.deepEqual(batchTargets({ rows, allRows: all, rootPath: '/d', idColumn: 'sample_id', recipeName: 'Standard' }), [
        { path: 'L1/a.wav', channel: null, recipe: 'Standard.recipe.json', id: 'S1' },
        { path: 'L2/b.wav', channel: 2, recipe: 'Standard.ch2.recipe.json', id: 'S2' },
        { path: 'm.wav', channel: null, recipe: 'Standard.recipe.json', id: 'S3' },
    ]);
    const { folder, files } = batchBundle({ recipe, recipeName: 'Standard', rows, allRows: all, rootPath: '/d', idColumn: 'sample_id', now: new Date(2026, 9, 26, 1, 2, 3) });
    assert.equal(folder, 'Standard_batch_20261026-010203');
    assert.deepEqual(files.map(file => file.name), ['Standard.recipe.json', 'Standard.ch2.recipe.json', 'targets.csv', 'run_recipe.py', 'README.txt']);
    assert.equal(JSON.parse(files[1].text).nodes[0].operation, 'wandas.frame.get_channel');
    assert.equal(files[2].text, 'path,channel,recipe,sample_id\r\nL1/a.wav,,Standard.recipe.json,S1\r\nL2/b.wav,2,Standard.ch2.recipe.json,S2\r\nm.wav,,Standard.recipe.json,S3\r\n');
    const readme = files[4].text;
    assert.ok(readme.indexOf('実行') < readme.indexOf('Run (wandas'), 'Japanese first, English under it');
    assert.match(readme, /--root "\/d"/);
});

test('a CSV id column called path, channel or recipe is written as id_<name>, so it does not hide the column run_recipe.py reads', () => {
    const attributes = new Map([['/d/a.wav', { path: '/archive/a_original.wav' }]]);
    const all = datasetRows(['/d/a.wav'], '/d', attributes, new Map(), new Map([['/d/a.wav', 1]]));
    const { files } = batchBundle({ recipe, recipeName: 'Standard', rows: all, allRows: all, rootPath: '/d', idColumn: 'path', now: new Date(2026, 9, 26) });
    assert.equal(files.find(file => file.name === 'targets.csv')?.text, 'path,channel,recipe,id_path\r\na.wav,,Standard.recipe.json,/archive/a_original.wav\r\n');
});
