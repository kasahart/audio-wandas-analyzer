import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { recipeSteps, withStep } from '../shared/recipe/recipeSteps';
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
