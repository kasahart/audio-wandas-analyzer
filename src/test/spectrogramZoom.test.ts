/**
 * A zoomed spectrogram lane asks for its time window again when the whole file's columns are too few for its pixels
 * (R3), and not otherwise: the window covers the view with margin to pan, and has the columns the view wants.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spectrogramWindowServes, spectrogramZoomWindow } from '../webview/spectrum/spectrogramZoom';

// A 30 s file at 16 kHz with a 64-sample hop: 7500 frames, averaged down to 720 columns.
const long = { columns: 720, frames: 7500 };

test('the whole file spectrogram serves a lane not zoomed, or zoomed while its columns still fill the pixels', () => {
    assert.equal(spectrogramZoomWindow(long, { startNorm: 0, endNorm: 1 }, 1600), null);
    // Half the file in 700 px: 360 columns for 350 wanted.
    assert.equal(spectrogramZoomWindow(long, { startNorm: 0.25, endNorm: 0.75 }, 700), null);
    // A short file whose every frame is already a column never asks.
    assert.equal(spectrogramZoomWindow({ columns: 400, frames: 400 }, { startNorm: 0.4, endNorm: 0.41 }, 1600), null);
});

test('zoomed past the whole file columns, the lane asks for a window around the view that brings every frame it can show', () => {
    const view = { startNorm: 0.4, endNorm: 0.45 };
    const window = spectrogramZoomWindow(long, view, 1600);
    assert.ok(window);
    assert.ok(window.startNorm <= view.startNorm && window.endNorm >= view.endNorm, 'the window covers the view');
    assert.ok(window.endNorm - window.startNorm <= 2 * (view.endNorm - view.startNorm) + 1e-12, 'with at most half the view beside each end');
    assert.ok(spectrogramWindowServes(long, window, view, 1600), 'and the answer serves the view');
    // The whole file never would, so the lane would otherwise stretch 36 columns over 1600 px.
    assert.equal(spectrogramWindowServes(long, { startNorm: 0, endNorm: 1 }, view, 1600), false);
});

test('a window kept from before serves a short pan but not a pan out of it, nor a deeper zoom it has too few columns for', () => {
    const window = spectrogramZoomWindow(long, { startNorm: 0.4, endNorm: 0.45 }, 1600);
    assert.ok(window);
    assert.equal(spectrogramWindowServes(long, window, { startNorm: 0.41, endNorm: 0.46 }, 1600), true);
    assert.equal(spectrogramWindowServes(long, window, { startNorm: 0.6, endNorm: 0.65 }, 1600), false);
    // A window asked for a wider view (0.3 to 0.5: 720 columns, one per 2 px) has 180 columns in 0.4 to 0.45, which wants 375.
    const wider = spectrogramZoomWindow(long, { startNorm: 0.3, endNorm: 0.5 }, 1600);
    assert.ok(wider);
    assert.equal(spectrogramWindowServes(long, wider, { startNorm: 0.4, endNorm: 0.45 }, 1600), false);
    // A window that brought every frame still serves a deeper zoom: there is nothing finer to ask for.
    assert.equal(spectrogramWindowServes(long, window, { startNorm: 0.42, endNorm: 0.425 }, 1600), true);
});

test('a window at the file edge is shifted inside the file, not cut short', () => {
    const window = spectrogramZoomWindow(long, { startNorm: 0, endNorm: 0.02 }, 1600);
    assert.ok(window);
    assert.equal(window.startNorm, 0);
    assert.ok(Math.abs(window.endNorm - 0.04) < 1e-12);
});

test('with the automatic settings, where a window gets its own hop, the lane asks for a window as soon as the file\'s columns are too few', () => {
    // 30 s at 16 kHz: the whole file's ~720 frames are its 720 columns, but a window can bring a frame per sample.
    const auto = { columns: 720, frames: 30 * 16000 };
    const view = { startNorm: 0.4, endNorm: 0.45 };
    const window = spectrogramZoomWindow(auto, view, 1600);
    assert.ok(window);
    assert.ok(spectrogramWindowServes(auto, window, view, 1600));
    // The same file with set settings whose frames are exactly its columns has nothing finer to bring.
    assert.equal(spectrogramZoomWindow({ columns: 720, frames: 720 }, view, 1600), null);
});
