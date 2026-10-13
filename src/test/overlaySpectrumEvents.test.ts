import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachOverlaySpectrumDoubleClick } from '../webview/runtime/overlaySpectrumEvents';
import { OVERLAY_SPECTRUM_PAD } from '../webview/runtime/spectrumRuntime';

function setup(hasData: boolean) {
    const { window } = new JSDOM('<!doctype html><body><canvas width="200" height="100"></canvas></body>');
    const canvas = window.document.querySelector('canvas') as unknown as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    const calls: string[] = [];
    attachOverlaySpectrumDoubleClick(canvas, {
        hasData: () => hasData,
        openRangePopup: (axis, clientX, clientY) => { calls.push(`popup:${axis}:${clientX}:${clientY}`); },
        resetZoom: () => { calls.push('reset'); },
    });
    const dblclick = (clientX: number, clientY: number) => canvas.dispatchEvent(new window.MouseEvent('dblclick', { clientX, clientY }));
    return { calls, dblclick };
}

test('attachOverlaySpectrumDoubleClick routes the dB axis, frequency axis and plot regions', () => {
    const { calls, dblclick } = setup(true);
    dblclick(OVERLAY_SPECTRUM_PAD.left - 1, 50);
    dblclick(100, 100 - OVERLAY_SPECTRUM_PAD.bottom + 1);
    dblclick(100, 50);
    dblclick(200 - OVERLAY_SPECTRUM_PAD.right + 1, 50);
    assert.deepEqual(calls, [`popup:db:${OVERLAY_SPECTRUM_PAD.left - 1}:50`, `popup:freq:100:${100 - OVERLAY_SPECTRUM_PAD.bottom + 1}`, 'reset']);
});

test('attachOverlaySpectrumDoubleClick ignores double-clicks while there is no spectrum data', () => {
    const { calls, dblclick } = setup(false);
    dblclick(100, 50);
    assert.deepEqual(calls, []);
});
