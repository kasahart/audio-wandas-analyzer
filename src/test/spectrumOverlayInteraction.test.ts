import assert from 'node:assert/strict';
import test from 'node:test';
import { overlayPlotPoint, overlaySpectrumRegionAt, setOverlaySecondaryLevelAxis, spectrumZoomFromWindow } from '../webview/runtime/spectrumRuntime';

const W = 144;
const H = 126;

test('overlayPlotPoint normalizes a canvas point inside the padded plot and clamps outside it', () => {
    assert.deepEqual(overlayPlotPoint(52, 8, W, H), { freqNorm: 0, dbNorm: 1 });
    // The plot is 84 px wide and 102 px tall (126 - 8 above - 16 for the frequency ticks and title below).
    assert.deepEqual(overlayPlotPoint(94, 8 + 102 / 2, W, H), { freqNorm: 0.5, dbNorm: 0.5 });
    assert.deepEqual(overlayPlotPoint(0, 500, W, H), { freqNorm: 0, dbNorm: 0 });
    assert.equal(overlayPlotPoint(10, 10, 40, H), null);
});

test('spectrumZoomFromWindow takes the frequency part as it is and maps the level part onto the dB on screen', () => {
    assert.deepEqual(
        spectrumZoomFromWindow({ x: { start: 0.3, end: 0.5 }, y: { start: 0.2, end: 0.6 } }, { min: -100, max: 0 }),
        { freqStart: 0.3, freqEnd: 0.5, dbMin: -80, dbMax: -40 },
    );
    // A Ctrl+wheel zoom keeps every level on screen: the dB axis keeps following the data.
    assert.deepEqual(spectrumZoomFromWindow({ x: { start: 0.1, end: 0.4 }, y: { start: 0, end: 1 } }, { min: -100, max: 0 }), { freqStart: 0.1, freqEnd: 0.4 });
    assert.deepEqual(spectrumZoomFromWindow({ x: { start: 0, end: 1 }, y: { start: 0.2, end: 0.6 } }, null), { freqStart: 0, freqEnd: 1 });
});

test('overlaySpectrumRegionAt splits the canvas into dB axis, frequency axis and plot', () => {
    assert.equal(overlaySpectrumRegionAt(10, 50, W, H), 'db-axis');
    assert.equal(overlaySpectrumRegionAt(80, 120, W, H), 'freq-axis');
    assert.equal(overlaySpectrumRegionAt(80, 50, W, H), 'plot');
    assert.equal(overlaySpectrumRegionAt(80, 4, W, H), null);
    assert.equal(overlaySpectrumRegionAt(140, 50, W, H), null);
});

test('with a right-hand level axis drawn, its margin is a level axis too: it answers the axis gestures as the left one (A48, R13)', () => {
    setOverlaySecondaryLevelAxis(true);
    try {
        assert.equal(overlaySpectrumRegionAt(W + 20, 50, W + 40, H), 'db-axis-right');
        assert.equal(overlaySpectrumRegionAt(W + 20, H - 4, W + 40, H), null, 'under it, the frequency axis\'s row, is no level axis');
    } finally {
        setOverlaySecondaryLevelAxis(false);
    }
    assert.equal(overlaySpectrumRegionAt(140, 50, W, H), null, 'without one, the narrow margin is nothing');
});
