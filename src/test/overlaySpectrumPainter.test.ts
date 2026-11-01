import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_THEME, type CanvasDrawCtx } from '../webview/draw/canvasDrawers';
import { paintOverlaySpectrum, type OverlaySpectrumHover } from '../webview/runtime/overlaySpectrumPainter';
import { spectrumReadoutText, spectrumVisibleWindow, steppedOverlaySpectrumHoverNorm, type SpectrumViewState } from '../webview/runtime/spectrumRuntime';
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

for (const [bins, tone] of [[1025, 40], [8193, 320]]) {
    test(`each arrow press moves the overlay readout one bin, also over bins denser than pixels (${bins} bins)`, () => {
        const values = Array.from({ length: bins }, (_, bin) => -Math.abs(bin - tone) / 10);
        const dense: SpectrumSeries[] = [{ ...series[0], slice: { values, frequencyBins: bins, maxFrequencyHz: 24000, minDb: -100, maxDb: 0, unit: 'dB' } }];
        const binHz = (bin: number) => bin * 24000 / (bins - 1);
        const readoutAt = (bin: number) => spectrumReadoutText('A', dense[0].slice, binHz(bin), values[bin]);
        const vis = spectrumVisibleWindow(24000, -100, 0, fullView);
        const { ctx } = recordingCtx();
        // The pointer one pixel beside the tone (300 px plot) reads the tone.
        const pointer = { norm: binHz(tone) / 24000 + 1 / 300, yFrac: 0.1, target: 'overlay' as const };
        assert.equal(paintOverlaySpectrum(ctx, 356, 200, dense, fullView, pointer, null, DEFAULT_THEME).readout?.text, readoutAt(tone));
        let norm = binHz(tone) / 24000;
        for (let press = 1; press <= 8; press++) {
            norm = steppedOverlaySpectrumHoverNorm(dense, norm, 0.1, { width: 356, height: 200 }, vis, 1) ?? NaN;
            const hover = { norm, yFrac: 0.1, target: 'overlay' as const, stepped: true };
            assert.equal(paintOverlaySpectrum(ctx, 356, 200, dense, fullView, hover, null, DEFAULT_THEME).readout?.text, readoutAt(tone + press), `press ${press}`);
        }
    });
}
