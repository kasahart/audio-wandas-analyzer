import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { recipeChain, recipeSteps, withBypass, withParam } from '../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { INPUT_STAGE, runnableRecipe } from '../webview/runtime/stepBarModel';
import { FULL_PLOT_WINDOW } from '../webview/runtime/plotInteraction';
import { pictureSummary } from '../webview/runtime/pictureSummary';
import type { FigureInspection } from '../webview/figure/index';
import { channelRecipe, chosenStage, comparedPath, enterStageState, holdStageSpec, initialStageState, liveRegion, openStageState, stageSpec, watchedChannel } from '../webview/runtime/trackStageModel';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const limits = { sampleRate: 16000 };
const [hpf, slice, welch] = recipeSteps(entry, 16000);

test('the step shown: the one chosen, else the chain\'s end; the step before a bypassed one', () => {
    assert.equal(chosenStage(entry, limits, null), welch.id);
    assert.equal(chosenStage(entry, limits, 'node-noct'), welch.id, 'the app\'s former 1/3-octave chip, from a saved stage: the chain\'s end');
    assert.equal(chosenStage(entry, limits, INPUT_STAGE), INPUT_STAGE);
    assert.equal(chosenStage(entry, limits, hpf.id), hpf.id);
    assert.equal(chosenStage(entry, limits, 'gone'), welch.id, 'a step no longer there: the chain\'s end');
    assert.equal(chosenStage(withBypass(entry, slice.id, true), limits, slice.id), hpf.id);
    assert.equal(chosenStage(withBypass(entry, hpf.id, true), limits, hpf.id), INPUT_STAGE);
    // A step that cannot run is shown as such, so paint can say why.
    const broken = withParam(entry, hpf.id, hpf.editable[0], 9000);
    assert.equal(chosenStage(broken, limits, hpf.id), hpf.id);
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

test('the Figure is summed up by the points its first lane draws and their median on its value axis', () => {
    const frame = { left: 0, top: 10, width: 100, height: 100 };
    const seen = (lane: object, waiting = false): FigureInspection => ({ waiting, lanes: [{ frame, range: { x: [0, 1], y: [-40, 0] }, lines: [], ...lane }] } as unknown as FigureInspection);
    // Drawn 25, 50 and 75 px down a 100 px axis from 0 to -40 dB: -10, -20 and -30 dB; a gap is no point.
    assert.deepEqual(pictureSummary(seen({ lines: [{ points: [[0, 35], null, [5, 60]] }, { points: [[9, 85]] }] })), { stageValues: 3, stageMedian: -20 });
    assert.deepEqual(pictureSummary(seen({ image: { rows: 2, columns: 3 } })), { stageValues: 6, stageMedian: null });
    assert.deepEqual(pictureSummary(seen({ lines: [{ points: [[0, 35]] }] }, true)), { stageValues: 0, stageMedian: null }, 'a picture on its way is not on the canvas');
    assert.deepEqual(pictureSummary(null), { stageValues: 0, stageMedian: null });
});

test('opening the mode keeps the step shown last, the region and the base groups allowed, and forgets the rest', () => {
    const state = initialStageState();
    Object.assign(state, { stage: 'x', compared: 3, held: 2, groupBase: true, heldStep: hpf, window: { x: { start: 0.2, end: 0.4 }, y: { start: 0, end: 1 } }, diffY: { start: 0.3, end: 0.6 }, lanesWindow: { x: { start: 0.1, end: 0.2 }, y: { start: 0.4, end: 0.5 } }, overlaid: false, pendingRegion: { start: 0, end: 1 }, regionSet: { start: 1, end: 2 }, showDiff: true });
    state.baseAllowed.add('k');
    openStageState(state, welch.id);
    assert.deepEqual({ ...state, baseAllowed: [...state.baseAllowed] }, {
        on: false, stage: welch.id, opened: true, overlaid: true, showDiff: true, window: FULL_PLOT_WINDOW, diffY: FULL_PLOT_WINDOW.y, lanesWindow: FULL_PLOT_WINDOW, compared: 1, held: null, groupBase: false,
        regionSet: { start: 1, end: 2 }, pendingRegion: null, heldStep: null, baseAllowed: ['k'], gateKey: null,
    });
    openStageState(state, undefined);
    assert.equal(state.stage, welch.id, 'opened again without a step: the step shown last');
});

test('the first opening shows the input, from either entrance; later ones the step shown last', () => {
    const fromTable = initialStageState();
    openStageState(fromTable, undefined);
    assert.equal(fromTable.stage, INPUT_STAGE);
    fromTable.stage = welch.id;
    openStageState(fromTable, undefined);
    assert.equal(fromTable.stage, welch.id);
    openStageState(fromTable, hpf.id);
    assert.equal(fromTable.stage, hpf.id, 'a step chosen on the table\'s bar opens that step');
    const fromTracks = initialStageState();
    enterStageState(fromTracks);
    assert.equal(fromTracks.stage, INPUT_STAGE);
    fromTracks.stage = welch.id;
    enterStageState(fromTracks);
    assert.equal(fromTracks.stage, welch.id);
    openStageState(fromTracks, undefined);
    assert.equal(fromTracks.stage, welch.id, 'opened from the table after the tracks: still the step shown last');
});

test('the recording drawn under a trigger\'s events is the channel the trigger watches (its index from 0), never the channels averaged; a compared channel row is its own', () => {
    const recipe = { recipe: entry, runRecipe: entry } as Parameters<typeof stageSpec>[0];
    const selected = (ch: number): unknown => {
        const nodes = (stageSpec(recipe, null, welch.id, ch).message.recipe as unknown as { nodes: Array<{ operation: string; params: { entries: Array<[string, unknown]> } }> }).nodes;
        return nodes.find(node => node.operation.endsWith('get_channel'))?.params.entries.find(([name]) => name === 'channel_idx')?.[1];
    };
    // A whole stereo recording: the trigger's channel 0 is wandas' index 0, its channel 1 index 1 (not "all channels", not the one before).
    assert.equal(selected(watchedChannel(null, 0)), 0);
    assert.equal(selected(watchedChannel(null, 1)), 1);
    // No channel parameter (a trigger of an older recipe): the first channel, as wandas takes it.
    assert.equal(selected(watchedChannel(null, undefined)), 0);
    // A channel row compared (from 1) is drawn as itself.
    assert.equal(watchedChannel(2, 0), 2);
    assert.equal(selected(watchedChannel(2, 0)), 1);
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
});

test('every scan\'s key holds its region exactly as it is sent: a region imported from a selection and one typed to 0.01 s never share a cache', () => {
    const recipe = { recipe: entry, runRecipe: runnableRecipe(entry, 16000) };
    const imported = { start: 1.2345, end: 2.5 };
    const typed = { start: 1.23, end: 2.5 };
    const specs = [
        (region: { start: number; end: number }) => stageSpec(recipe, region, welch.id),
        (region: { start: number; end: number }) => holdStageSpec(recipe, welch.id, hpf, limits, region)!,
    ];
    for (const of of specs) {
        const a = of(imported), b = of(typed);
        assert.deepEqual(a.message.region, imported);
        assert.notEqual(a.key, b.key, `${a.key} and ${b.key} ask for different samples`);
        assert.equal(of({ ...imported }).key, a.key, 'the same region is the same key');
    }
});

