import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getStrings } from '../shared/i18n/strings';
import { createStaticFooter } from '../webview/runtime/staticFooter';

const strings = getStrings('en');

function page() {
    const dom = new JSDOM('<!doctype html><body><div id="app-footer"><div id="hint-footer"></div><span id="app-version">v1</span></div>'
        + '<button data-action="configure-calibration" id="calibrate">Calibrate</button><main id="outside"></main></body>');
    const window = dom.window as unknown as Window;
    const footer = createStaticFooter(dom.window.document, window, strings);
    return { dom, document: dom.window.document, footer };
}

test('the footer row holds the hidden inputs, status and About before the version, and the Python dot after them', () => {
    const { document, footer } = page();
    const row = Array.from(document.getElementById('app-footer')!.children);
    assert.equal(row.length, 4);
    assert.equal(row[0].id, 'hint-footer');
    assert.equal(row[1], footer.bar);
    assert.equal(row[2].hasAttribute('data-python-indicator'), true);
    assert.equal(row[3].id, 'app-version');
    assert.equal(footer.pick.getAttribute('data-action'), 'browser-open-wav');
    assert.equal(footer.pick.multiple, true);
    assert.match(footer.pick.accept, /\.wav/);
    assert.equal(footer.folderPick.hasAttribute('webkitdirectory'), true);
    footer.announce('3 tracks');
    assert.equal(document.querySelector('[role="status"]')?.textContent, '3 tracks');
});

test('the Python state shows on the dot and, while it boots, in a centred card', () => {
    const { document, footer } = page();
    const state = document.querySelector('[data-python-state]')!;
    const card = document.querySelector<HTMLElement>('[data-python-loading]')!;
    footer.showPythonState('starting');
    assert.equal(state.textContent, strings.browserPythonStarting);
    assert.equal(card.style.display, 'flex');
    footer.showPythonState('starting', true);
    assert.equal(card.style.display, 'none', 'a quiet restart keeps to the dot');
    footer.showPythonState('ready');
    assert.equal(state.textContent, strings.browserPythonReady);
    assert.equal(card.style.display, 'none');
    footer.showPythonState('failed');
    assert.equal(state.textContent, strings.browserPythonFailed);
    footer.showPythonState('stopped');
    assert.equal(state.textContent, strings.browserPythonStopped);
    assert.equal(document.querySelector('[data-python-indicator]')?.getAttribute('data-hint'), strings.browserPythonStopped);
});

test('About closes on Escape, giving focus back to its toggle, and on a press outside it', () => {
    const { dom, document } = page();
    const about = document.querySelector<HTMLDetailsElement>('[data-browser-about]')!;
    const toggle = about.querySelector<HTMLElement>('summary')!;
    assert.equal(toggle.textContent, strings.browserAbout);
    assert.equal(about.querySelectorAll('li').length, 5);
    about.open = true;
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    assert.equal(about.open, false);
    assert.equal(document.activeElement, toggle);
    about.open = true;
    about.querySelector('li')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    assert.equal(about.open, true, 'a press inside keeps it open');
    document.getElementById('outside')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    assert.equal(about.open, false);
});

test('an action the browser cannot run is stopped and explained in the footer and to screen readers', () => {
    const { dom, document, footer } = page();
    const calibrate = document.getElementById('calibrate')!;
    let reached = false;
    calibrate.addEventListener('click', () => { reached = true; });
    calibrate.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(reached, false);
    assert.equal(document.getElementById('hint-footer')?.textContent, strings.browserUnavailable);
    assert.ok(Array.from(footer.bar.querySelectorAll('[aria-live="polite"]')).some(region => region.textContent === strings.browserUnavailable));
    calibrate.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true }));
    assert.equal(calibrate.getAttribute('aria-disabled'), 'true');
    assert.equal(calibrate.getAttribute('aria-description'), strings.browserUnavailable);
    document.getElementById('hint-footer')!.textContent = '';
    footer.reportUnavailable();
    assert.equal(document.getElementById('hint-footer')?.textContent, strings.browserUnavailable);
});
