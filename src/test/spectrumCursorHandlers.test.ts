import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachSpectrumCursorListeners, createSpectrumCursorHandlers, isSpectrumCanvasFocused } from '../webview/runtime/spectrumCursorHandlers';
import type { SpectrumCursorHandlers } from '../webview/runtime/spectrumCursorHandlers';
import { SpectrumHover } from '../webview/runtime/spectrumHover';

function setup(active: { id: string } | null = null) {
    const hover = new SpectrumHover();
    let refreshes = 0;
    const state = { active };
    const handlers = createSpectrumCursorHandlers({
        hover,
        activeElement: () => state.active,
        refresh: () => { refreshes++; },
    });
    return { hover, handlers, state, refreshes: () => refreshes };
}

const canvas = { width: 220, height: 100, getBoundingClientRect: () => ({ left: 10, top: 20 }) };

test('isSpectrumCanvasFocused recognises only the cursor spectrum canvas', () => {
    assert.equal(isSpectrumCanvasFocused({ id: 'spectrum-overlay-canvas' }), true);
    assert.equal(isSpectrumCanvasFocused({ id: 'other' }), false);
    assert.equal(isSpectrumCanvasFocused(null), false);
});

test('move maps the pointer into the plot', () => {
    const { hover, handlers, refreshes } = setup();
    handlers.move(canvas, 10, 10, { clientX: 120, clientY: 70 });
    assert.equal(hover.target, 'overlay');
    assert.equal(hover.norm, 0.5);
    assert.equal(hover.yFrac, 0.5);
    assert.equal(hover.hasMouse, true);
    assert.equal(refreshes(), 1);
});

test('move over a canvas with no plot width clears the hover', () => {
    const { hover, handlers } = setup();
    handlers.move(canvas, 10, 10, { clientX: 120, clientY: 70 });
    handlers.move(canvas, 200, 30, { clientX: 120, clientY: 70 });
    assert.equal(hover.norm, null);
    assert.equal(hover.hasMouse, false);
});

test('leave keeps the cursor while the spectrum canvas has focus, otherwise clears', () => {
    const { hover, handlers, state } = setup({ id: 'spectrum-overlay-canvas' });
    handlers.move(canvas, 10, 10, { clientX: 120, clientY: 70 });
    handlers.leave();
    assert.equal(hover.target, 'overlay');
    assert.equal(hover.hasMouse, false);
    state.active = null;
    handlers.leave();
    assert.equal(hover.target, null);
});

test('blur keeps the hover while the mouse is over the canvas', () => {
    const { hover, handlers } = setup();
    handlers.focus();
    assert.equal(hover.target, 'overlay');
    handlers.move(canvas, 10, 10, { clientX: 120, clientY: 70 });
    handlers.blur();
    assert.equal(hover.target, 'overlay');
    hover.hasMouse = false;
    handlers.blur();
    assert.equal(hover.target, null);
});

test('attachSpectrumCursorListeners routes canvas events to the cursor', () => {
    const { window } = new JSDOM('<!doctype html><body><canvas width="220" height="100"></canvas></body>');
    const el = window.document.querySelector('canvas') as unknown as HTMLCanvasElement;
    const calls: string[] = [];
    const cursor: SpectrumCursorHandlers = {
        move: (_c, padLeft, padRight, pointer) => { calls.push(`move:${padLeft}:${padRight}:${pointer.clientX}`); },
        leave: () => { calls.push('leave'); },
        focus: () => { calls.push('focus'); },
        blur: () => { calls.push('blur'); },
    };
    let suppressed = false;
    attachSpectrumCursorListeners(el, cursor, { left: 32, right: 6 }, () => suppressed);
    el.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 50 }));
    suppressed = true;
    el.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 60 }));
    el.dispatchEvent(new window.FocusEvent('focus'));
    el.dispatchEvent(new window.MouseEvent('mouseleave'));
    el.dispatchEvent(new window.FocusEvent('blur'));
    assert.deepEqual(calls, ['move:32:6:50', 'focus', 'leave', 'blur']);
});
