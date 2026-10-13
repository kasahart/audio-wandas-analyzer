import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { canvasTarget, requiredElementById } from '../webview/runtime/domAdapter';

test('requiredElementById returns the element and names a missing id', () => {
    const doc = new JSDOM('<!doctype html><body><div id="app"></div></body>').window.document;
    assert.equal(requiredElementById(doc, 'app').id, 'app');
    assert.throws(() => requiredElementById(doc, 'tracks-wrapper'), /Missing element #tracks-wrapper/);
});

test('canvasTarget returns the event target only when it carries the class', () => {
    const { window } = new JSDOM('<!doctype html><body><canvas class="track-canvas"></canvas><canvas class="other"></canvas></body>');
    const targetOf = (selector: string) => {
        let found: HTMLCanvasElement | null = null;
        const el = window.document.querySelector(selector) as HTMLCanvasElement;
        el.addEventListener('mousemove', (e) => { found = canvasTarget(e, 'track-canvas'); });
        el.dispatchEvent(new window.MouseEvent('mousemove'));
        return { el, found: found as HTMLCanvasElement | null };
    };
    const hit = targetOf('.track-canvas');
    assert.equal(hit.found, hit.el);
    assert.equal(targetOf('.other').found, null);
});
