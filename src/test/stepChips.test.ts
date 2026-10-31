import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { recipeSteps, withBypass, withParam } from '../shared/recipe/recipeSteps';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { INPUT_STAGE, OCTAVE_BRANCH } from '../webview/runtime/stepBarModel';
import { stepChipsHtml, type StepChipsContext } from '../webview/runtime/stepChips';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const strings = getStrings('en');
const [hpf, slice, welch] = recipeSteps(entry, 16000);
const context = (extra: Partial<StepChipsContext> = {}): StepChipsContext => ({
    recipe: entry, state: { recipe: entry, sampleRate: 16000 }, strings, mode: 'entry', expanded: false, open: null, menu: null,
    regionSettable: false, inputSelectable: false, canUndo: false, canRedo: false, ...extra,
});
const chips = (extra: Partial<StepChipsContext> = {}): DocumentFragment => JSDOM.fragment(`<nav>${stepChipsHtml(context(extra))}</nav>`);
const ids = (root: DocumentFragment, selector: string): string[] => Array.from(root.querySelectorAll(selector), chip => chip.getAttribute('data-step-id') ?? '');

test('the row: ↶ ↷, the name, the input, the steps joined by → ＋ (the region chip only with a region), ＋, the branch apart', () => {
    const root = chips();
    assert.deepEqual(ids(root, '.step-chip'), [hpf.id, welch.id, OCTAVE_BRANCH]);
    assert.deepEqual(ids(root, '.step-branch .step-chip'), [OCTAVE_BRANCH]);
    assert.ok(root.querySelector('[data-step-input]:not(.step-chip)'), 'the entry table\'s input is not a chip');
    // A link adds right before the chip after it, behind the region chip that is not shown.
    assert.deepEqual(Array.from(root.querySelectorAll('[data-action="step-insert"]'), button => button.getAttribute('data-after')), ['', slice.id]);
    assert.equal(root.querySelector('[data-action="step-add"]')?.getAttribute('data-after'), welch.id);
    assert.equal(root.querySelector('[data-action="step-undo"]')?.hasAttribute('disabled'), true);
    assert.equal(chips({ canUndo: true }).querySelector('[data-action="step-undo"]')?.hasAttribute('disabled'), false);
    assert.equal(root.querySelector('.step-outside-row'), null);
    assert.ok(chips({ expanded: true }).querySelector('.step-outside-row .awa-tag'));
});

test('the stage on screen is framed, the steps after it dimmed; the branch is never after', () => {
    const entryRow = chips();
    assert.deepEqual(ids(entryRow, '.is-current'), [OCTAVE_BRANCH]);
    assert.deepEqual(ids(entryRow, '.is-after'), []);
    const compare = chips({ mode: 'compare', state: { recipe: entry, sampleRate: 16000, stage: hpf.id } });
    assert.deepEqual(ids(compare, '.is-current'), [hpf.id]);
    assert.deepEqual(ids(compare, '.is-after'), [welch.id]);
    const input = chips({ mode: 'compare', inputSelectable: true, state: { recipe: entry, sampleRate: 16000, stage: INPUT_STAGE } });
    assert.deepEqual(ids(input, '.step-chip.step-input.is-current'), [INPUT_STAGE]);
});

test('a chip\'s buttons: ⚙, bypass and × on a step; the region chip\'s own ⚙ and × on the comparison; none on the branch', () => {
    const root = chips({ mode: 'compare', regionSettable: true, state: { recipe: entry, sampleRate: 16000, regionRange: { start: 0.5, end: 1 } } });
    const actions = (id: string): string[] => Array.from(root.querySelectorAll(`[data-step-id="${id}"] [data-action]`), button => button.getAttribute('data-action') ?? '');
    assert.deepEqual(actions(hpf.id), ['step-settings', 'step-bypass', 'step-delete']);
    assert.deepEqual(actions(slice.id), ['step-settings', 'step-bypass', 'step-region-clear']);
    assert.deepEqual(actions(OCTAVE_BRANCH), []);
    assert.equal(root.querySelector(`[data-step-id="${hpf.id}"]`)?.getAttribute('draggable'), 'true');
    assert.equal(root.querySelector(`[data-step-id="${slice.id}"]`)?.hasAttribute('draggable'), false);
    assert.match(root.querySelector(`[data-step-id="${slice.id}"] .step-body`)?.textContent ?? '', /0\.50–1\.00 s/);
});

test('a step that cannot run is marked, says why, and passes its mark on; a bypassed one is pressed', () => {
    const broken = withParam(entry, hpf.id, hpf.editable[0], 9000);
    const root = chips({ recipe: broken, state: { recipe: broken, sampleRate: 16000 } });
    assert.deepEqual(ids(root, '.is-invalid'), [hpf.id, welch.id, OCTAVE_BRANCH]);
    assert.equal(root.querySelector(`[data-step-id="${hpf.id}"] .step-dot`)?.getAttribute('data-kind'), '');
    const bypassed = withBypass(entry, hpf.id, true);
    const off = chips({ recipe: bypassed, state: { recipe: bypassed, sampleRate: 16000 } });
    assert.deepEqual(ids(off, '.is-bypassed'), [hpf.id]);
    assert.equal(off.querySelector(`[data-step-id="${hpf.id}"] [data-action="step-bypass"]`)?.getAttribute('aria-pressed'), 'true');
});

test('the open form\'s chip and the open menu\'s ＋ say so', () => {
    const root = chips({ open: hpf.id, menu: { after: welch.id, frame: welch.output, filter: '' } });
    assert.deepEqual(ids(root, '.is-open'), [hpf.id]);
    assert.equal(root.querySelector('[data-action="step-add"]')?.getAttribute('aria-expanded'), 'true');
});
