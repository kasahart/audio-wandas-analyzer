import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { HeightKind, HeightResize } from '../webview/runtime/heightResize';
import { attachExclusiveMenus, attachHeightResizeListeners, attachToolbarActions } from '../webview/runtime/toolbarEvents';
import type { RuntimeElement } from '../webview/runtime/types';

function el(dom: JSDOM, id: string): RuntimeElement {
    return dom.window.document.getElementById(id) as unknown as RuntimeElement;
}

test('attachToolbarActions dispatches clicked actions but skips the height inputs', () => {
    const dom = new JSDOM('<div id="bar"><button data-action="open-file"><span id="inner"></span></button><input id="h" data-action="track-height-input" value="120"></div>');
    const actions: string[] = [];
    const inputs: Array<[string | null, string | null]> = [];
    attachToolbarActions(el(dom, 'bar'), {
        onAction: action => actions.push(action),
        onHeightInput: (action, value) => inputs.push([action, value]),
    });
    (dom.window.document.getElementById('inner') as HTMLElement).click();
    (dom.window.document.getElementById('h') as HTMLElement).click();
    assert.deepEqual(actions, ['open-file']);
    const input = dom.window.document.getElementById('h')!;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.deepEqual(inputs, [['track-height-input', '120'], ['track-height-input', '120']]);
});

test('attachToolbarActions ignores a missing container', () => {
    assert.doesNotThrow(() => attachToolbarActions(null, { onAction: () => {}, onHeightInput: () => {} }));
});

test('attachExclusiveMenus closes the other open menu when one opens', () => {
    const dom = new JSDOM('<div id="bar"><details id="a" class="tb-menu" open></details><details id="b" class="tb-menu"></details></div>');
    attachExclusiveMenus(el(dom, 'bar'));
    const a = dom.window.document.getElementById('a') as HTMLDetailsElement;
    const b = dom.window.document.getElementById('b') as HTMLDetailsElement;
    b.open = true;
    b.dispatchEvent(new dom.window.Event('toggle'));
    assert.equal(a.open, false);
    assert.equal(b.open, true);
});

test('attachHeightResizeListeners drives the resize from a drag handle', () => {
    const dom = new JSDOM('<div id="wrap"><div id="handle" data-action="spectrum-height-drag"></div><div id="other"></div></div>');
    const calls: string[] = [];
    let active = false;
    const resize: HeightResize = {
        begin: (kind: HeightKind, y) => { active = true; calls.push(`begin ${kind} ${y}`); },
        update: y => calls.push(`update ${y}`),
        end: () => { active = false; calls.push('end'); },
        isActive: () => active,
    };
    const { window } = dom;
    attachHeightResizeListeners(resize, [null], window.document, window as unknown as Window);
    window.document.getElementById('other')!.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, clientY: 5 }));
    assert.deepEqual(calls, []);
    const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientY: 40 });
    window.document.getElementById('handle')!.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    const move = new window.MouseEvent('mousemove', { bubbles: true, cancelable: true, clientY: 60 });
    window.document.body.dispatchEvent(move);
    assert.equal(move.defaultPrevented, true);
    window.document.body.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    assert.equal(active, false);
    assert.deepEqual(calls, ['begin spectrum 40', 'begin spectrum 40', 'update 60', 'update 60', 'end', 'end']);
});
