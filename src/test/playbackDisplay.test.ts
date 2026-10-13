import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createPlaybackDisplay } from '../webview/runtime/playbackDisplay';
import type { RuntimeDocument } from '../webview/runtime/types';

function setup(withDisplay = true) {
    const dom = new JSDOM(`<!doctype html><body>${withDisplay ? '<span id="playback-display"></span>' : ''}</body>`);
    const doc = dom.window.document as unknown as RuntimeDocument;
    return { doc, el: doc.getElementById('playback-display') as HTMLElement, update: createPlaybackDisplay(doc, '▶') };
}

test('createPlaybackDisplay shows the prefixed clock time while playing and hides it when stopped', () => {
    const { el, update } = setup();
    update(65.5);
    assert.equal(el.style.display, 'inline');
    assert.equal(el.textContent, '▶ 1:05.50');
    update(null);
    assert.equal(el.style.display, 'none');
    assert.equal(el.textContent, '');
});

test('createPlaybackDisplay skips DOM writes when the shown text is unchanged', () => {
    const { el, update } = setup();
    update(1);
    el.textContent = 'externally changed';
    update(1);
    assert.equal(el.textContent, 'externally changed');
    update(2);
    assert.equal(el.textContent, '▶ 0:02.00');
});

test('createPlaybackDisplay is a no-op without the display element', () => {
    const { update } = setup(false);
    assert.doesNotThrow(() => {
        update(1);
        update(null);
    });
});
