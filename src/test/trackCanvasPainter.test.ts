import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpectrogramData, WaveformEnvelope } from '../shared/analysis/analysisTypes';
import { DEFAULT_THEME } from '../webview/draw/canvasDrawers';
import { hexToRgba, paintTrackSpectrogram, paintTrackWaveform, spectrogramPlotWidth, type WaveformPaintView } from '../webview/runtime/trackCanvasPainter';

function recordingCtx(): { ctx: CanvasRenderingContext2D; calls: string[]; props: Record<string, unknown> } {
    const calls: string[] = [];
    const props: Record<string, unknown> = {};
    const target: Record<string, unknown> = {};
    const ctx = new Proxy(target, {
        get(_t, prop) {
            const key = String(prop);
            if (key in target) {
                return target[key];
            }
            if (key === 'measureText') {
                return () => ({ width: 10 });
            }
            if (key === 'createImageData') {
                return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
            }
            return () => { calls.push(key); };
        },
        set(_t, prop, value) {
            const key = String(prop);
            if (typeof value === 'function') {
                target[key] = value;
            }
            else {
                props[key] = value;
            }
            return true;
        },
        deleteProperty(_t, prop) {
            delete target[String(prop)];
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, calls, props };
}

const view: WaveformPaintView = { zoomStart: 0, zoomEnd: 1, offsetNorm: 0, trackDurRatio: 1, amplitudeMinNorm: undefined, amplitudeMaxNorm: undefined };
const waveform = { min: [0], max: [0] } as unknown as WaveformEnvelope;

test('hexToRgba converts a #rrggbb color', () => {
    assert.equal(hexToRgba('#ff8000', 0.25), 'rgba(255,128,0,0.25)');
});

test('paintTrackWaveform draws only the zero line when there is no source or pipeline', () => {
    const { ctx, calls, props } = recordingCtx();
    assert.equal(paintTrackWaveform(ctx, 200, 100, '#ff0000', null, view, () => undefined), null);
    assert.deepEqual(calls, ['beginPath', 'moveTo', 'lineTo', 'stroke']);
    assert.equal(props.strokeStyle, 'rgba(255,0,0,0.25)');
    const src = { waveform, dataStart: 0, dataEnd: 1, amplitudeScale: undefined };
    assert.equal(paintTrackWaveform(recordingCtx().ctx, 200, 100, '#ff0000', src, view, undefined), null);
});

test('paintTrackWaveform passes the view and source to the pipeline and reports the drawn coverage', () => {
    const { ctx } = recordingCtx();
    let options: Record<string, unknown> = {};
    const coverage = paintTrackWaveform(ctx, 200, 100, '#00ff00', { waveform, dataStart: 0.2, dataEnd: 0.8, amplitudeScale: 0.5 }, view, (c, _w, _h, _wf, opts) => {
        options = opts;
        c.moveTo(40, 10);
        c.lineTo(120, 20);
    });
    assert.deepEqual(coverage, { minX: 40, maxX: 120, canvasWidth: 200, coversLeft: false, coversRight: false });
    assert.equal(options.dataStart, 0.2);
    assert.equal(options.dataEnd, 0.8);
    assert.equal(options.color, '#00ff00');
    assert.equal(options.amplitudeScale, 0.5);
    assert.equal(options.zoomEnd, 1);
});

const spec: SpectrogramData = {
    values: [[-80, -20], [-60, -40]],
    timeBins: 2, frequencyBins: 2, windowSize: 1024, hopSize: 256,
    maxFrequencyHz: 1000, minDb: -80, maxDb: -20, unit: 'dB',
};
const rasterView = { zoomStart: 0, zoomEnd: 1, trackStart: 0, trackDurRatio: 1, dbLo: -80, dbHi: -20, maxFrequencyHz: 1000 };

test('paintTrackSpectrogram repaints only when the spectrogram or its view changes', () => {
    const first = recordingCtx();
    const entry = paintTrackSpectrogram(first.ctx, 120, 40, spec, rasterView, undefined, DEFAULT_THEME);
    assert.ok(first.calls.includes('putImageData'));
    assert.equal(entry.source, spec);

    const same = recordingCtx();
    assert.equal(paintTrackSpectrogram(same.ctx, 120, 40, spec, rasterView, entry, DEFAULT_THEME), entry);
    assert.deepEqual(same.calls, []);

    const zoomed = recordingCtx();
    const next = paintTrackSpectrogram(zoomed.ctx, 120, 40, spec, { ...rasterView, zoomEnd: 0.5 }, entry, DEFAULT_THEME);
    assert.notEqual(next, entry);
    assert.ok(zoomed.calls.includes('putImageData'));
});

test('spectrogramPlotWidth leaves room for the colorbar and never drops below one pixel', () => {
    assert.equal(spectrogramPlotWidth(200), 150);
    assert.equal(spectrogramPlotWidth(10), 1);
});
