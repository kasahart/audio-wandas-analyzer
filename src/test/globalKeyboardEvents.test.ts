import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachGlobalKeyboardListeners } from '../webview/runtime/globalKeyboardEvents';
import { keyRouterFor } from '../webview/runtime/keyRouter';

function setup(options: { helpHidden?: boolean; spectrumHasMouse?: boolean } = {}) {
    const { window } = new JSDOM('<!doctype html><body><div id="help-overlay"></div><canvas class="track-canvas" tabindex="0"></canvas><input id="text"></body>');
    const doc = window.document;
    const help = doc.getElementById('help-overlay') as HTMLElement;
    help.hidden = options.helpHidden ?? true;
    const calls: string[] = [];
    attachGlobalKeyboardListeners(keyRouterFor(window as unknown as Window), doc, {
        helpOverlay: () => help,
        spectrumHasMouse: () => options.spectrumHasMouse ?? false,
        stepSpectrum: (delta) => { calls.push(`spectrum:${delta}`); },
        runShortcut: (action) => { calls.push(`shortcut:${action}`); },
        togglePlayback: (target, active) => { calls.push(`play:${target}:${active?.tagName}`); },
        stepCursor: (direction, shiftKey, active) => { calls.push(`cursor:${direction}:${shiftKey}:${active?.tagName}`); },
        arrowReleased: () => { calls.push('released'); },
    });
    const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit) => {
        const event = new window.KeyboardEvent(type, { cancelable: true, ...init });
        doc.dispatchEvent(event);
        return event.defaultPrevented;
    };
    const focus = (selector: string) => (doc.querySelector(selector) as HTMLElement).focus();
    return { calls, key, focus };
}

test('attachGlobalKeyboardListeners routes keydown intents and prevents their default', () => {
    const { calls, key, focus } = setup();
    assert.equal(key('keydown', { code: 'Space', key: ' ' }), true);
    assert.equal(key('keydown', { code: 'Digit0', key: '0' }), true);
    focus('.track-canvas');
    assert.equal(key('keydown', { code: 'ArrowRight', key: 'ArrowRight', shiftKey: true }), true);
    assert.equal(key('keydown', { code: 'Space', key: ' ' }), true);
    assert.equal(key('keydown', { code: 'KeyQ', key: 'q' }), false);
    assert.deepEqual(calls, ['play:current:BODY', 'shortcut:zoom-reset', 'cursor:1:true:CANVAS', 'play:focused-track:CANVAS']);
});

test('attachGlobalKeyboardListeners steps the spectrum while the pointer is over it', () => {
    const { calls, key } = setup({ spectrumHasMouse: true });
    key('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' });
    assert.deepEqual(calls, ['spectrum:-1']);
});

test('attachGlobalKeyboardListeners ignores shortcuts while help is open or text is focused', () => {
    const help = setup({ helpHidden: false });
    help.key('keydown', { code: 'Space', key: ' ' });
    assert.deepEqual(help.calls, []);
    const text = setup();
    text.focus('#text');
    text.key('keydown', { code: 'Space', key: ' ' });
    assert.deepEqual(text.calls, []);
});

test('attachGlobalKeyboardListeners reports arrow key release only', () => {
    const { calls, key } = setup();
    key('keyup', { code: 'ArrowLeft' });
    key('keyup', { code: 'KeyA' });
    key('keyup', { code: 'ArrowRight' });
    assert.deepEqual(calls, ['released', 'released']);
});

test('a context in front of the lanes takes a key first; one that passes leaves it to the lanes', () => {
    const { window } = new JSDOM('<!doctype html><body></body>');
    const router = keyRouterFor(window);
    const calls: string[] = [];
    attachGlobalKeyboardListeners(router, window.document, {
        helpOverlay: () => null, spectrumHasMouse: () => false, stepSpectrum() {}, togglePlayback() {}, stepCursor() {}, arrowReleased() {},
        runShortcut: (action) => { calls.push(`lanes:${action}`); },
    });
    router.add({ layer: 'stage', keydown: event => { calls.push(`stage:${event.key}`); return event.key === '0'; } });
    const remove = router.add({ layer: 'popover', keydown: event => { calls.push(`popover:${event.key}`); return event.key === 'Escape'; } });
    const key = (name: string) => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, cancelable: true }));
    key('0');
    key('+');
    key('Escape');
    remove();
    key('Escape');
    assert.deepEqual(calls, ['popover:0', 'stage:0', 'popover:+', 'stage:+', 'lanes:zoom-in', 'popover:Escape', 'stage:Escape']);
    assert.deepEqual(router.layers(), ['stage', 'lanes']);
});

test('a focused role chip keeps its digits from the lanes', () => {
    const { window } = new JSDOM('<!doctype html><body><details class="role-chip"><summary tabindex="0">c</summary></details></body>');
    const calls: string[] = [];
    attachGlobalKeyboardListeners(keyRouterFor(window as unknown as Window), window.document, {
        helpOverlay: () => null, spectrumHasMouse: () => false, stepSpectrum() {}, togglePlayback() {}, stepCursor() {}, arrowReleased() {},
        runShortcut: (action) => { calls.push(action); },
    });
    window.document.querySelector('summary')!.dispatchEvent(new window.KeyboardEvent('keydown', { key: '0', bubbles: true, cancelable: true }));
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '0', cancelable: true }));
    assert.deepEqual(calls, ['zoom-reset']);
});

test('two bundles on one window share its router: the help closes before a popover of the other bundle', async () => {
    const { window } = new JSDOM('<!doctype html><body></body>');
    // A second copy of the module, as the static build's host and comparison bundles each carry one.
    delete require.cache[require.resolve('../webview/runtime/keyRouter')];
    const second = await import('../webview/runtime/keyRouter');
    assert.notEqual(keyRouterFor, second.keyRouterFor);
    const calls: string[] = [];
    keyRouterFor(window).add({ layer: 'popover', keydown: event => { calls.push(`about:${event.key}`); return event.key === 'Escape'; } });
    const removeHelp = second.keyRouterFor(window).add({ layer: 'help', keydown: event => { calls.push(`help:${event.key}`); return event.key === 'Escape'; } });
    const escape = () => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    escape();
    removeHelp();
    escape();
    assert.deepEqual(calls, ['help:Escape', 'about:Escape']);
    assert.equal(keyRouterFor(window), second.keyRouterFor(window));
});
