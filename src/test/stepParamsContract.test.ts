/**
 * The step form's contract with wandas, over every operation ＋ offers (docs/display-rules.md R12), so a kind of
 * parameter the form mishandles fails here for every operation that has one, not only for the one a review found:
 * a new step runs at wandas' defaults; an untouched form changes nothing; every value a field can hold reaches the
 * Recipe and comes back as that value; a parameter that takes None can be set to None; Enter applies only from a field.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { catalogOperation } from '../shared/recipe/recipeCatalog';
import { WANDAS_OPERATIONS } from '../shared/recipe/generated/wandasOperations';
import { addableOperations, recipeSteps, withStep, type RecipeStep, type StepLimits, type StepParam } from '../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import type { StepBarState } from '../webview/runtime/stepBarModel';
import { stepFormDraft, stepFormHtml, stepFormKey } from '../webview/runtime/stepForm';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const strings = getStrings('en');
/** Two channels of 2 s at 48 kHz: every operation ＋ offers on a recording is offered here. */
const LIMITS: StepLimits = { sampleRate: 48000, channels: 2, shortestSamples: 96000 };
const state: StepBarState = { recipe: entry, ...LIMITS };

/** The steps before an operation that takes `frame`: none for a time signal, one that gives it otherwise. */
const BEFORE: Record<string, readonly string[]> = {
    ChannelFrame: [],
    SpectralFrame: ['wandas.audio.welch'],
    SpectrogramFrame: ['wandas.audio.stft'],
    NOctFrame: ['wandas.audio.noct_spectrum'],
    CepstralFrame: ['wandas.audio.cepstrum'],
    CepstrogramFrame: ['wandas.audio.stft', 'wandas.spectrogram.cepstrum'],
    CrossSpectralFrame: ['wandas.audio.csd'],
    ChannelFrameSegments: ['wandas.audio.trigger'],
};

/** Every operation ＋ offers somewhere (not greyed there), each added where it is offered, as the step it becomes. */
function offeredSteps(): Array<{ recipe: RecipeDocument; step: RecipeStep }> {
    const hpf = recipeSteps(entry).find(item => item.name === 'highpass_filter')!;
    const found = new Map<string, { recipe: RecipeDocument; step: RecipeStep }>();
    for (const [frame, before] of Object.entries(BEFORE)) {
        let recipe = entry;
        let after = hpf.id;
        for (const id of before) ({ recipe, id: after } = withStep(recipe, after, catalogOperation(id)!));
        for (const offered of addableOperations(frame, undefined, LIMITS.channels, LIMITS.sampleRate)) {
            if (offered.off || found.has(offered.operation.id)) continue;
            const added = withStep(recipe, after, offered.operation);
            found.set(offered.operation.id, { recipe: added.recipe, step: recipeSteps(added.recipe, LIMITS).find(item => item.id === added.id)! });
        }
    }
    return [...found.values()];
}

const steps = offeredSteps();

function formOf(step: RecipeStep, recipe: RecipeDocument): HTMLElement {
    const dom = new JSDOM(`<!doctype html><body>${stepFormHtml(step, { ...state, recipe }, strings)}</body>`);
    const form = dom.window.document.querySelector<HTMLElement>('[data-step-form]');
    assert.ok(form, step.name);
    return form;
}

const paramsAfter = (draft: RecipeDocument | null, id: string): RecipeStep['params'] => recipeSteps(draft!, LIMITS).find(item => item.id === id)!.params;

test('the contract reaches every kind of field wandas describes', () => {
    // Most of ＋'s operations, and among their fields each kind and each kind's None. A str that takes None (integrate's
    // unit) is on no step ＋ offers: integrate is greyed with wandas' reason on a recording without a unit.
    assert.ok(steps.length >= 50, String(steps.length));
    const kinds = new Set(steps.flatMap(({ step }) => step.editable.map(param => `${param.kind}${'nullable' in param && param.nullable ? '?' : ''}`)));
    assert.deepEqual([...kinds].sort(), ['int', 'int?', 'float', 'float?', 'bool', 'bool?', 'enum', 'enum?', 'str'].sort());
});

test('every operation ＋ offers runs as added: a new step at wandas\' defaults is not marked', () => {
    const marked = steps.filter(({ step }) => step.invalid !== undefined).map(({ step }) => `${step.operation}: ${step.invalid} ${JSON.stringify(step.reason)}`);
    assert.deepEqual(marked, []);
});

test('an untouched form changes nothing: Apply writes the Recipe as it was', () => {
    for (const { recipe, step } of steps) {
        assert.equal(stepFormDraft(formOf(step, recipe), recipe, LIMITS), recipe, step.operation);
    }
});

/** The values a field can be set to, as typed or picked, with what the step then holds. */
function valuesOf(param: StepParam, form: HTMLElement): Array<{ set: (input: HTMLInputElement & HTMLSelectElement) => void; holds: unknown }> {
    const input = form.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-step-param="${param.name}"]`)!;
    if (input.tagName === 'SELECT') {
        return Array.from(input.options, option => ({
            set: (field: HTMLSelectElement) => { field.value = option.value; },
            holds: option.value === '' ? null : param.kind === 'bool' ? option.value === 'true' : option.value,
        }));
    }
    if ((input as HTMLInputElement).type === 'checkbox') return [true, false].map(on => ({ set: (field: HTMLInputElement) => { field.checked = on; }, holds: on }));
    const nullable = input.hasAttribute('data-step-nullable') ? [{ set: (field: HTMLInputElement) => { field.value = ''; }, holds: null }] : [];
    if (param.kind === 'str') return [{ set: (field: HTMLInputElement) => { field.value = 'linear'; }, holds: 'linear' }, ...nullable];
    // A channel is typed from 1 and held from 0.
    const channel = param.kind === 'int' && param.channel;
    return [{ set: (field: HTMLInputElement) => { field.value = channel ? '2' : '3'; }, holds: channel ? 1 : 3 }, ...nullable];
}

test('every value a field can hold reaches the Recipe and comes back as that value', () => {
    const lost: string[] = [];
    for (const { recipe, step } of steps) {
        for (const param of step.editable) {
            for (const value of valuesOf(param, formOf(step, recipe))) {
                const form = formOf(step, recipe);
                value.set(form.querySelector(`[data-step-param="${param.name}"]`)!);
                const held = paramsAfter(stepFormDraft(form, recipe, LIMITS), step.id)[param.name];
                // A value left as it was is not written: the step holds wandas' default, shown as that value.
                const shown = step.params[param.name] ?? null;
                if (!Object.is(held ?? null, value.holds) && !(Object.is(value.holds, shown) && held === step.params[param.name])) {
                    lost.push(`${step.operation}.${param.name}: set ${String(value.holds)}, held ${String(held)}`);
                }
            }
        }
    }
    assert.deepEqual(lost, []);
});

/**
 * Parameters wandas lets be None that the step bar keeps to a value on purpose, and why. Every other one can be set to
 * None from its field.
 */
const NOT_NONE: Readonly<Record<string, string>> = {
    'wandas.audio.fix_length:duration': 'wandas needs one of length and duration: a step holds its duration, so length stays None',
    'wandas.audio.cross_correlation:max_lag': 'None is every lag of every pair (GBs for 8 channels of 30 s): a step keeps a bounded lag',
};

test('a parameter that takes None can be set to None from its field', () => {
    const missing: string[] = [];
    for (const { recipe, step } of steps) {
        const described = catalogOperation(step.operation)?.params ?? [];
        for (const param of step.editable) {
            if (!described.find(item => item.name === param.name)?.nullable || NOT_NONE[`${step.operation}:${param.name}`]) continue;
            const input = formOf(step, recipe).querySelector<HTMLInputElement & HTMLSelectElement>(`[data-step-param="${param.name}"]`)!;
            const none = input.tagName === 'SELECT' ? Array.from(input.options).some(option => option.value === '') : input.hasAttribute('data-step-nullable');
            if (!none) missing.push(`${step.operation}.${param.name}`);
        }
    }
    assert.deepEqual(missing, []);
    for (const key of Object.keys(NOT_NONE)) {
        const [operation, name] = key.split(':');
        assert.ok(WANDAS_OPERATIONS.find(item => item.id === operation)?.params.find(param => param.name === name)?.nullable, key);
    }
});

test('Enter applies a form only from one of its fields; on a button or a disclosure it does what that control does', () => {
    for (const { recipe, step } of steps) {
        const form = formOf(step, recipe);
        for (const control of Array.from(form.querySelectorAll('input, select, button, summary'))) {
            const expected = control.matches('input, select') ? 'apply' : null;
            assert.equal(stepFormKey({ key: 'Enter', target: control }), expected, `${step.operation} ${control.outerHTML.slice(0, 60)}`);
            assert.equal(stepFormKey({ key: 'Escape', target: control }), 'close');
        }
    }
});
