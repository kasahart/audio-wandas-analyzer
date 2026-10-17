import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachTrackPointerListeners } from '../webview/runtime/trackPointerEvents';

function setup(axisOpens = false) {
    const { window } = new JSDOM('<!doctype html><body><div id="tracks"><canvas class="track-canvas"></canvas><canvas class="track-axis-canvas"></canvas><span class="label"></span></div></body>');
    const doc = window.document;
    const wrapper = doc.getElementById('tracks') as HTMLElement;
    const calls: string[] = [];
    attachTrackPointerListeners(wrapper, doc as unknown as Document, {
        resetZoom: () => { calls.push('reset'); },
        openAxisRange: () => { calls.push('axis'); return axisOpens; },
        hover: () => { calls.push('hover'); },
        clearHover: () => { calls.push('clear'); },
        press: () => { calls.push('press'); },
        drag: () => { calls.push('drag'); },
        release: () => { calls.push('release'); },
        zoomWheel: () => { calls.push('zoom'); },
        panWheel: () => { calls.push('pan'); },
    });
    const at = (selector: string) => doc.querySelector(selector) as HTMLElement;
    return { window, doc, wrapper, calls, at };
}

test('attachTrackPointerListeners resets zoom only for double-clicks on waveform or axis canvases', () => {
    const { window, calls, at } = setup();
    for (const selector of ['.track-canvas', '.track-axis-canvas', '.label']) {
        at(selector).dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    }
    assert.deepEqual(calls, ['reset', 'axis', 'reset']);
});

test('attachTrackPointerListeners opens the axis range instead of resetting zoom when the axis has one', () => {
    const { window, calls, at } = setup(true);
    for (const selector of ['.track-axis-canvas', '.track-canvas']) {
        at(selector).dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    }
    assert.deepEqual(calls, ['axis', 'reset']);
});

test('attachTrackPointerListeners wires hover and press on the tracks and drag on the document', () => {
    const { window, doc, wrapper, calls } = setup();
    wrapper.dispatchEvent(new window.MouseEvent('mousemove'));
    wrapper.dispatchEvent(new window.MouseEvent('mouseleave'));
    wrapper.dispatchEvent(new window.MouseEvent('mousedown'));
    doc.dispatchEvent(new window.MouseEvent('mousemove'));
    doc.dispatchEvent(new window.MouseEvent('mouseup'));
    assert.deepEqual(calls, ['hover', 'clear', 'press', 'drag', 'release']);
});

test('attachTrackPointerListeners zooms with Ctrl+wheel, pans with Shift+wheel and leaves plain scrolling alone', () => {
    const { window, wrapper, calls } = setup();
    const wheel = (init: WheelEventInit) => {
        const event = new window.WheelEvent('wheel', { cancelable: true, ...init });
        wrapper.dispatchEvent(event);
        return event.defaultPrevented;
    };
    assert.equal(wheel({ ctrlKey: true }), true);
    assert.equal(wheel({ shiftKey: true }), true);
    assert.equal(wheel({}), false);
    assert.deepEqual(calls, ['zoom', 'pan']);
});
