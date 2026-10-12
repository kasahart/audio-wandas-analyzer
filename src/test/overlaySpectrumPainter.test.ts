import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_THEME, type CanvasDrawCtx } from '../webview/draw/canvasDrawers';
import { paintOverlaySpectrum, type OverlaySpectrumHover } from '../webview/runtime/overlaySpectrumPainter';
import type { SpectrumViewState } from '../webview/runtime/spectrumRuntime';
import type { SpectrumSeries } from '../webview/runtime/types';

function recordingCtx(): { ctx: CanvasDrawCtx; calls: string[] } {
    const calls: string[] = [];
    const ctx = new Proxy({}, {
        get(_target, prop) {
            if (prop === 'measureText') {
                return () => ({ width: 10 });
            }
            return () => { calls.push(String(prop)); };
        },
        set() {
            return true;
        },
    }) as unknown as CanvasDrawCtx;
    return { ctx, calls };
}

const series: SpectrumSeries[] = [{
    slice: { values: [-60, -20, -40, -50], frequencyBins: 4, maxFrequencyHz: 1000, minDb: -60, maxDb: -20, unit: 'dB' },
    color: '#ff0000',
    index: 0,
    channelIndex: 0,
    label: 'A',
}];
const fullView: SpectrumViewState = { freqStart: 0, freqEnd: 1, dbMin: null, dbMax: null };
const noHover: OverlaySpectrumHover = { norm: null, yFrac: null, target: null };

test('paintOverlaySpectrum reports the visible window and clears the readout without a hover', () => {
    const { ctx, calls } = recordingCtx();
    const paint = paintOverlaySpectrum(ctx, 400, 200, series, fullView, noHover, null, DEFAULT_THEME);
    assert.equal(calls[0], 'clearRect');
    assert.equal(paint.painted, true);
    assert.equal(paint.maxFrequencyHz, 1000);
    assert.ok(paint.dbMin <= -60 && paint.dbMax >= -20);
    assert.deepEqual(paint.readout, { text: '', color: '' });
});

test('paintOverlaySpectrum fills the readout from the nearest series under an overlay hover', () => {
    const { ctx } = recordingCtx();
    const paint = paintOverlaySpectrum(ctx, 400, 200, series, fullView, { norm: 0.3, yFrac: 0.5, target: 'overlay' }, null, DEFAULT_THEME);
    assert.equal(paint.readout?.color, '#ff0000');
    assert.match(paint.readout?.text ?? '', /^A/);
});

test('paintOverlaySpectrum leaves the readout alone while a per-track spectrum is hovered', () => {
    const { ctx } = recordingCtx();
    const paint = paintOverlaySpectrum(ctx, 400, 200, series, fullView, { norm: 0.3, yFrac: 0.5, target: 'track-1' as OverlaySpectrumHover['target'] }, null, DEFAULT_THEME);
    assert.equal(paint.readout, null);
});

test('paintOverlaySpectrum stops after the axes when the frequency window is empty', () => {
    const { ctx } = recordingCtx();
    const paint = paintOverlaySpectrum(ctx, 400, 200, series, { ...fullView, freqStart: 0.5, freqEnd: 0.5 }, { norm: 0.3, yFrac: 0.5, target: 'overlay' }, null, DEFAULT_THEME);
    assert.equal(paint.painted, false);
    assert.equal(paint.readout, null);
});
