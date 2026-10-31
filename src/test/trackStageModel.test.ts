import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { recipeChain, recipeSteps, withBypass, withParam } from '../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import type { StageView } from '../shared/protocol/backendProtocol';
import { INPUT_STAGE, OCTAVE_BRANCH, runnableRecipe } from '../webview/runtime/stepBarModel';
import { FULL_PLOT_WINDOW } from '../webview/runtime/plotInteraction';
import { channelRecipe, chosenStage, comparedPath, holdStageSpec, initialStageState, liveRegion, openStageState, pictureSummary, plotsOf, regionStageSpec, stageSpec, tableBaseView } from '../webview/runtime/trackStageModel';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const limits = { sampleRate: 16000 };
const [hpf, slice, welch] = recipeSteps(entry, 16000);
const line = (values: Array<number | null>, xs = values.map((_, index) => 100 * (index + 1))): StageView => ({ kind: 'line', x: 'frequency', quantity: 'level', xs, values } as StageView);

test('the step shown: the 1/3-octave branch of a spectral chain unless another is chosen, the step before a bypassed one', () => {
    assert.equal(chosenStage(entry, limits, null), OCTAVE_BRANCH);
    assert.equal(chosenStage(entry, limits, OCTAVE_BRANCH), OCTAVE_BRANCH);
    assert.equal(chosenStage(entry, limits, INPUT_STAGE), INPUT_STAGE);
    assert.equal(chosenStage(entry, limits, hpf.id), hpf.id);
    assert.equal(chosenStage(entry, limits, 'gone'), welch.id, 'a step no longer there: the chain\'s end');
    assert.equal(chosenStage(withBypass(entry, slice.id, true), limits, slice.id), hpf.id);
    assert.equal(chosenStage(withBypass(entry, hpf.id, true), limits, hpf.id), INPUT_STAGE);
    // A step that cannot run is shown as such, so paint can say why.
    const broken = withParam(entry, hpf.id, hpf.editable[0], 9000);
    assert.equal(chosenStage(broken, limits, hpf.id), hpf.id);
    assert.equal(chosenStage(broken, limits, null), OCTAVE_BRANCH);
});

test('the compared file: the slot held, else the one tapped, else the first slot among the tracks', () => {
    const slots = ['base', 'one', 'two', null];
    assert.equal(comparedPath(slots, ['base', 'one', 'two'], null, 1), 'one');
    assert.equal(comparedPath(slots, ['base', 'one', 'two'], 2, 1), 'two');
    assert.equal(comparedPath(slots, ['base', 'two'], null, 1), 'two', 'slot 1 not on the tracks');
    assert.equal(comparedPath(slots, ['base', 'one'], 3, 1), 'one', 'an empty slot held');
    assert.equal(comparedPath(slots, ['base'], null, 1), null);
});

test('the region compared is the chip\'s unless it is bypassed', () => {
    const region = { start: 0.5, end: 1 };
    assert.deepEqual(liveRegion(entry, region), region);
    assert.equal(liveRegion(withBypass(entry, slice.id, true), region), null);
    assert.equal(liveRegion(undefined, null), null);
});

test('a scan\'s key names its Recipe, region and step; one channel adds a get_channel step', () => {
    const recipe = { recipe: entry, runRecipe: runnableRecipe(entry, 16000) };
    const spec = stageSpec(recipe, null, welch.id);
    assert.match(spec.key, new RegExp(`^stage\\|.*\\|.*\\|${welch.id}$`));
    assert.equal(spec.message.stage, welch.id);
    assert.equal(spec.message.region, undefined);
    const over = stageSpec(recipe, { start: 0.5, end: 1 }, welch.id);
    assert.notEqual(over.key, spec.key);
    assert.deepEqual(over.message.region, { start: 0.5, end: 1 });
    const two = stageSpec(recipe, null, welch.id, 2);
    assert.notEqual(two.key, spec.key);
    assert.ok(recipeChain(two.message.recipe as RecipeDocument).some(node => node.operation === 'wandas.frame.get_channel'));
    assert.equal(channelRecipe(entry, null, entry), entry);
    assert.equal(channelRecipe(undefined, 2, undefined), undefined);
    assert.deepEqual(stageSpec(null, null, welch.id).message, { stage: welch.id });
    assert.equal(regionStageSpec(recipe, { start: 0, end: 1 }).message.stage, undefined);
    assert.match(regionStageSpec(recipe, null).key, /^region\|/);
});

test('holding a step scans the chain without it, on the step before it when it is the one shown', () => {
    const recipe = { recipe: entry, runRecipe: runnableRecipe(entry, 16000) };
    const held = holdStageSpec(recipe, welch.id, hpf, limits, null);
    assert.equal(held?.message.stage, welch.id);
    assert.ok(!recipeChain(held.message.recipe as RecipeDocument).some(node => node.id === hpf.id));
    assert.equal(holdStageSpec(recipe, welch.id, welch, limits, null)?.message.stage, slice.id);
    assert.equal(holdStageSpec(recipe, hpf.id, hpf, limits, null), undefined, 'nothing before the first step');
    assert.equal(holdStageSpec(recipe, welch.id, slice, limits, null), undefined, 'the region chip is not held');
    assert.equal(holdStageSpec(null, welch.id, hpf, limits, null), undefined);
    assert.equal(holdStageSpec(recipe, null, hpf, limits, null), undefined);
    const channel = holdStageSpec(recipe, welch.id, hpf, limits, null, 2);
    assert.ok(recipeChain(channel?.message.recipe as RecipeDocument).some(node => node.operation === 'wandas.frame.get_channel'));
});

test('the base is the median of its files once all are in; the compared file\'s difference is against it', () => {
    const views: Record<string, StageView | null | undefined> = { a: line([-10, -20]), b: line([-30, -40]), c: line([-20, -20]) };
    const tracks = ['a', 'b', 'c', 'd'].map(filePath => ({ filePath }));
    const plots = plotsOf(path => views[path], tracks, 'c', ['a', 'b']);
    assert.deepEqual(plots.base?.values, [-20, -30]);
    assert.deepEqual(plots.compare?.values, [-20, -20]);
    assert.deepEqual(plots.diff?.values, [0, 10]);
    assert.deepEqual(plots.others.map(item => [item.track.filePath, item.view]), [['d', null]]);
    const fallback = line([0, 0]);
    assert.equal(plotsOf(path => (path === 'b' ? undefined : views[path]), tracks, 'c', ['a', 'b'], fallback).base, fallback, 'a base file not in yet');
    assert.equal(plotsOf(path => views[path], tracks, 'a', ['a', 'b']).diff, null, 'a file is not compared with a base it is in');
});

test('a gated base group\'s levels come from the table on the compared file\'s bands', () => {
    const compare = line([-10, -20, -30], [100, 125, 160]);
    const base = tableBaseView(compare, { centers: [100, 160, 1000], values: [-15, -35, -50] });
    assert.deepEqual(base?.values, [-15, null, -35]);
    assert.equal(base?.waveform, undefined);
    assert.equal(tableBaseView(compare, null), null);
    assert.equal(tableBaseView(null, { centers: [100], values: [0] }), null);
});

test('a picture is summed up by its points with a level and their median', () => {
    assert.deepEqual(pictureSummary(line([-300, -20, -10, -30])), { stageValues: 3, stageMedian: -20 });
    assert.deepEqual(pictureSummary({ kind: 'heatmap', matrix: [[-1, null], [-3, -2]] } as StageView), { stageValues: 3, stageMedian: -2 });
    assert.deepEqual(pictureSummary(undefined), { stageValues: 0, stageMedian: null });
});

test('opening the mode forgets what it showed but keeps the region and the base groups allowed', () => {
    const state = initialStageState();
    Object.assign(state, { stage: 'x', compared: 3, held: 2, groupBase: true, heldStep: hpf, window: { x: { start: 0.2, end: 0.4 }, y: { start: 0, end: 1 } }, overlaid: false, pendingRegion: { start: 0, end: 1 }, regionSet: { start: 1, end: 2 }, showDiff: true });
    state.baseAllowed.add('k');
    openStageState(state, welch.id);
    assert.deepEqual({ ...state, baseAllowed: [...state.baseAllowed] }, {
        on: false, stage: welch.id, overlaid: true, showDiff: true, window: FULL_PLOT_WINDOW, compared: 1, held: null, groupBase: false,
        regionSet: { start: 1, end: 2 }, pendingRegion: null, heldStep: null, baseAllowed: ['k'], gateKey: null,
    });
    openStageState(state, undefined);
    assert.equal(state.stage, null);
});
