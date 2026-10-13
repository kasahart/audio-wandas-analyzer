import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installReanalyzeOverlay, reanalyzeOverlayHtml } from '../webview/runtime/reanalyzeOverlay';

function setup() {
    const dom = new JSDOM('<body></body>');
    const document = dom.window.document;
    const shown: string[] = [];
    const overlay = installReanalyzeOverlay(document, {
        defaultMessage: 'Re-analyzing…',
        onShow: message => shown.push(message),
    });
    return { document, overlay, shown };
}

test('reanalyzeOverlayHtml escapes the default message', () => {
    assert.match(reanalyzeOverlayHtml('<b>'), /&lt;b&gt;/);
});

test('the overlay starts hidden', () => {
    const { document, overlay, shown } = setup();
    assert.equal(overlay.isBusy(), false);
    assert.equal(document.getElementById('reanalyze-overlay')!.style.display, 'none');
    assert.deepEqual(shown, []);
});

test('setBusy shows the given message, or the default, and reports it', () => {
    const { document, overlay, shown } = setup();
    overlay.setBusy(true, '(1/3) a.wav');
    assert.equal(overlay.isBusy(), true);
    assert.equal(document.getElementById('reanalyze-overlay-msg')!.textContent, '(1/3) a.wav');
    overlay.setBusy(true);
    assert.equal(document.getElementById('reanalyze-overlay-msg')!.textContent, 'Re-analyzing…');
    assert.deepEqual(shown, ['(1/3) a.wav', 'Re-analyzing…']);
});

test('setBusy(false) hides the overlay without reporting', () => {
    const { overlay, shown } = setup();
    overlay.setBusy(true, 'x');
    overlay.setBusy(false);
    assert.equal(overlay.isBusy(), false);
    assert.deepEqual(shown, ['x']);
});
