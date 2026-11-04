import assert from 'node:assert/strict';
import test from 'node:test';
import {
    trackAxisCanvasId,
    trackCanvasId,
    trackCanvasWrapId,
    trackSpectrogramOverlayCanvasId,
} from '../webview/runtime/trackCanvasIds';

test('track element ids omit the channel suffix for the first channel', () => {
    assert.equal(trackCanvasId(2, 0), 'track-canvas-2');
    assert.equal(trackAxisCanvasId(2, 0), 'track-axis-canvas-2');
    assert.equal(trackSpectrogramOverlayCanvasId(2, 0), 'track-spectrogram-overlay-2');
    assert.equal(trackCanvasWrapId(2, 0), 'track-canvas-wrap-2');
});

test('track element ids append the channel index for later channels', () => {
    assert.equal(trackCanvasId(0, 3), 'track-canvas-0-3');
    assert.equal(trackAxisCanvasId(0, 3), 'track-axis-canvas-0-3');
    assert.equal(trackSpectrogramOverlayCanvasId(0, 3), 'track-spectrogram-overlay-0-3');
    assert.equal(trackCanvasWrapId(0, 3), 'track-canvas-wrap-0-3');
});
