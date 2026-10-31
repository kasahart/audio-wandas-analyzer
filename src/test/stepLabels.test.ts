import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import type { RecipeStep, StepParam } from '../shared/recipe/recipeSteps';
import { OCTAVE_BRANCH } from '../webview/runtime/stepBarModel';
import { channelText, formatNumber, fromShown, invalidReason, stepChipLabel, stepLabel } from '../webview/runtime/stepLabels';

const strings = getStrings('en');
const step = (name: string, params: RecipeStep['params'] = {}, extra: Partial<RecipeStep> = {}): RecipeStep => ({
    id: `node-${name}`, operation: `wandas.x.${name}`, name, params, editable: [], input: 'ChannelFrame', output: 'ChannelFrame', ...extra,
});
const channelParam: StepParam = { name: 'output', kind: 'int', min: 0, max: 64, channel: 'output' };

test('chip labels name the step by what it does, with its values', () => {
    assert.equal(stepChipLabel(step('highpass_filter', { cutoff: 20 }), strings), `${strings.stepHighpass} 20 Hz`);
    assert.equal(stepChipLabel(step('bandpass_filter', { low_cutoff: 100, high_cutoff: 2000.12345 }), strings), `${strings.stepBandpass} 100–2000.123 Hz`);
    assert.equal(stepChipLabel(step('resampling', { target_sr: 8000 }), strings), '→ 8 kHz');
    assert.equal(stepChipLabel(step('stft', { n_fft: 1024 }), strings), 'STFT 1024');
    assert.equal(stepChipLabel(step('time_slice'), strings), `${strings.stepRegion} ${strings.stepAll}`);
    assert.equal(stepChipLabel(step('time_slice'), strings, { start: 0.5, end: 1.25 }), `${strings.stepRegion} 0.50–1.25 s`);
    assert.equal(stepChipLabel(step('get_channel'), strings), 'get_channel');
    assert.equal(stepChipLabel(step('coherence', {}, { reference: 'slot' }), strings), `coherence · ${strings.stagePairBase}`);
});

test('channels are shown from 1, a negative index from the last when the channels are known', () => {
    assert.equal(channelText(0), '1');
    assert.equal(channelText(-1, 4), '4');
    assert.equal(channelText(-1), '-1');
    assert.equal(channelText('c1'), '?');
    assert.equal(stepLabel(step('select_pair', { output: 1, input: 0 }), strings, {}, false), strings.stepPair.replace('{output}', '2').replace('{input}', '1'));
    assert.equal(stepLabel(step('select_pair', { output: 'c2', input: 'c1' }), strings, {}, false), 'c2 / c1');
    assert.equal(fromShown(channelParam, 2), 1);
    assert.ok(Number.isNaN(fromShown(channelParam, 0)));
    assert.equal(fromShown(channelParam, -1), -1);
    assert.equal(fromShown({ name: 'cutoff', kind: 'float' }, 20), 20);
    assert.equal(formatNumber(1 / 3), '0.333');
    assert.equal(formatNumber(undefined), '');
});

test('the 1/3-octave chip shows its band range only when the bar is opened', () => {
    const noct = step('noct_spectrum', { fmin: 20, fmax: 5000 });
    assert.equal(stepLabel(noct, strings, {}, false), strings.stepOctave);
    assert.equal(stepLabel(noct, strings, {}, true), `${strings.stepOctave} 20 Hz–5 kHz`);
    assert.equal(stepLabel(step('noct_spectrum', { n: 6 }), strings, {}, false), '1/6 oct');
});

test('the reason a step cannot run names the step it depends on by its chip', () => {
    const hpf = step('highpass_filter', { cutoff: 9000 });
    assert.equal(invalidReason(step('welch'), strings), '');
    assert.equal(invalidReason(step('welch', {}, { invalid: '', reason: { kind: 'after', limit: 0, text: hpf.id } }), strings, [hpf]), strings.stepAfterBroken.replace('{op}', `${strings.stepHighpass} 9000 Hz`));
    assert.equal(invalidReason(step('welch', {}, { invalid: 'n_fft', reason: { kind: 'pow2', limit: 8192 } }), strings), strings.stepNeedPow2.replace('{max}', '8192'));
    assert.equal(invalidReason(step('x', {}, { invalid: 'cutoff', reason: { kind: 'below', limit: Infinity } }), strings), strings.stepNeedBelow.replace('{max}', '∞'));
    assert.equal(invalidReason(step('coherence', {}, { invalid: '', reason: { kind: 'channels', limit: 2 } }), strings), strings.stepNeedChannels);
    assert.equal(invalidReason(step('select_pair', {}, { editable: [channelParam], invalid: 'output', reason: { kind: 'below', limit: 2 } }), strings), strings.stepNeedChannel.replace('{n}', '2'));
    assert.equal(invalidReason({ ...step('noct_spectrum'), id: OCTAVE_BRANCH, invalid: '' }, strings), strings.stepOctaveBroken);
});
