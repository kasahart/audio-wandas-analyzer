import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { recipeChain, STEP_PARAMS, TIME_SLICE, TRIGGER, withBypass, withoutBypassed, withoutSteps, withParam, withStep } from '../shared/recipe/recipeSteps';
import { catalogOperation } from '../shared/recipe/recipeCatalog';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { dropNode, EXCLUDED_KEY, eventCondition, eventsKey, excludedOf, exclusionsLapse, withDroppedEvents, withEventExcluded } from '../shared/recipe/eventExclusion';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
// highpass → time_slice → trigger → average: the chain the step bar builds with ＋.
const triggered = withStep(withoutSteps(entry, ['node-2']), 'node-1', catalogOperation(TRIGGER)!);
const chain = withStep(triggered.recipe, triggered.id, catalogOperation('wandas.segments.average')!).recipe;
const trigger = triggered.id;
const key = eventsKey(trigger, '/data/a.wav', 2);

test('events left out are kept per trigger, recording and channel beside the nodes, and wandas never sees the key', () => {
    let recipe = withEventExcluded(chain, key, 3, true);
    recipe = withEventExcluded(recipe, key, 1, true);
    recipe = withEventExcluded(recipe, eventsKey(trigger, '/data/b.wav', null), 0, true);
    assert.deepEqual(excludedOf(recipe, key), [1, 3]);
    assert.deepEqual(excludedOf(recipe, eventsKey(trigger, '/data/a.wav', 1)), []);
    assert.deepEqual(excludedOf(recipe, eventsKey('node-9', '/data/a.wav', 2)), []);
    // Put back, the recording's list goes; the last one put back takes the key along.
    recipe = withEventExcluded(withEventExcluded(recipe, key, 1, false), key, 3, false);
    assert.deepEqual(Object.keys(recipe[EXCLUDED_KEY] as object), [eventsKey(trigger, '/data/b.wav', null)]);
    assert.equal(EXCLUDED_KEY in withEventExcluded(recipe, eventsKey(trigger, '/data/b.wav', null), 0, false), false);
    assert.equal(EXCLUDED_KEY in withoutBypassed(withEventExcluded(chain, key, 3, true)), false);
});

test('the steps after a trigger run without its events left out: wandas.segments.drop right after that trigger', () => {
    const dropped = withDroppedEvents(chain, [{ trigger, ids: [1, 3] }]);
    assert.deepEqual(recipeChain(dropped).map(node => node.operation.split('.').pop()), ['highpass_filter', 'time_slice', 'trigger', 'drop', 'average']);
    const drop = recipeChain(dropped).find(node => node.id === dropNode(trigger))!;
    assert.deepEqual(drop.params.entries, [['event_ids', { $type: 'list', items: [1, 3] }]]);
    // Nothing left out, no such trigger, or no trigger: the Recipe as it is; a recording paired later keeps an empty drop.
    assert.equal(withDroppedEvents(chain, [{ trigger, ids: [] }]), chain);
    assert.equal(withDroppedEvents(chain, [{ trigger: 'node-0', ids: [1] }]), chain);
    assert.equal(withDroppedEvents(entry, [{ trigger, ids: [1] }]), entry);
    assert.ok(recipeChain(withDroppedEvents(chain, [{ trigger, ids: [] }], true)).some(node => node.id === dropNode(trigger)));
    // A trigger at the chain's end is the drop's input, and the drop is the output.
    assert.equal(withDroppedEvents(triggered.recipe, [{ trigger, ids: [0] }]).output, dropNode(trigger));
    // Two triggers: each one's drop goes after it.
    const second = withStep(chain, recipeChain(chain).at(-1)!.id, catalogOperation(TRIGGER)!).recipe;
    const triggers = recipeChain(second).filter(node => node.operation === TRIGGER).map(node => node.id);
    assert.equal(triggers.length, 2);
    const both = recipeChain(withDroppedEvents(second, triggers.map((id, at) => ({ trigger: id, ids: [at] }))));
    for (const id of triggers) assert.equal(both[both.findIndex(node => node.id === id) + 1].id, dropNode(id));
});

test('another trigger level, another step before it, another region or the region bypassed brings the events left out back; a step after it does not', () => {
    const out = withEventExcluded(chain, key, 3, true);
    const region = { start: 0, end: 1 };
    const threshold = STEP_PARAMS[TRIGGER].find(param => param.name === 'threshold')!;
    assert.equal(exclusionsLapse(out, region, withParam(out, trigger, threshold, 0.3), region), true);
    assert.equal(exclusionsLapse(out, region, withBypass(out, 'node-0', true), region), true);
    assert.equal(exclusionsLapse(out, region, out, { start: 0, end: 2 }), true);
    const slice = recipeChain(out).find(node => node.operation === TIME_SLICE)!.id;
    const bypassed = withBypass(out, slice, true);
    assert.equal(exclusionsLapse(out, region, bypassed, region), true);
    assert.equal(exclusionsLapse(bypassed, region, withBypass(bypassed, slice, false), region), true);
    const after = recipeChain(out).at(-1)!.id;
    assert.equal(exclusionsLapse(out, region, withoutSteps(out, [after]), region), false);
    // Nothing left out: nothing comes back.
    assert.equal(exclusionsLapse(chain, region, withParam(chain, trigger, threshold, 0.3), region), false);
    assert.equal(eventCondition(entry, region), '');
});
