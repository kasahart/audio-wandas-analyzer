/**
 * A zoomed spectrogram lane asks for its time window again when the whole file's columns are too few for its pixels
 * (R3), and not otherwise: the window covers the view with margin to pan, and has the columns the view wants.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spectrogramBandServes, spectrogramRowSpan, spectrogramWindowServes, spectrogramZoomBand, spectrogramZoomWindow, type SpectrogramBandSource } from '../webview/spectrum/spectrogramZoom';

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

test('up the frequency axis: the whole range\'s rows serve a wide band; a narrow one asks for its own bins, a little wider than shown (R3)', () => {
    // 192 rows over 0–8 kHz from 1025 FFT bins (n_fft 2048): about 42 Hz a row, 7.8 Hz a bin; a 200 px lane.
    const source: SpectrogramBandSource = { rows: 192, bins: 1025, nyquistHz: 8000 };
    assert.equal(spectrogramZoomBand(source, { lowHz: 0, highHz: 8000 }, 200), null, 'all of it: 192 rows for 100 wanted');
    assert.equal(spectrogramBandServes(source, null, { lowHz: 0, highHz: 4000 }, 200), true, 'half: 96 rows, about the 100 wanted');
    // 900–1100 Hz: 4.8 rows of the whole range, 25.6 bins, 100 px of rows wanted.
    assert.equal(spectrogramBandServes(source, null, { lowHz: 900, highHz: 1100 }, 200), false);
    const band = spectrogramZoomBand(source, { lowHz: 900, highHz: 1100 }, 200);
    assert.ok(band);
    assert.ok(band.lowHz <= 900 && band.highHz >= 1100, 'covers what is shown');
    assert.ok(band.highHz - band.lowHz <= 400 + 1e-9, 'no wider than twice the band shown');
    assert.equal(spectrogramBandServes(source, band, { lowHz: 900, highHz: 1100 }, 200), true, 'its rows serve it');
    assert.equal(spectrogramBandServes(source, band, { lowHz: 700, highHz: 900 }, 200), false, 'panned out of it, it no longer covers');
    // Near the ends the band stays inside 0 Hz to Nyquist.
    const bottom = spectrogramZoomBand(source, { lowHz: 0, highHz: 100 }, 200);
    assert.ok(bottom && bottom.lowHz === 0 && bottom.highHz >= 100);
    const top = spectrogramZoomBand(source, { lowHz: 7900, highHz: 8000 }, 200);
    assert.ok(top && top.highHz === 8000 && top.lowHz <= 7900);
});

test('a spectrogram\'s rows run across its band when it has one, else from 0 Hz to Nyquist', () => {
    assert.deepEqual(spectrogramRowSpan({ maxFrequencyHz: 8000 }), { lowHz: 0, highHz: 8000 });
    assert.deepEqual(spectrogramRowSpan({ maxFrequencyHz: 8000, bandLowHz: 890.625, bandHighHz: 1109.375 }), { lowHz: 890.625, highHz: 1109.375 });
});
