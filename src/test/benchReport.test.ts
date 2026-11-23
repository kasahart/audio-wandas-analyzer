import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { recipeSteps } from '../shared/recipe/recipeSteps';

import { getStrings } from '../shared/i18n/strings';
import { excludedList } from '../shared/recipe/eventExclusion';
import { reportCsv, reportDefinitions, reportFiles, reportFolderName, reportRecipe, type ReportFile, type ReportInput, type ReportRow } from '../webview/runtime/compareReport';

import { testPython } from './helpers/python';
import { withChannel } from '../shared/recipe/channelSelection';

const repoRoot = path.resolve(__dirname, '..', '..');
const entry = JSON.parse(readFileSync(path.join(repoRoot, 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;

test('the report folder is named after the Recipe and the moment it was written', () => {
    assert.equal(reportFolderName('entry-scan', new Date(2026, 9, 22, 7, 5, 9)), 'entry-scan_20261022-070509');
});

test('the report Recipe carries the region as its time slice and still loads in wandas', (t) => {
    const withRegion = reportRecipe(entry, { start: 0.5, end: 1.5 });
    const slice = recipeSteps(withRegion).find(step => step.name === 'time_slice')!;
    assert.deepEqual(slice.params, { end: 1.5, start: 0.5 });
    assert.deepEqual(recipeSteps(reportRecipe(entry, null)).find(step => step.name === 'time_slice')!.params, { end: null, start: 0 });
    const python = testPython();
    if (!python) { t.skip('no Python'); return; }
    const run = spawnSync(python.command, [...python.args, '-c', 'import json,sys; from wandas.pipeline import RecipePlan; print(len(RecipePlan.from_dict(json.load(sys.stdin)).to_dict()["nodes"]))'], { input: JSON.stringify(withRegion), encoding: 'utf8' });
    if (/No module named 'wandas'/.test(run.stderr)) { t.skip('wandas is not installed'); return; }
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), '3');
});

test('a compared channel is a get_channel step in the exported Recipe, and wandas loads it', (t) => {
    const recipe = reportRecipe(withChannel(entry, 2), { start: 0.5, end: 1.5 });
    const steps = recipeSteps(recipe);
    assert.equal(steps[0].operation, 'wandas.frame.get_channel');
    assert.deepEqual(steps[0].params, { channel_idx: 1 });
    const python = testPython();
    if (!python) { t.skip('no Python'); return; }
    const run = spawnSync(python.command, [...python.args, '-c', 'import json,sys; from wandas.pipeline import RecipePlan; print(len(RecipePlan.from_dict(json.load(sys.stdin)).to_dict()["nodes"]))'], { input: JSON.stringify(recipe), encoding: 'utf8' });
    if (/No module named 'wandas'/.test(run.stderr)) { t.skip('wandas is not installed'); return; }
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), '4');
});

const strings = getStrings('en');

/** A comparison of run2 (slot 1) and run3 channel 2 (slot 2) against the group of run1 and run4, as the entry table has them. */
function reportInput(over: Partial<ReportInput> = {}): ReportInput {
    const rows: Record<string, ReportRow> = {
        '/d/run2.wav': { label: 'run2', value: '12.5', memo: 'rattle, "loud"', channel: null, cells: ['L1', 'night'], base: { kind: 'group', group: { column: 'line', name: 'L1' }, channel: null, filters: ['shift: night'], files: ['run1.wav', 'run4.wav'] } },
        '/d/run3.wav': { label: 'run3 ch2', value: '', memo: '', channel: 2, cells: ['L1', ''], base: { kind: 'file', file: 'run1', channel: null, filters: [], files: ['run1.wav'] } },
    };
    return {
        slots: [null, '/d/run2.wav', '/d/run3.wav', null], region: { start: 0.5, end: 1.5 }, recipe: entry, recipeName: 'entry-scan', now: new Date(2026, 9, 22, 7, 5, 9),
        columns: ['line', ''], row: path => rows[path], selection: { value: 'torque', group: 'line', filters: ['shift: night'], excluded: 1 }, ...over,
    };
}

test('報告.csv has one row per compared slot, in words only: the recording, its conditions, the region, its base and its memo', () => {
    const csv = reportCsv(reportInput(), strings);
    assert.equal(csv, '﻿' + [
        'File,line,Cond. 2,Start s,End s,Base group files,ch,Shown: torque,Memo,Base definition',
        'run2,L1,night,0.50,1.50,run1.wav;run4.wav,,12.5,"rattle, ""loud""",Base group line L1 · shift: night',
        'run3 ch2,L1,,0.50,1.50,run1.wav,2,,,Base run1',
        '',
    ].join('\r\n'));
    // The whole file, nothing narrowed: the region's cells are empty and the shown value has no column.
    const whole = reportCsv(reportInput({ region: null, selection: undefined }), strings).split('\r\n');
    assert.equal(whole[0], '﻿File,line,Cond. 2,Start s,End s,Base group files,ch,Memo,Base definition');
    assert.equal(whole[1], 'run2,L1,night,,,run1.wav;run4.wav,,"rattle, ""loud""",Base group line L1 · shift: night');
});

const textOf = (file: ReportFile): string => { assert.ok('text' in file, `${file.name} is a text file`); return file.text; };

test('with no figure on show a report is of words only: its files are 報告.csv, the Recipe and 定義.json', () => {
    const { folder, files } = reportFiles(reportInput(), strings);
    assert.equal(folder, 'entry-scan_20261022-070509');
    // Slots of different channels get one Recipe each: the channels together, and channel 2.
    assert.deepEqual(files.map(file => file.name), ['report.csv', 'entry-scan.recipe.json', 'entry-scan.ch2.recipe.json', 'definitions.json']);
    assert.ok(files.every(file => 'text' in file), 'text files only: no PNG');
    const ch2 = JSON.parse(textOf(files[2])) as RecipeDocument;
    assert.equal(recipeSteps(ch2)[0].operation, 'wandas.frame.get_channel');
    assert.deepEqual(recipeSteps(ch2).find(step => step.name === 'time_slice')!.params, { end: 1.5, start: 0.5 });
    const definitions = JSON.parse(textOf(files[3])) as Record<string, unknown>;
    // 定義.json names the Recipe files written (both), not one of a fixed name.
    assert.deepEqual(definitions, JSON.parse(JSON.stringify(reportDefinitions(reportInput(), [], ['entry-scan.recipe.json', 'entry-scan.ch2.recipe.json']))));
    assert.deepEqual(Object.keys(definitions), ['region', 'recipes', 'steps', 'selection', 'comparisons']);
    assert.deepEqual(definitions['region'], { startS: 0.5, endS: 1.5 });
    assert.deepEqual((definitions['comparisons'] as Array<{ slot: number; file: string }>).map(item => [item.slot, item.file]), [[1, 'run2'], [2, 'run3 ch2']]);
});

test('the figure on show goes into the report as it was handed over: its PNG, the table of its lines, and its data id in 定義.json', () => {
    const figure = { dataId: 'd41c', png: 'iVBORw0KGgo=', table: { header: ['run2 Frequency [Hz]', 'run2 Level [dBFS]'], rows: [['100', '-12.5'], ['200', '-0.1']] } };
    const { files } = reportFiles(reportInput({ figure }), strings);
    assert.deepEqual(files.map(file => file.name), ['report.csv', 'entry-scan.recipe.json', 'entry-scan.ch2.recipe.json', 'definitions.json', 'figure.png', 'figure.csv']);
    // The bytes and the cells are the ones handed over: nothing is measured, rounded or reordered here.
    assert.deepEqual(files[4], { name: 'figure.png', base64: 'iVBORw0KGgo=' });
    assert.equal(textOf(files[5]), '\uFEFF' + ['run2 Frequency [Hz],run2 Level [dBFS]', '100,-12.5', '200,-0.1', ''].join('\r\n'));
    const definitions = JSON.parse(textOf(files[3])) as Record<string, unknown>;
    assert.deepEqual(definitions['figure'], { dataId: 'd41c', files: ['figure.png', 'figure.csv'] });
    // A figure of time signals or images only has no line to tabulate: its PNG alone.
    const pictured = reportFiles(reportInput({ figure: { ...figure, table: null } }), strings).files;
    assert.deepEqual(pictured.map(file => file.name).slice(-2), ['definitions.json', 'figure.png']);
    assert.deepEqual((JSON.parse(textOf(pictured[3])) as { figure: unknown }).figure, { dataId: 'd41c', files: ['figure.png'] });
});

test('定義.json names the Recipe files the folder holds, the step the figure shows, and the events left out of each recording', () => {
    // Slots of channel 1 and channel 2: a Recipe a channel, and none without a channel to name.
    const rows: Record<string, ReportRow> = {
        '/d/run2.wav': { label: 'run2 ch1', value: '', memo: '', channel: 1, cells: [], base: { kind: 'file', file: 'run1', channel: null, filters: [], files: ['run1.wav'] } },
        '/d/run3.wav': { label: 'run3 ch2', value: '', memo: '', channel: 2, cells: [], base: { kind: 'file', file: 'run1', channel: null, filters: [], files: ['run1.wav'] } },
    };
    const input = reportInput({ row: path => rows[path], stage: 'node-fft', excluded: [{ trigger: 'node-trigger', path: '/d/run2.wav', channel: 1, ids: [0, 3] }] });
    const { files } = reportFiles(input, strings);
    const recipes = files.map(file => file.name).filter(name => name.endsWith('.recipe.json'));
    assert.deepEqual(recipes, ['entry-scan.ch1.recipe.json', 'entry-scan.ch2.recipe.json']);
    const definitions = JSON.parse(textOf(files.find(file => file.name === 'definitions.json')!)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(definitions['recipes'] as object), recipes, 'every Recipe 定義.json names is a file of the folder');
    assert.equal(definitions['shownStep'], 'node-fft');
    assert.deepEqual(definitions['excludedEvents'], [{ step: 'node-trigger', file: 'run2.wav', path: '/d/run2.wav', channel: 1, eventIds: [0, 3] }]);
    // The events are read back from the Recipe's own keys (trigger|path#channel), a path with those marks in it too.
    assert.deepEqual(excludedList({ ...entry, awaExcludedEvents: { 'node-trigger|/d/a|b#1.wav#2': [3, 0], 'node-trigger|/d/c.wav#*': [1] } }), [
        { trigger: 'node-trigger', path: '/d/a|b#1.wav', channel: 2, ids: [0, 3] }, { trigger: 'node-trigger', path: '/d/c.wav', channel: null, ids: [1] },
    ]);
    // The input shown (no step chosen) is said as null; with nothing said of the step or no event left out, no key.
    assert.equal((reportDefinitions(reportInput({ stage: null })) as { shownStep?: unknown }).shownStep, null);
    assert.ok(!('shownStep' in reportDefinitions(reportInput())) && !('excludedEvents' in reportDefinitions(reportInput({ excluded: [] }))));
});

test('the module that writes a report makes no number: it reaches no answer, no figure and no canvas', () => {
    const source = readFileSync(path.join(repoRoot, 'src', 'webview', 'runtime', 'compareReport.ts'), 'utf8');
    const imported = [...source.matchAll(/from '([^']+)'/g)].map(match => path.basename(match[1]));
    assert.deepEqual(imported.filter(name => /answer|figure|stage|scan|pane|levels|canvas/i.test(name) && name !== 'entryScan'), []);
    assert.doesNotMatch(source, /leqDb|thirdOct|spectrumDb|toDataURL|getContext|Math\.|parseFloat|Number\(/);
});
