import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { recipeSteps, TIME_SLICE } from '../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { INPUT_FRAME } from '../shared/recipe/recipeCatalog';
import { stepMenuAt, stepMenuHtml, stepMenuKey, stepMenuListHtml, type StepMenuContext } from '../webview/runtime/stepMenu';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const strings = getStrings('en');
const context = (extra: Partial<StepMenuContext> = {}): StepMenuContext => ({ recipe: entry, state: { recipe: entry, sampleRate: 16000 }, strings, expanded: false, lacks: new Set(), regionSettable: false, ...extra });
const parse = (html: string): DocumentFragment => JSDOM.fragment(`<div>${html}</div>`);
const ops = (root: DocumentFragment, selector: string): string[] => Array.from(root.querySelectorAll(selector), item => item.getAttribute('data-op') ?? '');

test('＋ opens on the Frame where it is: the input before the first step, the step\'s own after it', () => {
    const [hpf, , welch] = recipeSteps(entry, 16000);
    assert.deepEqual(stepMenuAt(entry, { recipe: entry }, null), { after: null, frame: INPUT_FRAME, filter: '' });
    assert.equal(stepMenuAt(entry, { recipe: entry }, hpf.id).frame, hpf.output);
    assert.equal(stepMenuAt(entry, { recipe: entry, sampleRate: 16000 }, welch.id).frame, welch.output);
});

test('the menu lists what takes the Frame here by group, what fits an earlier place there, and the rest with why', () => {
    const [, , welch] = recipeSteps(entry, 16000);
    const root = parse(stepMenuListHtml(stepMenuAt(entry, { recipe: entry, sampleRate: 16000 }, welch.id), context()));
    const earlier = root.querySelector('[data-group="earlier"]');
    assert.ok(earlier, 'operations on a time signal fit before the spectrum');
    const filter = earlier.querySelector<HTMLElement>('[data-op="wandas.audio.highpass_filter"]');
    assert.ok(filter?.hasAttribute('data-after'), 'the high-pass goes in at an earlier place');
    assert.match(filter!.textContent ?? '', /highpass_filter/);
    // An earlier place's operation is pressable; one that cannot go anywhere is greyed.
    assert.equal(earlier.querySelectorAll('.is-off').length, 0);
    assert.ok(Array.from(root.querySelectorAll('[data-group="off"] .step-menu-item')).every(item => item.getAttribute('aria-disabled') === 'true'));
    assert.ok(ops(root, '.step-menu-item').length > 0);
});

test('the filter narrows the list by name or what an operation does', () => {
    const menu = { ...stepMenuAt(entry, { recipe: entry }, null), filter: 'LOWPASS' };
    const root = parse(stepMenuListHtml(menu, context()));
    assert.deepEqual(ops(root, '.step-menu-item'), ['wandas.audio.lowpass_filter']);
    assert.equal(stepMenuListHtml({ ...menu, filter: 'no such operation' }, context()), '');
});

test('on the comparison the region is set from the menu: here at the input, at an earlier place, or greyed once there is one', () => {
    const [, slice, welch] = recipeSteps(entry, 16000);
    const atInput = parse(stepMenuListHtml(stepMenuAt(entry, { recipe: entry }, null), context({ regionSettable: true })));
    assert.ok(atInput.querySelector(`[data-group="prepare"] [data-op="${TIME_SLICE}"]:not(.is-off)`));
    // After the spectrum, the nearest place a time signal is at.
    const later = parse(stepMenuListHtml(stepMenuAt(entry, { recipe: entry, sampleRate: 16000 }, welch.id), context({ regionSettable: true })));
    assert.equal(later.querySelector(`[data-group="earlier"] [data-op="${TIME_SLICE}"]`)?.getAttribute('data-after'), slice.id);
    const set = context({ regionSettable: true, state: { recipe: entry, regionRange: { start: 0, end: 1 } } });
    assert.ok(parse(stepMenuListHtml(stepMenuAt(entry, { recipe: entry }, null), set)).querySelector(`[data-group="off"] [data-op="${TIME_SLICE}"].is-off`));
    assert.equal(parse(stepMenuListHtml(stepMenuAt(entry, { recipe: entry }, null), context())).querySelector(`[data-op="${TIME_SLICE}"]`), null);
});

test('the menu keeps its typed filter in the field and is titled by the Frame here', () => {
    const root = parse(stepMenuHtml({ after: null, frame: INPUT_FRAME, filter: 'fil<ter' }, context()));
    assert.equal(root.querySelector<HTMLInputElement>('[data-step-menu-filter]')?.value, 'fil<ter');
    assert.equal(root.querySelector('.step-menu-title')?.textContent, strings.stepMenuTitle.replace('{frame}', INPUT_FRAME));
    assert.ok(root.querySelector('[data-step-menu] .step-menu-list'));
});

test('in the menu Esc closes it, and Enter in the filter adds the first operation unless it ends an IME composition', () => {
    const root = JSDOM.fragment('<input data-step-menu-filter><button class="step-menu-item"></button>');
    const filter = root.querySelector('input'), item = root.querySelector('button');
    const key = (name: string, target: Element | null, ime: Partial<Pick<KeyboardEvent, 'isComposing' | 'keyCode'>> = {}) => stepMenuKey({ key: name, target, isComposing: false, keyCode: 13, ...ime });
    assert.equal(key('Escape', item), 'close');
    assert.equal(key('Enter', filter), 'add-first');
    assert.equal(key('Enter', filter, { isComposing: true }), null);
    assert.equal(key('Enter', filter, { keyCode: 229 }), null);
    assert.equal(key('Enter', item), null, 'an item\'s own Enter presses it');
    assert.equal(key('a', filter), null);
});
