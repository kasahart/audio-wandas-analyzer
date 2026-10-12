import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { isOffsetEditorOpen, openOffsetEditor } from '../webview/runtime/offsetInlineEditor';
import type { RuntimeDocument, RuntimeElement } from '../webview/runtime/types';

const LABELS = { placeholder: 'ms', ariaLabel: 'Offset (ms)' };

function setup() {
    const dom = new JSDOM('<!doctype html><body><div id="row"><span class="track-offset-val">+0 ms</span></div></body>');
    const doc = dom.window.document as unknown as RuntimeDocument;
    const span = doc.querySelector('.track-offset-val');
    const commits: Array<number | null> = [];
    const key = (input: RuntimeElement, k: string) => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, cancelable: true }));
    const blur = (input: RuntimeElement) => input.dispatchEvent(new dom.window.FocusEvent('blur'));
    return { doc, span, commits, key, blur };
}

test('openOffsetEditor replaces the span with a prefilled number input', () => {
    const { doc, span, commits } = setup();
    openOffsetEditor(doc, span, 120, LABELS, (ms) => commits.push(ms));
    const input = doc.querySelector('.track-offset-input');
    assert.ok(input);
    assert.equal(input.type, 'number');
    assert.equal(input.value, '120');
    assert.equal(input.placeholder, 'ms');
    assert.equal(input.getAttribute('aria-label'), 'Offset (ms)');
    assert.equal(input.nextElementSibling, span);
    assert.equal(isOffsetEditorOpen(span), true);
    assert.equal(doc.activeElement, input);
});

test('Enter commits the parsed value once and restores the span', () => {
    const { doc, span, commits, key, blur } = setup();
    openOffsetEditor(doc, span, 0, LABELS, (ms) => commits.push(ms));
    const input = doc.querySelector('.track-offset-input');
    input.value = '-35.5';
    key(input, 'Enter');
    blur(input);
    assert.deepEqual(commits, [-35.5]);
    assert.equal(doc.querySelector('.track-offset-input'), null);
    assert.equal(isOffsetEditorOpen(span), false);
});

test('blur commits null for a non-numeric value', () => {
    const { doc, span, commits, blur } = setup();
    openOffsetEditor(doc, span, 10, LABELS, (ms) => commits.push(ms));
    const input = doc.querySelector('.track-offset-input');
    input.value = '';
    blur(input);
    assert.deepEqual(commits, [null]);
});

test('Escape closes without committing, and a second open while editing is ignored', () => {
    const { doc, span, commits, key } = setup();
    openOffsetEditor(doc, span, 10, LABELS, (ms) => commits.push(ms));
    openOffsetEditor(doc, span, 99, LABELS, (ms) => commits.push(ms));
    assert.equal(doc.querySelectorAll('.track-offset-input').length, 1);
    key(doc.querySelector('.track-offset-input'), 'Escape');
    assert.deepEqual(commits, []);
    assert.equal(doc.querySelector('.track-offset-input'), null);
    assert.equal(isOffsetEditorOpen(span), false);
});
