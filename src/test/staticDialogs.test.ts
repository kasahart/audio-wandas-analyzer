import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { choose, showRecipeCharts } from '../webview/runtime/staticDialogs';

function page() {
    const dom = new JSDOM('<!doctype html><body><main id="outside"></main></body>');
    return { dom, window: dom.window as unknown as Window, document: dom.window.document };
}

test('the in-page choice resolves with the pressed option and leaves nothing behind', async () => {
    const { window, document } = page();
    const picked = choose(document, window, 'Format', [['markdown', 'Markdown'], ['notebook', 'Notebook']] as const);
    const box = document.querySelector('[data-web-choice]')!;
    assert.equal(box.getAttribute('role'), 'dialog');
    assert.equal(box.getAttribute('aria-label'), 'Format');
    const buttons = Array.from(box.querySelectorAll('button'));
    assert.deepEqual(buttons.map(button => button.textContent), ['Markdown', 'Notebook']);
    assert.equal(document.activeElement, buttons[0], 'the first option takes focus');
    buttons[1].click();
    assert.equal(await picked, 'notebook');
    assert.equal(document.querySelector('[data-web-choice]'), null);
});

test('Escape or a press outside the choice cancels it', async () => {
    const { dom, window, document } = page();
    const escaped = choose(document, window, 'Format', [['a', 'A']] as const);
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    assert.equal(await escaped, undefined);
    assert.equal(document.querySelector('[data-web-choice]'), null);
    const outside = choose(document, window, 'Format', [['a', 'A']] as const);
    document.getElementById('outside')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    assert.equal(await outside, undefined);
    // A later Escape no longer reaches the closed choice.
    const third = choose(document, window, 'Format', [['a', 'A']] as const);
    document.querySelector<HTMLButtonElement>('[data-web-choice] button')!.click();
    assert.equal(await third, 'a');
});

test('recipe charts open in one fresh frame with the renderer globals and a close button', () => {
    const { document } = page();
    const strings = getStrings('en');
    const prepared: Window[] = [];
    const charts = [{ kind: 'scalar', title: 'Level', values: [] }] as never;
    showRecipeCharts(document, strings, 'octave', charts, 'signal: a.wav', frame => prepared.push(frame));
    showRecipeCharts(document, strings, 'octave', charts, 'signal: b.wav', frame => prepared.push(frame));
    const panels = document.querySelectorAll('[data-recipe-result]');
    assert.equal(panels.length, 1, 'a new run replaces the earlier result');
    const panel = panels[0];
    assert.equal(panel.getAttribute('data-recipe-result'), 'octave');
    assert.match(panel.textContent ?? '', /signal: b\.wav/);
    const frame = panel.querySelector('iframe')!;
    assert.equal(prepared.length, 2);
    assert.equal(prepared[1], frame.contentWindow);
    assert.deepEqual((frame.contentWindow as unknown as { __CHART_SPECS__: unknown }).__CHART_SPECS__, charts);
    assert.equal(frame.contentDocument!.getElementById('charts')?.tagName, 'DIV');
    assert.equal(frame.contentDocument!.querySelector('script')?.getAttribute('src'), './chartSpecRuntime.js');
    const close = panel.querySelector<HTMLButtonElement>('[data-action="browser-recipe-close"]')!;
    assert.equal(close.textContent, strings.btnCloseRecipeResult);
    close.click();
    assert.equal(document.querySelector('[data-recipe-result]'), null);
});
