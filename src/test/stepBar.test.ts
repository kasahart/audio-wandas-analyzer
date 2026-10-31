import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { withStep } from '../shared/recipe/recipeSteps';
import { catalogOperation } from '../shared/recipe/recipeCatalog';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { createStepBar } from '../webview/runtime/stepBar';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const strings = getStrings('en');

/** A step bar on a page of its own (jsdom), with the browser globals the bar reads. */
function mountBar(mode: 'entry' | 'compare' = 'compare') {
    const dom = new JSDOM('<!doctype html><body><div id="hint-footer"></div></body>', { pretendToBeVisual: true });
    const globals = globalThis as unknown as Record<string, unknown>;
    globals['CSS'] = { escape: (text: string) => text.replace(/["\\]/g, '\\$&') };
    globals['HTMLInputElement'] = dom.window.HTMLInputElement;
    const errors: string[] = [];
    dom.window.addEventListener('error', event => errors.push(event.message));
    const changes: RecipeDocument[] = [];
    const bar = createStepBar({ document: dom.window.document, strings, mode, onChange: recipe => changes.push(recipe), onRegionSet: () => undefined });
    dom.window.document.body.append(bar.element);
    const type = (selector: string, value: string): void => {
        const input = bar.element.querySelector<HTMLInputElement>(selector);
        assert.ok(input, selector);
        input.value = value;
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    };
    return { dom, bar, errors, changes, type, footer: () => dom.window.document.getElementById('hint-footer')?.textContent ?? '' };
}

test('a cross-channel step\'s form checks its values beside the reference choice, which has none', () => {
    const operation = catalogOperation('wandas.audio.cross_correlation');
    assert.ok(operation);
    const { recipe, id } = withStep(entry, null, operation);
    const { bar, errors, type, footer } = mountBar();
    bar.set({ recipe, sampleRate: 16000, channels: 2 });
    bar.element.querySelector<HTMLElement>(`[data-action="step-settings"][data-step="${id}"]`)?.click();
    assert.ok(bar.element.querySelector('[data-step-form] .step-reference'), 'the form has the reference choice');
    type('[data-step-param="max_lag"]', '');
    assert.deepEqual(errors, []);
    assert.equal(bar.element.querySelector<HTMLButtonElement>('[data-step-form] [data-action="step-apply"]')?.disabled, true);
    assert.equal(footer(), strings.stepNeedValue);
    assert.equal(bar.element.querySelector('[data-step-form] .step-reference')?.classList.contains('is-invalid'), false);
});

test('a step\'s settings are applied from its form, and the chips take the edit at once', () => {
    const { dom, bar, changes } = mountBar('entry');
    bar.set({ recipe: entry, sampleRate: 16000 });
    const gear = bar.element.querySelector<HTMLElement>('.step-chip [data-action="step-settings"]');
    const stepId = gear?.getAttribute('data-step');
    gear?.click();
    const cutoff = bar.element.querySelector<HTMLInputElement>('[data-step-form] [data-step-param="cutoff"]');
    assert.ok(cutoff);
    cutoff.value = '40';
    cutoff.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(changes.length, 1);
    assert.equal(bar.element.querySelector('[data-step-form]'), null);
    assert.match(bar.element.querySelector(`[data-step-id="${stepId}"] .step-body`)?.textContent ?? '', /40 Hz/);
    // ↶ takes it back.
    bar.element.querySelector<HTMLElement>('[data-action="step-undo"]')?.click();
    assert.equal(changes.length, 2);
    assert.equal(changes[1], entry);
});

test('Delete on a chip removes its step, M bypasses it; a button naming no step does nothing', () => {
    const { dom, bar, changes, footer } = mountBar('entry');
    bar.set({ recipe: entry, sampleRate: 16000 });
    const key = (id: string, name: string): void => {
        bar.element.querySelector(`[data-step-hold="${id}"]`)?.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true }));
    };
    const [first] = Array.from(bar.element.querySelectorAll('.step-chip[draggable="true"]'), chip => chip.getAttribute('data-step-id') ?? '');
    key(first, 'm');
    assert.equal(changes.length, 1);
    assert.equal(bar.element.querySelector(`[data-step-id="${first}"]`)?.classList.contains('is-bypassed'), true);
    assert.match(footer(), /HPF/);
    key(first, 'Delete');
    assert.equal(changes.length, 2);
    assert.equal(bar.element.querySelector(`[data-step-id="${first}"]`), null);
    const stray = dom.window.document.createElement('button');
    stray.setAttribute('data-action', 'step-delete');
    bar.element.append(stray);
    stray.click();
    assert.equal(changes.length, 2);
});
