import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { attachStageGestures } from '../webview/runtime/trackStageGestures';
import { initialStageState } from '../webview/runtime/trackStageModel';

test('attaching the gestures puts the cursor line, readout, zoom box and axis range popover on the page, hidden', () => {
    const dom = new JSDOM('<!doctype html><body><div class="lanes"></div><div class="track-stage"></div></body>');
    const document = dom.window.document;
    const state = initialStageState();
    attachStageGestures(document.querySelector('.lanes') as HTMLElement, document.querySelector('.track-stage') as HTMLElement, document, {
        strings: getStrings('en'), state, drawnOn: new Map(), painted: () => false, moved: () => undefined, rerender: () => undefined, hint: () => undefined,
    });
    for (const selector of ['.track-stage-cursor', '.track-stage-readout', '.track-stage-box']) {
        assert.equal(document.querySelectorAll(selector).length, 1, selector);
        assert.equal(document.querySelector<HTMLElement>(selector)?.hidden, true, selector);
    }
    assert.ok(document.getElementById('track-stage-range-popover'));
});
