import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { recipeSteps, STEP_PARAMS, withParam, withStep } from '../shared/recipe/recipeSteps';
import { catalogOperation } from '../shared/recipe/recipeCatalog';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import type { StepBarState } from '../webview/runtime/stepBarModel';
import { checkStepForm, regionFormDraft, regionLength, stepFormDraft, stepFormHtml, stepFormKey } from '../webview/runtime/stepForm';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const strings = getStrings('en');
const state: StepBarState = { recipe: entry, sampleRate: 16000 };

/** The form drawn into a page of its own; `type` sets a field as the user would. */
function formFor(html: string) {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const form = dom.window.document.querySelector<HTMLElement>('[data-step-form]');
    assert.ok(form);
    const type = (selector: string, value: string): void => {
        const input = form.querySelector<HTMLInputElement>(selector);
        assert.ok(input, selector);
        input.value = value;
    };
    return { form, type };
}

test('a step\'s form has its fields with their values, Remove and Apply', () => {
    const [hpf] = recipeSteps(entry, 16000);
    const { form } = formFor(stepFormHtml(hpf, state, strings));
    assert.equal(form.getAttribute('data-step-form'), hpf.id);
    assert.equal(form.querySelector<HTMLInputElement>('[data-step-param="cutoff"]')?.value, '20');
    assert.ok(form.querySelector(`[data-action="step-remove"][data-step="${hpf.id}"]`));
    assert.ok(form.querySelector('[data-action="step-apply"]:not([disabled])'));
    assert.equal(form.querySelector('.step-reference'), null);
});

test('the region chip\'s form gives a region within the files, start before end', () => {
    const [, slice] = recipeSteps(entry, 16000);
    const { form, type } = formFor(stepFormHtml(slice, { ...state, regionRange: { start: 0.5, end: 1.5 } }, strings));
    assert.ok(form.hasAttribute('data-step-form-region'));
    assert.ok(form.querySelector('[data-action="step-region-clear"]'));
    assert.deepEqual(regionFormDraft(form, 2), { start: 0.5, end: 1.5 });
    assert.equal(regionFormDraft(form, 1), null, 'past the files\' end');
    type('[data-step-region-param="end"]', '0.25');
    assert.equal(regionFormDraft(form, undefined), null);
    type('[data-step-region-param="end"]', '');
    assert.equal(regionFormDraft(form, undefined), null);
    assert.equal(regionLength({ shortestSamples: 32000, sampleRate: 16000, lengthS: 9 }), 2);
    assert.equal(regionLength({ lengthS: 9 }), 9);
});

test('the draft changes only the fields typed into', () => {
    const [hpf] = recipeSteps(entry, 16000);
    const { form, type } = formFor(stepFormHtml(hpf, state, strings));
    assert.equal(stepFormDraft(form, entry, { sampleRate: 16000 }), entry, 'untouched: the stored Recipe');
    type('[data-step-param="cutoff"]', '40');
    const draft = stepFormDraft(form, entry, { sampleRate: 16000 });
    assert.ok(draft);
    assert.equal(recipeSteps(draft, 16000)[0].params['cutoff'], 40);
    assert.equal(stepFormDraft(null, entry, { sampleRate: 16000 }), null);
    assert.equal(stepFormDraft(form, null, { sampleRate: 16000 }), null);
});

test('a value the step cannot take marks its field and keeps Apply off; fixed, Apply is back', () => {
    const [hpf] = recipeSteps(entry, 16000);
    const { form, type } = formFor(stepFormHtml(hpf, state, strings));
    const said: string[] = [];
    const check = (): void => checkStepForm(form, { recipe: entry, state, strings, footer: text => said.push(text) });
    const apply = form.querySelector<HTMLButtonElement>('[data-action="step-apply"]');
    const field = form.querySelector('[data-step-param="cutoff"]')?.closest('.step-field');
    type('[data-step-param="cutoff"]', '9000');
    check();
    assert.equal(apply?.disabled, true);
    assert.equal(field?.classList.contains('is-invalid'), true);
    assert.ok(said.at(-1));
    assert.equal(field?.getAttribute('data-hint'), said.at(-1));
    type('[data-step-param="cutoff"]', '');
    check();
    assert.equal(said.at(-1), strings.stepNeedValue);
    assert.equal(apply?.disabled, true);
    type('[data-step-param="cutoff"]', '30');
    check();
    assert.equal(apply?.disabled, false);
    assert.equal(field?.classList.contains('is-invalid'), false);
});

test('a cross-channel step\'s form offers its reference, and the check passes over it', () => {
    const operation = catalogOperation('wandas.audio.cross_correlation');
    assert.ok(operation);
    const { recipe, id } = withStep(entry, null, operation);
    const step = recipeSteps(recipe, { sampleRate: 16000, channels: 2 }).find(item => item.id === id);
    assert.ok(step);
    const twoChannels = { recipe, sampleRate: 16000, channels: 2 };
    const { form, type } = formFor(stepFormHtml(step, twoChannels, strings));
    assert.deepEqual(Array.from(form.querySelectorAll('[data-action="step-reference"]'), button => [button.getAttribute('data-mode'), button.getAttribute('aria-pressed')]), [['channel', 'true'], ['slot', 'false']]);
    type('[data-step-param="max_lag"]', '');
    checkStepForm(form, { recipe, state: twoChannels, strings, footer: () => undefined });
    assert.equal(form.querySelector<HTMLButtonElement>('[data-action="step-apply"]')?.disabled, true);
    assert.equal(form.querySelector('.step-reference')?.hasAttribute('data-hint'), false);
});

test('the region form keeps Apply off and says why while its values are not a region', () => {
    const [, slice] = recipeSteps(entry, 16000);
    const { form, type } = formFor(stepFormHtml(slice, { ...state, regionRange: { start: 0.5, end: 1.5 } }, strings));
    const said: string[] = [];
    type('[data-step-region-param="start"]', '2');
    checkStepForm(form, { recipe: entry, state, strings, footer: text => said.push(text) });
    assert.equal(form.querySelector<HTMLButtonElement>('[data-action="step-apply"]')?.disabled, true);
    assert.deepEqual(said, [strings.stepRegionOrder]);
    assert.ok(Array.from(form.querySelectorAll('.step-field')).every(label => label.classList.contains('is-invalid')));
});

test('in the form Esc closes it and Enter applies it', () => {
    assert.equal(stepFormKey({ key: 'Escape' }), 'close');
    assert.equal(stepFormKey({ key: 'Enter' }), 'apply');
    assert.equal(stepFormKey({ key: 'Tab' }), null);
});

test('a field shows the stored value unrounded: a 0.0015 s lifter cutoff reads 0.0015, and typing 0.002 sets 0.002', () => {
    const [, slice] = recipeSteps(entry, 16000);
    const cepstrum = withStep(entry, slice.id, catalogOperation('wandas.audio.cepstrum')!);
    const lifter = withStep(cepstrum.recipe, cepstrum.id, catalogOperation('wandas.cepstral.lifter')!);
    const recipe = withParam(lifter.recipe, lifter.id, STEP_PARAMS['wandas.cepstral.lifter'][0], 0.0015);
    const step = recipeSteps(recipe, 16000).find(item => item.id === lifter.id)!;
    const { form, type } = formFor(stepFormHtml(step, { recipe, sampleRate: 16000 }, strings));
    assert.equal(form.querySelector<HTMLInputElement>('[data-step-param="cutoff"]')?.value, '0.0015');
    type('[data-step-param="cutoff"]', '0.002');
    const draft = stepFormDraft(form, recipe, { sampleRate: 16000 })!;
    assert.equal(recipeSteps(draft, 16000).find(item => item.id === lifter.id)!.params['cutoff'], 0.002);
});

/** The entry Recipe with `operation` added after its high-pass filter, and that step as the form sees it. */
function added(operation: string) {
    const hpf = recipeSteps(entry).find(step => step.name === 'highpass_filter')!;
    const { recipe, id } = withStep(entry, hpf.id, catalogOperation(operation)!);
    const step = recipeSteps(recipe, 48000).find(item => item.id === id)!;
    return { recipe, id, step };
}

test('every field wandas describes is in the form: a choice, on/off, and a number wandas picks itself (auto)', () => {
    const { step } = added('wandas.audio.sound_level');
    const { form } = formFor(stepFormHtml(step, state, strings));
    const frequency = form.querySelector<HTMLSelectElement>('select[data-step-param="freq_weighting"]')!;
    assert.deepEqual(Array.from(frequency.options, option => [option.value, option.textContent]), [['A', 'A'], ['C', 'C'], ['Z', 'Z'], ['', strings.stepNone]]);
    assert.equal(frequency.value, 'Z');
    assert.equal(form.querySelector<HTMLSelectElement>('select[data-step-param="time_weighting"]')!.value, 'Fast');
    const dB = form.querySelector<HTMLInputElement>('input[type="checkbox"][data-step-param="dB"]')!;
    assert.equal(dB.checked, false);
    assert.equal(form.querySelector('.step-form-note'), null, 'no "no settings" note');
    assert.ok(form.querySelector('[data-action="step-apply"]'));
    const welch = recipeSteps(entry).find(item => item.name === 'welch')!;
    const hop = formFor(stepFormHtml(welch, state, strings)).form.querySelector<HTMLInputElement>('[data-step-param="hop_length"]')!;
    assert.equal(hop.value, '');
    assert.equal(hop.placeholder, strings.stepAuto);
});

test('the draft writes the values changed in the form, in wandas\' encoding, and nothing else', () => {
    const { recipe, id, step } = added('wandas.audio.sound_level');
    const { form } = formFor(stepFormHtml(step, state, strings));
    assert.equal(stepFormDraft(form, recipe, { sampleRate: 48000 }), recipe, 'untouched: the stored Recipe');
    form.querySelector<HTMLSelectElement>('[data-step-param="freq_weighting"]')!.value = 'A';
    form.querySelector<HTMLInputElement>('[data-step-param="dB"]')!.checked = true;
    const draft = stepFormDraft(form, recipe, { sampleRate: 48000 })!;
    const entries = (draft['nodes'] as Array<{ id: string; params: { entries: unknown[] } }>).find(node => node.id === id)!.params.entries;
    assert.deepEqual(entries, [['dB', true], ['freq_weighting', 'A']]);
    // "none" is None: wandas' sound_level without a frequency weighting.
    form.querySelector<HTMLSelectElement>('[data-step-param="freq_weighting"]')!.value = '';
    const none = stepFormDraft(form, recipe, { sampleRate: 48000 })!;
    assert.deepEqual((none['nodes'] as Array<{ id: string; params: { entries: unknown[] } }>).find(node => node.id === id)!.params.entries, [['dB', true], ['freq_weighting', null]]);
});

test('an emptied number wandas picks itself is auto (None), not a missing value', () => {
    const welch = recipeSteps(entry).find(item => item.name === 'welch')!;
    const hop = welch.editable.find(param => param.name === 'hop_length')!;
    const set = withParam(entry, welch.id, hop, 256);
    const step = recipeSteps(set, 16000).find(item => item.name === 'welch')!;
    const { form, type } = formFor(`<div data-step-bar>${stepFormHtml(step, { ...state, recipe: set }, strings)}</div>`);
    assert.equal(form.querySelector<HTMLInputElement>('[data-step-param="hop_length"]')!.value, '256');
    type('[data-step-param="hop_length"]', '');
    const draft = stepFormDraft(form, set, { sampleRate: 16000 })!;
    assert.equal(recipeSteps(draft).find(item => item.name === 'welch')!.params['hop_length'], null);
    const footer: string[] = [];
    checkStepForm(form, { recipe: set, state: { ...state, recipe: set }, strings, footer: text => footer.push(text) });
    assert.equal(form.querySelector<HTMLButtonElement>('[data-action="step-apply"]')!.disabled, false, 'auto is a value');
    assert.deepEqual(footer, []);
});

test('a form of many fields shows the first four and the changed ones; the rest open from "more"', () => {
    const { recipe, id } = added('wandas.audio.transfer_function');
    const estimator = recipeSteps(recipe).find(item => item.id === id)!.editable.find(param => param.name === 'estimator')!;
    const changed = withParam(recipe, id, estimator, 'H2');
    const step = recipeSteps(changed, { sampleRate: 48000, channels: 2 }).find(item => item.id === id)!;
    const { form } = formFor(stepFormHtml(step, { ...state, recipe: changed, channels: 2 }, strings));
    const shown = Array.from(form.querySelectorAll(':scope > .step-field [data-step-param]'), input => input.getAttribute('data-step-param'));
    assert.deepEqual(shown, ['n_fft', 'hop_length', 'win_length', 'window', 'estimator']);
    const more = form.querySelector<HTMLDetailsElement>('details.step-more')!;
    assert.equal(more.open, false);
    assert.deepEqual(Array.from(more.querySelectorAll('[data-step-param]'), input => input.getAttribute('data-step-param')), ['detrend', 'scaling', 'average']);
    assert.equal(more.querySelector('summary')!.textContent, strings.stepMore.replace('{n}', '3').replace('{names}', 'detrend, scaling, average'));
    // A changed value is marked; a folded field still counts in the draft.
    assert.ok(form.querySelector('.step-field.is-changed [data-step-param="estimator"]'));
    assert.equal(form.querySelectorAll('.step-field.is-changed').length, 1);
    more.querySelector<HTMLSelectElement>('[data-step-param="average"]')!.value = 'median';
    const draft = stepFormDraft(form, changed, { sampleRate: 48000 })!;
    assert.equal(recipeSteps(draft).find(item => item.id === id)!.params['average'], 'median');
    // Four or fewer: no "more".
    assert.equal(formFor(stepFormHtml(added('wandas.audio.sound_level').step, state, strings)).form.querySelector('details.step-more'), null);
});

test('an operation without parameters says it has none', () => {
    const { step } = added('wandas.audio.a_weighting');
    const { form } = formFor(stepFormHtml(step, state, strings));
    assert.equal(form.querySelector('.step-form-note')?.textContent, strings.stepNoSettings);
    assert.equal(strings.stepNoSettings, 'No settings');
    assert.equal(getStrings('ja').stepNoSettings, '設定項目はありません');
    assert.equal(form.querySelector('[data-action="step-apply"]'), null);
});
