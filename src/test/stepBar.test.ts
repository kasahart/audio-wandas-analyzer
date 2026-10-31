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
