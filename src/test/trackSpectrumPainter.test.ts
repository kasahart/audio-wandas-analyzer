import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_THEME, type CanvasDrawCtx } from '../webview/draw/canvasDrawers';
import type { SpectrumViewState } from '../webview/runtime/spectrumRuntime';
import { paintTrackSpectrum, type TrackSpectrumSeries } from '../webview/runtime/trackSpectrumPainter';

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

const series: TrackSpectrumSeries = {
    slice: { values: [-60, -20, -40, -50], frequencyBins: 4, maxFrequencyHz: 1000, minDb: -60, maxDb: -20, unit: 'dB' },
    color: '#00ff00',
    label: 'B / ch1',
};
const fullView: SpectrumViewState = { freqStart: 0, freqEnd: 1, dbMin: null, dbMax: null };

test('paintTrackSpectrum clears the canvas and returns no readout without a hover', () => {
    const { ctx, calls } = recordingCtx();
    assert.equal(paintTrackSpectrum(ctx, 180, 80, series, fullView, null, DEFAULT_THEME), null);
    assert.equal(calls[0], 'clearRect');
    assert.ok(calls.includes('stroke'));
});

test('paintTrackSpectrum returns the hovered bin readout in the series color', () => {
    const { ctx } = recordingCtx();
    const readout = paintTrackSpectrum(ctx, 180, 80, series, fullView, 0.4, DEFAULT_THEME);
    assert.equal(readout?.color, '#00ff00');
    assert.match(readout?.text ?? '', /^B \/ ch1/);
});
