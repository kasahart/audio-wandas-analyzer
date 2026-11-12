import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { recipeSteps, withBypass, withParam } from '../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { INPUT_FRAME } from '../shared/recipe/recipeCatalog';
import { wholeValue } from './helpers/whole';
import { currentStepId, earlierPlaces, frameAfter, lastRunningStep, orderedSteps, removable, shownStep, startValues, stepFlow, type StepBarState } from '../webview/runtime/stepBarModel';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const state: StepBarState = { recipe: entry, sampleRate: 16000 };

test('the flow splits the chain at its time signal: the Recipe\'s steps only, no step of the app\'s beside them', () => {
    const flow = stepFlow(entry, state);
    assert.deepEqual(flow.chain.map(step => step.name), ['highpass_filter', 'time_slice']);
    assert.deepEqual(flow.tail.map(step => step.name), ['welch']);
    assert.deepEqual(orderedSteps(flow).map(step => step.id), recipeSteps(entry, 16000).map(step => step.id));
    const [hpf] = recipeSteps(entry, 16000);
    const broken = withParam(entry, hpf.id, hpf.editable[0], 9000);
    assert.deepEqual(orderedSteps(stepFlow(broken, { recipe: broken, sampleRate: 16000 })).map(step => step.name), ['highpass_filter', 'time_slice', 'welch']);
});

test('the stage on screen: the chain\'s end on the entry table, the step shown (else the last that runs) on the comparison', () => {
    const steps = recipeSteps(entry, 16000);
    assert.equal(currentStepId(entry, state, 'entry'), steps[2].id);
    assert.equal(currentStepId(entry, state, 'compare'), steps[2].id);
    assert.equal(currentStepId(entry, { ...state, stage: steps[0].id }, 'compare'), steps[0].id);
    // A bypassed last step does not run: the step before it is the chain's end.
    const bypassed = withBypass(entry, steps[2].id, true);
    assert.equal(lastRunningStep(bypassed, { recipe: bypassed, sampleRate: 16000 })?.id, steps[1].id);
    assert.equal(currentStepId(entry, { recipe: entry }, 'entry'), steps[2].id);
});

test('the places before ＋, nearest first, with the Frame there and the chip that follows', () => {
    const steps = recipeSteps(entry, 16000);
    const places = earlierPlaces(entry, state, steps[2].id);
    assert.deepEqual(places.map(place => place.after), [steps[1].id, steps[0].id, null]);
    assert.deepEqual(places.map(place => place.frame), [frameAfter(steps[1]), frameAfter(steps[0]), INPUT_FRAME]);
    // The region chip is not shown while no region is set: after the filter the next chip is welch's.
    assert.deepEqual(places.map(place => place.next?.id), [steps[2].id, steps[2].id, steps[0].id]);
    assert.equal(earlierPlaces(entry, { ...state, regionRange: { start: 0, end: 1 } }, steps[2].id)[1].next?.id, steps[1].id);
    assert.deepEqual(earlierPlaces(entry, state, null), []);
});

test('chips: the region chip shows only with a region and is not removable; a left-out step passes its input on', () => {
    const [hpf, slice, welch] = recipeSteps(entry, 16000);
    assert.equal(shownStep(slice, {}), false);
    assert.equal(shownStep(slice, { regionRange: { start: 0, end: 1 } }), true);
    assert.equal(shownStep(hpf, {}), true);
    assert.equal(removable(hpf), true);
    assert.equal(removable(slice), false);
    assert.equal(frameAfter(welch), welch.output);
    assert.equal(frameAfter({ ...welch, bypassed: true }), welch.input);
    assert.equal(frameAfter({ ...welch, invalid: 'n_fft' }), welch.input);
});

test('a new trigger starts at half the tracks\' peak, to two figures; fix_length at the files\' length', () => {
    const read = (value: number) => ({ peak: { state: 'ready' as const, value: wholeValue(value) } });
    assert.deepEqual(startValues('wandas.audio.trigger', read(0.734)), { threshold: 0.37 });
    assert.deepEqual(startValues('wandas.audio.trigger', read(12.5), 3), { threshold: 6.3 });
    // No peak known (the entry table): the step's own initial value.
    assert.deepEqual(startValues('wandas.audio.trigger', {}), {});
    // A peak still being read, or whose read failed, is no number to start from: the step's own initial value too.
    assert.deepEqual(startValues('wandas.audio.trigger', { peak: { state: 'pending' } }), {}, 'a pending peak gives no threshold');
    assert.deepEqual(startValues('wandas.audio.trigger', { peak: { state: 'failed' } }), {}, 'a failed peak gives no threshold');
    assert.deepEqual(startValues('wandas.audio.trigger', { peak: { state: 'tooMany', limit: 30 } }), {}, 'a peak not read (too many recordings) gives no threshold');
    assert.deepEqual(startValues('wandas.audio.fix_length', read(1), 2.5), { duration: 2.5 });
    assert.deepEqual(startValues('wandas.audio.highpass_filter', read(1), 2.5), {});
});
