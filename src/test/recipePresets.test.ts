import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { presetOf, presetRecipe, RECIPE_PRESETS } from '../shared/recipe/recipePresets';
import { catalogOperation } from '../shared/recipe/recipeCatalog';
import type { RecipeDocument } from '../shared/recipe/recipeSelection';
import { recipeNodes, recipeSteps, withBypass, withParam, withStep, STEP_PARAMS } from '../shared/recipe/recipeSteps';
import { createStepBar, presetMenuHtml } from '../webview/runtime/stepBar';

const entry = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'python-backend', 'recipes', 'entry-scan.recipe.json'), 'utf8')) as RecipeDocument;
const preset = (id: string) => RECIPE_PRESETS.find(item => item.id === id)!;

test('the presets are the six one-input chains, the first the entry Recipe, and each runs at 16 and 48 kHz', () => {
    assert.deepEqual(RECIPE_PRESETS.map(item => item.id), ['spectrum', 'octave', 'spectrogram', 'level', 'loudness', 'roughness']);
    assert.equal(presetOf(entry)?.id, 'spectrum');
    for (const item of RECIPE_PRESETS) {
        for (const sampleRate of [16000, 48000]) {
            const broken = recipeSteps(item.recipe, { sampleRate, channels: 1 }).filter(step => step.invalid !== undefined);
            assert.deepEqual(broken.map(step => step.operation), [], `${item.id} at ${sampleRate} Hz`);
        }
    }
});

test('a chain is its preset whatever its region or node ids; an edit, a bypass or a new step makes it none', () => {
    const octave = presetRecipe(preset('octave'));
    assert.equal(presetOf(octave)?.id, 'octave');
    // The region's bounds are the comparison's, not the preset's.
    const sliced = JSON.parse(JSON.stringify(octave)) as RecipeDocument & { nodes: Array<{ operation: string; params: { entries: unknown[] } }> };
    sliced.nodes.find(node => node.operation === 'wandas.frame.time_slice')!.params.entries = [['start', 1], ['end', 2]];
    assert.equal(presetOf(sliced)?.id, 'octave');
    const hpf = recipeSteps(octave)[0];
    assert.equal(presetOf(withParam(octave, hpf.id, STEP_PARAMS[hpf.operation][0], 40)), undefined);
    assert.equal(presetOf(withBypass(octave, hpf.id, true)), undefined);
    assert.equal(presetOf(withStep(octave, null, catalogOperation('wandas.audio.normalize')!).recipe), undefined);
    // presetRecipe hands out a copy: editing it leaves the preset as generated.
    assert.notEqual(octave, preset('octave').recipe);
});

function mountBar(language: 'en' | 'ja' = 'en') {
    const dom = new JSDOM('<!doctype html><body><div id="hint-footer"></div></body>', { pretendToBeVisual: true });
    const globals = globalThis as unknown as Record<string, unknown>;
    globals['CSS'] = { escape: (text: string) => text.replace(/["\\]/g, '\\$&') };
    globals['HTMLInputElement'] = dom.window.HTMLInputElement;
    const strings = getStrings(language);
    const changes: RecipeDocument[] = [];
    const shown: string[] = [];
    const regions: unknown[] = [];
    const bar = createStepBar({
        document: dom.window.document, strings, mode: 'compare', presets: true,
        onChange: recipe => changes.push(recipe), onStepShown: id => shown.push(id), onRegionSet: region => regions.push(region),
    });
    dom.window.document.body.append(bar.element);
    const button = (): HTMLElement => bar.element.querySelector<HTMLElement>('[data-action="step-preset-open"]')!;
    const choose = (id: string): void => {
        button().click();
        bar.element.querySelector<HTMLElement>(`[data-step-preset-menu] [data-preset="${id}"]`)!.click();
    };
    return { dom, bar, strings, changes, shown, regions, button, choose, footer: () => dom.window.document.getElementById('hint-footer')?.textContent ?? '' };
}

test('the recipe button lists the presets by name and graph, and a choice replaces the chain as one edit ↶ takes back', () => {
    const { bar, strings, changes, shown, regions, button, choose, footer } = mountBar('ja');
    bar.set({ recipe: entry, sampleRate: 16000, channels: 1, regionRange: { start: 1, end: 2 } });
    assert.equal(button().textContent, 'レシピ: 全体のスペクトル');
    button().click();
    const items = Array.from(bar.element.querySelectorAll('[data-step-preset-menu] [data-preset]'));
    assert.deepEqual(items.map(item => item.querySelector('.step-preset-name')?.textContent), ['全体のスペクトル', '帯域別レベル（A特性）', '時間と周波数', 'レベルの時間変化', '聞こえの大きさ', '音の粗さ']);
    assert.equal(items[0].getAttribute('aria-checked'), 'true');
    assert.equal(items[1].querySelector('.step-preset-graph')?.textContent, strings.presetOctaveGraph);
    // Esc closes the menu without a change.
    bar.close();
    assert.equal(bar.element.querySelector('[data-step-preset-menu]'), null);

    choose('loudness');
    assert.equal(changes.length, 1);
    assert.equal(presetOf(changes[0])?.id, 'loudness');
    assert.equal(shown.at(-1), changes[0]['output']);
    assert.equal(button().textContent, 'レシピ: 聞こえの大きさ');
    assert.equal(footer(), '手順を「聞こえの大きさ」に置き換えました · ↶ で戻す');
    // The region stays.
    assert.deepEqual(regions, []);
    // Choosing the chain's own preset again changes nothing.
    choose('loudness');
    assert.equal(changes.length, 1);

    bar.element.querySelector<HTMLElement>('[data-action="step-undo"]')!.click();
    assert.equal(changes.at(-1), entry);
    assert.equal(button().textContent, 'レシピ: 全体のスペクトル');
});

test('an edited preset reads "(edited)" after its name until it is that preset again', () => {
    const { bar, changes, button, choose } = mountBar('en');
    bar.set({ recipe: entry, sampleRate: 16000, channels: 1 });
    choose('octave');
    const chip = bar.element.querySelector<HTMLElement>('.step-chip:not([data-step-input]) [data-action="step-bypass"]')!;
    chip.click();
    assert.equal(button().textContent, 'Recipe: Band levels (A-weighted) (edited)');
    bar.element.querySelector<HTMLElement>('[data-action="step-undo"]')!.click();
    assert.equal(button().textContent, 'Recipe: Band levels (A-weighted)');
    assert.equal(presetOf(changes.at(-1))?.id, 'octave');
});

test('every preset runs in the Web version: none of its steps needs a package the runtime may lack, so none is greyed', () => {
    for (const item of RECIPE_PRESETS) {
        for (const node of recipeNodes(item.recipe)) assert.deepEqual(catalogOperation(node.operation)?.needs ?? [], [], `${item.id}: ${node.operation}`);
    }
    assert.doesNotMatch(presetMenuHtml(entry, getStrings('en'), new Set(['librosa', 'mosqito'])), /is-off/);
});
