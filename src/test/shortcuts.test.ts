import assert from 'node:assert/strict';
import test from 'node:test';
import { arrowCursorStep, globalShortcutAction, isTextEntryTag, keydownIntent, type KeydownContext } from '../webview/runtime/shortcuts';

test('globalShortcutAction maps both key variants of each documented shortcut', () => {
    assert.equal(globalShortcutAction('+'), 'zoom-in');
    assert.equal(globalShortcutAction('='), 'zoom-in');
    assert.equal(globalShortcutAction('-'), 'zoom-out');
    assert.equal(globalShortcutAction('_'), 'zoom-out');
    assert.equal(globalShortcutAction('0'), 'zoom-reset');
    assert.equal(globalShortcutAction('f'), 'toggle-follow-cursor');
    assert.equal(globalShortcutAction('F'), 'toggle-follow-cursor');
    assert.equal(globalShortcutAction('l'), 'zoom-to-selection');
    assert.equal(globalShortcutAction('L'), 'zoom-to-selection');
    assert.equal(globalShortcutAction('x'), null);
    assert.equal(globalShortcutAction('toString'), null);
});

test('isTextEntryTag treats form fields as text entry regardless of case', () => {
    assert.equal(isTextEntryTag('input'), true);
    assert.equal(isTextEntryTag('TEXTAREA'), true);
    assert.equal(isTextEntryTag('Select'), true);
    assert.equal(isTextEntryTag('CANVAS'), false);
    assert.equal(isTextEntryTag(undefined), false);
});

test('arrowCursorStep moves one pixel of the zoomed view, or 0.1 s with Shift', () => {
    assert.equal(arrowCursorStep(false, 10, 0.25, 0.75, 500), 0.001);
    assert.equal(arrowCursorStep(true, 10, 0.25, 0.75, 500), 0.01);
    assert.equal(arrowCursorStep(true, 0, 0, 1, 500), 0.001);
});

const idle: KeydownContext = { spectrumActive: false, helpOpen: false, textEntryFocused: false, trackCanvasFocused: false };
const key = (k: string, code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    ({ key: k, code, ctrlKey: false, metaKey: false, altKey: false, ...mods });

test('keydownIntent ignores keys pressed with Ctrl, Meta or Alt', () => {
    const ctx = { ...idle, spectrumActive: true, trackCanvasFocused: true };
    assert.equal(keydownIntent(key('ArrowLeft', 'ArrowLeft', { ctrlKey: true }), ctx), null);
    assert.equal(keydownIntent(key('+', 'Equal', { metaKey: true }), ctx), null);
    assert.equal(keydownIntent(key(' ', 'Space', { altKey: true }), ctx), null);
});

test('keydownIntent steps the spectrum cursor before anything else, even with help open', () => {
    const ctx = { ...idle, spectrumActive: true, helpOpen: true, trackCanvasFocused: true };
    assert.deepEqual(keydownIntent(key('ArrowLeft', 'ArrowLeft'), ctx), { kind: 'spectrum-step', delta: -1 });
    assert.deepEqual(keydownIntent(key('ArrowRight', 'ArrowRight'), ctx), { kind: 'spectrum-step', delta: 1 });
});

test('keydownIntent disables shortcuts, playback and cursor keys while help is open', () => {
    const ctx = { ...idle, helpOpen: true, trackCanvasFocused: true };
    assert.equal(keydownIntent(key('+', 'Equal'), ctx), null);
    assert.equal(keydownIntent(key(' ', 'Space'), ctx), null);
    assert.equal(keydownIntent(key('ArrowLeft', 'ArrowLeft'), ctx), null);
});

test('keydownIntent maps global shortcuts unless a text field has focus', () => {
    assert.deepEqual(keydownIntent(key('f', 'KeyF'), idle), { kind: 'shortcut', action: 'toggle-follow-cursor' });
    assert.equal(keydownIntent(key('f', 'KeyF'), { ...idle, textEntryFocused: true }), null);
});

test('keydownIntent toggles the focused track on Space, otherwise the current track', () => {
    assert.deepEqual(keydownIntent(key(' ', 'Space'), { ...idle, trackCanvasFocused: true }), { kind: 'toggle-playback', target: 'focused-track' });
    assert.deepEqual(keydownIntent(key(' ', 'Space'), idle), { kind: 'toggle-playback', target: 'current' });
    assert.equal(keydownIntent(key(' ', 'Space'), { ...idle, textEntryFocused: true }), null);
});

test('keydownIntent moves the time cursor with arrows only while a track canvas has focus', () => {
    assert.deepEqual(keydownIntent(key('ArrowLeft', 'ArrowLeft'), { ...idle, trackCanvasFocused: true }), { kind: 'cursor-step', direction: -1 });
    assert.deepEqual(keydownIntent(key('ArrowRight', 'ArrowRight'), { ...idle, trackCanvasFocused: true }), { kind: 'cursor-step', direction: 1 });
    assert.equal(keydownIntent(key('ArrowLeft', 'ArrowLeft'), idle), null);
    assert.equal(keydownIntent(key('x', 'KeyX'), { ...idle, trackCanvasFocused: true }), null);
});
