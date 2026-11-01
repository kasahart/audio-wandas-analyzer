import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_THEME, type CanvasDrawCtx } from '../webview/draw/canvasDrawers';
import { spectrumReadoutText, steppedTrackSpectrumHoverNorm, type SpectrumViewState } from '../webview/runtime/spectrumRuntime';
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

// n_fft 2048 at 48 kHz (1025 bins), and the 8193-bin row a CSV export leaves cached, on a 276 px lane (238 px plot).
for (const [bins, tone] of [[1025, 40], [8193, 320]]) {
    test(`each arrow press moves the lane readout one bin, also over bins denser than pixels (${bins} bins)`, () => {
        const values = Array.from({ length: bins }, (_, bin) => -Math.abs(bin - tone) / 10);
        const dense: TrackSpectrumSeries = { ...series, slice: { values, frequencyBins: bins, maxFrequencyHz: 24000, minDb: -100, maxDb: 0, unit: 'dB' } };
        const binHz = (bin: number) => bin * 24000 / (bins - 1);
        const readoutAt = (bin: number) => spectrumReadoutText(dense.label, dense.slice, binHz(bin), values[bin]);
        const { ctx } = recordingCtx();
        // The pointer one pixel beside the tone reads the tone.
        let norm = binHz(tone) / 24000 + 1 / 238;
        assert.equal(paintTrackSpectrum(ctx, 276, 80, dense, fullView, norm, DEFAULT_THEME)?.text, readoutAt(tone));
        norm = binHz(tone) / 24000;
        for (let press = 1; press <= 8; press++) {
            norm = steppedTrackSpectrumHoverNorm(dense.slice, norm, 0, 1, 1) ?? NaN;
            assert.equal(paintTrackSpectrum(ctx, 276, 80, dense, fullView, norm, DEFAULT_THEME, true)?.text, readoutAt(tone + press), `press ${press}`);
        }
    });
}
