import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { requiredElementById } from '../webview/runtime/domAdapter';

test('requiredElementById returns the element and names a missing id', () => {
    const doc = new JSDOM('<!doctype html><body><div id="app"></div></body>').window.document;
    assert.equal(requiredElementById(doc, 'app').id, 'app');
    assert.throws(() => requiredElementById(doc, 'tracks-wrapper'), /Missing element #tracks-wrapper/);
});
