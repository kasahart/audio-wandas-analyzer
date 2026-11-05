import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { choose } from '../webview/runtime/staticDialogs';

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
