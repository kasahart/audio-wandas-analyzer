import assert from 'node:assert/strict';
import test from 'node:test';
import { arrowCursorStep, globalShortcutAction, isTextEntryTag } from '../webview/runtime/shortcuts';

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
