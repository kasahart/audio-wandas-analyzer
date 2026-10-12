import assert from 'node:assert/strict';
import test from 'node:test';
import { overlayPlotPoint, overlaySpectrumRegionAt, spectrumBoxZoom } from '../webview/runtime/spectrumRuntime';

const W = 144;
const H = 126;

test('overlayPlotPoint normalizes a canvas point inside the padded plot and clamps outside it', () => {
    assert.deepEqual(overlayPlotPoint(36, 8, W, H), { freqNorm: 0, dbNorm: 1 });
    assert.deepEqual(overlayPlotPoint(86, 58, W, H), { freqNorm: 0.5, dbNorm: 0.5 });
    assert.deepEqual(overlayPlotPoint(0, 500, W, H), { freqNorm: 0, dbNorm: 0 });
    assert.equal(overlayPlotPoint(10, 10, 40, H), null);
});

test('spectrumBoxZoom ignores boxes under 5 px in either direction', () => {
    const view = { freqStart: 0, freqEnd: 1 };
    assert.equal(spectrumBoxZoom({ freqNorm: 0.1, dbNorm: 0.1 }, { freqNorm: 0.13, dbNorm: 0.9 }, W, H, view, null), null);
    assert.equal(spectrumBoxZoom({ freqNorm: 0.1, dbNorm: 0.1 }, { freqNorm: 0.9, dbNorm: 0.13 }, W, H, view, null), null);
});

test('spectrumBoxZoom narrows the current frequency view and maps dB onto the visible range', () => {
    assert.deepEqual(
        spectrumBoxZoom({ freqNorm: 0.75, dbNorm: 0.2 }, { freqNorm: 0.25, dbNorm: 0.6 }, W, H, { freqStart: 0.2, freqEnd: 0.6 }, { min: -100, max: 0 }),
        { freqStart: 0.3, freqEnd: 0.5, dbMin: -80, dbMax: -40 },
    );
    assert.deepEqual(
        spectrumBoxZoom({ freqNorm: 0, dbNorm: 0 }, { freqNorm: 1, dbNorm: 1 }, W, H, { freqStart: 0, freqEnd: 1 }, null),
        { freqStart: 0, freqEnd: 1 },
    );
});

test('overlaySpectrumRegionAt splits the canvas into dB axis, frequency axis and plot', () => {
    assert.equal(overlaySpectrumRegionAt(10, 50, W, H), 'db-axis');
    assert.equal(overlaySpectrumRegionAt(80, 120, W, H), 'freq-axis');
    assert.equal(overlaySpectrumRegionAt(80, 50, W, H), 'plot');
    assert.equal(overlaySpectrumRegionAt(80, 4, W, H), null);
    assert.equal(overlaySpectrumRegionAt(140, 50, W, H), null);
});
