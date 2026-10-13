import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installLayoutResizeHandling } from '../webview/runtime/layoutResize';

function setup() {
    const dom = new JSDOM('<!doctype html><body><div id="a"></div><div id="b"></div></body>');
    const doc = dom.window.document;
    const observed: string[] = [];
    let trigger: () => void = () => { };
    class FakeObserver {
        constructor(callback: () => void) { trigger = callback; }
        observe(el: Element) { observed.push(el.id); }
        unobserve() { }
        disconnect() { }
    }
    return { dom, doc, observed, fire: () => trigger(), FakeObserver: FakeObserver as unknown as typeof ResizeObserver };
}

test('installLayoutResizeHandling observes the listed elements that exist and reacts to window and element resizes', () => {
    const { dom, doc, observed, fire, FakeObserver } = setup();
    let calls = 0;
    installLayoutResizeHandling(dom.window, doc, ['a', 'missing', 'b'], () => { calls++; }, FakeObserver);
    assert.deepEqual(observed, ['a', 'b']);
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    fire();
    assert.equal(calls, 2);
});

test('installLayoutResizeHandling falls back to window resize only without ResizeObserver', () => {
    const { dom, doc } = setup();
    let calls = 0;
    installLayoutResizeHandling(dom.window, doc, ['a'], () => { calls++; }, undefined);
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    assert.equal(calls, 1);
});
