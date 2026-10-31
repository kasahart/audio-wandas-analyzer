import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { HeightKind, HeightResize } from '../webview/runtime/heightResize';
import { attachExclusiveMenus, attachHeightResizeListeners, attachToolbarActions } from '../webview/runtime/toolbarEvents';

function el(dom: JSDOM, id: string): HTMLElement {
    return dom.window.document.getElementById(id) as unknown as HTMLElement;
}

test('attachToolbarActions dispatches the clicked control\'s action', () => {
    const dom = new JSDOM('<div id="bar"><button data-action="open-file"><span id="inner"></span></button><span id="plain"></span></div>');
    const actions: string[] = [];
    attachToolbarActions(el(dom, 'bar'), { onAction: action => actions.push(action) });
    (dom.window.document.getElementById('inner') as HTMLElement).click();
    (dom.window.document.getElementById('plain') as HTMLElement).click();
    assert.deepEqual(actions, ['open-file']);
});

test('attachToolbarActions ignores a missing container', () => {
    assert.doesNotThrow(() => attachToolbarActions(null, { onAction: () => {} }));
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

test('attachExclusiveMenus closes an open menu once an item is used, on a press outside and on Esc', () => {
    const dom = new JSDOM('<div id="bar"><details id="a" class="tb-menu" open><summary>Export</summary><div class="tb-menu-popover"><button id="item" data-action="export-png"></button></div></details></div><div id="outside"></div>');
    attachExclusiveMenus(el(dom, 'bar'));
    const { document } = dom.window;
    const menu = document.getElementById('a') as HTMLDetailsElement;
    (document.getElementById('item') as HTMLElement).click();
    assert.equal(menu.open, false);
    menu.open = true;
    document.getElementById('item')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    assert.equal(menu.open, true, 'a press inside keeps it open');
    document.getElementById('outside')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    assert.equal(menu.open, false);
    menu.open = true;
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(menu.open, false);
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
    window.document.getElementById('other')!.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientY: 5 }));
    assert.deepEqual(calls, []);
    const down = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientY: 40 });
    window.document.getElementById('handle')!.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    const move = new window.MouseEvent('pointermove', { bubbles: true, cancelable: true, clientY: 60 });
    window.document.body.dispatchEvent(move);
    assert.equal(move.defaultPrevented, true);
    window.document.body.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true }));
    assert.equal(active, false);
    assert.deepEqual(calls, ['begin spectrum 40', 'begin spectrum 40', 'update 60', 'update 60', 'end', 'end']);
});
