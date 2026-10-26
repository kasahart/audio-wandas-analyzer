import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { addableOperations, brokenStep, chainEnd, bypassedSteps, SELECT_PAIR, decodeParam, encodeNumber, isRecipeChain, movedStep, recipeKey, recipeSteps, withBypass, withDefaults, withParam, withoutSteps, withStep, BYPASS_KEY, STEP_PARAMS } from '../shared/recipe/recipeSteps';
import { operationGroup, operationHint } from '../shared/recipe/operationGuide';
import { catalogOperation } from '../shared/recipe/recipeCatalog';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { runnableRecipe } from '../webview/runtime/stepBar';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;

test('floats are written as wandas does: big-endian IEEE 754 bytes in hex', () => {
    assert.deepEqual(encodeNumber(25.5, 'float'), { $type: 'number', kind: 'python-float', data: '4039800000000000' });
    // A non-integer for an integer parameter is kept as typed, so validation refuses it instead of rounding it.
    assert.equal(encodeNumber(2048, 'int'), 2048);
    assert.equal(decodeParam(encodeNumber(2.5, 'int')), 2.5);
    assert.equal(decodeParam({ $type: 'number', kind: 'python-float', data: '3fe0000000000000' }), 0.5);
});

test('the entry Recipe reads as its chain of steps, with the parameters the step bar may edit', () => {
    const steps = recipeSteps(entry, 16000);
    assert.deepEqual(steps.map(step => [step.name, step.invalid]), [['highpass_filter', undefined], ['time_slice', undefined], ['welch', undefined]]);
    assert.equal(steps[0].params['cutoff'], 20);
    assert.deepEqual(steps[2].editable.map(param => param.name), ['n_fft', 'window']);
});

test('an invalid setting marks its step and the scans leave that step out', () => {
    const [hpf, , welch] = recipeSteps(entry, 16000);
    const aboveNyquist = withParam(entry, hpf.id, hpf.editable[0], 9000);
    assert.equal(recipeSteps(aboveNyquist, 16000)[0].invalid, 'cutoff');
    assert.equal(recipeSteps(aboveNyquist, 48000)[0].invalid, undefined);
    assert.equal(recipeSteps(withParam(entry, welch.id, welch.editable[0], 1000), 16000)[2].invalid, 'n_fft');
    // The chain cannot run past it: the steps after it cannot either, and none of them is run without it.
    assert.deepEqual(recipeSteps(aboveNyquist, 16000).map(step => step.reason?.kind), ['below', 'after', 'after']);
    const runnable = runnableRecipe(aboveNyquist, 16000) as unknown as { nodes: Array<{ id: string; operation: string; inputs: string[] }>; output: string };
    assert.deepEqual(runnable.nodes, []);
    assert.equal(withoutSteps(entry, []), entry);
});

test('edits change the Recipe key; stored Recipes are checked before use', () => {
    const [hpf] = recipeSteps(entry, 16000);
    assert.notEqual(recipeKey(withParam(entry, hpf.id, hpf.editable[0], 25)), recipeKey(entry));
    assert.equal(recipeKey(JSON.parse(JSON.stringify(entry))), recipeKey(entry));
    assert.ok(isRecipeChain(entry));
    assert.equal(isRecipeChain({ schema: 'wandas.recipe', nodes: 'x', output: 'node-0' }), false);
    assert.equal(isRecipeChain({ version: 1 }), false);
});

test('an FFT longer than the shortest file is refused, with the limit as its reason', () => {
    const welch = recipeSteps(entry, 16000)[2];
    const long = withParam(entry, welch.id, welch.editable[0], 65536);
    const step = recipeSteps(long, { sampleRate: 16000, shortestSamples: 32000 })[2];
    assert.equal(step.invalid, 'n_fft');
    // The limit is the largest power of two that fits, so it can be typed as it reads.
    assert.deepEqual(step.reason, { kind: 'pow2', limit: 16384 });
    assert.equal(recipeSteps(long, { sampleRate: 16000, shortestSamples: 100000 })[2].invalid, undefined);
});

test('a parameter the Recipe leaves out shows and is written as wandas\' default', () => {
    const hpf = recipeSteps(entry).find(step => step.name === 'highpass_filter')!;
    assert.equal(hpf.params['order'], 4);
    const written = recipeSteps(withDefaults(entry)).find(step => step.name === 'highpass_filter')!;
    assert.equal(written.params['order'], 4);
    assert.ok(JSON.stringify(withDefaults(entry)).includes('"order"'));
});

test('a value below the minimum names the minimum; an order of 2.5 is refused, not rounded', () => {
    const hpf = recipeSteps(entry).find(step => step.name === 'highpass_filter')!;
    const negative = recipeSteps(withParam(entry, hpf.id, hpf.editable[0], -5), 16000).find(step => step.name === 'highpass_filter')!;
    assert.deepEqual(negative.reason, { kind: 'above', limit: 0 });
    const order = recipeSteps(withParam(entry, hpf.id, hpf.editable[1], 2.5), 16000).find(step => step.name === 'highpass_filter')!;
    assert.equal(order.invalid, 'order');
    assert.deepEqual(order.reason, { kind: 'integer', limit: 0 });
});

test('each step takes the Frame the step before gives; one that cannot is left out and passes its Frame on', async () => {
    const { catalogOperation } = await import('../shared/recipe/recipeCatalog');
    const { chainOutput, withStep, timeSignalStep, addableOperations } = await import('../shared/recipe/recipeSteps');
    assert.deepEqual(recipeSteps(entry, 16000).map(step => [step.input, step.output]), [['ChannelFrame', 'ChannelFrame'], ['ChannelFrame', 'ChannelFrame'], ['ChannelFrame', 'SpectralFrame']]);
    assert.equal(chainOutput(entry, 16000), 'SpectralFrame');
    // stft after the average spectrum: it takes a time signal, so it is left out and the chain still ends in the spectrum.
    const { recipe: after, id } = withStep(entry, 'node-2', catalogOperation('wandas.audio.stft')!);
    const stft = recipeSteps(after, 16000).find(step => step.id === id)!;
    assert.deepEqual([stft.invalid, stft.reason?.kind, stft.reason?.text], ['', 'frame', 'SpectralFrame']);
    assert.equal(chainOutput(after, 16000), 'SpectralFrame');
    assert.deepEqual(recipeSteps(runnableRecipe(after, 16000)).map(step => step.name), ['highpass_filter', 'time_slice', 'welch']);
    // Added after the region, a filter starts at its initial cutoff and the time signal is now its output.
    const { recipe: filtered, id: lpf } = withStep(entry, 'node-1', catalogOperation('wandas.audio.lowpass_filter')!);
    assert.deepEqual(recipeSteps(filtered, 16000).map(step => step.name), ['highpass_filter', 'time_slice', 'lowpass_filter', 'welch']);
    assert.equal(recipeSteps(filtered, 16000)[2].params['cutoff'], 1000);
    assert.equal(timeSignalStep(filtered, 16000)!.id, lpf);
    // A Recipe lists a node after the node it reads, so wandas accepts it.
    const order = (filtered as unknown as { nodes: Array<{ id: string; inputs: string[] }> }).nodes;
    order.forEach((node, index) => node.inputs.forEach(input => assert.ok(input.startsWith('input') || order.slice(0, index).some(item => item.id === input))));
    // A step failed on a file is left out with wandas' reason.
    assert.equal(recipeSteps(filtered, { sampleRate: 16000, failed: { [lpf]: 'boom' } })[2].reason?.kind, 'failed');
    // ＋ after a spectrum: welch is off (it takes a time signal); ifft is on.
    const menu = addableOperations('SpectralFrame');
    assert.equal(menu.find(item => item.name === 'welch')!.off, 'frame');
    assert.equal(menu.find(item => item.operation.id === 'wandas.spectral.ifft')!.off, undefined);
    // A required parameter the app cannot set keeps an operation off; the time slice is never offered twice.
    assert.equal(addableOperations('ChannelFrame').find(item => item.name === 'remove_channel')!.off, 'required');
    // wandas.numpy.ufunc needs a NumPy function name the app cannot set: it is not offered at all.
    assert.equal(addableOperations('ChannelFrame').find(item => item.operation.id === 'wandas.numpy.ufunc'), undefined);
    assert.ok(!addableOperations('ChannelFrame').some(item => item.operation.id === 'wandas.frame.time_slice'));
    // HPSS runs where librosa is (VS Code); a runtime that lists what it carries without it (the Web version) has it off.
    assert.equal(addableOperations('ChannelFrame').find(item => item.name === 'hpss_harmonic')!.off, undefined);
    const web = addableOperations('ChannelFrame', new Set(['librosa', 'scikit_learn'])).find(item => item.name === 'hpss_harmonic')!;
    assert.equal(web.off, 'unavailable');
    assert.match(web.why!, /librosa/);
    assert.equal(addableOperations('ChannelFrame', new Set(['librosa'])).find(item => item.name === 'a_weighting')!.off, undefined);
    // get_channel and fix_length need one of their optional values: the step bar sets it, so they run.
    const getChannel = addableOperations('SpectralFrame').find(item => item.name === 'get_channel')!;
    assert.deepEqual([getChannel.off, getChannel.settable], [undefined, true]);
    const { recipe: picked, id: channelStep } = withStep(entry, 'node-1', catalogOperation('wandas.frame.get_channel')!);
    assert.equal(recipeSteps(picked, { sampleRate: 16000, channels: 2 }).find(step => step.id === channelStep)!.params['channel_idx'], 0);
    // A channel the files do not have is refused.
    const third = withParam(picked, channelStep, STEP_PARAMS['wandas.frame.get_channel'][0], 2);
    assert.equal(recipeSteps(third, { sampleRate: 16000, channels: 2 }).find(step => step.id === channelStep)!.invalid, 'channel_idx');
    // fix_length starts at the length it is given (the region's).
    const { recipe: fixed, id: lengthStep } = withStep(entry, 'node-1', catalogOperation('wandas.audio.fix_length')!, { duration: 0.75 });
    assert.equal(recipeSteps(fixed, 16000).find(step => step.id === lengthStep)!.params['duration'], 0.75);
    // One that fails only on some files (noct_synthesis below 48 kHz) stays on: it is marked when it fails.
    assert.equal(addableOperations('SpectralFrame').find(item => item.name === 'noct_synthesis')!.off, undefined);
    assert.equal(addableOperations('SpectrogramFrame').find(item => item.operation.id === 'wandas.spectrogram.cepstrum')!.off, undefined);
});

test('a step moved by dragging keeps its parameters and the chain stays one chain', () => {
    const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
    const { recipe, id } = withStep(entry, 'node-1', catalogOperation('wandas.audio.a_weighting')!);
    const names = (doc: RecipeDocument): string[] => recipeSteps(doc).map(step => step.name);
    assert.deepEqual(names(recipe), ['highpass_filter', 'time_slice', 'a_weighting', 'welch']);
    const first = movedStep(recipe, id, null);
    assert.deepEqual(names(first), ['a_weighting', 'highpass_filter', 'time_slice', 'welch']);
    assert.ok(isRecipeChain(first));
    // Moved to the end, it becomes the Recipe's output; the HPF keeps its cutoff.
    const last = movedStep(recipe, 'node-0', 'node-2');
    assert.deepEqual(names(last), ['time_slice', 'a_weighting', 'welch', 'highpass_filter']);
    assert.equal((last as unknown as { output: string }).output, 'node-0');
    assert.deepEqual(recipeSteps(last).at(-1)!.params, recipeSteps(entry)[0].params);
    assert.equal(movedStep(recipe, id, id), recipe);
});

test('the ＋ menu groups operations by what they do, with a hint in the UI\'s language', () => {
    assert.equal(operationGroup('wandas.audio.highpass_filter'), 'filter');
    assert.equal(operationGroup('wandas.audio.normalize'), 'prepare');
    assert.equal(operationGroup('wandas.audio.loudness_zwtv'), 'time');
    assert.equal(operationGroup('wandas.spectrogram.cepstrum'), 'frequency');
    assert.equal(operationGroup('wandas.operator.add'), 'other');
    assert.equal(operationHint('wandas.audio.highpass_filter', 'ja'), '低い音を消す');
    assert.equal(operationHint('wandas.audio.highpass_filter', 'en'), 'remove what is below a frequency');
    assert.equal(operationHint('wandas.operator.add', 'ja'), '');
});

test('a bypassed step stays in the chain but is skipped: the Recipe run and exported has neither it nor the key', () => {
    const [hpf, slice] = recipeSteps(entry, 16000);
    const bypassed = withBypass(entry, hpf.id, true);
    assert.deepEqual(bypassedSteps(bypassed), [hpf.id]);
    const steps = recipeSteps(bypassed, 16000);
    assert.equal(steps.length, 3);
    assert.equal(steps[0].bypassed, true);
    // The step after it takes what the bypassed step took.
    assert.equal(steps[1].input, 'ChannelFrame');
    const run = runnableRecipe(bypassed, 16000) as unknown as Record<string, unknown> & { nodes: Array<{ operation: string }> };
    assert.deepEqual(run.nodes.map(node => node.operation), ['wandas.frame.time_slice', 'wandas.audio.welch']);
    assert.equal(BYPASS_KEY in run, false);
    // A bypassed region keeps its node: the screen sends no region instead.
    const region = runnableRecipe(withBypass(entry, slice.id, true), 16000) as unknown as Record<string, unknown> & { nodes: Array<{ operation: string }> };
    assert.equal(region.nodes.length, 3);
    assert.equal(BYPASS_KEY in region, false);
    // Off again, the Recipe is as it was.
    assert.deepEqual(withBypass(bypassed, hpf.id, false), entry);
    assert.notEqual(recipeKey(bypassed), recipeKey(entry));
});

test('the first step that cannot run breaks the chain: every step after it cannot run either, and nothing is run past it', () => {
    const { recipe, id } = withStep(entry, 'node-0', catalogOperation('wandas.audio.stft')!);
    const steps = recipeSteps(recipe, 16000);
    // The region takes a time signal, not the STFT's spectrogram: it is the break; the average spectrum after it cannot run either.
    assert.deepEqual(steps.map(step => [step.name, step.reason?.kind]), [['highpass_filter', undefined], ['stft', undefined], ['time_slice', 'frame'], ['welch', 'after']]);
    assert.equal(steps[3].reason?.text, steps[2].id);
    assert.equal(brokenStep(recipe, 16000)?.id, steps[2].id);
    // The Recipe run stops before the break; the chain would still end in a spectrum.
    assert.deepEqual(recipeSteps(runnableRecipe(recipe, 16000)).map(step => step.id), ['node-0', id]);
    assert.equal(chainEnd(recipe, 16000), 'SpectralFrame');
    assert.equal(brokenStep(entry, 16000), undefined);
});

test('a step that compares two channels needs two: one channel (or one picked by get_channel) has only itself', () => {
    const [, slice, welch] = recipeSteps(entry, 16000);
    const base = withoutSteps(entry, [welch.id]);
    const { recipe: cross, id: coherence } = withStep(base, slice.id, catalogOperation('wandas.audio.coherence')!);
    const { recipe: paired, id: pair } = withStep(cross, coherence, catalogOperation(SELECT_PAIR)!);
    // A new pair is ch2 over the reference ch1 (wandas' indices 1 and 0).
    const stereo = recipeSteps(paired, { sampleRate: 16000, channels: 2 });
    assert.deepEqual(stereo.map(step => [step.name, step.invalid]), [['highpass_filter', undefined], ['time_slice', undefined], ['coherence', undefined], ['select_pair', undefined]]);
    assert.deepEqual([stereo[3].params['output'], stereo[3].params['input']], [1, 0]);
    // One channel: the coherence cannot run, and says why; the pair after it cannot either.
    const mono = recipeSteps(paired, { sampleRate: 16000, channels: 1 });
    assert.deepEqual(mono.find(step => step.id === coherence)!.reason, { kind: 'channels', limit: 2 });
    assert.equal(mono.find(step => step.id === pair)!.reason?.kind, 'after');
    // The channels are unknown until a file is scanned: nothing is refused yet.
    assert.equal(brokenStep(paired, 16000), undefined);
    // get_channel leaves one channel of two.
    const { recipe: picked } = withStep(paired, null, catalogOperation('wandas.frame.get_channel')!);
    // …and the reason names that step, not the files.
    const narrowed = recipeSteps(picked, { sampleRate: 16000, channels: 2 });
    assert.deepEqual(narrowed.find(step => step.id === coherence)!.reason, { kind: 'channels', limit: 2, text: narrowed[0].id });
    // A list of channels keeps as many: two selected still make a pair.
    const listed = JSON.parse(JSON.stringify(picked)) as { nodes: Array<{ operation: string; params: { entries: Array<[string, unknown]> } }> };
    listed.nodes.find(node => node.operation === 'wandas.frame.get_channel')!.params.entries = [['channel_idx', { $type: 'list', items: [0, 1] }]];
    assert.equal(recipeSteps(listed as unknown as RecipeDocument, { sampleRate: 16000, channels: 2 }).find(step => step.id === coherence)!.reason, undefined);
    // On a pairwise Frame, get_channel selects pair rows: the recording keeps its channels, and a pair can follow.
    const rows = JSON.parse(JSON.stringify(paired)) as { nodes: Array<{ id: string; operation: string; version: number; inputs: string[]; params: unknown }>; output: string };
    const pairNode = rows.nodes.find(node => node.id === pair)!;
    rows.nodes.splice(rows.nodes.indexOf(pairNode), 0, { id: 'rows', operation: 'wandas.frame.get_channel', version: 1, inputs: [coherence], params: { $type: 'map', entries: [['channel_idx', 1]] } });
    pairNode.inputs = ['rows'];
    assert.equal(recipeSteps(rows as unknown as RecipeDocument, { sampleRate: 16000, channels: 2 }).find(step => step.id === pair)!.invalid, undefined);
    // sum and mean leave one channel too.
    for (const one of ['wandas.audio.sum', 'wandas.audio.mean']) {
        const { recipe: summed } = withStep(paired, slice.id, catalogOperation(one)!);
        assert.equal(recipeSteps(summed, { sampleRate: 16000, channels: 2 }).find(step => step.id === coherence)!.reason?.kind, 'channels');
    }
    // Bypassed, coherence and its pair do not run, so they do not break the chain on one channel.
    assert.equal(brokenStep(withBypass(withBypass(paired, coherence, true), pair, true), { sampleRate: 16000, channels: 1 }), undefined);
    // ＋ greys it on one channel, with that reason.
    assert.equal(addableOperations('ChannelFrame', undefined, 1).find(item => item.name === 'coherence')!.off, 'channels');
    assert.equal(addableOperations('ChannelFrame', undefined, 2).find(item => item.name === 'coherence')!.off, undefined);
    // A channel over itself compares nothing; a channel past the last is refused.
    const [output, input] = STEP_PARAMS[SELECT_PAIR];
    const self = withParam(paired, pair, output, 0);
    assert.deepEqual(recipeSteps(self, { sampleRate: 16000, channels: 2 }).find(step => step.id === pair)!.reason, { kind: 'pair', limit: 0 });
    // A pair named by source ids is wandas' to resolve: kept, unless it is a channel with itself.
    const named = JSON.parse(JSON.stringify(paired)) as { nodes: Array<{ id: string; params: { entries: Array<[string, unknown]> } }> };
    named.nodes.find(node => node.id === pair)!.params.entries = [['output', 'c1'], ['input', 'c0']];
    assert.equal(recipeSteps(named as unknown as RecipeDocument, { sampleRate: 16000, channels: 2 }).find(step => step.id === pair)!.invalid, undefined);
    named.nodes.find(node => node.id === pair)!.params.entries = [['output', 'c0'], ['input', 'c0']];
    assert.deepEqual(recipeSteps(named as unknown as RecipeDocument, { sampleRate: 16000, channels: 2 }).find(step => step.id === pair)!.reason, { kind: 'pair', limit: 0 });
    // A negative channel counts from the last (wandas resolves it): -1 over 0 is ch2 over ch1; -1 over 1 is ch2 with itself.
    named.nodes.find(node => node.id === pair)!.params.entries = [['output', -1], ['input', 0]];
    assert.equal(recipeSteps(named as unknown as RecipeDocument, { sampleRate: 16000, channels: 2 }).find(step => step.id === pair)!.invalid, undefined);
    named.nodes.find(node => node.id === pair)!.params.entries = [['output', -1], ['input', 1]];
    assert.equal(recipeSteps(named as unknown as RecipeDocument, { sampleRate: 16000, channels: 2 }).find(step => step.id === pair)!.reason?.kind, 'pair');
    const beyond = withParam(paired, pair, input, 2);
    assert.equal(recipeSteps(beyond, { sampleRate: 16000, channels: 2 }).find(step => step.id === pair)!.invalid, 'input');
});
