import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { arrowCursorStep, globalShortcutAction, isTextEntryTag, keydownContextFor, keydownIntent, type KeydownContext } from '../webview/runtime/shortcuts';

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

/** The keyboard-focus exception of docs/display-rules.md R7: a focused lane's ← / → move its time cursor, not the readout. */
const FOCUS_EXCEPTION = 'R7\'s keyboard-focus exception (docs/display-rules.md): a lane with the keyboard focus moves its time cursor with ← / →, one pixel of the zoomed view, 0.1 s with Shift: it is transport (where to listen), not reading; the readout steps by keys on a plot that is not a lane. Change the rule there first if this is meant.';

test('R7 states the keyboard-focus exception these tests hold, with its reason (transport, not reading) and where keys read instead', () => {
    const rules = readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'display-rules.md'), 'utf8');
    const r7 = rules.slice(rules.indexOf('## R7 '), rules.indexOf('\n## ', rules.indexOf('## R7 ') + 1));
    for (const phrase of [
        'キーボードのフォーカスの例外（← / →）',
        '← / → は再生の時刻カーソルを動かします。これは読み取りではなく再生の操作（聞く位置を動かすこと）だからです',
        'キーで読み値を 1 点ずつ進めるのは、レーンではなくグラフ（カーソルスペクトル、ペアの図、比較の図、入口の図）にフォーカスがあるとき',
        '1 回で今の拡大の窓の 1 画素ぶん、Shift を押すと 0.1 秒です（`shortcuts.ts` の `keydownIntent` と `arrowCursorStep`）',
    ]) assert.ok(r7.includes(phrase), `R7 no longer says: ${phrase}. ${FOCUS_EXCEPTION}`);
});

test('arrowCursorStep moves one pixel of the zoomed view, or 0.1 s with Shift (R7)', () => {
    assert.equal(arrowCursorStep(false, 10, 0.25, 0.75, 500), 0.001, FOCUS_EXCEPTION);
    assert.equal(arrowCursorStep(true, 10, 0.25, 0.75, 500), 0.01, FOCUS_EXCEPTION);
    assert.equal(arrowCursorStep(true, 0, 0, 1, 500), 0.001, FOCUS_EXCEPTION);
});

const idle: KeydownContext = { helpOpen: false, textEntryFocused: false, trackCanvasFocused: false };
const key = (k: string, code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    ({ key: k, code, ctrlKey: false, metaKey: false, altKey: false, ...mods });

test('keydownIntent ignores keys pressed with Ctrl, Meta or Alt', () => {
    const ctx = { ...idle, trackCanvasFocused: true };
    assert.equal(keydownIntent(key('ArrowLeft', 'ArrowLeft', { ctrlKey: true }), ctx), null);
    assert.equal(keydownIntent(key('+', 'Equal', { metaKey: true }), ctx), null);
    assert.equal(keydownIntent(key(' ', 'Space', { altKey: true }), ctx), null);
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

test('keydownIntent moves the time cursor with arrows only while a track canvas has focus (R7)', () => {
    assert.deepEqual(keydownIntent(key('ArrowLeft', 'ArrowLeft'), { ...idle, trackCanvasFocused: true }), { kind: 'cursor-step', direction: -1 }, FOCUS_EXCEPTION);
    assert.deepEqual(keydownIntent(key('ArrowRight', 'ArrowRight'), { ...idle, trackCanvasFocused: true }), { kind: 'cursor-step', direction: 1 }, FOCUS_EXCEPTION);
    assert.equal(keydownIntent(key('ArrowLeft', 'ArrowLeft'), idle), null, `with no lane focused ← / → are the readout's, never the time cursor's. ${FOCUS_EXCEPTION}`);
    assert.equal(keydownIntent(key('x', 'KeyX'), { ...idle, trackCanvasFocused: true }), null);
});

function focused(id: string, tagName: string, classes: string[] = []) {
    return { id, tagName, classList: { contains: (token: string) => classes.includes(token) } };
}

test('keydownContextFor derives the keyboard context from the focused element and the help', () => {
    assert.deepEqual(keydownContextFor(focused('t0', 'CANVAS', ['track-canvas']), { hidden: true }), {
        helpOpen: false, textEntryFocused: false, trackCanvasFocused: true,
    });
    assert.equal(keydownContextFor(focused('q', 'input'), null).textEntryFocused, true);
    assert.equal(keydownContextFor(null, { hidden: false }).helpOpen, true);
});
