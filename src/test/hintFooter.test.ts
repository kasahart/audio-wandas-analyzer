import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachCanvasFocusHint, attachHoverHints, createHintFooter, createTaskStatus, hintAttr, setHint } from '../webview/runtime/hintFooter';

function setup(withFooter = true) {
    const dom = new JSDOM(`<!doctype html><body><button id="btn" data-hint="Export PNG"><span id="label">PNG</span></button><canvas class="track-canvas" tabindex="0"></canvas>${withFooter ? '<div id="hint-footer"></div>' : ''}</body>`);
    const doc = dom.window.document;
    return { dom, doc, footerEl: doc.getElementById('hint-footer') as HTMLElement, footer: createHintFooter(doc) };
}

test('show and clear set the footer text', () => {
    const { footer, footerEl } = setup();
    footer.show('hello');
    assert.equal(footerEl.textContent, 'hello');
    footer.clear();
    assert.equal(footerEl.textContent, '');
});

test('footer calls are no-ops without the footer element', () => {
    const { footer } = setup(false);
    assert.doesNotThrow(() => {
        footer.show('x');
        footer.clear();
    });
});

test('hovering an element inside a hinted element shows its hint and leaving clears it', () => {
    const { dom, doc, footer, footerEl } = setup();
    attachHoverHints(doc, footer);
    doc.getElementById('label')!.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, clientX: 5, clientY: 5 }));
    assert.equal(footerEl.textContent, 'Export PNG');
    doc.querySelector('.track-canvas')!.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, clientX: 40, clientY: 5 }));
    assert.equal(footerEl.textContent, '');
    footer.show('x');
    doc.body.dispatchEvent(new dom.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: null }));
    assert.equal(footerEl.textContent, '');
});

test('a page drawn again under a pointer at rest keeps the message written since: only a pointer that moved shows a hint', () => {
    const { dom, doc, footer, footerEl } = setup();
    attachHoverHints(doc, footer);
    const over = (target: Element, x: number): boolean => target.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: 5 }));
    over(doc.getElementById('label')!, 5);
    doc.getElementById('btn')!.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    assert.equal(footerEl.textContent, 'Export PNG');
    // A click draws the button again; a refused value then writes its reason.
    footer.show('Choose two different channels');
    // The browser says the pointer is over the new button, at the place it already was: the reason stays.
    over(doc.getElementById('label')!, 5);
    assert.equal(footerEl.textContent, 'Choose two different channels');
    // Moved, the pointer shows the hint of what it is over again.
    over(doc.getElementById('label')!, 6);
    assert.equal(footerEl.textContent, 'Export PNG');
});

test('a scroll under a pointer at rest still moves the hint to what is under the pointer now', () => {
    const { dom, doc, footer, footerEl } = setup();
    attachHoverHints(doc, footer);
    const over = (target: Element): boolean => target.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 200 }));
    over(doc.getElementById('label')!);
    doc.getElementById('btn')!.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 200 }));
    assert.equal(footerEl.textContent, 'Export PNG');
    // Scrolled: the canvas (no hint) is now under the same point, and nothing else was written: the hint goes.
    over(doc.querySelector('.track-canvas')!);
    assert.equal(footerEl.textContent, '');
    over(doc.getElementById('label')!);
    assert.equal(footerEl.textContent, 'Export PNG');
});

test('attachCanvasFocusHint shows the key hint in the footer on focus and clears it on blur', () => {
    const { dom, doc, footer, footerEl } = setup();
    const canvas = doc.querySelector('.track-canvas') as HTMLElement;
    attachCanvasFocusHint(canvas, footer, 'Arrow keys move the cursor');
    canvas.dispatchEvent(new dom.window.FocusEvent('focus'));
    assert.equal(footerEl.textContent, 'Arrow keys move the cursor');
    // The ring is the stylesheet's :focus-visible, so the mouse's focus has none.
    assert.equal(canvas.style.outline, '');
    canvas.dispatchEvent(new dom.window.FocusEvent('blur'));
    assert.equal(footerEl.textContent, '');
});

test('blurring the canvas keeps a hint that replaced the focus hint', () => {
    const { dom, doc, footer, footerEl } = setup();
    const canvas = doc.querySelector('.track-canvas') as HTMLElement;
    attachCanvasFocusHint(canvas, footer, 'Arrow keys move the cursor');
    canvas.dispatchEvent(new dom.window.FocusEvent('focus'));
    footer.show('Export PNG');
    canvas.dispatchEvent(new dom.window.FocusEvent('blur'));
    assert.equal(footerEl.textContent, 'Export PNG');
});

test('hints are also exposed as accessible descriptions', () => {
    assert.equal(hintAttr('a & "b"'), ' data-hint="a &amp; &quot;b&quot;" aria-description="a &amp; &quot;b&quot;"');
    const { doc } = setup();
    const btn = doc.getElementById('btn') as HTMLElement;
    setHint(btn, 'Python');
    assert.equal(btn.dataset.hint, 'Python');
    assert.equal(btn.getAttribute('aria-description'), 'Python');
});

test('createTaskStatus announces a finished or failed task through the live region, not the busy state', () => {
    const dom = new JSDOM('<!doctype html><body><div id="task-status" aria-hidden="true" hidden></div></body>');
    const doc = dom.window.document;
    const announced: string[] = [];
    const timers = { setTimeout: (() => 1) as unknown as Window['setTimeout'], clearTimeout: (() => undefined) as Window['clearTimeout'] };
    const status = createTaskStatus(doc, timers, text => announced.push(text));
    status('Exporting PNG…', 'busy');
    assert.deepEqual(announced, []);
    status('Saved waveform-export.png', 'done');
    status('PNG export failed', 'failed');
    assert.deepEqual(announced, ['Saved waveform-export.png', 'PNG export failed']);
    assert.equal(doc.getElementById('task-status')!.textContent, 'PNG export failed');
});
