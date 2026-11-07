import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { attachOverlaySpectrumHints } from '../webview/runtime/overlaySpectrumEvents';
import { OVERLAY_SPECTRUM_PAD } from '../webview/runtime/spectrumRuntime';

test('attachOverlaySpectrumHints names the gesture of the region under the pointer', () => {
    const { window } = new JSDOM('<!doctype html><body><canvas width="200" height="100"></canvas></body>');
    const canvas = window.document.querySelector('canvas') as unknown as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
    const shown: string[] = [];
    attachOverlaySpectrumHints(canvas, { show: (text) => { shown.push(text); }, clear: () => { shown.push(''); } }, { 'db-axis': 'db', 'freq-axis': 'freq', plot: 'plot' });
    const move = (clientX: number, clientY: number) => canvas.dispatchEvent(new window.MouseEvent('mousemove', { clientX, clientY }));
    move(OVERLAY_SPECTRUM_PAD.left - 1, 50);
    move(100, 100 - OVERLAY_SPECTRUM_PAD.bottom + 1);
    move(100, 50);
    move(200 - OVERLAY_SPECTRUM_PAD.right + 1, 50);
    assert.deepEqual(shown, ['db', 'freq', 'plot', '']);
});
