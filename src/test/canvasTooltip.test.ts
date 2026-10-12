import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachCanvasFocusHint, createCanvasTooltip } from '../webview/runtime/canvasTooltip';
import type { RuntimeDocument, RuntimeElement } from '../webview/runtime/types';

function setup(withTooltip = true) {
    const dom = new JSDOM(`<!doctype html><body>${withTooltip ? '<div id="canvas-tooltip" style="display:none"></div>' : ''}<canvas class="track-canvas" tabindex="0"></canvas></body>`);
    const doc = dom.window.document as unknown as RuntimeDocument;
    return { dom, doc, tooltipEl: doc.getElementById('canvas-tooltip') as HTMLElement, tooltip: createCanvasTooltip(doc) };
}

test('showAtPointer places the tooltip just below-right of the pointer', () => {
    const { tooltip, tooltipEl } = setup();
    tooltip.showAtPointer(100, 50, 'hello');
    assert.equal(tooltipEl.textContent, 'hello');
    assert.equal(tooltipEl.style.display, 'block');
    assert.equal(tooltipEl.style.left, '114px');
    assert.equal(tooltipEl.style.top, '64px');
    tooltip.hide();
    assert.equal(tooltipEl.style.display, 'none');
});

test('tooltip calls are no-ops without the tooltip element', () => {
    const { tooltip } = setup(false);
    assert.doesNotThrow(() => {
        tooltip.showAtPointer(1, 2, 'x');
        tooltip.showInside({ left: 0, bottom: 0 }, 'x');
        tooltip.hide();
    });
});

test('attachCanvasFocusHint shows the key hint inside the canvas on focus and clears it on blur', () => {
    const { dom, doc, tooltip, tooltipEl } = setup();
    const canvas = doc.querySelector('.track-canvas') as RuntimeElement;
    canvas.getBoundingClientRect = () => ({ left: 20, bottom: 200 }) as DOMRect;
    attachCanvasFocusHint(canvas, tooltip, 'Arrow keys move the cursor');
    canvas.dispatchEvent(new dom.window.FocusEvent('focus'));
    assert.equal(tooltipEl.textContent, 'Arrow keys move the cursor');
    assert.equal(tooltipEl.style.display, 'block');
    assert.equal(tooltipEl.style.left, '28px');
    assert.equal(tooltipEl.style.top, '164px');
    assert.notEqual(canvas.style.outline, '');
    canvas.dispatchEvent(new dom.window.FocusEvent('blur'));
    assert.equal(tooltipEl.style.display, 'none');
    assert.equal(canvas.style.outline, 'none');
});
