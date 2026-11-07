import assert from 'node:assert/strict';
import test from 'node:test';
import type { SpectrogramData, WaveformEnvelope } from '../shared/analysis/analysisTypes';
import { hexToRgba, onColourBar, paintTrackSpectrogram, paintTrackWaveform, type WaveformPaintView } from '../webview/runtime/trackCanvasPainter';

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
                return (w: number, h: number) => { calls.push(`createImageData ${w}x${h}`); return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; };
            }
            if (key === 'createLinearGradient') {
                return () => ({ addColorStop() { /* recorded by nothing */ } });
            }
            if (key === 'fillText') {
                return (text: string) => { calls.push(`fillText ${text}`); };
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

test('paintTrackWaveform draws finer detail over its own span and the overview only around it', () => {
    const { ctx, calls } = recordingCtx();
    const rects: number[][] = [];
    (ctx as unknown as { rect: (...args: number[]) => void }).rect = (...args: number[]) => { rects.push(args); };
    const drawn: Array<{ dataStart: unknown; rects: number }> = [];
    const detail = { waveform, dataStart: 0.25, dataEnd: 0.5, amplitudeScale: undefined };
    paintTrackWaveform(ctx, 200, 100, '#00ff00', { waveform, dataStart: 0, dataEnd: 1, amplitudeScale: undefined, detail }, view, (_c, _w, _h, _wf, opts) => {
        drawn.push({ dataStart: opts.dataStart, rects: rects.length });
    });
    assert.deepEqual(drawn, [{ dataStart: 0, rects: 2 }, { dataStart: 0.25, rects: 3 }]);
    assert.deepEqual(rects, [[0, 0, 50, 100], [100, 0, 100, 100], [50, 0, 50, 100]]);
    assert.equal(calls.filter(call => call === 'clip').length, 2);
});

const spec: SpectrogramData = {
    values: [[-80, -20], [-60, -40]],
    timeBins: 2, frequencyBins: 2, windowSize: 1024, hopSize: 256,
    maxFrequencyHz: 1000, minDb: -80, maxDb: -20, unit: 'dB',
};
const STYLE = { title: 'Level [dBFS]', text: '#ddd', back: '#111', line: '#444' };
const rasterView = { zoomStart: 0, zoomEnd: 1, trackStart: 0, trackDurRatio: 1, dbLo: -80, dbHi: -20, maxFrequencyHz: 1000 };

test('paintTrackSpectrogram repaints only when the spectrogram or its view changes', () => {
    const first = recordingCtx();
    const entry = paintTrackSpectrogram(first.ctx, 120, 40, spec, rasterView, undefined, STYLE);
    assert.ok(first.calls.includes('putImageData'));
    assert.equal(entry.source, spec);

    const same = recordingCtx();
    assert.equal(paintTrackSpectrogram(same.ctx, 120, 40, spec, rasterView, entry, STYLE), entry);
    assert.deepEqual(same.calls, []);

    const zoomed = recordingCtx();
    const next = paintTrackSpectrogram(zoomed.ctx, 120, 40, spec, { ...rasterView, zoomEnd: 0.5 }, entry, STYLE);
    assert.notEqual(next, entry);
    assert.ok(zoomed.calls.includes('putImageData'));
});

test('a spectrogram lane is drawn over its whole width, with the colour bar every coloured picture draws in its top right (R13)', () => {
    const { ctx, calls } = recordingCtx();
    const entry = paintTrackSpectrogram(ctx, 400, 60, spec, rasterView, undefined, STYLE);
    // The raster spans the canvas: the lanes share one time axis with nothing beside it.
    assert.ok(calls.includes('createImageData 400x60'), calls.join(','));
    // paintColourBar: the name, the low end, the strip, the high end.
    assert.ok(calls.includes('fillText Level [dBFS]') && calls.includes('fillText -80') && calls.includes('fillText -20'), calls.join(','));
    const box = entry.colourBar;
    assert.ok(box.x > 0 && box.x + box.width <= 396 && box.y === 3 && box.height === 14, JSON.stringify(box));
    assert.equal(onColourBar(entry, box.x + 1, box.y + 1), true);
    assert.equal(onColourBar(entry, 10, 50), false);
    // A new name is a new look: the lane is painted again.
    const renamed = recordingCtx();
    assert.notEqual(paintTrackSpectrogram(renamed.ctx, 400, 60, spec, rasterView, entry, { ...STYLE, title: 'Level [dB SPL]' }), entry);
});
