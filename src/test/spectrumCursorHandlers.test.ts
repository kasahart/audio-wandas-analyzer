import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpectrumCursorHandlers, spectrumFocusTargetFromElement } from '../webview/runtime/spectrumCursorHandlers';
import { SpectrumHover } from '../webview/runtime/spectrumHover';
import type { TrackId } from '../webview/runtime/types';

function fakeElement(id: string, classes: string[], attrs: Record<string, string> = {}) {
    return {
        id,
        classList: { contains: (name: string) => classes.includes(name) } as DOMTokenList,
        getAttribute: (name: string) => attrs[name] ?? null,
    };
}

const trackIndexFromElement = (el: Pick<Element, 'getAttribute'>) => {
    const raw = el.getAttribute('data-track-index');
    return raw === null ? null : Number(raw);
};

function setup(active: ReturnType<typeof fakeElement> | null = null) {
    const hover = new SpectrumHover();
    let refreshes = 0;
    const state = { active };
    const handlers = createSpectrumCursorHandlers({
        hover,
        trackIdAtIndex: (i) => `track-${i}` as TrackId,
        trackIndexFromElement,
        activeElement: () => state.active,
        refresh: () => { refreshes++; },
    });
    return { hover, handlers, state, refreshes: () => refreshes };
}

const canvas = { width: 220, height: 100, getBoundingClientRect: () => ({ left: 10, top: 20 }) };

test('spectrumFocusTargetFromElement recognises the overlay and per-track spectrum canvases', () => {
    assert.deepEqual(spectrumFocusTargetFromElement(fakeElement('spectrum-overlay-canvas', []), trackIndexFromElement), { trackIndex: -1, channelIndex: null });
    assert.deepEqual(
        spectrumFocusTargetFromElement(fakeElement('', ['track-spectrum-canvas'], { 'data-track-index': '2', 'data-channel-index': '1' }), trackIndexFromElement),
        { trackIndex: 2, channelIndex: 1 },
    );
    assert.equal(spectrumFocusTargetFromElement(fakeElement('', ['track-spectrum-canvas']), trackIndexFromElement), null);
    assert.equal(spectrumFocusTargetFromElement(fakeElement('other', []), trackIndexFromElement), null);
    assert.equal(spectrumFocusTargetFromElement(null, trackIndexFromElement), null);
});

test('move maps the pointer into the plot and targets the overlay or the track', () => {
    const { hover, handlers, refreshes } = setup();
    handlers.move(canvas, 10, 10, { clientX: 120, clientY: 70 }, -1, null);
    assert.equal(hover.target, 'overlay');
    assert.equal(hover.norm, 0.5);
    assert.equal(hover.yFrac, 0.5);
    assert.equal(hover.hasMouse, true);
    handlers.move(canvas, 10, 10, { clientX: 120, clientY: 70 }, 3, 1);
    assert.equal(hover.target, 'track-3');
    assert.equal(hover.channelIndex, 1);
    assert.equal(refreshes(), 2);
});

test('move over a canvas with no plot width clears the hover', () => {
    const { hover, handlers } = setup();
    handlers.move(canvas, 10, 10, { clientX: 120, clientY: 70 }, -1, null);
    handlers.move(canvas, 200, 30, { clientX: 120, clientY: 70 }, -1, null);
    assert.equal(hover.norm, null);
    assert.equal(hover.hasMouse, false);
});

test('leave falls back to the focused spectrum canvas, otherwise clears', () => {
    const { hover, handlers, state } = setup(fakeElement('spectrum-overlay-canvas', []));
    handlers.move(canvas, 10, 10, { clientX: 120, clientY: 70 }, 2, null);
    handlers.leave();
    assert.equal(hover.target, 'overlay');
    assert.equal(hover.hasMouse, false);
    state.active = null;
    handlers.leave();
    assert.equal(hover.target, null);
});

test('blur keeps the hover while the mouse is over the canvas', () => {
    const { hover, handlers } = setup();
    handlers.focus(1, 0);
    assert.equal(hover.target, 'track-1');
    handlers.move(canvas, 10, 10, { clientX: 120, clientY: 70 }, 1, 0);
    handlers.blur();
    assert.equal(hover.target, 'track-1');
    hover.hasMouse = false;
    handlers.blur();
    assert.equal(hover.target, null);
    handlers.focus(null, null);
    assert.equal(hover.target, null);
});
